import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../env.js', () => ({
  readEnvFile: vi.fn(() => ({
    OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:8080/v1',
    OPENAI_COMPATIBLE_API_KEY: 'test-openai-compatible-key',
  })),
}));

import { readEnvFile } from '../../env.js';
import { openaiCompatibleProvider } from './provider.js';

describe('OpenAICompatibleProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getCapabilities', () => {
    it('returns conservative defaults', async () => {
      const caps =
        await openaiCompatibleProvider.getCapabilities('any-model');
      expect(caps.toolCalls).toBe(false);
      expect(caps.structuredOutput).toBe(false);
      expect(caps.streaming).toBe(true);
      expect(caps.vision).toBe(false);
      expect(caps.contextWindow).toBe(32768);
      expect(caps.costTier).toBe('low');
      expect(caps.privacyTier).toBe('low');
    });

    it('returns codeStrength as low', async () => {
      const caps = await openaiCompatibleProvider.getCapabilities('test');
      expect(caps.codeStrength).toBe('low');
    });

    it('returns supportsMcpStrategy as false', async () => {
      const caps = await openaiCompatibleProvider.getCapabilities('test');
      expect(caps.supportsMcpStrategy).toBe(false);
    });
  });

  describe('validateModel', () => {
    it('returns true when model exists in API response', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [{ id: 'gpt-4-turbo' }, { id: 'gpt-3.5-turbo' }],
        }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const result =
        await openaiCompatibleProvider.validateModel('gpt-4-turbo');
      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8080/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-openai-compatible-key',
          }),
        }),
      );
    });

    it('returns false when model not found in API list', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ data: [{ id: 'gpt-4-turbo' }] }),
        })),
      );

      const result =
        await openaiCompatibleProvider.validateModel('gpt-5.4');
      expect(result).toBe(false);
    });

    it('returns false on API error response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: false,
          status: 401,
          json: async () => ({}),
        })),
      );

      const result =
        await openaiCompatibleProvider.validateModel('gpt-4-turbo');
      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('network error');
        }),
      );

      const result =
        await openaiCompatibleProvider.validateModel('gpt-4-turbo');
      expect(result).toBe(false);
    });

    it('returns false when no base URL is configured', async () => {
      vi.mocked(readEnvFile).mockReturnValueOnce({});

      const prevUrl = process.env.OPENAI_COMPATIBLE_BASE_URL;
      delete process.env.OPENAI_COMPATIBLE_BASE_URL;

      const result =
        await openaiCompatibleProvider.validateModel('gpt-4-turbo');
      expect(result).toBe(false);

      if (prevUrl) process.env.OPENAI_COMPATIBLE_BASE_URL = prevUrl;
    });
  });

  describe('executeTask', () => {
    it('sends POST to /chat/completions and returns parsed output', async () => {
      const mockResponse = {
        id: 'cmpl_abc123',
        model: 'gpt-4-turbo',
        choices: [
          { message: { content: 'Hello!', role: 'assistant' } },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, json: async () => mockResponse })),
      );

      const result = await openaiCompatibleProvider.executeTask(
        { input: 'Say hello' },
        { model: 'gpt-4-turbo' },
      );

      expect(result.id).toBe('cmpl_abc123');
      expect(result.model).toBe('gpt-4-turbo');
      expect(result.output).toHaveLength(1);
      expect(result.output[0]).toEqual({
        type: 'message',
        content: 'Hello!',
      });
      expect(result.usage?.total_tokens).toBe(15);

      const fetchMock = vi.mocked(fetch);
      const callUrl = fetchMock.mock.calls[0][0];
      const callInit = fetchMock.mock.calls[0][1] as RequestInit;
      expect(callUrl).toBe(
        'http://localhost:8080/v1/chat/completions',
      );
      expect(callInit.method).toBe('POST');
      const body = JSON.parse(callInit.body as string);
      expect(body.model).toBe('gpt-4-turbo');
      expect(body.messages).toEqual([
        { role: 'user', content: 'Say hello' },
      ]);
      expect(body.max_tokens).toBe(4096);
    });

    it('prepends instructions as system message and passes optional fields', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            id: 'cmpl_1',
            model: 'gpt-4-turbo',
            choices: [
              { message: { content: 'Sure!', role: 'assistant' } },
            ],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 3,
              total_tokens: 23,
            },
          }),
        })),
      );

      await openaiCompatibleProvider.executeTask({
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
            model: 'gpt-4-turbo',
            choices: [
              { message: { content: 'ok', role: 'assistant' } },
            ],
          }),
        })),
      );

      await openaiCompatibleProvider.executeTask({ input: 'Hello' });

      const fetchMock = vi.mocked(fetch);
      const callInit = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = callInit.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(
        'Bearer test-openai-compatible-key',
      );
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
        openaiCompatibleProvider.executeTask({ input: 'test' }),
      ).rejects.toThrow(/429.*Rate limit exceeded/);
    });

    it('works without API key (auth is optional)', async () => {
      vi.mocked(readEnvFile)
        .mockReturnValueOnce({
          OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:8080/v1',
        })
        .mockReturnValueOnce({
          OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:8080/v1',
        });

      const prevKey = process.env.OPENAI_COMPATIBLE_API_KEY;
      delete process.env.OPENAI_COMPATIBLE_API_KEY;

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            id: 'cmpl_1',
            model: 'gpt-4-turbo',
            choices: [
              { message: { content: 'ok', role: 'assistant' } },
            ],
          }),
        })),
      );

      const result = await openaiCompatibleProvider.executeTask({
        input: 'Hello',
      });
      expect(result.output).toHaveLength(1);

      const fetchMock = vi.mocked(fetch);
      const callInit = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = callInit.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBeUndefined();

      if (prevKey) process.env.OPENAI_COMPATIBLE_API_KEY = prevKey;
    });

    it('throws when base URL is not configured', async () => {
      vi.mocked(readEnvFile).mockReturnValueOnce({});

      const prevUrl = process.env.OPENAI_COMPATIBLE_BASE_URL;
      delete process.env.OPENAI_COMPATIBLE_BASE_URL;

      await expect(
        openaiCompatibleProvider.executeTask({ input: 'test' }),
      ).rejects.toThrow(
        'OPENAI_COMPATIBLE_BASE_URL is not configured',
      );

      if (prevUrl) process.env.OPENAI_COMPATIBLE_BASE_URL = prevUrl;
    });
  });
});
