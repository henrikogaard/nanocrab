import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';

import { STORE_DIR } from '../../config.js';
import { logger } from '../../logger.js';
import type { ContainerConfig } from '../../types.js';
import { isAgentProvider } from '../../agent-provider.js';
import {
  filterAllowedConnectorIds,
  loadConnectorPermissions,
  normalizeConnectorId,
  normalizeConnectorPermission,
  saveConnectorPermissions,
  type ConnectorPermission,
} from '../../connector-permissions.js';
import {
  createChatProject,
  listChatProjects,
  getChatProject,
  getWebThreads,
  getRegisteredGroup,
  getCoworkProject,
  setRegisteredGroup,
  deleteRegisteredGroup,
  deleteMessagesForJid,
  storeMessageDirect,
  storeChatMetadata,
  updateChatName,
  getLatestStoredMessage,
  getStoredMessagesForJid,
} from '../../db.js';
import { isWebJid, newWebJid, buildThreadGroup } from '../../web-threads.js';
import { resolveGroupFolderPath } from '../../group-folder.js';
import { getState } from '../state.js';

const router = Router();
const MCP_CONFIG_PATH = path.join(STORE_DIR, 'mcp-servers.json');

const COWORK_MCP_THREAD_EXAMPLES = [
  'Latest emails -> sourced project summary',
  'Emails from a person or domain -> commitments and follow-ups',
  'External MCP context -> local markdown document draft',
  'Project files plus MCP evidence -> source ledger and artifact',
];

const WEB_MCP_THREAD_EXAMPLES = [
  'Check recent email or calendar context',
  'Search configured storage or document sources',
  'Use external MCP context in this chat',
];

function newChatProjectId(): string {
  return `chat-project-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function threadSummary(
  jid: string,
  group: ReturnType<typeof getRegisteredGroup>,
) {
  if (!group) return null;
  const latest = getLatestStoredMessage(jid);
  const chatProject = group.chatProjectId
    ? getChatProject(group.chatProjectId)
    : undefined;
  return {
    id: jid,
    title: group.title ?? 'New conversation',
    addedAt: group.added_at,
    lastMessage: latest?.content ?? null,
    lastMessageAt: latest?.timestamp ?? null,
    chatProjectId: group.chatProjectId ?? null,
    chatProjectName: chatProject?.name ?? null,
  };
}

function readConfiguredExternalMcpServers(): string[] {
  try {
    if (!fs.existsSync(MCP_CONFIG_PATH)) return [];
    const raw = JSON.parse(
      fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'),
    ) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((server) => {
        if (!server || typeof server !== 'object') return null;
        const shape = server as { name?: unknown; core?: unknown };
        const connectorId = normalizeConnectorId(shape.name);
        if (!connectorId || connectorId === 'nanocrab' || shape.core === true) {
          return null;
        }
        return connectorId;
      })
      .filter((connectorId): connectorId is string => Boolean(connectorId))
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    logger.warn({ err }, 'Could not read configured MCP servers for web chat');
    return [];
  }
}

function hasConfiguredExternalMcpServers(): boolean {
  return fs.existsSync(MCP_CONFIG_PATH);
}

function ensureWebThreadMcpPermissions(
  serverNames: string[],
  groupFolder: string,
): void {
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
        scope: 'groups',
        allowedActions: ['*.read', 'tools.expose'],
        requiresApproval: true,
        groups: [groupFolder],
        agents: [],
      }),
    );
    existingIds.add(connectorId);
  }

  if (additions.length) {
    saveConnectorPermissions([...permissions, ...additions]);
  }
}

function actionAllowsWrite(action: string): boolean {
  return /(^|\.)(write|send|create|update|delete|upload|push|commit|open_pr|execute)$/i.test(
    action,
  );
}

function mcpWriteStatus(allowedMcpServers: string[]): {
  writesEnabled: boolean;
  requiresApprovalForWrites: boolean;
} {
  if (!allowedMcpServers.length) {
    return { writesEnabled: false, requiresApprovalForWrites: false };
  }
  const permissions = loadConnectorPermissions();
  let writesEnabled = false;
  let requiresApprovalForWrites = false;
  for (const serverName of allowedMcpServers) {
    const connectorId = normalizeConnectorId(serverName);
    const permission = permissions.find(
      (item) => item.connectorId === connectorId,
    );
    if (!permission) {
      requiresApprovalForWrites = true;
      continue;
    }
    const hasWrite =
      permission.allowedActions.includes('*') ||
      permission.allowedActions.some(actionAllowsWrite);
    if (hasWrite) {
      writesEnabled = true;
      if (permission.requiresApproval) requiresApprovalForWrites = true;
    }
  }
  return { writesEnabled, requiresApprovalForWrites };
}

function allowedWebThreadMcpServers(
  groupFolder: string,
  configuredServers: string[],
  isProjectThread: boolean,
): string[] {
  return filterAllowedConnectorIds({
    connectorIds: configuredServers,
    groupFolder,
    agentId: groupFolder,
    isMain: false,
    isCoworkProject: isProjectThread,
    action: 'tools.expose',
  });
}

function webThreadMcpConfig(
  groupFolder: string,
  base: ContainerConfig = {},
): ContainerConfig {
  const allowedMcpServers = readConfiguredExternalMcpServers();
  ensureWebThreadMcpPermissions(allowedMcpServers, groupFolder);
  return {
    ...base,
    allowedMcpServers,
  };
}

function refreshWebThreadMcpAccess(id: string) {
  const group = getRegisteredGroup(id);
  if (!group || group.kind !== 'web') {
    return group;
  }
  if (!hasConfiguredExternalMcpServers()) return group;

  const allowedMcpServers = readConfiguredExternalMcpServers();
  ensureWebThreadMcpPermissions(allowedMcpServers, group.folder);

  const existingConfig = group.containerConfig || {};
  const current = existingConfig.allowedMcpServers || [];
  const changed =
    current.length !== allowedMcpServers.length ||
    current.some((server, index) => server !== allowedMcpServers[index]);
  if (!changed) return group;

  const updatedGroup = {
    ...group,
    containerConfig: {
      ...existingConfig,
      allowedMcpServers,
    },
  };
  setRegisteredGroup(id, updatedGroup);
  try {
    getState().updateRegisteredGroup?.(id, updatedGroup);
  } catch {
    /* state not ready */
  }
  return updatedGroup;
}

// GET / — list web threads, newest first by addedAt
router.get('/', (_req: Request, res: Response) => {
  try {
    const threads = getWebThreads();
    const list = Object.entries(threads)
      .filter(([, g]) => !g.projectId)
      .map(([jid, g]) => threadSummary(jid, { ...g, jid }))
      .filter((thread): thread is NonNullable<typeof thread> => Boolean(thread))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    res.json(list);
  } catch (err) {
    logger.error({ err }, 'Failed to list web threads');
    res.status(500).json({ error: 'Failed to list threads' });
  }
});

router.get('/projects', (_req: Request, res: Response) => {
  try {
    const threads = getWebThreads();
    const plainThreads = Object.entries(threads)
      .filter(([, g]) => !g.projectId)
      .map(([jid, g]) => threadSummary(jid, { ...g, jid }))
      .filter((thread): thread is NonNullable<typeof thread> =>
        Boolean(thread),
      );
    const projects = listChatProjects().map((project) => {
      const projectThreads = plainThreads
        .filter((thread) => thread.chatProjectId === project.id)
        .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
      return {
        id: project.id,
        name: project.name,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
        threadCount: projectThreads.length,
        threads: projectThreads,
      };
    });
    res.json({ projects });
  } catch (err) {
    logger.error({ err }, 'Failed to list chat projects');
    res.status(500).json({ error: 'Failed to list chat projects' });
  }
});

router.post('/projects', (req: Request, res: Response) => {
  try {
    const incoming = (req.body as { name?: unknown })?.name;
    const name = typeof incoming === 'string' ? incoming.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const now = new Date().toISOString();
    const project = createChatProject({
      id: newChatProjectId(),
      name,
      created_at: now,
      updated_at: now,
    });
    res.json({
      id: project.id,
      name: project.name,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      threadCount: 0,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to create chat project');
    res.status(500).json({ error: 'Failed to create chat project' });
  }
});

// POST / — create a new web thread
router.post('/', (req: Request, res: Response) => {
  try {
    const { templateAgentId, provider, model, title, chatProjectId } =
      req.body as {
        templateAgentId?: string;
        provider?: string;
        model?: string;
        title?: string;
        chatProjectId?: string;
      };
    const cleanTitle =
      typeof title === 'string' && title.trim() ? title.trim() : undefined;

    const jid = newWebJid();
    const groupFolder = `web-${jid.slice('web:'.length)}`;
    let config: ContainerConfig = webThreadMcpConfig(groupFolder);

    if (templateAgentId) {
      res.status(400).json({
        error: 'Agent templates are not supported for chat threads',
      });
      return;
    }

    const cleanChatProjectId =
      typeof chatProjectId === 'string' && chatProjectId.trim()
        ? chatProjectId.trim()
        : undefined;
    if (cleanChatProjectId && !getChatProject(cleanChatProjectId)) {
      res.status(400).json({ error: 'Unknown chat project' });
      return;
    }

    if (provider) {
      if (!isAgentProvider(provider)) {
        res.status(400).json({ error: 'Unknown provider' });
        return;
      }
      config = {
        provider,
        ...(model ? { model } : {}),
      } as ContainerConfig;
      config = webThreadMcpConfig(groupFolder, config);
    }
    // else config keeps the default web chat MCP access

    const group = buildThreadGroup({
      jid,
      title: cleanTitle,
      chatProjectId: cleanChatProjectId,
      addedAt: new Date().toISOString(),
      config,
    });
    setRegisteredGroup(jid, group);
    try {
      getState().updateRegisteredGroup?.(jid, group);
    } catch {
      /* state not ready */
    }

    res.json({ id: jid });
  } catch (err) {
    logger.error({ err }, 'Failed to create web thread');
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

// GET /:id — metadata for a single web thread, including project context
router.get('/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (!isWebJid(id)) {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }
  const group = refreshWebThreadMcpAccess(id);
  if (!group || group.kind !== 'web') {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }

  const project = group.projectId ? getCoworkProject(group.projectId) : null;
  const allowedMcpServers = group.containerConfig?.allowedMcpServers;
  const isProjectThread = Boolean(group.projectId || group.projectSlug);
  const effectiveMcpServers =
    allowedMcpServers === undefined
      ? undefined
      : allowedWebThreadMcpServers(
          group.folder,
          allowedMcpServers,
          isProjectThread,
        );
  const hasMcpAccess =
    effectiveMcpServers === undefined || effectiveMcpServers.length > 0;
  const writeStatus =
    effectiveMcpServers === undefined
      ? { writesEnabled: true, requiresApprovalForWrites: true }
      : mcpWriteStatus(effectiveMcpServers);
  res.json({
    id,
    title: group.title?.trim() ? group.title : 'New conversation',
    addedAt: group.added_at,
    projectId: group.projectId ?? null,
    projectSlug: group.projectSlug ?? project?.slug ?? null,
    projectName: project?.name ?? null,
    chatProjectId: group.chatProjectId ?? null,
    chatProjectName: group.chatProjectId
      ? (getChatProject(group.chatProjectId)?.name ?? null)
      : null,
    mcpAccess: {
      enabled: hasMcpAccess,
      scope:
        allowedMcpServers === undefined
          ? 'configured'
          : allowedMcpServers.length
            ? 'restricted'
            : 'nanocrab-only',
      servers: effectiveMcpServers ?? null,
      writesEnabled: writeStatus.writesEnabled,
      requiresApprovalForWrites: writeStatus.requiresApprovalForWrites,
      examples: isProjectThread
        ? COWORK_MCP_THREAD_EXAMPLES
        : hasMcpAccess
          ? WEB_MCP_THREAD_EXAMPLES
          : [],
    },
  });
});

// GET /:id/messages — messages for a web thread
router.get('/:id/messages', (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (!isWebJid(id)) {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }
  if (!getRegisteredGroup(id)) {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }
  try {
    const msgs = getStoredMessagesForJid(id);
    res.json(msgs);
  } catch (err) {
    logger.error({ err, id }, 'Failed to load thread messages');
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// POST /:id/messages — send a user message and trigger the agent
router.post('/:id/messages', (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (!isWebJid(id)) {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }
  const group = refreshWebThreadMcpAccess(id);
  if (!group) {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }

  const { message } = req.body as { message?: string };
  if (!message || !message.trim()) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    // Determine sender name from authenticated user if available
    const senderName =
      (req as Request & { user?: { username?: string; name?: string } }).user
        ?.username ?? 'user';

    const msgId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const timestamp = new Date().toISOString();

    // Ensure the chat row exists before the message insert satisfies its FK.
    storeChatMetadata(id, timestamp, group.title ?? 'Web conversation', 'web');

    // Store the message using shared db helpers
    storeMessageDirect({
      id: msgId,
      chat_jid: id,
      sender: 'user',
      sender_name: senderName,
      content: message,
      timestamp,
      is_from_me: false,
      is_bot_message: false,
    });

    // Trigger the agent via the queue (same mechanism as chat plugin)
    try {
      const state = getState();
      state.queue.enqueueMessageCheck(id);
    } catch (stateErr) {
      // State may not be initialized in tests; log but don't fail the request
      logger.warn(
        { stateErr },
        'Could not enqueue message check (state not ready)',
      );
    }

    const allowedMcpServers = group.containerConfig?.allowedMcpServers;
    const isProjectThread = Boolean(group.projectId || group.projectSlug);
    const effectiveMcpServers =
      allowedMcpServers === undefined
        ? undefined
        : allowedWebThreadMcpServers(
            group.folder,
            allowedMcpServers,
            isProjectThread,
          );
    const hasMcpAccess =
      effectiveMcpServers === undefined || effectiveMcpServers.length > 0;
    const writeStatus =
      effectiveMcpServers === undefined
        ? { writesEnabled: true, requiresApprovalForWrites: true }
        : mcpWriteStatus(effectiveMcpServers);
    res.json({
      ok: true,
      mcpAccess: hasMcpAccess
        ? {
            enabled: true,
            servers: effectiveMcpServers ?? null,
            writesEnabled: writeStatus.writesEnabled,
            requiresApprovalForWrites: writeStatus.requiresApprovalForWrites,
          }
        : undefined,
    });
  } catch (err) {
    logger.error({ err, id }, 'Failed to store thread message');
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// PATCH /:id — rename a web thread
router.patch('/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const group = getRegisteredGroup(id);
  if (!group || group.kind !== 'web') {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }
  try {
    const body = req.body as { title?: unknown; chatProjectId?: unknown };
    const incoming = body?.title;
    const newTitle =
      typeof incoming === 'string' && incoming.trim()
        ? incoming.trim()
        : (group.title ?? '');
    let nextChatProjectId = group.chatProjectId;
    if (Object.prototype.hasOwnProperty.call(body || {}, 'chatProjectId')) {
      if (typeof body.chatProjectId === 'string' && body.chatProjectId.trim()) {
        nextChatProjectId = body.chatProjectId.trim();
        if (!getChatProject(nextChatProjectId)) {
          res.status(400).json({ error: 'Unknown chat project' });
          return;
        }
      } else {
        nextChatProjectId = undefined;
      }
    }
    const updatedGroup = {
      ...group,
      title: newTitle,
      chatProjectId: nextChatProjectId,
    };
    setRegisteredGroup(id, updatedGroup);
    updateChatName(id, newTitle.trim() || 'New conversation');
    try {
      getState().updateRegisteredGroup?.(id, updatedGroup);
    } catch {
      /* state not ready */
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, 'Failed to rename thread');
    res.status(500).json({ error: 'Failed to rename thread' });
  }
});

// DELETE /:id — delete a web thread and clean up
router.delete('/:id', async (_req: Request, res: Response) => {
  const id = _req.params.id as string;
  const group = getRegisteredGroup(id);
  if (!group || group.kind !== 'web') {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }

  // Best-effort: stop running container for this jid
  try {
    const state = getState();
    // GroupQueue does not expose a per-jid stop; signal via closeStdin best-effort
    state.queue.closeStdin(id);
  } catch (stopErr) {
    logger.warn(
      { stopErr, id },
      'Could not stop container for web thread (best-effort)',
    );
  }

  // Best-effort: remove the group's folder
  try {
    const folderPath = resolveGroupFolderPath(group.folder);
    if (fs.existsSync(folderPath)) {
      fs.rmSync(folderPath, { recursive: true, force: true });
    }
  } catch (folderErr) {
    logger.warn(
      { folderErr, id },
      'Could not remove web thread folder (best-effort)',
    );
  }

  // Delete from DB (registered group + messages + chat row)
  try {
    deleteMessagesForJid(id);
  } catch (msgErr) {
    logger.warn(
      { msgErr, id },
      'Could not delete messages for web thread (best-effort)',
    );
  }
  try {
    deleteRegisteredGroup(id);
  } catch (regErr) {
    logger.warn(
      { regErr, id },
      'Could not delete registered group for web thread (best-effort)',
    );
  }
  try {
    getState().removeRegisteredGroup?.(id);
  } catch (memErr) {
    logger.warn(
      { memErr, id },
      'Could not remove web thread from in-memory map (best-effort)',
    );
  }

  res.json({ ok: true });
});

export default router;
