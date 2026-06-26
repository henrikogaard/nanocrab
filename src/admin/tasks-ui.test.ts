import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

const scheduledWorkSource = (source: string) =>
  source.slice(
    source.indexOf('<div class="routine-section-head">'),
    source.indexOf('window._routineBlueprints'),
  );

describe('Scheduled tasks productivity UI', () => {
  it('renders a routine cockpit for next runs, outputs, and guardrails', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('routineIntakeGuide');
    expect(source).toContain('renderRoutineIntakeGuide');
    expect(source).toContain('routine-intake-guide');
    expect(source).toContain('Automation intake');
    expect(source).toContain(
      'Choose the smallest workspace that can safely finish the work',
    );
    expect(source).toContain(
      'Not every useful request should become a schedule',
    );
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('agents')");
    expect(source).toContain('routine-cockpit');
    expect(source).toContain('routine-lane-map');
    expect(source).toContain('routine-decision-brief');
    expect(source).toContain('Routine decision');
    expect(source).toContain('Scheduled queue');
    expect(source).toContain('Delivery map');
    expect(source).toContain('Guardrails');
    expect(source).toContain('approvalGuardCount');
    expect(source).toContain('deliveryCounts');
    expect(source).toContain('nextTaskRows');
    expect(source).toContain('routineBrief');
    expect(source).toContain('routineQueueReadinessBriefText');
    expect(source).toContain('window.copyRoutineQueueReadinessBrief');
    expect(source).toContain('Copy queue brief');
    expect(source).toContain('Routine queue brief copied');
    expect(source).toContain('window._routineQueueState');
    expect(source).toContain(
      'Routine queue feeds loaded without known fallback.',
    );
    expect(source).toContain(
      'Data health: ${loadIssues.length ? loadIssues.join',
    );
    expect(source).toContain('NanoCrab routine queue readiness brief');
    expect(source).toContain(
      'Review failed routines before adding more automation',
    );
    expect(source).toContain(
      'Routine cockpit is ready for productive automation',
    );
    expect(source).toContain("navigate('approvals')");
  });

  it('classifies scheduled work by Copilot, Cowork, Code, and System intent', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('routineLaneDefinitions');
    expect(source).toContain('routineLaneCards');
    expect(source).toContain("lane: 'Copilot'");
    expect(source).toContain("lane: 'Cowork'");
    expect(source).toContain("lane: 'Code'");
    expect(source).toContain("lane: 'System'");
    expect(source).toContain("lane: 'Routine'");
    expect(source).toContain(
      'Use when the work needs files, MCP sources, documents, artifacts, project memory',
    );
    expect(source).toContain(
      'Use only after the work repeats, the output is understood',
    );
    expect(source).toContain(
      'Project summaries, MCP context, documents, and artifacts',
    );
    expect(source).toContain(
      'Repository checks, review reminders, and release routines',
    );
  });

  it('wires cockpit controls into existing routine filtering', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const filterBlock = source.slice(
      source.indexOf('window.filterRoutineCards = function ()'),
      source.indexOf('window.filterRoutineKind = function'),
    );

    expect(source).toContain('window.filterRoutineKind');
    expect(source).toContain('window.filterRoutineStatus');
    expect(source).toContain('window.filterRoutineFailures');
    expect(source).toContain("filterRoutineKind('heartbeat')");
    expect(source).toContain("filterRoutineStatus('paused')");
    expect(source).toContain('data-task-failed');
    expect(source).toContain('filterRoutineCards();');
    expect(filterBlock).toContain("classList.toggle('is-filtered'");
    expect(filterBlock).not.toContain('style.display');
    expect(style).toContain('[data-routine-filter].is-filtered');
    expect(style).toContain('.routine-task-card.is-filtered');
  });

  it('uses class-based state for routine wizard and detail panels', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('class="card routine-wizard is-hidden"');
    expect(source).toContain('window.closeRoutineWizard');
    expect(source).toContain('window.closeTaskDetailPanel');
    expect(source).toContain("formEl.classList.remove('is-hidden')");
    expect(source).toContain('onclick="closeRoutineWizard()"');
    expect(source).toContain('id="task-detail-panel" class="is-hidden"');
    expect(source).toContain("panel.classList.remove('is-hidden')");
    expect(source).toContain('onclick="closeTaskDetailPanel()"');
    expect(source).toContain("classList.contains('is-hidden')");
    expect(source).toContain('routine-count-badge');
    expect(source).toContain('renderRoutineBlueprintEmptyState');
    expect(source).toContain(
      "renderRoutineBlueprintEmptyState('unavailable', blueprintLoadIssue)",
    );
    expect(source).toContain('Routine blueprint library unavailable');
    expect(source).toContain('Blueprint data health');
    expect(source).toContain(
      'Draft from scratch for now, and retry before assuming no reusable automation patterns exist.',
    );
    expect(source).toContain('blueprintLoadIssue');
    expect(source).toContain(
      'const loadIssues = blueprintLoadIssue ? [blueprintLoadIssue] : []',
    );
    expect(source).toContain('renderRoutineCockpit(tasks, { loadIssues })');
    expect(source).toContain(
      'window._routineQueueState = { tasks, approvalGuardCount, brief, loadIssues };',
    );
    expect(source).toContain('renderRoutineTaskEmptyState');
    expect(source).toContain('routine-blueprint-empty-state');
    expect(source).toContain('routine-task-empty-state');
    expect(source).toContain(
      'Blueprints normally fill schedule, prompt, context, and safety defaults.',
    );
    expect(source).toContain('Start with one supervised routine');
    expect(source).toContain(
      'Keep external writes approval-gated until the output is trusted.',
    );
    expect(source).toContain("navigate('skills')");
    expect(source).toContain("navigate('snippets')");
    expect(source).not.toContain(
      'id="new-task-form" class="card routine-wizard" style="display:none"',
    );
    expect(source).not.toContain('id="task-detail-panel" style="display:none"');
    expect(source).not.toContain(
      'class="badge badge-muted" style="font-size:10px">${tasks.length}</span>',
    );
    expect(source).not.toContain(
      '<div class="empty">No routine blueprints available.</div>',
    );
    expect(source).not.toContain("api('/tasks/blueprints').catch(() => [])");
    expect(source).not.toContain(
      '<div class="routine-empty"><div class="routine-empty-icon">◷</div><div>Create your first scheduled task</div><div class="routine-chip-row"><button class="routine-chip" onclick="applyRoutineBlueprint(0)">Daily brief</button><button class="routine-chip" onclick="applyRoutineBlueprint(2)">System health check</button></div></div>',
    );
    expect(style).toContain('.routine-wizard.is-hidden');
    expect(style).toContain('#task-detail-panel.is-hidden');
    expect(style).toContain('.routine-count-badge');
    expect(style).toContain('.routine-blueprint-empty-state');
    expect(style).toContain('.routine-blueprint-empty-state.is-warning');
    expect(style).toContain('.routine-blueprint-empty-state.is-warning span');
    expect(style).toContain('.routine-task-empty-state');
    expect(style).toContain('.routine-task-empty-flow button:focus-visible');
  });

  it('uses class-based controls for filters and operation schedules', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const scheduled = scheduledWorkSource(source);

    expect(scheduled).toContain('routine-kind-filter');
    expect(scheduled).toContain('routine-operation-schedule');
    expect(scheduled).toContain('routine-operation-type');
    expect(scheduled).not.toContain(
      'id="routine-kind-filter" onchange="filterRoutineCards()" style="width:180px"',
    );
    expect(scheduled).not.toContain('style="display:flex;gap:8px"');
    expect(scheduled).not.toContain(
      'id="operation-schedule-type" style="width:120px"',
    );
    expect(style).toContain('.routine-kind-filter');
    expect(style).toContain('.routine-operation-schedule');
    expect(style).toContain('.routine-operation-type');
  });

  it('uses class-based inline confirmations and task editor controls', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const helperBlock = source.slice(
      source.indexOf('function inlineConfirm'),
      source.indexOf('// --- Task actions ---'),
    );
    const editBlock = source.slice(
      source.indexOf('window.editTask = async'),
      source.indexOf('window.deleteTask'),
    );
    const detailBlock = source.slice(
      source.indexOf('window.viewTaskDetail = async'),
      source.indexOf('window.copyTaskRoutineBrief'),
    );

    expect(helperBlock).toContain('inline-confirm');
    expect(helperBlock).toContain('role="alertdialog"');
    expect(helperBlock).toContain('aria-live="assertive"');
    expect(helperBlock).toContain('data-confirm-action="yes"');
    expect(helperBlock).toContain('data-confirm-action="no"');
    expect(helperBlock).toContain('panel.onkeydown = (event) =>');
    expect(helperBlock).toContain("if (event.key === 'Escape') restore();");
    expect(helperBlock).toContain('no.focus();');
    expect(helperBlock).toContain("panel.classList.add('is-busy')");
    expect(helperBlock).toContain('inline-input-control');
    expect(helperBlock).toContain('role="group"');
    expect(helperBlock).toContain('data-inline-input="value"');
    expect(helperBlock).toContain('data-inline-input-action="save"');
    expect(helperBlock).toContain('data-inline-input-action="cancel"');
    expect(helperBlock).toContain('inline-input-field');
    expect(helperBlock).toContain("panel.classList.add('is-busy')");
    expect(helperBlock).toContain("if (e.key === 'Escape') restore();");
    expect(helperBlock).not.toContain('id="_inline_input"');
    expect(helperBlock).not.toContain('id="_inline_ok"');
    expect(helperBlock).not.toContain('id="_inline_cancel"');
    expect(helperBlock).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-right:8px"',
    );
    expect(helperBlock).not.toContain(
      'style="display:flex;gap:6px;align-items:center"',
    );
    expect(editBlock).toContain('routine-editor-card');
    expect(editBlock).toContain('routine-edit-prompt');
    expect(editBlock).toContain('routine-edit-script');
    expect(editBlock).toContain('routine-editor-actions');
    expect(editBlock).toContain('routine-editor-message');
    expect(editBlock).toContain(
      "setInlineStatus(m, routineActionErrorMessage('save', r), 'error')",
    );
    expect(detailBlock).toContain('renderRoutineRunsEmptyState');
    expect(detailBlock).toContain('renderRoutineRunsUnavailableState');
    expect(detailBlock).toContain('renderRoutineDetailDataHealth');
    expect(detailBlock).toContain('renderRoutineRecoveryState');
    expect(detailBlock).toContain('renderRoutineDetailLoadingState(id)');
    expect(detailBlock).toContain('Recent run history unavailable');
    expect(detailBlock).toContain('Webhook approval context unavailable');
    expect(detailBlock).toContain('logsUnavailable');
    expect(detailBlock).toContain('webhookApprovalsUnavailable');
    expect(detailBlock).toContain('task._loadIssues = loadIssues');
    expect(detailBlock).toContain(
      'window._taskById = { ...(window._taskById || {}), [task.id]: task }',
    );
    expect(source).toContain('routine-runs-empty-state');
    expect(source).toContain('routine-recovery-state');
    expect(source).toContain('routine-detail-warning');
    expect(source).toContain('Run evidence unavailable');
    expect(source).toContain(
      'Retry before deciding this routine has no evidence.',
    );
    expect(source).toContain(
      'Data health: ${loadIssues.length ? loadIssues.join',
    );
    expect(source).toContain('Routine detail loaded without known fallback.');
    expect(source).toContain(
      'Retry before changing cadence, trusting run history, or promoting the routine to broader automation.',
    );
    expect(source).toContain('routine-detail-loading-state');
    expect(source).toContain('Loading task details');
    expect(source).toContain(
      'Gathering schedule, prompt, provider settings, recent run evidence, and approval context',
    );
    expect(source).toContain('Run this routine once to create evidence');
    expect(source).toContain('Routine detail could not load');
    expect(source).toContain("navigate('approvals')");
    expect(source).toContain("navigate('monitoring')");
    expect(source).toContain("navigate('projects')");
    expect(source).not.toContain(
      '\'<div class="empty routine-runs-empty">No runs recorded yet.</div>\'',
    );
    expect(detailBlock).not.toContain(
      'api(`/tasks/${encodeURIComponent(id)}/logs?limit=8`).catch(() => [])',
    );
    expect(detailBlock).not.toContain(').catch(() => [])');
    expect(source).not.toContain(
      '\'<div class="card"><div class="loading">Loading task details...</div></div>\'',
    );
    expect(source).not.toContain(
      'panel.innerHTML = `<div class="card empty">Failed to load task: ${esc(e.message)}</div>`',
    );
    expect(editBlock).not.toContain('style="width:100%;min-height:120px');
    expect(editBlock).not.toContain(
      'style="display:flex;gap:8px;align-items:center"',
    );
    expect(editBlock).not.toContain('m.style.color');
    expect(style).toContain('.inline-confirm');
    expect(style).toContain('.inline-confirm.is-busy');
    expect(style).toContain('.inline-confirm button:focus-visible');
    expect(style).toContain('.inline-input-control');
    expect(style).toContain('.inline-input-control.is-busy');
    expect(style).toContain('.inline-input-control input:focus-visible');
    expect(style).toContain('.routine-editor-actions');
    expect(style).toContain('.routine-detail-loading-state');
    expect(style).toContain('.routine-detail-loading-grid');
    expect(style).toContain('@keyframes routineDetailLoading');
    expect(style).toContain('.routine-editor-message.is-error');
    expect(style).toContain('.routine-runs-empty');
    expect(style).toContain('.routine-runs-empty-state');
    expect(style).toContain('.routine-runs-empty-state.is-warning');
    expect(style).toContain('.routine-runs-empty-actions');
    expect(style).toContain('.routine-detail-warning');
    expect(style).toContain('.routine-approval-callout.is-warning');
    expect(style).toContain('.routine-recovery-state');
    expect(style).toContain('.routine-recovery-actions');
  });

  it('uses actionable routine failure messages for scheduling and task actions', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const routineBlock = source.slice(
      source.indexOf('function routineActionErrorMessage'),
      source.indexOf('// Credentials'),
    );
    const actionsBlock = source.slice(
      source.indexOf('window.taskRunNow = async'),
      source.indexOf('// --- Helpers ---'),
    );

    expect(routineBlock).toContain('function routineActionErrorMessage');
    expect(routineBlock).toContain('Routine was not scheduled.');
    expect(routineBlock).toContain('Operation schedule was not created.');
    expect(routineBlock).toContain(
      'provider profile, tool policy, and delivery target',
    );
    expect(routineBlock).toContain(
      "toast(routineActionErrorMessage('create', r), 'error')",
    );
    expect(routineBlock).toContain(
      "toast(routineActionErrorMessage('create', err), 'error')",
    );
    expect(routineBlock).toContain(
      "toast(routineActionErrorMessage('operation', r), 'error')",
    );
    expect(routineBlock).toContain(
      "toast(routineActionErrorMessage('operation', err), 'error')",
    );
    expect(actionsBlock).toContain(
      "toast(routineActionErrorMessage('run', r), 'error')",
    );
    expect(actionsBlock).toContain(
      "toast(routineActionErrorMessage('run', e), 'error')",
    );
    expect(actionsBlock).toContain(
      "setInlineStatus(m, routineActionErrorMessage('save', r), 'error')",
    );
    expect(actionsBlock).toContain(
      "setInlineStatus(m, routineActionErrorMessage('save', err), 'error')",
    );
    expect(actionsBlock).toContain(
      "toast(routineActionErrorMessage('delete', r), 'error')",
    );
    expect(actionsBlock).toContain(
      "toast(routineActionErrorMessage('delete', err), 'error')",
    );
    expect(actionsBlock).toContain(
      "toast(routineActionErrorMessage('state', r), 'error')",
    );
    expect(actionsBlock).toContain(
      "toast(routineActionErrorMessage('state', err), 'error')",
    );
    expect(routineBlock).not.toContain("toast(r.error || 'Failed', 'error')");
    expect(actionsBlock).not.toContain(
      "toast(r.error || 'Failed to queue task', 'error')",
    );
    expect(actionsBlock).not.toContain(
      "toast('Failed: ' + e.message, 'error')",
    );
    expect(actionsBlock).not.toContain(
      "setInlineStatus(m, r.error || 'Failed', 'error')",
    );
  });

  it('lets operators copy routine briefs for Cowork and MCP handoff', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('taskRoutineBriefText');
    expect(source).toContain('taskRoutineAuditPromptText');
    expect(source).toContain('window.copyTaskRoutineBrief');
    expect(source).toContain('window.copyTaskRoutineAuditPrompt');
    expect(source).toContain('copyTextWithFallback');
    expect(source).toContain("'Routine brief copied'");
    expect(source).toContain("'Routine audit prompt copied'");
    expect(source).toContain("'Copy routine audit prompt'");
    expect(source).not.toContain("prompt('Copy routine brief:'");
    expect(source).not.toContain("prompt('Copy routine audit prompt:'");
    expect(source).toContain(
      'onclick="copyTaskRoutineBrief(\'${esc(task.id)}\')"',
    );
    expect(source).toContain('onclick="copyTaskRoutineBrief(\'${esc(id)}\')"');
    expect(source).toContain(
      'onclick="copyTaskRoutineAuditPrompt(\'${esc(task.id)}\')"',
    );
    expect(source).toContain(
      'onclick="copyTaskRoutineAuditPrompt(\'${esc(id)}\')"',
    );
    expect(source).toContain(
      'Audit this NanoCrab routine before it runs unattended or gets promoted.',
    );
    expect(source).toContain(
      'Is the schedule still useful, or should the work stay manual in Copilot, Cowork, or Code?',
    );
    expect(source).toContain(
      'Is there enough run evidence to trust the output quality, citations, source windows, and owner?',
    );
    expect(source).toContain(
      'Are failures, stale runs, missing context, or weak prompts visible enough to pause before the next run?',
    );
    expect(source).toContain(
      'Are external writes, webhooks, email sends, document publishing, calendar changes, or repository changes approval-gated?',
    );
    expect(source).toContain(
      'Return a decision: keep running, pause, run once under supervision, tighten prompt/context, lower frequency, or promote to a workflow.',
    );
    expect(source).toContain(
      'Approval boundary: local project drafts, summaries, artifacts',
    );
    expect(source).toContain(
      'document publishing, email actions, and third-party updates',
    );
    expect(source).toContain('Recurring work readiness:');
    expect(source).toContain('Queue readiness checklist');
    expect(source).toContain(
      'Keep one-off work in Copilot until the pattern repeats.',
    );
    expect(source).toContain(
      'Keep project files, MCP sources, documents, summaries, and artifacts in Cowork before scheduling them.',
    );
    expect(source).toContain(
      'Keep repository checks, PR work, tests, and release routines in Code with explicit evidence.',
    );
    expect(source).toContain(
      'Pause routines with failures, missing citations, stale source windows, or unclear owners.',
    );
    expect(source).toContain(
      'Require approval before webhooks, email sends, document publishing, calendar changes, repository writes, or third-party mutations.',
    );
    expect(source).toContain(
      'Name the source systems, search window, project workspace, expected artifact path, and owner.',
    );
    expect(source).toContain(
      'Run once under supervision and keep the run evidence, approval reference, and output artifact together.',
    );
    expect(source).toContain(
      'Promote to a trigger workflow only after failures, missing citations, and external-write approvals are understood.',
    );
    expect(source).toContain(
      'rerun it as a read-only Cowork task before broadening automation',
    );
    expect(source).toContain('Skills: none declared');
    expect(source).toContain('window._taskById');
  });

  it('styles the routine cockpit responsively', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.routine-cockpit');
    expect(source).toContain('.routine-intake-guide');
    expect(source).toContain('.routine-intake-grid');
    expect(source).toContain('.routine-intake-card');
    expect(source).toContain('.routine-intake-card:hover');
    expect(source).toContain('.routine-intake-card:focus-visible');
    expect(source).toContain('.routine-lane-map');
    expect(source).toContain('.routine-lane-card');
    expect(source).toContain('.routine-decision-brief');
    expect(source).toContain('.routine-decision-brief.is-attention');
    expect(source).toContain('.routine-decision-facts');
    expect(source).toContain('.routine-next-row');
    expect(source).toContain('.routine-delivery-grid');
    expect(source).toContain('.routine-safety-actions');
    expect(source).toContain('.routine-decision-actions');
    expect(source).toContain('.routine-cockpit,');
    expect(source).toContain('.routine-intake-guide,');
    expect(source).toContain('.routine-intake-grid,');
    expect(source).toContain('.routine-lane-map,');
  });
});
