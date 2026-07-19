import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_DIR = path.join(
  os.tmpdir(),
  `nanocrab-admin-analytics-${Date.now()}`,
);
const HISTORY_PATH = path.join(TEST_DIR, 'briefing-history.json');

vi.mock('../../config.js', () => ({
  STORE_DIR: TEST_DIR,
  MAX_SESSION_RETENTION_DAYS: 90,
}));

vi.mock('../../audit-log.js', () => ({
  redactAuditValue: vi.fn((value: unknown) => value),
}));

vi.mock('../../approvals.js', () => ({
  createApproval: vi.fn(() => ({ id: 'approval-1', status: 'pending' })),
  findPendingApprovalForTarget: vi.fn(() => undefined),
  hasApprovedTarget: vi.fn(() => false),
  listApprovals: vi.fn(() => []),
}));

vi.mock('../security.js', () => ({
  auditLog: vi.fn(),
}));

vi.mock('../middleware.js', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole:
    () =>
    (_req: unknown, _res: unknown, next: () => void): void => {
      next();
    },
}));

const { default: briefingAnalyticsRouter } =
  await import('./briefing-analytics.js');

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use('/briefing-analytics', briefingAnalyticsRouter);
  return server;
}

async function withServer<T>(
  handler: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer(app());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to allocate test server port');
  }
  try {
    return await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

function seedHistory() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const entries = [
    {
      id: 'b-1',
      taskId: 'task-a',
      source: 'scheduled',
      routine: 'daily-briefing',
      mission: 'main',
      groupFolder: 'main',
      channel: 'wa:main',
      status: 'completed',
      delivery: {
        mode: 'chat',
        target: 'wa:main',
        attemptedAt: '2026-01-01T08:00:00.000Z',
        deliveredAt: '2026-01-01T08:00:01.000Z',
        failureContext: null,
      },
      approvalState: 'none',
      latencyMs: 1200,
      retryCount: 0,
      retriedFrom: null,
      redacted: true,
      timestamp: '2026-01-01T08:00:00.000Z',
      resultPreview: null,
    },
    {
      id: 'b-2',
      taskId: 'task-b',
      source: 'manual',
      routine: 'weekly-briefing',
      mission: 'main',
      groupFolder: 'main',
      channel: 'wa:main',
      status: 'failed',
      delivery: {
        mode: 'chat',
        target: 'wa:main',
        attemptedAt: '2026-01-02T08:00:00.000Z',
        deliveredAt: null,
        failureContext: 'network error',
      },
      approvalState: 'none',
      latencyMs: 3000,
      retryCount: 1,
      retriedFrom: null,
      redacted: true,
      timestamp: '2026-01-02T08:00:00.000Z',
      resultPreview: null,
    },
  ];
  fs.writeFileSync(HISTORY_PATH, JSON.stringify({ entries }));
}

describe('briefing analytics admin routes', () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    vi.clearAllMocks();
  });

  it('lists history with filters', async () => {
    seedHistory();
    await withServer(async (baseUrl) => {
      const res = await fetch(
        new URL('/briefing-analytics/history?status=completed', baseUrl),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body).toHaveLength(1);
      expect((body[0] as { status: string }).status).toBe('completed');
    });
  });

  it('returns analytics aggregation', async () => {
    seedHistory();
    await withServer(async (baseUrl) => {
      const res = await fetch(
        new URL('/briefing-analytics/analytics', baseUrl),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        total: number;
        byOutcome: Record<string, number>;
      };
      expect(body.total).toBe(2);
      expect(body.byOutcome.completed).toBe(1);
      expect(body.byOutcome.failed).toBe(1);
    });
  });

  it('creates and reads delivery preferences', async () => {
    await withServer(async (baseUrl) => {
      const post = await fetch(
        new URL('/briefing-analytics/preferences', baseUrl),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groupFolder: 'ops',
            channelId: 'wa:ops',
            mode: 'disabled',
          }),
        },
      );
      expect(post.status).toBe(200);
      const created = (await post.json()) as { preference: { mode: string } };
      expect(created.preference.mode).toBe('disabled');

      const get = await fetch(
        new URL(
          '/briefing-analytics/preferences?groupFolder=ops&channelId=wa:ops',
          baseUrl,
        ),
      );
      expect(get.status).toBe(200);
      const pref = (await get.json()) as { mode: string };
      expect(pref.mode).toBe('disabled');
    });
  });

  it('rejects invalid delivery modes', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(
        new URL('/briefing-analytics/preferences', baseUrl),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groupFolder: 'ops',
            channelId: 'wa:ops',
            mode: 'sms',
          }),
        },
      );
      expect(res.status).toBe(400);
    });
  });

  it('exports history as attachment', async () => {
    seedHistory();
    await withServer(async (baseUrl) => {
      const res = await fetch(new URL('/briefing-analytics/export', baseUrl), {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toMatch(/attachment/);
      const body = (await res.json()) as { entries: unknown[] };
      expect(body.entries).toHaveLength(2);
    });
  });
});
