/**
 * Signal channel for NanoCrab.
 * Uses signal-cli daemon with:
 *   - stdout JSON lines for receiving messages (-o json)
 *   - HTTP JSON-RPC for sending messages (--http)
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
import { transcribeAudio } from '../transcription.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { Channel, NewMessage } from '../types.js';

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
  private opts: ChannelOpts;
  private phoneNumber: string;
  private port: number;
  private connected = false;
  private daemonRestarts = 0;
  private rpcId = 0;
  private lastTimestamps = new Set<number>();
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

    // Always kill any existing daemon — we need our own for stdout reading
    try {
      await this.rpc('version', {});
      logger.info(
        { port: this.port },
        'Signal: killing existing daemon (need our own for stdout)',
      );
      await this.killExistingDaemon();
      await new Promise((r) => setTimeout(r, 2000));
    } catch {
      // No existing daemon — good
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
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      },
    );

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
        this.daemonRestarts = 0;
        this.startMemoryWatchdog();
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
    }
  }

  private async killExistingDaemon(): Promise<void> {
    try {
      const { execSync } = await import('child_process');
      const pids = execSync(`pgrep -f "signal-cli.*daemon.*--http"`, {
        encoding: 'utf-8',
      })
        .trim()
        .split('\n')
        .filter(Boolean);
      for (const pid of pids) {
        try {
          process.kill(parseInt(pid), 'SIGTERM');
        } catch {}
      }
      if (pids.length > 0)
        logger.info({ pids }, 'Killed existing signal-cli daemon(s)');
    } catch {
      // No matching processes
    }
  }

  private startMemoryWatchdog(): void {
    setInterval(() => {
      if (!this.daemon?.pid) return;
      try {
        const { execSync } = require('child_process');
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
      } catch {}
    }, DAEMON_MEMORY_CHECK_INTERVAL);
  }

  private async processMessage(msg: SignalJsonMessage): Promise<void> {
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

    // Resolve sender: phone number if known, else UUID
    const phone = phoneFromEnvelope || this.uuidToPhone.get(uuid) || null;
    const sender = phone || uuid;
    const senderName = envelope.sourceName || sender;
    const isGroup = !!data.groupInfo;

    // Build JID: prefer phone number so replies land in the right thread
    const chatJid = isGroup
      ? `sig:group.${data.groupInfo!.groupId}`
      : `sig:${sender}`;

    // If we only have UUID, try to look up phone via registered groups
    if (!phone && uuid) {
      const groups = this.opts.registeredGroups();
      for (const [jid] of Object.entries(groups)) {
        if (jid.startsWith('sig:+')) {
          // We have a phone-based JID registered — try to resolve this UUID
          this.resolveUuidToPhone(uuid).catch(() => {});
          break;
        }
      }
    }
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
      await this.rpc('send', {
        ...target,
        message: caption || '',
        attachment: [filePath],
      });
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

  ownsJid(jid: string): boolean {
    return jid.startsWith('sig:');
  }

  async disconnect(): Promise<void> {
    this.connected = false;

    if (this.daemon) {
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
      this.daemon = null;
    }

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
