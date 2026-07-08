import { readEnvFile } from '../../env.js';
import {
  AGENT_PROVIDER_DEFINITIONS,
  providerBaseUrlEnvKey,
} from '../../agent-provider.js';

const PROVIDER_ID = 'openai-compatible';
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

const DEFAULT_CAPABILITIES: ProviderCapabilitiesResult = {
  toolCalls: false,
  structuredOutput: false,
  streaming: true,
  vision: false,
  codeStrength: 'low',
  contextWindow: 32768,
  costTier: 'low',
  privacyTier: 'low',
  supportsMcpStrategy: false,
};

function getApiKey(): string {
  const key = DEFINITION.envKey;
  if (!key) return '';
  const env = readEnvFile([key]);
  return process.env[key] || env[key] || '';
}

function getBaseUrl(): string {
  const envKey = DEFINITION.baseUrlEnvKey;
  const defaultKey = providerBaseUrlEnvKey(PROVIDER_ID);
  const env = readEnvFile([defaultKey, envKey].filter(Boolean) as string[]);
  const url =
    process.env[defaultKey] ||
    env[defaultKey] ||
    (envKey ? process.env[envKey] || env[envKey] : '') ||
    '';
  return url ? url.replace(/\/+$/, '') : '';
}

export class OpenAICompatibleProvider implements Provider {
  readonly id = PROVIDER_ID;
  readonly name = DEFINITION.name;

  async getCapabilities(_model: string): Promise<ProviderCapabilitiesResult> {
    return { ...DEFAULT_CAPABILITIES };
  }

  async validateModel(model: string): Promise<boolean> {
    const baseUrl = getBaseUrl();
    if (!baseUrl) return false;

    const apiKey = getApiKey();
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const response = await fetch(`${baseUrl}/models`, {
        headers,
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
    const baseUrl = getBaseUrl();
    if (!baseUrl)
      throw new Error(`${DEFINITION.baseUrlEnvKey} is not configured`);

    const apiKey = getApiKey();
    const model = options?.model || 'default';

    const messages: Array<{ role: string; content: string }> =
      typeof task.input === 'string'
        ? [{ role: 'user', content: task.input }]
        : task.input;

    if (task.instructions) {
      messages.unshift({ role: 'system', content: task.instructions });
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: task.maxOutputTokens ?? 4096,
    };
    if (task.temperature !== undefined) body.temperature = task.temperature;
    if (task.stream !== undefined) body.stream = task.stream;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `OpenAI-Compatible API error: ${response.status} — ${text}`,
      );
    }

    const data = (await response.json()) as {
      id: string;
      model: string;
      choices: Array<{
        message: { content: string; role: string };
      }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    const output: Array<{ type: string; content: string }> = [];
    if (data.choices?.[0]?.message?.content) {
      output.push({
        type: 'message',
        content: data.choices[0].message.content,
      });
    }

    return {
      id: data.id,
      model: data.model,
      output,
      usage: data.usage
        ? {
            input_tokens: data.usage.prompt_tokens,
            output_tokens: data.usage.completion_tokens,
            total_tokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }
}

export const openaiCompatibleProvider = new OpenAICompatibleProvider();
