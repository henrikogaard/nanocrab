/**
 * State bridge between NanoCrab internals and the admin dashboard.
 * Populated by index.ts at startup, consumed by admin routes.
 */
import { Channel, RegisteredGroup } from '../types.js';
import { GroupQueue } from '../group-queue.js';

export interface NanoCrabState {
  channels: Channel[];
  registeredGroups: () => Record<string, RegisteredGroup>;
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
