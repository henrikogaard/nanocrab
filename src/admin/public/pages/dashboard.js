// NanoCrab Admin - Dashboard Page

function dashboardOperatingBriefText(data) {
  const workspaceLaneItems = data.workspaceLaneItems || [];
  const dailyBriefStats = data.dailyBriefStats || [];
  const loadIssues = data.loadIssues || [];
  const lines = [
    'NanoCrab workspace brief',
    '',
    'Next action: ' + (data.dailyBriefTitle || 'Pick the most useful surface'),
    'Why: ' + (data.dailyBriefDetail || 'No detail available'),
    'Action: ' + (data.dailyBriefActionLabel || 'Open'),
    '',
    'Counts',
    dailyBriefStats.length
      ? dailyBriefStats
          .map((stat) => `- ${stat.label}: ${stat.value}`)
          .join('\n')
      : '- No dashboard counts available',
    `Data health: ${loadIssues.length ? loadIssues.join('; ') : 'Dashboard feeds loaded without known fallback.'}`,
    '',
    'Workspace surfaces',
    workspaceLaneItems.length
      ? workspaceLaneItems
          .map(
            (lane) =>
              `- ${lane.label}: ${lane.title}. ${lane.metric}${lane.submetric ? '; ' + lane.submetric : ''}`,
          )
          .join('\n')
      : '- Workspace lane data unavailable',
    '',
    'Use this brief to decide whether to start in Chat, Cowork, Code, or More.',
  ];
  return lines.join('\n');
}

function dashboardKickoffPromptText(data) {
  const workspaceLaneItems = data.workspaceLaneItems || [];
  const loadIssues = data.loadIssues || [];
  const routeHint = data.dailyBriefActionLabel || 'Open the right workspace';
  const laneLines = workspaceLaneItems.length
    ? workspaceLaneItems
        .map(
          (lane) =>
            `- ${lane.label}: ${lane.title}. ${lane.detail} Current signal: ${lane.metric}${lane.submetric ? '; ' + lane.submetric : ''}.`,
        )
        .join('\n')
    : '- Workspace lane signals are not loaded.';
  return [
    'Start my NanoCrab work session.',
    '',
    `Recommended next action: ${data.dailyBriefTitle || 'Review dashboard'}`,
    `Reason: ${data.dailyBriefDetail || 'No current dashboard detail was available.'}`,
    `Open route: ${routeHint}`,
    '',
    'Workspace choice',
    laneLines,
    '',
    'Data confidence',
    loadIssues.length
      ? loadIssues.map((issue) => `- ${issue}`).join('\n')
      : '- Dashboard feeds loaded without known fallback.',
    '',
    'Instructions',
    '- Decide whether this belongs in Chat, Cowork, Code, or More.',
    '- If it needs files, documents, MCP/email/calendar context, or artifacts, use Cowork and save the draft in a project first.',
    '- If it needs repository changes, tests, GitHub Copilot, snippets, or review rules, use Code.',
    '- If it only needs thinking, drafting, or a quick answer, use Chat.',
    '- Use More for settings, credentials, monitoring, channels, audits, memory, and other administration.',
    '- Ask before external writes such as sending email, publishing documents, changing calendars, webhooks, or repo-changing actions.',
    '',
    'Return the first surface to open, the exact first prompt to send, and any approval or credential checks needed.',
  ].join('\n');
}

function renderDashboardDataHealthChip(loadIssues = []) {
  return loadIssues.length
    ? `<span class="dash-data-health is-warning" id="dashboard-data-health-chip">${loadIssues.length} feed${loadIssues.length === 1 ? '' : 's'} need review</span>`
    : '<span class="dash-data-health is-ready" id="dashboard-data-health-chip">Data ready</span>';
}

function updateDashboardRefreshDataHealth(refreshIssues = []) {
  const state = window._dashboardDataHealthState || {};
  const baseIssues = Array.isArray(state.baseLoadIssues)
    ? state.baseLoadIssues
    : Array.isArray(state.loadIssues)
      ? state.loadIssues
      : [];
  const refreshList = Array.isArray(refreshIssues)
    ? refreshIssues.filter(Boolean)
    : [];
  const loadIssues = Array.from(new Set([...baseIssues, ...refreshList]));
  window._dashboardDataHealthState = {
    ...state,
    baseLoadIssues: baseIssues,
    refreshIssues: refreshList,
    loadIssues,
    feedsReady: loadIssues.length === 0,
  };
  const chip = document.getElementById('dashboard-data-health-chip');
  if (chip) chip.outerHTML = renderDashboardDataHealthChip(loadIssues);
}

function cockpitRunHandoffText(state = {}) {
  const session = state.session || {};
  const loadIssues = state.loadIssues || [];
  const timeline = state.timeline || [];
  const artifacts = state.artifacts || [];
  const deliverables = state.deliverables || [];
  const toolEvents = state.toolEvents || [];
  const progressEvents = state.progressEvents || [];
  const approvals = state.approvals || [];
  const changedFiles = Array.isArray(session.changedFiles)
    ? session.changedFiles
    : [];
  const lineItems = (items, mapper, empty) =>
    items.length ? items.slice(0, 8).map(mapper).join('\n') : empty;
  return [
    'NanoCrab cockpit run handoff',
    '',
    `Run: ${session.group || session.id || 'unknown'}`,
    `Status: ${session.status || 'unknown'}`,
    `Provider: ${[session.provider, session.model].filter(Boolean).join(' / ') || 'unknown'}`,
    `Current step: ${session.currentStep || 'No current step recorded.'}`,
    `Started: ${session.startedAt || 'unknown'}`,
    `Updated: ${session.updatedAt || session.lastEventAt || 'unknown'}`,
    `Changed files: ${changedFiles.length}`,
    `Data health: ${loadIssues.length ? loadIssues.join('; ') : 'Cockpit detail loaded without known fallback.'}`,
    '',
    'Timeline:',
    lineItems(
      timeline,
      (event) => `- ${event.title || event.type || 'event'}: ${event.detail || ''}`,
      '- No durable timeline events recorded.',
    ),
    '',
    'Artifacts and deliverables:',
    lineItems(
      artifacts,
      (artifact) => `- Artifact: ${artifact.name || artifact.path || 'artifact'} (${artifact.kind || 'file'}, ${artifact.status || 'recorded'})`,
      '- No artifacts recorded.',
    ),
    lineItems(
      deliverables,
      (item) => `- Deliverable: ${item.title || item.path || 'deliverable'} (${item.status || 'ready'})`,
      '- No deliverables published.',
    ),
    '',
    'Tool and progress signals:',
    lineItems(
      toolEvents,
      (event) => `- ${event.toolName || event.title || event.type}: ${event.status || 'recorded'} ${event.detail || ''}`,
      '- No MCP, file, shell, or connector calls recorded.',
    ),
    lineItems(
      progressEvents,
      (event) => `- ${event.phase || event.title || 'progress'}: ${event.pct || 0}% ${event.detail || ''}`,
      '- No progress stream recorded.',
    ),
    '',
    'Approvals:',
    lineItems(
      approvals,
      (approval) => `- ${approval.title || approval.id}: ${approval.status || 'pending'}`,
      '- No approvals for this run.',
    ),
    '',
    'Next route:',
    '- Use Cowork when this should become a project draft, source ledger, artifact, or MCP-backed follow-up.',
    '- Use Code when changed files, tests, repository work, or PR evidence need continuation.',
    '- Use Approvals before external writes, sends, document publishing, calendar edits, webhooks, or third-party mutations.',
    '- Use Monitoring or Sessions when progress is missing, tool calls are unclear, or the run appears stalled.',
  ].join('\n');
}

function dashRevealStyle(index) {
  const numeric = Number(index);
  const safeIndex = Number.isFinite(numeric)
    ? Math.max(0, Math.min(24, Math.floor(numeric)))
    : 0;
  return `style="--i:${safeIndex}"`;
}

function dashProgressStyle(pct) {
  const numeric = Number(pct);
  const safePct = Number.isFinite(numeric)
    ? Math.max(0, Math.min(100, numeric))
    : 0;
  return `style="--cockpit-progress-pct:${safePct.toFixed(1)}%"`;
}

function dashChartBarStyle(height, index) {
  const numericHeight = Number(height);
  const safeHeight = Number.isFinite(numericHeight)
    ? Math.max(8, Math.min(178, numericHeight))
    : 8;
  const numericIndex = Number(index);
  const safeIndex = Number.isFinite(numericIndex)
    ? Math.max(0, Math.min(60, Math.floor(numericIndex)))
    : 0;
  return `style="--bar-h:${safeHeight.toFixed(1)}px;--bar-i:${safeIndex}"`;
}

function dashEmptyState(options = {}) {
  const tone = options.tone || 'neutral';
  const kicker = options.kicker || 'Nothing here yet';
  const title = options.title || 'No activity recorded';
  const detail = options.detail || 'Once NanoCrab has data for this area, it will appear here.';
  const action = options.action || '';
  const actionLabel = options.actionLabel || '';
  const secondaryAction = options.secondaryAction || '';
  const secondaryLabel = options.secondaryLabel || '';
  return `
    <div class="dash-empty-state is-${esc(tone)}">
      <span>${esc(kicker)}</span>
      <strong>${esc(title)}</strong>
      <p>${esc(detail)}</p>
      ${
        action || secondaryAction
          ? `<div class="dash-empty-actions">
              ${
                action
                  ? `<button type="button" class="btn btn-sm btn-primary" onclick="${action}">${esc(actionLabel || 'Open')}</button>`
                  : ''
              }
              ${
                secondaryAction
                  ? `<button type="button" class="btn btn-sm btn-ghost" onclick="${secondaryAction}">${esc(secondaryLabel || 'More')}</button>`
                  : ''
              }
            </div>`
          : ''
      }
    </div>`;
}

async function renderDashboard(el) {
  const renderLoading = () => {
    el.innerHTML = `
      <div class="dashboard-shell">
        <div class="dashboard-loading-grid" aria-label="Loading dashboard">
          <div class="dash-skeleton dash-skeleton-hero"></div>
          <div class="dash-skeleton dash-skeleton-strip"></div>
          <div class="dash-skeleton dash-skeleton-panel"></div>
          <div class="dash-skeleton dash-skeleton-panel dash-skeleton-offset"></div>
        </div>
      </div>`;
  };

  async function load() {
    renderLoading();

    try {
      const loadIssues = [];
      const [d, cockpitData, approvalData, projectData, taskData, copilotJobsData] =
        await Promise.all([
        api('/system/dashboard'),
        api('/sessions/cockpit').catch(() => {
          loadIssues.push('Cockpit run feed unavailable');
          return [];
        }),
        api('/approvals?status=pending&limit=5').catch(() => {
          loadIssues.push('Approval queue unavailable');
          return [];
        }),
        api('/projects').catch(() => {
          loadIssues.push('Cowork project list unavailable');
          return { projects: [] };
        }),
        api('/tasks').catch(() => {
          loadIssues.push('Routine schedule list unavailable');
          return [];
        }),
        api('/copilot/jobs').catch(() => {
          loadIssues.push('Copilot job queue unavailable');
          return [];
        }),
      ]);
      const channels = Array.isArray(d.channels) ? d.channels : [];
      const containers = Array.isArray(d.containers) ? d.containers : [];
      const groups = Array.isArray(d.groups) ? d.groups : [];
      const messages = Array.isArray(d.messages) ? d.messages : [];
      const cockpitSessions = Array.isArray(cockpitData) ? cockpitData : [];
      const approvals = Array.isArray(approvalData)
        ? approvalData
        : Array.isArray(approvalData?.approvals)
          ? approvalData.approvals
          : [];
      const projects = Array.isArray(projectData?.projects) ? projectData.projects : [];
      const tasks = Array.isArray(taskData) ? taskData : [];
      const copilotJobs = Array.isArray(copilotJobsData) ? copilotJobsData : [];
      const failedLogins = d.failedLogins || 0;
      const blockedIps = d.blockedIps || 0;
      const stats = { daily: Array.isArray(d.daily) ? d.daily : [] };
      const unregCount = 0;
      const alertCount = 0;

      const onlineCh = channels.filter((c) => c.connected).length;
      const totalCh = channels.length;
      const todayMsgs = d.todayCount || 0;
      const latestMessage = messages[0];
      const botResponses = messages.filter((m) => m.is_bot_message);
      const humanMessages = messages.filter((m) => !m.is_bot_message);
      const conversationCount = new Set(
        messages.map((m) => m.chat_jid || m.chat_name).filter(Boolean),
      ).size;
      const healthScore = totalCh
        ? Math.round((onlineCh / Math.max(totalCh, 1)) * 100)
        : 0;
      const securityState =
        failedLogins > 0 || blockedIps > 0 ? 'Needs review' : 'Quiet';

      const hiddenWidgets = JSON.parse(
        localStorage.getItem('hidden_widgets') || '[]',
      );
      const wHiddenClass = (id) =>
        hiddenWidgets.includes(id) ? ' is-hidden' : '';
      const wBtn = (id) =>
        `<button class="widget-hide-btn dash-widget-hide is-hidden" data-widget="${id}" onclick="hideWidget('${id}')" aria-label="Hide widget">x</button>`;

      const channelRows =
        channels
          .map((ch, index) => {
            const runtimeStatus =
              ch.status || (ch.connected ? 'active' : 'offline');
            const status =
              runtimeStatus === 'active'
                ? 'online'
                : runtimeStatus === 'degraded'
                  ? 'idle'
                  : 'offline';
            return `
              <div class="dash-line-item dash-reveal" ${dashRevealStyle(index)}>
                <div class="dash-line-main">
                  <span class="status-dot ${status}"></span>
                  <span class="dash-line-title">${esc(ch.name || 'channel')}</span>
                </div>
                <span class="dash-pill ${runtimeStatus === 'active' ? 'is-good' : 'is-bad'}">${esc(runtimeStatus)}</span>
              </div>`;
          })
          .join('') ||
        dashEmptyState({
          tone: 'setup',
          kicker: 'Channels',
          title: 'Connect a place where NanoCrab can listen.',
          detail: 'Add WhatsApp, Telegram, Signal, or another channel so assistant work can start from real conversations.',
          action: "navigate('channels')",
          actionLabel: 'Open channels',
          secondaryAction: "navigate('integrations')",
          secondaryLabel: 'Review connectors',
        });

      const agentRows =
        groups
          .slice(0, 7)
          .map((g, index) => {
            const channel =
              g.channel ||
              (g.jid?.startsWith('tg:')
                ? 'telegram'
                : g.jid?.startsWith('sig:')
                  ? 'signal'
                  : 'whatsapp');
            const isActive = containers.some(
              (c) =>
                c.groupJid === g.jid ||
                c.groupFolder === g.name ||
                c.groupFolder === g.folder,
            );
            return `
              <div class="dash-agent-row dash-reveal" ${dashRevealStyle(index)}>
                <div>
                  <div class="dash-line-title">${esc(g.name || g.folder || 'Group')}</div>
                  <div class="dash-line-sub">${esc(channel)} channel</div>
                </div>
                <span class="dash-pill ${isActive ? 'is-good' : 'is-idle'}">${isActive ? 'Active' : 'Idle'}</span>
              </div>`;
          })
          .join('') ||
        dashEmptyState({
          tone: 'setup',
          kicker: 'Agents',
          title: 'Register the first assistant workspace.',
          detail: 'Agents give channels, projects, and scheduled work a stable place to run with the right instructions and skills.',
          action: "navigate('agents')",
          actionLabel: 'Open agents',
          secondaryAction: "navigate('skills')",
          secondaryLabel: 'Review skills',
        });

      const activityRows =
        containers
          .slice(0, 6)
          .map((c, index) => {
            const elapsed = c.startedAt
              ? Math.floor(
                  (Date.now() - new Date(c.startedAt).getTime()) / 1000,
                )
              : 0;
            const durStr =
              elapsed > 3600
                ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
                : elapsed > 60
                  ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
                  : `${elapsed}s`;
            const state = c.isTask
              ? 'Task'
              : c.idleWaiting
                ? 'Idle'
                : 'Running';
            return `
              <div class="dash-activity-row dash-reveal" ${dashRevealStyle(index)}>
                <div class="dash-activity-index">${String(index + 1).padStart(2, '0')}</div>
                <div>
                  <div class="dash-line-title">${esc(c.groupFolder || c.groupJid || 'agent')}</div>
                  <div class="dash-line-sub">${c.isTask ? 'Scheduled task' : 'Interactive'} for ${durStr}</div>
                </div>
                <span class="dash-pill ${c.idleWaiting ? 'is-idle' : 'is-good'}">${state}</span>
              </div>`;
          })
          .join('') ||
        dashEmptyState({
          tone: 'idle',
          kicker: 'Agent activity',
          title: 'No agent work is running right now.',
          detail: 'Start a Cowork project, assign a coding job, or create a schedule when you want NanoCrab to pick up work.',
          action: "navigate('projects')",
          actionLabel: 'Open Cowork',
          secondaryAction: "navigate('agents')",
          secondaryLabel: 'Assign work',
        });

      const responseRows = botResponses.length
        ? botResponses
            .slice(0, 4)
            .map(
              (m, index) => `
              <div class="dash-response-row dash-reveal" ${dashRevealStyle(index)}>
                <span>${esc(m.sender_name || 'Bot')}</span>
                <time>${timeAgo(m.timestamp)}</time>
                <p>${esc(truncate(m.content || '', 92))}</p>
              </div>`,
            )
            .join('')
        : dashEmptyState({
            tone: 'quiet',
            kicker: 'Bot responses',
            title: 'No recent assistant replies yet.',
            detail: 'Once chats, channels, routines, or project threads produce responses, the latest useful outputs will appear here.',
            action: "navigate('chat')",
            actionLabel: 'Start Copilot',
            secondaryAction: "navigate('projects')",
            secondaryLabel: 'Open Cowork',
          });

      const feedRows =
        messages
          .slice(0, 9)
          .map(
            (m, index) => `
              <div class="dash-feed-item ${m.is_bot_message ? 'is-bot' : ''} dash-reveal" ${dashRevealStyle(index)}>
                <div class="dash-feed-meta">
                  <span class="dash-feed-sender">${esc(m.sender_name || 'Unknown')}</span>
                  <span>${esc(m.chat_name || m.chat_jid || 'conversation')}</span>
                  <span>${timeAgo(m.timestamp)}</span>
                  ${m.channel ? `<span class="dash-pill is-muted">${esc(m.channel)}</span>` : ''}
                  <button class="dash-pin-btn" onclick="pinMessage('${esc(m.id || '')}','${esc(m.chat_jid || '')}',true)" title="Pin message" aria-label="Pin message"></button>
                </div>
                <div class="dash-feed-content">${esc(truncate(m.content || '', 190))}</div>
              </div>`,
          )
          .join('') ||
        dashEmptyState({
          tone: 'quiet',
          kicker: 'Messages',
          title: 'No recent conversation sample yet.',
          detail: 'Use Copilot for a quick exchange, connect a channel, or open Messages when history starts arriving.',
          action: "navigate('chat')",
          actionLabel: 'Start Copilot',
          secondaryAction: "navigate('messages')",
          secondaryLabel: 'Open messages',
        });

      const selectedCockpitId =
        window._selectedCockpitSessionId ||
        (cockpitSessions[0] ? cockpitSessions[0].id : '');
      const cockpitRows =
        cockpitSessions
          .slice(0, 9)
          .map((session, index) =>
            renderCockpitSessionRow(session, index, selectedCockpitId),
          )
          .join('') ||
        dashEmptyState({
          tone: 'idle',
          kicker: 'Run cockpit',
          title: 'No agent runs captured yet.',
          detail: 'When Cowork, Code, Copilot, or scheduled tasks launch agent work, progress and artifacts will appear here.',
          action: "navigate('projects')",
          actionLabel: 'Start project work',
          secondaryAction: "navigate('tasks')",
          secondaryLabel: 'Schedule routine',
        });
      const selectedCockpit =
        cockpitSessions.find((session) => session.id === selectedCockpitId) ||
        cockpitSessions[0] ||
        null;
      const cockpitCounts = cockpitSessions.reduce(
        (acc, session) => {
          const status = session.status || 'completed';
          if (status === 'running' || status === 'idle') acc.active += 1;
          if (status === 'waiting_approval') acc.waiting += 1;
          if (status === 'failed') acc.failed += 1;
          return acc;
        },
        { active: 0, waiting: 0, failed: 0 },
      );
      const activeProject = projects
        .slice()
        .sort(
          (a, b) =>
            new Date(b.updatedAt || b.updated_at || b.created_at || 0).getTime() -
            new Date(a.updatedAt || a.updated_at || a.created_at || 0).getTime(),
        )[0];
      const dueTasks = tasks
        .filter((task) => task.status === 'active')
        .slice()
        .sort(
          (a, b) =>
            new Date(a.next_run || a.nextRun || 0).getTime() -
            new Date(b.next_run || b.nextRun || 0).getTime(),
        );
      const pendingApprovals = approvals
        .filter((approval) => (approval.status || 'pending') === 'pending')
        .slice(0, 2);
      const activeCopilotJobs = copilotJobs.filter((job) =>
        ['working', 'assigned', 'queued', 'in_progress'].includes(job.status),
      );
      const codeRunCount =
        activeCopilotJobs.length +
        cockpitSessions.filter((session) =>
          (session.changedFiles || []).length > 0 ||
          /code|github|repo|pull|pr/i.test(
            [
              session.group,
              session.provider,
              session.currentStep,
              session.title,
            ]
              .filter(Boolean)
              .join(' '),
          ),
        ).length;
      const attentionSessions = cockpitSessions
        .filter((session) =>
          ['waiting_approval', 'failed', 'running'].includes(
            session.status || 'completed',
          ),
        )
        .slice(0, 2);
      const priorityItems = [
        ...pendingApprovals.map((approval) => ({
          tone: approval.risk === 'high' ? 'bad' : 'warn',
          label: approval.kind === 'tool-action' ? 'MCP approval' : 'Approval',
          title: approval.title || approval.id || 'Pending approval',
          detail:
            approval.resourceSummary ||
            approval.summary ||
            'Review requested external action',
          meta: approval.createdAt ? timeAgo(approval.createdAt) : 'pending',
          action: "navigate('approvals')",
          actionLabel: 'Review',
        })),
        ...attentionSessions.map((session) => ({
          tone:
            session.status === 'failed'
              ? 'bad'
              : session.status === 'waiting_approval'
                ? 'warn'
                : 'good',
          label:
            session.status === 'waiting_approval'
              ? 'Agent waiting'
              : session.status === 'failed'
                ? 'Agent failed'
                : 'Agent running',
          title: session.title || session.groupFolder || session.id || 'Agent run',
          detail:
            session.latestSummary ||
            session.prompt ||
            `${session.approvalCount || 0} approvals, ${session.artifactCount || 0} artifacts`,
          meta: session.updatedAt || session.startedAt ? timeAgo(session.updatedAt || session.startedAt) : 'now',
          action: `selectCockpitSession('${esc(session.id || '')}')`,
          actionLabel: 'Inspect',
        })),
        ...dueTasks.slice(0, 1).map((task) => ({
          tone: task.tool_policy === 'approval-required' ? 'warn' : 'info',
          label: task.delivery_mode === 'webhook' ? 'Scheduled write' : 'Scheduled',
          title: task.title || task.id || 'Scheduled task',
          detail:
            task.description ||
            task.prompt ||
            `${task.schedule_type || 'schedule'} ${task.schedule_value || ''}`,
          meta: task.next_run ? `Due ${timeAgo(task.next_run)}` : 'active',
          action: "navigate('tasks')",
          actionLabel: 'Open',
        })),
        ...(activeProject
          ? [
              {
                tone: 'info',
                label: 'Cowork project',
                title: activeProject.name || activeProject.slug || 'Project workspace',
                detail: `${activeProject.fileCount || 0} files, ${activeProject.chatCount || 0} chats`,
                meta: activeProject.updatedAt || activeProject.updated_at ? timeAgo(activeProject.updatedAt || activeProject.updated_at) : 'recent',
                action: `sessionStorage.setItem('project_focus_id','${esc(activeProject.id || '')}');navigate('projects')`,
                actionLabel: 'Cowork',
              },
            ]
          : []),
      ].slice(0, 6);
      const priorityRows =
        priorityItems
          .map(
            (item, index) => `
              <div class="dash-priority-item is-${item.tone || 'info'} dash-reveal" ${dashRevealStyle(index)}>
                <div class="dash-priority-marker"></div>
                <div class="dash-priority-main">
                  <div class="dash-priority-top">
                    <span>${esc(item.label)}</span>
                    <time>${esc(item.meta || '')}</time>
                  </div>
                  <strong>${esc(item.title)}</strong>
                  <p>${esc(truncate(item.detail || '', 120))}</p>
                </div>
                <button class="btn btn-sm btn-ghost dash-priority-action" onclick="${item.action}">${esc(item.actionLabel || 'Open')}</button>
              </div>`,
          )
          .join('') ||
        dashEmptyState({
          tone: 'ready',
          kicker: 'Priority queue',
          title: 'No urgent work needs attention.',
          detail: 'You can start in Copilot, move a Cowork project forward, or set up a recurring routine for follow-up.',
          action: projects.length > 0 ? "navigate('projects')" : "navigate('chat')",
          actionLabel: projects.length > 0 ? 'Open projects' : 'Start Copilot',
          secondaryAction: "navigate('tasks')",
          secondaryLabel: 'Create routine',
        });
      const nextBest = priorityItems[0] || null;
      const dailyBriefTone =
        loadIssues.length > 0 ||
        pendingApprovals.length > 0 ||
        cockpitCounts.failed > 0 ||
        failedLogins > 0 ||
        blockedIps > 0
          ? 'attention'
          : cockpitCounts.active > 0 || dueTasks.length > 0
            ? 'active'
            : 'ready';
      const dailyBriefTitle = nextBest
        ? nextBest.title
        : loadIssues.length > 0
          ? 'Review workspace data confidence'
        : cockpitCounts.active > 0
          ? 'Keep an eye on active agent work'
          : projects.length > 0
            ? 'Pick the most useful surface'
            : 'Start in Chat, Cowork, or Code';
      const dailyBriefDetail = nextBest
        ? `${nextBest.label}: ${nextBest.detail || 'Open the related workspace.'}`
        : loadIssues.length > 0
          ? `${loadIssues.length} dashboard feed${loadIssues.length === 1 ? '' : 's'} did not load. Open More for monitoring before assuming the day is quiet.`
        : cockpitCounts.active > 0
          ? 'There are active agent runs. Inspect the cockpit if you want to review progress or artifacts.'
          : projects.length > 0
            ? 'No urgent queue items are waiting. Open Cowork and use a project brief, email summary, or document draft.'
            : 'No urgent queue items are waiting. Start in Chat for quick thinking, Cowork for project context, or Code for repository work.';
      const dailyBriefAction = nextBest
        ? nextBest.action
        : loadIssues.length > 0
          ? 'toggleMoreDrawer()'
        : projects.length > 0
          ? "navigate('projects')"
          : "navigate('chat')";
      const dailyBriefActionLabel = nextBest
        ? nextBest.actionLabel || 'Open'
        : loadIssues.length > 0
          ? 'Open More'
        : projects.length > 0
          ? 'Open projects'
          : 'Open Chat';
      const dailyBriefStats = [
        {
          label: 'attention',
          value: priorityItems.length,
        },
        {
          label: 'active',
          value: cockpitCounts.active + activeCopilotJobs.length,
        },
        {
          label: 'projects',
          value: projects.length,
        },
        {
          label: 'data',
          value: loadIssues.length ? 'review' : 'ready',
        },
      ];

      const latestCopy = latestMessage
        ? `${esc(latestMessage.sender_name || 'Latest')}: ${esc(truncate(latestMessage.content || '', 130))}`
        : 'No recent conversation activity.';
      const humanCopy =
        humanMessages.length > 0
          ? `${humanMessages.length} member messages in the current window`
          : 'No member messages in this window';
      const moreStatusCopy = `${todayMsgs} message${todayMsgs === 1 ? '' : 's'} today across ${conversationCount} thread${conversationCount === 1 ? '' : 's'}. ${humanCopy}. ${securityState} security posture.`;
      const activeTasks = tasks.filter((task) => task.status === 'active');
      const mcpApprovalCount = approvals.filter(
        (approval) => approval.kind === 'tool-action',
      ).length;
      const workspaceLaneItems = [
        {
          id: 'chat',
          label: 'Chat',
          title: 'Plain chat',
          detail:
            'Quick thinking, writing, planning, and direct AI conversation without project context.',
          metric: `${conversationCount} thread${conversationCount === 1 ? '' : 's'}`,
          action: "navigate('chat')",
          actionLabel: 'Open Chat',
        },
        {
          id: 'cowork',
          label: 'Cowork',
          title: 'Projects and agent work',
          detail:
            'Project files, MCP-backed chats, documents, approvals, reports, and scheduled routines.',
          metric: `${projects.length} project${projects.length === 1 ? '' : 's'} · ${activeTasks.length} active`,
          submetric: mcpApprovalCount ? `${mcpApprovalCount} MCP approvals` : 'MCP ready when permitted',
          action: "navigate('projects')",
          actionLabel: 'Open projects',
        },
        {
          id: 'code',
          label: 'Code',
          title: 'Repository automation',
          detail:
            'Git workbench, Copilot issue delegation, Autofix pipelines, tests, snippets, and review rules.',
          metric: `${codeRunCount} code run${codeRunCount === 1 ? '' : 's'}`,
          submetric: activeCopilotJobs.length
            ? `${activeCopilotJobs.length} Copilot active`
            : 'Ready for issues',
          action: "navigate('gitcode')",
          actionLabel: 'Open Code',
        },
      ];
      const workspaceLaneRows = workspaceLaneItems
        .map(
          (lane, index) => `
            <button class="dash-workspace-lane dash-primary-lane is-${lane.id} dash-reveal" ${dashRevealStyle(index)} onclick="${lane.action}">
              <span class="dash-workspace-label">${esc(lane.label)}</span>
              <strong>${esc(lane.title)}</strong>
              <p>${esc(lane.detail)}</p>
              <em>${esc(lane.metric)}</em>
              ${lane.submetric ? `<small>${esc(lane.submetric)}</small>` : ''}
              <span class="dash-workspace-action">${esc(lane.actionLabel)}</span>
            </button>`,
        )
        .join('');

      window._dashboardOperatingBrief = dashboardOperatingBriefText({
        dailyBriefTitle,
        dailyBriefDetail,
        dailyBriefActionLabel,
        dailyBriefStats,
        priorityItems,
        workspaceLaneItems,
        loadIssues,
      });
      window._dashboardKickoffPrompt = dashboardKickoffPromptText({
        dailyBriefTitle,
        dailyBriefDetail,
        dailyBriefActionLabel,
        priorityItems,
        workspaceLaneItems,
        loadIssues,
      });
      window._dashboardDataHealthState = {
        baseLoadIssues: loadIssues,
        refreshIssues: [],
        loadIssues,
        feedsReady: loadIssues.length === 0,
      };

      el.innerHTML = `
        <div class="dashboard-shell dash-home-shell">
          <section class="dash-home-hero">
            <div>
              <span class="dash-kicker">Workspace home</span>
              <h2>${esc(botName)}</h2>
              <p>Start with the right surface. Use Chat for quick thinking, Cowork for durable project context, Code for repository work, and More for administration.</p>
            </div>
            <div class="dashboard-toolbar-actions">
              ${renderDashboardDataHealthChip(loadIssues)}
              <button class="btn btn-sm btn-ghost" onclick="copyDashboardOperatingBrief()">Copy brief</button>
              <button class="btn btn-sm btn-ghost" onclick="copyDashboardKickoffPrompt()">Copy kickoff prompt</button>
            </div>
          </section>

          <section class="dash-next-action is-${dailyBriefTone}">
            <div>
              <span class="dash-kicker">Next action</span>
              <h3>${esc(dailyBriefTitle)}</h3>
              <p>${esc(truncate(dailyBriefDetail, 180))}</p>
            </div>
            <div class="dash-next-stats">
              ${dailyBriefStats
                .map(
                  (stat) => `<span><strong>${esc(String(stat.value))}</strong><small>${esc(stat.label)}</small></span>`,
                )
                .join('')}
            </div>
            <button class="btn btn-primary" onclick="${dailyBriefAction}">${esc(dailyBriefActionLabel)}</button>
          </section>

          <section class="dash-primary-lanes" aria-label="Primary workspace surfaces">
            ${workspaceLaneRows}
          </section>

          <section class="dash-more-strip">
            <div>
              <span class="dash-kicker">More</span>
              <strong>Settings, channels, approvals, monitoring, memory, credentials, and recovery stay out of the main path.</strong>
              <p>${esc(moreStatusCopy)}</p>
            </div>
            <button class="btn btn-ghost" onclick="toggleMoreDrawer()">Open More</button>
          </section>

          <section class="dash-quiet-state">
            ${priorityItems.length
              ? `<div class="dash-quiet-list">${priorityRows}</div>`
              : dashEmptyState({
                  tone: 'ready',
                  kicker: 'Ready',
                  title: 'No urgent workspace action is waiting.',
                  detail:
                    'Start in Chat for a quick answer. Open Cowork when files or project context matter. Open Code for repository work.',
                  action: "navigate('chat')",
                  actionLabel: 'Open Chat',
                  secondaryAction: "navigate('projects')",
                  secondaryLabel: 'Open Cowork',
                })}
          </section>
        </div>`;

      window._cockpitSessions = cockpitSessions;
      window._cockpitDetailById = window._cockpitDetailById || {};
      window._selectedCockpitSessionId = selectedCockpit?.id || '';
    } catch (e) {
      el.innerHTML = `
        <div class="dashboard-shell">
          <div class="dash-error-state">
            <div>
              <span class="dash-kicker">Dashboard unavailable</span>
              <h2>Could not load command data</h2>
              <p>${esc(e.message || 'The dashboard API returned an unexpected response.')}</p>
            </div>
            <button class="btn btn-primary" onclick="navigate('dashboard')">Retry</button>
          </div>
        </div>`;
    }
  }

  let lastDashHash = '';
  const smartLoad = async () => {
    const [containersResult, sysResult, cockpitResult] = await Promise.allSettled([
      api('/containers'),
      api('/system'),
      api('/sessions/cockpit'),
    ]);
    if (cockpitResult.status === 'rejected') {
      updateDashboardRefreshDataHealth(['Dashboard smart refresh cockpit feed unavailable']);
      return;
    }
    updateDashboardRefreshDataHealth([]);
    if (containersResult.status === 'rejected' || sysResult.status === 'rejected') {
      return;
    }
    const containers = Array.isArray(containersResult.value)
      ? containersResult.value
      : [];
    const cockpit = Array.isArray(cockpitResult.value) ? cockpitResult.value : [];
    const sys = sysResult.value || {};
    const hash = `${containers.length}|${cockpit.length}|${sys.uptimeFormatted}|${Math.floor(Date.now() / 60000)}`;
    if (hash === lastDashHash) return;
    lastDashHash = hash;
    await load();
  };

  await load();
  poll(smartLoad, 15000);
}

function cockpitStatusClass(status) {
  if (status === 'running' || status === 'completed') return 'is-good';
  if (
    status === 'waiting_approval' ||
    status === 'queued' ||
    status === 'pending'
  )
    return 'is-warn';
  if (status === 'failed' || status === 'cancelled' || status === 'denied')
    return 'is-bad';
  return 'is-idle';
}

function formatCockpitBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderCockpitSessionRow(session, index, selectedId) {
  const status = session.status || 'completed';
  const isActive = selectedId ? session.id === selectedId : index === 0;
  const changed = Array.isArray(session.changedFiles)
    ? session.changedFiles.length
    : 0;
  return `
    <button class="cockpit-session-row dash-reveal ${isActive ? 'active' : ''}" ${dashRevealStyle(index)} data-session-id="${esc(session.id)}" onclick="selectCockpitSession('${esc(session.id)}')">
      <span class="cockpit-status-dot ${status}"></span>
      <span class="cockpit-row-main">
        <strong>${esc(session.group || session.id)}</strong>
        <small>${esc(session.provider || 'provider')} / ${esc(session.model || 'model')}</small>
      </span>
      <span class="cockpit-row-meta">
        <span class="dash-pill ${cockpitStatusClass(status)}">${esc(status.replace(/_/g, ' '))}</span>
        <small>${timeAgo(session.lastEventAt || session.updatedAt || session.startedAt)}</small>
      </span>
      <span class="cockpit-row-step">${esc(truncate(session.currentStep || '', 96))}</span>
      <span class="cockpit-row-counters">${session.approvalCount || 0} approvals · ${session.artifactCount || 0} artifacts · ${changed} files</span>
    </button>`;
}

function renderCockpitDetailShell(session) {
  if (!session)
    return dashEmptyState({
      tone: 'idle',
      kicker: 'Run detail',
      title: 'Select a run to inspect evidence.',
      detail:
        'Choose a cockpit run from the list, or start Cowork project work so timelines, artifacts, approvals, and tool calls can be reviewed here.',
      action: "navigate('projects')",
      actionLabel: 'Start Cowork work',
      secondaryAction: "navigate('sessions')",
      secondaryLabel: 'Open sessions',
    });
  return `
    <div class="cockpit-detail-head">
      <div>
        <span class="dash-kicker">Selected run</span>
        <h4>${esc(session.group || session.id)}</h4>
        <p>${esc(session.currentStep || 'No current step recorded.')}</p>
      </div>
      <div class="cockpit-detail-head-actions">
        <button type="button" class="btn btn-sm btn-ghost" onclick="copyCockpitRunHandoff('${esc(session.id)}')">Copy run handoff</button>
        <span class="dash-pill ${cockpitStatusClass(session.status)}">${esc((session.status || '').replace(/_/g, ' '))}</span>
      </div>
    </div>
    <div class="cockpit-detail-metrics">
      <div><span>Started</span><strong>${session.startedAt ? formatTime(session.startedAt) : '-'}</strong></div>
      <div><span>Updated</span><strong>${session.updatedAt ? timeAgo(session.updatedAt) : '-'}</strong></div>
      <div><span>Events</span><strong>${session.messageCount || 0}</strong></div>
      <div><span>Files</span><strong>${Array.isArray(session.changedFiles) ? session.changedFiles.length : 0}</strong></div>
    </div>
    ${renderCockpitPreviewState('loading')}`;
}

function renderCockpitPreviewState(kind = 'loading') {
  const isError = kind === 'error';
  return `
    <section class="cockpit-preview-loading ${isError ? 'is-error' : ''}" aria-busy="${isError ? 'false' : 'true'}" aria-label="${isError ? 'Cockpit detail failed' : 'Loading cockpit detail'}">
      <div>
        <span>${isError ? 'Cockpit unavailable' : 'Cockpit detail'}</span>
        <strong>${isError ? 'Could not load cockpit detail' : 'Loading run evidence'}</strong>
        <p>${isError ? 'The selected run is still listed. Open Sessions or Monitoring to inspect logs while the detail API recovers.' : 'Gathering timeline, artifacts, deliverables, tools, progress, and approvals for the selected run.'}</p>
      </div>
      <div class="cockpit-preview-bars" aria-hidden="true"><i></i><i></i><i></i></div>
    </section>`;
}

function renderCockpitDetailWarning(message) {
  return `
    <section class="cockpit-detail-warning">
      <strong>Cockpit data needs review</strong>
      <span>${esc(message)}</span>
    </section>`;
}

function renderCockpitSectionEmpty(kind) {
  const states = {
    timeline: {
      title: 'No timeline events recorded',
      body: 'The run has not emitted durable milestones yet. Check progress or logs if the agent appears stalled.',
      action: "navigate('sessions')",
      actionLabel: 'Open Sessions',
    },
    artifacts: {
      title: 'No artifacts recorded',
      body: 'Generated files and reusable outputs will appear here when Cowork, Code, or reports save deliverables.',
      action: "navigate('projects')",
      actionLabel: 'Open Cowork',
    },
    deliverables: {
      title: 'No deliverables published',
      body: 'Downloads and external-ready outputs appear after the agent creates a final artifact or report.',
      action: "navigate('artifacts')",
      actionLabel: 'Artifacts',
    },
    tools: {
      title: 'No tool events recorded',
      body: 'MCP, file, shell, and connector calls will appear here when a tool-capable agent uses them.',
      action: "navigate('monitoring')",
      actionLabel: 'Monitoring',
    },
    progress: {
      title: 'No progress stream yet',
      body: 'The run has not sent live progress events. Keep watching, or inspect sessions and logs before intervening.',
      action: "navigate('sessions')",
      actionLabel: 'Sessions',
    },
    approvals: {
      title: 'No approvals for this run',
      body: 'External writes, MCP actions, and risky changes will show here when they need review.',
      action: "navigate('approvals')",
      actionLabel: 'Approvals',
    },
  };
  const state = states[kind] || states.timeline;
  return `
    <div class="cockpit-section-empty">
      <div>
        <span>Quiet section</span>
        <strong>${esc(state.title)}</strong>
        <p>${esc(state.body)}</p>
      </div>
      <button type="button" class="btn btn-sm btn-ghost" onclick="${state.action}">${esc(state.actionLabel)}</button>
    </div>`;
}

window.selectCockpitSession = function (id) {
  window._selectedCockpitSessionId = id;
  document
    .querySelectorAll('.cockpit-session-row')
    .forEach((row) =>
      row.classList.toggle('active', row.dataset.sessionId === id),
    );
  const session = (window._cockpitSessions || []).find(
    (item) => item.id === id,
  );
  const detail = document.getElementById('cockpit-detail');
  if (detail) detail.innerHTML = renderCockpitDetailShell(session);
  loadCockpitDetail(id);
};

async function loadCockpitDetail(id) {
  const detail = document.getElementById('cockpit-detail');
  if (!detail || !id) return;
  try {
    const loadIssues = [];
    let streamLoadIssue = '';
    const [data, stream] = await Promise.all([
      api(`/sessions/cockpit/${encodeURIComponent(id)}`),
      api(`/sessions/cockpit/${encodeURIComponent(id)}/stream`).catch(() => {
        streamLoadIssue = 'Cockpit progress stream unavailable';
        loadIssues.push(streamLoadIssue);
        return { events: [] };
      }),
    ]);
    const timeline = (data.timeline || [])
      .slice(-8)
      .reverse()
      .map(
        (event) => `
          <div class="cockpit-timeline-item">
            <time>${event.timestamp ? timeAgo(event.timestamp) : '-'}</time>
            <strong>${esc(event.title || event.type || 'event')}</strong>
            <p>${esc(truncate(event.detail || '', 140))}</p>
          </div>`,
      )
      .join('');
    const artifacts = (data.artifacts || [])
      .slice(0, 6)
      .map(
        (artifact) => `
          <div class="cockpit-artifact">
            <strong>${esc(artifact.name || artifact.path || 'artifact')}</strong>
            <small>${esc([artifact.kind || 'file', artifact.status, formatCockpitBytes(artifact.sizeBytes)].filter(Boolean).join(' · '))}</small>
          </div>`,
      )
      .join('');
    const deliverables = (data.deliverables || [])
      .slice(0, 6)
      .map((item) => {
        const href = item.downloadUrl || item.externalUrl || '';
        const action = href
          ? `<a class="btn btn-sm btn-ghost" href="${esc(href)}" ${item.downloadUrl ? 'download' : 'target="_blank" rel="noopener"'}>${item.downloadUrl ? 'Download' : 'Open'}</a>`
          : '';
        return `
          <div class="cockpit-deliverable">
            <div>
              <strong>${esc(item.title || item.path || 'Deliverable')}</strong>
              <small>${esc([item.format || 'file', formatCockpitBytes(item.sizeBytes), item.summary].filter(Boolean).join(' · '))}</small>
            </div>
            <div class="cockpit-deliverable-actions">
              <span class="dash-pill ${cockpitStatusClass(item.status || 'completed')}">${esc(item.status || 'ready')}</span>
              ${action}
            </div>
          </div>`;
      })
      .join('');
    const streamEvents = Array.isArray(stream.events) ? stream.events : [];
    const toolEvents = streamEvents.filter(
      (event) => event.type === 'tool_call' || event.type === 'tool_result',
    );
    const progressStreamEvents = streamEvents.filter(
      (event) => event.type === 'progress',
    );
    const toolTimeline = streamEvents
      .filter(
        (event) => event.type === 'tool_call' || event.type === 'tool_result',
      )
      .slice(-8)
      .reverse()
      .map(
        (event) => `
          <div class="cockpit-tool-event">
            <time>${event.timestamp ? timeAgo(event.timestamp) : '-'}</time>
            <strong>${esc(event.title || event.toolName || event.type)}</strong>
            <small>${esc([event.status, event.duration ? `${event.duration}s` : '', truncate(event.detail || '', 120)].filter(Boolean).join(' · '))}</small>
          </div>`,
      )
      .join('');
    const progressEvents = streamEvents
      .filter((event) => event.type === 'progress')
      .slice(-5)
      .reverse()
      .map((event) => {
        const pct = Math.max(0, Math.min(Number(event.pct || 0), 100));
        return `
          <div class="cockpit-progress-event">
            <div class="cockpit-progress-head">
              <strong>${esc(event.detail || event.title || 'Progress')}</strong>
              <span>${pct}%</span>
            </div>
            <div class="cockpit-progress-track"><span class="cockpit-progress-fill" ${dashProgressStyle(pct)}></span></div>
            <small>${esc([event.phase, event.status].filter(Boolean).join(' · '))}</small>
          </div>`;
      })
      .join('');
    const approvals = (data.approvals || [])
      .slice(0, 5)
      .map(
        (approval) => `
          <div class="cockpit-approval">
            <strong>${esc(approval.title || approval.id)}</strong>
            <span class="dash-pill ${cockpitStatusClass(approval.status === 'pending' ? 'waiting_approval' : approval.status)}">${esc(approval.status || 'pending')}</span>
          </div>`,
      )
      .join('');
    window._cockpitDetailById = window._cockpitDetailById || {};
    window._cockpitDetailById[id] = {
      session: data,
      loadIssues,
      timeline: data.timeline || [],
      artifacts: data.artifacts || [],
      deliverables: data.deliverables || [],
      toolEvents,
      progressEvents: progressStreamEvents,
      approvals: data.approvals || [],
    };
    detail.innerHTML = `
      ${renderCockpitDetailShell(data)}
      ${streamLoadIssue ? renderCockpitDetailWarning('Progress, tool, and live stream events did not load. Use Sessions or Monitoring before assuming the run is quiet.') : ''}
      <div class="cockpit-detail-sections">
        <section>
          <div class="dash-section-label">Timeline</div>
          <div class="cockpit-timeline">${timeline || renderCockpitSectionEmpty('timeline')}</div>
        </section>
        <section>
          <div class="dash-section-label">Artifacts</div>
          <div class="cockpit-artifacts">${artifacts || renderCockpitSectionEmpty('artifacts')}</div>
        </section>
        <section>
          <div class="dash-section-label">Deliverables</div>
          <div class="cockpit-deliverables">${deliverables || renderCockpitSectionEmpty('deliverables')}</div>
        </section>
        <section>
          <div class="dash-section-label">Tool Timeline</div>
          <div class="cockpit-tools">${toolTimeline || renderCockpitSectionEmpty('tools')}</div>
        </section>
        <section>
          <div class="dash-section-label">Progress</div>
          <div class="cockpit-progress">${progressEvents || renderCockpitSectionEmpty('progress')}</div>
        </section>
        <section>
          <div class="dash-section-label">Approvals</div>
          <div class="cockpit-approvals">${approvals || renderCockpitSectionEmpty('approvals')}</div>
        </section>
      </div>`;
    const loading = detail.querySelector('.cockpit-preview-loading');
    if (loading) loading.remove();
  } catch {
    const loading = detail.querySelector('.cockpit-preview-loading');
    if (loading) loading.outerHTML = renderCockpitPreviewState('error');
  }
}

window.copyCockpitRunHandoff = async function (id) {
  const detailState = window._cockpitDetailById?.[id];
  const fallbackSession = (window._cockpitSessions || []).find(
    (session) => String(session.id) === String(id),
  );
  const state = detailState || { session: fallbackSession || { id } };
  await copyTextWithFallback(
    cockpitRunHandoffText(state),
    'Cockpit run handoff copied',
    'Copy cockpit run handoff',
  );
};

window.refreshCockpitDashboard = async function () {
  const list = document.getElementById('cockpit-session-list');
  if (!list) return;
  let refreshIssue = '';
  const sessions = await api('/sessions/cockpit').catch(() => {
    refreshIssue = 'Cockpit run feed unavailable';
    return null;
  });
  if (refreshIssue) {
    list.innerHTML = dashEmptyState({
      tone: 'error',
      kicker: 'Run cockpit',
      title: 'Cockpit run feed unavailable.',
      detail:
        'The dashboard could not refresh current agent runs. Open Monitoring or Sessions before assuming there is no active work.',
      action: "navigate('monitoring')",
      actionLabel: 'Monitoring',
      secondaryAction: "navigate('sessions')",
      secondaryLabel: 'Sessions',
    });
    return;
  }
  window._cockpitSessions = Array.isArray(sessions) ? sessions : [];
  const selectedId =
    window._selectedCockpitSessionId ||
    (window._cockpitSessions[0] ? window._cockpitSessions[0].id : '');
  list.innerHTML =
    window._cockpitSessions
      .slice(0, 9)
      .map((session, index) =>
        renderCockpitSessionRow(session, index, selectedId),
      )
      .join('') ||
    dashEmptyState({
      tone: 'idle',
      kicker: 'Run cockpit',
      title: 'No agent runs captured yet.',
      detail: 'When Cowork, Code, Copilot, or scheduled tasks launch agent work, progress and artifacts will appear here.',
      action: "navigate('projects')",
      actionLabel: 'Start project work',
      secondaryAction: "navigate('tasks')",
      secondaryLabel: 'Schedule routine',
    });
  if (selectedId) {
    window._selectedCockpitSessionId = selectedId;
    loadCockpitDetail(selectedId);
  }
};

async function loadDashboardWeather() {
  const slot = document.getElementById('weather-widget-slot');
  const content = slot?.querySelector('.dash-weather-content');
  if (!slot || !content) return;

  try {
    const data = await api('/system/weather');
    if (!data || data.error) {
      slot.classList.add('is-hidden');
      return;
    }

    const weatherItems = [
      ['Temp', `${data.temperature}&deg;C`, 'Air temperature'],
      ['Wind', `${data.windSpeed}<span>m/s</span>`, esc(data.windDirection)],
      ['Cloud', `${data.cloudCover}%`, 'Cloud cover'],
      ['Pressure', `${data.pressure}<span>hPa</span>`, 'Sea level'],
      ['Humidity', `${data.humidity}%`, 'Relative humidity'],
      ['Rain', `${data.precipitation}<span>mm</span>`, 'Precipitation'],
    ];

    content.innerHTML = `
      <div class="dash-panel dash-weather-panel">
        <div class="dash-panel-header">
          <div>
            <span class="dash-kicker">Weather</span>
            <h3>${esc(data.location || 'Local area')}</h3>
          </div>
          <span class="dash-panel-count">${data.temperature}&deg;</span>
        </div>
        <div class="dash-weather-grid">
          ${weatherItems
            .map(
              ([label, value, detail], index) => `
                <div class="dash-weather-cell dash-reveal" ${dashRevealStyle(index)}>
                  <span>${label}</span>
                  <strong>${value}</strong>
                  <small>${detail}</small>
                </div>`,
            )
            .join('')}
        </div>
      </div>`;
  } catch {
    if (slot) slot.classList.add('is-hidden');
  }
}

function renderChart(daily) {
  if (!daily || daily.length === 0) {
    return dashEmptyState({
      tone: 'quiet',
      kicker: 'Message history',
      title: 'No message history is available yet.',
      detail:
        'Start in Copilot, connect a channel, or review Messages once NanoCrab has conversation data to chart.',
      action: "navigate('chat')",
      actionLabel: 'Start Copilot',
      secondaryAction: "navigate('messages')",
      secondaryLabel: 'Open messages',
    });
  }

  const max = Math.max(...daily.map((d) => d.count), 1);
  const bars = daily
    .map((d, index) => {
      const h = Math.max(8, (d.count / max) * 178);
      return `
        <div class="dash-chart-bar" ${dashChartBarStyle(h, index)}>
          <div class="tooltip">${esc(d.day)}: ${d.count} messages</div>
        </div>`;
    })
    .join('');
  const first = daily[0]?.day?.slice(5) || '';
  const last = daily[daily.length - 1]?.day?.slice(5) || '';

  return `
    <div class="dash-chart">
      <div class="dash-chart-grid">${bars}</div>
      <div class="dash-chart-labels"><span>${esc(first)}</span><span>${esc(last)}</span></div>
    </div>`;
}

function dashboardActionErrorMessage(kind, err) {
  const detail = err?.error || err?.message ? ` Detail: ${err.error || err.message}` : '';
  if (kind === 'restart-channel') {
    return 'Channel restart was not queued. Check channel credentials, adapter health, and monitoring logs before relying on new messages.' + detail;
  }
  return 'Dashboard action could not complete. Refresh command data and check monitoring before retrying.' + detail;
}

window.restartChannel = async (name, btnEl) => {
  inlineConfirm(btnEl, `Restart ${name}?`, async () => {
    try {
      const r = await api(`/system/restart-channel/${name}`, {
        method: 'POST',
      });
      if (r.ok) {
        toast(r.message || 'Restarting...', 'success');
        setTimeout(() => navigate('monitoring'), 3000);
      } else {
        toast(dashboardActionErrorMessage('restart-channel', r), 'error');
      }
    } catch (e) {
      toast(dashboardActionErrorMessage('restart-channel', e), 'error');
    }
  });
};

window.restartService = async (btnEl) => {
  inlineConfirm(btnEl, 'Restart NanoCrab?', async () => {
    await api('/system/restart', { method: 'POST' });
    toast('Restarting... Page will reload in 10 seconds.', 'warning');
    setTimeout(() => location.reload(), 10000);
  });
};

window.copyDashboardOperatingBrief = async () => {
  const text = window._dashboardOperatingBrief || '';
  if (!text) {
    toast('Dashboard brief is not ready', 'error');
    return;
  }
  await copyTextWithFallback(text, 'Dashboard brief copied', 'Copy dashboard brief');
};

window.copyDashboardKickoffPrompt = async () => {
  const text = window._dashboardKickoffPrompt || '';
  if (!text) {
    toast('Dashboard kickoff prompt is not ready', 'error');
    return;
  }
  await copyTextWithFallback(
    text,
    'Dashboard kickoff prompt copied',
    'Copy dashboard kickoff prompt',
  );
};

window.toggleDashboardEditMode = () => {
  const btn = document.getElementById('dashboard-customize-btn');
  const hideBtns = document.querySelectorAll('.widget-hide-btn');
  const isEditing = btn && btn.textContent === 'Done';
  if (isEditing) {
    btn.textContent = 'Customize';
    hideBtns.forEach((b) => b.classList.add('is-hidden'));
  } else {
    if (btn) btn.textContent = 'Done';
    hideBtns.forEach((b) => b.classList.remove('is-hidden'));
  }
};

window.hideWidget = (id) => {
  const hidden = JSON.parse(localStorage.getItem('hidden_widgets') || '[]');
  if (!hidden.includes(id)) hidden.push(id);
  localStorage.setItem('hidden_widgets', JSON.stringify(hidden));
  const widget = document.querySelector(`[data-widget-id="${id}"]`);
  if (widget) widget.classList.add('is-hidden');
  const resetBtn = document.getElementById('dashboard-reset-btn');
  if (resetBtn) resetBtn.classList.remove('is-hidden');
  toast('Widget hidden. Click Reset to restore.', 'info');
};

window.resetDashboardWidgets = () => {
  localStorage.removeItem('hidden_widgets');
  toast('Dashboard reset', 'success');
  navigate('dashboard');
};
