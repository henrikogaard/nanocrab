import { exec as _exec } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  makeWASocket,
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import type {
  GroupMetadata,
  WAMessageKey,
  WASocket,
  proto as ProtoTypes,
} from '@whiskeysockets/baileys';
// proto is not statically analyzable as a named ESM export from this CJS module
import { createRequire } from 'module';
const { proto } = createRequire(import.meta.url)('@whiskeysockets/baileys') as {
  proto: typeof ProtoTypes;
};

import {
  ASSISTANT_HAS_OWN_NUMBER,
  ASSISTANT_NAME,
  STORE_DIR,
} from '../config.js';
import {
  getLastGroupSync,
  getMessageContentById,
  setLastGroupSync,
  updateChatName,
} from '../db.js';
import { logger } from '../logger.js';
import { auditUploadSend } from '../upload-audit.js';
import pino from 'pino';

// Baileys requires a pino-compatible logger instance
const baileysLogger = pino({ level: 'silent' });
import {
  Channel,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
} from '../types.js';
import { resolveGroupFolderPath } from '../group-folder.js';
import { transcribeAudio } from '../transcription.js';
import { registerChannel, ChannelOpts } from './registry.js';

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface WhatsAppChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class WhatsAppChannel implements Channel {
  name = 'whatsapp';

  private sock!: WASocket;
  private connected = false;
  private lidToPhoneMap: Record<string, string> = {};
  private outgoingQueue: Array<{ jid: string; text: string }> = [];
  private flushing = false;
  private groupSyncTimerStarted = false;
  private groupSyncTimer?: ReturnType<typeof setInterval>;
  /** Cache of recently sent messages for retry requests (max 256 entries). */
  private sentMessageCache = new Map<string, ProtoTypes.IMessage>();
  /** Short-lived cache of phone-normalized group metadata for outbound sends. */
  private groupMetadataCache = new Map<
    string,
    { metadata: GroupMetadata; expiresAt: number }
  >();
  /** Bot's LID user ID (e.g. "80355281346633") for normalizing group mentions. */
  private botLidUser?: string;
  /** Resolve the initial connect() once the first successful open happens. */
  private pendingFirstOpen?: () => void;
  /** Prevent requesting multiple pairing codes per session. */
  private pairingRequested = false;

  private opts: WhatsAppChannelOpts;

  constructor(opts: WhatsAppChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pendingFirstOpen = resolve;
      this.connectInternal().catch(reject);
    });
  }

  private async connectInternal(): Promise<void> {
    const authDir = path.join(STORE_DIR, 'auth');
    fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const { version } = await fetchLatestWaWebVersion({}).catch((err) => {
      logger.warn(
        { err },
        'Failed to fetch latest WA Web version, using default',
      );
      return { version: undefined };
    });
    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      printQRInTerminal: false,
      logger: baileysLogger,
      browser: Browsers.macOS('Chrome'),
      cachedGroupMetadata: async (jid: string) =>
        this.getNormalizedGroupMetadata(jid),
      getMessage: async (key: WAMessageKey) => {
        const cached = this.sentMessageCache.get(key.id || '');
        if (cached) {
          logger.debug(
            { id: key.id },
            'getMessage: returning cached message for retry',
          );
          return cached;
        }
        // Fall back to DB lookup so WhatsApp can re-encrypt on retry.
        // Without this, self-chat messages show "waiting for this message".
        const content =
          key.id && key.remoteJid
            ? getMessageContentById(key.id, key.remoteJid)
            : undefined;
        if (content) {
          logger.debug(
            { id: key.id },
            'getMessage: returning DB message for retry',
          );
          return proto.Message.fromObject({ conversation: content });
        }
        // Return empty message rather than undefined — prevents indefinite
        // "waiting for this message" when we genuinely don't have the content.
        return proto.Message.fromObject({});
      },
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !this.pairingRequested) {
        // Request pairing code instead of QR (easier for headless servers)
        this.pairingRequested = true;
        const phoneNumber = process.env.WHATSAPP_PHONE_NUMBER || '';
        const scheduleQrExit = () => {
          if (this.pendingFirstOpen) {
            this.pendingFirstOpen();
            this.pendingFirstOpen = undefined;
          }
          logger.warn(
            'WhatsApp authentication is required; leaving channel offline until setup completes.',
          );
        };
        if (phoneNumber) {
          this.sock
            .requestPairingCode(phoneNumber.replace(/\+/g, ''))
            .then((code: string) => {
              console.log('\n  ========================================');
              console.log(`  WhatsApp Pairing Code: ${code}`);
              console.log('  ========================================');
              console.log('  Open WhatsApp > Settings > Linked Devices');
              console.log('  > Link a Device > Link with phone number');
              console.log(`  Enter code: ${code}\n`);
              logger.info({ code }, 'WhatsApp pairing code generated');
            })
            .catch((err: any) => {
              logger.error(
                { err: err.message },
                'Failed to request pairing code, showing QR',
              );
              import('qrcode-terminal')
                .then((qrcode) => {
                  console.log(
                    '\n  WhatsApp: Scan this QR code with your phone\n',
                  );
                  (qrcode.default || qrcode).generate(qr, { small: true });
                })
                .catch(() => {
                  console.log(`\n  WhatsApp QR: ${qr}\n`);
                });
              scheduleQrExit();
            });
        } else {
          // No phone number configured — show QR
          scheduleQrExit();
          import('qrcode-terminal')
            .then((qrcode) => {
              console.log('\n  WhatsApp: Scan this QR code with your phone\n');
              (qrcode.default || qrcode).generate(qr, { small: true });
              console.log(
                '\n  Tip: Set WHATSAPP_PHONE_NUMBER in .env for pairing code instead\n',
              );
            })
            .catch(() => {
              console.log(`\n  WhatsApp QR: ${qr}`);
              console.log(
                '  Set WHATSAPP_PHONE_NUMBER in .env for pairing code\n',
              );
            });
        }
      }

      if (connection === 'close') {
        this.connected = false;
        const reason = (
          lastDisconnect?.error as { output?: { statusCode?: number } }
        )?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;
        logger.info(
          {
            reason,
            shouldReconnect,
            queuedMessages: this.outgoingQueue.length,
          },
          'Connection closed',
        );

        if (shouldReconnect) {
          logger.info('Reconnecting...');
          this.connectInternal().catch((err) => {
            logger.error({ err }, 'Failed to reconnect, retrying in 5s');
            setTimeout(() => {
              this.connectInternal().catch((err2) => {
                logger.error({ err: err2 }, 'Reconnection retry failed');
              });
            }, 5000);
          });
        } else {
          logger.info('Logged out. Run /setup to re-authenticate.');
          // Resolve pending connect so startup isn't blocked
          if (this.pendingFirstOpen) {
            this.pendingFirstOpen();
            this.pendingFirstOpen = undefined;
          }
        }
      } else if (connection === 'open') {
        this.connected = true;
        logger.info('Connected to WhatsApp');

        // Don't announce presence — prevents bot showing as "online" or "typing" constantly
        // Typing indicators are sent only during active agent processing

        // Build LID to phone mapping from auth state for self-chat translation
        if (this.sock.user) {
          const phoneUser = this.sock.user.id.split(':')[0];
          const lidUser = this.sock.user.lid?.split(':')[0];
          if (lidUser && phoneUser) {
            this.setLidPhoneMapping(lidUser, `${phoneUser}@s.whatsapp.net`);
            this.botLidUser = lidUser;
            logger.debug({ lidUser, phoneUser }, 'LID to phone mapping set');
          }
        }

        // Flush any messages queued while disconnected
        this.flushOutgoingQueue().catch((err) =>
          logger.error({ err }, 'Failed to flush outgoing queue'),
        );

        // Sync group metadata on startup (respects 24h cache)
        this.syncGroupMetadata().catch((err) =>
          logger.error({ err }, 'Initial group sync failed'),
        );
        // Set up daily sync timer (only once)
        if (!this.groupSyncTimerStarted) {
          this.groupSyncTimerStarted = true;
          this.groupSyncTimer = setInterval(() => {
            this.syncGroupMetadata().catch((err) =>
              logger.error({ err }, 'Periodic group sync failed'),
            );
          }, GROUP_SYNC_INTERVAL_MS);
          this.groupSyncTimer.unref?.();
        }

        // Signal first connection to caller
        if (this.pendingFirstOpen) {
          this.pendingFirstOpen();
          this.pendingFirstOpen = undefined;
        }
      }
    });

    this.sock.ev.on('creds.update', saveCreds);

    // v7: phoneNumberShare event removed — LID resolution happens via
    // signalRepository and senderPn on incoming messages instead

    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        try {
          if (!msg.message) continue;
          // Unwrap container types (viewOnceMessageV2, ephemeralMessage,
          // editedMessage, etc.) so that conversation, extendedTextMessage,
          // imageMessage, etc. are accessible at the top level.
          const normalized = normalizeMessageContent(msg.message);
          if (!normalized) continue;
          const rawJid = msg.key.remoteJid;
          if (!rawJid || rawJid === 'status@broadcast') continue;

          // Translate LID JID to phone JID if applicable.
          // Prefer senderPn from the message key (available in newer WA protocol)
          // since translateJid may fail to resolve LID→phone via signalRepository.
          let chatJid = await this.translateJid(rawJid);
          if (chatJid.endsWith('@lid') && (msg.key as any).senderPn) {
            const pn = (msg.key as any).senderPn as string;
            const phoneJid = pn.includes('@') ? pn : `${pn}@s.whatsapp.net`;
            this.setLidPhoneMapping(
              rawJid.split('@')[0].split(':')[0],
              phoneJid,
            );
            chatJid = phoneJid;
            logger.info(
              { lidJid: rawJid, phoneJid },
              'Translated LID via senderPn',
            );
          }

          const timestamp = new Date(
            Number(msg.messageTimestamp) * 1000,
          ).toISOString();

          // Always notify about chat metadata for group discovery
          const isGroup = chatJid.endsWith('@g.us');
          this.opts.onChatMetadata(
            chatJid,
            timestamp,
            undefined,
            'whatsapp',
            isGroup,
          );

          // Only deliver full message for registered groups
          // Check both translated JID and original LID JID
          const groups = this.opts.registeredGroups();
          const effectiveJid = groups[chatJid]
            ? chatJid
            : groups[rawJid]
              ? rawJid
              : null;
          if (effectiveJid) {
            chatJid = effectiveJid;
            let content =
              normalized.conversation ||
              normalized.extendedTextMessage?.text ||
              normalized.imageMessage?.caption ||
              normalized.videoMessage?.caption ||
              '';

            // Handle voice messages (audioMessage with ptt flag)
            const audioMsg = normalized.audioMessage;
            if (audioMsg && !content) {
              const group = groups[chatJid];
              if (group) {
                try {
                  const stream = await downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    {
                      logger: undefined as any,
                      reuploadRequest: this.sock.updateMediaMessage,
                    },
                  );
                  if (stream && Buffer.isBuffer(stream)) {
                    const attachDir = path.join(
                      resolveGroupFolderPath(group.folder),
                      'attachments',
                    );
                    fs.mkdirSync(attachDir, { recursive: true });
                    const ext = audioMsg.mimetype?.includes('ogg')
                      ? '.ogg'
                      : '.mp3';
                    const filename = `voice_${msg.key.id}${ext}`;
                    const filePath = path.join(attachDir, filename);
                    fs.writeFileSync(filePath, stream);

                    const transcript = await transcribeAudio(filePath);
                    if (transcript) {
                      content = `[Voice: "${transcript}"] (/workspace/group/attachments/${filename})`;
                    } else {
                      content = `[Voice message] (/workspace/group/attachments/${filename})`;
                    }
                  }
                } catch (err) {
                  logger.warn(
                    { err },
                    'Failed to download WhatsApp voice message',
                  );
                  content = '[Voice message]';
                }
              }
            }

            // WhatsApp group mentions use the LID in raw text (e.g. "@80355281346633")
            // instead of the display name. Normalize to @AssistantName for trigger matching.
            if (this.botLidUser && content.includes(`@${this.botLidUser}`)) {
              content = content.replace(
                `@${this.botLidUser}`,
                `@${ASSISTANT_NAME}`,
              );
            }

            // Skip protocol messages with no text content (encryption keys, read receipts, etc.)
            if (!content) continue;

            const sender = msg.key.participant || msg.key.remoteJid || '';
            const senderName = msg.pushName || sender.split('@')[0];

            const fromMe = msg.key.fromMe || false;
            // Detect bot messages: with own number, fromMe is reliable
            // since only the bot sends from that number.
            // With shared number, bot messages carry the assistant name prefix
            // (even in DMs/self-chat) so we check for that.
            const isBotMessage = ASSISTANT_HAS_OWN_NUMBER
              ? fromMe
              : content.startsWith(`${ASSISTANT_NAME}:`);

            this.opts.onMessage(chatJid, {
              id: msg.key.id || '',
              chat_jid: chatJid,
              sender,
              sender_name: senderName,
              content,
              timestamp,
              is_from_me: fromMe,
              is_bot_message: isBotMessage,
            });
          } else if (
            rawJid.endsWith('@lid') ||
            rawJid.endsWith('@s.whatsapp.net')
          ) {
            // JID not found in registered groups
            logger.debug(
              { rawJid, translatedJid: chatJid },
              'Message from unregistered chat',
            );
          }
        } catch (err) {
          logger.error(
            { err, remoteJid: msg.key?.remoteJid },
            'Error processing incoming message',
          );
        }
      }
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    // Prefix bot messages with assistant name so users know who's speaking.
    // On a shared number, prefix is also needed in DMs (including self-chat)
    // to distinguish bot output from user messages.
    // Skip only when the assistant has its own dedicated phone number.
    const prefixed = ASSISTANT_HAS_OWN_NUMBER
      ? text
      : `${ASSISTANT_NAME}: ${text}`;

    if (!this.connected) {
      this.outgoingQueue.push({ jid, text: prefixed });
      logger.info(
        { jid, length: prefixed.length, queueSize: this.outgoingQueue.length },
        'WA disconnected, message queued',
      );
      return;
    }
    try {
      const sent = await this.sock.sendMessage(jid, { text: prefixed });
      // Cache for retry requests (recipient may ask us to re-encrypt)
      if (sent?.key?.id && sent.message) {
        this.sentMessageCache.set(sent.key.id, sent.message);
        if (this.sentMessageCache.size > 256) {
          const oldest = this.sentMessageCache.keys().next().value!;
          this.sentMessageCache.delete(oldest);
        }
      }
      logger.info({ jid, length: prefixed.length }, 'Message sent');
    } catch (err) {
      // If send fails, queue it for retry on reconnect
      this.outgoingQueue.push({ jid, text: prefixed });
      logger.warn(
        { jid, err, queueSize: this.outgoingQueue.length },
        'Failed to send, message queued',
      );
    }
  }

  /** Find a DM JID to fall back to when group send fails. */
  private findDmFallback(groupJid: string): string | undefined {
    const groups = this.opts.registeredGroups();
    // Find any registered non-group JID (DM) that belongs to WhatsApp
    for (const [jid, _group] of Object.entries(groups)) {
      if (jid !== groupJid && !jid.endsWith('@g.us')) return jid;
    }
    return undefined;
  }

  /** Get group display name from registered groups. */
  private getGroupName(jid: string): string {
    const groups = this.opts.registeredGroups();
    return groups[jid]?.name || jid;
  }

  async sendFile(
    jid: string,
    filePath: string,
    filename: string,
    caption?: string,
  ): Promise<void> {
    if (!this.connected) {
      logger.warn({ jid, filePath }, 'Cannot send file while disconnected');
      return;
    }
    if (!fs.existsSync(filePath)) {
      logger.warn({ jid, filePath }, 'File not found for sending');
      return;
    }
    try {
      const buffer = fs.readFileSync(filePath);
      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.csv': 'text/csv',
        '.txt': 'text/plain',
        '.json': 'application/json',
        '.zip': 'application/zip',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.mp4': 'video/mp4',
        '.mp3': 'audio/mpeg',
        '.ogg': 'audio/ogg',
      };
      const ext = path.extname(filename).toLowerCase();
      const mimetype = mimeTypes[ext] || 'application/octet-stream';

      // Send as image, video, audio, or document based on mime type
      await auditUploadSend(
        {
          channel: this.name,
          jid,
          filename,
          filePath,
          mimeType: mimetype,
          sizeBytes: buffer.length,
          caption,
        },
        async () => {
          if (mimetype.startsWith('image/')) {
            await this.sock.sendMessage(jid, {
              image: buffer,
              caption,
              mimetype,
            });
          } else if (mimetype.startsWith('video/')) {
            await this.sock.sendMessage(jid, {
              video: buffer,
              caption,
              mimetype,
            });
          } else if (mimetype.startsWith('audio/')) {
            await this.sock.sendMessage(jid, { audio: buffer, mimetype });
          } else {
            await this.sock.sendMessage(jid, {
              document: buffer,
              mimetype,
              fileName: filename,
              caption,
            });
          }
        },
      );
      logger.info(
        { jid, filename, mimetype, size: buffer.length },
        'File sent',
      );
    } catch (err) {
      logger.warn({ jid, filePath, err }, 'Failed to send file');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return (
      jid.endsWith('@g.us') ||
      jid.endsWith('@s.whatsapp.net') ||
      jid.endsWith('@lid')
    );
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.groupSyncTimer) {
      clearInterval(this.groupSyncTimer);
      this.groupSyncTimer = undefined;
      this.groupSyncTimerStarted = false;
    }
    this.sock?.end(undefined);
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    try {
      const status = isTyping ? 'composing' : 'paused';
      logger.debug({ jid, status }, 'Sending presence update');
      await this.sock.sendPresenceUpdate(status, jid);
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to update typing status');
    }
  }

  async syncGroups(force: boolean): Promise<void> {
    return this.syncGroupMetadata(force);
  }

  /**
   * Sync group metadata from WhatsApp.
   * Fetches all participating groups and stores their names in the database.
   * Called on startup, daily, and on-demand via IPC.
   */
  async syncGroupMetadata(force = false): Promise<void> {
    if (!force) {
      const lastSync = getLastGroupSync();
      if (lastSync) {
        const lastSyncTime = new Date(lastSync).getTime();
        if (Date.now() - lastSyncTime < GROUP_SYNC_INTERVAL_MS) {
          logger.debug({ lastSync }, 'Skipping group sync - synced recently');
          return;
        }
      }
    }

    try {
      logger.info('Syncing group metadata from WhatsApp...');
      const groups = await this.sock.groupFetchAllParticipating();

      let count = 0;
      for (const [jid, metadata] of Object.entries(groups)) {
        if (metadata.subject) {
          updateChatName(jid, metadata.subject);
          count++;
        }
      }

      setLastGroupSync();
      logger.info({ count }, 'Group metadata synced');
    } catch (err) {
      logger.error({ err }, 'Failed to sync group metadata');
    }
  }

  private async translateJid(jid: string): Promise<string> {
    if (!jid.endsWith('@lid')) return jid;
    const lidUser = jid.split('@')[0].split(':')[0];

    // Check local cache first
    const cached = this.lidToPhoneMap[lidUser];
    if (cached) {
      logger.debug(
        { lidJid: jid, phoneJid: cached },
        'Translated LID to phone JID (cached)',
      );
      return cached;
    }

    // Query Baileys' signal repository for the mapping
    try {
      const pn = await (
        this.sock.signalRepository as any
      )?.lidMapping?.getPNForLID(jid);
      if (pn) {
        const phoneJid = `${pn.split('@')[0].split(':')[0]}@s.whatsapp.net`;
        this.setLidPhoneMapping(lidUser, phoneJid);
        logger.info(
          { lidJid: jid, phoneJid },
          'Translated LID to phone JID (signalRepository)',
        );
        return phoneJid;
      }
    } catch (err) {
      logger.debug({ err, jid }, 'Failed to resolve LID via signalRepository');
    }

    return jid;
  }

  private setLidPhoneMapping(lidUser: string, phoneJid: string): void {
    if (this.lidToPhoneMap[lidUser] === phoneJid) return;
    this.lidToPhoneMap[lidUser] = phoneJid;
    // Participant IDs in cached group metadata depend on this mapping.
    this.groupMetadataCache.clear();
  }

  private async getNormalizedGroupMetadata(
    jid: string,
    forceRefresh = false,
  ): Promise<GroupMetadata | undefined> {
    if (!jid.endsWith('@g.us')) return undefined;

    const cached = this.groupMetadataCache.get(jid);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return cached.metadata;
    }

    const metadata = await this.sock.groupMetadata(jid);
    const participants = await Promise.all(
      metadata.participants.map(async (participant) => ({
        ...participant,
        id: await this.translateJid(participant.id),
      })),
    );
    const normalized = { ...metadata, participants };
    const mappedCount = participants.filter(
      (participant, index) =>
        participant.id !== metadata.participants[index]?.id,
    ).length;

    logger.info(
      { jid, participantCount: participants.length, mappedCount },
      'Prepared normalized group metadata for send',
    );

    this.groupMetadataCache.set(jid, {
      metadata: normalized,
      expiresAt: Date.now() + 60_000,
    });
    return normalized;
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.flushing || this.outgoingQueue.length === 0) return;
    this.flushing = true;
    try {
      logger.info(
        { count: this.outgoingQueue.length },
        'Flushing outgoing message queue',
      );
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue.shift()!;
        // Send directly — queued items are already prefixed by sendMessage
        const sent = await this.sock.sendMessage(item.jid, { text: item.text });
        if (sent?.key?.id && sent.message) {
          this.sentMessageCache.set(sent.key.id, sent.message);
        }
        logger.info(
          { jid: item.jid, length: item.text.length },
          'Queued message sent',
        );
      }
    } finally {
      this.flushing = false;
    }
  }
}

registerChannel('whatsapp', (opts: ChannelOpts) => new WhatsAppChannel(opts));
