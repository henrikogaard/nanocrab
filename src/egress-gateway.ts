/**
 * Destination-bound egress gateway for NanoCrab.
 *
 * Expands the credential proxy from a credential injector into an authoritative
 * allow/deny egress boundary. The proxy consults this module before forwarding
 * any outbound request:
 *
 *   - unknown public destinations are denied by default
 *   - a credential is only injected for the destination it is bound to
 *   - allow/deny decisions are emitted as sanitized audit events
 *   - dry-run mode audits deny decisions without blocking traffic
 *
 * Private/loopback destinations (127.0.0.0/8, 10/8, 172.16/12, 192.168/16,
 * ::1, localhost) are allowed without an explicit allowlist entry because they
 * are not real egress — the proxy itself listens on a bridge/loopback address
 * and provider base URLs may point at local runtimes (e.g. Ollama).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { logAuditEvent, redactAuditValue } from './audit-log.js';
import { logger } from './logger.js';

export type EgressDecision = 'allow' | 'deny';

export interface EgressDestination {
  id: string;
  host: string;
  /** Credential identifier bound to this destination (e.g. provider env key). */
  credentialId?: string;
  port?: number;
  reason: string;
}

export interface EgressAllowlist {
  destinations: EgressDestination[];
}

export interface EgressInput {
  host: string;
  port?: number;
  credentialId?: string;
  actor?: string;
  actorId?: string | null;
  correlationId?: string | null;
  method?: string;
  dryRun?: boolean;
}

export interface EgressResult {
  decision: EgressDecision;
  reason: string;
  matchedDestination?: EgressDestination;
  host: string;
  port?: number;
  credentialId?: string;
  correlationId: string;
  dryRun: boolean;
}

const ALLOWLIST_PATH = path.join(STORE_DIR, 'egress-allowlist.json');

/**
 * Default allowlist derived from the provider routes the credential proxy
 * already knows about. Each destination binds a provider credential to its
 * host so a key configured for one provider cannot be replayed against
 * another host.
 */
const DEFAULT_DESTINATIONS: EgressDestination[] = [
  {
    id: 'anthropic',
    host: 'api.anthropic.com',
    credentialId: 'ANTHROPIC_API_KEY',
    port: 443,
    reason: 'Anthropic Claude API (default upstream).',
  },
  {
    id: 'openrouter',
    host: 'openrouter.ai',
    credentialId: 'OPENROUTER_API_KEY',
    port: 443,
    reason: 'OpenRouter hosted provider route.',
  },
  {
    id: 'google-gemini',
    host: 'generativelanguage.googleapis.com',
    credentialId: 'GEMINI_API_KEY',
    port: 443,
    reason: 'Google Gemini OpenAI-compatible route.',
  },
  {
    id: 'airouter',
    host: 'api.airouter.ch',
    credentialId: 'AIROUTER_API_KEY',
    port: 443,
    reason: 'Airouter hosted provider route.',
  },
  {
    id: 'mistral',
    host: 'api.mistral.ai',
    credentialId: 'MISTRAL_API_KEY',
    port: 443,
    reason: 'Mistral hosted provider route.',
  },
];

let cachedAllowlist: EgressAllowlist | null = null;

/** Fix #8: track file mtime to detect external modifications */
let cachedAllowlistMtime: number | null = null;

/** Hosts that are not real egress and are always allowed. */
export function isPrivateHost(host: string): boolean {
  if (!host) return false;
  const lower = host.toLowerCase();
  if (lower === 'localhost') return true;
  // IPv4 loopback / private ranges
  const ipv4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [parseInt(ipv4[1], 10), parseInt(ipv4[2], 10)];
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true; // 0.0.0.0
  }
  // IPv6 loopback
  if (lower === '::1' || lower === '::') return true;
  return false;
}

function normalizeAllowlist(value: unknown): EgressAllowlist {
  if (!value || typeof value !== 'object') {
    return { destinations: DEFAULT_DESTINATIONS };
  }
  const raw = (value as { destinations?: unknown }).destinations;
  if (!Array.isArray(raw)) return { destinations: DEFAULT_DESTINATIONS };
  const destinations = raw
    .filter((d): d is Record<string, unknown> =>
      Boolean(d && typeof d === 'object'),
    )
    .map((d) => ({
      id:
        typeof d.id === 'string' && d.id.trim()
          ? d.id
          : `dest-${crypto.randomBytes(3).toString('hex')}`,
      host: String(d.host || '')
        .toLowerCase()
        .trim(),
      credentialId:
        typeof d.credentialId === 'string' && d.credentialId.trim()
          ? d.credentialId
          : undefined,
      port: typeof d.port === 'number' ? d.port : undefined,
      reason:
        typeof d.reason === 'string' && d.reason.trim()
          ? d.reason
          : 'Operator-configured egress destination.',
    }))
    .filter((d) => d.host);
  if (!destinations.length) return { destinations: DEFAULT_DESTINATIONS };
  return { destinations };
}

export function loadEgressAllowlist(): EgressAllowlist {
  // Fix #8: invalidate cache if the file was modified externally
  try {
    const stat = fs.statSync(ALLOWLIST_PATH);
    if (cachedAllowlist && cachedAllowlistMtime === stat.mtimeMs) {
      return cachedAllowlist;
    }
  } catch {
    // File doesn't exist yet — fall through to default
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf-8'));
    cachedAllowlist = normalizeAllowlist(parsed);
    try {
      const stat = fs.statSync(ALLOWLIST_PATH);
      cachedAllowlistMtime = stat.mtimeMs;
    } catch {
      /* mtime tracking failed — continue without it */
    }
  } catch {
    cachedAllowlist = { destinations: DEFAULT_DESTINATIONS };
    try {
      fs.mkdirSync(path.dirname(ALLOWLIST_PATH), { recursive: true });
      fs.writeFileSync(
        ALLOWLIST_PATH,
        `${JSON.stringify(cachedAllowlist, null, 2)}\n`,
      );
      const stat = fs.statSync(ALLOWLIST_PATH);
      cachedAllowlistMtime = stat.mtimeMs;
    } catch (err) {
      logger.warn({ err }, 'Failed to write default egress allowlist');
    }
  }
  return cachedAllowlist;
}

export function saveEgressAllowlist(allowlist: EgressAllowlist): void {
  fs.mkdirSync(path.dirname(ALLOWLIST_PATH), { recursive: true });
  fs.writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(allowlist, null, 2)}\n`);
  cachedAllowlist = normalizeAllowlist(allowlist);
  try {
    const stat = fs.statSync(ALLOWLIST_PATH);
    cachedAllowlistMtime = stat.mtimeMs;
  } catch {
    /* mtime tracking failed */
  }
}

export function resetEgressAllowlistCache(): void {
  cachedAllowlist = null;
  cachedAllowlistMtime = null;
}

function hostMatches(allowed: string, requested: string): boolean {
  return allowed === requested || requested.endsWith(`.${allowed}`);
}

/**
 * Evaluate an egress request against the allowlist and credential binding.
 * Private/loopback destinations are allowed without an allowlist entry.
 */
export function evaluateEgress(input: EgressInput): EgressResult {
  const host = (input.host || '').toLowerCase().trim();
  const correlationId =
    input.correlationId || `egress-${crypto.randomBytes(6).toString('hex')}`;
  const dryRun = input.dryRun === true || process.env.EGRESS_DRY_RUN === '1';

  if (!host) {
    return {
      decision: 'deny',
      reason: 'No destination host provided.',
      host,
      port: input.port,
      credentialId: input.credentialId,
      correlationId,
      dryRun,
    };
  }

  if (isPrivateHost(host)) {
    return {
      decision: 'allow',
      reason: 'Private/loopback destination does not require allowlist entry.',
      host,
      port: input.port,
      credentialId: input.credentialId,
      correlationId,
      dryRun,
    };
  }

  const allowlist = loadEgressAllowlist();
  const candidates = allowlist.destinations.filter((d) =>
    hostMatches(d.host, host),
  );

  if (!candidates.length) {
    return {
      decision: 'deny',
      reason: `Destination ${host} is not in the egress allowlist.`,
      host,
      port: input.port,
      credentialId: input.credentialId,
      correlationId,
      dryRun,
    };
  }

  // If a credential is being injected, it must be bound to the destination.
  let matched = candidates[0];
  if (input.credentialId) {
    const bound = candidates.find((d) => d.credentialId === input.credentialId);
    if (!bound) {
      return {
        decision: 'deny',
        reason: `Credential ${input.credentialId} is not bound to destination ${host}.`,
        host,
        port: input.port,
        credentialId: input.credentialId,
        correlationId,
        dryRun,
      };
    }
    matched = bound;
  }

  if (matched.port && input.port && matched.port !== input.port) {
    return {
      decision: 'deny',
      reason: `Destination ${host}:${input.port} does not match allowed port ${matched.port}.`,
      matchedDestination: matched,
      host,
      port: input.port,
      credentialId: input.credentialId,
      correlationId,
      dryRun,
    };
  }

  return {
    decision: 'allow',
    reason: matched.reason,
    matchedDestination: matched,
    host,
    port: input.port,
    credentialId: input.credentialId,
    correlationId,
    dryRun,
  };
}

/** Whether a deny decision should be enforced (false in dry-run mode). */
export function shouldEnforceDeny(result: EgressResult): boolean {
  return !(result.dryRun && result.decision === 'deny');
}

/**
 * Evaluate and audit an egress decision. Returns the result so the caller can
 * enforce it. Audit context is redacted and never includes secret values.
 */
export function auditEgressDecision(input: EgressInput): EgressResult {
  const result = evaluateEgress(input);
  const actionType =
    result.decision === 'allow'
      ? 'network.egress.allow'
      : 'network.egress.deny';
  logAuditEvent({
    actor: input.actor || 'credential-proxy',
    actorId: input.actorId || null,
    actionType,
    resource: result.host,
    decision: result.decision === 'allow' ? 'allowed' : 'denied',
    correlationId: result.correlationId,
    context: redactAuditValue({
      host: result.host,
      port: result.port,
      method: input.method,
      credentialId: result.credentialId,
      reason: result.reason,
      dryRun: result.dryRun,
      matchedDestinationId: result.matchedDestination?.id,
    }),
  });
  return result;
}
