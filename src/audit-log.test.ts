import { beforeEach, describe, expect, it } from 'vitest';

import { _closeDatabase, _initTestDatabase } from './db.js';
import {
  listAuditEvents,
  logAuditEvent,
  replayAuditCorrelation,
} from './audit-log.js';

describe('audit log', () => {
  beforeEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* database may not be initialized */
    }
    _initTestDatabase();
  });

  it('stores redacted audit events and filters them by decision and correlation', () => {
    const event = logAuditEvent({
      actor: 'coding-agent',
      actorId: 'job-1',
      actionType: 'coding.open_pr',
      resource: 'owner/repo#42',
      decision: 'approved',
      correlationId: 'corr-job-1',
      durationMs: 27,
      context: {
        branch: 'nanocrab/task',
        authorization: 'Bearer secret-token',
        nested: { apiKey: 'sk-live-secret', message: 'safe detail' },
      },
    });

    const [stored] = listAuditEvents({
      decision: 'approved',
      correlationId: 'corr-job-1',
    });

    expect(stored).toMatchObject({
      id: event.id,
      actor: 'coding-agent',
      actorId: 'job-1',
      actionType: 'coding.open_pr',
      resource: 'owner/repo#42',
      decision: 'approved',
      correlationId: 'corr-job-1',
      durationMs: 27,
    });
    expect(stored.context).toMatchObject({
      branch: 'nanocrab/task',
      authorization: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', message: 'safe detail' },
    });
    expect(JSON.stringify(stored.context)).not.toContain('secret-token');
    expect(JSON.stringify(stored.context)).not.toContain('sk-live-secret');
  });

  it('replays a correlation id as an ordered job timeline', () => {
    logAuditEvent({
      actor: 'coding-agent',
      actionType: 'coding.transition',
      resource: 'job-1',
      decision: 'allowed',
      correlationId: 'job-1',
      context: { from: 'queued', to: 'plan' },
      timestamp: '2026-06-10T10:00:00.000Z',
    });
    logAuditEvent({
      actor: 'coding-agent',
      actionType: 'coding.transition',
      resource: 'job-1',
      decision: 'simulated',
      correlationId: 'job-1',
      context: { from: 'plan', to: 'completed' },
      timestamp: '2026-06-10T10:01:00.000Z',
    });

    const replay = replayAuditCorrelation('job-1');

    expect(replay.correlationId).toBe('job-1');
    expect(replay.events.map((event) => event.context)).toEqual([
      { from: 'queued', to: 'plan' },
      { from: 'plan', to: 'completed' },
    ]);
    expect(replay.summary).toMatchObject({
      firstActionType: 'coding.transition',
      lastDecision: 'simulated',
      eventCount: 2,
    });
  });

  it('replays complete long correlations without dropping earliest events', () => {
    for (let index = 0; index < 1005; index++) {
      logAuditEvent({
        actor: 'coding-agent',
        actionType:
          index === 0
            ? 'coding.first'
            : index === 1004
              ? 'coding.last'
              : 'coding.middle',
        resource: 'job-long',
        decision: index === 1004 ? 'simulated' : 'allowed',
        correlationId: 'job-long',
        context: { index },
        timestamp: new Date(Date.UTC(2026, 5, 10, 10, 0, index)).toISOString(),
      });
    }

    const replay = replayAuditCorrelation('job-long');

    expect(replay.events).toHaveLength(1005);
    expect(replay.events[0]).toMatchObject({
      actionType: 'coding.first',
      context: { index: 0 },
    });
    expect(replay.events[1004]).toMatchObject({
      actionType: 'coding.last',
      context: { index: 1004 },
    });
    expect(replay.summary).toMatchObject({
      eventCount: 1005,
      firstActionType: 'coding.first',
      lastActionType: 'coding.last',
      lastDecision: 'simulated',
    });
  });
});
