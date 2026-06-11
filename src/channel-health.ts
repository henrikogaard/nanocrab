import type { Channel, ChannelHealth } from './types.js';

export function buildGenericChannelHealth(channel: Channel): ChannelHealth {
  const connected = channel.isConnected();
  return {
    name: channel.name,
    connected,
    status: connected ? 'active' : 'offline',
    lastActiveAt: null,
    detail: connected
      ? 'Channel adapter reports connected.'
      : 'Channel adapter reports disconnected.',
  };
}

export function getChannelHealth(channel: Channel): ChannelHealth {
  return channel.getHealth?.() || buildGenericChannelHealth(channel);
}

export function channelStatusBadge(
  status: ChannelHealth['status'],
): 'healthy' | 'degraded' | 'down' | 'disabled' {
  if (status === 'active') return 'healthy';
  if (status === 'disabled') return 'disabled';
  if (status === 'degraded') return 'degraded';
  return 'down';
}
