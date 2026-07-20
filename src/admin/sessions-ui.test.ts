import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

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
    expect(source.match(/class="sessions-command-stat"/g)).toHaveLength(3);
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
    expect(source).toContain('sessionReviewPrompt');
    expect(source).toContain('sessionContinuityBriefText');
    expect(source).toContain('sessions-handoff-list');
    expect(source).toContain('session-run-facts');
    expect(source).toContain('session-file-strip');
    expect(source).toContain('session-reuse-strip');
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
    expect(source).toContain('Review prompt');
    expect(source).toContain('Resume in');
    expect(source).toContain('window.copySessionHandoff');
    expect(source).toContain('window.copySessionReviewPrompt');
    expect(source).toContain('window.resumeSessionWorkspace');
    expect(source).toContain('Use the session transcript as context');
    expect(source).toContain(
      'Review this NanoCrab agent run before continuing or closing it.',
    );
    expect(source).toContain('Recommended workspace: ${target.label}');
    expect(source).toContain(
      'State what is complete, what is blocked, and what still needs a human decision.',
    );
    expect(source).toContain(
      'Identify whether the result should become a Cowork artifact, report, memory candidate, Code follow-up, approval review, or routine.',
    );
    expect(source).toContain(
      'If external writes are involved, verify the approval record before sending, publishing, scheduling, posting webhooks, or changing repositories.',
    );
    expect(source).toContain('Session review prompt copied');
    expect(source).toContain('Copy session review prompt');
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
      'id="session-search" class="search-input" aria-label="Search sessions"',
    );
    expect(source).toContain('window._sessionGroupFilter');
    expect(source).toContain('filterSessions');
    expect(source).toContain("'session-detail'");
    expect(source).toContain('renderSessionDetail');
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
