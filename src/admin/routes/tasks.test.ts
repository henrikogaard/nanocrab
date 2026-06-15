import express from 'express';
import http from 'http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduledTask } from '../../types.js';

const taskStore = new Map<string, ScheduledTask>();

vi.mock('../security.js', () => ({
  auditLog: vi.fn(),
}));

vi.mock('better-sqlite3', () => ({
  default: class FakeDatabase {
    prepare() {
      return { all: () => [] };
    }
    close() {}
  },
}));

vi.mock('../../db.js', () => ({
  getAllTasks: vi.fn(() => Array.from(taskStore.values())),
  getTaskById: vi.fn((id: string) => taskStore.get(id)),
  createTask: vi.fn((task: ScheduledTask) => taskStore.set(task.id, task)),
  updateTask: vi.fn((id: string, updates: Partial<ScheduledTask>) => {
    const task = taskStore.get(id);
    if (task) taskStore.set(id, { ...task, ...updates });
  }),
  deleteTask: vi.fn((id: string) => taskStore.delete(id)),
  getTaskRunLogs: vi.fn(() => []),
}));

const { default: tasksRouter } = await import('./tasks.js');

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use('/tasks', tasksRouter);
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

describe('task admin routes', () => {
  beforeEach(() => {
    taskStore.clear();
  });

  it('lists routine blueprints for the dashboard wizard', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(new URL('/tasks/blueprints', baseUrl));

      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ id: string; title: string }>;
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'daily-briefing',
            title: 'Daily briefing',
          }),
          expect.objectContaining({
            id: 'issue-triage',
            title: 'Issue triage',
          }),
        ]),
      );
    });
  });

  it('marks a task active and due when run-now is requested', async () => {
    taskStore.set('task-run-now', {
      id: 'task-run-now',
      group_folder: 'main',
      chat_jid: 'wa:main',
      prompt: 'Send summary',
      schedule_type: 'cron',
      schedule_value: '0 8 * * *',
      context_mode: 'isolated',
      next_run: '2030-01-01T08:00:00.000Z',
      last_run: null,
      last_result: null,
      status: 'paused',
      created_at: '2026-06-14T10:00:00.000Z',
    });

    await withServer(async (baseUrl) => {
      const before = Date.now();
      const res = await fetch(new URL('/tasks/task-run-now/run-now', baseUrl), {
        method: 'POST',
      });
      const after = Date.now();

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        task: { id: string; status: string; next_run: string };
      };
      expect(body.ok).toBe(true);
      expect(body.task).toMatchObject({
        id: 'task-run-now',
        status: 'active',
      });

      const task = taskStore.get('task-run-now');
      expect(task?.status).toBe('active');
      expect(new Date(task?.next_run || '').getTime()).toBeGreaterThanOrEqual(
        before,
      );
      expect(new Date(task?.next_run || '').getTime()).toBeLessThanOrEqual(
        after + 1000,
      );
    });
  });

  it('persists routine metadata, delivery, and named session settings on create', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(new URL('/tasks', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          groupFolder: 'main',
          chatJid: 'wa:main',
          title: 'Daily operator briefing',
          description: 'Preview-first morning summary',
          routineType: 'briefing',
          prompt: 'Prepare a concise briefing.',
          scheduleType: 'cron',
          scheduleValue: '0 8 * * 1-5',
          contextMode: 'session',
          sessionKey: 'daily-operator-briefing',
          deliveryMode: 'dashboard',
          deliveryTarget: 'wa:main',
          silentMarker: 'BRIEFING_OK',
          maxRuntimeMs: 120000,
          maxActiveRuns: 1,
          heartbeatPolicy: {
            quietHours: { start: '22:00', end: '07:00' },
            staleAfterMinutes: 90,
          },
          skills: ['calendar-assistant', 'email-assistant'],
          contextTaskIds: ['task-source'],
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string };
      const task = taskStore.get(body.id) as ScheduledTask & {
        title?: string | null;
        description?: string | null;
        routine_type?: string | null;
        delivery_mode?: string | null;
        delivery_target?: string | null;
        silent_marker?: string | null;
        session_key?: string | null;
        max_runtime_ms?: number | null;
        max_active_runs?: number | null;
        heartbeat_policy_json?: string | null;
        skills_json?: string | null;
        context_task_ids_json?: string | null;
      };

      expect(task).toMatchObject({
        title: 'Daily operator briefing',
        description: 'Preview-first morning summary',
        routine_type: 'briefing',
        delivery_mode: 'dashboard',
        delivery_target: 'wa:main',
        silent_marker: 'BRIEFING_OK',
        session_key: 'daily-operator-briefing',
        max_runtime_ms: 120000,
        max_active_runs: 1,
        context_mode: 'session',
      });
      expect(JSON.parse(task.heartbeat_policy_json || '{}')).toEqual({
        quietHours: { start: '22:00', end: '07:00' },
        staleAfterMinutes: 90,
      });
      expect(JSON.parse(task.skills_json || '[]')).toEqual([
        'calendar-assistant',
        'email-assistant',
      ]);
      expect(JSON.parse(task.context_task_ids_json || '[]')).toEqual([
        'task-source',
      ]);
    });
  });

  it('updates routine metadata and delivery settings', async () => {
    taskStore.set('task-edit-routine', {
      id: 'task-edit-routine',
      group_folder: 'main',
      chat_jid: 'wa:main',
      prompt: 'Old prompt',
      schedule_type: 'cron',
      schedule_value: '0 8 * * *',
      context_mode: 'isolated',
      next_run: '2030-01-01T08:00:00.000Z',
      last_run: null,
      last_result: null,
      status: 'active',
      created_at: '2026-06-14T10:00:00.000Z',
    } as ScheduledTask);

    await withServer(async (baseUrl) => {
      const res = await fetch(new URL('/tasks/task-edit-routine', baseUrl), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Updated routine',
          routineType: 'heartbeat',
          deliveryMode: 'file',
          deliveryTarget: 'heartbeats/latest.md',
          contextMode: 'session',
          sessionKey: 'health-heartbeat',
          contextTaskIds: ['task-a', 'task-b'],
        }),
      });

      expect(res.status).toBe(200);
      const task = taskStore.get('task-edit-routine') as ScheduledTask & {
        title?: string | null;
        routine_type?: string | null;
        delivery_mode?: string | null;
        delivery_target?: string | null;
        session_key?: string | null;
        context_task_ids_json?: string | null;
      };
      expect(task).toMatchObject({
        title: 'Updated routine',
        routine_type: 'heartbeat',
        delivery_mode: 'file',
        delivery_target: 'heartbeats/latest.md',
        context_mode: 'session',
        session_key: 'health-heartbeat',
      });
      expect(JSON.parse(task.context_task_ids_json || '[]')).toEqual([
        'task-a',
        'task-b',
      ]);
    });
  });
});
