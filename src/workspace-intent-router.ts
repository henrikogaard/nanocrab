import type { NewMessage } from './types.js';

export type WorkspaceIntent = 'copilot' | 'cowork' | 'code';

const RECENT_MESSAGE_WINDOW = 8;

const CODE_CUES = [
  /(^|\s)\/code(\s|$)/i,
  /\b(?:bug\s*fix|bugfix|fix\s+bug|hotfix|regression)\b/i,
  /\b(?:pr|pull\s+request|branch|commit|cherry-pick|rebase|merge)\b/i,
  /\b(?:test\s*-?\s*failure|test\s+fail(?:ed|ure)?|failing\s+test|ci\s+fail(?:ed|ure)|build\s+fail(?:ed|ure))\b/i,
];

const COWORK_CUES = [
  /\b(?:research|summari[sz]e|summary)\b/i,
  /\b(?:email|calendar|document|artifact|sources?|citation|citations)\b/i,
];

function recentVisibleContent(messages: NewMessage[]): string {
  return messages
    .filter((m) => !m.is_bot_message)
    .slice(-RECENT_MESSAGE_WINDOW)
    .map((m) => (m.content || '').trim().toLowerCase())
    .filter(Boolean)
    .join('\n');
}

export function classifyWorkspaceIntent(messages: NewMessage[]): WorkspaceIntent {
  const content = recentVisibleContent(messages);
  if (!content) return 'copilot';

  if (CODE_CUES.some((cue) => cue.test(content))) {
    return 'code';
  }

  if (COWORK_CUES.some((cue) => cue.test(content))) {
    return 'cowork';
  }

  return 'copilot';
}

export function workspaceIntentContext(intent: WorkspaceIntent): string {
  if (intent === 'code') {
    return [
      '<workspace_intent lane="code" guidance="code-workspace">',
      '  <lane_summary>Code workspace intent selected.</lane_summary>',
      '  <lane_guidance>Focus on implementation, debugging, repo changes, tests, and precise verification.</lane_guidance>',
      '</workspace_intent>',
    ].join('\n');
  }

  if (intent === 'cowork') {
    return [
      '<workspace_intent lane="cowork" guidance="cowork-workspace">',
      '  <lane_summary>Cowork workspace intent selected.</lane_summary>',
      '  <lane_guidance>Focus on research, synthesis, summaries, documents, and citations unless coding is explicitly requested.</lane_guidance>',
      '</workspace_intent>',
    ].join('\n');
  }

  return [
    '<workspace_intent lane="copilot" guidance="copilot-workspace">',
    '  <lane_summary>Copilot workspace intent selected.</lane_summary>',
    '  <lane_guidance>Provide general assistance and keep actions scoped to explicit user asks.</lane_guidance>',
    '</workspace_intent>',
  ].join('\n');
}
