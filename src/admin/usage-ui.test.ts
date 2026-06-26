import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Usage and cost cockpit UI', () => {
  it('frames usage as spend control for agent work', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Spend control');
    expect(source).toContain('Cost cockpit');
    expect(source).toContain(
      'See what agent work costs before it surprises you',
    );
    expect(source).toContain("navigate('integrations')");
    expect(source).toContain('usage-command-center');
    expect(source).toContain('usage-budget-brief');
    expect(source).toContain('Spend decision');
    expect(source).toContain('usageCostBriefText');
    expect(source).toContain('usageSpendToWorkChecklist');
    expect(source).toContain('renderUsageSpendGate');
    expect(source).toContain('usage-spend-gate');
    expect(source).toContain('Spend-to-work gate');
    expect(source).toContain(
      'Choose the cheapest lane that can still finish the job',
    );
    expect(source).toContain(
      'Use this before long Cowork MCP reads, document generation, broad Code automation, or recurring routines',
    );
    expect(source).toContain(
      'fewer context reads, tighter prompts, and better proof',
    );
    expect(source).toContain('NanoCrab spend control brief');
    expect(source).toContain('Copy spend brief');
    expect(source).toContain('copyUsageCostBrief');
    expect(source).toContain('Usage spend brief copied');
    expect(source).toContain('usageBudgetInterventionPromptText');
    expect(source).toContain('copyUsageBudgetInterventionPrompt');
    expect(source).toContain('Copy intervention');
    expect(source).toContain('Usage intervention prompt copied');
    expect(source).toContain('Copy usage intervention prompt');
    expect(source).toContain('Create a NanoCrab budget intervention plan.');
    expect(source).toContain(
      'Return a short action plan: what to pause, what to reroute, what to batch, what budget limit to set, and which workspace should own the next request.',
    );
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("prompt('Copy usage spend brief:'");
    expect(source).not.toContain("prompt('Copy usage intervention prompt:'");
    expect(source).toContain('window._usageCostState');
  });

  it('surfaces budget risk and spend drivers before detailed tables', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Budget guardrails');
    expect(source).toContain('Spend drivers');
    expect(source).toContain('Workload planner');
    expect(source).toContain('usageWorkloadPlan');
    expect(source).toContain('usageBrief');
    expect(source).toContain('Set a budget before scaling agent routines');
    expect(source).toContain('Spend is close to the configured limit');
    expect(source).toContain('id="usage-spend-drivers"');
    expect(source).toContain('top group');
    expect(source).toContain('top provider');
    expect(source).toContain('budget alerts');
    expect(source).toContain('usage-driver-card');
  });

  it('turns spend state into lane-specific Copilot, Cowork, Code, and routine guidance', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('usage-workload-planner');
    expect(source).toContain('usage-workload-card');
    expect(source).toContain('usage-spend-gate-grid');
    expect(source).toContain('usage-spend-step');
    expect(source).toContain("lane: 'Copilot'");
    expect(source).toContain("lane: 'Cowork'");
    expect(source).toContain("lane: 'Code'");
    expect(source).toContain("lane: 'Routines'");
    expect(source).toContain('Batch project and MCP work');
    expect(source).toContain('Pause broad code agents');
    expect(source).toContain("target: 'projects'");
    expect(source).toContain("target: 'gitcode'");
    expect(source).toContain(
      'Batch Cowork project, MCP, email, document, and artifact work so context is reused',
    );
    expect(source).toContain(
      'Keep Code automation scoped to specific repositories, issues, tests, or diffs when near budget limits',
    );
    expect(source).toContain(
      'Add or lower routine budgets before recurring agents generate unattended cost',
    );
    expect(source).toContain('Spend-to-work checklist');
    expect(source).toContain(
      'Route simple drafting and clarification to Copilot with a cheaper provider before using deep synthesis',
    );
    expect(source).toContain(
      'Batch Cowork MCP/document/email/artifact requests by project so one source read serves several outputs',
    );
    expect(source).toContain(
      'Require a scoped repository, issue, test target, or diff before starting Code automation',
    );
    expect(source).toContain(
      'Pause or lower routine frequency when budget alerts appear, then resume only after the next run has useful evidence',
    );
    expect(source).toContain(
      'Keep simple drafting on Copilot with a cheaper or local provider.',
    );
    expect(source).toContain(
      'Batch Cowork MCP, email, document, and artifact requests by project before reading source systems again.',
    );
    expect(source).toContain(
      'Pause broad Code automation unless there is a scoped repository, issue, test target, or diff.',
    );
    expect(source).toContain(
      'Lower or pause routine frequency until the next run has useful evidence.',
    );
    expect(source).toContain(
      'Add or lower daily/monthly budget guardrails before more unattended work starts.',
    );
  });

  it('keeps budget editing and export behavior wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('loadBudget(periodSummaries, fmtCostBig, budget)');
    expect(source).toContain('id="budget-daily"');
    expect(source).toContain('id="budget-monthly"');
    expect(source).toContain('saveBudget()');
    expect(source).toContain('window.print()');
  });

  it('uses budget recovery copy when spend guardrails fail to save', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const actions = source.slice(
      source.indexOf('function usageActionErrorMessage'),
      source.indexOf('// --- Conversation Analytics ---'),
    );

    expect(actions).toContain('usageActionErrorMessage');
    expect(actions).toContain('Budget guardrails were not saved.');
    expect(actions).toContain('Preserve the daily and monthly limits');
    expect(actions).toContain(
      'Cowork MCP reads, Code automation, or recurring routines',
    );
    expect(actions).toContain(
      "toast(usageActionErrorMessage('budget', r), 'error')",
    );
    expect(actions).toContain(
      "toast(usageActionErrorMessage('budget', err), 'error')",
    );
    expect(actions).not.toContain("toast(r.error || 'Failed', 'error')");
  });

  it('uses class-based usage tables, budget meters, and spend share bars', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('function usagePercentStyle(name, pct)');
    expect(source).toContain('function usageChartStyle(height, color)');
    expect(source).toContain('function cssVarStyle(vars, allowedVars)');
    expect(source).toContain('const allowed = new Set(allowedVars || [])');
    expect(source).toContain('/^-?\\d+(\\.\\d+)?(px|%)$/.test(stringValue)');
    expect(source).toContain('/^var\\(--[a-z0-9-]+\\)$/i.test(stringValue)');
    expect(source).toContain('function usageBudgetTone(pct)');
    expect(source).toContain("const allowed = [\n    '--usage-share'");
    expect(source).toContain('usageClampedNumber(pct, 0, 100).toFixed(1)');
    expect(source).toContain(
      'usageClampedNumber(height, 4, 180, 4).toFixed(1)',
    );
    expect(source).toContain("['--chart-height', '--chart-color']");
    expect(source).toContain('usage-chart-bar');
    expect(source).toContain('usageChartStyle(h, color)');
    expect(source).toContain('usage-table-label');
    expect(source).toContain('usage-table-cost');
    expect(source).toContain('usage-table-muted');
    expect(source).toContain('usage-share-cell');
    expect(source).toContain('usage-share-track');
    expect(source).toContain("usagePercentStyle('--usage-share', pct)");
    expect(source).toContain('usage-provider-total-row');
    expect(source).toContain('usage-scroll-table');
    expect(source).toContain('usage-budget-card');
    expect(source).toContain('usage-budget-progress-grid');
    expect(source).toContain('usage-budget-fill');
    expect(source).toContain(
      "usagePercentStyle('--usage-budget-pct', dailyPct)",
    );
    expect(source).toContain(
      "usagePercentStyle('--usage-budget-pct', monthlyPct)",
    );
    expect(source).toContain('usage-budget-edit-row');
    expect(source).toContain('renderUsageBudgetUnavailableState');
    expect(source).toContain('usage-budget-unavailable-state');
    expect(source).toContain('Budget controls unavailable');
    expect(source).toContain(
      'Spend history is still visible, but daily and monthly guardrails could not be loaded',
    );
    expect(source).toContain('Review spend brief');
    expect(source).toContain('Check Monitoring');
    expect(source).toContain('Verify System Info');
    expect(source).toContain('Retry budget controls');
    expect(source).toContain("navigate('system')");
    expect(source).toContain('renderUsageBudgetUnavailableState()');
    expect(source).not.toContain(
      '\'<div class="usage-budget-note">Budget API not available</div>\'',
    );
    expect(source).not.toContain(
      'style="--chart-height:${h}px;--chart-color:${color}"',
    );
    expect(source).not.toContain('style="--usage-share:${pct}%"');
    expect(source).not.toContain('style="--usage-budget-pct:${dailyPct}%"');
    expect(source).not.toContain('style="--usage-budget-pct:${monthlyPct}%"');
  });

  it('keeps conversation analytics stats and channel breakdown class-based', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const analyticsSource = appSource.slice(
      appSource.indexOf('async function loadConversationAnalytics'),
      appSource.indexOf('// Sessions'),
    );

    expect(analyticsSource).toContain('conversation-stats-grid');
    expect(analyticsSource).toContain('conversation-stat');
    expect(analyticsSource).toContain('conversation-stat-value');
    expect(analyticsSource).toContain('conversation-channel-breakdown');
    expect(analyticsSource).toContain('conversation-channel-title');
    expect(analyticsSource).toContain('conversation-channel-row');
    expect(analyticsSource).toContain('conversation-channel-main');
    expect(analyticsSource).toContain('conversation-channel-name');
    expect(analyticsSource).toContain('conversation-channel-metrics');
    expect(analyticsSource).toContain('conversation-channel-track');
    expect(analyticsSource).toContain('conversation-channel-fill');
    expect(analyticsSource).toContain(
      "renderConversationAnalyticsState('empty')",
    );
    expect(analyticsSource).toContain(
      "renderConversationAnalyticsState('error')",
    );
    expect(analyticsSource).toContain('--conversation-channel-pct');
    expect(analyticsSource).toContain(
      "usagePercentStyle('--conversation-channel-pct', pct)",
    );
    expect(analyticsSource).toContain('conversation-channel-count');
    expect(analyticsSource).toContain('conversation-channel-pct');
    expect(analyticsSource).toContain('conversation-channel-empty');
    expect(appSource).toContain('No message data available');
    expect(appSource).toContain('Failed to load analytics');
    expect(analyticsSource).not.toContain(
      'style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)"',
    );
    expect(analyticsSource).not.toContain(
      'style="font-size:13px;font-weight:500;text-transform:capitalize;color:var(--text)"',
    );
    expect(analyticsSource).not.toContain(
      'style="width:80px;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden"',
    );
    expect(analyticsSource).not.toContain(
      'class="stats-grid" style="margin-bottom:16px"',
    );
    expect(analyticsSource).not.toContain(
      'class="card stat" style="padding:14px;margin:0"',
    );
    expect(analyticsSource).not.toContain(
      'class="stat-value" style="font-size:22px"',
    );
    expect(analyticsSource).not.toContain(
      'style="--conversation-channel-pct:${pct}%"',
    );
    expect(styleSource).toContain('.conversation-stats-grid');
    expect(styleSource).toContain('.conversation-channel-row');
    expect(styleSource).toContain('.conversation-channel-fill');
    expect(styleSource).toContain('width: var(--conversation-channel-pct, 0%)');
    expect(styleSource).toContain('.conversation-channel-empty');
  });

  it('uses actionable empty and recovery states for missing usage data', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('renderUsageChartEmptyState');
    expect(source).toContain('renderUsageLoadErrorState');
    expect(source).toContain('renderUsageLoadingState');
    expect(source).toContain('renderConversationAnalyticsState');
    expect(source).toContain('Loading usage cockpit');
    expect(source).toContain('Loading budget controls');
    expect(source).toContain('Loading conversation analytics');
    expect(source).toContain("renderUsageLoadingState('overview')");
    expect(source).toContain("renderUsageLoadingState('budget')");
    expect(source).toContain("renderUsageLoadingState('analytics')");
    expect(source).toContain('No chart data yet');
    expect(source).toContain(
      'Run a Copilot, Cowork, Code, or scheduled agent task',
    );
    expect(source).toContain('Usage data could not be loaded');
    expect(source).toContain(
      'Send a plain chat, start a Cowork project thread, or connect a channel',
    );
    expect(source).toContain("navigate('monitoring')");
    expect(source).not.toContain(
      'el.innerHTML = \'<div class="loading">Loading usage data</div>\'',
    );
    expect(source).not.toContain('<div class="loading">Loading budget</div>');
    expect(source).not.toContain(
      '<div class="loading">Loading analytics</div>',
    );
    expect(source).not.toContain('return \'<div class="empty">No data</div>\'');
    expect(source).not.toContain(
      'el.innerHTML = \'<div class="card empty">Failed to load usage data</div>\'',
    );
    expect(source).not.toContain(
      'el.innerHTML = \'<div class="empty">No message data available</div>\'',
    );
    expect(source).not.toContain(
      'el.innerHTML = \'<div class="empty">Failed to load analytics</div>\'',
    );
    expect(styleSource).toContain('.usage-empty-state');
    expect(styleSource).toContain('.usage-chart-empty-state');
    expect(styleSource).toContain('.usage-load-error-state');
    expect(styleSource).toContain('.usage-loading-state');
    expect(styleSource).toContain('.usage-loading-state::after');
    expect(styleSource).toContain('.usage-loading-flow');
    expect(styleSource).toContain('@keyframes usageLoadingSweep');
    expect(styleSource).toContain(
      '.conversation-analytics-empty-state.is-error',
    );
    expect(styleSource).toContain('.usage-budget-unavailable-state');
    expect(styleSource).toContain('.usage-budget-unavailable-flow');
    expect(styleSource).toContain('.usage-budget-unavailable-actions');
    expect(styleSource).toContain('.usage-empty-flow');
    expect(styleSource).toContain('.usage-empty-actions');
  });

  it('styles the usage surface as a responsive cost cockpit', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.usage-command-center');
    expect(source).toContain('.usage-budget-brief');
    expect(source).toContain('.usage-budget-brief.is-attention');
    expect(source).toContain('.usage-budget-facts');
    expect(source).toContain('.usage-command-stats');
    expect(source).toContain('.usage-work-grid');
    expect(source).toContain('.usage-budget-form');
    expect(source).toContain('.usage-driver-card');
    expect(source).toContain('.usage-workload-planner');
    expect(source).toContain('.usage-workload-grid');
    expect(source).toContain('.usage-workload-card');
    expect(source).toContain('.usage-spend-gate');
    expect(source).toContain('.usage-spend-gate-head');
    expect(source).toContain('.usage-spend-gate-grid');
    expect(source).toContain('.usage-spend-step');
    expect(source).toContain('.usage-budget-actions');
    expect(source).toContain('.usage-stat');
    expect(source).toContain('.usage-budget-card');
    expect(source).toContain('.usage-budget-progress-grid');
    expect(source).toContain('.usage-share-cell');
    expect(source).toContain('.usage-scroll-table');
    expect(source).toContain('.conversation-stats-grid');
    expect(source).toContain('.conversation-channel-breakdown');
    expect(source).toContain(
      '.usage-command-center,\n  .usage-work-grid,\n  .usage-workload-grid,\n  .usage-spend-gate-grid,\n  .usage-budget-form',
    );
    expect(source).toContain(
      '.usage-command-center,\n  .usage-workload-planner,\n  .usage-spend-gate,\n  .usage-panel',
    );
    expect(source).toContain(
      '.usage-page-header,\n  .usage-budget-brief,\n  .usage-spend-gate-head,\n  .usage-panel-head',
    );
  });
});
