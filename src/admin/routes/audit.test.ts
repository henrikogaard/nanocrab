import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'http';

import { _closeDatabase, _initTestDatabase } from '../../db.js';
import { logAuditEvent } from '../../audit-log.js';

let activeRole: 'viewer' | 'admin' = 'viewer';

vi.mock('../middleware.js', () => ({
  requireRole:
    (role: string) =>
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      req.user = { username: 'test-user', role: activeRole } as any;
      if (role === 'admin' && activeRole !== 'admin') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      next();
    },
}));

vi.mock('../../container-runtime.js', () => ({
  isNetworkIsolationEnabled: () => true,
  isContainerHardeningEnabled: () => true,
}));

vi.mock('../../egress-gateway.js', () => ({
  loadEgressAllowlist: () => ({
    destinations: [
      {
        id: 'anthropic',
        host: 'api.anthropic.com',
        credentialId: 'ANTHROPIC_API_KEY',
        port: 443,
        reason: 'default',
      },
    ],
  }),
}));

const { default: auditRouter } = await import('./audit.js');

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use('/runtime-audit', auditRouter);
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

describe('runtime audit admin routes', () => {
  beforeEach(() => {
    activeRole = 'viewer';
    try {
      _closeDatabase();
    } catch {
      /* database may not be initialized */
    }
    _initTestDatabase();
    logAuditEvent({
      actor: 'router',
      actionType: 'channel.send',
      resource: 'tg:ops',
      decision: 'allowed',
      context: { textLength: 42 },
    });
  });

  it('blocks viewers from runtime audit list, export, replay, and simulator', async () => {
    await withServer(async (baseUrl) => {
      for (const path of [
        '/runtime-audit',
        '/runtime-audit/export',
        '/runtime-audit/replay/corr-1',
      ]) {
        const response = await fetch(new URL(path, baseUrl));
        expect(response.status).toBe(403);
      }
      const response = await fetch(
        new URL('/runtime-audit/simulate', baseUrl),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionType: 'coding.open_pr' }),
        },
      );
      expect(response.status).toBe(403);
    });
  });

  it('allows admins to list runtime audit events', async () => {
    activeRole = 'admin';

    await withServer(async (baseUrl) => {
      const response = await fetch(new URL('/runtime-audit', baseUrl));
      expect(response.status).toBe(200);
      const events = (await response.json()) as Array<{ actionType: string }>;
      expect(events[0].actionType).toBe('channel.send');
    });
  });

  it('allows admins to download a tamper-evident export and verify it', async () => {
    activeRole = 'admin';

    await withServer(async (baseUrl) => {
      const exportRes = await fetch(
        new URL(
          '/runtime-audit/export/tamper-evident?signingKey=test-key',
          baseUrl,
        ),
      );
      expect(exportRes.status).toBe(200);
      const exportData = (await exportRes.json()) as {
        count: number;
        signature: string;
      };
      expect(exportData.count).toBeGreaterThan(0);
      expect(exportData.signature).toMatch(/^[a-f0-9]{64}$/);

      const verifyRes = await fetch(
        new URL('/runtime-audit/export/verify', baseUrl),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            export: exportData,
            signingKey: 'test-key',
          }),
        },
      );
      expect(verifyRes.status).toBe(200);
      const report = (await verifyRes.json()) as { valid: boolean };
      expect(report.valid).toBe(true);
    });
  });

  it('allows admins to fetch the security proof matrix', async () => {
    activeRole = 'admin';

    await withServer(async (baseUrl) => {
      const res = await fetch(new URL('/runtime-audit/proof-matrix', baseUrl));
      expect(res.status).toBe(200);
      const matrix = (await res.json()) as {
        proofs: Array<{ claimId: string }>;
        summary: Record<string, number>;
      };
      const claimIds = matrix.proofs.map((p) => p.claimId);
      expect(claimIds).toContain('default-deny-network');
      expect(claimIds).toContain('tamper-evident-audit');
      expect(matrix.summary).toHaveProperty('proven');
    });
  });
});
