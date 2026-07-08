import { formatMessages } from './router.js';
import type { NewMessage } from './types.js';
import {
  classifyWorkspaceIntent,
  workspaceIntentContext,
} from './workspace-intent-router.js';

export function buildWorkspaceIntentPrompt(
  messages: NewMessage[],
  timezone: string,
): string {
  const intent = classifyWorkspaceIntent(messages);
  return `${workspaceIntentContext(intent)}\n\n${formatMessages(messages, timezone)}`;
}
