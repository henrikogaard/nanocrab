import { execFileSync } from 'child_process';

import { readEnvFile, writeEnvValue } from './env.js';

export const AGENT_PROVIDERS = [
  'claude',
  'codex',
  'opencode',
  'pi',
  'ollama',
  'openrouter',
  'google',
  'openai-responses',
  'anthropic-messages',
  'gemini',
  'mistral',
  'airouter',
  'openai-compatible',
] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export type AgentProviderRuntime =
  | 'claude-agent-sdk'
  | 'codex-cli'
  | 'opencode-cli'
  | 'pi-cli'
  | 'vibe-cli'
  | 'openai-compatible'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'gemini'
  | 'mistral';

export interface AgentProviderDefinition {
  id: AgentProvider;
  name: string;
  runtime: AgentProviderRuntime;
  description: string;
  envKey?: string;
  baseUrlEnvKey?: string;
  defaultBaseUrl?: string;
  selectable: boolean;
  requiresCli?: string;
  requiresAuth?: boolean;
}

export const AGENT_PROVIDER_DEFINITIONS: Record<
  AgentProvider,
  AgentProviderDefinition
> = {
  claude: {
    id: 'claude',
    name: 'Claude Agent SDK',
    runtime: 'claude-agent-sdk',
    description: 'Claude Code Agent SDK runtime inside isolated containers.',
    selectable: true,
    requiresAuth: true,
  },
  codex: {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    runtime: 'codex-cli',
    description: 'OpenAI Codex CLI using ChatGPT OAuth inside containers.',
    selectable: true,
    requiresCli: 'codex',
    requiresAuth: true,
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode CLI',
    runtime: 'opencode-cli',
    description:
      'OpenCode CLI coding-agent runtime. Uses OpenCode provider config/auth.',
    selectable: true,
    requiresCli: 'opencode',
    requiresAuth: true,
  },
  pi: {
    id: 'pi',
    name: 'Pi CLI',
    runtime: 'pi-cli',
    description: 'Pi coding assistant with read, bash, edit, write tools.',
    selectable: true,
    requiresCli: 'pi',
    requiresAuth: true,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    runtime: 'openai-compatible',
    description: 'Local Ollama via its OpenAI-compatible API.',
    baseUrlEnvKey: 'OLLAMA_BASE_URL',
    defaultBaseUrl: 'http://host.docker.internal:11434/v1',
    selectable: true,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    runtime: 'openai-compatible',
    description: 'OpenRouter OpenAI-compatible gateway for hosted models.',
    envKey: 'OPENROUTER_API_KEY',
    baseUrlEnvKey: 'OPENROUTER_BASE_URL',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    selectable: true,
    requiresAuth: true,
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    runtime: 'openai-compatible',
    description:
      'Google Gemini API through the official OpenAI-compatible endpoint.',
    envKey: 'GEMINI_API_KEY',
    baseUrlEnvKey: 'GOOGLE_OPENAI_BASE_URL',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    selectable: true,
    requiresAuth: true,
  },
  'openai-responses': {
    id: 'openai-responses',
    name: 'OpenAI Responses API',
    runtime: 'openai-responses',
    description:
      'OpenAI Responses API for chat, structured output, tools, and document work.',
    envKey: 'OPENAI_API_KEY',
    baseUrlEnvKey: 'OPENAI_BASE_URL',
    defaultBaseUrl: 'https://api.openai.com/v1',
    selectable: true,
    requiresAuth: true,
  },
  'anthropic-messages': {
    id: 'anthropic-messages',
    name: 'Anthropic Messages API',
    runtime: 'anthropic-messages',
    description:
      'Anthropic Messages API for hosted Claude models outside the coding SDK runtime.',
    envKey: 'ANTHROPIC_API_KEY',
    baseUrlEnvKey: 'ANTHROPIC_BASE_URL',
    defaultBaseUrl: 'https://api.anthropic.com',
    selectable: true,
    requiresAuth: true,
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini API',
    runtime: 'gemini',
    description:
      'Native Gemini API for long-context, structured, and multimodal work.',
    envKey: 'GEMINI_API_KEY',
    baseUrlEnvKey: 'GEMINI_BASE_URL',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    selectable: true,
    requiresAuth: true,
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral API',
    runtime: 'mistral',
    description:
      'Mistral hosted API for chat, coding assistance, and structured extraction.',
    envKey: 'MISTRAL_API_KEY',
    baseUrlEnvKey: 'MISTRAL_BASE_URL',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    selectable: true,
    requiresAuth: true,
  },
  airouter: {
    id: 'airouter',
    name: 'AI Router Switzerland',
    runtime: 'openai-compatible',
    description:
      'Swiss-hosted OpenAI-compatible gateway for Qwen, DeepSeek, and embedding models.',
    envKey: 'AIROUTER_API_KEY',
    baseUrlEnvKey: 'AIROUTER_BASE_URL',
    defaultBaseUrl: 'https://api.airouter.ch/v1',
    selectable: true,
    requiresAuth: true,
  },
  'openai-compatible': {
    id: 'openai-compatible',
    name: 'Custom OpenAI-Compatible',
    runtime: 'openai-compatible',
    description:
      'User-configured OpenAI-compatible endpoint for self-hosted or gateway models.',
    envKey: 'OPENAI_COMPATIBLE_API_KEY',
    baseUrlEnvKey: 'OPENAI_COMPATIBLE_BASE_URL',
    selectable: true,
    requiresAuth: false,
  },
};

export const AGENT_PROVIDER_MODELS: Record<AgentProvider, string[]> = {
  claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  codex: [
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.2',
    'o4-mini',
    'o3-mini',
    'gpt-4.1',
  ],
  opencode: [
    'opencode/grok-code-fast-1',
    'anthropic/claude-sonnet-4-6',
    'openai/gpt-5.4',
  ],
  pi: ['gemini-2.5-pro', 'claude-sonnet-4-6', 'gpt-5.4'],
  ollama: ['llama3', 'llama3.1', 'mistral', 'codestral', 'gemma4:e2b'],
  openrouter: [
    'openai/gpt-5.4',
    'anthropic/claude-sonnet-4.5',
    'google/gemini-2.5-pro',
    'qwen/qwen3-coder',
    'openrouter/auto',
  ],
  google: ['gemini-3.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  'openai-responses': ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'gpt-4.1'],
  'anthropic-messages': [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
  ],
  gemini: ['gemini-3.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  mistral: [
    'mistral-large-latest',
    'mistral-medium-latest',
    'codestral-latest',
  ],
  airouter: ['Qwen3.6', 'DeepSeek-V4-Flash', 'deepseek-v4'],
  'openai-compatible': ['model-id'],
};

export const DEFAULT_AGENT_MODELS: Record<AgentProvider, string> = {
  claude: 'claude-sonnet-4-6',
  codex: 'gpt-5.4',
  opencode: 'opencode/grok-code-fast-1',
  pi: 'gemini-2.5-pro',
  ollama: 'llama3',
  openrouter: 'openrouter/auto',
  google: 'gemini-3.5-flash',
  'openai-responses': 'gpt-5.4',
  'anthropic-messages': 'claude-sonnet-4-6',
  gemini: 'gemini-3.5-flash',
  mistral: 'mistral-large-latest',
  airouter: 'Qwen3.6',
  'openai-compatible': 'model-id',
};

export const CODING_PROVIDER_IDS = new Set<AgentProvider>([
  'claude',
  'codex',
  'opencode',
  'pi',
  'mistral',
  'openrouter',
  'ollama',
  'openai-compatible',
]);

const CODE_CAPABLE_MODEL_PATTERNS = [/^codestral(?::|$)/i, /code/i, /coder/i];

export function isCodingCapableProvider(
  provider: AgentProvider,
  model?: string,
): boolean {
  if (!CODING_PROVIDER_IDS.has(provider)) return false;
  if (provider !== 'ollama' && provider !== 'openai-compatible') return true;
  const selectedModel = model || DEFAULT_AGENT_MODELS[provider];
  return CODE_CAPABLE_MODEL_PATTERNS.some((pattern) =>
    pattern.test(selectedModel),
  );
}

export function codingProviderUnavailableReason(
  provider: AgentProvider,
  model?: string,
): string | null {
  if (isCodingCapableProvider(provider, model)) return null;
  if (provider === 'ollama') {
    const selectedModel = model || DEFAULT_AGENT_MODELS.ollama;
    return `Ollama model "${selectedModel}" is chat/local-task only. Choose a code-capable local model such as codestral for coding jobs.`;
  }
  if (provider === 'openai-compatible') {
    const selectedModel = model || DEFAULT_AGENT_MODELS['openai-compatible'];
    return `OpenAI-compatible model "${selectedModel}" is chat/local-task only. Choose a code-capable OpenAI-compatible model such as qwen3-coder or codestral for coding jobs.`;
  }
  return `${provider} is not a coding-job runtime`;
}

export function isAgentProvider(value: unknown): value is AgentProvider {
  return (
    typeof value === 'string' &&
    AGENT_PROVIDERS.includes(value as AgentProvider)
  );
}

export function getAgentProviderDefinition(
  provider: AgentProvider,
): AgentProviderDefinition {
  return AGENT_PROVIDER_DEFINITIONS[provider];
}

function providerEnvSlug(provider: AgentProvider): string {
  return provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function legacyProviderModelEnvKey(provider: AgentProvider): string {
  return `DEFAULT_${provider.toUpperCase()}_MODEL`;
}

function legacyProviderBaseUrlEnvKey(provider: AgentProvider): string {
  return `DEFAULT_${provider.toUpperCase()}_BASE_URL`;
}

export function providerModelEnvKey(provider: AgentProvider): string {
  return `DEFAULT_${providerEnvSlug(provider)}_MODEL`;
}

export function providerBaseUrlEnvKey(provider: AgentProvider): string {
  return `DEFAULT_${providerEnvSlug(provider)}_BASE_URL`;
}

export function providerApiKeyEnvKey(
  provider: AgentProvider,
): string | undefined {
  return AGENT_PROVIDER_DEFINITIONS[provider].envKey;
}

export function isValidAgentModel(
  provider: AgentProvider,
  model: unknown,
): model is string {
  if (typeof model !== 'string' || !model.trim()) return false;
  if (
    [
      'ollama',
      'openrouter',
      'google',
      'opencode',
      'pi',
      'openai-compatible',
      'gemini',
      'mistral',
      'airouter',
    ].includes(provider)
  ) {
    return /^[a-zA-Z0-9._:/@+-]+$/.test(model);
  }
  return AGENT_PROVIDER_MODELS[provider].includes(model);
}

export function getAgentProviderConfig(): {
  provider: AgentProvider;
  model: string;
  modelsByProvider: Record<AgentProvider, string>;
  baseUrlsByProvider: Partial<Record<AgentProvider, string>>;
} {
  const keys = [
    'DEFAULT_PROVIDER',
    'DEFAULT_MODEL',
    ...AGENT_PROVIDERS.flatMap((provider) => [
      providerModelEnvKey(provider),
      legacyProviderModelEnvKey(provider),
    ]),
    ...AGENT_PROVIDERS.flatMap((provider) => [
      providerBaseUrlEnvKey(provider),
      legacyProviderBaseUrlEnvKey(provider),
    ]),
    ...AGENT_PROVIDERS.flatMap((provider) => {
      const definition = AGENT_PROVIDER_DEFINITIONS[provider];
      return [definition.baseUrlEnvKey].filter(Boolean) as string[];
    }),
  ];
  const env = readEnvFile(keys);
  const rawProvider = env.DEFAULT_PROVIDER || process.env.DEFAULT_PROVIDER;
  const provider = isAgentProvider(rawProvider) ? rawProvider : 'claude';
  const modelsByProvider = {} as Record<AgentProvider, string>;
  const baseUrlsByProvider: Partial<Record<AgentProvider, string>> = {};

  for (const p of AGENT_PROVIDERS) {
    const providerSpecific =
      env[providerModelEnvKey(p)] ||
      process.env[providerModelEnvKey(p)] ||
      env[legacyProviderModelEnvKey(p)] ||
      process.env[legacyProviderModelEnvKey(p)];
    const legacy =
      p === provider ? env.DEFAULT_MODEL || process.env.DEFAULT_MODEL : '';
    const candidate = providerSpecific || legacy || DEFAULT_AGENT_MODELS[p];
    modelsByProvider[p] = isValidAgentModel(p, candidate)
      ? candidate
      : DEFAULT_AGENT_MODELS[p];

    const definition = AGENT_PROVIDER_DEFINITIONS[p];
    const baseUrl =
      env[providerBaseUrlEnvKey(p)] ||
      process.env[providerBaseUrlEnvKey(p)] ||
      env[legacyProviderBaseUrlEnvKey(p)] ||
      process.env[legacyProviderBaseUrlEnvKey(p)] ||
      (definition.baseUrlEnvKey
        ? env[definition.baseUrlEnvKey] || process.env[definition.baseUrlEnvKey]
        : '') ||
      definition.defaultBaseUrl;
    if (baseUrl) baseUrlsByProvider[p] = baseUrl;
  }

  return {
    provider,
    model: modelsByProvider[provider],
    modelsByProvider,
    baseUrlsByProvider,
  };
}

export function writeAgentProviderConfig(
  provider: AgentProvider,
  model: string,
  baseUrl?: string,
): void {
  writeEnvValue('DEFAULT_PROVIDER', provider);
  writeEnvValue('DEFAULT_MODEL', model);
  writeEnvValue(providerModelEnvKey(provider), model);
  process.env.DEFAULT_PROVIDER = provider;
  process.env.DEFAULT_MODEL = model;
  process.env[providerModelEnvKey(provider)] = model;

  if (baseUrl) {
    writeEnvValue(providerBaseUrlEnvKey(provider), baseUrl);
    process.env[providerBaseUrlEnvKey(provider)] = baseUrl;
  }
}

function commandAvailable(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function getProviderAvailability(): Record<AgentProvider, boolean> {
  const config = getAgentProviderConfig();
  const availability = {} as Record<AgentProvider, boolean>;

  for (const provider of AGENT_PROVIDERS) {
    const definition = AGENT_PROVIDER_DEFINITIONS[provider];
    if (definition.requiresCli) {
      availability[provider] = commandAvailable(definition.requiresCli);
      continue;
    }

    if (provider === 'claude') {
      availability[provider] = true;
      continue;
    }

    if (provider === 'ollama') {
      availability[provider] = Boolean(config.baseUrlsByProvider.ollama);
      continue;
    }

    if (
      definition.runtime === 'openai-compatible' &&
      definition.requiresAuth === false
    ) {
      availability[provider] = Boolean(config.baseUrlsByProvider[provider]);
      continue;
    }

    const envKey = definition.envKey;
    availability[provider] = Boolean(
      envKey && (process.env[envKey] || readEnvFile([envKey])[envKey]),
    );
  }

  return availability;
}
