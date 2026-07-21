import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_AGENT_MODELS,
  getAgentProviderConfig,
  isCodingCapableProvider,
  isAgentProvider,
} from './agent-provider.js';
import type { AgentProvider } from './agent-provider.js';
import { DEVIN_CLI_MODEL_ALIASES, STORE_DIR } from './config.js';
import { getProviderProfile } from './provider-router.js';
import {
  inferLegacyRunnerCli,
  validateCodingRuntimeSelection,
} from './agent-runtime-registry.js';
import type { AgentRuntimeSelection } from './types.js';

const PROFILE_PATH = path.join(STORE_DIR, 'coding-runtime-profiles.json');
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;

export const DEFAULT_CODING_RUNTIME_PROFILE_ID = 'default';
const BUILTIN_PROFILE_IDS = new Set([
  DEFAULT_CODING_RUNTIME_PROFILE_ID,
  'claude-default',
  'codex-default',
  'opencode-default',
  'pi-default',
  'mistral-default',
  'devin-default',
]);

export interface CodingRuntimeProfile {
  id: string;
  label: string;
  description: string | null;
  runtime: AgentRuntimeSelection;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CodingRuntimeProfileInput {
  id: string;
  label: string;
  description?: string | null;
  runtime: AgentRuntimeSelection;
  enabled?: boolean;
}

function readStoredProfiles(): CodingRuntimeProfile[] {
  try {
    const value = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
    if (!Array.isArray(value)) return [];
    return value.filter(isStoredProfile).map((profile) => ({
      ...profile,
      runtime: { ...profile.runtime },
    }));
  } catch {
    return [];
  }
}

function writeStoredProfiles(profiles: CodingRuntimeProfile[]): void {
  fs.mkdirSync(path.dirname(PROFILE_PATH), { recursive: true });
  fs.writeFileSync(PROFILE_PATH, `${JSON.stringify(profiles, null, 2)}\n`);
}

function isStoredProfile(value: unknown): value is CodingRuntimeProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const profile = value as Partial<CodingRuntimeProfile>;
  return (
    typeof profile.id === 'string' &&
    typeof profile.label === 'string' &&
    profile.runtime !== null &&
    typeof profile.runtime === 'object' &&
    typeof profile.createdAt === 'string' &&
    typeof profile.updatedAt === 'string'
  );
}

function codingDefaultRuntime(): AgentRuntimeSelection {
  const configured = getProviderProfile('default_coding');
  const providerConfig = getAgentProviderConfig();
  const candidates: AgentRuntimeSelection[] = [];
  if (configured && isAgentProvider(configured.provider)) {
    candidates.push({
      cli: inferLegacyRunnerCli(configured.provider),
      provider: configured.provider,
      model: configured.model,
    });
  }
  const configuredProvider = providerConfig.provider;
  if (isAgentProvider(configuredProvider)) {
    candidates.push({
      cli: inferLegacyRunnerCli(configuredProvider),
      provider: configuredProvider,
      model:
        providerConfig.modelsByProvider[configuredProvider] ||
        DEFAULT_AGENT_MODELS[configuredProvider],
    });
  }
  candidates.push(
    { cli: 'claude', provider: 'claude', model: DEFAULT_AGENT_MODELS.claude },
    { cli: 'codex', provider: 'codex', model: DEFAULT_AGENT_MODELS.codex },
  );
  const valid = candidates.find(
    (runtime) =>
      isCodingCapableProvider(runtime.provider, runtime.model) &&
      (() => {
        try {
          validateCodingRuntimeSelection(runtime);
          return true;
        } catch {
          return false;
        }
      })(),
  );
  return (
    valid || { cli: 'claude', provider: 'claude', model: 'claude-sonnet-4-6' }
  );
}

function defaultProfile(): CodingRuntimeProfile {
  const timestamp = new Date(0).toISOString();
  return {
    id: DEFAULT_CODING_RUNTIME_PROFILE_ID,
    label: 'Default coding runtime',
    description:
      'Uses the configured default_coding provider and model with a validated coding CLI.',
    runtime: codingDefaultRuntime(),
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function builtinProfile(
  id: string,
  label: string,
  runtime: AgentRuntimeSelection,
): CodingRuntimeProfile | null {
  try {
    validateCodingRuntimeSelection(runtime);
  } catch {
    return null;
  }
  return {
    id,
    label,
    description:
      'Built-in coding runtime profile; edit provider defaults to customize it.',
    runtime,
    enabled: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function builtinProfiles(): CodingRuntimeProfile[] {
  const providerConfig = getAgentProviderConfig();
  const profiles: Array<CodingRuntimeProfile | null> = [
    builtinProfile('claude-default', 'Claude Code', {
      cli: 'claude',
      provider: 'claude',
      model: DEFAULT_AGENT_MODELS.claude,
    }),
    builtinProfile('codex-default', 'OpenAI Codex CLI', {
      cli: 'codex',
      provider: 'codex',
      model: DEFAULT_AGENT_MODELS.codex,
    }),
    builtinProfile('pi-default', 'Pi CLI', {
      cli: 'pi',
      provider: 'pi',
      model: DEFAULT_AGENT_MODELS.pi,
    }),
    builtinProfile('mistral-default', 'Mistral Vibe', {
      cli: 'mistral',
      provider: 'mistral',
      model: DEFAULT_AGENT_MODELS.mistral,
    }),
  ];
  const openCodeProvider = [
    providerConfig.provider,
    'openrouter',
    'opencode',
  ].find((provider): provider is AgentProvider => {
    if (!isAgentProvider(provider)) return false;
    const model =
      providerConfig.modelsByProvider[provider] ||
      DEFAULT_AGENT_MODELS[provider];
    if (!isCodingCapableProvider(provider, model)) return false;
    try {
      validateCodingRuntimeSelection({
        cli: 'opencode',
        provider,
        model,
      });
      return true;
    } catch {
      return false;
    }
  });
  if (openCodeProvider) {
    profiles.push(
      builtinProfile('opencode-default', 'OpenCode CLI', {
        cli: 'opencode',
        provider: openCodeProvider,
        model:
          providerConfig.modelsByProvider[openCodeProvider] ||
          DEFAULT_AGENT_MODELS[openCodeProvider],
      }),
    );
  }
  const devinKey = Object.keys(DEVIN_CLI_MODEL_ALIASES)[0];
  if (devinKey) {
    const separator = devinKey.indexOf('/');
    const provider = devinKey.slice(0, separator);
    const model = devinKey.slice(separator + 1);
    if (isAgentProvider(provider) && model) {
      profiles.push(
        builtinProfile('devin-default', 'Devin CLI', {
          cli: 'devin',
          provider,
          model,
        }),
      );
    }
  }
  return profiles.filter((profile): profile is CodingRuntimeProfile =>
    Boolean(profile),
  );
}

export function isBuiltInCodingRuntimeProfile(id: string): boolean {
  return BUILTIN_PROFILE_IDS.has(id.trim().toLowerCase());
}

export function validateCodingRuntimeProfile(
  input: CodingRuntimeProfileInput,
): void {
  const id = input.id.trim().toLowerCase();
  if (!PROFILE_ID_RE.test(id)) {
    throw new Error(
      'coding runtime profile id must be 1-64 chars using lowercase letters, numbers, underscores, or dashes',
    );
  }
  if (!input.label?.trim())
    throw new Error('coding runtime profile label is required');
  if (!input.runtime || typeof input.runtime !== 'object') {
    throw new Error('coding runtime profile runtime is required');
  }
  try {
    validateCodingRuntimeSelection(input.runtime);
  } catch (err) {
    throw new Error(
      `invalid coding runtime profile ${id}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

export function buildCodingRuntimeProfile(
  input: CodingRuntimeProfileInput,
  now: () => string = () => new Date().toISOString(),
): CodingRuntimeProfile {
  validateCodingRuntimeProfile(input);
  const id = input.id.trim().toLowerCase();
  const timestamp = now();
  return {
    id,
    label: input.label.trim(),
    description: input.description?.trim() || null,
    runtime: { ...input.runtime },
    enabled: input.enabled !== false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function listCodingRuntimeProfiles(): CodingRuntimeProfile[] {
  const stored = readStoredProfiles();
  const profiles = [
    defaultProfile(),
    ...builtinProfiles(),
    ...stored.filter((p) => p.id !== 'default'),
  ];
  return profiles.filter(
    (profile, index, all) =>
      all.findIndex((candidate) => candidate.id === profile.id) === index,
  );
}

export function getCodingRuntimeProfile(
  id: string,
): CodingRuntimeProfile | undefined {
  const normalizedId = id.trim().toLowerCase();
  return listCodingRuntimeProfiles().find(
    (profile) => profile.id === normalizedId,
  );
}

export function resolveCodingRuntimeProfile(id: string): AgentRuntimeSelection {
  const normalizedId = id.trim().toLowerCase();
  const profile = getCodingRuntimeProfile(normalizedId);
  if (!profile)
    throw new Error(`coding runtime profile not found: ${normalizedId}`);
  if (!profile.enabled)
    throw new Error(`coding runtime profile is disabled: ${normalizedId}`);
  return { ...profile.runtime };
}

export function saveCodingRuntimeProfile(
  profile: CodingRuntimeProfile,
): CodingRuntimeProfile {
  validateCodingRuntimeProfile(profile);
  if (isBuiltInCodingRuntimeProfile(profile.id)) {
    throw new Error(
      'built-in coding runtime profiles are managed by runtime settings',
    );
  }
  const stored = readStoredProfiles().filter((item) => item.id !== profile.id);
  const normalized = {
    ...profile,
    id: profile.id.trim().toLowerCase(),
    label: profile.label.trim(),
    description: profile.description?.trim() || null,
    runtime: { ...profile.runtime },
    updatedAt: new Date().toISOString(),
  };
  writeStoredProfiles([...stored, normalized]);
  return normalized;
}

export function deleteCodingRuntimeProfile(id: string): void {
  const normalizedId = id.trim().toLowerCase();
  if (isBuiltInCodingRuntimeProfile(normalizedId)) {
    throw new Error('built-in coding runtime profiles cannot be deleted');
  }
  writeStoredProfiles(
    readStoredProfiles().filter((profile) => profile.id !== normalizedId),
  );
}
