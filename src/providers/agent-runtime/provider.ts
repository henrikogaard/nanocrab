import {
  AGENT_PROVIDER_DEFINITIONS,
  isValidAgentModel,
  type AgentProvider,
} from '../../agent-provider.js';
import { readEnvFile } from '../../env.js';
import type {
  Provider,
  ProviderCapabilitiesResult,
  ProviderOutput,
  ProviderTask,
} from '../openai-responses/provider.js';

const CAPABILITIES: Record<AgentProvider, ProviderCapabilitiesResult> = {
  claude: {
    toolCalls: true,
    structuredOutput: true,
    streaming: true,
    vision: true,
    codeStrength: 'high',
    contextWindow: 200000,
    costTier: 'high',
    privacyTier: 'medium',
    supportsMcpStrategy: true,
  },
  codex: {
    toolCalls: true,
    structuredOutput: true,
    streaming: true,
    vision: true,
    codeStrength: 'high',
    contextWindow: 200000,
    costTier: 'medium',
    privacyTier: 'medium',
    supportsMcpStrategy: true,
  },
  opencode: {
    toolCalls: true,
    structuredOutput: false,
    streaming: true,
    vision: false,
    codeStrength: 'high',
    contextWindow: 128000,
    costTier: 'medium',
    privacyTier: 'high',
    supportsMcpStrategy: true,
  },
  ollama: {
    toolCalls: false,
    structuredOutput: false,
    streaming: true,
    vision: false,
    codeStrength: 'low',
    contextWindow: 8192,
    costTier: 'low',
    privacyTier: 'low',
    supportsMcpStrategy: true,
  },
  openrouter: {
    toolCalls: true,
    structuredOutput: true,
    streaming: true,
    vision: true,
    codeStrength: 'medium',
    contextWindow: 128000,
    costTier: 'medium',
    privacyTier: 'high',
    supportsMcpStrategy: true,
  },
  google: {
    toolCalls: true,
    structuredOutput: true,
    streaming: true,
    vision: true,
    codeStrength: 'medium',
    contextWindow: 1000000,
    costTier: 'medium',
    privacyTier: 'medium',
    supportsMcpStrategy: true,
  },
  'openai-responses': {
    toolCalls: true,
    structuredOutput: true,
    streaming: true,
    vision: true,
    codeStrength: 'medium',
    contextWindow: 200000,
    costTier: 'medium',
    privacyTier: 'medium',
    supportsMcpStrategy: true,
  },
  'anthropic-messages': {
    toolCalls: true,
    structuredOutput: true,
    streaming: true,
    vision: true,
    codeStrength: 'medium',
    contextWindow: 200000,
    costTier: 'high',
    privacyTier: 'medium',
    supportsMcpStrategy: true,
  },
  gemini: {
    toolCalls: true,
    structuredOutput: true,
    streaming: true,
    vision: true,
    codeStrength: 'medium',
    contextWindow: 1000000,
    costTier: 'medium',
    privacyTier: 'medium',
    supportsMcpStrategy: true,
  },
  mistral: {
    toolCalls: true,
    structuredOutput: true,
    streaming: true,
    vision: false,
    codeStrength: 'medium',
    contextWindow: 128000,
    costTier: 'medium',
    privacyTier: 'high',
    supportsMcpStrategy: true,
  },
  'openai-compatible': {
    toolCalls: false,
    structuredOutput: false,
    streaming: true,
    vision: false,
    codeStrength: 'low',
    contextWindow: 32768,
    costTier: 'low',
    privacyTier: 'high',
    supportsMcpStrategy: true,
  },
};

function envValue(key?: string): string {
  if (!key) return '';
  const env = readEnvFile([key]);
  return process.env[key] || env[key] || '';
}

function providerBaseUrl(provider: AgentProvider): string {
  const definition = AGENT_PROVIDER_DEFINITIONS[provider];
  const specificKey = `DEFAULT_${provider.toUpperCase()}_BASE_URL`;
  return (
    envValue(specificKey) ||
    envValue(definition.baseUrlEnvKey) ||
    definition.defaultBaseUrl ||
    ''
  ).replace(/\/+$/, '');
}

async function validateOpenAICompatibleProvider(
  provider: AgentProvider,
  model: string,
): Promise<boolean> {
  const baseUrl = providerBaseUrl(provider);
  if (!baseUrl) return false;

  try {
    const definition = AGENT_PROVIDER_DEFINITIONS[provider];
    const apiKey = envValue(definition.envKey);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(`${baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as {
      data?: Array<{ id?: string; name?: string }>;
      models?: Array<{ id?: string; name?: string }>;
    };
    const models = data.data || data.models || [];
    if (models.length === 0) return true;
    return models.some((entry) => entry.id === model || entry.name === model);
  } catch {
    return false;
  }
}

export class AgentRuntimeProvider implements Provider {
  readonly id: AgentProvider;
  readonly name: string;

  constructor(provider: AgentProvider) {
    this.id = provider;
    this.name = AGENT_PROVIDER_DEFINITIONS[provider].name;
  }

  async getCapabilities(
    _model: string,
  ): Promise<ProviderCapabilitiesResult> {
    return { ...CAPABILITIES[this.id] };
  }

  async validateModel(model: string): Promise<boolean> {
    if (!isValidAgentModel(this.id, model)) return false;
    const runtime = AGENT_PROVIDER_DEFINITIONS[this.id].runtime;
    if (runtime === 'openai-compatible') {
      return validateOpenAICompatibleProvider(this.id, model);
    }
    return true;
  }

  async executeTask(
    _task: ProviderTask,
    _options?: { model?: string },
  ): Promise<ProviderOutput> {
    throw new Error(
      `${this.name} runs through NanoCrab's isolated agent container runtime, not the host provider adapter.`,
    );
  }
}

export const claudeRuntimeProvider = new AgentRuntimeProvider('claude');
export const codexRuntimeProvider = new AgentRuntimeProvider('codex');
export const opencodeRuntimeProvider = new AgentRuntimeProvider('opencode');
export const ollamaRuntimeProvider = new AgentRuntimeProvider('ollama');
export const openrouterRuntimeProvider = new AgentRuntimeProvider('openrouter');
export const googleRuntimeProvider = new AgentRuntimeProvider('google');
