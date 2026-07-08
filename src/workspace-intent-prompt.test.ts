import { describe, expect, it } from 'vitest';

import { buildWorkspaceIntentPrompt } from './workspace-intent-prompt.js';
import type { NewMessage } from './types.js';

function message(content: string): NewMessage {
  return {
    id: 'm1',
    chat_jid: 'signal:main',
    sender: 'user',
    sender_name: 'User',
    content,
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

describe('workspace intent prompt', () => {
  it('prepends lane guidance before channel messages', () => {
    const prompt = buildWorkspaceIntentPrompt(
      [
        message(
          'Check Cowork for project AuroraDocs and send me the latest brief.',
        ),
      ],
      'UTC',
    );

    expect(prompt).toContain('<workspace_intent lane="cowork"');
    expect(prompt.indexOf('<workspace_intent')).toBeLessThan(
      prompt.indexOf('<messages>'),
    );
    expect(prompt).toContain('Cowork workspace intent selected.');
  });
});
