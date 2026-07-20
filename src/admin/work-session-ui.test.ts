import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as vm from 'node:vm';

const workSessionPath = path.join(
  process.cwd(),
  'src/admin/public/ui/work-session.js',
);

type WorkSessionViewModel = {
  id: string;
  group: string;
  mode: string;
  status: string;
  currentStep: string;
  startedAt: string;
  updatedAt: string;
  progressPct: number | null;
  timeline: Array<Record<string, unknown>>;
  toolCalls: Array<Record<string, unknown>>;
  changedFiles: string[];
  artifacts: Array<Record<string, unknown>>;
  proposals: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  canCancel: boolean;
  canRetry: boolean;
  canResume: boolean;
  isReadOnly: boolean;
};

type WorkSessionAdapter = {
  normalize(
    summary?: unknown,
    cockpitDetail?: unknown,
    structuredDetail?: unknown,
    streamEvents?: unknown,
  ): WorkSessionViewModel;
  normalizeStatus(value: unknown): string;
  nextAction(session: Partial<WorkSessionViewModel>): string | null;
};

function loadWorkSession(): WorkSessionAdapter {
  const context: { window: { NanoWorkSession?: WorkSessionAdapter } } = {
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(workSessionPath, 'utf8'), context);
  if (!context.window.NanoWorkSession) {
    throw new Error('NanoWorkSession was not exposed');
  }
  return context.window.NanoWorkSession;
}

describe('NanoWorkSession status and action normalization', () => {
  it.each([
    'running',
    'waiting_approval',
    'failed',
    'completed',
    'cancelled',
    'interrupted',
  ])('preserves the supported %s status', (status) => {
    expect(loadWorkSession().normalizeStatus(status)).toBe(status);
  });

  it.each([undefined, null, '', 'queued', 'idle', 'complete', 'blocked'])(
    'maps unsupported status %s to unknown',
    (status) => {
      expect(loadWorkSession().normalizeStatus(status)).toBe('unknown');
    },
  );

  it.each([
    ['running', true, false, true, false, 'resume'],
    ['waiting_approval', true, false, false, false, 'review_approvals'],
    ['failed', false, true, false, false, 'retry'],
    ['completed', false, false, true, false, 'resume'],
    ['cancelled', false, true, false, false, 'retry'],
    ['interrupted', false, false, false, true, null],
    ['unknown-value', false, false, false, true, null],
  ])(
    'derives conservative capabilities and a deterministic next action for %s',
    (status, canCancel, canRetry, canResume, isReadOnly, nextAction) => {
      const adapter = loadWorkSession();
      const session = adapter.normalize({ status });

      expect(session).toMatchObject({
        status: status === 'unknown-value' ? 'unknown' : status,
        canCancel,
        canRetry,
        canResume,
        isReadOnly,
      });
      expect(adapter.nextAction(session)).toBe(nextAction);
    },
  );

  it('does not turn an interrupted or unknown capability claim into an action', () => {
    const adapter = loadWorkSession();

    expect(
      adapter.nextAction({
        status: 'interrupted',
        canCancel: true,
        canRetry: true,
        canResume: true,
      }),
    ).toBeNull();
    expect(
      adapter.nextAction({
        status: 'unknown',
        canCancel: true,
        canRetry: true,
        canResume: true,
      }),
    ).toBeNull();
  });
});

describe('NanoWorkSession surface merging', () => {
  it('prefers cockpit fields, then summary fields, then structured fallback fields', () => {
    const session = loadWorkSession().normalize(
      {
        id: 'summary-id',
        group: 'summary-group',
        status: 'failed',
        startedAt: '2026-07-20T08:00:00.000Z',
        updatedAt: '2026-07-20T08:30:00.000Z',
      },
      {
        id: 'cockpit-id',
        status: 'running',
        currentStep: 'Applying the focused change',
        updatedAt: '2026-07-20T09:00:00.000Z',
      },
      {
        id: 'structured-id',
        group: 'structured-group',
        mode: 'code',
        status: 'completed',
        currentStep: 'Structured fallback step',
        stats: {
          createdAt: '2026-07-20T07:00:00.000Z',
          endedAt: '2026-07-20T07:30:00.000Z',
        },
      },
    );

    expect(session).toMatchObject({
      id: 'cockpit-id',
      group: 'summary-group',
      mode: 'code',
      status: 'running',
      currentStep: 'Applying the focused change',
      startedAt: '2026-07-20T08:00:00.000Z',
      updatedAt: '2026-07-20T09:00:00.000Z',
    });
  });

  it('merges valid cockpit and wrapped stream events chronologically with ID dedupe', () => {
    const session = loadWorkSession().normalize(
      {},
      {
        timeline: [
          {
            id: 'shared',
            timestamp: '2026-07-20T10:03:00.000Z',
            type: 'tool_call',
            title: 'Cockpit copy',
          },
          {
            timestamp: '2026-07-20T10:02:00.000Z',
            type: 'progress',
            title: 'Anonymous cockpit event',
          },
          null,
          { id: 'missing-timestamp', type: 'progress' },
          { id: 'bad-date', timestamp: 'not-a-date', type: 'progress' },
          {
            id: 'missing-type',
            timestamp: '2026-07-20T10:04:00.000Z',
          },
        ],
      },
      {},
      {
        events: [
          {
            id: 'early',
            timestamp: '2026-07-20T10:01:00.000Z',
            type: 'progress',
          },
          {
            timestamp: '2026-07-20T10:02:00.000Z',
            type: 'tool_result',
            title: 'Anonymous stream event',
          },
          {
            id: 'shared',
            timestamp: '2026-07-20T10:03:00.000Z',
            type: 'tool_result',
            title: 'Duplicate stream copy',
          },
        ],
      },
    );

    expect(session.timeline).toHaveLength(4);
    expect(session.timeline.map((event) => event.id ?? event.title)).toEqual([
      'early',
      'Anonymous cockpit event',
      'Anonymous stream event',
      'shared',
    ]);
    expect(session.timeline.at(-1)?.title).toBe('Duplicate stream copy');
  });

  it('derives progress from the latest chronologically valid numeric progress event', () => {
    const session = loadWorkSession().normalize({}, {}, {}, [
      {
        id: 'newest-invalid',
        timestamp: '2026-07-20T10:05:00.000Z',
        type: 'progress',
        pct: '91',
      },
      {
        id: 'latest-valid',
        timestamp: '2026-07-20T10:04:00.000Z',
        type: 'progress',
        pct: 125,
      },
      {
        id: 'earlier',
        timestamp: '2026-07-20T10:03:00.000Z',
        type: 'progress',
        pct: 42,
      },
      {
        id: 'not-progress',
        timestamp: '2026-07-20T10:06:00.000Z',
        type: 'tool_call',
        pct: 12,
      },
    ]);

    expect(session.progressPct).toBe(100);
  });

  it.each([
    [-15, 0],
    [0, 0],
    [63.5, 63.5],
    [140, 100],
  ])('clamps numeric progress %s to %s', (pct, expected) => {
    const session = loadWorkSession().normalize({}, {}, {}, [
      {
        timestamp: '2026-07-20T10:00:00.000Z',
        type: 'progress',
        pct,
      },
    ]);

    expect(session.progressPct).toBe(expected);
  });

  it('returns null when no progress event has a finite numeric percentage', () => {
    const session = loadWorkSession().normalize({}, {}, {}, [
      {
        timestamp: '2026-07-20T10:00:00.000Z',
        type: 'progress',
        pct: Number.NaN,
      },
      {
        timestamp: '2026-07-20T10:01:00.000Z',
        type: 'progress',
        pct: Number.POSITIVE_INFINITY,
      },
    ]);

    expect(session.progressPct).toBeNull();
  });

  it('flattens structured message tool calls and ignores malformed optional shapes', () => {
    const session = loadWorkSession().normalize(
      null,
      {
        timeline: 'not-an-array',
        artifacts: [null, 'not-an-object'],
        proposals: {},
        approvals: 2,
      },
      {
        messages: [
          null,
          {},
          { toolCalls: 'not-an-array' },
          {
            toolCalls: [
              null,
              { id: 'read-1', name: 'read_file', input: { path: 'a.ts' } },
            ],
          },
          { toolCalls: [{ id: 'test-1', name: 'run_tests' }] },
        ],
      },
      { events: 'not-an-array' },
    );

    expect(session).toMatchObject({
      id: '',
      group: '',
      mode: '',
      status: 'unknown',
      currentStep: '',
      startedAt: '',
      updatedAt: '',
      progressPct: null,
      timeline: [],
      changedFiles: [],
      artifacts: [],
      proposals: [],
      approvals: [],
    });
    expect(session.toolCalls.map((toolCall) => toolCall.id)).toEqual([
      'read-1',
      'test-1',
    ]);
  });

  it('collects files, artifacts, deliverables, proposals, and approvals without sharing inputs', () => {
    const summary = {
      changedFiles: ['src/summary.ts'],
      artifacts: [{ id: 'summary-artifact', meta: { source: 'summary' } }],
    };
    const cockpit = {
      changedFiles: ['src/cockpit.ts'],
      timeline: [
        {
          id: 'timeline-1',
          timestamp: '2026-07-20T10:00:00.000Z',
          type: 'progress',
          pct: 50,
          meta: { source: 'cockpit' },
        },
      ],
      artifacts: [{ id: 'cockpit-artifact' }],
      deliverables: [{ id: 'deliverable-1', format: 'markdown' }],
      proposals: [{ id: 'proposal-1' }],
      approvals: [{ id: 'approval-1', status: 'pending' }],
    };
    const structured = {
      changedFiles: ['src/structured.ts', 'src/summary.ts'],
      messages: [
        {
          toolCalls: [
            {
              id: 'tool-1',
              name: 'write_file',
              input: { path: 'src/structured.ts' },
            },
          ],
        },
      ],
      artifacts: [{ id: 'structured-artifact' }],
      proposals: [{ id: 'proposal-2' }],
      approvals: [{ id: 'approval-2', status: 'approved' }],
    };
    const stream = {
      events: [
        {
          id: 'stream-1',
          timestamp: '2026-07-20T10:01:00.000Z',
          type: 'tool_result',
          detail: { ok: true },
        },
      ],
    };
    const before = structuredClone({ summary, cockpit, structured, stream });

    const session = loadWorkSession().normalize(
      summary,
      cockpit,
      structured,
      stream,
    );

    expect({ summary, cockpit, structured, stream }).toEqual(before);
    expect(session.changedFiles).toEqual([
      'src/cockpit.ts',
      'src/summary.ts',
      'src/structured.ts',
    ]);
    expect(session.artifacts.map((artifact) => artifact.id)).toEqual([
      'cockpit-artifact',
      'deliverable-1',
      'summary-artifact',
      'structured-artifact',
    ]);
    expect(session.proposals.map((proposal) => proposal.id)).toEqual([
      'proposal-1',
      'proposal-2',
    ]);
    expect(session.approvals.map((approval) => approval.id)).toEqual([
      'approval-1',
      'approval-2',
    ]);

    session.timeline[0].meta = { changed: true };
    session.toolCalls[0].input = { path: 'changed.ts' };
    (session.artifacts[2].meta as Record<string, string>).source = 'changed';
    session.changedFiles.push('src/changed.ts');

    expect({ summary, cockpit, structured, stream }).toEqual(before);
  });
});
