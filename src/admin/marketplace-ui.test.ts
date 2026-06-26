import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const marketplacePagePath = path.join(
  process.cwd(),
  'src/admin/public/pages/marketplace.js',
);
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Marketplace productivity UI', () => {
  it('frames plugins as trusted extensions across Copilot, Cowork, Code, and system lanes', () => {
    const source = fs.readFileSync(marketplacePagePath, 'utf8');

    expect(source).toContain('marketplace-command-center');
    expect(source).toContain('Extension cockpit');
    expect(source).toContain('Choose capabilities before installing code');
    expect(source).toContain('marketplacePluginLane');
    expect(source).toContain('marketplaceActivationRunway');
    expect(source).toContain('renderMarketplaceActivationRunway');
    expect(source).toContain('marketplace-activation-runway');
    expect(source).toContain('Activation runway');
    expect(source).toContain(
      'Turn a plugin into a useful workflow without opening the floodgates',
    );
    expect(source).toContain(
      'one trusted workflow, one scoped access path, and proof before writes or agent handoff',
    );
    expect(source).toContain('marketplaceReviewBriefText');
    expect(source).toContain('Marketplace plugin review brief');
    expect(source).toContain('Data health:');
    expect(source).toContain(
      'Marketplace registry loaded without known fallback.',
    );
    expect(source).toContain('loadIssues');
    expect(source).toContain('marketplacePluginFitBriefText');
    expect(source).toContain('Marketplace plugin fit brief');
    expect(source).toContain('marketplaceActivationChecklistText');
    expect(source).toContain('Marketplace activation checklist');
    expect(source).toContain('renderMarketplaceLoadingState');
    expect(source).toContain('renderMarketplaceEmptyState');
    expect(source).toContain('renderMarketplaceLoadError');
    expect(source).toContain('Copy review brief');
    expect(source).toContain('Copy activation checklist');
    expect(source).toContain('copyMarketplaceActivationChecklist');
    expect(source).toContain('Marketplace activation checklist copied');
    expect(source).toContain('copyMarketplaceReviewBrief');
    expect(source).toContain('Marketplace review brief copied');
    expect(source).toContain('copyMarketplacePluginFit');
    expect(source).toContain('Copy fit brief');
    expect(source).toContain('Marketplace plugin fit brief copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain(
      "window.prompt('Copy marketplace review brief:'",
    );
    expect(source).toContain('window._marketplaceReviewState');
    expect(source).not.toContain('github|git|code');
    expect(source).toContain("'Copilot'");
    expect(source).toContain("'Cowork'");
    expect(source).toContain("'Code'");
    expect(source).toContain("'System'");
  });

  it('keeps install flow explicit about Git trust and restart requirements', () => {
    const source = fs.readFileSync(marketplacePagePath, 'utf8');

    expect(source).toContain('togglePluginInstall');
    expect(source).toContain('Only install repositories you trust');
    expect(source).toContain('class="card marketplace-install-card is-hidden"');
    expect(source).toContain("form.classList.contains('is-hidden')");
    expect(source).toContain("form.classList.toggle('is-hidden', !shouldOpen)");
    expect(source).toContain('marketplace-installed-card');
    expect(source).toContain('marketplace-count-badge');
    expect(source).not.toContain(
      'class="card marketplace-install-card" style="display:none"',
    );
    expect(source).not.toContain(
      'class="badge badge-muted" style="font-size:10px"',
    );
    expect(source).toContain('Review plugin.json');
    expect(source).toContain('Confirm routes and credentials');
    expect(source).toContain('Restart after install');
    expect(source).toContain(
      'Check routes, frontend pages, credentials, MCP tools, skills, and container permissions before activation',
    );
    expect(source).toContain(
      'Decide whether the plugin belongs in Copilot, Cowork, Code, or System',
    );
    expect(source).toContain('Activation checklist');
    expect(source).toContain('Activation runway');
    expect(source).toContain(
      'Name the first useful workflow this plugin should unlock before installing it',
    );
    expect(source).toContain(
      'For Cowork plugins, verify project-chat prompts, MCP server credentials, document/artifact outputs, and approval boundaries together',
    );
    expect(source).toContain(
      'For Code plugins, verify repository scope, issue/PR permissions, test commands, and review rules before agent handoff',
    );
    expect(source).toContain(
      'For Copilot or channel plugins, verify message routing, identity, rate limits, and whether output should stay plain chat or move into a Cowork project',
    );
    expect(source).toContain(
      'test a read-only request first and keep publish/send/update actions behind Approvals',
    );
    expect(source).toContain(
      'Name the exact Copilot, Cowork, Code, or System workflow this plugin should improve before restart.',
    );
    expect(source).toContain(
      'Identify which routes, frontend pages, credentials, MCP tools, skills, or container permissions it adds.',
    );
    expect(source).toContain(
      'Confirm the operator who owns the workflow and where the first successful result should appear.',
    );
    expect(source).toContain(
      'Run one read-only dry run before enabling publish, send, update, repository, or document-write actions.',
    );
    expect(source).toContain(
      'Restart NanoCrab only after credentials, plugin metadata, permissions, and rollback path are understood.',
    );
    expect(source).toContain('Plugin settings');
    expect(source).toContain('Reading trusted plugin metadata.');
    expect(source).toContain(
      'Marketplace installs can add pages, routes, skills, MCP tools, and credentials',
    );
    expect(source).toContain('No marketplace plugins installed');
    expect(source).toContain(
      'Start with the workflow gap, then install the plugin.',
    );
    expect(source).toContain('Match capability');
    expect(source).toContain('Review source');
    expect(source).toContain('Restart deliberately');
    expect(source).toContain('Marketplace unavailable');
    expect(source).toContain('We could not read the local plugin registry.');
    expect(source).toContain('Marketplace plugin registry unavailable');
    expect(source).toContain('installed: []');
    expect(source).toContain(
      "loadIssues: ['Marketplace plugin registry unavailable']",
    );
    expect(source).toContain(
      "renderMarketplace(document.getElementById('page-content'))",
    );
    expect(source).toContain('Copy review brief');
    expect(source).not.toContain(
      "renderMarketplace(document.getElementById('content'))",
    );
    expect(source).not.toContain("api('/marketplace').catch(() => [])");
    expect(source).toContain('if (!Array.isArray(installed))');
    expect(source).toContain('marketplaceActionErrorMessage');
    expect(source).toContain('err?.error || err?.message');
    expect(source).toContain(
      'Plugin install failed. Check the Git URL, plugin.json, credentials, and local plugin permissions before retrying',
    );
    expect(source).toContain(
      'Plugin uninstall failed. Check active routes, running work, and restart requirements before retrying',
    );
    expect(source).toContain(
      'Plugin update failed. Review the plugin diff, credentials, and restart plan before retrying',
    );
    expect(source).not.toContain(
      '<div class="empty marketplace-empty">No marketplace plugins installed. Start with a trusted Git repository when you need a capability NanoCrab does not already include.</div>',
    );
    expect(source).not.toContain(
      '\'<div class="card empty">Failed to load marketplace:',
    );
    expect(source).not.toContain(
      '<div class="loading">Loading marketplace</div>',
    );
    expect(source).not.toContain('Plugin installed! Restart to activate.');
    expect(source).not.toContain("toast('Failed: ' + e.message, 'error')");
    expect(source).not.toContain("toast(r.error || 'Install failed', 'error')");
    expect(source).not.toContain("toast(r.error || 'Update failed', 'error')");
  });

  it('makes plugin activation a visible workflow runway before restart', () => {
    const source = fs.readFileSync(marketplacePagePath, 'utf8');

    expect(source).toContain("step: 'Fit'");
    expect(source).toContain("title: 'Name the first useful workflow'");
    expect(source).toContain(
      'Write down what the plugin should improve before it adds routes, tools, skills, or MCP servers',
    );
    expect(source).toContain("target: 'help'");
    expect(source).toContain("step: 'Access'");
    expect(source).toContain("title: 'Prepare credentials and scope'");
    expect(source).toContain(
      'Add required credentials, confirm project/repo/channel scope, and keep secrets outside agent containers',
    );
    expect(source).toContain("target: 'credentials'");
    expect(source).toContain("step: 'Dry run'");
    expect(source).toContain("title: 'Test a read-only request'");
    expect(source).toContain(
      'Run one harmless read before enabling publish, send, update, repository, or document-write actions',
    );
    expect(source).toContain("target: 'integrations'");
    expect(source).toContain("step: 'Control'");
    expect(source).toContain("title: 'Keep writes approval-gated'");
    expect(source).toContain(
      'Route external writes through Approvals until the plugin has successful evidence in the right workspace lane',
    );
    expect(source).toContain("target: 'approvals'");
    expect(source).toContain('...marketplaceActivationRunway().map(');
    expect(source).toContain('onclick="navigate(\'${esc(item.target)}\')"');
    expect(source).toContain(
      'Use this checklist before restarting NanoCrab or handing the plugin to Copilot, Cowork, Code, or System work.',
    );
    expect(source).toContain(
      'Keep external writes behind Approvals until one read-only dry run succeeds in the right workspace lane.',
    );
  });

  it('styles the marketplace cockpit and capability lanes responsively', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.marketplace-command-center');
    expect(source).toContain('.marketplace-command-stats');
    expect(source).toContain('.marketplace-lanes');
    expect(source).toContain('.marketplace-activation-runway');
    expect(source).toContain('.marketplace-activation-head');
    expect(source).toContain('.marketplace-activation-grid');
    expect(source).toContain('.marketplace-activation-card');
    expect(source).toContain('.marketplace-activation-card:hover');
    expect(source).toContain('.marketplace-plugin-row');
    expect(source).toContain('.marketplace-install-card.is-hidden');
    expect(source).toContain('.marketplace-installed-card');
    expect(source).toContain('.marketplace-count-badge');
    expect(source).toContain('.marketplace-install-grid');
    expect(source).toContain('.marketplace-loading-state');
    expect(source).toContain('.marketplace-loading-copy');
    expect(source).toContain('.marketplace-loading-steps');
    expect(source).toContain('.marketplace-empty-state');
    expect(source).toContain('.marketplace-empty-flow');
    expect(source).toContain('.marketplace-empty-step');
    expect(source).toContain('.marketplace-error-state');
    expect(source).toContain('.marketplace-loading-state,');
    expect(source).toContain(
      '.marketplace-command-stats,\n  .marketplace-lanes,\n  .marketplace-activation-grid,\n  .marketplace-empty-flow {\n    grid-template-columns: 1fr;',
    );
    expect(source).toContain(
      '.marketplace-command-stats,\n  .marketplace-lanes,\n  .marketplace-activation-grid,\n  .marketplace-empty-flow {\n    grid-template-columns: repeat(2, minmax(0, 1fr));',
    );
    expect(source).toContain(
      '.marketplace-plugin-row,\n  .marketplace-activation-head,\n  .marketplace-install-head',
    );
    expect(source).toContain(
      '.marketplace-empty-flow {\n    grid-template-columns: 1fr;',
    );
  });
});
