import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { STORE_DIR, TIMEZONE } from './config.js';
import { createTask as createScheduledTask } from './db.js';
import { PROVIDER_PURPOSES, type ProviderPurpose } from './provider-router.js';
import type { ScheduledTask } from './types.js';

export type BriefingCadence = 'daily' | 'weekly';
export type BriefingStatus = 'active' | 'paused';
export type BriefingDeliveryMode = 'approval' | 'draft' | 'send';

export interface BriefingSchedule {
  id: string;
  title: string;
  cadence: BriefingCadence;
  groupFolder: string;
  chatJid: string;
  timezone: string;
  localTime: string;
  scheduleType: 'cron';
  scheduleValue: string;
  sourceScopes: string[];
  outputFormats: string[];
  providerProfileId: ProviderPurpose;
  deliveryMode: BriefingDeliveryMode;
  requireDeliveryApproval: boolean;
  scheduledTaskId: string;
  status: BriefingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BriefingStore {
  briefings: BriefingSchedule[];
}

export interface CreateBriefingScheduleInput {
  title: string;
  cadence: BriefingCadence;
  groupFolder: string;
  chatJid: string;
  localTime: string;
  timezone?: string;
  sourceScopes?: string[];
  outputFormats?: string[];
  providerProfileId?: ProviderPurpose;
  deliveryMode?: BriefingDeliveryMode;
  requireDeliveryApproval?: boolean;
}

export interface BriefingScheduleOptions {
  storePath?: string;
  now?: () => string;
  id?: () => string;
  createTask?: (task: Omit<ScheduledTask, 'last_run' | 'last_result'>) => void;
}

export const DEFAULT_BRIEFING_STORE = path.join(
  STORE_DIR,
  'briefing-jobs.json',
);

function emptyStore(): BriefingStore {
  return { briefings: [] };
}

function currentTime(options?: BriefingScheduleOptions) {
  return options?.now?.() || new Date().toISOString();
}

function storePath(options?: BriefingScheduleOptions) {
  return options?.storePath || DEFAULT_BRIEFING_STORE;
}

function nextId(options?: BriefingScheduleOptions) {
  return (
    options?.id?.() ||
    `briefing-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  );
}

function normalizeLocalTime(value: string): {
  hour: number;
  minute: number;
  text: string;
} {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) throw new Error('localTime must use HH:mm format');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return {
    hour,
    minute,
    text: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

function cronFor(cadence: BriefingCadence, localTime: string): string {
  const parsed = normalizeLocalTime(localTime);
  return cadence === 'weekly'
    ? `${parsed.minute} ${parsed.hour} * * 1`
    : `${parsed.minute} ${parsed.hour} * * *`;
}

function assertRequired(value: string | undefined, field: string) {
  if (!value || !value.trim()) throw new Error(`${field} is required`);
}

function buildPrompt(briefing: BriefingSchedule): string {
  return [
    `Create a ${briefing.cadence} briefing report titled "${briefing.title}".`,
    `Use source scopes: ${briefing.sourceScopes.join(', ')}.`,
    `Generate output formats: ${briefing.outputFormats.join(', ')}.`,
    'Use Report Studio/report job behavior with source citations and provenance.',
    briefing.requireDeliveryApproval
      ? 'Require delivery approval before sending or publishing anything externally.'
      : 'Keep the briefing as a dashboard draft only; do not send externally.',
  ].join('\n');
}

function normalizeProviderProfileId(value: unknown): ProviderPurpose {
  if (!value) return 'default_reports';
  if (PROVIDER_PURPOSES.includes(value as ProviderPurpose)) {
    return value as ProviderPurpose;
  }
  throw new Error('providerProfileId must be a known provider profile');
}

export function loadBriefingStore(
  filePath = DEFAULT_BRIEFING_STORE,
): BriefingStore {
  try {
    if (!fs.existsSync(filePath)) return emptyStore();
    const raw = JSON.parse(
      fs.readFileSync(filePath, 'utf-8'),
    ) as Partial<BriefingStore>;
    return {
      briefings: Array.isArray(raw.briefings) ? raw.briefings : [],
    };
  } catch {
    return emptyStore();
  }
}

export function saveBriefingStore(
  store: BriefingStore,
  filePath = DEFAULT_BRIEFING_STORE,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`);
}

export function createBriefingSchedule(
  input: CreateBriefingScheduleInput,
  options?: BriefingScheduleOptions,
): BriefingSchedule {
  assertRequired(input.title, 'title');
  assertRequired(input.groupFolder, 'groupFolder');
  assertRequired(input.chatJid, 'chatJid');
  assertRequired(input.localTime, 'localTime');
  if (!['daily', 'weekly'].includes(input.cadence)) {
    throw new Error('cadence must be daily or weekly');
  }

  const deliveryMode = input.deliveryMode || 'approval';
  const providerProfileId = normalizeProviderProfileId(input.providerProfileId);
  const requireDeliveryApproval = input.requireDeliveryApproval !== false;
  if (deliveryMode === 'send' && !requireDeliveryApproval) {
    throw new Error('External-send briefings require delivery approval');
  }

  const parsedTime = normalizeLocalTime(input.localTime);
  const timestamp = currentTime(options);
  const id = nextId(options);
  const briefing: BriefingSchedule = {
    id,
    title: input.title.trim(),
    cadence: input.cadence,
    groupFolder: input.groupFolder.trim(),
    chatJid: input.chatJid.trim(),
    timezone: input.timezone?.trim() || TIMEZONE,
    localTime: parsedTime.text,
    scheduleType: 'cron',
    scheduleValue: cronFor(input.cadence, parsedTime.text),
    sourceScopes: input.sourceScopes?.length
      ? input.sourceScopes
      : ['journal', 'memory'],
    outputFormats: input.outputFormats?.length
      ? input.outputFormats
      : ['markdown'],
    providerProfileId,
    deliveryMode,
    requireDeliveryApproval,
    scheduledTaskId: `${id}-task`,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const store = loadBriefingStore(storePath(options));
  store.briefings.push(briefing);
  saveBriefingStore(store, storePath(options));

  const createTask = options?.createTask || createScheduledTask;
  createTask({
    id: briefing.scheduledTaskId,
    group_folder: briefing.groupFolder,
    chat_jid: briefing.chatJid,
    prompt: buildPrompt(briefing),
    script: null,
    provider_profile_id: briefing.providerProfileId,
    provider: null,
    model: null,
    tool_policy: 'approval-required',
    schedule_type: briefing.scheduleType,
    schedule_value: briefing.scheduleValue,
    context_mode: 'isolated',
    next_run: timestamp,
    status: 'active',
    created_at: timestamp,
  });

  return briefing;
}
