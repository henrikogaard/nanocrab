import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-report-routes-${Date.now()}`,
);

vi.mock('../../config.js', () => ({
  STORE_DIR,
}));

const { default: reportsRouter } = await import('./reports.js');

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.user = { id: 'owner', username: 'owner', role: 'owner' };
    next();
  });
  server.use('/reports', reportsRouter);
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

function writeReportJob(input: {
  id: string;
  deliverablesDir: string;
  artifactPath: string;
}): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(STORE_DIR, 'report-jobs.json'),
    `${JSON.stringify(
      [
        {
          id: input.id,
          title: 'Unsafe Artifact',
          request: 'Verify download boundaries',
          requester: 'owner',
          providerProfileId: 'default_reports',
          sourceScopes: ['journal'],
          outputFormats: ['markdown'],
          deliverablesDir: input.deliverablesDir,
          requireOutlineApproval: false,
          requireDeliveryApproval: false,
          status: 'draft_ready',
          outline: '',
          markdown: '',
          citations: [],
          artifacts: [{ format: 'markdown', path: input.artifactPath }],
          createdAt: '2026-06-01T12:00:00.000Z',
          updatedAt: '2026-06-01T12:00:00.000Z',
          error: null,
        },
      ],
      null,
      2,
    )}\n`,
  );
}

describe('report admin routes', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
  });

  it('blocks artifact downloads outside the deliverables directory', async () => {
    const deliverablesDir = path.join(STORE_DIR, 'deliverables');
    const outsideDir = path.join(STORE_DIR, 'outside');
    const outsideArtifact = path.join(outsideDir, 'leak.md');
    fs.mkdirSync(deliverablesDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(outsideArtifact, '# should not download\n');
    writeReportJob({
      id: 'report-unsafe',
      deliverablesDir,
      artifactPath: outsideArtifact,
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/reports/jobs/report-unsafe/artifacts/0/download`,
      );
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).toBe(
        'Report artifact path is outside deliverables directory',
      );
    });
  });
});
