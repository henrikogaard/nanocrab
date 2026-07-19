import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const { approveCodingJobRuntimeFallback, executeBriefingDeliveryApproval } =
  vi.hoisted(() => ({
    approveCodingJobRuntimeFallback: vi.fn(),
    executeBriefingDeliveryApproval: vi.fn(),
  }));

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

vi.mock('../../coding-jobs.js', () => ({
  approveCodingJobRuntimeFallback,
}));

vi.mock('../../briefing-delivery.js', () => ({
  executeBriefingDeliveryApproval,
}));

vi.mock('../state.js', () => ({
  getState: () => ({ sendMessage: vi.fn() }),
}));

const { default: approvalsRouter } = await import('./approvals.js');
const { getApproval, reviewApproval } = await import('../../approvals.js');

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
  let codingJobRuntime: Record<string, string>;

  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    approveCodingJobRuntimeFallback.mockReset();
    executeBriefingDeliveryApproval.mockReset();
    codingJobRuntime = {
      cli: 'devin',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
    };
  });

  it('executes an approved briefing result immediately', async () => {
    writeApprovals([
      {
        id: 'briefing-result',
        kind: 'briefing-delivery',
        title: 'Deliver briefing',
        summary: 'Deliver exact result',
        risk: 'medium',
        requester: 'task-scheduler',
        targetType: 'scheduled-task-result',
        targetId: 'task-1:digest',
        payload: {
          taskId: 'task-1',
          mode: 'chat',
          channelId: 'wa:main',
          result: 'Approved result',
        },
        status: 'pending',
        correlationId: 'task-1:digest',
        createdAt: '2026-07-19T10:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
        decisionNote: null,
      },
    ]);

    await withServer(async (baseUrl) => {
      const response = await fetch(
        new URL('/approvals/briefing-result/approve', baseUrl),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      expect(response.status).toBe(200);
    });

    expect(executeBriefingDeliveryApproval).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'briefing-result', status: 'approved' }),
      expect.objectContaining({ sendMessage: expect.any(Function) }),
    );
  });

  function writeCodingRuntimeFallbackApproval(
    proposedProvider = 'codex',
    proposedModel = 'gpt-5.4',
  ): void {
    writeApprovals([
      {
        id: 'coding-runtime-fallback',
        kind: 'provider-fallback',
        title: 'Select fallback coding runtime',
        summary: 'Choose a complete runtime.',
        risk: 'high',
        requester: 'control-plane',
        targetType: 'coding-job',
        targetId: 'job-129',
        payload: {
          sourceRuntime: codingJobRuntime,
          proposedProvider,
          proposedModel,
        },
        status: 'pending',
        correlationId: 'job-129',
        createdAt: '2026-07-14T10:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
        decisionNote: null,
      },
    ]);
  }

  it('approves a coding-job provider fallback through the complete runtime owner API', async () => {
    writeCodingRuntimeFallbackApproval();
    approveCodingJobRuntimeFallback.mockImplementation((jobId, runtime, by) => {
      expect(jobId).toBe('job-129');
      expect(by).toBe('owner');
      codingJobRuntime = { ...runtime };
      reviewApproval('coding-runtime-fallback', 'approved', by);
      return { id: jobId, actualRuntime: runtime };
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(
        new URL('/approvals/coding-runtime-fallback/approve', baseUrl),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runtime: { cli: 'codex', provider: 'codex', model: 'gpt-5.4' },
          }),
        },
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        approval: { status: string };
      };
      expect(body.approval.status).toBe('approved');
    });
    expect(approveCodingJobRuntimeFallback).toHaveBeenCalledWith(
      'job-129',
      { cli: 'codex', provider: 'codex', model: 'gpt-5.4' },
      'owner',
    );
    expect(codingJobRuntime).toEqual({
      cli: 'codex',
      provider: 'codex',
      model: 'gpt-5.4',
    });
  });

  it('rejects a coding-job provider fallback without a complete runtime and preserves pending state', async () => {
    writeCodingRuntimeFallbackApproval();
    const originalRuntime = { ...codingJobRuntime };

    await withServer(async (baseUrl) => {
      const response = await fetch(
        new URL('/approvals/coding-runtime-fallback/approve', baseUrl),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: 'missing runtime' }),
        },
      );
      expect(response.status).toBe(400);
      expect((await response.json()) as { error: string }).toMatchObject({
        error: expect.stringContaining('complete runtime'),
      });
    });
    expect(approveCodingJobRuntimeFallback).not.toHaveBeenCalled();
    expect(getApproval('coding-runtime-fallback')?.status).toBe('pending');
    expect(codingJobRuntime).toEqual(originalRuntime);
  });

  it('rejects an incompatible coding-job runtime and preserves pending state', async () => {
    writeCodingRuntimeFallbackApproval();
    const originalRuntime = { ...codingJobRuntime };
    approveCodingJobRuntimeFallback.mockImplementation(() => {
      throw new Error(
        'coding runtime CLI codex is not compatible with provider claude',
      );
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(
        new URL('/approvals/coding-runtime-fallback/approve', baseUrl),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runtime: { cli: 'codex', provider: 'claude', model: 'gpt-5.4' },
          }),
        },
      );
      expect(response.status).toBe(400);
      expect((await response.json()) as { error: string }).toMatchObject({
        error: expect.stringContaining('not compatible'),
      });
    });
    expect(getApproval('coding-runtime-fallback')?.status).toBe('pending');
    expect(codingJobRuntime).toEqual(originalRuntime);
  });

  it('returns 400 when Devin readiness changes before approval and preserves pending state', async () => {
    codingJobRuntime = {
      cli: 'codex',
      provider: 'codex',
      model: 'gpt-5.4',
    };
    writeCodingRuntimeFallbackApproval('claude', 'claude-sonnet-4-6');
    const originalRuntime = { ...codingJobRuntime };
    approveCodingJobRuntimeFallback.mockRejectedValue(
      new Error(
        'Coding runtime devin / claude / claude-sonnet-4-6 is unavailable: Devin credential unavailable',
      ),
    );

    await withServer(async (baseUrl) => {
      const response = await fetch(
        new URL('/approvals/coding-runtime-fallback/approve', baseUrl),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runtime: {
              cli: 'devin',
              provider: 'claude',
              model: 'claude-sonnet-4-6',
            },
          }),
        },
      );
      expect(response.status).toBe(400);
      expect((await response.json()) as { error: string }).toMatchObject({
        error: expect.stringContaining(
          'devin / claude / claude-sonnet-4-6 is unavailable',
        ),
      });
    });
    expect(approveCodingJobRuntimeFallback).toHaveBeenCalledWith(
      'job-129',
      {
        cli: 'devin',
        provider: 'claude',
        model: 'claude-sonnet-4-6',
      },
      'owner',
    );
    expect(getApproval('coding-runtime-fallback')?.status).toBe('pending');
    expect(codingJobRuntime).toEqual(originalRuntime);
  });

  it('keeps generic approval kinds on the existing review path', async () => {
    writeApprovals([
      {
        id: 'generic-upload',
        kind: 'upload',
        title: 'Upload artifact',
        summary: 'Approve a normal upload.',
        risk: 'medium',
        requester: 'owner',
        targetType: 'upload',
        targetId: 'artifact-1',
        payload: {},
        status: 'pending',
        createdAt: '2026-07-14T10:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
        decisionNote: null,
      },
    ]);

    await withServer(async (baseUrl) => {
      const response = await fetch(
        new URL('/approvals/generic-upload/approve', baseUrl),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: 'approved normally' }),
        },
      );
      expect(response.status).toBe(200);
    });
    expect(getApproval('generic-upload')).toMatchObject({
      status: 'approved',
      reviewedBy: 'owner',
      decisionNote: 'approved normally',
    });
    expect(approveCodingJobRuntimeFallback).not.toHaveBeenCalled();
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
