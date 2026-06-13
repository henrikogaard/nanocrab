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
});
