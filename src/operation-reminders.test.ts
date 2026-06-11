import fs from 'fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanocrab-operation-reminders-test';

vi.mock('./config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  DATA_DIR: '/tmp/nanocrab-operation-reminders-test/data',
  GROUPS_DIR: '/tmp/nanocrab-operation-reminders-test/groups',
  STORE_DIR: '/tmp/nanocrab-operation-reminders-test/store',
  TIMEZONE: 'UTC',
}));

import { _closeDatabase, _initTestDatabase, setRegisteredGroup } from './db.js';
import { createOperationReminder } from './operation-reminders.js';

describe('operation reminders', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    _initTestDatabase();
    setRegisteredGroup('tg:operations', {
      name: 'Operations',
      folder: 'operations',
      trigger: '@Andy',
      added_at: '2026-06-10T00:00:00.000Z',
    });
  });

  afterEach(() => {
    _closeDatabase();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('creates a recurring operations reminder task', () => {
    const task = createOperationReminder({
      groupFolder: 'operations',
      title: 'Rally check',
      order: 'Remind pilots to confirm rally status.',
      scheduleType: 'cron',
      scheduleValue: '0 8 * * *',
      requireConfirmation: true,
    });

    expect(task).toMatchObject({
      group_folder: 'operations',
      chat_jid: 'tg:operations',
      schedule_type: 'cron',
      provider_profile_id: 'default_automation',
      context_mode: 'group',
      status: 'active',
    });
    expect(task.prompt).toContain('Rally check');
    expect(task.prompt).toContain('confirm');
  });

  it('rejects invalid schedules before creating a task', () => {
    expect(() =>
      createOperationReminder({
        groupFolder: 'operations',
        title: 'Bad reminder',
        order: 'This should not be scheduled.',
        scheduleType: 'interval',
        scheduleValue: '0',
      }),
    ).toThrow('interval must be positive');
  });
});
