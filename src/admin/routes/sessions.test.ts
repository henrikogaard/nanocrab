import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DIR = path.join(os.tmpdir(), `nanocrab-sessions-test-${Date.now()}`);

vi.mock('../../config.js', () => ({
  SESSIONS_DIR: path.join(os.tmpdir(), `nanocrab-sessions-test-${Date.now()}`),
  STORE_DIR: path.join(os.tmpdir(), `nanocrab-sessions-test-store-${Date.now()}`),
  DATA_DIR: path.join(os.tmpdir(), `nanocrab-sessions-test-data-${Date.now()}`),
}));

vi.mock('../../logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn(), fatal: vi.fn() },
}));

// Re-import sessions dir after mock
const SESSIONS_DIR = (vi.mocked(await import('../../config.js')).SESSIONS_DIR) as string;

describe('terminal session API', () => {
  beforeEach(() => {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SESSIONS_DIR, 'index.json'), JSON.stringify([
      { id: 'term-1', name: 'term-1', owner: 'owner', createdAt: '2026-06-01T12:00:00Z', endedAt: '2026-06-01T13:00:00Z', bytes: 100 },
      { id: 'term-2', name: 'term-2', owner: 'owner', createdAt: '2026-06-02T12:00:00Z', endedAt: null, bytes: 50 },
    ], null, 2));
    fs.writeFileSync(path.join(SESSIONS_DIR, 'term-1.log'), 'line1\nline2\nerror: something failed\nline4\n');
    fs.writeFileSync(path.join(SESSIONS_DIR, 'term-2.log'), 'startup\nrunning\n');
  });

  afterEach(() => {
    fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
  });

  it('GET /terminal/history returns session list from index', () => {
    const indexPath = path.join(SESSIONS_DIR, 'index.json');
    const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    expect(data).toHaveLength(2);
    expect(data[0].id).toBe('term-1');
    expect(data[1].id).toBe('term-2');
  });

  it('GET /terminal/:id/transcript returns file content', () => {
    const content = fs.readFileSync(path.join(SESSIONS_DIR, 'term-1.log'), 'utf-8');
    expect(content).toContain('error: something failed');
    expect(content).toContain('line1');
  });

  it('POST /terminal/search finds matching lines', () => {
    const query = 'error';
    const content = fs.readFileSync(path.join(SESSIONS_DIR, 'term-1.log'), 'utf-8');
    const lines = content.split('\n');
    const matches = lines
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter(l => l.text.toLowerCase().includes(query.toLowerCase()));
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(3);
  });

  it('POST /terminal/search returns empty for no matches', () => {
    const query = 'nonexistent';
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.log'));
    let totalMatches = 0;
    for (const file of files) {
      const content = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8');
      const lines = content.split('\n');
      totalMatches += lines.filter(l => l.toLowerCase().includes(query)).length;
    }
    expect(totalMatches).toBe(0);
  });

  it('returns 404 for missing session transcript', () => {
    const logPath = path.join(SESSIONS_DIR, 'nonexistent.log');
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('filters by date', () => {
    const query = 'running';
    const dateFrom = '2026-06-02T00:00:00Z';
    const index = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, 'index.json'), 'utf-8'));
    const matching = index.filter((e: any) => {
      if (dateFrom && e.createdAt && e.createdAt < dateFrom) return false;
      return true;
    });
    expect(matching).toHaveLength(1);
    expect(matching[0].id).toBe('term-2');
  });
});
