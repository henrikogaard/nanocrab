/* global window */

(function () {
  var esc =
    (window.NanoShared && window.NanoShared.esc) ||
    window.esc ||
    function (value) {
      return String(value || '');
    };

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

  window.NanoRoutineStates = {
    renderRoutineRunsEmptyState,
    renderRoutineRunsUnavailableState,
    renderRoutineDetailDataHealth,
    renderRoutineDetailLoadingState,
    renderRoutineRecoveryState,
  };
})();
