import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'http';

const learningLoopMocks = vi.hoisted(() => ({
  approveLearningProposal: vi.fn((id: string, reviewedBy: string) => ({
    id,
    status: 'approved',
    reviewedBy,
  })),
  getLearningConfig: vi.fn(() => ({ enabled: true })),
  getLearningProposal: vi.fn(),
  listLearningProposals: vi.fn(() => []),
  rejectLearningProposal: vi.fn(
    (id: string, reviewedBy: string, note?: string) => ({
      id,
      status: 'rejected',
      reviewedBy,
      decisionNote: note ?? null,
    }),
  ),
  updateLearningConfig: vi.fn((config: Record<string, unknown>) => config),
}));

vi.mock('../../learning-loop.js', () => learningLoopMocks);

vi.mock('../security.js', () => ({
  auditLog: vi.fn(),
}));

const { default: learningProposalsRouter } =
  await import('./learning-proposals.js');

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.user = { id: 'henrik', username: 'henrik', role: 'owner' };
    next();
  });
  server.use('/learning-proposals', learningProposalsRouter);
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

describe('learning proposal admin routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attributes an approval to the authenticated username', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(
        new URL('/learning-proposals/proposal-1/approve', baseUrl),
        { method: 'PUT' },
      );

      expect(response.status).toBe(200);
      expect(learningLoopMocks.approveLearningProposal).toHaveBeenCalledWith(
        'proposal-1',
        'henrik',
      );
      await expect(response.json()).resolves.toMatchObject({
        reviewedBy: 'henrik',
      });
    });
  });

  it('attributes a rejection to the authenticated username', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(
        new URL('/learning-proposals/proposal-2/reject', baseUrl),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: 'not reusable' }),
        },
      );

      expect(response.status).toBe(200);
      expect(learningLoopMocks.rejectLearningProposal).toHaveBeenCalledWith(
        'proposal-2',
        'henrik',
        'not reusable',
      );
      await expect(response.json()).resolves.toMatchObject({
        reviewedBy: 'henrik',
        decisionNote: 'not reusable',
      });
    });
  });
});
