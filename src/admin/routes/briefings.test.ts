import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { BriefingSchedule } from '../../briefing-jobs.js';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-admin-briefings-${Date.now()}`,
);
const createTask = vi.fn();

vi.mock('../../config.js', () => ({
  STORE_DIR,
  TIMEZONE: 'Europe/Oslo',
}));

vi.mock('../../db.js', () => ({
  createTask,
}));

vi.mock('../security.js', () => ({
  auditLog: vi.fn(),
}));

const { default: briefingsRouter } = await import('./briefings.js');

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use('/briefings', briefingsRouter);
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

describe('briefing admin routes', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    createTask.mockReset();
  });

  it('creates and lists briefing schedules', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(new URL('/briefings', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Weekly Briefing',
          cadence: 'weekly',
          groupFolder: 'main',
          chatJid: 'wa:alliance-command',
          localTime: '09:15',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { briefing: BriefingSchedule };
      expect(body.briefing).toMatchObject({
        title: 'Weekly Briefing',
        cadence: 'weekly',
        scheduleValue: '15 9 * * 1',
      });
      expect(createTask).toHaveBeenCalledOnce();

      const list = await fetch(new URL('/briefings', baseUrl));
      expect(list.status).toBe(200);
      const listed = (await list.json()) as BriefingSchedule[];
      expect(listed).toHaveLength(1);
    });
  });

  it('rejects unsafe external-send briefing creation', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(new URL('/briefings', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Unsafe',
          cadence: 'daily',
          groupFolder: 'main',
          chatJid: 'wa:alliance-command',
          localTime: '08:00',
          deliveryMode: 'send',
          requireDeliveryApproval: false,
        }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: expect.stringMatching(/delivery approval/i),
      });
      expect(createTask).not.toHaveBeenCalled();
    });
  });
});
