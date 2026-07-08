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

function codingJobCanOpenPr(job) {
  return job?.status === 'await_pr_approval';
}

function codingJobCanRefreshCi(job) {
  return Boolean(
    job?.commitSha && ['open_pr', 'ci_running', 'completed'].includes(job.status),
  );
}

function codingJobCanRevert(job) {
  return Boolean(
    job?.branch &&
      !['queued', 'investigate', 'plan', 'implement', 'test', 'cancelled'].includes(
        job.status,
      ) &&
      (job.commitSha ||
        job.prUrl ||
        ['await_pr_approval', 'open_pr', 'ci_running', 'completed', 'failed'].includes(
          job.status,
        )),
  );
}

function codingJobCanClosePr(job) {
  return Boolean(job?.prUrl);
}

function deriveCodingStageLaneDetails(status) {
  const visualStatus = status === 'running' ? 'implement' : status;
  if (['queued', 'investigate', 'plan'].includes(visualStatus)) {
    return {
      key: 'investigate',
      label: 'Lane: investigate',
      guidance:
        'Clarify root cause and plan before implementation approval to avoid churn.',
    };
  }
  if (['implement', 'test', 'failed', 'cancelled'].includes(visualStatus)) {
    return {
      key: 'implement',
      label: 'Lane: implement',
      guidance:
        'Focus on minimal code changes, run targeted tests, and capture evidence.',
    };
  }
  if (['await_approval', 'await_pr_approval'].includes(visualStatus)) {
    return {
      key: 'approval',
      label: 'Lane: approval',
      guidance:
        'A gate is waiting on you; approve or deny with a concrete note to unblock delivery.',
    };
  }
  return {
    key: 'delivery',
    label: 'Lane: delivery',
    guidance:
      'Verify PR and CI signals, then close out the handoff with delivery notes.',
  };
}

function deriveCodingProviderFit(job, codingProvidersById = {}) {
  const provider = codingProvidersById[job?.provider];
  const model = (provider?.models || []).find(
    (candidate) =>
      candidate?.id === job?.model ||
      candidate?.name === job?.model ||
      candidate?.model === job?.model,
  );
  if (!provider || provider.codingCapable === false || model?.codingCapable === false) {
    return {
      key: 'review',
      label: 'Provider fit: review',
      guidance:
        'Provider/model metadata is not coding-ready. Confirm the assignment target before retrying.',
    };
  }
  if (!model) {
    return {
      key: 'review',
      label: 'Provider fit: review',
      guidance:
        'Model metadata is missing from this provider profile. Verify model capability before broad rollout.',
    };
  }
  return {
    key: 'strong',
    label: 'Provider fit: strong',
    guidance:
      'Provider and model both advertise coding capability for implementation and testing stages.',
  };
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

function normalizeAgentProfiles(profiles) {
  if (Array.isArray(profiles)) return profiles;
  if (Array.isArray(profiles?.profiles)) return profiles.profiles;
  if (Array.isArray(profiles?.items)) return profiles.items;
  return [];
}

function agentProfileId(profile) {
  return String(
    profile?.id ||
      profile?.handle ||
      profile?.slug ||
      profile?.name ||
      profile?.displayName ||
      'agent-profile',
  );
}

function agentProfileDisplayName(profile) {
  return (
    profile?.displayName ||
    profile?.name ||
    profile?.title ||
    profile?.handle ||
    agentProfileId(profile)
  );
}

function agentProfileHandle(profile) {
  const raw = String(profile?.handle || profile?.slug || agentProfileId(profile));
  return raw.startsWith('@') ? raw : `@${raw}`;
}

function agentProfileArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined);
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function agentProfileItemLabel(item) {
  if (typeof item === 'string') return item;
  if (typeof item === 'number') return String(item);
  return (
    item?.label ||
    item?.name ||
    item?.id ||
    item?.server ||
    item?.scope ||
    item?.kind ||
    'Configured'
  );
}

function agentProfileDomId(id) {
  return String(id || 'agent-profile').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function agentProfileAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function agentProfileFormText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function agentProfileFormList(value) {
  return agentProfileArray(value)
    .map((item) => agentProfileItemLabel(item))
    .join('\n');
}

function agentProfileCsvValue(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function agentProfileNullableText(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : null;
}

function agentProfileControl(form, name) {
  return form?.elements?.namedItem(name) || form?.querySelector(`[name="${name}"]`);
}

function agentProfileFieldValue(form, name) {
  return agentProfileControl(form, name)?.value || '';
}

function agentProfileSetStatus(id, message, type = 'info') {
  const status = document.getElementById(
    `agent-profile-status-${agentProfileDomId(id)}`,
  );
  if (!status) return;
  status.textContent = message || '';
  status.classList.toggle('is-error', type === 'error');
  status.classList.toggle('is-success', type === 'success');
  status.classList.toggle('is-warning', type === 'warning');
}

function agentProfileUpdateLocalProfile(id, patch) {
  const roster = Array.isArray(window._agentProfileRoster)
    ? window._agentProfileRoster
    : [];
  const current =
    roster.find((profile) => agentProfileId(profile) === id) ||
    window._agentProfilesById?.[id] ||
    {};
  const updated = { ...current, ...patch };
  window._agentProfileRoster = roster.map((profile) =>
    agentProfileId(profile) === id ? updated : profile,
  );
  window._agentProfilesById = {
    ...(window._agentProfilesById || {}),
    [id]: updated,
  };
  return updated;
}

function agentProfileRerender(id) {
  const shell = document.getElementById('agent-profile-shell');
  const roster = Array.isArray(window._agentProfileRoster)
    ? window._agentProfileRoster
    : [];
  if (!shell || roster.length === 0) return;
  shell.innerHTML = renderAgentProfileShellContent(roster, id);
}

function agentProfileInitial(profile) {
  return agentProfileDisplayName(profile).trim().charAt(0).toUpperCase() || 'A';
}

function agentProfileActiveRunCount(profile) {
  return (
    profile?.activeRunCount ??
    profile?.activeRuns ??
    profile?.active_runs ??
    profile?.runCounts?.active ??
    profile?.activitySummary?.activeRuns
  );
}

function agentProfileBlockedApprovalCount(profile) {
  const explicit =
    profile?.blockedApprovalCount ??
    profile?.blockedApprovals ??
    profile?.blocked_approvals ??
    profile?.approvals?.blocked ??
    profile?.activitySummary?.blockedApprovals;
  if (explicit !== undefined) return explicit;

  const activity = agentProfileArray(profile?.activity || profile?.activityItems);
  if (activity.length === 0) return undefined;
  return (
    activity.filter((item) =>
      ['approval_blocked', 'blocked', 'await_approval'].includes(
        item?.kind || item?.status || item?.state || '',
      ),
    ).length
  );
}

function agentProfileErrorCount(profile) {
  const explicit =
    profile?.errorCount ??
    profile?.errors ??
    profile?.error_count ??
    profile?.activitySummary?.errors;
  if (explicit !== undefined) return explicit;

  const activity = agentProfileArray(profile?.activity || profile?.activityItems);
  if (activity.length === 0) return undefined;
  return activity.filter((item) =>
    ['error', 'failed', 'failure'].includes(
      item?.kind || item?.status || item?.state || '',
    ),
  ).length;
}

function agentProfileLatestAt(profile) {
  return (
    profile?.lastActivityAt ||
    profile?.latestActivityAt ||
    profile?.last_activity_at ||
    profile?.latestActivity?.at ||
    profile?.activity?.[0]?.at ||
    profile?.activity?.[0]?.createdAt
  );
}

function agentProfileTimestamp(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) || '';
}

function agentProfileLatestLabel(profile) {
  const latest = profile?.latestActivity;
  return (
    (typeof latest === 'string' ? latest : latest?.title || latest?.summary) ||
    profile?.latestActivityLabel ||
    profile?.lastActivity ||
    ''
  );
}

function agentProfileStatus(profile) {
  const enabled = profile?.enabled !== false;
  return {
    enabled,
    label: enabled ? 'Enabled' : 'Disabled',
    badge: enabled ? 'badge-success' : 'badge-muted',
  };
}

function renderAgentProfileBadgeList(items, emptyLabel = 'None configured') {
  const normalized = agentProfileArray(items);
  if (normalized.length === 0) {
    return `<span class="agent-profile-muted">${esc(emptyLabel)}</span>`;
  }
  return `
    <div class="agent-profile-chip-list">
      ${normalized
        .map(
          (item) =>
            `<span class="badge badge-muted agent-profile-chip">${esc(agentProfileItemLabel(item))}</span>`,
        )
        .join('')}
    </div>`;
}

function renderAgentProfileField(label, value) {
  return `
    <div class="agent-profile-field">
      <span>${esc(label)}</span>
      <strong>${value ? esc(value) : 'Not set'}</strong>
    </div>`;
}

function renderAgentProfileEmptyState(kind) {
  const states = {
    loading: {
      className: 'agent-profile-loading-state',
      label: 'Profiles loading',
      title: 'Loading agent profiles',
      detail: 'Reading the profile roster, model policies, capabilities, subscriptions, and recent activity.',
    },
    unavailable: {
      className: 'agent-profile-unavailable-state',
      label: 'Profiles unavailable',
      title: 'Agent profile roster unavailable',
      detail: 'The Agents cockpit is still usable, but the profile feed did not load. Refresh after checking the profile route.',
    },
    empty: {
      className: 'agent-profile-empty-state',
      label: 'No profiles',
      title: 'No agent profiles configured yet',
      detail: 'Task 7 only displays saved profiles. Create and edit profile definitions in the next profile workflow.',
    },
    detail: {
      className: 'agent-profile-empty-state is-detail',
      label: 'No selection',
      title: 'Select a profile',
      detail: 'Pick a profile from the roster to inspect its model, capabilities, subscriptions, and activity.',
    },
    detailUnavailable: {
      className: 'agent-profile-unavailable-state is-detail',
      label: 'Profile detail unavailable',
      title: 'Profile detail could not load',
      detail: 'The roster loaded, but subscriptions and activity did not. Refresh after checking the profile detail route.',
    },
    subscriptions: {
      className: 'agent-profile-empty-state is-subscriptions',
      label: 'Subscriptions',
      title: 'No subscriptions configured',
      detail: 'This profile is not watching any trigger, inbox, issue, or workflow subscription.',
    },
    activity: {
      className: 'agent-profile-empty-state is-activity',
      label: 'Activity',
      title: 'No activity recorded',
      detail: 'No runs, blocked approvals, or errors have been recorded for this profile yet.',
    },
  };
  const state = states[kind] || states.empty;
  return `
    <section class="${state.className}">
      <span>${esc(state.label)}</span>
      <strong>${esc(state.title)}</strong>
      <p>${esc(state.detail)}</p>
    </section>`;
}

function renderAgentProfileRoster(profiles, selectedId) {
  const roster = normalizeAgentProfiles(profiles);
  if (roster.length === 0) return renderAgentProfileEmptyState('empty');

  return `
    <div class="agent-profile-roster" aria-label="Agent profile roster">
      ${roster
        .map((profile, index) => {
          const id = agentProfileId(profile);
          const isActive = id === selectedId;
          const status = agentProfileStatus(profile);
          const activeRuns = agentProfileActiveRunCount(profile);
          const blockedApprovals = agentProfileBlockedApprovalCount(profile);
          const latestAt = agentProfileLatestAt(profile);
          const latestLabel = agentProfileLatestLabel(profile);
          const latestText =
            latestAt && latestLabel
              ? `${latestLabel} - ${timeAgo(latestAt)}`
              : latestAt
                ? `Active ${timeAgo(latestAt)}`
                : latestLabel || 'No recent activity';
          return `
            <button class="agent-profile-row ${isActive ? 'is-active' : ''}" type="button" onclick="selectAgentProfileByIndex(${index})">
              <span class="agent-profile-avatar">${esc(agentProfileInitial(profile))}</span>
              <span class="agent-profile-row-main">
                <span class="agent-profile-row-title">
                  <strong>${esc(agentProfileDisplayName(profile))}</strong>
                  <em>${esc(agentProfileHandle(profile))}</em>
                </span>
                <span class="agent-profile-row-meta">${esc(latestText)}</span>
              </span>
              <span class="agent-profile-row-state">
                <span class="badge ${status.badge} agent-tool-badge">${status.label}</span>
                ${activeRuns !== undefined ? `<span class="badge badge-info agent-tool-badge">${esc(String(activeRuns))} active</span>` : ''}
                ${blockedApprovals !== undefined && blockedApprovals > 0 ? `<span class="badge badge-warning agent-tool-badge">${esc(String(blockedApprovals))} blocked</span>` : ''}
              </span>
            </button>`;
        })
        .join('')}
    </div>`;
}

function renderAgentProfileDetail(profile) {
  if (!profile) return renderAgentProfileEmptyState('detail');

  const id = agentProfileId(profile);
  const detailId = agentProfileDomId(id);

  if (profile.detailUnavailable) {
    return `
      <section class="agent-profile-detail" aria-label="${agentProfileAttr(agentProfileDisplayName(profile))} profile detail unavailable">
        <div class="agent-profile-detail-head">
          <div>
            <span>Selected profile</span>
            <strong>${esc(agentProfileDisplayName(profile))}</strong>
            <small>${esc(agentProfileHandle(profile))}</small>
          </div>
          <span class="badge badge-warning agent-tool-badge">Detail unavailable</span>
        </div>
        ${renderAgentProfileEmptyState('detailUnavailable')}
      </section>`;
  }

  const status = agentProfileStatus(profile);
  const providerProfile =
    profile.providerProfileId ||
    profile.provider_profile_id ||
    profile.providerProfile ||
    profile.provider_profile ||
    profile.model?.profile ||
    profile.runtime?.providerProfile;
  const provider = profile.provider || profile.model?.provider || profile.runtime?.provider;
  const model =
    (typeof profile.model === 'string' ? profile.model : '') ||
    profile.modelId ||
    profile.modelName ||
    profile.model?.id ||
    profile.model?.name ||
    profile.runtime?.model;
  const toolPolicy =
    profile.toolPolicy ||
    profile.tool_policy ||
    profile.policy?.toolPolicy ||
    profile.policy?.tools ||
    profile.runtime?.toolPolicy;
  const capabilities = profile.capabilities || {};
  const taskKinds =
    profile.taskKinds ||
    profile.task_kinds ||
    capabilities.taskKinds ||
    capabilities.tasks;
  const mcpServers =
    profile.allowedMcpServers ||
    profile.allowed_mcp_servers ||
    profile.mcpServers ||
    profile.mcp_servers ||
    capabilities.mcpServers;
  const skills = profile.skills || capabilities.skills;
  const memoryScopes =
    profile.memoryScopes ||
    profile.memory_scopes ||
    capabilities.memoryScopes ||
    capabilities.memory;
  const subscriptions = agentProfileArray(profile.subscriptions);
  const activity = agentProfileArray(profile.activity || profile.activityItems);
  const blockedApprovals = agentProfileBlockedApprovalCount(profile);
  const errors = agentProfileErrorCount(profile);

  const subscriptionRows =
    subscriptions.length === 0
      ? renderAgentProfileEmptyState('subscriptions')
      : subscriptions
          .map((subscription) => {
            const enabled = subscription?.enabled !== false && subscription?.status !== 'disabled';
            const state =
              subscription?.lastRunState ||
              subscription?.runState ||
              subscription?.state ||
              subscription?.status ||
              (enabled ? 'watching' : 'disabled');
            const lastMatchAt = agentProfileTimestamp(
              subscription?.lastMatchAt,
              subscription?.lastMatchedAt,
              subscription?.last_matched_at,
            );
            const lastRunAt = agentProfileTimestamp(
              subscription?.lastRunAt,
              subscription?.last_run_at,
            );
            const lastRunId = subscription?.lastRunId || subscription?.last_run_id;
            const lastMatch = lastMatchAt
              ? `Matched ${timeAgo(lastMatchAt)}`
              : 'No matches yet';
            const lastRun = lastRunAt
              ? `Run ${timeAgo(lastRunAt)}`
              : lastRunId
                ? `Run ${lastRunId}`
              : 'No runs yet';
            return `
              <div class="agent-profile-subscription-row ${enabled ? '' : 'is-disabled'}">
                <div>
                  <strong>${esc(subscription?.name || subscription?.title || subscription?.id || 'Subscription')}</strong>
                  <span>${esc(subscription?.kind || subscription?.trigger || subscription?.source || subscription?.sourceType || 'subscription')}</span>
                  <small>${esc(lastMatch)} - ${esc(lastRun)}</small>
                </div>
                <span class="badge ${enabled ? 'badge-info' : 'badge-muted'} agent-tool-badge">${esc(state)}</span>
              </div>`;
          })
          .join('');

  const activityRows =
    activity.length === 0
      ? renderAgentProfileEmptyState('activity')
      : activity
          .map((item) => {
            const state = item?.status || item?.state || item?.kind || item?.type || 'activity';
            const stateClass = ['blocked', 'approval_blocked', 'await_approval'].includes(state)
              ? 'is-blocked'
              : ['error', 'failed', 'failure'].includes(state)
                ? 'is-error'
                : '';
            const at = item?.at || item?.createdAt || item?.updatedAt;
            return `
              <div class="agent-profile-activity-row ${stateClass}">
                <div>
                  <strong>${esc(item?.title || item?.summary || item?.id || 'Activity')}</strong>
                  <span>${esc(item?.detail || item?.message || state)}</span>
                </div>
                <small>${at ? timeAgo(at) : esc(state)}</small>
              </div>`;
          })
          .join('');

  return `
    <section class="agent-profile-detail" aria-label="${agentProfileAttr(agentProfileDisplayName(profile))} profile detail">
      <div class="agent-profile-detail-head">
        <div>
          <span>Selected profile</span>
          <strong>${esc(agentProfileDisplayName(profile))}</strong>
          <small>${esc(agentProfileHandle(profile))}</small>
        </div>
        <span class="badge ${status.badge} agent-tool-badge">${status.label}</span>
      </div>
      <div class="agent-profile-tabs" role="tablist" aria-label="Profile detail sections">
        <span class="agent-profile-tab is-active" role="tab" aria-selected="true">Identity</span>
        <span class="agent-profile-tab" role="tab">Model</span>
        <span class="agent-profile-tab" role="tab">Capabilities</span>
        <span class="agent-profile-tab" role="tab">Subscriptions</span>
        <span class="agent-profile-tab" role="tab">Activity</span>
      </div>
      <div class="agent-profile-action-bar">
        <span class="agent-profile-action-status" id="agent-profile-status-${agentProfileAttr(detailId)}" aria-live="polite"></span>
        <button type="button" class="btn btn-sm btn-primary" onclick="saveAgentProfile(window._selectedAgentProfileId)">Save profile</button>
      </div>
      <div class="agent-profile-tab-panel is-identity">
        <div class="agent-profile-panel-head"><span>Identity</span></div>
        <form class="agent-profile-form" id="agent-profile-form-${agentProfileAttr(detailId)}">
          <div class="agent-profile-field-grid">
            <label class="agent-profile-field">
              <span>Display name</span>
              <input name="displayName" class="input" value="${agentProfileAttr(agentProfileDisplayName(profile))}" autocomplete="off">
            </label>
            <label class="agent-profile-field">
              <span>Handle</span>
              <input name="handle" class="input" value="${agentProfileAttr(agentProfileHandle(profile).replace(/^@+/, ''))}" autocomplete="off">
            </label>
            <label class="agent-profile-field agent-profile-check-field">
              <span>State</span>
              <input name="enabled" type="checkbox" ${status.enabled ? 'checked' : ''}>
              <strong>${esc(status.label)}</strong>
            </label>
            <label class="agent-profile-field agent-profile-field-wide">
              <span>Description</span>
              <textarea name="description" class="input" rows="3">${esc(agentProfileFormText(profile.description || profile.summary))}</textarea>
            </label>
            <label class="agent-profile-field agent-profile-field-wide">
              <span>Personality</span>
              <textarea name="personality" class="input" rows="3">${esc(agentProfileFormText(profile.personality))}</textarea>
            </label>
          </div>
        </form>
      </div>
      <div class="agent-profile-tab-panel is-model">
        <div class="agent-profile-panel-head"><span>Model</span></div>
        <div class="agent-profile-field-grid" form="agent-profile-form-${agentProfileAttr(detailId)}">
          <label class="agent-profile-field">
            <span>Provider profile</span>
            <input name="providerProfileId" class="input" form="agent-profile-form-${agentProfileAttr(detailId)}" value="${agentProfileAttr(agentProfileFormText(providerProfile))}" autocomplete="off">
          </label>
          <label class="agent-profile-field">
            <span>Provider</span>
            <input name="provider" class="input" form="agent-profile-form-${agentProfileAttr(detailId)}" value="${agentProfileAttr(agentProfileFormText(provider))}" autocomplete="off">
          </label>
          <label class="agent-profile-field">
            <span>Model</span>
            <input name="model" class="input" form="agent-profile-form-${agentProfileAttr(detailId)}" value="${agentProfileAttr(agentProfileFormText(model))}" autocomplete="off">
          </label>
          <label class="agent-profile-field">
            <span>Tool policy</span>
            <select name="toolPolicy" class="input" form="agent-profile-form-${agentProfileAttr(detailId)}">
              ${['read-only', 'approval-required', 'allow']
                .map(
                  (policy) =>
                    `<option value="${policy}" ${policy === toolPolicy ? 'selected' : ''}>${policy}</option>`,
                )
                .join('')}
            </select>
          </label>
        </div>
      </div>
      <div class="agent-profile-tab-panel is-capabilities">
        <div class="agent-profile-panel-head"><span>Capabilities</span></div>
        <div class="agent-profile-capability-grid">
          <label>
            <span>Task kinds</span>
            <textarea name="taskKinds" class="input" form="agent-profile-form-${agentProfileAttr(detailId)}" rows="4">${esc(agentProfileFormList(taskKinds))}</textarea>
          </label>
          <label>
            <span>MCP servers</span>
            <textarea name="allowedMcpServers" class="input" form="agent-profile-form-${agentProfileAttr(detailId)}" rows="4">${esc(agentProfileFormList(mcpServers))}</textarea>
          </label>
          <label>
            <span>Skills</span>
            <textarea name="skills" class="input" form="agent-profile-form-${agentProfileAttr(detailId)}" rows="4">${esc(agentProfileFormList(skills))}</textarea>
          </label>
          <label>
            <span>Memory scopes</span>
            <textarea name="memoryScopes" class="input" form="agent-profile-form-${agentProfileAttr(detailId)}" rows="4">${esc(agentProfileFormList(memoryScopes))}</textarea>
          </label>
        </div>
      </div>
      <div class="agent-profile-tab-panel is-subscriptions">
        <div class="agent-profile-panel-head"><span>Subscriptions</span></div>
        ${subscriptionRows}
      </div>
      <div class="agent-profile-tab-panel is-activity">
        <div class="agent-profile-panel-head"><span>Activity</span></div>
        <div class="agent-profile-state-strip">
          ${blockedApprovals !== undefined ? `<span class="badge ${blockedApprovals > 0 ? 'badge-warning' : 'badge-muted'} agent-tool-badge">${esc(String(blockedApprovals))} approval blocked</span>` : ''}
          ${errors !== undefined ? `<span class="badge ${errors > 0 ? 'badge-error' : 'badge-muted'} agent-tool-badge">${esc(String(errors))} errors</span>` : ''}
        </div>
        ${activityRows}
      </div>
      <div class="agent-profile-tab-panel is-invoke">
        <div class="agent-profile-panel-head"><span>Invoke</span></div>
        <textarea id="agent-profile-invoke-prompt-${agentProfileAttr(detailId)}" class="input agent-profile-invoke-input" rows="4" placeholder="Describe the one-off work for this profile."></textarea>
        <div class="agent-profile-action-row">
          <button type="button" class="btn btn-sm btn-primary" onclick="invokeAgentProfile(window._selectedAgentProfileId)">Invoke profile</button>
        </div>
      </div>
    </section>`;
}

function renderAgentProfileShellContent(profiles, selectedId) {
  const roster = normalizeAgentProfiles(profiles);
  const fallbackId = roster.length > 0 ? agentProfileId(roster[0]) : '';
  const activeId = roster.some((profile) => agentProfileId(profile) === selectedId)
    ? selectedId
    : fallbackId;
  const selectedProfile = roster.find((profile) => agentProfileId(profile) === activeId);
  window._selectedAgentProfileId = activeId;
  return `
    <div class="agent-profile-shell-head">
      <div>
        <span>Agent profiles</span>
        <strong>Profile cockpit</strong>
        <small>Read-only roster, model policy, subscriptions, and activity for configured agent personas.</small>
      </div>
      <span class="badge badge-muted agent-tool-badge">${roster.length} profile${roster.length === 1 ? '' : 's'}</span>
    </div>
    <div class="agent-profile-layout">
      ${renderAgentProfileRoster(roster, activeId)}
      ${renderAgentProfileDetail(selectedProfile)}
    </div>`;
}

function renderAgentProfileShell(profiles) {
  if (profiles === null || profiles?.available === false) {
    return `
      <section class="agent-profile-shell" id="agent-profile-shell">
        ${renderAgentProfileEmptyState('unavailable')}
      </section>`;
  }

  const roster = normalizeAgentProfiles(profiles);
  if (roster.length === 0) {
    return `
      <section class="agent-profile-shell" id="agent-profile-shell">
        ${renderAgentProfileEmptyState('empty')}
      </section>`;
  }

  window._agentProfileRoster = roster;
  window._agentProfilesById = roster.reduce((acc, profile) => {
    acc[agentProfileId(profile)] = profile;
    return acc;
  }, {});

  return `
    <section class="agent-profile-shell" id="agent-profile-shell">
      ${renderAgentProfileShellContent(roster, window._selectedAgentProfileId)}
    </section>`;
}

async function renderAgents(el) {
  el.innerHTML = `
    ${renderAgentLoadingState('cockpit')}
    <section class="agent-profile-shell" id="agent-profile-shell">
      ${renderAgentProfileEmptyState('loading')}
    </section>`;
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
      agentProfilesRaw,
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
      api('/agent-profiles').catch(() => {
        loadIssues.push('Agent profile roster unavailable');
        return null;
      }),
    ]);
    const groups = Array.isArray(groupsRaw) ? groupsRaw : [];
    let agentProfiles =
      agentProfilesRaw === null ? null : normalizeAgentProfiles(agentProfilesRaw);
    if (Array.isArray(agentProfiles) && agentProfiles.length > 0) {
      let profileDetailLoadFailed = false;
      agentProfiles = await Promise.all(
        agentProfiles.map(async (profile) => {
          if (Array.isArray(profile?.subscriptions) && Array.isArray(profile?.activity)) {
            return profile;
          }
          try {
            const detail = await api(
              '/agent-profiles/' + encodeURIComponent(agentProfileId(profile)),
            );
            return { ...profile, ...detail };
          } catch {
            profileDetailLoadFailed = true;
            return { ...profile, detailUnavailable: true };
          }
        }),
      );
      if (profileDetailLoadFailed) {
        loadIssues.push('Agent profile detail unavailable');
      }
    }
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
        const lane = deriveCodingStageLaneDetails(job.status);
        const providerFit = deriveCodingProviderFit(job, codingProvidersById);
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
          codingJobCanOpenPr(job)
            ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(job.id)}','open-pr')">Open PR</button>`
            : '',
          codingJobCanRefreshCi(job)
            ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(job.id)}','refresh-ci')">CI</button>`
            : '',
          ['failed', 'cancelled'].includes(job.status)
            ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(job.id)}','retry')">Retry</button>`
            : '',
          codingJobCanRevert(job)
            ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(job.id)}','revert')">Revert</button>`
            : '',
          codingJobCanClosePr(job)
            ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(job.id)}','close-pr')">Close PR</button>`
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
          <div class="agent-task-meta coding-row-signals">
            <span class="coding-stage-lane is-${esc(lane.key)}">${esc(lane.label)}</span>
            <span class="coding-provider-fit is-${esc(providerFit.key)}">${esc(providerFit.label)}</span>
          </div>
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
      profiles: agentProfiles || [],
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

      ${renderAgentProfileShell(agentProfiles)}

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
            <div class="form-group"><label>Target</label><select class="search-input" id="assign-coding-target-type">
              <option value="auto">Next issue</option>
              <option value="issue-number">Issue #</option>
              <option value="freeform">Freeform task</option>
            </select></div>
            <div class="form-group"><label>Issue #</label><input class="search-input" id="assign-coding-issue-number" placeholder="optional"></div>
            <div class="form-group"><label>Provider</label><select class="search-input" id="assign-coding-provider-select" onchange="updateAssignCodingModels()">${codingProviderOptions || '<option value="claude">Claude</option>'}</select></div>
            <div class="form-group"><label>Model</label><select class="search-input" id="assign-coding-model-select"><option value="">Default model</option></select></div>
            <div class="form-group"><label>Mode</label><select class="search-input" id="assign-coding-plan-mode">
              <option value="plan-first">Plan first</option>
              <option value="implement-now">Implement after approval</option>
            </select></div>
            <div class="form-group"><label>Labels</label><input class="search-input" id="assign-coding-labels" placeholder="p0, autofix, bug"></div>
          </div>
          <div class="form-group">
            <label>Instructions</label>
            <textarea class="search-input assign-prompt-input" id="assign-coding-prompt" rows="3" placeholder="Optional issue context, freeform repo task, tests, PR expectations, or handoff details."></textarea>
            <div class="field-hint">Implementation approval is still required before repository writes, PR creation, or retry/cancel handoff changes proceed.</div>
          </div>
          <label class="assign-check"><input type="checkbox" id="assign-coding-create-pr" checked> Create a draft PR when changes are ready</label>
          <div class="assign-action-row">
            <button class="btn btn-primary" onclick="startAssignedCodingJob()">Start Code Assignment</button>
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
          <div class="agent-coding-brief-side">
            <div class="agent-coding-brief-stats">
              <span><strong>${codingRepos.length}</strong><small>repos</small></span>
              <span><strong>${activeCodingJobCount}</strong><small>active</small></span>
              <span><strong>${waitingCodingJobCount}</strong><small>gates</small></span>
            </div>
            <button class="btn btn-sm btn-ghost" onclick="navigate('autofix')">GitHub workbench</button>
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

window.selectAgentProfile = function (id) {
  const roster = Array.isArray(window._agentProfileRoster)
    ? window._agentProfileRoster
    : [];
  if (roster.length === 0) return;
  window._selectedAgentProfileId = id;
  const shell = document.getElementById('agent-profile-shell');
  if (!shell) return;
  shell.innerHTML = renderAgentProfileShellContent(roster, id);
};

window.selectAgentProfileByIndex = function (index) {
  const roster = Array.isArray(window._agentProfileRoster)
    ? window._agentProfileRoster
    : [];
  const profile = roster[Number(index)];
  if (!profile) return;
  window.selectAgentProfile(agentProfileId(profile));
};

window.saveAgentProfile = async function (id) {
  const form = document.getElementById(
    `agent-profile-form-${agentProfileDomId(id)}`,
  );
  if (!form) {
    toast('Profile form not found', 'error');
    return;
  }

  const displayName = agentProfileFieldValue(form, 'displayName').trim();
  const handle = agentProfileFieldValue(form, 'handle').trim();
  if (!displayName || !handle) {
    agentProfileSetStatus(id, 'Display name and handle are required.', 'error');
    toast('Display name and handle are required', 'warning');
    return;
  }

  const enabledControl = agentProfileControl(form, 'enabled');
  const allowedMcpServers = agentProfileCsvValue(
    agentProfileFieldValue(form, 'allowedMcpServers'),
  );
  const current =
    window._agentProfilesById?.[id] ||
    (Array.isArray(window._agentProfileRoster)
      ? window._agentProfileRoster.find((profile) => agentProfileId(profile) === id)
      : {});
  const currentAllowedMcpServers =
    current?.allowedMcpServers ?? current?.allowed_mcp_servers;
  const body = {
    displayName,
    handle,
    description: agentProfileNullableText(
      agentProfileFieldValue(form, 'description'),
    ),
    personality: agentProfileNullableText(
      agentProfileFieldValue(form, 'personality'),
    ),
    enabled: Boolean(enabledControl?.checked),
    providerProfileId: agentProfileNullableText(
      agentProfileFieldValue(form, 'providerProfileId'),
    ),
    provider: agentProfileNullableText(agentProfileFieldValue(form, 'provider')),
    model: agentProfileNullableText(agentProfileFieldValue(form, 'model')),
    toolPolicy: agentProfileFieldValue(form, 'toolPolicy') || 'approval-required',
    allowedMcpServers: allowedMcpServers.length
      ? allowedMcpServers
      : Array.isArray(currentAllowedMcpServers)
        ? []
        : null,
    skills: agentProfileCsvValue(agentProfileFieldValue(form, 'skills')),
    memoryScopes: agentProfileCsvValue(
      agentProfileFieldValue(form, 'memoryScopes'),
    ),
    taskKinds: agentProfileCsvValue(agentProfileFieldValue(form, 'taskKinds')),
  };

  agentProfileSetStatus(id, 'Saving profile...', 'info');
  try {
    const r = await api('/agent-profiles/' + encodeURIComponent(id), {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    const updatedProfile = {
      ...(current || {}),
      ...(r.profile || {}),
      subscriptions: current?.subscriptions || [],
      activity: current?.activity || current?.activityItems || [],
    };
    agentProfileUpdateLocalProfile(id, updatedProfile);
    agentProfileRerender(id);
    agentProfileSetStatus(id, 'Profile saved.', 'success');
    toast('Agent profile saved', 'success');
  } catch (e) {
    const message = e?.message || 'Profile save failed';
    agentProfileSetStatus(id, message, 'error');
    toast(message, 'error');
  }
};

window.invokeAgentProfile = async function (id) {
  const promptEl = document.getElementById(
    `agent-profile-invoke-prompt-${agentProfileDomId(id)}`,
  );
  const prompt = promptEl?.value?.trim() || '';
  if (!prompt) {
    promptEl?.classList.add('input-error');
    promptEl?.focus();
    agentProfileSetStatus(id, 'Enter a prompt before invoking this profile.', 'error');
    toast('Enter an invocation prompt', 'warning');
    return;
  }
  promptEl.classList.remove('input-error');

  agentProfileSetStatus(id, 'Recording invocation...', 'info');
  try {
    const r = await api('/agent-profiles/' + encodeURIComponent(id) + '/invoke', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
    if (r.activity) {
      const current = window._agentProfilesById?.[id] || {};
      const activity = [
        r.activity,
        ...agentProfileArray(current.activity || current.activityItems).filter(
          (item) => item?.id !== r.activity.id,
        ),
      ];
      agentProfileUpdateLocalProfile(id, {
        ...current,
        activity,
        lastActivityAt: r.activity.createdAt || current.lastActivityAt,
        latestActivity: r.activity.summary || current.latestActivity,
      });
      agentProfileRerender(id);
    }
    agentProfileSetStatus(id, 'Invocation recorded.', 'success');
    toast('Agent profile invocation recorded', 'success');
  } catch (e) {
    const message = e?.message || 'Profile invocation failed';
    agentProfileSetStatus(id, message, 'error');
    toast(message, 'error');
  }
};

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
  const defaultAllowed = codingProviderAllowsDefaultModel(provider, models);
  modelEl.innerHTML = `${defaultAllowed ? '<option value="">Default model</option>' : ''}${models.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}`;
};

function codingProviderAllowsDefaultModel(provider, models) {
  if (!provider || !provider.defaultModel) return true;
  const defaultModel = (models || []).find((model) => model.id === provider.defaultModel);
  return defaultModel ? defaultModel.codingCapable !== false : provider.codingCapable === true;
}

window.updateAssignCodingModels = function () {
  const providerEl = document.getElementById('assign-coding-provider-select');
  const modelEl = document.getElementById('assign-coding-model-select');
  if (!providerEl || !modelEl) return;
  const provider = (window._codingProvidersById || {})[providerEl.value] || {};
  const models = (window._codingModelsByProvider || {})[providerEl.value] || [];
  const defaultAllowed = codingProviderAllowsDefaultModel(provider, models);
  modelEl.innerHTML = `${defaultAllowed ? '<option value="">Default model</option>' : ''}${models.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}`;
};

window.updateAssignAutofixModels = function () {
  const providerEl = document.getElementById('assign-af-provider');
  const modelEl = document.getElementById('assign-af-model');
  if (!providerEl || !modelEl) return;
  const provider = (window._codingProvidersById || {})[providerEl.value] || {};
  const models = (window._codingModelsByProvider || {})[providerEl.value] || [];
  const defaultAllowed = codingProviderAllowsDefaultModel(provider, models);
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

function assignmentPlanDirective(mode) {
  if (mode === 'implement-now') {
    return 'Assignment mode: implement after approval. Implementation approval is still required before repository writes, PR creation, or external delivery proceed.';
  }
  return 'Assignment mode: plan first. Produce a concrete plan and wait for implementation approval before changing repository files.';
}

function assignedCodingPrompt(prompt, mode) {
  return [assignmentPlanDirective(mode), prompt || ''].filter(Boolean).join('\n\n');
}

window.startAssignedCodingJob = async function () {
  const repo = document.getElementById('assign-coding-repo-select')?.value;
  const targetType =
    document.getElementById('assign-coding-target-type')?.value || 'auto';
  const provider = document.getElementById('assign-coding-provider-select')?.value;
  const model = document.getElementById('assign-coding-model-select')?.value;
  const prompt =
    document.getElementById('assign-coding-prompt')?.value?.trim() || '';
  const planMode =
    document.getElementById('assign-coding-plan-mode')?.value || 'plan-first';
  const labels = document
    .getElementById('assign-coding-labels')
    ?.value?.split(',')
    .map((label) => label.trim())
    .filter(Boolean);
  const issueRaw =
    document.getElementById('assign-coding-issue-number')?.value?.trim() || '';
  const issueNumber = issueRaw ? Number(issueRaw.replace(/^#/, '')) : undefined;
  const createPr =
    document.getElementById('assign-coding-create-pr')?.checked === true;
  if (!repo) {
    toast('Register/select a repo first', 'warning');
    document.getElementById('assign-coding-repo-select')?.focus();
    return;
  }
  if (targetType === 'issue-number' && (!issueNumber || Number.isNaN(issueNumber))) {
    toast('Enter a valid issue number', 'warning');
    document.getElementById('assign-coding-issue-number')?.focus();
    return;
  }
  if (targetType === 'freeform' && !prompt) {
    toast('Describe the freeform repo task first', 'warning');
    document.getElementById('assign-coding-prompt')?.focus();
    return;
  }
  try {
    const r =
      targetType === 'auto'
        ? await api('/agents/coding/pick-issue', {
            method: 'POST',
            body: JSON.stringify({
              repo,
              labels,
              provider,
              model: model || undefined,
              createPr,
            }),
          })
        : await api('/agents/coding/jobs', {
            method: 'POST',
            body: JSON.stringify({
              repo,
              issueNumber:
                targetType === 'issue-number' ? issueNumber : undefined,
              prompt: assignedCodingPrompt(prompt, planMode),
              provider,
              model: model || undefined,
              createPr,
            }),
          });
    if (!r.ok) {
      toast(agentActionErrorMessage('issue', r.error), 'error');
      return;
    }
    if (targetType === 'auto' && !r.issue) {
      toast('No matching open issue found', 'info');
      return;
    }
    toast(
      targetType === 'auto'
        ? `Started coding job for #${r.issue.number}`
        : `Started Code assignment for ${repo}`,
      'success',
    );
    toggleTaskLauncher(false);
    setTimeout(() => {
      if (currentPage === 'agents') navigate('agents');
    }, 1000);
  } catch (e) {
    toast(agentActionErrorMessage('issue', e), 'error');
  }
};

window.assignPickCodingIssue = window.startAssignedCodingJob;

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
    const lane = deriveCodingStageLaneDetails(job.status);
    const providerFit = deriveCodingProviderFit(job, window._codingProvidersById || {});
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
      codingJobCanOpenPr(job)
        ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(id)}','open-pr')">Open PR</button>`
        : '',
      codingJobCanRefreshCi(job)
        ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(id)}','refresh-ci')">Refresh CI</button>`
        : '',
      ['failed', 'cancelled'].includes(job.status)
        ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(id)}','retry')">Retry</button>`
        : '',
      codingJobCanRevert(job)
        ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(id)}','revert')">Revert</button>`
        : '',
      codingJobCanClosePr(job)
        ? `<button class="btn btn-sm btn-ghost" onclick="controlCodingJob('${esc(id)}','close-pr')">Close PR</button>`
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
      <div class="coding-lane-summary">
        <div class="coding-lane-summary-head">
          <span class="coding-stage-lane is-${esc(lane.key)}">${esc(lane.label)}</span>
          <span class="coding-provider-fit is-${esc(providerFit.key)}">${esc(providerFit.label)}</span>
        </div>
        <p class="coding-lane-guidance">${esc(lane.guidance)}</p>
        <p class="coding-lane-guidance">${esc(providerFit.guidance)}</p>
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
