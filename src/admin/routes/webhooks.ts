import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../../config.js';
import { readEnvFile } from '../../env.js';
import { getState } from '../state.js';
import { auditLog } from '../security.js';
import { logger } from '../../logger.js';
import { handleAutofixWebhook } from '../plugins/autofix/routes.js';

const router = Router();
const CONFIG_PATH = path.join(STORE_DIR, 'webhook-config.json');
const EVENTS_PATH = path.join(STORE_DIR, 'webhook-events.jsonl');

interface WebhookConfig {
  enabled: boolean;
  secret: string;
  events: string[];
  targetJid: string;
}

function loadConfig(): WebhookConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {
      enabled: false,
      secret: '',
      events: ['push', 'pull_request'],
      targetJid: '',
    };
  }
}

function saveConfig(config: WebhookConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function logEvent(event: Record<string, unknown>): void {
  try {
    fs.appendFileSync(EVENTS_PATH, JSON.stringify(event) + '\n');
  } catch {
    /* non-fatal */
  }
}

// Config CRUD (protected by requireAuth in index.ts)
router.get('/config', (_req: Request, res: Response) => {
  const config = loadConfig();
  res.json({ ...config, secret: config.secret ? '****' : '' });
});

router.put('/config', (req: Request, res: Response) => {
  const current = loadConfig();
  const { enabled, secret, events, targetJid } = req.body;
  const updated: WebhookConfig = {
    enabled: enabled !== undefined ? !!enabled : current.enabled,
    secret: secret && secret !== '****' ? secret : current.secret,
    events: Array.isArray(events) ? events : current.events,
    targetJid: targetJid !== undefined ? targetJid : current.targetJid,
  };
  saveConfig(updated);
  auditLog(req, 'webhook_config_updated', `enabled: ${updated.enabled}`);
  res.json({ ok: true });
});

router.get('/events', (_req: Request, res: Response) => {
  try {
    const content = fs.readFileSync(EVENTS_PATH, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const events = lines
      .slice(-50)
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    res.json(events);
  } catch {
    res.json([]);
  }
});

router.get('/github-health', (_req: Request, res: Response) => {
  const config = loadConfig();
  const env = readEnvFile(['GITHUB_TOKEN', 'GITHUB_WEBHOOK_SECRET']);
  const tokenConfigured = !!(process.env.GITHUB_TOKEN || env.GITHUB_TOKEN);
  const secretConfigured = !!(
    config.secret ||
    process.env.GITHUB_WEBHOOK_SECRET ||
    env.GITHUB_WEBHOOK_SECRET
  );
  let recentEvents = 0;
  let lastEvent: Record<string, unknown> | null = null;
  try {
    const lines = fs
      .readFileSync(EVENTS_PATH, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean);
    recentEvents = lines.length;
    lastEvent = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
  } catch {
    recentEvents = 0;
  }
  const checks = [
    {
      label: 'GitHub token',
      ok: tokenConfigured,
      detail: 'Required for issue, PR, CI, and coding-job API calls.',
    },
    {
      label: 'Webhook enabled',
      ok: config.enabled,
      detail: 'Incoming GitHub webhook delivery is accepted only when enabled.',
    },
    {
      label: 'Webhook secret',
      ok: secretConfigured,
      detail: 'Required for HMAC signature validation.',
    },
    {
      label: 'Target group',
      ok: !!config.targetJid,
      detail: 'Webhook summaries need a destination group for notifications.',
    },
  ];
  res.json({
    ok: checks.every((check) => check.ok),
    webhookUrl: '/api/webhooks/github',
    recentEvents,
    lastEvent,
    checks,
    setupSteps: [
      'Set GITHUB_TOKEN in Credentials.',
      'Choose a webhook secret and store it in Webhooks or GITHUB_WEBHOOK_SECRET.',
      'Add the webhook URL to the GitHub repository with application/json content type.',
      'Subscribe to push, pull_request, and issues events as needed.',
      'Send a GitHub test delivery and confirm it appears in Recent Events.',
    ],
  });
});

router.delete('/events', (req: Request, res: Response) => {
  try {
    fs.writeFileSync(EVENTS_PATH, '');
  } catch {
    /* ok */
  }
  auditLog(req, 'webhook_events_cleared');
  res.json({ ok: true });
});

// GitHub webhook handler — exported separately for raw body registration
export function handleGithubWebhook(req: Request, res: Response): void {
  const config = loadConfig();

  if (!config.enabled) {
    res.status(503).json({ error: 'Webhooks disabled' });
    return;
  }

  // Verify HMAC signature
  const secret =
    config.secret ||
    process.env.GITHUB_WEBHOOK_SECRET ||
    readEnvFile(['GITHUB_WEBHOOK_SECRET']).GITHUB_WEBHOOK_SECRET ||
    '';
  if (!secret) {
    res.status(500).json({ error: 'Webhook secret not configured' });
    return;
  }

  const signature = req.headers['x-hub-signature-256'] as string;
  if (!signature) {
    res.status(401).json({ error: 'Missing signature' });
    return;
  }
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(JSON.stringify(req.body));
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    if (
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  } catch {
    res.status(401).json({ error: 'Signature verification failed' });
    return;
  }

  // Parse body
  let payload: Record<string, unknown>;
  try {
    payload = Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString())
      : req.body;
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  const eventType = (req.headers['x-github-event'] as string) || 'unknown';

  // Build prompt based on event type
  let prompt = '';
  const repo =
    (payload.repository as { full_name?: string })?.full_name || 'unknown';

  switch (eventType) {
    case 'push': {
      const branch = ((payload.ref as string) || '').replace('refs/heads/', '');
      const pusher = (payload.pusher as { name?: string })?.name || 'unknown';
      const commits = (payload.commits as Array<{ message?: string }>) || [];
      const commitSummary = commits
        .slice(0, 5)
        .map((c) => `- ${c.message?.split('\n')[0] || 'no message'}`)
        .join('\n');
      prompt = `GitHub push to ${repo}/${branch} by ${pusher} (${commits.length} commit${commits.length !== 1 ? 's' : ''}):\n${commitSummary}\n\nReview these changes and let me know if anything needs attention.`;
      break;
    }
    case 'pull_request': {
      const pr =
        (payload.pull_request as {
          number?: number;
          title?: string;
          user?: { login?: string };
          html_url?: string;
        }) || {};
      const action = (payload.action as string) || 'unknown';
      prompt = `GitHub PR #${pr.number} ${action} on ${repo}: "${pr.title}" by ${pr.user?.login || 'unknown'}\n${pr.html_url || ''}\n\nReview this PR and summarize the changes.`;
      break;
    }
    case 'issues': {
      const issue =
        (payload.issue as {
          number?: number;
          title?: string;
          user?: { login?: string };
        }) || {};
      const action = (payload.action as string) || 'unknown';
      prompt = `GitHub issue #${issue.number} ${action} on ${repo}: "${issue.title}" by ${issue.user?.login || 'unknown'}`;
      break;
    }
    default:
      prompt = `GitHub event "${eventType}" on ${repo}: ${JSON.stringify(payload).slice(0, 500)}`;
  }

  // Log event
  logEvent({
    timestamp: new Date().toISOString(),
    event: eventType,
    repo,
    summary: prompt.slice(0, 200),
    status: 'received',
  });

  // Autofix pipeline — handle issue/PR events
  if (eventType === 'issues' || eventType === 'pull_request') {
    handleAutofixWebhook(payload).catch((err) => {
      logger.warn({ err: err.message }, 'Autofix webhook handler failed');
    });
  }

  // Send to target channel
  const targetJid = config.targetJid;
  if (targetJid && prompt) {
    const state = getState();
    state.sendMessage(targetJid, prompt).catch((err) => {
      logger.error({ err }, 'Failed to send webhook message');
    });
    logger.info({ event: eventType, repo }, 'GitHub webhook processed');
  }

  res.json({ ok: true });
}

export default router;
