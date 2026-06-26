import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';

import { STORE_DIR } from '../../config.js';
import { logger } from '../../logger.js';
import type { ContainerConfig } from '../../types.js';
import { isAgentProvider } from '../../agent-provider.js';
import {
  loadConnectorPermissions,
  normalizeConnectorId,
  normalizeConnectorPermission,
  saveConnectorPermissions,
  type ConnectorPermission,
} from '../../connector-permissions.js';
import {
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
    logger.warn({ err }, 'Could not refresh MCP servers for project thread');
    return [];
  }
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

function refreshProjectThreadMcpAccess(id: string) {
  const group = getRegisteredGroup(id);
  if (
    !group ||
    group.kind !== 'web' ||
    !(group.projectId || group.projectSlug)
  ) {
    return group;
  }

  const allowedMcpServers = readConfiguredExternalMcpServers();
  ensureProjectThreadMcpPermissions(allowedMcpServers);

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
      .map(([jid, g]) => {
        const latest = getLatestStoredMessage(jid);
        return {
          id: jid,
          title: g.title ?? 'New conversation',
          addedAt: g.added_at,
          lastMessage: latest?.content ?? null,
          lastMessageAt: latest?.timestamp ?? null,
        };
      })
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    res.json(list);
  } catch (err) {
    logger.error({ err }, 'Failed to list web threads');
    res.status(500).json({ error: 'Failed to list threads' });
  }
});

// POST / — create a new web thread
router.post('/', (req: Request, res: Response) => {
  try {
    const { templateAgentId, provider, model, title } = req.body as {
      templateAgentId?: string;
      provider?: string;
      model?: string;
      title?: string;
    };
    const cleanTitle =
      typeof title === 'string' && title.trim() ? title.trim() : undefined;

    let config: ContainerConfig = { allowedMcpServers: [] };

    if (templateAgentId) {
      res.status(400).json({
        error: 'Agent templates are not supported for chat threads',
      });
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
        allowedMcpServers: [],
      } as ContainerConfig;
    }
    // else config = undefined → buildThreadGroup uses default

    const jid = newWebJid();
    const group = buildThreadGroup({
      jid,
      title: cleanTitle,
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
  const group = getRegisteredGroup(id);
  if (!group || group.kind !== 'web') {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }

  const project = group.projectId ? getCoworkProject(group.projectId) : null;
  const allowedMcpServers = group.containerConfig?.allowedMcpServers;
  const isProjectThread = Boolean(group.projectId || group.projectSlug);
  const hasProjectMcpAccess =
    isProjectThread &&
    (allowedMcpServers === undefined || allowedMcpServers.length > 0);
  res.json({
    id,
    title: group.title?.trim() ? group.title : 'New conversation',
    addedAt: group.added_at,
    projectId: group.projectId ?? null,
    projectSlug: group.projectSlug ?? project?.slug ?? null,
    projectName: project?.name ?? null,
    mcpAccess: {
      enabled: hasProjectMcpAccess,
      scope:
        allowedMcpServers === undefined
          ? 'configured'
          : allowedMcpServers.length
            ? 'restricted'
            : 'nanocrab-only',
      servers: allowedMcpServers ?? null,
      requiresApprovalForWrites: isProjectThread,
      examples: isProjectThread ? COWORK_MCP_THREAD_EXAMPLES : [],
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
  const group = refreshProjectThreadMcpAccess(id);
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

    const isProjectThread = Boolean(group.projectId || group.projectSlug);
    res.json({
      ok: true,
      mcpAccess: isProjectThread
        ? {
            enabled:
              (group.containerConfig?.allowedMcpServers || []).length > 0,
            servers: group.containerConfig?.allowedMcpServers || [],
            requiresApprovalForWrites: true,
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
    const incoming = (req.body as { title?: unknown })?.title;
    const newTitle =
      typeof incoming === 'string' && incoming.trim()
        ? incoming.trim()
        : (group.title ?? '');
    const updatedGroup = { ...group, title: newTitle };
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
