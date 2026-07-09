import { describe, expect, it, vi } from 'vitest';

import {
  createDiscordChannel,
  normalizeDiscordBotMention,
  splitDiscordText,
} from './discord.js';
import type { ChannelOpts } from './registry.js';

function opts(groups: ChannelOpts['registeredGroups']): ChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: groups,
  };
}

function fakeDiscordClient() {
  const handlers = new Map<string, (...args: any[]) => Promise<void> | void>();
  const textChannel = {
    send: vi.fn(async () => {}),
    sendTyping: vi.fn(async () => {}),
    isTextBased: () => true,
  };
  const client = {
    handlers,
    user: { id: 'BOT123' },
    channels: {
      fetch: vi.fn(async () => textChannel),
    },
    on: vi.fn(
      (name: string, handler: (...args: any[]) => Promise<void> | void) => {
        handlers.set(name, handler);
        return client;
      },
    ),
    login: vi.fn(async () => 'discord-token'),
    destroy: vi.fn(async () => {}),
  };
  return { client, textChannel };
}

describe('DiscordChannel', () => {
  it('owns Discord channel JIDs and reports connection state', async () => {
    const { client } = fakeDiscordClient();
    const channel = createDiscordChannel(
      'discord-token',
      opts(() => ({})),
      () => client,
    );

    expect(channel.name).toBe('discord');
    expect(channel.ownsJid('dc:123')).toBe(true);
    expect(channel.ownsJid('slack:123')).toBe(false);

    await channel.connect();
    await client.handlers.get('ready')?.();

    expect(client.login).toHaveBeenCalledWith('discord-token');
    expect(channel.isConnected()).toBe(true);
    expect(channel.getStatus?.()).toMatchObject({
      name: 'discord',
      connected: true,
      status: 'healthy',
    });

    await channel.disconnect();
    expect(client.destroy).toHaveBeenCalled();
    expect(channel.isConnected()).toBe(false);
  });

  it('stores metadata and delivers registered Discord messages with mention normalization', async () => {
    const { client } = fakeDiscordClient();
    const groups = {
      'dc:123': {
        name: 'Engineering',
        folder: 'discord_engineering',
        trigger: '@NanoCrab',
        added_at: '2026-07-09T00:00:00.000Z',
      },
    };
    const channelOpts = opts(() => groups);
    const channel = createDiscordChannel(
      'discord-token',
      channelOpts,
      () => client,
    );
    await channel.connect();

    await client.handlers.get('messageCreate')?.({
      id: 'm1',
      channelId: '123',
      createdAt: new Date('2026-07-09T15:30:00.123Z'),
      content: '<@BOT123> check this',
      author: {
        id: 'U123',
        bot: false,
        username: 'henrik',
        globalName: 'Henrik',
      },
      guild: { name: 'NanoCrab HQ' },
      channel: { name: 'engineering' },
      attachments: new Map([
        [
          'a1',
          {
            name: 'brief.pdf',
            contentType: 'application/pdf',
            url: 'https://cdn.example/brief.pdf',
          },
        ],
      ]),
      reference: { messageId: 'm0' },
      fetchReference: vi.fn(async () => ({
        id: 'm0',
        content: 'previous context',
        author: { username: 'Laura', globalName: 'Laura' },
      })),
    });

    expect(channelOpts.onChatMetadata).toHaveBeenCalledWith(
      'dc:123',
      '2026-07-09T15:30:00.123Z',
      'NanoCrab HQ #engineering',
      'discord',
      true,
    );
    expect(channelOpts.onMessage).toHaveBeenCalledWith(
      'dc:123',
      expect.objectContaining({
        id: 'm1',
        chat_jid: 'dc:123',
        sender: 'U123',
        sender_name: 'Henrik',
        content:
          '@NanoCrab check this\n[Attachment: brief.pdf (application/pdf)] https://cdn.example/brief.pdf',
        reply_to_message_id: 'm0',
        reply_to_message_content: 'previous context',
        reply_to_sender_name: 'Laura',
      }),
    );
  });

  it('ignores bot messages and unregistered Discord channels', async () => {
    const { client } = fakeDiscordClient();
    const channelOpts = opts(() => ({}));
    const channel = createDiscordChannel(
      'discord-token',
      channelOpts,
      () => client,
    );
    await channel.connect();

    await client.handlers.get('messageCreate')?.({
      id: 'm1',
      channelId: '123',
      createdAt: new Date('2026-07-09T15:30:00.123Z'),
      content: 'ignored bot',
      author: { id: 'BOT', bot: true, username: 'bot' },
      guild: { name: 'NanoCrab HQ' },
      channel: { name: 'engineering' },
      attachments: new Map(),
    });
    await client.handlers.get('messageCreate')?.({
      id: 'm2',
      channelId: '456',
      createdAt: new Date('2026-07-09T15:30:00.123Z'),
      content: 'unregistered',
      author: { id: 'U123', bot: false, username: 'henrik' },
      guild: { name: 'NanoCrab HQ' },
      channel: { name: 'general' },
      attachments: new Map(),
    });

    expect(channelOpts.onMessage).not.toHaveBeenCalled();
    expect(channelOpts.onChatMetadata).toHaveBeenCalledTimes(1);
  });

  it('sends Discord replies in platform-sized chunks and supports typing', async () => {
    const { client, textChannel } = fakeDiscordClient();
    const channel = createDiscordChannel(
      'discord-token',
      opts(() => ({})),
      () => client,
    );

    await channel.connect();
    await channel.sendMessage('dc:123', 'x'.repeat(2001));
    await channel.setTyping?.('dc:123', true);

    expect(textChannel.send).toHaveBeenCalledTimes(2);
    expect(textChannel.send).toHaveBeenNthCalledWith(1, 'x'.repeat(2000));
    expect(textChannel.sendTyping).toHaveBeenCalled();
  });
});

describe('Discord helpers', () => {
  it('normalizes direct bot mentions to the registered group trigger', () => {
    expect(
      normalizeDiscordBotMention('<@BOT123> hello', 'BOT123', '@NanoCrab'),
    ).toBe('@NanoCrab hello');
    expect(
      normalizeDiscordBotMention('<@!BOT123> hello', 'BOT123', '@NanoCrab'),
    ).toBe('@NanoCrab hello');
  });

  it('keeps Discord message chunks within the configured platform limit', () => {
    expect(
      splitDiscordText('x'.repeat(4001)).map((chunk) => chunk.length),
    ).toEqual([2000, 2000, 1]);
  });
});
