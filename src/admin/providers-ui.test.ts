import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');
const parityUiPath = path.join(
  process.cwd(),
  'src/admin/public/ui/provider-parity.js',
);

const providerCatalogSource = (source: string) =>
  source.slice(
    source.indexOf('const categoryHtml = Object.entries(data.categories)'),
    source.indexOf('// Per-group defaults'),
  );

const providerTablesSource = (source: string) => {
  const start = source.indexOf('// Per-group defaults');
  return source.slice(start, source.indexOf('el.innerHTML = `', start));
};

describe('AI Providers routing cockpit UI', () => {
  it('frames providers as model routing for agent work', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Model routing');
    expect(source).toContain('Configure the providers and profile defaults');
    expect(source).toContain('provider-page-header');
    expect(source).toContain('provider-routing-brief');
    expect(source).toContain('provider-focus-lanes');
    expect(source).toContain('provider-launch-checklist');
    expect(source).toContain('provider-fallback-ladder');
    expect(source).toContain('Provider decision');
    expect(source).toContain('Choose the model lane before the agent starts');
    expect(source).toContain('Route the request to the right model profile');
    expect(source).toContain(
      'Recover provider decisions before the work drifts',
    );
  });

  it('surfaces provider readiness from configured providers, defaults, and profiles', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const paritySource = fs.readFileSync(parityUiPath, 'utf8');

    expect(source).toContain('configuredProviders');
    expect(source).toContain('missingDefaultCategories');
    expect(source).toContain('toolReadyProfiles');
    expect(source).toContain('providerFocusLanes');
    expect(source).toContain('providerLaunchChecklist');
    expect(source).toContain('providerFallbackLadder');
    expect(source).toContain('providerBrief');
    expect(source).toContain(
      'Configure an AI provider before assigning agent work',
    );
    expect(source).toContain('Provider routing is ready for agent work');
    expect(source).toContain(
      'Plain Copilot chat, Cowork MCP work, Code automation, and report/document generation',
    );
    expect(source).toContain(
      'Use a tool-capable profile for MCP, email, document, artifact, and project-context work',
    );
    expect(source).toContain(
      'Keep external writes approval-gated and save generated outputs back to the Cowork project',
    );
    expect(source).toContain(
      'Require a scoped repo, branch, issue, diff, or test target before launching broad automation',
    );
    expect(source).toContain('Copilot default');
    expect(source).toContain('Plain chat has a fast, reliable profile.');
    expect(source).toContain('Cowork tools');
    expect(source).toContain(
      'MCP, email, document, and artifact work has a tool-capable profile.',
    );
    expect(source).toContain('Code profile');
    expect(source).toContain(
      'Repository automation has a coding profile before issues or diffs are assigned.',
    );
    expect(source).toContain('Routing defaults');
    expect(source).toContain(
      'Global provider defaults are present before unattended work starts.',
    );
    expect(source).toContain('Simple answer');
    expect(source).toContain('Use Copilot profile');
    expect(source).toContain('Needs MCP tools');
    expect(source).toContain('Escalate to Cowork profile');
    expect(source).toContain('Provider fails');
    expect(source).toContain('Check Logs and fallback');
    expect(source).toContain('External write');
    expect(source).toContain('Route through Approvals');
    expect(source).toContain(
      'Use a tool-capable provider before asking for email, document, calendar, or project-context work.',
    );
    expect(source).toContain(
      'Keep sends, publishes, repository writes, webhooks, and third-party updates approval-gated regardless of model.',
    );
    expect(source).toContain("api('/providers/parity')");
    expect(source).toContain(
      'window.NanoProviderParity.renderProviderParityPanel(parity)',
    );
    expect(paritySource).toContain('window.NanoProviderParity');
    expect(paritySource).toContain('renderProviderParityPanel');
    expect(paritySource).toContain('provider-parity-panel');
    expect(paritySource).toContain('Provider parity');
    expect(paritySource).toContain('Conformance across key surfaces');
    expect(paritySource).toContain('provider-parity-summary');
    expect(paritySource).toContain('provider-parity-row');
    expect(paritySource).toContain('provider-parity-note');
    expect(paritySource).toContain('is-ready');
    expect(paritySource).toContain('is-degraded');
    expect(paritySource).toContain('is-blocked');
    expect(paritySource).toContain('badge-success');
    expect(paritySource).toContain('badge-warning');
    expect(paritySource).toContain('badge-error');
  });

  it('keeps provider catalog, routing, and group defaults wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('id="provider-routing"');
    expect(source).toContain('id="provider-catalog"');
    expect(source).toContain('Capability Routing');
    expect(source).toContain('Per-Group Defaults');
    expect(source).toContain('enableProvider');
    expect(source).toContain('setDefaultProvider');
    expect(source).toContain('setGroupProvider');
  });

  it('uses recovery-oriented provider action errors', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const actionBlock = source.slice(
      source.indexOf('window.copyProviderRoutingBrief'),
      source.indexOf('function reportStatusBadge'),
    );

    expect(actionBlock).toContain('function providerActionErrorMessage');
    expect(actionBlock).toContain(
      'Provider was not enabled. Check the API key, credentials page, and whether this provider should handle Copilot, Cowork, Code, or report work.',
    );
    expect(actionBlock).toContain(
      'Provider was not disabled. Check defaults and active profiles before routing agent work away from this provider.',
    );
    expect(actionBlock).toContain(
      'Provider default was not saved. Review category defaults before assigning unattended chat, Cowork MCP, report, or Code work.',
    );
    expect(actionBlock).toContain(
      'Group provider default was not saved. Check the group route, category, and provider readiness before relying on this override.',
    );
    expect(actionBlock).toContain(
      "toast(providerActionErrorMessage('enable', r), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(providerActionErrorMessage('disable', r), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(providerActionErrorMessage('default', r), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(providerActionErrorMessage('groupDefault', r), 'error')",
    );
    expect(actionBlock).not.toContain("toast(r.error || 'Failed', 'error')");
  });

  it('uses class-based provider catalog rows', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const catalog = providerCatalogSource(appSource);

    expect(catalog).toContain('provider-catalog-row');
    expect(catalog).toContain('provider-catalog-head');
    expect(catalog).toContain('provider-catalog-title');
    expect(catalog).toContain('provider-model-list');
    expect(catalog).toContain('provider-website-link');
    expect(catalog).toContain('provider-config-note');
    expect(catalog).not.toContain('style="padding:14px 0');
    expect(catalog).not.toContain('style="display:flex;gap:6px');
    expect(styleSource).toContain('.provider-catalog-row');
    expect(styleSource).toContain('.provider-catalog-row.is-last');
    expect(styleSource).toContain('.provider-website-link:hover');
  });

  it('uses class-based provider defaults and routing table cells', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const tables = providerTablesSource(appSource);

    expect(tables).toContain('provider-section-note');
    expect(tables).toContain('provider-group-name');
    expect(tables).toContain('provider-default-cell');
    expect(tables).toContain('provider-group-select');
    expect(tables).toContain('provider-purpose-cell');
    expect(tables).toContain('provider-model-cell');
    expect(tables).toContain('provider-capability-cell');
    expect(tables).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-bottom:12px',
    );
    expect(tables).not.toContain(
      'style="max-width:150px;padding:4px 8px;font-size:11px',
    );
    expect(tables).not.toContain(
      'style="font-family:var(--mono);font-size:11px;color:var(--text)',
    );
    expect(styleSource).toContain('.provider-section-note');
    expect(styleSource).toContain('.provider-group-select');
    expect(styleSource).toContain('.provider-capability-cell');
  });

  it('copies provider routing state as a model and tool brief', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('providerRoutingBriefText');
    expect(source).toContain('providerLaneDecisionPromptText');
    expect(source).toContain('window.copyProviderRoutingBrief');
    expect(source).toContain('window.copyProviderLaneDecisionPrompt');
    expect(source).toContain('Copy routing brief');
    expect(source).toContain('Copy lane prompt');
    expect(source).toContain('Provider routing brief copied');
    expect(source).toContain('Provider lane prompt copied');
    expect(source).toContain('Copy provider lane prompt');
    expect(source).toContain('Review this NanoCrab provider routing state.');
    expect(source).toContain(
      'Choose the NanoCrab provider lane for this request.',
    );
    expect(source).toContain('Capability profiles:');
    expect(source).toContain('Workspace focus lanes:');
    expect(source).toContain('Launch checklist:');
    expect(source).toContain(
      "${item.ready ? 'ready' : 'review'}: ${item.label}. ${item.detail}",
    );
    expect(source).toContain('Fallback ladder:');
    expect(source).toContain('${item.trigger}: ${item.action}. ${item.detail}');
    expect(source).toContain(
      'Choose provider defaults before assigning Copilot, Cowork, Code, reports, routines, or MCP tool work',
    );
    expect(source).toContain(
      'Use tool-capable profiles for MCP/document/email actions',
    );
    expect(source).toContain(
      'Use Copilot for plain chat, drafting, explanation, or quick clarification with no files, tools, or durable artifact.',
    );
    expect(source).toContain(
      'Use Cowork when the request needs project files, memory context, MCP/email/calendar/document tools, source citations, or a saved artifact.',
    );
    expect(source).toContain(
      'Use Code when the request needs a repository, branch, issue, diff, test target, PR, or GitHub Copilot handoff.',
    );
    expect(source).toContain(
      'Use Reports when the output should become a reviewed summary, briefing, markdown, HTML, DOCX, PDF, or scheduled document.',
    );
    expect(source).toContain(
      'Prefer the cheapest reliable profile that satisfies the needed capability.',
    );
    expect(source).toContain(
      'Return one lane, one provider/model profile, why it fits, what approval gate applies, and what dashboard surface should start the work.',
    );
    expect(source).toContain('window._providerRoutingState');
    expect(source).toContain('focusLanes');
    expect(source).toContain('launchChecklist');
  });

  it('styles the provider decision surface responsively', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.provider-page-header');
    expect(source).toContain('.provider-routing-brief');
    expect(source).toContain('.provider-routing-brief.is-attention');
    expect(source).toContain('.provider-routing-facts');
    expect(source).toContain('.provider-routing-actions');
    expect(source).toContain('.provider-focus-lanes');
    expect(source).toContain('.provider-focus-grid');
    expect(source).toContain('.provider-focus-card');
    expect(source).toContain('.provider-launch-checklist');
    expect(source).toContain('.provider-parity-panel');
    expect(source).toContain('.provider-parity-summary');
    expect(source).toContain('.provider-parity-grid');
    expect(source).toContain('.provider-parity-row');
    expect(source).toContain('.provider-parity-row.is-degraded');
    expect(source).toContain('.provider-parity-row.is-blocked');
    expect(source).toContain('.provider-launch-checklist-grid');
    expect(source).toContain('.provider-launch-check.is-ready');
    expect(source).toContain('.provider-launch-check.is-review');
    expect(source).toContain('.provider-fallback-ladder');
    expect(source).toContain('.provider-fallback-copy');
    expect(source).toContain('.provider-fallback-grid');
    expect(source).toContain('.provider-fallback-card');
    expect(source).toContain('.provider-page-header,');
    expect(source).toContain(
      '.provider-focus-lanes,\n  .provider-parity-grid,\n  .provider-focus-grid,\n  .provider-launch-checklist-grid,\n  .provider-fallback-ladder,\n  .provider-fallback-grid {\n    grid-template-columns: 1fr;',
    );
  });
});
