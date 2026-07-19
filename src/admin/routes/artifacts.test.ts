import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-artifacts-routes-${Date.now()}`,
);

vi.mock('../../config.js', () => ({
  STORE_DIR,
}));

const { default: artifactsRouter } = await import('./artifacts.js');

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.user = { id: 'owner', username: 'owner', role: 'owner' };
    next();
  });
  server.use('/artifacts', artifactsRouter);
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

describe('artifacts admin routes', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    fs.mkdirSync(STORE_DIR, { recursive: true });
  });

  it('ingests a non-report artifact through the API', async () => {
    const sourceFile = path.join(STORE_DIR, 'ingested-note.md');
    fs.writeFileSync(sourceFile, 'Ingested content.');

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/artifacts/vault/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Ingested note',
          path: sourceFile,
          sourceType: 'mcp',
          sourceId: 'collection-123',
          sourceLinks: [
            { label: 'Source ledger', source: 'ledger:ledger-abc' },
          ],
        }),
      });
      const body = (await response.json()) as { ok: boolean; record: { id: string } };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.record.id).toBeTruthy();
    });
  });
});
