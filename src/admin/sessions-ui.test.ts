import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');
const agentRoutesPath = path.join(process.cwd(), 'src/admin/routes/agents.ts');

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Could not extract ${start} through ${end}`);
  }
  return source.slice(startIndex, endIndex);
}

describe('Sessions handoff cockpit UI', () => {
  it('frames sessions as reusable agent run history', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Agent run history');
    expect(source).toContain('Handoff cockpit');
    expect(source).toContain(
      'what agents are doing, what needs you, and what can be reused',
    );
    expect(source).toContain("navigate('approvals')");
    expect(source).toContain("navigate('artifacts')");
    expect(source).toContain('class="sessions-command-main"');
    expect(source.match(/class="sessions-command-stat"/g)).toHaveLength(4);
    expect(source).not.toContain(
      '<button class="session-stat" onclick="navigate(\'approvals\')">',
    );
  });

  it('surfaces approvals, artifacts, files, status, and current step per run', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('sessionStatusBadge');
    expect(source).toContain('sessionPriorityLabel');
    expect(source).toContain('sessionHandoffScore');
    expect(source).toContain('sessionWorkspaceTarget');
    expect(source).toContain('sessionContinuationGuide');
    expect(source).toContain('renderSessionContinuationGuide');
    expect(source).toContain('session-continuation-guide');
    expect(source).toContain('Continuation guide');
    expect(source).toContain(
      'Choose where this run should continue before reopening it',
    );
    expect(source).toContain(
      'Old transcripts are useful only when they land in the right workspace',
    );
    expect(source).toContain('sessionHandoffPrompt');
    expect(source).toContain('sessionContinuityBriefText');
    expect(source).toContain('sessions-handoff-list');
    expect(source).toContain('NanoWorkSession.renderRunStrip');
    expect(source).toContain('NanoWorkSession.renderInspector');
    expect(source).toContain('Copy continuity brief');
    expect(source).toContain('window._sessionContinuityBrief');
    expect(source).toContain('window.copySessionContinuityBrief');
    expect(source).toContain('NanoCrab session continuity brief');
    expect(source).toContain('Highest-value continuations:');
    expect(source).toContain(
      'Use when project files, artifacts, MCP context, summaries, documents, email, or calendar context matter.',
    );
    expect(source).toContain(
      'Use before continuing runs with external sends, document publishing, webhooks, or third-party writes.',
    );
    expect(source).toContain(
      'Use Artifacts when the durable output matters more than the transcript.',
    );
    expect(source).toContain('Resume the conversation');
    expect(source).toContain('Reopen project context');
    expect(source).toContain('Continue repository work');
    expect(source).toContain('Review external actions');
    expect(source).toContain('Copy handoff');
    expect(source).toContain('Use the session transcript as context');
    expect(source).toContain(
      'State what is complete, what is blocked, and what still needs a human decision.',
    );
    expect(source).toContain(
      'Identify whether the result should become a Cowork artifact, report, memory candidate, Code follow-up, approval review, or routine.',
    );
    expect(source).toContain(
      'If external writes are involved, verify the approval record before sending, publishing, scheduling, posting webhooks, or changing repositories.',
    );
    expect(source).toContain('sessionDetailContinuationBriefText');
    expect(source).toContain('_sessionDetailContinuationState');
    expect(source).toContain('copySessionDetailContinuationBrief');
    expect(source).toContain('Copy continuation brief');
    expect(source).toContain('Session detail continuation brief');
    expect(source).toContain('Session detail continuation brief copied');
    expect(source).toContain(
      'Do not invent source results that are not visible in the transcript.',
    );
    expect(source).toContain('changedFiles');
    expect(source).toContain('currentStep');
  });

  it('adds filtering and search without losing the existing detail route', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain(
      'id="session-search" class="search-input" data-session-search aria-label="Search sessions"',
    );
    expect(source).toContain('window._sessionGroupFilter');
    expect(source).toContain('filterSessions');
    expect(source).toContain("'session-detail'");
    expect(source).toContain('renderSessionDetail');
  });

  it('uses one contextual run list and one shared work-session canvas', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('class="sessions-contextual-column"');
    expect(source).toContain('class="sessions-primary-canvas"');
    expect(source).toContain('data-session-select');
    expect(source).toContain("api('/sessions/cockpit')");
    expect(source).toContain('NanoWorkSession.normalize');
    expect(source).toContain('NanoWorkSession.renderRunStrip');
    expect(source).toContain('NanoWorkSession.renderInspector');
  });

  it('loads each detail surface independently and keeps warnings in the inspector', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('loadUnifiedSessionDetail');
    expect(source).toContain(
      '/sessions/cockpit/${encodeURIComponent(cockpitId)}',
    );
    expect(source).toContain(
      '/sessions/cockpit/${encodeURIComponent(cockpitId)}/stream',
    );
    expect(source).toContain(
      '/sessions/${encodeURIComponent(params.group)}/${encodeURIComponent(params.sessionId)}/detail',
    );
    expect(source).toContain('class="work-session-partial-warning"');
    expect(source).toContain('_sessionDetailParams');
    expect(source).toContain("'session-detail'");
  });

  it('delegates run actions through verified mutations and navigation', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('bindUnifiedSessionActions');
    expect(source).toContain('[data-work-session-action]');
    expect(source).toContain("['cancel', 'retry'].includes(action)");
    expect(source).toContain(
      '/agents/coding/jobs/${encodeURIComponent(session.id)}/${action}',
    );
    expect(source).toContain("action === 'review_approvals'");
    expect(source).toContain("action === 'handoff'");
    expect(source).toContain('await refreshUnifiedSessionDetail');
  });

  it('invalidates older and detached session renders before they can commit', async () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const guardSource = sourceBetween(
      source,
      'function createSessionRenderGuard',
      'const sessionRenderGuard',
    );
    const createGuard = new Function(
      `${guardSource}; return createSessionRenderGuard;`,
    )() as (
      currentElement: () => unknown,
      currentPage: () => string,
    ) => {
      begin(): number;
      isCurrent(
        token: number,
        element: { isConnected: boolean },
        expectedPage: string,
      ): boolean;
    };
    const currentElement = { isConnected: true };
    const detachedElement = { isConnected: false };
    let activeElement: unknown = currentElement;
    let activePage = 'sessions';
    const guard = createGuard(
      () => activeElement,
      () => activePage,
    );
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first, currentElement, 'sessions')).toBe(false);
    expect(guard.isCurrent(second, detachedElement, 'sessions')).toBe(false);
    expect(
      ((activePage = 'chat'),
      guard.isCurrent(second, currentElement, 'sessions')),
    ).toBe(false);
    expect(
      ((activePage = 'sessions'),
      (activeElement = currentElement),
      guard.isCurrent(second, currentElement, 'sessions')),
    ).toBe(true);

    const overlappingGuard = createGuard(
      () => activeElement,
      () => activePage,
    );
    let resolveFirst!: (value: string[]) => void;
    let resolveSecond!: (value: string[]) => void;
    const firstList = new Promise<string[]>((resolve) => {
      resolveFirst = resolve;
    });
    const secondList = new Promise<string[]>((resolve) => {
      resolveSecond = resolve;
    });
    const writes: string[] = [];
    const hydrate = async (request: Promise<string[]>, token: number) => {
      const sessions = await request;
      if (!overlappingGuard.isCurrent(token, currentElement, 'sessions'))
        return;
      writes.push(
        `globals:${sessions[0]}`,
        `dom:${sessions[0]}`,
        `detail:${sessions[0]}`,
      );
    };
    const firstHydration = hydrate(firstList, overlappingGuard.begin());
    const secondHydration = hydrate(secondList, overlappingGuard.begin());
    resolveSecond(['new']);
    await secondHydration;
    resolveFirst(['old']);
    await firstHydration;
    expect(writes).toEqual(['globals:new', 'dom:new', 'detail:new']);

    const renderSource = sourceBetween(
      source,
      'async function renderSessions',
      'function renderSessionList',
    );
    expect(renderSource).toContain(
      'const renderToken = sessionRenderGuard.begin()',
    );
    expect(renderSource).toContain(
      "sessionRenderGuard.isCurrent(renderToken, el, 'sessions')",
    );
    expect(renderSource.indexOf('sessionRenderGuard.isCurrent')).toBeLessThan(
      renderSource.indexOf('window._allSessions = sessions'),
    );
  });

  it('performs verified coding-job mutations without optimistic success', async () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const mutationSource = sourceBetween(
      source,
      'async function performUnifiedSessionMutation',
      'function bindUnifiedSessionActions',
    );
    const performMutation = new Function(
      `${mutationSource}; return performUnifiedSessionMutation;`,
    )() as (
      state: {
        model: { canCancel: boolean; canRetry: boolean; status: string };
        summary: { id: string; source: string };
      },
      action: 'cancel' | 'retry',
      dependencies: {
        api(path: string, options: unknown): Promise<unknown>;
        refresh(state: unknown): Promise<void>;
        toast(message: string, type: string): void;
      },
    ) => Promise<boolean>;
    const state = {
      model: { canCancel: true, canRetry: false, status: 'running' },
      summary: { id: 'code-mock-1', source: 'coding-job' },
    };
    const calls: Array<{ path: string; options: unknown }> = [];
    let refreshes = 0;
    const notices: Array<{ message: string; type: string }> = [];

    const succeeded = await performMutation(state, 'cancel', {
      api: async (path: string, options: unknown) => {
        calls.push({ path, options });
        return { ok: true };
      },
      refresh: async () => {
        refreshes += 1;
      },
      toast: (message: string, type: string) => notices.push({ message, type }),
    });

    expect(succeeded).toBe(true);
    expect(calls).toEqual([
      {
        path: '/agents/coding/jobs/code-mock-1/cancel',
        options: { method: 'POST' },
      },
    ]);
    expect(refreshes).toBe(1);
    expect(notices.at(-1)?.type).toBe('success');

    calls.length = 0;
    refreshes = 0;
    notices.length = 0;
    const snapshot = JSON.stringify(state);
    const failed = await performMutation(state, 'cancel', {
      api: async () => {
        throw new Error('rejected');
      },
      refresh: async () => {
        refreshes += 1;
      },
      toast: (message: string, type: string) => notices.push({ message, type }),
    });

    expect(failed).toBe(false);
    expect(refreshes).toBe(0);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(notices).toEqual([{ message: 'rejected', type: 'error' }]);

    let unsupportedCalls = 0;
    const unsupported = await performMutation(
      {
        model: { canCancel: false, canRetry: true, status: 'failed' },
        summary: {
          id: 'transcript:scouts:failed-run',
          source: 'transcript',
        },
      },
      'retry',
      {
        api: async () => {
          unsupportedCalls += 1;
          return { ok: true };
        },
        refresh: async () => {},
        toast: (message: string, type: string) =>
          notices.push({ message, type }),
      },
    );
    expect(unsupported).toBe(false);
    expect(unsupportedCalls).toBe(0);

    const routeSource = fs.readFileSync(agentRoutesPath, 'utf8');
    expect(routeSource).toContain("router.post('/coding/jobs/:id/cancel'");
    expect(routeSource).toContain("router.post('/coding/jobs/:id/retry'");
    expect(source).toContain("if (summary?.source !== 'coding-job')");
  });

  it('renders compact safe contextual rows without interpolated inline handlers', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const listSource = sourceBetween(
      source,
      'function renderSessionList(sessions)',
      'function unifiedSessionWarning',
    );

    expect(listSource).toContain(
      'class="sessions-handoff-item session-run-row"',
    );
    expect(listSource).toContain('data-session-select="${dependencies.esc(');
    expect(listSource).toContain(
      "aria-current=\"${selected ? 'true' : 'false'}\"",
    );
    expect(listSource).not.toContain('session-run-card');
    expect(listSource).not.toContain('session-run-facts');
    expect(listSource).not.toContain('session-file-strip');
    expect(listSource).not.toContain('session-reuse-strip');
    expect(listSource).not.toContain('onclick=');
    expect(source).toContain('data-session-group="${esc(g)}"');
    expect(source).not.toContain('onclick="filterSessions(\'${esc(g)}\')"');
    expect(source).not.toContain('onclick="copySessionHandoff(\'${esc(');
    expect(source).not.toContain('onclick="copySessionReviewPrompt(\'${esc(');
    expect(source).not.toContain('onclick="resumeSessionWorkspace(\'${esc(');
    expect(style).toContain('.session-run-row:focus-visible');
    expect(style).toContain(".session-run-row[aria-current='true']");
    const narrowRows = style.slice(
      style.indexOf('@media (max-width: 480px) {\n  .work-session-run-strip'),
      style.indexOf('@media (max-width: 480px) {\n  .login-card'),
    );
    expect(narrowRows).toContain(
      '.session-run-row {\n    grid-template-columns: 1fr;',
    );

    const rowSource = sourceBetween(
      source,
      'function renderSessionRow',
      'function unifiedSessionWarning',
    );
    const renderRow = new Function(
      `${rowSource}; return renderSessionRow;`,
    )() as (
      session: Record<string, unknown>,
      selected: boolean,
      dependencies: {
        esc(value: unknown): string;
        formatTime(value: unknown): string;
        sessionStatusBadge(session: unknown): string;
        timeAgo(value: unknown): string;
      },
    ) => string;
    const escape = (value: unknown) =>
      String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const hostile = `group'"><img src=x onerror=alert(1)>`;
    const html = renderRow(
      {
        id: hostile,
        sessionId: hostile,
        group: hostile,
        title: hostile,
        status: 'running',
      },
      true,
      {
        esc: escape,
        formatTime: () => 'now',
        sessionStatusBadge: () => '<span class="badge">Running</span>',
        timeAgo: () => 'now',
      },
    );
    expect(html).toContain(`data-session-select="${escape(hostile)}"`);
    expect(html).not.toContain('<img');
    expect(html).toContain('aria-current="true"');
  });

  it('models partial data as a rejected surface request', async () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const captureSource = sourceBetween(
      source,
      'async function captureSessionSurface',
      'async function loadUnifiedSessionDetail',
    );
    const capture = new Function(
      `${captureSource}; return captureSessionSurface;`,
    )() as (
      label: string,
      request: Promise<unknown>,
    ) => Promise<{ data: unknown; error: unknown; label: string }>;

    const available = await capture(
      'summary',
      Promise.resolve([{ id: 'one' }]),
    );
    const unavailable = await capture(
      'stream',
      Promise.reject(new Error('stream unavailable')),
    );

    expect(available).toEqual({
      data: [{ id: 'one' }],
      error: null,
      label: 'summary',
    });
    expect(unavailable.data).toBeNull();
    expect(unavailable.label).toBe('stream');
    expect(unavailable.error).toBeInstanceOf(Error);
    expect(source).not.toContain('partialData');
  });

  it('keeps mobile run, group, approval, and artifact summaries as separate nodes', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const commandCenter = source.slice(
      source.indexOf('<section class="sessions-command-center">'),
      source.indexOf('${renderSessionContinuationGuide()}'),
    );

    expect(commandCenter.match(/class="sessions-command-stat"/g)).toHaveLength(
      4,
    );
    expect(commandCenter).toContain('<span>Runs</span>');
    expect(commandCenter).toContain('<span>Groups</span>');
    expect(commandCenter).toContain('<span>Approvals</span>');
    expect(commandCenter).toContain('<span>Artifacts</span>');
  });

  it('sums real cockpit attention counts and fails malformed values closed', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const totalsSource = sourceBetween(
      source,
      'function sessionAttentionTotals',
      'async function renderSessions',
    );
    const totals = new Function(
      `${totalsSource}; return sessionAttentionTotals;`,
    )() as (sessions: Array<Record<string, unknown>>) => {
      approvals: number;
      artifacts: number;
    };

    expect(
      totals([
        { approvalCount: 2, artifactCount: 3 },
        { approvalCount: 1, artifactCount: 4 },
        { approvalCount: 0, artifactCount: 0 },
      ]),
    ).toEqual({ approvals: 3, artifacts: 7 });
    expect(
      totals([
        { approvalCount: -1, artifactCount: -2 },
        { approvalCount: Number.NaN, artifactCount: Number.POSITIVE_INFINITY },
        { approvalCount: '8', artifactCount: '9' },
        { approvalCount: null, artifactCount: undefined },
      ]),
    ).toEqual({ approvals: 0, artifacts: 0 });

    const renderSource = sourceBetween(
      source,
      'async function renderSessions',
      'function renderSessionList',
    );
    expect(renderSource).toContain(
      'const attention = sessionAttentionTotals(sessions)',
    );
    expect(renderSource).toContain('<strong>${attention.approvals}</strong>');
    expect(renderSource).toContain('<strong>${attention.artifacts}</strong>');
    expect(renderSource).not.toContain('session.approvals ||');
    expect(renderSource).not.toContain('session.artifacts ||');
  });

  it('uses class-based session viewer and transcript detail chrome', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('session-viewer-card');
    expect(source).toContain('session-viewer-head');
    expect(source).toContain(
      '<button type="button" class="session-detail-backlink" onclick="navigate(\'sessions\')">Sessions</button>',
    );
    expect(source).not.toContain(
      'href="#" onclick="navigate(\'sessions\');return false"',
    );
    expect(source).toContain('session-detail-separator');
    expect(source).toContain('session-detail-actions');
    expect(source).toContain('session-transcript-card');
    expect(source).toContain('renderSessionLoadingState');
    expect(source).toContain("renderSessionLoadingState('cockpit')");
    expect(source).toContain("renderSessionLoadingState('viewer')");
    expect(source).toContain("renderSessionLoadingState('detail')");
    expect(source).toContain('Loading transcript, stats, and tool evidence');
    expect(source).toContain('Loading agent run history');
    expect(source).toContain('session-msg-header-user');
    expect(source).toContain('session-msg-meta');
    expect(source).toContain('session-tool-badge');
    expect(source).toContain('session-fork-btn');
    expect(source).toContain('session-stats-menu-actions');
    expect(source).toContain('session-system-pill');
  });

  it('turns the no-session state into first-run workflow starters', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('function renderSessionsEmptyState');
    expect(source).toContain('Create the first reusable agent trail');
    expect(source).toContain('sessions-empty-state');
    expect(source).toContain('sessions-empty-card');
    expect(source).toContain("lane: 'Copilot'");
    expect(source).toContain("lane: 'Cowork'");
    expect(source).toContain("lane: 'Code'");
    expect(source).toContain("lane: 'Routines'");
    expect(source).toContain("target: 'projects'");
    expect(source).toContain("target: 'gitcode'");
  });

  it('turns filtered and blank transcript states into guided recovery paths', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderSessionListEmptyState');
    expect(source).toContain('No matching runs');
    expect(source).toContain('Bring the agent trail back into view');
    expect(source).toContain('Show all runs');
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('gitcode')");
    expect(source).toContain('function renderSessionMessagesEmptyState');
    expect(source).toContain('function renderSessionRecoveryState');
    expect(source).toContain('No transcript messages yet');
    expect(source).toContain(
      'This run has metadata, but no readable chat trail',
    );
    expect(source).toContain('Session route incomplete');
    expect(source).toContain('Session unavailable');
    expect(source).toContain('No session specified');
    expect(source).toContain('Failed to load session');
    expect(source).toContain('Back to cockpit');
    expect(source).toContain('Project context');
    expect(source).toContain('Repository work');
    expect(source).toContain('Copy continuity brief');
    expect(source).toContain("navigate('chat')");
    expect(source).toContain("navigate('sessions')");
    expect(source).not.toContain('\'<div class="empty">No sessions</div>\'');
    expect(source).not.toContain(
      '\'<div class="empty">No messages in this session</div>\'',
    );
    expect(source).not.toContain(
      'el.innerHTML = \'<div class="card empty">Failed to load sessions</div>\'',
    );
    expect(source).not.toContain(
      'viewer.innerHTML = \'<div class="card empty">Failed to load session</div>\'',
    );
    expect(source).not.toContain(
      '\'<div class="card"><div class="empty">No session specified</div></div>\'',
    );
    expect(source).not.toContain(
      'if (t) t.innerHTML = \'<div class="empty">Failed to load session</div>\'',
    );
    expect(source).not.toContain(
      'el.innerHTML = \'<div class="loading">Loading sessions</div>\'',
    );
    expect(source).not.toContain(
      'viewer.innerHTML = \'<div class="loading">Loading session</div>\'',
    );
    expect(source).not.toContain(
      '<div class="loading session-transcript-loading">Loading session...</div>',
    );
    expect(style).toContain('.sessions-filter-empty-state');
    expect(style).toContain('.sessions-filter-empty-flow');
    expect(style).toContain('.session-message-empty-state');
    expect(style).toContain('.session-message-empty-flow');
    expect(style).toContain('.session-recovery-state');
    expect(style).toContain('.session-loading-state');
    expect(style).toContain('.session-loading-state.is-detail');
    expect(style).toContain('.session-loading-copy');
    expect(style).toContain('.session-loading-steps');
    expect(style).toContain('.session-recovery-state.is-error');
    expect(style).toContain('.session-recovery-flow');
    expect(style).toContain('.session-recovery-step:focus-visible');
    expect(style).toContain('.sessions-filter-empty-step:focus-visible');
    expect(style).toContain('.session-message-empty-step:active');
  });

  it('styles sessions as a responsive cockpit with cards and a handoff rail', () => {
    const source = fs.readFileSync(stylePath, 'utf8');
    const commandStatStyles = source.slice(
      source.indexOf('.sessions-command-stat {'),
      source.indexOf('.session-continuation-guide {'),
    );

    expect(source).toContain('.sessions-command-center');
    expect(source).toContain('.sessions-command-main h2');
    expect(source).toContain('.sessions-command-stats');
    expect(source).toContain('.sessions-command-actions');
    expect(commandStatStyles).toContain('color: var(--text);');
    expect(commandStatStyles).toContain('font: inherit;');
    expect(commandStatStyles).toContain('text-align: left;');
    expect(commandStatStyles).toContain('.sessions-command-stat small');
    expect(commandStatStyles).toContain(
      'button.sessions-command-stat:focus-visible',
    );
    expect(source).toContain('.session-continuation-guide');
    expect(source).toContain('.session-continuation-grid');
    expect(source).toContain('.session-continuation-card');
    expect(source).toContain('.session-continuation-card:focus-visible');
    expect(source).toContain('.sessions-rail');
    expect(source).toContain('.sessions-handoff-item');
    expect(source).toContain('.session-viewer-card');
    expect(source).toContain('.session-msg-meta');
    expect(source).toContain('.session-system-pill');
    expect(source).toContain('.session-stats-menu-actions');
    expect(source).toContain('.session-detail-actions');
    expect(source).toContain('.session-run-card');
    expect(source).toContain('.session-run-facts');
    expect(source).toContain('.session-reuse-strip');
    expect(source).toContain('.session-reuse-actions');
    expect(source).toContain('.sessions-empty-state');
    expect(source).toContain('.sessions-empty-grid');
    expect(source).toContain('.sessions-empty-card');
    expect(source).toContain('.session-loading-state');
    expect(source).toContain('.session-loading-steps');
    expect(source).toContain('.sessions-filter-empty-state');
    expect(source).toContain('.session-message-empty-state');
    expect(source).toContain('.session-recovery-state');
    expect(source).toContain('.session-continuation-guide,');
    expect(source).toContain('.session-continuation-grid,');
    expect(source).toContain(
      '.sessions-layout {\n    grid-template-columns: 1fr !important;',
    );
  });
});
