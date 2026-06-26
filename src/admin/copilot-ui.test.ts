import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const copilotPagePath = path.join(
  process.cwd(),
  'src/admin/public/pages/copilot.js',
);
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('GitHub Copilot Code focus UI', () => {
  it('frames Copilot as a Code workspace delegation surface', () => {
    const source = fs.readFileSync(copilotPagePath, 'utf8');

    expect(source).toContain('Code-focused delegation');
    expect(source).toContain('copilot-command-center');
    expect(source).toContain('Code focus');
    expect(source).toContain('copilot-handoff-brief');
    expect(source).toContain('Handoff readiness');
    expect(source).toContain('copilotHandoffFitCards');
    expect(source).toContain('renderCopilotHandoffFit');
    expect(source).toContain('copilot-fit-matrix');
    expect(source).toContain('Handoff fit');
    expect(source).toContain('Choose the Code lane before assigning work.');
    expect(source).toContain('Single GitHub issue');
    expect(source).toContain('Repeated issue pickup');
    expect(source).toContain('Open-ended code task');
    expect(source).toContain('Repo state and proof');
    expect(source).toContain('Copilot is best for a clear GitHub issue');
    expect(source).toContain('copilot-work-queue');
    expect(source).toContain('copilotHandoffBriefText');
    expect(source).toContain('copilotIssueHandoffPromptText');
    expect(source).toContain('_copilotHandoffState');
    expect(source).toContain('_copilotIssuePickerState');
    expect(source).toContain('copyCopilotHandoffBrief');
    expect(source).toContain('copyCopilotIssueBrief');
    expect(source).toContain('Copy handoff brief');
    expect(source).toContain('Copy issue brief');
    expect(source).toContain('copyTextWithFallback');
    expect(source).toContain('Copilot Code handoff brief');
    expect(source).toContain('Copilot issue handoff prompt');
    expect(source).toContain('Data health:');
    expect(source).toContain(
      'Copilot delegation feeds loaded without known fallback.',
    );
    expect(source).toContain('loadIssues');
    expect(source).toContain(
      "loadIssues.push('GitHub account list unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Copilot job queue unavailable')",
    );
    expect(source).toContain(
      'Review Copilot data confidence before assigning code work',
    );
    expect(source).toContain('Copilot feed${loadIssues.length === 1 ?');
    expect(source).toContain("label: 'Data health'");
    expect(source).toContain('Feeds need review before assignment');
    expect(source).not.toContain("api('/copilot/accounts').catch(() => [])");
    expect(source).not.toContain("api('/copilot/jobs').catch(() => [])");
    expect(source).not.toContain("prompt('Copy Copilot handoff brief:'");
    expect(source).toContain(
      'Use Copilot for clearly scoped GitHub issues that fit Code work. Use Autofix when the task needs a fuller repo pipeline, build/test loop, PR orchestration, or repeated pickup rules.',
    );
    expect(source).toContain(
      'Route to Autofix when labels, repeated pickup, build/test loops, PR orchestration, or approval gates should manage the workflow.',
    );
    expect(source).toContain(
      'Do not mix Cowork project documents, MCP/email summaries, or pure chat requests into this Code handoff.',
    );
    expect(source).toContain(
      'Do not assign more Copilot work while failed handoffs or approval gates need review.',
    );
    expect(source).toContain("navigate('agents')");
    expect(source).toContain("navigate('autofix')");
    expect(source).toContain("navigate('gitcode')");
    expect(source).toContain("navigate('approvals')");
    expect(source).toContain(
      "document.getElementById('copilot-repos')?.scrollIntoView",
    );
  });

  it('summarizes setup, account, active-job, and review status', () => {
    const source = fs.readFileSync(copilotPagePath, 'utf8');

    expect(source).toContain('copilotJobTone');
    expect(source).toContain('copilotStatusBadge');
    expect(source).toContain('activeJobs');
    expect(source).toContain('failedJobs');
    expect(source).toContain('enabledAccounts');
    expect(source).toContain('handoffTone');
    expect(source).toContain('handoffTitle');
    expect(source).toContain('handoffDetail');
    expect(source).toContain('Ready to hand off code work');
    expect(source).toContain('Review failed handoffs');
    expect(source).toContain('Needs review');
    expect(source).toContain('Throughput');
    expect(source).toContain('copilot-setup-card');
    expect(source).toContain('copilot-section-card');
    expect(source).toContain('renderCopilotEmptyState');
    expect(source).toContain('renderCopilotRecoveryState');
    expect(source).toContain('renderCopilotLoadingState');
    expect(source).toContain('copilot-empty-state');
    expect(source).toContain('copilot-recovery-state');
    expect(source).toContain('copilot-loading-state');
    expect(source).toContain('Loading Code delegation cockpit');
    expect(source).toContain('Loading repositories');
    expect(source).toContain('Loading issues');
    expect(source).toContain('Connect GitHub before delegating code work');
    expect(source).toContain('No Copilot jobs in the queue yet');
    expect(source).toContain('Copilot could not load');
    expect(source).toContain('Repository list could not load');
    expect(source).toContain('Issue list could not load');
    expect(source).toContain('Code delegation unavailable');
    expect(source).toContain('Picker unavailable');
    expect(source).toContain('copilotActionErrorMessage');
    expect(source).toContain(
      'Could not start GitHub OAuth. Check Copilot credentials, callback URL, and provider setup',
    );
    expect(source).toContain(
      'Could not remove the GitHub account. Check active jobs before retrying',
    );
    expect(source).toContain(
      'Could not refresh GitHub access. Reconnect the account if OAuth has expired',
    );
    expect(source).toContain(
      'Could not assign GitHub Copilot. Check issue permissions, Copilot access, and Code handoff readiness',
    );
    expect(source).toContain(
      'Confirm the issue is open and the account has Copilot access',
    );
    expect(source).toContain(
      'OAuth unlocks repository browsing and issue assignment.',
    );
    expect(source).toContain(
      'Escalate repeatable pickup, build/test loops, or PR orchestration.',
    );
    expect(source).toContain('copilot-count-badge');
    expect(source).toContain('copilot-remove-action');
    expect(source).toContain('Setup Required');
    expect(source).toContain('r.repo');
    expect(source).toContain('open issue');
    expect(source).not.toContain(
      'style="border-left:3px solid var(--warning);margin-bottom:16px"',
    );
    expect(source).not.toContain(
      'style="font-size:13px;color:var(--text-muted)"',
    );
    expect(source).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin:8px 0;padding-left:20px"',
    );
    expect(source).not.toContain(
      'style="font-size:11px">${window.location.origin}/api/copilot/oauth/callback',
    );
    expect(source).not.toContain('class="card" style="margin-bottom:16px"');
    expect(source).not.toContain(
      'class="badge badge-muted" style="font-size:10px"',
    );
    expect(source).not.toContain('style="color:var(--error)"');
    expect(source).not.toContain(
      'class="badge badge-success" style="font-size:10px"',
    );
    expect(source).not.toContain(
      '<div class="empty">No GitHub accounts connected. Connect an account to browse repositories and assign issues.</div>',
    );
    expect(source).not.toContain(
      '<div class="empty">No code jobs yet. Browse a repository, pick an open issue, and assign Copilot when you are ready.</div>',
    );
    expect(source).not.toContain(
      'el.innerHTML = \'<div class="loading">Loading Copilot</div>\'',
    );
    expect(source).not.toContain(
      '<div class="card"><div class="loading">Loading repos...</div></div>',
    );
    expect(source).not.toContain(
      '<div class="card"><div class="loading">Loading issues...</div></div>',
    );
    expect(source).not.toContain(
      'el.innerHTML = `<div class="card empty">Failed to load Copilot: ${esc(e.message)}</div>`',
    );
    expect(source).not.toContain(
      'container.innerHTML = `<div class="card empty">Failed: ${esc(e.message)}</div>`',
    );
    expect(source).not.toContain("toast('Failed: ' + e.message, 'error')");
    expect(source).not.toContain("toast(r.error || 'Failed', 'error')");
  });

  it('uses scannable repository and issue pickers for code handoff', () => {
    const source = fs.readFileSync(copilotPagePath, 'utf8');

    expect(source).toContain('Repository picker');
    expect(source).toContain('Issue picker');
    expect(source).toContain('copilot-picker-panel');
    expect(source).toContain('copilot-picker-row');
    expect(source).toContain('copilot-picker-meta');
    expect(source).toContain('copilot-picker-slot is-hidden');
    expect(source).toContain('hideCopilotPicker');
    expect(source).toContain("container.classList.remove('is-hidden')");
    expect(source).toContain("classList.add('is-hidden')");
    expect(source).toContain('Ready for assignment');
    expect(source).toContain('No repositories returned for this account');
    expect(source).toContain('No open issues returned for this repository');
    expect(source).toContain('copilot-picker-actions');
    expect(source).toContain('Copilot issue brief copied');
    expect(source).toContain('Open a Copilot issue picker first');
    expect(source).not.toContain(
      "document.getElementById('copilot-repos').style.display",
    );
    expect(source).not.toContain(
      "document.getElementById('copilot-issues').style.display",
    );
    expect(source).not.toContain("container.style.display = 'block'");
    expect(source).not.toContain('id="copilot-repos" style=');
    expect(source).not.toContain('id="copilot-issues" style=');
  });

  it('styles the Copilot cockpit responsively', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.copilot-command-center');
    expect(source).toContain('.copilot-command-stats');
    expect(source).toContain('.copilot-handoff-brief');
    expect(source).toContain('.copilot-handoff-actions');
    expect(source).toContain('.copilot-fit-matrix');
    expect(source).toContain('.copilot-fit-head');
    expect(source).toContain('.copilot-fit-grid');
    expect(source).toContain('.copilot-fit-card');
    expect(source).toContain('.copilot-fit-card:hover');
    expect(source).toContain('.copilot-fit-card:focus-within');
    expect(source).toContain('.copilot-work-queue');
    expect(source).toContain('.copilot-setup-card');
    expect(source).toContain('.copilot-section-card');
    expect(source).toContain('.copilot-empty-state');
    expect(source).toContain('.copilot-empty-actions');
    expect(source).toContain('.copilot-empty-steps');
    expect(source).toContain('.copilot-empty-step');
    expect(source).toContain('.copilot-loading-state');
    expect(source).toContain('.copilot-loading-state.is-page');
    expect(source).toContain('.copilot-loading-state::after');
    expect(source).toContain('.copilot-loading-flow');
    expect(source).toContain('@keyframes copilotLoadingSweep');
    expect(source).toContain('.copilot-recovery-state');
    expect(source).toContain('.copilot-recovery-actions');
    expect(source).toContain('.copilot-count-badge');
    expect(source).toContain('.copilot-remove-action');
    expect(source).toContain('.copilot-picker-slot');
    expect(source).toContain('.copilot-picker-slot.is-hidden');
    expect(source).toContain('.copilot-picker-panel');
    expect(source).toContain('.copilot-picker-row');
    expect(source).toContain('.copilot-picker-actions');
    expect(source).toContain('.copilot-picker-empty');
    expect(source).toContain('.copilot-account-row');
    expect(source).toContain('.copilot-job-row');
    expect(source).toContain('.copilot-command-stats,\n  .copilot-fit-grid,');
    expect(source).toContain(
      '.copilot-command-center,\n  .copilot-loading-state,\n  .copilot-handoff-brief,\n  .copilot-fit-matrix,',
    );
    expect(source).toContain(
      '.copilot-loading-flow {\n    grid-template-columns: 1fr;',
    );
    expect(source).toContain(
      '.copilot-picker-actions {\n    justify-content: flex-start;',
    );
  });
});
