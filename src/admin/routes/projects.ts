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
import type { ContainerConfig, CoworkProject } from '../../types.js';
import { isAgentProvider } from '../../agent-provider.js';
import {
  loadConnectorPermissions,
  normalizeConnectorId,
  normalizeConnectorPermission,
  saveConnectorPermissions,
  type ConnectorPermission,
} from '../../connector-permissions.js';
import {
  createCoworkProject,
  getCoworkProject,
  getCoworkProjectBySlug,
  getCoworkProjects,
  getLatestStoredMessage,
  getWebThreads,
  setRegisteredGroup,
  touchCoworkProject,
  updateCoworkProjectContext,
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
  };
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
  res.json({
    project: projectSummary(project),
    files: listCoworkProjectFiles(project),
    threads: projectThreads(project.id),
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

export default router;
