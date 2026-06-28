import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';

import { STORE_DIR } from '../../config.js';
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
  CoworkProject,
  CoworkRun,
  CoworkRunStatus,
} from '../../types.js';
import { isAgentProvider } from '../../agent-provider.js';
import {
  authorizeConnectorAction,
  loadConnectorPermissions,
  normalizeConnectorId,
  normalizeConnectorPermission,
  saveConnectorPermissions,
  type ConnectorPermission,
} from '../../connector-permissions.js';
import { listSkillRegistry } from '../../skill-registry.js';
import {
  createCoworkProjectContextItem,
  createCoworkRun,
  deleteCoworkProjectContextItem,
  createCoworkProject,
  getCoworkRun,
  getCoworkProject,
  getCoworkProjectBySlug,
  getCoworkProjects,
  listCoworkProjectContextItems,
  listCoworkRuns,
  getLatestStoredMessage,
  getWebThreads,
  setRegisteredGroup,
  touchCoworkProject,
  updateCoworkProjectContextItem,
  updateCoworkRun,
  updateCoworkProjectContext,
} from '../../db.js';
import { getEnabledPlugins } from '../plugins/registry.js';
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

const PROJECT_MCP_EXAMPLES = [
  'Summarize the latest project emails into a sourced markdown brief',
  'Check all emails from a person or domain and extract commitments',
  'Generate a summary document from mail, calendar, document, storage, or custom MCP context',
  'Create a project artifact with source ledger, assumptions, and approval notes',
];

function inferSensitivityForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (
    lower.includes('.env') ||
    lower.includes('secret') ||
    lower.includes('token') ||
    lower.includes('credential') ||
    lower.endsWith('.pem') ||
    lower.endsWith('.key')
  ) {
    return 'sensitive';
  }
  if (lower.endsWith('.pdf') || lower.endsWith('.docx')) {
    return 'review-required';
  }
  return 'normal';
}

function projectCapabilitiesSummary() {
  const skills = listSkillRegistry()
    .filter((skill) => skill.enabled)
    .map((skill) => ({
      name: skill.name,
      scope: skill.scope,
      visibility: skill.visibility,
      riskLevel: skill.riskLevel,
    }));
  const plugins = getEnabledPlugins().map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
  }));
  const connectorPermissions = loadConnectorPermissions();
  const servers = configuredExternalMcpServers();
  const connectors = servers.map((server) => {
    const permission = connectorPermissions.find(
      (entry) => entry.connectorId === server,
    );
    return {
      id: server,
      requiresApproval: permission?.requiresApproval !== false,
      allowedActions: permission?.allowedActions ?? ['*.read', 'tools.expose'],
    };
  });
  return {
    skills: {
      total: skills.length,
      enabled: skills,
    },
    plugins: {
      total: plugins.length,
      enabled: plugins,
    },
    connectors: {
      total: connectors.length,
      configured: connectors,
    },
  };
}

function buildRunApprovalPreview(run: CoworkRun): {
  required: boolean;
  risk: string;
  reason: string;
} {
  const approvals = parseJsonArray(run.approvals_json);
  if (run.status === 'waiting_for_approval' || run.status === 'blocked') {
    return {
      required: true,
      risk: 'high',
      reason:
        'This run is paused for approval before external send/publish or connector mutation.',
    };
  }
  if (run.complexity_level === 'high') {
    return {
      required: true,
      risk: 'medium',
      reason:
        'High-complexity run with connector/external signals; review approval boundaries before external writes.',
    };
  }
  if (approvals.length) {
    return {
      required: true,
      risk: 'medium',
      reason: 'Approval records are attached to this run history.',
    };
  }
  return {
    required: false,
    risk: 'low',
    reason: 'No pending approval checkpoints detected.',
  };
}

function projectSummary(project: CoworkProject) {
  const files = listCoworkProjectFiles(project);
  const threads = projectThreads(project.id);
  const runs = listCoworkRuns(project.id);
  const servers = configuredExternalMcpServers();
  return {
    ...project,
    path: coworkProjectPath(project),
    fileCount: files.length,
    chatCount: threads.length,
    runCount: runs.length,
    updatedAt: project.updated_at,
    capabilities: projectCapabilitiesSummary(),
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
  };
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function estimateRunComplexity(prompt: string): {
  level: string;
  estimatedSteps: number;
  budgetTier: string;
  risk: string;
} {
  const normalized = prompt.toLowerCase();
  const tokenCount = prompt.trim().split(/\s+/).filter(Boolean).length;
  const connectorSignals = [
    'email',
    'calendar',
    'connector',
    'mcp',
    'webhook',
    'publish',
    'send',
    'external',
  ].filter((keyword) => normalized.includes(keyword)).length;
  const multiStepSignals = [
    'then',
    'after',
    'also',
    'and',
    'compare',
    'summarize',
    'draft',
    'analyze',
    'review',
  ].filter((keyword) => normalized.includes(keyword)).length;

  const score = tokenCount / 40 + connectorSignals * 2 + multiStepSignals * 0.5;
  if (score >= 10) {
    return {
      level: 'high',
      estimatedSteps: 8,
      budgetTier: 'high',
      risk: 'approval-heavy',
    };
  }
  if (score >= 6) {
    return {
      level: 'moderate',
      estimatedSteps: 5,
      budgetTier: 'medium',
      risk: connectorSignals ? 'connector-aware' : 'standard',
    };
  }
  return {
    level: 'low',
    estimatedSteps: 3,
    budgetTier: 'low',
    risk: 'low',
  };
}

function buildConnectorActionPreview(input: {
  project: CoworkProject;
  connectorId: string;
  action: string;
}): {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  connectorId: string;
  action: string;
  sensitivitySignals: {
    includedSensitiveItems: number;
  };
} {
  const connectorId = normalizeConnectorId(input.connectorId);
  const action = String(input.action || '').trim();
  const isReadAction = action.endsWith('.read') || action === 'tools.expose';
  const sensitiveCount = listCoworkProjectContextItems(input.project.id).filter(
    (item) => item.included === 1 && item.sensitivity !== 'normal',
  ).length;

  if (!connectorId || !action) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: 'Connector ID and action are required for action preview.',
      connectorId,
      action,
      sensitivitySignals: {
        includedSensitiveItems: sensitiveCount,
      },
    };
  }
  const authorization = authorizeConnectorAction({
    connectorId,
    action,
    groupFolder: input.project.slug,
    isMain: true,
    isCoworkProject: true,
    context: {
      projectId: input.project.id,
      projectSlug: input.project.slug,
      route: 'projects.runs.actions.preview',
    },
  });
  const policyAllows =
    authorization.allowed || authorization.decision === 'requires_approval';
  if (!policyAllows) {
    return {
      allowed: false,
      requiresApproval: authorization.requiresApproval,
      reason: authorization.reason,
      connectorId,
      action,
      sensitivitySignals: {
        includedSensitiveItems: sensitiveCount,
      },
    };
  }

  const requiresApproval =
    authorization.decision === 'requires_approval' ||
    authorization.matchedPermission?.requiresApproval === true ||
    (!isReadAction && sensitiveCount > 0);
  const reason = requiresApproval
    ? sensitiveCount > 0
      ? `Action is allowed but requires approval because ${sensitiveCount} included context item(s) are marked sensitive/review-required.`
      : authorization.reason
    : 'Action is allowed with current connector policy.';
  return {
    allowed: true,
    requiresApproval,
    reason,
    connectorId,
    action,
    sensitivitySignals: {
      includedSensitiveItems: sensitiveCount,
    },
  };
}

function inferRunIntent(prompt: string): {
  mode: 'research' | 'execution';
  requiresCitations: boolean;
  sourceExpectation: string;
} {
  const normalized = prompt.toLowerCase();
  const researchSignals = [
    'research',
    'investigate',
    'source',
    'citation',
    'evidence',
    'browser',
    'web',
  ].filter((signal) => normalized.includes(signal)).length;
  if (researchSignals >= 2) {
    return {
      mode: 'research',
      requiresCitations: true,
      sourceExpectation: 'Collect source links and attach citations in outputs.',
    };
  }
  return {
    mode: 'execution',
    requiresCitations: false,
    sourceExpectation: 'Use project files and context notebook as the primary source of truth.',
  };
}

type ResearchCoverageStatus =
  | 'not_applicable'
  | 'missing'
  | 'partial'
  | 'sufficient';

interface RunCitationEntry {
  title: string;
  sourceUrl: string;
  note?: string;
}

function extractCitationLikeEntries(outputs: unknown[]): RunCitationEntry[] {
  const toTrimmedString = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized ? normalized : null;
  };

  const citationEntryFromRecord = (
    value: Record<string, unknown>,
    fallback?: Record<string, unknown>,
  ): RunCitationEntry | null => {
    const sourceUrl =
      toTrimmedString(value.sourceUrl) ||
      toTrimmedString(value.url) ||
      toTrimmedString(value.source) ||
      null;
    if (!sourceUrl) return null;
    const title =
      toTrimmedString(value.title) ||
      toTrimmedString(value.label) ||
      toTrimmedString(value.name) ||
      toTrimmedString(fallback?.title) ||
      sourceUrl;
    const note =
      toTrimmedString(value.note) || toTrimmedString(fallback?.note) || undefined;
    return note ? { title, sourceUrl, note } : { title, sourceUrl };
  };

  const citationEntriesFromValue = (value: unknown): RunCitationEntry[] => {
    if (!value || typeof value !== 'object') return [];
    const entry = value as Record<string, unknown>;

    let directEntry: RunCitationEntry | null = null;
    if (typeof entry.sourceUrl === 'string' && entry.sourceUrl.trim()) {
      directEntry = citationEntryFromRecord(entry);
    } else if (entry.kind === 'citation') {
      directEntry =
        citationEntryFromRecord(entry) ||
        (entry.citation && typeof entry.citation === 'object'
          ? citationEntryFromRecord(entry.citation as Record<string, unknown>, entry)
          : null) ||
        (typeof entry.citation === 'string' && entry.citation.trim()
          ? {
              title: toTrimmedString(entry.title) || entry.citation.trim(),
              sourceUrl: entry.citation.trim(),
              ...(toTrimmedString(entry.note) ? { note: toTrimmedString(entry.note)! } : {}),
            }
          : null);
    } else if (typeof entry.citation === 'string' && entry.citation.trim()) {
      directEntry = {
        title: toTrimmedString(entry.title) || entry.citation.trim(),
        sourceUrl: entry.citation.trim(),
        ...(toTrimmedString(entry.note) ? { note: toTrimmedString(entry.note)! } : {}),
      };
    } else if (entry.citation && typeof entry.citation === 'object') {
      directEntry = citationEntryFromRecord(
        entry.citation as Record<string, unknown>,
        entry,
      );
    }

    if (!Array.isArray(entry.citations)) {
      return directEntry ? [directEntry] : [];
    }
    const nestedEntries = entry.citations.flatMap((item) =>
      citationEntriesFromValue(item),
    );
    if (nestedEntries.length > 0 && directEntry) {
      const merged = [directEntry, ...nestedEntries];
      const deduped = new Map<string, RunCitationEntry>();
      for (const citation of merged) {
        const key = `${citation.sourceUrl.toLowerCase()}|${citation.title.toLowerCase()}`;
        if (!deduped.has(key)) deduped.set(key, citation);
      }
      return Array.from(deduped.values());
    }
    if (nestedEntries.length > 0) {
      return nestedEntries;
    }
    return directEntry ? [directEntry] : [];
  };

  return outputs.flatMap((entry) => citationEntriesFromValue(entry));
}

function citationLikeEntryCount(outputs: unknown[]): number {
  return extractCitationLikeEntries(outputs).length;
}

function runResearchCoverage(run: CoworkRun): {
  citationCount: number;
  status: ResearchCoverageStatus;
  guidance: string;
} {
  const intent = inferRunIntent(run.prompt);
  const outputs = parseJsonArray(run.outputs_json);
  const citationCount = citationLikeEntryCount(outputs);
  if (intent.mode === 'execution') {
    return {
      citationCount,
      status: 'not_applicable',
      guidance: 'Research coverage applies only to research-mode runs.',
    };
  }
  if (citationCount === 0) {
    return {
      citationCount,
      status: 'missing',
      guidance:
        'Add at least 3 citations with title and source URL before completing this research run.',
    };
  }
  if (citationCount <= 2) {
    return {
      citationCount,
      status: 'partial',
      guidance:
        'Add more citations to reach at least 3 source-backed references for sufficient research coverage.',
    };
  }
  return {
    citationCount,
    status: 'sufficient',
    guidance: 'Research coverage is sufficient. Keep citations aligned with key claims.',
  };
}

function runSummary(run: CoworkRun | undefined) {
  if (!run) return null;
  const intent = inferRunIntent(run.prompt);
  const outputs = parseJsonArray(run.outputs_json);
  return {
    id: run.id,
    title: run.title,
    prompt: run.prompt,
    status: run.status,
    provider: run.provider,
    model: run.model,
    complexity: {
      level: run.complexity_level,
      estimatedSteps: run.estimated_steps,
      budgetTier: run.budget_tier,
    },
    intent,
    approvalPreview: buildRunApprovalPreview(run),
    summary: run.summary,
    error: run.error,
    planSteps: parseJsonArray(run.plan_steps_json),
    events: parseJsonArray(run.events_json),
    approvals: parseJsonArray(run.approvals_json),
    outputs,
    researchCoverage: runResearchCoverage(run),
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    lastActivityAt: run.last_activity_at,
  };
}

function autoContextItems(
  files: ReturnType<typeof listCoworkProjectFiles>,
  threads: ReturnType<typeof projectThreads>,
  runs: ReturnType<typeof listCoworkRuns>,
) {
  return [
    ...files.map((file) => ({
      id: `auto:file:${file.path}`,
      kind: 'file',
      title: file.path,
      path: file.path,
      source: 'project-files',
      provenance: 'local-project-workspace',
      sensitivity: inferSensitivityForPath(file.path),
      included: 1,
      pinned: 0,
      staleState: 'fresh',
      content: null,
      autoGenerated: 1,
      createdAt: file.updatedAt,
      updatedAt: file.updatedAt,
    })),
    ...threads.map((thread) => ({
      id: `auto:thread:${thread.id}`,
      kind: 'chat',
      title: thread.title || 'New conversation',
      path: null,
      source: 'project-chat',
      provenance: 'web-thread',
      sensitivity: thread.lastMessage ? 'review-required' : 'normal',
      included: 1,
      pinned: 0,
      staleState: 'fresh',
      content: thread.lastMessage,
      autoGenerated: 1,
      createdAt: thread.addedAt,
      updatedAt: thread.lastMessageAt || thread.addedAt,
    })),
    ...runs.map((run) => ({
      id: `auto:run:${run.id}`,
      kind: 'run',
      title: run.title,
      path: null,
      source: 'cowork-run',
      provenance: run.status,
      sensitivity:
        run.status === 'waiting_for_approval' || run.status === 'blocked'
          ? 'sensitive'
          : run.status === 'failed'
            ? 'review-required'
            : 'normal',
      included: 1,
      pinned: 0,
      staleState:
        run.status === 'failed' || run.status === 'blocked' ? 'stale' : 'fresh',
      content: run.summary || run.error,
      autoGenerated: 1,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
    })),
  ];
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

router.get('/:id', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const files = listCoworkProjectFiles(project);
  const threads = projectThreads(project.id);
  const runs = listCoworkRuns(project.id);
  const contextItems = listCoworkProjectContextItems(project.id);
  res.json({
    project: projectSummary(project),
    files,
    threads,
    runs: runs.map((run) => runSummary(run)),
    contextItems: [
      ...contextItems.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        path: item.path,
        source: item.source,
        provenance: item.provenance,
        sensitivity: item.sensitivity,
        included: item.included,
        pinned: item.pinned,
        staleState: item.stale_state,
        content: item.content,
        autoGenerated: item.auto_generated,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
      ...autoContextItems(files, threads, runs),
    ],
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
  const allowedMcpServers = projectThreadMcpServers();
  ensureProjectThreadMcpPermissions(allowedMcpServers);
  const mcpServerContext = allowedMcpServers.length
    ? `Configured external MCP servers for this chat: ${allowedMcpServers.join(', ')}. Connector permissions still decide which tools are exposed at runtime.`
    : 'No external MCP servers are configured for this project chat yet. You can use NanoCrab project tools and local project files, but for email, calendar, external documents, storage, or custom source systems, explain which MCP server needs to be configured.';
  const projectInstructions = [
    `Project: ${project.name}`,
    `Project files are mounted read/write at /workspace/extra/project-${project.slug}.`,
    projectFileManifest(files),
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

router.get('/:id/runs', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({
    runs: listCoworkRuns(project.id).map((run) => runSummary(run)),
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
      : 'Cowork run';
  const prompt =
    typeof req.body.prompt === 'string' && req.body.prompt.trim()
      ? req.body.prompt.trim()
      : '';
  if (!prompt) {
    res.status(400).json({ error: 'Run prompt is required' });
    return;
  }
  ensureProjectThreadMcpPermissions(projectThreadMcpServers());
  const now = new Date().toISOString();
  const complexity = estimateRunComplexity(prompt);
  const intent = inferRunIntent(prompt);
  const planSteps =
    intent.mode === 'research'
      ? [
          { id: 'plan', title: 'Scoping research question', status: 'planning' },
          {
            id: 'gather',
            title: 'Gathering sources and citations',
            status: 'pending',
          },
          { id: 'synthesize', title: 'Synthesizing findings', status: 'pending' },
          {
            id: 'deliver',
            title: 'Delivering sourced output',
            status: 'pending',
          },
        ]
      : [
          { id: 'plan', title: 'Planning approach', status: 'planning' },
          { id: 'execute', title: 'Executing task', status: 'pending' },
          { id: 'deliver', title: 'Delivering outputs', status: 'pending' },
        ];
  const run = createCoworkRun({
    id: randomUUID(),
    project_id: project.id,
    title,
    prompt,
    status: 'planning',
    provider:
      typeof req.body.provider === 'string' && req.body.provider
        ? req.body.provider
        : null,
    model:
      typeof req.body.model === 'string' && req.body.model ? req.body.model : null,
    complexity_level: complexity.level,
    estimated_steps: complexity.estimatedSteps,
    budget_tier: complexity.budgetTier,
    plan_steps_json: JSON.stringify(planSteps),
    events_json: JSON.stringify([
      {
        id: randomUUID(),
        timestamp: now,
        kind: 'created',
        message: `Run created (${complexity.level} complexity, ${complexity.risk} risk, ${intent.mode} mode)`,
      },
    ]),
    approvals_json: '[]',
    outputs_json: '[]',
    summary: null,
    error: null,
    created_at: now,
    updated_at: now,
    last_activity_at: now,
  });
  touchCoworkProject(project.id, now);
  res.json({ run: runSummary(run) });
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
  res.json({ run: runSummary(run) });
});

router.post('/:id/runs/:runId/research/citations', (req: Request, res: Response) => {
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

  const title =
    typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const sourceUrl =
    typeof req.body.sourceUrl === 'string' ? req.body.sourceUrl.trim() : '';
  const note =
    typeof req.body.note === 'string' && req.body.note.trim()
      ? req.body.note.trim()
      : undefined;
  if (!title || !sourceUrl) {
    res.status(400).json({ error: 'Title and sourceUrl are required' });
    return;
  }

  const now = new Date().toISOString();
  const outputs = parseJsonArray(run.outputs_json);
  outputs.push({
    id: randomUUID(),
    kind: 'citation',
    title,
    sourceUrl,
    note,
    addedAt: now,
  });
  const events = parseJsonArray(run.events_json);
  events.push({
    id: randomUUID(),
    timestamp: now,
    kind: 'citation-added',
    message: `Citation added: ${title}`,
  });
  const updated = updateCoworkRun(project.id, run.id, {
    outputs_json: JSON.stringify(outputs),
    events_json: JSON.stringify(events),
    updated_at: now,
    last_activity_at: now,
  });
  touchCoworkProject(project.id, now);
  res.status(200).json({ run: runSummary(updated) });
});

router.post(
  '/:id/runs/:runId/research/export-ledger',
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

    const outputs = parseJsonArray(run.outputs_json);
    const citations = extractCitationLikeEntries(outputs);
    if (!citations.length) {
      res.status(400).json({
        error:
          'No citation entries found in this run output. Add citations before exporting a ledger.',
      });
      return;
    }

    const now = new Date().toISOString();
    const filePath = safeCoworkProjectFilePath(`research/run-${run.id}-citations.md`);
    if (!filePath) {
      res.status(400).json({ error: 'Invalid ledger file path' });
      return;
    }
    const markdown = [
      '# Research citation ledger',
      '',
      `- Run title: ${run.title}`,
      `- Run ID: ${run.id}`,
      `- Run timestamp: ${run.updated_at}`,
      '',
      '## Citations',
      ...citations.flatMap((citation) => {
        const lines = [`- [${citation.title}](${citation.sourceUrl})`];
        if (citation.note) {
          lines.push(`  - Note: ${citation.note}`);
        }
        return lines;
      }),
      '',
      `- Ledger exported at: ${now}`,
      '',
    ].join('\n');

    try {
      const file = writeCoworkProjectFile(project, filePath, markdown);
      const contextTitle = `Citation ledger · ${run.title}`;
      const existingContext = listCoworkProjectContextItems(project.id).find(
        (item) => item.path === filePath,
      );
      const contextItem = existingContext
        ? updateCoworkProjectContextItem(project.id, existingContext.id, {
            kind: 'document',
            title: contextTitle,
            path: filePath,
            source: 'run-citations',
            provenance: run.id,
            sensitivity: 'review-required',
            included: 1,
            updated_at: now,
          })
        : createCoworkProjectContextItem({
            id: randomUUID(),
            project_id: project.id,
            kind: 'document',
            title: contextTitle,
            path: filePath,
            source: 'run-citations',
            provenance: run.id,
            sensitivity: 'review-required',
            included: 1,
            pinned: 0,
            stale_state: 'fresh',
            content: null,
            auto_generated: 0,
            created_at: now,
            updated_at: now,
          });
      if (!contextItem) {
        res.status(500).json({ error: 'Failed to update citation ledger context item' });
        return;
      }

      const events = parseJsonArray(run.events_json);
      events.push({
        id: randomUUID(),
        timestamp: now,
        kind: 'citation-ledger-exported',
        message: `Citation ledger exported to ${filePath}`,
      });
      const updatedRun = updateCoworkRun(project.id, run.id, {
        events_json: JSON.stringify(events),
        updated_at: now,
        last_activity_at: now,
      });
      touchCoworkProject(project.id, now);

      res.status(200).json({
        run: runSummary(updatedRun),
        file: {
          path: file.path,
          kind: file.kind,
          size: file.size,
          updatedAt: file.updatedAt,
        },
        contextItem: {
          id: contextItem.id,
          path: contextItem.path,
          title: contextItem.title,
        },
      });
    } catch (err) {
      logger.error(
        { err, projectId: project.id, runId: run.id, filePath },
        'Failed to export citation ledger',
      );
      res.status(500).json({ error: 'Failed to export citation ledger' });
    }
  },
);

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
  const action = typeof req.body.action === 'string' ? req.body.action : '';
  const actionStatusMap: Record<string, CoworkRunStatus> = {
    start: 'running',
    checkpoint: 'waiting_for_approval',
    resume: 'running',
    retry: 'planning',
    complete: 'completed',
    fail: 'failed',
    cancel: 'cancelled',
    block: 'blocked',
  };
  const allowedStatuses: CoworkRunStatus[] = [
    'draft',
    'planning',
    'waiting_for_approval',
    'running',
    'blocked',
    'completed',
    'failed',
    'cancelled',
  ];
  const statusFromBody =
    typeof req.body.status === 'string' &&
    allowedStatuses.includes(req.body.status as CoworkRunStatus)
      ? (req.body.status as CoworkRunStatus)
      : undefined;
  const nextStatus: CoworkRunStatus =
    statusFromBody ||
    actionStatusMap[action] ||
    run.status;
  const events = parseJsonArray(run.events_json);
  const currentApprovals = parseJsonArray(run.approvals_json);
  const contextItems = listCoworkProjectContextItems(project.id);
  const sensitiveContext = contextItems.filter(
    (item) => item.included === 1 && item.sensitivity !== 'normal',
  );
  const nextApprovals =
    action === 'checkpoint' && typeof req.body.approvals !== 'string'
      ? [
          ...currentApprovals,
          {
            id: randomUUID(),
            requestedAt: now,
            kind: 'external-write-checkpoint',
            status: 'pending',
            reason:
              typeof req.body.message === 'string' && req.body.message.trim()
                ? req.body.message.trim()
                : 'External write requires operator approval',
            sensitiveContextCount: sensitiveContext.length,
            sensitiveContextSample: sensitiveContext
              .slice(0, 5)
              .map((item) => ({
                title: item.title,
                sensitivity: item.sensitivity,
                provenance: item.provenance,
              })),
          },
        ]
      : currentApprovals;
  events.push({
    id: randomUUID(),
    timestamp: now,
    kind: action || 'status',
    message:
      typeof req.body.message === 'string' && req.body.message.trim()
        ? req.body.message.trim()
        : `Run updated: ${nextStatus}`,
  });
  const updated = updateCoworkRun(project.id, run.id, {
    status: nextStatus,
    summary:
      typeof req.body.summary === 'string' ? req.body.summary : run.summary,
    error: typeof req.body.error === 'string' ? req.body.error : run.error,
    plan_steps_json:
      typeof req.body.planSteps === 'string'
        ? req.body.planSteps
        : run.plan_steps_json,
    outputs_json:
      typeof req.body.outputs === 'string' ? req.body.outputs : run.outputs_json,
    approvals_json:
      typeof req.body.approvals === 'string'
        ? req.body.approvals
        : JSON.stringify(nextApprovals),
    events_json: JSON.stringify(events),
    updated_at: now,
    last_activity_at: now,
  });
  touchCoworkProject(project.id, now);
  res.json({ run: runSummary(updated) });
});

router.post('/:id/runs/:runId/actions/preview', (req: Request, res: Response) => {
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
  ensureProjectThreadMcpPermissions(projectThreadMcpServers());

  const connectorId =
    typeof req.body.connectorId === 'string' ? req.body.connectorId : '';
  const action = typeof req.body.action === 'string' ? req.body.action : '';
  const preview = buildConnectorActionPreview({
    project,
    connectorId,
    action,
  });
  res.json({
    run: {
      id: run.id,
      status: run.status,
    },
    preview,
  });
});

router.post('/:id/runs/:runId/actions/request', (req: Request, res: Response) => {
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
  ensureProjectThreadMcpPermissions(projectThreadMcpServers());

  const connectorId =
    typeof req.body.connectorId === 'string' ? req.body.connectorId.trim() : '';
  const action = typeof req.body.action === 'string' ? req.body.action.trim() : '';
  if (!connectorId || !action) {
    res.status(400).json({ error: 'Connector ID and action are required' });
    return;
  }

  const note =
    typeof req.body.note === 'string' && req.body.note.trim()
      ? req.body.note.trim()
      : undefined;
  const payload = req.body.payload;
  const preview = buildConnectorActionPreview({
    project,
    connectorId,
    action,
  });
  if (!preview.allowed) {
    res.status(403).json({
      error: preview.reason,
      preview,
    });
    return;
  }

  const now = new Date().toISOString();
  const events = parseJsonArray(run.events_json);
  const approvals = parseJsonArray(run.approvals_json);
  const requiresApproval = preview.requiresApproval;
  let nextStatus = run.status;

  if (requiresApproval) {
    approvals.push({
      id: randomUUID(),
      kind: 'connector-action',
      status: 'pending',
      connectorId: preview.connectorId,
      action: preview.action,
      note,
      requestedAt: now,
      sensitivitySignals: preview.sensitivitySignals,
      payload,
    });
    events.push({
      id: randomUUID(),
      timestamp: now,
      kind: 'action-requested',
      message: `Connector action ${preview.connectorId}/${preview.action} requested and requires approval before execution.`,
    });
    nextStatus = 'waiting_for_approval';
  } else {
    events.push({
      id: randomUUID(),
      timestamp: now,
      kind: 'action-authorized',
      message: `Connector action ${preview.connectorId}/${preview.action} authorized by policy.`,
    });
    if (run.status === 'planning') {
      nextStatus = 'running';
    }
  }

  const updated = updateCoworkRun(project.id, run.id, {
    status: nextStatus,
    approvals_json: JSON.stringify(approvals),
    events_json: JSON.stringify(events),
    updated_at: now,
    last_activity_at: now,
  });
  touchCoworkProject(project.id, now);
  res.status(requiresApproval ? 202 : 200).json({
    requested: true,
    approvalRequired: requiresApproval,
    run: runSummary(updated),
    preview,
  });
});

router.get('/:id/context', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const files = listCoworkProjectFiles(project);
  const threads = projectThreads(project.id);
  const runs = listCoworkRuns(project.id);
  const contextItems = listCoworkProjectContextItems(project.id).map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    path: item.path,
    source: item.source,
    provenance: item.provenance,
    sensitivity: item.sensitivity,
    included: item.included,
    pinned: item.pinned,
    staleState: item.stale_state,
    content: item.content,
    autoGenerated: item.auto_generated,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }));
  res.json({
    contextItems: [...contextItems, ...autoContextItems(files, threads, runs)],
  });
});

router.post('/:id/context', (req: Request, res: Response) => {
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
    res.status(400).json({ error: 'Context title is required' });
    return;
  }
  const now = new Date().toISOString();
  const item = createCoworkProjectContextItem({
    id: randomUUID(),
    project_id: project.id,
    kind:
      typeof req.body.kind === 'string' && req.body.kind.trim()
        ? req.body.kind.trim()
        : 'note',
    title,
    path:
      typeof req.body.path === 'string' && req.body.path.trim()
        ? req.body.path.trim()
        : null,
    source:
      typeof req.body.source === 'string' && req.body.source.trim()
        ? req.body.source.trim()
        : 'manual',
    provenance:
      typeof req.body.provenance === 'string' && req.body.provenance.trim()
        ? req.body.provenance.trim()
        : 'manual-entry',
    sensitivity:
      typeof req.body.sensitivity === 'string' && req.body.sensitivity.trim()
        ? req.body.sensitivity.trim()
        : 'normal',
    included: req.body.included === false ? 0 : 1,
    pinned: req.body.pinned === true ? 1 : 0,
    stale_state:
      typeof req.body.staleState === 'string' && req.body.staleState.trim()
        ? req.body.staleState.trim()
        : 'fresh',
    content:
      typeof req.body.content === 'string' && req.body.content.trim()
        ? req.body.content
        : null,
    auto_generated: 0,
    created_at: now,
    updated_at: now,
  });
  touchCoworkProject(project.id, now);
  res.json({
    item: {
      id: item.id,
      kind: item.kind,
      title: item.title,
      path: item.path,
      source: item.source,
      provenance: item.provenance,
      sensitivity: item.sensitivity,
      included: item.included,
      pinned: item.pinned,
      staleState: item.stale_state,
      content: item.content,
      autoGenerated: item.auto_generated,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    },
  });
});

router.patch('/:id/context/:itemId', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const now = new Date().toISOString();
  const updated = updateCoworkProjectContextItem(
    project.id,
    String(req.params.itemId),
    {
      title:
        typeof req.body.title === 'string' && req.body.title.trim()
          ? req.body.title.trim()
          : undefined,
      kind:
        typeof req.body.kind === 'string' && req.body.kind.trim()
          ? req.body.kind.trim()
          : undefined,
      path:
        typeof req.body.path === 'string' && req.body.path.trim()
          ? req.body.path.trim()
          : req.body.path === null
            ? null
            : undefined,
      source:
        typeof req.body.source === 'string' && req.body.source.trim()
          ? req.body.source.trim()
          : undefined,
      provenance:
        typeof req.body.provenance === 'string' && req.body.provenance.trim()
          ? req.body.provenance.trim()
          : undefined,
      sensitivity:
        typeof req.body.sensitivity === 'string' && req.body.sensitivity.trim()
          ? req.body.sensitivity.trim()
          : undefined,
      included:
        typeof req.body.included === 'boolean' ? (req.body.included ? 1 : 0) : undefined,
      pinned:
        typeof req.body.pinned === 'boolean' ? (req.body.pinned ? 1 : 0) : undefined,
      stale_state:
        typeof req.body.staleState === 'string' && req.body.staleState.trim()
          ? req.body.staleState.trim()
          : undefined,
      content:
        typeof req.body.content === 'string'
          ? req.body.content
          : req.body.content === null
            ? null
            : undefined,
      updated_at: now,
    },
  );
  if (!updated) {
    res.status(404).json({ error: 'Context item not found' });
    return;
  }
  touchCoworkProject(project.id, now);
  res.json({
    item: {
      id: updated.id,
      kind: updated.kind,
      title: updated.title,
      path: updated.path,
      source: updated.source,
      provenance: updated.provenance,
      sensitivity: updated.sensitivity,
      included: updated.included,
      pinned: updated.pinned,
      staleState: updated.stale_state,
      content: updated.content,
      autoGenerated: updated.auto_generated,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    },
  });
});

router.delete('/:id/context/:itemId', (req: Request, res: Response) => {
  const project = getCoworkProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  deleteCoworkProjectContextItem(project.id, String(req.params.itemId));
  touchCoworkProject(project.id, new Date().toISOString());
  res.json({ ok: true });
});

export default router;
