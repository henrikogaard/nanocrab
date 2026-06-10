/**
 * Interactive Questions — agents can pose multiple-choice questions to users.
 * Questions are stored in SQLite and answered via the dashboard.
 * Answers are written back to the group's IPC directory for the agent to read.
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

export function initQuestionsDb(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_questions (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      question TEXT NOT NULL,
      options TEXT NOT NULL,
      answer TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL,
      answered_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_questions_status ON agent_questions(status);
    CREATE INDEX IF NOT EXISTS idx_questions_group ON agent_questions(group_folder);
  `);
}

interface AgentQuestion {
  id: string;
  group_folder: string;
  question: string;
  options: string; // JSON array of strings
  answer: string | null;
  status: 'pending' | 'answered' | 'expired';
  created_at: string;
  answered_at: string | null;
}

// POST /api/questions — agent creates a question
router.post('/', (req: Request, res: Response) => {
  const { groupFolder, question, options } = req.body;
  if (
    !groupFolder ||
    !question ||
    !Array.isArray(options) ||
    options.length === 0
  ) {
    res
      .status(400)
      .json({ error: 'groupFolder, question, and options[] required' });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO agent_questions (id, group_folder, question, options, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  ).run(id, groupFolder, question, JSON.stringify(options), now);

  // Notify dashboard via WebSocket
  broadcast({
    type: 'agent_question',
    data: { id, groupFolder, question, options },
  });

  logger.info({ id, groupFolder }, 'Agent question created');
  res.json({ ok: true, id });
});

// GET /api/questions/pending — list pending questions (optionally filtered by group)
router.get('/pending', (req: Request, res: Response) => {
  const groupFolder = req.query.group as string | undefined;

  let rows: AgentQuestion[];
  if (groupFolder) {
    rows = db
      .prepare(
        `SELECT * FROM agent_questions WHERE status = 'pending' AND group_folder = ? ORDER BY created_at DESC`,
      )
      .all(groupFolder) as AgentQuestion[];
  } else {
    rows = db
      .prepare(
        `SELECT * FROM agent_questions WHERE status = 'pending' ORDER BY created_at DESC`,
      )
      .all() as AgentQuestion[];
  }

  const questions = rows.map((q) => ({
    ...q,
    options: JSON.parse(q.options),
  }));

  res.json(questions);
});

// GET /api/questions — list all questions (recent)
router.get('/', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const rows = db
    .prepare(`SELECT * FROM agent_questions ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as AgentQuestion[];

  const questions = rows.map((q) => ({
    ...q,
    options: JSON.parse(q.options),
  }));

  res.json(questions);
});

// POST /api/questions/:id/answer — user answers a question
router.post('/:id/answer', (req: Request, res: Response) => {
  const { id } = req.params;
  const { answer } = req.body;
  if (!answer) {
    res.status(400).json({ error: 'answer required' });
    return;
  }

  const question = db
    .prepare(`SELECT * FROM agent_questions WHERE id = ?`)
    .get(id) as AgentQuestion | undefined;

  if (!question) {
    res.status(404).json({ error: 'Question not found' });
    return;
  }

  if (question.status !== 'pending') {
    res.status(400).json({ error: 'Question already answered' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE agent_questions SET answer = ?, status = 'answered', answered_at = ? WHERE id = ?`,
  ).run(answer, now, id);

  // Write the answer to the group's IPC input directory so the agent can read it
  const ipcDir = resolveGroupIpcPath(question.group_folder);
  const inputDir = path.join(ipcDir, 'input');
  fs.mkdirSync(inputDir, { recursive: true });

  const answerFile = path.join(inputDir, `answer-${id}.json`);
  fs.writeFileSync(
    answerFile,
    JSON.stringify({
      type: 'question_answer',
      questionId: id,
      question: question.question,
      answer,
      answeredAt: now,
    }),
  );

  auditLog(req, 'question_answered', `${id}: ${answer}`);
  logger.info(
    { id, answer, groupFolder: question.group_folder },
    'Question answered',
  );

  res.json({ ok: true });
});

export default router;
