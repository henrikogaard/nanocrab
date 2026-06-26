// NanoCrab Admin — Autofix Page

// --- GitHub Autofix ---

function autofixStatusBadge(status) {
  if (status === 'completed') return 'badge-success';
  if (
    [
      'queued',
      'investigate',
      'plan',
      'implement',
      'test',
      'open_pr',
      'ci_running',
    ].includes(status)
  )
    return 'badge-warning';
  if (['await_approval', 'await_pr_approval'].includes(status))
    return 'badge-info';
  if (status === 'cancelled') return 'badge-muted';
  return 'badge-error';
}

function autofixDenyNoteId(id) {
  return `autofix-deny-note-${String(id || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function autofixLastPollLabel(value) {
  return value ? `last scan ${timeAgo(value)}` : 'not scanned yet';
}

function autofixReadinessBriefText(state) {
  const projects = state?.projects || [];
  const jobs = state?.jobs || [];
  const webhookHealth = state?.webhookHealth || {};
  const command = state?.command || {};
  const loadIssues = state?.loadIssues || [];
  const activeStatuses = [
    'queued',
    'investigate',
    'plan',
    'implement',
    'test',
    'open_pr',
    'ci_running',
  ];
  const reviewStatuses = ['await_approval', 'await_pr_approval'];
  const activeJobs = jobs.filter((job) => activeStatuses.includes(job.status));
  const reviewJobs = jobs.filter((job) => reviewStatuses.includes(job.status));
  const failedJobs = jobs.filter((job) => job.status === 'failed');
  const enabledAutoPick = projects.filter((project) => project.autoPickEnabled);
  const projectLines = projects.slice(0, 10).map((project) => {
    const mode = project.autoPickEnabled ? 'auto-pick' : 'manual';
    const pr = project.createPr === false ? 'no PR flow' : 'PR flow';
    return `- ${project.owner}/${project.repo}: ${mode}, label ${project.triggerLabel}, ${pr}, max ${project.maxActiveJobs || 1}`;
  });
  const jobLines = jobs.slice(0, 10).map((job) => {
    return `- ${job.repo}#${job.issueNumber}: ${job.status}${job.issueTitle ? ` - ${job.issueTitle}` : ''}`;
  });

  return [
    'Autofix readiness brief',
    '',
    `Decision: ${command.headline || 'No decision available'}`,
    `Detail: ${command.detail || 'Review Autofix readiness before assigning automatic issue pickup.'}`,
    `Data health: ${loadIssues.length ? loadIssues.join('; ') : 'Autofix feeds loaded without known fallback.'}`,
    `Webhook health: ${webhookHealth.status || 'unknown'}`,
    `Watched repositories: ${projects.length}`,
    `Auto-pick enabled: ${enabledAutoPick.length}`,
    `Recent jobs: ${jobs.length}`,
    `Active jobs: ${activeJobs.length}`,
    `Review gates: ${reviewJobs.length}`,
    `Failed jobs: ${failedJobs.length}`,
    '',
    'Use Autofix for repeatable GitHub issue pickup that needs a repo pipeline, build/test loop, approval gates, and PR orchestration.',
    'Pause automatic pickup while webhook health is blocked, review gates are waiting, failed jobs are unresolved, or repo changes lack verification evidence.',
    'Use Copilot for a single clearly scoped issue; use Autofix when the workflow should repeatedly pick labeled issues and produce reviewed branches or PRs.',
    '',
    'Watched repositories',
    ...(projectLines.length ? projectLines : ['- No watched repositories configured.']),
    '',
    'Recent jobs',
    ...(jobLines.length ? jobLines : ['- No recent Autofix jobs.']),
  ].join('\n');
}

function renderAutofixRecoveryState(kind, message, options = {}) {
  const title =
    kind === 'issues'
      ? 'Issue search could not load'
      : kind === 'job'
        ? 'Autofix job detail could not load'
        : 'Autofix could not load';
  const detail =
    kind === 'issues'
      ? 'Check GitHub credentials, labels, and repository access before starting a repository-changing automation run.'
      : kind === 'job'
        ? 'The job may still be writing evidence, or the run record may be unavailable. Check Code, Git Ops, and approvals before retrying.'
        : 'NanoCrab could not reach Autofix projects, jobs, webhook health, or provider data. Review setup before enabling automatic pickup.';
  const retryAction = options.retryAction || "navigate('autofix')";
  return `
    <section class="autofix-recovery-state is-${esc(kind || 'load')}">
      <div>
        <span>${kind === 'load' ? 'Code automation unavailable' : 'Autofix detail unavailable'}</span>
        <strong>${esc(title)}</strong>
        <p>${esc(detail)}</p>
        ${message ? `<small>${esc(message)}</small>` : ''}
      </div>
      <div class="autofix-recovery-actions">
        <button type="button" class="btn btn-sm btn-primary" onclick="${retryAction}">Retry</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('webhooks')">Webhooks</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('gitcode')">Git & Code</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('approvals')">Approvals</button>
      </div>
    </section>`;
}

function autofixActionErrorMessage(kind, err) {
  const message =
    typeof err === 'string'
      ? err
      : err?.message || err?.error || '';
  const detail = message ? `: ${message}` : '';
  if (kind === 'create-project') {
    return 'Could not add the Autofix project. Confirm the GitHub owner/repo, trigger label, provider, and workspace path before enabling automation' + detail;
  }
  if (kind === 'update-project') {
    return 'Could not update the Autofix project. Refresh the project list before changing auto-pick or review settings again' + detail;
  }
  if (kind === 'auto-pick') {
    return 'Could not run the auto-pick scan. Check GitHub credentials, watched repositories, and webhook readiness before retrying' + detail;
  }
  if (kind === 'delete-project') {
    return 'Could not remove the Autofix project. Check whether jobs are still active for this repository before retrying' + detail;
  }
  if (kind === 'run') {
    return 'Could not start Autofix for this issue. Check issue access, project settings, provider readiness, and active job limits' + detail;
  }
  if (kind === 'job-action') {
    return 'Could not update the Autofix job. Refresh the job evidence, check approval or CI state, and retry' + detail;
  }
  return 'Autofix action could not complete. Refresh Code automation and retry' + detail;
}

function renderAutofixJobLoadingState(id) {
  return `
    <section class="autofix-job-loading-state" aria-busy="true" aria-label="Loading Autofix job evidence">
      <div class="autofix-job-loading-copy">
        <span>Autofix job detail</span>
        <strong>Collecting branch, diff, tests, CI, and approval evidence.</strong>
        <p>Job ${esc(id)} may still be writing logs. Keep this panel open to follow the run, or check Git & Code and Approvals if the evidence does not appear.</p>
      </div>
      <div class="autofix-job-loading-steps">
        <span>Branch</span>
        <span>Diff</span>
        <span>Tests</span>
        <span>CI</span>
        <span>Approval</span>
      </div>
    </section>`;
}

function renderAutofixLoadingState(kind = 'cockpit') {
  const states = {
    cockpit: {
      title: 'Loading Autofix command center',
      detail:
        'Checking watched repositories, recent jobs, GitHub webhook health, provider readiness, and approval gates before automatic issue pickup.',
      steps: ['Repos', 'Jobs', 'Webhook', 'Providers'],
    },
    issues: {
      title: 'Loading matching GitHub issues',
      detail:
        'Searching repository issues, labels, assignees, milestones, and existing assignments before starting a repository-changing run.',
      steps: ['Repo', 'Labels', 'Filters', 'Issue state'],
    },
  };
  const state = states[kind] || states.cockpit;
  return `
    <section class="autofix-loading-state is-${esc(kind)}" aria-busy="true" aria-label="${esc(state.title)}">
      <div>
        <span>${kind === 'issues' ? 'Issue search' : 'Code automation'}</span>
        <strong>${esc(state.title)}</strong>
        <p>${esc(state.detail)}</p>
      </div>
      <div class="autofix-loading-flow">
        ${state.steps.map((step) => `<span>${esc(step)}</span>`).join('')}
      </div>
    </section>`;
}

function renderAutofixCommandCenter({
  projects,
  jobs,
  enabledAutoPickCount,
  webhookHealth,
  healthClass,
  healthChecks,
  loadIssues = [],
}) {
  const activeStatuses = [
    'queued',
    'investigate',
    'plan',
    'implement',
    'test',
    'open_pr',
    'ci_running',
  ];
  const reviewStatuses = ['await_approval', 'await_pr_approval'];
  const activeJobs = jobs.filter((job) => activeStatuses.includes(job.status));
  const reviewJobs = jobs.filter((job) => reviewStatuses.includes(job.status));
  const failedJobs = jobs.filter((job) => job.status === 'failed');
  const latestJob =
    jobs
      .slice()
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.startedAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.startedAt || a.createdAt || 0).getTime(),
      )[0] || null;
  const headline =
    loadIssues.length
      ? 'Review Autofix data confidence before enabling pickup'
      : webhookHealth?.status === 'blocked'
      ? 'GitHub automation is blocked'
      : reviewJobs.length
        ? 'Review before Autofix continues'
        : activeJobs.length
          ? 'Autofix is working code issues'
          : projects.length
            ? 'Ready to pick the next issue'
            : 'Register a repo to start Autofix';
  const detail =
    loadIssues.length
      ? `${loadIssues.length} Autofix feed${loadIssues.length === 1 ? '' : 's'} did not load. Check Monitoring, Webhooks, Git & Code, and provider setup before assuming the automation queue is quiet.`
      : webhookHealth?.status === 'blocked'
      ? 'Fix webhook and credential readiness before relying on automatic issue pickup.'
      : reviewJobs.length
        ? 'Approve the implementation or PR step after checking the diff, tests, and CI evidence.'
        : activeJobs.length
          ? 'Watch running jobs and refresh CI before opening more repository work.'
          : projects.length
            ? 'Run a scan, select a labeled issue manually, or let enabled projects poll GitHub on schedule.'
            : 'Add an owner/repo, trigger label, provider, and PR policy so Code can delegate fixes safely.';
  window._autofixReadinessState = {
    projects,
    jobs,
    webhookHealth,
    loadIssues,
    command: { headline, detail },
  };
  return `
    <section class="autofix-command-center" aria-label="Autofix command center">
      <div class="autofix-command-main">
        <span class="report-kicker">Code automation</span>
        <h3>${esc(headline)}</h3>
        <p>${esc(detail)}</p>
        <div class="autofix-command-facts">
          <span>${projects.length} watched repo${projects.length === 1 ? '' : 's'}</span>
          <span>${enabledAutoPickCount} scheduled scan${enabledAutoPickCount === 1 ? '' : 's'}</span>
          <span>${jobs.length} recent job${jobs.length === 1 ? '' : 's'}</span>
          <span class="${loadIssues.length ? 'is-warning' : ''}">Data ${loadIssues.length ? 'needs review' : 'ready'}</span>
          <span class="badge ${healthClass}">${esc(webhookHealth?.status || 'unknown')}</span>
        </div>
        ${webhookHealth?.webhookUrl ? `<code>${esc(webhookHealth.webhookUrl)}</code>` : ''}
      </div>
      <div class="autofix-command-actions">
        <button type="button" onclick="copyAutofixReadinessBrief()">
          <span>${reviewJobs.length}</span>
          <strong>Copy readiness brief</strong>
        </button>
        <button type="button" onclick="autofixRunAutoPickNow(this)">
          <span>${activeJobs.length}</span>
          <strong>Run scan now</strong>
        </button>
        <button type="button" onclick="toggleAutofixAddForm(true)">
          <span>${reviewJobs.length}</span>
          <strong>Add watched repo</strong>
        </button>
        <button type="button" onclick="navigate('webhooks')">
          <span>${failedJobs.length}</span>
          <strong>Webhook setup</strong>
        </button>
      </div>
      ${
        latestJob
          ? `<div class="autofix-latest-job">
              <span>Latest job</span>
              <strong>${esc(latestJob.repo)}#${esc(String(latestJob.issueNumber || ''))}</strong>
              <small>${esc(latestJob.issueTitle || latestJob.status || 'Recent Autofix activity')}</small>
            </div>`
          : ''
      }
      ${healthChecks ? `<div class="autofix-health-grid">${healthChecks}</div>` : ''}
    </section>`;
}

function renderAutofixProjectEmptyState() {
  const steps = [
    ['01', 'Register repository', 'Add owner, repo, trigger label, provider, PR policy, and optional auto-pick cadence.'],
    ['02', 'Verify webhooks', 'Confirm GitHub webhook and credential readiness before relying on scheduled pickup.'],
    ['03', 'Review evidence', 'Keep fixes tied to diffs, tests, CI, approvals, and PR links.'],
  ];
  return `
    <section class="autofix-empty-state autofix-project-empty-state">
      <div>
        <span>First watched repo</span>
        <strong>Register a repo before Autofix can pick issues</strong>
        <p>Autofix is for repeatable GitHub issue pickup that needs a branch, test loop, approval gate, and PR trail. Start with one repository and one trigger label.</p>
        <div class="autofix-empty-actions">
          <button class="btn btn-sm btn-primary" onclick="toggleAutofixAddForm(true)">Add watched repo</button>
          <button class="btn btn-sm btn-ghost" onclick="navigate('webhooks')">Webhook setup</button>
          <button class="btn btn-sm btn-ghost" onclick="navigate('copilot')">Use Copilot instead</button>
        </div>
      </div>
      <div class="autofix-empty-flow">
        ${steps
          .map(
            ([step, title, detail]) => `
          <div class="autofix-empty-step">
            <span>${esc(step)}</span>
            <strong>${esc(title)}</strong>
            <small>${esc(detail)}</small>
          </div>`,
          )
          .join('')}
      </div>
    </section>`;
}

function renderAutofixIssueEmptyState(owner, repo, triggerLabel) {
  return `
    <section class="autofix-empty-state autofix-issue-empty-state">
      <div>
        <span>No matching issues</span>
        <strong>No open issues matched this Autofix search</strong>
        <p>Broaden the filters, confirm the trigger label, or use Copilot for a one-off issue that should not become an Autofix pickup rule.</p>
        <div class="autofix-empty-actions">
          <button class="btn btn-sm btn-primary" onclick="document.getElementById('af-filter-number').value='';document.getElementById('af-filter-assignee').value='';document.getElementById('af-filter-milestone').value='';document.getElementById('af-filter-labels').value='${esc(triggerLabel || '')}';autofixLoadIssues(window._autofixActiveProjectId,'${esc(owner)}','${esc(repo)}')">Clear filters</button>
          <button class="btn btn-sm btn-ghost" onclick="toggleAutofixAddForm(true)">Check repo setup</button>
          <button class="btn btn-sm btn-ghost" onclick="navigate('copilot')">Try Copilot</button>
        </div>
      </div>
      <div class="autofix-empty-flow">
        <div class="autofix-empty-step">
          <span>Repo</span>
          <strong>${esc(owner)}/${esc(repo)}</strong>
          <small>Confirm this is the repository with the labeled issue queue.</small>
        </div>
        <div class="autofix-empty-step">
          <span>Label</span>
          <strong>${esc(triggerLabel || 'any')}</strong>
          <small>Autofix only picks issues matching the selected filters.</small>
        </div>
        <div class="autofix-empty-step">
          <span>Fallback</span>
          <strong>One-off issue</strong>
          <small>Use Copilot when the work should not enter an automated pickup loop.</small>
        </div>
      </div>
    </section>`;
}

window.copyAutofixReadinessBrief = async function () {
  const state = window._autofixReadinessState;
  if (!state) {
    toast('Open Autofix first', 'warning');
    return;
  }
  const text = autofixReadinessBriefText(state);
  await copyTextWithFallback(
    text,
    'Autofix readiness brief copied',
    'Copy Autofix readiness brief',
  );
};

window.toggleAutofixAddForm = function (forceOpen) {
  const form = document.getElementById('autofix-add-form');
  if (!form) return;
  const shouldOpen =
    typeof forceOpen === 'boolean'
      ? forceOpen
      : form.classList.contains('is-hidden');
  form.classList.toggle('is-hidden', !shouldOpen);
  if (shouldOpen) document.getElementById('af-owner')?.focus();
};

window.toggleAutofixPanel = function (id, forceOpen) {
  const panel = document.getElementById(id);
  if (!panel) return;
  const shouldOpen =
    typeof forceOpen === 'boolean'
      ? forceOpen
      : panel.classList.contains('is-hidden');
  panel.classList.toggle('is-hidden', !shouldOpen);
};

async function renderAutofix(el) {
  el.innerHTML = renderAutofixLoadingState('cockpit');
  try {
    const loadIssues = [];
    const [projects, jobs, groups, providers, webhookHealth] = await Promise.all([
      api('/autofix/projects').catch(() => {
        loadIssues.push('Autofix project list unavailable');
        return [];
      }),
      api('/autofix/jobs').catch(() => {
        loadIssues.push('Autofix job queue unavailable');
        return [];
      }),
      api('/groups').catch(() => {
        loadIssues.push('Group delivery targets unavailable');
        return [];
      }),
      api('/agents/providers').catch(() => {
        loadIssues.push('Provider catalog unavailable');
        return [];
      }),
      api('/webhooks/github-health').catch(() => {
        loadIssues.push('GitHub webhook health unavailable');
        return null;
      }),
    ]);

    const codingProviders = (Array.isArray(providers) ? providers : []).filter(
      (provider) => provider.codingCapable,
    );
    const providerOptions =
      codingProviders
        .map((provider) => `<option value="${esc(provider.id)}">${esc(provider.name)}</option>`)
        .join('') || '<option value="claude">Claude</option>';
    const modelMap = {};
    const providerMap = {};
    for (const provider of codingProviders) {
      providerMap[provider.id] = provider;
      modelMap[provider.id] = (provider.models || []).filter((model) => model.codingCapable !== false);
    }
    const healthClass =
      webhookHealth?.status === 'ready'
        ? 'badge-success'
        : webhookHealth?.status === 'blocked'
          ? 'badge-error'
          : 'badge-warning';
    const healthChecks = (webhookHealth?.checks || [])
      .slice(0, 4)
      .map(
        (check) => `<div class="channel-card autofix-health-row">
          <div class="autofix-health-label">${esc(check.label)}</div>
          <span class="badge ${check.ok ? 'badge-success' : check.severity === 'required' ? 'badge-error' : 'badge-warning'} autofix-count-badge">${check.ok ? 'OK' : 'Needs attention'}</span>
        </div>`,
      )
      .join('');

    const groupOpts = (Array.isArray(groups) ? groups : [])
      .map((g) => {
        const ch = g.channel || 'unknown';
        return `<option value="${esc(g.jid)}">${esc(ch)} (${esc(g.name)})</option>`;
      })
      .join('');
    const enabledAutoPickCount = projects.filter((p) => p.autoPickEnabled).length;

    const projectCards = projects
      .map(
        (p) => {
          const autoPickBadge = p.autoPickEnabled
            ? '<span class="badge badge-success autofix-mini-badge">Auto-pick</span>'
            : '<span class="badge badge-muted autofix-mini-badge">Manual</span>';
          return `
      <div class="channel-card autofix-project-row">
        <div class="autofix-row-body">
          <strong>${esc(p.owner)}/${esc(p.repo)}</strong>
          <span class="badge badge-muted autofix-mini-badge">label: ${esc(p.triggerLabel)}</span>
          <span class="badge badge-muted autofix-mini-badge">${esc(p.provider || 'claude')}/${esc(p.model)}</span>
          <span class="badge badge-muted autofix-mini-badge">max ${esc(p.maxActiveJobs || 1)}</span>
          ${p.createPr === false ? '<span class="badge badge-warning autofix-mini-badge">No PR</span>' : '<span class="badge badge-info autofix-mini-badge">PR flow</span>'}
          ${p.autoReview ? '<span class="badge badge-success autofix-mini-badge">Auto-review</span>' : ''}
          ${autoPickBadge}
          <div class="autofix-row-meta">${esc(p.workDir)}</div>
          <div class="autofix-project-controls">
            <label class="autofix-inline-control">
              <input type="checkbox" ${p.autoPickEnabled ? 'checked' : ''} onchange="autofixUpdateProject('${esc(p.id)}',{autoPickEnabled:this.checked})">
              Auto-pick labeled issues
            </label>
            <label class="autofix-inline-control">
              Poll every
              <input class="search-input autofix-small-input" type="number" min="5" step="1" value="${esc(p.pollIntervalMinutes || 15)}" onchange="autofixUpdateProject('${esc(p.id)}',{pollIntervalMinutes:Number(this.value||15)})">
              min
            </label>
            <span class="field-hint">${esc(autofixLastPollLabel(p.lastAutoPickAt))}</span>
          </div>
        </div>
        <div class="autofix-row-actions">
          <button class="btn btn-sm btn-primary" onclick="autofixPickIssue('${esc(p.id)}','${esc(p.owner)}','${esc(p.repo)}','${esc(p.triggerLabel)}')">Fix Issue</button>
          <button class="btn btn-sm btn-ghost autofix-remove-action" onclick="autofixDeleteProject('${esc(p.id)}',this)">Remove</button>
        </div>
      </div>
    `;
        },
      )
      .join('');

    const jobRows = jobs
      .map((j) => {
        const sc = autofixStatusBadge(j.status);
        return `<div class="channel-card autofix-job-row">
        <div class="autofix-row-body">
          <strong>${esc(j.repo)}#${j.issueNumber}</strong>
          <span class="autofix-job-title">${esc((j.issueTitle || '').slice(0, 60))}</span>
          ${j.prUrl ? `<a href="${esc(j.prUrl)}" target="_blank" class="autofix-row-link">View PR</a>` : ''}
          <div class="autofix-job-meta">${esc(j.provider || 'claude')}/${esc(j.model || '')} \u2022 ${timeAgo(j.startedAt || j.createdAt)} \u2022 ${esc(j.branch || '')}</div>
        </div>
        <div class="autofix-row-actions">
          <span class="badge ${sc} autofix-count-badge">${j.status}</span>
          <button class="btn btn-sm btn-ghost" onclick="viewAutofixJob('${esc(j.id)}')">Review</button>
        </div>
      </div>`;
      })
      .join('');

    el.innerHTML = `
      <div class="page-header autofix-page-header">
        <div>
          <span class="report-kicker">Code focus</span>
          <h2>GitHub Autofix</h2>
          <p class="autofix-page-description">Turn labeled GitHub issues into reviewed branches, test evidence, and PRs.</p>
        </div>
        <div class="autofix-header-actions">
          <button class="btn btn-sm btn-ghost" onclick="autofixRunAutoPickNow(this)">Run scan now</button>
          <button class="btn btn-sm btn-primary" onclick="toggleAutofixAddForm(true)">Add Project</button>
        </div>
      </div>

      ${renderAutofixCommandCenter({
        projects,
        jobs,
        enabledAutoPickCount,
        webhookHealth,
        healthClass,
        healthChecks,
        loadIssues,
      })}

      <div id="autofix-add-form" class="card autofix-form-panel is-hidden">
        <div class="card-title">Add Project</div>
        <div class="grid grid-2">
          <div class="form-group"><label>Owner</label><input class="search-input autofix-full-input" id="af-owner" placeholder="owner"></div>
          <div class="form-group"><label>Repo</label><input class="search-input autofix-full-input" id="af-repo" placeholder="nanocrab"></div>
        </div>
        <div class="grid grid-2">
          <div class="form-group"><label>Trigger label</label><input class="search-input autofix-full-input" id="af-label" value="autofix"></div>
          <div class="form-group"><label>Provider</label><select class="search-input autofix-full-input" id="af-provider" onchange="autofixUpdateModels()">${providerOptions}</select></div>
        </div>
        <div class="grid grid-2">
          <div class="form-group"><label>Model</label><select class="search-input autofix-full-input" id="af-model"><option value="">Default model</option></select></div>
          <div class="form-group"><label>Max active jobs</label><input class="search-input autofix-full-input" id="af-max-active" type="number" min="1" step="1" value="1"></div>
        </div>
        <div class="grid grid-2">
          <div class="form-group"><label>Working directory (auto-cloned if empty)</label><input class="search-input autofix-full-input" id="af-workdir" placeholder="/home/user/repos/myrepo"></div>
          <div class="form-group"><label>Notify channel</label>
            <select class="search-input autofix-full-input" id="af-notify">
              <option value="">None</option>
              ${groupOpts}
            </select>
          </div>
        </div>
        <label class="autofix-check-control">
          <input type="checkbox" id="af-autoreview"> Auto-review new PRs with the selected model
        </label>
        <label class="autofix-check-control">
          <input type="checkbox" id="af-create-pr" checked> Open PR flow after implementation
        </label>
        <div class="autofix-automation-panel">
          <label class="autofix-check-control autofix-check-control-inline">
            <input type="checkbox" id="af-auto-pick"> Automatically pick up labeled GitHub issues
          </label>
          <label class="autofix-inline-control">
            Poll every
            <input class="search-input autofix-small-input" id="af-poll-interval" type="number" min="5" step="1" value="15">
            min
          </label>
        </div>
        <div class="autofix-form-actions">
          <button class="btn btn-primary" onclick="autofixAddProject()">Add Project</button>
          <button class="btn btn-ghost" onclick="toggleAutofixAddForm(false)">Cancel</button>
        </div>
      </div>

      <div id="autofix-issue-picker" class="autofix-panel-slot is-hidden"></div>
      <div id="autofix-job-output" class="autofix-panel-slot is-hidden"></div>

      <div class="card autofix-section-card">
        <div class="card-title">Projects <span class="badge badge-muted autofix-count-badge">${projects.length}</span></div>
        ${projects.length === 0 ? renderAutofixProjectEmptyState() : projectCards}
      </div>

      ${
        jobs.length > 0
          ? `<div class="card">
        <div class="card-title">Recent Jobs <span class="badge badge-muted autofix-count-badge">${jobs.length}</span></div>
        ${jobRows}
      </div>`
          : ''
      }
    `;
    window._autofixModelsByProvider = modelMap;
    window._autofixProvidersById = providerMap;
    autofixUpdateModels();
  } catch (e) {
    el.innerHTML = renderAutofixRecoveryState('load', e.message);
  }
}

window.autofixUpdateModels = function () {
  const providerEl = document.getElementById('af-provider');
  const modelEl = document.getElementById('af-model');
  if (!providerEl || !modelEl) return;
  const provider = (window._autofixProvidersById || {})[providerEl.value] || {};
  const models = (window._autofixModelsByProvider || {})[providerEl.value] || [];
  const defaultAllowed = provider.id !== 'ollama';
  modelEl.innerHTML = `${defaultAllowed ? '<option value="">Default model</option>' : ''}${models.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}`;
};

window.autofixAddProject = async function () {
  const owner = document.getElementById('af-owner').value.trim();
  const repo = document.getElementById('af-repo').value.trim();
  const triggerLabel =
    document.getElementById('af-label').value.trim() || 'autofix';
  const provider = document.getElementById('af-provider').value;
  const model = document.getElementById('af-model').value;
  const workDir = document.getElementById('af-workdir').value.trim();
  const notifyJid = document.getElementById('af-notify').value;
  const autoReview = document.getElementById('af-autoreview').checked;
  const createPr = document.getElementById('af-create-pr').checked;
  const maxActiveJobs = Number(document.getElementById('af-max-active').value || 1);
  const autoPickEnabled = document.getElementById('af-auto-pick').checked;
  const pollIntervalMinutes = Number(
    document.getElementById('af-poll-interval').value || 15,
  );
  if (!owner || !repo) {
    toast('Owner and repo required', 'warning');
    return;
  }
  try {
    const r = await api('/autofix/projects', {
      method: 'POST',
      body: JSON.stringify({
        owner,
        repo,
        triggerLabel,
        provider,
        model,
        workDir,
        notifyJid,
        autoReview,
        createPr,
        maxActiveJobs,
        autoPickEnabled,
        pollIntervalMinutes,
      }),
    });
    if (r.ok) {
      toast('Project added', 'success');
      navigate('autofix');
    } else toast(autofixActionErrorMessage('create-project', r.error), 'error');
  } catch (e) {
    toast(autofixActionErrorMessage('create-project', e), 'error');
  }
};

window.autofixUpdateProject = async function (id, patch) {
  try {
    const r = await api('/autofix/projects/' + id, {
      method: 'PUT',
      body: JSON.stringify(patch || {}),
    });
    if (!r.ok) {
      toast(autofixActionErrorMessage('update-project', r.error), 'error');
      return;
    }
    toast('Project updated', 'success');
    navigate('autofix');
  } catch (e) {
    toast(autofixActionErrorMessage('update-project', e), 'error');
  }
};

window.autofixRunAutoPickNow = async function (btn) {
  const previous = btn?.textContent || 'Run scan now';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Scanning...';
  }
  try {
    const r = await api('/autofix/auto-pick/run', { method: 'POST' });
    if (!r.ok) {
      toast(autofixActionErrorMessage('auto-pick', r.error), 'error');
      return;
    }
    const result = r.result || {};
    toast(
      `Scan complete: ${result.started || 0} started, ${result.scanned || 0} project${result.scanned === 1 ? '' : 's'} scanned`,
      result.errors ? 'warning' : 'success',
    );
    navigate('autofix');
  } catch (e) {
    toast(autofixActionErrorMessage('auto-pick', e), 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = previous;
    }
  }
};

window.autofixDeleteProject = function (id, btn) {
  inlineConfirm(btn, 'Remove?', async () => {
    try {
      await api('/autofix/projects/' + id, { method: 'DELETE' });
      toast('Removed', 'success');
      navigate('autofix');
    } catch (e) {
      toast(autofixActionErrorMessage('delete-project', e), 'error');
    }
  });
};

window.autofixPickIssue = async function (
  projectId,
  owner,
  repo,
  triggerLabel,
) {
  const picker = document.getElementById('autofix-issue-picker');
  if (!picker) return;
  toggleAutofixPanel('autofix-issue-picker', true);
  window._autofixActiveProjectId = projectId;
  window._autofixActiveTriggerLabel = triggerLabel || '';
  const fullRepo = `${owner}/${repo}`;
  picker.innerHTML = `<div class="card">
    <div class="autofix-panel-head">
      <div class="card-title">Pick an issue — ${esc(fullRepo)}</div>
      <button class="btn btn-sm btn-ghost" onclick="toggleAutofixPanel('autofix-issue-picker', false)">\u2715</button>
    </div>
    <div class="autofix-filter-grid">
      <input class="search-input" id="af-filter-number" placeholder="Issue #">
      <input class="search-input" id="af-filter-labels" value="${esc(triggerLabel || 'autofix')}" placeholder="labels, comma-separated">
      <input class="search-input" id="af-filter-assignee" placeholder="assignee">
      <input class="search-input" id="af-filter-milestone" placeholder="milestone">
      <button class="btn btn-sm btn-primary" onclick="autofixLoadIssues('${esc(projectId)}','${esc(owner)}','${esc(repo)}')">Search</button>
    </div>
    <div id="autofix-issue-results" class="autofix-issue-results">${renderAutofixLoadingState('issues')}</div>
  </div>`;
  await autofixLoadIssues(projectId, owner, repo);
};

window.autofixLoadIssues = async function (projectId, owner, repo) {
  const results = document.getElementById('autofix-issue-results');
  if (!results) return;
  results.innerHTML = renderAutofixLoadingState('issues');
  try {
    const labels = document.getElementById('af-filter-labels')?.value?.trim();
    const assignee = document
      .getElementById('af-filter-assignee')
      ?.value?.trim();
    const milestone = document
      .getElementById('af-filter-milestone')
      ?.value?.trim();
    const issueNumber = document
      .getElementById('af-filter-number')
      ?.value?.trim();
    const params = new URLSearchParams({ repo: `${owner}/${repo}` });
    if (labels) params.set('labels', labels);
    if (assignee) params.set('assignee', assignee);
    if (milestone) params.set('milestone', milestone);
    if (issueNumber) params.set('issueNumber', issueNumber);
    const issues = await api(`/autofix/issues?${params.toString()}`);
    if (!Array.isArray(issues) || issues.length === 0) {
      results.innerHTML = renderAutofixIssueEmptyState(
        owner,
        repo,
        labels || window._autofixActiveTriggerLabel || '',
      );
      return;
    }
    results.innerHTML = `
      ${issues
        .map(
          (i) => `<div class="channel-card autofix-issue-row">
        <div class="autofix-row-body">
          <strong>#${i.number}</strong> ${esc(i.title)}
          ${(i.labels || []).map((l) => `<span class="badge badge-muted autofix-mini-badge">${esc(l)}</span>`).join(' ')}
          <div class="autofix-job-meta">${esc((i.assignees || []).join(', ') || 'unassigned')}${i.milestone ? ` \u2022 ${esc(i.milestone)}` : ''}</div>
        </div>
        <button class="btn btn-sm btn-primary" onclick="autofixRun('${esc(projectId)}',${i.number},this)">Fix</button>
      </div>`,
        )
        .join('')}`;
  } catch (e) {
    results.innerHTML = renderAutofixRecoveryState('issues', e.message, {
      retryAction: `autofixLoadIssues('${esc(projectId)}','${esc(owner)}','${esc(repo)}')`,
    });
  }
};

window.autofixRun = async function (projectId, issueNumber, btn) {
  btn.disabled = true;
  btn.textContent = 'Starting...';
  try {
    const r = await api('/autofix/run', {
      method: 'POST',
      body: JSON.stringify({ projectId, issueNumber }),
    });
    if (r.ok) {
      toast('Autofix started', 'success');
      btn.outerHTML =
        '<span class="badge badge-warning autofix-count-badge">Running</span>';
      toggleAutofixPanel('autofix-issue-picker', false);
      // Show output
      setTimeout(() => viewAutofixJob(r.jobId), 2000);
    } else {
      toast(autofixActionErrorMessage('run', r.error), 'error');
      btn.disabled = false;
      btn.textContent = 'Fix';
    }
  } catch (e) {
    toast(autofixActionErrorMessage('run', e), 'error');
    btn.disabled = false;
    btn.textContent = 'Fix';
  }
};

window.viewAutofixJob = async function (id) {
  const panel = document.getElementById('autofix-job-output');
  if (!panel) return;
  toggleAutofixPanel('autofix-job-output', true);
  panel.innerHTML = renderAutofixJobLoadingState(id);
  try {
    const job = await api('/autofix/jobs/' + id);
    const sc = autofixStatusBadge(job.status);
    const diff =
      job.diffSummary ||
      (job.changedFiles || []).join('\n') ||
      '(no diff captured yet)';
    const tests = job.testSummary || '(no test summary captured yet)';
    const ci = [
      `Status: ${job.ciStatus || 'unknown'}`,
      job.lastCiError ? `Last error: ${job.lastCiError}` : '',
      job.commitSha ? `Commit: ${job.commitSha}` : '',
      job.prUrl ? `PR: ${job.prUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const actions = [
      job.status === 'await_approval'
        ? `<label class="autofix-deny-note-field"><span>Deny note</span><input id="${esc(autofixDenyNoteId(id))}" placeholder="Reason or follow-up"></label>`
        : '',
      job.status === 'await_approval'
        ? `<button class="btn btn-sm btn-primary" onclick="autofixJobAction('${esc(id)}','approve-implementation')">Approve implementation</button>`
        : '',
      job.status === 'await_approval'
        ? `<button class="btn btn-sm btn-ghost" onclick="autofixDenyImplementation('${esc(id)}')">Deny implementation</button>`
        : '',
      job.status === 'await_pr_approval'
        ? `<button class="btn btn-sm btn-primary" onclick="autofixJobAction('${esc(id)}','approve-pr')">Approve PR</button>`
        : '',
      job.commitSha && ['ci_running', 'completed'].includes(job.status)
        ? `<button class="btn btn-sm btn-ghost" onclick="autofixJobAction('${esc(id)}','refresh-ci')">Refresh CI</button>`
        : '',
      ['failed', 'cancelled'].includes(job.status)
        ? `<button class="btn btn-sm btn-ghost" onclick="autofixJobAction('${esc(id)}','retry')">Retry</button>`
        : '',
      !['completed', 'cancelled'].includes(job.status)
        ? `<button class="btn btn-sm btn-ghost" onclick="autofixJobAction('${esc(id)}','cancel')">Cancel</button>`
        : '',
    ]
      .filter(Boolean)
      .join('');
    panel.innerHTML = `<div class="card">
      <div class="autofix-review-head">
        <div>
          <strong>${esc(job.repo)}#${job.issueNumber}</strong> \u2014 ${esc(job.issueTitle)}
          <span class="badge ${sc} autofix-status-badge">${job.status}</span>
          ${job.prUrl ? `<a href="${esc(job.prUrl)}" target="_blank" class="autofix-row-link">View PR</a>` : ''}
        </div>
        <div class="autofix-review-actions">
          ${actions}
          ${['queued', 'investigate', 'plan', 'implement', 'test', 'open_pr', 'ci_running'].includes(job.status) ? `<button class="btn btn-sm btn-ghost" onclick="viewAutofixJob('${id}')">Refresh</button>` : ''}
          <button class="btn btn-sm btn-ghost" onclick="toggleAutofixPanel('autofix-job-output', false)">\u2715</button>
        </div>
      </div>
      <div class="autofix-review-meta">
        <span>Branch: <strong>${esc(job.branch || '')}</strong></span>
        <span>Files: <strong>${(job.changedFiles || []).length}</strong></span>
        <span>Commit: <strong>${esc(job.commitSha ? job.commitSha.slice(0, 12) : 'pending')}</strong></span>
      </div>
      <div class="autofix-review-grid">
        <div class="autofix-review-pane"><div class="autofix-pane-title">Diff</div><pre>${esc(diff)}</pre></div>
        <div class="autofix-review-pane"><div class="autofix-pane-title">Log</div><pre>${esc(job.output || '(waiting for output...)')}</pre></div>
        <div class="autofix-review-pane"><div class="autofix-pane-title">Tests</div><pre>${esc(tests)}</pre></div>
        <div class="autofix-review-pane"><div class="autofix-pane-title">CI</div><pre>${esc(ci || 'Status: unknown')}</pre></div>
      </div>
    </div>`;
    if (
      [
        'queued',
        'investigate',
        'plan',
        'implement',
        'test',
        'open_pr',
        'ci_running',
      ].includes(job.status)
    ) {
      setTimeout(() => {
        if (
          !document
            .getElementById('autofix-job-output')
            ?.classList.contains('is-hidden')
        )
          viewAutofixJob(id);
      }, 5000);
    }
  } catch (e) {
    panel.innerHTML = renderAutofixRecoveryState('job', e.message, {
      retryAction: `viewAutofixJob('${esc(id)}')`,
    });
  }
};

window.autofixJobAction = async function (id, action) {
  try {
    const r = await api(`/autofix/jobs/${id}/${action}`, { method: 'POST' });
    if (!r.ok) {
      toast(autofixActionErrorMessage('job-action', r.error), 'error');
      return;
    }
    toast('Job updated', 'success');
    await viewAutofixJob(id);
    setTimeout(() => {
      if (currentPage === 'autofix') navigate('autofix');
    }, 800);
  } catch (e) {
    toast(autofixActionErrorMessage('job-action', e), 'error');
  }
};

window.autofixDenyImplementation = function (id) {
  const noteInput = document.getElementById(autofixDenyNoteId(id));
  const note =
    noteInput?.value.trim() ||
    'Denied from Autofix dashboard';
  autofixJobActionWithBody(id, 'deny-implementation', { note });
};

async function autofixJobActionWithBody(id, action, body) {
  try {
    const r = await api(`/autofix/jobs/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) {
      toast(autofixActionErrorMessage('job-action', r.error), 'error');
      return;
    }
    toast('Job updated', 'success');
    await viewAutofixJob(id);
  } catch (e) {
    toast(autofixActionErrorMessage('job-action', e), 'error');
  }
}
