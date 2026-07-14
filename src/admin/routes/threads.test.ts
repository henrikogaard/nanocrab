import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import express from 'express';

const STORE_DIR = path.join(os.tmpdir(), `nanocrab-threads-test-${Date.now()}`);
const DATA_DIR = path.join(os.tmpdir(), `nanocrab-threads-data-${Date.now()}`);
const GROUPS_DIR = path.join(
  os.tmpdir(),
  `nanocrab-threads-groups-${Date.now()}`,
);

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
  getAllChats,
  getChatProject,
  createChatProject,
  createCoworkProject,
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
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
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

  it('POST / with provider/model creates custom web group', async () => {
    const result = await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai-responses',
          model: 'gpt-4.1',
        }),
      });
      expect(res.status).toBe(200);
      return res.json() as Promise<{ id: string }>;
    });

    expect(result.id).toMatch(/^web:/);
    const stored = getRegisteredGroup(result.id);
    expect(stored!.kind).toBe('web');
    expect(stored!.requiresTrigger).toBe(false);
    expect(stored!.title).toBeUndefined();
    expect((stored!.containerConfig as any)?.provider).toBe('openai-responses');
    expect((stored!.containerConfig as any)?.model).toBe('gpt-4.1');
    expect((stored!.containerConfig as any)?.allowedMcpServers).toEqual([]);
  });

  it('POST / creates pure chat threads without external MCP access by default', async () => {
    const result = await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Simple question' }),
      });
      expect(res.status).toBe(200);
      return res.json() as Promise<{ id: string }>;
    });

    expect(getRegisteredGroup(result.id)?.containerConfig).toEqual({
      allowedMcpServers: [],
    });
  });

  it('POST / gives regular web chats configured external MCP access scoped to that thread', async () => {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STORE_DIR, 'mcp-servers.json'),
      JSON.stringify([
        { name: 'nanocrab', core: true },
        {
          name: 'infomaniak',
          command: 'npx',
          args: ['-y', '@henrikogard/infomaniak-mcp'],
        },
      ]),
    );

    const result = await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Inbox check' }),
      });
      expect(res.status).toBe(200);
      return res.json() as Promise<{ id: string }>;
    });

    expect(getRegisteredGroup(result.id)?.containerConfig).toEqual({
      allowedMcpServers: ['infomaniak'],
    });
    const folder = getRegisteredGroup(result.id)?.folder;

    const permissions = JSON.parse(
      fs.readFileSync(
        path.join(STORE_DIR, 'connector-permissions.json'),
        'utf-8',
      ),
    );
    expect(permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectorId: 'infomaniak',
          scope: 'groups',
          allowedActions: ['*.read', 'tools.expose'],
          requiresApproval: true,
          groups: [folder],
        }),
      ]),
    );
  });

  it('POST / does not claim MCP access when existing permissions are out of scope', async () => {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STORE_DIR, 'mcp-servers.json'),
      JSON.stringify([
        {
          name: 'infomaniak',
          command: 'npx',
          args: ['-y', '@henrikogard/infomaniak-mcp'],
        },
      ]),
    );
    fs.writeFileSync(
      path.join(STORE_DIR, 'connector-permissions.json'),
      JSON.stringify([
        {
          connectorId: 'infomaniak',
          scope: 'main',
          allowedActions: ['*.read', 'tools.expose'],
          requiresApproval: true,
          groups: [],
          agents: [],
          createdAt: '2026-06-13T10:00:00.000Z',
          updatedAt: '2026-06-13T10:00:00.000Z',
        },
      ]),
    );

    const result = await withServer('admin', async (base) => {
      const createRes = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Inbox check' }),
      });
      expect(createRes.status).toBe(200);
      const created = (await createRes.json()) as { id: string };
      const detailRes = await fetch(
        `${base}/api/threads/${encodeURIComponent(created.id)}`,
      );
      expect(detailRes.status).toBe(200);
      return detailRes.json() as Promise<{
        mcpAccess: { enabled: boolean; servers: string[] };
      }>;
    });

    expect(result.mcpAccess.enabled).toBe(false);
    expect(result.mcpAccess.servers).toEqual([]);
  });

  it('POST / preserves an explicit title when provided', async () => {
    const result = await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'codex',
          model: 'gpt-5.4',
          title: 'Launch notes',
        }),
      });
      expect(res.status).toBe(200);
      return res.json() as Promise<{ id: string }>;
    });

    expect(getRegisteredGroup(result.id)!.title).toBe('Launch notes');
  });

  it('POST / treats a blank title as absent so chats can be auto-titled', async () => {
    const result = await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'codex',
          model: 'gpt-5.4',
          title: '   ',
        }),
      });
      expect(res.status).toBe(200);
      return res.json() as Promise<{ id: string }>;
    });

    expect(getRegisteredGroup(result.id)!.title).toBeUndefined();
  });

  it('POST /projects creates a virtual Chat project for grouping conversations', async () => {
    const project = await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Weather and fishing' }),
      });
      expect(res.status).toBe(200);
      return res.json() as Promise<{
        id: string;
        name: string;
        createdAt: string;
        updatedAt: string;
        threadCount: number;
      }>;
    });

    expect(project.name).toBe('Weather and fishing');
    expect(project.threadCount).toBe(0);
    expect(getChatProject(project.id)?.name).toBe('Weather and fishing');
  });

  it('POST / can assign a plain Chat thread to a virtual project', async () => {
    const created = await withServer('admin', async (base) => {
      const projectRes = await fetch(`${base}/api/threads/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Home planning' }),
      });
      expect(projectRes.status).toBe(200);
      const project = (await projectRes.json()) as { id: string };

      const threadRes = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Paint colors',
          chatProjectId: project.id,
        }),
      });
      expect(threadRes.status).toBe(200);
      return {
        project,
        thread: (await threadRes.json()) as { id: string },
      };
    });

    const stored = getRegisteredGroup(created.thread.id);
    expect(stored?.projectId).toBeUndefined();
    expect(stored?.chatProjectId).toBe(created.project.id);
  });

  it('PATCH /:id moves an existing Chat thread into a virtual project', async () => {
    const moved = await withServer('admin', async (base) => {
      const projectRes = await fetch(`${base}/api/threads/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Trip planning' }),
      });
      expect(projectRes.status).toBe(200);
      const project = (await projectRes.json()) as { id: string };

      const threadRes = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Flights' }),
      });
      expect(threadRes.status).toBe(200);
      const thread = (await threadRes.json()) as { id: string };

      const moveRes = await fetch(
        `${base}/api/threads/${encodeURIComponent(thread.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chatProjectId: project.id }),
        },
      );
      expect(moveRes.status).toBe(200);
      return { project, thread };
    });

    expect(getRegisteredGroup(moved.thread.id)?.chatProjectId).toBe(
      moved.project.id,
    );
  });

  it('PATCH /:id can remove a Chat thread from its virtual project', async () => {
    setRegisteredGroup('web:loose-thread', {
      name: 'Web Conversation',
      title: 'Loose',
      kind: 'web',
      folder: 'web-loose-thread',
      trigger: '^',
      added_at: '2026-07-09T09:00:00.000Z',
      requiresTrigger: false,
      chatProjectId: 'chat-project-old',
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/web%3Aloose-thread`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatProjectId: null }),
      });
      expect(res.status).toBe(200);
    });

    expect(
      getRegisteredGroup('web:loose-thread')?.chatProjectId,
    ).toBeUndefined();
  });

  it('GET /projects includes Chat projects with their virtual-folder threads', async () => {
    const now = '2026-07-09T09:00:00.000Z';
    const project = {
      id: 'chat-project-weather',
      name: 'Weather',
      created_at: now,
      updated_at: now,
    };
    createChatProject(project);
    setRegisteredGroup('web:weather-thread', {
      name: 'Web Conversation',
      title: 'Vaeret i Stavanger',
      kind: 'web',
      folder: 'web-weather-thread',
      trigger: '^',
      added_at: now,
      requiresTrigger: false,
      chatProjectId: project.id,
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/projects`);
      expect(res.status).toBe(200);
      const list = (await res.json()) as {
        projects: Array<{
          id: string;
          name: string;
          threadCount: number;
          threads: Array<{ id: string; title: string; chatProjectId: string }>;
        }>;
      };

      expect(list.projects).toEqual([
        expect.objectContaining({
          id: 'chat-project-weather',
          name: 'Weather',
          threadCount: 1,
          threads: [
            expect.objectContaining({
              id: 'web:weather-thread',
              title: 'Vaeret i Stavanger',
              chatProjectId: 'chat-project-weather',
            }),
          ],
        }),
      ]);
    });
  });

  it('GET /:id reports Cowork project MCP access, including restricted connector scopes', async () => {
    const now = new Date().toISOString();
    const project = createCoworkProject({
      id: 'project-mail-docs',
      name: 'Mail Briefs',
      slug: 'mail-briefs',
      description: null,
      instructions: null,
      created_at: now,
      updated_at: now,
    });
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STORE_DIR, 'connector-permissions.json'),
      JSON.stringify([
        {
          connectorId: 'gmail',
          scope: 'main',
          allowedActions: ['mail.read', 'tools.expose'],
          requiresApproval: true,
          groups: [],
          agents: [],
          createdAt: now,
          updatedAt: now,
        },
        {
          connectorId: 'google-docs',
          scope: 'main',
          allowedActions: ['document.write', 'tools.expose'],
          requiresApproval: true,
          groups: [],
          agents: [],
          createdAt: now,
          updatedAt: now,
        },
      ]),
    );
    setRegisteredGroup('web:project-mail-docs-thread', {
      name: 'Web Conversation',
      title: 'Sender summary',
      folder: 'web-project-mail-docs-thread',
      trigger: '^',
      added_at: now,
      requiresTrigger: false,
      enabled: true,
      kind: 'web',
      projectId: project.id,
      projectSlug: project.slug,
      containerConfig: {
        allowedMcpServers: ['gmail', 'google-docs'],
      } as any,
    });

    const meta = await withServer('admin', async (base) => {
      const res = await fetch(
        `${base}/api/threads/web%3Aproject-mail-docs-thread`,
      );
      expect(res.status).toBe(200);
      return res.json() as Promise<{
        projectId: string;
        projectName: string;
        mcpAccess: {
          enabled: boolean;
          scope: string;
          servers: string[];
          requiresApprovalForWrites: boolean;
          examples: string[];
        };
      }>;
    });

    expect(meta.projectId).toBe(project.id);
    expect(meta.projectName).toBe('Mail Briefs');
    expect(meta.mcpAccess).toEqual({
      enabled: true,
      scope: 'restricted',
      servers: ['gmail', 'google-docs'],
      writesEnabled: true,
      requiresApprovalForWrites: true,
      examples: [
        'Latest emails -> sourced project summary',
        'Emails from a person or domain -> commitments and follow-ups',
        'External MCP context -> local markdown document draft',
        'Project files plus MCP evidence -> source ledger and artifact',
      ],
    });
  });

  it('GET /:id refreshes configured MCP access before reporting metadata', async () => {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STORE_DIR, 'mcp-servers.json'),
      JSON.stringify([
        {
          name: 'infomaniak',
          command: 'npx',
          args: ['-y', '@henrikogard/infomaniak-mcp'],
        },
      ]),
    );
    setRegisteredGroup('web:stale-mcp-thread', {
      name: 'Web Conversation',
      title: 'Inbox',
      kind: 'web',
      folder: 'web-stale-mcp-thread',
      trigger: '^',
      added_at: '2026-06-15T12:00:00Z',
      requiresTrigger: false,
      containerConfig: {
        allowedMcpServers: [],
      } as any,
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/web:stale-mcp-thread`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        mcpAccess: { enabled: boolean; servers: string[] };
      };
      expect(body.mcpAccess.enabled).toBe(true);
      expect(body.mcpAccess.servers).toEqual(['infomaniak']);
    });
  });

  it('GET /:id does not report write approval needs when connector writes are not enabled', async () => {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STORE_DIR, 'connector-permissions.json'),
      JSON.stringify([
        {
          connectorId: 'infomaniak',
          scope: 'groups',
          allowedActions: ['*.read', 'tools.expose'],
          requiresApproval: false,
          groups: ['web-read-only-mcp-thread'],
          agents: [],
          createdAt: '2026-06-13T10:00:00.000Z',
          updatedAt: '2026-06-13T10:00:00.000Z',
        },
      ]),
    );
    setRegisteredGroup('web:read-only-mcp-thread', {
      name: 'Web Conversation',
      title: 'Read only',
      kind: 'web',
      folder: 'web-read-only-mcp-thread',
      trigger: '^',
      added_at: '2026-06-15T12:00:00Z',
      requiresTrigger: false,
      containerConfig: {
        allowedMcpServers: ['infomaniak'],
      } as any,
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/web:read-only-mcp-thread`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        mcpAccess: {
          enabled: boolean;
          writesEnabled: boolean;
          requiresApprovalForWrites: boolean;
        };
      };
      expect(body.mcpAccess.enabled).toBe(true);
      expect(body.mcpAccess.writesEnabled).toBe(false);
      expect(body.mcpAccess.requiresApprovalForWrites).toBe(false);
    });
  });

  it('POST / rejects agent templates for plain web chat threads', async () => {
    setRegisteredGroup('wa:template@g.us', {
      name: 'TemplateAgent',
      folder: 'template-agent',
      trigger: '!',
      added_at: '2026-06-01T00:00:00Z',
      containerConfig: {
        provider: 'claude',
        model: 'claude-sonnet-4-6',
      } as any,
    });

    const before = Object.keys(getWebThreads()).length;

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateAgentId: 'wa:template@g.us' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe(
        'Agent templates are not supported for chat threads',
      );
    });

    expect(Object.keys(getWebThreads()).length).toBe(before);
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

  it('GET / excludes project-scoped web threads from plain chat', async () => {
    setRegisteredGroup('web:plain-thread', {
      name: 'Web Conversation',
      title: 'Plain thread',
      kind: 'web',
      folder: 'web-plain-thread',
      trigger: '^',
      added_at: '2026-06-15T11:00:00Z',
      requiresTrigger: false,
    });
    setRegisteredGroup('web:project-thread', {
      name: 'Web Conversation',
      title: 'Project thread',
      kind: 'web',
      folder: 'web-project-thread',
      trigger: '^',
      added_at: '2026-06-15T12:00:00Z',
      requiresTrigger: false,
      projectId: 'project-1',
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads`);
      expect(res.status).toBe(200);
      const list = (await res.json()) as Array<{ id: string }>;

      expect(list.map((thread) => thread.id)).toEqual(['web:plain-thread']);
    });
  });

  it('GET /:id returns project metadata for project-scoped web threads', async () => {
    const now = '2026-06-01T00:00:00Z';
    const project = createCoworkProject({
      id: 'project-thread-meta',
      name: 'Inbox Briefs',
      slug: 'inbox-briefs',
      description: null,
      instructions: null,
      created_at: now,
      updated_at: now,
    });
    setRegisteredGroup('web:project-thread-detail', {
      name: 'Web Conversation',
      title: '',
      kind: 'web',
      folder: 'web-project-thread-detail',
      trigger: '^',
      added_at: now,
      requiresTrigger: false,
      projectId: project.id,
      projectSlug: project.slug,
    });

    await withServer('admin', async (base) => {
      const res = await fetch(`${base}/api/threads/web:project-thread-detail`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        id: string;
        title: string;
        projectId: string;
        projectSlug: string;
        projectName: string;
        mcpAccess: {
          enabled: boolean;
          scope: string;
          servers: string[] | null;
          requiresApprovalForWrites: boolean;
          examples: string[];
        };
      };
      expect(body).toMatchObject({
        id: 'web:project-thread-detail',
        title: 'New conversation',
        projectId: 'project-thread-meta',
        projectSlug: 'inbox-briefs',
        projectName: 'Inbox Briefs',
        mcpAccess: {
          enabled: true,
          scope: 'configured',
          servers: null,
          requiresApprovalForWrites: true,
          examples: expect.arrayContaining([
            'Latest emails -> sourced project summary',
            'External MCP context -> local markdown document draft',
          ]),
        },
      });
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
    expect(
      getAllChats().find((chat) => chat.jid === 'web:rename-me')?.name,
    ).toBe('New title');
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
      const res = await fetch(
        `${base}/api/threads/web:msg-test-thread/messages`,
      );
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
      const res = await fetch(
        `${base}/api/threads/web:does-not-exist-xyz/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: 'hi' }),
        },
      );
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
      const res = await fetch(
        `${base}/api/threads/web:send-msg-thread/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: 'hi' }),
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    });
  });

  it('POST /:id/messages refreshes MCP access for project-scoped Cowork chats', async () => {
    const now = '2026-06-01T00:00:00Z';
    const project = createCoworkProject({
      id: 'project-thread-mcp-refresh',
      name: 'Inbox Documents',
      slug: 'inbox-documents',
      description: null,
      instructions: null,
      created_at: now,
      updated_at: now,
    });
    setRegisteredGroup('web:project-mcp-refresh', {
      name: 'Web Conversation',
      title: 'Email summary',
      kind: 'web',
      folder: 'web-project-mcp-refresh',
      trigger: '^',
      added_at: now,
      requiresTrigger: false,
      projectId: project.id,
      projectSlug: project.slug,
      containerConfig: { allowedMcpServers: [] },
    });
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STORE_DIR, 'mcp-servers.json'),
      JSON.stringify([
        { name: 'gmail', command: 'npx', args: ['-y', '@example/gmail-mcp'] },
        {
          name: 'google-docs',
          command: 'npx',
          args: ['-y', '@example/google-docs-mcp'],
        },
        { name: 'nanocrab', core: true },
      ]),
    );

    await withServer('admin', async (base) => {
      const res = await fetch(
        `${base}/api/threads/web:project-mcp-refresh/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message:
              'Check the latest emails and create a source-backed project summary.',
          }),
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        mcpAccess: { enabled: boolean; servers: string[] };
      };
      expect(body.mcpAccess).toMatchObject({
        enabled: true,
        servers: ['gmail', 'google-docs'],
      });
    });

    const refreshed = getRegisteredGroup('web:project-mcp-refresh');
    expect(refreshed?.containerConfig?.allowedMcpServers).toEqual([
      'gmail',
      'google-docs',
    ]);
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
