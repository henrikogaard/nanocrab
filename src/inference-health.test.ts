import fs from 'fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanocrab-inference-health-test';

vi.mock('./config.js', () => ({
  STORE_DIR: '/tmp/nanocrab-inference-health-test/store',
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

import { buildInferenceHealth } from './inference-health.js';
import { getProviderProfile, saveProviderProfile } from './provider-router.js';

describe('inference health', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('summarizes local and remote provider profiles', () => {
    saveProviderProfile({
      ...getProviderProfile('default_chat')!,
      provider: 'ollama',
      model: 'llama3.2',
      baseUrl: 'http://localhost:11434/v1',
    });
    saveProviderProfile({
      ...getProviderProfile('default_reports')!,
      provider: 'openrouter',
      model: 'openrouter/auto',
      baseUrl: 'https://openrouter.ai/api/v1',
    });

    const health = buildInferenceHealth();

    expect(health.summary.total).toBeGreaterThan(0);
    expect(health.summary.local).toBeGreaterThan(0);
    expect(health.summary.remote).toBeGreaterThan(0);
    expect(
      health.items.find((item) => item.profileId === 'default_chat'),
    ).toMatchObject({ locality: 'local', provider: 'ollama' });
  });
});
