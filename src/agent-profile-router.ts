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
  const profile = profiles.find(
    (candidate) =>
      normalizeAgentHandle(candidate.handle) === firstMention.handle,
  );

  if (!profile || !profile.enabled) {
    const disabledProfile = profile && !profile.enabled;
    throw new Error(
      disabledProfile
        ? `Agent profile @${firstMention.handle} is disabled`
        : `No enabled agent profile matched @${firstMention.handle}`,
    );
  }

  return {
    profile,
    profileId: profile.id,
    handle: firstMention.handle,
    taskText: stripMention(input.text, firstMention),
  };
}

function findMentionMatches(text: string): MentionMatch[] {
  const matches: MentionMatch[] = [];

  for (const match of text.matchAll(HANDLE_MENTION_RE)) {
    const prefix = match[1] || '';
    const rawHandle = match[2] || '';
    const start = (match.index ?? 0) + prefix.length;
    const end = start + rawHandle.length + 1;
    matches.push({
      handle: normalizeAgentHandle(rawHandle),
      start,
      end,
    });
  }

  return matches;
}

function stripMention(text: string, mention: MentionMatch): string {
  return `${text.slice(0, mention.start)}${text.slice(mention.end)}`
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
