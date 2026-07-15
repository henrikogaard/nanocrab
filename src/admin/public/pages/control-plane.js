// NanoCrab Admin — Control Plane Page

function controlPlaneBadge(status) {
  if (status === 'healthy') return 'badge-success';
  if (status === 'pending' || status === 'queued') return 'badge-warning';
  if (status === 'approved') return 'badge-info';
  if (status === 'rejected' || status === 'failed' || status === 'cancelled') return 'badge-error';
  if (status === 'paused') return 'badge-warning';
  return 'badge-muted';
}

function controlPlaneStat(label, value) {
  return `<div class="control-plane-stat card stat-card">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value">${esc(String(value))}</div>
  </div>`;
}

function controlPlaneBoardCard(card) {
  return `<div class="control-plane-board-card card">
    <div class="board-card-header">
      <span class="board-card-issue">#${esc(card.issue.number)} ${esc(card.issue.repo)}</span>
      <span class="board-card-stage ${esc(card.stage.kind)}">${esc(card.stage.name || card.stage.kind)}</span>
    </div>
    <div class="board-card-title">${esc(card.issue.title || '')}</div>
    <div class="board-card-meta">
      <span class="board-card-agent">${esc(card.agent ? card.agent.displayName : '—')}</span>
      <span class="board-card-runtime">${esc(card.actualRuntime || '—')}</span>
    </div>
    <div class="board-card-run">${esc(card.run ? `run ${card.run.status}` : 'no run')}</div>
    <div class="board-card-decision">${esc(card.decision ? card.decision.status : '—')}</div>
  </div>`;
}

function controlPlanePipelineCard(pipeline) {
  const stages = (pipeline.stages || [])
    .map((s) => `<span class="pipeline-stage-chip">${esc(s.name || s.kind)}</span>`)
    .join('');
  return `<div class="control-plane-pipeline-card card">
    <div class="card-title">${esc(pipeline.name)}</div>
    <div class="card-meta">${esc(pipeline.githubOwner)} / ${esc(pipeline.repositoryScopes.join(', '))}</div>
    <div class="pipeline-stage-list">${stages}</div>
  </div>`;
}

function controlPlaneAgentCard(agent) {
  return `<div class="control-plane-agent-card card">
    <div class="agent-card-name">${esc(agent.displayName)}</div>
    <div class="agent-card-handle">@${esc(agent.handle)}</div>
    <div class="agent-card-roles">${esc((agent.stageRoles || []).join(', '))}</div>
    <div class="agent-card-runtime">${esc(agent.primaryRuntime || '—')}</div>
  </div>`;
}

function controlPlaneRunCard(run) {
  return `<div class="control-plane-run-card card">
    <div class="run-card-id">${esc(run.id)}</div>
    <div class="run-card-repo">${esc(run.repo || '—')}</div>
    <div class="run-card-status ${esc(controlPlaneBadge(run.status))}">${esc(run.status)}</div>
  </div>`;
}

function controlPlaneDecisionCard(decision) {
  return `<div class="control-plane-decision-card card">
    <div class="decision-card-title">${esc(decision.summary || '')}</div>
    <div class="decision-card-meta">${esc(decision.kind)} · ${esc(decision.repository)}#${esc(decision.issueNumber)}</div>
    <div class="decision-card-status ${esc(controlPlaneBadge(decision.status))}">${esc(decision.status)}</div>
  </div>`;
}

function controlPlaneRuntimeRow(runtime) {
  const readiness = runtime.codingReadiness || runtime.health;
  const status = readiness ? readiness.status : 'unknown';
  return `<div class="control-plane-runtime-row">
    <span class="runtime-cli">${esc(runtime.cli)}</span>
    <span class="runtime-status ${esc(controlPlaneBadge(status))}">${esc(status)}</span>
  </div>`;
}

function renderControlPlaneOverview(state, el) {
  const overview = document.getElementById('control-plane-overview');
  if (!overview) return;
  const stats = state.overview?.stats || {};
  const cards = (state.overview?.boardCards || [])
    .map((c) => controlPlaneBoardCard(c))
    .join('');
  overview.innerHTML = `
    <div class="control-plane-stats">
      ${controlPlaneStat('Pipelines', stats.pipelines || 0)}
      ${controlPlaneStat('Agents', stats.agents || 0)}
      ${controlPlaneStat('Pending decisions', stats.pendingDecisions || 0)}
      ${controlPlaneStat('Runs', stats.runs || 0)}
      ${controlPlaneStat('Healthy runtimes', stats.runtimesHealthy || 0)}
    </div>
    <div class="control-plane-board">${cards || '<p class="muted">No board cards.</p>'}</div>
  `;
}

function renderControlPlaneAgents(state, el) {
  const section = document.getElementById('control-plane-agents');
  if (!section) return;
  const cards = (state.overview?.agents || [])
    .map((a) => controlPlaneAgentCard(a))
    .join('');
  section.innerHTML = `<div class="control-plane-agent-grid">${cards || '<p class="muted">No agents configured.</p>'}</div>`;
}

function renderControlPlanePipelines(state, el) {
  const section = document.getElementById('control-plane-pipelines');
  if (!section) return;
  const cards = (state.pipelines || [])
    .map((p) => controlPlanePipelineCard(p))
    .join('');
  section.innerHTML = `<div class="control-plane-pipeline-grid">${cards || '<p class="muted">No pipelines configured.</p>'}</div>`;
}

function renderControlPlaneRuns(state, el) {
  const section = document.getElementById('control-plane-runs');
  if (!section) return;
  const cards = (state.runs || [])
    .map((r) => controlPlaneRunCard(r))
    .join('');
  section.innerHTML = `<div class="control-plane-run-grid">${cards || '<p class="muted">No runs.</p>'}</div>`;
}

function renderControlPlaneDecisions(state, el) {
  const section = document.getElementById('control-plane-decisions');
  if (!section) return;
  const cards = (state.decisions || [])
    .map((d) => controlPlaneDecisionCard(d))
    .join('');
  section.innerHTML = `<div class="control-plane-decision-grid">${cards || '<p class="muted">No pending decisions.</p>'}</div>`;
}

function renderControlPlaneSettings(state, el) {
  const section = document.getElementById('control-plane-settings');
  if (!section) return;
  section.innerHTML = `
    <div class="card">
      <div class="card-title">Control Plane Settings</div>
      <p class="muted">Pipeline polling, sync, and agent assignment defaults will be configured here.</p>
    </div>
  `;
}

function renderControlPlaneTab(tabId) {
  const tabs = ['overview', 'agents', 'pipelines', 'runs', 'decisions', 'settings'];
  for (const t of tabs) {
    const el = document.getElementById(`control-plane-${t}`);
    if (el) el.classList.toggle('is-hidden', t !== tabId);
  }
  document.querySelectorAll('.control-plane-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
}

function renderControlPlaneTabs() {
  const tabs = [
    { id: 'overview', label: 'Overview / Board' },
    { id: 'agents', label: 'Agents' },
    { id: 'pipelines', label: 'Pipelines' },
    { id: 'runs', label: 'Runs' },
    { id: 'decisions', label: 'Decisions' },
    { id: 'settings', label: 'Settings' },
  ];
  return `<div class="control-plane-tabs" role="tablist">
    ${tabs
      .map(
        (t) =>
          `<button class="control-plane-tab ${t.id === 'overview' ? 'active' : ''}" data-tab="${t.id}" onclick="renderControlPlaneTab('${t.id}')">${esc(t.label)}</button>`,
      )
      .join('')}
  </div>`;
}

async function loadControlPlaneState() {
  const state = {};
  const loadIssues = [];
  try {
    state.overview = await api('/control-plane/overview');
  } catch (err) {
    loadIssues.push('Overview unavailable');
    state.overview = {};
  }
  try {
    state.runtimes = await api('/control-plane/runtimes');
  } catch (err) {
    loadIssues.push('Runtimes unavailable');
    state.runtimes = { runtimes: [] };
  }
  try {
    state.pipelines = await api('/control-plane/pipelines');
  } catch (err) {
    loadIssues.push('Pipelines unavailable');
    state.pipelines = { pipelines: [] };
  }
  try {
    state.runs = await api('/control-plane/runs');
  } catch (err) {
    loadIssues.push('Runs unavailable');
    state.runs = { runs: [] };
  }
  try {
    state.decisions = await api('/control-plane/decisions');
  } catch (err) {
    loadIssues.push('Decisions unavailable');
    state.decisions = { decisions: [] };
  }
  state.loadIssues = loadIssues;
  return state;
}

async function renderControlPlane(el) {
  el.innerHTML = `
    <div class="page-header control-plane-header">
      <h2>Control Plane</h2>
      <span class="muted">AI project delivery board, runtimes, and stage decisions</span>
    </div>
    ${renderControlPlaneTabs()}
    <div class="control-plane-content">
      <div id="control-plane-overview" class="control-plane-section"></div>
      <div id="control-plane-agents" class="control-plane-section is-hidden"></div>
      <div id="control-plane-pipelines" class="control-plane-section is-hidden"></div>
      <div id="control-plane-runs" class="control-plane-section is-hidden"></div>
      <div id="control-plane-decisions" class="control-plane-section is-hidden"></div>
      <div id="control-plane-settings" class="control-plane-section is-hidden"></div>
    </div>
  `;

  const state = await loadControlPlaneState();
  renderControlPlaneOverview(state, el);
  renderControlPlaneAgents(state, el);
  renderControlPlanePipelines(state, el);
  renderControlPlaneRuns(state, el);
  renderControlPlaneDecisions(state, el);
  renderControlPlaneSettings(state, el);
}

window.renderControlPlane = renderControlPlane;
window.renderControlPlaneTab = renderControlPlaneTab;
