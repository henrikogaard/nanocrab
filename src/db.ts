import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, DATA_DIR, STORE_DIR } from './config.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import {
  NewMessage,
  MemoryRecord,
  MemoryStatus,
  JournalEntryRecord,
  JournalEventRecord,
  NewJournalEntryRecord,
  NewJournalEventRecord,
  NewMemoryRecord,
  RegisteredGroup,
  CoworkProject,
  CoworkProjectContextItem,
  CoworkRun,
  ScheduledTask,
  TaskRunLog,
} from './types.js';

let db: Database.Database;

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT,
      channel TEXT,
      is_group INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      is_bot_message INTEGER DEFAULT 0,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      title TEXT,
      description TEXT,
      routine_type TEXT,
      prompt TEXT NOT NULL,
      script TEXT,
      provider_profile_id TEXT,
      provider TEXT,
      model TEXT,
      tool_policy TEXT,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      context_mode TEXT DEFAULT 'isolated',
      delivery_mode TEXT,
      delivery_target TEXT,
      skills_json TEXT,
      max_runtime_ms INTEGER,
      max_active_runs INTEGER,
      active_run_count INTEGER DEFAULT 0,
      last_started_at TEXT,
      heartbeat_policy_json TEXT,
      silent_marker TEXT,
      session_key TEXT,
      context_task_ids_json TEXT,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      group_folder TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL UNIQUE,
      trigger_pattern TEXT NOT NULL,
      added_at TEXT NOT NULL,
      container_config TEXT,
      requires_trigger INTEGER DEFAULT 1,
      is_main INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      is_primary INTEGER DEFAULT 0,
      kind TEXT,
      title TEXT,
      project_id TEXT,
      project_slug TEXT
    );
    CREATE TABLE IF NOT EXISTS cowork_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      instructions TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cowork_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      complexity_level TEXT NOT NULL DEFAULT 'moderate',
      estimated_steps INTEGER NOT NULL DEFAULT 3,
      budget_tier TEXT NOT NULL DEFAULT 'medium',
      plan_steps_json TEXT NOT NULL DEFAULT '[]',
      events_json TEXT NOT NULL DEFAULT '[]',
      approvals_json TEXT NOT NULL DEFAULT '[]',
      outputs_json TEXT NOT NULL DEFAULT '[]',
      summary TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES cowork_projects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_cowork_runs_project ON cowork_runs(project_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS cowork_project_context_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT,
      source TEXT,
      provenance TEXT,
      sensitivity TEXT NOT NULL DEFAULT 'normal',
      included INTEGER NOT NULL DEFAULT 1,
      pinned INTEGER NOT NULL DEFAULT 0,
      stale_state TEXT NOT NULL DEFAULT 'fresh',
      content TEXT,
      auto_generated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES cowork_projects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_cowork_context_project ON cowork_project_context_items(project_id, pinned DESC, updated_at DESC);
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      ip TEXT PRIMARY KEY,
      attempts INTEGER DEFAULT 0,
      last_attempt TEXT NOT NULL,
      locked_until TEXT
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT,
      confidence REAL NOT NULL,
      visibility TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_at TEXT,
      expires_at TEXT,
      sensitivity TEXT DEFAULT 'normal',
      source_links_json TEXT DEFAULT '[]',
      contradicts_memory_id TEXT,
      stale_after TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, visibility);
    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      scope TEXT NOT NULL,
      group_folder TEXT,
      summary TEXT NOT NULL,
      notable_events_json TEXT NOT NULL,
      source_message_ids_json TEXT NOT NULL,
      provider_profile_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(date);
    CREATE INDEX IF NOT EXISTS idx_journal_entries_scope ON journal_entries(scope, group_folder);
    CREATE TABLE IF NOT EXISTS journal_events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      title TEXT NOT NULL,
      entities_json TEXT NOT NULL,
      location_context TEXT,
      confidence REAL NOT NULL,
      source_ids_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      group_folder TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_journal_events_timestamp ON journal_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_journal_events_group ON journal_events(group_folder);

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_id TEXT,
      action_type TEXT NOT NULL,
      resource TEXT NOT NULL,
      decision TEXT NOT NULL,
      context_json TEXT NOT NULL,
      correlation_id TEXT,
      duration_ms INTEGER,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_events_correlation ON audit_events(correlation_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action_type);
    CREATE INDEX IF NOT EXISTS idx_audit_events_decision ON audit_events(decision);
  `);

  // Add context_mode column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
    );
  } catch {
    /* column already exists */
  }

  // Add script column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN script TEXT`);
  } catch {
    /* column already exists */
  }

  // Add provider routing columns if they don't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN provider_profile_id TEXT`,
    );
  } catch {
    /* column already exists */
  }
  try {
    database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN provider TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN model TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN tool_policy TEXT`);
  } catch {
    /* column already exists */
  }

  for (const [column, definition] of [
    ['title', 'TEXT'],
    ['description', 'TEXT'],
    ['routine_type', 'TEXT'],
    ['delivery_mode', 'TEXT'],
    ['delivery_target', 'TEXT'],
    ['skills_json', 'TEXT'],
    ['max_runtime_ms', 'INTEGER'],
    ['max_active_runs', 'INTEGER'],
    ['active_run_count', 'INTEGER DEFAULT 0'],
    ['last_started_at', 'TEXT'],
    ['heartbeat_policy_json', 'TEXT'],
    ['silent_marker', 'TEXT'],
    ['session_key', 'TEXT'],
    ['context_task_ids_json', 'TEXT'],
  ]) {
    try {
      database.exec(
        `ALTER TABLE scheduled_tasks ADD COLUMN ${column} ${definition}`,
      );
    } catch {
      /* column already exists */
    }

    for (const [column, definition] of [
      ['complexity_level', `TEXT NOT NULL DEFAULT 'moderate'`],
      ['estimated_steps', 'INTEGER NOT NULL DEFAULT 3'],
      ['budget_tier', `TEXT NOT NULL DEFAULT 'medium'`],
    ]) {
      try {
        database.exec(
          `ALTER TABLE cowork_runs ADD COLUMN ${column} ${definition}`,
        );
      } catch {
        /* column already exists */
      }
    }
  }

  for (const [column, definition] of [
    ['sensitivity', `TEXT DEFAULT 'normal'`],
    ['source_links_json', `TEXT DEFAULT '[]'`],
    ['contradicts_memory_id', 'TEXT'],
    ['stale_after', 'TEXT'],
  ]) {
    try {
      database.exec(`ALTER TABLE memories ADD COLUMN ${column} ${definition}`);
    } catch {
      /* column already exists */
    }
  }

  // Add is_bot_message column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE messages ADD COLUMN is_bot_message INTEGER DEFAULT 0`,
    );
    // Backfill: mark existing bot messages that used the content prefix pattern
    database
      .prepare(`UPDATE messages SET is_bot_message = 1 WHERE content LIKE ?`)
      .run(`${ASSISTANT_NAME}:%`);
  } catch {
    /* column already exists */
  }

  // Add is_main column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE registered_groups ADD COLUMN is_main INTEGER DEFAULT 0`,
    );
    // Backfill: existing rows with folder = 'main' are the main group
    database.exec(
      `UPDATE registered_groups SET is_main = 1 WHERE folder = 'main'`,
    );
  } catch {
    /* column already exists */
  }

  // Add bot-agent enabled/primary flags if they don't exist.
  try {
    database.exec(
      `ALTER TABLE registered_groups ADD COLUMN enabled INTEGER DEFAULT 1`,
    );
    database.exec(
      `UPDATE registered_groups SET enabled = 1 WHERE enabled IS NULL`,
    );
  } catch {
    /* column already exists */
  }
  try {
    database.exec(
      `ALTER TABLE registered_groups ADD COLUMN is_primary INTEGER DEFAULT 0`,
    );
    database.exec(
      `UPDATE registered_groups
       SET is_primary = 1
       WHERE jid = (
         SELECT jid FROM registered_groups
         WHERE is_main = 1
         ORDER BY added_at ASC
         LIMIT 1
       )
       AND NOT EXISTS (
         SELECT 1 FROM registered_groups WHERE is_primary = 1
       )`,
    );
  } catch {
    /* column already exists */
  }
  try {
    database.exec(`ALTER TABLE registered_groups ADD COLUMN kind TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    database.exec(`ALTER TABLE registered_groups ADD COLUMN title TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    database.exec(`ALTER TABLE registered_groups ADD COLUMN project_id TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    database.exec(`ALTER TABLE registered_groups ADD COLUMN project_slug TEXT`);
  } catch {
    /* column already exists */
  }

  // Add channel and is_group columns if they don't exist (migration for existing DBs)
  try {
    database.exec(`ALTER TABLE chats ADD COLUMN channel TEXT`);
    database.exec(`ALTER TABLE chats ADD COLUMN is_group INTEGER DEFAULT 0`);
    // Backfill from JID patterns
    database.exec(
      `UPDATE chats SET channel = 'whatsapp', is_group = 1 WHERE jid LIKE '%@g.us'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'whatsapp', is_group = 0 WHERE jid LIKE '%@s.whatsapp.net'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'discord', is_group = 1 WHERE jid LIKE 'dc:%'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'telegram', is_group = 0 WHERE jid LIKE 'tg:%'`,
    );
  } catch {
    /* columns already exist */
  }

  // Add reply context columns if they don't exist (migration for existing DBs)
  try {
    database.exec(`ALTER TABLE messages ADD COLUMN reply_to_message_id TEXT`);
    database.exec(
      `ALTER TABLE messages ADD COLUMN reply_to_message_content TEXT`,
    );
    database.exec(`ALTER TABLE messages ADD COLUMN reply_to_sender_name TEXT`);
  } catch {
    /* columns already exist */
  }

  // Add pinned column for message pinning
  try {
    database.exec(`ALTER TABLE messages ADD COLUMN pinned INTEGER DEFAULT 0`);
  } catch {
    /* column already exists */
  }
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  createSchema(db);

  // Migrate from JSON files if they exist
  migrateJsonState();
}

/** @internal - for tests only. Creates a fresh in-memory database. */
export function _initTestDatabase(): void {
  db = new Database(':memory:');
  createSchema(db);
}

/** @internal - for tests only. */
export function _closeDatabase(): void {
  db.close();
}

/** @internal - used by audit logging to avoid noisy writes before init. */
export function isDatabaseInitialized(): boolean {
  return Boolean(db);
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
): void {
  const ch = channel ?? null;
  const group = isGroup === undefined ? null : isGroup ? 1 : 0;

  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time),
        channel = COALESCE(excluded.channel, channel),
        is_group = COALESCE(excluded.is_group, is_group)
    `,
    ).run(chatJid, name, timestamp, ch, group);
  } else {
    // Update timestamp only, preserve existing name if any
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time),
        channel = COALESCE(excluded.channel, channel),
        is_group = COALESCE(excluded.is_group, is_group)
    `,
    ).run(chatJid, chatJid, timestamp, ch, group);
  }
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string;
  is_group: number;
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT jid, name, last_message_time, channel, is_group
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

/**
 * Store a message with full content.
 * Only call this for registered groups where message history is needed.
 */
export function storeMessage(msg: NewMessage): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, reply_to_message_id, reply_to_message_content, reply_to_sender_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
    msg.reply_to_message_id ?? null,
    msg.reply_to_message_content ?? null,
    msg.reply_to_sender_name ?? null,
  );
}

/**
 * Store a message directly.
 */
export function storeMessageDirect(msg: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  is_bot_message?: boolean;
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
  );
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
  limit: number = 200,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  // Filter bot messages using both the is_bot_message flag AND the content
  // prefix as a backstop for messages written before the migration ran.
  // Subquery takes the N most recent, outer query re-sorts chronologically.
  const sql = `
    SELECT * FROM (
      SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me,
             reply_to_message_id, reply_to_message_content, reply_to_sender_name
      FROM messages
      WHERE timestamp > ? AND chat_jid IN (${placeholders})
        AND is_bot_message = 0 AND content NOT LIKE ?
        AND content != '' AND content IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT ?
    ) ORDER BY timestamp
  `;

  const rows = db
    .prepare(sql)
    .all(lastTimestamp, ...jids, `${botPrefix}:%`, limit) as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
  limit: number = 200,
): NewMessage[] {
  // Filter bot messages using both the is_bot_message flag AND the content
  // prefix as a backstop for messages written before the migration ran.
  // Subquery takes the N most recent, outer query re-sorts chronologically.
  const sql = `
    SELECT * FROM (
      SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me,
             reply_to_message_id, reply_to_message_content, reply_to_sender_name
      FROM messages
      WHERE chat_jid = ? AND timestamp > ?
        AND is_bot_message = 0 AND content NOT LIKE ?
        AND content != '' AND content IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT ?
    ) ORDER BY timestamp
  `;
  return db
    .prepare(sql)
    .all(chatJid, sinceTimestamp, `${botPrefix}:%`, limit) as NewMessage[];
}

export function getLastBotMessageTimestamp(
  chatJid: string,
  botPrefix: string,
): string | undefined {
  const row = db
    .prepare(
      `SELECT MAX(timestamp) as ts FROM messages
       WHERE chat_jid = ? AND (is_bot_message = 1 OR content LIKE ?)`,
    )
    .get(chatJid, `${botPrefix}:%`) as { ts: string | null } | undefined;
  return row?.ts ?? undefined;
}

export function getMessageContentById(
  id: string,
  chatJid: string,
): string | undefined {
  const row = db
    .prepare(`SELECT content FROM messages WHERE id = ? AND chat_jid = ?`)
    .get(id, chatJid) as { content: string } | undefined;
  return row?.content;
}

export function getLatestStoredMessage(
  chatJid: string,
): { content: string; timestamp: string } | undefined {
  return db
    .prepare(
      `SELECT content, timestamp FROM messages
       WHERE chat_jid = ?
       ORDER BY timestamp DESC LIMIT 1`,
    )
    .get(chatJid) as { content: string; timestamp: string } | undefined;
}

export function getStoredMessagesForJid(
  chatJid: string,
  before: string = new Date().toISOString(),
  limit: number = 100,
): unknown[] {
  const rows = db
    .prepare(
      `SELECT id, chat_jid, sender_name, content, timestamp, is_from_me, is_bot_message
       FROM messages
       WHERE chat_jid = ? AND timestamp < ?
       ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(chatJid, before, limit) as unknown[];
  return rows.reverse();
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (
      id, group_folder, chat_jid, title, description, routine_type,
      prompt, script, provider_profile_id, provider, model, tool_policy,
      schedule_type, schedule_value, context_mode, delivery_mode,
      delivery_target, skills_json, max_runtime_ms, max_active_runs,
      active_run_count, last_started_at, heartbeat_policy_json, silent_marker,
      session_key, context_task_ids_json, next_run, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.title || null,
    task.description || null,
    task.routine_type || null,
    task.prompt,
    task.script || null,
    task.provider_profile_id || null,
    task.provider || null,
    task.model || null,
    task.tool_policy || null,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.delivery_mode || null,
    task.delivery_target || null,
    task.skills_json || null,
    task.max_runtime_ms ?? null,
    task.max_active_runs ?? null,
    task.active_run_count ?? 0,
    task.last_started_at ?? null,
    task.heartbeat_policy_json || null,
    task.silent_marker || null,
    task.session_key || null,
    task.context_task_ids_json || null,
    task.next_run,
    task.status,
    task.created_at,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      | 'title'
      | 'description'
      | 'routine_type'
      | 'prompt'
      | 'script'
      | 'provider_profile_id'
      | 'provider'
      | 'model'
      | 'tool_policy'
      | 'schedule_type'
      | 'schedule_value'
      | 'context_mode'
      | 'delivery_mode'
      | 'delivery_target'
      | 'skills_json'
      | 'max_runtime_ms'
      | 'max_active_runs'
      | 'active_run_count'
      | 'last_started_at'
      | 'heartbeat_policy_json'
      | 'silent_marker'
      | 'session_key'
      | 'context_task_ids_json'
      | 'next_run'
      | 'status'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title || null);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description || null);
  }
  if (updates.routine_type !== undefined) {
    fields.push('routine_type = ?');
    values.push(updates.routine_type || null);
  }
  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.script !== undefined) {
    fields.push('script = ?');
    values.push(updates.script || null);
  }
  if (updates.provider_profile_id !== undefined) {
    fields.push('provider_profile_id = ?');
    values.push(updates.provider_profile_id || null);
  }
  if (updates.provider !== undefined) {
    fields.push('provider = ?');
    values.push(updates.provider || null);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model || null);
  }
  if (updates.tool_policy !== undefined) {
    fields.push('tool_policy = ?');
    values.push(updates.tool_policy || null);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.context_mode !== undefined) {
    fields.push('context_mode = ?');
    values.push(updates.context_mode);
  }
  if (updates.delivery_mode !== undefined) {
    fields.push('delivery_mode = ?');
    values.push(updates.delivery_mode || null);
  }
  if (updates.delivery_target !== undefined) {
    fields.push('delivery_target = ?');
    values.push(updates.delivery_target || null);
  }
  if (updates.skills_json !== undefined) {
    fields.push('skills_json = ?');
    values.push(updates.skills_json || null);
  }
  if (updates.max_runtime_ms !== undefined) {
    fields.push('max_runtime_ms = ?');
    values.push(updates.max_runtime_ms ?? null);
  }
  if (updates.max_active_runs !== undefined) {
    fields.push('max_active_runs = ?');
    values.push(updates.max_active_runs ?? null);
  }
  if (updates.active_run_count !== undefined) {
    fields.push('active_run_count = ?');
    values.push(updates.active_run_count ?? 0);
  }
  if (updates.last_started_at !== undefined) {
    fields.push('last_started_at = ?');
    values.push(updates.last_started_at || null);
  }
  if (updates.heartbeat_policy_json !== undefined) {
    fields.push('heartbeat_policy_json = ?');
    values.push(updates.heartbeat_policy_json || null);
  }
  if (updates.silent_marker !== undefined) {
    fields.push('silent_marker = ?');
    values.push(updates.silent_marker || null);
  }
  if (updates.session_key !== undefined) {
    fields.push('session_key = ?');
    values.push(updates.session_key || null);
  }
  if (updates.context_task_ids_json !== undefined) {
    fields.push('context_task_ids_json = ?');
    values.push(updates.context_task_ids_json || null);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

export function getTaskRunLogs(
  taskId: string,
  limit: number = 10,
): TaskRunLog[] {
  const safeLimit = Math.min(Math.max(limit || 10, 1), 200);
  return db
    .prepare(
      `
    SELECT task_id, run_at, duration_ms, status, result, error
    FROM task_run_logs
    WHERE task_id = ?
    ORDER BY run_at DESC
    LIMIT ?
  `,
    )
    .all(taskId, safeLimit) as TaskRunLog[];
}

export interface AuditEventRow {
  id: string;
  timestamp: string;
  actor: string;
  actor_id: string | null;
  action_type: string;
  resource: string;
  decision: string;
  context_json: string;
  correlation_id: string | null;
  duration_ms: number | null;
  error: string | null;
}

export interface AuditEventInsert {
  id: string;
  timestamp: string;
  actor: string;
  actorId?: string | null;
  actionType: string;
  resource: string;
  decision: string;
  contextJson: string;
  correlationId?: string | null;
  durationMs?: number | null;
  error?: string | null;
}

export interface AuditEventQuery {
  actor?: string;
  actorId?: string;
  actionType?: string;
  resource?: string;
  decision?: string;
  correlationId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export function insertAuditEvent(event: AuditEventInsert): void {
  db.prepare(
    `
    INSERT INTO audit_events (
      id, timestamp, actor, actor_id, action_type, resource, decision,
      context_json, correlation_id, duration_ms, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    event.id,
    event.timestamp,
    event.actor,
    event.actorId || null,
    event.actionType,
    event.resource,
    event.decision,
    event.contextJson,
    event.correlationId || null,
    event.durationMs ?? null,
    event.error || null,
  );
}

export function queryAuditEvents(query: AuditEventQuery = {}): AuditEventRow[] {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    where.push(clause);
    values.push(value);
  };
  if (query.actor) add('actor = ?', query.actor);
  if (query.actorId) add('actor_id = ?', query.actorId);
  if (query.actionType) add('action_type = ?', query.actionType);
  if (query.resource) add('resource = ?', query.resource);
  if (query.decision) add('decision = ?', query.decision);
  if (query.correlationId) add('correlation_id = ?', query.correlationId);
  if (query.from) add('timestamp >= ?', query.from);
  if (query.to) add('timestamp <= ?', query.to);
  const limit = Math.min(Math.max(query.limit || 100, 1), 1000);
  return db
    .prepare(
      `
      SELECT id, timestamp, actor, actor_id, action_type, resource, decision,
             context_json, correlation_id, duration_ms, error
      FROM audit_events
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY timestamp DESC
      LIMIT ?
    `,
    )
    .all(...values, limit) as AuditEventRow[];
}

export function queryAuditEventsByCorrelation(
  correlationId: string,
): AuditEventRow[] {
  return db
    .prepare(
      `
      SELECT id, timestamp, actor, actor_id, action_type, resource, decision,
             context_json, correlation_id, duration_ms, error
      FROM audit_events
      WHERE correlation_id = ?
      ORDER BY timestamp ASC, id ASC
    `,
    )
    .all(correlationId) as AuditEventRow[];
}

// --- Memory accessors ---

export function createMemory(record: NewMemoryRecord): MemoryRecord {
  db.prepare(
    `
    INSERT INTO memories (
      id, scope, type, content, source, confidence, visibility, status,
      created_by, created_at, updated_at, reviewed_at, expires_at,
      sensitivity, source_links_json, contradicts_memory_id, stale_after
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    record.id,
    record.scope,
    record.type,
    record.content,
    record.source ?? null,
    record.confidence,
    record.visibility,
    record.status,
    record.created_by ?? null,
    record.created_at,
    record.updated_at,
    record.reviewed_at ?? null,
    record.expires_at ?? null,
    record.sensitivity ?? 'normal',
    record.source_links_json ?? '[]',
    record.contradicts_memory_id ?? null,
    record.stale_after ?? null,
  );
  return getMemoryById(record.id)!;
}

export function getMemoryById(id: string): MemoryRecord | undefined {
  return db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as
    | MemoryRecord
    | undefined;
}

export function listMemories(filters: {
  status?: MemoryStatus;
  scope?: string;
  visibility?: string;
  limit?: number;
}): MemoryRecord[] {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters.status) {
    where.push('status = ?');
    values.push(filters.status);
  }
  if (filters.scope) {
    where.push('scope = ?');
    values.push(filters.scope);
  }
  if (filters.visibility) {
    where.push('visibility = ?');
    values.push(filters.visibility);
  }
  const limit = Math.min(Math.max(filters.limit || 50, 1), 200);
  values.push(limit);
  const sql = `
    SELECT * FROM memories
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  return db.prepare(sql).all(...values) as MemoryRecord[];
}

export function reviewMemory(
  id: string,
  status: MemoryStatus,
  reviewedAt: string,
): MemoryRecord | undefined {
  db.prepare(
    `
    UPDATE memories
    SET status = ?, reviewed_at = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(status, reviewedAt, reviewedAt, id);
  return getMemoryById(id);
}

// --- Journal accessors ---

export function createJournalEntry(
  record: NewJournalEntryRecord,
): JournalEntryRecord {
  db.prepare(
    `
    INSERT INTO journal_entries (
      id, date, scope, group_folder, summary, notable_events_json,
      source_message_ids_json, provider_profile_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    record.id,
    record.date,
    record.scope,
    record.group_folder ?? null,
    record.summary,
    record.notable_events_json || '[]',
    record.source_message_ids_json || '[]',
    record.provider_profile_id ?? null,
    record.created_at,
  );
  return db
    .prepare('SELECT * FROM journal_entries WHERE id = ?')
    .get(record.id) as JournalEntryRecord;
}

export function createJournalEvent(
  record: NewJournalEventRecord,
): JournalEventRecord {
  db.prepare(
    `
    INSERT INTO journal_events (
      id, timestamp, title, entities_json, location_context, confidence,
      source_ids_json, tags_json, group_folder, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    record.id,
    record.timestamp,
    record.title,
    record.entities_json || '[]',
    record.location_context ?? null,
    record.confidence,
    record.source_ids_json || '[]',
    record.tags_json || '[]',
    record.group_folder ?? null,
    record.created_at,
  );
  return db
    .prepare('SELECT * FROM journal_events WHERE id = ?')
    .get(record.id) as JournalEventRecord;
}

export function searchJournalEvents(input: {
  query: string;
  groupFolder?: string | null;
  limit?: number;
}): JournalEventRecord[] {
  const limit = Math.min(Math.max(input.limit || 20, 1), 100);
  const pattern = `%${input.query}%`;
  if (input.groupFolder) {
    return db
      .prepare(
        `
        SELECT * FROM journal_events
        WHERE group_folder = ?
          AND (title LIKE ? OR location_context LIKE ? OR tags_json LIKE ? OR entities_json LIKE ?)
        ORDER BY timestamp DESC
        LIMIT ?
      `,
      )
      .all(
        input.groupFolder,
        pattern,
        pattern,
        pattern,
        pattern,
        limit,
      ) as JournalEventRecord[];
  }
  return db
    .prepare(
      `
      SELECT * FROM journal_events
      WHERE title LIKE ? OR location_context LIKE ? OR tags_json LIKE ? OR entities_json LIKE ?
      ORDER BY timestamp DESC
      LIMIT ?
    `,
    )
    .all(pattern, pattern, pattern, pattern, limit) as JournalEventRecord[];
}

export function listJournalEntries(input: {
  groupFolder?: string | null;
  scope?: string | null;
  limit?: number;
}): JournalEntryRecord[] {
  const where: string[] = [];
  const values: unknown[] = [];
  if (input.groupFolder) {
    where.push('group_folder = ?');
    values.push(input.groupFolder);
  }
  if (input.scope) {
    where.push('scope = ?');
    values.push(input.scope);
  }
  const limit = Math.min(Math.max(input.limit || 30, 1), 200);
  values.push(limit);
  const sql = `
    SELECT * FROM journal_entries
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY date DESC, created_at DESC
    LIMIT ?
  `;
  return db.prepare(sql).all(...values) as JournalEntryRecord[];
}

// --- Router state accessors ---

export function getRouterState(key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM router_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
  ).run(key, value);
}

// --- Session accessors ---

export function getSession(groupFolder: string): string | undefined {
  const row = db
    .prepare('SELECT session_id FROM sessions WHERE group_folder = ?')
    .get(groupFolder) as { session_id: string } | undefined;
  return row?.session_id;
}

export function setSession(groupFolder: string, sessionId: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO sessions (group_folder, session_id) VALUES (?, ?)',
  ).run(groupFolder, sessionId);
}

export function deleteSession(groupFolder: string): void {
  db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(groupFolder);
}

export function getAllSessions(): Record<string, string> {
  const rows = db
    .prepare('SELECT group_folder, session_id FROM sessions')
    .all() as Array<{ group_folder: string; session_id: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.group_folder] = row.session_id;
  }
  return result;
}

// --- Registered group accessors ---

export function getRegisteredGroup(
  jid: string,
): (RegisteredGroup & { jid: string }) | undefined {
  const row = db
    .prepare('SELECT * FROM registered_groups WHERE jid = ?')
    .get(jid) as
    | {
        jid: string;
        name: string;
        folder: string;
        trigger_pattern: string;
        added_at: string;
        container_config: string | null;
        requires_trigger: number | null;
        is_main: number | null;
        enabled: number | null;
        is_primary: number | null;
        kind: string | null;
        title: string | null;
        project_id: string | null;
        project_slug: string | null;
      }
    | undefined;
  if (!row) return undefined;
  if (!isValidGroupFolder(row.folder)) {
    logger.warn(
      { jid: row.jid, folder: row.folder },
      'Skipping registered group with invalid folder',
    );
    return undefined;
  }
  return {
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    trigger: row.trigger_pattern,
    added_at: row.added_at,
    containerConfig: row.container_config
      ? JSON.parse(row.container_config)
      : undefined,
    requiresTrigger:
      row.requires_trigger === null ? undefined : row.requires_trigger === 1,
    isMain: row.is_main === 1 ? true : undefined,
    enabled: row.enabled === 0 ? false : undefined,
    isPrimary: row.is_primary === 1 ? true : undefined,
    kind: row.kind === 'web' ? 'web' : undefined,
    title: row.title ?? undefined,
    projectId: row.project_id ?? undefined,
    projectSlug: row.project_slug ?? undefined,
  };
}

export function setRegisteredGroup(jid: string, group: RegisteredGroup): void {
  if (!isValidGroupFolder(group.folder)) {
    throw new Error(`Invalid group folder "${group.folder}" for JID ${jid}`);
  }
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger, is_main, enabled, is_primary, kind, title, project_id, project_slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid,
    group.name,
    group.folder,
    group.trigger,
    group.added_at,
    group.containerConfig ? JSON.stringify(group.containerConfig) : null,
    group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
    group.isMain ? 1 : 0,
    group.enabled === false ? 0 : 1,
    group.isPrimary ? 1 : 0,
    group.kind ?? null,
    group.title ?? null,
    group.projectId ?? null,
    group.projectSlug ?? null,
  );
}

export function getAllRegisteredGroups(): Record<string, RegisteredGroup> {
  const rows = db.prepare('SELECT * FROM registered_groups').all() as Array<{
    jid: string;
    name: string;
    folder: string;
    trigger_pattern: string;
    added_at: string;
    container_config: string | null;
    requires_trigger: number | null;
    is_main: number | null;
    enabled: number | null;
    is_primary: number | null;
    kind: string | null;
    title: string | null;
    project_id: string | null;
    project_slug: string | null;
  }>;
  const result: Record<string, RegisteredGroup> = {};
  for (const row of rows) {
    if (!isValidGroupFolder(row.folder)) {
      logger.warn(
        { jid: row.jid, folder: row.folder },
        'Skipping registered group with invalid folder',
      );
      continue;
    }
    result[row.jid] = {
      name: row.name,
      folder: row.folder,
      trigger: row.trigger_pattern,
      added_at: row.added_at,
      containerConfig: row.container_config
        ? JSON.parse(row.container_config)
        : undefined,
      requiresTrigger:
        row.requires_trigger === null ? undefined : row.requires_trigger === 1,
      isMain: row.is_main === 1 ? true : undefined,
      enabled: row.enabled === 0 ? false : undefined,
      isPrimary: row.is_primary === 1 ? true : undefined,
      kind: row.kind === 'web' ? 'web' : undefined,
      title: row.title ?? undefined,
      projectId: row.project_id ?? undefined,
      projectSlug: row.project_slug ?? undefined,
    };
  }
  return result;
}

export function deleteRegisteredGroup(jid: string): void {
  db.prepare('DELETE FROM registered_groups WHERE jid = ?').run(jid);
}

export function deleteMessagesForJid(chatJid: string): void {
  db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(chatJid);
  db.prepare('DELETE FROM chats WHERE jid = ?').run(chatJid);
}

export function getNonWebRegisteredGroups(): Record<string, RegisteredGroup> {
  const all = getAllRegisteredGroups();
  const out: Record<string, RegisteredGroup> = {};
  for (const [jid, g] of Object.entries(all)) {
    if (g.kind !== 'web') out[jid] = g;
  }
  return out;
}

export function getWebThreads(): Record<string, RegisteredGroup> {
  const all = getAllRegisteredGroups();
  const out: Record<string, RegisteredGroup> = {};
  for (const [jid, g] of Object.entries(all)) {
    if (g.kind === 'web') out[jid] = g;
  }
  return out;
}

export function createCoworkProject(project: CoworkProject): CoworkProject {
  db.prepare(
    `INSERT INTO cowork_projects (id, name, slug, description, instructions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    project.id,
    project.name,
    project.slug,
    project.description,
    project.instructions,
    project.created_at,
    project.updated_at,
  );
  return project;
}

export function touchCoworkProject(id: string, updatedAt: string): void {
  db.prepare('UPDATE cowork_projects SET updated_at = ? WHERE id = ?').run(
    updatedAt,
    id,
  );
}

export function updateCoworkProjectContext(
  id: string,
  context: {
    description: string | null;
    instructions: string | null;
    updated_at: string;
  },
): CoworkProject | undefined {
  db.prepare(
    `UPDATE cowork_projects
     SET description = ?, instructions = ?, updated_at = ?
     WHERE id = ?`,
  ).run(context.description, context.instructions, context.updated_at, id);
  return getCoworkProject(id);
}

export function getCoworkProject(id: string): CoworkProject | undefined {
  return db.prepare('SELECT * FROM cowork_projects WHERE id = ?').get(id) as
    | CoworkProject
    | undefined;
}

export function getCoworkProjectBySlug(
  slug: string,
): CoworkProject | undefined {
  return db
    .prepare('SELECT * FROM cowork_projects WHERE slug = ?')
    .get(slug) as CoworkProject | undefined;
}

export function getCoworkProjects(): CoworkProject[] {
  return db
    .prepare(
      'SELECT * FROM cowork_projects ORDER BY updated_at DESC, created_at DESC',
    )
    .all() as CoworkProject[];
}

export function createCoworkRun(run: CoworkRun): CoworkRun {
  db.prepare(
    `INSERT INTO cowork_runs (
      id, project_id, title, prompt, status, provider, model,
      complexity_level, estimated_steps, budget_tier,
      plan_steps_json, events_json, approvals_json, outputs_json,
      summary, error, created_at, updated_at, last_activity_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    run.id,
    run.project_id,
    run.title,
    run.prompt,
    run.status,
    run.provider,
    run.model,
    run.complexity_level,
    run.estimated_steps,
    run.budget_tier,
    run.plan_steps_json,
    run.events_json,
    run.approvals_json,
    run.outputs_json,
    run.summary,
    run.error,
    run.created_at,
    run.updated_at,
    run.last_activity_at,
  );
  return run;
}

export function listCoworkRuns(projectId: string): CoworkRun[] {
  return db
    .prepare(
      `SELECT * FROM cowork_runs
       WHERE project_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .all(projectId) as CoworkRun[];
}

export function getCoworkRun(
  projectId: string,
  runId: string,
): CoworkRun | undefined {
  return db
    .prepare('SELECT * FROM cowork_runs WHERE project_id = ? AND id = ?')
    .get(projectId, runId) as CoworkRun | undefined;
}

export function updateCoworkRun(
  projectId: string,
  runId: string,
  patch: Partial<
    Pick<
      CoworkRun,
      | 'title'
      | 'prompt'
      | 'status'
      | 'provider'
      | 'model'
      | 'complexity_level'
      | 'estimated_steps'
      | 'budget_tier'
      | 'plan_steps_json'
      | 'events_json'
      | 'approvals_json'
      | 'outputs_json'
      | 'summary'
      | 'error'
      | 'updated_at'
      | 'last_activity_at'
    >
  >,
): CoworkRun | undefined {
  const existing = getCoworkRun(projectId, runId);
  if (!existing) return undefined;
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<CoworkRun>;
  const merged: CoworkRun = {
    ...existing,
    ...cleanPatch,
  };
  db.prepare(
    `UPDATE cowork_runs
     SET title = ?, prompt = ?, status = ?, provider = ?, model = ?,
         complexity_level = ?, estimated_steps = ?, budget_tier = ?,
         plan_steps_json = ?, events_json = ?, approvals_json = ?, outputs_json = ?,
         summary = ?, error = ?, updated_at = ?, last_activity_at = ?
     WHERE id = ? AND project_id = ?`,
  ).run(
    merged.title,
    merged.prompt,
    merged.status,
    merged.provider,
    merged.model,
    merged.complexity_level,
    merged.estimated_steps,
    merged.budget_tier,
    merged.plan_steps_json,
    merged.events_json,
    merged.approvals_json,
    merged.outputs_json,
    merged.summary,
    merged.error,
    merged.updated_at,
    merged.last_activity_at,
    runId,
    projectId,
  );
  return getCoworkRun(projectId, runId);
}

export function createCoworkProjectContextItem(
  item: CoworkProjectContextItem,
): CoworkProjectContextItem {
  db.prepare(
    `INSERT INTO cowork_project_context_items (
      id, project_id, kind, title, path, source, provenance, sensitivity,
      included, pinned, stale_state, content, auto_generated, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.id,
    item.project_id,
    item.kind,
    item.title,
    item.path,
    item.source,
    item.provenance,
    item.sensitivity,
    item.included,
    item.pinned,
    item.stale_state,
    item.content,
    item.auto_generated,
    item.created_at,
    item.updated_at,
  );
  return item;
}

export function listCoworkProjectContextItems(
  projectId: string,
): CoworkProjectContextItem[] {
  return db
    .prepare(
      `SELECT * FROM cowork_project_context_items
       WHERE project_id = ?
       ORDER BY pinned DESC, updated_at DESC, created_at DESC`,
    )
    .all(projectId) as CoworkProjectContextItem[];
}

export function getCoworkProjectContextItem(
  projectId: string,
  itemId: string,
): CoworkProjectContextItem | undefined {
  return db
    .prepare(
      'SELECT * FROM cowork_project_context_items WHERE project_id = ? AND id = ?',
    )
    .get(projectId, itemId) as CoworkProjectContextItem | undefined;
}

export function updateCoworkProjectContextItem(
  projectId: string,
  itemId: string,
  patch: Partial<
    Pick<
      CoworkProjectContextItem,
      | 'title'
      | 'kind'
      | 'path'
      | 'source'
      | 'provenance'
      | 'sensitivity'
      | 'included'
      | 'pinned'
      | 'stale_state'
      | 'content'
      | 'updated_at'
    >
  >,
): CoworkProjectContextItem | undefined {
  const existing = getCoworkProjectContextItem(projectId, itemId);
  if (!existing) return undefined;
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<CoworkProjectContextItem>;
  const merged: CoworkProjectContextItem = {
    ...existing,
    ...cleanPatch,
  };
  db.prepare(
    `UPDATE cowork_project_context_items
     SET title = ?, kind = ?, path = ?, source = ?, provenance = ?, sensitivity = ?,
         included = ?, pinned = ?, stale_state = ?, content = ?, updated_at = ?
     WHERE project_id = ? AND id = ?`,
  ).run(
    merged.title,
    merged.kind,
    merged.path,
    merged.source,
    merged.provenance,
    merged.sensitivity,
    merged.included,
    merged.pinned,
    merged.stale_state,
    merged.content,
    merged.updated_at,
    projectId,
    itemId,
  );
  return getCoworkProjectContextItem(projectId, itemId);
}

export function deleteCoworkProjectContextItem(
  projectId: string,
  itemId: string,
): void {
  db.prepare(
    'DELETE FROM cowork_project_context_items WHERE project_id = ? AND id = ?',
  ).run(projectId, itemId);
}

// --- JSON migration ---

function migrateJsonState(): void {
  const migrateFile = (filename: string) => {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      fs.renameSync(filePath, `${filePath}.migrated`);
      return data;
    } catch {
      return null;
    }
  };

  // Migrate router_state.json
  const routerState = migrateFile('router_state.json') as {
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
  } | null;
  if (routerState) {
    if (routerState.last_timestamp) {
      setRouterState('last_timestamp', routerState.last_timestamp);
    }
    if (routerState.last_agent_timestamp) {
      setRouterState(
        'last_agent_timestamp',
        JSON.stringify(routerState.last_agent_timestamp),
      );
    }
  }

  // Migrate sessions.json
  const sessions = migrateFile('sessions.json') as Record<
    string,
    string
  > | null;
  if (sessions) {
    for (const [folder, sessionId] of Object.entries(sessions)) {
      setSession(folder, sessionId);
    }
  }

  // Migrate registered_groups.json
  const groups = migrateFile('registered_groups.json') as Record<
    string,
    RegisteredGroup
  > | null;
  if (groups) {
    for (const [jid, group] of Object.entries(groups)) {
      try {
        setRegisteredGroup(jid, group);
      } catch (err) {
        logger.warn(
          { jid, folder: group.folder, err },
          'Skipping migrated registered group with invalid folder',
        );
      }
    }
  }
}
