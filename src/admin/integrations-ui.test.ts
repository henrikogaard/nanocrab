import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Integrations MCP cockpit UI', () => {
  const mcpSource = (source: string) =>
    source.slice(
      source.indexOf('async function renderMcp'),
      source.indexOf('window.copyMcpWorkflowPrompt'),
    );
  const catalogSource = (source: string) =>
    source.slice(
      source.indexOf('Connector Catalog'),
      source.indexOf('id="mcp-permissions-note"'),
    );
  const presetsSource = (source: string) =>
    source.slice(
      source.indexOf('Recommended MCP Presets'),
      source.indexOf('renderMcpWorkflowSection(infomaniakWorkflows'),
    );
  const serverListSource = (source: string) =>
    source.slice(
      source.indexOf('servers.map((server) => renderMcpServerCard(server))'),
      source.indexOf("document.getElementById('mcp-create-form')"),
    );
  const serverFormSource = (source: string) =>
    source.slice(
      source.indexOf(
        'class="card mcp-server-form is-hidden" id="new-mcp-form"',
      ),
      source.indexOf('servers.map((server) => renderMcpServerCard(server))'),
    );

  it('frames MCP servers as Cowork chat tools', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Cowork tool cockpit');
    expect(source).toContain('Let project chats call the right MCP tools');
    expect(source).toContain('Summarize latest emails');
    expect(source).toContain('Create document from inbox');
    expect(source).toContain('Check mail from a sender');
    expect(source).toContain('Prepare agenda brief');
    expect(source).toContain('MCP_WORKFLOW_PROMPTS');
    expect(source).toContain('mcpSourceArtifactChecklist');
    expect(source).toContain('mcpCoworkOutcomeBridge');
    expect(source).toContain('mcpServerCoworkReadiness');
    expect(source).toContain('mcpServerCoworkPromptText');
    expect(source).toContain('mcpServerPermissionBriefText');
    expect(source).toContain('Source-to-artifact gate');
    expect(source).toContain(
      'Turn emails, calendars, docs, and custom tools into durable Cowork outputs.',
    );
    expect(source).toContain(
      'Use this before asking a project chat to summarize email, create a document, or combine external MCP context.',
    );
    expect(source).toContain('Connector outcome bridge');
    expect(source).toContain(
      'Know what each MCP server should become inside Cowork.',
    );
    expect(source).toContain(
      'Every connector should point to a project artifact, cited summary, or approval-gated external action.',
    );
    expect(source).toContain('Inbox digests, sender briefs, reply drafts');
    expect(source).toContain(
      'Ask a Cowork project chat to summarize latest emails or all mail from a person',
    );
    expect(source).toContain('Creating or editing events requires approval.');
    expect(source).toContain(
      'Publishing external documents requires approval.',
    );
    expect(source).toContain('Confirm source window');
    expect(source).toContain('Draft inside Cowork first');
    expect(source).toContain('Cite systems used');
    expect(source).toContain('Gate external writes');
    expect(source).toContain('copyMcpWorkflowPrompt');
    expect(source).toContain('copyMcpReadinessBrief');
    expect(source).toContain('copyMcpServerCoworkPrompt');
    expect(source).toContain('copyMcpServerPermissionBrief');
    expect(source).toContain('showMcpServerForm');
    expect(source).toContain('toggleMcpServerForm');
    expect(source).toContain('renderMcpPresetCard');
    expect(source).toContain('renderMcpServerCard');
    expect(source).toContain('Copy Cowork prompt');
    expect(source).toContain('Copy readiness brief');
    expect(source).toContain('Copy server prompt');
    expect(source).toContain('Copy permission brief');
    expect(source).toContain('MCP workflow prompt copied');
    expect(source).toContain('MCP readiness brief copied');
    expect(source).toContain('MCP server Cowork prompt copied');
    expect(source).toContain('MCP server permission brief copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("window.prompt('Copy MCP workflow prompt:'");
    expect(source).not.toContain("window.prompt('Copy MCP readiness brief:'");
    expect(source).toContain(
      'Save a markdown summary draft in the project workspace',
    );
    expect(source).toContain(
      'ask before creating or updating an external document',
    );
    expect(source).toContain('Ready for Cowork chat');
    expect(source).toContain('Credential setup needed');
    expect(source).toContain(
      'Open a Cowork project chat, name the source window, and save the generated summary, document, or artifact in the project.',
    );
    expect(source).toContain(
      'External writes from this connector require approval.',
    );
    expect(source).toContain(
      'Use MCP server "${server.label || server.name}" from a Cowork project chat.',
    );
    expect(source).toContain(
      'Use this connector only for the project-scoped source task named below.',
    );
    expect(source).toContain('MCP connector permission brief');
    expect(source).toContain(
      'Expose read/list/search/get tools before write-capable tools.',
    );
    expect(source).toContain(
      'If required environment variables are missing, keep this connector out of Cowork project chats until credentials are configured.',
    );
    expect(source).toContain(
      'Approval-gated writes: create, update, delete, send, publish, post, upload.',
    );
    expect(source).toContain(
      'Do not let a project chat mutate third-party systems just because it can read from them.',
    );
    expect(source).toContain('Before external writes:');
    expect(source).toContain(
      'If credentials or permissions are missing, stop and return a setup checklist instead of guessing.',
    );
    expect(source).toContain("navigate('projects')");
  });

  it('summarizes server, connector, workflow, and approval readiness', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const mcp = mcpSource(source);
    const catalog = catalogSource(mcp);
    const presets = presetsSource(mcp);
    const serverList = serverListSource(mcp);

    expect(source).toContain('readyServers');
    expect(source).toContain('productivityItems');
    expect(source).toContain('approvalGatedServers');
    expect(source).toContain('workflowGroups');
    expect(source).toContain('mcpCommandStats');
    expect(source).toContain('mcpBrief');
    expect(source).toContain('mcpReadinessBriefText');
    expect(source).toContain('Cowork MCP readiness brief');
    expect(source).toContain('Data health:');
    expect(source).toContain('MCP setup feeds loaded without known fallback.');
    expect(source).toContain('Recommended Cowork uses');
    expect(source).toContain('Server-level Cowork readiness');
    expect(source).toContain('Connector-to-Cowork outcome bridge');
    expect(source).toContain('Source-to-artifact checklist');
    expect(source).toContain('mcpSourceArtifactChecklist()');
    expect(source).toContain('Copy-ready Cowork prompts');
    expect(source).toContain(
      'MCP_WORKFLOW_PROMPTS.map((item) => `- ${item.label}: ${item.prompt}`).join',
    );
    expect(source).toContain(
      'Local project drafts, summaries, and artifacts can be created',
    );
    expect(source).toContain(
      'Publishing documents, sending email, changing calendar events',
    );
    expect(source).toContain('window._mcpReadinessState');
    expect(source).toContain('loadIssues');
    expect(source).toContain(
      "loadIssues.push('MCP preset catalog unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('MCP connector catalog unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Document MCP workflows unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Calendar MCP workflows unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Email MCP workflows unavailable')",
    );
    expect(source).toContain('window._mcpServerByName');
    expect(source).toContain('Tool readiness');
    expect(source).toContain('Connector setup is blocking Cowork tools');
    expect(source).toContain('Cowork MCP tools are ready to use');
    expect(source).toContain('function mcpConnectorUseCases');
    expect(source).toContain('mcp-catalog-use-cases');
    expect(source).toContain('mcp-workflow-grid');
    expect(source).toContain('mcp-outcome-bridge');
    expect(source).toContain('mcp-outcome-grid');
    expect(source).toContain('mcp-outcome-card');
    expect(source).toContain('renderMcpWorkflowSection');
    expect(source).toContain('renderMcpWorkflowCard');
    expect(source).toContain('renderMcpWorkflowCheck');
    expect(source).toContain('mcp-email-workflows');
    expect(source).toContain('mcp-calendar-workflows');
    expect(source).toContain('mcp-document-workflows');
    expect(source).toContain(
      'class="card mcp-server-form is-hidden" id="new-mcp-form"',
    );
    expect(mcp).toContain('mcp-health-grid');
    expect(mcp).toContain('mcp-health-stat');
    expect(mcp).toContain('mcp-health-note');
    expect(mcp).toContain('mcp-data-health');
    expect(mcp).toContain('MCP setup data health');
    expect(mcp).toContain(
      'Review missing MCP setup feeds before assigning source-heavy Cowork work.',
    );
    expect(mcp).toContain('Data health');
    expect(mcp).toContain('feed${loadIssues.length === 1 ?');
    expect(mcp).toContain('mcp-catalog-panel-head');
    expect(mcp).toContain('mcp-catalog-panel-title');
    expect(mcp).toContain('mcp-catalog-summary');
    expect(mcp).toContain('mcp-catalog-grid');
    expect(mcp).toContain('mcp-catalog-card-head');
    expect(mcp).toContain('mcp-catalog-title');
    expect(mcp).toContain('mcp-catalog-name');
    expect(mcp).toContain('mcp-catalog-capabilities');
    expect(mcp).toContain('mcp-catalog-steps');
    expect(mcp).toContain('mcp-catalog-actions');
    expect(mcp).toContain('mcp-permissions-note');
    expect(mcp).toContain('mcp-preset-intro');
    expect(mcp).toContain('mcp-preset-list');
    expect(source).toContain('mcp-preset-card');
    expect(source).toContain('mcp-preset-main');
    expect(source).toContain('mcp-preset-name');
    expect(source).toContain('mcp-preset-notes');
    expect(source).toContain('mcp-preset-command');
    expect(source).toContain('mcp-server-card');
    expect(source).toContain('mcp-server-head');
    expect(source).toContain('mcp-server-title');
    expect(source).toContain('mcp-server-name');
    expect(source).toContain('mcp-server-id');
    expect(source).toContain('mcp-server-actions');
    expect(source).toContain('mcp-server-table');
    expect(source).toContain('mcp-server-env-badge');
    expect(source).toContain('mcp-server-cowork');
    expect(source).toContain('mcp-server-warning');
    expect(source).toContain('mcp-server-note');
    expect(source).toContain('link-button');
    expect(mcp).toContain("className: 'mcp-document-workflows'");
    expect(mcp).toContain("className: 'mcp-calendar-workflows'");
    expect(mcp).toContain("className: 'mcp-email-workflows'");
    expect(source).toContain('mcp-workflow-panel-head');
    expect(source).toContain('mcp-workflow-list');
    expect(source).toContain('mcp-workflow-item');
    expect(source).toContain('mcp-workflow-checks');
    expect(source).toContain('mcp-workflow-check');
    expect(source).not.toContain('id="new-mcp-form" style="display:none"');
    expect(source).not.toContain(
      "document.getElementById('new-mcp-form').style.display",
    );
    expect(catalog).not.toContain(
      'style="font-size:11px;color:var(--text-muted)"',
    );
    expect(catalog).not.toContain(
      'style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px"',
    );
    expect(catalog).not.toContain('class="mcp-catalog-card" style=');
    expect(catalog).not.toContain('class="mcp-catalog-step" style=');
    expect(mcp).not.toContain('id="mcp-permissions-note" style=');
    expect(mcp).not.toContain(
      'class="card mcp-document-workflows">\\n      <div style=',
    );
    expect(mcp).not.toContain(
      'class="card mcp-calendar-workflows">\\n      <div style=',
    );
    expect(mcp).not.toContain(
      'class="card mcp-email-workflows">\\n      <div style=',
    );
    expect(mcp).not.toContain(
      'style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;margin-bottom:12px"',
    );
    expect(mcp).not.toContain('style="display:grid;gap:6px"');
    expect(presets).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-bottom:12px"',
    );
    expect(presets).not.toContain(
      'class="channel-card" style="align-items:flex-start"',
    );
    expect(presets).not.toContain('style="flex:1;min-width:0"');
    expect(presets).not.toContain(
      'style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"',
    );
    expect(serverList).not.toContain(
      'style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px"',
    );
    expect(serverList).not.toContain(
      'style="font-size:16px;font-weight:600;color:var(--text)"',
    );
    expect(serverList).not.toContain(
      'style="font-family:var(--mono);font-size:12px;color:var(--text-muted);margin-top:2px"',
    );
    expect(serverList).not.toContain(
      'td style="width:120px;color:var(--text-muted)"',
    );
    expect(serverList).not.toContain('style="margin:2px"');
    expect(serverList).not.toContain(
      'style="margin-top:12px;padding:10px;background:var(--warning-bg)',
    );
    expect(source).not.toContain("api('/mcp/presets').catch(() => [])");
    expect(source).not.toContain("api('/mcp/catalog').catch(() => null)");
    expect(source).not.toContain(
      "api('/mcp/infomaniak-workflows').catch(() => null)",
    );
    expect(source).not.toContain(
      "api('/mcp/calendar-workflows').catch(() => null)",
    );
    expect(source).not.toContain(
      "api('/mcp/email-workflows').catch(() => null)",
    );
  });

  it('styles the MCP cockpit and workflow cards responsively', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.mcp-command-center');
    expect(source).toContain('.mcp-command-stats');
    expect(source).toContain('.mcp-prompt-strip');
    expect(source).toContain('.mcp-prompt-strip button');
    expect(source).toContain('.mcp-prompt-strip button:focus-visible');
    expect(source).toContain('.mcp-prompt-strip button small');
    expect(source).toContain('.mcp-decision-brief');
    expect(source).toContain('.mcp-decision-actions');
    expect(source).toContain('.mcp-decision-brief.is-attention');
    expect(source).toContain('.mcp-data-health');
    expect(source).toContain('.mcp-data-health.is-warning');
    expect(source).toContain('.mcp-data-health.is-ready');
    expect(source).toContain('.mcp-source-checklist');
    expect(source).toContain('.mcp-source-checklist-head');
    expect(source).toContain('.mcp-source-checklist-grid');
    expect(source).toContain('.mcp-source-check');
    expect(source).toContain('.mcp-outcome-bridge');
    expect(source).toContain('.mcp-outcome-bridge-head');
    expect(source).toContain('.mcp-outcome-grid');
    expect(source).toContain('.mcp-outcome-card');
    expect(source).toContain('.mcp-workflow-grid');
    expect(source).toContain('.mcp-workflow-card');
    expect(source).toContain('.mcp-server-form.is-hidden');
    expect(source).toContain('.mcp-form-note');
    expect(source).toContain('.mcp-form-env-note');
    expect(source).toContain('.mcp-health-grid');
    expect(source).toContain('.mcp-health-stat');
    expect(source).toContain('.mcp-health-note');
    expect(source).toContain('.mcp-catalog-panel-head');
    expect(source).toContain('.mcp-catalog-panel-title');
    expect(source).toContain('.mcp-catalog-summary');
    expect(source).toContain('.mcp-catalog-card');
    expect(source).toContain('.mcp-catalog-card-head');
    expect(source).toContain('.mcp-catalog-title');
    expect(source).toContain('.mcp-catalog-name');
    expect(source).toContain('.mcp-catalog-capabilities');
    expect(source).toContain('.mcp-catalog-steps');
    expect(source).toContain('.mcp-catalog-actions');
    expect(source).toContain('.mcp-permissions-note');
    expect(source).toContain('.mcp-workflow-panel-head');
    expect(source).toContain('.mcp-workflow-panel-title');
    expect(source).toContain('.mcp-workflow-list');
    expect(source).toContain('.mcp-workflow-item');
    expect(source).toContain('.mcp-workflow-item-head');
    expect(source).toContain('.mcp-workflow-item-detail');
    expect(source).toContain('.mcp-workflow-item-providers');
    expect(source).toContain('.mcp-workflow-approval');
    expect(source).toContain('.mcp-workflow-checks');
    expect(source).toContain('.mcp-workflow-check');
    expect(source).toContain('.mcp-preset-intro');
    expect(source).toContain('.mcp-preset-list');
    expect(source).toContain('.mcp-preset-card');
    expect(source).toContain('.mcp-preset-main');
    expect(source).toContain('.mcp-preset-name');
    expect(source).toContain('.mcp-preset-notes');
    expect(source).toContain('.mcp-preset-command');
    expect(source).toContain('.mcp-server-card');
    expect(source).toContain('.mcp-server-head');
    expect(source).toContain('.mcp-server-title');
    expect(source).toContain('.mcp-server-name');
    expect(source).toContain('.mcp-server-id');
    expect(source).toContain('.mcp-server-actions');
    expect(source).toContain('.mcp-server-table');
    expect(source).toContain('.mcp-server-cowork');
    expect(source).toContain('.mcp-server-cowork small.is-approval');
    expect(source).toContain('.mcp-server-env-badge');
    expect(source).toContain('.mcp-server-warning');
    expect(source).toContain('.mcp-server-note');
    expect(source).toContain('.link-button');
    expect(source).toContain('.mcp-catalog-use-cases');
    expect(source).toContain('.mcp-catalog-step');
    expect(source).toContain('.mcp-command-center');
    expect(source).toContain(
      '.mcp-command-stats {\n    grid-template-columns: repeat(2, minmax(0, 1fr));',
    );
    expect(source).toContain(
      '.mcp-workflow-grid {\n    grid-template-columns: 1fr;',
    );
    expect(source).toContain(
      '.mcp-server-cowork small {\n    justify-self: stretch;',
    );
    expect(source).toContain('.mcp-outcome-grid,');
  });

  it('uses class-based notes in the MCP add-server form', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const form = serverFormSource(appSource);

    expect(form).toContain('mcp-form-note');
    expect(form).toContain('mcp-form-env-note');
    expect(form).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-bottom:16px"',
    );
    expect(form).not.toContain(
      'style="font-size:11px;color:var(--text-muted);margin-bottom:12px"',
    );
    expect(styleSource).toContain('.mcp-form-note');
    expect(styleSource).toContain('.mcp-form-env-note');
  });

  it('uses recovery-oriented MCP action errors', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const mcpActions = source.slice(
      source.indexOf('function mcpActionErrorMessage'),
      source.indexOf('// AI Providers'),
    );

    expect(mcpActions).toContain('function mcpActionErrorMessage');
    expect(mcpActions).toContain(
      'MCP server was not added. Check the server name, command, args, and required credential names before using it from Cowork.',
    );
    expect(mcpActions).toContain(
      'MCP preset was not installed. Confirm the preset is available, credentials can be added, and the agent container can be rebuilt after install.',
    );
    expect(mcpActions).toContain(
      'MCP server was not removed. Check active project chats, scheduled workflows, and approval-gated connector use before retrying.',
    );
    expect(mcpActions).toContain(
      "toast(mcpActionErrorMessage('create', r), 'error')",
    );
    expect(mcpActions).toContain(
      "toast(mcpActionErrorMessage('preset', r), 'error')",
    );
    expect(mcpActions).toContain(
      "toast(mcpActionErrorMessage('delete', r), 'error')",
    );
    expect(mcpActions).not.toContain("toast(r.error || 'Failed', 'error')");
  });
});
