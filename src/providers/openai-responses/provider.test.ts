import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../env.js', () => ({
  readEnvFile: vi.fn(() => ({
    OPENAI_API_KEY: 'sk-test-key-123',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
  })),
}));

import { readEnvFile } from '../../env.js';
import { openaiResponsesProvider } from './provider.js';

describe('OpenAIResponsesProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getCapabilities', () => {
    it('returns capabilities for known models', async () => {
      const caps = await openaiResponsesProvider.getCapabilities('gpt-5.4');
      expect(caps.toolCalls).toBe(true);
      expect(caps.structuredOutput).toBe(true);
      expect(caps.streaming).toBe(true);
      expect(caps.vision).toBe(true);
      expect(caps.contextWindow).toBe(200000);
      expect(caps.costTier).toBe('high');
      expect(caps.privacyTier).toBe('medium');
      expect(caps.supportsMcpStrategy).toBe(true);
    });

    it('returns default capabilities for unknown models', async () => {
      const caps =
        await openaiResponsesProvider.getCapabilities('unknown-model');
      expect(caps.toolCalls).toBe(true);
      expect(caps.contextWindow).toBe(128000);
      expect(caps.costTier).toBe('medium');
    });

    it('returns model-specific context window and cost tier', async () => {
      const mini = await openaiResponsesProvider.getCapabilities('gpt-5.4-mini');
      const gpt52 = await openaiResponsesProvider.getCapabilities('gpt-5.2');

      expect(mini.contextWindow).toBe(200000);
      expect(mini.costTier).toBe('medium');
      expect(gpt52.contextWindow).toBe(128000);
      expect(gpt52.costTier).toBe('medium');
    });
  });

  describe('validateModel', () => {
    it('returns true when model exists in API response', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [{ id: 'gpt-5.4' }, { id: 'gpt-4.1' }],
        }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await openaiResponsesProvider.validateModel('gpt-5.4');
      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test-key-123',
          }),
        }),
      );
    });

    it('returns false when model not found in API list', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ data: [{ id: 'gpt-5.4' }] }),
        })),
      );

      const result =
        await openaiResponsesProvider.validateModel('gpt-5.4-mini');
      expect(result).toBe(false);
    });

    it('returns false on API error response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
      );

      const result = await openaiResponsesProvider.validateModel('gpt-5.4');
      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('network error');
        }),
      );

      const result = await openaiResponsesProvider.validateModel('gpt-5.4');
      expect(result).toBe(false);
    });
  });

  describe('executeTask', () => {
    it('sends POST to /responses and returns parsed output', async () => {
      const mockOutput = {
        id: 'resp_abc123',
        model: 'gpt-5.4',
        output: [{ type: 'message', content: 'Hello!' }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, json: async () => mockOutput })),
      );

      const result = await openaiResponsesProvider.executeTask(
        { input: 'Say hello' },
        { model: 'gpt-5.4' },
      );

      expect(result.id).toBe('resp_abc123');
      expect(result.output).toHaveLength(1);
      expect(result.usage?.total_tokens).toBe(15);

      const fetchMock = vi.mocked(fetch);
      const callUrl = fetchMock.mock.calls[0][0];
      const callInit = fetchMock.mock.calls[0][1] as RequestInit;
      expect(callUrl).toBe('https://api.openai.com/v1/responses');
      expect(callInit.method).toBe('POST');
      const body = JSON.parse(callInit.body as string);
      expect(body.model).toBe('gpt-5.4');
      expect(body.input).toBe('Say hello');
    });

    it('passes optional fields in request body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ id: 'resp_1', model: 'gpt-5.4', output: [] }),
        })),
      );

      await openaiResponsesProvider.executeTask({
        input: [{ role: 'user', content: 'Hi' }],
        instructions: 'Be concise',
        temperature: 0.3,
        maxOutputTokens: 1000,
        stream: false,
      });

      const fetchMock = vi.mocked(fetch);
      const callInit = fetchMock.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(callInit.body as string);
      expect(body.instructions).toBe('Be concise');
      expect(body.temperature).toBe(0.3);
      expect(body.max_output_tokens).toBe(1000);
      expect(body.stream).toBe(false);
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
        openaiResponsesProvider.executeTask({ input: 'test' }),
      ).rejects.toThrow(/429.*Rate limit exceeded/);
    });

    it('throws when API key is missing', async () => {
      vi.mocked(readEnvFile).mockReturnValueOnce({});

      const prevKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      await expect(
        openaiResponsesProvider.executeTask({ input: 'test' }),
      ).rejects.toThrow('OPENAI_API_KEY is not configured');

      if (prevKey) process.env.OPENAI_API_KEY = prevKey;
    });
  });
});
