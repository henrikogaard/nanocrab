import { App } from '@slack/bolt';

import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import type {
  Channel,
  ChannelHealth,
  ChannelStatusSnapshot,
  NewMessage,
} from '../types.js';
import { registerChannel, type ChannelOpts } from './registry.js';

const SLACK_JID_PREFIX = 'slack:';
const SLACK_MESSAGE_LIMIT = 4000;

type SlackEventHandler = (payload: {
  event: any;
  client?: SlackClientLike;
}) => Promise<void>;

interface SlackClientLike {
  auth?: { test?: () => Promise<{ user_id?: string }> };
  chat?: {
    postMessage?: (args: { channel: string; text: string }) => Promise<unknown>;
  };
  conversations?: {
    info?: (args: { channel: string }) => Promise<{
      channel?: {
        id?: string;
        name?: string;
        is_im?: boolean;
        is_group?: boolean;
      };
    }>;
  };
  users?: {
    info?: (args: { user: string }) => Promise<{
      user?: {
        name?: string;
        real_name?: string;
        profile?: { real_name?: string; display_name?: string };
      };
    }>;
  };
}

interface SlackAppLike {
  client: SlackClientLike;
  event(name: 'message', handler: SlackEventHandler): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

type SlackAppFactory = (botToken: string, appToken: string) => SlackAppLike;

function defaultSlackAppFactory(
  botToken: string,
  appToken: string,
): SlackAppLike {
  return new App({
    token: botToken,
    appToken,
    socketMode: true,
  }) as unknown as SlackAppLike;
}

export function splitSlackText(text: string): string[] {
  if (!text) return [''];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += SLACK_MESSAGE_LIMIT) {
    chunks.push(text.slice(index, index + SLACK_MESSAGE_LIMIT));
  }
  return chunks;
}

function slackTsToIso(ts: unknown): string {
  if (typeof ts === 'string') {
    const seconds = Number.parseFloat(ts);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function formatSlackFiles(files: unknown): string[] {
  if (!Array.isArray(files)) return [];
  return files.map((file) => {
    const item = file as {
      name?: string;
      title?: string;
      mimetype?: string;
      filetype?: string;
    };
    const name = item.name || item.title || 'Slack file';
    const type = item.mimetype || item.filetype || 'unknown type';
    return `[File: ${name} (${type})]`;
  });
}

async function slackChannelInfo(
  client: SlackClientLike,
  channel: string,
): Promise<{ name: string | undefined; isGroup: boolean }> {
  try {
    const info = await client.conversations?.info?.({ channel });
    const slackChannel = info?.channel;
    return {
      name: slackChannel?.name,
      isGroup: slackChannel?.is_im === true ? false : true,
    };
  } catch (err) {
    logger.debug({ err, channel }, 'Slack channel metadata lookup failed');
    return { name: undefined, isGroup: true };
  }
}

async function slackUserName(
  client: SlackClientLike,
  user: string,
): Promise<string> {
  try {
    const info = await client.users?.info?.({ user });
    return (
      info?.user?.profile?.real_name ||
      info?.user?.profile?.display_name ||
      info?.user?.real_name ||
      info?.user?.name ||
      user
    );
  } catch (err) {
    logger.debug({ err, user }, 'Slack user metadata lookup failed');
    return user;
  }
}

export class SlackChannel implements Channel {
  name = 'slack';

  private connected = false;
  private lastActiveAt: string | null = null;
  private botUserId: string | null = null;
  private handlersRegistered = false;

  constructor(
    private readonly botToken: string,
    private readonly appToken: string,
    private readonly opts: ChannelOpts,
    private readonly app: SlackAppLike = defaultSlackAppFactory(
      botToken,
      appToken,
    ),
  ) {}

  async connect(): Promise<void> {
    if (!this.handlersRegistered) {
      this.app.event('message', async ({ event, client }) => {
        await this.handleMessage(event, client || this.app.client);
      });
      this.handlersRegistered = true;
    }

    const auth = await this.app.client.auth?.test?.();
    this.botUserId = auth?.user_id || null;
    await this.app.start();
    this.connected = true;
    logger.info('Slack channel connected');
  }

  async disconnect(): Promise<void> {
    await this.app.stop();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(SLACK_JID_PREFIX);
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const channel = jid.replace(SLACK_JID_PREFIX, '');
    if (!channel) throw new Error(`Invalid Slack JID: ${jid}`);
    const postMessage = this.app.client.chat?.postMessage;
    if (!postMessage)
      throw new Error('Slack chat.postMessage API is unavailable');

    for (const chunk of splitSlackText(text)) {
      await postMessage({ channel, text: chunk });
    }
  }

  async setTyping(_jid: string, _isTyping: boolean): Promise<void> {
    // Slack's Web API does not expose a bot typing indicator for Socket Mode apps.
  }

  getStatus(): ChannelStatusSnapshot {
    return {
      name: this.name,
      connected: this.connected,
      status: this.connected ? 'healthy' : 'down',
      lastActiveAt: this.lastActiveAt,
      reason: this.connected
        ? 'Slack Socket Mode adapter connected'
        : 'Slack Socket Mode adapter disconnected',
    };
  }

  getHealth(): ChannelHealth {
    return {
      name: this.name,
      connected: this.connected,
      status: this.connected ? 'active' : 'offline',
      lastActiveAt: this.lastActiveAt,
      detail: this.connected
        ? 'Slack Socket Mode adapter connected'
        : 'Slack Socket Mode adapter disconnected',
    };
  }

  private async handleMessage(
    event: any,
    client: SlackClientLike,
  ): Promise<void> {
    if (!event || typeof event.channel !== 'string') return;
    if (event.bot_id || event.user === this.botUserId) return;
    if (event.subtype && event.subtype !== 'file_share') return;

    const jid = `${SLACK_JID_PREFIX}${event.channel}`;
    const timestamp = slackTsToIso(event.ts);
    const channelInfo = await slackChannelInfo(client, event.channel);
    this.opts.onChatMetadata(
      jid,
      timestamp,
      channelInfo.name,
      'slack',
      channelInfo.isGroup,
    );

    const group = this.opts.registeredGroups()[jid];
    if (!group) {
      logger.debug({ jid }, 'Message from unregistered Slack channel');
      return;
    }

    const text = typeof event.text === 'string' ? event.text.trim() : '';
    const fileLines = formatSlackFiles(event.files);
    const content = [text, ...fileLines].filter(Boolean).join('\n');
    if (!content) return;

    const sender = typeof event.user === 'string' ? event.user : 'unknown';
    const senderName = await slackUserName(client, sender);
    this.lastActiveAt = timestamp;

    const message: NewMessage = {
      id: String(event.ts || Date.now()),
      chat_jid: jid,
      sender,
      sender_name: senderName,
      content,
      timestamp,
      is_from_me: false,
      thread_id:
        typeof event.thread_ts === 'string' ? event.thread_ts : undefined,
    };
    this.opts.onMessage(jid, message);
  }
}

export function createSlackChannel(
  botToken: string,
  appToken: string,
  opts: ChannelOpts,
  appFactory: SlackAppFactory = defaultSlackAppFactory,
): SlackChannel {
  return new SlackChannel(
    botToken,
    appToken,
    opts,
    appFactory(botToken, appToken),
  );
}

registerChannel('slack', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN']);
  const botToken = process.env.SLACK_BOT_TOKEN || envVars.SLACK_BOT_TOKEN || '';
  const appToken = process.env.SLACK_APP_TOKEN || envVars.SLACK_APP_TOKEN || '';
  if (!botToken || !appToken) {
    logger.warn('Slack: SLACK_BOT_TOKEN or SLACK_APP_TOKEN not set');
    return null;
  }
  return createSlackChannel(botToken, appToken, opts);
});
