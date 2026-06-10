/**
 * Agent-to-Agent Messaging — agents can send messages to other agent groups.
 * Messages are stored in SQLite and visible from the dashboard.
 */
import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { STORE_DIR } from '../../config.js';
import { resolveGroupIpcPath } from '../../group-folder.js';
import { auditLog } from '../security.js';
import { logger } from '../../logger.js';
import { broadcast } from '../websocket.js';

const router = Router();

let db: Database.Database;

export function initAgentMessagesDb(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      from_group TEXT NOT NULL,
      to_group TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'unread',
      created_at TEXT NOT NULL,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_msg_to ON agent_messages(to_group, status);
    CREATE INDEX IF NOT EXISTS idx_agent_msg_from ON agent_messages(from_group);
  `);
}

interface AgentMessage {
  id: string;
  from_group: string;
  to_group: string;
  content: string;
  status: 'unread' | 'read';
  created_at: string;
  read_at: string | null;
}

// POST /api/agents/message — send a message from one agent to another
router.post('/message', (req: Request, res: Response) => {
  const { fromGroup, toGroup, content } = req.body;
  if (!fromGroup || !toGroup || !content) {
    res.status(400).json({ error: 'fromGroup, toGroup, and content required' });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO agent_messages (id, from_group, to_group, content, status, created_at)
     VALUES (?, ?, ?, ?, 'unread', ?)`,
  ).run(id, fromGroup, toGroup, content, now);

  // Write to receiving group's IPC input directory
  const ipcDir = resolveGroupIpcPath(toGroup);
  const inputDir = path.join(ipcDir, 'input');
  fs.mkdirSync(inputDir, { recursive: true });

  const msgFile = path.join(inputDir, `agent-msg-${id}.json`);
  fs.writeFileSync(
    msgFile,
    JSON.stringify({
      type: 'agent_message',
      id,
      fromGroup,
      content,
      timestamp: now,
    }),
  );

  // Notify dashboard via WebSocket
  broadcast({
    type: 'agent_message',
    data: { id, fromGroup, toGroup, content },
  });

  logger.info({ id, fromGroup, toGroup }, 'Agent message sent');
  res.json({ ok: true, id });
});

// GET /api/agents/messages/:groupFolder — get messages for a group
router.get('/messages/:groupFolder', (req: Request, res: Response) => {
  const { groupFolder } = req.params;
  const limit = parseInt(req.query.limit as string) || 50;

  const messages = db
    .prepare(
      `SELECT * FROM agent_messages
       WHERE to_group = ? OR from_group = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(groupFolder, groupFolder, limit) as AgentMessage[];

  res.json(messages);
});

// POST /api/agents/messages/:id/read — mark a message as read
router.post('/messages/:id/read', (req: Request, res: Response) => {
  const { id } = req.params;
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `UPDATE agent_messages SET status = 'read', read_at = ? WHERE id = ?`,
    )
    .run(now, id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }

  res.json({ ok: true });
});

// GET /api/agents/messages — list all recent agent messages
router.get('/messages', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const messages = db
    .prepare(`SELECT * FROM agent_messages ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as AgentMessage[];

  res.json(messages);
});

export default router;
