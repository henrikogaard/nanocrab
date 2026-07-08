import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';

import { STORE_DIR } from '../../config.js';
import {
  createApproval,
  findPendingApprovalForTarget,
} from '../../approvals.js';
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
import type {
  ContainerConfig,
  CoworkApprovalRisk,
  CoworkComplexity,
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

function projectSummary(project: CoworkProject) {
  const files = listCoworkProjectFiles(project);
  const threads = projectThreads(project.id);
  const servers = configuredExternalMcpServers();
  return {
    ...project,
    path: coworkProjectPath(project),
    fileCount: files.length,
    chatCount: threads.length,
    updatedAt: project.updated_at,
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
      skills: { total: 0 },
      plugins: { total: 0 },
      connectors: { total: servers.length },
    },
  };
}

function estimateCoworkRun(input: {
  title?: unknown;
  prompt?: unknown;
  provider?: unknown;
  model?: unknown;
}): {
  complexity: CoworkComplexity;
  approvalRisk: CoworkApprovalRisk;
  provider: string | null;
  model: string | null;
  warnings: string[];
} {
  const title = typeof input.title === 'string' ? input.title : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const text = `${title}\n${prompt}`.toLowerCase();
  const connectorTerms = [
    'mcp',
    'connector',
    'email',
    'mail',
    'calendar',
    'document',
    'artifact',
    'source',
    'browser',
    'research',
  ];
  const writeTerms = [
    'send',
    'publish',
    'upload',
    'webhook',
    'external',
    'write',
    'calendar edit',
    'delivery',
  ];
  const hasConnectorWork = connectorTerms.some((term) => text.includes(term));
  const hasExternalWrite = writeTerms.some((term) => text.includes(term));
  const complexity: CoworkComplexity = hasConnectorWork
    ? 'connector-heavy'
    : text.length > 600
      ? 'long'
      : text.length > 180
        ? 'standard'
        : 'quick';
  const approvalRisk: CoworkApprovalRisk = hasExternalWrite
    ? 'high'
    : hasConnectorWork
      ? 'medium'
      : 'low';
  const warnings =
    approvalRisk === 'high'
      ? [
          'Write-capable or external delivery language requires approval before mutation.',
        ]
      : [];

  return {
    complexity,
    approvalRisk,
    provider:
      typeof input.provider === 'string' && input.provider.trim()
        ? input.provider.trim()
        : null,
    model:
      typeof input.model === 'string' && input.model.trim()
        ? input.model.trim()
        : null,
    warnings,
  };
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
    .filter((event) => event.kind === 'action-requested')
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

router.post('/:id/estimate', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ estimate: estimateCoworkRun(req.body) });
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
    const estimate = estimateCoworkRun(req.body);
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
        item.included &&
        /sensitive|confidential|private/i.test(item.sensitivity),
    ).length;
    const approval = {
      kind: 'connector-action',
      status: 'pending',
      connectorId: preview.connectorId,
      action: preview.action,
      note: trimmed(req.body.note) || '',
      requestedAt: now,
      sensitivitySignals: { includedSensitiveItems: sensitiveItems },
    };
    appendCoworkRunEvent(
      run.id,
      'action-requested',
      `${preview.action} approval requested.`,
      {
        approval,
      },
    );
    const updated =
      updateCoworkRunStatus(project.id, run.id, 'waiting_for_approval', now) ||
      run;
    touchCoworkProject(project.id, now);
    res.status(202).json({
      requested: true,
      approvalRequired: preview.requiresApproval,
      preview,
      run: serializeCoworkRun(updated),
    });
  },
);

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
      sensitivity: 'normal',
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
      provenance: 'source-ledger',
      sensitivity:
        typeof req.body.sensitivity === 'string' && req.body.sensitivity.trim()
          ? req.body.sensitivity.trim()
          : 'normal',
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
    const pending = findPendingApprovalForTarget(
      'tool-action',
      'cowork-run',
      run.id,
    );
    const now = new Date().toISOString();
    try {
      const approval =
        pending ||
        createApproval({
          kind: 'tool-action',
          title:
            typeof req.body.title === 'string' && req.body.title.trim()
              ? req.body.title.trim()
              : `Approve ${action}`,
          summary:
            typeof req.body.summary === 'string' && req.body.summary.trim()
              ? req.body.summary.trim()
              : 'Approve a Cowork external write before execution.',
          risk: 'high',
          requester: req.user?.username || 'dashboard',
          targetType: 'cowork-run',
          targetId: run.id,
          source: 'cowork-project',
          correlationId: run.id,
          actionPreview:
            typeof req.body.actionPreview === 'string' &&
            req.body.actionPreview.trim()
              ? req.body.actionPreview.trim()
              : null,
          resourceSummary:
            typeof req.body.resourceSummary === 'string' &&
            req.body.resourceSummary.trim()
              ? req.body.resourceSummary.trim()
              : `${project.name}: ${run.title}`,
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

  try {
    const now = new Date().toISOString();
    const item = createCoworkContextItem({
      id: randomUUID(),
      project_id: project.id,
      type,
      title,
      path: relPath,
      url:
        typeof req.body.url === 'string' && req.body.url.trim()
          ? req.body.url.trim()
          : null,
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
          ? req.body.provenance.trim()
          : typeof req.body.source === 'string' && req.body.source.trim()
            ? req.body.source.trim()
            : 'manual',
      sensitivity:
        typeof req.body.sensitivity === 'string' && req.body.sensitivity.trim()
          ? req.body.sensitivity.trim()
          : 'unknown',
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
        ? req.body.url.trim()
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
        ? req.body.provenance.trim()
        : undefined,
    sensitivity:
      typeof req.body.sensitivity === 'string' && req.body.sensitivity.trim()
        ? req.body.sensitivity.trim()
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
