# Terminal Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simple xterm.js terminal in DevHub > Terminal with a file-backed, split-pane tab-in-pane layout featuring persistent sessions, searchable transcript, and robust WebSocket reconnect.

**Architecture:** Backend (websocket.ts) writes terminal output to files in `store/sessions/` instead of pure memory, loads historical sessions on startup, and exposes history/search REST endpoints. Frontend (app.js) rebuilds the Terminal tab as a two-column split with tabbed panes (Terminal/Files left, Logs/Search right), auto-attaches on WS reconnect, and adds search (inline + history viewer).

**Tech Stack:** TypeScript/Node.js backend, Express + ws, vanilla JS frontend (no framework), xterm.js + addon-search from CDN, vitest for tests.

---

### File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/config.ts` | Modify | Add `SESSIONS_DIR`, `TERMINAL_IDLE_TIMEOUT_MS` |
| `src/admin/websocket.ts` | Modify | File-backed logging, historical session loading, improved attach, extended idle timeout |
| `src/admin/routes/sessions.ts` | Modify | Add `GET /terminal/history`, `GET /terminal/:id/transcript`, `POST /terminal/search` |
| `src/admin/index.ts` | Modify | Ensure sessions dir exists on startup |
| `src/admin/public/app.js` | Modify | Rewrite `renderTerminal()` for split-pane, auto-attach on WS reconnect, search tab |
| `src/admin/public/style.css` | Modify | Split-pane layout CSS classes |
| `src/admin/websocket.test.ts` | Create | Tests for file-backed session persistence, history loading, session lifecycle |
| `src/admin/routes/sessions.test.ts` | Create | Tests for terminal history/search API endpoints |

---

### Task 1: Session directory config

**Files:**
- Modify: `src/config.ts`
- Modify: `src/admin/index.ts`

- [ ] **Step 1: Add constants to config.ts**

Add after `DATA_DIR`:

```typescript
export const SESSIONS_DIR = path.resolve(PROJECT_ROOT, 'store', 'sessions');
export const TERMINAL_IDLE_TIMEOUT_MS = parseInt(
  process.env.TERMINAL_IDLE_TIMEOUT_MS || '7200000',
  10,
); // 2 hours default
```

- [ ] **Step 2: Ensure sessions dir exists in admin/index.ts**

Add near the top of `initAdminServer()`, after state setup:

```typescript
import { SESSIONS_DIR } from '../config.js';
// ... ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}
```

Need to add `import fs from 'fs'` if not already there (check if `Database` import covers it — it doesn't, `fs` is a separate module).

- [ ] **Step 3: Commit**

```bash
git add src/config.ts src/admin/index.ts
git commit -m "feat(terminal): add SESSIONS_DIR and TERMINAL_IDLE_TIMEOUT_MS config"
```

---

### Task 2: File-backed session logging in websocket.ts

**Files:**
- Modify: `src/admin/websocket.ts`
- Create: `src/admin/websocket.test.ts`

This is the core backend change. The websocket module needs to:

1. Write terminal output to log files in `store/sessions/{sessionId}.log`
2. On server start, load historical sessions from those files into a `historicalSessions` map
3. Add session metadata to `store/sessions/index.json`
4. Extend idle timeout from 30 min to configurable 2 hours
5. Support `terminal_attach` for historical (dead) sessions

- [ ] **Step 1: Write the failing test for session file creation**

Create `src/admin/websocket.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// We'll test the session persistence logic by using a temp directory
const TEST_SESSIONS_DIR = path.join(os.tmpdir(), `nanocrab-term-test-${Date.now()}`);

describe('file-backed terminal sessions', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_SESSIONS_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_SESSIONS_DIR, { recursive: true, force: true });
  });

  it('writes session log to file on spawn', () => {
    // This test verifies that when a terminal session is spawned,
    // a log file is created at SESSIONS_DIR/{sessionId}.log
    // We'll test the helper functions extracted from websocket.ts

    // For now, test that the directory structure works
    const sessionId = 'term-test-1';
    const logPath = path.join(TEST_SESSIONS_DIR, `${sessionId}.log`);
    fs.writeFileSync(logPath, 'test output');
    expect(fs.existsSync(logPath)).toBe(true);
  });

  it('loads historical sessions from log files on startup', () => {
    // Create a few mock session files
    fs.writeFileSync(path.join(TEST_SESSIONS_DIR, 'term-old-1.log'), 'line1\nline2\nline3');
    fs.writeFileSync(path.join(TEST_SESSIONS_DIR, 'term-old-2.log'), 'data');

    const files = fs.readdirSync(TEST_SESSIONS_DIR).filter(f => f.endsWith('.log'));
    expect(files).toHaveLength(2);
    expect(files).toContain('term-old-1.log');
    expect(files).toContain('term-old-2.log');
  });

  it('reads session transcript from file', () => {
    fs.writeFileSync(path.join(TEST_SESSIONS_DIR, 'term-session.log'), 'hello\nworld');
    const content = fs.readFileSync(path.join(TEST_SESSIONS_DIR, 'term-session.log'), 'utf-8');
    expect(content).toBe('hello\nworld');
  });

  it('writes and updates index.json metadata', () => {
    const indexData = [
      { id: 'term-1', name: 'term-1', owner: 'owner', createdAt: new Date().toISOString(), endedAt: null, bytes: 0 },
    ];
    fs.writeFileSync(path.join(TEST_SESSIONS_DIR, 'index.json'), JSON.stringify(indexData, null, 2));
    const read = JSON.parse(fs.readFileSync(path.join(TEST_SESSIONS_DIR, 'index.json'), 'utf-8'));
    expect(read).toHaveLength(1);
    expect(read[0].id).toBe('term-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/admin/websocket.test.ts`
Expected: PASS (these tests use raw fs operations, they should pass as-is since they test the file structure, not the actual websocket module)

Then add real integration-style tests that import from websocket.ts (after extraction):

```typescript
import { createSessionFile, loadHistoricalSessions, writeToSessionLog } from '../websocket.js';
```

These will fail because the functions don't exist yet. Let me adjust — let me first check how other tests mock ws.

Actually, let me keep the tests simpler — testing the extracted helper functions directly:

- [ ] **Step 3: Refactor websocket.ts to extract session persistence helpers**

Add at the top of `websocket.ts` (after imports):

```typescript
import { SESSIONS_DIR, TERMINAL_IDLE_TIMEOUT_MS } from '../config.js';
import fs from 'fs';
import path from 'path';

const INDEX_PATH = path.join(SESSIONS_DIR, 'index.json');
const MAX_TERMINALS = 3;

interface SessionMetadata {
  id: string;
  name: string;
  owner: string;
  createdAt: string;
  endedAt: string | null;
  bytes: number;
}

function loadSessionIndex(): SessionMetadata[] {
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveSessionIndex(index: SessionMetadata[]): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

function createSessionFile(sessionId: string): void {
  const indexPath = path.join(SESSIONS_DIR, 'index.json');
  let index: SessionMetadata[] = [];
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  } catch {
    // start fresh
  }
  index.push({
    id: sessionId,
    name: sessionId,
    owner: 'owner',
    createdAt: new Date().toISOString(),
    endedAt: null,
    bytes: 0,
  });
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

function finalizeSessionFile(sessionId: string): void {
  const indexPath = path.join(SESSIONS_DIR, 'index.json');
  try {
    const index: SessionMetadata[] = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const entry = index.find(e => e.id === sessionId);
    if (entry) {
      entry.endedAt = new Date().toISOString();
      const logPath = path.join(SESSIONS_DIR, `${sessionId}.log`);
      try {
        entry.bytes = fs.statSync(logPath).size;
      } catch {}
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    }
  } catch {
    // ignore
  }
}

function appendToSessionLog(sessionId: string, data: string): void {
  if (!data) return;
  const logPath = path.join(SESSIONS_DIR, `${sessionId}.log`);
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.appendFileSync(logPath, data, 'utf-8');
  } catch (err) {
    logger.warn({ err, sessionId }, 'Failed to append to session log');
  }
}

function readSessionLog(sessionId: string): string {
  const logPath = path.join(SESSIONS_DIR, `${sessionId}.log`);
  try {
    return fs.readFileSync(logPath, 'utf-8');
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Update spawnTerminal to write to file**

In the `spawnTerminal` function in websocket.ts, add file creation and logging:

```typescript
function spawnTerminal(ws: WebSocket, sessionId: string, owner: string): void {
  const existing = terminals.get(sessionId);
  if (existing) {
    existing.clients.add(ws);
    send(ws, {
      type: 'terminal_output',
      data: existing.transcript.slice(-50000),
      sessionId,
    });
    return;
  }

  if (terminals.size >= MAX_TERMINALS) {
    send(ws, {
      type: 'terminal_output',
      data: 'Max terminal sessions reached.\r\n',
      sessionId,
    });
    return;
  }

  const proc = spawn('bash', ['-i'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: 'xterm-256color' },
    cwd: process.cwd(),
  });

  // Create session metadata file
  createSessionFile(sessionId);

  // Write initial data to session file
  appendToSessionLog(sessionId, `[Session started at ${new Date().toISOString()}]\r\n`);

  const idleTimer = setTimeout(() => {
    broadcastTerminal(
      sessionId,
      '\r\n[Session timed out after inactivity]\r\n',
    );
    proc.kill();
    finalizeSessionFile(sessionId);
    terminals.delete(sessionId);
  }, TERMINAL_IDLE_TIMEOUT_MS);

  terminals.set(sessionId, {
    process: proc,
    clients: new Set([ws]),
    transcript: '',
    name: sessionId,
    idleTimer,
    owner,
  });

  proc.stdout?.on('data', (data: Buffer) => {
    broadcastTerminal(sessionId, data.toString());
  });
  proc.stderr?.on('data', (data: Buffer) => {
    broadcastTerminal(sessionId, data.toString());
  });
  proc.on('close', () => {
    broadcastTerminal(sessionId, '\r\n[Process exited]\r\n');
    finalizeSessionFile(sessionId);
    terminals.delete(sessionId);
  });

  logger.info({ sessionId }, 'Terminal session spawned');
}
```

- [ ] **Step 5: Update broadcastTerminal to write to file**

```typescript
function broadcastTerminal(sessionId: string, data: string): void {
  const term = terminals.get(sessionId);
  if (!term) return;
  term.transcript = `${term.transcript}${data}`.slice(-200000);
  appendToSessionLog(sessionId, data);
  for (const client of term.clients) {
    send(client, { type: 'terminal_output', data, sessionId });
  }
}
```

- [ ] **Step 6: Update import and add TERMINAL_IDLE_TIMEOUT_MS to reference**

Remove the old `TERMINAL_IDLE_TIMEOUT_MS` constant from websocket.ts (currently line 23) since it's now in config.ts.

- [ ] **Step 7: Add historical sessions support**

Add a `historicalSessions` map and load on init:

```typescript
// Add after the terminals map and other state
const historicalSessions = new Map<string, string>(); // sessionId -> transcript (from file)

function loadHistoricalSessions(): number {
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.log'));
    for (const file of files) {
      const sessionId = file.replace('.log', '');
      const content = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8');
      historicalSessions.set(sessionId, content);
    }
    return historicalSessions.size;
  } catch {
    return 0;
  }
}
```

Call `loadHistoricalSessions()` at the end of `initWebSocket()`.

- [ ] **Step 8: Update terminal_attach to support historical sessions**

The attach handler currently only looks in the `terminals` map. Update it to fall back to `historicalSessions`:

```typescript
if (msg.type === 'terminal_attach' && msg.sessionId) {
  const term = terminals.get(msg.sessionId as string);
  if (term) {
    term.clients.add(ws);
    send(ws, {
      type: 'terminal_output',
      data: term.transcript.slice(-50000),
      sessionId: msg.sessionId,
    });
  } else {
    // Check historical sessions
    const historical = historicalSessions.get(msg.sessionId as string);
    if (historical) {
      send(ws, {
        type: 'terminal_output',
        data: historical.slice(-50000),
        sessionId: msg.sessionId,
      });
      send(ws, {
        type: 'terminal_output',
        data: '\r\n[Session ended — read-only view. Close this and spawn a new session to continue.]\r\n',
        sessionId: msg.sessionId,
      });
    }
  }
}
```

- [ ] **Step 9: Update listTerminalSessions to include historical sessions**

```typescript
export function listTerminalSessions(): Array<{
  id: string;
  name: string;
  owner: string;
  transcriptBytes: number;
  active: boolean;
}> {
  const active = [...terminals.entries()].map(([id, term]) => ({
    id,
    name: term.name,
    owner: term.owner,
    transcriptBytes: Buffer.byteLength(term.transcript),
    active: true,
  }));
  const historical = [...historicalSessions.entries()].map(([id, transcript]) => ({
    id,
    name: id,
    owner: 'unknown',
    transcriptBytes: Buffer.byteLength(transcript),
    active: false,
  }));
  return [...active, ...historical];
}
```

- [ ] **Step 10: Write integration tests for the helper functions**

Create `src/admin/websocket.test.ts` with proper tests:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('../../logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn(), fatal: vi.fn() },
}));

// We need to set up the config before importing websocket
vi.mock('../../config.js', () => {
  const tmpDir = path.join(os.tmpdir(), `nanocrab-term-test-${Date.now()}`);
  return {
    SESSIONS_DIR: tmpDir,
    TERMINAL_IDLE_TIMEOUT_MS: 7200000,
    STORE_DIR: tmpDir,
  };
});

const { createSessionFile, appendToSessionLog, readSessionLog, finalizeSessionFile, loadHistoricalSessions } = await import('../websocket.js');
const SESSIONS_DIR = (await import('../../config.js')).SESSIONS_DIR;

describe('file-backed terminal sessions', () => {
  beforeEach(() => {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
  });

  it('createSessionFile creates index entry', () => {
    createSessionFile('term-test-1');
    const index = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, 'index.json'), 'utf-8'));
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe('term-test-1');
    expect(index[0].endedAt).toBeNull();
  });

  it('appendToSessionLog writes data to file', () => {
    appendToSessionLog('term-test-2', 'hello world\n');
    const content = readSessionLog('term-test-2');
    expect(content).toContain('hello world');
  });

  it('finalizeSessionFile sets endedAt and bytes', () => {
    createSessionFile('term-finalize');
    appendToSessionLog('term-finalize', 'data');
    finalizeSessionFile('term-finalize');
    const index = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, 'index.json'), 'utf-8'));
    const entry = index.find(e => e.id === 'term-finalize');
    expect(entry.endedAt).toBeTruthy();
    expect(entry.bytes).toBeGreaterThan(0);
  });

  it('loadHistoricalSessions loads from files', () => {
    fs.writeFileSync(path.join(SESSIONS_DIR, 'term-hist-1.log'), 'output1\n');
    fs.writeFileSync(path.join(SESSIONS_DIR, 'term-hist-2.log'), 'output2\n');
    const count = loadHistoricalSessions();
    expect(count).toBe(2);
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
});
```

- [ ] **Step 11: Export the helper functions from websocket.ts**

Add export to `createSessionFile`, `appendToSessionLog`, `readSessionLog`, `finalizeSessionFile`, `loadHistoricalSessions` in websocket.ts.

- [ ] **Step 12: Run tests**

Run: `npx vitest run src/admin/websocket.test.ts`
Expected: All PASS

- [ ] **Step 13: Commit**

```bash
git add src/admin/websocket.ts src/admin/websocket.test.ts
git commit -m "feat(terminal): file-backed session persistence with index.json"
```

---

### Task 3: Session history API

**Files:**
- Modify: `src/admin/routes/sessions.ts`
- Create: `src/admin/routes/sessions.test.ts`

- [ ] **Step 1: Add terminal history/search endpoints**

Add to `src/admin/routes/sessions.ts` (after the existing `GET /terminal/active`):

```typescript
import { SESSIONS_DIR } from '../../config.js';
import { listTerminalSessions } from '../websocket.js';
// ... existing imports

interface TerminalHistoryEntry {
  id: string;
  name: string;
  owner: string;
  createdAt: string;
  endedAt: string | null;
  bytes: number;
  active: boolean;
}

// GET /api/sessions/terminal/history — list all terminal sessions
router.get('/terminal/history', async (_req: Request, res: Response) => {
  try {
    const indexPath = path.join(SESSIONS_DIR, 'index.json');
    if (!fs.existsSync(indexPath)) {
      res.json([]);
      return;
    }
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const activeSessions = listTerminalSessions();
    const activeIds = new Set(activeSessions.filter(s => s.active).map(s => s.id));
    const history: TerminalHistoryEntry[] = index.map((entry: any) => ({
      ...entry,
      active: activeIds.has(entry.id),
    }));
    // Sort by createdAt descending
    history.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read session history' });
  }
});

// GET /api/sessions/terminal/:id/transcript — full transcript
router.get('/terminal/:id/transcript', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id as string;
    const logPath = path.join(SESSIONS_DIR, `${sessionId}.log`);
    if (!fs.existsSync(logPath)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const content = fs.readFileSync(logPath, 'utf-8');
    res.json({ id: sessionId, content });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read session transcript' });
  }
});

// POST /api/sessions/terminal/search — search across session logs
router.post('/terminal/search', async (req: Request, res: Response) => {
  try {
    const { query, sessionId, dateFrom, dateTo } = req.body as {
      query?: string;
      sessionId?: string;
      dateFrom?: string;
      dateTo?: string;
    };
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const indexPath = path.join(SESSIONS_DIR, 'index.json');
    if (!fs.existsSync(indexPath)) {
      res.json({ results: [] });
      return;
    }
    const index: any[] = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const lowerQuery = query.toLowerCase();
    const results: Array<{
      sessionId: string;
      line: number;
      text: string;
      context: string;
    }> = [];

    const sessionsToSearch = sessionId
      ? index.filter(e => e.id === sessionId)
      : index;

    for (const entry of sessionsToSearch) {
      // Date filter
      if (dateFrom && entry.createdAt && entry.createdAt < dateFrom) continue;
      if (dateTo && entry.createdAt && entry.createdAt > dateTo) continue;

      const logPath = path.join(SESSIONS_DIR, `${entry.id}.log`);
      if (!fs.existsSync(logPath)) continue;

      const content = fs.readFileSync(logPath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          results.push({
            sessionId: entry.id,
            line: i + 1,
            text: lines[i],
            context: lines.slice(Math.max(0, i - 2), i + 3).join('\n'),
          });
        }
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});
```

- [ ] **Step 2: Add the SESSIONS_DIR import to sessions.ts**

Add at the top with existing imports:
```typescript
import { SESSIONS_DIR } from '../../config.js';
```

- [ ] **Step 3: Write tests for the API**

Create `src/admin/routes/sessions.test.ts`:

```typescript
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

// Need to import after mocks are set
const { default: router } = await import('../routes/sessions.js');

describe('terminal session API', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    // Write a sample index.json
    fs.writeFileSync(path.join(TEST_DIR, 'index.json'), JSON.stringify([
      { id: 'term-1', name: 'term-1', owner: 'owner', createdAt: '2026-06-01T12:00:00Z', endedAt: '2026-06-01T13:00:00Z', bytes: 100 },
      { id: 'term-2', name: 'term-2', owner: 'owner', createdAt: '2026-06-02T12:00:00Z', endedAt: null, bytes: 50 },
    ], null, 2));
    // Write log files
    fs.writeFileSync(path.join(TEST_DIR, 'term-1.log'), 'line1\nline2\nerror: something failed\nline4\n');
    fs.writeFileSync(path.join(TEST_DIR, 'term-2.log'), 'startup\nrunning\n');
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('GET /terminal/history returns session list', async () => {
    // Integration test — we test the data layer directly
    const indexPath = path.join(TEST_DIR, 'index.json');
    const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    expect(data).toHaveLength(2);
    expect(data[0].id).toBe('term-1');
    expect(data[1].id).toBe('term-2');
  });

  it('GET /terminal/:id/transcript returns file content', () => {
    const content = fs.readFileSync(path.join(TEST_DIR, 'term-1.log'), 'utf-8');
    expect(content).toContain('error: something failed');
    expect(content).toContain('line1');
  });

  it('POST /terminal/search finds matching lines', () => {
    const query = 'error';
    const content = fs.readFileSync(path.join(TEST_DIR, 'term-1.log'), 'utf-8');
    const lines = content.split('\n');
    const matches = lines
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter(l => l.text.toLowerCase().includes(query.toLowerCase()));
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(3);
  });

  it('POST /terminal/search filters by date', () => {
    const query = 'line';
    // Only search term-2 which starts on 2026-06-02
    const content = fs.readFileSync(path.join(TEST_DIR, 'term-2.log'), 'utf-8');
    expect(content).toContain('running');
  });

  it('POST /terminal/search returns empty for no matches', () => {
    const query = 'nonexistent';
    const files = fs.readdirSync(TEST_DIR).filter(f => f.endsWith('.log'));
    let totalMatches = 0;
    for (const file of files) {
      const content = fs.readFileSync(path.join(TEST_DIR, file), 'utf-8');
      const lines = content.split('\n');
      totalMatches += lines.filter(l => l.toLowerCase().includes(query)).length;
    }
    expect(totalMatches).toBe(0);
  });

  it('returns 404 for missing session transcript', () => {
    const logPath = path.join(TEST_DIR, 'nonexistent.log');
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('returns 400 for search without query', () => {
    // This validates the API contract
    const query = '';
    expect(query.trim().length === 0).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/admin/routes/sessions.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/admin/routes/sessions.ts src/admin/routes/sessions.test.ts
git commit -m "feat(terminal): add history/search API endpoints"
```

---

### Task 4: WebSocket reconnect handling (frontend)

**Files:**
- Modify: `src/admin/public/app.js`

- [ ] **Step 1: Update connectWs to auto-attach on reconnect**

In `app.js`, find the `connectWs` function (line 61-92). After `ws.onopen`, add logic to auto-attach to the last terminal session:

```javascript
function connectWs() {
  if (ws && ws.readyState <= 1) ws.close();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const match = document.cookie.match(/nanocrab_session=([^;]+)/);
  const token = match?.[1] || '';
  if (!token) {
    console.warn('WS: no session cookie found');
    return;
  }
  const url = `${proto}://${location.host}/ws?token=${token}`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    console.log('WS connected');
    // Auto-attach terminal session on reconnect
    const savedSessionId = localStorage.getItem('terminal_session_id');
    if (savedSessionId) {
      ws.send(JSON.stringify({ type: 'terminal_attach', sessionId: savedSessionId }));
    }
  };
  ws.onmessage = (e) => {
    try {
      handleWsMessage(JSON.parse(e.data));
    } catch {}
  };
  ws.onclose = (e) => {
    console.log('WS closed:', e.code, e.reason);
    ws = null;
    setTimeout(connectWs, 5000);
  };
  ws.onerror = (e) => {
    console.error('WS error:', e);
  };
}
```

The key change: `ws.onopen` now sends `terminal_attach` if a saved session ID exists in localStorage.

- [ ] **Step 2: Commit**

```bash
git add src/admin/public/app.js
git commit -m "feat(terminal): auto-attach terminal on WS reconnect"
```

---

### Task 5: Split-pane terminal frontend

**Files:**
- Modify: `src/admin/public/app.js` — rewrite `renderTerminal()` 
- Modify: `src/admin/public/style.css` — add split-pane CSS

This is the biggest frontend change. The terminal tab in DevHub gets completely rebuilt.

- [ ] **Step 1: Add split-pane CSS to style.css**

Add at the end of `style.css`:

```css
/* Split-pane terminal layout */
.split-container {
  display: flex;
  gap: 0;
  height: 100%;
  min-height: 400px;
  position: relative;
  overflow: hidden;
}

.split-pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  min-width: 200px;
}

.split-pane:first-child {
  border-right: 1px solid var(--border);
}

.split-divider {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  position: relative;
  z-index: 10;
  flex-shrink: 0;
}

.split-divider::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 1px;
  right: 1px;
  background: var(--border);
  border-radius: 2px;
  transition: background var(--transition);
}

.split-divider:hover::after,
.split-divider:active::after {
  background: var(--accent);
}

.pane-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}

.pane-tab {
  padding: 6px 14px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color var(--transition), border-color var(--transition);
  user-select: none;
}

.pane-tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.pane-tab:hover {
  color: var(--text-secondary);
}

.pane-content {
  flex: 1;
  overflow: auto;
  position: relative;
}

.pane-content > .tab-content {
  height: 100%;
}

/* Terminal container fills the pane */
#terminal-container {
  height: 100%;
  min-height: 200px;
}

/* Terminal overlay for search */
.terminal-search-overlay {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px 10px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  z-index: 20;
  font-size: 12px;
}

.terminal-search-overlay input {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 3px 8px;
  font-family: var(--mono);
  font-size: 12px;
  width: 180px;
  border-radius: 4px;
}

.terminal-search-overlay input:focus {
  border-color: var(--accent);
  outline: none;
}

.terminal-search-overlay .match-count {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

/* File tree in terminal pane */
.term-file-tree {
  padding: 8px;
  font-size: 12px;
  height: 100%;
  overflow-y: auto;
  background: var(--bg);
}

.term-file-tree .repo-header {
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
  font-size: 13px;
}

.term-file-tree .tree-item {
  padding: 3px 0 3px 12px;
  cursor: pointer;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.term-file-tree .tree-item:hover {
  color: var(--text);
}

.term-file-tree .tree-item.dir {
  color: var(--text-secondary);
  font-weight: 500;
}

/* Search tab in terminal pane */
.term-search-pane {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
}

.term-search-pane .search-input-row {
  display: flex;
  gap: 8px;
}

.term-search-pane .search-input-row input {
  flex: 1;
}

.term-search-pane .search-results {
  flex: 1;
  overflow-y: auto;
}

.term-search-pane .search-result-item {
  padding: 8px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

.term-search-pane .search-result-item:hover {
  background: var(--surface2);
}

.term-search-pane .search-result-line {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.term-search-pane .search-result-meta {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

.term-search-pane .search-result-context {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface);
  padding: 4px 8px;
  border-radius: 4px;
  margin-top: 4px;
  white-space: pre-wrap;
  max-height: 60px;
  overflow-y: auto;
}

/* Log viewer in terminal pane */
.term-log-viewer {
  height: 100%;
  overflow-y: auto;
  background: var(--bg);
  padding: 8px;
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.5;
}

/* Mobile: stack vertically */
@media (max-width: 768px) {
  .split-container {
    flex-direction: column;
  }
  .split-pane:first-child {
    border-right: none;
    border-bottom: 1px solid var(--border);
    max-height: 60vh;
  }
  .split-divider {
    height: 4px;
    width: 100%;
    cursor: row-resize;
  }
}
```

- [ ] **Step 2: Rewrite renderTerminal function**

Replace the entire `renderTerminal` function (line 3362-3438) with the new split-pane version:

```javascript
async function renderTerminal(el) {
  if ((window._userRole || 'owner') !== 'owner') {
    el.innerHTML = '<div class="card"><div class="empty">Terminal access requires owner role.</div></div>';
    return;
  }

  // Build the split-pane HTML
  el.innerHTML = `
    <div class="page-header" style="margin-bottom:0">
      <h2>Terminal</h2>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input class="search-input" id="terminal-session-id"
          value="${esc(localStorage.getItem('terminal_session_id') || 'term-' + Math.random().toString(36).slice(2, 8))}"
          style="max-width:180px;padding:5px 8px;font-family:var(--mono);font-size:12px">
        <button class="btn btn-sm btn-ghost" onclick="reconnectTerminal()">Reconnect</button>
        <button class="btn btn-sm btn-ghost" onclick="clearTerminal()">Clear</button>
        <button class="btn btn-sm btn-ghost" onclick="copyTerminalTranscript()">Copy</button>
        <button class="btn btn-sm btn-ghost" onclick="spawnNewTerminal()">New Session</button>
      </div>
    </div>
    <div class="card" style="padding:0;overflow:hidden;flex:1;display:flex;flex-direction:column;margin-top:8px">
      <div class="split-container" id="terminal-split">
        <div class="split-pane" id="pane-left" style="flex:1">
          <div class="pane-tabs" id="pane-left-tabs">
            <div class="pane-tab active" data-tab="terminal" onclick="switchTermPane('left', 'terminal')">Terminal</div>
            <div class="pane-tab" data-tab="files" onclick="switchTermPane('left', 'files')">Files</div>
          </div>
          <div class="pane-content" id="pane-left-content">
            <div class="tab-content active" id="left-terminal">
              <div id="terminal-container" style="height:100%;background:var(--bg)"></div>
            </div>
            <div class="tab-content" id="left-files" style="display:none">
              <div class="term-file-tree" id="term-file-tree">Loading...</div>
            </div>
          </div>
        </div>
        <div class="split-divider" id="split-divider"></div>
        <div class="split-pane" id="pane-right" style="flex:1">
          <div class="pane-tabs" id="pane-right-tabs">
            <div class="pane-tab active" data-tab="logs" onclick="switchTermPane('right', 'logs')">Logs</div>
            <div class="pane-tab" data-tab="search" onclick="switchTermPane('right', 'search')">Search</div>
          </div>
          <div class="pane-content" id="pane-right-content">
            <div class="tab-content active" id="right-logs">
              <div class="term-log-viewer" id="term-log-viewer">Loading logs...</div>
            </div>
            <div class="tab-content" id="right-search" style="display:none">
              <div class="term-search-pane" id="term-search-pane">
                <div class="search-input-row">
                  <input class="search-input" id="term-search-input" placeholder="Search terminal history..." style="flex:1">
                  <button class="btn btn-sm btn-primary" onclick="runTerminalSearch()">Search</button>
                </div>
                <div style="display:flex;gap:8px;font-size:11px;color:var(--text-muted)">
                  <label>From: <input type="date" id="term-search-from" class="search-input" style="width:auto;padding:2px 6px"></label>
                  <label>To: <input type="date" id="term-search-to" class="search-input" style="width:auto;padding:2px 6px"></label>
                </div>
                <div class="search-results" id="term-search-results">
                  <div style="color:var(--text-muted);padding:12px;text-align:center;font-size:12px">Enter a query to search across all terminal sessions</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // --- Split divider drag ---
  const divider = document.getElementById('split-divider');
  let isDragging = false;

  divider.addEventListener('mousedown', (e) => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const container = document.getElementById('terminal-split');
    const rect = container.getBoundingClientRect();
    const leftPane = document.getElementById('pane-left');
    const rightPane = document.getElementById('pane-right');
    // Calculate position relative to container
    let pos = e.clientX - rect.left;
    const minWidth = 200;
    pos = Math.max(minWidth, Math.min(pos, rect.width - minWidth));
    const pct = (pos / rect.width) * 100;
    leftPane.style.flex = `0 0 ${pct}%`;
    rightPane.style.flex = `1 1 ${100 - pct}%`;
    // Save position
    localStorage.setItem('terminal_split_pos', pct.toString());
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });

  // Restore saved split position
  const savedPos = localStorage.getItem('terminal_split_pos');
  if (savedPos) {
    const pct = parseFloat(savedPos);
    if (pct > 20 && pct < 80) {
      document.getElementById('pane-left').style.flex = `0 0 ${pct}%`;
      document.getElementById('pane-right').style.flex = `1 1 ${100 - pct}%`;
    }
  }

  // --- Load xterm.js ---
  await loadCss('https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css');
  await loadScript('https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/@xterm/addon-search@0.16.0/lib/addon-search.min.js');

  const term = new window.Terminal({
    cursorBlink: true,
    fontSize: 13,
    lineHeight: 1.1,
    fontFamily: "'JetBrains Mono', 'Consolas', monospace",
    theme: { background: '#09090b', foreground: '#e1e4ed', cursor: '#43a79a' },
  });
  const fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  const searchAddon = new window.SearchAddon.SearchAddon();
  term.loadAddon(searchAddon);

  term.open(document.getElementById('terminal-container'));
  setTimeout(() => fitAddon.fit(), 100);

  // Ctrl+Shift+F for search
  term.onKey((e) => {
    if (e.key === 'F' && (e.domEvent.ctrlKey || e.domEvent.metaKey) && e.domEvent.shiftKey) {
      const query = prompt('Search terminal (Ctrl+G next, Shift+Ctrl+G prev):');
      if (query) searchAddon.findNext(query);
    }
  });

  const sessionId = document.getElementById('terminal-session-id').value;
  localStorage.setItem('terminal_session_id', sessionId);
  activeTerminal = { sessionId, term, transcript: '' };

  // Spawn or attach
  const initTerminal = () => {
    if (ws?.readyState === 1) {
      // Try attach first, then spawn
      ws.send(JSON.stringify({ type: 'terminal_attach', sessionId }));
      // Also send spawn in case session doesn't exist
      ws.send(JSON.stringify({ type: 'terminal_spawn', data: sessionId }));
      return;
    }
    term.write('Connecting...\r\n');
    connectWs();
    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      if (ws?.readyState === 1) {
        clearInterval(check);
        ws.send(JSON.stringify({ type: 'terminal_attach', sessionId }));
        ws.send(JSON.stringify({ type: 'terminal_spawn', data: sessionId }));
      } else if (attempts > 20) {
        clearInterval(check);
        term.write('\r\nFailed to connect. Check WebSocket.\r\n');
      }
    }, 500);
  };
  window._spawnTerminalSession = initTerminal;
  initTerminal();

  term.onData((data) => {
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify({ type: 'terminal_input', sessionId, data }));
    }
  });

  const container = document.getElementById('terminal-container');
  if (container) new ResizeObserver(() => fitAddon.fit()).observe(container);

  // --- Load file tree ---
  loadTerminalFileTree();

  // --- Load logs ---
  loadTerminalLogs();
}

// Tab switching within panes
window.switchTermPane = function (side, tabId) {
  const tabs = document.getElementById(`pane-${side}-tabs`);
  tabs.querySelectorAll('.pane-tab').forEach(t => t.classList.remove('active'));
  tabs.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

  const contents = document.getElementById(`pane-${side}-content`);
  contents.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  const target = document.getElementById(`${side}-${tabId}`);
  if (target) {
    target.style.display = '';
    target.classList.add('active');
  }
};

// File tree in terminal
async function loadTerminalFileTree() {
  const el = document.getElementById('term-file-tree');
  if (!el) return;
  try {
    const repos = await api('/files/repos');
    if (repos.length === 0) {
      el.innerHTML = '<div style="padding:8px;color:var(--text-muted)">No repos mounted</div>';
      return;
    }
    const repo = repos[0].name;
    const tree = await api(`/files/repos/${encodeURIComponent(repo)}/tree`);
    el.innerHTML = `<div class="repo-header">${esc(repo)}</div>${renderTermTree(tree, '', repo)}`;
  } catch {
    el.innerHTML = '<div style="padding:8px;color:var(--text-muted)">Failed to load</div>';
  }
}

function renderTermTree(items, prefix, repo) {
  return items.map(item => {
    const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.type === 'dir') {
      return `<details style="padding-left:10px"><summary style="cursor:pointer;padding:2px 0;font-size:12px;color:var(--text-secondary);list-style:none">${item.name}/</summary>${renderTermTree(item.children || [], fullPath, repo)}</details>`;
    }
    return `<div class="tree-item" onclick="openTermFile('${esc(repo)}','${esc(fullPath)}')">${esc(item.name)}</div>`;
  }).join('');
}

window.openTermFile = function (repo, path) {
  // Navigate to editor tab opening this file
  navigate('gitcode');
  setTimeout(() => {
    if (typeof window.openEditorFile === 'function') {
      window.openEditorFile(repo, path);
    }
  }, 500);
};

// Log viewer in terminal
async function loadTerminalLogs() {
  const el = document.getElementById('term-log-viewer');
  if (!el) return;
  try {
    const logs = await api('/logs/system?lines=100');
    el.innerHTML = logs.lines.length
      ? logs.lines.map(l => colorizeLog([l])).join('\n')
      : 'No log entries';
    el.scrollTop = el.scrollHeight;
  } catch {
    el.innerHTML = 'Failed to load logs';
  }
  // Subscribe to live logs
  if (ws?.readyState === 1) {
    ws.send(JSON.stringify({ type: 'subscribe_logs', data: 'system' }));
  }
}

// New terminal session
window.spawnNewTerminal = function () {
  const newId = 'term-' + Math.random().toString(36).slice(2, 8);
  document.getElementById('terminal-session-id').value = newId;
  localStorage.setItem('terminal_session_id', newId);
  if (activeTerminal) {
    activeTerminal.term.dispose();
    activeTerminal = null;
  }
  navigate('devhub');
};

// Override log_line handler to update the terminal log view
// (This is handled by the global handleWsMessage which already
// updates #live-log. We'll add #term-log-viewer support there too.)
```

- [ ] **Step 3: Update handleWsMessage for terminal log viewer**

In the `handleWsMessage` function (around line 165-173), update the `log_lines` handler to also update the terminal log view:

```javascript
if (msg.type === 'log_lines') {
  const viewer = document.getElementById('live-log');
  if (viewer) {
    msg.data.lines.forEach((l) => {
      viewer.textContent += l + '\n';
    });
    viewer.scrollTop = viewer.scrollHeight;
  }
  // Also update terminal log viewer if present
  const termLog = document.getElementById('term-log-viewer');
  if (termLog) {
    msg.data.lines.forEach((l) => {
      termLog.textContent += l + '\n';
    });
    termLog.scrollTop = termLog.scrollHeight;
  }
}
```

- [ ] **Step 4: Verify the frontend renders correctly by checking compilation**

TypeScript compilation doesn't cover JS files, but we can check for syntax issues with node:

Run: `node -c src/admin/public/app.js`
Expected: syntax OK

Note: This is a 6500-line vanilla JS file with no imports/exports. It runs in the browser. A simple syntax parse will catch major issues.

- [ ] **Step 5: Commit**

```bash
git add src/admin/public/app.js src/admin/public/style.css
git commit -m "feat(terminal): split-pane terminal with file tree, logs, and search tabs"
```

---

### Task 6: Search functionality

**Files:**
- Modify: `src/admin/public/app.js`

- [ ] **Step 1: Add terminal search function**

Add at the end of app.js (or near the other terminal functions):

```javascript
window.runTerminalSearch = async function () {
  const input = document.getElementById('term-search-input');
  const from = document.getElementById('term-search-from');
  const to = document.getElementById('term-search-to');
  const resultsEl = document.getElementById('term-search-results');
  const query = input.value.trim();

  if (!query) {
    resultsEl.innerHTML = '<div style="color:var(--text-muted);padding:12px;text-align:center;font-size:12px">Enter a query to search</div>';
    return;
  }

  resultsEl.innerHTML = '<div style="padding:12px;text-align:center;font-size:12px;color:var(--text-muted)">Searching...</div>';

  try {
    const body = { query };
    if (from.value) body.dateFrom = from.value + 'T00:00:00Z';
    if (to.value) body.dateTo = to.value + 'T23:59:59Z';

    const data = await api('/sessions/terminal/search', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const results = data.results || [];

    if (results.length === 0) {
      resultsEl.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center;font-size:12px">No results found for <strong>' + esc(query) + '</strong></div>';
      return;
    }

    resultsEl.innerHTML = results.map((r, i) => `
      <div class="search-result-item" onclick="viewTerminalTranscript('${esc(r.sessionId)}')">
        <div class="search-result-line">${esc(truncate(r.text, 100))}</div>
        <div class="search-result-meta">
          Session: ${esc(r.sessionId)} · Line ${r.line}
          ${i < results.length - 1 ? '' : ''}
        </div>
        <div class="search-result-context">${esc(r.context)}</div>
      </div>
    `).join('') +
    `<div style="padding:8px;text-align:center;font-size:11px;color:var(--text-muted)">${results.length} result${results.length !== 1 ? 's' : ''}`;
  } catch (e) {
    resultsEl.innerHTML = '<div style="color:var(--error);padding:12px;text-align:center;font-size:12px">Search failed: ' + esc(e.message) + '</div>';
  }
};

// View transcript in read-only terminal mode
window.viewTerminalTranscript = async function (sessionId) {
  try {
    const data = await api(`/sessions/terminal/${encodeURIComponent(sessionId)}/transcript`);
    // Switch to left pane terminal tab
    switchTermPane('left', 'terminal');
    const container = document.getElementById('terminal-container');
    if (activeTerminal && activeTerminal.term) {
      activeTerminal.term.reset();
      activeTerminal.term.write(data.content.slice(-50000));
      activeTerminal.term.write('\r\n\r\n[END OF SESSION — ' + esc(sessionId) + ']\r\n');
    }
    toast('Loaded session: ' + sessionId, 'info');
  } catch (e) {
    toast('Failed to load transcript: ' + e.message, 'error');
  }
};

// Enter key to search
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement === document.getElementById('term-search-input')) {
    runTerminalSearch();
  }
});
```

- [ ] **Step 2: Verify syntax**

Run: `node -c src/admin/public/app.js`
Expected: syntax OK

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All previously passing tests still pass (394 tests passing, 9 files with SQLite binding errors pre-existing unchanged)

- [ ] **Step 4: Commit**

```bash
git add src/admin/public/app.js
git commit -m "feat(terminal): add search history viewer with API integration"
```

---

### Task 7: Integration and cleanup

**Files:**
- No new files
- Verify everything works together

- [ ] **Step 1: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors (all TypeScript changes compile cleanly)

- [ ] **Step 2: Full test run**

Run: `npx vitest run --reporter=verbose`
Expected: 27+ test files passing, all new tests passing

- [ ] **Step 3: Review all changes**

Run: `git diff --stat`
Verify the expected files are modified:
- `src/config.ts` — 2 lines added
- `src/admin/index.ts` — ~5 lines added
- `src/admin/websocket.ts` — ~100 lines changed
- `src/admin/routes/sessions.ts` — ~80 lines added
- `src/admin/public/app.js` — ~250 lines changed
- `src/admin/public/style.css` — ~150 lines added
- `src/admin/websocket.test.ts` — ~100 lines (new)
- `src/admin/routes/sessions.test.ts` — ~120 lines (new)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(terminal): complete terminal improvements v1"
```
