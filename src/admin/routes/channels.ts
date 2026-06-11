import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { getState } from '../state.js';
import { readEnvFile } from '../../env.js';
import { getChannelHealth } from '../../channel-health.js';
import { requireRole } from '../middleware.js';
import {
  cancelWhatsAppPairing,
  getWhatsAppPairingStatus,
  resetWhatsAppPairing,
  startWhatsAppPairing,
} from '../../whatsapp-pairing.js';

const router = Router();

/** Mask a sensitive value: show first 4 + ... + last 4 chars */
function mask(value: string): string {
  if (!value) return '';
  if (value.length <= 12) return value.slice(0, 4) + '...';
  return value.slice(0, 4) + '...' + value.slice(-4);
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

function whatsappConnected(): boolean {
  try {
    const channel = getState().channels.find(
      (ch) => ch.name.toLowerCase() === 'whatsapp',
    );
    return channel ? getChannelHealth(channel).connected : false;
  } catch {
    return false;
  }
}

async function whatsappPairingPayload(): Promise<Record<string, unknown>> {
  const status = getWhatsAppPairingStatus({ connected: whatsappConnected() });
  const qrCodeDataUrl =
    status.qrData && status.state === 'waiting_for_qr_scan'
      ? await QRCode.toDataURL(status.qrData, {
          margin: 1,
          width: 320,
          errorCorrectionLevel: 'M',
        })
      : null;
  return {
    ...status,
    qrCodeDataUrl,
    qrData: undefined,
  };
}

router.get('/whatsapp/pairing', async (_req: Request, res: Response) => {
  res.json(await whatsappPairingPayload());
});

router.post(
  '/whatsapp/pairing/start',
  requireRole('owner'),
  async (req: Request, res: Response) => {
    const method = req.body?.method === 'pairing-code' ? 'pairing-code' : 'qr';
    const phone =
      typeof req.body?.phone === 'string'
        ? req.body.phone.replace(/[^\d]/g, '')
        : '';
    if (method === 'pairing-code' && !phone) {
      res.status(400).json({ error: 'phone is required for pairing-code' });
      return;
    }
    startWhatsAppPairing({ method, phone });
    res.json(await whatsappPairingPayload());
  },
);

router.post(
  '/whatsapp/pairing/cancel',
  requireRole('owner'),
  async (_req: Request, res: Response) => {
    cancelWhatsAppPairing();
    res.json(await whatsappPairingPayload());
  },
);

router.post(
  '/whatsapp/pairing/reset',
  requireRole('owner'),
  async (_req: Request, res: Response) => {
    resetWhatsAppPairing();
    res.json(await whatsappPairingPayload());
  },
);

router.get('/', (_req: Request, res: Response) => {
  const state = getState();

  // Read all channel-related env vars
  const allEnvKeys = SUPPORTED_CHANNELS.flatMap((ch) => ch.envVars);
  const envValues = readEnvFile(allEnvKeys);

  // Build active channels with status and config
  const activeChannels = state.channels.map((ch) => {
    const def = SUPPORTED_CHANNELS.find((s) => s.id === ch.name.toLowerCase());
    const config: Record<string, string> = {};
    const health = getChannelHealth(ch);

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
      connected: health.connected,
      status: health.status,
      lastActiveAt: health.lastActiveAt,
      healthDetail: health.detail,
      diagnostics: health.diagnostics || {},
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

export default router;
