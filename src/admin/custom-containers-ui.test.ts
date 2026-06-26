import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');
const mockPath = path.join(process.cwd(), 'src/admin/mock-data.ts');

describe('Custom containers sidecar cockpit UI', () => {
  it('frames custom containers as sidecar operations', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Sidecar operations');
    expect(source).toContain('Custom Containers');
    expect(source).toContain('containers-command-center');
    expect(source).toContain('containers-command-actions');
    expect(source).toContain('containers-stats');
    expect(source).toContain('renderSidecarReadinessPanel');
    expect(source).toContain('sidecarReadinessItems');
    expect(source).toContain('container-sidecar-readiness');
    expect(source).toContain('Agent handoff gate');
    expect(source).toContain(
      'Check helper readiness before agents call sidecars',
    );
    expect(source).toContain('Ready to call');
    expect(source).toContain('Needs attention');
    expect(source).toContain('Access surface');
    expect(source).toContain(
      'Ports, volumes, and environment variables are the main things to review before broad agent use.',
    );
    expect(source).toContain('Copy readiness brief');
    expect(source).toContain('container-capability-map');
    expect(source).toContain('container-sidecar-grid');
    expect(source).toContain('container-sidecar-card');
    expect(source).toContain('container-sidecar-title-row');
    expect(source).toContain('container-sidecar-status');
    expect(source).toContain('container-sidecar-status-dot');
    expect(source).toContain('container-sidecar-description');
    expect(source).toContain('container-sidecar-actions');
    expect(source).toContain('No sidecars');
    expect(source).toContain('sidecarCapabilityCards');
    expect(source).toContain('sidecarCapabilityBriefText');
    expect(source).toContain('NanoCrab sidecar capability brief');
    expect(source).toContain('Copy sidecar brief');
    expect(source).toContain('copySidecarCapabilityBrief');
    expect(source).toContain('Sidecar capability brief copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("prompt('Copy sidecar capability brief:'");
    expect(source).toContain('window._sidecarCapabilityState');
    expect(source).toContain(
      'Expose private services agents can call without leaving your machine.',
    );
    expect(source).toContain(
      'Run document, artifact, and background job helpers beside NanoCrab.',
    );
    expect(source).toContain(
      'Package internal tools for Cowork and Code without adding them to every agent image.',
    );
    expect(source).toContain(
      'Keep helper services explicit, observable, and easy to pause.',
    );
    expect(source).toContain(
      'Use sidecars for explicit local tools that Cowork and Code agents can call intentionally',
    );
    expect(source).toContain(
      'Prefer narrow ports, read-only volumes, and named services before giving agents broad host access',
    );
    expect(source).toContain(
      'Keep credentials in NanoCrab credential handling; do not put raw secrets in handoff briefs',
    );
    expect(source).toContain('Helper readiness checklist');
    expect(source).toContain(
      'Name the owning Cowork project, Code repo, report job, or routine before exposing the sidecar to agents.',
    );
    expect(source).toContain(
      'Confirm ports, volumes, environment variables, credentials, and health/log visibility are narrow and observable.',
    );
    expect(source).toContain(
      'Check recent sidecar logs and Monitoring before restart, rebuild, stop, or broad agent use.',
    );
    expect(source).toContain(
      'Keep helper-triggered external writes approval-gated and keep raw secrets out of handoff briefs.',
    );
    expect(source).not.toContain(
      'class="card-title" style="display:flex;justify-content:space-between;align-items:center"',
    );
    expect(source).not.toContain(
      'style="display:inline-block;width:8px;height:8px;border-radius:50%',
    );
    expect(source).not.toContain(
      'style="color:var(--text-muted);margin-bottom:8px"',
    );
    expect(source).not.toContain('style="display:flex;gap:6px;flex-wrap:wrap"');
  });

  it('keeps creation fields and runtime actions wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/custom-containers'");
    expect(source).toContain('id="cc-form"');
    expect(source).toContain(
      'id="cc-form" class="container-form-panel is-hidden"',
    );
    expect(source).toContain('toggleCustomContainerForm');
    expect(source).toContain('id="cc-name"');
    expect(source).toContain('id="cc-desc"');
    expect(source).toContain('id="cc-image"');
    expect(source).toContain('id="cc-buildctx"');
    expect(source).toContain('id="cc-command"');
    expect(source).toContain('id="cc-envvars"');
    expect(source).toContain('id="cc-volumes"');
    expect(source).toContain('id="cc-ports"');
    expect(source).toContain('id="cc-autostart"');
    expect(source).toContain('class="container-autostart"');
    expect(source).toContain('container-dynamic-row container-env-row');
    expect(source).toContain('container-dynamic-row container-volume-row');
    expect(source).toContain('container-dynamic-row container-port-row');
    expect(source).toContain('search-input container-dynamic-input');
    expect(source).toContain('container-dynamic-input is-wide');
    expect(source).toContain('class="container-readonly-check"');
    expect(source).toContain('createCustomContainer');
    expect(source).toContain('startContainer');
    expect(source).toContain('stopContainer');
    expect(source).toContain('restartContainer');
    expect(source).toContain('buildContainer');
    expect(source).toContain('showContainerLogs');
    expect(source).toContain('renderSidecarLogState');
    expect(source).toContain('container-sidecar-log-state');
    expect(source).toContain('Fetching sidecar runtime output');
    expect(source).toContain('No sidecar logs available');
    expect(source).toContain('Could not fetch sidecar logs');
    expect(source).toContain(
      'Check Monitoring or Containers before restarting a helper',
    );
    expect(source).toContain('class="container-log-drawer is-hidden"');
    expect(source).toContain('editContainer');
    expect(source).toContain('saveContainerEdits');
    expect(source).toContain('class="container-edit-panel is-hidden"');
    expect(source).toContain('container-edit-grid');
    expect(source).toContain('container-edit-actions');
    expect(source).toContain('renderSidecarSettingsState');
    expect(source).toContain('container-sidecar-settings-state');
    expect(source).toContain('Loading sidecar configuration');
    expect(source).toContain('Could not load sidecar settings');
    expect(source).toContain('copySidecarCapabilityBrief()');
    expect(source).toContain("navigate('monitoring')");
    expect(source).toContain("navigate('containers')");
    expect(source).toContain('Name and image are required');
    expect(source).toContain('deleteContainer');
    expect(source).not.toContain("prompt('Name:', c.name)");
    expect(source).not.toContain("prompt('Description:', c.description)");
    expect(source).not.toContain("prompt('Image:', c.image)");
    expect(source).not.toContain('id="cc-form" style="display:none"');
    expect(source).not.toContain(
      'class="container-log-drawer" style="display:none"',
    );
    expect(source).not.toContain(
      'label style="display:flex;align-items:center;gap:8px"',
    );
    expect(source).not.toContain('style="display:flex;gap:6px;margin-top:4px"');
    expect(source).not.toContain(
      'style="display:flex;gap:6px;margin-top:4px;align-items:center"',
    );
    expect(source).not.toContain(
      'style="font-size:11px;display:flex;align-items:center;gap:4px"',
    );
    expect(source).not.toContain("pre.textContent = 'Loading...'");
    expect(source).not.toContain(
      "pre.textContent = r.logs || 'No logs available.'",
    );
    expect(source).not.toContain("pre.textContent = 'Failed to fetch logs.'");
    expect(source).not.toContain(
      'panel.innerHTML = \'<div class="loading">Loading sidecar settings</div>\'',
    );
    expect(source).not.toContain(
      'panel.innerHTML = `<div class="empty">Failed to load sidecar settings: ${esc(e.message)}</div>`',
    );
  });

  it('uses sidecar-specific recovery copy for create, lifecycle, build, edit, and delete failures', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const actions = source.slice(
      source.indexOf('function sidecarActionErrorMessage'),
      source.indexOf('window.navigate ='),
    );

    expect(actions).toContain('sidecarActionErrorMessage');
    expect(actions).toContain('Sidecar was not created.');
    expect(actions).toContain('Sidecar did not start.');
    expect(actions).toContain('Sidecar did not stop.');
    expect(actions).toContain('Sidecar did not restart.');
    expect(actions).toContain('Sidecar build did not complete.');
    expect(actions).toContain('Sidecar changes were not saved.');
    expect(actions).toContain('Sidecar was not deleted.');
    expect(actions).toContain(
      'Cowork project, Code repo, report job, or routine',
    );
    expect(actions).toContain(
      'active Cowork projects, Code tasks, reports, routines, and MCP-adjacent services',
    );
    expect(actions).toContain(
      "toast(sidecarActionErrorMessage('create', r), 'error')",
    );
    expect(actions).toContain(
      "toast(sidecarActionErrorMessage('start', r), 'error')",
    );
    expect(actions).toContain(
      "toast(sidecarActionErrorMessage('stop', r), 'error')",
    );
    expect(actions).toContain(
      "toast(sidecarActionErrorMessage('restart', r), 'error')",
    );
    expect(actions).toContain(
      "toast(sidecarActionErrorMessage('build', r), 'error')",
    );
    expect(actions).toContain(
      "toast(sidecarActionErrorMessage('update', r), 'error')",
    );
    expect(actions).toContain(
      "toast(sidecarActionErrorMessage('delete', r), 'error')",
    );
    expect(actions).not.toContain("toast(r.error || 'Failed', 'error')");
    expect(actions).not.toContain("toast('Error: ' + e.message, 'error')");
  });

  it('turns an empty sidecar list into a first-helper setup path', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderSidecarEmptyState');
    expect(source).toContain('container-sidecar-empty-state');
    expect(source).toContain('First sidecar');
    expect(source).toContain('No sidecars configured');
    expect(source).toContain('Add one explicit helper service');
    expect(source).toContain('Start with one local helper');
    expect(source).toContain('Keep access narrow');
    expect(source).toContain('Capture the handoff');
    expect(source).toContain(
      "document.getElementById('cc-ports')?.scrollIntoView",
    );
    expect(source).toContain('copySidecarCapabilityBrief()');
    expect(source).not.toContain(
      '\'<div class="container-sidecar-card empty">No sidecars configured</div>\'',
    );
    expect(style).toContain('.container-sidecar-empty-state');
    expect(style).toContain('.container-sidecar-empty-flow');
    expect(style).toContain('.container-sidecar-empty-flow article button');
    expect(style).toContain('.container-sidecar-empty-actions');
    expect(style).toContain('.container-sidecar-empty-flow,');
  });

  it('styles sidecar cards, form sections, and mobile layout', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.containers-command-center');
    expect(source).toContain('.containers-command-actions');
    expect(source).toContain('.containers-stats');
    expect(source).toContain('.container-sidecar-readiness');
    expect(source).toContain('.container-sidecar-readiness-head');
    expect(source).toContain('.container-sidecar-readiness-actions');
    expect(source).toContain('.container-sidecar-readiness-grid');
    expect(source).toContain('.container-sidecar-readiness-item');
    expect(source).toContain('.container-sidecar-readiness-item.is-ready');
    expect(source).toContain('.container-sidecar-readiness-item.is-warning');
    expect(source).toContain('.container-sidecar-readiness-item.is-review');
    expect(source).toContain('.container-capability-map');
    expect(source).toContain('.container-capability-card');
    expect(source).toContain('.container-form-panel');
    expect(source).toContain('.container-form-panel.is-hidden');
    expect(source).toContain('.container-autostart');
    expect(source).toContain('.container-dynamic-row');
    expect(source).toContain('.container-dynamic-input');
    expect(source).toContain('.container-dynamic-input.is-wide');
    expect(source).toContain('.container-readonly-check');
    expect(source).toContain('.container-log-drawer.is-hidden');
    expect(source).toContain('.container-edit-panel.is-hidden');
    expect(source).toContain('.container-edit-grid');
    expect(source).toContain('.container-edit-actions');
    expect(source).toContain('.container-sidecar-log-state');
    expect(source).toContain('.container-sidecar-log-state.is-error');
    expect(source).toContain('.container-sidecar-log-actions');
    expect(source).toContain('.container-sidecar-settings-state');
    expect(source).toContain('.container-sidecar-settings-state.is-error');
    expect(source).toContain('.container-sidecar-settings-actions');
    expect(source).toContain('.container-sidecar-card');
    expect(source).toContain('.container-sidecar-meta');
    expect(source).toContain('.container-sidecar-title-row');
    expect(source).toContain('.container-sidecar-status');
    expect(source).toContain('.container-sidecar-status-dot');
    expect(source).toContain('.container-sidecar-description');
    expect(source).toContain('.container-sidecar-empty-state');
    expect(source).toContain('.container-sidecar-empty-flow');
    expect(source).toContain('.container-log-drawer');
    expect(source).toContain(
      '.container-capability-map,\n  .container-form-grid',
    );
    expect(source).toContain('.container-sidecar-log-state,');
    expect(source).toContain('.container-sidecar-settings-state,');
    expect(source).toContain('.container-sidecar-readiness-grid,');
  });

  it('keeps mock custom container data available for dashboard previews', () => {
    const source = fs.readFileSync(mockPath, 'utf8');

    expect(source).toContain("pathname === '/custom-containers'");
    expect(source).toContain('Sample Worker');
    expect(source).toContain('Report Renderer');
    expect(source).toContain('Mock container log line');
  });
});
