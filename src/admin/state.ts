/**
 * State bridge between NanoCrab internals and the admin dashboard.
 * Populated by index.ts at startup, consumed by admin routes.
 */
import { Channel, RegisteredGroup } from '../types.js';
import { GroupQueue } from '../group-queue.js';

/**
 * Returns only the non-web groups from a registered-groups record.
 * Use this everywhere we need to exclude web-thread groups from channel/health surfaces.
 */
export function nonWebGroups(
  groups: Record<string, RegisteredGroup>,
): Record<string, RegisteredGroup> {
  return Object.fromEntries(
    Object.entries(groups).filter(([, g]) => g.kind !== 'web'),
  );
}

export interface NanoCrabState {
  channels: Channel[];
  registeredGroups: () => Record<string, RegisteredGroup>;
  updateRegisteredGroup?: (jid: string, group: RegisteredGroup) => void;
  queue: GroupQueue;
  sendMessage: (jid: string, text: string) => Promise<void>;
  startTime: number;
}

let state: NanoCrabState | null = null;

export function setState(s: NanoCrabState): void {
  state = s;
}

export function getState(): NanoCrabState {
  if (!state) throw new Error('Admin state not initialized');
  return state;
}
