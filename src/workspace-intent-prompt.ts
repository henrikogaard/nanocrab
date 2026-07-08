import { formatMessages } from './router.js';
import type { NewMessage } from './types.js';
import {
  resolveWorkspaceIntent,
  type WorkspaceIntentInput,
  type WorkspaceIntentResult,
} from './workspace-intent.js';

export interface WorkspaceIntentPromptOptions {
  intent?: WorkspaceIntentResult;
  projects?: WorkspaceIntentInput['projects'];
  threads?: WorkspaceIntentInput['threads'];
}

function latestVisiblePrompt(messages: NewMessage[]): string {
  return (
    messages
      .filter((message) => !message.is_bot_message)
      .map((message) => (message.content || '').trim())
      .filter(Boolean)
      .at(-1) || ''
  );
}

function xmlText(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function resolveWorkspaceIntentForMessages(
  messages: NewMessage[],
  options: Omit<WorkspaceIntentPromptOptions, 'intent'> = {},
): WorkspaceIntentResult {
  const intent = resolveWorkspaceIntent({
    prompt: latestVisiblePrompt(messages),
    projects: options.projects,
    threads: options.threads,
  });
  if (
    intent.kind === 'clarification' &&
    intent.candidates.length === 3 &&
    intent.candidates.every((candidate) => !candidate.target)
  ) {
    const copilotCandidate = intent.candidates.find(
      (candidate) => candidate.kind === 'copilot',
    );
    return {
      kind: 'copilot',
      confidence: 'low',
      approvalRequired: false,
      reason:
        copilotCandidate?.reason ||
        'No specific workspace target was detected.',
      target: null,
      candidates: copilotCandidate ? [copilotCandidate] : [],
      clarificationPrompt: null,
    };
  }
  return intent;
}

function workspaceIntentContext(intent: WorkspaceIntentResult): string {
  const lane = intent.kind === 'clarification' ? 'clarification' : intent.kind;
  const guidance =
    lane === 'code'
      ? 'code-workspace'
      : lane === 'cowork'
        ? 'cowork-workspace'
        : lane === 'clarification'
          ? 'workspace-clarification'
          : 'copilot-workspace';
  const summary =
    lane === 'code'
      ? 'Code workspace intent selected.'
      : lane === 'cowork'
        ? 'Cowork workspace intent selected.'
        : lane === 'clarification'
          ? 'Workspace clarification required.'
          : 'Copilot workspace intent selected.';
  const guidanceText =
    lane === 'code'
      ? 'Focus on implementation, debugging, repo changes, tests, and precise verification.'
      : lane === 'cowork'
        ? 'Focus on research, synthesis, summaries, documents, and citations unless coding is explicitly requested.'
        : lane === 'clarification'
          ? 'Ask the user to choose the intended workspace before acting.'
          : 'Provide general assistance and keep actions scoped to explicit user asks.';

  return [
    `<workspace_intent lane="${lane}" guidance="${guidance}">`,
    `  <lane_summary>${summary}</lane_summary>`,
    `  <lane_guidance>${guidanceText}</lane_guidance>`,
    `  <reason>${xmlText(intent.reason)}</reason>`,
    intent.target
      ? `  <target>${xmlText(JSON.stringify(intent.target))}</target>`
      : '',
    intent.clarificationPrompt
      ? `  <clarification_prompt>${xmlText(
          intent.clarificationPrompt,
        )}</clarification_prompt>`
      : '',
    '</workspace_intent>',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildWorkspaceIntentPrompt(
  messages: NewMessage[],
  timezone: string,
  options: WorkspaceIntentPromptOptions = {},
): string {
  const intent =
    options.intent || resolveWorkspaceIntentForMessages(messages, options);
  return `${workspaceIntentContext(intent)}\n\n${formatMessages(
    messages,
    timezone,
  )}`;
}
