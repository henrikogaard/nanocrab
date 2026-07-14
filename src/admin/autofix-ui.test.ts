import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const pagePath = path.join(process.cwd(), 'src/admin/public/pages/autofix.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('GitHub Autofix Code automation UI', () => {
  it('frames Autofix as a Code automation command center', () => {
    const source = fs.readFileSync(pagePath, 'utf8');

    expect(source).toContain('function renderAutofixCommandCenter');
    expect(source).toContain('Code automation');
    expect(source).toContain(
      'Turn labeled GitHub issues into reviewed branches',
    );
    expect(source).toContain('GitHub automation is blocked');
    expect(source).toContain('Review before Autofix continues');
    expect(source).toContain('Ready to pick the next issue');
    expect(source).toContain('autofixReadinessBriefText');
    expect(source).toContain('_autofixReadinessState');
    expect(source).toContain('copyAutofixReadinessBrief');
    expect(source).toContain('Copy readiness brief');
    expect(source).toContain('copyTextWithFallback');
    expect(source).toContain('Autofix readiness brief');
    expect(source).toContain('Data health:');
    expect(source).toContain('Autofix feeds loaded without known fallback.');
    expect(source).toContain(
      'Review Autofix data confidence before enabling pickup',
    );
    expect(source).toContain('Data ${loadIssues.length ?');
    expect(source).not.toContain("prompt('Copy Autofix readiness brief:'");
    expect(source).toContain(
      'Pause automatic pickup while webhook health is blocked, review gates are waiting, failed jobs are unresolved, or repo changes lack verification evidence.',
    );
    expect(source).toContain(
      'Use Copilot for a single clearly scoped issue; use Autofix when the workflow should repeatedly pick labeled issues and produce reviewed branches or PRs.',
    );
  });

  it('summarizes webhook readiness, watched repos, scans, jobs, and latest job', () => {
    const source = fs.readFileSync(pagePath, 'utf8');

    expect(source).toContain('enabledAutoPickCount');
    expect(source).toContain('webhookHealth?.status');
    expect(source).toContain('watched repo');
    expect(source).toContain('scheduled scan');
    expect(source).toContain('recent job');
    expect(source).toContain('loadIssues');
    expect(source).toContain(
      "loadIssues.push('Autofix project list unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Autofix job queue unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Group delivery targets unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Coding runtime catalog unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('GitHub webhook health unavailable')",
    );
    expect(source).toContain('Autofix feed${loadIssues.length === 1 ?');
    expect(source).toContain(
      'did not load. Check Monitoring, Webhooks, Git & Code',
    );
    expect(source).toContain('Latest job');
    expect(source).toContain('autofix-health-grid');
    expect(source).not.toContain("api('/autofix/projects').catch(() => [])");
    expect(source).not.toContain("api('/autofix/jobs').catch(() => [])");
    expect(source).not.toContain("api('/groups').catch(() => [])");
    expect(source).not.toContain(
      "api('/agents/coding/runtimes').catch(() => [])",
    );
    expect(source).not.toContain(
      "api('/webhooks/github-health').catch(() => null)",
    );
  });

  it('uses complete runtime compatibility metadata for Autofix choices', () => {
    const source = fs.readFileSync(pagePath, 'utf8');

    expect(source).toContain("api('/agents/coding/runtimes')");
    expect(source).toContain('normalizeCodingRuntimeCatalog');
    expect(source).toContain('loadIssues.push(runtimeCatalog.error)');
    expect(source).toContain('Runner CLI');
    expect(source).toContain('Provider');
    expect(source).toContain('Model');
    expect(source).toContain('autofixRuntimeOptionsForCli');
    expect(source).toContain('autofixRuntimeOptionsForProvider');
    expect(source).toContain('readiness.detail');
    expect(source).toContain("readiness.status === 'healthy'");
    expect(source).toContain(
      "Devin sends the prompt, selected repository content, and tool results to Devin's external service.",
    );
    expect(source).toContain('runtime: { cli, provider, model }');
    expect(source).toContain('actualRuntime: { cli, provider, model }');
    expect(source).not.toContain("provider === 'devin'");
  });

  it('renders the complete actual coding runtime on projects and jobs', () => {
    const source = fs.readFileSync(pagePath, 'utf8');

    expect(source).toContain('function runtimeLabel(runtime)');
    expect(source).toContain('runtimeLabel(');
    expect(source).toContain('j.actualRuntime || {');
    expect(source).toContain('cli: j.runnerCli');
    expect(source).toContain(
      "[runtime.cli, runtime.provider, runtime.model].join(' / ')",
    );
  });

  it('keeps scan, add project, webhook, issue picking, and review actions wired', () => {
    const source = fs.readFileSync(pagePath, 'utf8');

    expect(source).toContain('autofixRunAutoPickNow(this)');
    expect(source).toContain('autofix-add-form');
    expect(source).toContain('toggleAutofixAddForm');
    expect(source).toContain('autofix-form-panel is-hidden');
    expect(source).toContain("form.classList.toggle('is-hidden'");
    expect(source).toContain("document.getElementById('af-owner')?.focus()");
    expect(source).toContain('toggleAutofixPanel');
    expect(source).toContain('autofix-panel-slot is-hidden');
    expect(source).toContain("panel.classList.toggle('is-hidden'");
    expect(source).toContain(
      "toggleAutofixPanel('autofix-issue-picker', true)",
    );
    expect(source).toContain("toggleAutofixPanel('autofix-job-output', true)");
    expect(source).toContain("navigate('webhooks')");
    expect(source).toContain('autofixPickIssue');
    expect(source).toContain('viewAutofixJob');
    expect(source).toContain('approve-implementation');
    expect(source).toContain('approve-pr');
    expect(source).toContain('open-pr');
    expect(source).toContain('revert');
    expect(source).toContain('close-pr');
    expect(source).toContain('Open PR');
    expect(source).toContain('Revert');
    expect(source).toContain('Close PR');
    expect(source).toContain('autofixDenyNoteId');
    expect(source).toContain('autofix-deny-note-field');
    expect(source).toContain('page-header autofix-page-header');
    expect(source).toContain('autofix-page-description');
    expect(source).toContain('autofix-header-actions');
    expect(source).toContain('search-input autofix-full-input');
    expect(source).toContain('autofix-check-control');
    expect(source).toContain('autofix-form-actions');
    expect(source).toContain('card autofix-section-card');
    expect(source).toContain('renderAutofixProjectEmptyState');
    expect(source).toContain('renderAutofixIssueEmptyState');
    expect(source).toContain('renderAutofixRecoveryState');
    expect(source).toContain('renderAutofixLoadingState');
    expect(source).toContain('renderAutofixJobLoadingState');
    expect(source).toContain('Loading Autofix command center');
    expect(source).toContain('Loading matching GitHub issues');
    expect(source).toContain(
      'Checking watched repositories, recent jobs, GitHub webhook health',
    );
    expect(source).toContain(
      'Collecting branch, diff, tests, CI, and approval evidence.',
    );
    expect(source).toContain('autofix-loading-state');
    expect(source).toContain('autofix-loading-flow');
    expect(source).toContain('autofix-job-loading-state');
    expect(source).toContain('autofix-job-loading-steps');
    expect(source).toContain('autofix-empty-state');
    expect(source).toContain('autofix-recovery-state');
    expect(source).toContain('Register a repo before Autofix can pick issues');
    expect(source).toContain('No open issues matched this Autofix search');
    expect(source).toContain('Autofix could not load');
    expect(source).toContain('Issue search could not load');
    expect(source).toContain('Autofix job detail could not load');
    expect(source).toContain('Code automation unavailable');
    expect(source).toContain('Autofix detail unavailable');
    expect(source).toContain('Use Copilot instead');
    expect(source).toContain('Clear filters');
    expect(source).toContain('window._autofixActiveProjectId');
    expect(source).toContain('window._autofixActiveTriggerLabel');
    expect(source).toContain('autofix-count-badge');
    expect(source).toContain('autofix-health-row');
    expect(source).toContain('autofix-project-row');
    expect(source).toContain('autofix-job-row');
    expect(source).toContain('autofix-issue-row');
    expect(source).toContain('autofix-row-body');
    expect(source).toContain('autofix-row-actions');
    expect(source).toContain('autofix-panel-head');
    expect(source).toContain('autofix-review-head');
    expect(source).toContain('autofix-review-actions');
    expect(source).toContain('autofix-remove-action');
    expect(source).not.toContain(
      "document.getElementById('autofix-add-form').style.display",
    );
    expect(source).not.toContain(
      "document.getElementById('autofix-issue-picker').style.display",
    );
    expect(source).not.toContain(
      "document.getElementById('autofix-job-output').style.display",
    );
    expect(source).not.toContain('picker.style.display');
    expect(source).not.toContain('panel.style.display');
    expect(source).not.toContain('id="autofix-add-form" class="card" style=');
    expect(source).not.toContain('id="autofix-issue-picker" style=');
    expect(source).not.toContain('id="autofix-job-output" style=');
    expect(source).not.toContain(
      'class="page-header" style="display:flex;justify-content:space-between',
    );
    expect(source).not.toContain('style="width:100%"');
    expect(source).not.toContain(
      'style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted)',
    );
    expect(source).not.toContain('class="channel-card" style="padding:10px 0"');
    expect(source).not.toContain('class="channel-card" style="padding:8px 0"');
    expect(source).not.toContain('class="channel-card" style="padding:6px 0"');
    expect(source).not.toContain('style="flex:1');
    expect(source).not.toContain('style="display:flex;gap:4px');
    expect(source).not.toContain('style="color:var(--error)"');
    expect(source).not.toContain(
      "prompt('Reason for denying implementation?')",
    );
    expect(source).not.toContain('id="autofix-issue-results" style=');
    expect(source).not.toContain('style="font-size:9px');
    expect(source).not.toContain('style="');
    expect(source).not.toContain(
      '<div class="empty">No projects registered. Add one to get started.</div>',
    );
    expect(source).not.toContain(
      '<div class="empty">No matching open issues found.</div>',
    );
    expect(source).not.toContain(
      'el.innerHTML = `<div class="card empty">Failed to load: ${esc(e.message)}</div>`',
    );
    expect(source).not.toContain(
      'results.innerHTML = `<div class="empty">Failed: ${esc(e.message)}</div>`',
    );
    expect(source).not.toContain(
      'panel.innerHTML = `<div class="card empty">Failed: ${esc(e.message)}</div>`',
    );
    expect(source).not.toContain(
      '<div class="card"><div class="loading">Loading...</div></div>',
    );
    expect(source).not.toContain(
      'el.innerHTML = \'<div class="loading">Loading autofix</div>\'',
    );
    expect(source).not.toContain(
      '<div class="loading">Loading issues...</div>',
    );
    expect(source).not.toContain(
      'results.innerHTML = \'<div class="loading">Loading issues...</div>\'',
    );
  });

  it('exposes a GitHub issue and project-board workbench for assigning coding jobs', () => {
    const source = fs.readFileSync(pagePath, 'utf8');

    expect(source).toContain('GitHub workbench');
    expect(source).toContain('Project boards');
    expect(source).toContain('Assign coding task');
    expect(source).toContain('renderAutofixWorkbench');
    expect(source).toContain('autofixOpenWorkbench');
    expect(source).toContain('autofixLoadWorkbench');
    expect(source).toContain('autofixAssignIssueFromWorkbench');
    expect(source).toContain('api(`/autofix/workbench?');
    expect(source).toContain("api('/autofix/workbench/assign'");
    expect(source).toContain('projectBoardsError');
    expect(source).toContain('View on GitHub');
  });

  it('uses specific recovery copy for Autofix action failures', () => {
    const source = fs.readFileSync(pagePath, 'utf8');
    const start = source.indexOf('function autofixActionErrorMessage');
    const end = source.indexOf('function renderAutofixJobLoadingState', start);
    const actionBlock = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(actionBlock).toContain('Could not add the Autofix project');
    expect(actionBlock).toContain('Could not run the auto-pick scan');
    expect(actionBlock).toContain('Could not start Autofix for this issue');
    expect(actionBlock).toContain('Could not update the Autofix job');
    expect(source).toContain("autofixActionErrorMessage('create-project'");
    expect(source).toContain("autofixActionErrorMessage('update-project'");
    expect(source).toContain("autofixActionErrorMessage('auto-pick'");
    expect(source).toContain("autofixActionErrorMessage('delete-project'");
    expect(source).toContain("autofixActionErrorMessage('run'");
    expect(source).toContain("autofixActionErrorMessage('job-action'");
    expect(source).not.toContain("toast(r.error || 'Failed'");
    expect(source).not.toContain("toast(r.error || 'Action failed'");
    expect(source).not.toContain("toast('Failed: ' + e.message");
    expect(source).not.toContain("toast(r.error || 'Auto-pick scan failed'");
  });

  it('styles Autofix as a responsive operating cockpit', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.autofix-command-center');
    expect(source).toContain('.autofix-command-main');
    expect(source).toContain('.autofix-command-facts');
    expect(source).toContain('.autofix-command-actions');
    expect(source).toContain('.autofix-command-facts span.is-warning');
    expect(source).toContain('.autofix-latest-job');
    expect(source).toContain('.autofix-health-grid');
    expect(source).toContain('.autofix-form-panel');
    expect(source).toContain('.autofix-form-panel.is-hidden');
    expect(source).toContain('.autofix-panel-slot');
    expect(source).toContain('.autofix-panel-slot.is-hidden');
    expect(source).toContain('.autofix-page-header');
    expect(source).toContain('.autofix-page-description');
    expect(source).toContain('.autofix-header-actions');
    expect(source).toContain('.autofix-full-input');
    expect(source).toContain('.autofix-check-control');
    expect(source).toContain('.autofix-form-actions');
    expect(source).toContain('.autofix-section-card');
    expect(source).toContain('.autofix-empty-state');
    expect(source).toContain('.autofix-empty-actions');
    expect(source).toContain('.autofix-empty-flow');
    expect(source).toContain('.autofix-empty-step');
    expect(source).toContain('.autofix-recovery-state');
    expect(source).toContain('.autofix-recovery-actions');
    expect(source).toContain('.autofix-loading-state');
    expect(source).toContain('.autofix-loading-state.is-cockpit');
    expect(source).toContain('.autofix-loading-state::after');
    expect(source).toContain('.autofix-loading-flow');
    expect(source).toContain('@keyframes autofixLoadingSweep');
    expect(source).toContain('.autofix-job-loading-state');
    expect(source).toContain('.autofix-job-loading-copy');
    expect(source).toContain('.autofix-job-loading-steps');
    expect(source).toContain('.autofix-count-badge');
    expect(source).toContain('.autofix-mini-badge');
    expect(source).toContain('.autofix-health-row');
    expect(source).toContain('.autofix-project-row');
    expect(source).toContain('.autofix-job-row');
    expect(source).toContain('.autofix-issue-row');
    expect(source).toContain('.autofix-row-body');
    expect(source).toContain('.autofix-row-actions');
    expect(source).toContain('.autofix-remove-action');
    expect(source).toContain('.autofix-panel-head');
    expect(source).toContain('.autofix-review-head');
    expect(source).toContain('.autofix-review-actions');
    expect(source).toContain('.autofix-deny-note-field');
    expect(source).toContain('.autofix-deny-note-field input');
    expect(source).toContain('.autofix-status-badge');
    expect(source).toContain('.autofix-issue-results');
    expect(source).toContain('.autofix-command-center,');
    expect(source).toContain('.autofix-empty-state,');
    expect(source).toContain('.autofix-empty-flow,');
  });
});
