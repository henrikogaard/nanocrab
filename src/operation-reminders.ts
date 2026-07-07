import crypto from 'crypto';
import { CronExpressionParser } from 'cron-parser';

import { TIMEZONE } from './config.js';
import { createTask, getAllRegisteredGroups } from './db.js';
import { ScheduledTask } from './types.js';

export type OperationReminderScheduleType = 'cron' | 'interval' | 'once';

export interface CreateOperationReminderInput {
  groupFolder: string;
  title: string;
  order: string;
  scheduleType: OperationReminderScheduleType;
  scheduleValue: string;
  audience?: string;
  requireConfirmation?: boolean;
}

function nextRunForSchedule(
  scheduleType: OperationReminderScheduleType,
  scheduleValue: string,
): string {
  if (scheduleType === 'cron') {
    const next = CronExpressionParser.parse(scheduleValue, { tz: TIMEZONE })
      .next()
      .toISOString();
    if (!next) throw new Error('cron schedule did not produce a next run');
    return next;
  }
  if (scheduleType === 'interval') {
    const ms = parseInt(scheduleValue, 10);
    if (Number.isNaN(ms) || ms <= 0)
      throw new Error('interval must be positive');
    return new Date(Date.now() + ms).toISOString();
  }
  const date = new Date(scheduleValue);
  if (Number.isNaN(date.getTime()))
    throw new Error('once timestamp is invalid');
  return date.toISOString();
}

function composePrompt(input: CreateOperationReminderInput): string {
  return [
    `Recurring operations reminder: ${input.title.trim()}`,
    '',
    input.order.trim(),
    '',
    input.audience?.trim() ? `Audience: ${input.audience.trim()}` : '',
    input.requireConfirmation
      ? 'Ask recipients to confirm when they have completed or acknowledged the order.'
      : 'Send the reminder clearly and concisely.',
    'Do not publish external messages beyond this target group unless separately approved.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function createOperationReminder(
  input: CreateOperationReminderInput,
): Omit<ScheduledTask, 'last_run' | 'last_result'> {
  const groupFolder = input.groupFolder?.trim();
  const title = input.title?.trim();
  const order = input.order?.trim();
  if (!groupFolder) throw new Error('groupFolder is required');
  if (!title) throw new Error('title is required');
  if (!order) throw new Error('order is required');

  const groupEntry = Object.entries(getAllRegisteredGroups()).find(
    ([, group]) => group.folder === groupFolder,
  );
  if (!groupEntry)
    throw new Error(`registered group not found: ${groupFolder}`);
  const [chatJid] = groupEntry;
  const nextRun = nextRunForSchedule(input.scheduleType, input.scheduleValue);
  const now = new Date().toISOString();
  const task: Omit<ScheduledTask, 'last_run' | 'last_result'> = {
    id: `operation-reminder-${crypto.randomBytes(6).toString('hex')}`,
    group_folder: groupFolder,
    chat_jid: chatJid,
    prompt: composePrompt(input),
    provider_profile_id: 'default_automation',
    provider: null,
    model: null,
    tool_policy: 'read-only',
    schedule_type: input.scheduleType,
    schedule_value: input.scheduleValue,
    context_mode: 'group',
    next_run: nextRun,
    status: 'active',
    created_at: now,
  };
  createTask(task);
  return task;
}
