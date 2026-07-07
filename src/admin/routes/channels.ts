import { Router, Request, Response } from 'express';
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { getState, nonWebGroups } from '../state.js';
import { readEnvFile } from '../../env.js';
import {
  buildChannelStatus,
  isChannelEnabledForRegisteredGroups,
} from '../../channel-status.js';
import { getCoworkProjects, getWebThreads } from '../../db.js';
import { requireRole } from '../middleware.js';
import { logger } from '../../logger.js';
import {
  resolveWorkspaceIntent,
  type WorkspaceIntentProject,
  type WorkspaceIntentThread,
} from '../../workspace-intent.js';

const router = Router();
const WHATSAPP_QR_TTL_MS = 60_000;

let whatsappPairingProc: ChildProcess | null = null;
let whatsappPairingStartedAt: string | null = null;
let whatsappPairingError: string | null = null;

/** Mask a sensitive value: show first 4 + ... + last 4 chars */
function mask(value: string): string {
  if (!value) return '';
  if (value.length <= 12) return value.slice(0, 4) + '...';
  return value.slice(0, 4) + '...' + value.slice(-4);
}

function storePath(...parts: string[]): string {
  return path.join(process.cwd(), 'store', ...parts);
}

function readTextSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function whatsappCredentialsExist(): boolean {
  return fs.existsSync(storePath('auth', 'creds.json'));
}

function readWhatsAppAuthStatus(): {
  state: string;
  error: string | null;
  pairingCode: string | null;
} {
  if (whatsappCredentialsExist()) {
    return { state: 'paired', error: null, pairingCode: null };
  }

  const content = readTextSafe(storePath('auth-status.txt'));
  const pairingCode = readTextSafe(storePath('pairing-code.txt')) || null;
  if (!content) {
    return {
      state: whatsappPairingProc ? 'starting' : 'not_configured',
      error: whatsappPairingError,
      pairingCode,
    };
  }
  if (content === 'authenticated' || content === 'already_authenticated') {
    return { state: 'paired', error: null, pairingCode };
  }
  if (content.startsWith('pairing_code:')) {
    return {
      state: 'waiting_for_pairing_code',
      error: null,
      pairingCode: content.replace('pairing_code:', '') || pairingCode,
    };
  }
  if (content.startsWith('failed:')) {
    return {
      state: 'error',
      error: content.replace('failed:', '') || 'unknown',
      pairingCode,
    };
  }
  return { state: content, error: whatsappPairingError, pairingCode };
}

async function readWhatsAppQr(): Promise<{
  qrCode: string | null;
  qrExpiresAt: string | null;
  qrExpired: boolean;
}> {
  const qrPath = storePath('qr-data.txt');
  if (!fs.existsSync(qrPath)) {
    return { qrCode: null, qrExpiresAt: null, qrExpired: false };
  }
  const stat = fs.statSync(qrPath);
  const qrExpiresAt = new Date(stat.mtimeMs + WHATSAPP_QR_TTL_MS).toISOString();
  const qrExpired = Date.now() > stat.mtimeMs + WHATSAPP_QR_TTL_MS;
  const qrData = readTextSafe(qrPath);
  if (!qrData || qrExpired) {
    return { qrCode: null, qrExpiresAt, qrExpired };
  }
  return {
    qrCode: await QRCode.toDataURL(qrData, { margin: 1, width: 280 }),
    qrExpiresAt,
    qrExpired,
  };
}

function stopWhatsAppPairingProcess(): void {
  if (!whatsappPairingProc) return;
  try {
    whatsappPairingProc.kill('SIGTERM');
  } catch {
    // Process may have already exited.
  }
  whatsappPairingProc = null;
}

function startWhatsAppPairing(method: string, phone?: string): void {
  stopWhatsAppPairingProcess();
  whatsappPairingError = null;
  whatsappPairingStartedAt = new Date().toISOString();

  fs.mkdirSync(storePath(), { recursive: true });
  for (const file of ['qr-data.txt', 'auth-status.txt', 'pairing-code.txt']) {
    try {
      fs.unlinkSync(storePath(file));
    } catch {
      // Missing stale state is fine.
    }
  }

  const args =
    method === 'pairing-code'
      ? [
          'tsx',
          'src/whatsapp-auth.ts',
          '--pairing-code',
          '--phone',
          phone || '',
        ]
      : ['tsx', 'src/whatsapp-auth.ts'];
  whatsappPairingProc = spawn('npx', args, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logFile = path.join(process.cwd(), 'logs', 'whatsapp-pairing.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  whatsappPairingProc.stdout?.pipe(logStream);
  whatsappPairingProc.stderr?.pipe(logStream);

  whatsappPairingProc.on('error', (err) => {
    whatsappPairingError = err.message;
    logger.error({ err }, 'WhatsApp dashboard pairing failed to start');
  });
  whatsappPairingProc.on('exit', (code) => {
    if (code && code !== 0) {
      whatsappPairingError ||= `auth process exited with code ${code}`;
    }
    whatsappPairingProc = null;
    logStream.end();
  });
}

/** All supported channels with their env requirements */
const SUPPORTED_CHANNELS = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: 'WA',
    skill: '/add-whatsapp',
    envVars: [],
    description:
      'WhatsApp via Baileys. Authenticates with QR code or pairing code (credentials in store/auth/).',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    icon: 'TG',
    skill: '/add-telegram',
    envVars: ['TELEGRAM_BOT_TOKEN'],
    description:
      'Telegram Bot API. Create a bot via @BotFather and paste the token.',
  },
  {
    id: 'signal',
    name: 'Signal',
    icon: 'SG',
    skill: '/add-signal',
    envVars: ['SIGNAL_PHONE_NUMBER'],
    description:
      'Signal via signal-cli daemon. Requires a registered phone number.',
  },
  {
    id: 'discord',
    name: 'Discord',
    icon: 'DC',
    skill: '/add-discord',
    envVars: ['DISCORD_BOT_TOKEN'],
    description:
      'Discord bot integration. Create a bot at discord.com/developers.',
  },
  {
    id: 'slack',
    name: 'Slack',
    icon: 'SL',
    skill: '/add-slack',
    envVars: ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'],
    description: 'Slack integration via Socket Mode. No public URL needed.',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    icon: 'GM',
    skill: '/add-gmail',
    envVars: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET'],
    description: 'Gmail as a channel or tool. Requires GCP OAuth credentials.',
  },
];

function channelIntentProjects(bodyProjects: unknown): WorkspaceIntentProject[] {
  if (Array.isArray(bodyProjects)) {
    return bodyProjects
      .filter((project): project is Record<string, unknown> =>
        Boolean(project) && typeof project === 'object',
      )
      .map((project) => ({
        id: String(project.id || ''),
        name: String(project.name || ''),
        slug:
          typeof project.slug === 'string' && project.slug.trim()
            ? project.slug
            : null,
      }))
      .filter((project) => project.id && project.name);
  }
  return getCoworkProjects().map((project) => ({
    id: project.id,
    name: project.name,
    slug: project.slug,
  }));
}

function channelIntentThreads(bodyThreads: unknown): WorkspaceIntentThread[] {
  if (Array.isArray(bodyThreads)) {
    return bodyThreads
      .filter((thread): thread is Record<string, unknown> =>
        Boolean(thread) && typeof thread === 'object',
      )
      .map((thread) => ({
        id: String(thread.id || ''),
        title: String(thread.title || ''),
        projectId:
          typeof thread.projectId === 'string' && thread.projectId.trim()
            ? thread.projectId
            : null,
      }))
      .filter((thread) => thread.id && thread.title);
  }
  return Object.entries(getWebThreads()).map(([id, group]) => ({
    id,
    title: group.title || group.name || 'Conversation',
    projectId: group.projectId || null,
  }));
}

router.post('/intent/resolve', (req: Request, res: Response) => {
  const prompt =
    typeof req.body?.prompt === 'string' && req.body.prompt.trim()
      ? req.body.prompt.trim()
      : '';
  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }
  try {
    const intent = resolveWorkspaceIntent({
      prompt,
      channel:
        typeof req.body?.channel === 'string' ? req.body.channel : undefined,
      projects: channelIntentProjects(req.body?.projects),
      threads: channelIntentThreads(req.body?.threads),
    });
    res.json({ intent });
  } catch (err) {
    logger.error({ err }, 'Failed to resolve channel workspace intent');
    res.status(500).json({ error: 'Failed to resolve workspace intent' });
  }
});

router.get('/', (_req: Request, res: Response) => {
  const state = getState();

  // Read all channel-related env vars
  const allEnvKeys = SUPPORTED_CHANNELS.flatMap((ch) => ch.envVars);
  const envValues = readEnvFile(allEnvKeys);

  // Build active channels with status and config
  const groups = nonWebGroups(state.registeredGroups());
  const activeChannels = state.channels.map((ch) => {
    const def = SUPPORTED_CHANNELS.find((s) => s.id === ch.name.toLowerCase());
    const health = buildChannelStatus(ch);
    const enabled = isChannelEnabledForRegisteredGroups(ch.name, groups);
    const config: Record<string, string> = {};

    if (def) {
      for (const key of def.envVars) {
        const val = envValues[key] || process.env[key] || '';
        config[key] = val ? mask(val) : '';
      }
    }

    // WhatsApp: show phone from creds file instead of env var
    if (ch.name.toLowerCase() === 'whatsapp') {
      try {
        const creds = JSON.parse(
          fs.readFileSync(
            path.join(process.cwd(), 'store', 'auth', 'creds.json'),
            'utf-8',
          ),
        );
        const phone = creds.me?.id?.split(':')[0]?.split('@')[0] || '';
        if (phone) config['Phone'] = phone;
      } catch {
        /* no creds */
      }
    }

    // Signal: show phone from env
    if (ch.name.toLowerCase() === 'signal') {
      const phone =
        envValues['SIGNAL_PHONE_NUMBER'] ||
        process.env.SIGNAL_PHONE_NUMBER ||
        '';
      if (phone) config['Phone'] = phone;
    }

    return {
      name: ch.name,
      id: ch.name.toLowerCase(),
      enabled,
      connected: enabled && health.connected,
      status: enabled ? health.status : 'disabled',
      lastActiveAt: health.lastActiveAt,
      statusReason: enabled
        ? health.reason
        : 'All bot agents for this channel are disabled',
      config,
      envVars: def?.envVars || [],
      description: def?.description || '',
      icon: def?.icon || ch.name.slice(0, 2).toUpperCase(),
    };
  });

  // Build available (not active) channels
  const activeIds = new Set(activeChannels.map((c) => c.id));
  const availableChannels = SUPPORTED_CHANNELS.filter(
    (s) => !activeIds.has(s.id),
  ).map((s) => {
    const config: Record<string, string> = {};
    for (const key of s.envVars) {
      const val = envValues[key] || process.env[key] || '';
      config[key] = val ? mask(val) : '';
    }
    return {
      ...s,
      configured: s.envVars.some((k) => !!(envValues[k] || process.env[k])),
      config,
    };
  });

  res.json({ active: activeChannels, available: availableChannels });
});

router.get('/whatsapp/pairing', async (_req: Request, res: Response) => {
  const auth = readWhatsAppAuthStatus();
  const qr = await readWhatsAppQr();
  const whatsappChannel = getState().channels.find(
    (ch) => ch.name.toLowerCase() === 'whatsapp',
  );
  const health = whatsappChannel ? buildChannelStatus(whatsappChannel) : null;

  const state =
    health?.connected === true
      ? 'connected'
      : qr.qrCode
        ? 'waiting_for_qr_scan'
        : qr.qrExpired
          ? 'expired_qr'
          : auth.state;

  res.json({
    state,
    method: readTextSafe(storePath('pairing-code.txt')) ? 'pairing-code' : 'qr',
    connected: health?.connected === true,
    configured: whatsappCredentialsExist(),
    startedAt: whatsappPairingStartedAt,
    qrCode: qr.qrCode,
    qrExpiresAt: qr.qrExpiresAt,
    qrExpired: qr.qrExpired,
    pairingCode: auth.pairingCode,
    error: auth.error || whatsappPairingError,
    statusReason: health?.reason || null,
  });
});

router.post(
  '/whatsapp/pairing/start',
  requireRole('owner'),
  (req: Request, res: Response) => {
    const method = req.body?.method === 'pairing-code' ? 'pairing-code' : 'qr';
    const phone = String(req.body?.phone || '').replace(/\D/g, '');
    if (method === 'pairing-code' && !phone) {
      res.status(400).json({ error: 'phone is required for pairing-code' });
      return;
    }
    startWhatsAppPairing(method, phone);
    res.json({ ok: true, state: 'starting' });
  },
);

router.post(
  '/whatsapp/pairing/cancel',
  requireRole('owner'),
  (_req: Request, res: Response) => {
    stopWhatsAppPairingProcess();
    whatsappPairingError = null;
    res.json({ ok: true, state: 'cancelled' });
  },
);

router.post(
  '/whatsapp/pairing/reset',
  requireRole('owner'),
  async (_req: Request, res: Response) => {
    stopWhatsAppPairingProcess();
    const whatsappChannel = getState().channels.find(
      (ch) => ch.name.toLowerCase() === 'whatsapp',
    );
    try {
      await whatsappChannel?.disconnect();
    } catch (err) {
      logger.warn({ err }, 'Failed to disconnect WhatsApp before reset');
    }
    fs.rmSync(storePath('auth'), { recursive: true, force: true });
    for (const file of ['qr-data.txt', 'auth-status.txt', 'pairing-code.txt']) {
      try {
        fs.unlinkSync(storePath(file));
      } catch {
        // Missing stale state is fine.
      }
    }
    whatsappPairingError = null;
    whatsappPairingStartedAt = null;
    res.json({ ok: true, state: 'not_configured' });
  },
);

export default router;
