import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { Mission, Runbook } from '../../missions.js';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-admin-missions-${Date.now()}`,
);

vi.mock('../../config.js', () => ({
  STORE_DIR,
}));

vi.mock('../security.js', () => ({
  auditLog: vi.fn(),
}));

const { default: missionsRouter } = await import('./missions.js');

interface RunbookResponse {
  runbook: Runbook;
}

interface MissionResponse {
  mission: Mission;
}

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use('/missions', missionsRouter);
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

describe('mission admin routes', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
  });

  it('creates runbooks, starts missions, and updates steps through the API', async () => {
    await withServer(async (baseUrl) => {
      const runbookRes = await fetch(new URL('/missions/runbooks', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Launch Briefing',
          steps: [{ title: 'Collect notes' }, { title: 'Draft message' }],
        }),
      });
      expect(runbookRes.status).toBe(200);
      const runbookBody = (await runbookRes.json()) as RunbookResponse;

      const missionRes = await fetch(new URL('/missions', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Saturday launch',
          runbookId: runbookBody.runbook.id,
        }),
      });
      expect(missionRes.status).toBe(200);
      const missionBody = (await missionRes.json()) as MissionResponse;

      const stepRes = await fetch(
        new URL(
          `/missions/${missionBody.mission.id}/steps/${missionBody.mission.steps[0].id}`,
          baseUrl,
        ),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed', note: 'Done' }),
        },
      );
      expect(stepRes.status).toBe(200);
      const stepBody = (await stepRes.json()) as MissionResponse;
      expect(stepBody.mission.steps[0]).toMatchObject({
        status: 'completed',
        note: 'Done',
      });
    });
  });

  it('returns a 400 when completing approval-required steps without approval', async () => {
    await withServer(async (baseUrl) => {
      const runbookRes = await fetch(new URL('/missions/runbooks', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'External Publish',
          steps: [{ title: 'Send message', requiresApproval: true }],
        }),
      });
      const runbookBody = (await runbookRes.json()) as RunbookResponse;
      const missionRes = await fetch(new URL('/missions', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Publish orders',
          runbookId: runbookBody.runbook.id,
        }),
      });
      const missionBody = (await missionRes.json()) as MissionResponse;

      const res = await fetch(
        new URL(
          `/missions/${missionBody.mission.id}/steps/${missionBody.mission.steps[0].id}`,
          baseUrl,
        ),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        },
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: expect.stringMatching(/approval reference/i),
      });
    });
  });
});
