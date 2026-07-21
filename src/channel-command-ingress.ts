import {
  parseCodingCommand,
  type ParsedCodingCommand,
} from './coding-commands.js';

export interface ChannelCommandIngressOptions {
  /** The trigger configured for this registered group. */
  trigger?: string;
  /** Main groups are triggerless by design. */
  isMain?: boolean;
  /** Defaults to false here; the message loop remains the trigger authority. */
  requiresTrigger?: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLeadingMention(text: string): string {
  // Platform adapters normalize their own bot mention to the configured
  // trigger. These additional mentions are optional profile/channel hints.
  return text.replace(
    /^(?:@[A-Za-z0-9_.-]+|<@!?[A-Za-z0-9]+(?:\|[^>]+)?>)(?:\s+|$)/,
    '',
  );
}

function stripConfiguredTrigger(
  text: string,
  trigger: string,
): { text: string; present: boolean } {
  const normalized = trigger.trim();
  if (!normalized) return { text, present: false };
  const match = text.match(
    new RegExp(`^${escapeRegExp(normalized)}(?=$|\\s)`, 'i'),
  );
  if (!match) return { text, present: false };
  return { text: text.slice(match[0].length).trimStart(), present: true };
}

/**
 * Normalize a platform message into the command text consumed by the shared
 * coding-command parser. The configured trigger must be at the beginning;
 * profile mentions immediately after it are discarded as routing hints.
 */
export function normalizeChannelCommandText(
  rawText: string,
  trigger?: string,
  options: Pick<
    ChannelCommandIngressOptions,
    'isMain' | 'requiresTrigger'
  > = {},
): string | null {
  let text = rawText.trim();
  if (!text) return null;

  const triggerRequired =
    options.isMain !== true && options.requiresTrigger === true;
  let triggerPresent = false;
  if (trigger) {
    const stripped = stripConfiguredTrigger(text, trigger);
    text = stripped.text;
    triggerPresent = stripped.present;
  }
  if (triggerRequired && !triggerPresent) return null;

  // Strip a bounded number of leading profile/channel mentions. A loop is
  // used instead of a global replacement so mentions in command arguments are
  // never altered.
  for (;;) {
    const next = stripLeadingMention(text).trimStart();
    if (next === text) break;
    text = next;
  }
  return text || null;
}

export function parseChannelCodingCommand(
  rawText: string,
  options: ChannelCommandIngressOptions = {},
): ParsedCodingCommand | null {
  const text = normalizeChannelCommandText(rawText, options.trigger, options);
  return text ? parseCodingCommand(text) : null;
}
