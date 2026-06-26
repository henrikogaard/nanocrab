import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Monitoring operations cockpit UI', () => {
  it('frames monitoring as an operations pulse surface', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Operations pulse');
    expect(source).toContain('Monitoring');
    expect(source).toContain('monitoring-command-center');
    expect(source).toContain('monitoring-command-actions');
    expect(source).toContain('Copy operations brief');
    expect(source).toContain('monitoring-decision-brief');
    expect(source).toContain('monitoring-assignment-gate');
    expect(source).toContain('Operator brief');
    expect(source).toContain('renderMonitoringLoadingState');
    expect(source).toContain('monitoringAssignmentGate');
    expect(source).toContain('renderMonitoringAssignmentGate');
    expect(source).toContain('Building operator brief');
    expect(source).toContain('Reading runtime resources');
    expect(source).toContain('Preparing resource history');
    expect(source).toContain('Loading recent snapshots');
    expect(source).toContain('Resource history');
    expect(source).toContain('Recent snapshots');
  });

  it('keeps monitoring data hooks and actions wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/system')");
    expect(source).toContain("api('/providers/health')");
    expect(source).toContain("api('/providers/model-metrics')");
    expect(source).toContain("api('/dev/monitoring/history')");
    expect(source).toContain('id="monitoring-stats"');
    expect(source).toContain('id="monitoring-decision-brief"');
    expect(source).toContain('id="monitoring-health"');
    expect(source).toContain('id="model-metrics"');
    expect(source).toContain('id="monitoring-chart"');
    expect(source).toContain('id="monitoring-history"');
    expect(source).toContain("renderMonitoringLoadingState('decision')");
    expect(source).toContain("renderMonitoringLoadingState('stats')");
    expect(source).toContain("renderMonitoringLoadingState('chart')");
    expect(source).toContain("renderMonitoringLoadingState('history')");
    expect(source).toContain('runAllProbes');
    expect(source).not.toContain(
      '<div id="monitoring-decision-brief"><div class="loading">Loading</div></div>',
    );
    expect(source).not.toContain(
      '<div id="monitoring-stats"><div class="loading">Loading</div></div>',
    );
    expect(source).not.toContain(
      '<div id="monitoring-chart"><div class="loading">Loading</div></div>',
    );
    expect(source).not.toContain(
      '<div id="monitoring-history"><div class="loading">Loading</div></div>',
    );
  });

  it('uses reusable resource and history panel classes', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('monitoring-resource-grid');
    expect(source).toContain('monitoring-resource-card');
    expect(source).toContain('monitoring-resource-value');
    expect(source).toContain('resourceSignals');
    expect(source).toContain('monitoringOperationsBriefText');
    expect(source).toContain('window._monitoringOperationsState');
    expect(source).toContain('window.copyMonitoringOperationsBrief');
    expect(source).toContain('NanoCrab monitoring operations brief');
    expect(source).toContain('Runtime posture:');
    expect(source).toContain('Data health:');
    expect(source).toContain(
      'System resources, provider health, model metrics, and history loaded without known fallback.',
    );
    expect(source).toContain('Resource signals:');
    expect(source).toContain(
      'Re-probe providers before assigning long-running Cowork, Code, or scheduled work.',
    );
    expect(source).toContain(
      'Keep external MCP actions, document publishing, webhooks, and scheduled sends approval-gated while the runtime is degraded.',
    );
    expect(source).toContain(
      'Prefer Copilot or short read-only Cowork tasks when provider readiness or resource pressure is uncertain.',
    );
    expect(source).toContain('Work readiness gate:');
    expect(source).toContain('Runtime assignment gate:');
    expect(source).toContain(
      'Confirm a fresh monitoring snapshot and provider probes exist before long Cowork, Code, MCP, or scheduled runs.',
    );
    expect(source).toContain(
      'Keep heavy work paused when CPU, RAM, heap, disk, stale probes, or model reliability show attention.',
    );
    expect(source).toContain(
      'Use Copilot or read-only Cowork for diagnosis until Logs, provider health, and resource pressure are back in range.',
    );
    expect(source).toContain(
      'Require approvals for external MCP actions, document publishing, webhooks, and scheduled sends while the runtime is degraded.',
    );
    expect(source).toContain(
      'Use only short project checks until resource pressure, MCP health, and provider probes are fresh.',
    );
    expect(source).toContain(
      'Keep schedules, external MCP writes, webhooks, and document publishing paused or approval-gated.',
    );
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('workflows')");
    expect(source).toContain('renderDecisionBrief');
    expect(source).toContain('monitoringSetOperationsState');
    expect(source).toContain('monitoringRefreshDecisionBrief');
    expect(source).toContain('loadIssues');
    expect(source).toContain('providers ready');
    expect(source).toContain('Intervene before assigning heavy agent work');
    expect(source).toContain(
      'Runtime evidence needs review before heavy agent work',
    );
    expect(source).toContain('Needs review');
    expect(source).toContain('Data health</span>');
    expect(source).toContain('monitoring-history-grid');
    expect(source).toContain('monitoring-panel');
  });

  it('uses tone classes for monitoring resource bars', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const monitoringBlock = source.slice(
      source.indexOf('// --- Monitoring ---'),
      source.indexOf('// --- Deploy Pipelines ---'),
    );

    expect(monitoringBlock).toContain('monitoringFillTone');
    expect(monitoringBlock).toContain('monitoringFillStyle');
    expect(monitoringBlock).toContain('function monitoringChartStyle(height)');
    expect(source).toContain('function cssVarStyle(vars, allowedVars)');
    expect(monitoringBlock).toContain("['--monitoring-fill-width']");
    expect(monitoringBlock).toContain("['--monitoring-chart-height']");
    expect(monitoringBlock).toContain(
      'Math.max(4, Math.min(180, Number(height) || 4))',
    );
    expect(monitoringBlock).toContain('monitoring-fill ${monitoringFillTone');
    expect(monitoringBlock).toContain('${monitoringFillStyle(cpuPct)}');
    expect(monitoringBlock).toContain('${monitoringFillStyle(ramPct)}');
    expect(monitoringBlock).toContain('${monitoringFillStyle(heapPct)}');
    expect(monitoringBlock).toContain('${monitoringFillStyle(diskPct)}');
    expect(monitoringBlock).toContain('--monitoring-fill-width');
    expect(monitoringBlock).not.toContain('background:${cpuPct > 80');
    expect(monitoringBlock).not.toContain('background:${parseFloat(ramPct)');
    expect(monitoringBlock).not.toContain('background:${parseFloat(heapPct)');
    expect(monitoringBlock).not.toContain('background:${parseFloat(diskPct)');
    expect(monitoringBlock).not.toContain(
      'style="${monitoringFillStyle(cpuPct)}"',
    );
    expect(monitoringBlock).not.toContain(
      'style="${monitoringFillStyle(ramPct)}"',
    );
    expect(monitoringBlock).not.toContain(
      'style="${monitoringFillStyle(heapPct)}"',
    );
    expect(monitoringBlock).not.toContain(
      'style="${monitoringFillStyle(diskPct)}"',
    );
    expect(style).toContain('width: var(--monitoring-fill-width, 0%)');
    expect(style).toContain('.monitoring-fill.is-warning');
    expect(style).toContain('.monitoring-fill.is-danger');
  });

  it('uses class-based provider and model summary panels', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const monitoringBlock = source.slice(
      source.indexOf('// Load provider health'),
      source.indexOf('// Load history'),
    );

    expect(monitoringBlock).toContain('monitoring-summary-panel');
    expect(monitoringBlock).toContain('monitoring-summary-title');
    expect(monitoringBlock).toContain('monitoring-summary-badge');
    expect(monitoringBlock).toContain('monitoring-summary-action');
    expect(monitoringBlock).toContain('monitoring-summary-grid');
    expect(monitoringBlock).toContain('monitoring-summary-card');
    expect(monitoringBlock).toContain('monitoring-summary-label');
    expect(monitoringBlock).toContain('monitoring-summary-value');
    expect(monitoringBlock).not.toContain('style="margin:0;margin-top:16px"');
    expect(monitoringBlock).not.toContain(
      'class="grid grid-4" style="margin-bottom:12px"',
    );
    expect(monitoringBlock).not.toContain(
      'style="padding:10px;border:1px solid var(--border)',
    );
    expect(style).toContain('.monitoring-summary-panel');
    expect(style).toContain('.monitoring-summary-grid');
    expect(style).toContain('.monitoring-summary-value.is-warning');
    expect(style).toContain('.monitoring-summary-grid,');
  });

  it('uses class-based provider and model health table cells', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const monitoringBlock = source.slice(
      source.indexOf('// Load provider health'),
      source.indexOf('// Load history'),
    );

    expect(monitoringBlock).toContain('monitoring-profile-cell');
    expect(monitoringBlock).toContain('monitoring-chip-cell');
    expect(monitoringBlock).toContain('monitoring-model-cell');
    expect(monitoringBlock).toContain('monitoring-status-dot');
    expect(monitoringBlock).toContain('monitoring-status-badge');
    expect(monitoringBlock).toContain('monitoring-small-badge');
    expect(monitoringBlock).toContain('monitoring-error-note');
    expect(monitoringBlock).toContain('monitoring-muted-cell');
    expect(monitoringBlock).toContain('monitoring-sample-count');
    expect(monitoringBlock).toContain('monitoring-last-error');
    expect(monitoringBlock).not.toContain(
      'td style="font-weight:500;color:var(--text)"',
    );
    expect(monitoringBlock).not.toContain(
      'td style="font-family:var(--mono);font-size:11px;color:var(--text)"',
    );
    expect(monitoringBlock).not.toContain('style="margin-right:4px"');
    expect(monitoringBlock).not.toContain('style="font-size:10px"');
    expect(monitoringBlock).not.toContain('style="font-size:9px"');
    expect(monitoringBlock).not.toContain(
      'style="font-size:10px;color:var(--error);margin-top:2px"',
    );
    expect(monitoringBlock).not.toContain(
      'td style="font-size:11px;color:var(--text-muted)"',
    );
    expect(monitoringBlock).not.toContain(
      'span style="font-size:11px;color:var(--text-muted)"',
    );
    expect(monitoringBlock).not.toContain(
      'td style="font-size:11px;color:${m.lastError',
    );
    expect(style).toContain('.monitoring-profile-cell');
    expect(style).toContain('.monitoring-model-cell');
    expect(style).toContain('.monitoring-muted-cell,');
    expect(style).toContain('.monitoring-last-error.has-error');
    expect(style).toContain('.monitoring-chip-cell');
    expect(style).toContain('.monitoring-status-badge');
    expect(style).toContain('.monitoring-small-badge');
  });

  it('uses class-based recent snapshot table styling', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const historyBlock = source.slice(
      source.indexOf('// Load history'),
      source.indexOf('window.runAllProbes'),
    );

    expect(historyBlock).toContain('monitoring-history-table');
    expect(historyBlock).toContain('monitoring-history-time');
    expect(historyBlock).not.toContain(
      'class="table-wrap" style="max-height:400px;overflow-y:auto"',
    );
    expect(historyBlock).not.toContain('td style="font-size:11px"');
    expect(style).toContain('.monitoring-history-table');
    expect(style).toContain('max-height: 400px');
    expect(style).toContain('.monitoring-history-time');
    expect(style).toContain('font-variant-numeric: tabular-nums');
  });

  it('turns missing monitoring history into recovery actions', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const historyBlock = source.slice(
      source.indexOf('// Load history'),
      source.indexOf('window.runAllProbes'),
    );

    expect(source).toContain('function renderMonitoringEmptyState');
    expect(source).toContain('No resource history yet');
    expect(source).toContain('No monitoring snapshots available');
    expect(source).toContain('Monitoring history unavailable');
    expect(source).toContain('System resource snapshot unavailable');
    expect(source).toContain('Provider health unavailable');
    expect(source).toContain('Model operations metrics unavailable');
    expect(source).toContain('monitoring-empty-state');
    expect(source).toContain('monitoring-empty-flow');
    expect(source).toContain('monitoring-empty-actions');
    expect(source).toContain('Probe providers</button>');
    expect(source).toContain('Copy brief</button>');
    expect(source).toContain('Open Logs</button>');
    expect(historyBlock).toContain("renderMonitoringEmptyState('chart')");
    expect(historyBlock).toContain("renderMonitoringEmptyState('history')");
    expect(historyBlock).toContain(
      "renderMonitoringEmptyState('error', message)",
    );
    const monitoringBlock = source.slice(
      source.indexOf('// --- Monitoring ---'),
      source.indexOf('// --- Deploy Pipelines ---'),
    );
    expect(monitoringBlock).not.toContain('catch {}');
    expect(source).not.toContain("api('/providers/health').catch(() => null)");
    expect(source).not.toContain(
      "api('/providers/model-metrics').catch(() => null)",
    );
    expect(historyBlock).not.toContain(
      '<div class="empty">No history data yet</div>',
    );
    expect(historyBlock).not.toContain(
      '<div class="empty">No monitoring snapshots available</div>',
    );
    expect(style).toContain('.monitoring-empty-state');
    expect(style).toContain('.monitoring-empty-flow');
    expect(style).toContain('.monitoring-empty-actions');
    expect(style).toContain('.monitoring-loading-state');
    expect(style).toContain('.monitoring-loading-flow');
  });

  it('uses class-based chart bar sizing for resource history', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const historyBlock = source.slice(
      source.indexOf('// Load history'),
      source.indexOf('window.runAllProbes'),
    );

    expect(source).toContain(
      "'--monitoring-chart-height': `${numeric.toFixed(1)}px`",
    );
    expect(historyBlock).toContain('chart-bar monitoring-chart-bar');
    expect(historyBlock).toContain('monitoringChartStyle(height)');
    expect(historyBlock).not.toContain(
      'class="chart-bar" style="height:${height}px"',
    );
    expect(historyBlock).not.toContain(
      'style="--monitoring-chart-height:${height}px"',
    );
    expect(style).toContain('.monitoring-chart-bar');
    expect(style).toContain('height: var(--monitoring-chart-height, 4px)');
  });

  it('styles monitoring panels responsively', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.monitoring-command-center');
    expect(source).toContain('.monitoring-decision-brief');
    expect(source).toContain('.monitoring-decision-brief.is-attention');
    expect(source).toContain('.monitoring-decision-facts');
    expect(source).toContain('.monitoring-decision-facts span.is-warning');
    expect(source).toContain('.monitoring-assignment-gate');
    expect(source).toContain('.monitoring-assignment-head');
    expect(source).toContain('.monitoring-assignment-grid');
    expect(source).toContain('.monitoring-assignment-card');
    expect(source).toContain('.monitoring-resource-grid');
    expect(source).toContain('.monitoring-resource-card');
    expect(source).toContain('.monitoring-history-grid');
    expect(source).toContain('.monitoring-resource-grid,');
    expect(source).toContain('.monitoring-assignment-grid,');
    expect(source).toContain('.monitoring-summary-grid,');
    expect(source).toContain('.monitoring-history-grid,');
    expect(source).toContain('.monitoring-loading-state,');
    expect(source).toContain('.monitoring-decision-actions');
    expect(source).toContain('.monitoring-empty-actions');
  });
});
