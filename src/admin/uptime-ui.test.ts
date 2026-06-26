import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');
const mockPath = path.join(process.cwd(), 'src/admin/mock-data.ts');

describe('Uptime availability cockpit UI', () => {
  it('frames uptime as an availability cockpit', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Availability cockpit');
    expect(source).toContain('Uptime Monitoring');
    expect(source).toContain('uptime-command-center');
    expect(source).toContain('uptime-stats');
    expect(source).toContain('uptime-decision-map');
    expect(source).toContain('uptime-monitor-grid');
    expect(source).toContain('uptime-monitor-card');
    expect(source).toContain('No checks');
    expect(source).toContain('uptimeDecisionCards');
    expect(source).toContain('uptimeAgentReadinessChecklist');
    expect(source).toContain('uptimeDependencyRecoveryMatrix');
    expect(source).toContain('Agent dependency gate');
    expect(source).toContain(
      'Decide if agents can depend on this system before work starts.',
    );
    expect(source).toContain(
      'Use this for Cowork project chats, Code handoffs, scheduled tasks, MCP-backed summaries, and channel delivery.',
    );
    expect(source).toContain('Map dependency to work');
    expect(source).toContain('Verify the right signal');
    expect(source).toContain('Pick the owner route');
    expect(source).toContain('Choose fallback behavior');
    expect(source).toContain('Recovery route');
    expect(source).toContain(
      'Move failed dependencies into the right workspace.',
    );
    expect(source).toContain(
      'When a check fails, route the next action by blast radius instead of letting every agent continue as usual.',
    );
    expect(source).toContain('Dependency recovery matrix');
    expect(source).toContain('Copilot fallback');
    expect(source).toContain('Cowork pause or draft');
    expect(source).toContain('Code repair');
    expect(source).toContain('Automation hold');
    expect(source).toContain('uptimeAvailabilityBriefText');
    expect(source).toContain('NanoCrab availability brief');
    expect(source).toContain('Copy availability brief');
    expect(source).toContain('copyUptimeAvailabilityBrief');
    expect(source).toContain('Uptime availability brief copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("prompt('Copy uptime availability brief:'");
    expect(source).toContain('window._uptimeAvailabilityState');
    expect(source).toContain(
      'Decide whether agents can rely on external APIs and local services.',
    );
    expect(source).toContain(
      'Monitor inbound automation paths before assigning repo or approval work.',
    );
    expect(source).toContain(
      'Use file checks for artifact indexes, reports, and generated project context.',
    );
    expect(source).toContain(
      'Send dependency failures to the channel that owns the follow-up.',
    );
    expect(source).toContain('uptimeAgentReadinessChecklist()');
    expect(source).toContain(
      'Check external APIs, MCP servers, webhooks, and generated context freshness before starting heavy Cowork or Code automation',
    );
    expect(source).toContain(
      'Keep project chats read-only, save local artifacts, and wait before sending MCP-backed summaries or documents.',
    );
    expect(source).toContain(
      'Use Code when the failing monitor belongs to a repo, webhook receiver, test endpoint, or deployable service.',
    );
    expect(source).toContain(
      'Pause scheduled tasks and external writes until the monitor is healthy or the owner approves a narrower fallback.',
    );
    expect(source).toContain(
      'Add file freshness checks for reports, artifacts, project indexes, and generated documents that agents depend on',
    );
    expect(source).toContain(
      'Pause broad scheduled work when critical dependency monitors are down',
    );
    expect(source).toContain('No body or freshness checks are configured yet.');
    expect(source).toContain(
      'Add response-body checks for MCP, webhook, and API readiness before agents depend on them.',
    );
    expect(source).toContain(
      'Add freshness checks for reports, artifact indexes, project summaries, and generated documents that Cowork or Code work will reuse.',
    );
    expect(source).not.toContain(
      "'- No body or freshness checks configured yet'",
    );
  });

  it('keeps monitor form fields and actions wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/uptime')");
    expect(source).toContain("api('/groups')");
    expect(source).toContain('id="new-monitor-form"');
    expect(source).toContain('id="monitor-create-form"');
    expect(source).toContain('id="mon-name"');
    expect(source).toContain('id="mon-url"');
    expect(source).toContain('id="mon-method"');
    expect(source).toContain('id="mon-status"');
    expect(source).toContain('id="mon-interval"');
    expect(source).toContain('id="mon-timeout"');
    expect(source).toContain('id="mon-alert"');
    expect(source).toContain('id="mon-alert-after"');
    expect(source).toContain('id="mon-expected-body"');
    expect(source).toContain('checkMonitorNow');
    expect(source).toContain('showMonitorHistory');
    expect(source).toContain('toggleMonitor');
    expect(source).toContain('deleteMonitor');
  });

  it('uses recovery-oriented uptime action errors', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const uptimeBlock = source.slice(
      source.indexOf('function uptimeActionErrorMessage'),
      source.indexOf('async function renderMonitoringConsolidated'),
    );

    expect(uptimeBlock).toContain('function uptimeActionErrorMessage');
    expect(uptimeBlock).toContain(
      'Monitor was not created. Check the URL, expected status, alert channel, and body validation before adding it again.',
    );
    expect(uptimeBlock).toContain(
      'Monitor check did not run. Confirm the target is reachable from NanoCrab and review Monitoring logs before agents depend on it.',
    );
    expect(uptimeBlock).toContain(
      'Monitor state was not saved. Refresh the page, then confirm whether scheduled or MCP-backed work should stay paused.',
    );
    expect(uptimeBlock).toContain(
      'Monitor was not deleted. Check whether it is still referenced by automation, recovery notes, or active agent work.',
    );
    expect(uptimeBlock).toContain(
      'Monitor history could not be loaded. Retry before deciding this dependency is stable enough for agent work.',
    );
    expect(uptimeBlock).toContain(
      "toast(uptimeActionErrorMessage('create', r), 'error')",
    );
    expect(uptimeBlock).toContain(
      "toast(uptimeActionErrorMessage('check', r), 'error')",
    );
    expect(uptimeBlock).toContain(
      "toast(uptimeActionErrorMessage('toggle', r), 'error')",
    );
    expect(uptimeBlock).toContain(
      "toast(uptimeActionErrorMessage('delete', r), 'error')",
    );
    expect(uptimeBlock).not.toContain("toast(r.error || 'Failed', 'error')");
    expect(uptimeBlock).not.toContain(
      "toast(`Failed: ${r.error || 'Error'}`, 'error')",
    );
  });

  it('offers monitor starter patterns that prefill the form', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('uptimeStarters');
    expect(source).toContain('Start from a monitor pattern');
    expect(source).toContain('API health endpoint');
    expect(source).toContain('GitHub webhook receiver');
    expect(source).toContain('Fresh artifact index');
    expect(source).toContain('applyUptimeStarter');
    expect(source).toContain("form.classList.remove('is-hidden')");
    expect(source).toContain('toggleUptimeMonitorForm');
    expect(source).toContain("'mon-expected-body': starter.expectedBody");
    expect(source).toContain('form?.scrollIntoView');
  });

  it('turns an empty monitor list into a dependency setup path', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderUptimeEmptyState');
    expect(source).toContain('uptime-monitor-empty-state');
    expect(source).toContain('Dependency readiness');
    expect(source).toContain('No checks configured');
    expect(source).toContain(
      'Add the first monitor before heavier Cowork, Code, scheduled, or MCP-backed work depends on external services and generated context.',
    );
    expect(source).toContain('Start with API health');
    expect(source).toContain('Watch generated context');
    expect(source).toContain('Route ownership');
    expect(source).toContain('applyUptimeStarter(0)');
    expect(source).toContain('applyUptimeStarter(2)');
    expect(source).toContain('copyUptimeAvailabilityBrief()');
    expect(source).not.toContain(
      '\'<div class="uptime-monitor-card empty">No checks configured. Add one above.</div>\'',
    );
    expect(style).toContain('.uptime-monitor-empty-state');
    expect(style).toContain('.uptime-empty-flow');
    expect(style).toContain('.uptime-empty-flow article button');
    expect(style).toContain('.uptime-empty-actions');
    expect(style).toContain('.uptime-empty-flow,');
  });

  it('uses reusable classes for monitor form and row presentation', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('class="uptime-form-panel is-hidden"');
    expect(source).toContain('class="uptime-form-grid"');
    expect(source).toContain('class="uptime-body-editor"');
    expect(source).toContain(
      "class=\"uptime-monitor-card ${!m.enabled ? 'disabled' : m.isDown ? 'down' : 'up'}\"",
    );
    expect(source).toContain('class="uptime-monitor-head"');
    expect(source).toContain('class="uptime-monitor-title"');
    expect(source).toContain('class="uptime-monitor-last"');
    expect(source).toContain('class="uptime-monitor-error"');
    expect(source).toContain('class="uptime-monitor-cadence"');
    expect(source).toContain('class="uptime-body-checks"');
    expect(source).toContain('class="uptime-history-drawer is-hidden"');
    expect(source).toContain('uptime-monitor-empty-state');
    expect(source).toContain("el.classList.add('is-hidden')");
    expect(source).toContain("el.classList.remove('is-hidden')");
    expect(source).not.toContain('id="new-monitor-form" style="display:none"');
    expect(source).not.toContain('grid-template-columns: repeat(4, 1fr)');
    expect(source).not.toContain(
      'id="mon-expected-body" placeholder="ok=true\\nstatus=ready\\ndependencies.database.status=up" style=',
    );
    expect(source).not.toContain(
      'span style="margin-left:auto;font-size:11px;color:var(--text-muted)"',
    );
  });

  it('uses reusable classes for monitor history drawer rows', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const historyBlock = source.slice(
      source.indexOf('window.showMonitorHistory'),
      source.indexOf('window.toggleMonitor'),
    );

    expect(historyBlock).toContain('uptime-history-table');
    expect(historyBlock).toContain('uptime-history-time');
    expect(historyBlock).toContain('renderUptimeHistoryState');
    expect(historyBlock).toContain("renderUptimeHistoryState('loading'");
    expect(historyBlock).toContain("renderUptimeHistoryState('empty'");
    expect(historyBlock).toContain("renderUptimeHistoryState(\n      'error'");
    expect(historyBlock).toContain("uptimeActionErrorMessage('history', err)");
    expect(historyBlock).toContain('Array.isArray(history)');
    expect(source).toContain('function renderUptimeHistoryState');
    expect(source).toContain('Monitor history unavailable');
    expect(source).toContain('No checks recorded yet');
    expect(source).toContain(
      'Fetching recent checks so you can decide whether agents should depend on this service.',
    );
    expect(historyBlock).not.toContain(
      'class="table-wrap" style="max-height:200px;overflow-y:auto"',
    );
    expect(historyBlock).not.toContain('td style="font-size:11px"');
    expect(style).toContain('.uptime-monitor-cadence');
    expect(style).toContain('.uptime-history-state');
    expect(style).toContain('.uptime-history-state.is-error');
    expect(style).toContain('.uptime-history-state-actions');
    expect(style).toContain('.uptime-history-loading-bars');
    expect(style).toContain('@keyframes uptimeHistoryLoading');
    expect(style).toContain('.uptime-history-table');
    expect(style).toContain('max-height: 200px');
    expect(style).toContain('.uptime-history-time');
    expect(style).toContain('font-variant-numeric: tabular-nums');
  });

  it('styles uptime cards and responsive layout', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.uptime-command-center');
    expect(source).toContain('.uptime-decision-map');
    expect(source).toContain('.uptime-decision-card');
    expect(source).toContain('.uptime-agent-gate');
    expect(source).toContain('.uptime-agent-gate-head');
    expect(source).toContain('.uptime-agent-gate-grid');
    expect(source).toContain('.uptime-agent-gate-card');
    expect(source).toContain('.uptime-recovery-matrix');
    expect(source).toContain('.uptime-recovery-head');
    expect(source).toContain('.uptime-recovery-grid');
    expect(source).toContain('.uptime-recovery-card');
    expect(source).toContain('.uptime-form-panel');
    expect(source).toContain('.uptime-form-panel.is-hidden');
    expect(source).toContain('.uptime-starter-strip');
    expect(source).toContain('.uptime-starter-grid');
    expect(source).toContain('.uptime-starter-card:focus-visible');
    expect(source).toContain('.uptime-monitor-empty-state');
    expect(source).toContain('.uptime-empty-flow');
    expect(source).toContain('.uptime-monitor-card');
    expect(source).toContain('.uptime-monitor-actions');
    expect(source).toContain('.uptime-monitor-cadence');
    expect(source).toContain('.uptime-history-drawer');
    expect(source).toContain('.uptime-history-table');
    expect(source).toContain('.uptime-decision-map,');
    expect(source).toContain('.uptime-agent-gate,');
    expect(source).toContain('.uptime-recovery-matrix,');
    expect(source).toContain('.uptime-starter-grid,');
    expect(source).toContain('.uptime-agent-gate-grid,');
    expect(source).toContain('.uptime-recovery-grid,');
    expect(source).toContain('.uptime-stats,');
  });

  it('serves mock uptime data in the live monitor shape', () => {
    const source = fs.readFileSync(mockPath, 'utf8');

    expect(source).toContain("pathname === '/uptime'");
    expect(source).toContain('enabled: true');
    expect(source).toContain('isDown: true');
    expect(source).toContain('lastResponseTime');
    expect(source).toContain('Manual index is stale');
  });
});
