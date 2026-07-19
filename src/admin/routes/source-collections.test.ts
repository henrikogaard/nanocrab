import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-source-collections-routes-${Date.now()}`,
);

vi.mock('../../config.js', () => ({
  STORE_DIR,
}));

const {
  startSourceCollection,
  markScopeFailed,
} = await import('../../source-collection.js');
const { default: sourceCollectionsRouter } = await import(
  './source-collections.js'
);

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.user = { id: 'owner', username: 'owner', role: 'owner' };
    next();
  });
  server.use('/source-collections', sourceCollectionsRouter);
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

describe('source collections admin routes', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    fs.mkdirSync(STORE_DIR, { recursive: true });
  });

  it('returns a source collection by id', async () => {
    const collection = startSourceCollection('report-123', ['memory']);

    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/source-collections/${collection.id}`,
      );
      const body = (await response.json()) as { id: string };

      expect(response.status).toBe(200);
      expect(body.id).toBe(collection.id);
    });
  });

  it('retries a failed source collection through the API', async () => {
    const collection = startSourceCollection('report-retry', ['connector'], {
      availableConnectors: ['github'],
    });
    markScopeFailed(collection.id, 'connector', 'connector unavailable', 'github');

    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/source-collections/${collection.id}/retry`,
        { method: 'POST' },
      );
      const body = (await response.json()) as { ok: boolean; collection: { status: string } };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.collection.status).not.toBe('collecting');
    });
  });
});
