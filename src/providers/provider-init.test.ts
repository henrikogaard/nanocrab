import { describe, expect, it, vi } from 'vitest';

vi.mock('../env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

vi.mock('../container-runtime.js', () => ({}));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import { getAllProviders } from './index.js';
import { getProviderCapabilityMatrix } from '../provider-router.js';

describe('provider initialization', () => {
  it('registers all provider adapters', () => {
    const providers = getAllProviders();
    const ids = providers.map(p => p.id);
    expect(ids).toContain('openai-responses');
    expect(ids).toContain('anthropic-messages');
    expect(ids).toContain('gemini');
    expect(ids).toContain('mistral');
    expect(ids).toContain('openai-compatible');
  });

  it('capability matrix contains all agent providers', () => {
    const matrix = getProviderCapabilityMatrix();
    expect(matrix['openai-responses']).toBeDefined();
    expect(matrix['anthropic-messages']).toBeDefined();
    expect(matrix['gemini']).toBeDefined();
    expect(matrix['mistral']).toBeDefined();
    expect(matrix['openai-compatible']).toBeDefined();
  });

  it('live probe service can be initialized', async () => {
    const { liveProbeService } = await import('./live-probe.js');
    expect(liveProbeService).toBeDefined();
  });
});
