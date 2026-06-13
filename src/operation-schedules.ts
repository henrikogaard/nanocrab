import crypto from 'crypto';
import { CronExpressionParser } from 'cron-parser';

import { createTask } from './db.js';
import type { ScheduledTask } from './types.js';

export type OperationScheduleIntent = 'orders' | 'reminder';
export type OperationScheduleDelivery = 'preview' | 'send';

export interface CreateOperationScheduleInput {
  groupFolder: string;
  chatJid: string;
  title?: string;
  orders: string;
  intent: OperationScheduleIntent;
  scheduleType: 'cron' | 'interval';
  scheduleValue: string;
  contextMode?: 'group' | 'isolated';
  deliveryMode?: OperationScheduleDelivery;
  deliveryApproved?: boolean;
  providerProfileId?: string | null;
  provider?: ScheduledTask['provider'];
  model?: string | null;
}

export interface OperationScheduleResult {
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>;
  deliveryMode: OperationScheduleDelivery;
}

const MIN_INTERVAL_MS = 5 * 60 * 1000;

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function normalizeIntervalMs(value: string): number {
  const raw = value.trim().toLowerCase();
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = raw.match(/^(\d+)\s*([mhd])$/);
  if (!match) throw new Error('interval must be milliseconds or use m/h/d');
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === 'm'
      ? 60 * 1000
      : unit === 'h'
        ? 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;
  return amount * multiplier;
}

function normalizeSchedule(
  scheduleType: 'cron' | 'interval',
  scheduleValue: string,
  now: Date,
): { value: string; nextRun: string } {
  const rawValue = requiredString(scheduleValue, 'scheduleValue');
  if (scheduleType !== 'cron' && scheduleType !== 'interval') {
    throw new Error('scheduleType must be cron or interval');
  }
  if (scheduleType === 'cron') {
    const interval = CronExpressionParser.parse(rawValue);
    return { value: rawValue, nextRun: interval.next().toDate().toISOString() };
  }

  const ms = normalizeIntervalMs(rawValue);
  if (!Number.isFinite(ms) || ms < MIN_INTERVAL_MS) {
    throw new Error('interval must be at least 5 minutes');
  }
  return {
    value: String(ms),
    nextRun: new Date(now.getTime() + ms).toISOString(),
  };
}

function buildOperationPrompt(input: {
  title: string;
  orders: string;
  intent: OperationScheduleIntent;
  deliveryMode: OperationScheduleDelivery;
}): string {
  const action =
    input.intent === 'orders'
      ? 'Repeat the active operation orders'
      : 'Send an operation reminder and ask for missing confirmations';
  const delivery =
    input.deliveryMode === 'send'
      ? 'Return the exact message that should be sent to this chat.'
      : 'Draft a preview only. Do not ask tools to send, publish, upload, or forward anything.';
  return [
    '[operation-schedule]',
    `Title: ${input.title}`,
    `Intent: ${input.intent}`,
    '',
    action,
    '',
    'Orders/reminder context:',
    input.orders,
    '',
    delivery,
    'Keep the message concise, operational, and limited to the selected group.',
    'Ask for explicit approval before changing orders, using external connectors, or sending anything outside this scheduled chat.',
  ].join('\n');
}

export function createOperationSchedule(
  input: CreateOperationScheduleInput,
  options: {
    now?: Date;
    id?: string;
    saveTask?: typeof createTask;
  } = {},
): OperationScheduleResult {
  const now = options.now ?? new Date();
  const deliveryMode = input.deliveryMode ?? 'preview';
  if (deliveryMode === 'send' && input.deliveryApproved !== true) {
    throw new Error('scheduled message delivery requires explicit approval');
  }

  const title = requiredString(input.title || 'Operation reminder', 'title');
  const orders = requiredString(input.orders, 'orders');
  const groupFolder = requiredString(input.groupFolder, 'groupFolder');
  const chatJid = requiredString(input.chatJid, 'chatJid');
  const schedule = normalizeSchedule(
    input.scheduleType,
    input.scheduleValue,
    now,
  );
  const id = options.id ?? `operation-schedule-${crypto.randomUUID()}`;
  const task: Omit<ScheduledTask, 'last_run' | 'last_result'> = {
    id,
    group_folder: groupFolder,
    chat_jid: chatJid,
    prompt: buildOperationPrompt({
      title,
      orders,
      intent: input.intent,
      deliveryMode,
    }),
    provider_profile_id: input.providerProfileId || 'default_automation',
    provider: input.provider || null,
    model: input.model || null,
    tool_policy: deliveryMode === 'preview' ? 'dry-run' : 'approval-required',
    schedule_type: input.scheduleType,
    schedule_value: schedule.value,
    context_mode: input.contextMode || 'group',
    next_run: schedule.nextRun,
    status: 'active',
    created_at: now.toISOString(),
  };

  (options.saveTask ?? createTask)(task);
  return { task, deliveryMode };
}
