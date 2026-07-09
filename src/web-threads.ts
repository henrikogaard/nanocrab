import { randomUUID } from 'crypto';
import type { ContainerConfig, RegisteredGroup } from './types.js';

const WEB_PREFIX = 'web:';

export function isWebJid(jid: string): boolean {
  return typeof jid === 'string' && jid.startsWith(WEB_PREFIX);
}

export function newWebJid(): string {
  return `${WEB_PREFIX}${randomUUID()}`;
}

export interface BuildThreadInput {
  jid: string;
  title?: string;
  chatProjectId?: string;
  addedAt: string;
  config?: ContainerConfig;
}

// Build an isolated web-thread group. The folder is derived from the jid id only,
// never from a source agent — isolation is strict. The config is a deep clone so
// the source template is never mutated.
export function buildThreadGroup(input: BuildThreadInput): RegisteredGroup {
  if (!input.jid.startsWith(WEB_PREFIX)) {
    throw new Error(`buildThreadGroup requires a web: jid, got "${input.jid}"`);
  }
  const id = input.jid.slice(WEB_PREFIX.length);
  const title =
    input.title && input.title.trim() ? input.title.trim() : undefined;
  return {
    name: 'Web Conversation',
    ...(title ? { title } : {}),
    ...(input.chatProjectId ? { chatProjectId: input.chatProjectId } : {}),
    kind: 'web',
    folder: `web-${id}`,
    trigger: '^', // unused: requiresTrigger is false, so every message is processed
    added_at: input.addedAt,
    requiresTrigger: false,
    enabled: true,
    containerConfig: input.config
      ? (JSON.parse(JSON.stringify(input.config)) as ContainerConfig)
      : undefined,
  };
}
