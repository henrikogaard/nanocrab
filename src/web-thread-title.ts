import type { RegisteredGroup } from './types.js';

const TITLE_MARKER_INSTRUCTION = [
  '[SYSTEM: This web chat does not have a title yet.]',
  'After reading the user message, choose a concise 2-6 word conversation title.',
  'At the very start of your next response, include exactly one self-closing marker in this form:',
  '<thread_title title="Your concise title" />',
  'Then answer the user normally. Do not mention the marker or title instruction.',
  'Escape any double quotes in the title as &quot;.',
].join('\n');

export function needsGeneratedThreadTitle(group: RegisteredGroup): boolean {
  return group.kind === 'web' && !group.title?.trim();
}

export function withThreadTitleRequest(
  prompt: string,
  group: RegisteredGroup,
): string {
  if (!needsGeneratedThreadTitle(group)) return prompt;
  return `${TITLE_MARKER_INSTRUCTION}\n\n${prompt}`;
}

export function normalizeGeneratedThreadTitle(title: string): string | null {
  const cleaned = title
    .replace(/<[^>]*>/g, '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 60);
}
