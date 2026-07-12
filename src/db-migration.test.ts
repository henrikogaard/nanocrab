import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

describe('database migrations', () => {
  it('adds agent runtime profile columns to an existing database', async () => {
    const repoRoot = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocrab-db-test-'));

    try {
      process.chdir(tempDir);
      fs.mkdirSync(path.join(tempDir, 'store'), { recursive: true });
      const dbPath = path.join(tempDir, 'store', 'messages.db');
      const legacyDb = new Database(dbPath);
      legacyDb.exec(`
        CREATE TABLE agent_profiles (
          id TEXT PRIMARY KEY,
          handle TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          avatar TEXT,
          description TEXT,
          personality TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          provider_profile_id TEXT,
          provider TEXT,
          model TEXT,
          tool_policy TEXT NOT NULL,
          allowed_mcp_servers_json TEXT,
          skills_json TEXT NOT NULL,
          memory_scopes_json TEXT NOT NULL,
          task_kinds_json TEXT NOT NULL,
          channel_bindings_json TEXT NOT NULL,
          write_policy_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO agent_profiles (
          id, handle, display_name, tool_policy, skills_json,
          memory_scopes_json, task_kinds_json, channel_bindings_json,
          write_policy_json, created_at, updated_at
        ) VALUES (
          'agent_legacy', 'legacy', 'Legacy', 'approval-required', '[]',
          '[]', '["chat"]', '{}', '{}', '2026-01-01', '2026-01-01'
        );
      `);
      legacyDb.close();

      vi.resetModules();
      const { initDatabase, getAgentProfileRow, _closeDatabase } =
        await import('./db.js');
      initDatabase();

      expect(getAgentProfileRow('agent_legacy')).toMatchObject({
        instructions: null,
        primaryRuntime: null,
        fallbackRuntimes: [],
        stageRoles: [],
        repositoryScopes: [],
        maxConcurrency: 1,
      });
      _closeDatabase();
    } finally {
      process.chdir(repoRoot);
    }
  });

  it('defaults Telegram backfill chats to direct messages', async () => {
    const repoRoot = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocrab-db-test-'));

    try {
      process.chdir(tempDir);
      fs.mkdirSync(path.join(tempDir, 'store'), { recursive: true });

      const dbPath = path.join(tempDir, 'store', 'messages.db');
      const legacyDb = new Database(dbPath);
      legacyDb.exec(`
        CREATE TABLE chats (
          jid TEXT PRIMARY KEY,
          name TEXT,
          last_message_time TEXT
        );
      `);
      legacyDb
        .prepare(
          `INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)`,
        )
        .run('tg:12345', 'Telegram DM', '2024-01-01T00:00:00.000Z');
      legacyDb
        .prepare(
          `INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)`,
        )
        .run('tg:-10012345', 'Telegram Group', '2024-01-01T00:00:01.000Z');
      legacyDb
        .prepare(
          `INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)`,
        )
        .run('room@g.us', 'WhatsApp Group', '2024-01-01T00:00:02.000Z');
      legacyDb.close();

      vi.resetModules();
      const { initDatabase, getAllChats, _closeDatabase } =
        await import('./db.js');

      initDatabase();

      const chats = getAllChats();
      expect(chats.find((chat) => chat.jid === 'tg:12345')).toMatchObject({
        channel: 'telegram',
        is_group: 0,
      });
      expect(chats.find((chat) => chat.jid === 'tg:-10012345')).toMatchObject({
        channel: 'telegram',
        is_group: 0,
      });
      expect(chats.find((chat) => chat.jid === 'room@g.us')).toMatchObject({
        channel: 'whatsapp',
        is_group: 1,
      });

      _closeDatabase();
    } finally {
      process.chdir(repoRoot);
    }
  });
});
