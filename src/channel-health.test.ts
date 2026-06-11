import { describe, expect, it, vi } from 'vitest';

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

import { getChannelHealth } from './channel-health.js';
import { SignalChannel } from './channels/signal.js';
import type { Channel } from './types.js';

describe('channel health', () => {
  it('uses generic connected semantics for channels without health details', () => {
    const channel: Channel = {
      name: 'test',
      connect: async () => {},
      sendMessage: async () => {},
      isConnected: () => true,
      ownsJid: () => false,
      disconnect: async () => {},
    };

    expect(getChannelHealth(channel)).toMatchObject({
      name: 'test',
      connected: true,
      status: 'active',
    });
  });

  it('reports a working Signal daemon as active with last-active heartbeat', () => {
    const channel = new SignalChannel('+4712345678', {
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
    });
    (channel as any).connected = true;
    (channel as any).daemon = { pid: 1234, killed: false };
    (channel as any).lastActiveAt = new Date().toISOString();

    expect(channel.getHealth()).toMatchObject({
      name: 'signal',
      connected: true,
      status: 'active',
    });
  });

  it('reports Signal as degraded when heartbeat is stale', () => {
    const channel = new SignalChannel('+4712345678', {
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
    });
    (channel as any).connected = true;
    (channel as any).daemon = { pid: 1234, killed: false };
    (channel as any).lastActiveAt = new Date(Date.now() - 600000).toISOString();

    expect(channel.getHealth()).toMatchObject({
      connected: false,
      status: 'degraded',
    });
  });
});
