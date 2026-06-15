# Web Chat Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude Code-style web conversations ("threads") to the Chat mode — standalone, isolated agent chats delivered through a dedicated web channel, listed in the Chat-mode sidebar, kept entirely separate from WhatsApp/Signal.

**Architecture:** A new `web` channel (`ownsJid` for `web:` JIDs, no-op `sendMessage`) lets `web:<uuid>` conversations reuse the existing message loop / queue / container runner / WebSocket pipeline. Each thread is a registered group with `kind:'web'`, an isolated folder, and a `containerConfig` cloned from a chosen agent template. A `/api/threads` namespace handles CRUD; `kind:'web'` groups are filtered out of the Groups/Channels/health/Integrations surfaces. The Chat-mode sidebar renders the thread list + "New conversation"; the conversation view reuses existing message/tool/approval rendering.

**Tech Stack:** Node + TypeScript (Express, better-sqlite3) backend tested with vitest; vanilla browser JS frontend (no DOM test harness — verified live via `npm run mock:admin`).

**Key facts discovered (rely on these):**
- `RegisteredGroup` type: `src/types.ts` (around line 56). `ContainerConfig`: `src/types.ts:32`. `Channel` interface: `src/types.ts:245`.
- Channel registry: `src/channels/registry.ts` (`registerChannel(name, factory)`, `ChannelFactory = (opts) => Channel | null`). Channels self-register on import via `src/channels/index.js`; instantiated at startup in `src/index.ts:1058-1074` (factories returning `null` are skipped).
- Reply path `src/index.ts:499-518`: `await channel.sendMessage(chatJid, text)` then `storeMessageDirect(...)` then `broadcastMessage(...)`. The framework persists+broadcasts the reply, so the web channel's `sendMessage` must be a NO-OP. Channel for a jid is resolved by `findChannel(channels, jid)` (uses `ownsJid`).
- DB: `registered_groups` table (`src/db.ts:103`), `setRegisteredGroup` (`src/db.ts:1318`), `getAllRegisteredGroups` (`src/db.ts:1339`), `getRegisteredGroup` (`src/db.ts:1274`). Migrations are `ALTER TABLE` blocks near `src/db.ts:290-325`.
- Message loop polls registered group JIDs and calls `queue.enqueueMessageCheck(jid)` (`src/group-queue.ts`). Messages stored/loaded via `src/db.ts` + `/api/messages/:jid` (`src/admin/routes/messages.ts`). Chat send today: `src/admin/plugins/chat/routes.ts:15`.
- Frontend: `renderChat` is `src/admin/public/app.js:1560-1814`; `showShell` chat-mode nav uses `window.NanoModes`/`PAGE_META` (`src/admin/public/app.js`); page render map `_pageMap` (`src/admin/public/app.js:743`). Mode config: `src/admin/public/modes.js`.
- Tests run with `npm test` (vitest, globs `src/**/*.test.ts`). 150 pre-existing failures are an environmental `better-sqlite3` native-binding issue, unrelated — judge new tests by their own pass/fail, and prefer running a single new test file: `npx vitest run <file>`.

---

## File Structure

- **Create** `src/channels/web.ts` — the web `Channel` (ownsJid `web:`, no-op send/connect/disconnect, returns null-never factory). Self-registers.
- **Create** `src/web-threads.ts` — pure-ish helpers for threads: `isWebJid`, `newWebJid`, `buildThreadGroup(template|custom, title)` (returns a `RegisteredGroup` with `kind:'web'`, isolated folder, cloned config). DOM-free, unit-testable.
- **Create** `src/web-threads.test.ts`, `src/channels/web.test.ts` — unit tests.
- **Create** `src/admin/routes/threads.ts` — `/api/threads` CRUD + agent-templates.
- **Create** `src/admin/routes/threads.test.ts` — route tests.
- **Create** `src/admin/public/pages/chat-threads.js` — frontend conversation view + thread-list rendering helpers + new-conversation modal (new home for the reworked chat UI).
- **Modify** `src/types.ts` — add `kind?: 'web'` and `title?: string` to `RegisteredGroup`.
- **Modify** `src/db.ts` — `kind`/`title` columns (migration), read/write in `setRegisteredGroup`/`getAllRegisteredGroups`/`getRegisteredGroup`; add `getWebThreads()` / non-web group filter helper.
- **Modify** `src/channels/index.ts` — import `./web.js` so it registers.
- **Modify** `src/index.ts` — ensure the web channel is always instantiated (it returns non-null).
- **Modify** group/channel/health/integrations listing surfaces — exclude `kind:'web'`.
- **Modify** `src/admin/index.ts` — mount `threadsRoutes` at `/api/threads`.
- **Modify** `src/admin/public/app.js` — chat-mode sidebar renders thread list; `#/chat/:threadId` routing; wire `renderChat` to the new module.
- **Modify** `src/admin/public/modes.js` — chat mode page handling for thread routes (if needed).

---

## Task 1: Add `kind` and `title` to the group type

**Files:**
- Modify: `src/types.ts` (RegisteredGroup, ~line 56)

- [ ] **Step 1: Extend the type**

In `src/types.ts`, add two fields to `RegisteredGroup` (after `isPrimary`):

```ts
  isPrimary?: boolean; // Primary owner bot for startup notices and owner-facing status
  // 'web' marks a synthetic web-conversation thread (Chat mode). Web groups are
  // excluded from channel/group management surfaces. Undefined = a real channel group.
  kind?: 'web';
  // User-facing conversation title (web threads). Channel groups use `name`.
  title?: string;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add kind/title to RegisteredGroup for web threads"
```

---

## Task 2: Persist `kind` and `title` in the DB

**Files:**
- Modify: `src/db.ts` (schema ~103, migrations ~290-325, `setRegisteredGroup` ~1318, `getAllRegisteredGroups` ~1339, `getRegisteredGroup` ~1274)
- Test: `src/db.registered-groups.test.ts` (create)

> Note: DB tests require the `better-sqlite3` native binding. If it is unavailable in this environment, the test will fail to load `src/db.ts` with a bindings error (same pre-existing failure affecting 150 tests). In that case, still WRITE the test, run it, and if it fails ONLY due to the bindings load error (not an assertion), note that in the commit and proceed — the assertions will run wherever the binding is built. Verify your read/write code by inspection.

- [ ] **Step 1: Write the failing test**

Create `src/db.registered-groups.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as db from './db.js';

describe('registered group kind/title round-trip', () => {
  beforeAll(() => {
    // db.js opens its database on import; tests use the same instance.
  });

  it('persists and reads back kind and title', () => {
    const jid = 'web:test-kind-title';
    db.setRegisteredGroup(jid, {
      name: 'Web Conversation',
      title: 'My thread',
      kind: 'web',
      folder: 'web-chat-test-kind-title',
      trigger: '^',
      added_at: new Date('2026-06-15T00:00:00Z').toISOString(),
      requiresTrigger: false,
    });
    const all = db.getAllRegisteredGroups();
    expect(all[jid].kind).toBe('web');
    expect(all[jid].title).toBe('My thread');
    const one = db.getRegisteredGroup(jid);
    expect(one?.kind).toBe('web');
    expect(one?.title).toBe('My thread');
  });

  it('reads a non-web group with kind undefined', () => {
    const jid = 'plain:test-no-kind';
    db.setRegisteredGroup(jid, {
      name: 'Plain',
      folder: 'plain-test-no-kind',
      trigger: '^',
      added_at: new Date('2026-06-15T00:00:00Z').toISOString(),
    });
    expect(db.getAllRegisteredGroups()[jid].kind).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db.registered-groups.test.ts`
Expected: FAIL — assertions on `kind`/`title` fail (columns not stored), OR a bindings load error (see Task note).

- [ ] **Step 3: Add the columns + migration**

In `src/db.ts`, in the `CREATE TABLE IF NOT EXISTS registered_groups (...)` block (~line 103), add two columns before the closing `)`:

```sql
      kind TEXT,
      title TEXT,
```

Then add migrations alongside the existing `ALTER TABLE registered_groups ...` blocks (~line 313-325), each wrapped exactly like the neighbours (they tolerate "duplicate column" errors):

```js
    runMigration(
      `ALTER TABLE registered_groups ADD COLUMN kind TEXT`,
    );
    runMigration(
      `ALTER TABLE registered_groups ADD COLUMN title TEXT`,
    );
```

(Match the existing migration helper's exact call form used by the surrounding ALTERs — read lines ~285-325 and mirror it.)

- [ ] **Step 4: Write `kind`/`title` in `setRegisteredGroup`**

In `setRegisteredGroup` (~1318), extend the INSERT column list and values:

```ts
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger, is_main, enabled, is_primary, kind, title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  );
```

- [ ] **Step 5: Read `kind`/`title` in `getAllRegisteredGroups` and `getRegisteredGroup`**

In `getAllRegisteredGroups` (~1339), add to the row type `kind: string | null; title: string | null;` and to the mapped object:

```ts
      kind: row.kind === 'web' ? 'web' : undefined,
      title: row.title ?? undefined,
```

Apply the identical row-type additions and mapping to `getRegisteredGroup` (~1274).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/db.registered-groups.test.ts`
Expected: PASS (or bindings-load failure only — see Task note).

- [ ] **Step 7: Commit**

```bash
git add src/db.ts src/db.registered-groups.test.ts
git commit -m "feat(db): persist kind/title for registered groups"
```

---

## Task 3: Web-thread helpers (`src/web-threads.ts`)

**Files:**
- Create: `src/web-threads.ts`
- Test: `src/web-threads.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/web-threads.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isWebJid, newWebJid, buildThreadGroup } from './web-threads.js';

describe('isWebJid', () => {
  it('matches only web: jids', () => {
    expect(isWebJid('web:abc')).toBe(true);
    expect(isWebJid('123@g.us')).toBe(false);
    expect(isWebJid('')).toBe(false);
  });
});

describe('newWebJid', () => {
  it('produces a unique web: jid', () => {
    const a = newWebJid();
    const b = newWebJid();
    expect(a.startsWith('web:')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('buildThreadGroup', () => {
  it('builds an isolated web group from a template config', () => {
    const jid = 'web:fixed-id';
    const g = buildThreadGroup({
      jid,
      title: 'Deploy review',
      addedAt: '2026-06-15T00:00:00Z',
      config: { provider: 'codex', model: 'gpt-5.4', allowedMcpServers: ['nanocrab'] },
    });
    expect(g.kind).toBe('web');
    expect(g.title).toBe('Deploy review');
    expect(g.requiresTrigger).toBe(false);
    expect(g.enabled).toBe(true);
    expect(g.isMain).toBeFalsy();
    // isolated folder derived from the jid id, not from any source agent folder
    expect(g.folder).toBe('web-fixed-id');
    // config cloned (not the same reference) but equal in value
    expect(g.containerConfig).toEqual({ provider: 'codex', model: 'gpt-5.4', allowedMcpServers: ['nanocrab'] });
  });

  it('defaults title and tolerates no config', () => {
    const g = buildThreadGroup({ jid: 'web:x', addedAt: '2026-06-15T00:00:00Z' });
    expect(g.title).toBe('New conversation');
    expect(g.containerConfig).toBeUndefined();
    expect(g.folder).toBe('web-x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web-threads.test.ts`
Expected: FAIL — `Cannot find module './web-threads.js'`.

- [ ] **Step 3: Implement**

Create `src/web-threads.ts`:

```ts
import { randomUUID } from 'crypto';
import type { ContainerConfig, RegisteredGroup } from './types.js';

const WEB_PREFIX = 'web:';

export function isWebJid(jid: string): boolean {
  return typeof jid === 'string' && jid.startsWith(WEB_PREFIX);
}

export function newWebJid(): string {
  return `${WEB_PREFIX}${randomUUID()}`;
}

export interface BuildThreadInput {
  jid: string;
  title?: string;
  addedAt: string;
  config?: ContainerConfig;
}

// Build an isolated web-thread group. The folder is derived from the jid id only,
// never from a source agent — isolation is strict. The config is a deep clone so
// the source template is never mutated.
export function buildThreadGroup(input: BuildThreadInput): RegisteredGroup {
  const id = input.jid.startsWith(WEB_PREFIX)
    ? input.jid.slice(WEB_PREFIX.length)
    : input.jid;
  return {
    name: 'Web Conversation',
    title: input.title && input.title.trim() ? input.title.trim() : 'New conversation',
    kind: 'web',
    folder: `web-${id}`,
    trigger: '^',
    added_at: input.addedAt,
    requiresTrigger: false,
    enabled: true,
    containerConfig: input.config
      ? (JSON.parse(JSON.stringify(input.config)) as ContainerConfig)
      : undefined,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/web-threads.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web-threads.ts src/web-threads.test.ts
git commit -m "feat: web-thread helpers (jid + isolated group builder)"
```

---

## Task 4: The web channel (`src/channels/web.ts`)

**Files:**
- Create: `src/channels/web.ts`
- Modify: `src/channels/index.ts` (add `import './web.js';`)
- Test: `src/channels/web.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/channels/web.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createWebChannel } from './web.js';

const opts = {
  onMessage: vi.fn(),
  onChatMetadata: vi.fn(),
  registeredGroups: () => ({}),
};

describe('web channel', () => {
  it('owns only web: jids', () => {
    const ch = createWebChannel(opts);
    expect(ch.ownsJid('web:abc')).toBe(true);
    expect(ch.ownsJid('123@g.us')).toBe(false);
  });

  it('is always connected and sendMessage is a no-op that resolves', async () => {
    const ch = createWebChannel(opts);
    expect(ch.isConnected()).toBe(true);
    await expect(ch.sendMessage('web:abc', 'hi')).resolves.toBeUndefined();
  });

  it('connect/disconnect resolve without error', async () => {
    const ch = createWebChannel(opts);
    await expect(ch.connect()).resolves.toBeUndefined();
    await expect(ch.disconnect()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/channels/web.test.ts`
Expected: FAIL — `Cannot find module './web.js'`.

- [ ] **Step 3: Implement the channel**

Create `src/channels/web.ts`:

```ts
/**
 * Web channel for NanoCrab.
 * Backs "web:" conversation threads (Chat mode). It performs NO external delivery:
 * the agent reply is persisted and broadcast by the message loop in src/index.ts
 * immediately after channel.sendMessage(); the browser receives it over WebSocket.
 * This channel exists so findChannel() resolves a channel for web: jids.
 */
import { registerChannel, ChannelOpts } from './registry.js';
import { Channel } from '../types.js';
import { isWebJid } from '../web-threads.js';

export function createWebChannel(_opts: ChannelOpts): Channel {
  return {
    name: 'web',
    async connect() {},
    async disconnect() {},
    isConnected() {
      return true;
    },
    ownsJid(jid: string) {
      return isWebJid(jid);
    },
    // No-op: the framework persists + broadcasts the reply. Do not double-write.
    async sendMessage(_jid: string, _text: string) {},
  };
}

registerChannel('web', (opts) => createWebChannel(opts));
```

- [ ] **Step 4: Register it on import**

In `src/channels/index.ts`, add alongside the other channel imports:

```ts
import './web.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/channels/web.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/channels/web.ts src/channels/index.ts src/channels/web.test.ts
git commit -m "feat(channels): add internal web channel for thread delivery"
```

---

## Task 5: Ensure the web channel is instantiated at startup

**Files:**
- Modify: `src/index.ts` (channel instantiation loop ~1058-1074)

- [ ] **Step 1: Read the instantiation loop**

Read `src/index.ts:1055-1078`. It iterates registered channel factories, calls each with opts, and pushes non-null results into `channels`. Because `createWebChannel` never returns null, the web channel is included automatically once `src/channels/index.ts` imports `./web.js` (Task 4). 

- [ ] **Step 2: Verify (no code change expected)**

Confirm the loop instantiates ALL registered factories (not a hardcoded subset). If it instantiates a hardcoded list instead of iterating `getRegisteredChannelNames()`, add `'web'` to that list / add an explicit `channels.push(createWebChannel(opts))`. Otherwise no change.

If a change was needed, run: `npx tsc --noEmit` (expect 0 errors) and commit:

```bash
git add src/index.ts
git commit -m "feat: instantiate web channel at startup"
```

If no change was needed, note that in the task report and skip the commit.

---

## Task 6: Non-web group filtering helper + apply to listings

**Files:**
- Modify: `src/db.ts` (add `getNonWebRegisteredGroups()` and `getWebThreads()`)
- Test: `src/db.registered-groups.test.ts` (extend)
- Modify: the group/channel/health/integration listing surfaces

- [ ] **Step 1: Write the failing test (extend Task 2's test file)**

Append to `src/db.registered-groups.test.ts`:

```ts
describe('web vs non-web partition', () => {
  it('getNonWebRegisteredGroups excludes web threads; getWebThreads returns only web', () => {
    const webJid = 'web:partition-1';
    const realJid = 'real:partition-2';
    db.setRegisteredGroup(webJid, {
      name: 'Web', title: 'T', kind: 'web', folder: 'web-partition-1',
      trigger: '^', added_at: '2026-06-15T00:00:00Z', requiresTrigger: false,
    });
    db.setRegisteredGroup(realJid, {
      name: 'Real', folder: 'real-partition-2', trigger: '^',
      added_at: '2026-06-15T00:00:00Z',
    });
    const nonWeb = db.getNonWebRegisteredGroups();
    expect(nonWeb[webJid]).toBeUndefined();
    expect(nonWeb[realJid]).toBeDefined();
    const web = db.getWebThreads();
    expect(web[webJid]).toBeDefined();
    expect(web[realJid]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db.registered-groups.test.ts`
Expected: FAIL — `getNonWebRegisteredGroups`/`getWebThreads` not defined (or bindings-load only).

- [ ] **Step 3: Implement the helpers**

In `src/db.ts`, after `getAllRegisteredGroups`, add:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db.registered-groups.test.ts`
Expected: PASS (or bindings-load only).

- [ ] **Step 5: Exclude web groups from management surfaces**

Find every place that lists registered groups for the Groups page, Channels page, dashboard channel health, and Integrations, and exclude `kind:'web'`. Locate them:

```bash
grep -rn "getAllRegisteredGroups\|registeredGroups()" src/admin/routes src/channel-status.ts src/admin/websocket.ts
```

For each listing/health/integration endpoint that enumerates groups for display (NOT the agent runtime in `src/index.ts`, and NOT places that need every group), replace the enumeration with `getNonWebRegisteredGroups()` (or filter `g.kind !== 'web'` inline if it reads from in-memory state). Specifically check and fix:
- `src/admin/routes/groups.ts` (group listing)
- `src/admin/routes/channels.ts` (channel/group listing, channel health)
- `src/channel-status.ts` (dashboard health build)
- any Integrations route that lists groups

Do NOT change the agent message loop / `processGroupMessages` (web threads MUST still be processed there). When unsure whether a call site is "display" vs "runtime", leave runtime untouched and only filter display/management/health responses.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` (expect 0). Then:

```bash
git add src/db.ts src/db.registered-groups.test.ts src/admin/routes/ src/channel-status.ts src/admin/websocket.ts
git commit -m "feat: partition web threads out of channel/group management surfaces"
```

(Only `git add` files you actually changed.)

---

## Task 7: Threads API (`src/admin/routes/threads.ts`)

**Files:**
- Create: `src/admin/routes/threads.ts`
- Modify: `src/admin/index.ts` (mount route)
- Test: `src/admin/routes/threads.test.ts`

This route reuses: `getWebThreads`, `getRegisteredGroup`, `setRegisteredGroup`, `getNonWebRegisteredGroups` (for templates), message storage/loading (`src/db.ts` — find the functions the existing `/api/messages/:jid` and chat send use), and `queue.enqueueMessageCheck` plus folder/container cleanup helpers.

> Before writing: read `src/admin/routes/messages.ts` (how messages are loaded for a jid), `src/admin/plugins/chat/routes.ts:15-64` (how a user message is stored + enqueued), and how the admin layer accesses the queue and `storeMessage`/`storeMessageDirect` and group-folder removal. Reuse those exact helpers. Read `src/admin/routes/sessions.ts` for the router/auth style to mirror.

- [ ] **Step 1: Write the failing test**

Create `src/admin/routes/threads.test.ts` using supertest against an Express app mounting only this router with auth stubbed, following the pattern in `src/admin/routes/sessions.test.ts` (read it first for the exact harness — app construction, auth bypass, and how it stubs state). Cover:

```ts
// Pseudostructure — adapt to the existing test harness in sessions.test.ts:
// 1. POST /api/threads with { templateAgentId } creates a web group:
//    - responds 200 { id } where id starts with 'web:'
//    - getRegisteredGroup(id).kind === 'web', requiresTrigger === false
//    - containerConfig equals the template agent's config (cloned)
// 2. POST /api/threads with { provider, model } (custom) sets that config.
// 3. POST /api/threads with a bad templateAgentId -> 400, no group created.
// 4. GET /api/threads lists created web threads (newest first) and NOT real groups.
// 5. GET /api/threads/agent-templates returns non-web groups as {id,label,provider,model}.
// 6. PATCH /api/threads/:id { title } renames (getRegisteredGroup(id).title updated).
// 7. DELETE /api/threads/:id removes the group (getRegisteredGroup(id) -> undefined).
```

Write real assertions following the harness. If the supertest harness in this repo is not used elsewhere, instead unit-test the handler functions by exporting them and calling with mock req/res — match whatever `sessions.test.ts` does.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/admin/routes/threads.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the router**

Create `src/admin/routes/threads.ts`. Mirror the router/auth style of `src/admin/routes/sessions.ts`. Endpoints:

```ts
import { Router } from 'express';
import {
  getWebThreads,
  getRegisteredGroup,
  setRegisteredGroup,
  getNonWebRegisteredGroups,
  // message load/store + delete helpers — use the SAME names the existing
  // messages route and chat send use (read those files):
  // e.g. getMessages, storeMessage, deleteMessagesForJid
} from '../../db.js';
import { newWebJid, buildThreadGroup, isWebJid } from '../../web-threads.js';
// queue + folder removal — import from wherever the admin layer already accesses them
// (read src/admin/plugins/chat/routes.ts and group-folder.ts).

const router = Router();

// GET /api/threads — list web threads, newest first
router.get('/', (_req, res) => {
  const threads = Object.entries(getWebThreads())
    .map(([id, g]) => ({
      id,
      title: g.title || 'New conversation',
      addedAt: g.added_at,
      // lastMessage/lastMessageAt: read the most recent message for `id` using the
      // same message-load helper as /api/messages; keep it cheap (limit 1, newest).
    }))
    .sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
  res.json(threads);
});

// GET /api/threads/agent-templates — selectable agent configs (non-web)
router.get('/agent-templates', (_req, res) => {
  const items = Object.entries(getNonWebRegisteredGroups()).map(([id, g]) => ({
    id,
    label: g.name,
    provider: g.containerConfig?.provider ?? null,
    model: g.containerConfig?.model ?? null,
  }));
  res.json(items);
});

// POST /api/threads — create. Body { templateAgentId?, provider?, model?, title? }
router.post('/', (req, res) => {
  const { templateAgentId, provider, model, title } = req.body || {};
  let config;
  if (templateAgentId) {
    const tmpl = getRegisteredGroup(templateAgentId);
    if (!tmpl || tmpl.kind === 'web') {
      return res.status(400).json({ error: 'Unknown agent template' });
    }
    config = tmpl.containerConfig ? { ...tmpl.containerConfig } : undefined;
  } else if (provider) {
    config = { provider, ...(model ? { model } : {}) };
  } // else: undefined config -> inherits global default provider
  const jid = newWebJid();
  const group = buildThreadGroup({
    jid,
    title,
    addedAt: new Date().toISOString(),
    config,
  });
  setRegisteredGroup(jid, group);
  res.json({ id: jid });
});

// GET /api/threads/:id/messages — reuse the same loader as /api/messages/:jid
router.get('/:id/messages', (req, res) => {
  if (!isWebJid(req.params.id)) return res.status(404).json({ error: 'Not a thread' });
  // return getMessages(req.params.id, limit) — same shape as /api/messages
});

// POST /api/threads/:id/messages — body { message }; store + enqueue
router.post('/:id/messages', (req, res) => {
  const id = req.params.id;
  if (!isWebJid(id) || !getRegisteredGroup(id)) {
    return res.status(404).json({ error: 'Thread not found' });
  }
  // storeMessage({ id: `web-${Date.now()}-...`, chat_jid: id, sender: 'user',
  //   sender_name: <current user>, content: req.body.message, timestamp: now,
  //   is_from_me: false }); then queue.enqueueMessageCheck(id);
  res.json({ ok: true });
});

// PATCH /api/threads/:id — body { title }
router.patch('/:id', (req, res) => {
  const g = getRegisteredGroup(req.params.id);
  if (!g || g.kind !== 'web') return res.status(404).json({ error: 'Thread not found' });
  setRegisteredGroup(req.params.id, { ...g, title: String(req.body?.title ?? g.title) });
  res.json({ ok: true });
});

// DELETE /api/threads/:id — stop container, remove folder, unregister, delete msgs
router.delete('/:id', (req, res) => {
  const g = getRegisteredGroup(req.params.id);
  if (!g || g.kind !== 'web') return res.status(404).json({ error: 'Thread not found' });
  // best-effort: queue.stop/kill for jid if running; remove group folder (group-folder helper);
  // deleteRegisteredGroup(jid); deleteMessagesForJid(jid).
  res.json({ ok: true });
});

export default router;
```

Fill every `//` comment with the real helper calls discovered from the existing code (messages loader, store, delete, queue access, folder removal, current-user name, `deleteRegisteredGroup`). If `deleteRegisteredGroup`/`deleteMessagesForJid` don't exist, add them to `src/db.ts` (small, mirror existing delete helpers) with a quick round-trip test.

- [ ] **Step 4: Mount the router**

In `src/admin/index.ts`, mirror the existing mounts (e.g. line ~242 for sessions):

```ts
import threadsRoutes from './routes/threads.js';
// ...
app.use('/api/threads', requireAuth, threadsRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/admin/routes/threads.test.ts`
Expected: PASS (or bindings-load only — verify logic by inspection if so).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` (expect 0). Then:

```bash
git add src/admin/routes/threads.ts src/admin/routes/threads.test.ts src/admin/index.ts src/db.ts
git commit -m "feat(api): /api/threads CRUD for web conversations"
```

---

## Task 8: Frontend — conversation module + thread sidebar rendering

**Files:**
- Create: `src/admin/public/pages/chat-threads.js`
- Modify: `src/admin/public/index.html` (load the new script, like the other `pages/*.js`)
- Modify: `src/admin/public/app.js` (`renderChat` delegates to the module; chat-mode sidebar renders threads)

> No DOM test harness — verify in the mock server. Read `renderChat` (`src/admin/public/app.js:1560-1814`) first to reuse its message-bubble markup, composer, voice button, progress bar, and especially the `handleWsMessage` patch pattern (`window._chatWsRestore`). Reuse the existing tool-call/tool-result/approval rendering helpers already used by the chat/cockpit (grep for `tool_call`, `approval` render helpers in app.js).

- [ ] **Step 1: Add the script tag**

In `src/admin/public/index.html`, after the other `pages/*.js` defer scripts, add:

```html
  <script defer src="/pages/chat-threads.js?v=2.0.0-beta.1"></script>
```

- [ ] **Step 2: Implement the conversation view module**

Create `src/admin/public/pages/chat-threads.js` exposing globals on `window` (classic script, like other pages):

```js
// Web chat threads — conversation view + thread-list rendering for Chat mode.
// API: window.WebChat = { renderConversation, loadThreads, openNewConversationModal, activeThreadId }
(function () {
  let activeThreadId = null;

  async function loadThreads() {
    try { return await api('/threads'); } catch { return []; }
  }

  // Render the thread list HTML for the Chat-mode sidebar.
  function renderThreadList(threads, currentId) {
    const items = threads.map((t) => {
      const active = t.id === currentId ? ' active' : '';
      return `<a class="nav-link${active}" onclick="WebChat.openThread('${t.id}')"><span class="nav-label">${esc(t.title)}</span></a>`;
    }).join('');
    return `
      <a class="nav-link" onclick="WebChat.openNewConversationModal()"><span class="nav-label">＋ New conversation</span></a>
      <div class="thread-list">${items || '<div class="nav-empty">No conversations yet</div>'}</div>
      <a class="nav-link nav-secondary" onclick="navigate('messages')"><span class="nav-label">Channel messages</span></a>`;
  }

  function openThread(id) {
    activeThreadId = id;
    location.hash = '#/chat/' + encodeURIComponent(id.replace(/^web:/, ''));
  }

  // Render the conversation into #page-content for a thread id.
  async function renderConversation(el, threadId) {
    activeThreadId = threadId;
    if (!threadId) {
      el.innerHTML = '<div class="card empty">Start a new conversation</div>';
      return;
    }
    el.innerHTML = '<div class="loading">Loading</div>';
    const msgs = await api('/threads/' + encodeURIComponent(threadId) + '/messages').catch(() => []);
    // Reuse the existing chat bubble + composer markup from renderChat. Build the
    // same structure: a #chat-messages-area, progress bar, and composer whose send
    // handler POSTs to /threads/:id/messages instead of /chat/send.
    // Patch handleWsMessage exactly like renderChat does, but FILTER events to
    // msg.data.chat_jid === threadId (new_message, tool_call, tool_result,
    // approval_request, task_progress). Restore via window._chatWsRestore on exit.
    // ... (mirror renderChat lines 1585-1790, swapping the send endpoint + jid filter)
  }

  async function openNewConversationModal() {
    const templates = await api('/threads/agent-templates').catch(() => []);
    // Render a modal: list templates (radio), an "Advanced" toggle revealing
    // provider + model inputs, a title input, and Create/Cancel buttons.
    // On Create: POST /threads with { templateAgentId } or { provider, model, title };
    // remember last choice in localStorage('webchat_last_template'); then openThread(id).
  }

  window.WebChat = {
    loadThreads, renderThreadList, openThread, renderConversation,
    openNewConversationModal, get activeThreadId() { return activeThreadId; },
  };
})();
```

Fill in the two `// ...` regions with real code copied/adapted from `renderChat` (bubbles, composer, progress, ws patch) — the only changes are (a) POST to `/threads/:id/messages`, (b) filter WS events by `chat_jid === threadId`, and (c) the modal. Keep the tool-call/approval rendering identical to the existing chat.

- [ ] **Step 3: Manual verification (after Task 9 wires it)**

Deferred to Task 9 (needs the sidebar + routing). Commit now:

```bash
git add src/admin/public/pages/chat-threads.js src/admin/public/index.html
git commit -m "feat(ui): web chat conversation module + thread list rendering"
```

---

## Task 9: Frontend — chat-mode sidebar + thread routing in the shell

**Files:**
- Modify: `src/admin/public/app.js` (`showShell` chat-mode branch; `renderChat`; router `navigate`/`hashchange`/init for `#/chat/:id`)

> Read `showShell` (the mode-scoped nav builder added in the mode-first work, where `navItems`/`filteredNavItems` are built and `navHtml` rendered) and the router block (`window.navigate`, `hashchange`, init IIFE) before editing. Locate edits by source strings.

- [ ] **Step 1: Render the thread list in the Chat-mode sidebar**

In `showShell`, where `navHtml` is produced for the mode-scoped section, special-case Chat mode: when `activeMode === 'chat'`, render the thread list instead of the page links. Because thread loading is async, render a placeholder synchronously then hydrate:

```js
  let navHtml;
  if (activeMode === 'chat' && window.WebChat) {
    navHtml = '<div id="chat-thread-nav"><div class="loading">Loading</div></div>';
  } else {
    navHtml = filteredNavItems
      .map((item) => `<a class="nav-link ${page === item.id ? 'active' : ''}" onclick="navigate('${item.id}')">${navIcon(item.icon)}<span class="nav-label">${item.label}</span></a>`)
      .join('');
  }
```

After `app.innerHTML = ...` is set (end of showShell), add a hydration call:

```js
  if (activeMode === 'chat' && window.WebChat) {
    const navEl = document.getElementById('chat-thread-nav');
    if (navEl) {
      window.WebChat.loadThreads().then((threads) => {
        navEl.innerHTML = window.WebChat.renderThreadList(threads, window.WebChat.activeThreadId);
      });
    }
  }
```

- [ ] **Step 2: Route `#/chat/:id` to the conversation view**

In the router, parse a thread id out of the hash. Update `window.navigate` / `hashchange` / init so that a hash of the form `#/chat/<id>`:
- sets `currentPage = 'chat'` (so chat mode + sidebar render), and
- renders the conversation for `web:<id>` into `#page-content`.

Concretely, in the `hashchange` handler and init, before `canonicalPage`, detect the chat-thread form:

```js
function routeFromHash() {
  const raw = window.location.hash.replace(/^#\//, '');
  if (raw === 'chat' || raw.startsWith('chat/')) {
    const rest = raw.slice('chat'.length).replace(/^\//, '');
    const threadId = rest ? 'web:' + decodeURIComponent(rest) : null;
    showShell('chat');
    const el = document.getElementById('page-content');
    if (window.WebChat) window.WebChat.renderConversation(el, threadId);
    return true;
  }
  return false;
}
```

Call `routeFromHash()` at the top of the `hashchange` listener and the init landing; if it returns true, skip the normal `pages[p]` path. Ensure `navigate('chat')` produces hash `#/chat` (no thread) → empty/most-recent state. (When entering Chat mode with threads present, optionally auto-open the newest by having `renderConversation(el, null)` redirect to the first thread from `loadThreads()`.)

- [ ] **Step 3: Point the chat page render at the module**

Ensure the `chat` entry still works when reached without a thread: in `_pageMap`/`pages`, `chat` can keep mapping to a thin wrapper that calls `window.WebChat.renderConversation(el, null)`. Simplest: in `renderChat`, replace its body with a delegation:

```js
function renderChat(el) {
  if (window.WebChat) return window.WebChat.renderConversation(el, window.WebChat.activeThreadId);
  el.innerHTML = '<div class="card empty">Chat unavailable</div>';
}
```

(Preserve the old `renderChat` implementation only if any non-thread caller needs it; otherwise this delegation replaces it. The raw channel feed remains available via the `messages` page.)

- [ ] **Step 4: Manual verification (mock server)**

Create `.claude/launch.json` already exists (`mock-admin`). Run `npm run mock:admin` (or use the preview tool). Verify:
- Chat mode sidebar shows "＋ New conversation" + (empty) thread list + "Channel messages".
- New conversation modal lists agent templates + Advanced; creating one opens an empty thread and adds it to the sidebar; URL becomes `#/chat/<id>`.
- Sending a message posts to `/threads/:id/messages` (check Network) and the user bubble appears.
- Switching threads swaps the conversation; deep-linking `#/chat/<id>` reload lands on that thread.
- Work/Code sidebars are unchanged; no console errors.

(Agent replies require a live container runtime; in mock mode the reply may be simulated or absent — verify the request path and UI, not the agent output, here.)

- [ ] **Step 5: Commit**

```bash
git add src/admin/public/app.js
git commit -m "feat(ui): chat-mode thread sidebar + #/chat/:id routing"
```

---

## Task 10: Styling for thread list + new-conversation modal

**Files:**
- Modify: `src/admin/public/style.css`

- [ ] **Step 1: Add styles**

Append a `/* --- Web chat threads --- */` section. Grep existing tokens first (`grep -n "^\s*--[a-z]" src/admin/public/style.css | head -40`) and reuse the real theme variables (the mode-first work used `--surface`, `--surface2`, `--surface3`, `--border`, `--text`, `--text-secondary`, `--text-muted`, `--accent`, `--accent-glow`, `--radius-sm`). Style: `.thread-list` (scroll area), `.nav-empty`/`.nav-secondary` (muted), and a modal (`.modal-overlay`, `.modal`, `.modal-actions`) matching the existing `.more-drawer`/card visual language. If a modal style already exists in the file, reuse it instead of adding a new one (grep `modal`).

- [ ] **Step 2: Verify braces balance + manual check**

Run: `node -e "const c=require('fs').readFileSync('src/admin/public/style.css','utf8');const o=(c.match(/{/g)||[]).length,cl=(c.match(/}/g)||[]).length;process.exit(o===cl?0:1)" && echo balanced`
Then re-check in the mock server that the sidebar list + modal look consistent across a couple themes.

- [ ] **Step 3: Commit**

```bash
git add src/admin/public/style.css
git commit -m "style(ui): thread list + new-conversation modal"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: New tests pass**

Run: `npx vitest run src/web-threads.test.ts src/channels/web.test.ts`
Expected: PASS. (DB/route tests: PASS, or bindings-load-only failure — confirm no assertion failures by reading output.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Full suite — no NEW failures**

Run: `npm test 2>&1 | grep "Tests "`
Expected: failures ≤ the pre-existing 150 sqlite-binding baseline; no new failing files attributable to this change (check that any failures are bindings-load errors).

- [ ] **Step 4: Live reachability sweep (mock server)**

Run the mock admin server and verify end to end: create threads against a template and via Advanced custom; rename; delete (gone from sidebar); deep-link reload; confirm web threads do NOT appear on the Groups page, Channels page, dashboard channel health, or Integrations. Confirm Work/Code modes unaffected. No console errors.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "test: verify web chat threads end to end"
```

---

## Self-Review Notes

- **Spec coverage:** web channel (T4, no-op send confirmed), thread = isolated kind:'web' group (T1–T3), config clone from template or custom (T3, T7), `/api/threads` CRUD + agent-templates (T7), separation from channels/groups/health/integrations (T6), Chat-mode sidebar thread list + "Channel messages" secondary (T8, T9), `#/chat/:id` routing (T9), conversation view with inline tool/approval/progress via WS filtered by jid (T8), new-conversation modal with Advanced override + remembered choice (T8), rename/delete + cleanup (T7), styling (T10), testing (T1–T7 unit, T11 sweep). ✔
- **Double-write avoided:** web channel `sendMessage` is a no-op; reply persistence/broadcast stays in `src/index.ts` (T4). ✔
- **Runtime untouched:** filtering applies only to display/management/health listings, never `processGroupMessages` (T6 explicit). ✔
- **Naming consistency:** `kind:'web'`, `title`, `isWebJid`, `newWebJid`, `buildThreadGroup`, `getWebThreads`, `getNonWebRegisteredGroups`, `createWebChannel`, `window.WebChat`, `/api/threads` used consistently across tasks. ✔
- **Assumptions to verify during execution (flagged in-task):** exact DB migration helper form (T2); whether startup instantiates all channel factories (T5); exact message load/store/delete + queue + folder-removal helper names (T7); reuse of existing modal styles (T10); whether `deleteRegisteredGroup`/`deleteMessagesForJid` exist (T7 adds them if not).
- **Environmental caveat documented:** the `better-sqlite3` bindings failure means DB-touching tests may not assert in this environment; tasks instruct writing+running them anyway and verifying logic by inspection.
