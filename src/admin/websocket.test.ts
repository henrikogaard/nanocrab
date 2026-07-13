import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import _os from 'os';
import { WebSocket } from 'ws';

type WatchFileListener = (curr: fs.Stats, prev: fs.Stats) => void;

const TEST_DIR = vi.hoisted(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  () => require('os').tmpdir() + `/nanocrab-term-test-${Date.now()}`,
);

vi.mock('../config.js', () => ({
  SESSIONS_DIR: TEST_DIR,
  TERMINAL_IDLE_TIMEOUT_MS: 7200000,
  MAX_SESSION_LOG_BYTES: 1024,
  MAX_SESSION_RETENTION_DAYS: 90,
  MAX_SESSIONS_COUNT: 100,
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
  pruneOldSessions,
  startLogStream,
  stopLogStream,
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
    vi.restoreAllMocks();
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

  it('does not reuse an ended historical session id', () => {
    createSessionFile('term-ended', 'alice');
    appendToSessionLog('term-ended', 'historical output');
    finalizeSessionFile('term-ended');
    const before = fs.readFileSync(path.join(TEST_DIR, 'index.json'), 'utf-8');

    expect(createSessionFile('term-ended', 'alice')).toBe(false);
    expect(fs.readFileSync(path.join(TEST_DIR, 'index.json'), 'utf-8')).toBe(
      before,
    );
    expect(readSessionLog('term-ended')).toBe('historical output');
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

  it('unsubscribes log streams using the watched file path and listener', () => {
    const logsDir = path.join(TEST_DIR, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, 'nanocrab.log'), 'line one\n');

    let watchedPath: string | undefined;
    let watchedListener: WatchFileListener | undefined;
    vi.spyOn(process, 'cwd').mockReturnValue(TEST_DIR);
    vi.spyOn(fs, 'watchFile').mockImplementation(
      (
        filename: fs.PathLike,
        optionsOrListener:
          | WatchFileListener
          | { interval?: number; persistent?: boolean },
        listener?: WatchFileListener,
      ) => {
        watchedPath = filename.toString();
        watchedListener =
          typeof optionsOrListener === 'function'
            ? optionsOrListener
            : listener;
        return {} as fs.StatWatcher;
      },
    );
    const unwatchSpy = vi.spyOn(fs, 'unwatchFile').mockImplementation(() => {});
    const ws = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    } as unknown as WebSocket;

    startLogStream(ws, 'system');
    stopLogStream(ws);

    expect(watchedPath).toBe(path.join(logsDir, 'nanocrab.log'));
    expect(watchedListener).toBeDefined();
    expect(unwatchSpy).toHaveBeenCalledWith(watchedPath, watchedListener);
    expect(() => stopLogStream(ws)).not.toThrow();
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

  it('pruneOldSessions removes entries older than retention period', () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - 5);
    createSessionFile('fresh-session', 'alice');
    createSessionFile('stale-session', 'bob');
    // Manually backdate the stale entry
    const indexPath = path.join(TEST_DIR, 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const staleEntry = index.find(
      (e: { id: string }) => e.id === 'stale-session',
    );
    staleEntry.endedAt = oldDate.toISOString();
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    // Prime a .log file for the stale session so pruneOldSessions deletes it
    fs.writeFileSync(path.join(TEST_DIR, 'stale-session.log'), 'old data');
    loadHistoricalSessions();

    const pruned = pruneOldSessions();
    expect(pruned).toBe(1);
    const remaining = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    expect(remaining.map((e: { id: string }) => e.id)).toEqual([
      'fresh-session',
    ]);
    // Orphan .log file should be removed
    expect(fs.existsSync(path.join(TEST_DIR, 'stale-session.log'))).toBe(false);
    expect(listTerminalSessions().map((session) => session.id)).not.toContain(
      'stale-session',
    );
  });

  it('appendToSessionLog respects MAX_SESSION_LOG_BYTES', () => {
    // Fill the log past the limit
    const bigData = 'x'.repeat(1024);
    appendToSessionLog('term-bounded', bigData);
    appendToSessionLog('term-bounded', 'SHOULD_NOT_APPEAR');
    const content = readSessionLog('term-bounded');
    expect(content).not.toContain('SHOULD_NOT_APPEAR');
    expect(content).toContain('x');
    expect(content.length).toBeLessThanOrEqual(1024);
  });

  it('appendToSessionLog truncates data that exceeds max size', () => {
    const data = 'y'.repeat(800);
    const extra = 'z'.repeat(800);
    appendToSessionLog('term-truncated', data);
    appendToSessionLog('term-truncated', extra);
    const bytes = fs.statSync(path.join(TEST_DIR, 'term-truncated.log')).size;
    const content = readSessionLog('term-truncated');
    // Cap is 1024: 800 y's + exactly 224 z's, never more.
    expect(bytes).toBe(1024);
    expect(content).toBe('y'.repeat(800) + 'z'.repeat(224));
  });

  it('appendToSessionLog truncates on a UTF-8 codepoint boundary', () => {
    // 1021 ASCII bytes leaves only 3 bytes before the 1024-byte cap; a 4-byte
    // emoji cannot fit and must be dropped whole rather than split.
    appendToSessionLog('term-utf8', 'a'.repeat(1021));
    appendToSessionLog('term-utf8', '\u{1F600}');
    const buf = fs.readFileSync(path.join(TEST_DIR, 'term-utf8.log'));
    expect(buf.length).toBe(1021);
    expect(buf.toString('utf-8')).toBe('a'.repeat(1021));
    // The written bytes must be valid UTF-8 (no dangling continuation bytes).
    expect(Buffer.byteLength(buf.toString('utf-8'), 'utf-8')).toBe(1021);
  });

  it('pruneOldSessions caps total count at MAX_SESSIONS_COUNT', () => {
    // Create more than max entries
    for (let i = 0; i < 103; i++) {
      createSessionFile(`overflow-${i}`, `user-${i}`);
    }
    const prune = pruneOldSessions();
    expect(prune).toBeGreaterThanOrEqual(3);
    const indexed = JSON.parse(
      fs.readFileSync(path.join(TEST_DIR, 'index.json'), 'utf-8'),
    );
    expect(indexed.length).toBeLessThanOrEqual(100);
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
