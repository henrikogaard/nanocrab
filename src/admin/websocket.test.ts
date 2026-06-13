import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DIR = vi.hoisted(() => {
  const os = require('os');
  const p = require('path');
  return p.join(os.tmpdir(), `nanocrab-term-test-${Date.now()}`);
});

vi.mock('../config.js', () => ({
  SESSIONS_DIR: TEST_DIR,
  TERMINAL_IDLE_TIMEOUT_MS: 7200000,
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
  },
}));

import {
  createSessionFile,
  appendToSessionLog,
  readSessionLog,
  finalizeSessionFile,
  loadHistoricalSessions,
  listTerminalSessions,
  listCockpitStreamEvents,
  broadcastTaskProgress,
  broadcastToolCall,
  broadcastToolResult,
  broadcastCockpitSessionUpdate,
} from './websocket.js';

describe('file-backed terminal sessions', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('createSessionFile creates index entry', () => {
    createSessionFile('term-test-1', 'alice');
    const index: Array<{ id: string; endedAt: string | null; owner: string }> =
      JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'index.json'), 'utf-8'));
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe('term-test-1');
    expect(index[0].owner).toBe('alice');
    expect(index[0].endedAt).toBeNull();
  });

  it('rejects unsafe terminal session ids before writing files', () => {
    expect(createSessionFile('../outside', 'alice')).toBe(false);
    appendToSessionLog('../outside', 'nope');

    expect(fs.existsSync(path.join(TEST_DIR, 'index.json'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, '..', 'outside.log'))).toBe(false);
  });

  it('appendToSessionLog writes data to file', () => {
    appendToSessionLog('term-test-2', 'hello world\n');
    const content = readSessionLog('term-test-2');
    expect(content).toContain('hello world');
  });

  it('finalizeSessionFile sets endedAt and bytes', () => {
    createSessionFile('term-finalize');
    appendToSessionLog('term-finalize', 'some data');
    finalizeSessionFile('term-finalize');
    const index: Array<{ id: string; endedAt: string | null; bytes: number }> =
      JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'index.json'), 'utf-8'));
    const entry = index.find((e) => e.id === 'term-finalize')!;
    expect(entry.endedAt).toBeTruthy();
    expect(entry.bytes).toBeGreaterThan(0);
  });

  it('loadHistoricalSessions loads from .log files', () => {
    createSessionFile('term-hist-1', 'alice');
    createSessionFile('term-hist-2', 'bob');
    fs.writeFileSync(path.join(TEST_DIR, 'term-hist-1.log'), 'output1\n');
    fs.writeFileSync(path.join(TEST_DIR, 'term-hist-2.log'), 'output2\n');
    const count = loadHistoricalSessions();
    expect(count).toBe(2);
    expect(listTerminalSessions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'term-hist-1', owner: 'alice' }),
        expect.objectContaining({ id: 'term-hist-2', owner: 'bob' }),
      ]),
    );
  });

  it('readSessionLog returns empty string for missing session', () => {
    const content = readSessionLog('nonexistent');
    expect(content).toBe('');
  });

  it('handles multiple appends to same session', () => {
    appendToSessionLog('term-multi', 'line1\n');
    appendToSessionLog('term-multi', 'line2\n');
    appendToSessionLog('term-multi', 'line3\n');
    const content = readSessionLog('term-multi');
    expect(content).toBe('line1\nline2\nline3\n');
  });

  it('allows cockpit session updates before websocket server starts', () => {
    expect(() =>
      broadcastCockpitSessionUpdate({
        id: 'run-1',
        group: 'main',
        status: 'running',
        updatedAt: '2026-06-01T12:00:00Z',
        lastEventAt: '2026-06-01T12:00:00Z',
        currentStep: 'Running focused tests',
      }),
    ).not.toThrow();
  });

  it('records recent tool and progress events for cockpit streams', () => {
    broadcastToolCall({
      id: 'tc-stream-1',
      name: 'read_file',
      input: '{"path":"README.md"}',
      groupJid: 'main',
      timestamp: '2026-06-01T12:00:00Z',
    });
    broadcastToolResult({
      id: 'tc-stream-1',
      output: 'ok',
      duration: '0.2',
      groupJid: 'main',
    });
    broadcastTaskProgress({
      phase: 'testing',
      pct: 60,
      message: 'Running focused tests',
      groupJid: 'main',
    });

    expect(listCockpitStreamEvents({ group: 'main' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tc-stream-1',
          type: 'tool_call',
          status: 'running',
        }),
        expect.objectContaining({
          id: 'tc-stream-1',
          type: 'tool_result',
          status: 'completed',
        }),
        expect.objectContaining({
          type: 'progress',
          phase: 'testing',
          pct: 60,
        }),
      ]),
    );
  });
});
