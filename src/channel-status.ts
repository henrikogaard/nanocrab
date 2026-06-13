import { Channel, ChannelStatusSnapshot } from './types.js';

export function buildChannelStatus(channel: Channel): ChannelStatusSnapshot {
  if (channel.getStatus) {
    const status = channel.getStatus();
    return {
      name: status.name || channel.name,
      connected: !!status.connected,
      status:
        status.status ||
        (status.connected || channel.isConnected() ? 'healthy' : 'down'),
      lastActiveAt: status.lastActiveAt || null,
      reason: status.reason || defaultReason(status.connected, channel.name),
    };
  }

  const connected = channel.isConnected();
  return {
    name: channel.name,
    connected,
    status: connected ? 'healthy' : 'down',
    lastActiveAt: null,
    reason: defaultReason(connected, channel.name),
  };
}

function defaultReason(connected: boolean, channelName: string): string {
  return connected
    ? `${channelName} adapter reports connected`
    : `${channelName} adapter reports disconnected`;
}
