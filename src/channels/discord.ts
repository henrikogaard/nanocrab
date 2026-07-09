import { Client, GatewayIntentBits, Partials } from 'discord.js';

import { ASSISTANT_NAME } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import type {
  Channel,
  ChannelHealth,
  ChannelStatusSnapshot,
  NewMessage,
} from '../types.js';
import { registerChannel, type ChannelOpts } from './registry.js';

const DISCORD_JID_PREFIX = 'dc:';
const DISCORD_MESSAGE_LIMIT = 2000;

interface DiscordTextChannelLike {
  name?: string;
  send?: (text: string) => Promise<unknown>;
  sendTyping?: () => Promise<unknown>;
  isTextBased?: () => boolean;
}

interface DiscordClientLike {
  user?: { id?: string } | null;
  channels: {
    fetch: (id: string) => Promise<DiscordTextChannelLike | null>;
  };
  on(event: string, handler: (...args: any[]) => Promise<void> | void): DiscordClientLike;
  login(token: string): Promise<unknown>;
  destroy(): Promise<unknown> | void;
}

type DiscordClientFactory = () => DiscordClientLike;

function defaultDiscordClientFactory(): DiscordClientLike {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  }) as unknown as DiscordClientLike;
}

export function splitDiscordText(text: string): string[] {
  if (!text) return [''];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += DISCORD_MESSAGE_LIMIT) {
    chunks.push(text.slice(index, index + DISCORD_MESSAGE_LIMIT));
  }
  return chunks;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeDiscordBotMention(
  text: string,
  botUserId: string | undefined | null,
  trigger: string,
): string {
  if (!botUserId) return text;
  const mention = new RegExp(`<@!?${escapeRegExp(botUserId)}>`, 'g');
  return text.replace(mention, trigger).replace(/\s+/g, ' ').trim();
}

function discordSenderName(author: any): string {
  return (
    author?.globalName ||
    author?.displayName ||
    author?.username ||
    author?.id ||
    'Unknown'
  );
}

function discordChatName(message: any): string | undefined {
  const channelName = message.channel?.name;
  if (message.guild?.name && channelName) {
    return `${message.guild.name} #${channelName}`;
  }
  if (channelName) return channelName;
  return message.guild?.name || 'Discord DM';
}

function discordAttachments(message: any): string[] {
  const attachments = message.attachments;
  const values =
    typeof attachments?.values === 'function'
      ? Array.from(attachments.values())
      : Array.isArray(attachments)
        ? attachments
        : [];
  return values.map((attachment: any) => {
    const name = attachment.name || attachment.filename || 'Discord attachment';
    const type = attachment.contentType || 'unknown type';
    const url = attachment.url ? ` ${attachment.url}` : '';
    return `[Attachment: ${name} (${type})]${url}`;
  });
}

async function discordReplyContext(message: any): Promise<
  Pick<
    NewMessage,
    'reply_to_message_id' | 'reply_to_message_content' | 'reply_to_sender_name'
  >
> {
  if (!message.reference?.messageId || typeof message.fetchReference !== 'function') {
    return {};
  }
  try {
    const referenced = await message.fetchReference();
    return {
      reply_to_message_id: referenced?.id,
      reply_to_message_content: referenced?.content,
      reply_to_sender_name: discordSenderName(referenced?.author),
    };
  } catch (err) {
    logger.debug({ err, messageId: message.id }, 'Discord reply lookup failed');
    return { reply_to_message_id: message.reference.messageId };
  }
}

export class DiscordChannel implements Channel {
  name = 'discord';

  private connected = false;
  private lastActiveAt: string | null = null;
  private handlersRegistered = false;
  private readonly client: DiscordClientLike;

  constructor(
    private readonly token: string,
    private readonly opts: ChannelOpts,
    clientFactory: DiscordClientFactory = defaultDiscordClientFactory,
  ) {
    this.client = clientFactory();
  }

  async connect(): Promise<void> {
    if (!this.handlersRegistered) {
      this.client.on('ready', () => {
        this.connected = true;
        logger.info('Discord channel connected');
      });
      this.client.on('messageCreate', async (message: any) => {
        await this.handleMessage(message);
      });
      this.client.on('error', (err: unknown) => {
        this.connected = false;
        logger.warn({ err }, 'Discord channel error');
      });
      this.handlersRegistered = true;
    }

    await this.client.login(this.token);
    if (this.client.user?.id) this.connected = true;
  }

  async disconnect(): Promise<void> {
    await this.client.destroy();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(DISCORD_JID_PREFIX);
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const channelId = jid.replace(DISCORD_JID_PREFIX, '');
    if (!channelId) throw new Error(`Invalid Discord JID: ${jid}`);
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || channel.isTextBased?.() === false || !channel.send) {
      throw new Error(`Discord channel is not text-send capable: ${jid}`);
    }
    for (const chunk of splitDiscordText(text)) {
      await channel.send(chunk);
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!isTyping) return;
    const channelId = jid.replace(DISCORD_JID_PREFIX, '');
    if (!channelId) return;
    const channel = await this.client.channels.fetch(channelId);
    await channel?.sendTyping?.();
  }

  getStatus(): ChannelStatusSnapshot {
    return {
      name: this.name,
      connected: this.connected,
      status: this.connected ? 'healthy' : 'down',
      lastActiveAt: this.lastActiveAt,
      reason: this.connected
        ? 'Discord gateway adapter connected'
        : 'Discord gateway adapter disconnected',
    };
  }

  getHealth(): ChannelHealth {
    return {
      name: this.name,
      connected: this.connected,
      status: this.connected ? 'active' : 'offline',
      lastActiveAt: this.lastActiveAt,
      detail: this.connected
        ? 'Discord gateway adapter connected'
        : 'Discord gateway adapter disconnected',
    };
  }

  private async handleMessage(message: any): Promise<void> {
    if (!message || message.author?.bot) return;
    const channelId = message.channelId || message.channel?.id;
    if (!channelId) return;

    const jid = `${DISCORD_JID_PREFIX}${channelId}`;
    const timestamp =
      message.createdAt instanceof Date
        ? message.createdAt.toISOString()
        : new Date().toISOString();
    const isGroup = Boolean(message.guild);
    this.opts.onChatMetadata(
      jid,
      timestamp,
      discordChatName(message),
      'discord',
      isGroup,
    );

    const group = this.opts.registeredGroups()[jid];
    if (!group) {
      logger.debug({ jid }, 'Message from unregistered Discord channel');
      return;
    }

    const trigger = group.trigger || `@${ASSISTANT_NAME}`;
    const contentText = normalizeDiscordBotMention(
      typeof message.content === 'string' ? message.content : '',
      this.client.user?.id,
      trigger,
    );
    const content = [contentText, ...discordAttachments(message)]
      .filter(Boolean)
      .join('\n');
    if (!content) return;

    const replyContext = await discordReplyContext(message);
    this.lastActiveAt = timestamp;
    this.opts.onMessage(jid, {
      id: String(message.id || Date.now()),
      chat_jid: jid,
      sender: String(message.author?.id || 'unknown'),
      sender_name: discordSenderName(message.author),
      content,
      timestamp,
      is_from_me: false,
      ...replyContext,
    });
  }
}

export function createDiscordChannel(
  token: string,
  opts: ChannelOpts,
  clientFactory: DiscordClientFactory = defaultDiscordClientFactory,
): DiscordChannel {
  return new DiscordChannel(token, opts, clientFactory);
}

registerChannel('discord', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['DISCORD_BOT_TOKEN']);
  const token = process.env.DISCORD_BOT_TOKEN || envVars.DISCORD_BOT_TOKEN || '';
  if (!token) {
    logger.warn('Discord: DISCORD_BOT_TOKEN not set');
    return null;
  }
  return createDiscordChannel(token, opts);
});
