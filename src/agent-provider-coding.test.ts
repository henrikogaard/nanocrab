import { describe, expect, it } from 'vitest';

import {
  codingProviderUnavailableReason,
  isCodingCapableProvider,
} from './agent-provider.js';

describe('agent provider coding capability', () => {
  it('treats OpenRouter and OpenCode as coding-capable providers', () => {
    expect(
      isCodingCapableProvider('opencode', 'opencode/grok-code-fast-1'),
    ).toBe(true);
    expect(isCodingCapableProvider('openrouter', 'openrouter/auto')).toBe(true);
  });

  it('only enables Ollama coding jobs for code-capable local models', () => {
    expect(isCodingCapableProvider('ollama', 'llama3')).toBe(false);
    expect(isCodingCapableProvider('ollama', 'codestral')).toBe(true);
    expect(isCodingCapableProvider('ollama', 'qwen2.5-coder')).toBe(true);
    expect(codingProviderUnavailableReason('ollama', 'llama3')).toContain(
      'chat/local-task only',
    );
  });

  it('only enables custom OpenAI-compatible coding jobs for code-capable models', () => {
    expect(isCodingCapableProvider('openai-compatible', 'model-id')).toBe(
      false,
    );
    expect(isCodingCapableProvider('openai-compatible', 'qwen3-coder')).toBe(
      true,
    );
    expect(
      codingProviderUnavailableReason('openai-compatible', 'model-id'),
    ).toContain('code-capable OpenAI-compatible model');
  });
});
