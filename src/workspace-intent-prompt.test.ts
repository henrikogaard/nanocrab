import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceIntentPrompt,
  resolveWorkspaceIntentForMessages,
} from './workspace-intent-prompt.js';
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

  it('can use the workspace resolver to surface channel clarifications', () => {
    const messages = [
      message('Fix issue #104 and update the AuroraDocs project brief.'),
    ];
    const intent = resolveWorkspaceIntentForMessages(messages, {
      projects: [
        {
          id: 'project-auroradocs',
          name: 'AuroraDocs',
          slug: 'auroradocs',
        },
      ],
      threads: [],
    });

    const prompt = buildWorkspaceIntentPrompt(messages, 'UTC', { intent });

    expect(intent.kind).toBe('clarification');
    expect(intent.clarificationPrompt).toContain('Code issue #104');
    expect(intent.clarificationPrompt).toContain('Cowork project AuroraDocs');
    expect(prompt).toContain('<workspace_intent lane="clarification"');
    expect(prompt).toContain('Which workspace should handle this?');
  });
});
