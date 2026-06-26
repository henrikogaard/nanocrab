import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Audit policy review cockpit UI', () => {
  it('frames audit as a policy trail for agent decisions', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Policy trail');
    expect(source).toContain('Policy review cockpit');
    expect(source).toContain(
      'Understand the decision path before trusting the next automation',
    );
    expect(source).toContain('audit-command-center');
    expect(source).toContain('auditReviewBriefText');
    expect(source).toContain('auditTraceRecoverySteps');
    expect(source).toContain('renderAuditTraceRecovery');
    expect(source).toContain('auditHandoffMatrix');
    expect(source).toContain('renderAuditHandoffMatrix');
    expect(source).toContain('NanoCrab audit review brief');
    expect(source).toContain('Copy review brief');
    expect(source).toContain('copyAuditReviewBrief');
    expect(source).toContain('Audit review brief copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("prompt('Copy audit review brief:'");
    expect(source).toContain('window._auditReviewState');
  });

  it('surfaces decision counts, actors, correlations, and review queue', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('decisionCounts');
    expect(source).toContain('uniqueActors');
    expect(source).toContain('correlationCount');
    expect(source).toContain('reviewQueue');
    expect(source).toContain('audit-review-strip');
    expect(source).toContain('audit-review-card');
    expect(source).toContain('audit-trace-recovery');
    expect(source).toContain('Trace recovery path');
    expect(source).toContain('Resume from evidence, not guesswork.');
    expect(source).toContain('Match the correlation');
    expect(source).toContain('Find missing proof');
    expect(source).toContain('Rerun read-only');
    expect(source).toContain('Export the trail');
    expect(source).toContain(
      'Use Audit to explain why Copilot, Cowork, Code, MCP, webhook, provider, and approval actions were allowed or blocked',
    );
    expect(source).toContain(
      'Replay correlations before retrying failed automation or granting broader permissions',
    );
    expect(source).toContain(
      'Keep external writes approval-gated when audit events involve documents, email, calendar, webhooks, repositories, or third-party data',
    );
    expect(source).toContain('Reconstruction checklist');
    expect(source).toContain(
      'Match approval, MCP tool, credential, provider, and project-chat events by correlation ID before retrying the workflow',
    );
    expect(source).toContain(
      'confirm the source system, search window, project ID, draft artifact path, and external target are all visible in the trail',
    );
    expect(source).toContain(
      'rerun as a read-only Cowork request and require a cited project draft before external writes',
    );
    expect(source).toContain(
      'credentials, connector permissions, provider tool support, approval policy, or missing project context',
    );
    expect(source).toContain(
      'Attach the exported audit JSON to incidents, security reviews, or operator handoffs',
    );
    expect(source).toContain(
      'Group approval, MCP tool, provider, credential, project-chat, webhook, and artifact events before retrying work',
    );
    expect(source).toContain(
      'source system, search window, project ID, draft artifact path, external target, and approval reference',
    );
    expect(source).toContain('Audit handoff matrix');
    expect(source).toContain('Turn the trail into the next owned action.');
    expect(source).toContain(
      'After replaying the correlation, route the follow-up to the workspace that can close the evidence gap.',
    );
    expect(source).toContain(
      'Use when missing source proof should become a read-only project chat, cited draft, document, or artifact.',
    );
    expect(source).toContain(
      'Use when credentials, MCP health, webhooks, provider fallback, uptime, or runtime state explains the event.',
    );
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('gitcode')");
    expect(source).toContain("navigate('monitoring')");
  });

  it('keeps filtering, replay, simulator, and export controls wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('auditQueryFromFilters');
    expect(source).toContain('renderAuditDetail(selected, replay)');
    expect(source).toContain('policy-simulator-form');
    expect(source).toContain('exportAuditJson');
    expect(source).toContain('applyAuditDecisionFilter');
  });

  it('turns empty audit states into review routing actions', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderAuditEmptyState');
    expect(source).toContain('audit-empty-state');
    expect(source).toContain('audit-empty-flow');
    expect(source).toContain('audit-empty-actions');
    expect(source).toContain('No audit events match these filters');
    expect(source).toContain('Select an audit event');
    expect(source).toContain("renderAuditEmptyState('events')");
    expect(source).toContain("renderAuditEmptyState('select')");
    expect(source).toContain("navigate('approvals')");
    expect(source).toContain('copyAuditReviewBrief()');
    expect(source).toContain('exportAuditJson()');
    expect(source).not.toContain(
      '<div class="empty">No audit events match these filters.</div>',
    );
    expect(source).not.toContain(
      '<aside class="audit-detail empty">Select an audit event</aside>',
    );
    expect(style).toContain('.audit-empty-state');
    expect(style).toContain('.audit-empty-flow');
    expect(style).toContain('.audit-empty-actions');
  });

  it('styles the audit page as a responsive review cockpit', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.audit-command-center');
    expect(source).toContain('.audit-command-stats');
    expect(source).toContain('.audit-review-strip');
    expect(source).toContain('.audit-review-card');
    expect(source).toContain('.audit-trace-recovery');
    expect(source).toContain('.audit-trace-recovery-head');
    expect(source).toContain('.audit-trace-recovery-grid');
    expect(source).toContain('.audit-trace-step');
    expect(source).toContain('.audit-handoff-matrix');
    expect(source).toContain('.audit-handoff-head');
    expect(source).toContain('.audit-handoff-grid');
    expect(source).toContain('.audit-handoff-card');
    expect(source).toContain('.audit-empty-state');
    expect(source).toContain('.audit-empty-actions');
    expect(source).toContain('.audit-command-center,\n  .audit-review-grid');
    expect(source).toContain(
      '.audit-review-grid,\n  .audit-trace-recovery-grid',
    );
    expect(source).toContain(
      '.audit-trace-recovery-grid,\n  .audit-handoff-grid',
    );
  });
});
