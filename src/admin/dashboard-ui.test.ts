import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const dashboardPath = path.join(
  process.cwd(),
  'src/admin/public/pages/dashboard.js',
);
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Dashboard priority queue UI', () => {
  it('pulls cross-surface work into the command dashboard', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');

    expect(source).toContain("api('/approvals?status=pending&limit=5')");
    expect(source).toContain("api('/projects')");
    expect(source).toContain("api('/tasks')");
    expect(source).toContain('Priority queue');
    expect(source).toContain('MCP approval');
    expect(source).toContain('Cowork project');
    expect(source).toContain("actionLabel: 'Cowork'");
    expect(source).toContain("['Editor', 'Edit files'");
    expect(source).toContain("['Assign task', 'Tasks, issues, auto-pickup'");
    expect(source).toContain("navigate('approvals')");
    expect(source).toContain("navigate('tasks')");
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("sessionStorage.setItem('project_focus_id'");
  });

  it('adds a daily operating brief with the next best action', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');

    expect(source).toContain('dash-daily-brief');
    expect(source).toContain('Daily brief');
    expect(source).toContain('dailyBriefTone');
    expect(source).toContain('dailyBriefTitle');
    expect(source).toContain('dailyBriefAction');
    expect(source).toContain('nextBest');
    expect(source).toContain('Pick a project and move it forward');
    expect(source).toContain('Start with Copilot or a project');
    expect(source).toContain('dailyBriefStats');
    expect(source).toContain('dashboardOperatingBriefText');
    expect(source).toContain('NanoCrab operating brief');
    expect(source).toContain('window._dashboardOperatingBrief');
    expect(source).toContain('window._dashboardDataHealthState');
    expect(source).toContain('Data health:');
    expect(source).toContain('Dashboard feeds loaded without known fallback.');
    expect(source).toContain('renderDashboardDataHealthChip');
    expect(source).toContain('dashboard-data-health-chip');
    expect(source).toContain('updateDashboardRefreshDataHealth');
    expect(source).toContain(
      'Dashboard smart refresh cockpit feed unavailable',
    );
    expect(source).toContain('baseLoadIssues');
    expect(source).toContain('refreshIssues');
    expect(source).toContain('Data confidence');
    expect(source).toContain('copyDashboardOperatingBrief');
    expect(source).toContain('Copy brief');
    expect(source).toContain('Dashboard brief copied');
    expect(source).toContain('dashboardKickoffPromptText');
    expect(source).toContain('Start my NanoCrab work session.');
    expect(source).toContain('window._dashboardKickoffPrompt');
    expect(source).toContain('copyDashboardKickoffPrompt');
    expect(source).toContain('Copy kickoff prompt');
    expect(source).toContain('Dashboard kickoff prompt copied');
    expect(source).toContain('Copy dashboard kickoff prompt');
    expect(source).toContain(
      'Return a short plan with the first workspace to open',
    );
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("window.prompt('Copy dashboard brief:'");
    expect(source).not.toContain(
      "window.prompt('Copy dashboard kickoff prompt:'",
    );
    expect(source).toContain(
      'Use this brief to decide whether to start in Copilot, Cowork, Code, Approvals, or Routines.',
    );
  });

  it('shows dashboard feed confidence instead of hiding partial load failures', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain("loadIssues.push('Cockpit run feed unavailable')");
    expect(source).toContain("loadIssues.push('Approval queue unavailable')");
    expect(source).toContain(
      "loadIssues.push('Cowork project list unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Routine schedule list unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Copilot job queue unavailable')",
    );
    expect(source).toContain('Review dashboard data confidence');
    expect(source).toContain('dashboard feed${loadIssues.length === 1 ?');
    expect(source).toContain("navigate('monitoring')");
    expect(source).toContain('Open monitoring');
    expect(source).toContain('dash-data-health is-warning');
    expect(source).toContain('dash-data-health is-ready');
    expect(source).toContain('feedsReady: loadIssues.length === 0');
    expect(source).toContain('Promise.allSettled');
    expect(source).toContain("api('/sessions/cockpit'),");
    expect(source).toContain(
      "updateDashboardRefreshDataHealth(['Dashboard smart refresh cockpit feed unavailable'])",
    );
    expect(source).toContain('updateDashboardRefreshDataHealth([])');
    const mainLoadBlock = source.slice(
      source.indexOf(
        'const [d, cockpitData, approvalData, projectData, taskData, copilotJobsData]',
      ),
      source.indexOf(
        'const channels = Array.isArray(d.channels)',
        source.indexOf('const [d, cockpitData'),
      ),
    );
    expect(mainLoadBlock).not.toContain(
      "api('/sessions/cockpit').catch(() => [])",
    );
    expect(mainLoadBlock).not.toContain(
      "api('/approvals?status=pending&limit=5').catch(() => [])",
    );
    expect(mainLoadBlock).not.toContain("api('/tasks').catch(() => [])");
    expect(mainLoadBlock).not.toContain("api('/copilot/jobs').catch(() => [])");
    expect(style).toContain('.dash-data-health');
    expect(style).toContain('.dash-data-health.is-warning');
    expect(style).toContain('.dash-data-health.is-ready');
  });

  it('uses specific recovery copy for dashboard operational actions', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');
    const start = source.indexOf('function dashboardActionErrorMessage');
    const end = source.indexOf('window.restartChannel', start);
    const actionBlock = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(actionBlock).toContain('Channel restart was not queued');
    expect(actionBlock).toContain(
      'Check channel credentials, adapter health, and monitoring logs',
    );
    expect(source).toContain("dashboardActionErrorMessage('restart-channel'");
    expect(source).not.toContain("toast(r.error || 'Failed', 'error')");
  });

  it('turns empty dashboard panels into guided next actions', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');

    expect(source).toContain('function dashEmptyState');
    expect(source).toContain('dash-empty-state is-');
    expect(source).toContain('Connect a place where NanoCrab can listen.');
    expect(source).toContain('Register the first assistant workspace.');
    expect(source).toContain('No agent work is running right now.');
    expect(source).toContain('No recent assistant replies yet.');
    expect(source).toContain('No recent conversation sample yet.');
    expect(source).toContain(
      'When Cowork, Code, Copilot, or scheduled tasks launch agent work',
    );
    expect(source).toContain('No urgent work needs attention.');
    expect(source).toContain('Select a run to inspect evidence.');
    expect(source).toContain(
      'Choose a cockpit run from the list, or start Cowork project work',
    );
    expect(source).toContain('No message history is available yet.');
    expect(source).toContain(
      'Start in Copilot, connect a channel, or review Messages',
    );
    expect(source).toContain("navigate('channels')");
    expect(source).toContain("navigate('integrations')");
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('tasks')");
    expect(source).toContain("navigate('chat')");
    expect(source).toContain("navigate('sessions')");
    expect(source).not.toContain(
      '<div class="dash-empty">No channels configured yet.</div>',
    );
    expect(source).not.toContain(
      '<div class="dash-empty">No registered agents yet.</div>',
    );
    expect(source).not.toContain(
      '<div class="dash-empty">No active agents. Launch one from Agents.</div>',
    );
    expect(source).not.toContain(
      '<div class="dash-empty">No recent bot responses.</div>',
    );
    expect(source).not.toContain(
      '<div class="dash-empty">No messages in the current sample.</div>',
    );
    expect(source).not.toContain(
      '<div class="dash-empty">No agent runs captured yet.</div>',
    );
    expect(source).not.toContain(
      '<div class="dash-empty">No urgent approvals, runs, or schedules need attention.</div>',
    );
    expect(source).not.toContain(
      '<div class="dash-empty">Select a run to inspect details.</div>',
    );
    expect(source).not.toContain(
      '<div class="dash-empty">No message history yet.</div>',
    );
  });

  it('styles the priority queue as a dense triage surface', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.dash-daily-brief');
    expect(source).toContain('.dash-daily-stats');
    expect(source).toContain('.dash-daily-actions');
    expect(source).toContain('.dash-daily-brief.is-attention');
    expect(source).toContain('.dash-priority-panel');
    expect(source).toContain('.dash-priority-list');
    expect(source).toContain('.dash-priority-item');
    expect(source).toContain('.dash-priority-action');
    expect(source).toContain('.dash-empty-state');
    expect(source).toContain('.dash-empty-actions');
    expect(source).toContain('.dash-empty-state.is-ready');
    expect(source).toContain('.dash-empty-state.is-setup');
    expect(source).toContain(
      'grid-template-columns: repeat(3, minmax(0, 1fr))',
    );
  });

  it('keeps cockpit progress bars class-based', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('cockpit-progress-fill');
    expect(source).toContain('--cockpit-progress-pct');
    expect(source).toContain('function dashProgressStyle(pct)');
    expect(source).toContain('Math.max(0, Math.min(100, numeric))');
    expect(source).toContain('${dashProgressStyle(pct)}');
    expect(source).not.toContain(
      '<div class="cockpit-progress-track"><span style="width:${pct}%"></span></div>',
    );
    expect(source).not.toContain('style="--cockpit-progress-pct:${pct}%"');
    expect(style).toContain('.cockpit-progress-fill');
    expect(style).toContain('width: var(--cockpit-progress-pct, 0%)');
  });

  it('turns quiet cockpit detail sections into routed operator hints', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function cockpitRunHandoffText');
    expect(source).toContain('NanoCrab cockpit run handoff');
    expect(source).toContain('Copy run handoff');
    expect(source).toContain('window.copyCockpitRunHandoff');
    expect(source).toContain('Cockpit run handoff copied');
    expect(source).toContain('Data health: ${loadIssues.length ?');
    expect(source).toContain('Cockpit detail loaded without known fallback.');
    expect(source).toContain('Cockpit progress stream unavailable');
    expect(source).toContain('renderCockpitDetailWarning');
    expect(source).toContain('Cockpit data needs review');
    expect(source).toContain(
      'Progress, tool, and live stream events did not load.',
    );
    expect(source).toContain('loadIssues,');
    expect(source).toContain('window._cockpitDetailById');
    expect(source).toContain('toolEvents');
    expect(source).toContain('progressEvents: progressStreamEvents');
    expect(source).toContain(
      'Use Cowork when this should become a project draft, source ledger, artifact, or MCP-backed follow-up.',
    );
    expect(source).toContain(
      'Use Code when changed files, tests, repository work, or PR evidence need continuation.',
    );
    expect(source).toContain(
      'Use Approvals before external writes, sends, document publishing, calendar edits, webhooks, or third-party mutations.',
    );
    expect(source).toContain(
      'Use Monitoring or Sessions when progress is missing, tool calls are unclear, or the run appears stalled.',
    );
    expect(source).toContain('function renderCockpitSectionEmpty');
    expect(source).toContain('function renderCockpitPreviewState');
    expect(source).toContain('cockpit-section-empty');
    expect(source).toContain('cockpit-preview-loading');
    expect(source).toContain('Loading run evidence');
    expect(source).toContain('Could not load cockpit detail');
    expect(source).toContain(
      'Gathering timeline, artifacts, deliverables, tools, progress, and approvals',
    );
    expect(source).toContain('No timeline events recorded');
    expect(source).toContain('No artifacts recorded');
    expect(source).toContain('No deliverables published');
    expect(source).toContain('No tool events recorded');
    expect(source).toContain('No progress stream yet');
    expect(source).toContain('No approvals for this run');
    expect(source).toContain(
      'Check progress or logs if the agent appears stalled.',
    );
    expect(source).toContain(
      'MCP, file, shell, and connector calls will appear here',
    );
    expect(source).toContain('Cockpit run feed unavailable.');
    expect(source).toContain('before assuming there is no active work.');
    expect(source).not.toContain(
      "const sessions = await api('/sessions/cockpit').catch(() => [])",
    );
    expect(source).not.toContain(
      "const cockpit = await api('/sessions/cockpit').catch(() => [])",
    );
    expect(source).toContain("renderCockpitSectionEmpty('timeline')");
    expect(source).toContain("renderCockpitSectionEmpty('approvals')");
    expect(source).toContain("navigate('sessions')");
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('artifacts')");
    expect(source).toContain("navigate('monitoring')");
    expect(source).toContain("navigate('approvals')");
    expect(source).not.toContain(
      '<div class="cockpit-preview-loading">Loading cockpit detail</div>',
    );
    expect(source).not.toContain(
      "loading.textContent = 'Failed to load cockpit detail'",
    );
    expect(source).not.toContain(
      '<div class="dash-empty">No timeline events.</div>',
    );
    expect(source).not.toContain(
      '<div class="dash-empty">No artifacts recorded.</div>',
    );
    expect(source).not.toContain(
      '<div class="dash-empty">No deliverables published.</div>',
    );
    expect(source).not.toContain(
      '<div class="dash-empty">No tool events recorded.</div>',
    );
    expect(source).not.toContain(
      '<div class="dash-empty">No progress stream yet.</div>',
    );
    expect(source).not.toContain(
      '<div class="dash-empty">No approvals for this run.</div>',
    );
    expect(style).toContain('.cockpit-section-empty');
    expect(style).toContain('.cockpit-detail-head-actions');
    expect(style).toContain('.cockpit-preview-loading');
    expect(style).toContain('.cockpit-preview-loading.is-error');
    expect(style).toContain('.cockpit-detail-warning');
    expect(style).toContain('.cockpit-preview-bars');
    expect(style).toContain('@keyframes cockpitPreviewLoading');
    expect(style).toContain('.cockpit-section-empty p');
    expect(style).toContain(
      '.cockpit-section-empty {\n    grid-template-columns: 1fr;',
    );
  });

  it('keeps dashboard widget visibility and edit controls class-based', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('wHiddenClass');
    expect(source).toContain("dashboard-widget${wHiddenClass('daily-brief')}");
    expect(source).toContain("dashboard-widget${wHiddenClass('priorities')}");
    expect(source).toContain(
      "dashboard-widget${wHiddenClass('workspace-lanes')}",
    );
    expect(source).toContain("dashboard-widget${wHiddenClass('cockpit')}");
    expect(source).toContain('dash-widget-hide is-hidden');
    expect(source).toContain("hiddenWidgets.length > 0 ? '' : 'is-hidden'");
    expect(source).toContain("b.classList.add('is-hidden')");
    expect(source).toContain("b.classList.remove('is-hidden')");
    expect(source).toContain("widget.classList.add('is-hidden')");
    expect(source).toContain("resetBtn.classList.remove('is-hidden')");
    expect(source).toContain(
      "live-dot ${cockpitCounts.active > 0 ? '' : 'is-hidden'}",
    );
    expect(source).toContain('onerror="this.classList.add(\'is-hidden\')"');
    expect(source).toContain("slot.classList.add('is-hidden')");
    expect(source).not.toContain('const wVis =');
    expect(source).not.toContain('style="${wVis(');
    expect(source).not.toContain(
      'class="widget-hide-btn dash-widget-hide" data-widget="${id}" onclick="hideWidget',
    );
    expect(source).not.toContain(
      "hideBtns.forEach((b) => (b.style.display = 'none'))",
    );
    expect(source).not.toContain(
      "hideBtns.forEach((b) => (b.style.display = 'block'))",
    );
    expect(source).not.toContain("if (widget) widget.style.display = 'none'");
    expect(source).not.toContain("if (resetBtn) resetBtn.style.display = ''");
    expect(source).not.toContain('onerror="this.style.display=\'none\'"');
    expect(source).not.toContain("slot.style.display = 'none'");
    expect(style).toContain('.dashboard-widget.is-hidden');
    expect(style).toContain('.dash-widget-hide.is-hidden');
    expect(style).toContain('.dashboard-toolbar-actions .is-hidden');
    expect(style).toContain('.live-dot.is-hidden');
  });

  it('centralizes reveal delay styles for dashboard rows', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');

    expect(source).toContain('function dashRevealStyle(index)');
    expect(source).toContain('Math.max(0, Math.min(24, Math.floor(numeric)))');
    expect(source).toContain('${dashRevealStyle(index)}');
    expect(source).toContain('dash-reveal');
    expect(source).not.toContain('style="--i:${index}"');
  });

  it('centralizes dashboard chart bar sizing styles', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function dashChartBarStyle(height, index)');
    expect(source).toContain('Math.max(8, Math.min(178, numericHeight))');
    expect(source).toContain(
      'Math.max(0, Math.min(60, Math.floor(numericIndex)))',
    );
    expect(source).toContain('${dashChartBarStyle(h, index)}');
    expect(source).not.toContain('style="--bar-h:${h}px;--bar-i:${index}"');
    expect(style).toContain('.dash-chart-bar');
    expect(style).toContain('height: var(--bar-h)');
  });

  it('adds live workspace lanes for Copilot, Cowork, and Code routing', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');

    expect(source).toContain("api('/copilot/jobs')");
    expect(source).toContain('Workspace lanes');
    expect(source).toContain('Choose the right focus before launching work');
    expect(source).toContain('dash-workspace-lanes');
    expect(source).toContain('workspaceLaneItems');
    expect(source).toContain('Copilot chat');
    expect(source).toContain('Projects and agent work');
    expect(source).toContain('Repository automation');
    expect(source).toContain("navigate('chat')");
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('gitcode')");
    expect(source).toContain('MCP approvals');
    expect(source).toContain('Copilot active');
    expect(source).toContain(
      'If it needs files, documents, MCP/email/calendar context, or artifacts, use Cowork and save the draft in a project first.',
    );
    expect(source).toContain(
      'If it needs repository changes, tests, GitHub Copilot, snippets, or review rules, use Code.',
    );
    expect(source).toContain(
      'If it only needs thinking, drafting, or a quick answer, use Copilot.',
    );
    expect(source).toContain(
      'Ask before external writes such as sending email, publishing documents, changing calendars, webhooks, or repo-changing actions.',
    );
  });

  it('styles workspace lanes as a responsive first-screen routing strip', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.dash-workspace-lanes');
    expect(source).toContain('.dash-workspace-grid');
    expect(source).toContain('.dash-workspace-lane');
    expect(source).toContain('.dash-workspace-lane:focus-visible');
    expect(source).toContain(
      '.dash-workspace-grid {\n    grid-template-columns: 1fr;',
    );
  });
});
