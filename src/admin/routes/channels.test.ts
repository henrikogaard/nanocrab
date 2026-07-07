import { describe, expect, it, vi } from 'vitest';
import express from 'express';

vi.mock('../state.js', () => ({
  getState: () => ({
    channels: [],
    registeredGroups: {},
  }),
  nonWebGroups: () => ({}),
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

const { default: channelsRouter } = await import('./channels.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'admin', username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/channels', channelsRouter);
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

describe('/api/channels intent routes', () => {
  it('resolves channel prompts into workspace intent without sending messages', async () => {
    const result = await withServer(async (base) => {
      const res = await fetch(`${base}/api/channels/intent/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'signal',
          prompt: 'Fix GitHub issue #104 in nanocrab.',
          projects: [
            {
              id: 'project-auroradocs',
              name: 'AuroraDocs',
              slug: 'auroradocs',
            },
          ],
          threads: [],
        }),
      });
      expect(res.status).toBe(200);
      return res.json() as Promise<{
        intent: {
          kind: string;
          approvalRequired: boolean;
          target: { repo: string; issueNumber: number };
        };
      }>;
    });

    expect(result.intent).toMatchObject({
      kind: 'code',
      approvalRequired: true,
      target: {
        repo: 'nanocrab',
        issueNumber: 104,
      },
    });
  });
});
