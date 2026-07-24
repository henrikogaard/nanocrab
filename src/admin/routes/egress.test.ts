import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'http';

vi.mock('../../egress-gateway.js', () => ({
  evaluateEgress: vi.fn(),
  loadEgressAllowlist: vi.fn(() => ({
    destinations: [
      {
        id: 'anthropic',
        host: 'api.anthropic.com',
        credentialId: 'ANTHROPIC_API_KEY',
        port: 443,
        reason: 'default',
      },
    ],
  })),
  saveEgressAllowlist: vi.fn(),
}));

vi.mock('../../audit-log.js', () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock('../middleware.js', () => ({
  requireRole:
    () =>
    (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      req.user = { username: 'admin-user', role: 'admin' } as any;
      next();
    },
}));

const { default: egressRouter } = await import('./egress.js');
const { evaluateEgress, saveEgressAllowlist } =
  await import('../../egress-gateway.js');
const { logAuditEvent } = await import('../../audit-log.js');

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use('/api/egress', egressRouter);
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('egress admin routes', () => {
  it('GET / returns the current allowlist', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(new URL('/api/egress', baseUrl));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        destinations: Array<{ host: string }>;
      };
      expect(body.destinations).toHaveLength(1);
      expect(body.destinations[0].host).toBe('api.anthropic.com');
    });
  });

  it('PUT / replaces the allowlist and audits the change', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(new URL('/api/egress', baseUrl), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinations: [
            {
              host: 'custom.example.com',
              credentialId: 'CUSTOM_KEY',
              reason: 'custom',
            },
          ],
        }),
      });
      expect(res.status).toBe(200);
      expect(saveEgressAllowlist).toHaveBeenCalledWith({
        destinations: [expect.objectContaining({ host: 'custom.example.com' })],
      });
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'egress.allowlist.update',
          decision: 'allowed',
        }),
      );
    });
  });

  it('PUT / rejects non-array destinations', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(new URL('/api/egress', baseUrl), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinations: 'not-an-array' }),
      });
      expect(res.status).toBe(400);
    });
  });

  it('POST /evaluate returns the egress decision', async () => {
    vi.mocked(evaluateEgress).mockReturnValueOnce({
      decision: 'deny',
      reason: 'not allowed',
      host: 'evil.example.com',
      correlationId: 'corr-1',
      dryRun: false,
    } as any);
    await withServer(async (baseUrl) => {
      const res = await fetch(new URL('/api/egress/evaluate', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'evil.example.com' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { decision: string };
      expect(body.decision).toBe('deny');
      expect(evaluateEgress).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'evil.example.com' }),
      );
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'egress.evaluate',
          decision: 'denied',
        }),
      );
    });
  });

  it('POST /evaluate rejects missing host', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(new URL('/api/egress/evaluate', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });
});
