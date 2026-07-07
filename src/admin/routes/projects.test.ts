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

  it('previews connector actions with approval-aware policy gates', async () => {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STORE_DIR, 'mcp-servers.json'),
      JSON.stringify([
        { name: 'gmail', command: 'npx', args: ['-y', 'gmail'] },
      ]),
    );

    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Action Preview Project' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const threadRes = await fetch(
        `${base}/api/projects/${project.id}/threads`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Seed connector permissions' }),
        },
      );
      expect(threadRes.status).toBe(200);

      const runRes = await fetch(`${base}/api/projects/${project.id}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Email synthesis',
          prompt: 'Research the latest customer emails and summarize findings.',
        }),
      });
      expect(runRes.status).toBe(200);
      const runPayload = (await runRes.json()) as { run: { id: string } };

      const contextRes = await fetch(
        `${base}/api/projects/${project.id}/context`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: 'Sensitive inbox extract',
            sensitivity: 'sensitive',
            source: 'gmail',
          }),
        },
      );
      expect(contextRes.status).toBe(200);

      const readPreviewRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${runPayload.run.id}/actions/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            connectorId: 'gmail',
            action: 'gmail.read',
          }),
        },
      );
      expect(readPreviewRes.status).toBe(200);
      const readPreview = (await readPreviewRes.json()) as {
        preview: {
          allowed: boolean;
          requiresApproval: boolean;
          reason: string;
        };
      };

      const writePreviewRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${runPayload.run.id}/actions/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            connectorId: 'gmail',
            action: 'gmail.write',
          }),
        },
      );
      expect(writePreviewRes.status).toBe(200);
      const writePreview = (await writePreviewRes.json()) as {
        preview: {
          allowed: boolean;
          requiresApproval: boolean;
          reason: string;
        };
      };

      return { readPreview, writePreview };
    });

    expect(result.readPreview.preview).toEqual(
      expect.objectContaining({
        allowed: true,
        requiresApproval: true,
      }),
    );
    expect(result.readPreview.preview.reason).toContain('approval');
    expect(result.writePreview.preview).toEqual(
      expect.objectContaining({
        allowed: false,
        requiresApproval: true,
      }),
    );
    expect(result.writePreview.preview.reason).toContain('not allowed');
  });

  it('returns 403 for disallowed connector action requests without mutating the run', async () => {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STORE_DIR, 'mcp-servers.json'),
      JSON.stringify([
        { name: 'gmail', command: 'npx', args: ['-y', 'gmail'] },
      ]),
    );

    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Disallowed Action Request Project' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const threadRes = await fetch(
        `${base}/api/projects/${project.id}/threads`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Seed connector permissions' }),
        },
      );
      expect(threadRes.status).toBe(200);

      const runRes = await fetch(`${base}/api/projects/${project.id}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Read inbox',
          prompt: 'Read project inbox updates and summarize findings.',
        }),
      });
      expect(runRes.status).toBe(200);
      const runPayload = (await runRes.json()) as { run: { id: string } };

      const requestRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${runPayload.run.id}/actions/request`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            connectorId: 'gmail',
            action: 'gmail.write',
            note: 'Attempt to send update',
          }),
        },
      );
      expect(requestRes.status).toBe(403);
      const requestPayload = (await requestRes.json()) as {
        error: string;
        preview: { allowed: boolean; reason: string };
      };

      const runDetailRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${runPayload.run.id}`,
      );
      expect(runDetailRes.status).toBe(200);
      const runDetail = (await runDetailRes.json()) as {
        run: { status: string; approvals: unknown[]; events: unknown[] };
      };

      return { requestPayload, runDetail };
    });

    expect(result.requestPayload.error).toContain('not allowed');
    expect(result.requestPayload.preview).toEqual(
      expect.objectContaining({
        allowed: false,
      }),
    );
    expect(result.runDetail.run.status).toBe('planning');
    expect(result.runDetail.run.approvals).toEqual([]);
    expect(result.runDetail.run.events).toHaveLength(1);
  });

  it('creates approval-gated connector action requests and moves run to waiting_for_approval', async () => {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STORE_DIR, 'mcp-servers.json'),
      JSON.stringify([
        { name: 'gmail', command: 'npx', args: ['-y', 'gmail'] },
      ]),
    );

    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Approval Action Request Project' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const threadRes = await fetch(
        `${base}/api/projects/${project.id}/threads`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Seed connector permissions' }),
        },
      );
      expect(threadRes.status).toBe(200);

      const runRes = await fetch(`${base}/api/projects/${project.id}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Inbox summary',
          prompt: 'Summarize recent inbox messages.',
        }),
      });
      expect(runRes.status).toBe(200);
      const runPayload = (await runRes.json()) as { run: { id: string } };

      const requestRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${runPayload.run.id}/actions/request`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            connectorId: 'gmail',
            action: 'gmail.read',
            note: 'Need explicit approval before reading inbox',
          }),
        },
      );
      expect(requestRes.status).toBe(202);
      return requestRes.json() as Promise<{
        requested: boolean;
        approvalRequired: boolean;
        preview: { allowed: boolean; requiresApproval: boolean };
        run: {
          status: string;
          approvals: Array<{
            kind: string;
            status: string;
            connectorId: string;
            action: string;
            note: string;
            requestedAt: string;
            sensitivitySignals: { includedSensitiveItems: number };
          }>;
          events: Array<{ kind: string; message: string }>;
        };
      }>;
    });

    expect(result).toEqual(
      expect.objectContaining({
        requested: true,
        approvalRequired: true,
      }),
    );
    expect(result.preview).toEqual(
      expect.objectContaining({
        allowed: true,
        requiresApproval: true,
      }),
    );
    expect(result.run.status).toBe('waiting_for_approval');
    expect(result.run.approvals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'connector-action',
          status: 'pending',
          connectorId: 'gmail',
          action: 'gmail.read',
          note: 'Need explicit approval before reading inbox',
          sensitivitySignals: expect.objectContaining({
            includedSensitiveItems: 0,
          }),
        }),
      ]),
    );
    expect(result.run.approvals[0]?.requestedAt).toEqual(expect.any(String));
    expect(result.run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'action-requested',
        }),
      ]),
    );
    expect(result.run.events[result.run.events.length - 1]?.message).toContain(
      'gmail.read',
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

  it('tracks cowork runs and project context notebook items', async () => {
    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Run Notebook Project' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const runRes = await fetch(`${base}/api/projects/${project.id}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Draft launch brief',
          prompt: 'Review context and prepare launch brief with risks.',
        }),
      });
      expect(runRes.status).toBe(200);
      const runPayload = (await runRes.json()) as {
        run: {
          id: string;
          status: string;
          intent: { mode: string; requiresCitations: boolean };
        };
      };
      expect(runPayload.run.status).toBe('planning');
      expect(runPayload.run.intent).toEqual(
        expect.objectContaining({
          mode: 'execution',
          requiresCitations: false,
        }),
      );

      const patchRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${runPayload.run.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'checkpoint',
            message: 'Waiting for approval before external send',
          }),
        },
      );
      expect(patchRes.status).toBe(200);
      const patched = (await patchRes.json()) as { run: { status: string } };
      expect(patched.run.status).toBe('waiting_for_approval');

      const contextCreateRes = await fetch(
        `${base}/api/projects/${project.id}/context`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: 'Q2 launch source links',
            source: 'mail + docs',
            kind: 'note',
          }),
        },
      );
      expect(contextCreateRes.status).toBe(200);
      const contextCreate = (await contextCreateRes.json()) as {
        item: { id: string; included: number };
      };
      expect(contextCreate.item.included).toBe(1);

      const contextPatchRes = await fetch(
        `${base}/api/projects/${project.id}/context/${contextCreate.item.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pinned: true, included: false }),
        },
      );
      expect(contextPatchRes.status).toBe(200);
      const contextPatched = (await contextPatchRes.json()) as {
        item: { pinned: number; included: number };
      };
      expect(contextPatched.item.pinned).toBe(1);
      expect(contextPatched.item.included).toBe(0);

      const detailRes = await fetch(`${base}/api/projects/${project.id}`);
      expect(detailRes.status).toBe(200);
      const detail = (await detailRes.json()) as {
        project: {
          capabilities: {
            skills: { total: number };
            plugins: { total: number };
            connectors: { total: number };
          };
        };
        runs: Array<{
          id: string;
          status: string;
          intent: { mode: string; requiresCitations: boolean };
        }>;
        contextItems: Array<{ id: string; autoGenerated: number }>;
      };

      return {
        detail,
        runId: runPayload.run.id,
        contextId: contextCreate.item.id,
        projectId: project.id,
      };
    });

    expect(result.detail.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: result.runId,
          status: 'waiting_for_approval',
          intent: expect.objectContaining({
            mode: 'execution',
            requiresCitations: false,
          }),
        }),
      ]),
    );
    expect(result.detail.contextItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: result.contextId,
          autoGenerated: 0,
        }),
      ]),
    );
    expect(result.detail.project.capabilities).toEqual(
      expect.objectContaining({
        skills: expect.objectContaining({ total: expect.any(Number) }),
        plugins: expect.objectContaining({ total: expect.any(Number) }),
        connectors: expect.objectContaining({ total: expect.any(Number) }),
      }),
    );
  });

  it('tracks research citation coverage and allows adding citations', async () => {
    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Research Coverage Project' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const runRes = await fetch(`${base}/api/projects/${project.id}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Research references',
          prompt:
            'Research market updates, gather sources, and include citations with evidence.',
        }),
      });
      expect(runRes.status).toBe(200);
      const runPayload = (await runRes.json()) as {
        run: {
          id: string;
          intent: { mode: string };
          researchCoverage: {
            citationCount: number;
            status: string;
            guidance: string;
          };
        };
      };
      expect(runPayload.run.intent.mode).toBe('research');
      expect(runPayload.run.researchCoverage).toEqual(
        expect.objectContaining({
          citationCount: 0,
          status: 'missing',
          guidance: expect.stringContaining('Add at least 3 citations'),
        }),
      );

      const citationRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${runPayload.run.id}/research/citations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: 'Q2 market outlook',
            sourceUrl: 'https://example.com/research/q2-market-outlook',
            note: 'Primary baseline source',
          }),
        },
      );
      expect(citationRes.status).toBe(200);
      const citationPayload = (await citationRes.json()) as {
        run: {
          outputs: Array<{ kind?: string; title?: string; sourceUrl?: string }>;
          researchCoverage: {
            citationCount: number;
            status: string;
          };
        };
      };
      expect(citationPayload.run.outputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'citation',
            title: 'Q2 market outlook',
            sourceUrl: 'https://example.com/research/q2-market-outlook',
          }),
        ]),
      );
      expect(citationPayload.run.researchCoverage).toEqual(
        expect.objectContaining({
          citationCount: 1,
          status: 'partial',
        }),
      );

      const invalidCitationRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${runPayload.run.id}/research/citations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: 'Unsafe source',
            sourceUrl: 'javascript:alert(1)',
          }),
        },
      );
      expect(invalidCitationRes.status).toBe(400);
      await expect(invalidCitationRes.json()).resolves.toEqual(
        expect.objectContaining({
          error: expect.stringContaining('http:// or https://'),
        }),
      );

      const groupedCitationRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${runPayload.run.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            outputs: JSON.stringify([
              {
                kind: 'research-bundle',
                title: 'Topline report',
                sourceUrl: 'https://example.com/topline',
                citations: [
                  {
                    title: 'Source 1',
                    sourceUrl: 'https://example.com/source-1',
                  },
                  {
                    title: 'Source 2',
                    sourceUrl: 'https://example.com/source-2',
                  },
                  {
                    title: 'Source 3',
                    sourceUrl: 'https://example.com/source-3',
                  },
                ],
              },
            ]),
          }),
        },
      );
      expect(groupedCitationRes.status).toBe(200);
      const groupedCitationPayload = (await groupedCitationRes.json()) as {
        run: { researchCoverage: { citationCount: number; status: string } };
      };
      expect(groupedCitationPayload.run.researchCoverage).toEqual(
        expect.objectContaining({
          citationCount: 4,
          status: 'sufficient',
        }),
      );

      const escapedCitationRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${runPayload.run.id}/research/citations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: 'Doc ](x)',
            sourceUrl: 'https://example.com/research/(q1)',
            note: 'Use [alpha](beta) and keep (draft) context',
          }),
        },
      );
      expect(escapedCitationRes.status).toBe(200);

      const exportLedgerRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${runPayload.run.id}/research/export-ledger`,
        {
          method: 'POST',
        },
      );
      expect(exportLedgerRes.status).toBe(200);
      const exportLedgerPayload = (await exportLedgerRes.json()) as {
        file: { path: string };
        contextItem: { path: string };
      };
      expect(exportLedgerPayload.file.path).toBe(
        `research/run-${runPayload.run.id}-citations.md`,
      );
      expect(exportLedgerPayload.contextItem.path).toBe(
        `research/run-${runPayload.run.id}-citations.md`,
      );

      const ledgerReadRes = await fetch(
        `${base}/api/projects/${project.id}/files/read?path=${encodeURIComponent(
          `research/run-${runPayload.run.id}-citations.md`,
        )}`,
      );
      expect(ledgerReadRes.status).toBe(200);
      const ledgerReadPayload = (await ledgerReadRes.json()) as {
        file: { content: string };
      };
      expect(ledgerReadPayload.file.content).toContain(
        '- [Doc \\]\\(x\\)](https://example.com/research/%28q1%29)',
      );
      expect(ledgerReadPayload.file.content).toContain(
        '  - Note: Use \\[alpha\\]\\(beta\\) and keep \\(draft\\) context',
      );

      const detailRes = await fetch(`${base}/api/projects/${project.id}`);
      expect(detailRes.status).toBe(200);
      const detail = (await detailRes.json()) as {
        files: Array<{ path: string; kind: string }>;
        contextItems: Array<{
          path: string | null;
          source: string;
          autoGenerated: number;
        }>;
      };
      expect(detail.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: `research/run-${runPayload.run.id}-citations.md`,
          }),
        ]),
      );
      expect(detail.contextItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: `research/run-${runPayload.run.id}-citations.md`,
            source: 'run-citations',
            autoGenerated: 0,
          }),
        ]),
      );

      const contextRes = await fetch(
        `${base}/api/projects/${project.id}/context`,
      );
      expect(contextRes.status).toBe(200);
      const contextPayload = (await contextRes.json()) as {
        contextItems: Array<{
          path: string | null;
          source: string;
          autoGenerated: number;
        }>;
      };
      expect(contextPayload.contextItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: `research/run-${runPayload.run.id}-citations.md`,
            source: 'run-citations',
            autoGenerated: 0,
          }),
        ]),
      );
      return groupedCitationPayload;
    });

    expect(result.run.researchCoverage.status).not.toBe('missing');
  });
});
