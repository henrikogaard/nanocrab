import { afterEach, describe, expect, it, vi } from 'vitest';

const envValues: Record<string, string> = {};

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn((keys: string[]) =>
    Object.fromEntries(
      keys.filter((key) => envValues[key]).map((key) => [key, envValues[key]]),
    ),
  ),
  writeEnvValue: vi.fn((key: string, value: string) => {
    envValues[key] = value;
  }),
}));

import {
  getAgentProviderConfig,
  getProviderAvailability,
  providerBaseUrlEnvKey,
  providerModelEnvKey,
} from './agent-provider.js';

describe('custom OpenAI-compatible agent provider config', () => {
  afterEach(() => {
    for (const key of Object.keys(envValues)) delete envValues[key];
    delete process.env.DEFAULT_PROVIDER;
    delete process.env.OPENAI_COMPATIBLE_BASE_URL;
    delete process.env.OPENAI_COMPATIBLE_API_KEY;
    delete process.env.AIROUTER_API_KEY;
    delete process.env.AIROUTER_BASE_URL;
    delete process.env.DEFAULT_OPENAI_COMPATIBLE_MODEL;
    delete process.env.DEFAULT_AIROUTER_MODEL;
    delete process.env.DEFAULT_OPENAI_COMPATIBLE_BASE_URL;
    delete process.env.DEFAULT_AIROUTER_BASE_URL;
  });

  it('uses shell-safe env keys for custom OpenAI-compatible defaults', () => {
    expect(providerModelEnvKey('openai-compatible')).toBe(
      'DEFAULT_OPENAI_COMPATIBLE_MODEL',
    );
    expect(providerBaseUrlEnvKey('openai-compatible')).toBe(
      'DEFAULT_OPENAI_COMPATIBLE_BASE_URL',
    );
  });

  it('treats a configured base URL as available without requiring an API key', () => {
    envValues.DEFAULT_PROVIDER = 'openai-compatible';
    envValues.OPENAI_COMPATIBLE_BASE_URL = 'http://127.0.0.1:8080/v1';
    envValues.DEFAULT_OPENAI_COMPATIBLE_MODEL = 'qwen3-coder';

    const config = getAgentProviderConfig();
    expect(config.provider).toBe('openai-compatible');
    expect(config.model).toBe('qwen3-coder');
    expect(config.baseUrlsByProvider['openai-compatible']).toBe(
      'http://127.0.0.1:8080/v1',
    );
    expect(getProviderAvailability()['openai-compatible']).toBe(true);
  });

  it('configures AI Router Switzerland as a hosted OpenAI-compatible provider', () => {
    expect(providerModelEnvKey('airouter' as any)).toBe(
      'DEFAULT_AIROUTER_MODEL',
    );
    expect(providerBaseUrlEnvKey('airouter' as any)).toBe(
      'DEFAULT_AIROUTER_BASE_URL',
    );

    envValues.DEFAULT_PROVIDER = 'airouter';
    envValues.AIROUTER_API_KEY = 'sk-airouter';
    envValues.DEFAULT_AIROUTER_MODEL = 'DeepSeek-V4-Flash';

    const config = getAgentProviderConfig();
    expect(config.provider).toBe('airouter');
    expect(config.model).toBe('DeepSeek-V4-Flash');
    expect(config.baseUrlsByProvider.airouter as string).toBe(
      'https://api.airouter.ch/v1',
    );
    expect(getProviderAvailability().airouter as boolean).toBe(true);
  });
});
