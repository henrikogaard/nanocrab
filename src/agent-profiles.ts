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
  validateAgentProfileInput(input);

  const now = new Date().toISOString();

  return {
    id: `agent_${randomUUID()}`,
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
    createdAt: now,
    updatedAt: now,
  };
}

export function createAgentProfile(input: AgentProfileInput): AgentProfile {
  return insertAgentProfile(buildAgentProfile(input));
}

export function updateAgentProfile(input: AgentProfile): AgentProfile {
  validateAgentProfileInput({
    handle: input.handle,
    displayName: input.displayName,
    provider: input.provider,
    toolPolicy: input.toolPolicy,
  });

  return updateAgentProfileRow({
    ...input,
    handle: normalizeAgentHandle(input.handle),
    displayName: input.displayName.trim(),
    avatar: nullableString(input.avatar),
    description: nullableString(input.description),
    personality: nullableString(input.personality),
    providerProfileId: nullableString(input.providerProfileId),
    model: nullableString(input.model),
    allowedMcpServers:
      input.allowedMcpServers === null
        ? null
        : sanitizeStringList(input.allowedMcpServers),
    skills: sanitizeStringList(input.skills),
    memoryScopes: sanitizeStringList(input.memoryScopes),
    taskKinds: sanitizeTaskKinds(input.taskKinds),
    channelBindings: sanitizeChannelBindings(input.channelBindings),
    updatedAt: new Date().toISOString(),
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
  return [
    input.sourceType,
    input.sourceId,
    input.externalEventId,
    input.agentProfileId,
  ].join(':');
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
