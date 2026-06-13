import { beforeEach, describe, expect, it, vi } from 'vitest';

import { _initTestDatabase, getTaskById } from './db.js';
import { createOperationSchedule } from './operation-schedules.js';

describe('operation schedules', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('creates recurring operation reminders as scheduled tasks', () => {
    const now = new Date('2026-06-13T10:00:00.000Z');
    const result = createOperationSchedule(
      {
        groupFolder: 'operations',
        chatJid: 'tg:operations-room',
        title: 'Night rally orders',
        orders: 'Rally at 20:00. Confirm shield and speedups.',
        intent: 'orders',
        scheduleType: 'interval',
        scheduleValue: '30m',
        deliveryMode: 'preview',
      },
      { id: 'operation-test', now },
    );

    expect(result.task).toMatchObject({
      id: 'operation-test',
      group_folder: 'operations',
      chat_jid: 'tg:operations-room',
      schedule_type: 'interval',
      schedule_value: '1800000',
      next_run: '2026-06-13T10:30:00.000Z',
      context_mode: 'group',
      provider_profile_id: 'default_automation',
      tool_policy: 'dry-run',
    });
    expect(result.task.prompt).toContain('[operation-schedule]');
    expect(result.task.prompt).toContain('Night rally orders');
    expect(getTaskById('operation-test')?.prompt).toContain(
      'Confirm shield and speedups',
    );
  });

  it('requires explicit approval before scheduled operation messages can send', () => {
    const saveTask = vi.fn();

    expect(() =>
      createOperationSchedule(
        {
          groupFolder: 'operations',
          chatJid: 'tg:operations-room',
          title: 'Auto-send reminder',
          orders: 'Send this every 30 minutes.',
          intent: 'reminder',
          scheduleType: 'interval',
          scheduleValue: '30m',
          deliveryMode: 'send',
        },
        { id: 'operation-send-denied', saveTask },
      ),
    ).toThrow('scheduled message delivery requires explicit approval');
    expect(saveTask).not.toHaveBeenCalled();
  });
});
