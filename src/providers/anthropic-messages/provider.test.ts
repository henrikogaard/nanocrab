import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../env.js', () => ({
  readEnvFile: vi.fn(() => ({
    ANTHROPIC_API_KEY: 'sk-ant-test-key-123',
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
  })),
}));

import { readEnvFile } from '../../env.js';
import { anthropicMessagesProvider } from './provider.js';

describe('AnthropicMessagesProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getCapabilities', () => {
    it('returns capabilities for known models', async () => {
      const caps =
        await anthropicMessagesProvider.getCapabilities('claude-sonnet-4-6');
      expect(caps.toolCalls).toBe(true);
      expect(caps.structuredOutput).toBe(true);
      expect(caps.streaming).toBe(true);
      expect(caps.vision).toBe(true);
      expect(caps.contextWindow).toBe(200000);
      expect(caps.costTier).toBe('high');
      expect(caps.codeStrength).toBe('high');
      expect(caps.privacyTier).toBe('medium');
      expect(caps.supportsMcpStrategy).toBe(true);
    });

    it('returns default capabilities for unknown models', async () => {
      const caps =
        await anthropicMessagesProvider.getCapabilities('unknown-model');
      expect(caps.toolCalls).toBe(true);
      expect(caps.contextWindow).toBe(200000);
      expect(caps.costTier).toBe('high');
    });

    it('returns model-specific context window and cost tier', async () => {
      const opus =
        await anthropicMessagesProvider.getCapabilities('claude-opus-4-6');
      const haiku = await anthropicMessagesProvider.getCapabilities(
        'claude-haiku-4-5-20251001',
      );

      expect(opus.contextWindow).toBe(200000);
      expect(opus.costTier).toBe('high');
      expect(haiku.contextWindow).toBe(200000);
      expect(haiku.costTier).toBe('medium');
    });
  });

  describe('validateModel', () => {
    it('returns true when model exists in API response', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [{ id: 'claude-sonnet-4-6' }, { id: 'claude-opus-4-6' }],
        }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const result =
        await anthropicMessagesProvider.validateModel('claude-sonnet-4-6');
      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'sk-ant-test-key-123',
            'anthropic-version': '2023-06-01',
          }),
        }),
      );
    });

    it('returns false when model not found in API list', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ data: [{ id: 'claude-sonnet-4-6' }] }),
        })),
      );

      const result =
        await anthropicMessagesProvider.validateModel('claude-opus-4-6');
      expect(result).toBe(false);
    });

    it('returns false on API error response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
      );

      const result =
        await anthropicMessagesProvider.validateModel('claude-sonnet-4-6');
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
        await anthropicMessagesProvider.validateModel('claude-sonnet-4-6');
      expect(result).toBe(false);
    });
  });

  describe('executeTask', () => {
    it('sends POST to /v1/messages and returns parsed output', async () => {
      const mockOutput = {
        id: 'msg_abc123',
        model: 'claude-sonnet-4-6',
        output: [{ type: 'text', text: 'Hello!' }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, json: async () => mockOutput })),
      );

      const result = await anthropicMessagesProvider.executeTask(
        { input: 'Say hello' },
        { model: 'claude-sonnet-4-6' },
      );

      expect(result.id).toBe('msg_abc123');
      expect(result.output).toHaveLength(1);
      expect(result.usage?.total_tokens).toBe(15);

      const fetchMock = vi.mocked(fetch);
      const callUrl = fetchMock.mock.calls[0][0];
      const callInit = fetchMock.mock.calls[0][1] as RequestInit;
      expect(callUrl).toBe('https://api.anthropic.com/v1/messages');
      expect(callInit.method).toBe('POST');
      const body = JSON.parse(callInit.body as string);
      expect(body.model).toBe('claude-sonnet-4-6');
      expect(body.messages).toEqual([{ role: 'user', content: 'Say hello' }]);
      expect(body.max_tokens).toBe(4096);
    });

    it('maps input array directly to messages and instructions to system', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            id: 'msg_1',
            model: 'claude-sonnet-4-6',
            output: [],
          }),
        })),
      );

      await anthropicMessagesProvider.executeTask({
        input: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
        ],
        instructions: 'Be concise',
        temperature: 0.3,
        maxOutputTokens: 1000,
        stream: false,
      });

      const fetchMock = vi.mocked(fetch);
      const callInit = fetchMock.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(callInit.body as string);
      expect(body.messages).toEqual([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ]);
      expect(body.system).toBe('Be concise');
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(1000);
      expect(body.stream).toBe(false);
    });

    it('uses x-api-key and anthropic-version headers', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            id: 'msg_1',
            model: 'claude-sonnet-4-6',
            output: [],
          }),
        })),
      );

      await anthropicMessagesProvider.executeTask({ input: 'Hello' });

      const fetchMock = vi.mocked(fetch);
      const callInit = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = callInit.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-ant-test-key-123');
      expect(headers['anthropic-version']).toBe('2023-06-01');
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
        anthropicMessagesProvider.executeTask({ input: 'test' }),
      ).rejects.toThrow(/429.*Rate limit exceeded/);
    });

    it('throws when API key is missing', async () => {
      vi.mocked(readEnvFile).mockReturnValueOnce({});

      const prevKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      await expect(
        anthropicMessagesProvider.executeTask({ input: 'test' }),
      ).rejects.toThrow('ANTHROPIC_API_KEY is not configured');

      if (prevKey) process.env.ANTHROPIC_API_KEY = prevKey;
    });

    it('defaults to claude-sonnet-4-6 when no model specified', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            id: 'msg_1',
            model: 'claude-sonnet-4-6',
            output: [],
          }),
        })),
      );

      await anthropicMessagesProvider.executeTask({ input: 'test' });

      const fetchMock = vi.mocked(fetch);
      const callInit = fetchMock.mock.calls[0][1] as unknown as RequestInit;
      const body = JSON.parse(callInit.body as string);
      expect(body.model).toBe('claude-sonnet-4-6');
    });
  });
});
