import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(os.tmpdir(), `nanocrab-files-test-${Date.now()}`);
const DATA_DIR = path.join(os.tmpdir(), `nanocrab-files-data-${Date.now()}`);
const GROUPS_DIR = path.join(
  os.tmpdir(),
  `nanocrab-files-groups-${Date.now()}`,
);

vi.mock('../../config.js', () => ({
  STORE_DIR,
  DATA_DIR,
  GROUPS_DIR,
}));

const { _closeDatabase, _initTestDatabase, createCoworkProject } =
  await import('../../db.js');
const { coworkProjectPath } = await import('../../cowork-projects.js');
const { default: filesRouter } = await import('./files.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'admin', username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/files', filesRouter);
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

describe('/api/files artifact promotion', () => {
  beforeEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* may not be initialized */
    }
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(GROUPS_DIR, { recursive: true, force: true });
    _initTestDatabase();
  });

  afterEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* ok */
    }
  });

  it('lists group artifacts and promotes one into a Cowork project file', async () => {
    const groupDir = path.join(GROUPS_DIR, 'signal-main', 'artifacts');
    fs.mkdirSync(groupDir, { recursive: true });
    fs.writeFileSync(
      path.join(groupDir, 'daily-brief.md'),
      '# Daily brief\n\nRaw group artifact.',
    );
    const project = createCoworkProject({
      id: 'project-files-promote',
      name: 'Ops Briefs',
      slug: 'ops-briefs',
      description: null,
      instructions: null,
      created_at: '2026-07-08T10:00:00.000Z',
      updated_at: '2026-07-08T10:00:00.000Z',
    });

    const result = await withServer(async (base) => {
      const listRes = await fetch(`${base}/api/files/signal-main/artifacts`);
      expect(listRes.status).toBe(200);
      const listed = (await listRes.json()) as Array<{ name: string }>;
      expect(listed).toContainEqual(
        expect.objectContaining({ name: 'daily-brief.md' }),
      );

      const promoteRes = await fetch(
        `${base}/api/files/signal-main/artifacts/${encodeURIComponent('daily-brief.md')}/promote`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            projectId: project.id,
            path: 'inbox/daily-brief.md',
          }),
        },
      );
      expect(promoteRes.status).toBe(200);
      return promoteRes.json() as Promise<{
        file: { path: string; hostPath: string };
        provenance: { sourceGroup: string; sourceArtifact: string };
      }>;
    });

    expect(result).toMatchObject({
      file: { path: 'inbox/daily-brief.md' },
      provenance: {
        sourceGroup: 'signal-main',
        sourceArtifact: 'daily-brief.md',
      },
    });
    expect(
      fs.readFileSync(
        path.join(coworkProjectPath(project), 'inbox', 'daily-brief.md'),
        'utf-8',
      ),
    ).toContain('Raw group artifact.');
  });

  it('does not expose private memory or group instructions as promotable artifacts', async () => {
    const groupDir = path.join(GROUPS_DIR, 'signal-main');
    fs.mkdirSync(groupDir, { recursive: true });
    fs.writeFileSync(path.join(groupDir, 'AGENTS.md'), '# Group instructions');
    fs.writeFileSync(path.join(groupDir, 'MEMORY.md'), '# Private memory');
    const project = createCoworkProject({
      id: 'project-no-private-promote',
      name: 'No Private Promotion',
      slug: 'no-private-promotion',
      description: null,
      instructions: null,
      created_at: '2026-07-08T10:00:00.000Z',
      updated_at: '2026-07-08T10:00:00.000Z',
    });

    await withServer(async (base) => {
      const listRes = await fetch(`${base}/api/files/signal-main/artifacts`);
      expect(listRes.status).toBe(200);
      await expect(listRes.json()).resolves.toEqual([]);

      const promoteRes = await fetch(
        `${base}/api/files/signal-main/artifacts/${encodeURIComponent('AGENTS.md')}/promote`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            projectId: project.id,
            path: 'private/AGENTS.md',
          }),
        },
      );

      expect(promoteRes.status).toBe(404);
    });

    expect(
      fs.existsSync(
        path.join(coworkProjectPath(project), 'private', 'AGENTS.md'),
      ),
    ).toBe(false);
  });
});
