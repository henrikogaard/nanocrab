/**
 * Web channel for NanoCrab.
 * Backs "web:" conversation threads (Chat mode). It performs NO external delivery:
 * the agent reply is persisted and broadcast by the message loop in src/index.ts
 * immediately after channel.sendMessage(); the browser receives it over WebSocket.
 * This channel exists so findChannel() resolves a channel for web: jids.
 */
import { registerChannel, ChannelOpts } from './registry.js';
import { Channel } from '../types.js';
import { isWebJid } from '../web-threads.js';

export function createWebChannel(_opts: ChannelOpts): Channel {
  return {
    name: 'web',
    async connect() {},
    async disconnect() {},
    isConnected() {
      return true;
    },
    ownsJid(jid: string) {
      return isWebJid(jid);
    },
    // No-op: the framework persists + broadcasts the reply. Do not double-write.
    async sendMessage(_jid: string, _text: string) {},
  };
}

registerChannel('web', (opts) => createWebChannel(opts));
