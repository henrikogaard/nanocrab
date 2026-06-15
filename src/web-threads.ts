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
  addedAt: string;
  config?: ContainerConfig;
}

// Build an isolated web-thread group. The folder is derived from the jid id only,
// never from a source agent — isolation is strict. The config is a deep clone so
// the source template is never mutated.
export function buildThreadGroup(input: BuildThreadInput): RegisteredGroup {
  const id = input.jid.startsWith(WEB_PREFIX)
    ? input.jid.slice(WEB_PREFIX.length)
    : input.jid;
  return {
    name: 'Web Conversation',
    title: input.title && input.title.trim() ? input.title.trim() : 'New conversation',
    kind: 'web',
    folder: `web-${id}`,
    trigger: '^',
    added_at: input.addedAt,
    requiresTrigger: false,
    enabled: true,
    containerConfig: input.config
      ? (JSON.parse(JSON.stringify(input.config)) as ContainerConfig)
      : undefined,
  };
}
