import { describe, expect, it } from 'vitest';

import {
  buildChannelStatus,
  channelIdForRegisteredGroup,
  isChannelEnabledForRegisteredGroups,
} from './channel-status.js';
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

describe('channel enabled state from registered groups', () => {
  it('infers a channel id from registered group JIDs', () => {
    expect(channelIdForRegisteredGroup('tg:123')).toBe('telegram');
    expect(channelIdForRegisteredGroup('sig:123')).toBe('signal');
    expect(channelIdForRegisteredGroup('slack:C123')).toBe('slack');
    expect(channelIdForRegisteredGroup('dc:123')).toBe('discord');
    expect(
      channelIdForRegisteredGroup('signal_main', {
        name: 'Henrik Signal',
        folder: 'signal_main',
        trigger: '',
        added_at: '2026-06-13T00:00:00.000Z',
      }),
    ).toBe('signal');
    expect(
      channelIdForRegisteredGroup('folder-only', {
        name: 'Engineering',
        folder: 'slack_engineering',
        trigger: '',
        added_at: '2026-06-13T00:00:00.000Z',
      }),
    ).toBe('slack');
    expect(
      channelIdForRegisteredGroup('folder-only', {
        name: 'General',
        folder: 'discord_general',
        trigger: '',
        added_at: '2026-06-13T00:00:00.000Z',
      }),
    ).toBe('discord');
    expect(channelIdForRegisteredGroup('123@g.us')).toBe('whatsapp');
  });

  it('treats a channel as disabled when all matching bot agents are disabled', () => {
    expect(
      isChannelEnabledForRegisteredGroups('whatsapp', {
        'wa:owner': {
          name: 'Owner',
          folder: 'owner',
          trigger: '',
          added_at: '2026-06-13T00:00:00.000Z',
          enabled: false,
        },
      }),
    ).toBe(false);
  });

  it('keeps a channel enabled when at least one matching bot agent is enabled', () => {
    expect(
      isChannelEnabledForRegisteredGroups('whatsapp', {
        'wa:disabled': {
          name: 'Disabled',
          folder: 'disabled',
          trigger: '',
          added_at: '2026-06-13T00:00:00.000Z',
          enabled: false,
        },
        'wa:enabled': {
          name: 'Enabled',
          folder: 'enabled',
          trigger: '',
          added_at: '2026-06-13T00:00:00.000Z',
        },
      }),
    ).toBe(true);
  });
});
