import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as vm from 'node:vm';

const workSessionPath = path.join(
  process.cwd(),
  'src/admin/public/ui/work-session.js',
);
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

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
  renderRunStrip(session: Partial<WorkSessionViewModel>): string;
  renderTimeline(session: Partial<WorkSessionViewModel>): string;
  renderInspector(
    session: Partial<WorkSessionViewModel>,
    activeTab?: string,
  ): string;
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

  it('maps every Object prototype key and the prototype magic key to unknown', () => {
    const adapter = loadWorkSession();
    const prototypeKeys = [
      ...Object.getOwnPropertyNames(Object.prototype),
      'prototype',
    ];

    expect(
      [...new Set(prototypeKeys)].map((status) =>
        adapter.normalizeStatus(status),
      ),
    ).toEqual([...new Set(prototypeKeys)].map(() => 'unknown'));
  });

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
            type: 'tool_call',
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

  it('preserves producer-shaped tool call and result events that share an ID', () => {
    const session = loadWorkSession().normalize(
      {},
      {
        timeline: [
          {
            id: 'tc-stream-1',
            type: 'tool_call',
            timestamp: '2026-06-01T12:00:00.000Z',
            title: 'read_file',
            detail: 'stale cockpit input',
            status: 'running',
          },
        ],
      },
      {},
      {
        events: [
          {
            id: 'tc-stream-1',
            type: 'tool_call',
            groupJid: 'main',
            timestamp: '2026-06-01T12:00:00.000Z',
            title: 'read_file',
            detail: '{"path":"README.md"}',
            status: 'running',
            toolName: 'read_file',
          },
          {
            id: 'tc-stream-1',
            type: 'tool_result',
            groupJid: 'main',
            timestamp: '2026-06-01T12:00:00.200Z',
            title: 'Result tc-stream-1',
            detail: 'ok',
            status: 'completed',
            duration: '0.2',
          },
        ],
      },
    );

    expect(session.timeline).toHaveLength(2);
    expect(session.timeline.map((event) => event.type)).toEqual([
      'tool_call',
      'tool_result',
    ]);
    expect(session.timeline[0]).toMatchObject({
      id: 'tc-stream-1',
      detail: '{"path":"README.md"}',
      toolName: 'read_file',
    });
    expect(session.timeline[1]).toMatchObject({
      id: 'tc-stream-1',
      detail: 'ok',
      duration: '0.2',
    });
  });

  it('collapses an exact route fallback copy even when its type is relabeled', () => {
    const session = loadWorkSession().normalize(
      {},
      {
        timeline: [
          {
            id: 'session-tests',
            timestamp: '2026-07-20T10:03:00.000Z',
            type: 'test',
            title: 'Focused tests passed',
            detail: 'Route tests passed.',
          },
        ],
      },
      {},
      {
        events: [
          {
            id: 'session-tests',
            type: 'progress',
            groupJid: 'main',
            timestamp: '2026-07-20T10:03:00.000Z',
            title: 'Focused tests passed',
            detail: 'Route tests passed.',
            status: 'completed',
          },
        ],
      },
    );

    expect(session.timeline).toHaveLength(1);
    expect(session.timeline[0]).toMatchObject({
      id: 'session-tests',
      type: 'test',
      title: 'Focused tests passed',
      detail: 'Route tests passed.',
    });
  });

  it('preserves same-ID cross-surface events with distinct content or time', () => {
    const adapter = loadWorkSession();
    const cockpitEvent = {
      id: 'shared-progress',
      timestamp: '2026-07-20T10:03:00.000Z',
      type: 'test',
      title: 'Focused tests passed',
      detail: 'Route tests passed.',
    };

    const distinctContent = adapter.normalize(
      {},
      { timeline: [cockpitEvent] },
      {},
      {
        events: [
          {
            ...cockpitEvent,
            type: 'progress',
            detail: 'A different test payload.',
          },
        ],
      },
    );
    const distinctTime = adapter.normalize(
      {},
      { timeline: [cockpitEvent] },
      {},
      {
        events: [
          {
            ...cockpitEvent,
            type: 'progress',
            timestamp: '2026-07-20T10:04:00.000Z',
          },
        ],
      },
    );

    expect(distinctContent.timeline).toHaveLength(2);
    expect(distinctTime.timeline).toHaveLength(2);
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

  it('clones prototype magic keys as plain data without inherited payloads', () => {
    const payload = JSON.parse(
      '{"safeLabel":"renderer-visible","__proto__":{"inheritedPayload":"must-not-inherit"},"constructor":{"prototype":{"constructorPayload":"plain-data"}},"prototype":{"prototypePayload":"plain-data"},"nested":{"safe":true,"__proto__":{"nestedInheritedPayload":"must-not-inherit"}}}',
    ) as Record<string, unknown>;
    const objectPrototypeKeys = Object.getOwnPropertyNames(Object.prototype);

    const session = loadWorkSession().normalize({}, { artifacts: [payload] });
    const artifact = session.artifacts[0];
    const nested = artifact.nested as Record<string, unknown>;

    expect(Object.getPrototypeOf(artifact)).not.toBeNull();
    expect(Object.getPrototypeOf(nested)).not.toBeNull();
    expect(artifact.safeLabel).toBe('renderer-visible');
    expect(String(artifact)).toBe('[object Object]');
    expect(String(nested)).toBe('[object Object]');
    expect(artifact.inheritedPayload).toBeUndefined();
    expect(nested.nestedInheritedPayload).toBeUndefined();
    expect(
      ['__proto__', 'constructor', 'prototype'].every((key) =>
        Object.prototype.hasOwnProperty.call(artifact, key),
      ),
    ).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(nested, '__proto__')).toBe(
      true,
    );
    expect(JSON.parse(JSON.stringify(artifact))).toEqual(payload);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(artifact))).toEqual(
      objectPrototypeKeys,
    );
    expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(
      objectPrototypeKeys,
    );
    expect(
      Object.prototype.hasOwnProperty.call(
        Object.prototype,
        'inheritedPayload',
      ),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(
        Object.prototype,
        'nestedInheritedPayload',
      ),
    ).toBe(false);
  });
});

describe('NanoWorkSession shared views', () => {
  const session: WorkSessionViewModel = {
    id: 'session-42',
    group: 'main',
    mode: 'code',
    status: 'waiting_approval',
    currentStep: 'Review the proposed patch',
    startedAt: '2026-07-20T10:00:00.000Z',
    updatedAt: '2026-07-20T10:04:00.000Z',
    progressPct: 64,
    timeline: [
      {
        id: 'event-1',
        type: 'progress',
        timestamp: '2026-07-20T10:04:00.000Z',
        title: 'Patch ready',
        detail: 'Waiting for review',
      },
    ],
    toolCalls: [{ id: 'tool-1', name: 'apply_patch' }],
    changedFiles: ['src/admin/public/ui/work-session.js'],
    artifacts: [{ id: 'artifact-1', title: 'Review report' }],
    proposals: [{ id: 'proposal-1', title: 'Update the session shell' }],
    approvals: [
      { id: 'approval-1', status: 'pending', title: 'Apply the patch' },
      { id: 'approval-2', status: 'approved', title: 'Run focused tests' },
    ],
    canCancel: true,
    canRetry: false,
    canResume: false,
    isReadOnly: false,
  };

  it('renders a live run strip with readable status, progress, counters, and allowed actions', () => {
    const html = loadWorkSession().renderRunStrip(session);

    expect(html).toContain('class="work-session-run-strip"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Waiting for approval');
    expect(html).toContain('Review the proposed patch');
    expect(html).toContain('<progress');
    expect(html).toContain('value="64"');
    expect(html).toContain('64%');
    expect(html).toContain('class="work-session-counter"');
    expect(html).toContain('Pending approvals');
    expect(html).toContain('<strong>1</strong>');
    expect(html).toContain('data-work-session-action="review_approvals"');
    expect(html).toContain('data-work-session-action="cancel"');
    expect(html).toContain('data-session-id="session-42"');
    expect(html).not.toContain('data-work-session-action="retry"');
  });

  it('does not render Cancel or Retry when the session capabilities disallow them', () => {
    const html = loadWorkSession().renderRunStrip({
      ...session,
      status: 'completed',
      canCancel: false,
      canRetry: false,
      canResume: true,
    });

    expect(html).toContain('data-work-session-action="resume"');
    expect(html).not.toContain('data-work-session-action="cancel"');
    expect(html).not.toContain('data-work-session-action="retry"');
  });

  it.each([
    ['unknown', false, []],
    ['interrupted', false, []],
    ['running', true, []],
    ['running', false, ['resume', 'cancel']],
    ['waiting_approval', false, ['review_approvals', 'cancel']],
    ['failed', false, ['retry']],
    ['cancelled', false, ['retry']],
    ['completed', false, ['resume']],
  ])(
    'gates hostile capability flags for %s status (read-only: %s)',
    (status, isReadOnly, expectedActions) => {
      const adapter = loadWorkSession();
      const hostileSession = {
        ...session,
        status,
        canCancel: true,
        canRetry: true,
        canResume: true,
        isReadOnly,
      };
      const html = adapter.renderRunStrip(hostileSession);
      const actions = Array.from(
        html.matchAll(/data-work-session-action="([^"]+)"/g),
        (match) => match[1],
      );

      expect(actions).toEqual(expectedActions);
      expect(adapter.nextAction(hostileSession)).toBe(
        expectedActions[0] || null,
      );
    },
  );

  it('renders an ordered timeline and escapes producer-controlled content', () => {
    const html = loadWorkSession().renderTimeline({
      ...session,
      timeline: [
        ...session.timeline,
        {
          type: 'tool_result',
          timestamp: '2026-07-20T10:05:00.000Z',
          title: '<img src=x onerror=alert(1)>',
          detail: 'Result & evidence',
        },
      ],
    });

    expect(html).toContain('<ol class="work-session-timeline"');
    expect(html).toContain('Patch ready');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Result &amp; evidence');
    expect(html).not.toContain('<img src=x');
  });

  it('treats a timeline with only malformed entries as explicitly empty', () => {
    const html = loadWorkSession().renderTimeline({
      ...session,
      timeline: [null, 'not-an-event'] as unknown as Array<
        Record<string, unknown>
      >,
    });

    expect(html).toContain('<ol class="work-session-timeline"');
    expect(html).toContain('No timeline recorded');
  });

  it('renders exactly the seven inspector tabs with non-modal region and tab semantics', () => {
    const html = loadWorkSession().renderInspector(session, 'approvals');

    expect(html).toContain('class="work-session-inspector"');
    expect(html).toContain('role="region"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('aria-modal');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('role="tablist"');
    expect((html.match(/role="tab"/g) || []).length).toBe(7);
    expect((html.match(/data-work-session-tab=/g) || []).length).toBe(7);
    expect(html).toContain('data-work-session-tab="approvals"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tabpanel"');
    const selectedTabId = html.match(
      /id="([^"]+-approvals-tab)" role="tab"[^>]+aria-selected="true"/,
    )?.[1];
    expect(selectedTabId).toBeTruthy();
    expect(html).toContain(`aria-labelledby="${selectedTabId}"`);
    expect(html).toContain('Pending approvals');
    expect(html).toContain('<strong>1</strong>');
    expect(html).toContain('Apply the patch');
  });

  it.each([
    ['timeline', 'No timeline recorded'],
    ['tools', 'No tool calls recorded'],
    ['files', 'No files recorded'],
    ['proposals', 'No proposals recorded'],
    ['approvals', 'No approvals recorded'],
    ['artifacts', 'No artifacts recorded'],
  ])('renders an explicit empty state for the %s tab', (tab, message) => {
    const html = loadWorkSession().renderInspector(
      {
        ...session,
        timeline: [],
        toolCalls: [],
        changedFiles: [],
        proposals: [],
        approvals: [],
        artifacts: [],
      },
      tab,
    );

    expect(html).toContain(message);
  });

  it('falls back to Overview for an unsupported tab and escapes session IDs in actions', () => {
    const adapter = loadWorkSession();
    const inspector = adapter.renderInspector(session, 'constructor');
    const strip = adapter.renderRunStrip({
      ...session,
      id: 'session-42" onmouseover="alert(1)',
    });

    expect(inspector).toContain('data-work-session-tab="overview"');
    expect(inspector).toContain('aria-selected="true"');
    expect(inspector).toContain('Session overview');
    expect(strip).toContain(
      'data-session-id="session-42&quot; onmouseover=&quot;alert(1)"',
    );
    expect(strip).not.toContain('data-session-id="session-42" onmouseover=');
  });

  it('uses deterministic collision-resistant DOM IDs and matching ARIA references', () => {
    const adapter = loadWorkSession();
    const sessionIds = ['', 'session', '😀', 'team/main', 'team main'];
    const outputs = sessionIds.map((id) =>
      adapter.renderInspector({ ...session, id }, 'tools'),
    );
    const titleIds = outputs.map(
      (html) => html.match(/<h2 id="([^"]+)">/)?.[1],
    );

    expect(new Set(titleIds).size).toBe(sessionIds.length);
    expect(titleIds.every((id) => /^[a-zA-Z0-9_-]+$/.test(id || ''))).toBe(
      true,
    );
    outputs.forEach((html, index) => {
      const titleId = titleIds[index];
      const selectedTabId = html.match(
        /id="([^"]+-tools-tab)" role="tab"[^>]+aria-selected="true"/,
      )?.[1];
      expect(html).toContain(`role="region" aria-labelledby="${titleId}"`);
      expect(selectedTabId).toBeTruthy();
      expect(html).toContain(
        `role="tabpanel" aria-labelledby="${selectedTabId}"`,
      );
      expect(
        adapter.renderInspector({ ...session, id: sessionIds[index] }, 'tools'),
      ).toBe(html);
    });
  });

  it('defines token-based responsive run-strip and inspector layouts for a 390px viewport', () => {
    const style = fs.readFileSync(stylePath, 'utf8');
    const responsiveStart = style.indexOf(
      '@media (max-width: 480px) {\n  .work-session-run-strip',
    );
    const responsiveEnd = style.indexOf(
      '@media (max-width: 480px) {',
      responsiveStart + 1,
    );
    const responsive = style.slice(responsiveStart, responsiveEnd);

    expect(style).toContain('.work-session-run-strip');
    expect(style).toContain('.work-session-counter');
    expect(style).toContain('.work-session-inspector');
    expect(style).toContain('.work-session-tabs');
    expect(style).toContain('background: var(--surface)');
    expect(style).toContain('border: 1px solid var(--border)');
    expect(responsiveStart).toBeGreaterThan(-1);
    expect(responsive).toContain('grid-template-columns: 1fr');
    expect(responsive).toContain('.work-session-run-status');
    expect(responsive).toContain('.work-session-actions');
    expect(responsive).toContain(
      '.focus-stack-inspector.is-open .work-session-inspector',
    );
    expect(responsive).not.toContain(
      '.work-session-inspector {\n    position: fixed',
    );
    expect(responsive).not.toContain('inset: auto 0 0');
    expect(responsive).toContain('overflow-x: auto');
  });
});
