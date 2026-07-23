// NanoCrab Admin — GitHub Issues & PRs Page

window.renderGitHubViews = async function (el) {
  el.innerHTML = `<div class="page-header"><h2>GitHub</h2></div>
    <div id="ghv-content">${renderShellLoadingState('Loading GitHub', 'Fetching repos, issues, and pull requests.')}</div>`;

  const content = document.getElementById('ghv-content');
  let repos = [];
  let selectedRepo = '';
  let activeTab = 'issues';

  try {
    repos = await api('/github-views/repos');
    if (repos.length > 0) selectedRepo = repos[0].fullName;
  } catch (e) {
    content.innerHTML = `<div class="card"><p>Could not load coding repos: ${esc(e.message || e)}</p></div>`;
    return;
  }

  function renderRepoSelector() {
    return `<select id="ghv-repo-select" onchange="window._ghvRepoChange(this.value)">
      ${repos.map((r) => `<option value="${esc(r.fullName)}" ${r.fullName === selectedRepo ? 'selected' : ''}>${esc(r.fullName)}${r.enabled ? '' : ' (disabled)'}</option>`).join('')}
    </select>`;
  }

  function renderTabs() {
    return `<div class="ghv-tabs">
      <button class="btn btn-sm ${activeTab === 'issues' ? 'btn-primary' : 'btn-ghost'}" onclick="window._ghvTab('issues')">Issues</button>
      <button class="btn btn-sm ${activeTab === 'pulls' ? 'btn-primary' : 'btn-ghost'}" onclick="window._ghvTab('pulls')">Pull Requests</button>
    </div>`;
  }

  function renderShell() {
    content.innerHTML = `
      <div class="ghv-toolbar">
        ${renderRepoSelector()}
        ${renderTabs()}
      </div>
      <div id="ghv-list">${renderShellLoadingState()}</div>
      <div id="ghv-detail" class="is-hidden"></div>`;
    loadList();
  }

  async function loadList() {
    const listEl = document.getElementById('ghv-list');
    if (!listEl) return;
    listEl.innerHTML = renderShellLoadingState();
    try {
      if (activeTab === 'issues') {
        const issues = await api(`/github-views/issues?repo=${encodeURIComponent(selectedRepo)}&limit=50`);
        listEl.innerHTML = renderIssueList(issues);
      } else {
        const prs = await api(`/github-views/pulls?repo=${encodeURIComponent(selectedRepo)}&state=all&limit=50`);
        listEl.innerHTML = renderPRList(prs);
      }
    } catch (e) {
      listEl.innerHTML = `<div class="card"><p>Could not load ${activeTab}: ${esc(e.message || e)}</p></div>`;
    }
  }

  function renderIssueList(issues) {
    if (!issues.length) return '<div class="card"><p>No open issues found.</p></div>';
    return `<div class="ghv-list">
      ${issues.map((issue) => `
        <div class="ghv-item card" onclick="window._ghvIssueDetail(${issue.number})">
          <div class="ghv-item-head">
            <span class="badge badge-info">#${issue.number}</span>
            <strong>${esc(issue.title)}</strong>
          </div>
          <div class="ghv-item-meta">
            ${issue.labels.map((l) => `<span class="badge badge-muted">${esc(l)}</span>`).join('')}
            ${issue.assignees.length ? `<span>Assigned: ${esc(issue.assignees.join(', '))}</span>` : ''}
            ${issue.milestone ? `<span>Milestone: ${esc(issue.milestone)}</span>` : ''}
            <span>by ${esc(issue.author)}</span>
            <span>Updated ${timeAgo(issue.updatedAt)}</span>
          </div>
        </div>`).join('')}
    </div>`;
  }

  function renderPRList(prs) {
    if (!prs.length) return '<div class="card"><p>No pull requests found.</p></div>';
    return `<div class="ghv-list">
      ${prs.map((pr) => {
        const stateBadge = pr.merged ? 'badge-success' : pr.state === 'open' ? 'badge-info' : 'badge-muted';
        const stateLabel = pr.merged ? 'merged' : pr.state;
        return `
        <div class="ghv-item card" onclick="window._ghvPRDetail(${pr.number})">
          <div class="ghv-item-head">
            <span class="badge ${stateBadge}">${esc(stateLabel)}</span>
            <span class="badge badge-muted">#${pr.number}</span>
            ${pr.draft ? '<span class="badge badge-warning">draft</span>' : ''}
            <strong>${esc(pr.title)}</strong>
          </div>
          <div class="ghv-item-meta">
            <span>${esc(pr.headBranch)} → ${esc(pr.baseBranch)}</span>
            <span>by ${esc(pr.author)}</span>
            <span>+${pr.additions} -${pr.deletions}</span>
            <span>Updated ${timeAgo(pr.updatedAt)}</span>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  window._ghvRepoChange = function (repo) {
    selectedRepo = repo;
    loadList();
  };

  window._ghvTab = function (tab) {
    activeTab = tab;
    renderShell();
  };

  window._ghvIssueDetail = async function (number) {
    const detailEl = document.getElementById('ghv-detail');
    const listEl = document.getElementById('ghv-list');
    if (!detailEl) return;
    detailEl.classList.remove('is-hidden');
    if (listEl) listEl.classList.add('is-hidden');
    detailEl.innerHTML = renderShellLoadingState('Loading issue', `Fetching #${number} details.`);
    try {
      const issue = await api(`/github-views/issues/${number}?repo=${encodeURIComponent(selectedRepo)}`);
      detailEl.innerHTML = `
        <div class="card ghv-detail">
          <div class="ghv-detail-head">
            <button class="btn btn-sm btn-ghost" onclick="window._ghvBack()">← Back</button>
            <a href="${esc(issue.htmlUrl)}" target="_blank" class="btn btn-sm btn-ghost">Open on GitHub</a>
            <button class="btn btn-sm btn-primary" onclick="window._ghvStartCodingJob(${issue.number})">Start Coding Job</button>
          </div>
          <h3>#${issue.number} ${esc(issue.title)}</h3>
          <div class="ghv-item-meta">
            <span class="badge ${issue.state === 'open' ? 'badge-info' : 'badge-muted'}">${esc(issue.state)}</span>
            ${issue.labels.map((l) => `<span class="badge badge-muted">${esc(l)}</span>`).join('')}
            <span>by ${esc(issue.author)}</span>
            <span>${issue.comments} comments</span>
            ${issue.milestone ? `<span>Milestone: ${esc(issue.milestone)}</span>` : ''}
          </div>
          <div class="ghv-detail-body"><pre>${esc(issue.body || '(no description)')}</pre></div>
          ${issue.linkedPRs.length ? `
            <h4>Linked Pull Requests</h4>
            <ul>${issue.linkedPRs.map((pr) => `<li><a href="${esc(pr.htmlUrl)}" target="_blank">#${pr.number} ${esc(pr.title)}</a> <span class="badge badge-muted">${esc(pr.state)}</span></li>`).join('')}</ul>` : ''}
          ${issue.linkedCodingJobs.length ? `
            <h4>Linked Coding Jobs</h4>
            <ul>${issue.linkedCodingJobs.map((job) => `<li><code>${esc(job.id)}</code> <span class="badge badge-muted">${esc(job.status)}</span> ${job.prUrl ? `<a href="${esc(job.prUrl)}" target="_blank">PR</a>` : ''}</li>`).join('')}</ul>` : ''}
        </div>`;
    } catch (e) {
      detailEl.innerHTML = `<div class="card"><p>Could not load issue: ${esc(e.message || e)}</p><button class="btn btn-sm btn-ghost" onclick="window._ghvBack()">← Back</button></div>`;
    }
  };

  window._ghvPRDetail = async function (number) {
    const detailEl = document.getElementById('ghv-detail');
    const listEl = document.getElementById('ghv-list');
    if (!detailEl) return;
    detailEl.classList.remove('is-hidden');
    if (listEl) listEl.classList.add('is-hidden');
    detailEl.innerHTML = renderShellLoadingState('Loading PR', `Fetching #${number} details.`);
    try {
      const pr = await api(`/github-views/pulls/${number}?repo=${encodeURIComponent(selectedRepo)}`);
      const ciBadge = pr.ciStatus === 'success' ? 'badge-success' : pr.ciStatus === 'failure' ? 'badge-error' : pr.ciStatus === 'pending' ? 'badge-warning' : 'badge-muted';
      detailEl.innerHTML = `
        <div class="card ghv-detail">
          <div class="ghv-detail-head">
            <button class="btn btn-sm btn-ghost" onclick="window._ghvBack()">← Back</button>
            <a href="${esc(pr.htmlUrl)}" target="_blank" class="btn btn-sm btn-ghost">Open on GitHub</a>
          </div>
          <h3>#${pr.number} ${esc(pr.title)}</h3>
          <div class="ghv-item-meta">
            <span class="badge ${pr.merged ? 'badge-success' : pr.state === 'open' ? 'badge-info' : 'badge-muted'}">${pr.merged ? 'merged' : esc(pr.state)}</span>
            ${pr.draft ? '<span class="badge badge-warning">draft</span>' : ''}
            <span class="badge ${ciBadge}">CI: ${esc(pr.ciStatus)}</span>
            <span>Review: ${esc(pr.reviewStatus)}</span>
            <span>${esc(pr.headBranch)} → ${esc(pr.baseBranch)}</span>
            <span>by ${esc(pr.author)}</span>
            <span>+${pr.additions} -${pr.deletions} in ${pr.changedFiles} files</span>
          </div>
          <div class="ghv-detail-body"><pre>${esc(pr.body || '(no description)')}</pre></div>
          ${pr.changedFileList && pr.changedFileList.length ? `
            <h4>Changed Files (${pr.changedFileList.length})</h4>
            <ul class="ghv-file-list">${pr.changedFileList.map((f) => `<li><code>${esc(f.filename)}</code> <span class="badge badge-muted">${esc(f.status)}</span> +${f.additions} -${f.deletions}</li>`).join('')}</ul>` : ''}
          ${pr.linkedCodingJobs && pr.linkedCodingJobs.length ? `
            <h4>Linked Coding Jobs</h4>
            <ul>${pr.linkedCodingJobs.map((job) => `<li><code>${esc(job.id)}</code> <span class="badge badge-muted">${esc(job.status)}</span></li>`).join('')}</ul>` : ''}
        </div>`;
    } catch (e) {
      detailEl.innerHTML = `<div class="card"><p>Could not load PR: ${esc(e.message || e)}</p><button class="btn btn-sm btn-ghost" onclick="window._ghvBack()">← Back</button></div>`;
    }
  };

  window._ghvBack = function () {
    const detailEl = document.getElementById('ghv-detail');
    const listEl = document.getElementById('ghv-list');
    if (detailEl) detailEl.classList.add('is-hidden');
    if (listEl) listEl.classList.remove('is-hidden');
  };

  window._ghvStartCodingJob = async function (issueNumber) {
    try {
      const r = await api('/agents/coding/jobs', {
        method: 'POST',
        body: JSON.stringify({
          repo: selectedRepo,
          issueNumber,
          createPr: true,
        }),
      });
      if (r.ok !== false) {
        toast(`Started coding job for #${issueNumber}`, 'success');
      } else {
        toast(r.error || 'Could not start coding job', 'error');
      }
    } catch (e) {
      toast('Could not start coding job: ' + (e.message || e), 'error');
    }
  };

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  renderShell();
};
