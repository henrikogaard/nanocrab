import { describe, expect, it, vi } from 'vitest';

import { parseControlPlaneCommand } from '../control-plane/commands.js';
import {
  createSlackChannel,
  normalizeSlackBotMention,
  splitSlackText,
} from './slack.js';
import type { ChannelOpts } from './registry.js';

function opts(groups: ChannelOpts['registeredGroups']): ChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: groups,
  };
}

function fakeSlackApp() {
  const handlers = new Map<string, (payload: any) => Promise<void>>();
  const app = {
    handlers,
    client: {
      auth: {
        test: vi.fn(async () => ({ ok: true, user_id: 'UBOT' })),
      },
      chat: {
        postMessage: vi.fn(async () => ({ ok: true })),
      },
      conversations: {
        info: vi.fn(async () => ({
          ok: true,
          channel: { id: 'C123', name: 'engineering', is_im: false },
        })),
      },
      users: {
        info: vi.fn(async () => ({
          ok: true,
          user: { profile: { real_name: 'Henrik', display_name: 'Henrik O' } },
        })),
      },
    },
    event: vi.fn((name: string, handler: (payload: any) => Promise<void>) => {
      handlers.set(name, handler);
    }),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
  return app;
}

describe('SlackChannel', () => {
  it('owns slack JIDs and reports connection state', async () => {
    const app = fakeSlackApp();
    const channel = createSlackChannel(
      'xoxb-token',
      'xapp-token',
      opts(() => ({})),
      () => app,
    );

    expect(channel.name).toBe('slack');
    expect(channel.ownsJid('slack:C123')).toBe(true);
    expect(channel.ownsJid('dc:C123')).toBe(false);

    await channel.connect();
    expect(app.event).toHaveBeenCalledWith('message', expect.any(Function));
    expect(app.start).toHaveBeenCalled();
    expect(channel.isConnected()).toBe(true);
    expect(channel.getStatus?.()).toMatchObject({
      name: 'slack',
      connected: true,
      status: 'healthy',
    });

    await channel.disconnect();
    expect(app.stop).toHaveBeenCalled();
    expect(channel.isConnected()).toBe(false);
  });

  it('stores metadata and delivers registered Slack messages with file placeholders', async () => {
    const app = fakeSlackApp();
    const groups = {
      'slack:C123': {
        name: 'Engineering',
        folder: 'slack_engineering',
        trigger: '@NanoCrab',
        added_at: '2026-07-09T00:00:00.000Z',
      },
    };
    const channelOpts = opts(() => groups);
    const channel = createSlackChannel(
      'xoxb-token',
      'xapp-token',
      channelOpts,
      () => app,
    );

    await channel.connect();
    await app.handlers.get('message')?.({
      event: {
        channel: 'C123',
        ts: '1783611000.123',
        user: 'U123',
        text: 'please review this',
        files: [{ name: 'brief.pdf', mimetype: 'application/pdf' }],
      },
      client: app.client,
    });

    expect(channelOpts.onChatMetadata).toHaveBeenCalledWith(
      'slack:C123',
      '2026-07-09T15:30:00.123Z',
      'engineering',
      'slack',
      true,
    );
    expect(channelOpts.onMessage).toHaveBeenCalledWith(
      'slack:C123',
      expect.objectContaining({
        id: '1783611000.123',
        chat_jid: 'slack:C123',
        sender: 'U123',
        sender_name: 'Henrik',
        content: 'please review this\n[File: brief.pdf (application/pdf)]',
        is_from_me: false,
      }),
    );
  });

  it('ignores unregistered Slack chats after metadata discovery', async () => {
    const app = fakeSlackApp();
    const channelOpts = opts(() => ({}));
    const channel = createSlackChannel(
      'xoxb-token',
      'xapp-token',
      channelOpts,
      () => app,
    );

    await channel.connect();
    await app.handlers.get('message')?.({
      event: {
        channel: 'C999',
        ts: '1783611000.123',
        user: 'U123',
        text: 'unregistered',
      },
      client: app.client,
    });

    expect(channelOpts.onChatMetadata).toHaveBeenCalledWith(
      'slack:C999',
      '2026-07-09T15:30:00.123Z',
      'engineering',
      'slack',
      true,
    );
    expect(channelOpts.onMessage).not.toHaveBeenCalled();
  });

  it('normalizes control-plane command mentions', async () => {
    const app = fakeSlackApp();
    const groups = {
      'slack:C123': {
        name: 'Engineering',
        folder: 'slack_engineering',
        trigger: '@NanoCrab',
        added_at: '2026-07-09T00:00:00.000Z',
      },
    };
    const channelOpts = opts(() => groups);
    const channel = createSlackChannel(
      'xoxb-token',
      'xapp-token',
      channelOpts,
      () => app,
    );

    await channel.connect();
    await app.handlers.get('message')?.({
      event: {
        channel: 'C123',
        ts: '1783611000.123',
        user: 'U123',
        text: '@NanoCrab status #128',
      },
      client: app.client,
    });

    expect(channelOpts.onMessage).toHaveBeenCalledWith(
      'slack:C123',
      expect.objectContaining({ content: '@NanoCrab status #128' }),
    );

    const [, msg] = vi.mocked(channelOpts.onMessage).mock.calls[0];
    const command = parseControlPlaneCommand(msg.content, {
      trigger: '@NanoCrab',
    });
    expect(command).toEqual({
      action: 'status',
      repository: undefined,
      issueNumber: 128,
    });
  });

  it('normalizes native Slack bot mentions for trigger matching', async () => {
    const app = fakeSlackApp();
    const groups = {
      'slack:C123': {
        name: 'Engineering',
        folder: 'slack_engineering',
        trigger: '@NanoCrab',
        added_at: '2026-07-09T00:00:00.000Z',
      },
    };
    const channelOpts = opts(() => groups);
    const channel = createSlackChannel(
      'xoxb-token',
      'xapp-token',
      channelOpts,
      () => app,
    );

    await channel.connect();
    await app.handlers.get('message')?.({
      event: {
        channel: 'C123',
        ts: '1783611000.123',
        user: 'U123',
        text: '<@UBOT|nanocrab> status #128',
      },
      client: app.client,
    });

    expect(channelOpts.onMessage).toHaveBeenCalledWith(
      'slack:C123',
      expect.objectContaining({ content: '@NanoCrab status #128' }),
    );
  });

  it('sends long Slack replies in bounded chunks', async () => {
    const app = fakeSlackApp();
    const channel = createSlackChannel(
      'xoxb-token',
      'xapp-token',
      opts(() => ({})),
      () => app,
    );
    await channel.connect();

    await channel.sendMessage('slack:C123', 'x'.repeat(4100));

    expect(app.client.chat.postMessage).toHaveBeenCalledTimes(2);
    expect(app.client.chat.postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ channel: 'C123', text: 'x'.repeat(4000) }),
    );
  });

  it('preserves Slack thread context for outbound replies', async () => {
    const app = fakeSlackApp();
    const channel = createSlackChannel(
      'xoxb-token',
      'xapp-token',
      opts(() => ({})),
      () => app,
    );
    await channel.connect();

    await channel.sendMessage('slack:C123', 'reply', {
      threadId: '1783611000.123',
    });

    expect(app.client.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'reply',
      thread_ts: '1783611000.123',
    });
  });
});

describe('splitSlackText', () => {
  it('keeps Slack message chunks within the configured platform limit', () => {
    expect(
      splitSlackText('x'.repeat(8001)).map((chunk) => chunk.length),
    ).toEqual([4000, 4000, 1]);
  });
});

describe('normalizeSlackBotMention', () => {
  it('handles bare and display-name Slack mention forms', () => {
    expect(
      normalizeSlackBotMention(
        '<@UBOT> @RepoFixer inspect issue #123',
        'UBOT',
        '@NanoCrab',
      ),
    ).toBe('@NanoCrab @RepoFixer inspect issue #123');
    expect(
      normalizeSlackBotMention(
        '<@OTHER> leave this alone',
        'UBOT',
        '@NanoCrab',
      ),
    ).toBe('<@OTHER> leave this alone');
  });

  it('preserves pasted whitespace after mention replacement', () => {
    expect(
      normalizeSlackBotMention(
        '<@UBOT|nanocrab>\n\t/coding-jobs\n  const value = 1;\n\n  return value;',
        'UBOT',
        '@NanoCrab',
      ),
    ).toBe('@NanoCrab\n\t/coding-jobs\n  const value = 1;\n\n  return value;');
  });
});
