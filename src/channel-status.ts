import { Channel, ChannelStatusSnapshot, RegisteredGroup } from './types.js';

export function channelIdForRegisteredGroup(
  jid: string,
  group?: RegisteredGroup & { channel?: string | null },
): string {
  if (group?.channel) return group.channel.toLowerCase();
  const hints = [jid, group?.folder, group?.name]
    .filter((value): value is string => !!value)
    .map((value) => value.toLowerCase());
  if (hints.some((hint) => hint.startsWith('slack:') || hint.includes('slack')))
    return 'slack';
  if (hints.some((hint) => hint.startsWith('dc:') || hint.includes('discord')))
    return 'discord';
  if (hints.some((hint) => hint.startsWith('tg:') || hint.includes('telegram')))
    return 'telegram';
  if (hints.some((hint) => hint.startsWith('sig:') || hint.includes('signal')))
    return 'signal';
  if (hints.some((hint) => hint.startsWith('wa:') || hint.includes('whatsapp')))
    return 'whatsapp';
  return 'whatsapp';
}

export function isChannelEnabledForRegisteredGroups(
  channelName: string,
  groups: Record<string, RegisteredGroup>,
): boolean {
  const channelId = channelName.toLowerCase();
  const matchingGroups = Object.entries(groups).filter(
    ([jid, group]) => channelIdForRegisteredGroup(jid, group) === channelId,
  );

  if (matchingGroups.length === 0) return true;
  return matchingGroups.some(([, group]) => group.enabled !== false);
}

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
