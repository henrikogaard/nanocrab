import { describe, expect, it } from 'vitest';
import { type NewMessage } from './types.js';
import {
  classifyWorkspaceIntent,
  workspaceIntentContext,
} from './workspace-intent-router.js';

function message(
  content: string,
  overrides: Partial<NewMessage> = {},
): NewMessage {
  return {
    id: 'm1',
    chat_jid: 'wa:group',
    sender: 'user-1',
    sender_name: 'User',
    content,
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('workspace intent router', () => {
  it('classifies code intent for explicit coding cues', () => {
    const intent = classifyWorkspaceIntent([
      message('Can you /code fix this failing test and open a PR on a branch?'),
    ]);

    expect(intent).toBe('code');
  });

  it('classifies cowork intent for research and artifact cues', () => {
    const intent = classifyWorkspaceIntent([
      message(
        'Research this topic, summarize sources with citations, and draft an email artifact.',
      ),
    ]);

    expect(intent).toBe('cowork');
  });

  it('defaults to copilot when no code or cowork cues are present', () => {
    const intent = classifyWorkspaceIntent([
      message('Hei, what should we focus on this week?'),
    ]);

    expect(intent).toBe('copilot');
  });

  it('returns lane-specific guidance markers in workspace context blocks', () => {
    expect(workspaceIntentContext('code')).toContain(
      'guidance="code-workspace"',
    );
    expect(workspaceIntentContext('cowork')).toContain(
      'guidance="cowork-workspace"',
    );
    expect(workspaceIntentContext('copilot')).toContain(
      'guidance="copilot-workspace"',
    );
  });
});
