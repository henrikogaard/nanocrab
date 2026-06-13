import crypto from 'crypto';

import {
  insertAuditEvent,
  isDatabaseInitialized,
  queryAuditEvents,
  queryAuditEventsByCorrelation,
  type AuditEventQuery,
  type AuditEventRow,
} from './db.js';
import { logger } from './logger.js';

export type AuditDecision =
  | 'allowed'
  | 'approved'
  | 'denied'
  | 'requires_approval'
  | 'simulated'
  | 'error';

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  actorId: string | null;
  actionType: string;
  resource: string;
  decision: AuditDecision | string;
  context: unknown;
  correlationId: string | null;
  durationMs: number | null;
  error: string | null;
}

export interface AuditEventInput {
  id?: string;
  timestamp?: string;
  actor: string;
  actorId?: string | null;
  actionType: string;
  resource?: string;
  decision: AuditDecision | string;
  context?: unknown;
  correlationId?: string | null;
  durationMs?: number | null;
  error?: unknown;
}

export interface AuditFilters {
  actor?: string;
  actorId?: string;
  actionType?: string;
  resource?: string;
  decision?: string;
  correlationId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

const SECRET_KEY_RE =
  /(token|password|passwd|secret|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i;
const SECRET_VALUE_RE =
  /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*|\b(sk-[A-Za-z0-9_-]{8,})\b|\b(password\s*(?:[=:]|\s)\s*)\S+/gi;

function redactString(value: string): string {
  return value.replace(SECRET_VALUE_RE, (_match, prefix) =>
    prefix ? `${prefix}[REDACTED]` : '[REDACTED]',
  );
}

export function redactAuditValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY_RE.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([entryKey, item]) => [entryKey, redactAuditValue(item, entryKey)],
      ),
    );
  }
  return value;
}

function normalizeError(error: unknown): string | null {
  if (error == null) return null;
  const message = error instanceof Error ? error.message : String(error);
  return redactString(message).slice(0, 2000);
}

function rowToEvent(row: AuditEventRow): AuditEvent {
  let context: unknown = {};
  try {
    context = JSON.parse(row.context_json || '{}');
  } catch {
    context = {};
  }
  return {
    id: row.id,
    timestamp: row.timestamp,
    actor: row.actor,
    actorId: row.actor_id,
    actionType: row.action_type,
    resource: row.resource,
    decision: row.decision,
    context,
    correlationId: row.correlation_id,
    durationMs: row.duration_ms,
    error: row.error,
  };
}

export function logAuditEvent(input: AuditEventInput): AuditEvent {
  const event: AuditEvent = {
    id:
      input.id ||
      `audit-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    timestamp: input.timestamp || new Date().toISOString(),
    actor: input.actor || 'system',
    actorId: input.actorId || null,
    actionType: input.actionType,
    resource: input.resource || 'unknown',
    decision: input.decision,
    context: redactAuditValue(input.context || {}),
    correlationId: input.correlationId || null,
    durationMs: input.durationMs ?? null,
    error: normalizeError(input.error),
  };

  try {
    if (!isDatabaseInitialized()) return event;
    insertAuditEvent({
      id: event.id,
      timestamp: event.timestamp,
      actor: event.actor,
      actorId: event.actorId,
      actionType: event.actionType,
      resource: event.resource,
      decision: event.decision,
      contextJson: JSON.stringify(event.context),
      correlationId: event.correlationId,
      durationMs: event.durationMs,
      error: event.error,
    });
  } catch (err) {
    logger.warn(
      { err, actionType: event.actionType },
      'Failed to write audit event',
    );
  }

  return event;
}

export function listAuditEvents(filters: AuditFilters = {}): AuditEvent[] {
  try {
    return queryAuditEvents(filters as AuditEventQuery).map(rowToEvent);
  } catch (err) {
    logger.warn({ err }, 'Failed to read audit events');
    return [];
  }
}

export function replayAuditCorrelation(correlationId: string): {
  correlationId: string;
  events: AuditEvent[];
  summary: {
    eventCount: number;
    firstActionType: string | null;
    lastActionType: string | null;
    lastDecision: string | null;
    durationMs: number | null;
  };
} {
  let events: AuditEvent[];
  try {
    events = queryAuditEventsByCorrelation(correlationId).map(rowToEvent);
  } catch (err) {
    logger.warn({ err, correlationId }, 'Failed to replay audit correlation');
    events = [];
  }
  const first = events[0];
  const last = events[events.length - 1];
  const startMs = first ? Date.parse(first.timestamp) : NaN;
  const endMs = last ? Date.parse(last.timestamp) : NaN;
  return {
    correlationId,
    events,
    summary: {
      eventCount: events.length,
      firstActionType: first?.actionType || null,
      lastActionType: last?.actionType || null,
      lastDecision: last?.decision || null,
      durationMs:
        Number.isFinite(startMs) && Number.isFinite(endMs)
          ? endMs - startMs
          : null,
    },
  };
}
