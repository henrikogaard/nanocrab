import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Approval inbox UI wiring', () => {
  it('summarizes approval impact and exposes productivity quick filters', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('function approvalImpact');
    expect(source).toContain('function approvalHasSourceProof');
    expect(source).toContain('function approvalDecisionReadiness');
    expect(source).toContain('function approvalDecisionReadinessHtml');
    expect(source).toContain('function isExternalWriteApproval');
    expect(source).toContain('function renderApprovalDecisionBrief');
    expect(source).toContain('function approvalDecisionBriefText');
    expect(source).toContain('function approvalRevisionPromptText');
    expect(source).toContain('function approvalDecisionNoteTemplateText');
    expect(source).toContain('function approvalPolicyRunbookText');
    expect(source).toContain('function approvalSaferAlternativeLadder');
    expect(source).toContain('function renderApprovalSaferAlternativeLadder');
    expect(source).toContain('function approvalDecisionRunway');
    expect(source).toContain('function renderApprovalDecisionRunway');
    expect(source).toContain('function mostCommonApprovalWorkType');
    expect(source).toContain('function approvalLaneLabel');
    expect(source).toContain('approvalLaneCards');
    expect(source).toContain('Decision queue');
    expect(source).toContain('Needs caution');
    expect(source).toContain('Needs source proof');
    expect(source).toContain('Ready for narrow approval');
    expect(source).toContain('Already reviewed');
    expect(source).toContain('Review intent');
    expect(source).toContain('approvalImpactHtml(approval)');
    expect(source).toContain('approvalDecisionReadinessHtml(approval)');
    expect(source).toContain(
      'Decision readiness: ${readiness.label} - ${readiness.detail}',
    );
    expect(source).toContain(
      'Confirm source system, search window, target, payload preview, and Cowork draft before approval.',
    );
    expect(source).toContain(
      'Approve only if the preview matches the request and the audit note names the source.',
    );
    expect(source).toContain('Copy brief');
    expect(source).toContain('Revision prompt');
    expect(source).toContain('Copy policy runbook');
    expect(source).toContain('data-copy-approval');
    expect(source).toContain('data-copy-revision');
    expect(source).toContain('approval-note-panel is-hidden');
    expect(source).toContain('window.showApprovalNotePanel');
    expect(source).toContain('approval-note-input');
    expect(source).toContain(
      'Optional: explain the decision, source, or follow-up needed.',
    );
    expect(source).toContain('Use note template');
    expect(source).toContain('window.fillApprovalDecisionNoteTemplate');
    expect(source).toContain('Approved with boundaries.');
    expect(source).toContain('Denied pending revision.');
    expect(source).toContain(
      'The preview is narrow, source-backed, and matches the requested work.',
    );
    expect(source).toContain(
      'The preview needs a smaller, better-cited, or safer next step before external changes.',
    );
    expect(source).toContain('Evidence checked:');
    expect(source).toContain(
      'Local Cowork draft, summary, artifact, or read-only MCP result exists when external publishing is requested.',
    );
    expect(source).toContain('Proceed only with the previewed action.');
    expect(source).toContain(
      'Ask Cowork for a cited local draft, narrower read-only MCP summary, or revised approval preview before trying the external write again.',
    );
    expect(source).toContain(
      'showApprovalNotePanel(id, actionButton.dataset.action)',
    );
    expect(source).toContain(
      'async function reviewInboxApproval(id, decision, note)',
    );
    expect(source).not.toContain('const note = prompt(');
    expect(source).toContain('function renderApprovalPanelEmptyState');
    expect(source).toContain('approval-panel-empty-state');
    expect(source).toContain('Approval inspector');
    expect(source).toContain('Select an approval to inspect provenance');
    expect(source).toContain(
      'Review source, target, payload, and impact before allowing agents',
    );
    expect(source).toContain('approval-readiness-panel');
    expect(source).toContain('Intent matches request');
    expect(source).toContain('Source context is cited');
    expect(source).toContain('External writes are narrow');
    expect(source).not.toContain(
      '<div class="approval-panel empty">Select an approval to inspect provenance.</div>',
    );
    expect(source).toContain('window.copyApprovalDecisionBrief');
    expect(source).toContain('window.copyApprovalRevisionPrompt');
    expect(source).toContain('Approval revision prompt copied');
    expect(source).toContain(
      'Revise this NanoCrab approval request into the smallest safe next step.',
    );
    expect(source).toContain(
      'If this can be answered with a read-only MCP call, project summary, or local Cowork draft, do that first.',
    );
    expect(source).toContain(
      'If an external write is still needed, narrow the target, payload, recipient, document, calendar range, repository path, or webhook destination.',
    );
    expect(source).toContain(
      'Cite the source system, search window, file path, sender/domain, project artifact, or user instruction that justifies the action.',
    );
    expect(source).toContain(
      'Return a new approval preview with the exact changed fields and why the narrower action is safe.',
    );
    expect(source).toContain('window.copyApprovalPolicyRunbook');
    expect(source).toContain('NanoCrab approval policy runbook');
    expect(source).toContain('Approve when:');
    expect(source).toContain('MCP and document source checklist:');
    expect(source).toContain('Safer alternative ladder:');
    expect(source).toContain('Approval decision runway:');
    expect(source).toContain('Verify source');
    expect(source).toContain('Prefer draft first');
    expect(source).toContain('Leave audit trail');
    expect(source).toContain(
      'Check the requester, source system, search window, target, and cited project context before trusting the preview.',
    );
    expect(source).toContain(
      'ask Cowork for a cited project draft or read-only MCP summary before external writes.',
    );
    expect(source).toContain(
      'Add a note when approving or denying so the next agent can see the source, decision, and follow-up route.',
    );
    expect(source).toContain('Approve narrow write');
    expect(source).toContain('Ask for revision');
    expect(source).toContain('Rerun read-only');
    expect(source).toContain('Route back to workspace');
    expect(source).toContain('Choose the smallest useful permission.');
    expect(source).toContain(
      'Before approving MCP, document, email, calendar, webhook, or repository writes',
    );
    expect(source).toContain(
      'The approval cites the source system, search window, sender/domain, file path, calendar range, or document target used by the agent.',
    );
    expect(source).toContain(
      'A project workspace draft or artifact exists before publishing to an external document system.',
    );
    expect(source).toContain(
      'Email sends include recipients, subject, body preview, and the source thread or project instruction that justifies sending.',
    );
    expect(source).toContain(
      'Calendar writes include event title, time range, attendees, and the source request or project deadline.',
    );
    expect(source).toContain(
      'ask for a Cowork draft, cited summary, or narrower read-only MCP request first.',
    );
    expect(source).toContain('Deny or ask for revision when:');
    expect(source).toContain(
      'Source context is cited for MCP-backed email, document, calendar, webhook, and project actions.',
    );
    expect(source).toContain(
      'A read-only summary or Cowork project draft would satisfy the request with less risk.',
    );
    expect(source).toContain(
      'Copilot: plain conversation and draft replies before sending.',
    );
    expect(source).toContain(
      'Cowork: project files, artifacts, summaries, documents, and approved MCP source gathering.',
    );
    expect(source).toContain(
      'Code: repository writes, pull requests, GitHub Copilot tasks, test evidence, and review gates.',
    );
    expect(source).toContain(
      'System: webhooks, providers, schedules, uptime, credentials, and platform control.',
    );
    expect(source).toContain('Review this NanoCrab approval request');
    expect(source).toContain('Decide whether this matches the user intent');
    expect(source).toContain('MCP action');
    expect(source).toContain('External writes');
    expect(source).toContain('applyApprovalQuickFilter');
    expect(source).toContain("externalWrites:'1'");
    expect(source).toContain("reviewed:'1'");
    expect(source).toContain("approval.status !== 'pending'");
    expect(source).toContain('project documents');
  });

  it('maps approval pressure across Copilot, Cowork, Code, System, and operator lanes', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('approval-lane-map');
    expect(source).toContain(
      'MCP tools, project documents, artifacts, and external context',
    );
    expect(source).toContain(
      'Outbound messages and plain conversation actions',
    );
    expect(source).toContain(
      'Repository writes, pull request work, and coding-agent handoffs',
    );
    expect(source).toContain(
      'Webhooks, provider fallback, and platform-level delivery',
    );
    expect(source).toContain('Manual gates that need a human decision');
    expect(source).toContain("return 'Cowork'");
    expect(source).toContain("return 'Code'");
  });

  it('requires a healthy complete runtime for coding-job fallback approval', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/agents/coding/runtimes')");
    expect(source).toContain('isCodingRuntimeFallbackApproval');
    expect(source).toContain('Runner CLI');
    expect(source).toContain('Provider');
    expect(source).toContain('Model');
    expect(source).toContain('approvalRuntimeOptionsForCli');
    expect(source).toContain('approvalRuntimeOptionsForProvider');
    expect(source).toContain('runtime.readiness.detail');
    expect(source).toContain("runtime?.readiness.status === 'healthy'");
    expect(source).toContain('Coding runtime catalog unavailable');
    expect(source).toContain('No compatible coding runtimes are available');
    expect(source).toContain(
      "Devin sends the prompt, selected repository content, and tool results to Devin's external service.",
    );
    expect(source).toContain('body.runtime = { cli, provider, model }');
    expect(source).toContain('body: JSON.stringify(body)');
    expect(source).not.toContain("provider === 'devin'");
  });

  it('turns filtered approval empties into routing decisions', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderApprovalEmptyState');
    expect(source).toContain('approval-empty-state');
    expect(source).toContain('approval-empty-flow');
    expect(source).toContain('approval-empty-actions');
    expect(source).toContain('No pending approvals match these filters');
    expect(source).toContain('No reviewed approvals match these filters');
    expect(source).toContain('Copy runbook</button>');
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('gitcode')");
    expect(source).toContain("navigate('audit')");
    expect(source).toContain("renderApprovalEmptyState('pending')");
    expect(source).toContain("renderApprovalEmptyState('history')");
    expect(source).not.toContain(
      '<div class="card empty">No pending approvals match these filters.</div>',
    );
    expect(source).not.toContain(
      '<div class="card empty">No reviewed approvals match these filters.</div>',
    );
    expect(style).toContain('.approval-empty-state');
    expect(style).toContain('.approval-empty-flow');
    expect(style).toContain('.approval-empty-actions');
  });

  it('styles approval impact, overview stats, and responsive quick filters', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.approval-overview');
    expect(source).toContain('.approval-stat');
    expect(source).toContain('.approval-decision-brief');
    expect(source).toContain('.approval-brief-primary');
    expect(source).toContain('.approval-brief-metrics');
    expect(source).toContain('.approval-lane-map');
    expect(source).toContain('.approval-lane-card');
    expect(source).toContain('.approval-decision-runway');
    expect(source).toContain('.approval-decision-runway-head');
    expect(source).toContain('.approval-decision-runway-grid');
    expect(source).toContain('.approval-runway-step');
    expect(source).toContain('.approval-safer-ladder');
    expect(source).toContain('.approval-safer-ladder-head');
    expect(source).toContain('.approval-safer-ladder-grid');
    expect(source).toContain('.approval-safer-step');
    expect(source).toContain('.approval-quick-filters');
    expect(source).toContain('.approval-impact');
    expect(source).toContain('.approval-impact-external');
    expect(source).toContain('.approval-impact-panel');
    expect(source).toContain('.approval-readiness');
    expect(source).toContain('.approval-readiness.is-attention');
    expect(source).toContain('.approval-readiness.is-ready');
    expect(source).toContain('.approval-readiness.is-reviewed');
    expect(source).toContain('.approval-readiness-panel');
    expect(source).toContain('.approval-card-actions [data-copy-approval]');
    expect(source).toContain('.approval-card-actions [data-copy-revision]');
    expect(source).toContain('.approval-note-panel');
    expect(source).toContain('.approval-note-panel.is-hidden');
    expect(source).toContain('.approval-note-input');
    expect(source).toContain('.approval-note-actions');
    expect(source).toContain('.approval-panel-empty-state');
    expect(source).toContain('.approval-panel-checklist');
    expect(source).toContain('.approval-panel-empty-actions');
    expect(source).toContain('.approval-empty-state');
    expect(source).toContain('.approval-empty-actions');
    expect(source).toContain('.approval-safer-ladder-grid,');
    expect(source).toContain('.approval-decision-runway-grid,');
  });

  it('keeps mock-mode websocket reconnects from spamming console errors', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('let wsReconnectTimer = null');
    expect(source).toContain("console.debug('WS error:', e)");
    expect(source).toContain('if (!window._mockMode) {');
    expect(source).toContain('wsReconnectTimer = setTimeout(connectWs, 5000)');
    expect(source).toContain('WS: no mock session cookie found');
  });
});
