import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-admin-approvals-${Date.now()}`,
);
const APPROVALS_PATH = path.join(STORE_DIR, 'approvals.json');

vi.mock('../../config.js', () => ({
  STORE_DIR,
}));

vi.mock('../middleware.js', () => ({
  requireRole:
    () =>
    (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      req.user = { username: 'owner', role: 'admin' } as any;
      next();
    },
}));

vi.mock('../security.js', () => ({
  auditLog: vi.fn(),
}));

const { default: approvalsRouter } = await import('./approvals.js');

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use('/approvals', approvalsRouter);
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

function writeApprovals(records: Array<Record<string, unknown>>): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(APPROVALS_PATH, `${JSON.stringify(records, null, 2)}\n`);
}

describe('approval admin routes', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
  });

  it('passes inbox filters through GET /approvals', async () => {
    writeApprovals([
      {
        id: 'match',
        kind: 'provider-fallback',
        title: 'Fallback to OpenRouter',
        summary: 'Primary provider failed.',
        risk: 'medium',
        requester: 'router',
        targetType: 'provider',
        targetId: 'openrouter',
        payload: {},
        status: 'pending',
        correlationId: 'corr-provider',
        createdAt: '2026-06-10T12:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
        decisionNote: null,
      },
      {
        id: 'miss',
        kind: 'provider-fallback',
        title: 'Fallback to local',
        summary: 'Different requester.',
        risk: 'medium',
        requester: 'worker',
        targetType: 'provider',
        targetId: 'ollama',
        payload: {},
        status: 'pending',
        correlationId: 'corr-provider',
        createdAt: '2026-06-10T12:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
        decisionNote: null,
      },
    ]);

    await withServer(async (baseUrl) => {
      const url = new URL('/approvals', baseUrl);
      Object.entries({
        status: 'pending',
        risk: 'medium',
        kind: 'provider-fallback',
        requester: 'router',
        targetType: 'provider',
        correlationId: 'corr-provider',
        createdFrom: '2026-06-10T00:00:00.000Z',
        createdTo: '2026-06-11T00:00:00.000Z',
      }).forEach(([key, value]) => url.searchParams.set(key, value));
      const res = await fetch(url);

      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ id: string }>;
      expect(body.map((approval) => approval.id)).toEqual(['match']);
    });
  });

  it('creates approvals with provenance fields', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(new URL('/approvals', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'tool-action',
          title: 'Run deployment tool',
          summary: 'Deploy a new dashboard build.',
          risk: 'high',
          source: 'dashboard',
          correlationId: 'corr-tool',
          expiresAt: '2099-01-01T00:00:00.000Z',
          actionPreview: 'npm run deploy',
          resourceSummary: 'dashboard deployment',
          policyDecisionId: 'policy-1',
          targetType: 'tool',
          targetId: 'deploy',
          payload: { command: 'deploy' },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { approval: Record<string, unknown> };
      expect(body.approval).toMatchObject({
        kind: 'tool-action',
        source: 'dashboard',
        correlationId: 'corr-tool',
        expiresAt: '2099-01-01T00:00:00.000Z',
        actionPreview: 'npm run deploy',
        resourceSummary: 'dashboard deployment',
        policyDecisionId: 'policy-1',
      });
    });
  });

  it('rejects stale approvals instead of approving them', async () => {
    writeApprovals([
      {
        id: 'stale',
        kind: 'upload',
        title: 'Process old upload',
        summary: 'Old upload approval.',
        risk: 'medium',
        requester: 'uploader',
        targetType: 'upload',
        targetId: 'upload-1',
        payload: {},
        status: 'pending',
        expiresAt: '2000-01-01T00:00:00.000Z',
        createdAt: '1999-12-31T23:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
        decisionNote: null,
      },
    ]);

    await withServer(async (baseUrl) => {
      const res = await fetch(new URL('/approvals/stale/approve', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'looks fine' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Approval is expired');
    });
    const stored = JSON.parse(fs.readFileSync(APPROVALS_PATH, 'utf-8'));
    expect(stored[0]).toMatchObject({
      id: 'stale',
      status: 'expired',
      reviewedBy: 'system',
    });
  });
});
