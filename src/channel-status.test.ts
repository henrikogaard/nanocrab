import { describe, expect, it } from 'vitest';

import { buildChannelStatus } from './channel-status.js';
import { Channel } from './types.js';

function channel(overrides: Partial<Channel>): Channel {
  return {
    name: 'test',
    connect: async () => {},
    sendMessage: async () => {},
    isConnected: () => false,
    ownsJid: () => false,
    disconnect: async () => {},
    ...overrides,
  };
}

describe('buildChannelStatus', () => {
  it('uses default connected semantics when an adapter has no rich status', () => {
    const status = buildChannelStatus(
      channel({ name: 'telegram', isConnected: () => true }),
    );

    expect(status).toEqual({
      name: 'telegram',
      connected: true,
      status: 'healthy',
      lastActiveAt: null,
      reason: 'telegram adapter reports connected',
    });
  });

  it('preserves adapter-provided diagnostics and last activity', () => {
    const status = buildChannelStatus(
      channel({
        name: 'signal',
        isConnected: () => true,
        getStatus: () => ({
          name: 'signal',
          connected: true,
          status: 'healthy',
          lastActiveAt: '2026-06-13T09:00:00.000Z',
          reason: 'Signal message activity observed',
        }),
      }),
    );

    expect(status.status).toBe('healthy');
    expect(status.connected).toBe(true);
    expect(status.lastActiveAt).toBe('2026-06-13T09:00:00.000Z');
    expect(status.reason).toBe('Signal message activity observed');
  });
});
