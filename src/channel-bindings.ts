import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { STORE_DIR } from './config.js';
import { getAgentProfile } from './agent-profiles.js';
import { logger } from './logger.js';

export interface ChannelBinding {
  id: string;
  agentProfileId: string;
  channelType: string;
  channelId: string;
  handle: string | null;
  triggerRules: Record<string, unknown>;
  status: 'pending' | 'active' | 'disabled';
  requestedBy: string;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChannelBindingInput {
  agentProfileId: string;
  channelType: string;
  channelId: string;
  handle?: string;
  triggerRules?: Record<string, unknown>;
  requestedBy?: string;
}

const BINDINGS_PATH = path.join(STORE_DIR, 'channel-bindings.json');

function readBindings(): ChannelBinding[] {
  try {
    return JSON.parse(
      fs.readFileSync(BINDINGS_PATH, 'utf-8'),
    ) as ChannelBinding[];
  } catch {
    return [];
  }
}

function writeBindings(bindings: ChannelBinding[]): void {
  fs.mkdirSync(path.dirname(BINDINGS_PATH), { recursive: true });
  fs.writeFileSync(BINDINGS_PATH, JSON.stringify(bindings, null, 2) + '\n');
}

function nowIso(): string {
  return new Date().toISOString();
}

const SUPPORTED_CHANNEL_TYPES = [
  'whatsapp',
  'telegram',
  'signal',
  'slack',
  'discord',
  'web',
];

export function listChannelBindings(agentProfileId?: string): ChannelBinding[] {
  const bindings = readBindings();
  if (!agentProfileId) return bindings;
  return bindings.filter((b) => b.agentProfileId === agentProfileId);
}

export function getChannelBinding(id: string): ChannelBinding | undefined {
  return readBindings().find((b) => b.id === id);
}

export function createChannelBinding(
  input: CreateChannelBindingInput,
): ChannelBinding {
  if (!SUPPORTED_CHANNEL_TYPES.includes(input.channelType)) {
    throw new Error(
      `Unsupported channel type: ${input.channelType}. Supported: ${SUPPORTED_CHANNEL_TYPES.join(', ')}`,
    );
  }
  if (!input.agentProfileId) {
    throw new Error('agentProfileId is required');
  }
  if (!getAgentProfile(input.agentProfileId)) {
    throw new Error(`Agent profile ${input.agentProfileId} does not exist`);
  }
  if (!input.channelId) {
    throw new Error('channelId is required');
  }
  if (input.channelId.length > 256) {
    throw new Error('channelId exceeds maximum length');
  }

  const bindings = readBindings();

  // Check for duplicate active binding
  const existing = bindings.find(
    (b) =>
      b.agentProfileId === input.agentProfileId &&
      b.channelType === input.channelType &&
      b.channelId === input.channelId &&
      b.status !== 'disabled',
  );
  if (existing) {
    throw new Error(
      'An active or pending binding already exists for this agent/channel combination',
    );
  }

  const now = nowIso();
  const binding: ChannelBinding = {
    id: crypto.randomUUID().slice(0, 8),
    agentProfileId: input.agentProfileId,
    channelType: input.channelType,
    channelId: input.channelId,
    handle: input.handle || null,
    triggerRules: input.triggerRules || {},
    status: 'pending',
    requestedBy: input.requestedBy || 'admin',
    approvedBy: null,
    createdAt: now,
    updatedAt: now,
  };

  bindings.push(binding);
  writeBindings(bindings);

  logger.info(
    {
      id: binding.id,
      agentProfileId: input.agentProfileId,
      channelType: input.channelType,
    },
    'Channel binding created (pending approval)',
  );
  return binding;
}

export function approveChannelBinding(
  id: string,
  approvedBy: string,
): ChannelBinding {
  const bindings = readBindings();
  const binding = bindings.find((b) => b.id === id);
  if (!binding) throw new Error('Binding not found');
  if (binding.status !== 'pending') {
    throw new Error(`Binding is ${binding.status}, not pending`);
  }

  binding.status = 'active';
  binding.approvedBy = approvedBy;
  binding.updatedAt = nowIso();
  writeBindings(bindings);

  logger.info({ id, approvedBy }, 'Channel binding approved');
  return binding;
}

export function disableChannelBinding(id: string): ChannelBinding {
  const bindings = readBindings();
  const binding = bindings.find((b) => b.id === id);
  if (!binding) throw new Error('Binding not found');

  binding.status = 'disabled';
  binding.updatedAt = nowIso();
  writeBindings(bindings);

  logger.info({ id }, 'Channel binding disabled');
  return binding;
}

export function enableChannelBinding(id: string): ChannelBinding {
  const bindings = readBindings();
  const binding = bindings.find((b) => b.id === id);
  if (!binding) throw new Error('Binding not found');
  if (binding.status !== 'disabled') {
    throw new Error(`Binding is ${binding.status}, not disabled`);
  }

  binding.status = 'active';
  binding.updatedAt = nowIso();
  writeBindings(bindings);

  logger.info({ id }, 'Channel binding re-enabled');
  return binding;
}

export function deleteChannelBinding(id: string): boolean {
  const bindings = readBindings();
  const index = bindings.findIndex((b) => b.id === id);
  if (index === -1) return false;

  bindings.splice(index, 1);
  writeBindings(bindings);

  logger.info({ id }, 'Channel binding deleted');
  return true;
}

export function disableBindingsForAgent(agentProfileId: string): number {
  const bindings = readBindings();
  let count = 0;
  for (const binding of bindings) {
    if (
      binding.agentProfileId === agentProfileId &&
      binding.status === 'active'
    ) {
      binding.status = 'disabled';
      binding.updatedAt = nowIso();
      count++;
    }
  }
  if (count > 0) writeBindings(bindings);
  return count;
}

export function getSupportedChannelTypes(): string[] {
  return [...SUPPORTED_CHANNEL_TYPES];
}
