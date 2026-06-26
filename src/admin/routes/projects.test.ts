import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import express from 'express';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-projects-test-${Date.now()}`,
);
const DATA_DIR = path.join(os.tmpdir(), `nanocrab-projects-data-${Date.now()}`);
const GROUPS_DIR = path.join(
  os.tmpdir(),
  `nanocrab-projects-groups-${Date.now()}`,
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

vi.mock('../state.js', () => ({
  getState: () => {
    throw new Error('state not initialized');
  },
}));

const { _initTestDatabase, _closeDatabase, getRegisteredGroup } =
  await import('../../db.js');
const { loadConnectorPermissions } =
  await import('../../connector-permissions.js');
const { default: projectsRouter } = await import('./projects.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'admin', username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/projects', projectsRouter);
  return app;
}

async function withServer<T>(
  handler: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const app = buildApp();
  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const listeningServer = app.listen(0, '127.0.0.1', () =>
        resolve(listeningServer),
      );
      listeningServer.on('error', reject);
    },
  );
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

describe('/api/projects', () => {
  beforeEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* may not be initialized */
    }
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(GROUPS_DIR, { recursive: true, force: true });
    _initTestDatabase();
  });

  afterEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* ok */
    }
  });

  it('creates a virtual project and returns it in the list', async () => {
    const created = await withServer(async (base) => {
      const res = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'AuroraDocs',
          description: 'Docs, notes, and drafts for Aurora.',
          instructions: 'Keep the writing crisp.',
        }),
      });
      expect(res.status).toBe(200);
      return res.json() as Promise<{
        project: {
          id: string;
          name: string;
          slug: string;
          path: string;
          mcpAccess: {
            enabled: boolean;
            scope: string;
            setupHint: string;
            requiresApprovalForWrites: boolean;
            examples: string[];
          };
        };
      }>;
    });

    expect(created.project).toMatchObject({
      name: 'AuroraDocs',
      slug: 'auroradocs',
    });
    expect(created.project.path).toContain(path.join('projects', 'auroradocs'));
    expect(created.project.mcpAccess).toMatchObject({
      enabled: false,
      scope: 'nanocrab-only',
      requiresApprovalForWrites: true,
    });
    expect(created.project.mcpAccess.setupHint).toContain(
      'Add a mail, calendar, document, storage, or custom MCP server',
    );
    expect(created.project.mcpAccess.examples).toContain(
      'Summarize the latest project emails into a sourced markdown brief',
    );

    const list = await withServer(async (base) => {
      const res = await fetch(`${base}/api/projects`);
      expect(res.status).toBe(200);
      return res.json() as Promise<{
        projects: Array<{
          id: string;
          chatCount: number;
          fileCount: number;
          mcpAccess: { enabled: boolean; scope: string; examples: string[] };
        }>;
      }>;
    });
    expect(list.projects).toEqual([
      expect.objectContaining({
        id: created.project.id,
        chatCount: 0,
        fileCount: 0,
        mcpAccess: expect.objectContaining({
          enabled: false,
          scope: 'nanocrab-only',
          examples: expect.arrayContaining([
            'Check all emails from a person or domain and extract commitments',
            'Generate a summary document from mail, calendar, document, storage, or custom MCP context',
          ]),
        }),
      }),
    ]);
  });

  it('lists files and project chat history in project detail', async () => {
    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Research Notes' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const fileRes = await fetch(`${base}/api/projects/${project.id}/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: 'docs/brief.md',
          content: '# Brief\n\nStart here.',
        }),
      });
      expect(fileRes.status).toBe(200);

      const chatRes = await fetch(
        `${base}/api/projects/${project.id}/threads`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            provider: 'codex',
            model: 'gpt-5.4',
            title: 'Brief outline',
          }),
        },
      );
      expect(chatRes.status).toBe(200);
      const chat = (await chatRes.json()) as { id: string };

      const detailRes = await fetch(`${base}/api/projects/${project.id}`);
      expect(detailRes.status).toBe(200);
      const detail = (await detailRes.json()) as {
        project: { id: string };
        files: Array<{ path: string; kind: string }>;
        threads: Array<{ id: string; title: string }>;
      };
      return { project, chat, detail };
    });

    expect(result.detail.files).toEqual([
      expect.objectContaining({ path: 'docs/brief.md', kind: 'document' }),
    ]);
    expect(result.detail.threads).toEqual([
      expect.objectContaining({ id: result.chat.id, title: 'Brief outline' }),
    ]);
    const group = getRegisteredGroup(result.chat.id);
    expect(group?.projectId).toBe(result.project.id);
    expect(group?.projectSlug).toBe('research-notes');
    expect(group?.containerConfig?.restrictions).toContain(
      'You may call approved MCP servers when they help the task',
    );
    expect(group?.containerConfig?.restrictions).toContain(
      'Project file manifest:',
    );
    expect(group?.containerConfig?.restrictions).toContain(
      '- docs/brief.md (document, 20 bytes)',
    );
    expect(group?.containerConfig?.restrictions).toContain(
      'creating a document or summary from the latest emails, checking all emails from a sender, generating a source-backed document',
    );
    expect(group?.containerConfig?.restrictions).toContain(
      'Treat MCP source reads as normal Cowork chat work when the tools are exposed',
    );
    expect(group?.containerConfig?.restrictions).toContain(
      'No external MCP servers are configured for this project chat yet',
    );
    expect(group?.containerConfig?.restrictions).toContain(
      'say what is missing instead of inventing external source results',
    );
    expect(group?.containerConfig?.restrictions).toContain(
      'state the source server, search window, sender/topic filter, cited evidence, missing facts, and local project draft path',
    );
    expect(group?.containerConfig?.restrictions).toContain(
      'include a source ledger in the local project draft that names each MCP server, tool call purpose, query window or sender filter, and the exact project files or artifacts created',
    );
    expect(group?.containerConfig?.restrictions).toContain(
      'Writing drafts, summaries, and artifacts inside the project workspace is allowed',
    );
    expect(group?.containerConfig?.restrictions).toContain(
      'External writes, such as publishing or updating third-party documents, sending messages, changing calendar events, or updating third-party data, require approval',
    );
    expect(group?.containerConfig?.allowedMcpServers).toEqual([]);
  });

  it('warns project chats when no source files exist yet', async () => {
    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Empty Source Project' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const chatRes = await fetch(
        `${base}/api/projects/${project.id}/threads`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Needs sources' }),
        },
      );
      expect(chatRes.status).toBe(200);
      return (await chatRes.json()) as { id: string };
    });

    const group = getRegisteredGroup(result.id);
    expect(group?.containerConfig?.restrictions).toContain(
      'Project file manifest: no project files yet',
    );
    expect(group?.containerConfig?.restrictions).toContain(
      'Ask the user to add source material or create a local draft before claiming file-backed evidence.',
    );
  });

  it('keeps generated source-backed documents visible in project context', async () => {
    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Mail Artifact Workflow' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const draftRes = await fetch(`${base}/api/projects/${project.id}/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: 'documents/latest-email-summary.md',
          content: [
            '# Latest email summary',
            '',
            '## Source ledger',
            '',
            '- MCP server: gmail',
            '- Query window: latest inbox messages',
            '- Output: documents/latest-email-summary.md',
          ].join('\n'),
        }),
      });
      expect(draftRes.status).toBe(200);

      const detailRes = await fetch(`${base}/api/projects/${project.id}`);
      expect(detailRes.status).toBe(200);
      return detailRes.json() as Promise<{
        files: Array<{ path: string; kind: string }>;
      }>;
    });

    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'documents/latest-email-summary.md',
          kind: 'document',
        }),
      ]),
    );
  });

  it('scopes project chat MCP access to configured connector servers', async () => {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STORE_DIR, 'mcp-servers.json'),
      JSON.stringify(
        [
          { name: 'gmail', command: 'npx', args: ['-y', '@example/gmail-mcp'] },
          {
            name: 'Google Docs',
            command: 'npx',
            args: ['-y', '@example/google-docs-mcp'],
          },
          {
            name: 'calendar',
            command: 'npx',
            args: ['-y', '@example/calendar-mcp'],
          },
        ],
        null,
        2,
      ),
    );

    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'MCP Briefs' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const chatRes = await fetch(
        `${base}/api/projects/${project.id}/threads`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: 'Latest email summary',
          }),
        },
      );
      expect(chatRes.status).toBe(200);
      return (await chatRes.json()) as {
        id: string;
        allowedMcpServers: string[];
      };
    });

    const group = getRegisteredGroup(result.id);
    expect(result.allowedMcpServers).toEqual([
      'calendar',
      'gmail',
      'google-docs',
    ]);
    expect(group?.containerConfig?.allowedMcpServers).toEqual([
      'calendar',
      'gmail',
      'google-docs',
    ]);
    expect(loadConnectorPermissions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectorId: 'calendar',
          scope: 'main',
          allowedActions: ['*.read', 'tools.expose'],
          requiresApproval: true,
        }),
        expect.objectContaining({
          connectorId: 'gmail',
          scope: 'main',
          allowedActions: ['*.read', 'tools.expose'],
          requiresApproval: true,
        }),
        expect.objectContaining({
          connectorId: 'google-docs',
          scope: 'main',
          allowedActions: ['*.read', 'tools.expose'],
          requiresApproval: true,
        }),
      ]),
    );
    expect(group?.containerConfig?.restrictions).toContain(
      'call the relevant approved MCP tools and save durable drafts or summaries in the project workspace',
    );
    expect(group?.containerConfig?.restrictions).toContain(
      'Configured external MCP servers for this chat: calendar, gmail, google-docs',
    );
    expect(group?.containerConfig?.restrictions).toContain(
      'include a source ledger in the local project draft',
    );
  });

  it('reads project text files without allowing path traversal', async () => {
    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Readable Project' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const fileRes = await fetch(`${base}/api/projects/${project.id}/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: 'docs/summary.md',
          content: '# Summary\n\nProject notes stay inspectable.',
        }),
      });
      expect(fileRes.status).toBe(200);

      const readRes = await fetch(
        `${base}/api/projects/${project.id}/files/read?path=${encodeURIComponent('docs/summary.md')}`,
      );
      expect(readRes.status).toBe(200);

      const traversalRes = await fetch(
        `${base}/api/projects/${project.id}/files/read?path=${encodeURIComponent('../outside.md')}`,
      );
      expect(traversalRes.status).toBe(400);

      const missingRes = await fetch(
        `${base}/api/projects/${project.id}/files/read?path=${encodeURIComponent('docs/missing.md')}`,
      );
      expect(missingRes.status).toBe(404);

      return readRes.json() as Promise<{
        file: {
          path: string;
          content: string;
          previewable: boolean;
          truncated: boolean;
        };
      }>;
    });

    expect(result.file).toMatchObject({
      path: 'docs/summary.md',
      content: '# Summary\n\nProject notes stay inspectable.',
      previewable: true,
      truncated: false,
    });
  });

  it('downloads project files without allowing path traversal', async () => {
    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Downloadable Project' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const fileRes = await fetch(`${base}/api/projects/${project.id}/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: 'artifacts/result.txt',
          content: 'Download this artifact.',
        }),
      });
      expect(fileRes.status).toBe(200);

      const downloadRes = await fetch(
        `${base}/api/projects/${project.id}/files/download?path=${encodeURIComponent('artifacts/result.txt')}`,
      );
      expect(downloadRes.status).toBe(200);

      const traversalRes = await fetch(
        `${base}/api/projects/${project.id}/files/download?path=${encodeURIComponent('../outside.md')}`,
      );
      expect(traversalRes.status).toBe(400);

      return {
        body: await downloadRes.text(),
        disposition: downloadRes.headers.get('content-disposition') || '',
      };
    });

    expect(result.body).toBe('Download this artifact.');
    expect(result.disposition).toContain('attachment;');
    expect(result.disposition).toContain('result.txt');
  });

  it('creates untitled project chats when title is blank', async () => {
    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Inbox Summaries' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const chatRes = await fetch(
        `${base}/api/projects/${project.id}/threads`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: '   ' }),
        },
      );
      expect(chatRes.status).toBe(200);
      return chatRes.json() as Promise<{ id: string }>;
    });

    expect(getRegisteredGroup(result.id)?.title).toBeUndefined();
  });
});
