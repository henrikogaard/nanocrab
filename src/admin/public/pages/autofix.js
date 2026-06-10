// NanoCrab Admin — Autofix Page

// --- GitHub Autofix ---

async function renderAutofix(el) {
  el.innerHTML = '<div class="loading">Loading autofix</div>';
  try {
    const [projects, jobs, groups] = await Promise.all([
      api('/autofix/projects').catch(() => []),
      api('/autofix/jobs').catch(() => []),
      api('/groups').catch(() => []),
    ]);

    const groupOpts = (Array.isArray(groups) ? groups : []).map(g => {
      const ch = g.channel || 'unknown';
      return `<option value="${esc(g.jid)}">${esc(ch)} (${esc(g.name)})</option>`;
    }).join('');

    const projectCards = projects.map(p => `
      <div class="channel-card" style="padding:10px 0">
        <div style="flex:1">
          <strong>${esc(p.owner)}/${esc(p.repo)}</strong>
          <span class="badge badge-muted" style="font-size:9px;margin-left:6px">label: ${esc(p.triggerLabel)}</span>
          <span class="badge badge-muted" style="font-size:9px;margin-left:4px">${esc(p.model)}</span>
          ${p.autoReview ? '<span class="badge badge-success" style="font-size:9px;margin-left:4px">Auto-review</span>' : ''}
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(p.workDir)}</div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm btn-primary" onclick="autofixPickIssue('${esc(p.id)}','${esc(p.owner)}','${esc(p.repo)}')">Fix Issue</button>
          <button class="btn btn-sm btn-ghost" onclick="autofixDeleteProject('${esc(p.id)}',this)" style="color:var(--error)">Remove</button>
        </div>
      </div>
    `).join('');

    const jobRows = jobs.map(j => {
      const sc = j.status === 'completed' ? 'badge-success' : j.status === 'running' ? 'badge-warning' : j.status === 'queued' ? 'badge-muted' : 'badge-error';
      return `<div class="channel-card" style="padding:8px 0">
        <div style="flex:1;min-width:0">
          <strong>${esc(j.repo)}#${j.issueNumber}</strong>
          <span style="font-size:12px;color:var(--text-muted);margin-left:8px">${esc(j.issueTitle.slice(0, 60))}</span>
          ${j.prUrl ? `<a href="${esc(j.prUrl)}" target="_blank" style="font-size:11px;color:var(--accent);margin-left:8px">View PR</a>` : ''}
          <div style="font-size:10px;color:var(--text-muted)">${esc(j.model)} \u2022 ${timeAgo(j.startedAt)}</div>
        </div>
        <div style="display:flex;gap:4px;align-items:center">
          <span class="badge ${sc}" style="font-size:10px">${j.status}</span>
          <button class="btn btn-sm btn-ghost" onclick="viewAutofixJob('${esc(j.id)}')">Log</button>
        </div>
      </div>`;
    }).join('');

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

      ${jobs.length > 0 ? `<div class="card">
        <div class="card-title">Recent Jobs <span class="badge badge-muted" style="font-size:10px">${jobs.length}</span></div>
        ${jobRows}
      </div>` : ''}
    `;
  } catch (e) {
    el.innerHTML = `<div class="card empty">Failed to load: ${esc(e.message)}</div>`;
  }
}

window.autofixAddProject = async function () {
  const owner = document.getElementById('af-owner').value.trim();
  const repo = document.getElementById('af-repo').value.trim();
  const triggerLabel = document.getElementById('af-label').value.trim() || 'autofix';
  const model = document.getElementById('af-model').value;
  const workDir = document.getElementById('af-workdir').value.trim();
  const notifyJid = document.getElementById('af-notify').value;
  const autoReview = document.getElementById('af-autoreview').checked;
  if (!owner || !repo) { toast('Owner and repo required', 'warning'); return; }
  try {
    const r = await api('/autofix/projects', { method: 'POST', body: JSON.stringify({ owner, repo, triggerLabel, model, workDir, notifyJid, autoReview }) });
    if (r.ok) { toast('Project added', 'success'); navigate('autofix'); }
    else toast(r.error || 'Failed', 'error');
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
};

window.autofixDeleteProject = function (id, btn) {
  inlineConfirm(btn, 'Remove?', async () => {
    try { await api('/autofix/projects/' + id, { method: 'DELETE' }); toast('Removed', 'success'); navigate('autofix'); }
    catch (e) { toast('Failed: ' + e.message, 'error'); }
  });
};

window.autofixPickIssue = async function (projectId, owner, repo) {
  const picker = document.getElementById('autofix-issue-picker');
  if (!picker) return;
  picker.style.display = 'block';
  picker.innerHTML = '<div class="card"><div class="loading">Loading issues...</div></div>';
  try {
    const issues = await api(`/copilot/issues/${projectId}/${owner}/${repo}`).catch(async () => {
      // Fallback: use GitHub API directly via autofix
      const token = ''; // Will use server-side token
      return [];
    });
    // If copilot plugin isn't available, try fetching via gh CLI
    if (!Array.isArray(issues) || issues.length === 0) {
      picker.innerHTML = '<div class="card empty">No open issues found. <button class="btn btn-sm btn-ghost" onclick="document.getElementById(\'autofix-issue-picker\').style.display=\'none\'">Close</button></div>';
      return;
    }
    picker.innerHTML = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="card-title">Pick an issue \u2014 ${esc(owner)}/${esc(repo)}</div>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('autofix-issue-picker').style.display='none'">\u2715</button>
      </div>
      ${issues.map(i => `<div class="channel-card" style="padding:6px 0">
        <div style="flex:1"><strong>#${i.number}</strong> ${esc(i.title)} ${i.labels.map(l => `<span class="badge badge-muted" style="font-size:9px">${esc(l)}</span>`).join(' ')}</div>
        <button class="btn btn-sm btn-primary" onclick="autofixRun('${esc(projectId)}',${i.number},this)">Fix</button>
      </div>`).join('')}
    </div>`;
  } catch (e) {
    picker.innerHTML = `<div class="card empty">Failed: ${esc(e.message)}</div>`;
  }
};

window.autofixRun = async function (projectId, issueNumber, btn) {
  btn.disabled = true; btn.textContent = 'Starting...';
  try {
    const r = await api('/autofix/run', { method: 'POST', body: JSON.stringify({ projectId, issueNumber }) });
    if (r.ok) {
      toast('Autofix started', 'success');
      btn.outerHTML = '<span class="badge badge-warning" style="font-size:10px">Running</span>';
      document.getElementById('autofix-issue-picker').style.display = 'none';
      // Show output
      setTimeout(() => viewAutofixJob(r.jobId), 2000);
    } else { toast(r.error || 'Failed', 'error'); btn.disabled = false; btn.textContent = 'Fix'; }
  } catch (e) { toast('Failed: ' + e.message, 'error'); btn.disabled = false; btn.textContent = 'Fix'; }
};

window.viewAutofixJob = async function (id) {
  const panel = document.getElementById('autofix-job-output');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = '<div class="card"><div class="loading">Loading...</div></div>';
  try {
    const job = await api('/autofix/jobs/' + id);
    const sc = job.status === 'completed' ? 'badge-success' : job.status === 'running' ? 'badge-warning' : 'badge-error';
    panel.innerHTML = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div>
          <strong>${esc(job.repo)}#${job.issueNumber}</strong> \u2014 ${esc(job.issueTitle)}
          <span class="badge ${sc}" style="font-size:10px;margin-left:8px">${job.status}</span>
          ${job.prUrl ? `<a href="${esc(job.prUrl)}" target="_blank" style="font-size:12px;color:var(--accent);margin-left:8px">View PR</a>` : ''}
        </div>
        <div style="display:flex;gap:6px">
          ${job.status === 'running' ? `<button class="btn btn-sm btn-ghost" onclick="viewAutofixJob('${id}')">Refresh</button>` : ''}
          <button class="btn btn-sm btn-ghost" onclick="document.getElementById('autofix-job-output').style.display='none'">\u2715</button>
        </div>
      </div>
      <pre style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;font-size:11px;max-height:400px;overflow:auto;white-space:pre-wrap;word-break:break-word;color:var(--text)">${esc(job.output || '(waiting for output...)')}</pre>
    </div>`;
    if (job.status === 'running') {
      setTimeout(() => { if (document.getElementById('autofix-job-output')?.style.display !== 'none') viewAutofixJob(id); }, 5000);
    }
  } catch (e) { panel.innerHTML = `<div class="card empty">Failed: ${esc(e.message)}</div>`; }
};
