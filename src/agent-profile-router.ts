import { listAgentProfiles, normalizeAgentHandle } from './agent-profiles.js';
import type { AgentProfile } from './types.js';

export interface AgentProfileInvocation {
  profile: AgentProfile;
  profileId: string;
  handle: string;
  taskText: string;
}

interface ResolveAgentProfileInvocationInput {
  text: string;
  profiles?: AgentProfile[];
}

interface MentionMatch {
  handle: string;
  start: number;
  end: number;
}

export class AgentProfileResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentProfileResolutionError';
  }
}

const HANDLE_MENTION_RE =
  /(^|[^A-Za-z0-9_-])@([A-Za-z0-9][A-Za-z0-9_-]*)(?![A-Za-z0-9_-])/g;

export function extractAgentProfileHandles(text: string): string[] {
  const seen = new Set<string>();
  const handles: string[] = [];

  for (const mention of findMentionMatches(text)) {
    if (seen.has(mention.handle)) continue;
    seen.add(mention.handle);
    handles.push(mention.handle);
  }

  return handles;
}

export function resolveAgentProfileInvocation(
  input: ResolveAgentProfileInvocationInput,
): AgentProfileInvocation | null {
  const mentions = findMentionMatches(input.text);
  const firstMention = mentions[0];
  if (!firstMention) return null;

  const profiles = input.profiles ?? listAgentProfiles();
  let firstDisabledMention: MentionMatch | null = null;

  for (const mention of mentions) {
    const matchingProfiles = profiles.filter(
      (candidate) => normalizeAgentHandle(candidate.handle) === mention.handle,
    );
    if (matchingProfiles.length === 0) continue;

    const enabledProfile = matchingProfiles.find(
      (candidate) => candidate.enabled,
    );
    if (enabledProfile) {
      return {
        profile: enabledProfile,
        profileId: enabledProfile.id,
        handle: mention.handle,
        taskText: stripMention(input.text, mention),
      };
    }

    firstDisabledMention ??= mention;
  }

  if (firstDisabledMention) {
    throw new AgentProfileResolutionError(
      `Agent profile @${firstDisabledMention.handle} is disabled`,
    );
  }

  throw new AgentProfileResolutionError(
    `No enabled agent profile matched @${firstMention.handle}`,
  );
}

function findMentionMatches(text: string): MentionMatch[] {
  const matches: MentionMatch[] = [];

  for (const match of text.matchAll(HANDLE_MENTION_RE)) {
    const prefix = match[1] || '';
    const rawHandle = match[2] || '';
    const start = (match.index ?? 0) + prefix.length;
    const end = start + rawHandle.length + 1;
    if (isUrlLikeMentionToken(text, start)) continue;
    matches.push({
      handle: normalizeAgentHandle(rawHandle),
      start,
      end,
    });
  }

  return matches;
}

function isUrlLikeMentionToken(text: string, mentionStart: number): boolean {
  let tokenStart = mentionStart;
  while (tokenStart > 0 && !/\s/.test(text[tokenStart - 1])) {
    tokenStart -= 1;
  }

  const prefix = text.slice(tokenStart, mentionStart);
  return (
    /[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(prefix) ||
    /^\W*www\./i.test(prefix) ||
    /^\W*[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d+)?[/#?][^\s@]*$/i.test(prefix)
  );
}

function stripMention(text: string, mention: MentionMatch): string {
  const beforeMention = text.slice(0, mention.start);
  const afterMention = text.slice(mention.end).replace(/^\s*[,;:.!?]+\s*/, ' ');

  return `${beforeMention}${afterMention}`.replace(/[ \t]{2,}/g, ' ').trim();
}
