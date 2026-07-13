(function () {
  var esc =
    (window.NanoShared && window.NanoShared.esc) ||
    window.esc ||
    function (value) {
      return String(value || '');
    };

  var routineLaneDefinitions = [
    {
      lane: 'Copilot',
      kinds: ['briefing', 'task'],
      detail: 'Conversation follow-ups, reminders, and recurring briefings',
    },
    {
      lane: 'Cowork',
      kinds: ['briefing', 'operation', 'task'],
      detail: 'Project summaries, MCP context, documents, and artifacts',
    },
    {
      lane: 'Code',
      kinds: ['github', 'release'],
      detail: 'Repository checks, review reminders, and release routines',
    },
    {
      lane: 'System',
      kinds: ['heartbeat', 'monitor', 'operation'],
      detail: 'Health checks, webhooks, uptime routines, and operator pings',
    },
  ];

  var routineIntakeGuide = [
    {
      lane: 'Copilot',
      action: "navigate('chat')",
      label: 'Open Copilot',
      detail: 'Use for one-off questions, drafting, explanation, and quick decisions that do not need project state.',
    },
    {
      lane: 'Cowork',
      action: "navigate('projects')",
      label: 'Open Cowork',
      detail: 'Use when the work needs files, MCP sources, documents, artifacts, project memory, or a saved handoff.',
    },
    {
      lane: 'Code',
      action: "navigate('agents')",
      label: 'Open Code',
      detail: 'Use for repositories, tests, pull requests, release checks, and coding agents with workspace access.',
    },
    {
      lane: 'Routine',
      action: 'openRoutineWizard()',
      label: 'Draft routine',
      detail: 'Use only after the work repeats, the output is understood, and external writes can stay approval-gated.',
    },
  ];

  function renderRoutineRunsEmptyState(task) {
    var id = task?.id || '';
    return `
    <div class="routine-runs-empty-state">
      <div>
        <span>Run history</span>
        <strong>No runs recorded yet.</strong>
        <p>Run this routine once to create evidence, then use the brief when handing recurring work to Cowork or MCP-backed project chats.</p>
      </div>
      <div class="routine-runs-empty-actions">
        <button type="button" class="btn btn-sm btn-primary" onclick="taskRunNow('${esc(id)}')">Run now</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="copyTaskRoutineBrief('${esc(id)}')">Copy brief</button>
      </div>
    </div>`;
  }

  function renderRoutineRunsUnavailableState(task) {
    var id = task?.id || '';
    return `
    <div class="routine-runs-empty-state is-warning">
      <div>
        <span>Run evidence unavailable</span>
        <strong>Recent run history did not load.</strong>
        <p>Retry before deciding this routine has no evidence. Use Monitoring or rerun under supervision if the automation output needs to be trusted.</p>
      </div>
      <div class="routine-runs-empty-actions">
        <button type="button" class="btn btn-sm btn-primary" onclick="viewTaskDetail('${esc(id)}')">Retry evidence</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Monitoring</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="copyTaskRoutineBrief('${esc(id)}')">Copy brief</button>
      </div>
    </div>`;
  }

  function renderRoutineDetailDataHealth(loadIssues, task) {
    if (!Array.isArray(loadIssues) || loadIssues.length === 0) return '';
    var id = task?.id || '';
    return `
    <div class="routine-detail-warning" role="status">
      <div>
        <span>Data health</span>
        <strong>${loadIssues.length} routine feed${loadIssues.length === 1 ? '' : 's'} need review.</strong>
        <p>${esc(loadIssues.join('; '))}. Retry before changing cadence, trusting run history, or promoting the routine to broader automation.</p>
      </div>
      <div class="routine-recovery-actions">
        <button type="button" class="btn btn-sm btn-primary" onclick="viewTaskDetail('${esc(id)}')">Retry detail</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('approvals')">Approvals</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Monitoring</button>
      </div>
    </div>`;
  }

  function renderRoutineDetailLoadingState(id) {
    return `
    <section class="routine-detail-loading-state" aria-busy="true" aria-label="Loading routine detail">
      <div>
        <span>Routine detail</span>
        <strong>Loading task details</strong>
        <p>Gathering schedule, prompt, provider settings, recent run evidence, and approval context before showing controls.</p>
        ${id ? `<small>${esc(id)}</small>` : ''}
      </div>
      <div class="routine-detail-loading-grid" aria-hidden="true">
        <i></i><i></i><i></i><i></i>
      </div>
    </section>`;
  }

  function renderRoutineRecoveryState(kind, message, options) {
    var resolvedOptions = options || {};
    var title =
      kind === 'task'
        ? 'Routine detail could not load'
        : 'Routine data could not load';
    var detail =
      kind === 'task'
        ? 'The schedule may still exist, but NanoCrab could not load the run history, prompt, or approval context for this routine.'
        : 'NanoCrab could not load scheduled work data. Review monitoring and approvals before adding more automation.';
    var retryAction = resolvedOptions.retryAction || "navigate('tasks')";
    return `
    <section class="routine-recovery-state is-${esc(kind || 'load')}">
      <div>
        <span>Routine unavailable</span>
        <strong>${esc(title)}</strong>
        <p>${esc(detail)}</p>
        ${message ? `<small>${esc(message)}</small>` : ''}
      </div>
      <div class="routine-recovery-actions">
        <button type="button" class="btn btn-sm btn-primary" onclick="${retryAction}">Retry</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('approvals')">Approvals</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Monitoring</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('projects')">Cowork</button>
      </div>
  </section>`;
  }

  function renderRoutineIntakeGuide(items) {
    var guide = items || routineIntakeGuide;
    return `<section class="routine-intake-guide">
    <div class="routine-intake-copy">
      <span class="routine-cockpit-kicker">Automation intake</span>
      <h3>Choose the smallest workspace that can safely finish the work</h3>
      <p>Not every useful request should become a schedule. Route one-off work to Copilot, project work to Cowork, repository work to Code, and promote only stable recurring work into Routines.</p>
    </div>
    <div class="routine-intake-grid">
      ${guide
        .map(
          function (item) {
            return '<button type="button" class="routine-intake-card" onclick="' + item.action + '">'
              + '<span>' + esc(item.lane) + '</span>'
              + '<strong>' + esc(item.label) + '</strong>'
              + '<p>' + esc(item.detail) + '</p>'
              + '</button>';
          },
        )
        .join('')}
    </div>
  </section>`;
  }

  function renderRoutineBlueprintEmptyState(kind, issue) {
    var isWarning = kind === 'unavailable';
    return `
    <section class="routine-blueprint-empty-state ${isWarning ? 'is-warning' : ''}">
      <div>
        <span>${isWarning ? 'Blueprint data health' : 'Blueprint library'}</span>
        <strong>${isWarning ? 'Routine blueprint library unavailable' : 'No routine blueprints available'}</strong>
        <p>${esc(
          isWarning
            ? (issue || 'Blueprints did not load.') + ' Draft from scratch for now, and retry before assuming no reusable automation patterns exist.'
            : 'Blueprints normally fill schedule, prompt, context, and safety defaults. You can still draft an exact routine from scratch, then save useful patterns as skills or snippets later.',
        )}</p>
      </div>
      <div class="routine-empty-actions">
        <button type="button" class="btn btn-sm btn-primary" onclick="openRoutineWizard()">Draft routine</button>
        ${
          isWarning
            ? '<button type="button" class="btn btn-sm btn-ghost" onclick="navigate(\'tasks\')">Retry templates</button>'
            : ''
        }
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('skills')">Review skills</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('snippets')">Snippets</button>
      </div>
    </section>`;
  }

  function renderRoutineTaskEmptyState() {
    return `
    <section class="routine-task-empty-state">
      <div class="routine-task-empty-copy">
        <span>First routine</span>
        <strong>Create your first scheduled task</strong>
        <p>Start with one supervised routine: a daily brief, system health check, repository review, or Cowork document follow-up. Keep external writes approval-gated until the output is trusted.</p>
      </div>
      <div class="routine-task-empty-flow">
        <button type="button" onclick="applyRoutineBlueprint(0)"><strong>Daily brief</strong><small>Summarize what needs attention.</small></button>
        <button type="button" onclick="applyRoutineBlueprint(2)"><strong>System health check</strong><small>Watch runtime and service health.</small></button>
        <button type="button" onclick="openRoutineWizard()"><strong>Custom routine</strong><small>Set schedule, provider, context, and guardrails.</small></button>
      </div>
    </section>`;
  }

  window.NanoRoutineStates = {
    renderRoutineRunsEmptyState,
    renderRoutineRunsUnavailableState,
    renderRoutineDetailDataHealth,
    renderRoutineDetailLoadingState,
    renderRoutineRecoveryState,
    routineLaneDefinitions,
    routineIntakeGuide,
    renderRoutineIntakeGuide,
    renderRoutineBlueprintEmptyState,
    renderRoutineTaskEmptyState,
  };
})();
