// NanoCrab Admin — Settings Page

function settingsOperatingBriefText(state) {
  const stats = state?.settingsStats || [];
  const focusAreas = state?.settingsFocusAreas || [];
  const quickLinks = state?.settingsQuickLinks || [];
  const notificationRunway = state?.settingsNotificationRunway || [];
  const loadIssues = state?.settingsLoadIssues || [];
  const statsLines = stats.length
    ? stats
        .map((stat) => `- ${stat.label}: ${stat.value} (${stat.detail})`)
        .join('\n')
    : '- No settings stats loaded';
  const focusLines = focusAreas.length
    ? focusAreas
        .map((area) => `- ${area.label}: ${area.title}. ${area.detail}`)
        .join('\n')
    : '- No focus map loaded';
  const quickLines = quickLinks.length
    ? quickLinks.map((item) => `- ${item.label}: ${item.detail}`).join('\n')
    : '- No quick links loaded';
  const runway = state?.settingsDelegationRunway || [];
  const runwayLines = runway.length
    ? runway
        .map((item) => `- ${item.label}: ${item.title}. ${item.detail}`)
        .join('\n')
    : '- No delegation runway loaded';
  const notificationLines = notificationRunway.length
    ? notificationRunway
        .map((item) => `- ${item.label}: ${item.title}. ${item.detail}`)
        .join('\n')
    : '- No notification runway loaded';
  const loadIssueLines = loadIssues.length
    ? loadIssues.map((issue) => `- ${issue}`).join('\n')
    : '- Settings data loaded without known endpoint fallbacks';
  return [
    'Settings operating brief',
    '',
    'Readiness snapshot',
    statsLines,
    '',
    'Where work belongs',
    focusLines,
    '',
    'Setup shortcuts',
    quickLines,
    '',
    'Delegation runway',
    runwayLines,
    '',
    'Notification wake-up policy',
    notificationLines,
    '',
    'Data health',
    loadIssueLines,
    '',
    'Operating rule',
    'Keep durable personal memory, assistant identity, reusable skills, provider profiles, credentials, and access controls in Settings. Use Cowork for projects, documents, MCP context, and artifacts. Use Code for repositories, Copilot, tests, review rules, and repo automation.',
    '',
    'Before assigning unattended work',
    '- Confirm provider profiles are ready for the target work type.',
    '- Check credentials and MCP access before Cowork document or email tasks.',
    '- Keep external writes approval-gated.',
    '- Use 2FA and security controls before trusting long-running automation.',
  ].join('\n');
}

function settingsPanelLoadingState(label, title, body, tone = 'default') {
  return `
    <section class="settings-panel-loading is-${tone}" aria-busy="true">
      <span class="settings-plugin-kicker">${esc(label)}</span>
      <strong>${esc(title)}</strong>
      <p>${esc(body)}</p>
    </section>`;
}

function addSettingsLoadIssue(issue) {
  if (!issue) return;
  window._settingsOperatingState = window._settingsOperatingState || {};
  const issues = new Set(window._settingsOperatingState.settingsLoadIssues || []);
  issues.add(issue);
  window._settingsOperatingState.settingsLoadIssues = Array.from(issues);
}

function settingsNotificationRunway() {
  return [
    {
      label: 'Wake',
      title: 'Notify only when attention changes the outcome',
      detail:
        'Use push for uptime failures, approvals waiting on external writes, completed scheduled work, and blocked agent runs.',
      action: "navigate('monitoring')",
      actionLabel: 'Monitoring',
    },
    {
      label: 'Inspect',
      title: 'Open the evidence surface before replying',
      detail:
        'Check Logs, Approvals, Cowork project history, or Reports before retrying MCP tools, channel delivery, or document generation.',
      action: "navigate('audit')",
      actionLabel: 'Audit',
    },
    {
      label: 'Hold',
      title: 'Do not let notifications imply approval',
      detail:
        'Email sends, document publishing, calendar edits, webhooks, and repository writes still need explicit approval gates.',
      action: "navigate('approvals')",
      actionLabel: 'Approvals',
    },
  ];
}

function renderSettingsNotificationRunway(runway) {
  return `
    <div class="settings-push-runway" aria-label="Notification wake-up policy">
      ${runway
        .map(
          (item) => `
          <button type="button" class="settings-push-runway-step" onclick="${item.action}">
            <span>${esc(item.label)}</span>
            <strong>${esc(item.title)}</strong>
            <p>${esc(item.detail)}</p>
            <small>${esc(item.actionLabel)}</small>
          </button>`,
        )
        .join('')}
    </div>`;
}

window.renderSettings = async function (el) {
  const currentTheme =
    document.documentElement.getAttribute('data-theme') || 'dark';
  const settingsThemes = ['dark', 'light', 'midnight', 'forest', 'amber'];
  const themeLabels = {
    dark: 'Dark',
    light: 'Light',
    midnight: 'Midnight Blue',
    forest: 'Forest Green',
    amber: 'Warm Amber',
  };

  // Load identity + provider
  const settingsLoadIssues = [];
  let identity = { name: '', trigger: '' };
  try {
    identity = await api('/system/identity');
  } catch {
    settingsLoadIssues.push('Identity profile unavailable');
  }
  let providerInfo = {
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    available: {},
    modelsByProvider: {},
  };
  try {
    providerInfo = await api('/system/provider');
  } catch {
    settingsLoadIssues.push('Provider and model readiness unavailable');
  }
  let agentBoundaries = [];
  try {
    agentBoundaries = await api('/agents/boundaries');
  } catch {
    settingsLoadIssues.push('Agent boundary data unavailable');
  }
  let assistantProfile = {
    selectedAvatarId: 'default',
    selectedAvatar: {
      id: 'default',
      kind: 'default',
      name: 'NanoCrab Mark',
      description: 'Default NanoCrab logo mark.',
      url: '/static/nanocrab-mark.png',
      available: true,
    },
    avatars: [],
  };
  try {
    assistantProfile = await api('/assistant-profile');
  } catch {
    settingsLoadIssues.push('Assistant avatar profile unavailable');
  }
  let assistantSkills = { installed: [] };
  try {
    assistantSkills = await api('/skills');
  } catch {
    settingsLoadIssues.push('Installed skill inventory unavailable');
  }
  let pushSubscriptions = [];
  try {
    pushSubscriptions = await api('/push/subscriptions');
  } catch {
    settingsLoadIssues.push('Push subscription status unavailable');
  }
  const isOwner = (window._userRole || 'owner') === 'owner';
  let setupPreflight = null;
  let releaseDiagnostics = null;
  if (isOwner) {
    try {
      setupPreflight = await api('/system/setup/preflight');
    } catch {
      settingsLoadIssues.push('First-run preflight checks unavailable');
    }
    try {
      releaseDiagnostics = await api('/system/release-diagnostics');
    } catch {
      settingsLoadIssues.push('Release diagnostics unavailable');
    }
  }
  const providerModels = providerInfo.models || {
    claude: [
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-haiku-4-5-20251001',
    ],
    codex: [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.2',
      'o4-mini',
      'o3-mini',
      'gpt-4.1',
    ],
    opencode: ['opencode/grok-code-fast-1'],
    ollama: ['llama3', 'llama3.1', 'mistral', 'codestral', 'gemma4:e2b'],
    openrouter: [
      'openrouter/auto',
      'anthropic/claude-sonnet-4.5',
      'google/gemini-2.5-pro',
    ],
    google: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    airouter: ['Qwen3.6', 'DeepSeek-V4-Flash', 'deepseek-v4'],
  };
  const providerDefaults = providerInfo.modelsByProvider || {};
  const providerDefinitions = providerInfo.definitions || {
    claude: {
      id: 'claude',
      name: 'Claude',
      description: 'Anthropic Claude via Agent SDK',
      runtime: 'claude-agent-sdk',
    },
    codex: {
      id: 'codex',
      name: 'Codex',
      description: 'OpenAI Codex CLI',
      runtime: 'codex-cli',
    },
    opencode: {
      id: 'opencode',
      name: 'OpenCode',
      description: 'OpenCode CLI coding agent',
      runtime: 'opencode-cli',
    },
    ollama: {
      id: 'ollama',
      name: 'Ollama',
      description: 'Local Ollama OpenAI-compatible endpoint',
      runtime: 'openai-compatible',
      defaultBaseUrl: 'http://host.docker.internal:11434/v1',
    },
    openrouter: {
      id: 'openrouter',
      name: 'OpenRouter',
      description: 'OpenRouter OpenAI-compatible gateway',
      runtime: 'openai-compatible',
      defaultBaseUrl: 'https://openrouter.ai/api/v1',
      envKey: 'OPENROUTER_API_KEY',
    },
    google: {
      id: 'google',
      name: 'Google Gemini',
      description: 'Gemini OpenAI-compatible endpoint',
      runtime: 'openai-compatible',
      defaultBaseUrl:
        'https://generativelanguage.googleapis.com/v1beta/openai/',
      envKey: 'GEMINI_API_KEY',
    },
    airouter: {
      id: 'airouter',
      name: 'AI Router Switzerland',
      description: 'Swiss-hosted OpenAI-compatible endpoint',
      runtime: 'openai-compatible',
      defaultBaseUrl: 'https://api.airouter.ch/v1',
      envKey: 'AIROUTER_API_KEY',
    },
  };
  const selectedProvider = providerInfo.provider || 'claude';
  const selectedDefinition =
    providerDefinitions[selectedProvider] || providerDefinitions.claude;
  const selectedModels =
    providerModels[selectedProvider] || providerModels.claude || [];
  const selectedModel =
    providerInfo.model ||
    providerDefaults[selectedProvider] ||
    selectedModels[0] ||
    '';
  const selectedBaseUrl =
    providerInfo.baseUrlsByProvider?.[selectedProvider] ||
    selectedDefinition?.defaultBaseUrl ||
    '';
  const installedSkills = assistantSkills.installed || [];
  const activeSkillCount = installedSkills.filter(
    (skill) => skill.enabled !== false,
  ).length;
  const highRiskSkillCount = installedSkills.filter(
    (skill) => skill.riskLevel === 'high',
  ).length;
  const selectableProviders = Object.values(providerDefinitions).filter(
    (p) => p && p.selectable !== false,
  );
  const readyProviderCount = selectableProviders.filter(
    (p) => providerInfo.available?.[p.id],
  ).length;
  const profileProbeFailures = (providerInfo.profileProbes || []).filter(
    (probe) => probe && probe.ok === false,
  ).length;
  const failedPreflightCount = (setupPreflight?.checks || []).filter(
    (check) => !check.ok,
  ).length;
  const releaseStatus = releaseDiagnostics?.status || '';
  const releaseStatusLabel =
    releaseStatus === 'ready'
      ? 'Ready'
      : releaseStatus === 'blocked'
        ? 'Blocked'
        : releaseStatus === 'attention' || releaseStatus === 'warn'
          ? 'Needs review'
          : '';
  const settingsStats = [
    {
      label: 'Identity',
      value: identity.name || 'NanoCrab',
      detail: assistantProfile.selectedAvatar?.name || 'Default assistant',
      tone: 'ready',
    },
    {
      label: 'Memory & skills',
      value: activeSkillCount,
      detail: `${installedSkills.length} installed${highRiskSkillCount ? ` · ${highRiskSkillCount} high-risk` : ''}`,
      tone: highRiskSkillCount ? 'attention' : activeSkillCount ? 'ready' : 'muted',
    },
    {
      label: 'Providers',
      value: `${readyProviderCount}/${selectableProviders.length}`,
      detail: `${selectedDefinition?.name || selectedProvider} / ${selectedModel || 'default model'}`,
      tone:
        profileProbeFailures || readyProviderCount === 0 ? 'attention' : 'ready',
    },
    {
      label: 'Readiness',
      value:
        releaseStatusLabel ||
        (failedPreflightCount ? `${failedPreflightCount} checks` : 'OK'),
      detail: failedPreflightCount
        ? 'First-run preflight needs review'
        : 'Preflight and release gates',
      tone:
        releaseStatus === 'blocked' || failedPreflightCount
          ? 'attention'
          : releaseStatus === 'warn' || releaseStatus === 'attention'
            ? 'active'
            : 'ready',
    },
    ...(settingsLoadIssues.length
      ? [
          {
            label: 'Data health',
            value: `${settingsLoadIssues.length} gaps`,
            detail: 'Some Settings readiness data used fallbacks',
            tone: 'attention',
          },
        ]
      : []),
  ];
  const settingsQuickLinks = [
    {
      label: 'Memory',
      detail: 'Personal facts, timeline, and learned preferences',
      action: "navigate('memory')",
    },
    {
      label: 'Skills',
      detail: 'Reusable workflows and agent capabilities',
      action: "navigate('skills')",
    },
    {
      label: 'Providers',
      detail: 'Models, profiles, fallbacks, and preflights',
      action: "scrollToSettingsSection('settings-provider-card')",
    },
    {
      label: 'Credentials',
      detail: 'Secrets for MCP servers and integrations',
      action: "navigate('credentials')",
    },
    {
      label: 'Security',
      detail: '2FA, tokens, boundaries, and audit controls',
      action: "navigate('security')",
    },
  ];
  const settingsFocusAreas = [
    {
      label: 'Personal',
      title: 'Memory, identity, and preferences',
      detail:
        'Durable facts, learned preferences, assistant profile, skills, and security choices that carry across chat, Cowork, and Code.',
      action: "navigate('memory')",
      actionLabel: 'Open memory',
      tone: 'personal',
    },
    {
      label: 'Cowork',
      title: 'Projects, documents, and MCP context',
      detail:
        'Project workspaces use files, chats, approved connectors, documents, reports, schedules, and approval guardrails.',
      action: "navigate('projects')",
      actionLabel: 'Open projects',
      tone: 'cowork',
    },
    {
      label: 'Code',
      title: 'GitHub Copilot and repo automation',
      detail:
        'Coding providers, Copilot, Autofix, Git workbench, review rules, tests, and repo-oriented agent work belong here.',
      action: "navigate('copilot')",
      actionLabel: 'Open Copilot',
      tone: 'code',
    },
  ];
  const settingsDelegationRunway = [
    {
      label: 'Model',
      title: 'Pick the provider profile for the work',
      detail:
        'Use Copilot for simple answers, Cowork profiles for tool/document work, and Code profiles for repo automation.',
      action: "scrollToSettingsSection('settings-provider-card')",
      actionLabel: 'Provider profiles',
    },
    {
      label: 'Access',
      title: 'Check credentials and MCP scope',
      detail:
        'Confirm secrets, connector access, and project/repo/channel scope before asking agents to read external systems.',
      action: "navigate('credentials')",
      actionLabel: 'Credentials',
    },
    {
      label: 'Writes',
      title: 'Keep external changes approval-gated',
      detail:
        'Documents, email sends, record updates, and repo-changing actions should route through Approvals until proven safe.',
      action: "navigate('approvals')",
      actionLabel: 'Approvals',
    },
    {
      label: 'Trust',
      title: 'Protect unattended work',
      detail:
        'Use 2FA, token review, audit trails, and security checks before trusting long-running automation.',
      action: "scrollToSettingsSection('settings-security-card')",
      actionLabel: 'Access controls',
    },
  ];
  const notificationRunway = settingsNotificationRunway();
  const notificationPermission =
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const pushReady =
    notificationPermission === 'granted' && pushSubscriptions.length > 0;
  const pushStatusLabel =
    notificationPermission === 'unsupported'
      ? 'Not supported'
      : notificationPermission === 'granted'
        ? pushSubscriptions.length
          ? 'Ready'
          : 'Browser allowed'
        : notificationPermission || 'Unknown';
  const pushSubscriptionRows = pushSubscriptions.length
    ? pushSubscriptions
        .map(
          (sub) => `
          <div class="settings-push-subscription-row">
            <strong>${esc(sub.userAgent || 'Subscribed browser')}</strong>
            <span>${esc(sub.createdAt || 'unknown time')}</span>
            <small>${esc(sub.endpoint || 'endpoint hidden')}</small>
          </div>`,
        )
        .join('')
    : `<div class="settings-push-empty">
        <strong>No subscribed browsers yet</strong>
        <p>Enable push on the device you actually want to wake up for approvals, outages, completed routines, and blocked agent work.</p>
      </div>`;
  window._settingsOperatingState = {
    settingsStats,
    settingsQuickLinks,
    settingsFocusAreas,
    settingsDelegationRunway,
    settingsNotificationRunway: notificationRunway,
    settingsLoadIssues,
  };
  const providerCards = selectableProviders
    .map(
      (p) => `
      <button type="button" class="settings-provider-option ${selectedProvider === p.id ? 'is-selected' : ''}" onclick="selectProvider('${esc(p.id)}')">
        <div class="settings-provider-option-head">
          <strong class="settings-provider-option-name">${esc(p.name || p.id)}</strong>
          ${providerInfo.available?.[p.id] ? '<span class="badge badge-success settings-mini-badge">Available</span>' : '<span class="badge badge-warning settings-mini-badge">Needs setup</span>'}
        </div>
        <div class="settings-provider-option-description">${esc(p.description || '')}</div>
        <div class="settings-provider-option-meta">${esc(p.runtime || '')}${p.envKey ? ` · ${esc(p.envKey)}` : ''}</div>
      </button>
    `,
    )
    .join('');
  const providerBaseUrlField =
    selectedDefinition?.runtime === 'openai-compatible'
      ? `
    <div class="form-group settings-provider-base-field">
      <label class="settings-field-label">Base URL</label>
      <input class="search-input" id="provider-base-url" value="${esc(selectedBaseUrl)}" placeholder="${esc(selectedDefinition.defaultBaseUrl || '')}">
    </div>
  `
      : '';
  const providerCredentialHint = selectedDefinition?.envKey
    ? `
    <div class="settings-provider-credential-hint">
      ${esc(selectedDefinition.name || selectedProvider)} key: ${providerInfo.available?.[selectedProvider] ? '<span class="badge badge-success">Configured</span>' : `<span class="badge badge-warning">Set ${esc(selectedDefinition.envKey)}</span>`}
    </div>
  `
    : '';
  const providerProfiles = providerInfo.profiles || [];
  const providerPurposeLabels = (providerInfo.purposes || []).reduce(
    (acc, purpose) => {
      acc[purpose.id] = purpose.label || purpose.id;
      return acc;
    },
    {},
  );
  const profileProbeById = (providerInfo.profileProbes || []).reduce(
    (acc, probe) => {
      if (probe.profileId) acc[probe.profileId] = probe;
      return acc;
    },
    {},
  );
  const profileHistoryById = (providerInfo.probeHistory || []).reduce(
    (acc, entry) => {
      if (!entry.profileId) return acc;
      if (!acc[entry.profileId]) acc[entry.profileId] = [];
      acc[entry.profileId].push(entry);
      return acc;
    },
    {},
  );
  const profileOptions = Object.values(providerDefinitions)
    .filter((p) => p && p.selectable !== false)
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`)
    .join('');
  const providerProfilesCard = `
    <div class="card settings-provider-profiles-card">
      <div class="card-title">Provider Profiles</div>
      <p class="settings-card-note">Choose the default provider/model for each NanoCrab capability. Write-capable work still follows approval and container isolation rules.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Purpose</th><th>Provider</th><th>Model</th><th>Tool Policy</th><th>Fallback</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${providerProfiles
              .map((profile) => {
                const probe = profileProbeById[profile.id];
                const history = profileHistoryById[profile.id] || [];
                const recentOk = history.filter((entry) => entry.ok).length;
                const reliability = history.length
                  ? `${recentOk}/${history.length} recent`
                  : 'No live history';
                const lastError =
                  probe?.errorDetail ||
                  probe?.errors?.[0] ||
                  history
                    .slice()
                    .reverse()
                    .find((entry) => entry.errorDetail)?.errorDetail ||
                  '';
                const models = providerModels[profile.provider] || [
                  profile.model,
                ];
                const fallbackOptions = [
                  '<option value="">None</option>',
                  ...providerProfiles
                    .filter((item) => item.id !== profile.id)
                    .map(
                      (item) =>
                        `<option value="${esc(item.id)}" ${profile.fallbackProfileId === item.id ? 'selected' : ''}>${esc(providerPurposeLabels[item.id] || item.label || item.id)}</option>`,
                    ),
                ].join('');
                return `<tr>
                  <td class="settings-profile-purpose">${esc(providerPurposeLabels[profile.id] || profile.label || profile.id)}</td>
                  <td>
                    <select class="search-input settings-profile-control" id="profile-provider-${esc(profile.id)}">
                      ${profileOptions.replace(`value="${esc(profile.provider)}"`, `value="${esc(profile.provider)}" selected`)}
                    </select>
                  </td>
                  <td>
                    <input class="search-input settings-profile-control settings-profile-model" id="profile-model-${esc(profile.id)}" list="profile-models-${esc(profile.id)}" value="${esc(profile.model)}">
                    <datalist id="profile-models-${esc(profile.id)}">
                      ${models.map((m) => `<option value="${esc(m)}"></option>`).join('')}
                    </datalist>
                  </td>
                  <td>
                    <select class="search-input settings-profile-control" id="profile-policy-${esc(profile.id)}">
                      ${['deny', 'read-only', 'approval-required', 'allow']
                        .map(
                          (policy) =>
                            `<option value="${policy}" ${profile.toolPolicy === policy ? 'selected' : ''}>${policy}</option>`,
                        )
                        .join('')}
                    </select>
                  </td>
                  <td>
                    <select class="search-input settings-profile-control settings-profile-fallback" id="profile-fallback-${esc(profile.id)}">
                      ${fallbackOptions}
                    </select>
                  </td>
                  <td>
                    ${
                      probe?.ok
                        ? '<span class="badge badge-success">Ready</span>'
                        : '<span class="badge badge-warning">Needs review</span>'
                    }
                    <div id="profile-probe-${esc(profile.id)}" class="settings-profile-probe">${esc(probe?.checks?.find((c) => !c.ok)?.detail || profile.provider + '/' + profile.model)}</div>
                    <div class="settings-profile-reliability">${esc(reliability)}${probe?.lastProbeAt ? ` · ${esc(timeAgo(probe.lastProbeAt))}` : ''}</div>
                    ${lastError ? `<div class="settings-profile-error">${esc(lastError)}</div>` : ''}
                  </td>
                  <td class="settings-profile-action-cell">
                    <button class="btn btn-sm btn-primary" onclick="saveProviderProfile('${esc(profile.id)}')">Save</button>
                    <button class="btn btn-sm btn-ghost" onclick="probeProviderProfile('${esc(profile.id)}')">Probe</button>
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  const avatarOptions = (assistantProfile.avatars || [])
    .map((avatar) => {
      const selected = avatar.id === assistantProfile.selectedAvatarId;
      const unavailable = !avatar.available;
      const kindLabel =
        avatar.kind === 'default'
          ? 'Default'
          : avatar.kind === 'uploaded'
            ? 'Uploaded'
            : 'Built-in';
      return `
        <button type="button" class="avatar-option ${selected ? 'active' : ''}" ${unavailable ? 'disabled' : ''} onclick="selectAssistantAvatar('${esc(avatar.id)}')">
          <img src="${esc(avatar.url)}" alt="${esc(avatar.name)}" onerror="this.classList.add('is-unavailable')">
          <span>
            <strong>${esc(avatar.name)}</strong>
            <small>${esc(avatar.description || '')}</small>
            <em>${esc(kindLabel)}${unavailable ? ' · not uploaded' : ''}</em>
          </span>
        </button>`;
    })
    .join('');
  const skillFamilies = (assistantSkills.installed || []).reduce(
    (acc, skill) => {
      const family = skill.category || 'tool';
      if (!acc[family]) {
        acc[family] = { total: 0, enabled: 0, highRisk: 0 };
      }
      acc[family].total += 1;
      if (skill.enabled !== false) acc[family].enabled += 1;
      if (skill.riskLevel === 'high') acc[family].highRisk += 1;
      return acc;
    },
    {},
  );
  const skillPreferenceRows = Object.entries(skillFamilies)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([family, stats]) => `
        <div class="settings-skill-family-row">
          <div>
            <div class="settings-skill-family-name">${esc(family)} skills</div>
            <div class="settings-skill-family-meta">${Number(stats.enabled)} active of ${Number(stats.total)}${Number(stats.highRisk) ? ` · ${Number(stats.highRisk)} high-risk` : ''}</div>
          </div>
          <span class="badge ${Number(stats.enabled) ? 'badge-success' : 'badge-muted'}">${Number(stats.enabled) ? 'Enabled' : 'Disabled'}</span>
        </div>`,
    )
    .join('');
  const skillPreferenceEmpty = `
    <section class="settings-skill-empty-state">
      <div>
        <span class="report-kicker">Reusable agent behavior</span>
        <strong>No skills installed yet</strong>
        <p>Skills are reusable workflows for agents. Keep personal facts in Memory, project-specific rules in Cowork projects, and install skills only when a pattern should be reused across work.</p>
      </div>
      <div class="settings-skill-empty-flow">
        <span>Find</span>
        <span>Review</span>
        <span>Enable</span>
      </div>
      <div class="settings-skill-empty-actions">
        <button class="btn btn-sm btn-primary" onclick="navigate('skills')">Open Skills</button>
        <button class="btn btn-sm btn-ghost" onclick="navigate('marketplace')">Marketplace</button>
        <button class="btn btn-sm btn-ghost" onclick="navigate('memory')">Memory</button>
      </div>
    </section>`;
  const agentBoundaryCard = `
    <div class="card settings-agent-boundary-card">
      <div class="card-title">Agent Boundaries</div>
      <p class="settings-card-note">Runtime scopes are derived before containers receive mounts, provider profiles, skills, channels, or connector tools.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Agent</th><th>Channels</th><th>Connectors</th><th>Provider Profiles</th><th>External Writes</th></tr></thead>
          <tbody>
            ${
              (agentBoundaries || [])
                .map((item) => {
                  const boundary = item.boundary || {};
                  return `<tr>
                  <td class="settings-boundary-agent">${esc(item.name || item.folder || boundary.agentId || '')}</td>
                  <td>${(boundary.channelScopes || []).map((scope) => `<span class="badge badge-muted">${esc(scope)}</span>`).join(' ')}</td>
                  <td>${(boundary.connectorIds || [])
                    .slice(0, 5)
                    .map(
                      (connector) =>
                        `<span class="badge badge-info">${esc(connector)}</span>`,
                    )
                    .join(' ')}</td>
                  <td class="settings-boundary-profiles">${esc((boundary.providerProfiles || []).join(', '))}</td>
                  <td><span class="badge ${boundary.externalWrites?.allowed ? 'badge-warning' : 'badge-success'}">${boundary.externalWrites?.allowed ? 'approval gated' : 'denied'}</span></td>
                </tr>`;
                })
                .join('') ||
              '<tr><td colspan="5" class="settings-boundary-empty">No registered agents.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>`;
  const setupPreflightCard =
    isOwner && setupPreflight
      ? `
    <div class="card settings-diagnostics-card">
      <div class="settings-diagnostics-head">
        <div class="card-title">First-Run Preflight</div>
        <button class="btn btn-sm btn-ghost" onclick="refreshSetupPreflight()">Refresh</button>
      </div>
      <div id="setup-preflight-list" class="settings-diagnostics-grid">
        ${renderSetupPreflightChecks(setupPreflight.checks || [])}
      </div>
    </div>`
      : '';
  const releaseDiagnosticsCard =
    isOwner && releaseDiagnostics
      ? `
    <div class="card settings-diagnostics-card">
      <div class="settings-diagnostics-head">
        <div>
          <div class="card-title">Production Release Diagnostics</div>
          <div class="settings-diagnostics-subtitle">Required gates must pass before production release; advisory gates flag operational risk.</div>
        </div>
        <div class="settings-diagnostics-actions">
          <span class="badge ${releaseDiagnostics.status === 'ready' ? 'badge-success' : releaseDiagnostics.status === 'blocked' ? 'badge-error' : 'badge-warning'}">${esc(releaseDiagnostics.status)}</span>
          <button class="btn btn-sm btn-ghost" onclick="refreshReleaseDiagnostics()">Refresh</button>
        </div>
      </div>
      <div id="release-diagnostics-list">${renderReleaseDiagnostics(releaseDiagnostics)}</div>
    </div>`
      : '';

  el.innerHTML = `
    <div class="page-header settings-page-header">
      <div>
        <h2>Settings</h2>
        <p>Your personal operating space: memory, skills, providers, access, and the assistant profile that carries across workspaces.</p>
      </div>
      <div class="settings-header-actions">
        <button class="btn btn-sm btn-ghost" onclick="navigate('memory')">Memory</button>
        <button class="btn btn-sm btn-ghost" onclick="navigate('skills')">Skills</button>
        <button class="btn btn-sm btn-primary" onclick="navigate('credentials')">Credentials</button>
      </div>
    </div>

    <section class="settings-command-center">
      <div class="settings-command-main">
        <div class="settings-kicker">Personal space</div>
        <h3>Shape what the assistant knows, can do, and may access</h3>
        <p>Keep durable memory and reusable skills here, separate from project collaboration and code execution. Provider profiles and security controls decide how agent work is allowed to run.</p>
        <div class="settings-command-actions">
          <button class="btn btn-sm btn-ghost" onclick="copySettingsOperatingBrief()">Copy operating brief</button>
          <button class="btn btn-sm btn-primary" onclick="navigate('memory')">Open memory</button>
          <button class="btn btn-sm btn-ghost" onclick="navigate('skills')">Manage skills</button>
          <button class="btn btn-sm btn-ghost" onclick="scrollToSettingsSection('settings-provider-card')">Provider profiles</button>
          <button class="btn btn-sm btn-ghost" onclick="scrollToSettingsSection('settings-security-card')">Access controls</button>
        </div>
      </div>
      <div class="settings-command-stats">
        ${settingsStats
          .map(
            (stat) => `<div class="settings-command-stat is-${stat.tone}">
              <span>${esc(stat.label)}</span>
              <strong>${esc(String(stat.value))}</strong>
              <small>${esc(stat.detail)}</small>
            </div>`,
          )
          .join('')}
      </div>
    </section>

    <section class="settings-quick-panel" aria-label="Settings quick links">
      ${settingsQuickLinks
        .map(
          (item) => `<button type="button" class="settings-quick-link" onclick="${item.action}">
            <strong>${esc(item.label)}</strong>
            <small>${esc(item.detail)}</small>
          </button>`,
        )
        .join('')}
    </section>

    <section class="settings-focus-map" aria-label="Workspace focus map">
      <div class="settings-focus-head">
        <span>Where things belong</span>
        <strong>Keep personal memory separate from Cowork projects and Code automation</strong>
      </div>
      <div class="settings-focus-grid">
        ${settingsFocusAreas
          .map(
            (area) => `<button type="button" class="settings-focus-card is-${area.tone}" onclick="${area.action}">
              <span>${esc(area.label)}</span>
              <strong>${esc(area.title)}</strong>
              <p>${esc(area.detail)}</p>
              <em>${esc(area.actionLabel)}</em>
            </button>`,
          )
          .join('')}
      </div>
    </section>

    <section class="settings-delegation-runway" aria-label="Delegation readiness runway">
      <div class="settings-delegation-head">
        <span>Delegation runway</span>
        <strong>Check the setup path before agents work unattended</strong>
        <p>Use this before long Cowork MCP jobs, Code automation, scheduled tasks, or anything that can write outside NanoCrab.</p>
      </div>
      <div class="settings-delegation-grid">
        ${settingsDelegationRunway
          .map(
            (item) => `<button type="button" class="settings-delegation-card" onclick="${item.action}">
              <span>${esc(item.label)}</span>
              <strong>${esc(item.title)}</strong>
              <p>${esc(item.detail)}</p>
              <em>${esc(item.actionLabel)}</em>
            </button>`,
          )
          .join('')}
      </div>
    </section>

    <section class="settings-profile-card" id="settings-profile-card" aria-label="Assistant identity compass">
      <div class="settings-profile-main">
        <span class="settings-kicker">Assistant Profile</span>
        <h3>Identity and habits that follow every workspace</h3>
        <p>The profile is personal context: name, trigger, avatar, active skills, and durable preferences. Project files stay in Cowork; repository behavior stays in Code.</p>
        <div class="settings-profile-actions">
          <button class="btn btn-sm btn-primary" onclick="document.getElementById('identity-name')?.focus()">Edit identity</button>
          <button class="btn btn-sm btn-ghost" onclick="navigate('memory')">Memory</button>
          <button class="btn btn-sm btn-ghost" onclick="navigate('skills')">Skills</button>
        </div>
      </div>
      <div class="settings-profile-grid">
        <div class="settings-profile-metric">
          <span>Name</span>
          <strong>${esc(identity.name || 'NanoCrab')}</strong>
          <small>Used in Copilot, Cowork, and Code surfaces.</small>
        </div>
        <div class="settings-profile-metric">
          <span>Trigger</span>
          <strong>${esc(identity.trigger || 'not set')}</strong>
          <small>Derived from the assistant name for channel use.</small>
        </div>
        <div class="settings-profile-metric">
          <span>Avatar</span>
          <strong>${esc(assistantProfile.selectedAvatar?.name || 'NanoCrab Mark')}</strong>
          <small>${esc(assistantProfile.selectedAvatar?.kind || 'default')} identity.</small>
        </div>
        <div class="settings-profile-metric">
          <span>Skills</span>
          <strong>${Number(activeSkillCount)} active</strong>
          <small>${Number(highRiskSkillCount)} need careful review.</small>
        </div>
      </div>
    </section>
    <div class="settings-account-grid">
      <div class="card">
        <div class="card-title">Change Password</div>
        <div id="pw-msg" class="settings-password-msg"></div>
        <form id="pw-form">
          <div class="form-group"><label>Current password</label><input type="password" id="pw-current" required></div>
          <div class="form-group"><label>New password</label><input type="password" id="pw-new" required minlength="6"></div>
          <div class="form-group"><label>Confirm new password</label><input type="password" id="pw-confirm" required></div>
          <button type="submit" class="btn btn-primary">Change Password</button>
        </form>
      </div>
      <div class="card">
        <div class="card-title">Agent Identity</div>
        <form id="identity-form">
          <div class="form-group"><label>Bot name</label><input id="identity-name" value="${esc(identity.name)}" placeholder="Andy"></div>
          <div class="form-group"><label>Trigger word (read-only, derived from name)</label><input id="identity-trigger" class="settings-readonly-input" value="${esc(identity.trigger)}" disabled></div>
          <div class="settings-identity-actions">
            <button type="submit" class="btn btn-primary btn-sm">Save Identity</button>
            <span id="identity-msg" class="settings-status-msg"></span>
          </div>
          <p class="settings-form-note">Changes update .env and all group agent instruction files. Requires restart.</p>
        </form>
      </div>
    </div>
    ${
      isOwner
        ? `<div class="card settings-provider-card" id="settings-provider-card">
      <div class="card-title">Agent Provider</div>
      <p class="settings-card-note">Agent runtime for bot replies. Integrations below are separate API/service providers.</p>
      <div class="settings-provider-grid">
        ${providerCards}
      </div>
      <div class="settings-provider-actions">
        <div class="form-group settings-provider-model-field">
          <label class="settings-field-label">Default model</label>
          <input class="search-input" id="provider-model" list="provider-model-options" value="${esc(selectedModel)}">
          <datalist id="provider-model-options">
            ${selectedModels.map((m) => `<option value="${esc(m)}"></option>`).join('')}
          </datalist>
        </div>
        ${providerBaseUrlField}
        <button class="btn btn-sm btn-primary" onclick="saveProvider()">Save</button>
        <button class="btn btn-sm btn-ghost" onclick="testAndValidateProvider('${esc(selectedProvider)}')">Test and validate</button>
        <label class="settings-inline-check"><input type="checkbox" id="provider-restart-active" checked> restart active sessions</label>
        <span id="provider-msg" class="settings-muted-status"></span>
      </div>
      <div id="provider-preflight" class="settings-provider-preflight"></div>
      <div class="settings-provider-auth-note">
        Codex OAuth: ${providerInfo.auth?.codex?.configured ? '<span class="badge badge-success">Configured for containers</span>' : providerInfo.auth?.codex?.hasHostAuth ? '<span class="badge badge-info">Host login found; switching to Codex will import it</span>' : '<span class="badge badge-warning">Run codex login --device-auth</span>'}
      </div>
      ${providerCredentialHint}
    </div>
    ${providerProfilesCard}`
        : ''
    }
    ${releaseDiagnosticsCard}
    ${setupPreflightCard}
    ${isOwner ? '<div id="users-section"></div>' : ''}
    ${isOwner ? agentBoundaryCard : ''}
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">Appearance</div>
        <div class="settings-theme-section">
          <label class="settings-theme-label">Theme</label>
          <div class="theme-grid">
            ${settingsThemes
              .map(
                (t) => `
              <button class="theme-option ${currentTheme === t ? 'active' : ''}" data-theme="${t}" onclick="setTheme('${t}')">
                <div class="theme-preview is-${t}"></div>
                <span>${themeLabels[t]}</span>
              </button>`,
              )
              .join('')}
          </div>
        </div>
        <div class="settings-avatar-section">
          <div class="card-title">Bot Avatar</div>
          <div class="settings-avatar-current">
            <img src="${esc(assistantProfile.selectedAvatar?.url || '/static/nanocrab-mark.png')}" class="settings-avatar-preview" onerror="this.onerror=null;this.src='/static/nanocrab-mark.png'" id="avatar-preview" alt="Bot avatar">
            <div class="settings-avatar-copy">
              <div class="settings-avatar-name" id="avatar-current-name">${esc(assistantProfile.selectedAvatar?.name || 'NanoCrab Mark')}</div>
              <div class="settings-avatar-kind" id="avatar-current-kind">${esc(assistantProfile.selectedAvatar?.kind || 'default')}</div>
              <input type="file" id="avatar-file" class="settings-avatar-file" accept="image/*">
              <button class="btn btn-sm btn-ghost" onclick="document.getElementById('avatar-file').click()">Upload New Avatar</button>
              <div id="avatar-msg" class="settings-avatar-msg"></div>
            </div>
          </div>
          <div class="avatar-grid">${avatarOptions || renderSettingsAvatarEmptyState()}</div>
        </div>
      </div>
      <div class="card settings-push-card">
        <div class="card-title">Push Notifications</div>
        <div class="settings-push-readiness ${pushReady ? 'is-ready' : 'is-attention'}">
          <div>
            <span>Wake-up policy</span>
            <strong>${pushReady ? 'Push is ready for important work' : 'Push needs a subscribed browser'}</strong>
            <p>Use notifications for outages, approval waits, completed routines, and blocked agents. External writes still require explicit approvals.</p>
          </div>
          <div class="settings-push-facts">
            <span>Permission: ${esc(pushStatusLabel)}</span>
            <span>Subscriptions: ${pushSubscriptions.length}</span>
          </div>
        </div>
        <p class="settings-card-note settings-push-note">Receive alerts on your phone even when the browser is closed. Works with uptime alerts, automation notices, and agent tasks.</p>
        ${renderSettingsNotificationRunway(notificationRunway)}
        <div class="settings-push-actions">
          <button class="btn btn-sm btn-primary" id="push-subscribe-btn" onclick="subscribePush()">Enable Push</button>
          <button class="btn btn-sm btn-ghost" onclick="testPush()">Test</button>
          <button class="btn btn-sm btn-ghost" onclick="copySettingsOperatingBrief()">Copy policy</button>
          <span id="push-status" class="settings-muted-status">${esc(pushStatusLabel)}</span>
        </div>
        <div id="push-subs-list" class="settings-push-subscriptions">${pushSubscriptionRows}</div>
      </div>
    </div>
    <div class="grid grid-2 settings-owner-grid ${!isOwner ? 'is-hidden' : ''}">
      <div class="card" id="settings-security-card">
        <div class="card-title">API Tokens</div>
        <p class="settings-card-note">Create tokens for external API integrations. Use as <code>Authorization: Bearer &lt;token&gt;</code></p>
        <div id="tokens-list" class="settings-token-list">${settingsPanelLoadingState('Access tokens', 'Loading API token inventory', 'Checking external access tokens before you create, revoke, or rotate credentials.', 'security')}</div>
        <div class="settings-token-create">
          <input class="search-input settings-token-input" id="new-token-name" placeholder="Token name">
          <button class="btn btn-sm btn-primary" onclick="createApiToken()">Create Token</button>
        </div>
        <div id="new-token-display" class="settings-token-display is-hidden">
          <div class="settings-token-warning">Copy this token now - it won't be shown again:</div>
          <code id="new-token-value" class="settings-token-value"></code>
        </div>
      </div>
      <div class="card" id="settings-report-card">
        <div class="card-title">Scheduled Reports</div>
        <div id="report-config-area">${settingsPanelLoadingState('Scheduled reports', 'Loading report automation settings', 'Fetching briefing cadence, source scope, format, and approval rules for recurring summaries.', 'reports')}</div>
      </div>
    </div>
    <div class="card settings-plugins-card" id="settings-plugins-card">
      <div class="card-title">Plugins</div>
      <p class="settings-card-note">Enable or disable optional features. Changes take effect after restart.</p>
      <div id="plugins-list">${settingsPanelLoadingState('Plugin registry', 'Loading optional workspace plugins', 'Checking which extension surfaces are installed and whether they are enabled.', 'plugins')}</div>
    </div>
    <div class="card settings-2fa-card" id="settings-2fa-card">
      <div class="card-title">Two-Factor Authentication</div>
      <div id="2fa-area">${settingsPanelLoadingState('Workspace protection', 'Loading two-factor status', 'Confirming whether unattended work is protected by a second factor.', 'security')}</div>
    </div>
    <div class="card settings-personality-card" id="settings-personality-card">
      <div class="card-title">Personality</div>
      <p class="settings-card-note">Edit the global AGENTS.md instructions that shape your bot's personality and behavior.</p>
      <div id="personality-area">${settingsPanelLoadingState('Assistant instructions', 'Loading global personality context', 'Fetching the personal operating instructions that follow Copilot, Cowork, Code, and channel agents.', 'personal')}</div>
    </div>
    <div class="card settings-skills-card" id="settings-skills-card">
      <div class="card-title">Skill Preferences</div>
      <p class="settings-card-note">Choose the skill families this assistant can lean on by default. Scope, visibility, and high-risk skills still follow the Skills page controls.</p>
      <div>${skillPreferenceRows || skillPreferenceEmpty}</div>
      <div class="settings-skills-actions"><button class="btn btn-sm btn-primary" onclick="navigate('skills')">Manage Skills</button></div>
    </div>
    <div class="card settings-provenance-card" id="settings-provenance-card">
      <div class="card-title">Provenance Timeline</div>
      <div id="provenance-timeline">${settingsPanelLoadingState('Learning trail', 'Loading memory and skill provenance', 'Reviewing what changed across personal memory, approved learning, and reusable skills.', 'personal')}</div>
    </div>
    <div class="card settings-about-card">
      <div class="settings-about-head">
        <img src="/static/nanocrab-mark.png" class="settings-about-mark" alt="NanoCrab">
        <div>
          <div class="settings-about-name">${window._editionShort || 'NanoCrab'}</div>
          <div class="settings-about-version">${window._editionName || ''} v${window._editionVersion || '?'}</div>
        </div>
      </div>
      <table class="settings-about-table">
        <tr><td>App Version</td><td>${window._appVersion || '—'}</td></tr>
        <tr><td>Node.js</td><td>${typeof process !== 'undefined' ? process.version : 'N/A'}</td></tr>
      </table>
    </div>`;

  // Progressive enhancement: make each settings card collapsible
  // to tame the 8000px+ scroll. First two cards stay open.
  setTimeout(function () {
    var allCards = Array.from(el.querySelectorAll('.card, .settings-profile-card'));
    allCards.forEach(function (card, idx) {
      if (card.querySelector('.settings-card-collapse-toggle')) return;
      var titleEl = card.querySelector('.card-title, .settings-card-title, h3, h4');
      if (!titleEl) return;
      var titleText = titleEl.textContent.trim();
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'settings-card-collapse-toggle';
      toggle.setAttribute('aria-expanded', idx < 2 ? 'true' : 'false');
      var chevron = document.createElement('span');
      chevron.className = 'settings-card-collapse-chevron';
      toggle.append(chevron, document.createTextNode(titleText));
      titleEl.style.display = 'none';
      card.insertBefore(toggle, card.firstChild);
      var bodyWrap = document.createElement('div');
      bodyWrap.className = 'settings-card-body-wrap' + (idx < 2 ? ' is-open' : '');
      var innerWrap = document.createElement('div');
      innerWrap.className = 'settings-card-body-inner';
      var children = Array.from(card.children);
      children.forEach(function (child) {
        if (child !== toggle) innerWrap.appendChild(child);
      });
      bodyWrap.appendChild(innerWrap);
      card.appendChild(bodyWrap);
      toggle.addEventListener('click', function () {
        var open = bodyWrap.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
  }, 0);

  // Load user management (owner only)
  if (isOwner) loadUsersSection();

  // Load API tokens
  if (isOwner) loadApiTokens();

  // Load plugins list
  loadPluginsList();

  // Load report config
  loadReportConfig();

  // Load 2FA status
  load2faStatus();

  // Load personality editor
  loadPersonalityEditor();

  // Load memory/skill provenance timeline
  loadProvenanceTimeline();

  // Notifications controls may be absent in stripped-down dashboards.
  const notifToggle = document.getElementById('notif-toggle');
  const notifPermissionBtn = document.getElementById('notif-permission-btn');
  if (notifToggle) {
    notifToggle.onchange = (e) => {
      localStorage.setItem(
        'notifications_enabled',
        e.target.checked ? 'true' : 'false',
      );
    };
  }
  if (notifPermissionBtn) {
    notifPermissionBtn.onclick = async () => {
      if (typeof Notification === 'undefined') return;
      const perm = await Notification.requestPermission();
      const notifStatus = document.getElementById('notif-status');
      if (notifStatus) notifStatus.textContent = 'Permission: ' + perm;
      if (perm === 'granted') {
        if (notifToggle) notifToggle.checked = true;
        localStorage.setItem('notifications_enabled', 'true');
      }
    };
  }

  document.getElementById('pw-form').onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pw-msg');
    const cur = document.getElementById('pw-current').value;
    const np = document.getElementById('pw-new').value;
    const conf = document.getElementById('pw-confirm').value;
    if (np !== conf) {
      setSettingsStatus(msg, 'Passwords do not match', 'error');
      return;
    }
    try {
      const r = await api('/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: cur, newPassword: np }),
      });
      if (r.ok) {
        setSettingsStatus(msg, 'Password changed', 'success');
        document.getElementById('pw-form').reset();
      } else {
        setSettingsStatus(
          msg,
          r.error || 'Password change failed. Check the current password and try again.',
          'error',
        );
      }
    } catch {
      setSettingsStatus(
        msg,
        'Could not reach the password endpoint. Check logs before retrying.',
        'error',
      );
    }
  };

  document.getElementById('avatar-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const msgEl = document.getElementById('avatar-msg');
    setSettingsStatus(msgEl, 'Uploading...', 'muted');
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch('/api/system/avatar', {
        method: 'POST',
        body: buf,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      const data = await res.json();
      if (data.ok) {
        setSettingsStatus(msgEl, 'Avatar updated', 'success');
        document.getElementById('avatar-preview').src =
          (data.url || '/static/avatar.jpg') + '?' + Date.now();
      } else {
        setSettingsStatus(
          msgEl,
          data.error || 'Avatar upload failed. Try a smaller image or check storage permissions.',
          'error',
        );
      }
    } catch {
      setSettingsStatus(
        msgEl,
        'Avatar upload could not reach the server. Check logs before retrying.',
        'error',
      );
    }
  };

  // Identity form
  const identityForm = document.getElementById('identity-form');
  if (identityForm)
    identityForm.onsubmit = async (e) => {
      e.preventDefault();
      const msg = document.getElementById('identity-msg');
      const name = document.getElementById('identity-name').value.trim();
      if (!name) {
        setSettingsStatus(msg, 'Name required', 'error');
        return;
      }
      try {
        const r = await api('/system/identity', {
          method: 'PUT',
          body: JSON.stringify({ name }),
        });
        if (r.ok) {
          setSettingsStatus(msg, r.message || 'Saved', 'success');
          document.getElementById('identity-trigger').value = '@' + name;
        } else {
          setSettingsStatus(
            msg,
            r.error || 'Identity save failed. Keep the current assistant profile until this saves.',
            'error',
          );
        }
      } catch {
        setSettingsStatus(
          msg,
          'Could not save identity. Check the admin API and retry.',
          'error',
        );
      }
      setTimeout(() => {
        setSettingsStatus(msg, '');
      }, 4000);
    };
};

window.scrollToSettingsSection = function (id) {
  document.getElementById(id)?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
};

function setSettingsStatus(el, text, tone = 'muted') {
  if (!el) return;
  el.textContent = text || '';
  el.classList.remove('is-success', 'is-error', 'is-muted', 'is-visible');
  if (text) {
    el.classList.add(`is-${tone}`);
    if (el.classList.contains('settings-password-msg')) {
      el.classList.add('is-visible');
    }
  }
}

window.copySettingsOperatingBrief = async function () {
  const state = window._settingsOperatingState;
  if (!state) {
    toast('Settings operating state is not ready', 'error');
    return;
  }
  const text = settingsOperatingBriefText(state);
  await copyTextWithFallback(
    text,
    'Settings operating brief copied',
    'Copy settings operating brief',
  );
};

function renderSetupPreflightChecks(checks) {
  return (checks || [])
    .map(
      (check) => `
        <div class="settings-diagnostic-check">
          <div class="settings-diagnostic-check-head">
            <strong>${esc(check.label)}</strong>
            <span class="badge ${check.ok ? 'badge-success' : 'badge-error'}">${check.ok ? 'OK' : 'Fail'}</span>
          </div>
          <div class="settings-diagnostic-detail">${esc(check.detail || '')}</div>
        </div>`,
    )
    .join('');
}

function renderReleaseDiagnostics(result) {
  return (result.sections || [])
    .map(
      (section) => `
      <div class="settings-diagnostic-section">
        <div class="settings-diagnostic-section-title">${esc(section.title)}</div>
        <div class="settings-diagnostics-grid">
          ${(section.checks || [])
            .map(
              (check) => `
              <div class="settings-diagnostic-check">
                <div class="settings-diagnostic-check-head">
                  <strong>${esc(check.label)}</strong>
                  <span class="badge ${check.ok ? 'badge-success' : check.severity === 'required' ? 'badge-error' : 'badge-warning'}">${check.ok ? 'OK' : check.severity === 'required' ? 'Block' : 'Warn'}</span>
                </div>
                <div class="settings-diagnostic-detail">${esc(check.detail || '')}</div>
                ${check.hint && !check.ok ? `<div class="settings-diagnostic-hint">${esc(check.hint)}</div>` : ''}
              </div>`,
            )
            .join('')}
        </div>
      </div>`,
    )
    .join('');
}

// --- User Management ---
async function loadUsersSection() {
  const section = document.getElementById('users-section');
  if (!section) return;
  try {
    const users = await api('/users');
    const roleOptions = ['owner', 'admin', 'viewer'];
    let usersHtml = '';
    if (users.length === 0) {
      usersHtml =
        '<section class="settings-user-empty-state">' +
        '<div>' +
        '<span class="report-kicker">Single-user mode</span>' +
        '<strong>No additional users yet</strong>' +
        '<p>The env-based owner account is active. Add an admin or viewer only when someone else needs dashboard access to Copilot, Cowork, Code, or operations.</p>' +
        '</div>' +
        '<div class="settings-user-empty-flow">' +
        '<span>Owner stays active</span>' +
        '<span>Choose least privilege</span>' +
        '<span>Review audit trail</span>' +
        '</div>' +
        '<div class="settings-user-empty-actions">' +
        '<button class="btn btn-sm btn-primary" onclick="document.getElementById(&quot;new-user-name&quot;)?.focus()">Add first user</button>' +
        '<button class="btn btn-sm btn-ghost" onclick="navigate(&quot;audit&quot;)">Open audit</button>' +
        '</div>' +
        '</section>';
    } else {
      usersHtml = users
        .map(
          (u) => `
        <div class="settings-user-row">
          <div>
            <span class="settings-user-name">${esc(u.username)}</span>
            <span class="badge badge-${u.role === 'owner' ? 'success' : u.role === 'admin' ? 'warning' : 'muted'} settings-user-role-badge">${u.role}</span>
            <span class="settings-user-last-login">${u.last_login ? 'Last login ' + timeAgo(u.last_login) : 'Never logged in'}</span>
          </div>
          <div class="settings-user-actions">
            <select class="settings-user-role-select" onchange="changeUserRole('${esc(u.id)}', this.value)">
              ${roleOptions.map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
            <button class="btn btn-sm btn-danger" onclick="deleteUser('${esc(u.id)}', '${esc(u.username)}', this)">Delete</button>
          </div>
        </div>`,
        )
        .join('');
    }
    section.innerHTML = `
      <div class="card settings-users-card">
        <div class="card-title">User Management</div>
        <p class="settings-card-note">Add users for multi-user access control. The env-based admin account always works as owner.</p>
        <div id="users-list" class="settings-users-list">${usersHtml}</div>
        <div class="settings-user-form">
          <div class="form-group settings-user-field">
            <label class="settings-field-label">Username</label>
            <input class="search-input settings-user-input" id="new-user-name" placeholder="username">
          </div>
          <div class="form-group settings-user-field">
            <label class="settings-field-label">Password</label>
            <input class="search-input settings-user-input" id="new-user-password" type="password" placeholder="min 8 chars">
          </div>
          <div class="form-group settings-user-field">
            <label class="settings-field-label">Role</label>
            <select id="new-user-role" class="settings-user-role-select settings-user-role-select-large">
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
              <option value="owner">owner</option>
            </select>
          </div>
          <button class="btn btn-sm btn-primary" onclick="createUser()">Add User</button>
        </div>
      </div>`;
  } catch {
    section.innerHTML = renderSettingsUserErrorState();
  }
}

function renderSettingsUserErrorState() {
  return (
    '<section class="settings-user-empty-state is-error" aria-label="User management unavailable">' +
    '<div>' +
    '<span class="settings-plugin-kicker">User management unavailable</span>' +
    '<strong>We could not load additional workspace users.</strong>' +
    '<p>The env-based owner account still works. Check logs before changing roles, deleting users, or handing unattended work to shared operators.</p>' +
    '</div>' +
    '<div class="settings-user-empty-actions">' +
    '<button class="btn btn-sm btn-ghost" onclick="navigate(&quot;monitoring&quot;)">Open logs</button>' +
    '<button class="btn btn-sm btn-ghost" onclick="navigate(&quot;audit&quot;)">Audit trail</button>' +
    '<button class="btn btn-sm btn-primary" onclick="loadUsersSection()">Retry</button>' +
    '</div>' +
    '</section>'
  );
}

function settingsUserActionErrorMessage(kind, err) {
  const detail = err?.error || err?.message ? ` Detail: ${err.error || err.message}` : '';
  const messages = {
    create:
      'User was not created. Check the username, password length, selected role, and whether owner-only user management is available.',
    role:
      'User role was not updated. Reload users, confirm the target account still exists, and review audit before changing access.',
    delete:
      'User was not deleted. Check active sessions, owner account requirements, and audit trail before retrying account removal.',
  };
  return `${messages[kind] || 'User management action failed.'}${detail}`;
}

function settingsActionErrorMessage(kind, err) {
  const detail = err?.error || err?.message ? ` Detail: ${err.error || err.message}` : '';
  const messages = {
    provider:
      'Provider was not changed. Check provider credentials, selected model, base URL, and whether active sessions can restart safely.',
    profile:
      'Provider profile was not saved. Keep the current routing policy, check model availability, and retry before assigning unattended work.',
    plugin:
      'Plugin setting was not changed. Review plugin registry health and logs before restarting NanoCrab.',
    '2fa-disable':
      '2FA was not disabled. Confirm your current password and retry only after account security status reloads.',
    pin:
      'Message was not pinned. Refresh messages and confirm the conversation is still available.',
    unpin:
      'Message was not unpinned. Refresh messages and confirm the pinned message is still available.',
    'token-create':
      'API token was not created. Check owner permissions, token inventory health, and whether this integration should use Credentials or MCP access instead.',
  };
  return `${messages[kind] || 'Settings action failed.'}${detail}`;
}

window.selectProvider = async function (provider) {
  try {
    const provData = await api('/system/provider');
    const model =
      provData.modelsByProvider?.[provider] ||
      provData.defaults?.[provider] ||
      document.getElementById('provider-model')?.value;
    const baseUrl =
      provData.baseUrlsByProvider?.[provider] ||
      provData.definitions?.[provider]?.defaultBaseUrl;
    const restartActive =
      document.getElementById('provider-restart-active')?.checked !== false;
    const r = await api('/system/provider', {
      method: 'PUT',
      body: JSON.stringify({ provider, model, baseUrl, restartActive }),
    });
    if (!r.ok) {
      toast(settingsActionErrorMessage('provider', r), 'error');
      return;
    }
    toast(
      r.closedContainers > 0
        ? `Provider set to ${provider}; closing ${r.closedContainers} active session(s).`
        : `Provider set to ${provider}.`,
      'success',
    );
    navigate('settings');
  } catch (e) {
    toast(settingsActionErrorMessage('provider', e), 'error');
  }
};

window.saveProvider = async function () {
  try {
    const provData = await api('/system/provider');
    const model = document.getElementById('provider-model')?.value;
    const baseUrl = document.getElementById('provider-base-url')?.value?.trim();
    const restartActive =
      document.getElementById('provider-restart-active')?.checked !== false;
    const r = await api('/system/provider', {
      method: 'PUT',
      body: JSON.stringify({
        provider: provData.provider,
        model,
        baseUrl,
        restartActive,
      }),
    });
    if (!r.ok) {
      toast(settingsActionErrorMessage('provider', r), 'error');
      return;
    }
    toast(
      r.closedContainers > 0
        ? `Model updated; closing ${r.closedContainers} active session(s).`
        : 'Model updated.',
      'success',
    );
  } catch (e) {
    toast(settingsActionErrorMessage('provider', e), 'error');
  }
};

window.preflightProvider = async function (provider) {
  const target = document.getElementById('provider-preflight');
  if (target) target.innerHTML = 'Checking...';
  try {
    const r = await api(`/system/provider/preflight/${provider}`);
    if (!target) return;
    target.innerHTML = renderProviderCheckRows(r.checks || []);
  } catch (e) {
    if (target)
      target.innerHTML = `<span class="badge badge-error">Fail</span> ${esc(e.message)}`;
  }
};

window.testAndValidateProvider = async function (provider) {
  const target = document.getElementById('provider-preflight');
  if (target) target.innerHTML = 'Checking...';
  const params = new URLSearchParams();
  const model = document.getElementById('provider-model')?.value?.trim();
  const baseUrl = document.getElementById('provider-base-url')?.value?.trim();
  if (model) params.set('model', model);
  if (baseUrl) params.set('baseUrl', baseUrl);
  try {
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const r = await api(`/system/provider/preflight/${provider}${suffix}`);
    if (!target) return;
    target.innerHTML = renderProviderCheckRows(r.checks || []);
    toast(
      r.ok ? 'Provider test passed' : 'Provider test needs review',
      r.ok ? 'success' : 'warning',
    );
  } catch (e) {
    if (target)
      target.innerHTML = `<span class="badge badge-error">Fail</span> ${esc(e.message)}`;
    toast(settingsActionErrorMessage('provider', e), 'error');
  }
};

function renderProviderCheckRows(checks) {
  return (checks || [])
    .map(
      (c) =>
        `<div class="settings-provider-check">${c.ok ? '<span class="badge badge-success">OK</span>' : '<span class="badge badge-error">Fail</span>'} <span>${esc(c.label)}</span>${c.detail ? ` <span class="settings-provider-check-detail">${esc(c.detail)}</span>` : ''}</div>`,
    )
    .join('');
}

window.refreshSetupPreflight = async function () {
  const target = document.getElementById('setup-preflight-list');
  if (!target) return;
  target.innerHTML = '<div class="settings-diagnostic-loading">Checking...</div>';
  try {
    const result = await api('/system/setup/preflight');
    target.innerHTML = renderSetupPreflightChecks(result.checks || []);
  } catch (e) {
    target.innerHTML = `<span class="badge badge-error">Fail</span> ${esc(e.message)}`;
  }
};

window.refreshReleaseDiagnostics = async function () {
  const target = document.getElementById('release-diagnostics-list');
  if (!target) return;
  target.innerHTML = '<div class="settings-diagnostic-loading">Checking...</div>';
  try {
    const result = await api('/system/release-diagnostics');
    target.innerHTML = renderReleaseDiagnostics(result);
  } catch (e) {
    target.innerHTML = `<span class="badge badge-error">Fail</span> ${esc(e.message)}`;
  }
};

window.saveProviderProfile = async function (profileId) {
  const provider = document.getElementById(
    `profile-provider-${profileId}`,
  )?.value;
  const model = document.getElementById(`profile-model-${profileId}`)?.value;
  const toolPolicy = document.getElementById(
    `profile-policy-${profileId}`,
  )?.value;
  const fallbackProfileId = document.getElementById(
    `profile-fallback-${profileId}`,
  )?.value;
  const target = document.getElementById(`profile-probe-${profileId}`);
  if (target) target.textContent = 'Saving...';
  try {
    const r = await api(`/system/provider/profiles/${profileId}`, {
      method: 'PUT',
      body: JSON.stringify({ provider, model, toolPolicy, fallbackProfileId }),
    });
    if (!r.ok) {
      toast(settingsActionErrorMessage('profile', r), 'error');
      if (target) target.textContent = r.error || 'Profile was not saved';
      return;
    }
    toast('Provider profile saved', 'success');
    if (target) {
      const failed = r.probe?.checks?.find((c) => !c.ok);
      target.textContent = failed
        ? failed.detail || failed.label
      : `${r.profile.provider}/${r.profile.model}`;
    }
  } catch (e) {
    toast(settingsActionErrorMessage('profile', e), 'error');
    if (target) target.textContent = e.message;
  }
};

window.probeProviderProfile = async function (profileId) {
  const target = document.getElementById(`profile-probe-${profileId}`);
  if (target) target.textContent = 'Checking...';
  try {
    const r = await api(`/system/provider/profiles/${profileId}/probe`);
    if (!target) return;
    if (r.error) {
      target.innerHTML = `<span class="badge badge-error">Fail</span> ${esc(r.error)}`;
      return;
    }
    target.innerHTML = renderProviderCheckRows(r.checks || []);
    if (r.errorDetail) {
      target.innerHTML += `<div class="settings-provider-check-error">${esc(r.errorDetail)}</div>`;
    }
  } catch (e) {
    if (target) target.textContent = e.message;
  }
};

window.createUser = async function () {
  const username = document.getElementById('new-user-name')?.value?.trim();
  const password = document.getElementById('new-user-password')?.value;
  const role = document.getElementById('new-user-role')?.value;
  if (!username || !password) {
    toast('Username and password required', 'warning');
    return;
  }
  if (password.length < 8) {
    toast('Password must be at least 8 characters', 'warning');
    return;
  }
  try {
    const r = await api('/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, role }),
    });
    if (r.ok) {
      toast('User created: ' + username, 'success');
      document.getElementById('new-user-name').value = '';
      document.getElementById('new-user-password').value = '';
      loadUsersSection();
    } else {
      toast(settingsUserActionErrorMessage('create', r), 'error');
    }
  } catch (e) {
    toast(settingsUserActionErrorMessage('create', e), 'error');
  }
};

window.changeUserRole = async function (id, newRole) {
  try {
    const r = await api('/users/' + encodeURIComponent(id), {
      method: 'PUT',
      body: JSON.stringify({ role: newRole }),
    });
    if (r.ok) {
      toast('Role updated', 'success');
    } else {
      toast(settingsUserActionErrorMessage('role', r), 'error');
      loadUsersSection();
    }
  } catch (e) {
    toast(settingsUserActionErrorMessage('role', e), 'error');
    loadUsersSection();
  }
};

window.deleteUser = async function (id, username, btnEl) {
  inlineConfirm(btnEl, `Delete ${username}?`, async () => {
    try {
      const r = await api('/users/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
      if (r.ok) {
        toast('User deleted', 'success');
        loadUsersSection();
      } else {
        toast(settingsUserActionErrorMessage('delete', r), 'error');
      }
    } catch (e) {
      toast(settingsUserActionErrorMessage('delete', e), 'error');
    }
  });
};

// --- Plugins Management ---
window.subscribePush = async function () {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('Notification permission denied', 'warning');
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    const vapid = await api('/push/vapid-key');
    if (!vapid.publicKey) {
      toast('VAPID keys not configured', 'error');
      return;
    }

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
    });

    await api('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription }),
    });
    toast('Push notifications enabled', 'success');
    const statusEl = document.getElementById('push-status');
    if (statusEl) statusEl.textContent = 'Ready';
    window.renderSettings?.(document.getElementById('page-content'));
  } catch (e) {
    toast(
      'Push setup failed. Check browser permission, service worker readiness, and VAPID credentials before relying on wake-up alerts.',
      'error',
    );
  }
};

window.testPush = async function () {
  try {
    await api('/push/test', { method: 'POST' });
    toast('Test notification sent', 'success');
  } catch (e) {
    toast(
      'Test notification was not sent. Check VAPID credentials, active subscriptions, and service worker state before trusting push alerts.',
      'error',
    );
  }
};

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i)
    outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function loadPluginsList() {
  const el = document.getElementById('plugins-list');
  if (!el) return;
  try {
    const plugins = await api('/plugins');
    if (!plugins || plugins.length === 0) {
      el.innerHTML = renderSettingsPluginEmptyState();
      return;
    }
    el.innerHTML = plugins
      .map(
        (p) => `
      <div class="channel-card settings-plugin-row">
        <div>
          <strong>${esc(p.name)}</strong> <span class="settings-plugin-version">v${esc(p.version)}</span>
          <div class="settings-plugin-description">${esc(p.description)}</div>
        </div>
        <label class="settings-plugin-toggle">
          <span>${p.enabled ? 'Enabled' : 'Disabled'}</span>
          <input type="checkbox" ${p.enabled ? 'checked' : ''} onchange="togglePlugin('${esc(p.id)}', this.checked)">
        </label>
      </div>
    `,
      )
      .join('');
  } catch {
    el.innerHTML = renderSettingsPluginErrorState();
    addSettingsLoadIssue('Plugin registry unavailable');
  }
}

function renderSettingsPluginEmptyState() {
  return `
    <section class="settings-plugin-empty-state" aria-label="Plugin management guidance">
      <div>
        <span class="settings-plugin-kicker">No optional plugins installed</span>
        <strong>Built-in Copilot, Cowork, Code, and System surfaces are ready.</strong>
        <p>Add Marketplace plugins only when a workflow needs a new channel, MCP helper, document tool, coding automation, or admin integration.</p>
      </div>
      <div class="settings-plugin-empty-actions">
        <button class="btn btn-sm btn-primary" onclick="navigate('marketplace')">Open Marketplace</button>
        <button class="btn btn-sm btn-ghost" onclick="navigate('credentials')">Check credentials</button>
        <button class="btn btn-sm btn-ghost" onclick="navigate('help')">Plugin guide</button>
      </div>
    </section>`;
}

function renderSettingsAvatarEmptyState() {
  return `
    <section class="settings-avatar-empty-state" aria-label="Avatar library empty">
      <div>
        <span>Avatar library</span>
        <strong>No avatar options available</strong>
        <p>Use the current NanoCrab mark or upload a custom avatar so Copilot, Cowork, Code, and channel replies stay recognizable.</p>
      </div>
      <div class="settings-avatar-empty-actions">
        <button type="button" class="btn btn-sm btn-primary" onclick="document.getElementById('avatar-file')?.click()">Upload avatar</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="document.getElementById('identity-name')?.focus()">Edit identity</button>
      </div>
    </section>`;
}

function renderSettingsPluginErrorState() {
  return `
    <section class="settings-plugin-error-state" aria-label="Plugin registry unavailable">
      <div>
        <span class="settings-plugin-kicker">Plugin registry unavailable</span>
        <strong>We could not read installed plugin metadata.</strong>
        <p>Review logs before toggling plugins or restarting NanoCrab. Plugin settings should stay stable until the registry loads cleanly.</p>
      </div>
      <div class="settings-plugin-empty-actions">
        <button class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Open logs</button>
        <button class="btn btn-sm btn-primary" onclick="loadPluginsList()">Retry</button>
      </div>
    </section>`;
}

window.togglePlugin = async function (id, enabled) {
  try {
    await api('/plugins/' + encodeURIComponent(id), {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
    toast(
      `Plugin ${enabled ? 'enabled' : 'disabled'}. Restart required.`,
      'success',
    );
    // Refresh plugins cache
    try {
      window._pluginsList = await api('/plugins');
    } catch {
      window._pluginsList = [];
      addSettingsLoadIssue('Plugin registry unavailable after toggle');
    }
    loadPluginsList();
  } catch (e) {
    toast(settingsActionErrorMessage('plugin', e), 'error');
  }
};

async function loadProvenanceTimeline() {
  const el = document.getElementById('provenance-timeline');
  if (!el) return;
  try {
    const events = await api('/skills/timeline?limit=25');
    if (!events || events.length === 0) {
      el.innerHTML = renderSettingsProvenanceEmptyState();
      return;
    }
    el.innerHTML = `
      <div class="settings-provenance-list">
        ${events
          .map((event) => {
            const type = event.type || 'event';
            const subject = event.subjectName || event.subjectId || '';
            const summary = event.summary || '';
            const actor = event.actor ? ` · ${esc(event.actor)}` : '';
            return `
              <div class="settings-provenance-row">
                <div class="settings-provenance-time">${esc(timeAgo(event.timestamp || ''))}${actor}</div>
                <div>
                  <span class="badge badge-info settings-mini-badge">${esc(type)}</span>
                  <span class="settings-provenance-subject">${esc(subject)}</span>
                  <div class="settings-provenance-summary">${esc(summary)}</div>
                </div>
              </div>`;
          })
          .join('')}
      </div>`;
  } catch {
    el.innerHTML = renderSettingsProvenanceErrorState();
  }
}

function renderSettingsProvenanceEmptyState() {
  return `
    <section class="settings-provenance-empty-state" aria-label="No provenance events recorded">
      <div>
        <span class="settings-plugin-kicker">No provenance events yet</span>
        <strong>Memory, skills, and approved learning will appear here.</strong>
        <p>Use this timeline to audit what changed the assistant's shared context before assigning longer Cowork, Code, or scheduled work.</p>
      </div>
      <div class="settings-provenance-empty-actions">
        <button class="btn btn-sm btn-ghost" onclick="navigate('memory')">Open Memory</button>
        <button class="btn btn-sm btn-ghost" onclick="navigate('skills')">Review Skills</button>
        <button class="btn btn-sm btn-primary" onclick="copySettingsOperatingBrief()">Copy settings brief</button>
      </div>
    </section>`;
}

function renderSettingsProvenanceErrorState() {
  return `
    <section class="settings-provenance-error-state" aria-label="Provenance timeline unavailable">
      <div>
        <span class="settings-plugin-kicker">Timeline unavailable</span>
        <strong>We could not load memory and skill provenance.</strong>
        <p>Check logs before approving new memory, installing skills, or changing unattended work settings.</p>
      </div>
      <div class="settings-provenance-empty-actions">
        <button class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Open logs</button>
        <button class="btn btn-sm btn-primary" onclick="loadProvenanceTimeline()">Retry</button>
      </div>
    </section>`;
}

// --- 2FA Management ---
async function load2faStatus() {
  const el = document.getElementById('2fa-area');
  if (!el) return;
  try {
    const status = await api('/2fa/status');
    if (status.enabled) {
      el.innerHTML = `
        <div class="settings-2fa-state is-enabled">
          <div>
            <span class="badge badge-success">Enabled</span>
            <strong>Two-factor authentication protects this workspace</strong>
            <p>Your login requires a password and a current authenticator code before Copilot, Cowork, Code, or admin controls can be opened.</p>
          </div>
        </div>
        <div class="settings-2fa-disable">
          <div class="form-group">
            <label>Current password to disable</label>
            <input type="password" id="2fa-disable-pw" placeholder="Password">
          </div>
          <button class="btn btn-sm btn-danger" onclick="disable2fa()">Disable 2FA</button>
        </div>`;
    } else {
      el.innerHTML = `
        <div class="settings-2fa-state is-disabled">
          <div>
            <span class="badge badge-warning">Disabled</span>
            <strong>Add a second factor before trusting unattended work</strong>
            <p>Use a TOTP authenticator app so access to memory, credentials, approvals, and coding automation is protected even if a password leaks.</p>
          </div>
          <button class="btn btn-sm btn-primary" onclick="setup2fa()">Setup 2FA</button>
        </div>
        <div id="2fa-setup-area"></div>`;
    }
  } catch {
    el.innerHTML = `
      <div class="settings-2fa-state is-error">
        <div>
          <span class="badge badge-error">Unavailable</span>
          <strong>Could not load 2FA status</strong>
          <p>Refresh this panel before making account security changes. Existing login requirements are not changed by this error.</p>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="load2faStatus()">Retry</button>
      </div>`;
  }
}

window.setup2fa = async function () {
  const area = document.getElementById('2fa-setup-area');
  if (!area) return;
  try {
    const res = await api('/2fa/setup', { method: 'POST' });
    if (!res.ok && !res.qrCode) {
      toast(res.error || 'Setup failed', 'error');
      return;
    }
    area.innerHTML = `
      <div class="settings-2fa-setup-panel">
        <div class="settings-2fa-setup-copy">
          <span class="settings-kicker">Authenticator setup</span>
          <strong>Scan the QR code, then enter the 6-digit code</strong>
          <p>Keep the manual secret somewhere safe until setup is verified. NanoCrab will require a fresh code on future logins.</p>
        </div>
        <div class="settings-2fa-qr-wrap">
          <img src="${res.qrCode}" alt="2FA QR Code">
        </div>
        <div class="settings-2fa-secret">Manual secret <code>${esc(res.secret)}</code></div>
        <div class="settings-2fa-verify">
          <div class="form-group">
            <label>Verification code</label>
            <input type="text" id="2fa-verify-code" class="settings-2fa-code" placeholder="000000" maxlength="6" pattern="[0-9]{6}" inputmode="numeric">
          </div>
          <button class="btn btn-sm btn-primary" onclick="verify2fa()">Verify & Enable</button>
        </div>
      </div>`;
    document.getElementById('2fa-verify-code').focus();
  } catch (e) {
    toast('2FA setup failed: ' + e.message, 'error');
  }
};

window.verify2fa = async function () {
  const code = document.getElementById('2fa-verify-code')?.value;
  if (!code || code.length !== 6) {
    toast('Enter a 6-digit code', 'warning');
    return;
  }
  try {
    const res = await api('/2fa/enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      toast('2FA enabled successfully', 'success');
      load2faStatus();
    } else {
      toast(res.error || 'Invalid code', 'error');
    }
  } catch (e) {
    toast('Verification failed: ' + e.message, 'error');
  }
};

window.disable2fa = async function () {
  const pw = document.getElementById('2fa-disable-pw')?.value;
  if (!pw) {
    toast('Enter your password to disable 2FA', 'warning');
    return;
  }
  try {
    const res = await api('/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) {
      toast('2FA disabled', 'success');
      load2faStatus();
    } else {
      toast(settingsActionErrorMessage('2fa-disable', res), 'error');
    }
  } catch (e) {
    toast(settingsActionErrorMessage('2fa-disable', e), 'error');
  }
};

// --- Personality Editor ---
async function loadPersonalityEditor() {
  const el = document.getElementById('personality-area');
  if (!el) return;
  try {
    const res = await api('/files/global/agents-md');
    el.innerHTML = `
      <textarea id="personality-editor" class="settings-personality-editor" rows="15">${esc(res.content || '')}</textarea>
      <div class="settings-personality-actions">
        <button class="btn btn-sm btn-primary" onclick="savePersonality()">Save</button>
        <span id="personality-msg" class="settings-status-msg"></span>
      </div>`;
  } catch {
    el.innerHTML = renderSettingsPersonalityErrorState();
  }
}

function renderSettingsPersonalityErrorState() {
  return `
    <section class="settings-personality-error-state" aria-label="Personality config unavailable">
      <div>
        <span class="settings-plugin-kicker">Personality config unavailable</span>
        <strong>We could not load the global AGENTS.md instructions.</strong>
        <p>This file shapes assistant behavior across Copilot, Cowork, Code, and scheduled work. Review logs before editing memory, skills, or unattended automation rules.</p>
      </div>
      <div class="settings-personality-error-actions">
        <button class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Open logs</button>
        <button class="btn btn-sm btn-ghost" onclick="navigate('help')">Settings guide</button>
        <button class="btn btn-sm btn-primary" onclick="loadPersonalityEditor()">Retry</button>
      </div>
    </section>`;
}

window.savePersonality = async function () {
  const content = document.getElementById('personality-editor')?.value;
  const msg = document.getElementById('personality-msg');
  if (content == null) return;
  try {
    const res = await api('/files/global/agents-md', {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      setSettingsStatus(msg, 'Saved', 'success');
      toast('Personality updated', 'success');
    } else {
      setSettingsStatus(
        msg,
        res.error || 'Could not save global instructions. Review logs before editing memory or skills.',
        'error',
      );
    }
  } catch {
    setSettingsStatus(
      msg,
      'Could not reach the instructions endpoint. Your changes are still in the editor.',
      'error',
    );
  }
  setTimeout(() => {
    setSettingsStatus(msg, '');
  }, 4000);
};

window.selectAssistantAvatar = async function (selectedAvatarId) {
  const msg = document.getElementById('avatar-msg');
  try {
    const res = await api('/assistant-profile/avatar', {
      method: 'PUT',
      body: JSON.stringify({ selectedAvatarId }),
    });
    if (!res.ok) {
      throw new Error(res.error || 'Failed to save avatar');
    }
    const profile = res.profile;
    document
      .querySelectorAll('.avatar-option')
      .forEach((option) => option.classList.remove('active'));
    const clicked = Array.from(
      document.querySelectorAll('.avatar-option'),
    ).find((option) =>
      option.getAttribute('onclick')?.includes(`'${selectedAvatarId}'`),
    );
    if (clicked) clicked.classList.add('active');
    const preview = document.getElementById('avatar-preview');
    if (preview && profile?.selectedAvatar?.url) {
      preview.src = profile.selectedAvatar.url;
    }
    const name = document.getElementById('avatar-current-name');
    if (name)
      name.textContent = profile?.selectedAvatar?.name || selectedAvatarId;
    const kind = document.getElementById('avatar-current-kind');
    if (kind) kind.textContent = profile?.selectedAvatar?.kind || '';
    if (msg) {
      setSettingsStatus(msg, 'Avatar saved', 'success');
    }
    toast('Assistant avatar updated', 'success');
  } catch (err) {
    if (msg) {
      setSettingsStatus(
        msg,
        err.message || 'Avatar selection failed. Keep the current assistant avatar for now.',
        'error',
      );
    }
    toast(err.message || 'Failed to save avatar', 'error');
  }
  setTimeout(() => {
    setSettingsStatus(msg, '');
  }, 4000);
};

// --- API Tokens ---
async function loadApiTokens() {
  try {
    const tokens = await api('/tokens');
    const el = document.getElementById('tokens-list');
    if (!el) return;
    if (tokens.length === 0) {
      el.innerHTML = renderSettingsTokenEmptyState();
    } else {
      el.innerHTML = tokens
        .map(
          (t) => `
        <div class="settings-token-row">
          <div>
            <span class="settings-token-name">${esc(t.name)}</span>
            <code class="settings-token-code">${esc(t.token)}</code>
          </div>
          <div class="settings-token-actions">
            <span class="settings-token-last-used">${t.lastUsed ? 'Used ' + timeAgo(t.lastUsed) : 'Never used'}</span>
            <button class="btn btn-sm btn-danger" onclick="revokeApiToken('${esc(t.id)}', this)">Revoke</button>
          </div>
        </div>`,
        )
        .join('');
    }
  } catch {
    const el = document.getElementById('tokens-list');
    if (el) el.innerHTML = renderSettingsTokenErrorState();
  }
}

function renderSettingsTokenEmptyState() {
  return `
    <section class="settings-token-empty-state" aria-label="No API tokens created">
      <div>
        <span class="settings-plugin-kicker">No API tokens created</span>
        <strong>Create tokens only for systems that need NanoCrab's admin API.</strong>
        <p>Name tokens by integration and owner. Keep provider, MCP, email, and document credentials in Credentials instead of sharing them through API tokens.</p>
      </div>
      <div class="settings-token-empty-actions">
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('new-token-name')?.focus()">Name a token</button>
        <button class="btn btn-sm btn-ghost" onclick="navigate('credentials')">Credentials</button>
      </div>
    </section>`;
}

function renderSettingsTokenErrorState() {
  return `
    <section class="settings-token-error-state" aria-label="API token list unavailable">
      <div>
        <span class="settings-plugin-kicker">Token list unavailable</span>
        <strong>We could not load API token metadata.</strong>
        <p>Do not create replacement tokens until the current list loads, or you may lose track of active external access.</p>
      </div>
      <div class="settings-token-empty-actions">
        <button class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Open logs</button>
        <button class="btn btn-sm btn-primary" onclick="loadApiTokens()">Retry</button>
      </div>
    </section>`;
}

window.createApiToken = async () => {
  const nameEl = document.getElementById('new-token-name');
  const name = nameEl.value.trim();
  if (!name) {
    toast('Token name required', 'error');
    return;
  }
  try {
    const r = await api('/tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (r.token) {
      const display = document.getElementById('new-token-display');
      document.getElementById('new-token-value').textContent = r.token;
      display.classList.remove('is-hidden');
      nameEl.value = '';
      loadApiTokens();
      toast('Token created', 'success');
    } else {
      toast(settingsActionErrorMessage('token-create', r), 'error');
    }
  } catch (e) {
    toast(settingsActionErrorMessage('token-create', e), 'error');
  }
};

window.revokeApiToken = async (id, btnEl) => {
  inlineConfirm(btnEl, 'Revoke this token?', async () => {
    await api('/tokens/' + id, { method: 'DELETE' });
    toast('Token revoked', 'success');
    loadApiTokens();
  });
};

// --- Report Config ---
async function loadReportConfig() {
  try {
    const config = await api('/system/report-config');
    let providerProfiles = { profiles: [] };
    let providerProfileIssue = '';
    try {
      providerProfiles = await api('/system/provider/profiles');
    } catch {
      providerProfileIssue = 'Report provider profiles unavailable';
      addSettingsLoadIssue(providerProfileIssue);
    }
    const el = document.getElementById('report-config-area');
    if (!el) return;
    const sourceOptions = [
      'journal',
      'memory',
      'skill-suggestions',
      'github',
      'wiki',
      'kdrive',
      'web',
    ];
    const formatOptions = ['markdown', 'docx', 'pdf', 'html'];
    el.innerHTML = `
      <div class="channel-card settings-report-toggle">
        <span>Enable scheduled report pipeline</span>
        <input type="checkbox" id="report-enabled" ${config.enabled ? 'checked' : ''}>
      </div>
      <div class="settings-report-grid">
        <div class="form-group settings-report-field">
          <label>Schedule</label>
          <select id="report-schedule">
            <option value="weekly" ${config.schedule === 'weekly' ? 'selected' : ''}>Weekly</option>
            <option value="daily" ${config.schedule === 'daily' ? 'selected' : ''}>Daily</option>
          </select>
        </div>
        <div class="form-group settings-report-field">
          <label>Provider profile</label>
          <select id="report-provider-profile">
            ${(providerProfiles.profiles || [])
              .map(
                (profile) =>
                  `<option value="${esc(profile.id)}" ${config.providerProfileId === profile.id ? 'selected' : ''}>${esc(profile.label || profile.id)}</option>`,
              )
              .join('')}
          </select>
        </div>
      </div>
      ${
        providerProfileIssue
          ? `<section class="settings-report-warning">
              <strong>Provider profiles need review</strong>
              <span>Scheduled reports can keep their saved configuration, but profile choices did not load. Check provider setup before enabling recurring reports.</span>
            </section>`
          : ''
      }
      <div class="form-group settings-report-block">
        <label>Target chat JID</label>
        <input class="search-input settings-report-input" id="report-jid" value="${esc(config.targetJid)}" placeholder="e.g. sig:+1234567890">
      </div>
      <div class="form-group settings-report-block">
        <label>Deliverables directory</label>
        <input class="search-input settings-report-input" id="report-deliverables-dir" value="${esc(config.deliverablesDir || 'store/deliverables')}">
      </div>
      <div class="settings-report-grid settings-report-options">
        <div>
          <label class="settings-field-label">Sources</label>
          ${sourceOptions
            .map(
              (source) =>
                `<label class="settings-report-check"><input type="checkbox" class="report-source" value="${source}" ${(config.sourceScopes || []).includes(source) ? 'checked' : ''}> ${source}</label>`,
            )
            .join('')}
        </div>
        <div>
          <label class="settings-field-label">Formats</label>
          ${formatOptions
            .map(
              (format) =>
                `<label class="settings-report-check"><input type="checkbox" class="report-format" value="${format}" ${(config.outputFormats || []).includes(format) ? 'checked' : ''}> ${format}</label>`,
            )
            .join('')}
          <label class="settings-report-check settings-report-approval"><input type="checkbox" id="report-outline-approval" ${config.requireOutlineApproval !== false ? 'checked' : ''}> require outline approval</label>
        </div>
      </div>
      <div class="settings-report-actions">
        <button class="btn btn-sm btn-primary" onclick="saveReportConfig()">Save</button>
        <span id="report-msg" class="settings-status-msg"></span>
      </div>`;
  } catch {
    const el = document.getElementById('report-config-area');
    if (el) el.innerHTML = renderSettingsReportErrorState();
  }
}

function renderSettingsReportErrorState() {
  return `
    <section class="settings-report-error-state" aria-label="Scheduled report settings unavailable">
      <div>
        <span class="settings-plugin-kicker">Report settings unavailable</span>
        <strong>We could not load scheduled report automation.</strong>
        <p>Keep recurring summaries and generated documents paused until cadence, source scope, output format, and approval rules load cleanly.</p>
      </div>
      <div class="settings-report-error-actions">
        <button class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Open logs</button>
        <button class="btn btn-sm btn-ghost" onclick="navigate('reports')">Reports</button>
        <button class="btn btn-sm btn-primary" onclick="loadReportConfig()">Retry</button>
      </div>
    </section>`;
}

window.saveReportConfig = async () => {
  const msg = document.getElementById('report-msg');
  try {
    const r = await api('/system/report-config', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: document.getElementById('report-enabled').checked,
        schedule: document.getElementById('report-schedule').value,
        targetJid: document.getElementById('report-jid').value,
        providerProfileId: document.getElementById('report-provider-profile')
          ?.value,
        requireOutlineApproval: document.getElementById(
          'report-outline-approval',
        )?.checked,
        deliverablesDir: document.getElementById('report-deliverables-dir')
          ?.value,
        sourceScopes: Array.from(document.querySelectorAll('.report-source'))
          .filter((item) => item.checked)
          .map((item) => item.value),
        outputFormats: Array.from(document.querySelectorAll('.report-format'))
          .filter((item) => item.checked)
          .map((item) => item.value),
      }),
    });
    if (r.ok) {
      setSettingsStatus(msg, 'Saved', 'success');
      toast('Report config saved', 'success');
    } else {
      setSettingsStatus(
        msg,
        r.error || 'Report config was not saved. Keep scheduled reports paused until this succeeds.',
        'error',
      );
    }
  } catch {
    setSettingsStatus(
      msg,
      'Could not reach report settings. Check the admin API before enabling reports.',
      'error',
    );
  }
  setTimeout(() => {
    setSettingsStatus(msg, '');
  }, 3000);
};

// --- Pin/Unpin Messages ---
window.pinMessage = async (id, chatJid, pinned) => {
  try {
    const r = await api(
      `/messages/pin/${encodeURIComponent(id)}?chatJid=${encodeURIComponent(chatJid)}`,
      { method: 'PUT', body: JSON.stringify({ pinned }) },
    );
    if (r.ok) {
      toast('Message pinned', 'success');
      if (currentPage === 'messages') navigate('messages');
    } else toast(settingsActionErrorMessage('pin', r), 'error');
  } catch (e) {
    toast(settingsActionErrorMessage('pin', e), 'error');
  }
};

window.unpinMessage = async (id, chatJid) => {
  try {
    const r = await api(
      `/messages/pin/${encodeURIComponent(id)}?chatJid=${encodeURIComponent(chatJid)}`,
      { method: 'PUT', body: JSON.stringify({ pinned: false }) },
    );
    if (r.ok) {
      toast('Message unpinned', 'success');
      if (currentPage === 'messages') navigate('messages');
    } else toast(settingsActionErrorMessage('unpin', r), 'error');
  } catch (e) {
    toast(settingsActionErrorMessage('unpin', e), 'error');
  }
};
