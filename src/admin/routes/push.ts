/**
 * Web Push notifications — subscribe, manage, and send push notifications.
 * Used by uptime alerts, automation notices, and task completion.
 */
import { Router, Request, Response } from 'express';
import webpush from 'web-push';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../../config.js';
import { readEnvFile } from '../../env.js';
import { logger } from '../../logger.js';

const router = Router();
const SUBS_PATH = path.join(STORE_DIR, 'push-subscriptions.json');
const PUSH_ICON_PATH = '/static/nanocrab-mark.png';

interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: string;
  userAgent: string;
}

function loadSubs(): PushSubscription[] {
  try {
    return JSON.parse(fs.readFileSync(SUBS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveSubs(subs: PushSubscription[]): void {
  fs.mkdirSync(path.dirname(SUBS_PATH), { recursive: true });
  fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2));
}

function initVapid(): boolean {
  const env = readEnvFile([
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'VAPID_EMAIL',
  ]);
  const pub = env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY;
  const email =
    env.VAPID_EMAIL || process.env.VAPID_EMAIL || 'mailto:admin@nanocrab.dev';

  if (!pub || !priv) return false;
  webpush.setVapidDetails(email, pub, priv);
  return true;
}

// Get VAPID public key for client subscription
router.get('/vapid-key', (_req: Request, res: Response) => {
  const env = readEnvFile(['VAPID_PUBLIC_KEY']);
  const key = env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    res.status(500).json({ error: 'VAPID keys not configured' });
    return;
  }
  res.json({ publicKey: key });
});

// Subscribe a client
router.post('/subscribe', (req: Request, res: Response) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint || !subscription?.keys) {
    res.status(400).json({ error: 'Invalid subscription' });
    return;
  }

  const subs = loadSubs();
  // Deduplicate by endpoint
  if (subs.some((s) => s.endpoint === subscription.endpoint)) {
    res.json({ ok: true, note: 'Already subscribed' });
    return;
  }

  subs.push({
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    createdAt: new Date().toISOString(),
    userAgent: req.headers['user-agent'] || 'unknown',
  });
  saveSubs(subs);
  logger.info('Push subscription added');
  res.json({ ok: true });
});

// Unsubscribe
router.post('/unsubscribe', (req: Request, res: Response) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    res.status(400).json({ error: 'Endpoint required' });
    return;
  }
  const subs = loadSubs().filter((s) => s.endpoint !== endpoint);
  saveSubs(subs);
  res.json({ ok: true });
});

// List subscriptions (admin)
router.get('/subscriptions', (_req: Request, res: Response) => {
  const subs = loadSubs();
  res.json(
    subs.map((s) => ({
      endpoint: s.endpoint.slice(0, 50) + '...',
      createdAt: s.createdAt,
      userAgent: s.userAgent.slice(0, 60),
    })),
  );
});

// Test push
router.post('/test', async (_req: Request, res: Response) => {
  const sent = await sendPush(
    'NanoCrab Test',
    'Push notifications are working!',
  );
  res.json({ ok: true, sent });
});

export default router;

// --- Public API for other modules ---

export async function sendPush(
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<number> {
  if (!initVapid()) return 0;

  const subs = loadSubs();
  if (subs.length === 0) return 0;

  const payload = JSON.stringify({
    title,
    body,
    icon: PUSH_ICON_PATH,
    badge: PUSH_ICON_PATH,
    data: data || {},
  });

  let sent = 0;
  const expired: string[] = [];

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        payload,
      );
      sent++;
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription expired
        expired.push(sub.endpoint);
      } else {
        logger.debug({ err: err.message }, 'Push notification failed');
      }
    }
  }

  // Clean up expired subscriptions
  if (expired.length > 0) {
    const cleaned = subs.filter((s) => !expired.includes(s.endpoint));
    saveSubs(cleaned);
  }

  return sent;
}
