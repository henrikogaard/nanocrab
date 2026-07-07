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
const { listApprovals } = await import('../../approvals.js');
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

  it('creates, lists, updates, retries, and cancels Cowork runs with estimates', async () => {
    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Delegated Work' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const estimateRes = await fetch(
        `${base}/api/projects/${project.id}/estimate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: 'Summarize latest emails into a brief',
            prompt:
              'Use approved mail MCP tools, create a markdown artifact, and ask before sending anything.',
            provider: 'codex',
            model: 'gpt-5.4',
          }),
        },
      );
      expect(estimateRes.status).toBe(200);
      const estimate = (await estimateRes.json()) as {
        estimate: {
          complexity: string;
          approvalRisk: string;
          provider: string;
          model: string;
          warnings: string[];
        };
      };

      const runRes = await fetch(`${base}/api/projects/${project.id}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Latest email brief',
          prompt:
            'Use approved mail MCP tools, create a markdown artifact, and ask before sending anything.',
          provider: 'codex',
          model: 'gpt-5.4',
        }),
      });
      expect(runRes.status).toBe(200);
      const { run } = (await runRes.json()) as {
        run: {
          id: string;
          title: string;
          status: string;
          complexity: string;
          approvalRisk: string;
          provider: string;
          model: string;
          steps: Array<{ title: string; status: string }>;
          events: Array<{ kind: string; message: string }>;
        };
      };

      const retryRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${run.id}/retry`,
        { method: 'POST' },
      );
      expect(retryRes.status).toBe(200);

      const cancelRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${run.id}/cancel`,
        { method: 'POST' },
      );
      expect(cancelRes.status).toBe(200);

      const listRes = await fetch(`${base}/api/projects/${project.id}/runs`);
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as {
        runs: Array<{ id: string; status: string }>;
      };

      const detailRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${run.id}`,
      );
      expect(detailRes.status).toBe(200);
      const detail = (await detailRes.json()) as {
        run: { id: string; status: string; events: Array<{ kind: string }> };
      };

      return { estimate, run, list, detail };
    });

    expect(result.estimate.estimate).toMatchObject({
      complexity: 'connector-heavy',
      approvalRisk: 'high',
      provider: 'codex',
      model: 'gpt-5.4',
    });
    expect(result.estimate.estimate.warnings).toContain(
      'Write-capable or external delivery language requires approval before mutation.',
    );
    expect(result.run).toMatchObject({
      title: 'Latest email brief',
      status: 'draft',
      complexity: 'connector-heavy',
      approvalRisk: 'high',
      provider: 'codex',
      model: 'gpt-5.4',
    });
    expect(result.run.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Plan source-backed work' }),
        expect.objectContaining({ title: 'Create local project artifact' }),
      ]),
    );
    expect(result.run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'created' }),
      ]),
    );
    expect(result.list.runs).toEqual([
      expect.objectContaining({ id: result.run.id, status: 'cancelled' }),
    ]);
    expect(result.detail.run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'retry_requested' }),
        expect.objectContaining({ kind: 'cancelled' }),
      ]),
    );
  });

  it('manages Cowork context items and exposes project capabilities', async () => {
    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Context Notebook' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      await fetch(`${base}/api/projects/${project.id}/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: 'docs/source.md',
          content: '# Source',
        }),
      });

      const contextRes = await fetch(
        `${base}/api/projects/${project.id}/context`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'file',
            title: 'Source notes',
            path: 'docs/source.md',
            included: true,
            pinned: true,
            provenance: 'manual-upload',
            sensitivity: 'confidential',
          }),
        },
      );
      expect(contextRes.status).toBe(200);
      const created = (await contextRes.json()) as {
        item: { id: string; title: string };
      };

      const patchRes = await fetch(
        `${base}/api/projects/${project.id}/context/${created.item.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ included: false, sensitivity: 'private' }),
        },
      );
      expect(patchRes.status).toBe(200);

      const listRes = await fetch(`${base}/api/projects/${project.id}/context`);
      expect(listRes.status).toBe(200);
      const context = (await listRes.json()) as {
        items: Array<{
          id: string;
          type: string;
          title: string;
          included: boolean;
          pinned: boolean;
          provenance: string;
          sensitivity: string;
          path?: string;
        }>;
      };

      const capabilityRes = await fetch(
        `${base}/api/projects/${project.id}/capabilities`,
      );
      expect(capabilityRes.status).toBe(200);
      const capabilities = (await capabilityRes.json()) as {
        capabilities: Array<{
          id: string;
          kind: string;
          enabled: boolean;
          readOnly: boolean;
          writeCapable: boolean;
          approvalRequired: boolean;
        }>;
      };

      return { context, capabilities };
    });

    expect(result.context.items).toEqual([
      expect.objectContaining({
        type: 'file',
        title: 'Source notes',
        path: 'docs/source.md',
        included: false,
        pinned: true,
        provenance: 'manual-upload',
        sensitivity: 'private',
      }),
    ]);
    expect(result.capabilities.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'project-files',
          kind: 'files',
          enabled: true,
          readOnly: true,
          writeCapable: true,
          approvalRequired: false,
        }),
        expect.objectContaining({
          id: 'external-writes',
          kind: 'approval',
          enabled: true,
          readOnly: false,
          writeCapable: true,
          approvalRequired: true,
        }),
      ]),
    );
  });

  it('creates source-backed local artifacts for Cowork runs and records their ledger context', async () => {
    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Artifact Workflow' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const runRes = await fetch(`${base}/api/projects/${project.id}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Source-backed brief',
          prompt:
            'Use approved mail MCP context and save a local markdown artifact.',
        }),
      });
      const { run } = (await runRes.json()) as {
        run: { id: string };
      };

      const artifactRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${run.id}/artifacts`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            path: 'documents/source-brief.md',
            content: '# Source brief\n\nFindings.',
            sourceLedger: [
              {
                source: 'gmail',
                purpose: 'latest project email summary',
                query: 'last 7 days',
              },
            ],
          }),
        },
      );
      expect(artifactRes.status).toBe(200);
      const artifact = (await artifactRes.json()) as {
        artifact: { path: string; kind: string; sourceLedger: unknown[] };
        contextItem: { path: string; provenance: string; sensitivity: string };
        run: { events: Array<{ kind: string; metadata: { path?: string } }> };
      };

      const detailRes = await fetch(`${base}/api/projects/${project.id}`);
      const detail = (await detailRes.json()) as {
        files: Array<{ path: string }>;
        context: Array<{ path: string; provenance: string }>;
      };

      return { artifact, detail };
    });

    expect(result.artifact.artifact).toMatchObject({
      path: 'documents/source-brief.md',
      kind: 'document',
      sourceLedger: [
        expect.objectContaining({
          source: 'gmail',
          purpose: 'latest project email summary',
        }),
      ],
    });
    expect(result.artifact.contextItem).toMatchObject({
      path: 'documents/source-brief.md',
      provenance: 'source-ledger',
      sensitivity: 'normal',
    });
    expect(result.artifact.run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'artifact_created',
          metadata: expect.objectContaining({
            path: 'documents/source-brief.md',
          }),
        }),
      ]),
    );
    expect(result.detail.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'documents/source-brief.md' }),
      ]),
    );
    expect(result.detail.context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'documents/source-brief.md',
          provenance: 'source-ledger',
        }),
      ]),
    );
  });

  it('creates or reuses approval records before Cowork external writes', async () => {
    const result = await withServer(async (base) => {
      const createRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Approval Workflow' }),
      });
      const { project } = (await createRes.json()) as {
        project: { id: string };
      };

      const runRes = await fetch(`${base}/api/projects/${project.id}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Publish sourced document',
          prompt: 'Draft locally, then request approval before publishing.',
        }),
      });
      const { run } = (await runRes.json()) as { run: { id: string } };

      const body = {
        action: 'publish-document',
        title: 'Publish source brief',
        summary: 'Publish the local source-backed brief to the document system.',
        resourceSummary: 'documents/source-brief.md -> Google Docs',
        actionPreview: 'mcp__docs__create_document({ title, body })',
        payload: {
          path: 'documents/source-brief.md',
          connector: 'google-docs',
        },
      };

      const firstRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${run.id}/approvals/external-write`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      expect(firstRes.status).toBe(200);
      const first = (await firstRes.json()) as {
        approval: { id: string; status: string; kind: string };
        reused: boolean;
        run: { status: string; events: Array<{ kind: string }> };
      };

      const secondRes = await fetch(
        `${base}/api/projects/${project.id}/runs/${run.id}/approvals/external-write`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const second = (await secondRes.json()) as {
        approval: { id: string };
        reused: boolean;
      };

      return { project, run, first, second };
    });

    expect(result.first).toMatchObject({
      reused: false,
      approval: {
        status: 'pending',
        kind: 'tool-action',
      },
      run: {
        status: 'waiting_for_approval',
        events: expect.arrayContaining([
          expect.objectContaining({ kind: 'approval_required' }),
        ]),
      },
    });
    expect(result.second).toMatchObject({
      reused: true,
      approval: { id: result.first.approval.id },
    });
    expect(
      listApprovals({
        kind: 'tool-action',
        targetType: 'cowork-run',
        targetId: result.run.id,
      }),
    ).toEqual([
      expect.objectContaining({
        id: result.first.approval.id,
        title: 'Publish source brief',
        risk: 'high',
        requester: 'admin',
        targetType: 'cowork-run',
        targetId: result.run.id,
        resourceSummary: 'documents/source-brief.md -> Google Docs',
        payload: expect.objectContaining({
          projectId: result.project.id,
          runId: result.run.id,
          action: 'publish-document',
          connector: 'google-docs',
        }),
      }),
    ]);
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
