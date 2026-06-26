import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

const groupsRuntimeSource = (source: string) =>
  source.slice(
    source.indexOf('<section class="groups-routing-panel">'),
    source.indexOf('window.copyGroupRoutingBrief'),
  );

const groupsRestrictionsSource = (source: string) =>
  source.slice(
    source.indexOf('window.editRestrictions'),
    source.indexOf('window.saveRestrictions'),
  );

describe('Groups agent boundary UI', () => {
  it('frames groups as agent ownership and boundary control', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('groups-command-center');
    expect(source).toContain('Agent boundary cockpit');
    expect(source).toContain('Decide which agent owns each work stream');
    expect(source).toContain("navigate('channels')");
    expect(source).toContain("navigate('integrations')");
    expect(source).toContain("navigate('projects')");
    expect(source).toContain('groupWorkstreamCards');
    expect(source).toContain('groups-workstream-map');
  });

  it('maps group ownership across Copilot, Cowork, Code, and System workstreams', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("lane: 'Copilot'");
    expect(source).toContain("lane: 'Cowork'");
    expect(source).toContain("lane: 'Code'");
    expect(source).toContain("lane: 'System'");
    expect(source).toContain(
      'Channel-bound groups that can receive direct conversation work',
    );
    expect(source).toContain(
      'Groups with project, memory, or MCP context for collaborative work',
    );
    expect(source).toContain(
      'Main-capable operator groups for approvals, automation, and platform control',
    );
  });

  it('summarizes enabled agents, primary route, providers, and boundary scopes', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('enabledGroups');
    expect(source).toContain('primaryGroup');
    expect(source).toContain('restrictedGroups');
    expect(source).toContain('explicitMcpGroups');
    expect(source).toContain('providersInUse');
    expect(source).toContain('groupBoundaryLabel');
    expect(source).toContain('groupRoutingFocus');
    expect(source).toContain('renderGroupRoutingBrief');
    expect(source).toContain('Routing decision');
    expect(source).toContain('Primary channel');
    expect(source).toContain('groups-agent-grid');
    expect(source).toContain('groups-routing-brief');
    expect(source).toContain('Runtime editor');
  });

  it('copies group routing state as an ownership brief', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('groupRoutingBriefText');
    expect(source).toContain('groupOwnershipPromptText');
    expect(source).toContain('window.copyGroupRoutingBrief');
    expect(source).toContain('window.copyGroupOwnershipPrompt');
    expect(source).toContain('Copy routing brief');
    expect(source).toContain('Copy ownership prompt');
    expect(source).toContain('Group routing brief copied');
    expect(source).toContain('Group ownership prompt copied');
    expect(source).toContain('Copy group ownership prompt');
    expect(source).toContain('Review this NanoCrab group routing state.');
    expect(source).toContain('Create a NanoCrab group ownership plan.');
    expect(source).toContain('Workstream ownership:');
    expect(source).toContain(
      'Choose which group owns Copilot, Cowork, Code, and System work',
    );
    expect(source).toContain(
      'Assign Copilot to the group that should handle plain chat, lightweight replies, and quick clarification.',
    );
    expect(source).toContain(
      'Assign Cowork to the group that can own project files, durable artifacts, documents, memory context, and MCP-backed work.',
    );
    expect(source).toContain(
      'Assign Code to the group that should receive repository, issue, diff, test, PR, or GitHub Copilot handoffs.',
    );
    expect(source).toContain(
      'Assign System to the primary/main group that can own approvals, routines, monitoring, and platform operations.',
    );
    expect(source).toContain(
      'Keep memory as personal/shared context, not a substitute for project files or source citations.',
    );
    expect(source).toContain('external MCP/tool writes approval-gated');
    expect(source).toContain('window._groupRoutingState');
  });

  it('styles the groups cockpit and agent cards responsively', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.groups-command-center');
    expect(source).toContain('.groups-command-stats');
    expect(source).toContain('.groups-workstream-map');
    expect(source).toContain('.groups-workstream-card');
    expect(source).toContain('.groups-routing-brief');
    expect(source).toContain('.groups-routing-brief-actions');
    expect(source).toContain('.groups-routing-panel');
    expect(source).toContain('.groups-agent-grid');
    expect(source).toContain('.groups-agent-card');
  });

  it('uses class-based runtime editor and restrictions controls', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const runtime = groupsRuntimeSource(appSource);
    const restrictions = groupsRestrictionsSource(appSource);

    expect(runtime).toContain('groups-runtime-note');
    expect(runtime).toContain('groups-agent-toggle');
    expect(runtime).toContain('groups-agent-select');
    expect(runtime).toContain('groups-agent-trigger');
    expect(runtime).not.toContain(
      'style="padding:2px 6px;font-size:10px;margin-left:4px',
    );
    expect(restrictions).toContain('groups-restrictions-card');
    expect(restrictions).toContain('groups-restrictions-note');
    expect(restrictions).toContain('groups-restrictions-textarea');
    expect(restrictions).toContain('groups-restrictions-actions');
    expect(restrictions).toContain('groups-restrictions-message');
    expect(runtime).not.toContain('style="width:100%;min-height:120px');
    expect(restrictions).not.toContain('style="width:100%;min-height:120px');
    expect(styleSource).toContain('.groups-runtime-note');
    expect(styleSource).toContain('.groups-agent-controls');
    expect(styleSource).toContain('.groups-restrictions-card');
  });

  it('uses routing-oriented group action errors', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const actionBlock = source.slice(
      source.indexOf('window.copyGroupRoutingBrief'),
      source.indexOf('// Messages'),
    );

    expect(actionBlock).toContain('function groupActionErrorMessage');
    expect(actionBlock).toContain(
      'Provider route was not saved. Check provider readiness before sending more Copilot, Cowork, or channel work through this group.',
    );
    expect(actionBlock).toContain(
      'Bot agent state was not saved. Confirm the primary route still has an enabled owner before dispatching more work.',
    );
    expect(actionBlock).toContain(
      'Primary bot was not updated. Keep approvals, automation, and system work on the current primary route until this saves.',
    );
    expect(actionBlock).toContain(
      'Model route was not saved. Check provider model availability before relying on this group for agent runs.',
    );
    expect(actionBlock).toContain(
      'Runtime restrictions were not saved. Keep the previous guardrails in mind before allowing MCP, document, or code work through this group.',
    );
    expect(actionBlock).toContain(
      'Runtime restrictions were not cleared. Treat this group as still restricted until the routing state refreshes cleanly.',
    );
    expect(actionBlock).toContain(
      "toast(groupActionErrorMessage('provider', r), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(groupActionErrorMessage('provider', err), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(groupActionErrorMessage('enabled', r), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(groupActionErrorMessage('enabled', err), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(groupActionErrorMessage('primary', r), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(groupActionErrorMessage('primary', err), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(groupActionErrorMessage('model', r), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(groupActionErrorMessage('model', err), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(groupActionErrorMessage('restrictions', r), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(groupActionErrorMessage('restrictions', err), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(groupActionErrorMessage('clearRestrictions', r), 'error')",
    );
    expect(actionBlock).toContain(
      "toast(groupActionErrorMessage('clearRestrictions', err), 'error')",
    );
    expect(actionBlock).not.toContain("toast(r.error || 'Failed', 'error')");
    expect(actionBlock).not.toContain(
      "toast('Failed to update provider', 'error')",
    );
    expect(actionBlock).not.toContain(
      "toast('Failed to update bot agent', 'error')",
    );
    expect(actionBlock).not.toContain(
      "toast('Failed to set primary bot', 'error')",
    );
    expect(actionBlock).not.toContain(
      "toast('Failed to update model', 'error')",
    );
    expect(actionBlock).not.toContain(
      "toast('Failed to save restrictions', 'error')",
    );
    expect(actionBlock).not.toContain(
      "toast('Failed to clear restrictions', 'error')",
    );
  });
});
