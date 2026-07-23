import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { STORE_DIR, MAX_SESSION_RETENTION_DAYS } from './config.js';
import { redactAuditValue } from './audit-log.js';
import {
  createApproval,
  findPendingApprovalForTarget,
  hasApprovedTarget,
} from './approvals.js';

export type DeliveryPreferenceMode =
  | 'dashboard'
  | 'chat'
  | 'disabled'
  | 'approval-required';

export interface DeliveryPreference {
  groupFolder: string;
  channelId: string;
  mode: DeliveryPreferenceMode;
  updatedAt: string;
  updatedBy?: string | null;
}

export interface DeliveryPreferencesStore {
  preferences: Record<string, Record<string, DeliveryPreference>>;
}

export type BriefingSource = 'scheduled' | 'manual' | 'mobile';
export type BriefingOutcome =
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'approval-blocked';

export interface BriefingDeliveryRecord {
  mode: DeliveryPreferenceMode | 'webhook' | 'file' | 'dashboard' | null;
  target: string | null;
  attemptedAt: string;
  deliveredAt?: string | null;
  failureContext?: string | null;
}

export interface BriefingHistoryEntry {
  id: string;
  taskId: string;
  source: BriefingSource;
  routine: string;
  mission: string;
  groupFolder: string;
  channel: string;
  status: BriefingOutcome;
  delivery: BriefingDeliveryRecord;
  approvalState: 'none' | 'pending' | 'approved' | 'blocked';
  latencyMs: number;
  retryCount: number;
  retriedFrom?: string | null;
  redacted: boolean;
  timestamp: string;
  resultPreview?: string | null;
}

export interface BriefingHistoryStore {
  entries: BriefingHistoryEntry[];
}

export interface BriefingHistoryFilters {
  taskId?: string;
  groupFolder?: string;
  channel?: string;
  source?: BriefingSource;
  status?: BriefingOutcome;
  from?: string;
  to?: string;
  limit?: number;
}

export interface BriefingAnalyticsBucket {
  routine: string;
  mission: string;
  channel: string;
  outcome: BriefingOutcome;
  approvalState: BriefingHistoryEntry['approvalState'];
  count: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  minLatencyMs: number;
  sources: Record<BriefingSource, number>;
  firstAt: string;
  lastAt: string;
}

export interface BriefingAnalyticsResult {
  total: number;
  byRoutine: Record<string, number>;
  byMission: Record<string, number>;
  byChannel: Record<string, number>;
  byOutcome: Record<BriefingOutcome, number>;
  byApprovalState: Record<BriefingHistoryEntry['approvalState'], number>;
  byGroup: Record<string, BriefingGroupAnalytics>;
  schedulePreview: BriefingSchedulePreview[];
  buckets: BriefingAnalyticsBucket[];
}

export interface BriefingGroupAnalytics {
  routine: string;
  total: number;
  successRate: number;
  avgLatencyMs: number;
  deliveryModeBreakdown: Record<string, number>;
  scheduleAdherence: number;
  channels: string[];
}

export interface BriefingSchedulePreview {
  routine: string;
  nextScheduled: string | null;
  frequency: string;
  deliveryMode: string;
  groupFolder: string;
  channel: string;
  recentOutcome: BriefingOutcome | null;
}

export interface BriefingHistoryOptions {
  historyPath?: string;
  preferencesPath?: string;
  now?: () => string;
  id?: () => string;
  maxRetentionDays?: number;
}

export const DEFAULT_BRIEFING_HISTORY_PATH = path.join(
  STORE_DIR,
  'briefing-history.json',
);
export const DEFAULT_DELIVERY_PREFERENCES_PATH = path.join(
  STORE_DIR,
  'delivery-preferences.json',
);

function emptyHistoryStore(): BriefingHistoryStore {
  return { entries: [] };
}

function emptyPreferencesStore(): DeliveryPreferencesStore {
  return { preferences: {} };
}

function historyPath(options?: BriefingHistoryOptions): string {
  return options?.historyPath || DEFAULT_BRIEFING_HISTORY_PATH;
}

function preferencesPath(options?: BriefingHistoryOptions): string {
  return options?.preferencesPath || DEFAULT_DELIVERY_PREFERENCES_PATH;
}

function currentTime(options?: BriefingHistoryOptions): string {
  return options?.now?.() || new Date().toISOString();
}

function nextId(options?: BriefingHistoryOptions): string {
  return (
    options?.id?.() ||
    `briefing-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  );
}

function maxRetentionDays(options?: BriefingHistoryOptions): number {
  return options?.maxRetentionDays ?? MAX_SESSION_RETENTION_DAYS;
}

export function loadBriefingHistoryStore(
  filePath = DEFAULT_BRIEFING_HISTORY_PATH,
): BriefingHistoryStore {
  try {
    if (!fs.existsSync(filePath)) return emptyHistoryStore();
    const raw = JSON.parse(
      fs.readFileSync(filePath, 'utf-8'),
    ) as Partial<BriefingHistoryStore>;
    return { entries: Array.isArray(raw.entries) ? raw.entries : [] };
  } catch {
    return emptyHistoryStore();
  }
}

export function saveBriefingHistoryStore(
  store: BriefingHistoryStore,
  filePath = DEFAULT_BRIEFING_HISTORY_PATH,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`);
}

export function loadDeliveryPreferencesStore(
  filePath = DEFAULT_DELIVERY_PREFERENCES_PATH,
): DeliveryPreferencesStore {
  try {
    if (!fs.existsSync(filePath)) return emptyPreferencesStore();
    const raw = JSON.parse(
      fs.readFileSync(filePath, 'utf-8'),
    ) as Partial<DeliveryPreferencesStore>;
    const preferences: DeliveryPreferencesStore['preferences'] = {};
    if (raw.preferences && typeof raw.preferences === 'object') {
      for (const [group, channels] of Object.entries(raw.preferences)) {
        if (!channels || typeof channels !== 'object') continue;
        preferences[group] = {};
        for (const [channel, pref] of Object.entries(
          channels as Record<string, unknown>,
        )) {
          if (
            pref &&
            typeof pref === 'object' &&
            (pref as DeliveryPreference).mode
          ) {
            preferences[group][channel] = pref as DeliveryPreference;
          }
        }
      }
    }
    return { preferences };
  } catch {
    return emptyPreferencesStore();
  }
}

export function saveDeliveryPreferencesStore(
  store: DeliveryPreferencesStore,
  filePath = DEFAULT_DELIVERY_PREFERENCES_PATH,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`);
}

export function getDeliveryPreference(
  groupFolder: string,
  channelId: string,
  options?: BriefingHistoryOptions,
): DeliveryPreference | undefined {
  const store = loadDeliveryPreferencesStore(preferencesPath(options));
  return store.preferences[groupFolder]?.[channelId];
}

export function setDeliveryPreference(
  input: {
    groupFolder: string;
    channelId: string;
    mode: DeliveryPreferenceMode;
    updatedBy?: string | null;
  },
  options?: BriefingHistoryOptions,
): DeliveryPreference {
  const mode = input.mode;
  if (
    mode !== 'dashboard' &&
    mode !== 'chat' &&
    mode !== 'disabled' &&
    mode !== 'approval-required'
  ) {
    throw new Error(
      'mode must be dashboard, chat, disabled, or approval-required',
    );
  }
  const timestamp = currentTime(options);
  const preference: DeliveryPreference = {
    groupFolder: input.groupFolder.trim(),
    channelId: input.channelId.trim(),
    mode,
    updatedAt: timestamp,
    updatedBy: input.updatedBy ?? null,
  };
  const store = loadDeliveryPreferencesStore(preferencesPath(options));
  if (!store.preferences[preference.groupFolder]) {
    store.preferences[preference.groupFolder] = {};
  }
  store.preferences[preference.groupFolder][preference.channelId] = preference;
  saveDeliveryPreferencesStore(store, preferencesPath(options));
  return preference;
}

export function removeDeliveryPreference(
  groupFolder: string,
  channelId: string,
  options?: BriefingHistoryOptions,
): boolean {
  const store = loadDeliveryPreferencesStore(preferencesPath(options));
  if (!store.preferences[groupFolder]?.[channelId]) return false;
  delete store.preferences[groupFolder][channelId];
  if (Object.keys(store.preferences[groupFolder]).length === 0) {
    delete store.preferences[groupFolder];
  }
  saveDeliveryPreferencesStore(store, preferencesPath(options));
  return true;
}

export function listDeliveryPreferences(
  options?: BriefingHistoryOptions,
): DeliveryPreference[] {
  const store = loadDeliveryPreferencesStore(preferencesPath(options));
  return Object.values(store.preferences)
    .flatMap((group) => Object.values(group))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

function normalizeGroupFolder(group: string): string {
  return path
    .normalize(group)
    .replace(/^(\.\.\/?)+/, '')
    .replace(/^\//, '');
}

export interface ResolvedDelivery {
  mode: BriefingDeliveryRecord['mode'];
  allowed: boolean;
  requiresApproval: boolean;
  reason: string | null;
  preference: DeliveryPreference | undefined;
}

export function resolveDeliveryMode(
  groupFolder: string,
  channelId: string,
  taskDeliveryMode: BriefingDeliveryRecord['mode'],
  options?: BriefingHistoryOptions,
): ResolvedDelivery {
  const normalizedGroup = normalizeGroupFolder(groupFolder);
  const normalizedChannel = channelId.trim();
  const preference = getDeliveryPreference(
    normalizedGroup,
    normalizedChannel,
    options,
  );

  if (preference?.mode === 'disabled') {
    return {
      mode: 'dashboard',
      allowed: false,
      requiresApproval: false,
      reason: 'Channel disabled by group delivery preference',
      preference,
    };
  }

  if (preference?.mode === 'approval-required') {
    return {
      mode: taskDeliveryMode || 'chat',
      allowed: false,
      requiresApproval: true,
      reason: 'Approval required by group delivery preference',
      preference,
    };
  }

  const effectiveMode = preference?.mode || taskDeliveryMode || 'chat';
  if (
    effectiveMode !== 'dashboard' &&
    effectiveMode !== 'chat' &&
    effectiveMode !== 'webhook' &&
    effectiveMode !== 'file'
  ) {
    return {
      mode: 'dashboard',
      allowed: false,
      requiresApproval: false,
      reason: `Unknown delivery mode ${effectiveMode}`,
      preference,
    };
  }

  return {
    mode: effectiveMode,
    allowed: true,
    requiresApproval: false,
    reason: null,
    preference,
  };
}

export interface RecordBriefingRunInput {
  taskId: string;
  source: BriefingSource;
  routine?: string | null;
  mission?: string | null;
  groupFolder: string;
  channel: string;
  status: BriefingOutcome;
  deliveryMode: BriefingDeliveryRecord['mode'];
  deliveryTarget?: string | null;
  failureContext?: string | null;
  latencyMs?: number;
  retryCount?: number;
  retriedFrom?: string | null;
  approvalState?: BriefingHistoryEntry['approvalState'];
  resultPreview?: string | null;
  redacted?: boolean;
}

export function recordBriefingRun(
  input: RecordBriefingRunInput,
  options?: BriefingHistoryOptions,
): BriefingHistoryEntry {
  const timestamp = currentTime(options);
  const store = loadBriefingHistoryStore(historyPath(options));
  const entry: BriefingHistoryEntry = {
    id: nextId(options),
    taskId: input.taskId,
    source: input.source,
    routine: (input.routine ?? input.taskId).trim(),
    mission: (input.mission ?? input.groupFolder).trim(),
    groupFolder: normalizeGroupFolder(input.groupFolder),
    channel: input.channel.trim(),
    status: input.status,
    delivery: {
      mode: input.deliveryMode,
      target: input.deliveryTarget ?? null,
      attemptedAt: timestamp,
      deliveredAt: input.status === 'completed' ? timestamp : null,
      failureContext: input.failureContext
        ? (redactAuditValue(input.failureContext) as string)
        : null,
    },
    approvalState: input.approvalState ?? 'none',
    latencyMs: input.latencyMs ?? 0,
    retryCount: input.retryCount ?? 0,
    retriedFrom: input.retriedFrom ?? null,
    redacted: input.redacted ?? true,
    timestamp,
    resultPreview: input.resultPreview
      ? String(redactAuditValue(input.resultPreview)).slice(0, 500)
      : null,
  };
  store.entries.push(entry);
  pruneBriefingHistory(store, options);
  saveBriefingHistoryStore(store, historyPath(options));
  return entry;
}

export function listBriefingHistory(
  filters: BriefingHistoryFilters = {},
  options?: BriefingHistoryOptions,
): BriefingHistoryEntry[] {
  const store = loadBriefingHistoryStore(historyPath(options));
  let entries = store.entries
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (filters.taskId) {
    entries = entries.filter((e) => e.taskId === filters.taskId);
  }
  if (filters.groupFolder) {
    entries = entries.filter((e) => e.groupFolder === filters.groupFolder);
  }
  if (filters.channel) {
    entries = entries.filter((e) => e.channel === filters.channel);
  }
  if (filters.source) {
    entries = entries.filter((e) => e.source === filters.source);
  }
  if (filters.status) {
    entries = entries.filter((e) => e.status === filters.status);
  }
  if (filters.from) {
    entries = entries.filter((e) => e.timestamp >= filters.from!);
  }
  if (filters.to) {
    entries = entries.filter((e) => e.timestamp <= filters.to!);
  }

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 1000);
  return entries.slice(0, limit);
}

function matchingBriefingHistory(
  filters: BriefingHistoryFilters,
  options?: BriefingHistoryOptions,
): BriefingHistoryEntry[] {
  const store = loadBriefingHistoryStore(historyPath(options));
  return store.entries
    .filter((entry) => !filters.taskId || entry.taskId === filters.taskId)
    .filter(
      (entry) =>
        !filters.groupFolder || entry.groupFolder === filters.groupFolder,
    )
    .filter((entry) => !filters.channel || entry.channel === filters.channel)
    .filter((entry) => !filters.source || entry.source === filters.source)
    .filter((entry) => !filters.status || entry.status === filters.status)
    .filter((entry) => !filters.from || entry.timestamp >= filters.from)
    .filter((entry) => !filters.to || entry.timestamp <= filters.to)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function aggregateBriefingAnalytics(
  entries: BriefingHistoryEntry[],
): BriefingAnalyticsResult {
  const total = entries.length;
  const byRoutine: Record<string, number> = {};
  const byMission: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  const byOutcome: Record<BriefingOutcome, number> = {
    completed: 0,
    skipped: 0,
    failed: 0,
    'approval-blocked': 0,
  };
  const byApprovalState: Record<BriefingHistoryEntry['approvalState'], number> =
    {
      none: 0,
      pending: 0,
      approved: 0,
      blocked: 0,
    };

  const buckets = new Map<string, BriefingAnalyticsBucket>();

  for (const entry of entries) {
    byRoutine[entry.routine] = (byRoutine[entry.routine] || 0) + 1;
    byMission[entry.mission] = (byMission[entry.mission] || 0) + 1;
    byChannel[entry.channel] = (byChannel[entry.channel] || 0) + 1;
    byOutcome[entry.status] = (byOutcome[entry.status] || 0) + 1;
    byApprovalState[entry.approvalState] =
      (byApprovalState[entry.approvalState] || 0) + 1;

    const key = [
      entry.routine,
      entry.mission,
      entry.channel,
      entry.status,
      entry.approvalState,
    ].join('::');
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      existing.avgLatencyMs =
        (existing.avgLatencyMs * (existing.count - 1) + entry.latencyMs) /
        existing.count;
      existing.maxLatencyMs = Math.max(existing.maxLatencyMs, entry.latencyMs);
      existing.minLatencyMs = Math.min(existing.minLatencyMs, entry.latencyMs);
      existing.sources[entry.source] =
        (existing.sources[entry.source] || 0) + 1;
      if (entry.timestamp < existing.firstAt)
        existing.firstAt = entry.timestamp;
      if (entry.timestamp > existing.lastAt) existing.lastAt = entry.timestamp;
    } else {
      buckets.set(key, {
        routine: entry.routine,
        mission: entry.mission,
        channel: entry.channel,
        outcome: entry.status,
        approvalState: entry.approvalState,
        count: 1,
        avgLatencyMs: entry.latencyMs,
        maxLatencyMs: entry.latencyMs,
        minLatencyMs: entry.latencyMs,
        sources: { [entry.source]: 1 } as Record<BriefingSource, number>,
        firstAt: entry.timestamp,
        lastAt: entry.timestamp,
      });
    }
  }

  return {
    total,
    byRoutine,
    byMission,
    byChannel,
    byOutcome,
    byApprovalState,
    byGroup: {} as Record<string, BriefingGroupAnalytics>,
    schedulePreview: [] as BriefingSchedulePreview[],
    buckets: Array.from(buckets.values()).sort((a, b) =>
      b.lastAt.localeCompare(a.lastAt),
    ),
  };
}

export function getBriefingAnalytics(
  filters: BriefingHistoryFilters = {},
  options?: BriefingHistoryOptions,
): BriefingAnalyticsResult {
  const entries = matchingBriefingHistory(filters, options);
  return aggregateBriefingAnalytics(entries);
}

export function pruneBriefingHistory(
  store?: BriefingHistoryStore,
  options?: BriefingHistoryOptions,
): BriefingHistoryStore {
  const target = store ?? loadBriefingHistoryStore(historyPath(options));
  const retentionDays = maxRetentionDays(options);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffIso = cutoff.toISOString();
  target.entries = target.entries.filter(
    (entry) => entry.timestamp >= cutoffIso,
  );
  saveBriefingHistoryStore(target, historyPath(options));
  return target;
}

export function getNextRetryCountForTask(
  taskId: string,
  options?: BriefingHistoryOptions,
): number {
  const store = loadBriefingHistoryStore(historyPath(options));
  return store.entries.filter(
    (entry) =>
      entry.taskId === taskId &&
      (entry.status === 'failed' || entry.status === 'approval-blocked'),
  ).length;
}

export function recordMobileFollowUp(
  input: Omit<RecordBriefingRunInput, 'source'> & { source?: BriefingSource },
  options?: BriefingHistoryOptions,
): BriefingHistoryEntry {
  return recordBriefingRun(
    { ...input, source: input.source ?? 'mobile' },
    options,
  );
}

export function exportBriefingHistory(
  filters: BriefingHistoryFilters = {},
  options?: BriefingHistoryOptions,
): { exportedAt: string; entries: BriefingHistoryEntry[] } {
  return {
    exportedAt: currentTime(options),
    entries: listBriefingHistory(filters, options),
  };
}

export interface SendChannelFollowUpInput {
  groupFolder: string;
  channelId: string;
  text: string;
  sendMessage(jid: string, text: string): Promise<void> | void;
  taskId?: string;
  source?: BriefingSource;
  options?: BriefingHistoryOptions;
}

export async function sendChannelFollowUp(
  input: SendChannelFollowUpInput,
): Promise<BriefingHistoryEntry> {
  const taskId = input.taskId ?? `mobile-${input.channelId}`;
  const source = input.source ?? 'mobile';
  const resolved = resolveDeliveryMode(
    input.groupFolder,
    input.channelId,
    'chat',
    input.options,
  );

  if (resolved.mode === 'disabled' || !resolved.allowed) {
    if (resolved.requiresApproval) {
      const approved = hasApprovedTarget(
        'briefing-delivery',
        'mobile-followup',
        taskId,
      );
      if (!approved) {
        const existingApproval = findPendingApprovalForTarget(
          'briefing-delivery',
          'mobile-followup',
          taskId,
        );
        if (!existingApproval) {
          createApproval({
            kind: 'briefing-delivery',
            title: `Deliver mobile follow-up to ${input.channelId}`,
            summary: `Approve delivery of a mobile follow-up message to ${input.channelId}.`,
            risk: 'low',
            requester: 'mobile-followup',
            targetType: 'mobile-followup',
            targetId: taskId,
            source: 'mobile-followup',
            correlationId: `mobile-followup:${taskId}`,
            actionPreview: input.text.slice(0, 1000),
            resourceSummary: input.channelId,
            payload: {
              groupFolder: input.groupFolder,
              channelId: input.channelId,
              text: input.text,
            },
          });
        }
        return recordMobileFollowUp(
          {
            taskId,
            source,
            groupFolder: input.groupFolder,
            channel: input.channelId,
            status: 'approval-blocked',
            deliveryMode: resolved.mode,
            deliveryTarget: input.channelId,
            failureContext: resolved.reason,
            resultPreview: input.text,
            approvalState: 'pending',
          },
          input.options,
        );
      }
      // Approved: fall through to send.
    } else {
      return recordMobileFollowUp(
        {
          taskId,
          source,
          groupFolder: input.groupFolder,
          channel: input.channelId,
          status: 'skipped',
          deliveryMode: resolved.mode,
          deliveryTarget: input.channelId,
          failureContext: resolved.reason,
          resultPreview: input.text,
          approvalState: 'none',
        },
        input.options,
      );
    }
  }

  try {
    await input.sendMessage(input.channelId, input.text);
    return recordMobileFollowUp(
      {
        taskId,
        source,
        groupFolder: input.groupFolder,
        channel: input.channelId,
        status: 'completed',
        deliveryMode: resolved.mode,
        deliveryTarget: input.channelId,
        resultPreview: input.text,
        approvalState: resolved.requiresApproval ? 'approved' : 'none',
      },
      input.options,
    );
  } catch (err) {
    const failureContext = err instanceof Error ? err.message : String(err);
    return recordMobileFollowUp(
      {
        taskId,
        source,
        groupFolder: input.groupFolder,
        channel: input.channelId,
        status: 'failed',
        deliveryMode: resolved.mode,
        deliveryTarget: input.channelId,
        failureContext,
        resultPreview: input.text,
        approvalState: 'none',
      },
      input.options,
    );
  }
}

// Grouped routine analytics

export function aggregateGroupedRoutineAnalytics(
  entries: BriefingHistoryEntry[],
): BriefingGroupAnalytics[] {
  const byRoutine = new Map<string, BriefingHistoryEntry[]>();

  for (const entry of entries) {
    if (!byRoutine.has(entry.routine)) {
      byRoutine.set(entry.routine, []);
    }
    byRoutine.get(entry.routine)!.push(entry);
  }

  const result: BriefingGroupAnalytics[] = [];

  for (const [routine, routineEntries] of byRoutine) {
    const total = routineEntries.length;
    const successCount = routineEntries.filter(
      (e) => e.status === 'completed',
    ).length;
    const totalLatency = routineEntries.reduce(
      (sum, e) => sum + e.latencyMs,
      0,
    );
    const deliveryModes: Record<string, number> = {};
    const channels = new Set<string>();

    for (const entry of routineEntries) {
      const mode = entry.delivery.mode || 'none';
      deliveryModes[mode] = (deliveryModes[mode] || 0) + 1;
      channels.add(entry.channel);
    }

    result.push({
      routine,
      total,
      successRate: total > 0 ? successCount / total : 0,
      avgLatencyMs: total > 0 ? totalLatency / total : 0,
      deliveryModeBreakdown: deliveryModes,
      scheduleAdherence: total > 0 ? successCount / total : 0,
      channels: Array.from(channels),
    });
  }

  return result.sort((a, b) => b.total - a.total);
}

export function getGroupedRoutineAnalytics(
  filters: BriefingHistoryFilters = {},
  options?: BriefingHistoryOptions,
): BriefingGroupAnalytics[] {
  const entries = matchingBriefingHistory(filters, options);
  return aggregateGroupedRoutineAnalytics(entries);
}
