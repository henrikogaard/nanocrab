// NanoCrab Admin — Agents Page

// --- Agents ---

function codingJobStatusBadge(status) {
  if (status === 'completed') return 'badge-success';
  if (['await_approval', 'await_pr_approval'].includes(status))
    return 'badge-info';
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
  if (status === 'cancelled') return 'badge-muted';
  return 'badge-error';
}

function codingJobActive(status) {
  return [
    'queued',
    'investigate',
    'plan',
    'await_approval',
    'implement',
    'test',
    'await_pr_approval',
    'open_pr',
    'ci_running',
  ].includes(status);
}

async function renderAgents(el) {
  el.innerHTML = '<div class="loading">Loading agents</div>';
  try {
    const [
      groupsRaw,
      containers,
      recent,
      plugins,
      tools,
      agentTasks,
      codingRepos,
      codingJobs,
      agentProviders,
      pendingQuestions,
      agentMsgs,
      approvals,
      reportJobs,
      researchJobs,
      terminals,
    ] = await Promise.all([
      api('/groups').catch(() => []),
      api('/containers').catch(() => []),
      api('/containers/recent').catch(() => []),
      api('/plugins').catch(() => []),
      api('/agents/tools').catch(() => []),
      api('/agents/tasks').catch(() => []),
      api('/agents/coding/repos').catch(() => []),
      api('/agents/coding/jobs').catch(() => []),
      api('/agents/providers').catch(() => []),
      api('/questions/pending').catch(() => []),
      api('/agents/messages').catch(() => []),
      api('/approvals').catch(() => []),
      api('/reports/jobs').catch(() => []),
      api('/research/jobs').catch(() => []),
      api('/sessions/terminal/active').catch(() => []),
    ]);
    const groups = Array.isArray(groupsRaw) ? groupsRaw : [];

    const agentCards = groups
      .map((g) => {
        const ch =
          g.channel ||
          (g.jid?.startsWith('tg:')
            ? 'telegram'
            : g.jid?.startsWith('sig:')
              ? 'signal'
              : 'whatsapp');
        const container = containers.find(
          (c) => c.groupJid === g.jid || c.groupFolder === g.folder,
        );
        const isActive = !!container;
        const isIdle = container?.idleWaiting;
        const isEnabled = g.enabled !== false;
        const isPrimary = g.isPrimary === true;
        const recentLogs = recent.filter((r) => r.group === g.folder);

        let statusBadge, statusColor;
        if (!isEnabled) {
          statusBadge = 'Disabled';
          statusColor = 'badge-muted';
        } else if (isActive && !isIdle) {
          statusBadge = 'Running';
          statusColor = 'badge-success';
        } else if (isActive && isIdle) {
          statusBadge = 'Idle';
          statusColor = 'badge-warning';
        } else {
          statusBadge = 'Offline';
          statusColor = 'badge-error';
        }

        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);${!isEnabled ? 'opacity:.62' : ''}">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="status-dot ${!isEnabled ? '' : isActive ? (isIdle ? 'idle' : 'online') : 'offline'}" style="width:8px;height:8px"></span>
          <div>
            <strong>${esc(g.name)}</strong>
            <span class="badge badge-muted" style="margin-left:6px;font-size:9px">${ch}</span>
            ${g.isMain ? '<span class="badge badge-success" style="font-size:9px;margin-left:3px">Persistent</span>' : ''}
            ${isPrimary ? '<span class="badge badge-accent" style="font-size:9px;margin-left:3px">Primary</span>' : ''}
            <div style="font-size:11px;color:var(--text-muted)">${g.lastActivity ? 'Active ' + timeAgo(g.lastActivity) : 'No activity'}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
          <span class="badge ${statusColor}" style="font-size:10px">${statusBadge}</span>
          <button class="btn btn-sm btn-ghost" onclick="toggleBotAgent('${esc(g.jid)}', ${!isEnabled})">${isEnabled ? 'Disable' : 'Enable'}</button>
          ${g.isMain && isEnabled && !isPrimary ? `<button class="btn btn-sm btn-ghost" onclick="setPrimaryBotAgent('${esc(g.jid)}')">Set Primary</button>` : ''}
        </div>
      </div>`;
      })
      .join('');

    // Tool options for the launcher
    const toolOptions = tools
      .map(
        (t) =>
          `<option value="${t.id}" ${!t.available ? 'disabled' : ''}>${t.name}${!t.available ? ' (not installed)' : ''}</option>`,
      )
      .join('');
    const defaultTool = tools.find((t) => t.available) || tools[0];
    const modelOptionsJson = JSON.stringify(
      tools.reduce((acc, t) => {
        acc[t.id] = t.models;
        return acc;
      }, {}),
    );

    // Task history
    const taskRows = agentTasks
      .map((t) => {
        const statusBadge =
          t.status === 'completed'
            ? 'badge-success'
            : t.status === 'running'
              ? 'badge-warning'
              : t.status === 'cancelled'
                ? 'badge-muted'
                : 'badge-error';
        return `<div class="channel-card" style="padding:8px 0">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="badge badge-muted" style="font-size:9px">${esc(t.tool)}</span>
            <span class="badge badge-muted" style="font-size:9px">${esc(t.model)}</span>
            <span style="font-size:12px;font-weight:500">${esc(t.prompt.slice(0, 80))}${t.prompt.length > 80 ? '...' : ''}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(t.workDir)} \u2022 ${timeAgo(t.createdAt)}</div>
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
          <span class="badge ${statusBadge}" style="font-size:10px">${t.isRunning ? 'Running' : t.status}</span>
          ${t.isRunning ? `<button class="btn btn-sm btn-ghost" onclick="cancelAgentTask('${t.id}')" style="color:var(--error)">Cancel</button>` : ''}
          <button class="btn btn-sm btn-ghost" onclick="viewAgentTask('${t.id}')">View</button>
        </div>
      </div>`;
      })
      .join('');

    const enabledPlugins = plugins.filter((p) => p.enabled);
    const codingProviderOptions = agentProviders
      .filter((p) => ['claude', 'codex', 'opencode'].includes(p.id))
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
      .join('');
    const codingModelsByProvider = {};
    agentProviders.forEach((p) => {
      codingModelsByProvider[p.id] = p.models || [];
    });
    const codingRepoOptions = codingRepos
      .map(
        (r) => `<option value="${esc(r.fullName)}">${esc(r.fullName)}</option>`,
      )
      .join('');
    const codingJobRows = codingJobs
      .map((job) => {
        const statusBadge = codingJobStatusBadge(job.status);
        const actions = [
          job.status === 'await_approval'
            ? `<button class="btn btn-sm btn-primary" onclick="controlCodingJob('${esc(job.id)}','approve')">Approve</button>`
            : '',
          job.status === 'await_approval'
            ? `<button class="btn btn-sm btn-ghost" onclick="denyCodingJobImplementation('${esc(job.id)}')">Deny</button>`
            : '',
          job.status === 'await_pr_approval'
            ? `<button class="btn btn-sm btn-primary" onclick="controlCodingJob('${esc(job.id)}','approve-pr')">Approve PR</button>`
            : '',
          job.commitSha && ['ci_running', 'completed'].includes(job.status)
            ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(job.id)}','refresh-ci')">CI</button>`
            : '',
          ['failed', 'cancelled'].includes(job.status)
            ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(job.id)}','retry')">Retry</button>`
            : '',
          !['completed', 'cancelled'].includes(job.status)
            ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(job.id)}','cancel')">Cancel</button>`
            : '',
        ]
          .filter(Boolean)
          .join('');
        return `<div class="channel-card" style="padding:8px 0">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span class="badge badge-muted" style="font-size:9px">${esc(job.repo)}</span>
            <span class="badge badge-accent" style="font-size:9px">${esc(job.provider)}/${esc(job.model)}</span>
            ${job.issueNumber ? `<span class="badge badge-info" style="font-size:9px">#${job.issueNumber}</span>` : ''}
            <span style="font-size:12px;font-weight:500">${esc((job.issueTitle || job.prompt || job.id).slice(0, 100))}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(job.branch)} \u2022 ${timeAgo(job.createdAt)}${job.prUrl ? ` \u2022 <a href="${esc(job.prUrl)}" target="_blank" style="color:var(--accent)">PR</a>` : ''}</div>
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
          <span class="badge ${statusBadge}" style="font-size:10px">${esc(job.status)}</span>
          ${actions}
          <button class="btn btn-sm btn-ghost" onclick="viewCodingJob('${esc(job.id)}')">View</button>
        </div>
      </div>`;
      })
      .join('');
    const cockpitRows = [
      {
        label: 'Approvals',
        count: approvals.filter((a) => a.status === 'pending').length,
        detail: approvals[0]?.title || 'No pending approvals',
      },
      {
        label: 'Reports',
        count: reportJobs.length,
        detail: reportJobs[0]?.title || 'No report jobs',
      },
      {
        label: 'Research',
        count: researchJobs.length,
        detail: researchJobs[0]?.query || 'No research jobs',
      },
      {
        label: 'Terminals',
        count: terminals.length,
        detail: terminals[0]?.name || 'No active terminal sessions',
      },
    ];

    el.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h2>Agents</h2>
        <button class="btn btn-sm btn-primary" onclick="document.getElementById('task-launcher').style.display=document.getElementById('task-launcher').style.display==='none'?'block':'none'">New Coding Task</button>
      </div>

      <div id="task-launcher" class="card" style="display:none;margin-bottom:16px;border-left:3px solid var(--accent)">
        <div class="card-title">Launch Coding Task</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          <div class="form-group">
            <label>Tool</label>
            <select class="search-input" id="task-tool" onchange="updateTaskModels()" style="width:100%">${toolOptions}</select>
          </div>
          <div class="form-group">
            <label>Model</label>
            <select class="search-input" id="task-model" style="width:100%"></select>
          </div>
          <div class="form-group">
            <label>Budget (USD, optional)</label>
            <input class="search-input" id="task-budget" type="number" step="0.1" min="0" placeholder="e.g. 5" style="width:100%">
          </div>
        </div>
        <div class="form-group">
          <label>Working directory</label>
          <input class="search-input" id="task-workdir" value="${esc(window._lastWorkDir || window._projectRoot || '.')}" placeholder="/path/to/repo" style="width:100%">
        </div>
        <div class="form-group">
          <label>Task description</label>
          <textarea class="search-input" id="task-prompt" rows="3" placeholder="Describe what the agent should do..." style="width:100%;resize:vertical;font-family:var(--font)"></textarea>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" onclick="launchAgentTask()">Launch</button>
          <button class="btn btn-ghost" onclick="document.getElementById('task-launcher').style.display='none'">Cancel</button>
        </div>
      </div>

      <div id="task-output-panel" style="display:none;margin-bottom:16px"></div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Agent Cockpit</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
          ${cockpitRows
            .map(
              (
                row,
              ) => `<div style="border:1px solid var(--border);border-radius:8px;padding:12px;min-height:82px">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                  <span style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em">${esc(row.label)}</span>
                  <span class="badge badge-muted" style="font-size:10px">${row.count}</span>
                </div>
                <div style="font-size:13px;font-weight:600;margin-top:10px;line-height:1.35">${esc(row.detail)}</div>
              </div>`,
            )
            .join('')}
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">GitHub Coding Jobs <span class="badge badge-muted" style="font-size:10px">${codingJobs.length}</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">Register repo</div>
            <div style="display:flex;gap:6px">
              <input class="search-input" id="coding-repo-new" placeholder="owner/repo" style="flex:1">
              <button class="btn btn-sm btn-ghost" onclick="registerCodingRepo()">Add</button>
            </div>
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">Pick next issue</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              <select class="search-input" id="coding-repo-select">${codingRepoOptions || '<option value="">No repos registered</option>'}</select>
              <select class="search-input" id="coding-provider-select" onchange="updateCodingModels()">${codingProviderOptions || '<option value="claude">Claude</option>'}</select>
              <select class="search-input" id="coding-model-select" style="grid-column:1/2"><option value="">Default model</option></select>
              <input class="search-input" id="coding-labels" placeholder="labels, comma-separated" style="grid-column:1/-1">
              <label style="font-size:12px;color:var(--text-muted);display:flex;gap:6px;align-items:center"><input type="checkbox" id="coding-create-pr" checked> create draft PR when changes are ready</label>
              <button class="btn btn-sm btn-primary" onclick="pickCodingIssue()">Pick Issue</button>
            </div>
          </div>
        </div>
        ${
          codingJobs.length === 0
            ? '<div class="empty" style="padding:12px">No dedicated coding jobs yet</div>'
            : codingJobRows
        }
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Coding Agents</div>
        ${tools
          .filter((t) => t.available)
          .map((t) => {
            const running = agentTasks.filter(
              (j) => j.tool === t.id && j.isRunning,
            ).length;
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;align-items:center;gap:10px">
              <span class="status-dot ${running > 0 ? 'online' : 'idle'}" style="width:8px;height:8px"></span>
              <div>
                <strong>${esc(t.name)}</strong>
                <div style="font-size:11px;color:var(--text-muted)">${t.models.map((m) => m.label).join(', ')}</div>
              </div>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              ${running > 0 ? '<span class="badge badge-success" style="font-size:10px">' + running + ' running</span>' : '<span class="badge badge-muted" style="font-size:10px">Ready</span>'}
              <button class="btn btn-sm btn-ghost" onclick="document.getElementById('task-launcher').style.display='block';document.getElementById('task-tool').value='${t.id}';updateTaskModels()">Launch</button>
            </div>
          </div>`;
          })
          .join('')}
        ${tools
          .filter((t) => !t.available)
          .map(
            (
              t,
            ) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);opacity:0.5">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="status-dot offline" style="width:8px;height:8px"></span>
            <div>
              <strong>${esc(t.name)}</strong>
              <div style="font-size:11px;color:var(--text-muted)">Not installed</div>
            </div>
          </div>
          <span class="badge badge-error" style="font-size:10px">Unavailable</span>
        </div>`,
          )
          .join('')}
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Bot Agents <span class="badge badge-muted" style="font-size:10px">${groups.length}</span></div>
        ${agentCards}
      </div>

      ${
        agentTasks.length > 0
          ? `<div class="card" style="margin-bottom:16px">
        <div class="card-title">Coding Tasks <span class="badge badge-muted" style="font-size:10px">${agentTasks.length}</span></div>
        ${taskRows}
      </div>`
          : ''
      }

      ${
        recent.length > 0
          ? `<div class="card" style="margin-bottom:16px">
        <div class="card-title">Recent Sessions <span class="badge badge-muted" style="font-size:10px">${recent.length}</span></div>
        ${recent
          .map(
            (
              r,
            ) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px">
              <span class="badge badge-muted" style="font-size:9px">${esc(r.group)}</span>
              <span style="font-size:12px;font-family:var(--mono);color:var(--text-muted)">${esc(r.filename)}</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${timeAgo(r.timestamp)} \u2022 ${r.size > 1024 ? (r.size / 1024).toFixed(1) + ' KB' : r.size + ' B'}</div>
          </div>
          <button class="btn btn-sm btn-ghost" onclick="viewContainerLog('${esc(r.group)}','${esc(r.filename)}')">View</button>
        </div>`,
          )
          .join('')}
        <div id="container-log-viewer"></div>
      </div>`
          : ''
      }

      ${
        pendingQuestions.length > 0
          ? `<div class="card" style="margin-bottom:16px;border-left:3px solid var(--warning)">
        <div class="card-title">Pending Questions <span class="badge badge-warning" style="font-size:10px">${pendingQuestions.length}</span></div>
        ${pendingQuestions
          .map(
            (
              q,
            ) => `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:13px;font-weight:500;margin-bottom:6px">${esc(q.question)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">From: ${esc(q.group_folder)} \u2022 ${timeAgo(q.created_at)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${q.options.map((opt) => `<button class="btn btn-sm btn-primary" onclick="answerQuestion('${esc(q.id)}','${esc(opt)}')">${esc(opt)}</button>`).join('')}
          </div>
        </div>`,
          )
          .join('')}
      </div>`
          : ''
      }

      ${
        agentProviders.length > 0
          ? `<div class="card" style="margin-bottom:16px">
        <div class="card-title">Container Providers</div>
        ${agentProviders
          .map(
            (
              p,
            ) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="status-dot ${p.available ? 'online' : 'offline'}" style="width:8px;height:8px"></span>
            <div>
              <strong>${esc(p.name)}</strong>
              <div style="font-size:11px;color:var(--text-muted)">${p.models.map((m) => m.label).join(', ')}</div>
            </div>
          </div>
          <span class="badge ${p.available ? 'badge-success' : 'badge-error'}" style="font-size:10px">${p.available ? 'Available' : 'Not installed'}</span>
        </div>`,
          )
          .join('')}
      </div>`
          : ''
      }

      ${
        agentMsgs.length > 0
          ? `<div class="card" style="margin-bottom:16px">
        <div class="card-title">Agent Messages <span class="badge badge-muted" style="font-size:10px">${agentMsgs.length}</span></div>
        ${agentMsgs
          .slice(0, 15)
          .map(
            (
              m,
            ) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px">
              <span class="badge badge-muted" style="font-size:9px">${esc(m.from_group)}</span>
              <span style="font-size:11px;color:var(--text-muted)">\u2192</span>
              <span class="badge badge-muted" style="font-size:9px">${esc(m.to_group)}</span>
              ${m.status === 'unread' ? '<span class="badge badge-warning" style="font-size:8px">new</span>' : ''}
            </div>
            <div style="font-size:12px;margin-top:2px">${esc(m.content.length > 120 ? m.content.slice(0, 120) + '...' : m.content)}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:1px">${timeAgo(m.created_at)}</div>
          </div>
        </div>`,
          )
          .join('')}
      </div>`
          : ''
      }

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Send Agent Message</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <select class="search-input" id="msg-from" style="width:100%">
            ${groups.map((g) => `<option value="${esc(g.folder)}">${esc(g.name)}</option>`).join('')}
          </select>
          <select class="search-input" id="msg-to" style="width:100%">
            ${groups.map((g) => `<option value="${esc(g.folder)}">${esc(g.name)}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:8px">
          <input class="search-input" id="msg-content" placeholder="Message content..." style="flex:1">
          <button class="btn btn-sm btn-primary" onclick="sendAgentMessage()">Send</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Plugins <span class="badge badge-muted" style="font-size:10px">${enabledPlugins.length} enabled</span></div>
        ${enabledPlugins
          .map(
            (p) => `
          <div class="channel-card" style="padding:6px 0">
            <div><span style="font-weight:500">${esc(p.name)}</span> <span style="font-size:11px;color:var(--text-muted)">v${esc(p.version)}</span></div>
            ${p.sidebar ? `<button class="btn btn-sm btn-ghost" onclick="navigate('${esc(p.sidebar.id)}')" style="font-size:11px">${esc(p.sidebar.icon)} Open</button>` : ''}
          </div>
        `,
          )
          .join('')}
        <div style="margin-top:6px;font-size:11px;color:var(--text-muted)"><a style="color:var(--accent);cursor:pointer" onclick="navigate('settings')">Manage plugins</a></div>
      </div>
    `;

    // Init model dropdowns
    window._toolModels = JSON.parse(modelOptionsJson);
    updateTaskModels();
    window._codingModelsByProvider = codingModelsByProvider;
    updateCodingModels();
  } catch (e) {
    el.innerHTML = `<div class="card empty">Failed to load agents: ${esc(e.message)}</div>`;
  }
}

window.updateTaskModels = function () {
  const tool = document.getElementById('task-tool')?.value;
  const modelSelect = document.getElementById('task-model');
  if (!tool || !modelSelect || !window._toolModels) return;
  const models = window._toolModels[tool] || [];
  modelSelect.innerHTML = models
    .map((m) => `<option value="${m.id}">${m.label}</option>`)
    .join('');
};

window.launchAgentTask = async function () {
  const tool = document.getElementById('task-tool').value;
  const model = document.getElementById('task-model').value;
  const prompt = document.getElementById('task-prompt').value.trim();
  const workDir = document.getElementById('task-workdir').value.trim();
  const budget = document.getElementById('task-budget').value;
  if (!prompt) {
    toast('Enter a task description', 'warning');
    return;
  }

  window._lastWorkDir = workDir;
  try {
    const r = await api('/agents/tasks', {
      method: 'POST',
      body: JSON.stringify({
        tool,
        model,
        prompt,
        workDir,
        budget: budget || undefined,
      }),
    });
    if (r.ok) {
      toast(`Task launched on ${tool} (${model})`, 'success');
      document.getElementById('task-launcher').style.display = 'none';
      document.getElementById('task-prompt').value = '';
      // Auto-show output
      viewAgentTask(r.task.id);
      // Refresh the page after a delay
      setTimeout(() => {
        if (currentPage === 'agents') navigate('agents');
      }, 3000);
    } else {
      toast(r.error || 'Failed to launch', 'error');
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.registerCodingRepo = async function () {
  const repo = document.getElementById('coding-repo-new')?.value?.trim();
  if (!repo) {
    toast('Enter owner/repo', 'warning');
    return;
  }
  try {
    const r = await api('/agents/coding/repos', {
      method: 'POST',
      body: JSON.stringify({ repo }),
    });
    if (r.ok) {
      toast('Coding repo registered', 'success');
      navigate('agents');
    } else {
      toast(r.error || 'Failed', 'error');
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.updateCodingModels = function () {
  const providerEl = document.getElementById('coding-provider-select');
  const modelEl = document.getElementById('coding-model-select');
  if (!providerEl || !modelEl) return;
  const modelsByProvider = window._codingModelsByProvider || {};
  const models = modelsByProvider[providerEl.value] || [];
  modelEl.innerHTML = `<option value="">Default model</option>${models.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}`;
};

window.pickCodingIssue = async function () {
  const repo = document.getElementById('coding-repo-select')?.value;
  const provider = document.getElementById('coding-provider-select')?.value;
  const model = document.getElementById('coding-model-select')?.value;
  const labels = document
    .getElementById('coding-labels')
    ?.value?.split(',')
    .map((label) => label.trim())
    .filter(Boolean);
  const createPr =
    document.getElementById('coding-create-pr')?.checked === true;
  if (!repo) {
    toast('Register/select a repo first', 'warning');
    return;
  }
  try {
    const r = await api('/agents/coding/pick-issue', {
      method: 'POST',
      body: JSON.stringify({
        repo,
        labels,
        provider,
        model: model || undefined,
        createPr,
      }),
    });
    if (!r.ok) {
      toast(r.error || 'Failed', 'error');
      return;
    }
    if (!r.issue) {
      toast('No matching open issue found', 'info');
      return;
    }
    toast(`Started coding job for #${r.issue.number}`, 'success');
    setTimeout(() => {
      if (currentPage === 'agents') navigate('agents');
    }, 1000);
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.viewCodingJob = async function (id) {
  const panel = document.getElementById('task-output-panel');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML =
    '<div class="card"><div class="loading">Loading coding job...</div></div>';
  try {
    const job = await api('/agents/coding/jobs/' + encodeURIComponent(id));
    const statusBadge = codingJobStatusBadge(job.status);
    const actions = [
      job.status === 'await_approval'
        ? `<button class="btn btn-sm btn-primary" onclick="controlCodingJob('${esc(id)}','approve')">Approve implementation</button>`
        : '',
      job.status === 'await_approval'
        ? `<button class="btn btn-sm btn-ghost" onclick="denyCodingJobImplementation('${esc(id)}')">Deny implementation</button>`
        : '',
      job.status === 'await_pr_approval'
        ? `<button class="btn btn-sm btn-primary" onclick="controlCodingJob('${esc(id)}','approve-pr')">Approve PR</button>`
        : '',
      job.commitSha && ['ci_running', 'completed'].includes(job.status)
        ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(id)}','refresh-ci')">Refresh CI</button>`
        : '',
      ['failed', 'cancelled'].includes(job.status)
        ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(id)}','retry')">Retry</button>`
        : '',
      !['completed', 'cancelled'].includes(job.status)
        ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(id)}','cancel')">Cancel</button>`
        : '',
    ]
      .filter(Boolean)
      .join('');
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
    panel.innerHTML = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span class="badge badge-muted">${esc(job.repo)}</span>
          <span class="badge badge-accent">${esc(job.provider)}/${esc(job.model)}</span>
          <span class="badge ${statusBadge}">${esc(job.status)}</span>
          ${job.issueNumber ? `<span class="badge badge-info">#${job.issueNumber}</span>` : ''}
          ${job.prUrl ? `<a href="${esc(job.prUrl)}" target="_blank" style="color:var(--accent);font-size:12px">Pull request</a>` : ''}
        </div>
        <div style="display:flex;gap:6px">
          ${actions}
          <button class="btn btn-sm btn-ghost" onclick="viewCodingJob('${esc(id)}')">Refresh</button>
          <button class="btn btn-sm btn-ghost" onclick="document.getElementById('task-output-panel').style.display='none'">Close</button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
        <strong>Branch:</strong> ${esc(job.branch)}<br>
        <strong>Workspace:</strong> ${esc(job.workspace)}
      </div>
      <div class="autofix-review-grid">
        <div class="autofix-review-pane"><div class="autofix-pane-title">Diff</div><pre>${esc(diff)}</pre></div>
        <div class="autofix-review-pane"><div class="autofix-pane-title">Log</div><pre>${esc(job.output || '(no output yet)')}</pre></div>
        <div class="autofix-review-pane"><div class="autofix-pane-title">Tests</div><pre>${esc(tests)}</pre></div>
        <div class="autofix-review-pane"><div class="autofix-pane-title">CI</div><pre>${esc(ci || 'Status: unknown')}</pre></div>
      </div>
    </div>`;
    if (codingJobActive(job.status)) {
      setTimeout(() => {
        if (
          document.getElementById('task-output-panel')?.style.display !== 'none'
        )
          viewCodingJob(id);
      }, 4000);
    }
  } catch (e) {
    panel.innerHTML = `<div class="card empty">Failed: ${esc(e.message)}</div>`;
  }
};

window.cancelAgentTask = async function (id) {
  try {
    await api('/agents/tasks/' + id + '/cancel', { method: 'POST' });
    toast('Task cancelled', 'success');
    if (currentPage === 'agents') navigate('agents');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.viewContainerLog = async function (group, filename) {
  const viewer = document.getElementById('container-log-viewer');
  if (!viewer) return;
  viewer.innerHTML =
    '<div style="padding:12px"><div class="loading">Loading session log...</div></div>';
  try {
    const res = await api(
      `/logs/${encodeURIComponent(group)}/${encodeURIComponent(filename)}`,
    );
    const lines = res.lines || [];
    viewer.innerHTML = `
      <div style="margin-top:12px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--surface2);border-bottom:1px solid var(--border)">
          <span style="font-size:12px;font-weight:600;color:var(--text)">${esc(group)} / ${esc(filename)}</span>
          <button class="btn btn-sm btn-ghost" onclick="document.getElementById('container-log-viewer').innerHTML=''" style="font-size:11px">Close</button>
        </div>
        <pre style="margin:0;padding:12px;max-height:500px;overflow:auto;font-size:11px;line-height:1.6;background:var(--bg);color:var(--text-secondary);white-space:pre-wrap;word-break:break-word"><code>${esc(lines.join('\n'))}</code></pre>
      </div>`;
  } catch (e) {
    viewer.innerHTML = `<div style="margin-top:12px;padding:12px;color:var(--error);font-size:12px">Failed to load log: ${esc(e.message)}</div>`;
  }
};

window.viewAgentTask = async function (id) {
  const panel = document.getElementById('task-output-panel');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML =
    '<div class="card"><div class="loading">Loading output...</div></div>';
  try {
    const task = await api('/agents/tasks/' + id);
    const statusBadge =
      task.status === 'completed'
        ? 'badge-success'
        : task.status === 'running'
          ? 'badge-warning'
          : 'badge-error';
    panel.innerHTML = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <span class="badge badge-muted" style="font-size:10px">${esc(task.tool)}</span>
          <span class="badge badge-muted" style="font-size:10px">${esc(task.model)}</span>
          <span class="badge ${statusBadge}" style="font-size:10px">${task.isRunning ? 'Running' : task.status}</span>
          ${task.exitCode != null ? `<span style="font-size:11px;color:var(--text-muted)">exit ${task.exitCode}</span>` : ''}
        </div>
        <div style="display:flex;gap:6px">
          ${task.isRunning ? `<button class="btn btn-sm btn-ghost" onclick="viewAgentTask('${id}')">Refresh</button>` : ''}
          <button class="btn btn-sm btn-ghost" onclick="shareAgentTask('${id}')">Share</button>
          <button class="btn btn-sm btn-ghost" onclick="document.getElementById('task-output-panel').style.display='none'">Close</button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
        <strong>Prompt:</strong> ${esc(task.prompt.slice(0, 200))}${task.prompt.length > 200 ? '...' : ''}
      </div>
      <pre style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;font-size:11px;max-height:400px;overflow:auto;white-space:pre-wrap;word-break:break-word;color:var(--text)">${esc(task.output || '(no output yet)')}</pre>
    </div>`;
    // Auto-refresh if running
    if (task.isRunning) {
      setTimeout(() => {
        if (
          document.getElementById('task-output-panel')?.style.display !== 'none'
        )
          viewAgentTask(id);
      }, 3000);
    }
  } catch (e) {
    panel.innerHTML = `<div class="card empty">Failed: ${esc(e.message)}</div>`;
  }
};

window.shareAgentTask = async function (id) {
  try {
    const task = await api('/agents/tasks/' + id);
    const prompt =
      task.prompt.length > 200
        ? task.prompt.slice(0, 200) + '...'
        : task.prompt;
    const output = (task.output || '(no output)').slice(0, 500);
    shareContent('Agent Task', `Prompt: ${prompt}\n\nOutput:\n${output}`);
  } catch (e) {
    toast('Failed to share: ' + e.message, 'error');
  }
};

window.toggleBotAgent = async function (jid, enabled) {
  try {
    const groups = await api('/groups');
    const group = groups.find((g) => g.jid === jid);
    if (!group) {
      toast('Bot agent not found', 'error');
      return;
    }
    if (!enabled && group.isPrimary) {
      toast('Choose another primary bot before disabling this one', 'warning');
      return;
    }
    const r = await api('/groups/' + encodeURIComponent(jid), {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
    if (r.ok) {
      toast(enabled ? 'Bot agent enabled' : 'Bot agent disabled', 'success');
      navigate('agents');
    } else {
      toast(r.error || 'Failed to update bot agent', 'error');
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.setPrimaryBotAgent = async function (jid) {
  try {
    const r = await api('/groups/' + encodeURIComponent(jid), {
      method: 'PUT',
      body: JSON.stringify({ enabled: true, isPrimary: true }),
    });
    if (r.ok) {
      toast('Primary bot selected', 'success');
      navigate('agents');
    } else {
      toast(r.error || 'Failed to set primary bot', 'error');
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.controlCodingJob = async function (id, action) {
  try {
    const r = await api('/agents/coding/jobs/' + id + '/' + action, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (r.ok) {
      toast('Coding job action queued: ' + action, 'success');
      if (
        document.getElementById('task-output-panel')?.style.display !== 'none'
      ) {
        await viewCodingJob(id);
      }
      if (currentPage === 'agents') navigate('agents');
    } else {
      toast(r.error || 'Coding job action failed', 'error');
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.denyCodingJobImplementation = async function (id) {
  const note =
    prompt('Reason for denying implementation?') ||
    'Denied from Agents dashboard';
  try {
    const r = await api('/agents/coding/jobs/' + id + '/deny-implementation', {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
    if (r.ok) {
      toast('Implementation denied', 'success');
      if (
        document.getElementById('task-output-panel')?.style.display !== 'none'
      ) {
        await viewCodingJob(id);
      }
      if (currentPage === 'agents') navigate('agents');
    } else {
      toast(r.error || 'Coding job action failed', 'error');
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

// --- Interactive Questions ---

window.answerQuestion = async function (id, answer) {
  try {
    const r = await api('/questions/' + id + '/answer', {
      method: 'POST',
      body: JSON.stringify({ answer }),
    });
    if (r.ok) {
      toast('Answer sent: ' + answer, 'success');
      if (currentPage === 'agents') navigate('agents');
    } else {
      toast(r.error || 'Failed to answer', 'error');
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

// --- Agent-to-Agent Messaging ---

window.sendAgentMessage = async function () {
  const fromGroup = document.getElementById('msg-from')?.value;
  const toGroup = document.getElementById('msg-to')?.value;
  const content = document.getElementById('msg-content')?.value?.trim();
  if (!content) {
    toast('Enter a message', 'warning');
    return;
  }
  if (fromGroup === toGroup) {
    toast('Cannot send message to self', 'warning');
    return;
  }
  try {
    const r = await api('/agents/message', {
      method: 'POST',
      body: JSON.stringify({ fromGroup, toGroup, content }),
    });
    if (r.ok) {
      toast('Message sent', 'success');
      document.getElementById('msg-content').value = '';
      if (currentPage === 'agents') navigate('agents');
    } else {
      toast(r.error || 'Failed to send', 'error');
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};
