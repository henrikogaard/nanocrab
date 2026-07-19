import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import express from 'express';

const _TEST_DIR = path.join(
  os.tmpdir(),
  `nanocrab-sessions-test-${Date.now()}`,
);

vi.mock('../../config.js', () => ({
  SESSIONS_DIR: path.join(os.tmpdir(), `nanocrab-sessions-test-${Date.now()}`),
  STORE_DIR: path.join(
    os.tmpdir(),
    `nanocrab-sessions-test-store-${Date.now()}`,
  ),
  DATA_DIR: path.join(os.tmpdir(), `nanocrab-sessions-test-data-${Date.now()}`),
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

// Re-import paths after mock
const config = vi.mocked(await import('../../config.js'));
const SESSIONS_DIR = config.SESSIONS_DIR as string;
const DATA_DIR = config.DATA_DIR as string;
const STORE_DIR = config.STORE_DIR as string;
const { default: sessionsRouter, listCockpitSessions } =
  await import('./sessions.js');
const { broadcastTaskProgress, loadHistoricalSessions, listTerminalSessions } =
  await import('../websocket.js');

function transcriptId(group: string, sessionId: string): string {
  return `transcript:${encodeURIComponent(group)}:${encodeURIComponent(sessionId)}`;
}

function writeTranscript(
  group: string,
  sessionId: string,
  events: Array<Record<string, unknown>>,
): void {
  const transcriptDir = path.join(
    DATA_DIR,
    'sessions',
    group,
    '.agents',
    'projects',
    '-workspace-group',
  );
  fs.mkdirSync(transcriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(transcriptDir, `${sessionId}.jsonl`),
    events.map((event) => JSON.stringify(event)).join('\n') + '\n',
  );
}

async function withSessionsServer<T>(
  role: 'viewer' | 'admin' | 'owner',
  handler: (baseUrl: string) => Promise<T>,
  username: string = role,
): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: username, username, role };
    next();
  });
  app.use('/api/sessions', sessionsRouter);
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

describe('terminal session API', () => {
  beforeEach(() => {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SESSIONS_DIR, 'index.json'),
      JSON.stringify(
        [
          {
            id: 'term-1',
            name: 'term-1',
            owner: 'owner',
            createdAt: '2026-06-01T12:00:00Z',
            endedAt: '2026-06-01T13:00:00Z',
            bytes: 100,
          },
          {
            id: 'term-2',
            name: 'term-2',
            owner: 'owner',
            createdAt: '2026-06-02T12:00:00Z',
            endedAt: null,
            bytes: 50,
          },
          {
            id: 'legacy-term',
            name: 'legacy-term',
            createdAt: '2026-05-01T12:00:00Z',
            endedAt: '2026-05-01T13:00:00Z',
            bytes: 24,
          },
        ],
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(SESSIONS_DIR, 'term-1.log'),
      'line1\nline2\nerror: something failed\nline4\n',
    );
    fs.writeFileSync(
      path.join(SESSIONS_DIR, 'term-2.log'),
      'startup\nrunning\n',
    );
    fs.writeFileSync(
      path.join(SESSIONS_DIR, 'legacy-term.log'),
      'legacy read-only transcript\n',
    );
  });

  afterEach(() => {
    fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
  });

  it('GET /terminal/history returns session list from index', () => {
    const indexPath = path.join(SESSIONS_DIR, 'index.json');
    const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    expect(data).toHaveLength(3);
    expect(data[0].id).toBe('term-1');
    expect(data[1].id).toBe('term-2');
  });

  it('GET /terminal/:id/transcript returns file content', () => {
    const content = fs.readFileSync(
      path.join(SESSIONS_DIR, 'term-1.log'),
      'utf-8',
    );
    expect(content).toContain('error: something failed');
    expect(content).toContain('line1');
  });

  it('POST /terminal/search finds matching lines', () => {
    const query = 'error';
    const content = fs.readFileSync(
      path.join(SESSIONS_DIR, 'term-1.log'),
      'utf-8',
    );
    const lines = content.split('\n');
    const matches = lines
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter((l) => l.text.toLowerCase().includes(query.toLowerCase()));
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(3);
  });

  it('POST /terminal/search returns empty for no matches', () => {
    const query = 'nonexistent';
    const files = fs
      .readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith('.log'));
    let totalMatches = 0;
    for (const file of files) {
      const content = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8');
      const lines = content.split('\n');
      totalMatches += lines.filter((l) =>
        l.toLowerCase().includes(query),
      ).length;
    }
    expect(totalMatches).toBe(0);
  });

  it('returns 404 for missing session transcript', () => {
    const logPath = path.join(SESSIONS_DIR, 'nonexistent.log');
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('filters by date', () => {
    const _query = 'running';
    const dateFrom = '2026-06-02T00:00:00Z';
    const index = JSON.parse(
      fs.readFileSync(path.join(SESSIONS_DIR, 'index.json'), 'utf-8'),
    );
    const matching = index.filter((e: any) => {
      if (dateFrom && e.createdAt && e.createdAt < dateFrom) return false;
      return true;
    });
    expect(matching).toHaveLength(1);
    expect(matching[0].id).toBe('term-2');
  });

  it('GET /terminal/history returns owned terminal metadata through the route', async () => {
    await withSessionsServer('owner', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/terminal/history`);
      const history = (await response.json()) as Array<{
        id: string;
        owner: string;
        active: boolean;
        recoveryState: string;
        restorable: boolean;
      }>;

      expect(response.status).toBe(200);
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'term-1',
            owner: 'owner',
            active: false,
            recoveryState: 'historical',
            restorable: false,
          }),
          expect.objectContaining({
            id: 'term-2',
            recoveryState: 'interrupted',
            restorable: false,
          }),
        ]),
      );
    });
  });

  it('POST /terminal/search returns context and enforces owner role', async () => {
    await withSessionsServer('owner', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/terminal/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'error' }),
      });
      const data = (await response.json()) as {
        results: Array<{ sessionId: string; line: number; context: string }>;
      };

      expect(response.status).toBe(200);
      expect(data.results).toEqual([
        expect.objectContaining({
          sessionId: 'term-1',
          line: 3,
          context: expect.stringContaining('line2'),
        }),
      ]);
    });

    await withSessionsServer('viewer', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/terminal/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'error' }),
      });

      expect(response.status).toBe(403);
    });
  });

  it('DELETE /terminal/:id removes an existing session and enforces owner role', async () => {
    loadHistoricalSessions();
    await withSessionsServer('owner', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/terminal/term-1`, {
        method: 'DELETE',
      });
      const data = (await response.json()) as { deleted: string };
      expect(response.status).toBe(200);
      expect(data.deleted).toBe('term-1');

      const index = JSON.parse(
        fs.readFileSync(path.join(SESSIONS_DIR, 'index.json'), 'utf-8'),
      ) as Array<{ id: string }>;
      expect(index.map((e) => e.id)).not.toContain('term-1');
      expect(fs.existsSync(path.join(SESSIONS_DIR, 'term-1.log'))).toBe(false);
      expect(listTerminalSessions().map((session) => session.id)).not.toContain(
        'term-1',
      );
    });

    await withSessionsServer('viewer', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/terminal/term-2`, {
        method: 'DELETE',
      });
      expect(response.status).toBe(403);
    });
  });

  it('DELETE /terminal/:id returns 404 for unknown and 400 for unsafe ids', async () => {
    await withSessionsServer('owner', async (baseUrl) => {
      const missing = await fetch(
        `${baseUrl}/api/sessions/terminal/does-not-exist`,
        { method: 'DELETE' },
      );
      expect(missing.status).toBe(404);

      const unsafe = await fetch(
        `${baseUrl}/api/sessions/terminal/${encodeURIComponent('../escape')}`,
        { method: 'DELETE' },
      );
      expect(unsafe.status).toBe(400);
    });
  });

  it('GET /terminal/:id/transcript blocks unsafe session ids', async () => {
    await withSessionsServer('owner', async (baseUrl) => {
      const encodedUnsafeId = encodeURIComponent('../term-1');
      const response = await fetch(
        `${baseUrl}/api/sessions/terminal/${encodedUnsafeId}/transcript`,
      );
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid session id');
    });
  });

  it('enforces session ownership across every HTTP terminal operation', async () => {
    await withSessionsServer(
      'owner',
      async (baseUrl) => {
        const historyResponse = await fetch(
          `${baseUrl}/api/sessions/terminal/history`,
        );
        const history = (await historyResponse.json()) as Array<{ id: string }>;
        expect(historyResponse.status).toBe(200);
        expect(history.map((entry) => entry.id)).toEqual(['legacy-term']);

        const transcript = await fetch(
          `${baseUrl}/api/sessions/terminal/term-1/transcript`,
        );
        expect(transcript.status).toBe(403);
        expect(await transcript.text()).not.toContain('something failed');

        const targetedSearch = await fetch(
          `${baseUrl}/api/sessions/terminal/search`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: 'error', sessionId: 'term-1' }),
          },
        );
        expect(targetedSearch.status).toBe(403);
        expect(await targetedSearch.text()).not.toContain('something failed');

        const globalSearch = await fetch(
          `${baseUrl}/api/sessions/terminal/search`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: 'error' }),
          },
        );
        expect(globalSearch.status).toBe(200);
        expect(await globalSearch.json()).toEqual({ results: [] });

        const deletion = await fetch(
          `${baseUrl}/api/sessions/terminal/term-1`,
          { method: 'DELETE' },
        );
        expect(deletion.status).toBe(403);
        expect(fs.existsSync(path.join(SESSIONS_DIR, 'term-1.log'))).toBe(true);

        const legacyTranscript = await fetch(
          `${baseUrl}/api/sessions/terminal/legacy-term/transcript`,
        );
        expect(legacyTranscript.status).toBe(200);
        expect(await legacyTranscript.json()).toEqual({
          id: 'legacy-term',
          content: 'legacy read-only transcript\n',
        });

        const legacyDeletion = await fetch(
          `${baseUrl}/api/sessions/terminal/legacy-term`,
          { method: 'DELETE' },
        );
        expect(legacyDeletion.status).toBe(403);
      },
      'second-owner',
    );
  });

  it('denies transcript disclosure and deletion for disk-only orphan logs', async () => {
    const orphanPath = path.join(SESSIONS_DIR, 'disk-only-orphan.log');
    fs.writeFileSync(orphanPath, 'orphan private output\n');

    await withSessionsServer('owner', async (baseUrl) => {
      const transcript = await fetch(
        `${baseUrl}/api/sessions/terminal/disk-only-orphan/transcript`,
      );
      expect(transcript.status).toBe(403);
      expect(await transcript.text()).not.toContain('orphan private output');

      const deletion = await fetch(
        `${baseUrl}/api/sessions/terminal/disk-only-orphan`,
        { method: 'DELETE' },
      );
      expect(deletion.status).toBe(403);
      expect(fs.existsSync(orphanPath)).toBe(true);
    });
  });

  it('lists cockpit session summaries with stable fields from transcripts', () => {
    writeTranscript('main', 'run-1', [
      {
        type: 'user',
        timestamp: '2026-06-01T12:00:00Z',
        content: 'Implement cockpit dashboard',
      },
      {
        type: 'assistant',
        timestamp: '2026-06-01T12:02:00Z',
        message: {
          model: 'gpt-5.4',
          content: [
            { type: 'text', text: 'Editing dashboard files' },
            {
              type: 'tool_use',
              name: 'edit',
              input: { file_path: 'src/admin/public/pages/dashboard.js' },
            },
          ],
        },
      },
    ]);

    const sessions = listCockpitSessions();
    const session = sessions.find(
      (item) => item.id === transcriptId('main', 'run-1'),
    );
    expect(session).toMatchObject({
      id: transcriptId('main', 'run-1'),
      sessionId: 'run-1',
      source: 'transcript',
      group: 'main',
      model: 'gpt-5.4',
      status: 'completed',
      startedAt: '2026-06-01T12:00:00Z',
      updatedAt: '2026-06-01T12:02:00Z',
      lastEventAt: '2026-06-01T12:02:00Z',
      approvalCount: 0,
      artifactCount: 1,
      currentStep: 'Editing dashboard files',
    });
    expect(session?.changedFiles).toEqual([
      'src/admin/public/pages/dashboard.js',
    ]);
  });

  it('GET /cockpit/:id/stream returns recent progress events for the session group', async () => {
    writeTranscript('main', 'run-stream', [
      {
        type: 'assistant',
        timestamp: '2026-06-01T12:00:00Z',
        content: 'Preparing progress stream',
      },
    ]);
    broadcastTaskProgress({
      phase: 'testing',
      pct: 72,
      message: 'Running stream tests',
      groupJid: 'main',
    });

    const app = express();
    app.use('/api/sessions', sessionsRouter);
    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('test server did not bind to a port');
      }
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/sessions/cockpit/${encodeURIComponent(transcriptId('main', 'run-stream'))}/stream`,
      );
      const stream = (await response.json()) as {
        events: Array<{ type: string; phase?: string; pct?: number }>;
      };

      expect(response.status).toBe(200);
      expect(stream.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'progress',
            phase: 'testing',
            pct: 72,
          }),
        ]),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('keeps duplicate transcript session ids globally unique by group', async () => {
    const event = {
      type: 'assistant',
      timestamp: '2026-06-01T12:00:00Z',
      content: 'Shared upstream session id',
    };
    writeTranscript('main', 'shared-id', [event]);
    writeTranscript('operations', 'shared-id', [event]);

    const sessions = listCockpitSessions().filter(
      (item) => item.sessionId === 'shared-id',
    );
    expect(sessions).toHaveLength(2);
    expect(new Set(sessions.map((item) => item.id))).toEqual(
      new Set([
        transcriptId('main', 'shared-id'),
        transcriptId('operations', 'shared-id'),
      ]),
    );

    const app = express();
    app.use('/api/sessions', sessionsRouter);
    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('test server did not bind to a port');
      }
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/sessions/cockpit/${encodeURIComponent(transcriptId('operations', 'shared-id'))}`,
      );
      const detail = (await response.json()) as { group: string; id: string };

      expect(response.status).toBe(200);
      expect(detail).toMatchObject({
        id: transcriptId('operations', 'shared-id'),
        group: 'operations',
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('does not mark transcript text about fixed errors as failed', () => {
    writeTranscript('main', 'error-discussion', [
      {
        type: 'assistant',
        timestamp: '2026-06-01T12:00:00Z',
        content: 'Fixed error handling and approval wording in the dashboard.',
      },
    ]);

    const session = listCockpitSessions().find(
      (item) => item.id === transcriptId('main', 'error-discussion'),
    );
    expect(session).toMatchObject({
      status: 'completed',
      approvalCount: 0,
    });
  });

  it('includes persisted coding jobs in cockpit summaries', () => {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STORE_DIR, 'coding-jobs.json'),
      JSON.stringify([
        {
          id: 'job-approval',
          repo: 'owner/repo',
          type: 'issue',
          prompt: 'Fix issue #8',
          issueNumber: 8,
          issueTitle: 'Cockpit Foundation',
          provider: 'codex',
          model: 'gpt-5.4',
          status: 'await_approval',
          branch: 'feature/cockpit',
          workspace: '/tmp/workspace',
          createPr: true,
          prUrl: null,
          commitSha: null,
          changedFiles: ['src/admin/routes/sessions.ts'],
          testSummary: null,
          ciStatus: 'unknown',
          approvalHistory: [
            { action: 'requested', at: '2026-06-01T12:00:00Z', by: 'system' },
          ],
          output: 'Waiting for approval',
          requestedBy: 'owner',
          createdAt: '2026-06-01T11:59:00Z',
          completedAt: null,
        },
      ]),
    );

    const session = listCockpitSessions().find(
      (item) => item.id === 'job-approval',
    );
    expect(session).toMatchObject({
      id: 'job-approval',
      group: 'owner/repo',
      provider: 'codex',
      model: 'gpt-5.4',
      status: 'waiting_approval',
      approvalCount: 1,
      artifactCount: 1,
      changedFiles: ['src/admin/routes/sessions.ts'],
      currentStep: 'Cockpit Foundation',
    });
  });

  it('GET /cockpit/:id returns coding-job detail approvals and artifacts', async () => {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STORE_DIR, 'coding-jobs.json'),
      JSON.stringify([
        {
          id: 'job-detail',
          repo: 'owner/repo',
          type: 'issue',
          prompt: 'Fix issue #8',
          issueNumber: 8,
          issueTitle: 'Cockpit Foundation',
          provider: 'codex',
          model: 'gpt-5.4',
          status: 'await_pr_approval',
          branch: 'feature/cockpit',
          workspace: '/tmp/workspace',
          createPr: true,
          prUrl: 'https://github.com/owner/repo/pull/8',
          commitSha: null,
          changedFiles: [
            'src/admin/routes/sessions.ts',
            'src/admin/public/pages/dashboard.js',
          ],
          testSummary: null,
          ciStatus: 'unknown',
          approvalHistory: [
            { action: 'requested', at: '2026-06-01T12:00:00Z', by: 'system' },
          ],
          output: 'Waiting for PR approval',
          requestedBy: 'owner',
          createdAt: '2026-06-01T11:59:00Z',
          completedAt: null,
        },
      ]),
    );
    fs.writeFileSync(
      path.join(STORE_DIR, 'approvals.json'),
      JSON.stringify([
        {
          id: 'approval-persisted',
          kind: 'coding-open-pr',
          title: 'Open PR',
          summary: 'Approve opening the PR',
          risk: 'medium',
          requester: 'system',
          targetType: 'coding-job',
          targetId: 'job-detail',
          payload: {},
          status: 'pending',
          createdAt: '2026-06-01T12:03:00Z',
          reviewedAt: null,
          reviewedBy: null,
          decisionNote: null,
        },
        {
          id: 'approval-unrelated',
          kind: 'publish',
          title: 'Unrelated publish approval',
          summary: 'Same target id but wrong subsystem',
          risk: 'high',
          requester: 'system',
          targetType: 'publish',
          targetId: 'job-detail',
          payload: {},
          status: 'pending',
          createdAt: '2026-06-01T12:04:00Z',
          reviewedAt: null,
          reviewedBy: null,
          decisionNote: null,
        },
      ]),
    );

    const app = express();
    app.use('/api/sessions', sessionsRouter);
    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('test server did not bind to a port');
      }
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/sessions/cockpit/job-detail`,
      );
      const detail = (await response.json()) as {
        approvals: unknown[];
        artifacts: unknown[];
        deliverables: unknown[];
      };

      expect(response.status).toBe(200);
      expect(detail).toMatchObject({
        id: 'job-detail',
        status: 'waiting_approval',
        approvalCount: 2,
        artifactCount: 3,
      });
      expect(detail.approvals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'job-detail-approval-history-1' }),
          expect.objectContaining({ id: 'approval-persisted' }),
        ]),
      );
      expect(detail.approvals).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'approval-unrelated' }),
        ]),
      );
      expect(detail.artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'src/admin/routes/sessions.ts',
            kind: 'changed-file',
          }),
          expect.objectContaining({
            path: 'src/admin/public/pages/dashboard.js',
            kind: 'changed-file',
          }),
          expect.objectContaining({
            path: 'https://github.com/owner/repo/pull/8',
            kind: 'pull-request',
          }),
        ]),
      );
      expect(detail.deliverables).toEqual([
        expect.objectContaining({
          id: 'job-detail-deliverable-pr',
          title: 'Pull request',
          status: 'pending',
          sourceType: 'coding-job',
          externalUrl: 'https://github.com/owner/repo/pull/8',
        }),
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
