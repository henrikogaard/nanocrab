import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Credentials access cockpit UI', () => {
  const credentialsSource = (source: string) =>
    source.slice(
      source.indexOf('async function renderCredentials'),
      source.indexOf('window.copyCredentialReadinessBrief'),
    );

  it('frames credentials as readiness for tools, channels, and external context', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('credentials-command-center');
    expect(source).toContain('Access cockpit');
    expect(source).toContain(
      'Credentials unlock tools, channels, and external context',
    );
    expect(source).toContain('credentialIsSet');
    expect(source).toContain('credentialCategory');
    expect(source).toContain('credentialCategoryDestination');
    expect(source).toContain('credentialWorkspaceLane');
    expect(source).toContain('renderCredentialReadinessBrief');
    expect(source).toContain('renderCredentialCoworkSourceRunway');
    expect(source).toContain('renderCredentialMcpPreflight');
    expect(source).toContain('credentialMcpPreflightSteps');
    expect(source).toContain('credentialCoworkSourceRunway');
    expect(source).toContain('Readiness queue');
    expect(source).toContain('Cowork source runway');
    expect(source).toContain('Cowork MCP preflight');
    expect(source).toContain('Missing keys');
    expect(source).toContain("navigate('integrations')");
    expect(source).toContain("navigate('approvals')");
  });

  it('maps credentials to Copilot, Cowork, Code, and System readiness lanes', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('credentials-lane-map');
    expect(source).toContain('credentialLaneCards');
    expect(source).toContain(
      'Providers and channel tokens for plain chat and messaging',
    );
    expect(source).toContain(
      'MCP, email, calendar, document, and project-context tools',
    );
    expect(source).toContain(
      'GitHub, Copilot, repository, and coding-agent access',
    );
    expect(source).toContain(
      'Security, webhooks, OAuth, custom secrets, and platform access',
    );
    expect(source).toContain("return 'Cowork'");
    expect(source).toContain("return 'Code'");
  });

  it('summarizes live and mock credential payloads without exposing secret values', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const credentials = credentialsSource(source);

    expect(source).toContain(
      'credential.isSet === true || credential.configured === true',
    );
    expect(source).toContain('readyMcpServers');
    expect(source).toContain('mcpMatrix');
    expect(source).toContain('credentialStats');
    expect(source).toContain('categoryStats');
    expect(source).toContain(
      'Custom keys are written to the environment store and audited',
    );
    expect(credentials).toContain('credentials-key-label');
    expect(credentials).toContain('credentials-key-meta');
    expect(credentials).toContain('credentials-actions-cell');
    expect(credentials).not.toContain('value}</td>');
    expect(credentials).not.toContain(
      'style="color:var(--text);font-weight:500"',
    );
    expect(credentials).not.toContain(
      'style="font-family:var(--mono);font-size:10px;color:var(--text-muted)"',
    );
    expect(credentials).not.toContain('td style="white-space:nowrap"');
  });

  it('copies credential readiness without exposing secret values', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('credentialReadinessBriefText');
    expect(source).toContain('credentialSetupRequestText');
    expect(source).toContain('window.copyCredentialReadinessBrief');
    expect(source).toContain('window.copyCredentialSetupRequest');
    expect(source).toContain('Credential readiness brief copied');
    expect(source).toContain('Credential setup request copied');
    expect(source).toContain('Copy credential setup request');
    expect(source).toContain('Copy request');
    expect(source).toContain(
      'Review this NanoCrab credential readiness state.',
    );
    expect(source).toContain('Credential setup request for NanoCrab.');
    expect(source).toContain(
      'Do not include or ask for raw secret values in this handoff.',
    );
    expect(source).toContain('Readiness by workspace lane:');
    expect(source).toContain(
      'For Cowork MCP work, confirm a tool-capable provider, source-system credentials, MCP server health, and approval policy before project chats read external context.',
    );
    expect(source).toContain(
      'For Code work, confirm GitHub/Copilot/repository access before assigning issues, tests, pull requests, or release automation.',
    );
    expect(source).toContain(
      'Return only readiness status, missing key names, and next safe action. Never return secret values.',
    );
    expect(source).toContain('Readiness by lane:');
    expect(source).toContain('Cowork MCP setup path:');
    expect(source).toContain(
      'Add provider credentials for a model that supports tool calls',
    );
    expect(source).toContain(
      'Add mail, calendar, document, storage, or custom MCP credentials needed for the project source systems',
    );
    expect(source).toContain(
      'Open Integrations to confirm MCP health, workflow prompts, and ready servers',
    );
    expect(source).toContain(
      'Open Approvals before any workflow can publish documents, send email, edit calendars, or update external systems',
    );
    expect(source).toContain(
      'Start in a Cowork project so summaries, documents, and artifacts are saved beside the source context',
    );
    expect(source).toContain('Cowork source runway:');
    expect(source).toContain('- ${step.label}: ${step.detail}');
    expect(source).toContain('Ask in project chat');
    expect(source).toContain('Connect source MCP');
    expect(source).toContain('Generate artifact');
    expect(source).toContain('Approve external writes');
    expect(source).toContain(
      'Start from a Cowork project chat so email summaries, source notes, and generated files land in the right project.',
    );
    expect(source).toContain(
      'Cowork can turn gathered context into a summary, document, project file, or follow-up task.',
    );
    expect(source).toContain('Cowork MCP credential preflight:');
    expect(source).toContain('- ${step.label}: ${step.detail}');
    expect(source).toContain(
      'Confirm at least one chat provider key or OAuth profile is ready for tool-capable Cowork agents.',
    );
    expect(source).toContain(
      'Add the mail, calendar, document, storage, or custom MCP secrets needed for the project source systems.',
    );
    expect(source).toContain(
      'Open Integrations and verify MCP servers report ready before asking a project chat to gather external context.',
    );
    expect(source).toContain(
      'Keep document publishing, email sends, calendar edits, and external updates behind approval policy.',
    );
    expect(source).toContain('Do not expose secret values in handoffs');
    expect(source).toContain('external tool writes approval-gated');
    expect(source).toContain('window._credentialReadinessState');
  });

  it('keeps the custom key form class-driven and compact', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const credentials = credentialsSource(source);

    expect(credentials).toContain('credentials-add-panel');
    expect(credentials).toContain(
      'id="add-cred-form" class="credentials-add-form"',
    );
    expect(credentials).toContain('form-group credentials-add-field');
    expect(credentials).toContain('form-group credentials-add-field is-wide');
    expect(credentials).toContain('id="cred-new-key"');
    expect(credentials).toContain('id="cred-new-val"');
    expect(credentials).not.toContain('class="credentials-add-form" style=');
    expect(credentials).not.toContain('id="add-cred-form" style=');
    expect(credentials).not.toContain(
      'style="flex:1;min-width:120px;margin:0"',
    );
    expect(credentials).not.toContain(
      'style="flex:2;min-width:200px;margin:0"',
    );
  });

  it('uses recovery-oriented credential action errors', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const actionBlock = source.slice(
      source.indexOf('function credentialActionErrorMessage'),
      source.indexOf('// MCP Servers'),
    );

    expect(actionBlock).toContain('function credentialActionErrorMessage');
    expect(actionBlock).toContain(
      'Credential was not added. Check the key name, value, and whether this secret should unlock Providers, Cowork MCP, Code, or System work.',
    );
    expect(actionBlock).toContain(
      'Credential was not updated. Treat the related provider, connector, channel, or Code workflow as not ready until this saves.',
    );
    expect(actionBlock).toContain(
      'Credential was not removed. Check dependent providers, MCP servers, channels, and scheduled work before assuming access was revoked.',
    );
    expect(actionBlock).toContain(
      "toast(credentialActionErrorMessage('add', r), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(credentialActionErrorMessage('edit', r), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(credentialActionErrorMessage('delete', r), 'error')",
    );
    expect(actionBlock).toContain("toast('Credential added', 'success')");
    expect(actionBlock).toContain("const r = await api('/credentials',");
    expect(actionBlock).toContain(
      "const r = await api(`/credentials/${key}`, { method: 'DELETE' })",
    );
    expect(actionBlock).not.toContain("toast(r.error || 'Failed', 'error')");
  });

  it('styles the credentials cockpit and categories responsively', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.credentials-command-center');
    expect(source).toContain('.credentials-command-stats');
    expect(source).toContain('.credentials-readiness-brief');
    expect(source).toContain('.credentials-readiness-actions');
    expect(source).toContain('.credentials-source-runway');
    expect(source).toContain('.credentials-source-runway-grid');
    expect(source).toContain('.credentials-source-step');
    expect(source).toContain('.credentials-mcp-preflight');
    expect(source).toContain('.credentials-mcp-preflight-steps');
    expect(source).toContain('.credentials-mcp-preflight-step');
    expect(source).toContain('.credentials-category-grid');
    expect(source).toContain('.credentials-lane-map');
    expect(source).toContain('.credentials-lane-card');
    expect(source).toContain('.credentials-key-label');
    expect(source).toContain('.credentials-key-meta');
    expect(source).toContain('.credentials-actions-cell');
    expect(source).toContain('.credentials-add-panel');
    expect(source).toContain('.credentials-add-form');
    expect(source).toContain('.credentials-add-field');
    expect(source).toContain(
      '.credentials-command-stats,\n  .credentials-readiness-actions,\n  .credentials-source-runway-grid,\n  .credentials-mcp-preflight-steps,\n  .credentials-category-grid,\n  .credentials-lane-map {\n    grid-template-columns: repeat(2, minmax(0, 1fr));',
    );
    expect(source).toContain(
      '.credentials-category-grid,\n  .credentials-lane-map {\n    grid-template-columns: 1fr;',
    );
    expect(source).toContain(
      '.credentials-readiness-actions {\n    grid-template-columns: 1fr;',
    );
    expect(source).toContain(
      '.credentials-source-runway-grid {\n    grid-template-columns: 1fr;',
    );
    expect(source).toContain(
      '.credentials-mcp-preflight-steps {\n    grid-template-columns: 1fr;',
    );
  });
});
