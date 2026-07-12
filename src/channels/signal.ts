/**
 * Signal channel for NanoCrab.
 * Uses signal-cli daemon with:
 *   - HTTP SSE events for receiving messages (--http /api/v1/events)
 *   - HTTP JSON-RPC for sending messages (--http)
 *   - stdout JSON lines as a fallback for older signal-cli behavior (-o json)
 * Requires: signal-cli installed and registered.
 */
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { readEnvFile } from '../env.js';
import { resolveGroupFolderPath } from '../group-folder.js';
import { logger } from '../logger.js';
import { auditUploadSend } from '../upload-audit.js';
import { transcribeAudio } from '../transcription.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  ChannelHealth,
  ChannelStatusSnapshot,
  NewMessage,
} from '../types.js';

const SIGNAL_CLI_PORT = 8080;
const DAEMON_STARTUP_TIMEOUT_MS = 90000;
const MAX_DAEMON_RESTARTS = 10;
const MAX_MESSAGE_LENGTH = 20000;
const DAEMON_MEMORY_CHECK_INTERVAL = 300000; // 5 min
const DAEMON_MAX_MEMORY_MB = 1500; // restart if >1.5GB

interface SignalJsonMessage {
  envelope: {
    source?: string;
    sourceNumber?: string | null;
    sourceUuid?: string;
    sourceName?: string;
    sourceDevice?: number;
    timestamp?: number;
    dataMessage?: {
      timestamp?: number;
      message?: string;
      groupInfo?: { groupId: string; type?: string };
      attachments?: Array<{
        contentType: string;
        filename?: string;
        id: string;
        size?: number;
      }>;
      quote?: {
        id: number;
        author?: string;
        authorNumber?: string;
        text?: string;
      };
    };
    typingMessage?: {
      action: 'STARTED' | 'STOPPED';
      timestamp?: number;
    };
  };
  account?: string;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class SignalChannel implements Channel {
  name = 'signal';

  private daemon: ChildProcess | null = null;
  private ownsDaemon = false;
  private opts: ChannelOpts;
  private phoneNumber: string;
  private port: number;
  private connected = false;
  private lastReadyAt: string | null = null;
  private lastMessageAt: string | null = null;
  private lastError: string | null = null;
  private daemonRestarts = 0;
  private rpcId = 0;
  private lastTimestamps = new Set<number>();
  private eventController: AbortController | null = null;
  // Map UUID → phone number for JID resolution
  private uuidToPhone = new Map<string, string>();

  constructor(phoneNumber: string, opts: ChannelOpts) {
    this.phoneNumber = phoneNumber;
    this.opts = opts;
    this.port =
      parseInt(process.env.SIGNAL_CLI_PORT || '', 10) || SIGNAL_CLI_PORT;
  }

  async connect(): Promise<void> {
    await this.startDaemon();
    this.connected = true;

    // Pre-populate UUID→phone map from contacts
    await this.resolveUuidToPhone('').catch(() => {});

    logger.info({ phone: this.phoneNumber }, 'Connected to Signal');
    console.log(`\n  Signal: ${this.phoneNumber}`);
    console.log(
      `  Register chats with JID format: sig:<uuid> or sig:<phone_number>\n`,
    );
  }

  private async startDaemon(): Promise<void> {
    const signalCliBin = process.env.SIGNAL_CLI_PATH || 'signal-cli';

    try {
      await this.rpc('version', {});
      logger.info({ port: this.port }, 'Signal: reusing existing daemon');
      this.daemon = null;
      this.ownsDaemon = false;
      this.connected = true;
      this.lastReadyAt = new Date().toISOString();
      this.lastError = null;
      this.daemonRestarts = 0;
      this.startEventStream();
      return;
    } catch {
      // No existing daemon; start one below.
    }

    logger.info(
      { phone: this.phoneNumber, port: this.port },
      'Starting signal-cli daemon',
    );

    this.daemon = spawn(
      signalCliBin,
      [
        '-a',
        this.phoneNumber,
        '-o',
        'json',
        'daemon',
        '--http',
        `localhost:${this.port}`,
        '--receive-mode',
        'on-start',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      },
    );
    this.ownsDaemon = true;

    // Read JSON lines from stdout for incoming messages
    if (this.daemon.stdout) {
      const rl = readline.createInterface({ input: this.daemon.stdout });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line) as SignalJsonMessage;
          this.processMessage(msg).catch((err) => {
            logger.error({ err }, 'Error processing Signal message');
          });
        } catch {
          logger.debug(
            { line: line.slice(0, 200) },
            'Non-JSON signal-cli output',
          );
        }
      });
    }

    // Log stderr
    this.daemon.stderr?.on('data', (data: Buffer) => {
      logger.debug({ source: 'signal-cli' }, data.toString().trim());
    });

    // Handle daemon crashes
    this.daemon.on('close', (code) => {
      if (this.connected) {
        logger.warn({ code }, 'signal-cli daemon exited unexpectedly');
        this.daemon = null;
        this.handleDaemonCrash();
      }
    });

    // Wait for HTTP endpoint to be ready
    const startTime = Date.now();
    while (Date.now() - startTime < DAEMON_STARTUP_TIMEOUT_MS) {
      try {
        await this.rpc('version', {});
        logger.info('signal-cli daemon ready');
        this.connected = true;
        this.lastReadyAt = new Date().toISOString();
        this.lastError = null;
        this.daemonRestarts = 0;
        this.startMemoryWatchdog();
        this.startEventStream();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    throw new Error(
      `signal-cli daemon failed to start within ${DAEMON_STARTUP_TIMEOUT_MS / 1000}s`,
    );
  }

  private async handleDaemonCrash(): Promise<void> {
    if (this.daemonRestarts >= MAX_DAEMON_RESTARTS) {
      logger.error('signal-cli daemon exceeded max restarts, giving up');
      this.connected = false;
      this.lastError = 'signal-cli daemon exceeded max restarts';
      return;
    }

    this.daemonRestarts++;
    const delay = Math.min(2000 * Math.pow(2, this.daemonRestarts - 1), 300000); // cap at 5 minutes
    logger.info(
      { attempt: this.daemonRestarts, delayMs: delay },
      'Restarting signal-cli daemon',
    );

    await new Promise((r) => setTimeout(r, delay));

    try {
      await this.startDaemon();
      logger.info('signal-cli daemon restarted successfully');
    } catch (err) {
      logger.error({ err }, 'Failed to restart signal-cli daemon');
      this.connected = false;
      this.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  private startMemoryWatchdog(): void {
    setInterval(async () => {
      if (!this.daemon?.pid) return;
      try {
        const { execSync } = await import('child_process');
        const rss = execSync(`ps -o rss= -p ${this.daemon.pid}`, {
          encoding: 'utf-8',
        }).trim();
        const memMb = parseInt(rss) / 1024;
        if (memMb > DAEMON_MAX_MEMORY_MB) {
          logger.warn(
            { memMb: Math.round(memMb), pid: this.daemon.pid },
            'signal-cli daemon memory too high, restarting',
          );
          this.daemon.kill('SIGTERM');
          // handleDaemonCrash will restart it
        }
      } catch {
        // intentional
      }
    }, DAEMON_MEMORY_CHECK_INTERVAL);
  }

  private startEventStream(): void {
    this.eventController?.abort();
    const controller = new AbortController();
    this.eventController = controller;
    void this.consumeEventStream(controller);
  }

  private async consumeEventStream(controller: AbortController): Promise<void> {
    while (!controller.signal.aborted) {
      try {
        const res = await fetch(`http://localhost:${this.port}/api/v1/events`, {
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`signal-cli events endpoint returned ${res.status}`);
        }

        this.lastReadyAt = new Date().toISOString();
        let buffer = '';
        const decoder = new TextDecoder();
        const reader = res.body.getReader();

        for (;;) {
          const { done, value } = await reader.read();
          if (done || controller.signal.aborted) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = this.processEventBuffer(buffer);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        this.lastError = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, 'Signal event stream disconnected');
      }

      if (!controller.signal.aborted) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  private processEventBuffer(buffer: string): string {
    let remaining = buffer;
    for (;;) {
      const splitIndex = remaining.search(/\r?\n\r?\n/);
      if (splitIndex === -1) return remaining;

      const rawEvent = remaining.slice(0, splitIndex);
      const separatorLength = remaining[splitIndex] === '\r' ? 4 : 2;
      remaining = remaining.slice(splitIndex + separatorLength);

      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');

      if (!data) continue;

      try {
        this.processSignalEvent(JSON.parse(data));
      } catch (err) {
        logger.debug({ err, data: data.slice(0, 200) }, 'Invalid Signal event');
      }
    }
  }

  private processSignalEvent(event: unknown): void {
    const message = unwrapSignalEvent(event);
    if (!message) return;

    this.processMessage(message).catch((err) => {
      logger.error({ err }, 'Error processing Signal event');
    });
  }

  private async processMessage(msg: SignalJsonMessage): Promise<void> {
    this.lastMessageAt = new Date().toISOString();
    const envelope = msg.envelope;
    const data = envelope.dataMessage;
    if (!data) return; // typing indicator, receipt, etc.

    // Deduplicate by timestamp
    const ts = data.timestamp || envelope.timestamp;
    if (!ts || this.lastTimestamps.has(ts)) return;
    this.lastTimestamps.add(ts);
    // Keep set bounded
    if (this.lastTimestamps.size > 500) {
      const arr = [...this.lastTimestamps];
      this.lastTimestamps = new Set(arr.slice(-250));
    }

    // Sender: prefer sourceNumber, fall back to UUID
    const uuid = envelope.sourceUuid || envelope.source || '';
    const phoneFromEnvelope = envelope.sourceNumber || null;

    // Update UUID→phone mapping if we learn a new one
    if (phoneFromEnvelope && uuid) {
      this.uuidToPhone.set(uuid, phoneFromEnvelope);
    }

    const isGroup = !!data.groupInfo;
    const groups = this.opts.registeredGroups();

    // Resolve sender: phone number if known, else UUID. Direct messages from
    // signal-cli can arrive UUID-only; existing registrations are commonly
    // phone-based, so resolve before choosing the chat JID.
    let phone = phoneFromEnvelope || this.uuidToPhone.get(uuid) || null;
    if (!phone && uuid && !isGroup && hasPhoneBasedSignalGroup(groups)) {
      phone = await this.resolveUuidToPhone(uuid);
    }
    const sender = phone || uuid;
    const senderName = envelope.sourceName || sender;

    // Build JID: prefer phone number so replies land in the right thread
    const chatJid = isGroup
      ? `sig:group.${data.groupInfo!.groupId}`
      : `sig:${sender}`;

    const timestamp = new Date(ts).toISOString();
    const msgId = ts.toString();

    // Build content
    let content = data.message || '';

    // Handle attachments
    if (data.attachments?.length) {
      const group = this.opts.registeredGroups()[chatJid];
      if (group) {
        for (const att of data.attachments) {
          const downloaded = await this.downloadAttachment(att, group.folder);
          if (downloaded) {
            if (att.contentType.startsWith('audio/')) {
              const transcript = await transcribeAudio(downloaded.hostPath);
              if (transcript) {
                content += ` [Voice: "${transcript}"] (${downloaded.containerPath})`;
              } else {
                content += ` [Audio] (${downloaded.containerPath})`;
              }
            } else {
              const type = att.contentType.startsWith('image/')
                ? 'Photo'
                : att.contentType.startsWith('video/')
                  ? 'Video'
                  : 'File';
              content += ` [${type}] (${downloaded.containerPath})`;
            }
          } else {
            content += ` [Attachment: ${att.filename || att.contentType}]`;
          }
        }
      }
    }

    if (!content.trim()) return;

    // Chat metadata
    this.opts.onChatMetadata(chatJid, timestamp, senderName, 'signal', isGroup);

    // Only deliver for registered groups
    const group = this.opts.registeredGroups()[chatJid];
    if (!group) {
      logger.debug(
        { chatJid, senderName },
        'Message from unregistered Signal chat',
      );
      return;
    }

    // Translate @mentions in groups
    if (
      isGroup &&
      content.toLowerCase().includes(`@${ASSISTANT_NAME.toLowerCase()}`) &&
      !TRIGGER_PATTERN.test(content)
    ) {
      content = `@${ASSISTANT_NAME} ${content}`;
    }

    // Reply context
    const replyToMessageId = data.quote?.id?.toString();
    const replyToContent = data.quote?.text;
    const replyToSenderName = data.quote?.authorNumber || data.quote?.author;

    const msg2: NewMessage = {
      id: msgId,
      chat_jid: chatJid,
      sender,
      sender_name: senderName,
      content,
      timestamp,
      is_from_me: sender === this.phoneNumber,
      reply_to_message_id: replyToMessageId,
      reply_to_message_content: replyToContent,
      reply_to_sender_name: replyToSenderName,
    };

    this.opts.onMessage(chatJid, msg2);
    logger.info({ chatJid, sender: senderName }, 'Signal message stored');
  }

  private async downloadAttachment(
    att: { contentType: string; filename?: string; id: string },
    groupFolder: string,
  ): Promise<{ containerPath: string; hostPath: string } | null> {
    try {
      const signalDataDir =
        process.env.SIGNAL_CLI_DATA_DIR ||
        path.join(
          process.env.HOME || '/root',
          '.local',
          'share',
          'signal-cli',
          'attachments',
        );
      const sourcePath = path.join(signalDataDir, att.id);

      if (!fs.existsSync(sourcePath)) {
        logger.warn(
          { attachmentId: att.id },
          'Signal attachment file not found',
        );
        return null;
      }

      const groupDir = resolveGroupFolderPath(groupFolder);
      const attachDir = path.join(groupDir, 'attachments');
      fs.mkdirSync(attachDir, { recursive: true });

      const ext =
        path.extname(att.filename || '') || mimeToExt(att.contentType) || '';
      const filename = att.filename
        ? att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
        : `attachment_${att.id}${ext}`;
      const destPath = path.join(attachDir, filename);

      fs.copyFileSync(sourcePath, destPath);
      logger.info(
        { attachmentId: att.id, dest: destPath },
        'Signal attachment saved',
      );

      return {
        containerPath: `/workspace/group/attachments/${filename}`,
        hostPath: destPath,
      };
    } catch (err) {
      logger.error(
        { err, attachmentId: att.id },
        'Failed to download Signal attachment',
      );
      return null;
    }
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.connected) {
      logger.warn('Signal not connected');
      return;
    }

    try {
      const target = this.parseRecipient(jid);

      if (text.length <= MAX_MESSAGE_LENGTH) {
        await this.rpc('send', { ...target, message: text });
      } else {
        for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
          await this.rpc('send', {
            ...target,
            message: text.slice(i, i + MAX_MESSAGE_LENGTH),
          });
        }
      }

      logger.info({ jid, length: text.length }, 'Signal message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Signal message');
    }
  }

  async sendFile(
    jid: string,
    filePath: string,
    filename: string,
    caption?: string,
  ): Promise<void> {
    if (!this.connected) {
      logger.warn('Signal not connected');
      return;
    }

    if (!fs.existsSync(filePath)) {
      logger.warn({ jid, filePath }, 'File not found for sending');
      return;
    }

    try {
      const target = this.parseRecipient(jid);
      const stat = fs.statSync(filePath);
      await auditUploadSend(
        {
          channel: this.name,
          jid,
          filename,
          filePath,
          sizeBytes: stat.size,
          caption,
        },
        () =>
          this.rpc('send', {
            ...target,
            message: caption || '',
            attachment: [filePath],
          }),
      );
      logger.info({ jid, filePath, filename }, 'Signal file sent');
    } catch (err) {
      logger.error({ jid, filePath, err }, 'Failed to send Signal file');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.connected) return;
    try {
      const target = this.parseRecipient(jid);
      await this.rpc('sendTyping', {
        ...target,
        stop: !isTyping,
      });
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Signal typing indicator');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStatus(): ChannelStatusSnapshot {
    const lastActiveAt = maxIso(this.lastMessageAt, this.lastReadyAt);
    return {
      name: this.name,
      connected: this.connected,
      status: this.connected ? 'healthy' : 'down',
      lastActiveAt,
      reason: this.connected
        ? lastActiveAt === this.lastMessageAt
          ? 'Signal message activity observed'
          : 'signal-cli RPC endpoint is ready'
        : this.lastError || 'signal-cli daemon is not connected',
    };
  }

  getHealth(): ChannelHealth {
    const lastActiveAt =
      (this as unknown as { lastActiveAt?: string }).lastActiveAt ||
      maxIso(this.lastMessageAt, this.lastReadyAt);
    const stale =
      lastActiveAt !== null && Date.now() - Date.parse(lastActiveAt) > 300000;
    const active = this.connected && !stale;
    return {
      name: this.name,
      connected: active,
      status: active ? 'active' : this.connected ? 'degraded' : 'offline',
      lastActiveAt,
      detail: active
        ? 'signal-cli daemon is connected and recently active.'
        : this.connected
          ? 'signal-cli daemon is connected but heartbeat is stale.'
          : this.lastError || 'signal-cli daemon is not connected.',
      diagnostics: {
        daemonPid:
          (this as unknown as { daemon?: { pid?: number } }).daemon?.pid ||
          null,
      },
    };
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('sig:');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.lastError = 'Signal channel disconnected';
    this.eventController?.abort();
    this.eventController = null;

    if (this.daemon && this.ownsDaemon) {
      this.daemon.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (this.daemon) {
            this.daemon.kill('SIGKILL');
          }
          resolve();
        }, 5000);
        this.daemon!.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.daemon = null;
    this.ownsDaemon = false;

    logger.info('Signal channel stopped');
  }

  // --- Helpers ---

  /**
   * Try to resolve a UUID to a phone number via signal-cli contacts.
   */
  private async resolveUuidToPhone(uuid: string): Promise<string | null> {
    if (this.uuidToPhone.has(uuid)) return this.uuidToPhone.get(uuid)!;
    try {
      const contacts = (await this.rpc('listContacts', {})) as Array<{
        uuid?: string;
        number?: string | null;
      }>;
      for (const c of contacts) {
        if (c.uuid && c.number) {
          this.uuidToPhone.set(c.uuid, c.number);
        }
      }
      return this.uuidToPhone.get(uuid) || null;
    } catch {
      return null;
    }
  }

  private parseRecipient(jid: string): Record<string, unknown> {
    const stripped = jid.replace(/^sig:/, '');
    if (stripped.startsWith('group.')) {
      return { groupId: stripped.slice('group.'.length) };
    }
    return { recipient: [stripped] };
  }

  private async rpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const id = ++this.rpcId;
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id });

    const res = await fetch(`http://localhost:${this.port}/api/v1/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10000),
    });

    const json = (await res.json()) as JsonRpcResponse;
    if (json.error) {
      throw new Error(
        `signal-cli RPC error (${json.error.code}): ${json.error.message}`,
      );
    }
    return json.result;
  }
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function unwrapSignalEvent(event: unknown): SignalJsonMessage | null {
  if (!isRecord(event)) return null;
  if (isRecord(event.envelope)) return event as unknown as SignalJsonMessage;

  const params = event.params;
  if (!isRecord(params)) return null;
  if (isRecord(params.envelope)) return params as unknown as SignalJsonMessage;

  const result = params.result;
  if (isRecord(result) && isRecord(result.envelope)) {
    return result as unknown as SignalJsonMessage;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasPhoneBasedSignalGroup(groups: Record<string, unknown>): boolean {
  return Object.keys(groups).some((jid) => jid.startsWith('sig:+'));
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/aac': '.aac',
    'application/pdf': '.pdf',
  };
  return map[mime] || '';
}

// --- Self-registration ---

registerChannel('signal', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['SIGNAL_PHONE_NUMBER']);
  const phone =
    process.env.SIGNAL_PHONE_NUMBER || envVars.SIGNAL_PHONE_NUMBER || '';
  if (!phone) {
    return null;
  }
  return new SignalChannel(phone, opts);
});
