import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../env.js', () => ({
  readEnvFile: vi.fn(() => ({
    MISTRAL_API_KEY: 'test-mistral-key-123',
    MISTRAL_BASE_URL: 'https://api.mistral.ai/v1',
  })),
}));

import { readEnvFile } from '../../env.js';
import { mistralProvider } from './provider.js';

describe('MistralProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getCapabilities', () => {
    it('returns capabilities for known models', async () => {
      const caps = await mistralProvider.getCapabilities('mistral-large-latest');
      expect(caps.toolCalls).toBe(true);
      expect(caps.structuredOutput).toBe(true);
      expect(caps.streaming).toBe(true);
      expect(caps.vision).toBe(false);
      expect(caps.codeStrength).toBe('medium');
      expect(caps.contextWindow).toBe(128000);
      expect(caps.costTier).toBe('medium');
      expect(caps.privacyTier).toBe('medium');
      expect(caps.supportsMcpStrategy).toBe(true);
    });

    it('returns default capabilities for unknown models', async () => {
      const caps = await mistralProvider.getCapabilities('unknown-model');
      expect(caps.toolCalls).toBe(true);
      expect(caps.contextWindow).toBe(128000);
      expect(caps.costTier).toBe('medium');
      expect(caps.codeStrength).toBe('medium');
      expect(caps.vision).toBe(false);
    });

    it('returns model-specific context window and cost tier', async () => {
      const codestral = await mistralProvider.getCapabilities('codestral-latest');
      const medium = await mistralProvider.getCapabilities('mistral-medium-latest');

      expect(codestral.contextWindow).toBe(256000);
      expect(codestral.costTier).toBe('medium');
      expect(codestral.vision).toBe(false);
      expect(medium.contextWindow).toBe(128000);
      expect(medium.costTier).toBe('low');
    });
  });

  describe('validateModel', () => {
    it('returns true when model exists in API response', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [{ id: 'mistral-large-latest' }, { id: 'mistral-medium-latest' }],
        }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await mistralProvider.validateModel('mistral-large-latest');
      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.mistral.ai/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-mistral-key-123',
          }),
        }),
      );
    });

    it('returns false when model not found in API list', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ data: [{ id: 'mistral-large-latest' }] }),
        })),
      );

      const result = await mistralProvider.validateModel('codestral-latest');
      expect(result).toBe(false);
    });

    it('returns false on API error response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
      );

      const result = await mistralProvider.validateModel('mistral-large-latest');
      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('network error');
        }),
      );

      const result = await mistralProvider.validateModel('mistral-large-latest');
      expect(result).toBe(false);
    });
  });

  describe('executeTask', () => {
    it('sends POST to /chat/completions and returns parsed output', async () => {
      const mockResponse = {
        id: 'cmpl_abc123',
        model: 'mistral-large-latest',
        choices: [
          { message: { content: 'Hello! How can I help you?', role: 'assistant' } },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, json: async () => mockResponse })),
      );

      const result = await mistralProvider.executeTask(
        { input: 'Say hello' },
        { model: 'mistral-large-latest' },
      );

      expect(result.id).toBe('cmpl_abc123');
      expect(result.model).toBe('mistral-large-latest');
      expect(result.output).toHaveLength(1);
      expect(result.output[0]).toEqual({ type: 'message', content: 'Hello! How can I help you?' });
      expect(result.usage?.total_tokens).toBe(15);

      const fetchMock = vi.mocked(fetch);
      const callUrl = fetchMock.mock.calls[0][0];
      const callInit = fetchMock.mock.calls[0][1] as RequestInit;
      expect(callUrl).toBe('https://api.mistral.ai/v1/chat/completions');
      expect(callInit.method).toBe('POST');
      const body = JSON.parse(callInit.body as string);
      expect(body.model).toBe('mistral-large-latest');
      expect(body.messages).toEqual([{ role: 'user', content: 'Say hello' }]);
      expect(body.max_tokens).toBe(4096);
    });

    it('maps array input to messages and prepends instructions as system message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            id: 'cmpl_1',
            model: 'mistral-large-latest',
            choices: [{ message: { content: 'Sure!', role: 'assistant' } }],
            usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 },
          }),
        })),
      );

      await mistralProvider.executeTask({
        input: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
        ],
        instructions: 'Be concise',
        temperature: 0.3,
        maxOutputTokens: 1000,
      });

      const fetchMock = vi.mocked(fetch);
      const callInit = fetchMock.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(callInit.body as string);
      expect(body.messages).toEqual([
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ]);
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(1000);
    });

    it('uses Bearer token auth header', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            id: 'cmpl_1',
            model: 'mistral-large-latest',
            choices: [{ message: { content: 'ok', role: 'assistant' } }],
          }),
        })),
      );

      await mistralProvider.executeTask({ input: 'Hello' });

      const fetchMock = vi.mocked(fetch);
      const callInit = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = callInit.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-mistral-key-123');
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
        mistralProvider.executeTask({ input: 'test' }),
      ).rejects.toThrow(/429.*Rate limit exceeded/);
    });

    it('throws when API key is missing', async () => {
      vi.mocked(readEnvFile).mockReturnValueOnce({});

      const prevKey = process.env.MISTRAL_API_KEY;
      delete process.env.MISTRAL_API_KEY;

      await expect(
        mistralProvider.executeTask({ input: 'test' }),
      ).rejects.toThrow('MISTRAL_API_KEY is not configured');

      if (prevKey) process.env.MISTRAL_API_KEY = prevKey;
    });
  });
});
