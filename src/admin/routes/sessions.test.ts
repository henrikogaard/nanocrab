import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import express from 'express';

const TEST_DIR = path.join(os.tmpdir(), `nanocrab-sessions-test-${Date.now()}`);

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
  });

  afterEach(() => {
    fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
  });

  it('GET /terminal/history returns session list from index', () => {
    const indexPath = path.join(SESSIONS_DIR, 'index.json');
    const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    expect(data).toHaveLength(2);
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
    const query = 'running';
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

  it('lists cockpit session summaries with stable fields from transcripts', () => {
    const transcriptDir = path.join(
      DATA_DIR,
      'sessions',
      'main',
      '.agents',
      'projects',
      '-workspace-group',
    );
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.writeFileSync(
      path.join(transcriptDir, 'run-1.jsonl'),
      [
        JSON.stringify({
          type: 'user',
          timestamp: '2026-06-01T12:00:00Z',
          content: 'Implement cockpit dashboard',
        }),
        JSON.stringify({
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
        }),
      ].join('\n') + '\n',
    );

    const sessions = listCockpitSessions();
    const session = sessions.find((item) => item.id === 'run-1');
    expect(session).toMatchObject({
      id: 'run-1',
      sessionId: 'run-1',
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
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
