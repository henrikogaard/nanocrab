import fs from 'fs';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./container-runner.js', () => ({
  runContainerAgent: vi.fn(async () => ({ status: 'success', result: null })),
  writeTasksSnapshot: vi.fn(),
}));

vi.mock('./approvals.js', () => ({
  createApproval: vi.fn(() => ({
    id: 'approval-webhook',
    status: 'pending',
  })),
  findPendingApprovalForTarget: vi.fn(() => undefined),
  hasApprovedTarget: vi.fn(() => false),
}));

vi.mock('./webhook-delivery.js', () => ({
  sendScheduledTaskWebhook: vi.fn(async () => ({ ok: true, status: 200 })),
}));

import {
  _initTestDatabase,
  createTask,
  getTaskById,
  logTaskRun,
} from './db.js';
import {
  _resetSchedulerLoopForTests,
  computeNextRun,
  startSchedulerLoop,
} from './task-scheduler.js';
import { runContainerAgent } from './container-runner.js';
import { STORE_DIR } from './config.js';
import {
  createApproval,
  findPendingApprovalForTarget,
  hasApprovedTarget,
} from './approvals.js';
import { sendScheduledTaskWebhook } from './webhook-delivery.js';
import {
  loadBriefingHistoryStore,
  setDeliveryPreference,
} from './briefing-history.js';

describe('task scheduler', () => {
  beforeEach(() => {
    _initTestDatabase();
    _resetSchedulerLoopForTests();
    vi.clearAllMocks();
    vi.mocked(findPendingApprovalForTarget).mockReturnValue(undefined as any);
    vi.useFakeTimers();
    fs.rmSync(path.join(STORE_DIR, 'task-deliveries'), {
      recursive: true,
      force: true,
    });
    for (const file of [
      'briefing-history.json',
      'delivery-preferences.json',
      'approvals.json',
    ]) {
      fs.rmSync(path.join(STORE_DIR, file), { force: true });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(path.join(STORE_DIR, 'task-deliveries'), {
      recursive: true,
      force: true,
    });
    for (const file of [
      'briefing-history.json',
      'delivery-preferences.json',
      'approvals.json',
    ]) {
      fs.rmSync(path.join(STORE_DIR, file), { force: true });
    }
  });

  it('pauses due tasks with invalid group folders to prevent retry churn', async () => {
    createTask({
      id: 'task-invalid-folder',
      group_folder: '../../outside',
      chat_jid: 'bad@g.us',
      prompt: 'run',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      registeredGroups: () => ({}),
      getSessions: () => ({}),
      queue: { enqueueTask } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    const task = getTaskById('task-invalid-folder');
    expect(task?.status).toBe('paused');
  });

  it('classifies scheduled task provider fallback as automation execution even for read-default profiles', async () => {
    createTask({
      id: 'task-report-profile',
      group_folder: 'group-one',
      chat_jid: 'group-one@g.us',
      prompt: 'send the scheduled summary',
      provider_profile_id: 'default_reports',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });
    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      registeredGroups: () => ({
        'group-one@g.us': {
          name: 'Group One',
          folder: 'group-one',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask,
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(runContainerAgent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        providerFallbackPurpose: 'default_reports',
        providerFallbackAction: 'automation-execution',
      }),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('runs dry-run scheduled tasks without sending simulated output externally', async () => {
    vi.mocked(runContainerAgent).mockImplementationOnce(
      async (_group, _input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'success',
          result: 'Dry-run simulated container execution.',
        });
        return {
          status: 'success',
          result: 'Dry-run simulated container execution.',
        };
      },
    );
    createTask({
      id: 'task-dry-run',
      group_folder: 'group-one',
      chat_jid: 'group-one@g.us',
      prompt: 'send the scheduled summary',
      tool_policy: 'dry-run',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });
    const sendMessage = vi.fn(async () => {});

    startSchedulerLoop({
      registeredGroups: () => ({
        'group-one@g.us': {
          name: 'Group One',
          folder: 'group-one',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask: vi.fn(
          (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
            void fn();
          },
        ),
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage,
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(runContainerAgent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ dryRun: true }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(sendMessage).not.toHaveBeenCalled();
    expect(getTaskById('task-dry-run')?.last_result).toContain(
      'Dry-run simulated',
    );
  });

  it('keeps dashboard-only task output in run history without sending a chat message', async () => {
    vi.mocked(runContainerAgent).mockImplementationOnce(
      async (_group, _input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'success',
          result: 'Dashboard-only briefing draft.',
        });
        return { status: 'success', result: 'Dashboard-only briefing draft.' };
      },
    );
    createTask({
      id: 'task-dashboard-delivery',
      group_folder: 'group-one',
      chat_jid: 'group-one@g.us',
      prompt: 'Prepare a briefing draft',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      delivery_mode: 'dashboard',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    } as any);
    const sendMessage = vi.fn(async () => {});

    startSchedulerLoop({
      registeredGroups: () => ({
        'group-one@g.us': {
          name: 'Group One',
          folder: 'group-one',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask: vi.fn(
          (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
            void fn();
          },
        ),
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage,
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(getTaskById('task-dashboard-delivery')?.last_result).toContain(
      'Dashboard-only briefing',
    );
  });

  it('uses and persists named routine sessions separately from group chat sessions', async () => {
    vi.mocked(runContainerAgent).mockImplementationOnce(
      async () =>
        ({
          status: 'success',
          result: 'Session-aware briefing complete.',
          newSessionId: 'session-next',
        }) as any,
    );
    createTask({
      id: 'task-named-session',
      group_folder: 'group-one',
      chat_jid: 'group-one@g.us',
      prompt: 'Continue the routine memory',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'session',
      session_key: 'daily-briefing',
      delivery_mode: 'dashboard',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    } as any);
    const saveSession = vi.fn();

    startSchedulerLoop({
      registeredGroups: () => ({
        'group-one@g.us': {
          name: 'Group One',
          folder: 'group-one',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({ 'task:daily-briefing': 'session-previous' }),
      queue: {
        enqueueTask: vi.fn(
          (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
            void fn();
          },
        ),
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage: async () => {},
      saveSession,
    } as any);

    await vi.advanceTimersByTimeAsync(10);

    expect(runContainerAgent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ sessionId: 'session-previous' }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(saveSession).toHaveBeenCalledWith(
      'task:daily-briefing',
      'session-next',
    );
  });

  it('adds recent source task results to chained routine prompts', async () => {
    vi.mocked(runContainerAgent).mockImplementationOnce(async () => ({
      status: 'success',
      result: 'Chained digest complete.',
    }));
    createTask({
      id: 'task-source',
      group_folder: 'group-one',
      chat_jid: 'group-one@g.us',
      prompt: 'Source task',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'completed',
      created_at: '2026-02-22T00:00:00.000Z',
    });
    logTaskRun({
      task_id: 'task-source',
      run_at: '2026-02-22T08:00:00.000Z',
      duration_ms: 1200,
      status: 'success',
      result: 'Source task found two open P0 issues.',
      error: null,
    });
    createTask({
      id: 'task-chained',
      group_folder: 'group-one',
      chat_jid: 'group-one@g.us',
      prompt: 'Draft the next action plan.',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      delivery_mode: 'dashboard',
      context_task_ids_json: JSON.stringify(['task-source']),
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    } as any);

    startSchedulerLoop({
      registeredGroups: () => ({
        'group-one@g.us': {
          name: 'Group One',
          folder: 'group-one',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask: vi.fn(
          (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
            void fn();
          },
        ),
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(runContainerAgent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        prompt: expect.stringContaining(
          'Source task found two open P0 issues.',
        ),
      }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(vi.mocked(runContainerAgent).mock.calls[0]?.[1].prompt).toContain(
      'Draft the next action plan.',
    );
  });

  it('writes file-delivered task output into the task-deliveries folder', async () => {
    vi.mocked(runContainerAgent).mockImplementationOnce(
      async (_group, _input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'success',
          result: 'File delivery payload.',
        });
        return { status: 'success', result: 'File delivery payload.' };
      },
    );
    createTask({
      id: 'task-file-delivery',
      group_folder: 'group-one',
      chat_jid: 'group-one@g.us',
      prompt: 'Write an artifact',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      delivery_mode: 'file',
      delivery_target: 'briefings/latest.md',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    } as any);
    const sendMessage = vi.fn(async () => {});

    startSchedulerLoop({
      registeredGroups: () => ({
        'group-one@g.us': {
          name: 'Group One',
          folder: 'group-one',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask: vi.fn(
          (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
            void fn();
          },
        ),
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage,
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(
      fs.readFileSync(
        path.join(STORE_DIR, 'task-deliveries', 'briefings', 'latest.md'),
        'utf-8',
      ),
    ).toBe('File delivery payload.');
  });

  it('suppresses chat delivery when a successful heartbeat includes its silent marker', async () => {
    vi.mocked(runContainerAgent).mockImplementationOnce(
      async (_group, _input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'success',
          result: 'HEARTBEAT_OK',
        });
        return { status: 'success', result: 'HEARTBEAT_OK' };
      },
    );
    createTask({
      id: 'task-silent-heartbeat',
      group_folder: 'group-one',
      chat_jid: 'group-one@g.us',
      prompt: 'Check heartbeat',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      delivery_mode: 'chat',
      silent_marker: 'HEARTBEAT_OK',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    } as any);
    const sendMessage = vi.fn(async () => {});

    startSchedulerLoop({
      registeredGroups: () => ({
        'group-one@g.us': {
          name: 'Group One',
          folder: 'group-one',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask: vi.fn(
          (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
            void fn();
          },
        ),
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage,
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(getTaskById('task-silent-heartbeat')?.last_result).toContain(
      'HEARTBEAT_OK',
    );
  });

  it('creates an approval instead of emitting webhook deliveries directly', async () => {
    vi.mocked(runContainerAgent).mockImplementationOnce(
      async (_group, _input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'success',
          result: 'Webhook payload.',
        });
        return { status: 'success', result: 'Webhook payload.' };
      },
    );
    createTask({
      id: 'task-webhook-delivery',
      group_folder: 'group-one',
      chat_jid: 'group-one@g.us',
      title: 'Webhook routine',
      prompt: 'Prepare webhook payload',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      delivery_mode: 'webhook',
      delivery_target: 'https://example.com/hooks/nanocrab',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    } as any);
    const sendMessage = vi.fn(async () => {});

    startSchedulerLoop({
      registeredGroups: () => ({
        'group-one@g.us': {
          name: 'Group One',
          folder: 'group-one',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask: vi.fn(
          (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
            void fn();
          },
        ),
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage,
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(createApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'webhook-delivery',
        requester: 'task-scheduler',
        targetType: 'scheduled-task',
        targetId: 'task-webhook-delivery',
        resourceSummary: 'https://example.com/hooks/nanocrab',
        payload: expect.objectContaining({
          taskId: 'task-webhook-delivery',
          url: 'https://example.com/hooks/nanocrab',
          result: 'Webhook payload.',
        }),
      }),
    );
  });

  it('sends the webhook directly when the target is pre-approved', async () => {
    vi.mocked(hasApprovedTarget).mockReturnValueOnce(true);
    vi.mocked(runContainerAgent).mockImplementationOnce(
      async (_group, _input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'success',
          result: 'Fresh webhook payload.',
        });
        return { status: 'success', result: 'Fresh webhook payload.' };
      },
    );
    createTask({
      id: 'task-webhook-approved',
      group_folder: 'group-one',
      chat_jid: 'group-one@g.us',
      title: 'Webhook routine',
      prompt: 'Prepare webhook payload',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      delivery_mode: 'webhook',
      delivery_target: 'https://example.com/hooks/nanocrab',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    } as any);

    startSchedulerLoop({
      registeredGroups: () => ({
        'group-one@g.us': {
          name: 'Group One',
          folder: 'group-one',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask: vi.fn(
          (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
            void fn();
          },
        ),
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage: vi.fn(async () => {}),
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(createApproval).not.toHaveBeenCalled();
    expect(sendScheduledTaskWebhook).toHaveBeenCalledWith({
      url: 'https://example.com/hooks/nanocrab',
      taskId: 'task-webhook-approved',
      result: 'Fresh webhook payload.',
    });
    const history = loadBriefingHistoryStore();
    const entry = history.entries.find(
      (e) => e.taskId === 'task-webhook-approved',
    );
    expect(entry).toMatchObject({
      status: 'completed',
      approvalState: 'approved',
    });
    expect(entry?.delivery.mode).toBe('webhook');
  });

  it('skips heartbeat tasks during quiet hours without waking the container', async () => {
    createTask({
      id: 'task-quiet-heartbeat',
      group_folder: 'group-one',
      chat_jid: 'group-one@g.us',
      prompt: 'Check heartbeat',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      routine_type: 'heartbeat',
      heartbeat_policy_json: JSON.stringify({
        quietHours: { start: '00:00', end: '23:59' },
      }),
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    } as any);

    startSchedulerLoop({
      registeredGroups: () => ({
        'group-one@g.us': {
          name: 'Group One',
          folder: 'group-one',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask: vi.fn(
          (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
            void fn();
          },
        ),
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(runContainerAgent).not.toHaveBeenCalled();
    expect(getTaskById('task-quiet-heartbeat')?.last_result).toContain(
      'Skipped: quiet hours',
    );
  });

  it('runs stale heartbeat tasks even during quiet hours', async () => {
    createTask({
      id: 'task-stale-heartbeat',
      group_folder: 'group-one',
      chat_jid: 'group-one@g.us',
      prompt: 'Check stale heartbeat',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      routine_type: 'heartbeat',
      heartbeat_policy_json: JSON.stringify({
        quietHours: { start: '00:00', end: '23:59' },
        staleAfterMinutes: 1,
      }),
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    } as any);

    startSchedulerLoop({
      registeredGroups: () => ({
        'group-one@g.us': {
          name: 'Group One',
          folder: 'group-one',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask: vi.fn(
          (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
            void fn();
          },
        ),
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(runContainerAgent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        prompt: 'Check stale heartbeat',
      }),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('skips tasks that have reached their active-run limit', async () => {
    createTask({
      id: 'task-active-limit',
      group_folder: 'group-one',
      chat_jid: 'group-one@g.us',
      prompt: 'Should not run',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      max_active_runs: 1,
      active_run_count: 1,
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    } as any);

    startSchedulerLoop({
      registeredGroups: () => ({
        'group-one@g.us': {
          name: 'Group One',
          folder: 'group-one',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask: vi.fn(
          (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
            void fn();
          },
        ),
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(runContainerAgent).not.toHaveBeenCalled();
    expect(getTaskById('task-active-limit')?.last_result).toContain(
      'Skipped: active run limit',
    );
  });

  it('passes max_runtime_ms through as a task container timeout override', async () => {
    createTask({
      id: 'task-runtime-limit',
      group_folder: 'group-one',
      chat_jid: 'group-one@g.us',
      prompt: 'Run with timeout',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      max_runtime_ms: 123000,
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    } as any);

    startSchedulerLoop({
      registeredGroups: () => ({
        'group-one@g.us': {
          name: 'Group One',
          folder: 'group-one',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask: vi.fn(
          (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
            void fn();
          },
        ),
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(runContainerAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        containerConfig: expect.objectContaining({
          timeout: 123000,
        }),
      }),
      expect.any(Object),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('computeNextRun anchors interval tasks to scheduled time to prevent drift', () => {
    const scheduledTime = new Date(Date.now() - 2000).toISOString(); // 2s ago
    const task = {
      id: 'drift-test',
      group_folder: 'test',
      chat_jid: 'test@g.us',
      prompt: 'test',
      schedule_type: 'interval' as const,
      schedule_value: '60000', // 1 minute
      context_mode: 'isolated' as const,
      next_run: scheduledTime,
      last_run: null,
      last_result: null,
      status: 'active' as const,
      created_at: '2026-01-01T00:00:00.000Z',
    };

    const nextRun = computeNextRun(task);
    expect(nextRun).not.toBeNull();

    // Should be anchored to scheduledTime + 60s, NOT Date.now() + 60s
    const expected = new Date(scheduledTime).getTime() + 60000;
    expect(new Date(nextRun!).getTime()).toBe(expected);
  });

  it('computeNextRun returns null for once-tasks', () => {
    const task = {
      id: 'once-test',
      group_folder: 'test',
      chat_jid: 'test@g.us',
      prompt: 'test',
      schedule_type: 'once' as const,
      schedule_value: '2026-01-01T00:00:00.000Z',
      context_mode: 'isolated' as const,
      next_run: new Date(Date.now() - 1000).toISOString(),
      last_run: null,
      last_result: null,
      status: 'active' as const,
      created_at: '2026-01-01T00:00:00.000Z',
    };

    expect(computeNextRun(task)).toBeNull();
  });

  it('computeNextRun skips missed intervals without infinite loop', () => {
    // Task was due 10 intervals ago (missed)
    const ms = 60000;
    const missedBy = ms * 10;
    const scheduledTime = new Date(Date.now() - missedBy).toISOString();

    const task = {
      id: 'skip-test',
      group_folder: 'test',
      chat_jid: 'test@g.us',
      prompt: 'test',
      schedule_type: 'interval' as const,
      schedule_value: String(ms),
      context_mode: 'isolated' as const,
      next_run: scheduledTime,
      last_run: null,
      last_result: null,
      status: 'active' as const,
      created_at: '2026-01-01T00:00:00.000Z',
    };

    const nextRun = computeNextRun(task);
    expect(nextRun).not.toBeNull();
    // Must be in the future
    expect(new Date(nextRun!).getTime()).toBeGreaterThan(Date.now());
    // Must be aligned to the original schedule grid
    const offset =
      (new Date(nextRun!).getTime() - new Date(scheduledTime).getTime()) % ms;
    expect(offset).toBe(0);
  });

  it('records a briefing history entry after a successful run', async () => {
    vi.mocked(runContainerAgent).mockImplementationOnce(
      async (_group, _input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'success',
          result: 'Scheduled summary complete.',
        });
        return {
          status: 'success',
          result: 'Scheduled summary complete.',
        };
      },
    );

    createTask({
      id: 'task-history',
      group_folder: 'main',
      chat_jid: 'wa:main',
      prompt: 'Send summary',
      provider_profile_id: 'default_reports',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      delivery_mode: 'chat',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      registeredGroups: () => ({
        'wa:main': {
          name: 'Main',
          folder: 'main',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask,
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    const store = loadBriefingHistoryStore();
    const entry = store.entries.find((e) => e.taskId === 'task-history');
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('completed');
    expect(entry?.source).toBe('scheduled');
    expect(entry?.delivery.mode).toBe('chat');
  });

  it('skips chat delivery when group/channel preference is disabled', async () => {
    vi.mocked(runContainerAgent).mockImplementationOnce(
      async (_group, _input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'success',
          result: 'Disabled channel result.',
        });
        return {
          status: 'success',
          result: 'Disabled channel result.',
        };
      },
    );

    setDeliveryPreference({
      groupFolder: 'main',
      channelId: 'wa:main',
      mode: 'disabled',
    });

    const sendMessage = vi.fn();

    createTask({
      id: 'task-disabled',
      group_folder: 'main',
      chat_jid: 'wa:main',
      prompt: 'Send summary',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      delivery_mode: 'chat',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      registeredGroups: () => ({
        'wa:main': {
          name: 'Main',
          folder: 'main',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask,
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage,
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(sendMessage).not.toHaveBeenCalled();
    const store = loadBriefingHistoryStore();
    const entry = store.entries.find((e) => e.taskId === 'task-disabled');
    expect(entry?.status).toBe('skipped');
    expect(entry?.delivery.failureContext).toMatch(/disabled/i);
  });

  it('creates an approval and records approval-blocked when preference requires it', async () => {
    vi.mocked(runContainerAgent).mockImplementationOnce(
      async (_group, _input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'success',
          result: 'Approval required result.',
        });
        return {
          status: 'success',
          result: 'Approval required result.',
        };
      },
    );

    setDeliveryPreference({
      groupFolder: 'main',
      channelId: 'wa:main',
      mode: 'approval-required',
    });

    createTask({
      id: 'task-approval',
      group_folder: 'main',
      chat_jid: 'wa:main',
      prompt: 'Send summary',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      delivery_mode: 'chat',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      registeredGroups: () => ({
        'wa:main': {
          name: 'Main',
          folder: 'main',
          trigger: '@Andy',
          added_at: '2026-02-22T00:00:00.000Z',
        },
      }),
      getSessions: () => ({}),
      queue: {
        enqueueTask,
        closeStdin: vi.fn(),
        notifyIdle: vi.fn(),
      } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(createApproval).toHaveBeenCalled();
    const store = loadBriefingHistoryStore();
    const entry = store.entries.find((e) => e.taskId === 'task-approval');
    expect(entry?.status).toBe('approval-blocked');
    expect(entry?.approvalState).toBe('pending');
  });
});
