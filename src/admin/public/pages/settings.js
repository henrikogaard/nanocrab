// NanoCrab Admin — Settings Page

async function renderSettings(el) {
  const currentTheme =
    document.documentElement.getAttribute('data-theme') || 'dark';
  const themeLabels = {
    dark: 'Dark',
    light: 'Light',
    midnight: 'Midnight Blue',
    forest: 'Forest Green',
    amber: 'Warm Amber',
  };
  const themeColors = {
    dark: '#18181b',
    light: '#ffffff',
    midnight: '#0f1729',
    forest: '#0f1a14',
    amber: '#1a1408',
  };

  // Load identity + provider
  let identity = { name: '', trigger: '' };
  try {
    identity = await api('/system/identity');
  } catch {}
  let providerInfo = {
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    available: {},
    modelsByProvider: {},
  };
  try {
    providerInfo = await api('/system/provider');
  } catch {}
  let agentBoundaries = [];
  try {
    agentBoundaries = await api('/agents/boundaries');
  } catch {}
  const isOwner = (window._userRole || 'owner') === 'owner';
  let setupPreflight = null;
  if (isOwner) {
    try {
      setupPreflight = await api('/system/setup/preflight');
    } catch {}
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
  const providerCards = Object.values(providerDefinitions)
    .filter((p) => p && p.selectable !== false)
    .map(
      (p) => `
      <button type="button" onclick="selectProvider('${esc(p.id)}')" style="text-align:left;padding:14px;border:2px solid ${selectedProvider === p.id ? 'var(--accent)' : 'var(--border)'};border-radius:var(--radius-sm);cursor:pointer;background:${selectedProvider === p.id ? 'var(--accent-bg, rgba(67,167,154,0.1))' : 'var(--surface)'};transition:border-color 0.15s">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
          <strong style="font-size:14px;color:var(--text)">${esc(p.name || p.id)}</strong>
          ${providerInfo.available?.[p.id] ? '<span class="badge badge-success" style="font-size:9px">Available</span>' : '<span class="badge badge-warning" style="font-size:9px">Needs setup</span>'}
        </div>
        <div style="font-size:11px;color:var(--text-muted);line-height:1.35">${esc(p.description || '')}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:6px">${esc(p.runtime || '')}${p.envKey ? ` · ${esc(p.envKey)}` : ''}</div>
      </button>
    `,
    )
    .join('');
  const providerBaseUrlField =
    selectedDefinition?.runtime === 'openai-compatible'
      ? `
    <div class="form-group" style="margin:0;min-width:280px;flex:1">
      <label style="font-size:12px;color:var(--text-muted)">Base URL</label>
      <input class="search-input" id="provider-base-url" value="${esc(selectedBaseUrl)}" placeholder="${esc(selectedDefinition.defaultBaseUrl || '')}">
    </div>
  `
      : '';
  const providerCredentialHint = selectedDefinition?.envKey
    ? `
    <div style="margin-top:8px;font-size:11px;color:var(--text-muted)">
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
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Provider Profiles</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Choose the default provider/model for each NanoCrab capability. Write-capable work still follows approval and container isolation rules.</p>
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
                  <td style="color:var(--text);font-weight:600">${esc(providerPurposeLabels[profile.id] || profile.label || profile.id)}</td>
                  <td>
                    <select class="search-input" id="profile-provider-${esc(profile.id)}" style="min-width:150px;padding:5px 8px;font-size:12px">
                      ${profileOptions.replace(`value="${esc(profile.provider)}"`, `value="${esc(profile.provider)}" selected`)}
                    </select>
                  </td>
                  <td>
                    <input class="search-input" id="profile-model-${esc(profile.id)}" list="profile-models-${esc(profile.id)}" value="${esc(profile.model)}" style="min-width:190px;padding:5px 8px;font-size:12px">
                    <datalist id="profile-models-${esc(profile.id)}">
                      ${models.map((m) => `<option value="${esc(m)}"></option>`).join('')}
                    </datalist>
                  </td>
                  <td>
                    <select class="search-input" id="profile-policy-${esc(profile.id)}" style="min-width:150px;padding:5px 8px;font-size:12px">
                      ${['deny', 'read-only', 'approval-required', 'allow']
                        .map(
                          (policy) =>
                            `<option value="${policy}" ${profile.toolPolicy === policy ? 'selected' : ''}>${policy}</option>`,
                        )
                        .join('')}
                    </select>
                  </td>
                  <td>
                    <select class="search-input" id="profile-fallback-${esc(profile.id)}" style="min-width:145px;padding:5px 8px;font-size:12px">
                      ${fallbackOptions}
                    </select>
                  </td>
                  <td>
                    ${
                      probe?.ok
                        ? '<span class="badge badge-success">Ready</span>'
                        : '<span class="badge badge-warning">Needs review</span>'
                    }
                    <div id="profile-probe-${esc(profile.id)}" style="font-size:11px;color:var(--text-muted);margin-top:4px">${esc(probe?.checks?.find((c) => !c.ok)?.detail || profile.provider + '/' + profile.model)}</div>
                    <div style="font-size:10px;color:var(--text-muted);margin-top:3px">${esc(reliability)}${probe?.lastProbeAt ? ` · ${esc(timeAgo(probe.lastProbeAt))}` : ''}</div>
                    ${lastError ? `<div style="font-size:10px;color:var(--error);margin-top:3px">${esc(lastError)}</div>` : ''}
                  </td>
                  <td style="white-space:nowrap">
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
  const agentBoundaryCard = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Agent Boundaries</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Runtime scopes are derived before containers receive mounts, provider profiles, skills, channels, or connector tools.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Agent</th><th>Channels</th><th>Connectors</th><th>Provider Profiles</th><th>External Writes</th></tr></thead>
          <tbody>
            ${
              (agentBoundaries || [])
                .map((item) => {
                  const boundary = item.boundary || {};
                  return `<tr>
                  <td style="font-weight:600;color:var(--text)">${esc(item.name || item.folder || boundary.agentId || '')}</td>
                  <td>${(boundary.channelScopes || []).map((scope) => `<span class="badge badge-muted">${esc(scope)}</span>`).join(' ')}</td>
                  <td>${(boundary.connectorIds || [])
                    .slice(0, 5)
                    .map(
                      (connector) =>
                        `<span class="badge badge-info">${esc(connector)}</span>`,
                    )
                    .join(' ')}</td>
                  <td style="font-size:11px;color:var(--text-muted)">${esc((boundary.providerProfiles || []).join(', '))}</td>
                  <td><span class="badge ${boundary.externalWrites?.allowed ? 'badge-warning' : 'badge-success'}">${boundary.externalWrites?.allowed ? 'approval gated' : 'denied'}</span></td>
                </tr>`;
                })
                .join('') ||
              '<tr><td colspan="5" style="color:var(--text-muted)">No registered agents.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>`;
  const setupPreflightCard =
    isOwner && setupPreflight
      ? `
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px">
        <div class="card-title" style="margin:0">First-Run Preflight</div>
        <button class="btn btn-sm btn-ghost" onclick="refreshSetupPreflight()">Refresh</button>
      </div>
      <div id="setup-preflight-list" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px">
        ${setupPreflight.checks
          .map(
            (check) => `
          <div style="padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
              <strong style="font-size:12px;color:var(--text)">${esc(check.label)}</strong>
              <span class="badge ${check.ok ? 'badge-success' : 'badge-error'}">${check.ok ? 'OK' : 'Fail'}</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:5px;line-height:1.35">${esc(check.detail || '')}</div>
          </div>`,
          )
          .join('')}
      </div>
    </div>`
      : '';

  el.innerHTML = `
    <div class="page-header"><h2>Settings</h2></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <div class="card-title">Change Password</div>
        <div id="pw-msg" style="margin-bottom:12px;font-size:13px;display:none;padding:8px 12px;border-radius:var(--radius-sm)"></div>
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
          <div class="form-group"><label>Bot Name</label><input id="identity-name" value="${esc(identity.name)}" placeholder="Andy"></div>
          <div class="form-group"><label>Trigger Word (read-only, derived from name)</label><input id="identity-trigger" value="${esc(identity.trigger)}" disabled style="opacity:0.6"></div>
          <div style="display:flex;gap:8px;align-items:center">
            <button type="submit" class="btn btn-primary btn-sm">Save Identity</button>
            <span id="identity-msg" style="font-size:12px"></span>
          </div>
          <p style="font-size:11px;color:var(--text-muted);margin-top:8px">Changes update .env and all group agent instruction files. Requires restart.</p>
        </form>
      </div>
    </div>
    ${
      isOwner
        ? `<div class="card" style="margin-bottom:16px">
      <div class="card-title">Agent Provider</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Agent runtime for bot replies. Integrations below are separate API/service providers.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:12px">
        ${providerCards}
      </div>
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div class="form-group" style="margin:0;min-width:220px">
          <label style="font-size:12px;color:var(--text-muted)">Default model</label>
          <input class="search-input" id="provider-model" list="provider-model-options" value="${esc(selectedModel)}">
          <datalist id="provider-model-options">
            ${selectedModels.map((m) => `<option value="${esc(m)}"></option>`).join('')}
          </datalist>
        </div>
        ${providerBaseUrlField}
        <button class="btn btn-sm btn-primary" onclick="saveProvider()">Save</button>
        <button class="btn btn-sm btn-ghost" onclick="preflightProvider('${esc(selectedProvider)}')">Preflight</button>
        <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text-muted)"><input type="checkbox" id="provider-restart-active" checked> restart active sessions</label>
        <span id="provider-msg" style="font-size:12px;color:var(--text-muted)"></span>
      </div>
      <div id="provider-preflight" style="margin-top:8px;font-size:11px;color:var(--text-muted)"></div>
      <div style="margin-top:8px;font-size:11px;color:var(--text-muted)">
        Codex OAuth: ${providerInfo.auth?.codex?.configured ? '<span class="badge badge-success">Configured for containers</span>' : providerInfo.auth?.codex?.hasHostAuth ? '<span class="badge badge-info">Host login found; switching to Codex will import it</span>' : '<span class="badge badge-warning">Run codex login --device-auth</span>'}
      </div>
      ${providerCredentialHint}
    </div>
    ${providerProfilesCard}`
        : ''
    }
    ${setupPreflightCard}
    ${isOwner ? '<div id="users-section"></div>' : ''}
    ${isOwner ? agentBoundaryCard : ''}
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">Appearance</div>
        <div style="margin-bottom:16px">
          <label style="font-size:12px;color:var(--text-muted);font-weight:500;display:block;margin-bottom:8px">Theme</label>
          <div class="theme-grid">
            ${THEMES.map(
              (t) => `
              <button class="theme-option ${currentTheme === t ? 'active' : ''}" data-theme="${t}" onclick="setTheme('${t}')">
                <div class="theme-preview" style="background:${themeColors[t]}"></div>
                <span>${themeLabels[t]}</span>
              </button>`,
            ).join('')}
          </div>
        </div>
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
          <div class="card-title">Bot Avatar</div>
          <div style="display:flex;align-items:center;gap:16px">
            <img src="/static/avatar.jpg" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--border)" onerror="this.onerror=null;this.src='/static/nanocrab-mark.png'" id="avatar-preview" alt="Bot avatar">
            <div>
              <input type="file" id="avatar-file" accept="image/*" style="display:none">
              <button class="btn btn-sm btn-ghost" onclick="document.getElementById('avatar-file').click()">Upload New Avatar</button>
              <div id="avatar-msg" style="font-size:12px;color:var(--text-muted);margin-top:4px"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Push Notifications</div>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Receive alerts on your phone even when the browser is closed. Works with uptime alerts, automation notices, and agent tasks.</p>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <button class="btn btn-sm btn-primary" id="push-subscribe-btn" onclick="subscribePush()">Enable Push</button>
          <button class="btn btn-sm btn-ghost" onclick="testPush()">Test</button>
          <span id="push-status" style="font-size:12px;color:var(--text-muted)">${typeof Notification !== 'undefined' ? (Notification.permission === 'granted' ? 'Enabled' : Notification.permission) : 'Not supported'}</span>
        </div>
        <div id="push-subs-list" style="font-size:11px;color:var(--text-muted)"></div>
      </div>
    </div>
    <div class="grid grid-2" ${!isOwner ? 'style="display:none"' : ''}>
      <div class="card">
        <div class="card-title">API Tokens</div>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Create tokens for external API integrations. Use as <code>Authorization: Bearer &lt;token&gt;</code></p>
        <div id="tokens-list" style="margin-bottom:12px"><div class="empty">Loading...</div></div>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="search-input" id="new-token-name" placeholder="Token name" style="max-width:200px">
          <button class="btn btn-sm btn-primary" onclick="createApiToken()">Create Token</button>
        </div>
        <div id="new-token-display" style="display:none;margin-top:12px;padding:12px;background:var(--bg);border:1px solid var(--accent);border-radius:var(--radius-sm)">
          <div style="font-size:12px;color:var(--warning);margin-bottom:4px">Copy this token now - it won't be shown again:</div>
          <code id="new-token-value" style="font-size:13px;word-break:break-all"></code>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Scheduled Reports</div>
        <div id="report-config-area"><div class="empty">Loading...</div></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-title">Plugins</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Enable or disable optional features. Changes take effect after restart.</p>
      <div id="plugins-list"><div class="empty">Loading...</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-title">Two-Factor Authentication</div>
      <div id="2fa-area"><div class="empty">Loading...</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-title">Personality</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Edit the global AGENTS.md instructions that shape your bot's personality and behavior.</p>
      <div id="personality-area"><div class="empty">Loading...</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-title">Provenance Timeline</div>
      <div id="provenance-timeline"><div class="empty">Loading...</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div style="display:flex;align-items:center;gap:20px">
        <img src="/static/nanocrab-mark.png" style="width:64px;height:64px" alt="NanoCrab">
        <div>
          <div style="font-size:20px;font-weight:700;color:var(--text)">${window._editionShort || 'NanoCrab'}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${window._editionName || ''} v${window._editionVersion || '?'}</div>
        </div>
      </div>
      <table style="font-size:13px;margin-top:16px">
        <tr><td style="padding:4px 16px 4px 0;color:var(--text-muted)">App Version</td><td style="padding:4px 0;color:var(--text)">${window._appVersion || '—'}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:var(--text-muted)">Node.js</td><td style="padding:4px 0;color:var(--text)">${typeof process !== 'undefined' ? process.version : 'N/A'}</td></tr>
      </table>
    </div>`;

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
      msg.textContent = 'Passwords do not match';
      msg.style.background = 'var(--error-bg)';
      msg.style.color = 'var(--error)';
      msg.style.display = 'block';
      return;
    }
    try {
      const r = await api('/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: cur, newPassword: np }),
      });
      if (r.ok) {
        msg.textContent = 'Password changed';
        msg.style.background = 'var(--success-bg)';
        msg.style.color = 'var(--success)';
        msg.style.display = 'block';
        document.getElementById('pw-form').reset();
      } else {
        msg.textContent = r.error || 'Failed';
        msg.style.background = 'var(--error-bg)';
        msg.style.color = 'var(--error)';
        msg.style.display = 'block';
      }
    } catch {
      msg.textContent = 'Error';
      msg.style.background = 'var(--error-bg)';
      msg.style.color = 'var(--error)';
      msg.style.display = 'block';
    }
  };

  document.getElementById('avatar-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const msgEl = document.getElementById('avatar-msg');
    msgEl.textContent = 'Uploading...';
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch('/api/system/avatar', {
        method: 'POST',
        body: buf,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      const data = await res.json();
      if (data.ok) {
        msgEl.textContent = 'Avatar updated!';
        msgEl.style.color = 'var(--success)';
        document.getElementById('avatar-preview').src =
          '/static/avatar.jpg?' + Date.now();
      } else {
        msgEl.textContent = 'Failed';
        msgEl.style.color = 'var(--error)';
      }
    } catch {
      msgEl.textContent = 'Upload error';
      msgEl.style.color = 'var(--error)';
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
        msg.textContent = 'Name required';
        msg.style.color = 'var(--error)';
        return;
      }
      try {
        const r = await api('/system/identity', {
          method: 'PUT',
          body: JSON.stringify({ name }),
        });
        if (r.ok) {
          msg.textContent = r.message || 'Saved';
          msg.style.color = 'var(--success)';
          document.getElementById('identity-trigger').value = '@' + name;
        } else {
          msg.textContent = r.error || 'Failed';
          msg.style.color = 'var(--error)';
        }
      } catch {
        msg.textContent = 'Error';
        msg.style.color = 'var(--error)';
      }
      setTimeout(() => {
        if (msg) msg.textContent = '';
      }, 4000);
    };
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
        '<div class="empty" style="padding:8px">No additional users. Single-user mode is active (env credentials).</div>';
    } else {
      usersHtml = users
        .map(
          (u) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <div>
            <span style="font-weight:600">${esc(u.username)}</span>
            <span class="badge badge-${u.role === 'owner' ? 'success' : u.role === 'admin' ? 'warning' : 'muted'}" style="margin-left:8px;font-size:11px">${u.role}</span>
            <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${u.last_login ? 'Last login ' + timeAgo(u.last_login) : 'Never logged in'}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <select style="font-size:12px;padding:2px 6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm)" onchange="changeUserRole('${esc(u.id)}', this.value)">
              ${roleOptions.map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
            <button class="btn btn-sm btn-danger" onclick="deleteUser('${esc(u.id)}', '${esc(u.username)}', this)">Delete</button>
          </div>
        </div>`,
        )
        .join('');
    }
    section.innerHTML = `
      <div class="card" style="margin-top:16px">
        <div class="card-title">User Management</div>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Add users for multi-user access control. The env-based admin account always works as owner.</p>
        <div id="users-list" style="margin-bottom:16px">${usersHtml}</div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="form-group" style="margin:0">
            <label style="font-size:12px;color:var(--text-muted)">Username</label>
            <input class="search-input" id="new-user-name" placeholder="username" style="max-width:150px">
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:12px;color:var(--text-muted)">Password</label>
            <input class="search-input" id="new-user-password" type="password" placeholder="min 8 chars" style="max-width:150px">
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:12px;color:var(--text-muted)">Role</label>
            <select id="new-user-role" style="font-size:12px;padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm)">
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
              <option value="owner">owner</option>
            </select>
          </div>
          <button class="btn btn-sm btn-primary" onclick="createUser()">Add User</button>
        </div>
      </div>`;
  } catch {
    section.innerHTML = '';
  }
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
      toast(r.error || 'Failed', 'error');
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
    toast('Failed: ' + e.message, 'error');
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
      toast(r.error || 'Failed', 'error');
      return;
    }
    toast(
      r.closedContainers > 0
        ? `Model updated; closing ${r.closedContainers} active session(s).`
        : 'Model updated.',
      'success',
    );
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.preflightProvider = async function (provider) {
  const target = document.getElementById('provider-preflight');
  if (target) target.innerHTML = 'Checking...';
  try {
    const r = await api(`/system/provider/preflight/${provider}`);
    if (!target) return;
    target.innerHTML = r.checks
      .map(
        (c) =>
          `<div style="margin-top:4px">${c.ok ? '<span class="badge badge-success">OK</span>' : '<span class="badge badge-error">Fail</span>'} ${esc(c.label)}${c.detail ? ` <span style="color:var(--text-muted)">${esc(c.detail)}</span>` : ''}</div>`,
      )
      .join('');
  } catch (e) {
    if (target)
      target.innerHTML = `<span class="badge badge-error">Fail</span> ${esc(e.message)}`;
  }
};

window.refreshSetupPreflight = async function () {
  const target = document.getElementById('setup-preflight-list');
  if (!target) return;
  target.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">Checking...</div>';
  try {
    const result = await api('/system/setup/preflight');
    target.innerHTML = result.checks
      .map(
        (check) => `
        <div style="padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <strong style="font-size:12px;color:var(--text)">${esc(check.label)}</strong>
            <span class="badge ${check.ok ? 'badge-success' : 'badge-error'}">${check.ok ? 'OK' : 'Fail'}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:5px;line-height:1.35">${esc(check.detail || '')}</div>
        </div>`,
      )
      .join('');
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
      toast(r.error || 'Failed', 'error');
      if (target) target.textContent = r.error || 'Failed';
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
    toast('Failed: ' + e.message, 'error');
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
    target.innerHTML = r.checks
      .map(
        (c) =>
          `<div>${c.ok ? '<span class="badge badge-success">OK</span>' : '<span class="badge badge-error">Fail</span>'} ${esc(c.label)}${c.detail ? ` <span style="color:var(--text-muted)">${esc(c.detail)}</span>` : ''}</div>`,
      )
      .join('');
    if (r.errorDetail) {
      target.innerHTML += `<div style="color:var(--error);margin-top:4px">${esc(r.errorDetail)}</div>`;
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
      toast(r.error || 'Failed', 'error');
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
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
      toast(r.error || 'Failed', 'error');
      loadUsersSection();
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
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
        toast(r.error || 'Failed', 'error');
      }
    } catch (e) {
      toast('Failed: ' + e.message, 'error');
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
    toast('Push notifications enabled!', 'success');
    const statusEl = document.getElementById('push-status');
    if (statusEl) statusEl.textContent = 'Enabled';
  } catch (e) {
    toast('Push setup failed: ' + e.message, 'error');
  }
};

window.testPush = async function () {
  try {
    await api('/push/test', { method: 'POST' });
    toast('Test notification sent', 'success');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
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
      el.innerHTML = '<div class="empty">No plugins installed</div>';
      return;
    }
    el.innerHTML = plugins
      .map(
        (p) => `
      <div class="channel-card" style="padding:10px 0;display:flex;justify-content:space-between;align-items:center">
        <div>
          <strong>${esc(p.name)}</strong> <span style="font-size:11px;color:var(--text-muted)">v${esc(p.version)}</span>
          <div style="font-size:12px;color:var(--text-muted)">${esc(p.description)}</div>
        </div>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0">
          <span style="font-size:11px;color:var(--text-muted)">${p.enabled ? 'Enabled' : 'Disabled'}</span>
          <input type="checkbox" ${p.enabled ? 'checked' : ''} onchange="togglePlugin('${esc(p.id)}', this.checked)">
        </label>
      </div>
    `,
      )
      .join('');
  } catch {
    el.innerHTML = '<div class="empty">Failed to load plugins</div>';
  }
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
    window._pluginsList = await api('/plugins').catch(() => []);
    loadPluginsList();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

async function loadProvenanceTimeline() {
  const el = document.getElementById('provenance-timeline');
  if (!el) return;
  try {
    const events = await api('/skills/timeline?limit=25');
    if (!events || events.length === 0) {
      el.innerHTML = '<div class="empty">No provenance events yet</div>';
      return;
    }
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${events
          .map((event) => {
            const type = event.type || 'event';
            const subject = event.subjectName || event.subjectId || '';
            const summary = event.summary || '';
            const actor = event.actor ? ` · ${esc(event.actor)}` : '';
            return `
              <div style="display:grid;grid-template-columns:150px 1fr;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                <div style="font-size:11px;color:var(--text-muted)">${esc(timeAgo(event.timestamp || ''))}${actor}</div>
                <div>
                  <span class="badge badge-info" style="font-size:10px">${esc(type)}</span>
                  <span style="font-size:12px;font-weight:600;color:var(--text);margin-left:6px">${esc(subject)}</span>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(summary)}</div>
                </div>
              </div>`;
          })
          .join('')}
      </div>`;
  } catch {
    el.innerHTML =
      '<div class="empty">Failed to load provenance timeline</div>';
  }
}

// --- 2FA Management ---
async function load2faStatus() {
  const el = document.getElementById('2fa-area');
  if (!el) return;
  try {
    const status = await api('/2fa/status');
    if (status.enabled) {
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <span class="badge badge-success" style="font-size:12px">Enabled</span>
          <span style="font-size:12px;color:var(--text-muted)">Two-factor authentication is active on your account.</span>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end">
          <div class="form-group" style="margin:0;flex:1;max-width:240px">
            <label style="font-size:12px;color:var(--text-muted)">Current password to disable</label>
            <input type="password" id="2fa-disable-pw" placeholder="Password" style="width:100%">
          </div>
          <button class="btn btn-sm btn-danger" onclick="disable2fa()">Disable 2FA</button>
        </div>`;
    } else {
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <span class="badge badge-muted" style="font-size:12px">Disabled</span>
          <span style="font-size:12px;color:var(--text-muted)">Protect your account with a TOTP authenticator app.</span>
        </div>
        <button class="btn btn-sm btn-primary" onclick="setup2fa()">Setup 2FA</button>
        <div id="2fa-setup-area"></div>`;
    }
  } catch {
    el.innerHTML = '<div class="empty">Failed to load 2FA status</div>';
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
      <div style="margin-top:16px;padding:16px;background:var(--surface2);border-radius:var(--radius-sm);border:1px solid var(--border)">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px">Scan this QR code with your authenticator app:</div>
        <div style="text-align:center;margin-bottom:12px">
          <img src="${res.qrCode}" alt="2FA QR Code" style="max-width:200px;border-radius:8px;background:#fff;padding:8px">
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Or enter this secret manually: <code style="user-select:all;font-weight:600">${esc(res.secret)}</code></div>
        <div style="display:flex;gap:8px;align-items:flex-end">
          <div class="form-group" style="margin:0;flex:1;max-width:200px">
            <label style="font-size:12px;color:var(--text-muted)">Verification code</label>
            <input type="text" id="2fa-verify-code" placeholder="000000" maxlength="6" pattern="[0-9]{6}" inputmode="numeric" style="width:100%;text-align:center;font-size:16px;letter-spacing:4px">
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
      toast(res.error || 'Failed to disable 2FA', 'error');
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

// --- Personality Editor ---
async function loadPersonalityEditor() {
  const el = document.getElementById('personality-area');
  if (!el) return;
  try {
    const res = await api('/files/global/agents-md');
    el.innerHTML = `
      <textarea id="personality-editor" rows="15" style="width:100%;font-family:var(--mono);font-size:12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;resize:vertical;line-height:1.5">${esc(res.content || '')}</textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <button class="btn btn-sm btn-primary" onclick="savePersonality()">Save</button>
        <span id="personality-msg" style="font-size:12px"></span>
      </div>`;
  } catch {
    el.innerHTML = '<div class="empty">Failed to load personality config</div>';
  }
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
      msg.textContent = 'Saved';
      msg.style.color = 'var(--success)';
      toast('Personality updated', 'success');
    } else {
      msg.textContent = res.error || 'Failed';
      msg.style.color = 'var(--error)';
    }
  } catch {
    msg.textContent = 'Save error';
    msg.style.color = 'var(--error)';
  }
  setTimeout(() => {
    if (msg) msg.textContent = '';
  }, 4000);
};

// --- API Tokens ---
async function loadApiTokens() {
  try {
    const tokens = await api('/tokens');
    const el = document.getElementById('tokens-list');
    if (!el) return;
    if (tokens.length === 0) {
      el.innerHTML =
        '<div class="empty" style="padding:8px">No API tokens created</div>';
    } else {
      el.innerHTML = tokens
        .map(
          (t) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <div>
            <span style="font-weight:600">${esc(t.name)}</span>
            <code style="margin-left:8px;font-size:11px;color:var(--text-muted)">${esc(t.token)}</code>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:var(--text-muted)">${t.lastUsed ? 'Used ' + timeAgo(t.lastUsed) : 'Never used'}</span>
            <button class="btn btn-sm btn-danger" onclick="revokeApiToken('${esc(t.id)}', this)">Revoke</button>
          </div>
        </div>`,
        )
        .join('');
    }
  } catch {}
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
      display.style.display = 'block';
      nameEl.value = '';
      loadApiTokens();
      toast('Token created', 'success');
    }
  } catch {
    toast('Failed to create token', 'error');
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
    const [config, providerProfiles] = await Promise.all([
      api('/system/report-config'),
      api('/system/provider/profiles').catch(() => ({ profiles: [] })),
    ]);
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
      <div class="channel-card" style="padding:8px 0">
        <span>Enable scheduled report pipeline</span>
        <input type="checkbox" id="report-enabled" ${config.enabled ? 'checked' : ''}>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
        <div class="form-group" style="margin:0">
          <label>Schedule</label>
          <select id="report-schedule">
            <option value="weekly" ${config.schedule === 'weekly' ? 'selected' : ''}>Weekly</option>
            <option value="daily" ${config.schedule === 'daily' ? 'selected' : ''}>Daily</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label>Provider Profile</label>
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
      <div class="form-group" style="margin-top:8px">
        <label>Target Chat JID</label>
        <input class="search-input" id="report-jid" value="${esc(config.targetJid)}" placeholder="e.g. sig:+1234567890" style="max-width:100%">
      </div>
      <div class="form-group" style="margin-top:8px">
        <label>Deliverables directory</label>
        <input class="search-input" id="report-deliverables-dir" value="${esc(config.deliverablesDir || 'store/deliverables')}" style="max-width:100%">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
        <div>
          <label style="font-size:12px;color:var(--text-muted)">Sources</label>
          ${sourceOptions
            .map(
              (source) =>
                `<label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text-muted);margin-top:4px"><input type="checkbox" class="report-source" value="${source}" ${(config.sourceScopes || []).includes(source) ? 'checked' : ''}> ${source}</label>`,
            )
            .join('')}
        </div>
        <div>
          <label style="font-size:12px;color:var(--text-muted)">Formats</label>
          ${formatOptions
            .map(
              (format) =>
                `<label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text-muted);margin-top:4px"><input type="checkbox" class="report-format" value="${format}" ${(config.outputFormats || []).includes(format) ? 'checked' : ''}> ${format}</label>`,
            )
            .join('')}
          <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text-muted);margin-top:8px"><input type="checkbox" id="report-outline-approval" ${config.requireOutlineApproval !== false ? 'checked' : ''}> require outline approval</label>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <button class="btn btn-sm btn-primary" onclick="saveReportConfig()">Save</button>
        <span id="report-msg" style="font-size:12px"></span>
      </div>`;
  } catch {}
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
      msg.textContent = 'Saved';
      msg.style.color = 'var(--success)';
      toast('Report config saved', 'success');
    } else {
      msg.textContent = r.error || 'Failed';
      msg.style.color = 'var(--error)';
    }
  } catch {
    msg.textContent = 'Error';
    msg.style.color = 'var(--error)';
  }
  setTimeout(() => {
    if (msg) msg.textContent = '';
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
    } else toast(r.error || 'Failed to pin', 'error');
  } catch {
    toast('Failed to pin message', 'error');
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
    } else toast(r.error || 'Failed to unpin', 'error');
  } catch {
    toast('Failed to unpin message', 'error');
  }
};
