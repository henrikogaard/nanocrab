import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../config.js';

const router = Router();

function getDb(): Database.Database {
  return new Database(path.join(STORE_DIR, 'messages.db'), { readonly: true });
}

router.get('/recent', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const db = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT m.id, m.chat_jid, m.sender_name, m.content, m.timestamp, m.is_from_me, m.is_bot_message,
                c.name as chat_name, c.channel
         FROM messages m
         LEFT JOIN chats c ON m.chat_jid = c.jid
         WHERE m.content != '' AND m.content IS NOT NULL
         ORDER BY m.timestamp DESC LIMIT ?`,
      )
      .all(limit);
    res.json(rows);
  } finally {
    db.close();
  }
});

router.get('/search', (req: Request, res: Response) => {
  const q = req.query.q as string;
  if (!q || q.length < 2) {
    res.status(400).json({ error: 'Query must be at least 2 characters' });
    return;
  }
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const db = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT m.id, m.chat_jid, m.sender_name, m.content, m.timestamp, m.is_from_me, m.is_bot_message,
                c.name as chat_name, c.channel
         FROM messages m
         LEFT JOIN chats c ON m.chat_jid = c.jid
         WHERE m.content LIKE ?
         ORDER BY m.timestamp DESC LIMIT ?`,
      )
      .all(`%${q}%`, limit);
    res.json(rows);
  } finally {
    db.close();
  }
});

router.get('/:chatJid', (req: Request, res: Response) => {
  const { chatJid } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const before = (req.query.before as string) || new Date().toISOString();
  const db = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT id, chat_jid, sender_name, content, timestamp, is_from_me, is_bot_message
         FROM messages
         WHERE chat_jid = ? AND timestamp < ?
         ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(chatJid, before, limit);
    res.json(rows.reverse());
  } finally {
    db.close();
  }
});

// Pinned messages
router.get('/pinned', (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT m.id, m.chat_jid, m.sender_name, m.content, m.timestamp, m.is_from_me, m.is_bot_message,
                c.name as chat_name, c.channel
         FROM messages m
         LEFT JOIN chats c ON m.chat_jid = c.jid
         WHERE m.pinned = 1
         ORDER BY m.timestamp DESC LIMIT 50`,
      )
      .all();
    res.json(rows);
  } finally {
    db.close();
  }
});

router.put('/pin/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const chatJid = req.query.chatJid as string;
  const { pinned } = req.body;
  const db = new Database(path.join(STORE_DIR, 'messages.db'));
  try {
    db.prepare(
      'UPDATE messages SET pinned = ? WHERE id = ? AND chat_jid = ?',
    ).run(pinned ? 1 : 0, id, chatJid);
    res.json({ ok: true });
  } finally {
    db.close();
  }
});

// Export messages as JSON
router.get('/export/:chatJid', (req: Request, res: Response) => {
  const chatJid = req.params.chatJid as string;
  const format = (req.query.format as string) || 'json';
  const db = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT id, chat_jid, sender_name, content, timestamp, is_from_me, is_bot_message
         FROM messages WHERE chat_jid = ? ORDER BY timestamp`,
      )
      .all(chatJid) as Array<Record<string, unknown>>;

    if (format === 'csv') {
      const header = 'timestamp,sender,content\n';
      const csv = rows
        .map(
          (r) =>
            `"${r.timestamp}","${String(r.sender_name).replace(/"/g, '""')}","${String(r.content).replace(/"/g, '""')}"`,
        )
        .join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${chatJid.replace(/[^a-zA-Z0-9]/g, '_')}_export.csv"`,
      );
      res.send(header + csv);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${chatJid.replace(/[^a-zA-Z0-9]/g, '_')}_export.json"`,
      );
      res.json(rows);
    }
  } finally {
    db.close();
  }
});

export default router;
