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

function codingDenyNoteId(id) {
  return `coding-deny-note-${String(id || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
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

const TASK_TEMPLATES = {
  bugfix: {
    label: 'Fix regression',
    meta: 'Patch + focused tests',
    prompt:
      'Investigate and fix the regression. Reproduce the issue if possible, identify the smallest responsible code path, make a focused change, add or update tests that would fail before the fix, and run the relevant checks. Summarize the root cause, changed files, and verification result.',
    hint: 'Best when you know the broken behavior or suspect area.',
  },
  review: {
    label: 'Review changes',
    meta: 'Risks before merge',
    prompt:
      'Review the current changes for correctness, regressions, security issues, UX breaks, and missing tests. Lead with actionable findings and include file and line references when possible. If there are no issues, say so and name the remaining risk.',
    hint: 'Use for a pre-merge review or a second set of eyes.',
  },
  docs: {
    label: 'Update docs',
    meta: 'README + operator notes',
    prompt:
      'Update the documentation for this feature or workflow. Keep README, operator notes, setup instructions, and verification steps consistent with the implementation. Prefer concise, task-oriented writing and call out any behavior that changed.',
    hint: 'Use after changing behavior, setup, or operations.',
  },
  test: {
    label: 'Add coverage',
    meta: 'Guard the workflow',
    prompt:
      'Add focused test coverage for this workflow. Follow existing test patterns, cover the edge cases most likely to regress, avoid broad rewrites, and run the targeted test command. Summarize what is covered and what remains untested.',
    hint: 'Use when a feature works but needs safer regression coverage.',
  },
  release: {
    label: 'Release check',
    meta: 'Build + test sweep',
    prompt:
      'Run a release-readiness check for this area. Inspect recent changes, run the relevant typecheck/build/test commands, look for documentation or operator-note gaps, and return a concise go/no-go summary with blockers and follow-up actions.',
    hint: 'Use before tagging, deploying, or handing work back.',
  },
};

function renderTaskTemplateCards() {
  return Object.entries(TASK_TEMPLATES)
    .map(
      ([kind, template]) => `
        <button class="assign-template-card" onclick="applyTaskTemplate('${kind}')" type="button">
          <span class="assign-template-title">${esc(template.label)}</span>
          <span class="assign-template-meta">${esc(template.meta)}</span>
        </button>`,
    )
    .join('');
}

function renderAgentRecoveryState(kind, message, options = {}) {
  const title =
    kind === 'log'
      ? 'Session log could not load'
      : kind === 'coding'
        ? 'Coding job detail could not load'
        : kind === 'task'
          ? 'Task output could not load'
          : 'Agent cockpit could not load';
  const detail =
    kind === 'log'
      ? 'The agent may still be running, or the log file may have rotated. Try the session list again or inspect monitoring logs.'
      : kind === 'coding'
        ? 'The GitHub handoff may still be running or the job record may be unavailable. Check Code, Git Ops, or the test evidence before assigning more work.'
        : kind === 'task'
          ? 'The task record may still be writing output. Refresh the panel, then use monitoring if the output stays unavailable.'
          : 'NanoCrab could not reach the delegation data needed for agents, questions, coding jobs, or active tasks.';
  const retryAction = options.retryAction || "navigate('agents')";
  return `
    <section class="agent-recovery-state is-${esc(kind || 'load')}">
      <div>
        <span>${kind === 'load' ? 'Delegation unavailable' : 'Detail unavailable'}</span>
        <strong>${esc(title)}</strong>
        <p>${esc(detail)}</p>
        ${message ? `<small>${esc(message)}</small>` : ''}
      </div>
      <div class="agent-recovery-actions">
        <button type="button" class="btn btn-sm btn-primary" onclick="${retryAction}">Retry</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Monitoring</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('projects')">Cowork</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('gitcode')">Code</button>
      </div>
    </section>`;
}

function agentActionErrorMessage(kind, err) {
  const message =
    typeof err === 'string'
      ? err
      : err?.message || err?.error || '';
  const detail = message ? `: ${message}` : '';
  if (kind === 'launch') {
    return 'Could not launch the delegated task. Check the selected tool, model, workspace path, and container readiness' + detail;
  }
  if (kind === 'repo') {
    return 'Could not register the coding repo. Confirm the owner/repo name and GitHub access before assigning issues' + detail;
  }
  if (kind === 'rule') {
    return 'Could not save the repo rule. Keep your text in the editor, check the coding repo record, and retry' + detail;
  }
  if (kind === 'issue') {
    return 'Could not start a coding issue handoff. Check repo permissions, labels, provider setup, and Code readiness' + detail;
  }
  if (kind === 'autofix') {
    return 'Could not enable Autofix pickup. Check the GitHub repo, label, provider, and Autofix plugin settings' + detail;
  }
  if (kind === 'cancel-task') {
    return 'Could not cancel the delegated task. It may have already finished; refresh the task history before retrying' + detail;
  }
  if (kind === 'share-task') {
    return 'Could not prepare the task summary for sharing. Refresh the task output and try again' + detail;
  }
  if (kind === 'bot-agent') {
    return 'Could not update the bot agent. Check channel state and keep at least one primary bot enabled' + detail;
  }
  if (kind === 'primary-bot') {
    return 'Could not set the primary bot. Confirm the bot is enabled and the group record is available' + detail;
  }
  if (kind === 'coding-job') {
    return 'Could not update the coding job. Refresh the job evidence, check approvals or CI state, and retry' + detail;
  }
  if (kind === 'answer') {
    return 'Could not send the agent decision. Refresh pending questions before answering again' + detail;
  }
  if (kind === 'message') {
    return 'Could not send the agent message. Check both agent groups are available and retry' + detail;
  }
  return 'Agent action could not complete. Refresh the delegation cockpit and retry' + detail;
}

function renderAgentLoadingState(kind = 'cockpit') {
  const states = {
    cockpit: {
      title: 'Loading delegation cockpit',
      detail:
        'Collecting bot agents, channels, pending questions, approvals, coding jobs, and active tasks before you assign more work.',
      steps: ['Agents', 'Questions', 'Approvals', 'Jobs'],
    },
    coding: {
      title: 'Loading coding job evidence',
      detail:
        'Reading branch, workspace, diff, logs, tests, CI, and approval gates before you decide the next Code action.',
      steps: ['Branch', 'Diff', 'Tests', 'CI'],
    },
    log: {
      title: 'Loading session log',
      detail:
        'Opening the agent run transcript so you can inspect progress, tool output, and failure context.',
      steps: ['Session', 'Output', 'Events'],
    },
    task: {
      title: 'Loading task output',
      detail:
        'Reading one-off agent output, exit status, and shareable evidence for this delegated task.',
      steps: ['Task', 'Status', 'Output'],
    },
  };
  const state = states[kind] || states.cockpit;
  return `
    <section class="agent-loading-state is-${esc(kind)}" aria-busy="true" aria-label="${esc(state.title)}">
      <div>
        <span>${kind === 'cockpit' ? 'Delegation loading' : 'Evidence loading'}</span>
        <strong>${esc(state.title)}</strong>
        <p>${esc(state.detail)}</p>
      </div>
      <div class="agent-loading-flow">
        ${state.steps.map((step) => `<span>${esc(step)}</span>`).join('')}
      </div>
    </section>`;
}

function agentDelegationBriefText(state) {
  const stats = state?.stats || [];
  const attentionItems = state?.attentionItems || [];
  const loadIssues = state?.loadIssues || [];
  const coding = state?.coding || {};
  const groups = state?.groups || [];
  const tools = state?.tools || [];
  const tasks = state?.tasks || [];
  const approvals = state?.approvals || [];
  const questions = state?.questions || [];
  const channels = state?.channels || [];
  const enabledAgents = groups.filter((group) => group.enabled !== false);
  const connectedChannels = channels.filter((channel) => channel.connected === true);
  const statLines = stats.map((stat) => `- ${stat.label}: ${stat.count} (${stat.detail})`);
  const attentionLines = attentionItems.map((item) => `- ${item.label}: ${item.detail}`);
  const runningTaskLines = tasks
    .filter((task) => task.isRunning)
    .slice(0, 8)
    .map((task) => `- ${task.tool}/${task.model}: ${task.prompt?.slice(0, 120) || task.id}`);
  const questionLines = questions
    .slice(0, 8)
    .map(
      (question) =>
        `- ${question.group_folder || 'agent'}: ${question.question || 'Question'}${Array.isArray(question.options) && question.options.length ? ` Options: ${question.options.join(', ')}` : ''}`,
    );

  return [
    'Agent delegation brief',
    '',
    `Enabled bot agents: ${enabledAgents.length}`,
    `Available delegate tools: ${tools.filter((tool) => tool.available).length}`,
    `Connected channels: ${connectedChannels.length}/${channels.length}`,
    `Pending approvals: ${approvals.filter((approval) => approval.status === 'pending').length}`,
    `Pending questions: ${questions.length}`,
    `Coding repos: ${coding.repos || 0}`,
    `Active coding jobs: ${coding.active || 0}`,
    `Waiting coding gates: ${coding.waiting || 0}`,
    `Data health: ${loadIssues.length ? loadIssues.join('; ') : 'Delegation feeds loaded without known fallback.'}`,
    '',
    'Use this brief before assigning more work to agents. Resolve approval gates, unanswered questions, and waiting coding jobs before launching additional automation.',
    'Choose Copilot for simple conversation, Cowork projects for artifacts and MCP-backed project work, Code/GitHub handoff for repository changes, and Workflows when a repeated routine needs supervision.',
    'Prefer one clear owner, one expected output, and one verification path per delegated task.',
    '',
    'Delegation readiness checklist',
    '- Pick the lane first: Copilot for conversation, Cowork for project/MCP/document work, Code for repository changes, Workflows for repeatable routines.',
    '- Name the owner, expected output, source context, approval boundary, and proof needed before assigning.',
    '- Keep MCP/email/document/calendar requests in Cowork until sources and artifact paths are visible.',
    '- Do not launch another agent when approvals, unanswered questions, or coding gates already block the lane.',
    '',
    'Delegation stats',
    ...statLines,
    `- Data health: ${loadIssues.length ? 'needs review' : 'ready'} (${loadIssues.length || 0} feed issues)`,
    '',
    'Needs attention',
    ...(attentionLines.length ? attentionLines : ['- No agent blockers right now.']),
    '',
    'Questions waiting for a decision',
    ...(questionLines.length ? questionLines : ['- No unanswered agent questions.']),
    '',
    'Running tasks',
    ...(runningTaskLines.length ? runningTaskLines : ['- No one-off agent tasks are currently running.']),
  ].join('\n');
}

function agentQuestionDecisionBriefText(state) {
  const questions = state?.questions || [];
  const pending = questions.slice(0, 12).map((question) => {
    const options =
      Array.isArray(question.options) && question.options.length
        ? question.options.join(', ')
        : 'free-form answer';
    return `- ${question.group_folder || 'agent'}: ${question.question || 'Question'} | options: ${options}`;
  });
  return [
    'Agent question decision brief',
    '',
    `Pending questions: ${questions.length}`,
    '',
    'Answer these before assigning more automation, because agents are blocked on human intent.',
    '',
    ...(pending.length ? pending : ['- No unanswered agent questions.']),
    '',
    'Decision guidance:',
    '- Answer with the narrowest option that preserves user intent.',
    '- If the question would trigger external sends, document publishing, webhooks, calendar changes, or repository writes, check Approvals first.',
    '- Route project/document/email/calendar context back to Cowork, repository context to Code, and simple clarification back to Copilot.',
    '- Capture the chosen lane, owner, expected output, and verification step when the answer creates follow-up work.',
  ].join('\n');
}

async function renderAgents(el) {
  el.innerHTML = renderAgentLoadingState('cockpit');
  try {
    const loadIssues = [];
    const [
      groupsRaw,
      containers,
      recent,
      plugins,
      tools,
      agentTasks,
      codingRepos,
      codingRepoRules,
      codingJobs,
      agentProviders,
      pendingQuestions,
      agentMsgs,
      approvals,
      reportJobs,
      researchJobs,
      terminals,
      boundaries,
      channelInfo,
    ] = await Promise.all([
      api('/groups').catch(() => {
        loadIssues.push('Bot agent roster unavailable');
        return [];
      }),
      api('/containers').catch(() => {
        loadIssues.push('Active container list unavailable');
        return [];
      }),
      api('/containers/recent').catch(() => {
        loadIssues.push('Recent container history unavailable');
        return [];
      }),
      api('/plugins').catch(() => {
        loadIssues.push('Plugin registry unavailable');
        return [];
      }),
      api('/agents/tools').catch(() => {
        loadIssues.push('Delegate tool catalog unavailable');
        return [];
      }),
      api('/agents/tasks').catch(() => {
        loadIssues.push('Delegated task history unavailable');
        return [];
      }),
      api('/agents/coding/repos').catch(() => {
        loadIssues.push('Coding repo registry unavailable');
        return [];
      }),
      api('/agents/coding/repo-rules').catch(() => {
        loadIssues.push('Coding repo rules unavailable');
        return [];
      }),
      api('/agents/coding/jobs').catch(() => {
        loadIssues.push('Coding job queue unavailable');
        return [];
      }),
      api('/agents/providers').catch(() => {
        loadIssues.push('Agent provider catalog unavailable');
        return [];
      }),
      api('/questions/pending').catch(() => {
        loadIssues.push('Pending agent questions unavailable');
        return [];
      }),
      api('/agents/messages').catch(() => {
        loadIssues.push('Agent message inbox unavailable');
        return [];
      }),
      api('/approvals').catch(() => {
        loadIssues.push('Approval queue unavailable');
        return [];
      }),
      api('/reports/jobs').catch(() => {
        loadIssues.push('Report job queue unavailable');
        return [];
      }),
      api('/research/jobs').catch(() => {
        loadIssues.push('Research job queue unavailable');
        return [];
      }),
      api('/sessions/terminal/active').catch(() => {
        loadIssues.push('Active terminal sessions unavailable');
        return [];
      }),
      api('/agents/boundaries').catch(() => {
        loadIssues.push('Agent boundary policy unavailable');
        return [];
      }),
      api('/channels').catch(() => {
        loadIssues.push('Channel status unavailable');
        return { active: [] };
      }),
    ]);
    const groups = Array.isArray(groupsRaw) ? groupsRaw : [];
    const channels = Array.isArray(channelInfo?.active)
      ? channelInfo.active
      : [];
    const channelById = channels.reduce((acc, channel) => {
      if (channel.id) acc[channel.id] = channel;
      return acc;
    }, {});
    const boundaryByFolder = (boundaries || []).reduce((acc, item) => {
      if (item.folder) acc[item.folder] = item;
      return acc;
    }, {});

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
        const channelStatus = channelById[ch];
        const channelConnected = channelStatus?.connected === true;
        const isActive = !!container;
        const isIdle = container?.idleWaiting;
        const isEnabled = g.enabled !== false;
        const isPrimary = g.isPrimary === true;
        const recentLogs = recent.filter((r) => r.group === g.folder);
        const boundary = boundaryByFolder[g.folder]?.boundary;
        const connectorBadges = (boundary?.connectorIds || [])
          .slice(0, 4)
          .map(
            (connector) =>
              `<span class="badge badge-info agent-bot-mini-badge">${esc(connector)}</span>`,
          )
          .join('');

        let statusBadge, statusColor;
        if (!isEnabled) {
          statusBadge = 'Disabled';
          statusColor = 'badge-muted';
        } else if (!channelStatus || !channelConnected) {
          statusBadge = 'Offline';
          statusColor = 'badge-error';
        } else if (isActive && !isIdle) {
          statusBadge = 'Running';
          statusColor = 'badge-success';
        } else if (isActive && isIdle) {
          statusBadge = 'Idle';
          statusColor = 'badge-warning';
        } else if (channelConnected) {
          statusBadge = 'Active';
          statusColor = 'badge-success';
        } else {
          statusBadge = 'Offline';
          statusColor = 'badge-error';
        }

        const lastActive = g.lastActivity || channelStatus?.lastActiveAt;
        const statusReason =
          channelStatus?.statusReason || 'Channel adapter is not active';

        return `<div class="agent-bot-row ${!isEnabled ? 'is-disabled' : ''}">
        <div class="agent-bot-main">
          <span class="status-dot ${!isEnabled ? '' : channelConnected ? (isActive && isIdle ? 'idle' : 'online') : 'offline'}"></span>
          <div class="agent-bot-copy">
            <div class="agent-bot-titleline">
              <strong class="agent-bot-name">${esc(g.name)}</strong>
              <span class="badge badge-muted agent-bot-badge">${ch}</span>
              ${g.isMain ? '<span class="badge badge-success agent-bot-badge">Persistent</span>' : ''}
              ${isPrimary ? '<span class="badge badge-accent agent-bot-badge">Primary</span>' : ''}
            </div>
            <div class="agent-bot-meta">${lastActive ? 'Active ' + timeAgo(lastActive) : 'No activity'} · ${esc(statusReason)}</div>
            <div class="agent-bot-boundaries">
              <span class="badge badge-muted agent-bot-mini-badge">${esc((boundary?.channelScopes || ['own']).join(','))} channels</span>
              <span class="badge ${boundary?.externalWrites?.allowed ? 'badge-warning' : 'badge-success'} agent-bot-mini-badge">${boundary?.externalWrites?.allowed ? 'writes gated' : 'read/write denied'}</span>
              ${connectorBadges}
            </div>
          </div>
        </div>
        <div class="agent-bot-actions">
          <span class="badge ${statusColor} agent-tool-badge">${statusBadge}</span>
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
        return `<div class="agent-task-row">
        <div class="agent-task-main">
          <div class="agent-task-head">
            <span class="badge badge-muted agent-mini-badge">${esc(t.tool)}</span>
            <span class="badge badge-muted agent-mini-badge">${esc(t.model)}</span>
            <span class="agent-task-prompt">${esc(t.prompt.slice(0, 80))}${t.prompt.length > 80 ? '...' : ''}</span>
          </div>
          <div class="agent-task-meta">${esc(t.workDir)} \u2022 ${timeAgo(t.createdAt)}</div>
        </div>
        <div class="agent-task-actions">
          <span class="badge ${statusBadge} agent-tool-badge">${t.isRunning ? 'Running' : t.status}</span>
          ${t.isRunning ? `<button class="btn btn-sm btn-ghost agent-danger-action" onclick="cancelAgentTask('${t.id}')">Cancel</button>` : ''}
          <button class="btn btn-sm btn-ghost" onclick="viewAgentTask('${t.id}')">View</button>
        </div>
      </div>`;
      })
      .join('');

    const enabledPlugins = plugins.filter((p) => p.enabled);
    const codingProviderOptions = agentProviders
      .filter((p) => p.codingCapable)
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
      .join('');
    const codingModelsByProvider = {};
    const codingProvidersById = {};
    agentProviders.forEach((p) => {
      codingProvidersById[p.id] = p;
      codingModelsByProvider[p.id] = (p.models || []).filter((model) => model.codingCapable !== false);
    });
    const codingRepoOptions = codingRepos
      .map(
        (r) => `<option value="${esc(r.fullName)}">${esc(r.fullName)}</option>`,
      )
      .join('');
    const codingRepoRuleRows =
      codingRepoRules.length === 0
        ? renderAgentCodeEmptyState('rules')
        : codingRepoRules
            .map(
              (rule) => `
        <div class="agent-rule-row">
          <div class="agent-rule-head">
            <strong class="agent-rule-title">${esc(rule.title)}</strong>
            <span class="badge ${rule.status === 'approved' ? 'badge-success' : 'badge-muted'} agent-tool-badge">${esc(rule.status)}</span>
          </div>
          <div class="agent-rule-meta">${esc(rule.repo)} • ${esc(rule.visibility || 'shared')}</div>
          <div class="agent-rule-content">${esc(rule.content)}</div>
        </div>`,
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
        return `<div class="agent-task-row">
        <div class="agent-task-main">
          <div class="agent-task-head">
            <span class="badge badge-muted agent-mini-badge">${esc(job.repo)}</span>
            <span class="badge badge-accent agent-mini-badge">${esc(job.provider)}/${esc(job.model)}</span>
            ${job.issueNumber ? `<span class="badge badge-info agent-mini-badge">#${job.issueNumber}</span>` : ''}
            <span class="agent-task-prompt">${esc((job.issueTitle || job.prompt || job.id).slice(0, 100))}</span>
          </div>
          <div class="agent-task-meta">${esc(job.branch)} \u2022 ${timeAgo(job.createdAt)}${job.prUrl ? ` \u2022 <a class="agent-task-link" href="${esc(job.prUrl)}" target="_blank">PR</a>` : ''}</div>
        </div>
        <div class="agent-task-actions">
          <span class="badge ${statusBadge} agent-tool-badge">${esc(job.status)}</span>
          ${actions}
          <button class="btn btn-sm btn-ghost" onclick="viewCodingJob('${esc(job.id)}')">View</button>
        </div>
      </div>`;
      })
      .join('');
    const pendingApprovalCount = approvals.filter(
      (a) => a.status === 'pending',
    ).length;
    const activeCodingJobCount = codingJobs.filter((job) =>
      codingJobActive(job.status),
    ).length;
    const waitingCodingJobCount = codingJobs.filter((job) =>
      ['await_approval', 'await_pr_approval'].includes(job.status),
    ).length;
    const runningAgentTaskCount = agentTasks.filter((t) => t.isRunning).length;
    const availableToolCount = tools.filter((t) => t.available).length;
    const connectedChannelCount = channels.filter(
      (channel) => channel.connected === true,
    ).length;
    const enabledAgentCount = groups.filter((g) => g.enabled !== false).length;
    const latestApproval = approvals.find((a) => a.status === 'pending');
    const latestCodingJob = codingJobs.find((job) =>
      ['await_approval', 'await_pr_approval'].includes(job.status),
    );
    const latestQuestion = pendingQuestions[0];
    const runningTask = agentTasks.find((t) => t.isRunning);
    const codingBoardTone =
      codingRepos.length === 0
        ? 'attention'
        : waitingCodingJobCount > 0
          ? 'attention'
          : activeCodingJobCount > 0
            ? 'active'
            : 'ready';
    const codingBoardTitle =
      codingRepos.length === 0
        ? 'Register a repo before delegating GitHub work'
        : waitingCodingJobCount > 0
          ? 'Review coding gates before launching more jobs'
          : activeCodingJobCount > 0
            ? 'Coding agents are working issues'
            : 'Ready to pick the next GitHub issue';
    const codingBoardDetail =
      codingRepos.length === 0
        ? 'Add owner/repo once, then agents can pick issues, apply repo rules, and open draft PRs from this board.'
        : waitingCodingJobCount > 0
          ? 'Implementation or PR approval is waiting. Inspect the job queue before assigning more work.'
          : activeCodingJobCount > 0
            ? 'Track active jobs here and use approvals when implementation or PR gates appear.'
            : 'Pick from registered repos and route the next issue to the best available coding provider.';
    const agentStats = [
      {
        label: 'Awaiting you',
        count:
          pendingApprovalCount + pendingQuestions.length + waitingCodingJobCount,
        detail: 'Approvals, questions, and PR gates',
        tone:
          pendingApprovalCount + pendingQuestions.length + waitingCodingJobCount >
          0
            ? 'attention'
            : 'ready',
      },
      {
        label: 'Running',
        count: runningAgentTaskCount + activeCodingJobCount + terminals.length,
        detail: 'Tasks, coding jobs, and terminals',
        tone:
          runningAgentTaskCount + activeCodingJobCount + terminals.length > 0
            ? 'active'
            : 'ready',
      },
      {
        label: 'Delegates',
        count: availableToolCount,
        detail: `${enabledAgentCount} bot agents enabled`,
        tone: availableToolCount > 0 ? 'ready' : 'muted',
      },
      {
        label: 'Channels',
        count: connectedChannelCount,
        detail: `${channels.length} configured channel${channels.length === 1 ? '' : 's'}`,
        tone: connectedChannelCount > 0 ? 'ready' : 'attention',
      },
      {
        label: 'Data health',
        count: loadIssues.length,
        detail: loadIssues.length
          ? 'Feeds need review before broad delegation'
          : 'Delegation feeds loaded',
        tone: loadIssues.length ? 'attention' : 'ready',
      },
    ];
    const agentAttentionItems = [
      pendingApprovalCount > 0
        ? {
            tone: 'attention',
            label: `${pendingApprovalCount} approval${pendingApprovalCount === 1 ? '' : 's'} pending`,
            detail: latestApproval?.title || 'Review approval inbox',
            action: 'Review',
            onclick: "navigate('approvals')",
          }
        : null,
      pendingQuestions.length > 0
        ? {
            tone: 'attention',
            label: `${pendingQuestions.length} question${pendingQuestions.length === 1 ? '' : 's'} waiting`,
            detail: latestQuestion?.question || 'Agents need input',
            action: 'Answer',
            onclick: "scrollToAgentSection('pending-questions-card')",
          }
        : null,
      waitingCodingJobCount > 0
        ? {
            tone: 'active',
            label: `${waitingCodingJobCount} coding gate${waitingCodingJobCount === 1 ? '' : 's'}`,
            detail: latestCodingJob?.issueTitle || latestCodingJob?.prompt || 'Implementation or PR approval needed',
            action: 'Inspect',
            onclick: "scrollToAgentSection('github-coding-jobs')",
          }
        : null,
      runningTask
        ? {
            tone: 'active',
            label: `${runningAgentTaskCount} task${runningAgentTaskCount === 1 ? '' : 's'} running`,
            detail: runningTask.prompt || `${runningTask.tool} is working`,
            action: 'Watch',
            onclick: "scrollToAgentSection('coding-tasks-card')",
          }
        : null,
      codingRepos.length === 0
        ? {
            tone: 'muted',
            label: 'No coding repos registered',
            detail: 'Register a repo before assigning GitHub issues.',
            action: 'Add repo',
            onclick: "openAssignWorkWizard('github')",
          }
        : null,
    ].filter(Boolean);
    window._agentDelegationState = {
      stats: agentStats,
      attentionItems: agentAttentionItems,
      coding: {
        repos: codingRepos.length,
        active: activeCodingJobCount,
        waiting: waitingCodingJobCount,
      },
      groups,
      tools,
      tasks: agentTasks,
      approvals,
      questions: pendingQuestions,
      channels,
      loadIssues,
    };

    el.innerHTML = `
      <div class="page-header agent-page-header">
        <h2>Agents</h2>
        <button class="btn btn-sm btn-primary" onclick="openAssignWorkWizard()">Assign work</button>
      </div>

      <section class="agent-command-center">
        <div class="agent-command-main">
          <div class="agent-command-kicker">Delegation cockpit</div>
          <h3>Assign, approve, and watch agent work</h3>
          <p>Use this surface when work should leave your hands: one-off tasks, GitHub issues, recurring automations, coding agents, and human approval gates.</p>
          <div class="agent-command-actions">
            <button class="btn btn-sm btn-primary" onclick="openAssignWorkWizard('freeform')">Assign work</button>
            <button class="btn btn-sm btn-ghost" onclick="copyAgentDelegationBrief()">Copy delegation brief</button>
            <button class="btn btn-sm btn-ghost" onclick="openAssignWorkWizard('github')">GitHub issue</button>
            <button class="btn btn-sm btn-ghost" onclick="openAssignWorkWizard('autofix')">Auto-pickup</button>
            <button class="btn btn-sm btn-ghost" onclick="navigate('approvals')">Approvals</button>
          </div>
        </div>
        <div class="agent-command-stats">
          ${agentStats
            .map(
              (stat) => `<div class="agent-command-stat is-${stat.tone}">
                <div>
                  <span>${esc(stat.label)}</span>
                  <strong>${stat.count}</strong>
                </div>
                <small>${esc(stat.detail)}</small>
              </div>`,
            )
            .join('')}
        </div>
      </section>

      <section class="agent-attention-panel" aria-label="Agent attention queue">
        <div class="agent-attention-head">
          <div>
            <span>Needs attention</span>
            <small>${agentAttentionItems.length > 0 ? 'Handle blockers before launching more work.' : 'No agent blockers right now.'}</small>
          </div>
          <button class="btn btn-sm btn-ghost" onclick="refresh()">Refresh</button>
        </div>
        ${
          agentAttentionItems.length > 0
            ? agentAttentionItems
                .map(
                  (item) => `<button class="agent-attention-row is-${item.tone}" onclick="${item.onclick}">
                    <span>
                      <strong>${esc(item.label)}</strong>
                      <small>${esc(item.detail).slice(0, 140)}</small>
                    </span>
                    <em>${esc(item.action)}</em>
                  </button>`,
                )
                .join('')
            : '<div class="agent-attention-empty">Ready for the next useful delegation.</div>'
        }
      </section>

      <div id="task-launcher" class="card assign-wizard is-hidden">
        <div class="assign-wizard-head">
          <div>
            <div class="assign-wizard-title">Assign work</div>
            <div class="assign-wizard-subtitle">Start a one-off task, pick a GitHub issue, or enable automatic issue pickup.</div>
          </div>
          <button class="btn btn-sm btn-ghost" onclick="toggleTaskLauncher(false)">Close</button>
        </div>
        <div class="assign-mode-tabs" role="tablist" aria-label="Assignment type">
          <button class="assign-mode is-active" id="assign-mode-freeform" onclick="setAssignMode('freeform')">Freeform task</button>
          <button class="assign-mode" id="assign-mode-github" onclick="setAssignMode('github')">GitHub issue</button>
          <button class="assign-mode" id="assign-mode-autofix" onclick="setAssignMode('autofix')">Auto-pickup</button>
        </div>

        <div class="assign-pane" id="assign-pane-freeform">
          <div class="assign-template-head">
            <div>
              <span>Start from a known outcome</span>
              <small>These prompts include scope, expected result, and verification.</small>
            </div>
          </div>
          <div class="assign-template-row">
            ${renderTaskTemplateCards()}
          </div>
          <div class="assign-form-grid">
            <div class="form-group">
              <label>Tool</label>
              <select class="search-input assign-full-input" id="task-tool" onchange="updateTaskModels()">${toolOptions}</select>
            </div>
            <div class="form-group">
              <label>Model</label>
              <select class="search-input assign-full-input" id="task-model"></select>
            </div>
            <div class="form-group">
              <label>Budget (USD, optional)</label>
              <input class="search-input assign-full-input" id="task-budget" type="number" step="0.1" min="0" placeholder="e.g. 5">
            </div>
          </div>
          <div class="form-group">
            <label>Working directory</label>
            <input class="search-input assign-full-input" id="task-workdir" value="${esc(window._lastWorkDir || window._projectRoot || '.')}" placeholder="/path/to/repo">
          </div>
          <div class="form-group">
            <label>Task description</label>
            <textarea class="search-input assign-prompt-input" id="task-prompt" rows="4" placeholder="Describe the outcome you want, the repo area, and any checks to run."></textarea>
            <div class="field-hint" id="task-prompt-hint">A good task names the target files or workflow, expected behavior, and verification command.</div>
          </div>
          <div class="assign-action-row">
            <button class="btn btn-primary" onclick="launchAgentTask()">Launch Task</button>
            <button class="btn btn-ghost" onclick="toggleTaskLauncher(false)">Cancel</button>
          </div>
        </div>

        <div class="assign-pane is-hidden" id="assign-pane-github">
          <div class="assign-grid-compact">
            <div class="form-group"><label>Repository</label><select class="search-input" id="assign-coding-repo-select">${codingRepoOptions || '<option value="">No repos registered</option>'}</select></div>
            <div class="form-group"><label>Provider</label><select class="search-input" id="assign-coding-provider-select" onchange="updateAssignCodingModels()">${codingProviderOptions || '<option value="claude">Claude</option>'}</select></div>
            <div class="form-group"><label>Model</label><select class="search-input" id="assign-coding-model-select"><option value="">Default model</option></select></div>
            <div class="form-group"><label>Labels</label><input class="search-input" id="assign-coding-labels" placeholder="p0, autofix, bug"></div>
          </div>
          <label class="assign-check"><input type="checkbox" id="assign-coding-create-pr" checked> Create a draft PR when changes are ready</label>
          <div class="assign-action-row">
            <button class="btn btn-primary" onclick="assignPickCodingIssue()">Pick Next Issue</button>
            <button class="btn btn-ghost" onclick="document.getElementById('coding-repo-new')?.focus()">Register Repo Below</button>
          </div>
        </div>

        <div class="assign-pane is-hidden" id="assign-pane-autofix">
          <div class="assign-grid-compact">
            <div class="form-group"><label>Owner</label><input class="search-input" id="assign-af-owner" placeholder="owner"></div>
            <div class="form-group"><label>Repo</label><input class="search-input" id="assign-af-repo" placeholder="nanocrab"></div>
            <div class="form-group"><label>Trigger label</label><input class="search-input" id="assign-af-label" value="autofix"></div>
            <div class="form-group"><label>Provider</label><select class="search-input" id="assign-af-provider" onchange="updateAssignAutofixModels()">${codingProviderOptions || '<option value="claude">Claude</option>'}</select></div>
            <div class="form-group"><label>Model</label><select class="search-input" id="assign-af-model"><option value="">Default model</option></select></div>
            <div class="form-group"><label>Max active jobs</label><input class="search-input" id="assign-af-max-active" type="number" min="1" step="1" value="1"></div>
          </div>
          <label class="assign-check"><input type="checkbox" id="assign-af-create-pr" checked> Open PR flow after implementation</label>
          <div class="assign-action-row">
            <button class="btn btn-primary" onclick="assignCreateAutofixProject()">Enable Auto-Pickup</button>
            <button class="btn btn-ghost" onclick="navigate('autofix')">Open Autofix Settings</button>
            <button class="btn btn-ghost" onclick="navigate('webhooks')">Check Webhook</button>
          </div>
        </div>
      </div>

      <div id="task-output-panel" class="task-output-panel is-hidden"></div>

      <section class="agent-coding-board" id="github-coding-jobs">
        <div class="agent-coding-brief is-${codingBoardTone}">
          <div>
            <span>GitHub handoff</span>
            <strong>${esc(codingBoardTitle)}</strong>
            <p>${esc(codingBoardDetail)}</p>
          </div>
          <div class="agent-coding-brief-stats">
            <span><strong>${codingRepos.length}</strong><small>repos</small></span>
            <span><strong>${activeCodingJobCount}</strong><small>active</small></span>
            <span><strong>${waitingCodingJobCount}</strong><small>gates</small></span>
          </div>
        </div>
        <div class="agent-coding-controls">
          <div class="agent-coding-panel">
            <div class="agent-coding-panel-head">
              <span>Register repo</span>
              <small>Add a repository once, then reuse it for issue pickup and repo rules.</small>
            </div>
            <div class="agent-coding-inline-form">
              <input class="search-input" id="coding-repo-new" placeholder="owner/repo">
              <button class="btn btn-sm btn-ghost" onclick="registerCodingRepo()">Add</button>
            </div>
          </div>
          <div class="agent-coding-panel">
            <div class="agent-coding-panel-head">
              <span>Pick next issue</span>
              <small>Choose labels, provider, and whether the agent should open a draft PR.</small>
            </div>
            <div class="agent-coding-pick-grid">
              <select class="search-input" id="coding-repo-select">${codingRepoOptions || '<option value="">No repos registered</option>'}</select>
              <select class="search-input" id="coding-provider-select" onchange="updateCodingModels()">${codingProviderOptions || '<option value="claude">Claude</option>'}</select>
              <select class="search-input" id="coding-model-select"><option value="">Default model</option></select>
              <input class="search-input" id="coding-labels" placeholder="labels, comma-separated">
              <label class="agent-coding-check"><input type="checkbox" id="coding-create-pr" checked> Create draft PR when changes are ready</label>
              <button class="btn btn-sm btn-primary" onclick="pickCodingIssue()">Pick Issue</button>
            </div>
          </div>
        </div>
        <div class="agent-coding-queue-head">
          <div>
            <span>Coding jobs</span>
            <small>${codingJobs.length} job${codingJobs.length === 1 ? '' : 's'} tracked in this workspace</small>
          </div>
          <button class="btn btn-sm btn-ghost" onclick="refresh()">Refresh</button>
        </div>
        ${
          codingJobs.length === 0
            ? renderAgentCodeEmptyState('jobs')
            : codingJobRows
        }
      </section>

      <div class="card agent-section-card" id="repo-coding-rules-card">
        <div class="card-title">Repo Coding Rules <span class="badge badge-muted agent-tool-badge">${codingRepoRules.length}</span></div>
        <div class="agent-rule-form">
          <label class="agent-rule-field">Repo<select class="search-input" id="repo-rule-repo">${codingRepoOptions || '<option value="">No repos</option>'}</select></label>
          <label class="agent-rule-field">Title<input class="search-input" id="repo-rule-title" placeholder="Use Node 22"></label>
          <label class="agent-rule-field agent-rule-field-wide">Rule<input class="search-input" id="repo-rule-content" placeholder="Run checks through npm scripts"></label>
          <button class="btn btn-sm btn-primary" onclick="saveRepoCodingRule()">Save Rule</button>
        </div>
        ${codingRepoRuleRows}
      </div>

      <div class="card agent-section-card">
        <div class="card-title">Coding Agents</div>
        ${tools
          .filter((t) => t.available)
          .map((t) => {
            const running = agentTasks.filter(
              (j) => j.tool === t.id && j.isRunning,
            ).length;
            return `<div class="agent-tool-row">
            <div class="agent-tool-main">
              <span class="status-dot ${running > 0 ? 'online' : 'idle'}"></span>
              <div>
                <strong>${esc(t.name)}</strong>
                <div class="agent-tool-meta">${t.models.map((m) => m.label).join(', ')}</div>
              </div>
            </div>
            <div class="agent-tool-actions">
              ${running > 0 ? '<span class="badge badge-success agent-tool-badge">' + running + ' running</span>' : '<span class="badge badge-muted agent-tool-badge">Ready</span>'}
              <button class="btn btn-sm btn-ghost" onclick="openAssignWorkWizard('freeform');document.getElementById('task-tool').value='${t.id}';updateTaskModels()">Launch</button>
            </div>
          </div>`;
          })
          .join('')}
        ${tools
          .filter((t) => !t.available)
          .map(
            (
              t,
            ) => `<div class="agent-tool-row is-unavailable">
          <div class="agent-tool-main">
            <span class="status-dot offline"></span>
            <div>
              <strong>${esc(t.name)}</strong>
              <div class="agent-tool-meta">Not installed</div>
            </div>
          </div>
          <span class="badge badge-error agent-tool-badge">Unavailable</span>
        </div>`,
          )
          .join('')}
      </div>

      <div class="card agent-section-card">
        <div class="card-title">Bot Agents <span class="badge badge-muted agent-tool-badge">${groups.length}</span></div>
        ${agentCards}
      </div>

      ${
        agentTasks.length > 0
          ? `<div class="card agent-section-card" id="coding-tasks-card">
        <div class="card-title">Coding Tasks <span class="badge badge-muted agent-tool-badge">${agentTasks.length}</span></div>
        ${taskRows}
      </div>`
          : ''
      }

      ${
        recent.length > 0
          ? `<div class="card agent-section-card">
        <div class="card-title">Recent Sessions <span class="badge badge-muted agent-tool-badge">${recent.length}</span></div>
        ${recent
          .map(
            (
              r,
            ) => `<div class="agent-session-row">
          <div class="agent-session-main">
            <div class="agent-session-head">
              <span class="badge badge-muted agent-mini-badge">${esc(r.group)}</span>
              <span class="agent-session-file">${esc(r.filename)}</span>
            </div>
            <div class="agent-session-meta">${timeAgo(r.timestamp)} \u2022 ${r.size > 1024 ? (r.size / 1024).toFixed(1) + ' KB' : r.size + ' B'}</div>
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
          ? `<div class="card agent-question-card" id="pending-questions-card">
        <div class="card-title agent-question-title">
          <span>Pending Questions <span class="badge badge-warning agent-tool-badge">${pendingQuestions.length}</span></span>
          <button class="btn btn-sm btn-ghost" onclick="copyAgentQuestionDecisionBrief()">Copy question brief</button>
        </div>
        <div class="agent-question-brief">Answer these before assigning more automation. Questions often encode missing user intent, approval risk, or routing between Copilot, Cowork, and Code.</div>
        ${pendingQuestions
          .map(
            (
              q,
            ) => `<div class="agent-question-row">
          <div class="agent-question-text">${esc(q.question)}</div>
          <div class="agent-question-meta">From: ${esc(q.group_folder)} \u2022 ${timeAgo(q.created_at)}</div>
          <div class="agent-question-actions">
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
          ? `<div class="card agent-section-card">
        <div class="card-title">Container Providers</div>
        ${agentProviders
          .map(
            (
              p,
            ) => `<div class="agent-tool-row">
          <div class="agent-tool-main">
            <span class="status-dot ${p.available ? 'online' : 'offline'}"></span>
            <div>
              <strong>${esc(p.name)}</strong>
              <div class="agent-tool-meta">${p.models.map((m) => m.label).join(', ')}</div>
            </div>
          </div>
          <span class="badge ${p.available ? 'badge-success' : 'badge-error'} agent-tool-badge">${p.available ? 'Available' : 'Not installed'}</span>
        </div>`,
          )
          .join('')}
      </div>`
          : ''
      }

      ${
        agentMsgs.length > 0
          ? `<div class="card agent-section-card">
        <div class="card-title">Agent Messages <span class="badge badge-muted agent-tool-badge">${agentMsgs.length}</span></div>
        ${agentMsgs
          .slice(0, 15)
          .map(
            (
              m,
            ) => `<div class="agent-message-row">
          <div class="agent-message-main">
            <div class="agent-message-route">
              <span class="badge badge-muted agent-mini-badge">${esc(m.from_group)}</span>
              <span class="agent-message-arrow">\u2192</span>
              <span class="badge badge-muted agent-mini-badge">${esc(m.to_group)}</span>
              ${m.status === 'unread' ? '<span class="badge badge-warning agent-new-badge">new</span>' : ''}
            </div>
            <div class="agent-message-content">${esc(m.content.length > 120 ? m.content.slice(0, 120) + '...' : m.content)}</div>
            <div class="agent-message-time">${timeAgo(m.created_at)}</div>
          </div>
        </div>`,
          )
          .join('')}
      </div>`
          : ''
      }

      <div class="card agent-section-card">
        <div class="card-title">Send Agent Message</div>
        <div class="agent-message-compose-grid">
          <select class="search-input agent-message-select" id="msg-from">
            ${groups.map((g) => `<option value="${esc(g.folder)}">${esc(g.name)}</option>`).join('')}
          </select>
          <select class="search-input agent-message-select" id="msg-to">
            ${groups.map((g) => `<option value="${esc(g.folder)}">${esc(g.name)}</option>`).join('')}
          </select>
        </div>
        <div class="agent-message-compose-row">
          <input class="search-input agent-message-input" id="msg-content" placeholder="Message content...">
          <button class="btn btn-sm btn-primary" onclick="sendAgentMessage()">Send</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Plugins <span class="badge badge-muted agent-tool-badge">${enabledPlugins.length} enabled</span></div>
        ${enabledPlugins
          .map(
            (p) => `
          <div class="channel-card agent-plugin-row">
            <div><span class="agent-plugin-name">${esc(p.name)}</span> <span class="agent-plugin-version">v${esc(p.version)}</span></div>
            ${p.sidebar ? `<button class="btn btn-sm btn-ghost agent-plugin-action" onclick="navigate('${esc(p.sidebar.id)}')">${esc(p.sidebar.icon)} Open</button>` : ''}
          </div>
        `,
          )
          .join('')}
        <div class="agent-plugin-manage"><a onclick="navigate('settings')">Manage plugins</a></div>
      </div>
    `;

    // Init model dropdowns
    window._toolModels = JSON.parse(modelOptionsJson);
    updateTaskModels();
    window._codingModelsByProvider = codingModelsByProvider;
    window._codingProvidersById = codingProvidersById;
    updateCodingModels();
    updateAssignCodingModels();
    updateAssignAutofixModels();
  } catch (e) {
    el.innerHTML = renderAgentRecoveryState('load', e.message);
  }
}

window.copyAgentDelegationBrief = async function () {
  const state = window._agentDelegationState;
  if (!state) {
    toast('Open Agents first', 'warning');
    return;
  }
  const text = agentDelegationBriefText(state);
  await copyTextWithFallback(
    text,
    'Agent delegation brief copied',
    'Copy agent delegation brief',
  );
};

window.copyAgentQuestionDecisionBrief = async function () {
  const state = window._agentDelegationState;
  if (!state) {
    toast('Open Agents first', 'warning');
    return;
  }
  const text = agentQuestionDecisionBriefText(state);
  await copyTextWithFallback(
    text,
    'Agent question brief copied',
    'Copy agent question brief',
  );
};

window.openAssignWorkWizard = function (mode = 'freeform') {
  const launcher = document.getElementById('task-launcher');
  if (!launcher) return;
  toggleTaskLauncher(true);
  setAssignMode(mode);
  launcher.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.toggleTaskLauncher = function (forceOpen) {
  const launcher = document.getElementById('task-launcher');
  if (!launcher) return;
  const shouldOpen =
    typeof forceOpen === 'boolean'
      ? forceOpen
      : launcher.classList.contains('is-hidden');
  launcher.classList.toggle('is-hidden', !shouldOpen);
};

window.toggleTaskOutputPanel = function (forceOpen) {
  const panel = document.getElementById('task-output-panel');
  if (!panel) return;
  const shouldOpen =
    typeof forceOpen === 'boolean'
      ? forceOpen
      : panel.classList.contains('is-hidden');
  panel.classList.toggle('is-hidden', !shouldOpen);
};

function isTaskOutputPanelOpen() {
  return !document
    .getElementById('task-output-panel')
    ?.classList.contains('is-hidden');
}

window.scrollToAgentSection = function (id) {
  document.getElementById(id)?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
};

window.setAssignMode = function (mode) {
  ['freeform', 'github', 'autofix'].forEach((name) => {
    document
      .getElementById(`assign-mode-${name}`)
      ?.classList.toggle('is-active', name === mode);
    const pane = document.getElementById(`assign-pane-${name}`);
    if (pane) pane.classList.toggle('is-hidden', name !== mode);
  });
};

window.applyTaskTemplate = function (kind) {
  const prompt = document.getElementById('task-prompt');
  if (!prompt) return;
  const template = TASK_TEMPLATES[kind];
  if (!template) return;
  prompt.classList.remove('input-error');
  prompt.value = template.prompt;
  prompt.setSelectionRange(0, 0);
  prompt.scrollTop = 0;
  const hint = document.getElementById('task-prompt-hint');
  if (hint) hint.textContent = template.hint;
  prompt.focus();
};

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
    const promptEl = document.getElementById('task-prompt');
    promptEl?.classList.add('input-error');
    promptEl?.focus();
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
      toggleTaskLauncher(false);
      document.getElementById('task-prompt').value = '';
      // Auto-show output
      viewAgentTask(r.task.id);
      // Refresh the page after a delay
      setTimeout(() => {
        if (currentPage === 'agents') navigate('agents');
      }, 3000);
    } else {
      toast(agentActionErrorMessage('launch', r.error), 'error');
    }
  } catch (e) {
    toast(agentActionErrorMessage('launch', e), 'error');
  }
};

function renderAgentCodeEmptyState(kind) {
  const isRules = kind === 'rules';
  return `
    <section class="agent-code-empty ${isRules ? 'is-rules' : 'is-jobs'}">
      <div>
        <span>${isRules ? 'Repo rules' : 'Coding queue'}</span>
        <strong>${isRules ? 'No repo coding rules saved yet' : 'No dedicated coding jobs yet'}</strong>
        <p>${isRules ? 'Save project-specific conventions so Code agents know which checks, style rules, review boundaries, and PR expectations to follow.' : 'Register a repository, choose labels, and let a coding agent pick up a focused GitHub issue with a draft PR handoff.'}</p>
      </div>
      <div class="agent-code-empty-actions">
        <button class="btn btn-sm btn-primary" type="button" onclick="${isRules ? "document.getElementById('repo-rule-title')?.focus()" : "document.getElementById('coding-repo-new')?.focus()"}">${isRules ? 'Add rule' : 'Register repo'}</button>
        <button class="btn btn-sm btn-ghost" type="button" onclick="${isRules ? "document.getElementById('repo-rule-content')?.focus()" : "document.getElementById('coding-labels')?.focus()"}">${isRules ? 'Write guidance' : 'Pick issue'}</button>
      </div>
    </section>`;
}

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
      toast(agentActionErrorMessage('repo', r.error), 'error');
    }
  } catch (e) {
    toast(agentActionErrorMessage('repo', e), 'error');
  }
};

window.saveRepoCodingRule = async function () {
  const repo = document.getElementById('repo-rule-repo')?.value?.trim();
  const title = document.getElementById('repo-rule-title')?.value?.trim();
  const content = document.getElementById('repo-rule-content')?.value?.trim();
  if (!repo || !title || !content) {
    toast('Choose a repo and enter a rule title and body', 'warning');
    return;
  }
  try {
    const [owner, name] = repo.split('/');
    const r = await api(
      `/agents/coding/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/rules`,
      {
        method: 'POST',
        body: JSON.stringify({
          title,
          content,
          source: 'dashboard',
          visibility: 'shared',
          status: 'approved',
        }),
      },
    );
    if (r.ok) {
      toast('Repo rule saved', 'success');
      navigate('agents');
    } else {
      toast(agentActionErrorMessage('rule', r.error), 'error');
    }
  } catch (e) {
    toast(agentActionErrorMessage('rule', e), 'error');
  }
};

window.updateCodingModels = function () {
  const providerEl = document.getElementById('coding-provider-select');
  const modelEl = document.getElementById('coding-model-select');
  if (!providerEl || !modelEl) return;
  const modelsByProvider = window._codingModelsByProvider || {};
  const provider = (window._codingProvidersById || {})[providerEl.value] || {};
  const models = modelsByProvider[providerEl.value] || [];
  const defaultAllowed = provider.id !== 'ollama';
  modelEl.innerHTML = `${defaultAllowed ? '<option value="">Default model</option>' : ''}${models.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}`;
};

window.updateAssignCodingModels = function () {
  const providerEl = document.getElementById('assign-coding-provider-select');
  const modelEl = document.getElementById('assign-coding-model-select');
  if (!providerEl || !modelEl) return;
  const provider = (window._codingProvidersById || {})[providerEl.value] || {};
  const models = (window._codingModelsByProvider || {})[providerEl.value] || [];
  const defaultAllowed = provider.id !== 'ollama';
  modelEl.innerHTML = `${defaultAllowed ? '<option value="">Default model</option>' : ''}${models.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}`;
};

window.updateAssignAutofixModels = function () {
  const providerEl = document.getElementById('assign-af-provider');
  const modelEl = document.getElementById('assign-af-model');
  if (!providerEl || !modelEl) return;
  const provider = (window._codingProvidersById || {})[providerEl.value] || {};
  const models = (window._codingModelsByProvider || {})[providerEl.value] || [];
  const defaultAllowed = provider.id !== 'ollama';
  modelEl.innerHTML = `${defaultAllowed ? '<option value="">Default model</option>' : ''}${models.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}`;
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
      toast(agentActionErrorMessage('issue', r.error), 'error');
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
    toast(agentActionErrorMessage('issue', e), 'error');
  }
};

window.assignPickCodingIssue = async function () {
  const repo = document.getElementById('assign-coding-repo-select')?.value;
  const provider = document.getElementById('assign-coding-provider-select')?.value;
  const model = document.getElementById('assign-coding-model-select')?.value;
  const labels = document
    .getElementById('assign-coding-labels')
    ?.value?.split(',')
    .map((label) => label.trim())
    .filter(Boolean);
  const createPr =
    document.getElementById('assign-coding-create-pr')?.checked === true;
  if (!repo) {
    toast('Register/select a repo first', 'warning');
    document.getElementById('assign-coding-repo-select')?.focus();
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
      toast(agentActionErrorMessage('issue', r.error), 'error');
      return;
    }
    if (!r.issue) {
      toast('No matching open issue found', 'info');
      return;
    }
    toast(`Started coding job for #${r.issue.number}`, 'success');
    toggleTaskLauncher(false);
    setTimeout(() => {
      if (currentPage === 'agents') navigate('agents');
    }, 1000);
  } catch (e) {
    toast(agentActionErrorMessage('issue', e), 'error');
  }
};

window.assignCreateAutofixProject = async function () {
  const ownerEl = document.getElementById('assign-af-owner');
  const repoEl = document.getElementById('assign-af-repo');
  const owner = ownerEl?.value?.trim();
  const repo = repoEl?.value?.trim();
  if (!owner || !repo) {
    toast('Owner and repo required', 'warning');
    (owner ? repoEl : ownerEl)?.focus();
    return;
  }
  try {
    const r = await api('/autofix/projects', {
      method: 'POST',
      body: JSON.stringify({
        owner,
        repo,
        triggerLabel:
          document.getElementById('assign-af-label')?.value?.trim() ||
          'autofix',
        provider: document.getElementById('assign-af-provider')?.value,
        model:
          document.getElementById('assign-af-model')?.value || undefined,
        createPr: document.getElementById('assign-af-create-pr')?.checked,
        maxActiveJobs: Number(
          document.getElementById('assign-af-max-active')?.value || 1,
        ),
      }),
    });
    if (r.ok) {
      toast('Autofix auto-pickup enabled', 'success');
      toggleTaskLauncher(false);
      navigate('autofix');
    } else {
      toast(agentActionErrorMessage('autofix', r.error), 'error');
    }
  } catch (e) {
    toast(agentActionErrorMessage('autofix', e), 'error');
  }
};

function renderCodingJobStepper(job) {
  const steps = [
    ['queued', 'Queued'],
    ['investigate', 'Investigate'],
    ['plan', 'Plan'],
    ['await_approval', 'Approve'],
    ['implement', 'Implement'],
    ['test', 'Test'],
    ['await_pr_approval', 'PR Approval'],
    ['open_pr', 'Open PR'],
    ['ci_running', 'CI'],
    ['completed', 'Done'],
  ];
  const visualStatus = job.status === 'running' ? 'implement' : job.status;
  const currentIndex = steps.findIndex(([status]) => status === visualStatus);
  const failed = ['failed', 'cancelled'].includes(job.status);
  return `<div class="coding-stepper" aria-label="Coding job progress">
    ${steps
      .map(([status, label], index) => {
        const done =
          job.transitionedAt?.[status] ||
          job.status === 'completed' ||
          (currentIndex > -1 && index < currentIndex);
        const active = status === visualStatus;
        const cls = failed
          ? 'is-muted'
          : active
            ? 'is-active'
            : done
              ? 'is-done'
              : '';
        return `<div class="coding-step ${cls}">
          <span class="coding-step-dot"></span>
          <span>${esc(label)}</span>
        </div>`;
      })
      .join('')}
  </div>`;
}

window.viewCodingJob = async function (id) {
  const panel = document.getElementById('task-output-panel');
  if (!panel) return;
  toggleTaskOutputPanel(true);
  panel.innerHTML = renderAgentLoadingState('coding');
  try {
    const job = await api('/agents/coding/jobs/' + encodeURIComponent(id));
    const statusBadge = codingJobStatusBadge(job.status);
    const actions = [
      job.status === 'await_approval'
        ? `<label class="coding-deny-note-field"><span>Deny note</span><input id="${esc(codingDenyNoteId(id))}" placeholder="Reason or follow-up"></label>`
        : '',
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
      <div class="task-output-head">
        <div class="task-output-badges">
          <span class="badge badge-muted">${esc(job.repo)}</span>
          <span class="badge badge-accent">${esc(job.provider)}/${esc(job.model)}</span>
          <span class="badge ${statusBadge}">${esc(job.status)}</span>
          ${job.issueNumber ? `<span class="badge badge-info">#${job.issueNumber}</span>` : ''}
          ${job.prUrl ? `<a href="${esc(job.prUrl)}" target="_blank" class="task-output-link">Pull request</a>` : ''}
        </div>
        <div class="task-output-actions">
          ${actions}
          <button class="btn btn-sm btn-ghost" onclick="viewCodingJob('${esc(id)}')">Refresh</button>
          <button class="btn btn-sm btn-ghost" onclick="toggleTaskOutputPanel(false)">Close</button>
        </div>
      </div>
      <div class="coding-job-meta">
        <strong>Branch:</strong> ${esc(job.branch)}<br>
        <strong>Workspace:</strong> ${esc(job.workspace)}
      </div>
      ${renderCodingJobStepper(job)}
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
          !document
            .getElementById('task-output-panel')
            ?.classList.contains('is-hidden')
        )
          viewCodingJob(id);
      }, 4000);
    }
  } catch (e) {
    panel.innerHTML = renderAgentRecoveryState('coding', e.message, {
      retryAction: `viewCodingJob('${esc(id)}')`,
    });
  }
};

window.cancelAgentTask = async function (id) {
  try {
    await api('/agents/tasks/' + id + '/cancel', { method: 'POST' });
    toast('Task cancelled', 'success');
    if (currentPage === 'agents') navigate('agents');
  } catch (e) {
    toast(agentActionErrorMessage('cancel-task', e), 'error');
  }
};

window.viewContainerLog = async function (group, filename) {
  const viewer = document.getElementById('container-log-viewer');
  if (!viewer) return;
  viewer.innerHTML = renderAgentLoadingState('log');
  try {
    const res = await api(
      `/logs/${encodeURIComponent(group)}/${encodeURIComponent(filename)}`,
    );
    const lines = res.lines || [];
    viewer.innerHTML = `
      <div class="agent-log-viewer">
        <div class="agent-log-head">
          <span class="agent-log-title">${esc(group)} / ${esc(filename)}</span>
          <button class="btn btn-sm btn-ghost agent-log-close" onclick="document.getElementById('container-log-viewer').innerHTML=''">Close</button>
        </div>
        <pre class="agent-log-body"><code>${esc(lines.join('\n'))}</code></pre>
      </div>`;
  } catch (e) {
    viewer.innerHTML = renderAgentRecoveryState('log', e.message, {
      retryAction: `viewContainerLog('${esc(group)}','${esc(filename)}')`,
    });
  }
};

window.viewAgentTask = async function (id) {
  const panel = document.getElementById('task-output-panel');
  if (!panel) return;
  toggleTaskOutputPanel(true);
  panel.innerHTML = renderAgentLoadingState('task');
  try {
    const task = await api('/agents/tasks/' + id);
    const statusBadge =
      task.status === 'completed'
        ? 'badge-success'
        : task.status === 'running'
          ? 'badge-warning'
          : 'badge-error';
    panel.innerHTML = `<div class="card">
      <div class="task-output-head">
        <div class="task-output-badges">
          <span class="badge badge-muted task-output-badge">${esc(task.tool)}</span>
          <span class="badge badge-muted task-output-badge">${esc(task.model)}</span>
          <span class="badge ${statusBadge} task-output-badge">${task.isRunning ? 'Running' : task.status}</span>
          ${task.exitCode != null ? `<span class="task-output-exit">exit ${task.exitCode}</span>` : ''}
        </div>
        <div class="task-output-actions">
          ${task.isRunning ? `<button class="btn btn-sm btn-ghost" onclick="viewAgentTask('${id}')">Refresh</button>` : ''}
          <button class="btn btn-sm btn-ghost" onclick="shareAgentTask('${id}')">Share</button>
          <button class="btn btn-sm btn-ghost" onclick="toggleTaskOutputPanel(false)">Close</button>
        </div>
      </div>
      <div class="task-output-prompt">
        <strong>Prompt:</strong> ${esc(task.prompt.slice(0, 200))}${task.prompt.length > 200 ? '...' : ''}
      </div>
      <pre class="task-output-log">${esc(task.output || '(no output yet)')}</pre>
    </div>`;
    // Auto-refresh if running
    if (task.isRunning) {
      setTimeout(() => {
        if (isTaskOutputPanelOpen()) viewAgentTask(id);
      }, 3000);
    }
  } catch (e) {
    panel.innerHTML = renderAgentRecoveryState('task', e.message, {
      retryAction: `viewAgentTask('${esc(id)}')`,
    });
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
    toast(agentActionErrorMessage('share-task', e), 'error');
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
      toast(agentActionErrorMessage('bot-agent', r.error), 'error');
    }
  } catch (e) {
    toast(agentActionErrorMessage('bot-agent', e), 'error');
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
      toast(agentActionErrorMessage('primary-bot', r.error), 'error');
    }
  } catch (e) {
    toast(agentActionErrorMessage('primary-bot', e), 'error');
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
      if (isTaskOutputPanelOpen()) {
        await viewCodingJob(id);
      }
      if (currentPage === 'agents') navigate('agents');
    } else {
      toast(agentActionErrorMessage('coding-job', r.error), 'error');
    }
  } catch (e) {
    toast(agentActionErrorMessage('coding-job', e), 'error');
  }
};

window.denyCodingJobImplementation = async function (id) {
  const noteInput = document.getElementById(codingDenyNoteId(id));
  const note =
    noteInput?.value.trim() ||
    'Denied from Agents dashboard';
  try {
    const r = await api('/agents/coding/jobs/' + id + '/deny-implementation', {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
    if (r.ok) {
      toast('Implementation denied', 'success');
      if (isTaskOutputPanelOpen()) {
        await viewCodingJob(id);
      }
      if (currentPage === 'agents') navigate('agents');
    } else {
      toast(agentActionErrorMessage('coding-job', r.error), 'error');
    }
  } catch (e) {
    toast(agentActionErrorMessage('coding-job', e), 'error');
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
      toast(agentActionErrorMessage('answer', r.error), 'error');
    }
  } catch (e) {
    toast(agentActionErrorMessage('answer', e), 'error');
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
      toast(agentActionErrorMessage('message', r.error), 'error');
    }
  } catch (e) {
    toast(agentActionErrorMessage('message', e), 'error');
  }
};
