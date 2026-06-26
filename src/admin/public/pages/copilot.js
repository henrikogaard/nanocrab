// NanoCrab Admin — Copilot Page

// --- GitHub Copilot ---

function copilotJobTone(status) {
  if (status === 'completed') return 'ready';
  if (['working', 'assigned', 'queued', 'in_progress'].includes(status))
    return 'active';
  if (status === 'failed') return 'attention';
  return 'muted';
}

function copilotStatusBadge(status) {
  if (status === 'completed') return 'badge-success';
  if (['working', 'assigned', 'queued', 'in_progress'].includes(status))
    return 'badge-warning';
  if (status === 'failed') return 'badge-error';
  return 'badge-muted';
}

function copilotHandoffBriefText(state) {
  const status = state?.status || {};
  const accounts = state?.accounts || [];
  const jobs = state?.jobs || [];
  const loadIssues = state?.loadIssues || [];
  const handoff = state?.handoff || {};
  const activeJobs = jobs.filter((job) =>
    ['working', 'assigned', 'queued', 'in_progress'].includes(job.status),
  );
  const failedJobs = jobs.filter((job) => job.status === 'failed');
  const completedJobs = jobs.filter((job) => job.status === 'completed');
  const enabledAccounts = accounts.filter((account) => account.copilotEnabled !== false);
  const accountLines = accounts.slice(0, 8).map((account) => {
    const login = account.login || account.username || 'github';
    return `- @${login}: ${account.copilotEnabled === false ? 'no Copilot access' : 'Copilot ready'}`;
  });
  const jobLines = jobs.slice(0, 10).map((job) => {
    const issueNumber = Number(job.issueNumber || job.issue);
    const issueRef = Number.isFinite(issueNumber) ? ` #${issueNumber}` : '';
    return `- ${job.repo || 'Repository'}${issueRef}: ${job.status}${job.issueTitle || job.title ? ` - ${job.issueTitle || job.title}` : ''}`;
  });

  return [
    'Copilot Code handoff brief',
    '',
    `OAuth configured: ${status.configured ? 'yes' : 'no'}`,
    `Accounts: ${accounts.length}`,
    `Copilot-ready accounts: ${enabledAccounts.length}`,
    `Jobs: ${jobs.length}`,
    `Active jobs: ${activeJobs.length}`,
    `Failed jobs: ${failedJobs.length}`,
    `Completed jobs: ${completedJobs.length}`,
    `Data health: ${loadIssues.length ? loadIssues.join('; ') : 'Copilot delegation feeds loaded without known fallback.'}`,
    '',
    `Readiness: ${handoff.title || 'No readiness decision available'}`,
    handoff.detail || 'Check setup, account access, and job queue before delegating Code work.',
    '',
    'Use Copilot for clearly scoped GitHub issues that fit Code work. Use Autofix when the task needs a fuller repo pipeline, build/test loop, PR orchestration, or repeated pickup rules.',
    'Do not assign more Copilot work while failed handoffs or approval gates need review. Keep repository-changing work tied to Git Ops, Test Runner evidence, and Approvals.',
    '',
    'Accounts',
    ...(accountLines.length ? accountLines : ['- No GitHub accounts connected.']),
    '',
    'Recent jobs',
    ...(jobLines.length ? jobLines : ['- No Copilot jobs yet.']),
  ].join('\n');
}

function copilotIssueHandoffPromptText(state, issue) {
  const repo = [state?.owner, state?.repo].filter(Boolean).join('/') || 'selected repository';
  const labels = Array.isArray(issue?.labels) && issue.labels.length
    ? issue.labels.join(', ')
    : 'none listed';
  return [
    'Copilot issue handoff prompt',
    '',
    `Repository: ${repo}`,
    `Issue: #${issue?.number || 'unknown'} ${issue?.title || 'Untitled issue'}`,
    `Labels: ${labels}`,
    `Already assigned to Copilot: ${issue?.copilotAssigned ? 'yes' : 'no'}`,
    '',
    'Delegation fit',
    '- Use GitHub Copilot if this is a clearly scoped issue with an expected code change or PR follow-up.',
    '- Route to Agents when the task needs investigation, planning, tool choice, or clarification before writing code.',
    '- Route to Autofix when labels, repeated pickup, build/test loops, PR orchestration, or approval gates should manage the workflow.',
    '- Open Git & Code first when branch state, diffs, tests, review rules, or release proof should be inspected before assignment.',
    '',
    'Before assigning',
    '- Confirm the issue is open, small enough for a focused Code handoff, and not blocked by missing product decisions.',
    '- Name the expected output, test evidence, approval boundary, and where follow-up should be reviewed.',
    '- Do not mix Cowork project documents, MCP/email summaries, or pure chat requests into this Code handoff.',
  ].join('\n');
}

function renderCopilotEmptyState(kind, options = {}) {
  const isAccounts = kind === 'accounts';
  const title = isAccounts
    ? 'Connect GitHub before delegating code work'
    : 'No Copilot jobs in the queue yet';
  const body = isAccounts
    ? 'Add a Copilot-enabled GitHub account so NanoCrab can browse repositories, choose open issues, and assign work from the Code workspace.'
    : 'Start from a repository issue when the task is clearly scoped. Use Autofix instead when the work needs a fuller build, test, approval, or PR pipeline.';
  const primaryAction = isAccounts
    ? 'copilotAddAccount()'
    : options.firstAccount
      ? `copilotBrowseRepos('${esc(options.firstAccount.id)}','${esc(options.firstAccountLogin || 'github')}')`
      : 'copilotAddAccount()';
  const primaryLabel = isAccounts
    ? 'Connect GitHub'
    : options.firstAccount
      ? 'Choose issue'
      : 'Connect GitHub';
  const steps = isAccounts
    ? [
        ['01', 'Connect account', 'OAuth unlocks repository browsing and issue assignment.'],
        ['02', 'Pick repository', 'Choose work that belongs in Code, not a pure chat or Cowork project.'],
        ['03', 'Assign issue', 'Keep the result tied to Git Ops, tests, and approvals.'],
      ]
    : [
        ['01', 'Browse repos', 'Find an issue small enough for a Copilot handoff.'],
        ['02', 'Use Autofix', 'Escalate repeatable pickup, build/test loops, or PR orchestration.'],
        ['03', 'Review evidence', 'Return to Git & Code for repository state and test proof.'],
      ];
  return `
    <section class="copilot-empty-state is-${esc(kind)}">
      <div>
        <span>${isAccounts ? 'Account setup' : 'Code queue'}</span>
        <strong>${esc(title)}</strong>
        <p>${esc(body)}</p>
        <div class="copilot-empty-actions">
          <button class="btn btn-sm btn-primary" onclick="${primaryAction}">${esc(primaryLabel)}</button>
          <button class="btn btn-sm btn-ghost" onclick="navigate('autofix')">Autofix pipelines</button>
          <button class="btn btn-sm btn-ghost" onclick="navigate('gitcode')">Git & Code</button>
        </div>
      </div>
      <div class="copilot-empty-steps">
        ${steps
          .map(
            ([step, stepTitle, detail]) => `
          <div class="copilot-empty-step">
            <span>${esc(step)}</span>
            <strong>${esc(stepTitle)}</strong>
            <small>${esc(detail)}</small>
          </div>`,
          )
          .join('')}
      </div>
    </section>`;
}

function renderCopilotRecoveryState(kind, message, options = {}) {
  const isPicker = kind === 'repos' || kind === 'issues';
  const title =
    kind === 'repos'
      ? 'Repository list could not load'
      : kind === 'issues'
        ? 'Issue list could not load'
        : 'Copilot could not load';
  const body =
    kind === 'repos'
      ? 'Check GitHub account access, OAuth scopes, and repository visibility before assigning Code work.'
      : kind === 'issues'
        ? 'Check repository access and issue permissions. You can still route broader repository work through Autofix.'
        : 'The Code delegation cockpit could not reach Copilot status, accounts, or job data. Settings and Git & Code can help narrow the setup problem.';
  const retryAction = options.retryAction || "navigate('copilot')";
  return `
    <section class="copilot-recovery-state is-${esc(kind || 'load')}">
      <div>
        <span>${isPicker ? 'Picker unavailable' : 'Code delegation unavailable'}</span>
        <strong>${esc(title)}</strong>
        <p>${esc(body)}</p>
        ${message ? `<small>${esc(message)}</small>` : ''}
      </div>
      <div class="copilot-recovery-actions">
        <button type="button" class="btn btn-sm btn-primary" onclick="${retryAction}">Retry</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="copilotAddAccount()">Connect GitHub</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('gitcode')">Git & Code</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('autofix')">Autofix</button>
      </div>
    </section>`;
}

function renderCopilotLoadingState(kind = 'page') {
  const states = {
    page: {
      title: 'Loading Code delegation cockpit',
      detail:
        'Checking GitHub OAuth, Copilot-ready accounts, active jobs, failed handoffs, and approval routes before assigning code work.',
      steps: ['OAuth', 'Accounts', 'Jobs', 'Readiness'],
    },
    repos: {
      title: 'Loading repositories',
      detail:
        'Reading repository access and issue counts so you can choose work that belongs in Code.',
      steps: ['Account', 'Repos', 'Visibility'],
    },
    issues: {
      title: 'Loading issues',
      detail:
        'Collecting open issues, labels, and assignment state before handing a scoped task to Copilot.',
      steps: ['Issues', 'Labels', 'Assignees'],
    },
  };
  const state = states[kind] || states.page;
  return `
    <section class="copilot-loading-state is-${esc(kind)}" aria-busy="true" aria-label="${esc(state.title)}">
      <div>
        <span>${kind === 'page' ? 'Code focus' : 'Picker loading'}</span>
        <strong>${esc(state.title)}</strong>
        <p>${esc(state.detail)}</p>
      </div>
      <div class="copilot-loading-flow">
        ${state.steps.map((step) => `<span>${esc(step)}</span>`).join('')}
      </div>
    </section>`;
}

function copilotHandoffFitCards() {
  return [
    {
      lane: 'Copilot',
      fit: 'Single GitHub issue',
      detail:
        'Use when the issue is already scoped, the repository is known, and the expected output is a small code change or PR follow-up.',
      action: "document.getElementById('copilot-repos')?.scrollIntoView({ behavior: 'smooth', block: 'start' })",
      actionLabel: 'Pick issue',
    },
    {
      lane: 'Autofix',
      fit: 'Repeated issue pickup',
      detail:
        'Use when labels, build/test loops, PR approval, and repeated GitHub automation should run as a managed pipeline.',
      action: "navigate('autofix')",
      actionLabel: 'Open Autofix',
    },
    {
      lane: 'Agents',
      fit: 'Open-ended code task',
      detail:
        'Use when the work needs investigation, planning, tool choice, or a coding agent that can explain questions before changing files.',
      action: "navigate('agents')",
      actionLabel: 'Agent cockpit',
    },
    {
      lane: 'Git & Code',
      fit: 'Repo state and proof',
      detail:
        'Use when the next decision depends on branches, commits, diffs, tests, review rules, or evidence before delegation.',
      action: "navigate('gitcode')",
      actionLabel: 'Review repo',
    },
  ];
}

function renderCopilotHandoffFit() {
  return `
    <section class="copilot-fit-matrix" aria-label="Copilot handoff fit">
      <div class="copilot-fit-head">
        <span>Handoff fit</span>
        <strong>Choose the Code lane before assigning work.</strong>
        <p>Copilot is best for a clear GitHub issue. Route broader, repeated, or evidence-heavy repository work to the Code tool that can own it.</p>
      </div>
      <div class="copilot-fit-grid">
        ${copilotHandoffFitCards()
          .map(
            (card) => `
          <article class="copilot-fit-card">
            <span>${esc(card.lane)}</span>
            <strong>${esc(card.fit)}</strong>
            <p>${esc(card.detail)}</p>
            <button type="button" class="btn btn-sm btn-ghost" onclick="${card.action}">${esc(card.actionLabel)}</button>
          </article>`,
          )
          .join('')}
      </div>
    </section>`;
}

function copilotActionErrorMessage(kind, err) {
  const detail = err?.message ? ': ' + err.message : '';
  if (kind === 'oauth') {
    return 'Could not start GitHub OAuth. Check Copilot credentials, callback URL, and provider setup' + detail;
  }
  if (kind === 'remove-account') {
    return 'Could not remove the GitHub account. Check active jobs before retrying' + detail;
  }
  if (kind === 'refresh-account') {
    return 'Could not refresh GitHub access. Reconnect the account if OAuth has expired' + detail;
  }
  if (kind === 'assign') {
    return 'Could not assign GitHub Copilot. Check issue permissions, Copilot access, and Code handoff readiness' + detail;
  }
  return 'Copilot action failed' + detail;
}

async function renderCopilot(el) {
  el.innerHTML = renderCopilotLoadingState('page');
  try {
    const loadIssues = [];
    const [status, accounts, jobs] = await Promise.all([
      api('/copilot/status'),
      api('/copilot/accounts').catch(() => {
        loadIssues.push('GitHub account list unavailable');
        return [];
      }),
      api('/copilot/jobs').catch(() => {
        loadIssues.push('Copilot job queue unavailable');
        return [];
      }),
    ]);

    const activeJobs = jobs.filter((job) =>
      ['working', 'assigned', 'queued', 'in_progress'].includes(job.status),
    );
    const failedJobs = jobs.filter((job) => job.status === 'failed');
    const completedJobs = jobs.filter((job) => job.status === 'completed');
    const enabledAccounts = accounts.filter((a) => a.copilotEnabled !== false);
    const latestJob = jobs[0];
    const firstAccount = accounts[0];
    const firstAccountLogin =
      firstAccount?.login || firstAccount?.username || 'github';
    const browseFirstAccountAction = firstAccount
      ? `copilotBrowseRepos('${esc(firstAccount.id)}','${esc(firstAccountLogin)}')`
      : 'copilotAddAccount()';
    const handoffTone = loadIssues.length > 0 || !status.configured || enabledAccounts.length === 0
      ? 'attention'
      : failedJobs.length > 0
        ? 'attention'
        : activeJobs.length > 0
          ? 'active'
          : 'ready';
    const handoffTitle = loadIssues.length > 0
      ? 'Review Copilot data confidence before assigning code work'
      : !status.configured
      ? 'GitHub OAuth is not configured'
      : enabledAccounts.length === 0
        ? 'Connect a Copilot-enabled account'
        : failedJobs.length > 0
          ? 'Review failed handoffs before assigning more work'
          : activeJobs.length > 0
            ? 'Copilot is already working code issues'
            : 'Ready to hand off code work';
    const handoffDetail = loadIssues.length > 0
      ? `${loadIssues.length} Copilot feed${loadIssues.length === 1 ? '' : 's'} did not load. Check Monitoring, Git & Code, and Copilot credentials before assuming the Code queue is empty.`
      : !status.configured
      ? 'Add the GitHub OAuth credentials, then connect an account so Code can delegate repository work.'
      : enabledAccounts.length === 0
        ? 'A connected account needs Copilot access before NanoCrab can assign issues from this workspace.'
        : failedJobs.length > 0
          ? 'Open the job queue, inspect the failed issue, and decide whether to retry through Copilot or route it to Autofix.'
          : activeJobs.length > 0
            ? 'Keep an eye on active assignments and use Autofix for repository pipelines that need a fuller build or PR loop.'
            : 'Browse a repo, choose an issue, and assign Copilot when the task is clearly Code-focused.';
    window._copilotHandoffState = {
      status,
      accounts,
      jobs,
      loadIssues,
      handoff: {
        tone: handoffTone,
        title: handoffTitle,
        detail: handoffDetail,
      },
    };
    const accountCards = accounts
      .map((a) => {
        const login = a.login || a.username || 'github';
        const name = a.name || login;
        return `
      <div class="copilot-account-row">
        <div class="copilot-account-main">
          ${
            a.avatarUrl
              ? `<img src="${esc(a.avatarUrl)}" alt="${esc(login)} avatar">`
              : `<span class="copilot-account-avatar">${esc(login.slice(0, 2).toUpperCase())}</span>`
          }
          <div>
            <strong>${esc(name)}</strong> <span>@${esc(login)}</span>
            <div class="copilot-meta-row">
              ${a.copilotEnabled === false ? '<span class="badge badge-warning">No Copilot</span>' : '<span class="badge badge-success">Copilot ready</span>'}
              <small>${esc(a.scopes?.join(', ') || 'repo access')}</small>
            </div>
          </div>
        </div>
        <div class="copilot-row-actions">
          <button class="btn btn-sm btn-ghost" onclick="copilotRefreshAccount('${esc(a.id)}')" title="Refresh">Refresh</button>
          <button class="btn btn-sm btn-ghost" onclick="copilotBrowseRepos('${esc(a.id)}','${esc(login)}')" title="Browse repos">Repos</button>
          <button class="btn btn-sm btn-ghost copilot-remove-action" onclick="copilotRemoveAccount('${esc(a.id)}',this)">Remove</button>
        </div>
      </div>`;
      })
      .join('');

    const jobRows = jobs.map((j) => {
      const statusBadge = copilotStatusBadge(j.status);
      const tone = copilotJobTone(j.status);
      const issueNumber = Number(j.issueNumber || j.issue);
      const issueRef = Number.isFinite(issueNumber) ? `#${issueNumber}` : '';
      const issueTitle = j.issueTitle || j.title || '';
      return `<div class="copilot-job-row is-${tone}">
        <div class="copilot-job-main">
          <div>
            <strong>${esc(j.repo || 'Repository')}${issueRef ? ` ${esc(issueRef)}` : ''}</strong>
            ${issueTitle ? `<span>${esc(issueTitle)}</span>` : ''}
          </div>
          <small>${timeAgo(j.createdAt)}${j.prUrl ? ` · <a href="${esc(j.prUrl)}" target="_blank">View PR</a>` : ''}</small>
        </div>
        <div class="copilot-row-actions">
          <span class="badge ${statusBadge}">${esc(j.status)}</span>
        </div>
      </div>`;
    }).join('');
    const cockpitStats = [
      {
        label: 'Setup',
        value: status.configured ? 'Ready' : 'Needs setup',
        detail: status.message || 'GitHub OAuth status',
        tone: status.configured ? 'ready' : 'attention',
      },
      {
        label: 'Accounts',
        value: `${enabledAccounts.length}/${accounts.length}`,
        detail: 'Copilot-enabled GitHub accounts',
        tone: enabledAccounts.length > 0 ? 'ready' : 'attention',
      },
      {
        label: 'Active jobs',
        value: activeJobs.length,
        detail: 'Issues currently delegated',
        tone: activeJobs.length > 0 ? 'active' : 'muted',
      },
      {
        label: 'Needs review',
        value: failedJobs.length,
        detail: 'Failed jobs to inspect',
        tone: failedJobs.length > 0 ? 'attention' : 'ready',
      },
      {
        label: 'Data health',
        value: loadIssues.length,
        detail: loadIssues.length
          ? 'Feeds need review before assignment'
          : 'Copilot feeds loaded',
        tone: loadIssues.length ? 'attention' : 'ready',
      },
    ];

    el.innerHTML = `
      <div class="page-header code-page-header">
        <div>
          <h2>GitHub Copilot</h2>
          <p>Code-focused delegation for GitHub issues, PR follow-up, and repository work.</p>
        </div>
        <div class="copilot-header-actions">
          <button class="btn btn-sm btn-ghost" onclick="navigate('agents')">Agent cockpit</button>
          <button class="btn btn-sm btn-primary" onclick="copilotAddAccount()">Connect GitHub account</button>
        </div>
      </div>

      <section class="copilot-command-center">
        <div class="copilot-command-main">
          <div class="copilot-kicker">Code focus</div>
          <h3>${status.configured ? 'Delegate GitHub issues with confidence' : 'Connect GitHub before assigning code work'}</h3>
          <p>${status.configured ? 'Browse repositories, assign Copilot to issues, and watch delegated code work from the same queue as the rest of the Code workspace.' : 'Copilot needs a GitHub OAuth app and connected account before it can take issue work.'}</p>
          <div class="copilot-command-actions">
            <button class="btn btn-sm btn-primary" onclick="${browseFirstAccountAction}">${firstAccount ? 'Browse repos' : 'Connect account'}</button>
            <button class="btn btn-sm btn-ghost" onclick="copyCopilotHandoffBrief()">Copy handoff brief</button>
            <button class="btn btn-sm btn-ghost" onclick="navigate('autofix')">Autofix pipelines</button>
            <button class="btn btn-sm btn-ghost" onclick="navigate('gitcode')">Git & Code</button>
          </div>
        </div>
        <div class="copilot-command-stats">
          ${cockpitStats
            .map(
              (stat) => `<div class="copilot-command-stat is-${stat.tone}">
                <span>${esc(stat.label)}</span>
                <strong>${esc(String(stat.value))}</strong>
                <small>${esc(stat.detail)}</small>
              </div>`,
            )
            .join('')}
        </div>
      </section>

      <section class="copilot-handoff-brief is-${handoffTone}">
        <div>
          <span>Handoff readiness</span>
          <strong>${esc(handoffTitle)}</strong>
          <p>${esc(handoffDetail)}</p>
        </div>
        <div class="copilot-handoff-actions">
          <button class="btn btn-sm btn-primary" onclick="${browseFirstAccountAction}">${firstAccount ? 'Choose issue' : 'Connect GitHub'}</button>
          <button class="btn btn-sm btn-ghost" onclick="navigate('autofix')">Escalate to Autofix</button>
          <button class="btn btn-sm btn-ghost" onclick="navigate('approvals')">Approval queue</button>
        </div>
      </section>

      ${renderCopilotHandoffFit()}

      <section class="copilot-work-queue">
        <div class="copilot-work-item is-${failedJobs.length > 0 ? 'attention' : activeJobs.length > 0 ? 'active' : 'ready'}">
          <span>${failedJobs.length > 0 ? 'Review failed code work' : activeJobs.length > 0 ? 'Code work in progress' : 'Ready for the next issue'}</span>
          <strong>${latestJob ? esc(latestJob.repo || 'Repository') : 'No recent job'}</strong>
          <small>${latestJob ? esc(latestJob.issueTitle || latestJob.title || latestJob.status || 'Recently delegated') : 'Browse a repo and assign an open issue when you want Copilot to work.'}</small>
        </div>
        <div class="copilot-work-item">
          <span>Throughput</span>
          <strong>${completedJobs.length} completed</strong>
          <small>${jobs.length} total job${jobs.length === 1 ? '' : 's'} tracked in this workspace</small>
        </div>
      </section>

      ${!status.configured ? `<div class="card copilot-setup-card">
        <div class="card-title">Setup Required</div>
        <p>To use GitHub Copilot, create a GitHub OAuth App:</p>
        <ol>
          <li>Go to GitHub > Settings > Developer Settings > OAuth Apps > New OAuth App</li>
          <li>Set the callback URL to: <code>${window.location.origin}/api/copilot/oauth/callback</code></li>
          <li>Add the Client ID and Secret to Credentials as <code>GITHUB_OAUTH_CLIENT_ID</code> and <code>GITHUB_OAUTH_CLIENT_SECRET</code></li>
        </ol>
      </div>` : ''}

      <div class="card copilot-section-card">
        <div class="card-title">Connected Accounts <span class="badge badge-muted copilot-count-badge">${accounts.length}</span></div>
        ${accounts.length === 0 ? renderCopilotEmptyState('accounts') : accountCards}
      </div>

      <div id="copilot-repos" class="copilot-picker-slot is-hidden"></div>
      <div id="copilot-issues" class="copilot-picker-slot is-hidden"></div>

      <div class="card">
        <div class="card-title">Copilot Jobs <span class="badge badge-muted copilot-count-badge">${jobs.length}</span></div>
        ${jobs.length === 0 ? renderCopilotEmptyState('jobs', { firstAccount, firstAccountLogin }) : jobRows}
      </div>
    `;
  } catch (e) {
    el.innerHTML = renderCopilotRecoveryState('load', e.message);
  }
}

window.copyCopilotHandoffBrief = async function () {
  const state = window._copilotHandoffState;
  if (!state) {
    toast('Open Copilot first', 'warning');
    return;
  }
  const text = copilotHandoffBriefText(state);
  await copyTextWithFallback(
    text,
    'Copilot handoff brief copied',
    'Copy Copilot handoff brief',
  );
};

window.copyCopilotIssueBrief = async function (issueNumber) {
  const state = window._copilotIssuePickerState;
  const issue = state?.issues?.find(
    (candidate) => Number(candidate.number) === Number(issueNumber),
  );
  if (!state || !issue) {
    toast('Open a Copilot issue picker first', 'warning');
    return;
  }
  await copyTextWithFallback(
    copilotIssueHandoffPromptText(state, issue),
    'Copilot issue brief copied',
    'Copy Copilot issue brief',
  );
};

window.copilotAddAccount = async function () {
  try {
    const data = await api('/copilot/oauth/url');
    if (data.error) { toast(data.error, 'error'); return; }
    window.open(data.url, '_blank');
    toast('Complete the GitHub login in the new tab', 'info');
  } catch (e) {
    toast(copilotActionErrorMessage('oauth', e), 'error');
  }
};

window.copilotRemoveAccount = function (id, btnEl) {
  inlineConfirm(btnEl, 'Remove this account?', async () => {
    try {
      await api('/copilot/accounts/' + id, { method: 'DELETE' });
      toast('Account removed', 'success');
      navigate('copilot');
    } catch (e) { toast(copilotActionErrorMessage('remove-account', e), 'error'); }
  });
};

window.copilotRefreshAccount = async function (id) {
  try {
    const r = await api('/copilot/accounts/' + id + '/refresh', { method: 'POST' });
    if (r.ok) toast('Refreshed: ' + r.login + (r.copilotEnabled ? ' (Copilot active)' : ' (no Copilot)'), 'success');
    else toast(r.error, 'error');
    navigate('copilot');
  } catch (e) { toast(copilotActionErrorMessage('refresh-account', e), 'error'); }
};

window.hideCopilotPicker = function (id) {
  document.getElementById(id)?.classList.add('is-hidden');
};

window.copilotBrowseRepos = async function (accountId, login) {
  const container = document.getElementById('copilot-repos');
  if (!container) return;
  container.classList.remove('is-hidden');
  container.innerHTML = renderCopilotLoadingState('repos');
  try {
    const repos = await api('/copilot/repos/' + accountId);
    container.innerHTML = `<section class="copilot-picker-panel">
      <div class="copilot-picker-head">
        <div>
          <span>Repository picker</span>
          <strong>Repos for @${esc(login)}</strong>
          <small>Choose the repository whose open issues are ready for Code delegation.</small>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="hideCopilotPicker('copilot-repos')" title="Close repository picker">\u2715</button>
      </div>
      <div class="copilot-picker-list">
      ${repos.length === 0 ? '<div class="copilot-picker-empty">No repositories returned for this account.</div>' : repos.map((r) => {
        const owner = r.owner || r.fullName?.split('/')[0] || '';
        const name = r.name || r.repo || r.fullName?.split('/')[1] || '';
        const fullName = r.fullName || [owner, name].filter(Boolean).join('/');
        const openIssues = Number.isFinite(Number(r.openIssues))
          ? Number(r.openIssues)
          : Number.isFinite(Number(r.issueCount))
            ? Number(r.issueCount)
            : 0;
        return `<div class="copilot-picker-row">
        <div class="copilot-picker-main">
          <strong>${esc(fullName || 'Repository')}</strong>
          <div class="copilot-picker-meta">
            ${r.private ? '<span class="badge badge-muted">Private</span>' : '<span class="badge badge-muted">Public</span>'}
            <small>${openIssues} open issue${openIssues === 1 ? '' : 's'}</small>
          </div>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="copilotBrowseIssues('${esc(accountId)}','${esc(owner)}','${esc(name)}')">Issues</button>
      </div>`;
      }).join('')}
      </div>
    </section>`;
  } catch (e) {
    container.innerHTML = renderCopilotRecoveryState('repos', e.message, {
      retryAction: `copilotBrowseRepos('${esc(accountId)}','${esc(login)}')`,
    });
  }
};

window.copilotBrowseIssues = async function (accountId, owner, repo) {
  const container = document.getElementById('copilot-issues');
  if (!container) return;
  container.classList.remove('is-hidden');
  container.innerHTML = renderCopilotLoadingState('issues');
  try {
    const issues = await api(`/copilot/issues/${accountId}/${owner}/${repo}`);
    window._copilotIssuePickerState = { accountId, owner, repo, issues };
    const openIssueCount = issues.filter((i) => !i.copilotAssigned).length;
    container.innerHTML = `<section class="copilot-picker-panel">
      <div class="copilot-picker-head">
        <div>
          <span>Issue picker</span>
          <strong>${esc(owner)}/${esc(repo)}</strong>
          <small>${openIssueCount} issue${openIssueCount === 1 ? '' : 's'} ready for assignment</small>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="hideCopilotPicker('copilot-issues')" title="Close issue picker">\u2715</button>
      </div>
      <div class="copilot-picker-list">
      ${issues.length === 0 ? '<div class="copilot-picker-empty">No open issues returned for this repository.</div>' : issues.map(i => `<div class="copilot-picker-row ${i.copilotAssigned ? 'is-muted' : ''}">
        <div class="copilot-picker-main">
          <strong>#${i.number} ${esc(i.title)}</strong>
          <div class="copilot-picker-meta">
            ${(i.labels || []).map(l => `<span class="badge badge-muted">${esc(l)}</span>`).join('')}
            ${i.copilotAssigned ? '<span class="badge badge-success">Copilot assigned</span>' : '<small>Ready for assignment</small>'}
          </div>
        </div>
        <div class="copilot-picker-actions">
          <button class="btn btn-sm btn-ghost" onclick="copyCopilotIssueBrief(${i.number})">Copy issue brief</button>
          ${i.copilotAssigned ? '<span class="badge badge-success copilot-count-badge">Assigned</span>' : `<button class="btn btn-sm btn-primary" onclick="copilotAssign('${esc(accountId)}','${esc(owner)}','${esc(repo)}',${i.number},this)">Assign Copilot</button>`}
        </div>
      </div>`).join('')}
      </div>
    </section>`;
  } catch (e) {
    container.innerHTML = renderCopilotRecoveryState('issues', e.message, {
      retryAction: `copilotBrowseIssues('${esc(accountId)}','${esc(owner)}','${esc(repo)}')`,
    });
  }
};

window.copilotAssign = async function (accountId, owner, repo, issueNumber, btn) {
  btn.disabled = true;
  btn.textContent = 'Assigning...';
  try {
    const r = await api('/copilot/assign', {
      method: 'POST',
      body: JSON.stringify({ accountId, owner, repo, issueNumber }),
    });
    if (r.ok) {
      toast('Copilot assigned to #' + issueNumber, 'success');
      btn.outerHTML = '<span class="badge badge-success copilot-count-badge">Assigned</span>';
      navigate('copilot');
    } else {
      toast(r.error || 'Could not assign GitHub Copilot. Confirm the issue is open and the account has Copilot access.', 'error');
      btn.disabled = false;
      btn.textContent = 'Assign Copilot';
    }
  } catch (e) {
    toast(copilotActionErrorMessage('assign', e), 'error');
    btn.disabled = false;
    btn.textContent = 'Assign Copilot';
  }
};
