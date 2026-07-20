import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

const securityPostureSource = (source: string) =>
  source.slice(
    source.indexOf('<section class="security-posture-grid">'),
    source.indexOf('// Load unregistered conversations'),
  );

describe('Security trust cockpit UI', () => {
  it('frames security as trust controls for agent automation', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Trust controls');
    expect(source).toContain('Trust cockpit');
    expect(source).toContain('Trust decision');
    expect(source).toContain(
      'protects the operator, the agents, and the work they touch',
    );
    expect(source).toContain("navigate('audit')");
    expect(source).toContain("navigate('credentials')");
  });

  it('separates access boundary, agent isolation, allowlist, and hardening moves', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Access boundary');
    expect(source).toContain('Agent isolation');
    expect(source).toContain('IP Allowlist');
    expect(source).toContain('Next hardening moves');
    expect(source).toContain('security-check-card');
    expect(source).toContain('security-recommendation-list');
    expect(source).toContain('security-trust-brief');
    expect(source).toContain('trustDecision');
    expect(source).toContain('trustRoutes');
    expect(source).toContain(
      'Security posture needs attention before expanding automation',
    );
    expect(source).toContain(
      'Trust controls are ready for productive agent work',
    );
  });

  it('keeps allowlist and audit controls wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const allowlistSaveSource = source.slice(
      source.indexOf("document.getElementById('sec-allowlist-save').onclick"),
      source.indexOf(
        '}\n\nwindow.copySecurityPostureBrief',
        source.indexOf("document.getElementById('sec-allowlist-save').onclick"),
      ),
    );

    expect(source).toContain('id="sec-allowlist-toggle"');
    expect(source).toContain('id="sec-allowlist-save"');
    expect(source).toContain('id="sec-allowlist-ips"');
    expect(source).toContain('<label for="sec-allowlist-ips">Allowed IPs');
    expect(source).toContain('loadUnregisteredConversations');
    expect(source).toContain('renderUnregisteredConversationState');
    expect(source).toContain('unregistered-empty-state');
    expect(source).toContain("renderUnregisteredConversationState('loading')");
    expect(source).toContain('Loading unregistered conversations');
    expect(source).toContain(
      'Scanning recent channel activity before deciding whether new conversations should become Copilot chats, Cowork projects, or registered groups.',
    );
    expect(source).toContain('No unregistered conversations found');
    expect(source).toContain('Failed to load unregistered conversations');
    expect(source).toContain('Register group');
    expect(source).toContain("navigate('channels')");
    expect(source).toContain("navigate('groups')");
    expect(source).toContain('unregistered-message-row is-hidden');
    expect(source).toContain('renderUnregisteredMessagesEmptyState');
    expect(source).toContain('No retained transcript');
    expect(source).toContain('Register it only if the source is trusted');
    expect(source).toContain('toggleUnregMessages');
    expect(source).toContain("el?.classList.toggle('is-hidden')");
    expect(source).not.toContain(
      '<div id="unregistered-list"><div class="loading">Loading</div></div>',
    );
    expect(source).not.toContain('style="display:none"');
    expect(source).not.toContain(
      "el.style.display === 'none' ? 'table-row' : 'none'",
    );
    expect(allowlistSaveSource).toContain(
      "setInlineStatus(m, 'Saved', 'success')",
    );
    expect(allowlistSaveSource).toContain("setInlineStatus(m, '')");
    expect(allowlistSaveSource).not.toContain('m.style.color');
    expect(source).toContain('Audit Log');
  });

  it('turns an empty security audit log into an actionable trust path', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderSecurityAuditEmptyState');
    expect(source).toContain('security-audit-empty-state');
    expect(source).toContain(
      'Start with a low-risk project chat, MCP read, or approval request',
    );
    expect(source).toContain('Run one guarded action');
    expect(source).toContain('Review the decision trail');
    expect(source).toContain('Copy the posture brief');
    expect(source).toContain("navigate('projects')");
    expect(source).toContain('copySecurityPostureBrief()');
    expect(source).not.toContain(
      '\'<div class="empty">No audit entries yet</div>\'',
    );
    expect(styleSource).toContain('.security-audit-empty-state');
    expect(styleSource).toContain('.security-audit-empty-flow');
    expect(styleSource).toContain('.security-audit-empty-flow article button');
    expect(styleSource).toContain(
      '.security-audit-empty-flow {\n    grid-template-columns: 1fr;',
    );
  });

  it('uses class-based posture rows, allowlist actions, and audit cells', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const posture = securityPostureSource(appSource);

    expect(posture).toContain('security-check-dot');
    expect(posture).toContain('security-check-main');
    expect(posture).toContain('security-check-name');
    expect(posture).toContain('security-check-desc');
    expect(posture).toContain('security-allowlist-head');
    expect(posture).toContain('security-status-msg');
    expect(posture).toContain('security-audit-table-wrap');
    expect(posture).toContain('security-audit-time');
    expect(posture).toContain('security-audit-actor');
    expect(posture).toContain('security-audit-details');
    expect(posture).toContain('security-audit-device');
    expect(posture).toContain('security-section-note');
    expect(posture).not.toContain('style="margin-top:6px;flex-shrink:0"');
    expect(posture).not.toContain('style="flex:1"');
    expect(posture).not.toContain(
      'style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"',
    );
    expect(posture).not.toContain('style="max-height:400px;overflow-y:auto"');
    expect(posture).not.toContain('style="white-space:nowrap;font-size:11px"');
    expect(posture).not.toContain(
      'style="font-family:var(--mono);font-size:11px"',
    );
    expect(styleSource).toContain('.security-check-row');
    expect(styleSource).toContain('.security-audit-table-wrap');
    expect(styleSource).toContain('.security-section-note');
    expect(styleSource).toContain('.security-status-msg.is-success');
    expect(styleSource).toContain('.security-status-msg.is-error');
  });

  it('copies a security posture brief before expanding automation', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('securityPostureBriefText');
    expect(source).toContain('window.copySecurityPostureBrief');
    expect(source).toContain('Copy posture brief');
    expect(source).toContain('Security posture brief copied');
    expect(source).toContain(
      'Review this NanoCrab security posture before expanding agent automation.',
    );
    expect(source).toContain('Checks needing attention:');
    expect(source).toContain(
      'external MCP/tool writes scoped and approval-gated',
    );
    expect(source).toContain('Safe autonomy checklist:');
    expect(source).toContain(
      'Confirm the actor, route, source system, target system, credential scope, and approval boundary are visible in Audit before broadening access.',
    );
    expect(source).toContain(
      'Keep MCP/email/document/calendar writes in read-only or approval-required mode until a Cowork draft and artifact path exist.',
    );
    expect(source).toContain(
      'Use narrow project mounts and group MCP allowlists before giving agents reusable workspace access.',
    );
    expect(source).toContain(
      'If trust evidence is missing, pause automation and rerun the task as a low-risk project chat or read-only MCP request.',
    );
    expect(source).toContain('window._securityPostureState');
  });

  it('copies a Cowork-ready hardening plan with MCP guardrails', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('securityHardeningPlanText');
    expect(source).toContain('window.copySecurityHardeningPlan');
    expect(source).toContain('Copy hardening plan');
    expect(source).toContain('Security hardening plan copied');
    expect(source).toContain('NanoCrab security hardening plan');
    expect(source).toContain('Cowork task brief:');
    expect(source).toContain(
      'Create a project chat that reviews this posture, proposes the smallest safe next automation, and writes a short artifact summarizing the decision.',
    );
    expect(source).toContain('MCP and document guardrails:');
    expect(source).toContain(
      'Start with read-only MCP calls for email, documents, calendars, and external systems.',
    );
    expect(source).toContain(
      'Require approval before creating, editing, sending, or deleting external resources.',
    );
    expect(source).toContain(
      'Save summaries, drafts, and generated documents inside the Cowork project before allowing external writes.',
    );
    expect(source).toContain(
      'Mention the MCP server, credential scope, source data, and destination artifact in the task notes.',
    );
    expect(source).toContain('Recommended moves:');
    expect(styleSource).toContain('.security-trust-actions');
    expect(styleSource).toContain('.security-stat small');
  });

  it('styles the security surface as a responsive cockpit', () => {
    const source = fs.readFileSync(stylePath, 'utf8');
    const routeStyles = source.slice(
      source.indexOf('.security-trust-routes {'),
      source.indexOf('.security-posture-grid {'),
    );
    const cardStyles = source.slice(
      source.indexOf('.security-check-card {'),
      source.indexOf('.security-check-card.warn {'),
    );

    expect(source).toContain('.security-command-center');
    expect(source).toContain('.security-command-stats');
    expect(source).toContain('.security-trust-brief');
    expect(source).toContain('.security-trust-brief.is-attention');
    expect(source).toContain('.security-trust-routes');
    expect(routeStyles).toContain('display: grid;');
    expect(routeStyles).toContain(
      'grid-template-columns: repeat(4, minmax(0, 1fr));',
    );
    expect(routeStyles).toContain('.security-route-card {');
    expect(source).toContain('.security-posture-grid');
    expect(source).toContain('.security-check-card');
    expect(cardStyles).toContain('display: grid;');
    expect(cardStyles).toContain('align-content: start;');
    expect(source).toContain('.security-allowlist-input');
    expect(source).toContain('.security-check-row');
    expect(source).toContain('.security-audit-table-wrap');
    expect(source).toContain('.security-section-note');
    expect(source).toContain('.unregistered-message-row.is-hidden');
    expect(source).toContain('.unregistered-empty-state');
    expect(source).toContain('.unregistered-empty-state.is-error');
    expect(source).toContain('.unregistered-empty-flow');
    expect(source).toContain('.unregistered-empty-actions');
    expect(source).toContain('.unregistered-message-empty-flow');
    expect(source).toContain('.unregistered-message-empty-actions');
    expect(source).toContain(
      '.security-command-center,\n  .security-posture-grid',
    );
    expect(source).toContain(
      '.security-trust-brief {\n    flex-direction: column;',
    );
  });
});
