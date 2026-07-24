import { Router, Request, Response } from 'express';

import { logAuditEvent } from '../../audit-log.js';
import {
  evaluateEgress,
  loadEgressAllowlist,
  saveEgressAllowlist,
  type EgressAllowlist,
  type EgressDestination,
} from '../../egress-gateway.js';
import { requireRole } from '../middleware.js';

const router = Router();

router.use(requireRole('admin'));

router.get('/', (_req: Request, res: Response) => {
  res.json(loadEgressAllowlist());
});

function parseDestination(input: unknown): EgressDestination | null {
  if (!input || typeof input !== 'object') return null;
  const d = input as Record<string, unknown>;
  const host = typeof d.host === 'string' ? d.host.toLowerCase().trim() : '';
  if (!host) return null;
  return {
    id:
      typeof d.id === 'string' && d.id.trim()
        ? d.id
        : `dest-${Buffer.from(host).toString('hex').slice(0, 8)}`,
    host,
    credentialId:
      typeof d.credentialId === 'string' && d.credentialId.trim()
        ? d.credentialId
        : undefined,
    port: typeof d.port === 'number' ? d.port : undefined,
    reason:
      typeof d.reason === 'string' && d.reason.trim()
        ? d.reason
        : 'Operator-configured egress destination.',
  };
}

router.put('/', (req: Request, res: Response) => {
  const incoming = req.body as { destinations?: unknown };
  if (!incoming || !Array.isArray(incoming.destinations)) {
    res.status(400).json({ error: 'destinations must be an array' });
    return;
  }
  const destinations = incoming.destinations
    .map(parseDestination)
    .filter((d): d is EgressDestination => d !== null);
  const allowlist: EgressAllowlist = { destinations };
  saveEgressAllowlist(allowlist);
  logAuditEvent({
    actor: req.user?.username || 'dashboard',
    actionType: 'egress.allowlist.update',
    resource: 'egress-allowlist',
    decision: 'allowed',
    context: { count: destinations.length },
  });
  res.json(allowlist);
});

// Fix #12: simple in-memory rate limiter for /evaluate to prevent audit log flooding
const evaluateRateLimit = new Map<string, number[]>();
const EVALUATE_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const EVALUATE_RATE_LIMIT_MAX = 60; // 60 requests per minute per user

function checkEvaluateRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = evaluateRateLimit.get(userId) || [];
  const recent = timestamps.filter((t) => now - t < EVALUATE_RATE_LIMIT_WINDOW_MS);
  if (recent.length >= EVALUATE_RATE_LIMIT_MAX) {
    return false;
  }
  recent.push(now);
  evaluateRateLimit.set(userId, recent);
  return true;
}

router.post('/evaluate', (req: Request, res: Response) => {
  const userId = req.user?.username || 'dashboard';
  if (!checkEvaluateRateLimit(userId)) {
    res.status(429).json({ error: 'Rate limit exceeded. Maximum 60 evaluations per minute.' });
    return;
  }
  const body = req.body as {
    host?: string;
    port?: number;
    credentialId?: string;
    dryRun?: boolean;
  };
  if (!body || typeof body.host !== 'string' || !body.host.trim()) {
    res.status(400).json({ error: 'host is required' });
    return;
  }
  const result = evaluateEgress({
    host: body.host,
    port: body.port,
    credentialId: body.credentialId,
    dryRun: body.dryRun,
    actor: req.user?.username || 'dashboard',
  });
  logAuditEvent({
    actor: req.user?.username || 'dashboard',
    actionType: 'egress.evaluate',
    resource: result.host,
    decision: result.decision === 'allow' ? 'allowed' : 'denied',
    correlationId: result.correlationId,
    context: {
      reason: result.reason,
      dryRun: result.dryRun,
      matchedDestinationId: result.matchedDestination?.id,
    },
  });
  res.json(result);
});

export default router;
