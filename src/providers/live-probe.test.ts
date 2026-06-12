import fs from 'fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  STORE_DIR: '/tmp/nanocrab-probe-history-test/store',
}));

vi.mock('./index.js', () => ({
  getProviderById: vi.fn(),
}));

import { getProviderById } from './index.js';
import { LiveProbeService } from './live-probe.js';

const SAMPLE_CAPABILITIES = {
  toolCalls: true,
  structuredOutput: true,
  streaming: true,
  vision: true,
  codeStrength: 'high' as const,
  contextWindow: 200000,
  costTier: 'medium' as const,
  privacyTier: 'medium' as const,
  supportsMcpStrategy: true,
};

describe('LiveProbeService', () => {
  let service: LiveProbeService;

  beforeEach(() => {
    vi.mocked(getProviderById).mockReset();
    service = new LiveProbeService({ cacheTtlMs: 60000 });
  });

  const TEST_STORE = '/tmp/nanocrab-probe-history-test';

  afterEach(() => {
    service.clearCache();
    fs.rmSync(TEST_STORE, { recursive: true, force: true });
  });

  describe('probeModel', () => {
    it('returns successful result when provider validates model', async () => {
      const validProvider = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi.fn().mockResolvedValue(true),
        getCapabilities: vi.fn().mockResolvedValue(SAMPLE_CAPABILITIES),
      };
      vi.mocked(getProviderById).mockReturnValue(validProvider as never);

      const result = await service.probeModel('openai-responses', 'gpt-5.4');

      expect(result.model).toBe('gpt-5.4');
      expect(result.validated).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.status).toBe('success');
      expect(result.capabilities.toolCalls).toBe(true);
      expect(result.capabilities.contextWindow).toBe(200000);
      expect(validProvider.validateModel).toHaveBeenCalledWith('gpt-5.4');
      expect(validProvider.getCapabilities).toHaveBeenCalledWith('gpt-5.4');
    });

    it('returns failed result when provider not found in registry', async () => {
      vi.mocked(getProviderById).mockReturnValue(undefined);

      const result = await service.probeModel('unknown-provider', 'gpt-5.4');

      expect(result.model).toBe('gpt-5.4');
      expect(result.validated).toBe(false);
      expect(result.ok).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('not found');
    });

    it('returns non-ok result when validateModel returns false', async () => {
      const invalidProvider = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi.fn().mockResolvedValue(false),
        getCapabilities: vi.fn().mockResolvedValue(SAMPLE_CAPABILITIES),
      };
      vi.mocked(getProviderById).mockReturnValue(invalidProvider as never);

      const result = await service.probeModel('openai-responses', 'gpt-5.4');

      expect(result.validated).toBe(false);
      expect(result.ok).toBe(false);
      expect(result.status).toBe('success');
    });

    it('returns failed result on exception from provider', async () => {
      const throwingProvider = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi
          .fn()
          .mockRejectedValue(new Error('API timeout')),
        getCapabilities: vi.fn(),
      };
      vi.mocked(getProviderById).mockReturnValue(throwingProvider as never);

      const result = await service.probeModel('openai-responses', 'gpt-5.4');

      expect(result.validated).toBe(false);
      expect(result.ok).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('API timeout');
    });

    it('caches probe results and avoids re-probing', async () => {
      const cachedProvider = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi.fn().mockResolvedValue(true),
        getCapabilities: vi.fn().mockResolvedValue(SAMPLE_CAPABILITIES),
      };
      vi.mocked(getProviderById).mockReturnValue(cachedProvider as never);

      const result1 = await service.probeModel(
        'openai-responses',
        'gpt-5.4',
      );
      const result2 = await service.probeModel(
        'openai-responses',
        'gpt-5.4',
      );

      expect(result1.timestamp).toEqual(result2.timestamp);
      expect(cachedProvider.validateModel).toHaveBeenCalledTimes(1);
      expect(cachedProvider.getCapabilities).toHaveBeenCalledTimes(1);
    });
  });

  describe('probeAllModels', () => {
    it('probes multiple models and returns individual results', async () => {
      const multiProvider = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi
          .fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(false)
          .mockRejectedValueOnce(new Error('timeout')),
        getCapabilities: vi
          .fn()
          .mockResolvedValue(SAMPLE_CAPABILITIES),
      };
      vi.mocked(getProviderById).mockReturnValue(multiProvider as never);

      const results = await service.probeAllModels('openai-responses', [
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-3.5',
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].ok).toBe(true);
      expect(results[0].status).toBe('success');
      expect(results[1].ok).toBe(false);
      expect(results[1].status).toBe('success');
      expect(results[2].ok).toBe(false);
      expect(results[2].status).toBe('failed');
    });
  });

  describe('getLiveProbeStatus', () => {
    it('returns cached status without re-probing', async () => {
      const statusProvider = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi.fn().mockResolvedValue(true),
        getCapabilities: vi.fn().mockResolvedValue(SAMPLE_CAPABILITIES),
      };
      vi.mocked(getProviderById).mockReturnValue(statusProvider as never);

      await service.probeModel('openai-responses', 'gpt-5.4');
      const status = await service.getLiveProbeStatus(
        'openai-responses',
        'gpt-5.4',
      );

      expect(status.validated).toBe(true);
      expect(status.capabilities).not.toBeNull();
      expect(status.capabilities!.toolCalls).toBe(true);
      expect(statusProvider.validateModel).toHaveBeenCalledTimes(1);
    });

    it('returns null capabilities when provider not found', async () => {
      vi.mocked(getProviderById).mockReturnValue(undefined);

      const status = await service.getLiveProbeStatus(
        'unknown',
        'gpt-5.4',
      );

      expect(status.validated).toBe(false);
      expect(status.capabilities).toBeNull();
    });
  });

  describe('clearCache', () => {
    it('clears entire cache', async () => {
      const clearProvider = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi.fn().mockResolvedValue(true),
        getCapabilities: vi.fn().mockResolvedValue(SAMPLE_CAPABILITIES),
      };
      vi.mocked(getProviderById).mockReturnValue(clearProvider as never);

      await service.probeModel('openai-responses', 'gpt-5.4');
      service.clearCache();
      await service.probeModel('openai-responses', 'gpt-5.4');

      expect(clearProvider.validateModel).toHaveBeenCalledTimes(2);
    });

    it('clears cache for a specific provider only', async () => {
      const clearProvider = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi.fn().mockResolvedValue(true),
        getCapabilities: vi.fn().mockResolvedValue(SAMPLE_CAPABILITIES),
      };
      vi.mocked(getProviderById).mockReturnValue(clearProvider as never);

      await service.probeModel('openai-responses', 'gpt-5.4');
      await service.probeModel('openai-responses', 'gpt-4.1');
      service.clearCache('openai-responses');
      await service.probeModel('openai-responses', 'gpt-5.4');

      expect(clearProvider.validateModel).toHaveBeenCalledTimes(3);
    });

    it('clears cache for a specific provider and model', async () => {
      const clearProvider = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi.fn().mockResolvedValue(true),
        getCapabilities: vi.fn().mockResolvedValue(SAMPLE_CAPABILITIES),
      };
      vi.mocked(getProviderById).mockReturnValue(clearProvider as never);

      await service.probeModel('openai-responses', 'gpt-5.4');
      await service.probeModel('openai-responses', 'gpt-4.1');
      service.clearCache('openai-responses', 'gpt-5.4');
      await service.probeModel('openai-responses', 'gpt-5.4');
      await service.probeModel('openai-responses', 'gpt-4.1');

      expect(clearProvider.validateModel).toHaveBeenCalledTimes(3);
    });
  });

  describe('getCachedProbe', () => {
    it('returns cached probe result when available', async () => {
      const cachedProvider = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi.fn().mockResolvedValue(true),
        getCapabilities: vi.fn().mockResolvedValue(SAMPLE_CAPABILITIES),
      };
      vi.mocked(getProviderById).mockReturnValue(cachedProvider as never);

      await service.probeModel('openai-responses', 'gpt-5.4');
      const cached = service.getCachedProbe(
        'openai-responses',
        'gpt-5.4',
      );

      expect(cached).not.toBeNull();
      expect(cached!.model).toBe('gpt-5.4');
      expect(cached!.ok).toBe(true);
    });

    it('returns null when no cache entry exists', () => {
      const cached = service.getCachedProbe('unknown', 'gpt-5.4');
      expect(cached).toBeNull();
    });
  });

  describe('getProbeHistory', () => {
    it('returns empty array when no probes have been run', () => {
      const history = service.getProbeHistory();
      expect(history).toEqual([]);
    });

    it('records probe results and returns them', async () => {
      const historyProvider = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi.fn().mockResolvedValue(true),
        getCapabilities: vi.fn().mockResolvedValue(SAMPLE_CAPABILITIES),
      };
      vi.mocked(getProviderById).mockReturnValue(historyProvider as never);

      await service.probeModel('openai-responses', 'gpt-5.4');

      const history = service.getProbeHistory();
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].providerId).toBe('openai-responses');
      expect(history[0].model).toBe('gpt-5.4');
      expect(history[0].result.ok).toBe(true);
      expect(history[0].result.validated).toBe(true);
      expect(history[0].timestamp).toBeDefined();
    });

    it('records failed probes in history', async () => {
      vi.mocked(getProviderById).mockReturnValue(undefined);

      await service.probeModel('unknown', 'gpt-5.4');

      const history = service.getProbeHistory('unknown');
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].result.ok).toBe(false);
      expect(history[0].result.errorMessage).toContain('not found');
    });

    it('filters history by providerId', async () => {
      const hp = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi.fn().mockResolvedValue(true),
        getCapabilities: vi.fn().mockResolvedValue(SAMPLE_CAPABILITIES),
      };
      vi.mocked(getProviderById).mockReturnValue(hp as never);

      await service.probeModel('openai-responses', 'gpt-5.4');
      await service.probeModel('openai-responses', 'gpt-4.1');

      const history = service.getProbeHistory('openai-responses');
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history.every((e) => e.providerId === 'openai-responses')).toBe(
        true,
      );
    });

    it('filters history by providerId and model', async () => {
      const hp = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi.fn().mockResolvedValue(true),
        getCapabilities: vi.fn().mockResolvedValue(SAMPLE_CAPABILITIES),
      };
      vi.mocked(getProviderById).mockReturnValue(hp as never);

      await service.probeModel('openai-responses', 'gpt-5.4');
      await service.probeModel('openai-responses', 'gpt-4.1');

      const history = service.getProbeHistory(
        'openai-responses',
        'gpt-5.4',
      );
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(
        history.every(
          (e) =>
            e.providerId === 'openai-responses' && e.model === 'gpt-5.4',
        ),
      ).toBe(true);
    });

    it('respects the limit parameter', async () => {
      const hp = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi.fn().mockResolvedValue(true),
        getCapabilities: vi.fn().mockResolvedValue(SAMPLE_CAPABILITIES),
      };
      vi.mocked(getProviderById).mockReturnValue(hp as never);

      await service.probeModel('openai-responses', 'gpt-5.4');
      const history = service.getProbeHistory(undefined, undefined, 1);
      expect(history.length).toBeLessThanOrEqual(1);
    });
  });

  describe('cache expiry', () => {
    it('re-probes after cache TTL expires', async () => {
      const expiryProvider = {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        validateModel: vi.fn().mockResolvedValue(true),
        getCapabilities: vi.fn().mockResolvedValue(SAMPLE_CAPABILITIES),
      };
      vi.mocked(getProviderById).mockReturnValue(expiryProvider as never);

      service = new LiveProbeService({ cacheTtlMs: 0 });

      await service.probeModel('openai-responses', 'gpt-5.4');
      await service.probeModel('openai-responses', 'gpt-5.4');

      expect(expiryProvider.validateModel).toHaveBeenCalledTimes(2);
    });
  });
});
