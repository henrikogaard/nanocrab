import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../env.js', () => ({
  readEnvFile: vi.fn(() => ({
    GEMINI_API_KEY: 'test-gemini-key-123',
    GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
  })),
}));

import { readEnvFile } from '../../env.js';
import { geminiProvider } from './provider.js';

describe('GeminiProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getCapabilities', () => {
    it('returns capabilities for known models', async () => {
      const caps = await geminiProvider.getCapabilities('gemini-3.5-flash');
      expect(caps.toolCalls).toBe(true);
      expect(caps.structuredOutput).toBe(true);
      expect(caps.streaming).toBe(true);
      expect(caps.vision).toBe(true);
      expect(caps.codeStrength).toBe('medium');
      expect(caps.contextWindow).toBe(1000000);
      expect(caps.costTier).toBe('medium');
      expect(caps.privacyTier).toBe('medium');
      expect(caps.supportsMcpStrategy).toBe(true);
    });

    it('returns default capabilities for unknown models', async () => {
      const caps = await geminiProvider.getCapabilities('unknown-model');
      expect(caps.toolCalls).toBe(true);
      expect(caps.contextWindow).toBe(1000000);
      expect(caps.costTier).toBe('medium');
      expect(caps.codeStrength).toBe('medium');
    });

    it('returns model-specific context window and cost tier', async () => {
      const pro = await geminiProvider.getCapabilities('gemini-2.5-pro');
      const flash = await geminiProvider.getCapabilities('gemini-2.5-flash');

      expect(pro.contextWindow).toBe(1000000);
      expect(pro.costTier).toBe('high');
      expect(flash.contextWindow).toBe(1000000);
      expect(flash.costTier).toBe('medium');
    });
  });

  describe('validateModel', () => {
    it('returns true when model exists in API response', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          models: [{ name: 'models/gemini-3.5-flash' }, { name: 'models/gemini-2.5-pro' }],
        }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await geminiProvider.validateModel('gemini-3.5-flash');
      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-gemini-key-123',
          }),
        }),
      );
    });

    it('returns false when model not found in API list', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ models: [{ name: 'models/gemini-3.5-flash' }] }),
        })),
      );

      const result = await geminiProvider.validateModel('gemini-2.5-pro');
      expect(result).toBe(false);
    });

    it('returns false on API error response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
      );

      const result = await geminiProvider.validateModel('gemini-3.5-flash');
      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('network error');
        }),
      );

      const result = await geminiProvider.validateModel('gemini-3.5-flash');
      expect(result).toBe(false);
    });
  });

  describe('executeTask', () => {
    it('sends POST to :generateContent and returns parsed output', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello! How can I help you?' }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, json: async () => mockResponse })),
      );

      const result = await geminiProvider.executeTask(
        { input: 'Say hello' },
        { model: 'gemini-3.5-flash' },
      );

      expect(result.id).toMatch(/^gemini-gemini-3\.5-flash-/);
      expect(result.output).toHaveLength(1);
      expect(result.usage?.total_tokens).toBe(15);

      const fetchMock = vi.mocked(fetch);
      const callUrl = fetchMock.mock.calls[0][0];
      const callInit = fetchMock.mock.calls[0][1] as RequestInit;
      expect(callUrl).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
      );
      expect(callInit.method).toBe('POST');
      const body = JSON.parse(callInit.body as string);
      expect(body.contents).toEqual([
        { role: 'user', parts: [{ text: 'Say hello' }] },
      ]);
    });

    it('maps array input to contents with role mapping', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'Sure!' }] } }],
            usageMetadata: {
              promptTokenCount: 20,
              candidatesTokenCount: 3,
              totalTokenCount: 23,
            },
          }),
        })),
      );

      await geminiProvider.executeTask({
        input: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
          { role: 'user', content: 'How are you?' },
        ],
        instructions: 'Be concise',
        temperature: 0.3,
        maxOutputTokens: 1000,
      });

      const fetchMock = vi.mocked(fetch);
      const callInit = fetchMock.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(callInit.body as string);
      expect(body.contents).toEqual([
        { role: 'user', parts: [{ text: 'Hi' }] },
        { role: 'model', parts: [{ text: 'Hello' }] },
        { role: 'user', parts: [{ text: 'How are you?' }] },
      ]);
      expect(body.system_instruction).toEqual({
        parts: [{ text: 'Be concise' }],
      });
      expect(body.generationConfig).toEqual({
        temperature: 0.3,
        maxOutputTokens: 1000,
      });
    });

    it('uses Bearer token auth header', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'ok' }] } }],
          }),
        })),
      );

      await geminiProvider.executeTask({ input: 'Hello' });

      const fetchMock = vi.mocked(fetch);
      const callInit = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = callInit.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-gemini-key-123');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('throws on HTTP error response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: false,
          status: 429,
          text: async () => 'Rate limit exceeded',
        })),
      );

      await expect(
        geminiProvider.executeTask({ input: 'test' }),
      ).rejects.toThrow(/429.*Rate limit exceeded/);
    });

    it('throws when API key is missing', async () => {
      vi.mocked(readEnvFile).mockReturnValueOnce({});

      const prevKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      await expect(
        geminiProvider.executeTask({ input: 'test' }),
      ).rejects.toThrow('GEMINI_API_KEY is not configured');

      if (prevKey) process.env.GEMINI_API_KEY = prevKey;
    });
  });
});
