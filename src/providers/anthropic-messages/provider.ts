import { readEnvFile } from '../../env.js';
import { AGENT_PROVIDER_DEFINITIONS } from '../../agent-provider.js';

const PROVIDER_ID = 'anthropic-messages';
const DEFINITION = AGENT_PROVIDER_DEFINITIONS[PROVIDER_ID];

export interface ProviderTask {
  input: string | Array<{ role: string; content: string }>;
  instructions?: string;
  tools?: Array<Record<string, unknown>>;
  temperature?: number;
  maxOutputTokens?: number;
  stream?: boolean;
}

export interface ProviderOutput {
  id: string;
  model: string;
  output: Array<Record<string, unknown>>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export interface ProviderCapabilitiesResult {
  toolCalls: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  vision: boolean;
  codeStrength: 'low' | 'medium' | 'high';
  contextWindow: number;
  costTier: 'low' | 'medium' | 'high';
  privacyTier: 'low' | 'medium' | 'high';
  supportsMcpStrategy: boolean;
}

export interface Provider {
  readonly id: string;
  readonly name: string;
  getCapabilities(model: string): Promise<ProviderCapabilitiesResult>;
  validateModel(model: string): Promise<boolean>;
  executeTask(
    task: ProviderTask,
    options?: { model?: string },
  ): Promise<ProviderOutput>;
}

const MODEL_SPECS: Record<string, Partial<ProviderCapabilitiesResult>> = {
  'claude-opus-4-6': { contextWindow: 200000, costTier: 'high' },
  'claude-sonnet-4-6': { contextWindow: 200000, costTier: 'high' },
  'claude-haiku-4-5-20251001': { contextWindow: 200000, costTier: 'medium' },
};

const DEFAULT_CAPABILITIES: ProviderCapabilitiesResult = {
  toolCalls: true,
  structuredOutput: true,
  streaming: true,
  vision: true,
  codeStrength: 'high',
  contextWindow: 200000,
  costTier: 'high',
  privacyTier: 'medium',
  supportsMcpStrategy: true,
};

function getApiKey(): string {
  const key = DEFINITION.envKey;
  if (!key) return '';
  const env = readEnvFile([key]);
  return process.env[key] || env[key] || '';
}

function getBaseUrl(): string {
  const envKey = DEFINITION.baseUrlEnvKey;
  if (!envKey) return DEFINITION.defaultBaseUrl || 'https://api.anthropic.com';
  const env = readEnvFile([envKey]);
  return (
    process.env[envKey] ||
    env[envKey] ||
    DEFINITION.defaultBaseUrl ||
    'https://api.anthropic.com'
  ).replace(/\/+$/, '');
}

export class AnthropicMessagesProvider implements Provider {
  readonly id = PROVIDER_ID;
  readonly name = DEFINITION.name;

  async getCapabilities(
    model: string,
  ): Promise<ProviderCapabilitiesResult> {
    const modelSpec = MODEL_SPECS[model];
    if (!modelSpec) return { ...DEFAULT_CAPABILITIES };
    return { ...DEFAULT_CAPABILITIES, ...modelSpec };
  }

  async validateModel(model: string): Promise<boolean> {
    const apiKey = getApiKey();
    if (!apiKey) return false;

    const baseUrl = getBaseUrl();
    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as {
        data?: Array<{ id: string }>;
      };
      return data.data?.some((m) => m.id === model) ?? false;
    } catch {
      return false;
    }
  }

  async executeTask(
    task: ProviderTask,
    options?: { model?: string },
  ): Promise<ProviderOutput> {
    const apiKey = getApiKey();
    if (!apiKey)
      throw new Error(`${DEFINITION.envKey} is not configured`);

    const baseUrl = getBaseUrl();
    const model = options?.model || 'claude-sonnet-4-6';

    const messages: Array<{ role: string; content: string }> =
      typeof task.input === 'string'
        ? [{ role: 'user', content: task.input }]
        : task.input;

    const body: Record<string, unknown> = {
      model,
      max_tokens: task.maxOutputTokens ?? 4096,
      messages,
    };
    if (task.instructions) body.system = task.instructions;
    if (task.tools) body.tools = task.tools;
    if (task.temperature !== undefined) body.temperature = task.temperature;
    if (task.stream !== undefined) body.stream = task.stream;

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Anthropic Messages API error: ${response.status} — ${text}`,
      );
    }

    return response.json() as Promise<ProviderOutput>;
  }
}

export const anthropicMessagesProvider = new AnthropicMessagesProvider();
