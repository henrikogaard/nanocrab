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

async function renderAutofix(el) {
  el.innerHTML = '<div class="loading">Loading autofix</div>';
  try {
    const [projects, jobs, groups] = await Promise.all([
      api('/autofix/projects').catch(() => []),
      api('/autofix/jobs').catch(() => []),
      api('/groups').catch(() => []),
    ]);

    const groupOpts = (Array.isArray(groups) ? groups : [])
      .map((g) => {
        const ch = g.channel || 'unknown';
        return `<option value="${esc(g.jid)}">${esc(ch)} (${esc(g.name)})</option>`;
      })
      .join('');

    const projectCards = projects
      .map(
        (p) => `
      <div class="channel-card" style="padding:10px 0">
        <div style="flex:1">
          <strong>${esc(p.owner)}/${esc(p.repo)}</strong>
          <span class="badge badge-muted" style="font-size:9px;margin-left:6px">label: ${esc(p.triggerLabel)}</span>
          <span class="badge badge-muted" style="font-size:9px;margin-left:4px">${esc(p.model)}</span>
          ${p.autoReview ? '<span class="badge badge-success" style="font-size:9px;margin-left:4px">Auto-review</span>' : ''}
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(p.workDir)}</div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm btn-primary" onclick="autofixPickIssue('${esc(p.id)}','${esc(p.owner)}','${esc(p.repo)}','${esc(p.triggerLabel)}')">Fix Issue</button>
          <button class="btn btn-sm btn-ghost" onclick="autofixDeleteProject('${esc(p.id)}',this)" style="color:var(--error)">Remove</button>
        </div>
      </div>
    `,
      )
      .join('');

    const jobRows = jobs
      .map((j) => {
        const sc = autofixStatusBadge(j.status);
        return `<div class="channel-card" style="padding:8px 0">
        <div style="flex:1;min-width:0">
          <strong>${esc(j.repo)}#${j.issueNumber}</strong>
          <span style="font-size:12px;color:var(--text-muted);margin-left:8px">${esc((j.issueTitle || '').slice(0, 60))}</span>
          ${j.prUrl ? `<a href="${esc(j.prUrl)}" target="_blank" style="font-size:11px;color:var(--accent);margin-left:8px">View PR</a>` : ''}
          <div style="font-size:10px;color:var(--text-muted)">${esc(j.provider || 'claude')}/${esc(j.model || '')} \u2022 ${timeAgo(j.startedAt || j.createdAt)} \u2022 ${esc(j.branch || '')}</div>
        </div>
        <div style="display:flex;gap:4px;align-items:center">
          <span class="badge ${sc}" style="font-size:10px">${j.status}</span>
          <button class="btn btn-sm btn-ghost" onclick="viewAutofixJob('${esc(j.id)}')">Review</button>
        </div>
      </div>`;
      })
      .join('');

    el.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h2>GitHub Autofix</h2>
        <button class="btn btn-sm btn-primary" onclick="document.getElementById('autofix-add-form').style.display=document.getElementById('autofix-add-form').style.display==='none'?'block':'none'">Add Project</button>
      </div>

      <div class="card" style="margin-bottom:16px;border-left:3px solid var(--accent);padding:12px 16px;font-size:12px;color:var(--text-muted)">
        Label an issue with <strong>${projects[0]?.triggerLabel || 'autofix'}</strong> to trigger Claude Code automatically. Or click "Fix Issue" to pick one manually.
      </div>

      <div id="autofix-add-form" class="card" style="display:none;margin-bottom:16px">
        <div class="card-title">Add Project</div>
        <div class="grid grid-2">
          <div class="form-group"><label>Owner</label><input class="search-input" id="af-owner" placeholder="owner" style="width:100%"></div>
          <div class="form-group"><label>Repo</label><input class="search-input" id="af-repo" placeholder="nanocrab" style="width:100%"></div>
        </div>
        <div class="grid grid-2">
          <div class="form-group"><label>Trigger label</label><input class="search-input" id="af-label" value="autofix" style="width:100%"></div>
          <div class="form-group"><label>Model</label>
            <select class="search-input" id="af-model" style="width:100%">
              <option value="sonnet">Sonnet 4.6 (fast)</option>
              <option value="opus">Opus 4.6 (powerful)</option>
              <option value="haiku">Haiku 4.5 (cheapest)</option>
            </select>
          </div>
        </div>
        <div class="grid grid-2">
          <div class="form-group"><label>Working directory (auto-cloned if empty)</label><input class="search-input" id="af-workdir" placeholder="/home/user/repos/myrepo" style="width:100%"></div>
          <div class="form-group"><label>Notify channel</label>
            <select class="search-input" id="af-notify" style="width:100%">
              <option value="">None</option>
              ${groupOpts}
            </select>
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted);margin-bottom:12px">
          <input type="checkbox" id="af-autoreview"> Auto-review new PRs with Claude
        </label>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" onclick="autofixAddProject()">Add Project</button>
          <button class="btn btn-ghost" onclick="document.getElementById('autofix-add-form').style.display='none'">Cancel</button>
        </div>
      </div>

      <div id="autofix-issue-picker" style="display:none;margin-bottom:16px"></div>
      <div id="autofix-job-output" style="display:none;margin-bottom:16px"></div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Projects <span class="badge badge-muted" style="font-size:10px">${projects.length}</span></div>
        ${projects.length === 0 ? '<div class="empty">No projects registered. Add one to get started.</div>' : projectCards}
      </div>

      ${
        jobs.length > 0
          ? `<div class="card">
        <div class="card-title">Recent Jobs <span class="badge badge-muted" style="font-size:10px">${jobs.length}</span></div>
        ${jobRows}
      </div>`
          : ''
      }
    `;
  } catch (e) {
    el.innerHTML = `<div class="card empty">Failed to load: ${esc(e.message)}</div>`;
  }
}

window.autofixAddProject = async function () {
  const owner = document.getElementById('af-owner').value.trim();
  const repo = document.getElementById('af-repo').value.trim();
  const triggerLabel =
    document.getElementById('af-label').value.trim() || 'autofix';
  const model = document.getElementById('af-model').value;
  const workDir = document.getElementById('af-workdir').value.trim();
  const notifyJid = document.getElementById('af-notify').value;
  const autoReview = document.getElementById('af-autoreview').checked;
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
        model,
        workDir,
        notifyJid,
        autoReview,
      }),
    });
    if (r.ok) {
      toast('Project added', 'success');
      navigate('autofix');
    } else toast(r.error || 'Failed', 'error');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.autofixDeleteProject = function (id, btn) {
  inlineConfirm(btn, 'Remove?', async () => {
    try {
      await api('/autofix/projects/' + id, { method: 'DELETE' });
      toast('Removed', 'success');
      navigate('autofix');
    } catch (e) {
      toast('Failed: ' + e.message, 'error');
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
  picker.style.display = 'block';
  const fullRepo = `${owner}/${repo}`;
  picker.innerHTML = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div class="card-title">Pick an issue — ${esc(fullRepo)}</div>
      <button class="btn btn-sm btn-ghost" onclick="document.getElementById('autofix-issue-picker').style.display='none'">\u2715</button>
    </div>
    <div class="autofix-filter-grid">
      <input class="search-input" id="af-filter-number" placeholder="Issue #">
      <input class="search-input" id="af-filter-labels" value="${esc(triggerLabel || 'autofix')}" placeholder="labels, comma-separated">
      <input class="search-input" id="af-filter-assignee" placeholder="assignee">
      <input class="search-input" id="af-filter-milestone" placeholder="milestone">
      <button class="btn btn-sm btn-primary" onclick="autofixLoadIssues('${esc(projectId)}','${esc(owner)}','${esc(repo)}')">Search</button>
    </div>
    <div id="autofix-issue-results" style="margin-top:12px"><div class="loading">Loading issues...</div></div>
  </div>`;
  await autofixLoadIssues(projectId, owner, repo);
};

window.autofixLoadIssues = async function (projectId, owner, repo) {
  const results = document.getElementById('autofix-issue-results');
  if (!results) return;
  results.innerHTML = '<div class="loading">Loading issues...</div>';
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
      results.innerHTML =
        '<div class="empty">No matching open issues found.</div>';
      return;
    }
    results.innerHTML = `
      ${issues
        .map(
          (i) => `<div class="channel-card" style="padding:6px 0">
        <div style="flex:1">
          <strong>#${i.number}</strong> ${esc(i.title)}
          ${(i.labels || []).map((l) => `<span class="badge badge-muted" style="font-size:9px">${esc(l)}</span>`).join(' ')}
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${esc((i.assignees || []).join(', ') || 'unassigned')}${i.milestone ? ` \u2022 ${esc(i.milestone)}` : ''}</div>
        </div>
        <button class="btn btn-sm btn-primary" onclick="autofixRun('${esc(projectId)}',${i.number},this)">Fix</button>
      </div>`,
        )
        .join('')}`;
  } catch (e) {
    results.innerHTML = `<div class="empty">Failed: ${esc(e.message)}</div>`;
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
        '<span class="badge badge-warning" style="font-size:10px">Running</span>';
      document.getElementById('autofix-issue-picker').style.display = 'none';
      // Show output
      setTimeout(() => viewAutofixJob(r.jobId), 2000);
    } else {
      toast(r.error || 'Failed', 'error');
      btn.disabled = false;
      btn.textContent = 'Fix';
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Fix';
  }
};

window.viewAutofixJob = async function (id) {
  const panel = document.getElementById('autofix-job-output');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML =
    '<div class="card"><div class="loading">Loading...</div></div>';
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
        ? `<button class="btn btn-sm btn-primary" onclick="autofixJobAction('${esc(id)}','approve-implementation')">Approve implementation</button>`
        : '',
      job.status === 'await_approval'
        ? `<button class="btn btn-sm btn-ghost" onclick="autofixDenyImplementation('${esc(id)}')">Deny implementation</button>`
        : '',
      job.status === 'await_pr_approval'
        ? `<button class="btn btn-sm btn-primary" onclick="autofixJobAction('${esc(id)}','approve-pr')">Approve PR</button>`
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
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div>
          <strong>${esc(job.repo)}#${job.issueNumber}</strong> \u2014 ${esc(job.issueTitle)}
          <span class="badge ${sc}" style="font-size:10px;margin-left:8px">${job.status}</span>
          ${job.prUrl ? `<a href="${esc(job.prUrl)}" target="_blank" style="font-size:12px;color:var(--accent);margin-left:8px">View PR</a>` : ''}
        </div>
        <div style="display:flex;gap:6px">
          ${actions}
          ${['queued', 'investigate', 'plan', 'implement', 'test', 'open_pr', 'ci_running'].includes(job.status) ? `<button class="btn btn-sm btn-ghost" onclick="viewAutofixJob('${id}')">Refresh</button>` : ''}
          <button class="btn btn-sm btn-ghost" onclick="document.getElementById('autofix-job-output').style.display='none'">\u2715</button>
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
          document.getElementById('autofix-job-output')?.style.display !==
          'none'
        )
          viewAutofixJob(id);
      }, 5000);
    }
  } catch (e) {
    panel.innerHTML = `<div class="card empty">Failed: ${esc(e.message)}</div>`;
  }
};

window.autofixJobAction = async function (id, action) {
  try {
    const r = await api(`/autofix/jobs/${id}/${action}`, { method: 'POST' });
    if (!r.ok) {
      toast(r.error || 'Action failed', 'error');
      return;
    }
    toast('Job updated', 'success');
    await viewAutofixJob(id);
    setTimeout(() => {
      if (currentPage === 'autofix') navigate('autofix');
    }, 800);
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.autofixDenyImplementation = function (id) {
  const note =
    prompt('Reason for denying implementation?') ||
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
      toast(r.error || 'Action failed', 'error');
      return;
    }
    toast('Job updated', 'success');
    await viewAutofixJob(id);
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}
