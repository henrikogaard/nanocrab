import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Workflows automation cockpit UI', () => {
  it('frames workflows as supervised automation and mission work', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Automation cockpit');
    expect(source).toContain(
      'Turn repeatable work into supervised agent routines',
    );
    expect(source).toContain('workflow-command-center');
    expect(source).toContain('workflow-stats');
    expect(source).toContain('workflow-brief');
    expect(source).toContain('workflowAutomationPromotionGate');
    expect(source).toContain('workflowAutomationFitLanes');
    expect(source).toContain('renderWorkflowAutomationFit');
    expect(source).toContain('renderWorkflowAutomationGate');
    expect(source).toContain('workflow-fit-matrix');
    expect(source).toContain('workflow-fit-grid');
    expect(source).toContain('workflow-automation-gate');
    expect(source).toContain('workflow-automation-gate-grid');
    expect(source).toContain('workflow-operations-grid');
    expect(source).toContain('workflow-card-grid');
    expect(source).toContain('workflowOperationsBriefText');
    expect(source).toContain('missionResumeBriefText');
    expect(source).toContain('workflowTriggerBriefText');
    expect(source).toContain('workflowTriggerReadiness');
    expect(source).toContain('_workflowOperationsState');
    expect(source).toContain('copyWorkflowOperationsBrief');
    expect(source).toContain('copyMissionResumeBrief');
    expect(source).toContain('copyWorkflowTriggerBrief');
    expect(source).toContain('Copy operations brief');
    expect(source).toContain('Copy resume brief');
    expect(source).toContain('Copy run brief');
    expect(source).toContain('Mission resume brief copied');
    expect(source).toContain('Workflow trigger run brief copied');
    expect(source).toContain('Workflow operations brief');
    expect(source).toContain('Data health');
    expect(source).toContain(
      'Workflow, runbook, mission, and group data loaded without known fallback.',
    );
    expect(source).toContain('All workflow sources loaded');
    expect(source).toContain('Needs review');
    expect(source).toContain('loadIssues');
    expect(source).toContain('Workflow list unavailable');
    expect(source).toContain('Runbook library unavailable');
    expect(source).toContain('Mission history unavailable');
    expect(source).toContain('Group delivery targets unavailable');
    expect(source).toContain(
      "workflow-stat ${loadIssues.length ? 'is-warning' : ''}",
    );
    expect(source).toContain('Workflow mission resume brief');
    expect(source).toContain('Workflow trigger run brief');
    expect(source).toContain(
      'Readiness: ${readiness.label} - ${readiness.detail}',
    );
    expect(source).toContain('Needs actions');
    expect(source).toContain('Disabled for review');
    expect(source).toContain('Approval-sensitive');
    expect(source).toContain('Ready with monitoring');
    expect(source).toContain('Review trigger');
    expect(source).toContain('workflow-trigger-readiness');
    expect(source).toContain(
      'Confirm approvals, monitoring, credentials, and rollback before triggering external work.',
    );
    expect(source).toContain(
      'Use this brief to continue supervised Cowork/MCP work without promoting it to unattended automation too early.',
    );
    expect(source).toContain('Step trail:');
    expect(source).toContain('Resume checklist:');
    expect(source).toContain(
      'Keep blocked or unclear steps as read-only Cowork drafts until the missing source, approval, or artifact path is named.',
    );
    expect(source).toContain(
      'Route approval-sensitive email sends, document publishing, calendar edits, webhooks, repository writes, and third-party updates to Approvals.',
    );
    expect(source).toContain(
      'Save the next summary, draft, or decision as a Cowork artifact before creating a trigger workflow.',
    );
    expect(source).toContain(
      'Keep work as a supervised mission while steps are unclear, blocked, or approval-sensitive. Promote it to a trigger workflow only after the runbook is stable and observable.',
    );
    expect(source).toContain(
      'Route blocked mission steps to Approvals or an operator review before triggering more automation.',
    );
    expect(source).toContain('Promotion checklist');
    expect(source).toContain('Automation fit lanes');
    expect(source).toContain('Choose the smallest useful operating mode');
    expect(source).toContain(
      'Repeated work becomes safer when the surface matches the risk',
    );
    expect(source).toContain('Keep it conversational');
    expect(source).toContain('Track guided project work');
    expect(source).toContain('Route repository work');
    expect(source).toContain('Automate only stable routines');
    expect(source).toContain(
      'Use plain chat while the request is exploratory, one-off, or still missing a durable output.',
    );
    expect(source).toContain(
      'Use a mission when files, MCP context, document drafts, approvals, or step notes should stay together.',
    );
    expect(source).toContain(
      'Use Code when the next step needs a repo, issue, diff, tests, CI evidence, or a PR handoff.',
    );
    expect(source).toContain(
      'Create a trigger after the runbook is proven, observable, approval-safe, and has a recovery path.',
    );
    expect(source).toContain(
      'Move from supervised Cowork to automation when the evidence is ready',
    );
    expect(source).toContain(
      'Email digests, document summaries, and other MCP routines should start as missions',
    );
    expect(source).toContain('Runbook is stable');
    expect(source).toContain('Proof exists');
    expect(source).toContain('Runtime is ready');
    expect(source).toContain('Fallback is clear');
    expect(source).toContain(
      'Named source systems, project workspace, output artifact path, and owner',
    );
    expect(source).toContain(
      'Approval steps are marked for email sends, external document publishing, calendar edits, webhooks, repository writes',
    );
    expect(source).toContain(
      'source citations, saved artifacts, and approval references for external writes',
    );
    expect(source).toContain(
      'Monitoring, credentials, MCP health, and provider tool-call readiness are green',
    );
    expect(source).toContain(
      'Blocked steps pause the workflow, keep a read-only Cowork draft, and route recovery to Approvals or Audit',
    );
    expect(source).toContain('Pre-trigger checks:');
    expect(source).toContain(
      'Confirm the runbook has completed at least one supervised mission with evidence, artifacts, and approval references.',
    );
    expect(source).toContain(
      'Confirm monitoring, credentials, MCP health, provider readiness, and target group routing are healthy.',
    );
    expect(source).toContain(
      'Confirm external writes, sends, document publishing, calendar edits, webhooks, repository changes, and third-party mutations are approval-gated.',
    );
    expect(source).toContain(
      'Trigger only if the action list is narrow, current, observable, and still matches the user or project intent.',
    );
  });

  it('surfaces the next workflow operations decision', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('workflowBrief');
    expect(source).toContain('Blocked missions need an operator');
    expect(source).toContain('Mission work is in flight');
    expect(source).toContain('No runbooks for guided work yet');
    expect(source).toContain(
      'Runbooks exist, but trigger workflows are disabled',
    );
    expect(source).toContain('Supervised automation is ready');
    expect(source).toContain("showWorkflowPanel('new-runbook-form')");
    expect(source).toContain("showWorkflowPanel('new-workflow-form')");
    expect(source).toContain('Operations brief');
  });

  it('turns empty workflow panels into productivity starters', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('WORKFLOW_RUNBOOK_STARTERS');
    expect(source).toContain('MCP email digest');
    expect(source).toContain('Cowork project review');
    expect(source).toContain('Release readiness check');
    expect(source).toContain('function renderWorkflowEmptyState');
    expect(source).toContain('function renderWorkflowRunbookStarters');
    expect(source).toContain('workflow-empty-action');
    expect(source).toContain('workflow-starter-grid');
    expect(source).toContain('applyWorkflowRunbookStarter');
    expect(source).toContain('Use email digest');
    expect(source).toContain('Ready for a supervised mission');
    expect(source).toContain('Create a runbook before starting missions');
    expect(source).toContain('Keep work manual until the runbook is stable');
  });

  it('preserves existing workflow, runbook, and mission form hooks', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/workflows')");
    expect(source).toContain("api('/missions/runbooks')");
    expect(source).toContain("api('/missions')");
    expect(source).toContain('id="new-runbook-form"');
    expect(source).toContain(
      'class="workflow-form-panel is-hidden" id="new-runbook-form"',
    );
    expect(source).toContain('id="runbook-create-form"');
    expect(source).toContain('id="mission-create-form"');
    expect(source).toContain('id="new-workflow-form"');
    expect(source).toContain(
      'class="workflow-form-panel workflow-create-workflow is-hidden" id="new-workflow-form"',
    );
    expect(source).toContain('id="workflow-create-form"');
    expect(source).toContain('id="wf-actions-list"');
    expect(source).toContain('toggleWorkflowPanel');
    expect(source).toContain('showWorkflowPanel');
    expect(source).toContain('addRunbookStep');
    expect(source).toContain('addWorkflowAction');
    expect(source).not.toContain('id="new-runbook-form" style="display:none"');
    expect(source).not.toContain('id="new-workflow-form" style="display:none"');
    expect(source).not.toContain(
      "document.getElementById('new-runbook-form').style.display",
    );
    expect(source).not.toContain(
      "document.getElementById('new-workflow-form').style.display",
    );
  });

  it('keeps workflow operation actions wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('toggleWorkflow');
    expect(source).toContain('triggerWorkflow');
    expect(source).toContain('deleteWorkflow');
    expect(source).toContain('updateMissionStepStatus');
    expect(source).toContain('missionApprovalInputId');
    expect(source).toContain('workflow-approval-reference');
    expect(source).toContain('Approval reference required');
    expect(source).toContain('workflow-mission-step-actions');
    expect(source).not.toContain("prompt('Approval reference required')");
  });

  it('uses actionable workflow failure messages before scaling automation', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const workflowBlock = source.slice(
      source.indexOf('function workflowActionErrorMessage'),
      source.indexOf('// --- Developer Hub ---'),
    );

    expect(workflowBlock).toContain('function workflowActionErrorMessage');
    expect(workflowBlock).toContain('Runbook was not created.');
    expect(workflowBlock).toContain('Mission was not started.');
    expect(workflowBlock).toContain('Workflow was not created.');
    expect(workflowBlock).toContain('Mission step was not updated.');
    expect(workflowBlock).toContain('Workflow state was not saved.');
    expect(workflowBlock).toContain('Workflow was not triggered.');
    expect(workflowBlock).toContain('Workflow was not deleted.');
    expect(workflowBlock).toContain('stable enough to become guided work');
    expect(workflowBlock).toContain('external-write work to Approvals');
    expect(workflowBlock).toContain(
      'monitoring, credentials, MCP health, and recovery path',
    );
    expect(workflowBlock).toContain(
      "toast(workflowActionErrorMessage('runbook', r), 'error')",
    );
    expect(workflowBlock).toContain(
      "toast(workflowActionErrorMessage('runbook', err), 'error')",
    );
    expect(workflowBlock).toContain(
      "toast(workflowActionErrorMessage('mission', r), 'error')",
    );
    expect(workflowBlock).toContain(
      "toast(workflowActionErrorMessage('mission', err), 'error')",
    );
    expect(workflowBlock).toContain(
      "toast(workflowActionErrorMessage('create', r), 'error')",
    );
    expect(workflowBlock).toContain(
      "toast(workflowActionErrorMessage('create', err), 'error')",
    );
    expect(workflowBlock).toContain(
      "toast(workflowActionErrorMessage('step', r), 'error')",
    );
    expect(workflowBlock).toContain(
      "toast(workflowActionErrorMessage('step', err), 'error')",
    );
    expect(workflowBlock).toContain(
      "toast(workflowActionErrorMessage('toggle', r), 'error')",
    );
    expect(workflowBlock).toContain(
      "toast(workflowActionErrorMessage('toggle', err), 'error')",
    );
    expect(workflowBlock).toContain(
      "toast(workflowActionErrorMessage('trigger', r), 'error')",
    );
    expect(workflowBlock).toContain(
      "toast(workflowActionErrorMessage('trigger', err), 'error')",
    );
    expect(workflowBlock).toContain(
      "toast(workflowActionErrorMessage('delete', r), 'error')",
    );
    expect(workflowBlock).toContain(
      "toast(workflowActionErrorMessage('delete', err), 'error')",
    );
    expect(workflowBlock).not.toContain(
      "toast(r?.error || 'Failed to create runbook', 'error')",
    );
    expect(workflowBlock).not.toContain(
      "toast(r?.error || 'Failed to start mission', 'error')",
    );
    expect(workflowBlock).not.toContain("toast(r.error || 'Failed', 'error')");
    expect(workflowBlock).not.toContain(
      "toast('Failed to create workflow', 'error')",
    );
    expect(workflowBlock).not.toContain(
      "toast(r?.error || 'Failed to update mission step', 'error')",
    );
    expect(workflowBlock).not.toContain(
      "toast('Failed to update workflow', 'error')",
    );
    expect(workflowBlock).not.toContain(
      "toast('Failed to trigger workflow', 'error')",
    );
  });

  it('uses class-based dynamic rows for runbook steps and workflow actions', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const workflowDynamicSource = source.slice(
      source.indexOf('window.addRunbookStep'),
      source.indexOf('window.toggleWorkflow'),
    );

    expect(source).toContain('workflow-section-title');
    expect(source).toContain('class="runbook-step-row"');
    expect(source).toContain('class="wf-action-row"');
    expect(source).toContain('class="workflow-check"');
    expect(source).toContain('workflow-row-remove');
    expect(workflowDynamicSource).not.toContain('row.style.cssText =');
    expect(workflowDynamicSource).not.toContain(
      'display:grid;grid-template-columns',
    );
    expect(workflowDynamicSource).not.toContain(
      'display:flex;gap:8px;margin-bottom:8px',
    );
    expect(workflowDynamicSource).not.toContain('flex:0 0 140px');
  });

  it('styles workflow panels, cards, dynamic rows, and responsive layout', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.workflow-command-center');
    expect(source).toContain('.workflow-brief');
    expect(source).toContain('.workflow-brief.is-attention');
    expect(source).toContain('.workflow-fit-matrix');
    expect(source).toContain('.workflow-fit-grid');
    expect(source).toContain('.workflow-fit-card');
    expect(source).toContain('.workflow-fit-card:focus-visible');
    expect(source).toContain('.workflow-automation-gate');
    expect(source).toContain('.workflow-automation-gate-head');
    expect(source).toContain('.workflow-automation-gate-grid');
    expect(source).toContain('.workflow-automation-step');
    expect(source).toContain('.workflow-form-panel');
    expect(source).toContain('.workflow-form-panel.is-hidden');
    expect(source).toContain('.workflow-panel');
    expect(source).toContain('.workflow-card.enabled');
    expect(source).toContain('.workflow-stat.is-warning');
    expect(source).toContain('.workflow-stat.is-warning strong');
    expect(source).toContain('.workflow-trigger-readiness');
    expect(source).toContain('.workflow-trigger-readiness.is-ready');
    expect(source).toContain('.workflow-trigger-readiness.is-attention');
    expect(source).toContain('.workflow-trigger-readiness.is-blocked');
    expect(source).toContain('.workflow-mission-step');
    expect(source).toContain('.workflow-mission-head-actions');
    expect(source).toContain('.workflow-approval-reference');
    expect(source).toContain('.workflow-approval-reference input');
    expect(source).toContain('.workflow-empty-action');
    expect(source).toContain('.workflow-empty-actions');
    expect(source).toContain('.workflow-starter-grid');
    expect(source).toContain('.workflow-starter-card');
    expect(source).toContain('.workflow-starter-card:focus-visible');
    expect(source).toContain('.runbook-step-row');
    expect(source).toContain('.wf-action-row');
    expect(source).toContain('.workflow-section-title');
    expect(source).toContain('.workflow-row-remove');
    expect(source).toContain('.workflow-create-grid,');
    expect(source).toContain('.workflow-fit-grid,');
    expect(source).toContain('.workflow-automation-gate-grid,');
    expect(source).toContain('.workflow-automation-gate-head,');
    expect(source).toContain(
      '.workflow-stats {\n    grid-template-columns: 1fr;',
    );
  });
});
