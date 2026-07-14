import fs from 'fs';
import path from 'path';

import {
  AgentProvider,
  AGENT_PROVIDER_DEFINITIONS,
  AGENT_PROVIDER_MODELS,
  AGENT_PROVIDERS,
  DEFAULT_AGENT_MODELS,
  getAgentProviderConfig,
  getProviderAvailability,
  isAgentProvider,
  isValidAgentModel,
  providerApiKeyEnvKey,
} from './agent-provider.js';
import { STORE_DIR } from './config.js';
import { readEnvFile } from './env.js';
import {
  createApproval,
  findPendingApprovalForTarget,
  listApprovals,
} from './approvals.js';
import { liveProbeService } from './providers/live-probe.js';
import type { ProviderCapabilitiesResult } from './providers/openai-responses/provider.js';
import {
  type FallbackAction,
  FallbackPolicyManager,
} from './providers/fallback-policy.js';

export const PROVIDER_PURPOSES = [
  'default_chat',
  'default_coding',
  'default_automation',
  'default_memory',
  'default_journal',
  'default_skill_factory',
  'default_reports',
  'default_docs',
  'default_vision',
] as const;

export type ProviderPurpose = (typeof PROVIDER_PURPOSES)[number];
export type ProviderToolPolicy =
  | 'deny'
  | 'read-only'
  | 'approval-required'
  | 'allow';

export interface ProviderCapabilities {
  tool_calls: boolean;
  structured_output: boolean;
  streaming: boolean;
  vision: boolean;
  code_strength: 'none' | 'basic' | 'agentic';
  context_window: number;
  cost_tier: 'local' | 'low' | 'medium' | 'high' | 'unknown';
  privacy_tier: 'local' | 'hosted' | 'third-party';
  supports_mcp_strategy: 'native' | 'container-loop' | 'none';
}

export interface ProviderProfile {
  id: ProviderPurpose;
  label: string;
  purpose: ProviderPurpose;
  provider: AgentProvider;
  model: string;
  baseUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
  toolPolicy: ProviderToolPolicy;
  fallbackProfileId?: ProviderPurpose | null;
  updatedAt: string;
}

export interface ProviderProbeCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface ProviderProbeResult {
  profileId?: ProviderPurpose;
  provider: AgentProvider;
  model: string;
  ok: boolean;
  checks: ProviderProbeCheck[];
  live?: boolean;
  lastProbeAt?: string;
  latencyMs?: number;
  capabilities?: ProviderCapabilities;
  errors?: string[];
  errorDetail?: string;
  recommendedPurposes?: ProviderPurpose[];
}

export interface ProviderProbeHistoryEntry {
  profileId?: ProviderPurpose;
  provider: AgentProvider;
  model: string;
  ok: boolean;
  latencyMs?: number;
  streaming?: boolean;
  streamingSupport: boolean;
  toolSupport: boolean;
  schemaSupport: boolean;
  visionSupport: boolean;
  contextWindow: number;
  errorDetail?: string;
  timestamp: string;
}

interface ProviderProbeStore {
  latestByProfile: Record<string, ProviderProbeResult>;
  history: ProviderProbeHistoryEntry[];
}

const PROFILE_PATH = path.join(STORE_DIR, 'provider-profiles.json');
const PROBE_PATH = path.join(STORE_DIR, 'provider-probes.json');

const PURPOSE_LABELS: Record<ProviderPurpose, string> = {
  default_chat: 'Chat',
  default_coding: 'Coding',
  default_automation: 'Automations',
  default_memory: 'Memory extraction',
  default_journal: 'Journal extraction',
  default_skill_factory: 'Skill Factory',
  default_reports: 'Reports',
  default_docs: 'Documents',
  default_vision: 'Vision',
};

const PURPOSE_TOOL_POLICIES: Record<ProviderPurpose, ProviderToolPolicy> = {
  default_chat: 'read-only',
  default_coding: 'approval-required',
  default_automation: 'approval-required',
  default_memory: 'read-only',
  default_journal: 'read-only',
  default_skill_factory: 'approval-required',
  default_reports: 'read-only',
  default_docs: 'read-only',
  default_vision: 'read-only',
};

const STATIC_CAPABILITIES: Record<AgentProvider, ProviderCapabilities> = {
  claude: {
    tool_calls: true,
    structured_output: true,
    streaming: true,
    vision: true,
    code_strength: 'agentic',
    context_window: 200000,
    cost_tier: 'high',
    privacy_tier: 'hosted',
    supports_mcp_strategy: 'container-loop',
  },
  codex: {
    tool_calls: true,
    structured_output: true,
    streaming: true,
    vision: true,
    code_strength: 'agentic',
    context_window: 200000,
    cost_tier: 'medium',
    privacy_tier: 'hosted',
    supports_mcp_strategy: 'container-loop',
  },
  opencode: {
    tool_calls: true,
    structured_output: false,
    streaming: true,
    vision: false,
    code_strength: 'agentic',
    context_window: 128000,
    cost_tier: 'unknown',
    privacy_tier: 'third-party',
    supports_mcp_strategy: 'container-loop',
  },
  pi: {
    tool_calls: true,
    structured_output: false,
    streaming: false,
    vision: false,
    code_strength: 'agentic',
    context_window: 128000,
    cost_tier: 'medium',
    privacy_tier: 'third-party',
    supports_mcp_strategy: 'container-loop',
  },
  ollama: {
    tool_calls: false,
    structured_output: false,
    streaming: true,
    vision: false,
    code_strength: 'basic',
    context_window: 8192,
    cost_tier: 'local',
    privacy_tier: 'local',
    supports_mcp_strategy: 'container-loop',
  },
  openrouter: {
    tool_calls: true,
    structured_output: true,
    streaming: true,
    vision: true,
    code_strength: 'agentic',
    context_window: 128000,
    cost_tier: 'medium',
    privacy_tier: 'third-party',
    supports_mcp_strategy: 'container-loop',
  },
  google: {
    tool_calls: true,
    structured_output: true,
    streaming: true,
    vision: true,
    code_strength: 'basic',
    context_window: 1000000,
    cost_tier: 'medium',
    privacy_tier: 'hosted',
    supports_mcp_strategy: 'container-loop',
  },
  'openai-responses': {
    tool_calls: true,
    structured_output: true,
    streaming: true,
    vision: true,
    code_strength: 'basic',
    context_window: 200000,
    cost_tier: 'medium',
    privacy_tier: 'hosted',
    supports_mcp_strategy: 'container-loop',
  },
  'anthropic-messages': {
    tool_calls: true,
    structured_output: true,
    streaming: true,
    vision: true,
    code_strength: 'basic',
    context_window: 200000,
    cost_tier: 'high',
    privacy_tier: 'hosted',
    supports_mcp_strategy: 'container-loop',
  },
  gemini: {
    tool_calls: true,
    structured_output: true,
    streaming: true,
    vision: true,
    code_strength: 'basic',
    context_window: 1000000,
    cost_tier: 'medium',
    privacy_tier: 'hosted',
    supports_mcp_strategy: 'container-loop',
  },
  mistral: {
    tool_calls: true,
    structured_output: true,
    streaming: true,
    vision: false,
    code_strength: 'basic',
    context_window: 128000,
    cost_tier: 'medium',
    privacy_tier: 'third-party',
    supports_mcp_strategy: 'container-loop',
  },
  airouter: {
    tool_calls: true,
    structured_output: true,
    streaming: true,
    vision: true,
    code_strength: 'basic',
    context_window: 262144,
    cost_tier: 'medium',
    privacy_tier: 'hosted',
    supports_mcp_strategy: 'container-loop',
  },
  'openai-compatible': {
    tool_calls: false,
    structured_output: false,
    streaming: true,
    vision: false,
    code_strength: 'basic',
    context_window: 32768,
    cost_tier: 'unknown',
    privacy_tier: 'third-party',
    supports_mcp_strategy: 'container-loop',
  },
};

function readStoredProfiles(): Partial<
  Record<ProviderPurpose, ProviderProfile>
> {
  try {
    return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8')) as Partial<
      Record<ProviderPurpose, ProviderProfile>
    >;
  } catch {
    return {};
  }
}

function writeStoredProfiles(
  profiles: Partial<Record<ProviderPurpose, ProviderProfile>>,
): void {
  fs.mkdirSync(path.dirname(PROFILE_PATH), { recursive: true });
  fs.writeFileSync(PROFILE_PATH, `${JSON.stringify(profiles, null, 2)}\n`);
}

const MAX_PROBE_HISTORY_PER_MODEL = 20;

function readProbeStore(): ProviderProbeStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(PROBE_PATH, 'utf-8'));
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      parsed.latestByProfile &&
      typeof parsed.latestByProfile === 'object'
    ) {
      return {
        latestByProfile: parsed.latestByProfile as Record<
          string,
          ProviderProbeResult
        >,
        history: Array.isArray(parsed.history)
          ? parsed.history.map(normalizeProviderProbeHistoryEntry)
          : [],
      };
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const latestByProfile = {
        ...(parsed as Record<string, ProviderProbeResult>),
      };
      delete (latestByProfile as Record<string, unknown>).history;
      delete (latestByProfile as Record<string, unknown>).__history;
      return {
        latestByProfile,
        history: Array.isArray((parsed as Record<string, unknown>).__history)
          ? ((parsed as Record<string, unknown>).__history as unknown[]).map(
              normalizeProviderProbeHistoryEntry,
            )
          : [],
      };
    }
    return { latestByProfile: {}, history: [] };
  } catch {
    return { latestByProfile: {}, history: [] };
  }
}

function normalizeProviderProbeHistoryEntry(
  entry: unknown,
): ProviderProbeHistoryEntry {
  const raw = entry as Partial<
    ProviderProbeHistoryEntry & {
      providerId?: string;
      result?: {
        ok?: boolean;
        latencyMs?: number;
        errorMessage?: string;
        capabilities?: ProviderCapabilitiesResult;
        timestamp?: Date | string;
      };
    }
  >;
  const caps = raw.result?.capabilities;
  return {
    profileId: raw.profileId,
    provider: (raw.provider || raw.providerId || 'unknown') as AgentProvider,
    model: String(raw.model || ''),
    ok: Boolean(raw.ok ?? raw.result?.ok),
    latencyMs: raw.latencyMs ?? raw.result?.latencyMs,
    streaming: Boolean(raw.streaming ?? caps?.streaming),
    streamingSupport: Boolean(
      raw.streamingSupport ?? raw.streaming ?? caps?.streaming,
    ),
    toolSupport: Boolean(raw.toolSupport ?? caps?.toolCalls),
    schemaSupport: Boolean(raw.schemaSupport ?? caps?.structuredOutput),
    visionSupport: Boolean(raw.visionSupport ?? caps?.vision),
    contextWindow: Number(raw.contextWindow ?? caps?.contextWindow ?? 0),
    errorDetail: raw.errorDetail || raw.result?.errorMessage,
    timestamp: String(
      raw.timestamp || raw.result?.timestamp || new Date(0).toISOString(),
    ),
  };
}

function writeStoredProbes(probes: Record<string, ProviderProbeResult>): void {
  fs.mkdirSync(path.dirname(PROBE_PATH), { recursive: true });
  const store = readProbeStore();
  fs.writeFileSync(
    PROBE_PATH,
    `${JSON.stringify({ ...store, latestByProfile: probes }, null, 2)}\n`,
  );
}

function readStoredProbes(): Record<string, ProviderProbeResult> {
  return readProbeStore().latestByProfile;
}

function writeProbeStore(store: ProviderProbeStore): void {
  fs.mkdirSync(path.dirname(PROBE_PATH), { recursive: true });
  fs.writeFileSync(PROBE_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

function appendProbeHistory(result: ProviderProbeResult): void {
  const timestamp = result.lastProbeAt || new Date().toISOString();
  const capabilities = result.capabilities;
  const entry: ProviderProbeHistoryEntry = {
    profileId: result.profileId,
    provider: result.provider,
    model: result.model,
    ok: result.ok,
    latencyMs: result.latencyMs,
    streaming: capabilities?.streaming ?? false,
    streamingSupport: capabilities?.streaming ?? false,
    toolSupport: capabilities?.tool_calls ?? false,
    schemaSupport: capabilities?.structured_output ?? false,
    visionSupport: capabilities?.vision ?? false,
    contextWindow: capabilities?.context_window ?? 0,
    errorDetail: result.errorDetail || result.errors?.join('; '),
    timestamp,
  };
  const store = readProbeStore();
  const other = store.history.filter(
    (item) => item.provider !== entry.provider || item.model !== entry.model,
  );
  const same = store.history
    .filter(
      (item) => item.provider === entry.provider && item.model === entry.model,
    )
    .slice(-(MAX_PROBE_HISTORY_PER_MODEL - 1));
  writeProbeStore({
    latestByProfile: store.latestByProfile,
    history: [...other, ...same, entry],
  });
}

function failedCheckErrorDetail(
  checks: ProviderProbeCheck[],
): string | undefined {
  const failed = checks.filter((check) => !check.ok);
  if (failed.length === 0) return undefined;
  return failed
    .map((check) => check.detail || check.label)
    .filter(Boolean)
    .join('; ');
}

function providerApiKey(provider: AgentProvider): string {
  const key = providerApiKeyEnvKey(provider);
  if (!key) return '';
  const env = readEnvFile([key]);
  return process.env[key] || env[key] || '';
}

function providerBaseUrl(profile: ProviderProfile): string {
  return (
    profile.baseUrl ||
    AGENT_PROVIDER_DEFINITIONS[profile.provider].defaultBaseUrl ||
    ''
  ).replace(/\/+$/, '');
}

function providerUrl(profile: ProviderProfile, suffix: string): string {
  return `${providerBaseUrl(profile)}/${suffix.replace(/^\/+/, '')}`;
}

function recommendedPurposes(
  capabilities: ProviderCapabilities,
): ProviderPurpose[] {
  const purposes: ProviderPurpose[] = ['default_chat'];
  if (capabilities.code_strength === 'agentic') purposes.push('default_coding');
  if (capabilities.structured_output) {
    purposes.push(
      'default_memory',
      'default_journal',
      'default_reports',
      'default_docs',
    );
  }
  if (capabilities.vision) purposes.push('default_vision');
  if (capabilities.tool_calls) {
    purposes.push('default_automation', 'default_skill_factory');
  }
  return [...new Set(purposes)];
}

function defaultProfile(purpose: ProviderPurpose): ProviderProfile {
  const config = getAgentProviderConfig();
  const provider = config.provider;
  return {
    id: purpose,
    label: PURPOSE_LABELS[purpose],
    purpose,
    provider,
    model: config.modelsByProvider[provider] || DEFAULT_AGENT_MODELS[provider],
    baseUrl: config.baseUrlsByProvider[provider],
    temperature:
      purpose === 'default_coding' || purpose === 'default_skill_factory'
        ? 0.2
        : 0.4,
    maxOutputTokens:
      purpose === 'default_reports' || purpose === 'default_docs'
        ? 12000
        : 4000,
    toolPolicy: PURPOSE_TOOL_POLICIES[purpose],
    fallbackProfileId: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function validateProfile(input: ProviderProfile): ProviderProfile {
  if (!PROVIDER_PURPOSES.includes(input.id)) {
    throw new Error(
      `profile id must be one of: ${PROVIDER_PURPOSES.join(', ')}`,
    );
  }
  if (input.purpose !== input.id) {
    throw new Error('profile purpose must match profile id');
  }
  if (!isAgentProvider(input.provider)) {
    throw new Error(`provider must be one of: ${AGENT_PROVIDERS.join(', ')}`);
  }
  if (
    input.fallbackProfileId &&
    !PROVIDER_PURPOSES.includes(input.fallbackProfileId)
  ) {
    throw new Error('fallback profile is not a known provider purpose');
  }
  return {
    ...input,
    label: PURPOSE_LABELS[input.id],
    toolPolicy: input.toolPolicy || PURPOSE_TOOL_POLICIES[input.id],
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

export function getProviderCapabilities(
  provider: AgentProvider,
): ProviderCapabilities {
  return STATIC_CAPABILITIES[provider];
}

export function getProviderPurposeMetadata(): Array<{
  id: ProviderPurpose;
  label: string;
  toolPolicy: ProviderToolPolicy;
}> {
  return PROVIDER_PURPOSES.map((id) => ({
    id,
    label: PURPOSE_LABELS[id],
    toolPolicy: PURPOSE_TOOL_POLICIES[id],
  }));
}

export function loadProviderProfiles(): ProviderProfile[] {
  const stored = readStoredProfiles();
  return PROVIDER_PURPOSES.map((purpose) => {
    const profile = {
      ...defaultProfile(purpose),
      ...(stored[purpose] || {}),
      id: purpose,
      purpose,
      label: PURPOSE_LABELS[purpose],
    };
    try {
      return validateProfile(profile);
    } catch {
      return defaultProfile(purpose);
    }
  });
}

export function getProviderProfile(
  id: ProviderPurpose,
): ProviderProfile | undefined {
  return loadProviderProfiles().find((profile) => profile.id === id);
}

export function saveProviderProfile(
  input: Omit<ProviderProfile, 'label' | 'updatedAt'> &
    Partial<Pick<ProviderProfile, 'label' | 'updatedAt'>>,
): ProviderProfile {
  const profile = validateProfile({
    ...input,
    label: PURPOSE_LABELS[input.id],
    updatedAt: new Date().toISOString(),
  } as ProviderProfile);
  const stored = readStoredProfiles();
  stored[profile.id] = profile;
  writeStoredProfiles(stored);
  return profile;
}

export function getProviderCapabilityMatrix(): Record<
  AgentProvider,
  ProviderCapabilities & { available: boolean; defaultModel: string }
> {
  const availability = getProviderAvailability();
  return AGENT_PROVIDERS.reduce(
    (acc, provider) => {
      acc[provider] = {
        ...getProviderCapabilities(provider),
        available: availability[provider],
        defaultModel: DEFAULT_AGENT_MODELS[provider],
      };
      return acc;
    },
    {} as Record<
      AgentProvider,
      ProviderCapabilities & { available: boolean; defaultModel: string }
    >,
  );
}

export function probeProviderProfile(
  profile: ProviderProfile,
): ProviderProbeResult {
  const definition = AGENT_PROVIDER_DEFINITIONS[profile.provider];
  const capabilities = getProviderCapabilities(profile.provider);
  const availability = getProviderAvailability();
  const checks: ProviderProbeCheck[] = [
    {
      id: 'provider-enabled',
      label: `${definition.name} is available`,
      ok: availability[profile.provider],
      detail: availability[profile.provider]
        ? 'Provider preflight is currently passing'
        : 'Provider is missing credentials, CLI auth, or base URL configuration',
    },
    {
      id: 'model-valid',
      label: 'Selected model is valid',
      ok: isValidAgentModel(profile.provider, profile.model),
      detail: profile.model,
    },
    {
      id: 'tool-policy',
      label: 'Tool policy is explicit',
      ok: Boolean(profile.toolPolicy),
      detail: profile.toolPolicy,
    },
    {
      id: 'structured-output',
      label: 'Structured output',
      ok: capabilities.structured_output || profile.id === 'default_chat',
      detail: capabilities.structured_output
        ? 'Suitable for extraction and validation workflows'
        : 'Use for chat/simple work or wrap with stricter validation',
    },
    {
      id: 'tool-calls',
      label: 'Tool-capable workflow',
      ok:
        capabilities.tool_calls ||
        ['default_memory', 'default_journal', 'default_reports'].includes(
          profile.id,
        ),
      detail: capabilities.tool_calls
        ? capabilities.supports_mcp_strategy
        : 'No native tool calls; NanoCrab can only use constrained container-loop actions',
    },
  ];

  if (definition.runtime === 'openai-compatible') {
    checks.push({
      id: 'base-url',
      label: 'Base URL configured',
      ok: Boolean(profile.baseUrl || definition.defaultBaseUrl),
      detail: profile.baseUrl || definition.defaultBaseUrl || 'No base URL',
    });
  }

  return {
    profileId: profile.id,
    provider: profile.provider,
    model: profile.model,
    ok: checks.every((check) => check.ok),
    checks,
    live: false,
    capabilities,
    recommendedPurposes: recommendedPurposes(capabilities),
  };
}

export async function runLiveProviderProbe(
  profile: ProviderProfile,
): Promise<ProviderProbeResult> {
  const startedAt = Date.now();
  const staticProbe = probeProviderProfile(profile);
  const capabilities = { ...getProviderCapabilities(profile.provider) };
  const checks = [...staticProbe.checks];
  const errors: string[] = [];
  const definition = AGENT_PROVIDER_DEFINITIONS[profile.provider];
  const apiKey = providerApiKey(profile.provider);

  try {
    if (
      definition.runtime === 'openai-compatible' ||
      profile.provider === 'ollama' ||
      profile.provider === 'openrouter' ||
      profile.provider === 'google' ||
      profile.provider === 'mistral'
    ) {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const response = await fetch(providerUrl(profile, 'models'), {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      checks.push({
        id: 'live-models',
        label: 'Live models endpoint',
        ok: response.ok,
        detail: response.ok
          ? 'Models endpoint answered'
          : `${response.status} ${response.statusText}`,
      });
      if (!response.ok)
        errors.push(`models endpoint returned ${response.status}`);
    } else if (
      ['openai-responses', 'anthropic-messages', 'gemini'].includes(
        profile.provider,
      )
    ) {
      checks.push({
        id: 'live-api-key',
        label: `${definition.name} API key configured`,
        ok: Boolean(apiKey),
        detail: apiKey
          ? `${providerApiKeyEnvKey(profile.provider)} configured`
          : `${providerApiKeyEnvKey(profile.provider)} missing`,
      });
      if (!apiKey)
        errors.push(`${providerApiKeyEnvKey(profile.provider)} missing`);
    } else {
      checks.push({
        id: 'live-runtime',
        label: 'Runtime preflight',
        ok: staticProbe.ok,
        detail: 'CLI/SDK provider uses local preflight checks',
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    errors.push(detail);
    checks.push({
      id: 'live-probe-error',
      label: 'Live probe failed',
      ok: false,
      detail,
    });
  }

  try {
    const liveCapResult = await runLiveCapabilityProbe(
      profile.provider,
      profile.model,
    );
    if (liveCapResult.capabilities) {
      const merged = { ...capabilities, ...liveCapResult.capabilities };
      Object.assign(capabilities, merged);
    }
    if (liveCapResult.checks) {
      checks.push(...liveCapResult.checks);
    }
  } catch {
    // Live capability probe is non-critical; fall through with static capabilities
  }

  const errorDetail =
    errors.length > 0 ? errors.join('; ') : failedCheckErrorDetail(checks);
  const result: ProviderProbeResult = {
    ...staticProbe,
    ok: checks.every((check) => check.ok),
    checks,
    live: true,
    lastProbeAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    capabilities,
    errors,
    errorDetail,
    recommendedPurposes: recommendedPurposes(capabilities),
  };
  const probes = readStoredProbes();
  probes[profile.id] = result;
  writeStoredProbes(probes);
  appendProbeHistory(result);
  return result;
}

function probeCapabilitiesToRouter(
  caps: ProviderCapabilitiesResult,
): ProviderCapabilities {
  return {
    tool_calls: caps.toolCalls,
    structured_output: caps.structuredOutput,
    streaming: caps.streaming,
    vision: caps.vision,
    code_strength: caps.codeStrength === 'high' ? 'agentic' : 'basic',
    context_window: caps.contextWindow,
    cost_tier: caps.costTier === 'low' ? 'local' : caps.costTier,
    privacy_tier:
      caps.privacyTier === 'high'
        ? 'third-party'
        : caps.privacyTier === 'low'
          ? 'local'
          : 'hosted',
    supports_mcp_strategy: caps.supportsMcpStrategy ? 'container-loop' : 'none',
  };
}

export async function runLiveCapabilityProbe(
  providerId: string,
  model: string,
): Promise<ProviderProbeResult> {
  const probe = await liveProbeService.probeModel(providerId, model);
  const capabilities = probeCapabilitiesToRouter(probe.capabilities);
  const _definition = AGENT_PROVIDER_DEFINITIONS[providerId as AgentProvider];

  const checks: ProviderProbeCheck[] = [
    {
      id: 'live-model-validate',
      label: `Model validation for ${model}`,
      ok: probe.validated,
      detail: probe.validated
        ? 'Model is accessible via the provider API'
        : 'Model not found in live models list',
    },
    {
      id: 'live-capabilities',
      label: 'Capabilities determined',
      ok: probe.status === 'success',
      detail:
        probe.status === 'success'
          ? `tool_calls=${capabilities.tool_calls}, structured_output=${capabilities.structured_output}, vision=${capabilities.vision}`
          : probe.errorMessage || 'Unknown error',
    },
  ];

  if (probe.errorMessage) {
    checks.push({
      id: 'live-probe-error',
      label: 'Probe encountered an issue',
      ok: false,
      detail: probe.errorMessage,
    });
  }

  return {
    provider: (providerId as AgentProvider) || ('unknown' as AgentProvider),
    model,
    ok: probe.status === 'success' && probe.validated,
    checks,
    live: true,
    lastProbeAt: probe.timestamp.toISOString(),
    capabilities,
    errors: probe.errorMessage ? [probe.errorMessage] : undefined,
    recommendedPurposes: recommendedPurposes(capabilities),
  };
}

export function getLiveCapabilityProbeResult(
  providerId: string,
  model: string,
): ProviderProbeResult | null {
  const cached = liveProbeService.getCachedProbe(providerId, model);
  if (!cached) return null;
  const capabilities = probeCapabilitiesToRouter(cached.capabilities);
  const checks: ProviderProbeCheck[] = [
    {
      id: 'live-model-validate',
      label: `Model validation for ${model}`,
      ok: cached.validated,
      detail: cached.validated
        ? 'Model is accessible via the provider API'
        : 'Model not found in live models list',
    },
    {
      id: 'live-capabilities',
      label: 'Capabilities determined',
      ok: cached.status === 'success',
      detail: cached.errorMessage || 'success',
    },
  ];

  return {
    provider: (providerId as AgentProvider) || ('unknown' as AgentProvider),
    model,
    ok: cached.status === 'success' && cached.validated,
    checks,
    live: true,
    lastProbeAt: cached.timestamp.toISOString(),
    capabilities,
    errors: cached.errorMessage ? [cached.errorMessage] : undefined,
    recommendedPurposes: recommendedPurposes(capabilities),
  };
}

export function getStoredProviderProbes(): Record<string, ProviderProbeResult> {
  return readStoredProbes();
}

export function getProviderProbeHistory(
  provider?: AgentProvider | string,
  model?: string,
  limit?: number,
): ProviderProbeHistoryEntry[] {
  let history = readProbeStore().history;
  if (provider) {
    history = history.filter(
      (entry) =>
        entry.provider === provider ||
        (entry as ProviderProbeHistoryEntry & { providerId?: string })
          .providerId === provider,
    );
  }
  if (model) {
    history = history.filter((entry) => entry.model === model);
  }
  const cap = Math.min(Math.max(limit || MAX_PROBE_HISTORY_PER_MODEL, 1), 200);
  return history.slice(-cap);
}

export function probeAllProviderProfiles(): ProviderProbeResult[] {
  const stored = readStoredProbes();
  return loadProviderProfiles().map(
    (profile) => stored[profile.id] || probeProviderProfile(profile),
  );
}

export function providerModels(provider: AgentProvider): string[] {
  return AGENT_PROVIDER_MODELS[provider] || [];
}

export function fallbackActionForProviderPurpose(
  purpose: ProviderPurpose,
): FallbackAction {
  if (purpose === 'default_automation') return 'automation-execution';
  if (purpose === 'default_skill_factory') return 'skill-installation';
  return 'read';
}

export function providerCanFallbackAutomatically(input: {
  source: ProviderProfile;
  target: ProviderProfile;
  action: FallbackAction;
}): boolean {
  if (!input.source.fallbackProfileId) return false;
  if (input.source.fallbackProfileId !== input.target.id) return false;
  return input.action === 'read' && input.source.toolPolicy !== 'deny';
}

const _fpManager = new FallbackPolicyManager();

export function providerCanFallback(input: {
  source: ProviderProfile;
  target: ProviderProfile;
  action: FallbackAction;
  capabilities?: ProviderCapabilities;
}): ReturnType<FallbackPolicyManager['evaluateFallback']> {
  const hasFallbackConfigured =
    !!input.source.fallbackProfileId &&
    input.source.fallbackProfileId === input.target.id;

  return _fpManager.evaluateFallback(
    input.action,
    {
      providerId: input.source.provider,
      model: input.source.model,
      toolPolicy: input.source.toolPolicy,
      privacyTier: getProviderCapabilities(input.source.provider).privacy_tier,
    },
    {
      providerId: input.target.provider,
      model: input.target.model,
      privacyTier: getProviderCapabilities(input.target.provider).privacy_tier,
    },
    {
      toolCalls: input.capabilities?.tool_calls ?? false,
      structuredOutput: input.capabilities?.structured_output ?? false,
      codeStrength: input.capabilities?.code_strength ?? 'none',
    },
    hasFallbackConfigured,
  );
}

function profileUnavailabilityReason(profile: ProviderProfile): string | null {
  if (!getProviderAvailability()[profile.provider]) {
    return `provider ${profile.provider}/${profile.model} is unavailable`;
  }
  if (!isValidAgentModel(profile.provider, profile.model)) {
    return `invalid model ${profile.provider}/${profile.model}`;
  }
  const storedProbe = readStoredProbes()[profile.id];
  if (
    storedProbe?.live &&
    storedProbe.provider === profile.provider &&
    storedProbe.model === profile.model &&
    storedProbe.ok === false
  ) {
    const detail =
      storedProbe.errorDetail ||
      storedProbe.errors?.join('; ') ||
      storedProbe.checks.find((check) => !check.ok)?.detail ||
      'probe failed';
    return `failed stored probe for ${profile.provider}/${profile.model}: ${detail}`;
  }
  return null;
}

function providerFallbackTargetId(input: {
  source: ProviderProfile;
  target: ProviderProfile;
  action: FallbackAction;
}): string {
  return `${input.source.id}:${input.source.provider}/${input.source.model}->${input.target.id}:${input.target.provider}/${input.target.model}:${input.action}`;
}

function hasApprovedProviderFallback(input: {
  source: ProviderProfile;
  target: ProviderProfile;
  action: FallbackAction;
  targetId: string;
}): boolean {
  return listApprovals({
    kind: 'provider-fallback',
    status: 'approved',
    targetType: 'provider-profile',
    targetId: input.targetId,
  }).some((approval) => {
    const payload = approval.payload || {};
    return (
      payload.sourceProfileId === input.source.id &&
      payload.targetProfileId === input.target.id &&
      payload.sourceProvider === input.source.provider &&
      payload.sourceModel === input.source.model &&
      payload.targetProvider === input.target.provider &&
      payload.targetModel === input.target.model &&
      payload.action === input.action
    );
  });
}

export function resolveProviderFallbackForAction(input: {
  purpose: ProviderPurpose;
  action: FallbackAction;
  requester: string;
  correlationId?: string | null;
  sourceProvider?: AgentProvider;
  sourceModel?: string;
}):
  | {
      approved: true;
      profile: ProviderProfile;
      provider: AgentProvider;
      model: string;
    }
  | { approved: false; approvalId?: string; reason: string } {
  const source = getProviderProfile(input.purpose);
  if (!source) {
    return {
      approved: false,
      reason: `provider profile not found: ${input.purpose}`,
    };
  }

  const requestedSource: ProviderProfile = {
    ...source,
    provider: input.sourceProvider || source.provider,
    model:
      input.sourceModel ||
      (input.sourceProvider
        ? DEFAULT_AGENT_MODELS[input.sourceProvider]
        : source.model),
  };

  const sourceUnavailableReason = profileUnavailabilityReason(requestedSource);
  if (!sourceUnavailableReason) {
    return {
      approved: true,
      profile: requestedSource,
      provider: requestedSource.provider,
      model: requestedSource.model,
    };
  }

  if (!requestedSource.fallbackProfileId) {
    return {
      approved: false,
      reason: `${sourceUnavailableReason} and no fallback profile is configured`,
    };
  }

  const target = getProviderProfile(requestedSource.fallbackProfileId);
  if (!target) {
    return {
      approved: false,
      reason: `fallback profile not found: ${requestedSource.fallbackProfileId}`,
    };
  }
  const targetUnavailableReason = profileUnavailabilityReason(target);
  if (targetUnavailableReason) {
    return {
      approved: false,
      reason: `fallback ${targetUnavailableReason}`,
    };
  }

  const decision = providerCanFallback({
    source: requestedSource,
    target,
    action: input.action,
    capabilities: getProviderCapabilities(target.provider),
  });

  if (decision.allowed && !decision.requiresApproval) {
    return {
      approved: true,
      profile: target,
      provider: target.provider,
      model: target.model,
    };
  }

  if (!decision.requiresApproval) {
    return {
      approved: false,
      reason: `${sourceUnavailableReason}; ${decision.reason}`,
    };
  }

  const targetId = providerFallbackTargetId({
    source: requestedSource,
    target,
    action: input.action,
  });
  if (
    hasApprovedProviderFallback({
      source: requestedSource,
      target,
      action: input.action,
      targetId,
    })
  ) {
    return {
      approved: true,
      profile: target,
      provider: target.provider,
      model: target.model,
    };
  }

  const pending = findPendingApprovalForTarget(
    'provider-fallback',
    'provider-profile',
    targetId,
  );
  if (pending) {
    return {
      approved: false,
      approvalId: pending.id,
      reason: `${sourceUnavailableReason}; ${decision.reason}`,
    };
  }

  const approval = createApproval({
    kind: 'provider-fallback',
    title: 'Approve provider fallback',
    summary: `Allow ${requestedSource.label} to fall back from ${requestedSource.provider}/${requestedSource.model} to ${target.provider}/${target.model} for ${input.action}.`,
    risk: input.action === 'read' ? 'medium' : 'high',
    requester: input.requester,
    targetType: 'provider-profile',
    targetId,
    source: 'provider-router',
    correlationId: input.correlationId || null,
    actionPreview: `${requestedSource.provider}/${requestedSource.model} -> ${target.provider}/${target.model}`,
    resourceSummary: `${input.purpose} provider fallback`,
    payload: {
      sourceProfileId: requestedSource.id,
      targetProfileId: target.id,
      sourceProvider: requestedSource.provider,
      sourceModel: requestedSource.model,
      targetProvider: target.provider,
      targetModel: target.model,
      action: input.action,
      reason: `${sourceUnavailableReason}; ${decision.reason}`,
    },
  });

  return {
    approved: false,
    approvalId: approval.id,
    reason: `${sourceUnavailableReason}; ${decision.reason}`,
  };
}
