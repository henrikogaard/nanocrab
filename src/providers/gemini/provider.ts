import { readEnvFile } from '../../env.js';
import { AGENT_PROVIDER_DEFINITIONS } from '../../agent-provider.js';

const PROVIDER_ID = 'gemini';
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
  'gemini-3.5-flash': { contextWindow: 1000000, costTier: 'medium' },
  'gemini-2.5-pro': { contextWindow: 1000000, costTier: 'high' },
  'gemini-2.5-flash': { contextWindow: 1000000, costTier: 'medium' },
};

const DEFAULT_CAPABILITIES: ProviderCapabilitiesResult = {
  toolCalls: true,
  structuredOutput: true,
  streaming: true,
  vision: true,
  codeStrength: 'medium',
  contextWindow: 1000000,
  costTier: 'medium',
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
  if (!envKey)
    return (
      DEFINITION.defaultBaseUrl || 'https://generativelanguage.googleapis.com/v1beta'
    );
  const env = readEnvFile([envKey]);
  return (
    process.env[envKey] ||
    env[envKey] ||
    DEFINITION.defaultBaseUrl ||
    'https://generativelanguage.googleapis.com/v1beta'
  ).replace(/\/+$/, '');
}

export class GeminiProvider implements Provider {
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
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as {
        models?: Array<{ name: string }>;
      };
      return (
        data.models?.some(
          (m) => m.name === `models/${model}` || m.name === model,
        ) ?? false
      );
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
    const model = options?.model || 'gemini-3.5-flash';

    const contents: Array<{ role: string; parts: Array<{ text: string }> }> =
      typeof task.input === 'string'
        ? [{ role: 'user', parts: [{ text: task.input }] }]
        : task.input.map((msg) => ({
            role: msg.role === 'assistant' ? 'model' : msg.role,
            parts: [{ text: msg.content }],
          }));

    const body: Record<string, unknown> = { contents };
    if (task.instructions) {
      body.system_instruction = { parts: [{ text: task.instructions }] };
    }
    if (task.temperature !== undefined || task.maxOutputTokens !== undefined) {
      const generationConfig: Record<string, unknown> = {};
      if (task.temperature !== undefined)
        generationConfig.temperature = task.temperature;
      if (task.maxOutputTokens !== undefined)
        generationConfig.maxOutputTokens = task.maxOutputTokens;
      body.generationConfig = generationConfig;
    }

    const response = await fetch(
      `${baseUrl}/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini API error: ${response.status} — ${text}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const output: Array<{ type: string; content: string }> = [];
    if (data.candidates?.[0]?.content?.parts) {
      for (const part of data.candidates[0].content.parts) {
        if (part.text) {
          output.push({ type: 'text', content: part.text });
        }
      }
    }

    return {
      id: `gemini-${model}-${Date.now()}`,
      model,
      output,
      usage: data.usageMetadata
        ? {
            input_tokens: data.usageMetadata.promptTokenCount ?? 0,
            output_tokens: data.usageMetadata.candidatesTokenCount ?? 0,
            total_tokens: data.usageMetadata.totalTokenCount ?? 0,
          }
        : undefined,
    };
  }
}

export const geminiProvider = new GeminiProvider();
