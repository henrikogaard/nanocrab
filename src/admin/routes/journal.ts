import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import path from 'path';

import { STORE_DIR } from '../../config.js';
import { getAllRegisteredGroups } from '../../db.js';
import {
  answerJournalQuestion,
  findJournalEvents,
  listJournalEntryRecords,
  recordJournalEntry,
  recordJournalEvent,
} from '../../journal-store.js';
import { requireRole } from '../middleware.js';
import { auditLog } from '../security.js';

const router = Router();

function dayWindow(dateInput?: string): {
  start: Date;
  end: Date;
  label: string;
} {
  const base = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(base.getTime())) throw new Error('date is invalid');
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end, label: start.toISOString().slice(0, 10) };
}

function weekWindow(dateInput?: string): {
  start: Date;
  end: Date;
  label: string;
} {
  const daily = dayWindow(dateInput);
  const day = daily.start.getDay() || 7;
  daily.start.setDate(daily.start.getDate() - day + 1);
  const end = new Date(daily.start);
  end.setDate(end.getDate() + 7);
  return {
    start: daily.start,
    end,
    label: `${daily.start.toISOString().slice(0, 10)}-week`,
  };
}

function summarizeLines(
  rows: Array<{
    id: string;
    sender_name: string;
    content: string;
    timestamp: string;
  }>,
): { summary: string; notableRows: typeof rows } {
  const bySender = new Map<string, number>();
  const notableRows = rows.filter((row) =>
    /\b(attack|attacked|fleet|crash|operation|op\b|planet|order|rally|scout|intel|defend|reinforce)\b/i.test(
      row.content,
    ),
  );
  for (const row of rows) {
    bySender.set(row.sender_name, (bySender.get(row.sender_name) || 0) + 1);
  }
  const topSenders = [...bySender.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name} (${count})`)
    .join(', ');
  const notableBullets = notableRows
    .slice(0, 8)
    .map((row) => `- ${row.sender_name}: ${row.content.slice(0, 220)}`)
    .join('\n');
  const summary = [
    `${rows.length} message(s) reviewed.`,
    topSenders ? `Most active: ${topSenders}.` : '',
    notableRows.length
      ? `Notable operation/game events:\n${notableBullets}`
      : 'No obvious operation/game events matched the first-pass extractor.',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { summary, notableRows };
}

router.get('/entries', (req: Request, res: Response) => {
  res.json(
    listJournalEntryRecords({
      groupFolder:
        typeof req.query.group === 'string' ? req.query.group : undefined,
      scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
      limit: Math.min(parseInt(req.query.limit as string) || 30, 200),
    }),
  );
});

router.get('/events', (req: Request, res: Response) => {
  const query = typeof req.query.query === 'string' ? req.query.query : '';
  if (!query.trim()) {
    res.json([]);
    return;
  }
  res.json(
    findJournalEvents({
      query,
      groupFolder:
        typeof req.query.group === 'string' ? req.query.group : undefined,
      limit: Math.min(parseInt(req.query.limit as string) || 30, 100),
    }),
  );
});

router.get('/search', (req: Request, res: Response) => {
  const query = typeof req.query.query === 'string' ? req.query.query : '';
  if (!query.trim()) {
    res.json({
      query,
      events: [],
      answer: 'Ask a question to search the journal.',
    });
    return;
  }
  res.json(
    answerJournalQuestion({
      query,
      groupFolder:
        typeof req.query.group === 'string' ? req.query.group : undefined,
      limit: Math.min(parseInt(req.query.limit as string) || 10, 50),
    }),
  );
});

router.post(
  '/summaries',
  requireRole('admin'),
  (req: Request, res: Response) => {
    try {
      const period = req.body.period === 'weekly' ? 'weekly' : 'daily';
      const window =
        period === 'weekly'
          ? weekWindow(req.body.date)
          : dayWindow(req.body.date);
      const groupFolder =
        typeof req.body.groupFolder === 'string' ? req.body.groupFolder : '';
      if (!groupFolder) {
        res.status(400).json({ error: 'groupFolder is required' });
        return;
      }
      const groups = getAllRegisteredGroups();
      const groupJid = Object.entries(groups).find(
        ([, group]) => group.folder === groupFolder,
      )?.[0];
      if (!groupJid) {
        res.status(404).json({ error: `group not found: ${groupFolder}` });
        return;
      }

      const db = new Database(path.join(STORE_DIR, 'messages.db'), {
        readonly: true,
      });
      try {
        const rows = db
          .prepare(
            `
          SELECT id, sender_name, content, timestamp
          FROM messages
          WHERE chat_jid = ?
            AND timestamp >= ?
            AND timestamp < ?
            AND is_bot_message = 0
            AND content IS NOT NULL
            AND content != ''
          ORDER BY timestamp ASC
          LIMIT 1000
        `,
          )
          .all(
            groupJid,
            window.start.toISOString(),
            window.end.toISOString(),
          ) as Array<{
          id: string;
          sender_name: string;
          content: string;
          timestamp: string;
        }>;
        const generated = summarizeLines(rows);
        for (const row of generated.notableRows.slice(0, 20)) {
          recordJournalEvent({
            title: row.content.slice(0, 180),
            timestamp: row.timestamp,
            entities: [row.sender_name],
            locationContext: groupFolder,
            confidence: 0.55,
            sourceIds: [row.id],
            tags: ['auto-extracted', period],
            groupFolder,
          });
        }
        const entry = recordJournalEntry({
          date: window.label,
          scope: period,
          groupFolder,
          summary: generated.summary,
          notableEvents: generated.notableRows.slice(0, 20).map((row) => ({
            title: row.content.slice(0, 180),
            timestamp: row.timestamp,
            sender: row.sender_name,
          })),
          sourceMessageIds: rows.map((row) => row.id),
          providerProfileId: 'default_journal',
        });
        auditLog(
          req,
          'journal_summary_created',
          `${period}/${groupFolder}/${window.label}`,
        );
        res.json({ ok: true, entry, messageCount: rows.length });
      } finally {
        db.close();
      }
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.post('/extract', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const period = req.body.period === 'weekly' ? 'weekly' : 'daily';
    const window =
      period === 'weekly'
        ? weekWindow(req.body.date)
        : dayWindow(req.body.date);
    const groupFolder =
      typeof req.body.groupFolder === 'string' ? req.body.groupFolder : '';
    if (!groupFolder) {
      res.status(400).json({ error: 'groupFolder is required' });
      return;
    }
    const groups = getAllRegisteredGroups();
    const groupJid = Object.entries(groups).find(
      ([, group]) => group.folder === groupFolder,
    )?.[0];
    if (!groupJid) {
      res.status(404).json({ error: `group not found: ${groupFolder}` });
      return;
    }
    const db = new Database(path.join(STORE_DIR, 'messages.db'), {
      readonly: true,
    });
    try {
      const rows = db
        .prepare(
          `
          SELECT id, sender_name, content, timestamp
          FROM messages
          WHERE chat_jid = ?
            AND timestamp >= ?
            AND timestamp < ?
            AND is_bot_message = 0
            AND content IS NOT NULL
            AND content != ''
          ORDER BY timestamp ASC
          LIMIT 1000
        `,
        )
        .all(
          groupJid,
          window.start.toISOString(),
          window.end.toISOString(),
        ) as Array<{
        id: string;
        sender_name: string;
        content: string;
        timestamp: string;
      }>;
      const generated = summarizeLines(rows);
      for (const row of generated.notableRows.slice(0, 20)) {
        recordJournalEvent({
          title: row.content.slice(0, 180),
          timestamp: row.timestamp,
          entities: [row.sender_name],
          locationContext: groupFolder,
          confidence: 0.55,
          sourceIds: [row.id],
          tags: ['auto-extracted', period, 'llm-ready'],
          groupFolder,
        });
      }
      const entry = recordJournalEntry({
        date: window.label,
        scope: period,
        groupFolder,
        summary: generated.summary,
        notableEvents: generated.notableRows.slice(0, 20).map((row) => ({
          title: row.content.slice(0, 180),
          timestamp: row.timestamp,
          sender: row.sender_name,
        })),
        sourceMessageIds: rows.map((row) => row.id),
        providerProfileId:
          typeof req.body.providerProfileId === 'string'
            ? req.body.providerProfileId
            : 'default_journal',
      });
      auditLog(req, 'journal_extraction_created', `${period}/${groupFolder}`);
      res.json({ ok: true, entry, messageCount: rows.length });
    } finally {
      db.close();
    }
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
