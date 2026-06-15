import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import express from 'express';

const STORE_DIR = path.join(os.tmpdir(), `nanocrab-threads-test-${Date.now()}`);
const DATA_DIR = path.join(os.tmpdir(), `nanocrab-threads-data-${Date.now()}`);
const GROUPS_DIR = path.join(os.tmpdir(), `nanocrab-threads-groups-${Date.now()}`);

vi.mock('../../config.js', () => ({
  STORE_DIR,
  DATA_DIR,
  GROUPS_DIR,
  ASSISTANT_NAME: 'Assistant',
}));

vi.mock('../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Mock getState so queue operations don't throw in tests
vi.mock('../state.js', () => ({
  getState: () => {
    throw new Error('state not initialized');
  },
}));

// Dynamic imports after mocks are hoisted
const { _initTestDatabase, _closeDatabase } = await import('../../db.js');
const { default: threadsRouter } = await import('./threads.js');
const {
  setRegisteredGroup,
  getRegisteredGroup,
  getWebThreads,
  getNonWebRegisteredGroups,
} = await import('../../db.js');

function buildApp(role: 'viewer' | 'admin' | 'owner' = 'admin') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: role, username: role, role };
    next();
  });
  app.use('/api/threads', threadsRouter);
  return app;
}

async function withServer<T>(
  role: 'viewer' | 'admin' | 'owner',
  handler: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const app = buildApp(role);
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('test server did not bind to a port');
    }
    return await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('/api/threads CRUD', () => {
  beforeEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* may not be initialized */
    }
    _initTestDatabase();
  });

  afterEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* ok */
    }
  });

  // ------- POST / -------

  it('POST / with templateAgentId creates a web group', async () => {
    // Insert a non-web template group first
    setRegisteredGroup('wa:123@g.us', {
      name: 'MyAgent',
      folder: 'myagent',
      trigger: '!',
      added_at: '2026-06-01T00:00:00Z',
      containerConfig: { provider: 'claude', model: 'claude-3-5-sonnet' } as any,
    });

    const result = await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateAgentId: 'wa:123@g.us', title: 'Test thread' }),
      });
      expect(res.status).toBe(200);
      return res.json() as Promise<{ id: string }>;
    });

    expect(result.id).toMatch(/^web:/);

    const stored = getRegisteredGroup(result.id);
    expect(stored).toBeDefined();
    expect(stored!.kind).toBe('web');
    expect(stored!.requiresTrigger).toBe(false);
    expect(stored!.title).toBe('Test thread');
    // Config cloned from template
    expect((stored!.containerConfig as any)?.provider).toBe('claude');
    expect((stored!.containerConfig as any)?.model).toBe('claude-3-5-sonnet');
  });

  it('POST / with provider/model creates custom web group', async () => {
    const result = await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', model: 'gpt-4o' }),
      });
      expect(res.status).toBe(200);
      return res.json() as Promise<{ id: string }>;
    });

    expect(result.id).toMatch(/^web:/);
    const stored = getRegisteredGroup(result.id);
    expect(stored!.kind).toBe('web');
    expect(stored!.requiresTrigger).toBe(false);
    expect((stored!.containerConfig as any)?.provider).toBe('openai');
    expect((stored!.containerConfig as any)?.model).toBe('gpt-4o');
  });

  it('POST / with bad templateAgentId returns 400 and creates no group', async () => {
    const before = Object.keys(getWebThreads()).length;

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateAgentId: 'nonexistent:jid' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Unknown agent template');
    });

    expect(Object.keys(getWebThreads()).length).toBe(before);
  });

  it('POST / with web-kind templateAgentId returns 400', async () => {
    setRegisteredGroup('web:fake-template', {
      name: 'Web Conversation',
      title: 'Fake',
      kind: 'web',
      folder: 'web-fake-template',
      trigger: '^',
      added_at: '2026-06-01T00:00:00Z',
      requiresTrigger: false,
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateAgentId: 'web:fake-template' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ------- GET / -------

  it('GET / lists web threads and not real groups', async () => {
    setRegisteredGroup('wa:real@g.us', {
      name: 'RealGroup',
      folder: 'realgroup',
      trigger: '!',
      added_at: '2026-06-01T00:00:00Z',
    });
    setRegisteredGroup('web:aaa-bbb', {
      name: 'Web Conversation',
      title: 'My Chat',
      kind: 'web',
      folder: 'web-aaa-bbb',
      trigger: '^',
      added_at: '2026-06-10T00:00:00Z',
      requiresTrigger: false,
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads`);
      expect(res.status).toBe(200);
      const list = (await res.json()) as Array<{
        id: string;
        title: string;
        addedAt: string;
        lastMessage: string | null;
        lastMessageAt: string | null;
      }>;

      const ids = list.map((t) => t.id);
      expect(ids).toContain('web:aaa-bbb');
      expect(ids).not.toContain('wa:real@g.us');

      const thread = list.find((t) => t.id === 'web:aaa-bbb')!;
      expect(thread.title).toBe('My Chat');
      expect(thread.lastMessage).toBeNull();
    });
  });

  // ------- GET /agent-templates -------

  it('GET /agent-templates returns non-web groups', async () => {
    setRegisteredGroup('wa:real@g.us', {
      name: 'RealGroup',
      folder: 'realgroup2',
      trigger: '!',
      added_at: '2026-06-01T00:00:00Z',
      containerConfig: { provider: 'claude' } as any,
    });
    setRegisteredGroup('web:excluded', {
      name: 'Web',
      kind: 'web',
      folder: 'web-excluded',
      trigger: '^',
      added_at: '2026-06-01T00:00:00Z',
      requiresTrigger: false,
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/agent-templates`);
      expect(res.status).toBe(200);
      const list = (await res.json()) as Array<{
        id: string;
        label: string;
        provider: string | null;
        model: string | null;
      }>;

      const ids = list.map((t) => t.id);
      expect(ids).toContain('wa:real@g.us');
      expect(ids).not.toContain('web:excluded');

      const tpl = list.find((t) => t.id === 'wa:real@g.us')!;
      expect(tpl.label).toBe('RealGroup');
      expect(tpl.provider).toBe('claude');
      expect(tpl.model).toBeNull();
    });
  });

  // ------- PATCH /:id -------

  it('PATCH /:id renames a web thread', async () => {
    setRegisteredGroup('web:rename-me', {
      name: 'Web Conversation',
      title: 'Old title',
      kind: 'web',
      folder: 'web-rename-me',
      trigger: '^',
      added_at: '2026-06-01T00:00:00Z',
      requiresTrigger: false,
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/web:rename-me`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'New title' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect((body as any).ok).toBe(true);
    });

    const stored = getRegisteredGroup('web:rename-me');
    expect(stored!.title).toBe('New title');
  });

  it('PATCH non-existent thread returns 404', async () => {
    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/web:does-not-exist`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'X' }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ------- DELETE /:id -------

  it('DELETE /:id removes the thread from registered groups', async () => {
    setRegisteredGroup('web:delete-me', {
      name: 'Web Conversation',
      title: 'Temp',
      kind: 'web',
      folder: 'web-delete-me',
      trigger: '^',
      added_at: '2026-06-01T00:00:00Z',
      requiresTrigger: false,
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/web:delete-me`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect((body as any).ok).toBe(true);
    });

    expect(getRegisteredGroup('web:delete-me')).toBeUndefined();
  });

  it('DELETE non-existent thread returns 404', async () => {
    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/web:missing`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });
  });

  it('DELETE non-web jid returns 404', async () => {
    setRegisteredGroup('wa:not-web@g.us', {
      name: 'Not web',
      folder: 'not-web',
      trigger: '!',
      added_at: '2026-06-01T00:00:00Z',
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/wa:not-web@g.us`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });
  });

  // ------- GET /:id/messages -------

  it('GET /:id/messages non-web jid returns 404', async () => {
    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/123@g.us/messages`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Thread not found');
    });
  });

  it('GET /:id/messages for a created web thread returns 200 with an array', async () => {
    setRegisteredGroup('web:msg-test-thread', {
      name: 'Web Conversation',
      title: 'Messages test',
      kind: 'web',
      folder: 'web-msg-test-thread',
      trigger: '^',
      added_at: '2026-06-01T00:00:00Z',
      requiresTrigger: false,
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/web:msg-test-thread/messages`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  // ------- POST /:id/messages -------

  it('POST /:id/messages non-web jid returns 404', async () => {
    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/123@g.us/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'hi' }),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Thread not found');
    });
  });

  it('POST /:id/messages unknown web jid (valid prefix, no group) returns 404', async () => {
    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/web:does-not-exist-xyz/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'hi' }),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Thread not found');
    });
  });

  it('POST /:id/messages valid thread returns 200 {ok:true}', async () => {
    setRegisteredGroup('web:send-msg-thread', {
      name: 'Web Conversation',
      title: 'Send test',
      kind: 'web',
      folder: 'web-send-msg-thread',
      trigger: '^',
      added_at: '2026-06-01T00:00:00Z',
      requiresTrigger: false,
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/web:send-msg-thread/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'hi' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    });
  });

  // ------- PATCH /:id — non-web kind guard -------

  it('PATCH /:id on a non-web group returns 404 and does not rename it', async () => {
    setRegisteredGroup('wa:real-group@g.us', {
      name: 'RealGroup',
      folder: 'real-group-patch-test',
      trigger: '!',
      added_at: '2026-06-01T00:00:00Z',
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/wa:real-group@g.us`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Should not be set' }),
      });
      expect(res.status).toBe(404);
    });

    // Group must still be unchanged (no title was written)
    const stored = getRegisteredGroup('wa:real-group@g.us');
    expect(stored).toBeDefined();
    expect(stored!.title).toBeUndefined();
    expect(stored!.name).toBe('RealGroup');
  });
});
