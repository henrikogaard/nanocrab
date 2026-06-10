// NanoCrab Admin — Copilot Page

// --- GitHub Copilot ---

async function renderCopilot(el) {
  el.innerHTML = '<div class="loading">Loading Copilot</div>';
  try {
    const [status, accounts, jobs] = await Promise.all([
      api('/copilot/status'),
      api('/copilot/accounts').catch(() => []),
      api('/copilot/jobs').catch(() => []),
    ]);

    const accountCards = accounts.map(a => `
      <div class="channel-card" style="padding:10px 0">
        <div style="display:flex;align-items:center;gap:10px;flex:1">
          ${a.avatarUrl ? `<img src="${esc(a.avatarUrl)}" style="width:32px;height:32px;border-radius:50%">` : ''}
          <div>
            <strong>${esc(a.name)}</strong> <span style="font-size:12px;color:var(--text-muted)">@${esc(a.login)}</span>
            <div style="display:flex;gap:6px;margin-top:2px">
              ${a.copilotEnabled ? '<span class="badge badge-success" style="font-size:9px">Copilot</span>' : '<span class="badge badge-warning" style="font-size:9px">No Copilot</span>'}
              <span style="font-size:10px;color:var(--text-muted)">${a.scopes?.join(', ') || ''}</span>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm btn-ghost" onclick="copilotRefreshAccount('${esc(a.id)}')" title="Refresh">Refresh</button>
          <button class="btn btn-sm btn-ghost" onclick="copilotBrowseRepos('${esc(a.id)}','${esc(a.login)}')" title="Browse repos">Repos</button>
          <button class="btn btn-sm btn-ghost" onclick="copilotRemoveAccount('${esc(a.id)}',this)" style="color:var(--error)">Remove</button>
        </div>
      </div>
    `).join('');

    const jobRows = jobs.map(j => {
      const statusBadge = j.status === 'completed' ? 'badge-success' : j.status === 'working' ? 'badge-warning' : j.status === 'failed' ? 'badge-error' : 'badge-muted';
      return `<div class="channel-card" style="padding:8px 0">
        <div style="flex:1">
          <span style="font-weight:500">${esc(j.repo)}#${j.issueNumber}</span>
          <span style="font-size:12px;color:var(--text-muted);margin-left:8px">${esc(j.issueTitle)}</span>
          ${j.prUrl ? `<a href="${esc(j.prUrl)}" target="_blank" style="font-size:11px;color:var(--accent);margin-left:8px">View PR</a>` : ''}
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="badge ${statusBadge}" style="font-size:10px">${j.status}</span>
          <span style="font-size:10px;color:var(--text-muted)">${timeAgo(j.createdAt)}</span>
        </div>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h2>GitHub Copilot</h2>
        <button class="btn btn-sm btn-primary" onclick="copilotAddAccount()">Connect GitHub Account</button>
      </div>

      ${!status.configured ? `<div class="card" style="border-left:3px solid var(--warning);margin-bottom:16px">
        <div class="card-title">Setup Required</div>
        <p style="font-size:13px;color:var(--text-muted)">To use GitHub Copilot, create a GitHub OAuth App:</p>
        <ol style="font-size:12px;color:var(--text-muted);margin:8px 0;padding-left:20px">
          <li>Go to GitHub > Settings > Developer Settings > OAuth Apps > New OAuth App</li>
          <li>Set the callback URL to: <code style="font-size:11px">${window.location.origin}/api/copilot/oauth/callback</code></li>
          <li>Add the Client ID and Secret to Credentials as <code>GITHUB_OAUTH_CLIENT_ID</code> and <code>GITHUB_OAUTH_CLIENT_SECRET</code></li>
        </ol>
      </div>` : ''}

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Connected Accounts <span class="badge badge-muted" style="font-size:10px">${accounts.length}</span></div>
        ${accounts.length === 0 ? '<div class="empty">No GitHub accounts connected. Click "Connect GitHub Account" to start.</div>' : accountCards}
      </div>

      <div id="copilot-repos" style="display:none;margin-bottom:16px"></div>
      <div id="copilot-issues" style="display:none;margin-bottom:16px"></div>

      <div class="card">
        <div class="card-title">Copilot Jobs <span class="badge badge-muted" style="font-size:10px">${jobs.length}</span></div>
        ${jobs.length === 0 ? '<div class="empty">No jobs yet. Assign Copilot to an issue to get started.</div>' : jobRows}
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="card empty">Failed to load Copilot: ${esc(e.message)}</div>`;
  }
}

window.copilotAddAccount = async function () {
  try {
    const data = await api('/copilot/oauth/url');
    if (data.error) { toast(data.error, 'error'); return; }
    window.open(data.url, '_blank');
    toast('Complete the GitHub login in the new tab', 'info');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.copilotRemoveAccount = function (id, btnEl) {
  inlineConfirm(btnEl, 'Remove this account?', async () => {
    try {
      await api('/copilot/accounts/' + id, { method: 'DELETE' });
      toast('Account removed', 'success');
      navigate('copilot');
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  });
};

window.copilotRefreshAccount = async function (id) {
  try {
    const r = await api('/copilot/accounts/' + id + '/refresh', { method: 'POST' });
    if (r.ok) toast('Refreshed: ' + r.login + (r.copilotEnabled ? ' (Copilot active)' : ' (no Copilot)'), 'success');
    else toast(r.error, 'error');
    navigate('copilot');
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
};

window.copilotBrowseRepos = async function (accountId, login) {
  const container = document.getElementById('copilot-repos');
  if (!container) return;
  container.style.display = 'block';
  container.innerHTML = '<div class="card"><div class="loading">Loading repos...</div></div>';
  try {
    const repos = await api('/copilot/repos/' + accountId);
    container.innerHTML = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="card-title">Repos for @${esc(login)}</div>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('copilot-repos').style.display='none'">\u2715</button>
      </div>
      ${repos.map(r => `<div class="channel-card" style="padding:8px 0">
        <div style="flex:1">
          <strong style="font-size:13px">${esc(r.fullName)}</strong>
          ${r.private ? '<span class="badge badge-muted" style="font-size:9px;margin-left:6px">Private</span>' : ''}
          <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${r.openIssues} issues</span>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="copilotBrowseIssues('${esc(accountId)}','${esc(r.owner)}','${esc(r.name)}')">Issues</button>
      </div>`).join('')}
    </div>`;
  } catch (e) {
    container.innerHTML = `<div class="card empty">Failed: ${esc(e.message)}</div>`;
  }
};

window.copilotBrowseIssues = async function (accountId, owner, repo) {
  const container = document.getElementById('copilot-issues');
  if (!container) return;
  container.style.display = 'block';
  container.innerHTML = '<div class="card"><div class="loading">Loading issues...</div></div>';
  try {
    const issues = await api(`/copilot/issues/${accountId}/${owner}/${repo}`);
    container.innerHTML = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="card-title">Issues: ${esc(owner)}/${esc(repo)}</div>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('copilot-issues').style.display='none'">\u2715</button>
      </div>
      ${issues.length === 0 ? '<div class="empty">No open issues</div>' : issues.map(i => `<div class="channel-card" style="padding:8px 0">
        <div style="flex:1">
          <strong style="font-size:13px">#${i.number}</strong>
          <span style="margin-left:8px">${esc(i.title)}</span>
          ${i.labels.map(l => `<span class="badge badge-muted" style="font-size:9px;margin-left:4px">${esc(l)}</span>`).join('')}
          ${i.copilotAssigned ? '<span class="badge badge-success" style="font-size:9px;margin-left:4px">Copilot assigned</span>' : ''}
        </div>
        ${i.copilotAssigned ? '' : `<button class="btn btn-sm btn-primary" onclick="copilotAssign('${esc(accountId)}','${esc(owner)}','${esc(repo)}',${i.number},this)">Assign Copilot</button>`}
      </div>`).join('')}
    </div>`;
  } catch (e) {
    container.innerHTML = `<div class="card empty">Failed: ${esc(e.message)}</div>`;
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
      btn.outerHTML = '<span class="badge badge-success" style="font-size:10px">Assigned</span>';
      navigate('copilot');
    } else {
      toast(r.error || 'Failed', 'error');
      btn.disabled = false;
      btn.textContent = 'Assign Copilot';
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Assign Copilot';
  }
};

