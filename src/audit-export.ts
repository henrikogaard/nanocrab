/**
 * Tamper-evident audit export for NanoCrab.
 *
 * Produces a signed, chained export of audit events so any after-the-fact
 * modification, deletion, or reordering of an event is detectable. Each event
 * in the export carries a SHA-256 hash of its canonical form plus the previous
 * event's hash, forming a hash chain anchored to a per-export seed. The
 * export ends with a signature (HMAC-SHA256) over the chain head, keyed by an
 * operator-provided secret or a host-derived key.
 *
 * Verification (`verifyTamperEvidentExport`) recomputes the chain and checks
 * the signature, returning a structured report that flags any broken links,
 * mutated events, or an invalid signature.
 */
import crypto from 'crypto';

import {
  listAuditEvents,
  type AuditEvent,
  type AuditFilters,
} from './audit-log.js';

export interface ChainedAuditEvent {
  /** 1-based position in the export chain. */
  index: number;
  /** SHA-256 of the canonical event fields (excluding the chain metadata). */
  eventHash: string;
  /** SHA-256 of the previous event's chain record (or the seed for index 1). */
  previousHash: string;
  /** The original audit event. */
  event: AuditEvent;
}

export interface TamperEvidentExport {
  /** ISO timestamp the export was generated. */
  exportedAt: string;
  /** Random 32-byte hex seed anchoring the chain. */
  seed: string;
  /** Filter snapshot used to select events. */
  filters: AuditFilters;
  /** Number of events in the chain. */
  count: number;
  /** SHA-256 of the final chain record (head of the chain). */
  chainHead: string;
  /** HMAC-SHA256 of `chainHead` keyed by the signing key. */
  signature: string;
  /** Key id used for signing (for rotation/identification). */
  keyId: string;
  /** The chained events. */
  events: ChainedAuditEvent[];
}

export interface VerificationReport {
  valid: boolean;
  /** True if the signature over the chain head matches. */
  signatureValid: boolean;
  /** True if every event hash and chain link recomputes correctly. */
  chainValid: boolean;
  /** Indices of events whose hash does not recompute. */
  mutatedEventIndices: number[];
  /** Indices of events whose previousHash link is broken. */
  brokenLinkIndices: number[];
  /** Number of events in the verified export. */
  count: number;
  /** Recomputed chain head. */
  recomputedChainHead: string;
  /** Error explanation when verification cannot complete. */
  error?: string;
}

/**
 * Canonical JSON form of an audit event for hashing. Field order is fixed so
 * semantically-equal events produce the same hash regardless of object key
 * insertion order. Recursively sorts all nested object keys so the context
 * field (and any future nested fields) produce deterministic output.
 */
function canonicalEventJson(event: AuditEvent): string {
  const canonical = {
    id: event.id,
    timestamp: event.timestamp,
    actor: event.actor,
    actorId: event.actorId,
    actionType: event.actionType,
    resource: event.resource,
    decision: event.decision,
    context: event.context,
    correlationId: event.correlationId,
    durationMs: event.durationMs,
    error: event.error,
  };
  return canonicalJsonStringify(canonical);
}

/**
 * Recursively sort object keys and stringify to produce deterministic JSON.
 * Handles nested objects and arrays so the context field (and any future
 * nested fields) always produce the same string for semantically equal input.
 */
function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map((k) =>
    JSON.stringify(k) + ':' + canonicalJsonStringify((value as Record<string, unknown>)[k]),
  );
  return '{' + entries.join(',') + '}';
}

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function chainRecordHash(record: Omit<ChainedAuditEvent, 'event'>): string {
  return sha256(
    JSON.stringify({
      index: record.index,
      eventHash: record.eventHash,
      previousHash: record.previousHash,
    }),
  );
}

/**
 * Resolve the signing key. Operators should set AUDIT_EXPORT_KEY to a
 * long-lived secret; if unset, a host-derived key is used so the export is
 * still tamper-evident within a single host (but not portable across hosts).
 */
function resolveSigningKey(): { key: string; keyId: string } {
  const explicit = process.env.AUDIT_EXPORT_KEY;
  if (explicit && explicit.trim()) {
    return { key: explicit, keyId: 'env:_AUDIT_EXPORT_KEY' };
  }
  // Host-derived fallback: stable per host but not a real secret. This makes
  // the export tamper-evident against after-the-fact edits without requiring
  // operators to configure a key before they can verify integrity.
  const fallback = `nanocrab-audit-export-fallback:${process.env.USER || 'default'}`;
  return { key: fallback, keyId: 'host-derived-fallback' };
}

/**
 * Build a tamper-evident export from the current audit log. Events are ordered
 * by timestamp then id so the chain is deterministic.
 */
export function buildTamperEvidentExport(
  filters: AuditFilters = {},
  signingKey?: string,
): TamperEvidentExport {
  const events = listAuditEvents(filters);
  // Stable ordering: timestamp, then id.
  events.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp < b.timestamp ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const seed = crypto.randomBytes(32).toString('hex');
  const resolved = resolveSigningKey();
  const key = signingKey ?? resolved.key;

  const chained: ChainedAuditEvent[] = [];
  let previousHash = seed;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const eventHash = sha256(canonicalEventJson(event));
    const record = {
      index: i + 1,
      eventHash,
      previousHash,
    };
    previousHash = chainRecordHash(record);
    chained.push({ ...record, event });
  }

  const chainHead = previousHash;
  const signature = crypto
    .createHmac('sha256', key)
    .update(chainHead, 'utf8')
    .digest('hex');

  return {
    exportedAt: new Date().toISOString(),
    seed,
    filters,
    count: chained.length,
    chainHead,
    signature,
    keyId: resolved.keyId,
    events: chained,
  };
}

/**
 * Verify a tamper-evident export. Recomputes every event hash and chain link,
 * then checks the signature over the chain head.
 */
export function verifyTamperEvidentExport(
  exportData: TamperEvidentExport,
  signingKey?: string,
): VerificationReport {
  const resolved = resolveSigningKey();
  const key = signingKey ?? resolved.key;
  const mutatedEventIndices: number[] = [];
  const brokenLinkIndices: number[] = [];
  let previousHash = exportData.seed;
  let chainValid = true;

  for (const record of exportData.events) {
    const expectedEventHash = sha256(canonicalEventJson(record.event));
    if (expectedEventHash !== record.eventHash) {
      mutatedEventIndices.push(record.index);
      chainValid = false;
    }
    const expectedRecord = {
      index: record.index,
      eventHash: record.eventHash,
      previousHash,
    };
    const recomputed = chainRecordHash(expectedRecord);
    if (recomputed !== previousHash && record.previousHash !== previousHash) {
      brokenLinkIndices.push(record.index);
      chainValid = false;
    }
    previousHash = chainRecordHash({
      index: record.index,
      eventHash: record.eventHash,
      previousHash,
    });
  }

  const recomputedChainHead = previousHash;
  const expectedSignature = crypto
    .createHmac('sha256', key)
    .update(recomputedChainHead, 'utf8')
    .digest('hex');
  const signatureValid = expectedSignature === exportData.signature;

  return {
    valid: chainValid && signatureValid,
    signatureValid,
    chainValid,
    mutatedEventIndices,
    brokenLinkIndices,
    count: exportData.events.length,
    recomputedChainHead,
  };
}
