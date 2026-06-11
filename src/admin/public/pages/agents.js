// NanoCrab Admin — Agents Page

// --- Agents ---

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
      artifactVault,
      terminals,
      providerProfileInfo,
      codingSummary,
      codingTimeline,
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
      api('/artifacts?limit=12&includeExpired=true').catch(() => ({
        artifacts: [],
      })),
      api('/sessions/terminal/active').catch(() => []),
      api('/system/provider/profiles').catch(() => ({
        profiles: [],
        probes: [],
      })),
      api('/agents/coding/summary').catch(() => null),
      api('/agents/coding/timeline?limit=40').catch(() => []),
    ]);
    const groups = Array.isArray(groupsRaw) ? groupsRaw : [];
    const pendingApprovals = approvals.filter((a) => a.status === 'pending');
    const cockpitMode =
      localStorage.getItem('nanocrab-agents-cockpit-mode') || 'overview';
    const providerProfiles = providerProfileInfo.profiles || [];
    const providerProbes = providerProfileInfo.probes || [];
    const providerProbeById = providerProbes.reduce((acc, probe) => {
      if (probe.profileId) acc[probe.profileId] = probe;
      return acc;
    }, {});
    const codingStatusClass = (status, ciStatus) =>
      status === 'completed' || ciStatus === 'success'
        ? 'badge-success'
        : status === 'failed' || ciStatus === 'failure'
          ? 'badge-error'
          : status === 'await_approval' || status === 'await_pr_approval'
            ? 'badge-warning'
            : 'badge-info';
    const artifactRows = (artifactVault.artifacts || [])
      .map(
        (artifact) => `<div class="channel-card" style="padding:9px 0">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <span class="badge ${artifact.expired ? 'badge-warning' : 'badge-success'}" style="font-size:9px">${artifact.expired ? 'expired' : 'retained'}</span>
              <span class="badge badge-muted" style="font-size:9px">${esc(artifact.kind)}</span>
              <strong style="font-size:13px;color:var(--text)">${esc(artifact.name)}</strong>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${esc(artifact.relativePath)} · ${Math.max(1, Math.round(artifact.size / 1024))} KB · updated ${timeAgo(artifact.updatedAt)}</div>
            ${
              artifact.sourceLinks?.length
                ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px">${artifact.sourceLinks
                    .slice(0, 4)
                    .map(
                      (link) =>
                        `<span class="badge badge-info" title="${esc(link.source)}">${esc(link.label.slice(0, 42))}</span>`,
                    )
                    .join('')}</div>`
                : ''
            }
          </div>
          <div style="font-size:11px;color:var(--text-muted);text-align:right">${artifact.expiresAt ? `expires ${timeAgo(artifact.expiresAt)}` : 'no expiry'}</div>
        </div>`,
      )
      .join('');

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
        const channelHealth = g.channelHealth || null;
        const channelStatus =
          channelHealth?.status ||
          (channelHealth?.connected ? 'active' : 'offline');
        const channelConnected = channelStatus === 'active';

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
        } else if (channelConnected) {
          statusBadge = 'Active';
          statusColor = 'badge-success';
        } else if (channelStatus === 'degraded') {
          statusBadge = 'Degraded';
          statusColor = 'badge-warning';
        } else {
          statusBadge = 'Offline';
          statusColor = 'badge-error';
        }
        const dotStatus = !isEnabled
          ? ''
          : isActive
            ? isIdle
              ? 'idle'
              : 'online'
            : channelStatus === 'active'
              ? 'online'
              : channelStatus === 'degraded'
                ? 'idle'
                : 'offline';
        const lastActivity =
          g.lastActivity || channelHealth?.lastActiveAt || null;

        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);${!isEnabled ? 'opacity:.62' : ''}">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="status-dot ${dotStatus}" style="width:8px;height:8px"></span>
          <div>
            <strong>${esc(g.name)}</strong>
            <span class="badge badge-muted" style="margin-left:6px;font-size:9px">${ch}</span>
            ${g.isMain ? '<span class="badge badge-success" style="font-size:9px;margin-left:3px">Persistent</span>' : ''}
            ${isPrimary ? '<span class="badge badge-accent" style="font-size:9px;margin-left:3px">Primary</span>' : ''}
            <div style="font-size:11px;color:var(--text-muted)">${lastActivity ? 'Active ' + timeAgo(lastActivity) : 'No activity'}${channelHealth?.detail ? ' · ' + esc(channelHealth.detail) : ''}</div>
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
    const codingRepoOptions = codingRepos
      .map(
        (r) => `<option value="${esc(r.fullName)}">${esc(r.fullName)}</option>`,
      )
      .join('');
    const codingJobRows = codingJobs
      .map((job) => {
        const statusBadge = codingStatusClass(job.status, job.ciStatus);
        const changedFiles = Array.isArray(job.changedFiles)
          ? job.changedFiles
          : [];
        const needsImplementApproval = job.status === 'await_approval';
        const needsPrApproval = job.status === 'await_pr_approval';
        return `<div class="channel-card" style="padding:8px 0">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span class="badge badge-muted" style="font-size:9px">${esc(job.repo)}</span>
            <span class="badge badge-accent" style="font-size:9px">${esc(job.provider)}/${esc(job.model)}</span>
            ${job.issueNumber ? `<span class="badge badge-info" style="font-size:9px">#${job.issueNumber}</span>` : ''}
            ${job.ciStatus && job.ciStatus !== 'unknown' ? `<span class="badge badge-muted" style="font-size:9px">CI ${esc(job.ciStatus)}</span>` : ''}
            <span style="font-size:12px;font-weight:500">${esc((job.issueTitle || job.prompt || job.id).slice(0, 100))}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(job.branch)} \u2022 ${timeAgo(job.createdAt)}${job.prUrl ? ` \u2022 <a href="${esc(job.prUrl)}" target="_blank" style="color:var(--accent)">PR</a>` : ''}${changedFiles.length ? ` \u2022 ${changedFiles.length} changed file${changedFiles.length === 1 ? '' : 's'}` : ''}</div>
          ${job.testSummary ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(job.testSummary)}</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
          <span class="badge ${statusBadge}" style="font-size:10px">${esc(job.status)}</span>
          ${needsImplementApproval ? `<button class="btn btn-sm btn-primary" onclick="controlCodingJob('${esc(job.id)}','approve')">Approve</button>` : ''}
          ${needsPrApproval ? `<button class="btn btn-sm btn-primary" onclick="controlCodingJob('${esc(job.id)}','open-pr')">Approve PR</button>` : ''}
          <button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(job.id)}','open-pr')">PR</button>
          <button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(job.id)}','retry')">Retry</button>
          <button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(job.id)}','cancel')">Cancel</button>
          <button class="btn btn-sm btn-ghost" onclick="viewCodingJob('${esc(job.id)}')">View</button>
        </div>
      </div>`;
      })
      .join('');
    const reportJobRows = reportJobs
      .map((job) => {
        const statusBadge =
          job.status === 'delivered' || job.status === 'draft_ready'
            ? 'badge-success'
            : job.status?.includes('approval')
              ? 'badge-warning'
              : job.status === 'failed'
                ? 'badge-error'
                : 'badge-info';
        const artifacts = Array.isArray(job.artifacts) ? job.artifacts : [];
        return `<div class="channel-card" style="padding:10px 0">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <span class="badge ${statusBadge}" style="font-size:9px">${esc(job.status)}</span>
              <span class="badge badge-muted" style="font-size:9px">${esc((job.outputFormats || []).join(', ') || 'markdown')}</span>
              <strong style="font-size:13px;color:var(--text)">${esc(job.title)}</strong>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${esc(job.request)} · ${timeAgo(job.createdAt)}</div>
            ${
              job.outline
                ? `<details style="margin-top:6px"><summary style="font-size:12px;color:var(--accent);cursor:pointer">Outline</summary><pre style="white-space:pre-wrap;font-size:11px;color:var(--text-muted);margin:6px 0 0;max-height:140px;overflow:auto">${esc(job.outline)}</pre></details>`
                : ''
            }
            ${
              artifacts.length
                ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${artifacts
                    .map(
                      (artifact) =>
                        `<span class="badge badge-success" title="${esc(artifact.path)}">${esc(artifact.format)}</span>`,
                    )
                    .join('')}</div>`
                : ''
            }
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
            ${
              job.status === 'awaiting_outline_approval' ||
              job.status === 'awaiting_delivery_approval'
                ? `<button class="btn btn-sm btn-primary" onclick="openReportApproval('${esc(job.id)}')">Approve</button>`
                : ''
            }
          </div>
        </div>`;
      })
      .join('');
    const cockpitRows = [
      {
        label: 'Approvals',
        count: pendingApprovals.length,
        detail: pendingApprovals[0]?.title || 'No pending approvals',
      },
      {
        label: 'Coding',
        count: codingSummary?.total || codingJobs.length,
        detail: `${codingSummary?.active || 0} active, ${codingSummary?.waitingApproval || 0} waiting`,
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
    const codingTimelineRows = (
      Array.isArray(codingTimeline) ? codingTimeline : []
    )
      .slice(0, 24)
      .map(
        (
          event,
        ) => `<div style="display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border)">
          <span class="badge badge-muted" style="font-size:9px">${esc(event.kind)}</span>
          <div style="min-width:0;flex:1">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <strong style="font-size:12px;color:var(--text)">${esc(event.title)}</strong>
              <span class="badge badge-muted" style="font-size:9px">${esc(event.repo)}</span>
              ${event.issueNumber ? `<span class="badge badge-info" style="font-size:9px">#${event.issueNumber}</span>` : ''}
              <span class="badge badge-muted" style="font-size:9px">${esc(event.status)}</span>
            </div>
            ${event.detail ? `<div style="font-size:11px;color:var(--text-muted);margin-top:3px">${esc(String(event.detail).slice(0, 220))}${String(event.detail).length > 220 ? '...' : ''}</div>` : ''}
            <div style="font-size:10px;color:var(--text-muted);margin-top:3px">${timeAgo(event.at)}${event.prUrl ? ` · <a href="${esc(event.prUrl)}" target="_blank" style="color:var(--accent)">PR</a>` : ''}</div>
          </div>
          <button class="btn btn-sm btn-ghost" onclick="viewCodingJob('${esc(event.jobId)}')">View</button>
        </div>`,
      )
      .join('');
    const providerProbeRows = providerProfiles
      .map((profile) => {
        const probe = providerProbeById[profile.id];
        const ok = probe ? probe.ok : false;
        const failed = probe?.checks?.find((check) => !check.ok);
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="min-width:0">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <strong style="font-size:12px">${esc(profile.label || profile.id)}</strong>
              <span class="badge badge-muted" style="font-size:9px">${esc(profile.provider)}/${esc(profile.model)}</span>
              <span class="badge ${ok ? 'badge-success' : 'badge-warning'}" style="font-size:9px">${ok ? 'Probe OK' : 'Needs check'}</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(failed?.detail || probe?.lastProbeAt || profile.toolPolicy)}</div>
          </div>
          <button class="btn btn-sm btn-ghost" onclick="navigate('settings')">Settings</button>
        </div>`;
      })
      .join('');
    const pendingApprovalRows = pendingApprovals
      .slice(0, 8)
      .map(
        (
          approval,
        ) => `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="min-width:0;flex:1">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <span class="badge badge-warning" style="font-size:9px">${esc(approval.kind)}</span>
              <span style="font-size:12px;font-weight:600">${esc(approval.title)}</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${esc(approval.summary.slice(0, 180))}${approval.summary.length > 180 ? '...' : ''}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button class="btn btn-sm btn-primary" onclick="reviewApproval('${esc(approval.id)}','approve')">Approve</button>
            <button class="btn btn-sm btn-ghost" onclick="reviewApproval('${esc(approval.id)}','deny')">Deny</button>
          </div>
        </div>`,
      )
      .join('');

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
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px">
          <div class="card-title" style="margin:0">Agent Cockpit</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${['overview', 'timeline', 'approvals', 'providers']
              .map(
                (mode) =>
                  `<button class="btn btn-sm ${cockpitMode === mode ? 'btn-primary' : 'btn-ghost'}" onclick="setAgentsCockpitMode('${mode}')">${mode}</button>`,
              )
              .join('')}
          </div>
        </div>
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
        ${
          cockpitMode === 'timeline'
            ? `<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px">
              <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Task Progress Stream</div>
              ${codingTimelineRows || '<div class="empty" style="padding:12px">No coding timeline events yet</div>'}
            </div>`
            : ''
        }
        ${
          cockpitMode === 'approvals'
            ? `<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px">
              ${pendingApprovalRows || '<div class="empty" style="padding:12px">No pending approvals</div>'}
            </div>`
            : ''
        }
        ${
          cockpitMode === 'providers'
            ? `<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px">
              ${providerProbeRows || '<div class="empty" style="padding:12px">No provider profiles configured</div>'}
            </div>`
            : ''
        }
      </div>

      ${
        pendingApprovals.length > 0
          ? `<div class="card" style="margin-bottom:16px;border-left:3px solid var(--warning)">
        <div class="card-title">Pending Approvals <span class="badge badge-warning" style="font-size:10px">${pendingApprovals.length}</span></div>
        ${pendingApprovalRows}
      </div>`
          : ''
      }

      ${
        providerProfiles.length > 0
          ? `<div class="card" style="margin-bottom:16px">
        <div class="card-title">Provider Probe Health <span class="badge badge-muted" style="font-size:10px">${providerProfiles.length}</span></div>
        ${providerProbeRows}
      </div>`
          : ''
      }

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Report Studio <span class="badge badge-muted" style="font-size:10px">${reportJobs.length}</span></div>
        <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,.6fr);gap:12px;margin-bottom:14px">
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">New report</div>
            <input class="search-input" id="report-title" placeholder="Report title" style="width:100%;margin-bottom:6px">
            <textarea class="search-input" id="report-request" rows="3" placeholder="What should the report cover?" style="width:100%;resize:vertical;font-family:var(--font);margin-bottom:6px"></textarea>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--text-muted)">
              <label><input type="checkbox" class="report-format" value="markdown" checked> Markdown</label>
              <label><input type="checkbox" class="report-format" value="html"> HTML</label>
              <label><input type="checkbox" class="report-format" value="docx"> DOCX</label>
              <label><input type="checkbox" class="report-format" value="pdf"> PDF</label>
            </div>
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">Approval gates</div>
            <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text-muted);margin-bottom:6px"><input type="checkbox" id="report-require-outline" checked> require outline approval</label>
            <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text-muted);margin-bottom:10px"><input type="checkbox" id="report-require-delivery" checked> require delivery approval</label>
            <button class="btn btn-sm btn-primary" onclick="createReportJobFromStudio()">Create Report</button>
          </div>
        </div>
        ${
          reportJobs.length === 0
            ? '<div class="empty" style="padding:12px">No report jobs yet</div>'
            : reportJobRows
        }
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Artifact Vault <span class="badge badge-muted" style="font-size:10px">${(artifactVault.artifacts || []).length}</span></div>
        <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:12px">
          <input class="search-input" id="artifact-query" placeholder="Search artifacts" style="min-width:220px;flex:1">
          <select class="search-input" id="artifact-kind" style="min-width:130px">
            <option value="">All kinds</option>
            <option value="deliverable">Deliverables</option>
            <option value="group">Group artifacts</option>
          </select>
          <input class="search-input" id="artifact-retention" type="number" min="0" max="3650" value="90" style="width:100px">
          <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text-muted)"><input type="checkbox" id="artifact-expired" checked> expired</label>
          <button class="btn btn-sm btn-ghost" onclick="searchArtifactVault()">Search</button>
        </div>
        <div id="artifact-vault-results">
          ${artifactRows || '<div class="empty" style="padding:12px">No artifacts found</div>'}
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">GitHub Coding Jobs <span class="badge badge-muted" style="font-size:10px">${codingJobs.length}</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">Register repo</div>
            <div style="display:flex;gap:6px;margin-bottom:6px">
              <input class="search-input" id="coding-repo-new" placeholder="owner/repo" style="flex:1">
              <button class="btn btn-sm btn-ghost" onclick="registerCodingRepo()">Add</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              <select class="search-input" id="coding-repo-provider">${codingProviderOptions || '<option value="">Default provider</option>'}</select>
              <input class="search-input" id="coding-repo-model" placeholder="default model">
              <input class="search-input" id="coding-repo-assignee" placeholder="assignee login">
              <input class="search-input" id="coding-repo-milestone" placeholder="milestone">
              <input class="search-input" id="coding-repo-labels" placeholder="default labels" style="grid-column:1/-1">
              <textarea class="search-input" id="coding-repo-rules" rows="2" placeholder="repo coding rules" style="grid-column:1/-1;resize:vertical"></textarea>
              <label style="font-size:12px;color:var(--text-muted);display:flex;gap:6px;align-items:center"><input type="checkbox" id="coding-repo-trusted-pr"> trusted for PR flow</label>
            </div>
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">Pick next issue</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              <select class="search-input" id="coding-repo-select">${codingRepoOptions || '<option value="">No repos registered</option>'}</select>
              <select class="search-input" id="coding-provider-select">${codingProviderOptions || '<option value="claude">Claude</option>'}</select>
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

    // Init model dropdown
    window._toolModels = JSON.parse(modelOptionsJson);
    updateTaskModels();
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

window.setAgentsCockpitMode = function (mode) {
  localStorage.setItem('nanocrab-agents-cockpit-mode', mode);
  if (currentPage === 'agents') navigate('agents');
};

window.createReportJobFromStudio = async function () {
  const title = document.getElementById('report-title')?.value?.trim();
  const request = document.getElementById('report-request')?.value?.trim();
  const outputFormats = [...document.querySelectorAll('.report-format:checked')]
    .map((item) => item.value)
    .filter(Boolean);
  if (!request) {
    toast('Enter a report request', 'warning');
    return;
  }
  try {
    const r = await api('/reports/jobs', {
      method: 'POST',
      body: JSON.stringify({
        title,
        request,
        outputFormats: outputFormats.length ? outputFormats : ['markdown'],
        requireOutlineApproval:
          document.getElementById('report-require-outline')?.checked !== false,
        requireDeliveryApproval:
          document.getElementById('report-require-delivery')?.checked !== false,
      }),
    });
    if (r.ok) {
      toast('Report job created', 'success');
      localStorage.setItem('nanocrab-agents-cockpit-mode', 'approvals');
      navigate('agents');
    } else {
      toast(r.error || 'Failed to create report job', 'error');
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.openReportApproval = function (jobId) {
  localStorage.setItem('nanocrab-agents-cockpit-mode', 'approvals');
  toast(`Review report approval for ${jobId}`, 'info');
  navigate('agents');
};

window.searchArtifactVault = async function () {
  const query = document.getElementById('artifact-query')?.value?.trim() || '';
  const kind = document.getElementById('artifact-kind')?.value || '';
  const retentionDays =
    document.getElementById('artifact-retention')?.value || '90';
  const includeExpired =
    document.getElementById('artifact-expired')?.checked === true;
  const target = document.getElementById('artifact-vault-results');
  if (!target) return;
  target.innerHTML = '<div class="loading">Searching artifacts</div>';
  const result = await api(
    `/artifacts?limit=50&retentionDays=${encodeURIComponent(retentionDays)}&includeExpired=${includeExpired ? 'true' : 'false'}${query ? `&query=${encodeURIComponent(query)}` : ''}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}`,
  );
  const artifacts = result.artifacts || [];
  target.innerHTML = artifacts.length
    ? artifacts
        .map(
          (artifact) => `<div class="channel-card" style="padding:9px 0">
            <div style="flex:1;min-width:0">
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <span class="badge ${artifact.expired ? 'badge-warning' : 'badge-success'}" style="font-size:9px">${artifact.expired ? 'expired' : 'retained'}</span>
                <span class="badge badge-muted" style="font-size:9px">${esc(artifact.kind)}</span>
                <strong style="font-size:13px;color:var(--text)">${esc(artifact.name)}</strong>
              </div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${esc(artifact.relativePath)} · ${Math.max(1, Math.round(artifact.size / 1024))} KB · updated ${timeAgo(artifact.updatedAt)}</div>
              ${
                artifact.sourceLinks?.length
                  ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px">${artifact.sourceLinks
                      .slice(0, 4)
                      .map(
                        (link) =>
                          `<span class="badge badge-info" title="${esc(link.source)}">${esc(link.label.slice(0, 42))}</span>`,
                      )
                      .join('')}</div>`
                  : ''
              }
            </div>
            <div style="font-size:11px;color:var(--text-muted);text-align:right">${artifact.expiresAt ? `expires ${timeAgo(artifact.expiresAt)}` : 'no expiry'}</div>
          </div>`,
        )
        .join('')
    : '<div class="empty" style="padding:12px">No artifacts found</div>';
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
  const defaultProvider = document
    .getElementById('coding-repo-provider')
    ?.value?.trim();
  const defaultModel = document
    .getElementById('coding-repo-model')
    ?.value?.trim();
  const labels = document
    .getElementById('coding-repo-labels')
    ?.value?.split(',')
    .map((label) => label.trim())
    .filter(Boolean);
  const assignee = document
    .getElementById('coding-repo-assignee')
    ?.value?.trim();
  const milestone = document
    .getElementById('coding-repo-milestone')
    ?.value?.trim();
  const codingRules = document.getElementById('coding-repo-rules')?.value || '';
  const trustedForPr =
    document.getElementById('coding-repo-trusted-pr')?.checked === true;
  if (!repo) {
    toast('Enter owner/repo', 'warning');
    return;
  }
  try {
    const r = await api('/agents/coding/repos', {
      method: 'POST',
      body: JSON.stringify({
        repo,
        labels,
        assignee: assignee || undefined,
        milestone: milestone || undefined,
        defaultProvider: defaultProvider || undefined,
        defaultModel: defaultModel || undefined,
        codingRules: codingRules.trim() || undefined,
        trustedForPr,
      }),
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

window.pickCodingIssue = async function () {
  const repo = document.getElementById('coding-repo-select')?.value;
  const provider = document.getElementById('coding-provider-select')?.value;
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
      body: JSON.stringify({ repo, labels, provider, createPr }),
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
    const statusBadge =
      job.status === 'completed' || job.ciStatus === 'success'
        ? 'badge-success'
        : job.status === 'failed' || job.ciStatus === 'failure'
          ? 'badge-error'
          : job.status === 'await_approval' ||
              job.status === 'await_pr_approval'
            ? 'badge-warning'
            : 'badge-info';
    const changedFiles = Array.isArray(job.changedFiles)
      ? job.changedFiles
      : [];
    panel.innerHTML = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span class="badge badge-muted">${esc(job.repo)}</span>
          <span class="badge badge-accent">${esc(job.provider)}/${esc(job.model)}</span>
          <span class="badge ${statusBadge}">${esc(job.status)}</span>
          ${job.ciStatus && job.ciStatus !== 'unknown' ? `<span class="badge badge-muted">CI ${esc(job.ciStatus)}</span>` : ''}
          ${job.issueNumber ? `<span class="badge badge-info">#${job.issueNumber}</span>` : ''}
          ${job.prUrl ? `<a href="${esc(job.prUrl)}" target="_blank" style="color:var(--accent);font-size:12px">Pull request</a>` : ''}
        </div>
        <div style="display:flex;gap:6px">
          ${job.status === 'await_approval' ? `<button class="btn btn-sm btn-primary" onclick="controlCodingJob('${esc(id)}','approve')">Approve</button>` : ''}
          ${job.status === 'await_pr_approval' ? `<button class="btn btn-sm btn-primary" onclick="controlCodingJob('${esc(id)}','open-pr')">Approve PR</button>` : ''}
          ${job.commitSha ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(id)}','refresh-ci')">Refresh CI</button>` : ''}
          <button class="btn btn-sm btn-ghost" onclick="viewCodingJob('${esc(id)}')">Refresh</button>
          <button class="btn btn-sm btn-ghost" onclick="document.getElementById('task-output-panel').style.display='none'">Close</button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
        <strong>Branch:</strong> ${esc(job.branch)}<br>
        <strong>Workspace:</strong> ${esc(job.workspace)}<br>
        <strong>Tests:</strong> ${esc(job.testSummary || 'No structured test summary yet')}
      </div>
      ${
        job.investigationSummary || job.implementationPlan
          ? `<div style="margin-bottom:10px;border:1px solid var(--border);border-radius:8px;padding:10px;background:var(--bg)">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Implementation Plan</div>
        ${job.investigationSummary ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${esc(job.investigationSummary)}</div>` : ''}
        ${job.implementationPlan ? `<pre class="log-viewer" style="max-height:180px;white-space:pre-wrap;margin:0">${esc(job.implementationPlan)}</pre>` : ''}
      </div>`
          : ''
      }
      ${
        changedFiles.length > 0
          ? `<div style="margin-bottom:10px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Changed Files</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">${changedFiles
          .map(
            (file) =>
              `<span class="badge badge-muted" style="font-size:10px">${esc(file)}</span>`,
          )
          .join('')}</div>
      </div>`
          : ''
      }
      ${
        Array.isArray(job.timeline) && job.timeline.length > 0
          ? `<div style="margin-bottom:10px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Timeline</div>
        <div style="display:grid;gap:6px">${job.timeline
          .slice()
          .reverse()
          .slice(0, 12)
          .map(
            (event) =>
              `<div style="display:flex;gap:8px;align-items:flex-start;font-size:11px;color:var(--text-muted)">
                <span class="badge badge-muted" style="font-size:9px">${esc(event.kind)}</span>
                <div style="min-width:0">
                  <div style="color:var(--text);font-weight:600">${esc(event.title)}</div>
                  ${event.detail ? `<div>${esc(event.detail.slice(0, 180))}${event.detail.length > 180 ? '...' : ''}</div>` : ''}
                </div>
              </div>`,
          )
          .join('')}</div>
      </div>`
          : ''
      }
      <pre style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;font-size:11px;max-height:440px;overflow:auto;white-space:pre-wrap;word-break:break-word;color:var(--text)">${esc(job.output || '(no output yet)')}</pre>
    </div>`;
    if (job.status === 'running' || job.status === 'queued') {
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
      if (currentPage === 'agents') navigate('agents');
    } else {
      toast(r.error || 'Coding job action failed', 'error');
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.reviewApproval = async function (id, action) {
  try {
    const r = await api('/approvals/' + encodeURIComponent(id) + '/' + action, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (r.ok) {
      toast(
        `Approval ${action === 'approve' ? 'approved' : 'denied'}`,
        'success',
      );
      if (currentPage === 'agents') navigate('agents');
    } else {
      toast(r.error || 'Approval review failed', 'error');
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
