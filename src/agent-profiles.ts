import { randomUUID } from 'crypto';

import { isAgentProvider } from './agent-provider.js';
import {
  getAgentProfileRow,
  getAgentProfileRowByHandle,
  getAgentSubscriptionEventByDedupeKey,
  insertAgentProfile,
  insertAgentProfileActivity,
  insertAgentSubscription,
  insertAgentSubscriptionEvent,
  listAgentProfileActivityRows,
  listAgentProfileRows,
  listAgentSubscriptionsForProfile,
  updateAgentProfile as updateAgentProfileRow,
  updateAgentSubscription as updateAgentSubscriptionRow,
} from './db.js';
import type {
  AgentProfile,
  AgentProfileActivity,
  AgentProfileTaskKind,
  AgentProfileToolPolicy,
  AgentSubscription,
  AgentSubscriptionAutonomyMode,
  AgentSubscriptionEvent,
  AgentSubscriptionSourceType,
  NewAgentProfileActivity,
  NewAgentSubscriptionEvent,
} from './types.js';

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

const TASK_KINDS: AgentProfileTaskKind[] = [
  'chat',
  'cowork_task',
  'coding_job',
  'report',
  'research',
  'scheduled_check',
];

const TOOL_POLICIES: AgentProfileToolPolicy[] = [
  'read-only',
  'approval-required',
  'allow',
];

const SUBSCRIPTION_SOURCE_TYPES: AgentSubscriptionSourceType[] = [
  'github',
  'channel_mention',
];

export interface AgentProfileInput {
  handle: string;
  displayName: string;
  avatar?: string | null;
  description?: string | null;
  personality?: string | null;
  enabled?: boolean;
  providerProfileId?: string | null;
  provider?: string | null;
  model?: string | null;
  toolPolicy?: AgentProfileToolPolicy;
  allowedMcpServers?: string[] | null;
  skills?: string[];
  memoryScopes?: string[];
  taskKinds?: AgentProfileTaskKind[];
  channelBindings?: Record<string, string[]>;
  writePolicy?: {
    directSendRequiresApproval?: boolean;
    autonomousSendRequiresApproval?: boolean;
  };
}

export type AgentProfileUpdateInput = Partial<AgentProfileInput>;

export interface AgentSubscriptionInput {
  agentProfileId: string;
  sourceType: AgentSubscriptionSourceType;
  enabled?: boolean;
  filters?: Record<string, unknown>;
  taskKind: AgentProfileTaskKind;
  autonomyMode?: AgentSubscriptionAutonomyMode;
  lastSeenAt?: string | null;
  lastMatchedAt?: string | null;
  lastRunId?: string | null;
}

export type AgentSubscriptionUpdateInput = Partial<
  Pick<
    AgentSubscription,
    | 'enabled'
    | 'filters'
    | 'taskKind'
    | 'autonomyMode'
    | 'lastSeenAt'
    | 'lastMatchedAt'
    | 'lastRunId'
  >
>;

export type NewAgentSubscriptionEventInput = Omit<
  NewAgentSubscriptionEvent,
  'id' | 'createdAt'
>;

export type NewAgentProfileActivityInput = Omit<
  NewAgentProfileActivity,
  'id' | 'createdAt'
>;

export function normalizeAgentHandle(value: string): string {
  return value.trim().replace(/^@+/, '').toLowerCase();
}

export function validateAgentProfileInput(input: AgentProfileInput): void {
  const handle = normalizeAgentHandle(input.handle || '');

  if (!HANDLE_RE.test(handle)) {
    throw new Error(
      'agent profile handle must be 2-32 chars using lowercase letters, numbers, underscores, or dashes',
    );
  }

  if (!input.displayName?.trim()) {
    throw new Error('agent profile displayName is required');
  }

  if (input.provider && !isAgentProvider(input.provider)) {
    throw new Error(
      `agent profile provider is not supported: ${input.provider}`,
    );
  }

  if (input.toolPolicy && !TOOL_POLICIES.includes(input.toolPolicy)) {
    throw new Error(
      `agent profile toolPolicy is not supported: ${input.toolPolicy}`,
    );
  }
}

export function buildAgentProfile(input: AgentProfileInput): AgentProfile {
  const now = new Date().toISOString();

  return {
    id: `agent_${randomUUID()}`,
    ...normalizeAgentProfileFields(input),
    createdAt: now,
    updatedAt: now,
  };
}

export function createAgentProfile(input: AgentProfileInput): AgentProfile {
  return insertAgentProfile(buildAgentProfile(input));
}

export function updateAgentProfile(
  id: string,
  patch: AgentProfileUpdateInput,
  now: () => string = () => new Date().toISOString(),
): AgentProfile {
  const existing = getAgentProfileRow(id);
  if (!existing) throw new Error(`Agent profile not found: ${id}`);

  return updateAgentProfileRow({
    ...existing,
    ...normalizeAgentProfileFields({
      handle: patch.handle === undefined ? existing.handle : patch.handle,
      displayName:
        patch.displayName === undefined
          ? existing.displayName
          : patch.displayName,
      avatar: patch.avatar === undefined ? existing.avatar : patch.avatar,
      description:
        patch.description === undefined
          ? existing.description
          : patch.description,
      personality:
        patch.personality === undefined
          ? existing.personality
          : patch.personality,
      enabled: patch.enabled === undefined ? existing.enabled : patch.enabled,
      providerProfileId:
        patch.providerProfileId === undefined
          ? existing.providerProfileId
          : patch.providerProfileId,
      provider:
        patch.provider === undefined ? existing.provider : patch.provider,
      model: patch.model === undefined ? existing.model : patch.model,
      toolPolicy:
        patch.toolPolicy === undefined ? existing.toolPolicy : patch.toolPolicy,
      allowedMcpServers:
        patch.allowedMcpServers === undefined
          ? existing.allowedMcpServers
          : patch.allowedMcpServers,
      skills: patch.skills === undefined ? existing.skills : patch.skills,
      memoryScopes:
        patch.memoryScopes === undefined
          ? existing.memoryScopes
          : patch.memoryScopes,
      taskKinds:
        patch.taskKinds === undefined ? existing.taskKinds : patch.taskKinds,
      channelBindings:
        patch.channelBindings === undefined
          ? existing.channelBindings
          : patch.channelBindings,
      writePolicy:
        patch.writePolicy === undefined
          ? existing.writePolicy
          : {
              ...existing.writePolicy,
              ...patch.writePolicy,
            },
    }),
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: now(),
  });
}

export function getAgentProfile(id: string): AgentProfile | undefined {
  return getAgentProfileRow(id);
}

export function getAgentProfileByHandle(
  handle: string,
): AgentProfile | undefined {
  return getAgentProfileRowByHandle(normalizeAgentHandle(handle));
}

export function listAgentProfiles(): AgentProfile[] {
  return listAgentProfileRows();
}

export function createAgentSubscription(
  input: AgentSubscriptionInput,
): AgentSubscription {
  validateSubscriptionShape({
    sourceType: input.sourceType,
    taskKind: input.taskKind,
    autonomyMode: input.autonomyMode,
  });

  if (!getAgentProfileRow(input.agentProfileId)) {
    throw new Error(`agent profile not found: ${input.agentProfileId}`);
  }

  const now = new Date().toISOString();
  return insertAgentSubscription({
    id: `sub_${randomUUID()}`,
    agentProfileId: input.agentProfileId,
    sourceType: input.sourceType,
    enabled: input.enabled !== false,
    filters: input.filters || {},
    taskKind: input.taskKind,
    autonomyMode: input.autonomyMode || 'investigate_then_pause',
    lastSeenAt: input.lastSeenAt ?? null,
    lastMatchedAt: input.lastMatchedAt ?? null,
    lastRunId: input.lastRunId ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

export function listAgentSubscriptions(
  agentProfileId: string,
): AgentSubscription[] {
  return listAgentSubscriptionsForProfile(agentProfileId);
}

export function updateAgentSubscription(
  agentProfileId: string,
  subscriptionId: string,
  patch: AgentSubscriptionUpdateInput,
): AgentSubscription {
  const existing = listAgentSubscriptionsForProfile(agentProfileId).find(
    (subscription) => subscription.id === subscriptionId,
  );
  if (!existing) {
    throw new Error(`Agent subscription not found: ${subscriptionId}`);
  }

  const sanitizedPatch = sanitizeSubscriptionPatch(patch);

  const merged: AgentSubscription = {
    ...existing,
    enabled:
      sanitizedPatch.enabled === undefined
        ? existing.enabled
        : sanitizedPatch.enabled,
    filters:
      sanitizedPatch.filters === undefined
        ? existing.filters
        : sanitizedPatch.filters,
    taskKind:
      sanitizedPatch.taskKind === undefined
        ? existing.taskKind
        : sanitizedPatch.taskKind,
    autonomyMode:
      sanitizedPatch.autonomyMode === undefined
        ? existing.autonomyMode
        : sanitizedPatch.autonomyMode,
    lastSeenAt:
      sanitizedPatch.lastSeenAt === undefined
        ? existing.lastSeenAt
        : sanitizedPatch.lastSeenAt,
    lastMatchedAt:
      sanitizedPatch.lastMatchedAt === undefined
        ? existing.lastMatchedAt
        : sanitizedPatch.lastMatchedAt,
    lastRunId:
      sanitizedPatch.lastRunId === undefined
        ? existing.lastRunId
        : sanitizedPatch.lastRunId,
    id: existing.id,
    agentProfileId: existing.agentProfileId,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  validateSubscriptionShape({
    sourceType: merged.sourceType,
    taskKind: merged.taskKind,
    autonomyMode: merged.autonomyMode,
  });

  return updateAgentSubscriptionRow(merged);
}

function sanitizeSubscriptionPatch(
  patch: AgentSubscriptionUpdateInput,
): AgentSubscriptionUpdateInput {
  const rawPatch = patch as Record<string, unknown>;
  const sanitized: AgentSubscriptionUpdateInput = {};

  if (rawPatch.enabled !== undefined) {
    if (typeof rawPatch.enabled !== 'boolean') {
      throw new Error('agent subscription enabled must be a boolean');
    }
    sanitized.enabled = rawPatch.enabled;
  }

  if (rawPatch.filters !== undefined) {
    if (!isPlainRecord(rawPatch.filters)) {
      throw new Error('agent subscription filters must be a plain object');
    }
    sanitized.filters = { ...rawPatch.filters };
  }

  if (rawPatch.taskKind !== undefined) {
    sanitized.taskKind = rawPatch.taskKind as AgentProfileTaskKind;
  }

  if (rawPatch.autonomyMode !== undefined) {
    sanitized.autonomyMode =
      rawPatch.autonomyMode as AgentSubscriptionAutonomyMode;
  }

  sanitizeNullableStringPatchField(rawPatch, sanitized, 'lastSeenAt');
  sanitizeNullableStringPatchField(rawPatch, sanitized, 'lastMatchedAt');
  sanitizeNullableStringPatchField(rawPatch, sanitized, 'lastRunId');

  return sanitized;
}

function sanitizeNullableStringPatchField(
  rawPatch: Record<string, unknown>,
  sanitized: AgentSubscriptionUpdateInput,
  field: 'lastSeenAt' | 'lastMatchedAt' | 'lastRunId',
): void {
  const value = rawPatch[field];
  if (value === undefined) return;

  if (value !== null && typeof value !== 'string') {
    throw new Error(`agent subscription ${field} must be a string or null`);
  }

  sanitized[field] = value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function recordAgentSubscriptionEvent(
  input: NewAgentSubscriptionEventInput,
): AgentSubscriptionEvent {
  const existing = getAgentSubscriptionEventByDedupeKey(input.dedupeKey);
  if (existing) return existing;

  validateSubscriptionSourceType(input.sourceType);

  const event: NewAgentSubscriptionEvent = {
    ...input,
    id: `sub_event_${randomUUID()}`,
    runId: input.runId ?? null,
    metadata: input.metadata || {},
    createdAt: new Date().toISOString(),
  };

  try {
    return insertAgentSubscriptionEvent(event);
  } catch (err) {
    const deduped = getAgentSubscriptionEventByDedupeKey(input.dedupeKey);
    if (deduped) return deduped;
    throw err;
  }
}

export function recordAgentProfileActivity(
  input: NewAgentProfileActivityInput,
): AgentProfileActivity {
  return insertAgentProfileActivity({
    ...input,
    id: `agent_activity_${randomUUID()}`,
    subscriptionId: input.subscriptionId ?? null,
    sourceId: input.sourceId ?? null,
    runId: input.runId ?? null,
    approvalId: input.approvalId ?? null,
    metadata: input.metadata || {},
    createdAt: new Date().toISOString(),
  });
}

export function listAgentProfileActivity(
  agentProfileId: string,
  limit?: number,
): AgentProfileActivity[] {
  return listAgentProfileActivityRows(agentProfileId, limit);
}

export function buildSubscriptionDedupeKey(input: {
  sourceType: AgentSubscriptionSourceType;
  sourceId: string;
  externalEventId: string;
  agentProfileId: string;
}): string {
  return JSON.stringify([
    input.sourceType,
    input.sourceId,
    input.externalEventId,
    input.agentProfileId,
  ]);
}

export function validateSubscriptionShape(input: {
  sourceType: AgentSubscriptionSourceType;
  taskKind: AgentProfileTaskKind;
  autonomyMode?: AgentSubscriptionAutonomyMode;
}): void {
  validateSubscriptionSourceType(input.sourceType);

  if (!TASK_KINDS.includes(input.taskKind)) {
    throw new Error(`unsupported subscription taskKind: ${input.taskKind}`);
  }

  if (input.autonomyMode && input.autonomyMode !== 'investigate_then_pause') {
    throw new Error(
      `unsupported subscription autonomyMode: ${input.autonomyMode}`,
    );
  }
}

function validateSubscriptionSourceType(
  sourceType: AgentSubscriptionSourceType,
): void {
  if (!SUBSCRIPTION_SOURCE_TYPES.includes(sourceType)) {
    throw new Error(`unsupported subscription sourceType: ${sourceType}`);
  }
}

function nullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeAgentProfileFields(
  input: AgentProfileInput,
): Omit<AgentProfile, 'id' | 'createdAt' | 'updatedAt'> {
  validateAgentProfileInput(input);

  return {
    handle: normalizeAgentHandle(input.handle),
    displayName: input.displayName.trim(),
    avatar: nullableString(input.avatar),
    description: nullableString(input.description),
    personality: nullableString(input.personality),
    enabled: input.enabled !== false,
    providerProfileId: nullableString(input.providerProfileId),
    provider:
      input.provider && isAgentProvider(input.provider) ? input.provider : null,
    model: nullableString(input.model),
    toolPolicy: input.toolPolicy || 'approval-required',
    allowedMcpServers: Array.isArray(input.allowedMcpServers)
      ? sanitizeStringList(input.allowedMcpServers)
      : null,
    skills: sanitizeStringList(input.skills),
    memoryScopes: sanitizeStringList(input.memoryScopes),
    taskKinds: sanitizeTaskKinds(input.taskKinds),
    channelBindings: sanitizeChannelBindings(input.channelBindings),
    writePolicy: {
      directSendRequiresApproval:
        input.writePolicy?.directSendRequiresApproval === true,
      autonomousSendRequiresApproval:
        input.writePolicy?.autonomousSendRequiresApproval !== false,
    },
  };
}

function sanitizeStringList(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) return [];

  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function sanitizeTaskKinds(
  values: AgentProfileTaskKind[] | undefined,
): AgentProfileTaskKind[] {
  if (!Array.isArray(values) || values.length === 0) return ['chat'];

  const sanitized = values.filter((value) => TASK_KINDS.includes(value));
  return sanitized.length > 0 ? sanitized : ['chat'];
}

function sanitizeChannelBindings(
  values: Record<string, string[]> | undefined,
): Record<string, string[]> {
  if (!values) return {};

  return Object.entries(values).reduce<Record<string, string[]>>(
    (bindings, [channel, handles]) => {
      const cleanChannel = channel.trim();
      const cleanHandles = sanitizeStringList(handles);
      if (cleanChannel && cleanHandles.length > 0) {
        bindings[cleanChannel] = cleanHandles;
      }
      return bindings;
    },
    {},
  );
}
