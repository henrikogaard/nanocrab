import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

import { STORE_DIR } from '../../config.js';
import { logger } from '../../logger.js';
import type { ContainerConfig } from '../../types.js';
import {
  getWebThreads,
  getNonWebRegisteredGroups,
  getRegisteredGroup,
  setRegisteredGroup,
  deleteRegisteredGroup,
  deleteMessagesForJid,
} from '../../db.js';
import { isWebJid, newWebJid, buildThreadGroup } from '../../web-threads.js';
import { resolveGroupFolderPath } from '../../group-folder.js';
import { getState } from '../state.js';

const router = Router();

function getMessagesDb(): Database.Database {
  return new Database(path.join(STORE_DIR, 'messages.db'), { readonly: true });
}

/** Load the most recent message row for a given jid, same approach as messages.ts /:chatJid */
function getLatestMessage(
  jid: string,
): { content: string; timestamp: string } | undefined {
  const db = getMessagesDb();
  try {
    const row = db
      .prepare(
        `SELECT content, timestamp FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT 1`,
      )
      .get(jid) as { content: string; timestamp: string } | undefined;
    return row;
  } finally {
    db.close();
  }
}

/** Load all messages for a jid (same query as messages.ts /:chatJid, reversed). */
function getMessagesForJid(jid: string): unknown[] {
  const limit = 100;
  const before = new Date().toISOString();
  const db = getMessagesDb();
  try {
    const rows = db
      .prepare(
        `SELECT id, chat_jid, sender_name, content, timestamp, is_from_me, is_bot_message
         FROM messages
         WHERE chat_jid = ? AND timestamp < ?
         ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(jid, before, limit) as unknown[];
    return (rows as unknown[]).reverse();
  } finally {
    db.close();
  }
}

// GET / — list web threads, newest first by addedAt
router.get('/', (_req: Request, res: Response) => {
  try {
    const threads = getWebThreads();
    const list = Object.entries(threads)
      .map(([jid, g]) => {
        const latest = getLatestMessage(jid);
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

// GET /agent-templates — non-web groups as template options
router.get('/agent-templates', (_req: Request, res: Response) => {
  try {
    const groups = getNonWebRegisteredGroups();
    const list = Object.entries(groups).map(([jid, g]) => ({
      id: jid,
      label: g.name,
      provider: g.containerConfig?.provider ?? null,
      model: g.containerConfig?.model ?? null,
    }));
    res.json(list);
  } catch (err) {
    logger.error({ err }, 'Failed to list agent templates');
    res.status(500).json({ error: 'Failed to list agent templates' });
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

    let config: ContainerConfig | undefined;

    if (templateAgentId) {
      const template = getRegisteredGroup(templateAgentId);
      if (!template || template.kind === 'web') {
        res.status(400).json({ error: 'Unknown agent template' });
        return;
      }
      config = template.containerConfig
        ? { ...template.containerConfig }
        : undefined;
    } else if (provider) {
      config = { provider, ...(model ? { model } : {}) } as ContainerConfig;
    }
    // else config = undefined → buildThreadGroup uses default

    const jid = newWebJid();
    const group = buildThreadGroup({
      jid,
      title: title ?? undefined,
      addedAt: new Date().toISOString(),
      config,
    });
    setRegisteredGroup(jid, group);

    res.json({ id: jid });
  } catch (err) {
    logger.error({ err }, 'Failed to create web thread');
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

// GET /:id/messages — messages for a web thread
router.get('/:id/messages', (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (!isWebJid(id)) {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }
  try {
    const msgs = getMessagesForJid(id);
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
  const group = getRegisteredGroup(id);
  if (!group) {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }

  const { message } = req.body as { message?: string };
  if (!message) {
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

    // Store the message — mirror approach from chat plugin (direct sqlite write)
    const writableDb = new Database(path.join(STORE_DIR, 'messages.db'));
    try {
      writableDb
        .prepare(
          'INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(msgId, id, 'user', senderName, message, timestamp, 0, 0);
      // Ensure the chat row exists so the agent can look it up
      writableDb
        .prepare(
          `INSERT INTO chats (jid, name, last_message_time, channel) VALUES (?, ?, ?, ?)
           ON CONFLICT(jid) DO UPDATE SET last_message_time = MAX(last_message_time, excluded.last_message_time)`,
        )
        .run(id, group.title ?? 'Web conversation', timestamp, 'web');
    } finally {
      writableDb.close();
    }

    // Trigger the agent via the queue (same mechanism as chat plugin)
    try {
      const state = getState();
      state.queue.enqueueMessageCheck(id);
    } catch (stateErr) {
      // State may not be initialized in tests; log but don't fail the request
      logger.warn({ stateErr }, 'Could not enqueue message check (state not ready)');
    }

    res.json({ ok: true });
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
    const newTitle = String((req.body as { title?: unknown })?.title ?? group.title ?? '');
    setRegisteredGroup(id, { ...group, title: newTitle });
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
    logger.warn({ stopErr, id }, 'Could not stop container for web thread (best-effort)');
  }

  // Best-effort: remove the group's folder
  try {
    const folderPath = resolveGroupFolderPath(group.folder);
    if (fs.existsSync(folderPath)) {
      fs.rmSync(folderPath, { recursive: true, force: true });
    }
  } catch (folderErr) {
    logger.warn({ folderErr, id }, 'Could not remove web thread folder (best-effort)');
  }

  // Delete from DB (registered group + messages + chat row)
  try {
    deleteMessagesForJid(id);
  } catch (msgErr) {
    logger.warn({ msgErr, id }, 'Could not delete messages for web thread (best-effort)');
  }
  try {
    deleteRegisteredGroup(id);
  } catch (regErr) {
    logger.warn({ regErr, id }, 'Could not delete registered group for web thread (best-effort)');
  }

  res.json({ ok: true });
});

export default router;
