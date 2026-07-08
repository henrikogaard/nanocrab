import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';

import { STORE_DIR } from '../../config.js';
import { createApproval, listApprovals } from '../../approvals.js';
import { estimateCoworkRun } from '../../cowork-run-estimator.js';
import {
  classifyCoworkProjectFile,
  COWORK_PROJECT_FILE_PREVIEW_LIMIT,
  coworkProjectPath,
  ensureCoworkProjectFolder,
  isPreviewableCoworkProjectFile,
  listCoworkProjectFiles,
  resolveCoworkProjectFile,
  safeCoworkProjectFilePath,
  writeCoworkProjectFile,
} from '../../cowork-projects.js';
import { logger } from '../../logger.js';
import {
  isApprovalSensitiveCoworkItem,
  normalizeCoworkProvenance,
  normalizeCoworkSensitivity,
} from '../../cowork-metadata.js';
import {
  createResearchJob,
  updateResearchJobMetadata,
} from '../../research-jobs.js';
import {
  buildDesignSystemPromptContext,
  createDesignSystem,
  deleteDesignSystem,
  designSystemSelectionSummary,
  listDesignSystems,
  setDefaultDesignSystem,
  setProjectDefaultDesignSystem,
  updateDesignSystem,
  type DesignSystem,
} from '../../design-systems.js';
import { listSkillRegistry } from '../../skill-registry.js';
import { getPlugins, isPluginEnabled } from '../plugins/registry.js';
import type {
  ContainerConfig,
  CoworkContextItem,
  CoworkProject,
  CoworkRun,
  CoworkRunEvent,
  CoworkRunStep,
} from '../../types.js';
import { isAgentProvider } from '../../agent-provider.js';
import {
  loadConnectorPermissions,
  normalizeConnectorId,
  normalizeConnectorPermission,
  saveConnectorPermissions,
  type ConnectorPermission,
} from '../../connector-permissions.js';
import {
  createCoworkContextItem,
  createCoworkProject,
  createCoworkRun,
  createCoworkRunEvent,
  createCoworkRunStep,
  deleteCoworkContextItem,
  getCoworkContextItem,
  getCoworkContextItems,
  getCoworkProject,
  getCoworkProjectBySlug,
  getCoworkProjects,
  getCoworkRun,
  getCoworkRunEvents,
  getCoworkRuns,
  getCoworkRunSteps,
  getLatestStoredMessage,
  getWebThreads,
  nextCoworkRunEventOrder,
  setRegisteredGroup,
  touchCoworkProject,
  updateCoworkContextItem,
  updateCoworkProjectContext,
  updateCoworkRunStatus,
} from '../../db.js';
import { buildThreadGroup, newWebJid } from '../../web-threads.js';
import { getState } from '../state.js';

const router = Router();
const MCP_CONFIG_PATH = path.join(STORE_DIR, 'mcp-servers.json');

interface McpServerConfigShape {
  name?: unknown;
  label?: unknown;
  core?: unknown;
}

function slugifyProjectName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

function uniqueProjectSlug(name: string): string {
  const base = slugifyProjectName(name);
  let slug = base;
  let suffix = 2;
  while (getCoworkProjectBySlug(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function readConfiguredMcpServers(): McpServerConfigShape[] {
  try {
    if (!fs.existsSync(MCP_CONFIG_PATH)) {
      return [];
    }
    const raw = JSON.parse(
      fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'),
    ) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (server): server is McpServerConfigShape =>
        Boolean(server) && typeof server === 'object',
    );
  } catch (err) {
    logger.warn(
      { err },
      'Could not read MCP server configuration for project summary',
    );
    return [];
  }
}

function normalizeMcpServerName(server: McpServerConfigShape): string {
  return normalizeConnectorId(server.name);
}

function configuredExternalMcpServers(): string[] {
  return readConfiguredMcpServers()
    .map((server) => ({
      name: normalizeMcpServerName(server),
      core: server.core === true,
    }))
    .filter(
      (server) => server.name && !server.core && server.name !== 'nanocrab',
    )
    .map((server) => server.name)
    .sort((a, b) => a.localeCompare(b));
}

function projectThreadMcpServers(): string[] {
  return configuredExternalMcpServers();
}

function ensureProjectThreadMcpPermissions(serverNames: string[]): void {
  if (!serverNames.length) return;
  const permissions = loadConnectorPermissions();
  const existingIds = new Set(
    permissions.map((permission) => permission.connectorId),
  );
  const additions: ConnectorPermission[] = [];

  for (const serverName of serverNames) {
    const connectorId = normalizeConnectorId(serverName);
    if (
      !connectorId ||
      connectorId === 'nanocrab' ||
      existingIds.has(connectorId)
    ) {
      continue;
    }
    additions.push(
      normalizeConnectorPermission({
        connectorId,
        scope: 'main',
        allowedActions: ['*.read', 'tools.expose'],
        requiresApproval: true,
        groups: [],
        agents: [],
      }),
    );
    existingIds.add(connectorId);
  }

  if (additions.length) {
    saveConnectorPermissions([...permissions, ...additions]);
  }
}

function projectThreads(projectId: string): Array<{
  id: string;
  title: string;
  addedAt: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
}> {
  return Object.entries(getWebThreads())
    .filter(([, group]) => group.projectId === projectId)
    .map(([jid, group]) => {
      const latest = getLatestStoredMessage(jid);
      return {
        id: jid,
        title: group.title ?? 'New conversation',
        addedAt: group.added_at,
        lastMessage: latest?.content ?? null,
        lastMessageAt: latest?.timestamp ?? null,
      };
    })
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

function projectFileManifest(
  files: ReturnType<typeof listCoworkProjectFiles>,
): string {
  if (!files.length) {
    return 'Project file manifest: no project files yet. Ask the user to add source material or create a local draft before claiming file-backed evidence.';
  }

  const lines = files.slice(0, 24).map((file) => {
    return `- ${file.path} (${file.kind}, ${file.size} bytes)`;
  });
  if (files.length > 24) {
    lines.push(`- ...and ${files.length - 24} more project files`);
  }
  return ['Project file manifest:', ...lines].join('\n');
}

function contextItemLocator(item: CoworkContextItem): string {
  if (item.path) return `path: ${item.path}`;
  if (item.url) return `url: ${item.url}`;
  if (item.thread_id) return `thread: ${item.thread_id}`;
  if (item.artifact_id) return `artifact: ${item.artifact_id}`;
  return 'manual note';
}

function projectContextNotebookManifest(items: CoworkContextItem[]): string {
  const included = items.filter((item) => item.included);
  if (!included.length) {
    return 'Project context notebook: no included notebook items yet. Use project files and ask before treating excluded/stale notebook items as active context.';
  }

  const lines = included.slice(0, 24).map((item) => {
    const flags = [
      item.type || 'note',
      item.sensitivity || 'unknown',
      item.pinned ? 'pinned' : 'unpinned',
      item.provenance || 'manual',
    ].join(', ');
    return `- ${item.title} [${flags}] ${contextItemLocator(item)}; updated: ${item.updated_at}`;
  });
  if (included.length > 24) {
    lines.push(`- ...and ${included.length - 24} more included notebook items`);
  }
  lines.push(
    'Only included notebook items are injected into this chat. Excluded items remain inspectable in the UI but should not be used unless the user asks to include them.',
  );
  return ['Project context notebook:', ...lines].join('\n');
}

const PROJECT_MCP_EXAMPLES = [
  'Summarize the latest project emails into a sourced markdown brief',
  'Check all emails from a person or domain and extract commitments',
  'Generate a summary document from mail, calendar, document, storage, or custom MCP context',
  'Create a project artifact with source ledger, assumptions, and approval notes',
];

function serializeDesignSystem(
  system: DesignSystem,
  options: { includeContent?: boolean } = {},
) {
  const serialized: {
    id: string;
    name: string;
    description: string | null;
    content?: string;
    sourceFileName: string | null;
    createdAt: string;
    updatedAt: string;
  } = {
    id: system.id,
    name: system.name,
    description: system.description,
    sourceFileName: system.sourceFileName,
    createdAt: system.createdAt,
    updatedAt: system.updatedAt,
  };
  if (options.includeContent) {
    serialized.content = system.content;
  }
  return serialized;
}

function designSystemState(projectId?: string | null) {
  const store = listDesignSystems();
  const selection = designSystemSelectionSummary({ projectId });
  return {
    available: store.systems.map((system) => serializeDesignSystem(system)),
    default: selection.selected ? serializeDesignSystem(selection.selected) : null,
    defaultSource: selection.source,
    globalDefaultId: store.defaultDesignSystemId,
    projectDefaultId: projectId
      ? store.projectDefaults[
          projectId
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
        ] || null
      : null,
  };
}

function designSystemManifest(): string {
  const systems = listDesignSystems().systems;
  if (!systems.length) {
    return 'Available design systems: none uploaded yet. Ask the user to upload a design system before claiming a specific brand, document, or presentation style is configured.';
  }
  return [
    'Available design systems for generated documents, presentations, and artifacts:',
    ...systems.map(
      (system) =>
        `- ${system.name} (id: ${system.id})${system.description ? ` - ${system.description}` : ''}`,
    ),
    'Use the project default design system unless the user names a specific system. If the user names a system that is not listed, ask them to upload or select it first.',
  ].join('\n');
}

function requestedDesignSystem(value: {
  designSystemId?: unknown;
  designSystemName?: unknown;
}): string | null {
  return (
    trimmed(value.designSystemId) ||
    trimmed(value.designSystemName) ||
    null
  );
}

function selectedDesignSystemForProject(
  projectId: string,
  input: {
    designSystemId?: unknown;
    designSystemName?: unknown;
  },
) {
  const requested = requestedDesignSystem(input);
  const selection = designSystemSelectionSummary({
    projectId,
    requestedDesignSystem: requested,
  });
  if (requested && !selection.selected) {
    throw new Error('Design system not found');
  }
  return selection;
}

function projectSummary(project: CoworkProject) {
  const files = listCoworkProjectFiles(project);
  const threads = projectThreads(project.id);
  const servers = configuredExternalMcpServers();
  const skills = listSkillRegistry();
  const plugins = getPlugins();
  return {
    ...project,
    path: coworkProjectPath(project),
    fileCount: files.length,
    chatCount: threads.length,
    updatedAt: project.updated_at,
    designSystems: designSystemState(project.id),
    mcpAccess: {
      enabled: servers.length > 0,
      scope: servers.length > 0 ? 'configured' : 'nanocrab-only',
      servers,
      setupHint: servers.length
        ? 'Project chats can call these configured external MCP servers when connector permissions allow tool exposure.'
        : 'Add a mail, calendar, document, storage, or custom MCP server before project chats can gather external context.',
      requiresApprovalForWrites: true,
      examples: PROJECT_MCP_EXAMPLES,
    },
    capabilities: {
      skills: {
        total: skills.length,
        active: skills.filter((skill) => skill.enabled).length,
      },
      plugins: {
        total: plugins.length,
        active: plugins.filter((plugin) => isPluginEnabled(plugin.id)).length,
      },
      connectors: { total: servers.length },
    },
  };
}

function projectContextSizeBytes(project: CoworkProject): number {
  return listCoworkProjectFiles(project).reduce(
    (total, file) => total + file.size,
    0,
  );
}

function parseStats(statsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(statsJson) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validHttpUrl(value: unknown): string | null {
  const source = trimmed(value);
  if (!source) return null;
  try {
    const url = new URL(source);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function requestUrlOrNull(value: unknown): {
  url: string | null;
  invalid: boolean;
} {
  if (typeof value !== 'string' || !value.trim()) {
    return { url: null, invalid: false };
  }
  const url = validHttpUrl(value);
  return { url, invalid: !url };
}

function coworkRunIntent(run: CoworkRun) {
  const text = `${run.title}\n${run.prompt || ''}`.toLowerCase();
  const isResearch =
    /\bresearch\b|\bcitation|\bcitations\b|\bsources?\b|\bevidence\b/.test(
      text,
    );
  return {
    mode: isResearch ? 'research' : 'execution',
    requiresCitations: isResearch,
  };
}

function citationEntriesFromValue(
  value: unknown,
): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return [];
  const entry = value as Record<string, unknown>;
  const nested = Array.isArray(entry.citations)
    ? entry.citations.flatMap(citationEntriesFromValue)
    : [];
  if (nested.length) return nested;
  return entry.kind === 'citation' || trimmed(entry.sourceUrl)
    ? [entry, ...nested]
    : nested;
}

function coworkRunOutputs(
  events: CoworkRunEvent[],
): Array<Record<string, unknown>> {
  return events.flatMap((event) => {
    const metadata = parseStats(event.metadata_json);
    if (event.kind === 'citation_added') {
      return [
        {
          kind: 'citation',
          title: metadata.title,
          sourceUrl: metadata.sourceUrl,
          note: metadata.note,
        },
      ];
    }
    if (event.kind === 'outputs_updated' && Array.isArray(metadata.outputs)) {
      return metadata.outputs.filter(
        (output): output is Record<string, unknown> =>
          Boolean(output) && typeof output === 'object',
      );
    }
    return [];
  });
}

function coworkResearchCoverage(outputs: Array<Record<string, unknown>>) {
  const citationCount = outputs.flatMap(citationEntriesFromValue).length;
  return {
    citationCount,
    status:
      citationCount === 0
        ? 'missing'
        : citationCount < 3
          ? 'partial'
          : 'sufficient',
    guidance:
      citationCount === 0
        ? 'Add at least 3 citations before relying on this research run.'
        : citationCount < 3
          ? 'Add more citations to reach the recommended minimum of 3.'
          : 'Citation coverage meets the recommended minimum.',
  };
}

function coworkRunApprovals(events: CoworkRunEvent[]) {
  return events
    .filter((event) =>
      ['action-requested', 'action-workflow-approval-requested'].includes(
        event.kind,
      ),
    )
    .map((event) => parseStats(event.metadata_json))
    .filter((metadata) => metadata.approval)
    .map((metadata) => metadata.approval);
}

function markdownEscape(value: unknown): string {
  return String(value || '').replace(/([\\[\]()])/g, '\\$1');
}

function markdownUrl(value: unknown): string {
  return String(value || '')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

const COWORK_ACTION_WORKFLOWS = {
  'email-summary': {
    label: 'Email summary',
    connectorId: 'gmail',
    action: 'gmail.read',
    readOnly: true,
    description: 'Read mail context and save a local project summary artifact.',
  },
  'email-draft': {
    label: 'Email draft',
    connectorId: 'gmail',
    action: 'gmail.send',
    readOnly: false,
    description:
      'Prepare an email draft preview and require approval before external mutation.',
  },
  'calendar-draft': {
    label: 'Calendar draft',
    connectorId: 'calendar',
    action: 'calendar.write',
    readOnly: false,
    description:
      'Prepare a calendar change preview and require approval before external mutation.',
  },
  'document-artifact': {
    label: 'Document artifact',
    connectorId: 'documents',
    action: 'documents.read',
    readOnly: true,
    description:
      'Generate a local source-backed document artifact from supplied context.',
  },
  'file-delivery': {
    label: 'File delivery',
    connectorId: 'files',
    action: 'files.send',
    readOnly: false,
    description:
      'Prepare a file delivery preview and require approval before external send.',
  },
} as const;

type CoworkActionWorkflowKind = keyof typeof COWORK_ACTION_WORKFLOWS;

function coworkActionWorkflowKind(
  value: unknown,
): CoworkActionWorkflowKind | null {
  return typeof value === 'string' && value in COWORK_ACTION_WORKFLOWS
    ? (value as CoworkActionWorkflowKind)
    : null;
}

function workflowArtifactPath(
  run: CoworkRun,
  kind: CoworkActionWorkflowKind,
  rawPath: unknown,
): string {
  const requested =
    typeof rawPath === 'string' ? safeCoworkProjectFilePath(rawPath) : null;
  return requested || `actions/run-${run.id}-${kind}.md`;
}

function workflowPreviewContent(input: {
  title: string;
  kind: CoworkActionWorkflowKind;
  connectorId: string;
  action: string;
  target: string | null;
  note: string | null;
  mockData: unknown[];
}): string {
  return [
    `# ${input.title}`,
    '',
    `Workflow: ${input.kind}`,
    `Connector: ${input.connectorId}`,
    `Action: ${input.action}`,
    input.target ? `Target: ${input.target}` : '',
    input.note ? `Note: ${input.note}` : '',
    '',
    '## Preview',
    COWORK_ACTION_WORKFLOWS[input.kind].description,
    '',
    input.mockData.length ? '## Mock connector data' : '',
    input.mockData.length ? JSON.stringify(input.mockData, null, 2) : '',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function matchingPendingExternalWriteApproval(input: {
  runId: string;
  action: string;
  actionPreview: string | null;
  resourceSummary: string;
}) {
  return listApprovals({
    status: 'pending',
    kind: 'tool-action',
    targetType: 'cowork-run',
    targetId: input.runId,
  }).find(
    (approval) =>
      approval.policyDecisionId === 'cowork-external-write-approval' &&
      approval.payload?.action === input.action &&
      approval.actionPreview === input.actionPreview &&
      approval.resourceSummary === input.resourceSummary,
  );
}

function serializeCoworkRun(run: CoworkRun) {
  const events = getCoworkRunEvents(run.id);
  const outputs = coworkRunOutputs(events);
  return {
    id: run.id,
    projectId: run.project_id,
    title: run.title,
    status: run.status,
    provider: run.provider,
    model: run.model,
    complexity: run.complexity,
    approvalRisk: run.approval_risk,
    prompt: run.prompt,
    summary: run.summary,
    stats: parseStats(run.stats_json),
    intent: coworkRunIntent(run),
    outputs,
    approvals: coworkRunApprovals(events),
    researchCoverage: coworkResearchCoverage(outputs),
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    steps: getCoworkRunSteps(run.id).map(serializeCoworkRunStep),
    events: events.map(serializeCoworkRunEvent),
  };
}

function serializeCoworkRunStep(step: CoworkRunStep) {
  return {
    id: step.id,
    runId: step.run_id,
    order: step.step_order,
    title: step.title,
    status: step.status,
    detail: step.detail,
    createdAt: step.created_at,
    updatedAt: step.updated_at,
  };
}

function serializeCoworkRunEvent(event: CoworkRunEvent) {
  return {
    id: event.id,
    runId: event.run_id,
    order: event.event_order,
    kind: event.kind,
    message: event.message,
    metadata: parseStats(event.metadata_json),
    createdAt: event.created_at,
  };
}

function serializeCoworkContextItem(item: CoworkContextItem) {
  return {
    id: item.id,
    projectId: item.project_id,
    type: item.type,
    title: item.title,
    path: item.path ?? undefined,
    url: item.url ?? undefined,
    threadId: item.thread_id ?? undefined,
    artifactId: item.artifact_id ?? undefined,
    included: Boolean(item.included),
    pinned: Boolean(item.pinned),
    provenance: item.provenance,
    sensitivity: item.sensitivity,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function projectCapabilities(project: CoworkProject) {
  const files = listCoworkProjectFiles(project);
  const servers = configuredExternalMcpServers();
  const skills = listSkillRegistry();
  const activeSkills = skills.filter((skill) => skill.enabled);
  const plugins = getPlugins();
  const activePlugins = plugins.filter((plugin) => isPluginEnabled(plugin.id));
  return [
    {
      id: 'project-files',
      kind: 'files',
      label: 'Project files',
      enabled: true,
      unavailable: false,
      readOnly: true,
      writeCapable: true,
      approvalRequired: false,
      summary: `${files.length} local project file${files.length === 1 ? '' : 's'} available`,
    },
    {
      id: 'external-writes',
      kind: 'approval',
      label: 'External writes',
      enabled: true,
      unavailable: false,
      readOnly: false,
      writeCapable: true,
      approvalRequired: true,
      summary:
        'External sends, uploads, repo writes, calendar edits, webhooks, and connector mutations require approval.',
    },
    {
      id: 'project-skills',
      kind: 'skills',
      label: 'Active skills',
      enabled: true,
      unavailable: false,
      readOnly: true,
      writeCapable: false,
      approvalRequired: false,
      summary: `${activeSkills.length} active skill${activeSkills.length === 1 ? '' : 's'} of ${skills.length} installed`,
      states: {
        enabled: activeSkills.length,
        disabled: skills.length - activeSkills.length,
        private: skills.filter((skill) => skill.visibility === 'private')
          .length,
        system: skills.filter((skill) => skill.visibility === 'system').length,
      },
    },
    {
      id: 'project-plugins',
      kind: 'plugins',
      label: 'Active plugins',
      enabled: true,
      unavailable: false,
      readOnly: true,
      writeCapable: false,
      approvalRequired: false,
      summary: `${activePlugins.length} active plugin${activePlugins.length === 1 ? '' : 's'} of ${plugins.length} registered`,
      states: {
        enabled: activePlugins.length,
        disabled: plugins.length - activePlugins.length,
      },
    },
    ...activeSkills.slice(0, 12).map((skill) => ({
      id: `skill-${skill.path}`,
      kind: 'skill',
      label: skill.name,
      enabled: skill.enabled,
      unavailable: false,
      readOnly: true,
      writeCapable: skill.requiredTools.some((tool) =>
        /\b(write|send|upload|delete|create|update)\b/i.test(tool),
      ),
      approvalRequired: skill.riskLevel !== 'low',
      summary: `${skill.category} skill, ${skill.scope} scope, ${skill.visibility} visibility`,
      states: {
        scope: skill.scope,
        visibility: skill.visibility,
        riskLevel: skill.riskLevel,
      },
    })),
    ...plugins.slice(0, 12).map((plugin) => {
      const enabled = isPluginEnabled(plugin.id);
      return {
        id: `plugin-${plugin.id}`,
        kind: 'plugin',
        label: plugin.name,
        enabled,
        unavailable: !enabled,
        readOnly: true,
        writeCapable: true,
        approvalRequired: true,
        summary: enabled
          ? plugin.description
          : `${plugin.name} is disabled in Settings.`,
      };
    }),
    ...servers.map((server) => ({
      id: `connector-${server}`,
      kind: 'connector',
      label: server,
      enabled: true,
      unavailable: false,
      readOnly: true,
      writeCapable: true,
      approvalRequired: true,
      summary:
        'Configured MCP connector. Reads may be exposed by permissions; writes are approval-gated.',
    })),
  ];
}

function appendCoworkRunEvent(
  runId: string,
  kind: string,
  message: string,
  metadata: Record<string, unknown> = {},
): CoworkRunEvent {
  return createCoworkRunEvent({
    id: randomUUID(),
    run_id: runId,
    event_order: nextCoworkRunEventOrder(runId),
    kind,
    message,
    metadata_json: JSON.stringify(metadata),
    created_at: new Date().toISOString(),
  });
}

router.get('/design-systems', (_req: Request, res: Response) => {
  res.json({ designSystems: designSystemState() });
});

router.post('/design-systems', (req: Request, res: Response) => {
  try {
    const designSystem = createDesignSystem({
      name: req.body.name,
      description: req.body.description,
      content: req.body.content,
      sourceFileName: req.body.sourceFileName,
    });
    res.json({
      designSystem: serializeDesignSystem(designSystem, {
        includeContent: true,
      }),
      designSystems: designSystemState(),
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.patch('/design-systems/default', (req: Request, res: Response) => {
  try {
    const designSystemId = trimmed(req.body.designSystemId);
    setDefaultDesignSystem(designSystemId);
    res.json({ designSystems: designSystemState() });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.patch('/design-systems/:designSystemId', (req: Request, res: Response) => {
  try {
    const designSystem = updateDesignSystem(
      String(req.params.designSystemId),
      {
        name: req.body.name,
        description: req.body.description,
        content: req.body.content,
        sourceFileName: req.body.sourceFileName,
      },
    );
    res.json({
      designSystem: serializeDesignSystem(designSystem, {
        includeContent: true,
      }),
      designSystems: designSystemState(),
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.delete(
  '/design-systems/:designSystemId',
  (req: Request, res: Response) => {
    const removed = deleteDesignSystem(String(req.params.designSystemId));
    if (!removed) {
      res.status(404).json({ error: 'Design system not found' });
      return;
    }
    res.json({ removed: true, designSystems: designSystemState() });
  },
);

router.get('/', (_req: Request, res: Response) => {
  try {
    res.json({ projects: getCoworkProjects().map(projectSummary) });
  } catch (err) {
    logger.error({ err }, 'Failed to list cowork projects');
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }

    const now = new Date().toISOString();
    const project = createCoworkProject({
      id: randomUUID(),
      name,
      slug: uniqueProjectSlug(name),
      description:
        typeof req.body.description === 'string' && req.body.description.trim()
          ? req.body.description.trim()
          : null,
      instructions:
        typeof req.body.instructions === 'string' &&
        req.body.instructions.trim()
          ? req.body.instructions.trim()
          : null,
      created_at: now,
      updated_at: now,
    });
    ensureCoworkProjectFolder(project);
    res.json({ project: projectSummary(project) });
  } catch (err) {
    logger.error({ err }, 'Failed to create cowork project');
    res.status(500).json({ error: 'Failed to create project' });
  }
});

router.patch('/:id', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const updatedAt = new Date().toISOString();
    const updated = updateCoworkProjectContext(project.id, {
      description:
        typeof req.body.description === 'string' && req.body.description.trim()
          ? req.body.description.trim()
          : null,
      instructions:
        typeof req.body.instructions === 'string' &&
        req.body.instructions.trim()
          ? req.body.instructions.trim()
          : null,
      updated_at: updatedAt,
    });
    if (!updated) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json({ project: projectSummary(updated) });
  } catch (err) {
    logger.error(
      { err, projectId: project.id },
      'Failed to update cowork project',
    );
    res.status(500).json({ error: 'Failed to update project' });
  }
});

router.patch('/:id/design-system-default', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const designSystemId = trimmed(req.body.designSystemId);
    setProjectDefaultDesignSystem(project.id, designSystemId);
    touchCoworkProject(project.id, new Date().toISOString());
    res.json({
      project: projectSummary(getCoworkProject(project.id) || project),
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/:id/estimate', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({
    estimate: estimateCoworkRun({
      ...req.body,
      connectorIds: configuredExternalMcpServers(),
      contextItemCount: getCoworkContextItems(project.id).filter(
        (item) => item.included,
      ).length,
      contextSizeBytes: projectContextSizeBytes(project),
    }),
  });
});

router.get('/:id/runs', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({
    runs: getCoworkRuns(project.id).map(serializeCoworkRun),
  });
});

router.post('/:id/runs', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const title =
    typeof req.body.title === 'string' && req.body.title.trim()
      ? req.body.title.trim()
      : '';
  if (!title) {
    res.status(400).json({ error: 'Run title is required' });
    return;
  }

  try {
    const now = new Date().toISOString();
    const designSelection = selectedDesignSystemForProject(project.id, req.body);
    const estimate = estimateCoworkRun({
      ...req.body,
      connectorIds: configuredExternalMcpServers(),
      contextItemCount: getCoworkContextItems(project.id).filter(
        (item) => item.included,
      ).length,
      contextSizeBytes: projectContextSizeBytes(project),
    });
    const run = createCoworkRun({
      id: randomUUID(),
      project_id: project.id,
      title,
      status: estimate.approvalRisk === 'high' ? 'draft' : 'planning',
      provider: estimate.provider,
      model: estimate.model,
      complexity: estimate.complexity,
      approval_risk: estimate.approvalRisk,
      prompt:
        typeof req.body.prompt === 'string' && req.body.prompt.trim()
          ? req.body.prompt.trim()
          : null,
      summary: null,
      stats_json: JSON.stringify({
        approvalsRequested: 0,
        artifactsCreated: 0,
        toolCalls: 0,
        toolClasses: estimate.toolClasses,
        warnings: estimate.warnings,
        context: estimate.context,
        designSystem: designSelection.selected
          ? {
              id: designSelection.selected.id,
              name: designSelection.selected.name,
              source: designSelection.source,
            }
          : null,
      }),
      created_at: now,
      updated_at: now,
    });
    const stepTitles = [
      'Plan source-backed work',
      'Gather approved context',
      'Create local project artifact',
      'Request approval for external writes',
    ];
    stepTitles.forEach((stepTitle, index) => {
      createCoworkRunStep({
        id: randomUUID(),
        run_id: run.id,
        step_order: index + 1,
        title: stepTitle,
        status: 'pending',
        detail: null,
        created_at: now,
        updated_at: now,
      });
    });
    createCoworkRunEvent({
      id: randomUUID(),
      run_id: run.id,
      event_order: 1,
      kind: 'created',
      message: 'Cowork run created.',
      metadata_json: JSON.stringify({
        complexity: run.complexity,
        approvalRisk: run.approval_risk,
      }),
      created_at: now,
    });
    if (designSelection.selected) {
      createCoworkRunEvent({
        id: randomUUID(),
        run_id: run.id,
        event_order: 2,
        kind: 'design_system_selected',
        message: 'Design system selected for generated artifacts.',
        metadata_json: JSON.stringify({
          designSystemId: designSelection.selected.id,
          name: designSelection.selected.name,
          source: designSelection.source,
        }),
        created_at: now,
      });
    }
    touchCoworkProject(project.id, now);
    res.json({ run: serializeCoworkRun(run) });
  } catch (err) {
    logger.error({ err, projectId: project.id }, 'Failed to create Cowork run');
    res.status(500).json({ error: 'Failed to create Cowork run' });
  }
});

router.get('/:id/runs/:runId', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const run = getCoworkRun(project.id, String(req.params.runId));
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json({ run: serializeCoworkRun(run) });
});

router.patch('/:id/runs/:runId', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const run = getCoworkRun(project.id, String(req.params.runId));
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  const now = new Date().toISOString();
  if (req.body.action === 'checkpoint') {
    const updated =
      updateCoworkRunStatus(project.id, run.id, 'waiting_for_approval', now) ||
      run;
    appendCoworkRunEvent(
      run.id,
      'checkpoint',
      trimmed(req.body.message) || 'Run checkpoint recorded.',
    );
    touchCoworkProject(project.id, now);
    res.json({ run: serializeCoworkRun(updated) });
    return;
  }
  if (typeof req.body.outputs === 'string') {
    try {
      const outputs = JSON.parse(req.body.outputs) as unknown;
      if (!Array.isArray(outputs)) {
        res.status(400).json({ error: 'Run outputs must be an array' });
        return;
      }
      appendCoworkRunEvent(run.id, 'outputs_updated', 'Run outputs updated.', {
        outputs,
      });
      touchCoworkProject(project.id, now);
      res.json({
        run: serializeCoworkRun(getCoworkRun(project.id, run.id) || run),
      });
      return;
    } catch {
      res.status(400).json({ error: 'Run outputs must be valid JSON' });
      return;
    }
  }
  res.json({ run: serializeCoworkRun(run) });
});

function previewConnectorAction(connectorId: unknown, action: unknown) {
  const connector = normalizeConnectorId(String(connectorId || ''));
  const actionName = trimmed(action) || '';
  const permissions = loadConnectorPermissions();
  const permission = permissions.find((item) => item.connectorId === connector);
  const allowed = Boolean(
    permission?.allowedActions.some(
      (allowedAction) =>
        allowedAction === '*' ||
        allowedAction === actionName ||
        (allowedAction === '*.read' && /\.read$/i.test(actionName)) ||
        (allowedAction === 'tools.expose' && /\.read$/i.test(actionName)),
    ),
  );
  const requiresApproval = permission?.requiresApproval !== false;
  return {
    connectorId: connector,
    action: actionName,
    allowed,
    requiresApproval,
    reason: allowed
      ? requiresApproval
        ? 'Connector action is allowed but requires approval before execution.'
        : 'Connector action is allowed by current permissions.'
      : 'Connector action is not allowed by current connector permissions.',
  };
}

router.post(
  '/:id/runs/:runId/actions/preview',
  (req: Request, res: Response) => {
    const project = getCoworkProject(String(req.params.id));
    const run = project
      ? getCoworkRun(project.id, String(req.params.runId))
      : undefined;
    if (!project || !run) {
      res
        .status(project ? 404 : 404)
        .json({ error: project ? 'Run not found' : 'Project not found' });
      return;
    }
    res.json({
      preview: previewConnectorAction(req.body.connectorId, req.body.action),
    });
  },
);

router.post(
  '/:id/runs/:runId/actions/request',
  (req: Request, res: Response) => {
    const project = getCoworkProject(String(req.params.id));
    const run = project
      ? getCoworkRun(project.id, String(req.params.runId))
      : undefined;
    if (!project || !run) {
      res
        .status(404)
        .json({ error: project ? 'Run not found' : 'Project not found' });
      return;
    }
    const preview = previewConnectorAction(
      req.body.connectorId,
      req.body.action,
    );
    if (!preview.allowed) {
      res.status(403).json({ error: preview.reason, preview });
      return;
    }
    const now = new Date().toISOString();
    const sensitiveItems = getCoworkContextItems(project.id).filter(
      (item) =>
        item.included && isApprovalSensitiveCoworkItem(item.sensitivity),
    ).length;
    const approvalRecord = createApproval({
      kind: 'tool-action',
      title: `Approve ${preview.action}`,
      summary:
        trimmed(req.body.note) ||
        `Approve ${preview.connectorId} connector action ${preview.action}.`,
      risk: preview.requiresApproval ? 'high' : 'medium',
      requester: req.user?.username || 'dashboard',
      targetType: 'cowork-run',
      targetId: run.id,
      source: 'cowork-project',
      correlationId: run.id,
      actionPreview: preview.action,
      resourceSummary: `${project.name}: ${run.title}`,
      policyDecisionId: 'cowork-connector-action-approval',
      payload: {
        projectId: project.id,
        projectName: project.name,
        runId: run.id,
        runTitle: run.title,
        connectorId: preview.connectorId,
        action: preview.action,
        note: trimmed(req.body.note) || '',
        sensitivitySignals: { includedSensitiveItems: sensitiveItems },
      },
    });
    const actionApproval = {
      kind: 'connector-action',
      status: 'pending',
      connectorId: preview.connectorId,
      action: preview.action,
      note: trimmed(req.body.note) || '',
      approvalId: approvalRecord.id,
      requestedAt: now,
      sensitivitySignals: { includedSensitiveItems: sensitiveItems },
    };
    appendCoworkRunEvent(
      run.id,
      'action-requested',
      `${preview.action} approval requested.`,
      {
        approval: actionApproval,
      },
    );
    const updated =
      updateCoworkRunStatus(project.id, run.id, 'waiting_for_approval', now) ||
      run;
    touchCoworkProject(project.id, now);
    res.status(202).json({
      requested: true,
      approvalRequired: preview.requiresApproval,
      approvalId: approvalRecord.id,
      projectId: project.id,
      runId: run.id,
      preview,
      run: serializeCoworkRun(updated),
    });
  },
);

router.post(
  '/:id/runs/:runId/actions/workflows',
  (req: Request, res: Response) => {
    const project = getCoworkProject(String(req.params.id));
    const run = project
      ? getCoworkRun(project.id, String(req.params.runId))
      : undefined;
    if (!project || !run) {
      res
        .status(404)
        .json({ error: project ? 'Run not found' : 'Project not found' });
      return;
    }

    const kind = coworkActionWorkflowKind(req.body.kind);
    if (!kind) {
      res.status(400).json({
        error:
          'Unsupported Cowork action workflow. Use email-summary, email-draft, calendar-draft, document-artifact, or file-delivery.',
      });
      return;
    }

    const config = COWORK_ACTION_WORKFLOWS[kind];
    const connectorId = trimmed(req.body.connectorId) || config.connectorId;
    const action = trimmed(req.body.action) || config.action;
    const title = trimmed(req.body.title) || config.label;
    const target = trimmed(req.body.target);
    const note = trimmed(req.body.note);
    const artifactPath = workflowArtifactPath(run, kind, req.body.artifactPath);
    const mockData = Array.isArray(req.body.mockData) ? req.body.mockData : [];
    const now = new Date().toISOString();
    const sourceLedger = [
      {
        kind: 'action-workflow',
        workflow: kind,
        source: mockData.length ? 'mock-connector' : connectorId,
        connectorId,
        action,
        target,
        createdAt: now,
      },
    ];

    try {
      const file = writeCoworkProjectFile(
        project,
        artifactPath,
        workflowPreviewContent({
          title,
          kind,
          connectorId,
          action,
          target,
          note,
          mockData,
        }),
      );
      const contextItem = createCoworkContextItem({
        id: randomUUID(),
        project_id: project.id,
        type: 'artifact',
        title,
        path: file.path,
        url: null,
        thread_id: null,
        artifact_id: `run:${run.id}:${kind}`,
        included: 1,
        pinned: 0,
        provenance: normalizeCoworkProvenance('mcp-server'),
        sensitivity: normalizeCoworkSensitivity(
          config.readOnly ? 'normal' : 'approval-required',
        ),
        created_at: now,
        updated_at: now,
      });
      appendCoworkRunEvent(
        run.id,
        'artifact_created',
        `${config.label} preview artifact saved.`,
        {
          path: file.path,
          kind: file.kind,
          sourceLedger,
          contextItemId: contextItem.id,
        },
      );

      let approval = null;
      let updatedRun = run;
      const approvalRequired = !config.readOnly;
      const workflow = {
        id: `${run.id}:${kind}`,
        kind,
        title,
        connectorId,
        action,
        readOnly: config.readOnly,
        approvalRequired,
        status: approvalRequired ? 'waiting_for_approval' : 'artifact_created',
        artifactPath: file.path,
        approvalId: undefined as string | undefined,
        preview: {
          target,
          note,
          sourceLedger,
        },
      };

      if (approvalRequired) {
        approval = createApproval({
          kind: 'tool-action',
          title: `Approve ${config.label}`,
          summary:
            note ||
            `Approve ${kind} external action ${action} for ${project.name}.`,
          risk: 'high',
          requester: req.user?.username || 'dashboard',
          targetType: 'cowork-run',
          targetId: run.id,
          source: 'cowork-project',
          correlationId: run.id,
          actionPreview: `${connectorId}.${action}`,
          resourceSummary: target || `${project.name}: ${run.title}`,
          policyDecisionId: 'cowork-action-workflow-approval',
          payload: {
            projectId: project.id,
            projectName: project.name,
            runId: run.id,
            runTitle: run.title,
            workflowKind: kind,
            connectorId,
            action,
            target,
            artifactPath: file.path,
          },
        });
        workflow.approvalId = approval.id;
        appendCoworkRunEvent(
          run.id,
          'action-workflow-approval-requested',
          `${config.label} approval requested.`,
          {
            approval: {
              kind: 'action-workflow',
              status: 'pending',
              workflowKind: kind,
              connectorId,
              action,
              artifactPath: file.path,
              approvalId: approval.id,
              requestedAt: now,
            },
          },
        );
        updatedRun =
          updateCoworkRunStatus(
            project.id,
            run.id,
            'waiting_for_approval',
            now,
          ) || run;
      } else {
        appendCoworkRunEvent(
          run.id,
          'action-workflow-completed',
          `${config.label} artifact created.`,
          {
            workflow: {
              kind,
              connectorId,
              action,
              artifactPath: file.path,
            },
          },
        );
      }

      touchCoworkProject(project.id, now);
      res.status(approvalRequired ? 202 : 200).json({
        workflow,
        approval,
        artifact: {
          path: file.path,
          kind: file.kind,
          size: file.size,
          updatedAt: file.updatedAt,
          sourceLedger,
        },
        contextItem: serializeCoworkContextItem(contextItem),
        run: serializeCoworkRun(
          getCoworkRun(project.id, updatedRun.id) || updatedRun,
        ),
      });
    } catch (err) {
      logger.error(
        { err, projectId: project.id, runId: run.id, kind },
        'Failed to create Cowork action workflow',
      );
      res.status(500).json({ error: 'Failed to create action workflow' });
    }
  },
);

router.post('/:id/runs/:runId/research/jobs', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  const run = project
    ? getCoworkRun(project.id, String(req.params.runId))
    : undefined;
  if (!project || !run) {
    res
      .status(404)
      .json({ error: project ? 'Run not found' : 'Project not found' });
    return;
  }

  const query = trimmed(req.body.query);
  if (!query) {
    res.status(400).json({ error: 'query is required' });
    return;
  }
  const rawUrls: string[] = Array.isArray(req.body.urls)
    ? req.body.urls.map((url: unknown) => String(url)).filter(Boolean)
    : [];
  const urls: Array<string | null> = rawUrls.map(validHttpUrl);
  if (urls.some((url) => !url)) {
    res
      .status(400)
      .json({ error: 'Research URLs must be http:// or https://' });
    return;
  }
  const screenshots: string[] = Array.isArray(req.body.screenshots)
    ? req.body.screenshots
        .map((screenshot: unknown) => String(screenshot).trim())
        .filter(Boolean)
    : [];
  const notes = trimmed(req.body.notes);

  try {
    const job = createResearchJob({
      query,
      urls: urls.filter((url): url is string => Boolean(url)),
      requester: req.user?.username || 'dashboard',
      projectId: project.id,
      runId: run.id,
      screenshots,
      autoRun: req.body.autoRun !== false,
    });
    const now = new Date().toISOString();
    const rel = `research/run-${run.id}-job-${job.id}.md`;
    const sourceLedger = [
      {
        kind: 'research-job',
        jobId: job.id,
        query,
        urls: job.urls,
        screenshots,
        notes,
        createdAt: now,
      },
    ];
    const body = [
      `# Research job: ${query}`,
      '',
      `Job: ${job.id}`,
      `Run: ${run.id}`,
      `Status: ${job.status}`,
      notes ? `Notes: ${notes}` : '',
      '',
      '## Sources',
      ...(job.urls.length
        ? job.urls.map((url) => `- URL: ${url}`)
        : ['- No URLs supplied']),
      '',
      '## Screenshots',
      ...(screenshots.length
        ? screenshots.map((screenshot) => `- Screenshot: ${screenshot}`)
        : ['- No screenshots captured yet']),
      '',
    ]
      .filter((line) => line !== '')
      .join('\n');
    const file = writeCoworkProjectFile(project, rel, body);
    const linkedJob =
      updateResearchJobMetadata(job.id, { sourceLedgerPath: rel }) || job;
    const contextItem = createCoworkContextItem({
      id: randomUUID(),
      project_id: project.id,
      type: 'artifact',
      title: `${run.title} research job ledger`,
      path: rel,
      url: null,
      thread_id: null,
      artifact_id: `research-job:${job.id}`,
      included: 1,
      pinned: 0,
      provenance: normalizeCoworkProvenance('research-ledger'),
      sensitivity: normalizeCoworkSensitivity('normal'),
      created_at: now,
      updated_at: now,
    });

    for (const url of job.urls) {
      appendCoworkRunEvent(
        run.id,
        'citation_added',
        'Research job URL captured.',
        {
          title: url,
          sourceUrl: url,
          note: `Captured from linked research job ${job.id}.`,
        },
      );
    }
    appendCoworkRunEvent(
      run.id,
      'artifact_created',
      'Research job ledger saved.',
      {
        path: rel,
        kind: file.kind,
        sourceLedger,
        contextItemId: contextItem.id,
      },
    );
    appendCoworkRunEvent(
      run.id,
      'research_job_linked',
      'Research job linked.',
      {
        jobId: job.id,
        query,
        urls: job.urls,
        screenshots,
        notesPath: linkedJob.notesPath,
        ledgerPath: rel,
        contextItemId: contextItem.id,
      },
    );
    touchCoworkProject(project.id, now);
    res.json({
      job: linkedJob,
      artifact: {
        path: file.path,
        kind: file.kind,
        size: file.size,
        updatedAt: file.updatedAt,
        sourceLedger,
      },
      contextItem: serializeCoworkContextItem(contextItem),
      run: serializeCoworkRun(getCoworkRun(project.id, run.id) || run),
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post(
  '/:id/runs/:runId/research/citations',
  (req: Request, res: Response) => {
    const project = getCoworkProject(String(req.params.id));
    const run = project
      ? getCoworkRun(project.id, String(req.params.runId))
      : undefined;
    if (!project || !run) {
      res
        .status(404)
        .json({ error: project ? 'Run not found' : 'Project not found' });
      return;
    }
    const sourceUrl = validHttpUrl(req.body.sourceUrl);
    if (!sourceUrl) {
      res
        .status(400)
        .json({ error: 'Citation sourceUrl must be http:// or https://' });
      return;
    }
    appendCoworkRunEvent(run.id, 'citation_added', 'Research citation added.', {
      title: trimmed(req.body.title) || sourceUrl,
      sourceUrl,
      note: trimmed(req.body.note),
    });
    touchCoworkProject(project.id, new Date().toISOString());
    res.json({ run: serializeCoworkRun(run) });
  },
);

router.post(
  '/:id/runs/:runId/research/export-ledger',
  (req: Request, res: Response) => {
    const project = getCoworkProject(String(req.params.id));
    const run = project
      ? getCoworkRun(project.id, String(req.params.runId))
      : undefined;
    if (!project || !run) {
      res
        .status(404)
        .json({ error: project ? 'Run not found' : 'Project not found' });
      return;
    }
    const outputs = coworkRunOutputs(getCoworkRunEvents(run.id));
    const citations = outputs.flatMap(citationEntriesFromValue);
    const rel = `research/run-${run.id}-citations.md`;
    const body = [
      `# Citation ledger for ${run.title}`,
      '',
      ...citations.flatMap((citation) => [
        `- [${markdownEscape(citation.title || citation.sourceUrl)}](${markdownUrl(citation.sourceUrl)})`,
        trimmed(citation.note)
          ? `  - Note: ${markdownEscape(citation.note)}`
          : '',
      ]),
      '',
    ]
      .filter((line) => line !== '')
      .join('\n');
    const file = writeCoworkProjectFile(project, rel, body);
    const now = new Date().toISOString();
    const contextItem = createCoworkContextItem({
      id: randomUUID(),
      project_id: project.id,
      type: 'artifact',
      title: `${run.title} citation ledger`,
      path: rel,
      url: null,
      thread_id: null,
      artifact_id: `run:${run.id}:citations`,
      included: 1,
      pinned: 0,
      provenance: 'research-ledger',
      sensitivity: normalizeCoworkSensitivity('normal'),
      created_at: now,
      updated_at: now,
    });
    appendCoworkRunEvent(run.id, 'artifact_created', 'Citation ledger saved.', {
      path: rel,
      citationCount: citations.length,
    });
    touchCoworkProject(project.id, now);
    res.json({
      file,
      contextItem: serializeCoworkContextItem(contextItem),
      run: serializeCoworkRun(run),
    });
  },
);

router.post('/:id/runs/:runId/artifacts', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const run = getCoworkRun(project.id, String(req.params.runId));
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  const rel = safeCoworkProjectFilePath(
    typeof req.body.path === 'string' ? req.body.path : '',
  );
  if (!rel) {
    res.status(400).json({ error: 'Invalid project artifact path' });
    return;
  }
  const sourceLedger = Array.isArray(req.body.sourceLedger)
    ? req.body.sourceLedger.filter(
        (entry: unknown) => Boolean(entry) && typeof entry === 'object',
      )
    : [];

  try {
    const content =
      typeof req.body.content === 'string' ? req.body.content : '';
    const file = writeCoworkProjectFile(project, rel, content);
    const now = new Date().toISOString();
    const contextItem = createCoworkContextItem({
      id: randomUUID(),
      project_id: project.id,
      type: 'artifact',
      title:
        typeof req.body.title === 'string' && req.body.title.trim()
          ? req.body.title.trim()
          : path.basename(rel),
      path: rel,
      url: null,
      thread_id: null,
      artifact_id: `run:${run.id}:${rel}`,
      included: 1,
      pinned: req.body.pinned === true ? 1 : 0,
      provenance: normalizeCoworkProvenance('source-ledger'),
      sensitivity:
        typeof req.body.sensitivity === 'string' && req.body.sensitivity.trim()
          ? normalizeCoworkSensitivity(req.body.sensitivity)
          : normalizeCoworkSensitivity('normal'),
      created_at: now,
      updated_at: now,
    });
    appendCoworkRunEvent(run.id, 'artifact_created', 'Local artifact saved.', {
      path: rel,
      kind: file.kind,
      sourceLedger,
      contextItemId: contextItem.id,
    });
    touchCoworkProject(project.id, now);
    const updatedRun = getCoworkRun(project.id, run.id) || run;
    res.json({
      artifact: {
        path: file.path,
        kind: file.kind,
        size: file.size,
        updatedAt: file.updatedAt,
        sourceLedger,
      },
      contextItem: serializeCoworkContextItem(contextItem),
      run: serializeCoworkRun(updatedRun),
    });
  } catch (err) {
    logger.error(
      { err, projectId: project.id, runId: run.id, filePath: rel },
      'Failed to create Cowork run artifact',
    );
    res.status(500).json({ error: 'Failed to create Cowork run artifact' });
  }
});

router.post(
  '/:id/runs/:runId/approvals/external-write',
  (req: Request, res: Response) => {
    const project = getCoworkProject(String(req.params.id));
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const run = getCoworkRun(project.id, String(req.params.runId));
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    const action =
      typeof req.body.action === 'string' && req.body.action.trim()
        ? req.body.action.trim()
        : 'external-write';
    const title =
      typeof req.body.title === 'string' && req.body.title.trim()
        ? req.body.title.trim()
        : `Approve ${action}`;
    const summary =
      typeof req.body.summary === 'string' && req.body.summary.trim()
        ? req.body.summary.trim()
        : 'Approve a Cowork external write before execution.';
    const actionPreview =
      typeof req.body.actionPreview === 'string' &&
      req.body.actionPreview.trim()
        ? req.body.actionPreview.trim()
        : null;
    const resourceSummary =
      typeof req.body.resourceSummary === 'string' &&
      req.body.resourceSummary.trim()
        ? req.body.resourceSummary.trim()
        : `${project.name}: ${run.title}`;
    const pending = matchingPendingExternalWriteApproval({
      runId: run.id,
      action,
      actionPreview,
      resourceSummary,
    });
    const now = new Date().toISOString();
    try {
      const approval =
        pending ||
        createApproval({
          kind: 'tool-action',
          title,
          summary,
          risk: 'high',
          requester: req.user?.username || 'dashboard',
          targetType: 'cowork-run',
          targetId: run.id,
          source: 'cowork-project',
          correlationId: run.id,
          actionPreview,
          resourceSummary,
          policyDecisionId: 'cowork-external-write-approval',
          payload: {
            ...(req.body.payload && typeof req.body.payload === 'object'
              ? req.body.payload
              : {}),
            projectId: project.id,
            projectName: project.name,
            runId: run.id,
            runTitle: run.title,
            action,
          },
        });
      const updatedRun =
        updateCoworkRunStatus(
          project.id,
          run.id,
          'waiting_for_approval',
          now,
        ) || run;
      if (!pending) {
        appendCoworkRunEvent(
          run.id,
          'approval_required',
          'External write approval requested.',
          {
            approvalId: approval.id,
            action,
            resourceSummary: approval.resourceSummary,
          },
        );
      }
      touchCoworkProject(project.id, now);
      res.json({
        approval,
        reused: Boolean(pending),
        run: serializeCoworkRun(updatedRun),
      });
    } catch (err) {
      logger.error(
        { err, projectId: project.id, runId: run.id },
        'Failed to create Cowork external write approval',
      );
      res.status(500).json({ error: 'Failed to create approval' });
    }
  },
);

router.post('/:id/runs/:runId/retry', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const now = new Date().toISOString();
  const run = updateCoworkRunStatus(
    project.id,
    String(req.params.runId),
    'draft',
    now,
  );
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  appendCoworkRunEvent(run.id, 'retry_requested', 'Retry requested.');
  touchCoworkProject(project.id, now);
  res.json({ run: serializeCoworkRun(run) });
});

router.post('/:id/runs/:runId/cancel', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const now = new Date().toISOString();
  const run = updateCoworkRunStatus(
    project.id,
    String(req.params.runId),
    'cancelled',
    now,
  );
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  appendCoworkRunEvent(run.id, 'cancelled', 'Run cancelled.');
  touchCoworkProject(project.id, now);
  res.json({ run: serializeCoworkRun(run) });
});

router.get('/:id/context', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const items = getCoworkContextItems(project.id);
  res.json({
    items: items.map(serializeCoworkContextItem),
    contextItems: items.map((item) => ({
      ...serializeCoworkContextItem(item),
      source:
        item.provenance === 'research-ledger'
          ? 'run-citations'
          : item.provenance,
      autoGenerated:
        item.type === 'artifact' && item.provenance !== 'research-ledger'
          ? 1
          : 0,
    })),
  });
});

router.post('/:id/context', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const type =
    typeof req.body.type === 'string' && req.body.type.trim()
      ? req.body.type.trim()
      : typeof req.body.kind === 'string' && req.body.kind.trim()
        ? req.body.kind.trim()
        : 'note';
  const title =
    typeof req.body.title === 'string' && req.body.title.trim()
      ? req.body.title.trim()
      : '';
  if (!type || !title) {
    res.status(400).json({ error: 'Context type and title are required' });
    return;
  }
  const relPath =
    typeof req.body.path === 'string' && req.body.path.trim()
      ? safeCoworkProjectFilePath(req.body.path)
      : null;
  if (typeof req.body.path === 'string' && req.body.path.trim() && !relPath) {
    res.status(400).json({ error: 'Invalid project file path' });
    return;
  }
  const sourceUrl = requestUrlOrNull(req.body.url);
  if (sourceUrl.invalid) {
    res.status(400).json({ error: 'Context URL must be http:// or https://' });
    return;
  }

  try {
    const now = new Date().toISOString();
    const item = createCoworkContextItem({
      id: randomUUID(),
      project_id: project.id,
      type,
      title,
      path: relPath,
      url: sourceUrl.url,
      thread_id:
        typeof req.body.threadId === 'string' && req.body.threadId.trim()
          ? req.body.threadId.trim()
          : null,
      artifact_id:
        typeof req.body.artifactId === 'string' && req.body.artifactId.trim()
          ? req.body.artifactId.trim()
          : null,
      included: req.body.included === false ? 0 : 1,
      pinned: req.body.pinned === true ? 1 : 0,
      provenance:
        typeof req.body.provenance === 'string' && req.body.provenance.trim()
          ? normalizeCoworkProvenance(req.body.provenance)
          : typeof req.body.source === 'string' && req.body.source.trim()
            ? normalizeCoworkProvenance(req.body.source)
            : normalizeCoworkProvenance('manual'),
      sensitivity:
        typeof req.body.sensitivity === 'string' && req.body.sensitivity.trim()
          ? normalizeCoworkSensitivity(req.body.sensitivity)
          : normalizeCoworkSensitivity('unknown'),
      created_at: now,
      updated_at: now,
    });
    touchCoworkProject(project.id, now);
    res.json({ item });
  } catch (err) {
    logger.error(
      { err, projectId: project.id },
      'Failed to create Cowork context item',
    );
    res.status(500).json({ error: 'Failed to create Cowork context item' });
  }
});

router.patch('/:id/context/:itemId', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const current = getCoworkContextItem(project.id, String(req.params.itemId));
  if (!current) {
    res.status(404).json({ error: 'Context item not found' });
    return;
  }
  const relPath =
    typeof req.body.path === 'string' && req.body.path.trim()
      ? safeCoworkProjectFilePath(req.body.path)
      : undefined;
  if (typeof req.body.path === 'string' && req.body.path.trim() && !relPath) {
    res.status(400).json({ error: 'Invalid project file path' });
    return;
  }
  const sourceUrl = requestUrlOrNull(req.body.url);
  if (sourceUrl.invalid) {
    res.status(400).json({ error: 'Context URL must be http:// or https://' });
    return;
  }
  const now = new Date().toISOString();
  const updated = updateCoworkContextItem(project.id, current.id, {
    type:
      typeof req.body.type === 'string' && req.body.type.trim()
        ? req.body.type.trim()
        : undefined,
    title:
      typeof req.body.title === 'string' && req.body.title.trim()
        ? req.body.title.trim()
        : undefined,
    path: relPath,
    url:
      typeof req.body.url === 'string' && req.body.url.trim()
        ? sourceUrl.url || undefined
        : undefined,
    thread_id:
      typeof req.body.threadId === 'string' && req.body.threadId.trim()
        ? req.body.threadId.trim()
        : undefined,
    artifact_id:
      typeof req.body.artifactId === 'string' && req.body.artifactId.trim()
        ? req.body.artifactId.trim()
        : undefined,
    included:
      typeof req.body.included === 'boolean'
        ? req.body.included
          ? 1
          : 0
        : undefined,
    pinned:
      typeof req.body.pinned === 'boolean'
        ? req.body.pinned
          ? 1
          : 0
        : undefined,
    provenance:
      typeof req.body.provenance === 'string' && req.body.provenance.trim()
        ? normalizeCoworkProvenance(req.body.provenance)
        : undefined,
    sensitivity:
      typeof req.body.sensitivity === 'string' && req.body.sensitivity.trim()
        ? normalizeCoworkSensitivity(req.body.sensitivity)
        : undefined,
    updated_at: now,
  });
  if (!updated) {
    res.status(404).json({ error: 'Context item not found' });
    return;
  }
  touchCoworkProject(project.id, now);
  res.json({ item: updated });
});

router.delete('/:id/context/:itemId', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const current = getCoworkContextItem(project.id, String(req.params.itemId));
  if (!current) {
    res.status(404).json({ error: 'Context item not found' });
    return;
  }
  const removed = deleteCoworkContextItem(project.id, current.id);
  if (!removed) {
    res.status(404).json({ error: 'Context item not found' });
    return;
  }
  touchCoworkProject(project.id, new Date().toISOString());
  res.json({ removed: true, item: serializeCoworkContextItem(current) });
});

router.get('/:id/capabilities', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ capabilities: projectCapabilities(project) });
});

router.get('/:id', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({
    project: projectSummary(project),
    files: listCoworkProjectFiles(project),
    threads: projectThreads(project.id),
    runs: getCoworkRuns(project.id).map(serializeCoworkRun),
    context: getCoworkContextItems(project.id).map(serializeCoworkContextItem),
    contextItems: getCoworkContextItems(project.id).map((item) => ({
      ...serializeCoworkContextItem(item),
      source:
        item.provenance === 'research-ledger'
          ? 'run-citations'
          : item.provenance,
      autoGenerated:
        item.type === 'artifact' && item.provenance !== 'research-ledger'
          ? 1
          : 0,
    })),
    capabilities: projectCapabilities(project),
  });
});

router.get('/:id/files/read', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const resolved = resolveCoworkProjectFile(project, req.query.path);
    if ('error' in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }
    const { rel, target, stat } = resolved;
    const previewable = isPreviewableCoworkProjectFile(rel);
    let content: string | null = null;
    let truncated = false;
    if (previewable) {
      const buffer = fs.readFileSync(target);
      content = buffer
        .subarray(0, COWORK_PROJECT_FILE_PREVIEW_LIMIT)
        .toString('utf-8');
      truncated = buffer.length > COWORK_PROJECT_FILE_PREVIEW_LIMIT;
    }

    res.json({
      file: {
        path: rel,
        kind: classifyCoworkProjectFile(rel),
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        previewable,
        content,
        truncated,
      },
    });
  } catch (err) {
    logger.error(
      { err, projectId: project.id, filePath: req.query.path },
      'Failed to read project file',
    );
    res.status(500).json({ error: 'Failed to read project file' });
  }
});

router.get('/:id/files/download', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const resolved = resolveCoworkProjectFile(project, req.query.path);
    if ('error' in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }
    res.download(resolved.target, path.basename(resolved.rel));
  } catch (err) {
    logger.error(
      { err, projectId: project.id, filePath: req.query.path },
      'Failed to download project file',
    );
    res.status(500).json({ error: 'Failed to download project file' });
  }
});

router.post('/:id/files', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const rel = safeCoworkProjectFilePath(
    typeof req.body.path === 'string' ? req.body.path : '',
  );
  if (!rel) {
    res.status(400).json({ error: 'Invalid project file path' });
    return;
  }

  try {
    const file = writeCoworkProjectFile(
      project,
      rel,
      typeof req.body.content === 'string' ? req.body.content : '',
    );
    const updatedAt = new Date().toISOString();
    touchCoworkProject(project.id, updatedAt);
    res.json({
      file: {
        path: file.path,
        kind: file.kind,
        size: file.size,
        updatedAt: file.updatedAt,
      },
      project: {
        id: project.id,
        updatedAt,
      },
    });
  } catch (err) {
    logger.error(
      { err, projectId: project.id, filePath: rel },
      'Failed to write project file',
    );
    res.status(500).json({ error: 'Failed to write project file' });
  }
});

router.post('/:id/threads', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const provider =
    typeof req.body.provider === 'string' ? req.body.provider : '';
  const model = typeof req.body.model === 'string' ? req.body.model : '';
  const title =
    typeof req.body.title === 'string' && req.body.title.trim()
      ? req.body.title.trim()
      : undefined;
  let config: ContainerConfig | undefined;

  if (provider) {
    if (!isAgentProvider(provider)) {
      res.status(400).json({ error: 'Unknown provider' });
      return;
    }
    config = { provider, ...(model ? { model } : {}) } as ContainerConfig;
  }

  ensureCoworkProjectFolder(project);
  const files = listCoworkProjectFiles(project);
  const contextItems = getCoworkContextItems(project.id);
  let designSelection: ReturnType<typeof selectedDesignSystemForProject>;
  try {
    designSelection = selectedDesignSystemForProject(project.id, req.body);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  const allowedMcpServers = projectThreadMcpServers();
  ensureProjectThreadMcpPermissions(allowedMcpServers);
  const mcpServerContext = allowedMcpServers.length
    ? `Configured external MCP servers for this chat: ${allowedMcpServers.join(', ')}. Connector permissions still decide which tools are exposed at runtime.`
    : 'No external MCP servers are configured for this project chat yet. You can use NanoCrab project tools and local project files, but for email, calendar, external documents, storage, or custom source systems, explain which MCP server needs to be configured.';
  const projectInstructions = [
    `Project: ${project.name}`,
    `Project files are mounted read/write at /workspace/extra/project-${project.slug}.`,
    projectFileManifest(files),
    projectContextNotebookManifest(contextItems),
    designSystemManifest(),
    designSelection.selected
      ? buildDesignSystemPromptContext(designSelection.selected, {
          source: designSelection.source,
        })
      : 'No design system default is selected for this project. If the user asks for a branded or styled artifact, ask which uploaded design system to use before generating final output.',
    mcpServerContext,
    'This is a Cowork project chat. You may call approved MCP servers when they help the task, including mail, calendar, document, storage, and custom MCP servers allowed by connector permissions.',
    'For requests like creating a document or summary from the latest emails, checking all emails from a sender, generating a source-backed document, or turning external context into a project artifact, call the relevant approved MCP tools and save durable drafts or summaries in the project workspace. If the relevant MCP tool is not exposed, say what is missing instead of inventing external source results.',
    'Treat MCP source reads as normal Cowork chat work when the tools are exposed. Treat external writes as approval-gated: document publishing, sending email, calendar changes, storage updates, webhooks, or third-party mutations must be requested before execution.',
    'When using MCP source systems, state the source server, search window, sender/topic filter, cited evidence, missing facts, and local project draft path before proposing any external write.',
    'For MCP-backed summaries or documents, include a source ledger in the local project draft that names each MCP server, tool call purpose, query window or sender filter, and the exact project files or artifacts created.',
    'Writing drafts, summaries, and artifacts inside the project workspace is allowed. External writes, such as publishing or updating third-party documents, sending messages, changing calendar events, or updating third-party data, require approval before execution.',
    project.description ? `Description: ${project.description}` : '',
    project.instructions ? `Instructions: ${project.instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const jid = newWebJid();
  const group = {
    ...buildThreadGroup({
      jid,
      title,
      addedAt: new Date().toISOString(),
      config: {
        ...(config || {}),
        allowedMcpServers,
        restrictions: projectInstructions,
      },
    }),
    projectId: project.id,
    projectSlug: project.slug,
  };

  try {
    setRegisteredGroup(jid, group);
    touchCoworkProject(project.id, group.added_at);
    try {
      getState().updateRegisteredGroup?.(jid, group);
    } catch {
      /* state not ready */
    }
    res.json({ id: jid, allowedMcpServers });
  } catch (err) {
    logger.error(
      { err, projectId: project.id },
      'Failed to create project thread',
    );
    res.status(500).json({ error: 'Failed to create project thread' });
  }
});

export default router;
