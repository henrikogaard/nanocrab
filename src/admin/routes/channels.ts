import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getState } from '../state.js';
import { readEnvFile } from '../../env.js';

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

router.get('/', (_req: Request, res: Response) => {
  const state = getState();

  // Read all channel-related env vars
  const allEnvKeys = SUPPORTED_CHANNELS.flatMap((ch) => ch.envVars);
  const envValues = readEnvFile(allEnvKeys);

  // Build active channels with status and config
  const activeChannels = state.channels.map((ch) => {
    const def = SUPPORTED_CHANNELS.find((s) => s.id === ch.name.toLowerCase());
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
      connected: ch.isConnected(),
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
