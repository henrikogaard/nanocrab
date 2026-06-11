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
import { hasApprovedTarget } from './approvals.js';
import { STORE_DIR } from './config.js';
import { readEnvFile } from './env.js';
import { evaluateActionPolicy } from './action-policy.js';

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
  capabilities?: ProviderCapabilities;
  errors?: string[];
  recommendedPurposes?: ProviderPurpose[];
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
    code_strength: 'basic',
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

function readStoredProbes(): Record<string, ProviderProbeResult> {
  try {
    return JSON.parse(fs.readFileSync(PROBE_PATH, 'utf-8')) as Record<
      string,
      ProviderProbeResult
    >;
  } catch {
    return {};
  }
}

function writeStoredProbes(probes: Record<string, ProviderProbeResult>): void {
  fs.mkdirSync(path.dirname(PROBE_PATH), { recursive: true });
  fs.writeFileSync(PROBE_PATH, `${JSON.stringify(probes, null, 2)}\n`);
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
  if (!isValidAgentModel(input.provider, input.model)) {
    throw new Error(`model is not valid for ${input.provider}`);
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

  const result: ProviderProbeResult = {
    ...staticProbe,
    ok: checks.every((check) => check.ok),
    checks,
    live: true,
    lastProbeAt: new Date().toISOString(),
    capabilities,
    errors,
    recommendedPurposes: recommendedPurposes(capabilities),
  };
  const probes = readStoredProbes();
  probes[profile.id] = result;
  writeStoredProbes(probes);
  return result;
}

export function getStoredProviderProbes(): Record<string, ProviderProbeResult> {
  return readStoredProbes();
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

export function providerCanFallbackAutomatically(input: {
  source: ProviderProfile;
  target: ProviderProfile;
  action:
    | 'read'
    | 'write'
    | 'publish'
    | 'external-message'
    | 'upload'
    | 'shell'
    | 'pr';
}): boolean {
  if (!input.source.fallbackProfileId) return false;
  if (input.source.fallbackProfileId !== input.target.id) return false;
  const approved = hasApprovedTarget(
    'provider-fallback',
    'provider-profile',
    input.source.id,
    {
      sourceProfileId: input.source.id,
      targetProfileId: input.target.id,
    },
  );
  const decision = evaluateActionPolicy({
    action: input.action === 'read' ? 'read' : 'provider-fallback',
    toolPolicy: input.source.toolPolicy,
    approved,
    targetType: 'provider-profile',
    targetId: input.source.id,
    payload: {
      sourceProfileId: input.source.id,
      targetProfileId: input.target.id,
      action: input.action,
    },
  });
  return decision.decision === 'allow';
}
