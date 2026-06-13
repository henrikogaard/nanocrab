import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { createBriefingSchedule, loadBriefingStore } from './briefing-jobs.js';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocrab-briefings-'));
  return path.join(dir, 'briefings.json');
}

describe('briefing jobs', () => {
  it('creates a daily briefing schedule backed by an approval-gated scheduled task', () => {
    const storePath = tempStore();
    const createTask = vi.fn();

    const briefing = createBriefingSchedule(
      {
        title: 'Morning Briefing',
        cadence: 'daily',
        groupFolder: 'main',
        chatJid: 'wa:alliance-command',
        localTime: '08:30',
        timezone: 'Europe/Oslo',
        sourceScopes: ['journal', 'memory'],
        outputFormats: ['markdown'],
        deliveryMode: 'approval',
      },
      {
        storePath,
        createTask,
        now: () => '2026-06-13T08:00:00.000Z',
        id: () => 'briefing-1',
      },
    );

    expect(briefing).toMatchObject({
      id: 'briefing-1',
      title: 'Morning Briefing',
      cadence: 'daily',
      scheduleType: 'cron',
      scheduleValue: '30 8 * * *',
      status: 'active',
      scheduledTaskId: 'briefing-1-task',
      requireDeliveryApproval: true,
    });
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'briefing-1-task',
        group_folder: 'main',
        chat_jid: 'wa:alliance-command',
        provider_profile_id: 'default_reports',
        tool_policy: 'approval-required',
        schedule_type: 'cron',
        schedule_value: '30 8 * * *',
        context_mode: 'isolated',
        status: 'active',
      }),
    );
    expect(createTask.mock.calls[0][0].prompt).toContain(
      'Create a daily briefing report',
    );
    expect(createTask.mock.calls[0][0].prompt).toContain(
      'Require delivery approval before sending or publishing anything externally.',
    );

    expect(loadBriefingStore(storePath).briefings).toHaveLength(1);
  });

  it('blocks external-send briefing schedules when delivery approval is disabled', () => {
    expect(() =>
      createBriefingSchedule(
        {
          title: 'Unsafe Briefing',
          cadence: 'weekly',
          groupFolder: 'main',
          chatJid: 'wa:alliance-command',
          localTime: '09:00',
          deliveryMode: 'send',
          requireDeliveryApproval: false,
        },
        { storePath: tempStore(), createTask: vi.fn() },
      ),
    ).toThrow(/delivery approval/i);
  });
});
