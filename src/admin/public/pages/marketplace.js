// NanoCrab Admin — Marketplace Page

// --- Marketplace ---

function marketplacePluginLane(plugin) {
  const haystack = [
    plugin.name,
    plugin.description,
    plugin.source,
    plugin.url,
    plugin.pageId,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/chat|message|channel|slack|telegram|whatsapp|mail|email/.test(haystack))
    return 'Copilot';
  if (/workflow|task|report|doc|artifact|project|kdrive|calendar/.test(haystack))
    return 'Cowork';
  if (/github|code|copilot|autofix|repo|pull request|\\bpr\\b/.test(haystack))
    return 'Code';
  return 'System';
}

function marketplacePluginStatus(plugin) {
  if (plugin.enabled === false) return 'disabled';
  return plugin.status || 'installed';
}

function marketplaceActivationRunway() {
  return [
    {
      step: 'Fit',
      title: 'Name the first useful workflow',
      body:
        'Write down what the plugin should improve before it adds routes, tools, skills, or MCP servers.',
      target: 'help',
    },
    {
      step: 'Access',
      title: 'Prepare credentials and scope',
      body:
        'Add required credentials, confirm project/repo/channel scope, and keep secrets outside agent containers.',
      target: 'credentials',
    },
    {
      step: 'Dry run',
      title: 'Test a read-only request',
      body:
        'Run one harmless read before enabling publish, send, update, repository, or document-write actions.',
      target: 'integrations',
    },
    {
      step: 'Control',
      title: 'Keep writes approval-gated',
      body:
        'Route external writes through Approvals until the plugin has successful evidence in the right workspace lane.',
      target: 'approvals',
    },
  ];
}

function marketplaceReviewBriefText(state) {
  const installed = state?.installed || [];
  const loadIssues = state?.loadIssues || [];
  const laneCounts = state?.laneCounts || {
    Copilot: 0,
    Cowork: 0,
    Code: 0,
    System: 0,
  };
  const restartNeeded = state?.restartNeeded || 0;
  const pluginLines = installed.length
    ? installed
        .slice(0, 12)
        .map((plugin) => {
          const lane = marketplacePluginLane(plugin);
          const status = marketplacePluginStatus(plugin);
          const source = plugin.source || plugin.url || 'local plugin';
          return `- ${plugin.name || plugin.dir || 'Plugin'}: ${lane}, ${status}, ${source}`;
        })
        .join('\n')
    : '- No marketplace plugins installed';
  return [
    'Marketplace plugin review brief',
    '',
    `Installed plugins: ${installed.length}`,
    `Restart queue: ${restartNeeded}`,
    `Copilot lane: ${laneCounts.Copilot || 0}`,
    `Cowork lane: ${laneCounts.Cowork || 0}`,
    `Code lane: ${laneCounts.Code || 0}`,
    `System lane: ${laneCounts.System || 0}`,
    `Data health: ${loadIssues.length ? loadIssues.join('; ') : 'Marketplace registry loaded without known fallback.'}`,
    '',
    'Installed plugin map',
    pluginLines,
    installed.length > 12 ? `- ...and ${installed.length - 12} more plugins` : null,
    '',
    'Review before install or update',
    '- Confirm the Git repository is trusted and the plugin.json metadata matches the expected capability.',
    '- Check routes, frontend pages, credentials, MCP tools, skills, and container permissions before activation.',
    '- Decide whether the plugin belongs in Copilot, Cowork, Code, or System before exposing it to operators.',
    '- Add required credentials first and restart NanoCrab after install, update, disable, or uninstall.',
    '',
    'Activation checklist',
    '- Name the first useful workflow this plugin should unlock before installing it.',
    '- For Cowork plugins, verify project-chat prompts, MCP server credentials, document/artifact outputs, and approval boundaries together.',
    '- For Code plugins, verify repository scope, issue/PR permissions, test commands, and review rules before agent handoff.',
    '- For Copilot or channel plugins, verify message routing, identity, rate limits, and whether output should stay plain chat or move into a Cowork project.',
    '- If the plugin adds MCP tools or external writes, test a read-only request first and keep publish/send/update actions behind Approvals.',
    '',
    'Activation runway',
    ...marketplaceActivationRunway().map(
      (item) => `- ${item.step}: ${item.title}. ${item.body}`,
    ),
    '',
    'Productivity fit',
    '- Copilot plugins should improve direct conversation, channels, inbox, or message workflows.',
    '- Cowork plugins should improve projects, documents, workflows, MCP helpers, or artifacts.',
    '- Code plugins should improve repositories, Copilot, GitHub issues, PRs, tests, or review loops.',
    '- System plugins should improve operations, monitoring, credentials, backup, or platform safety.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

function marketplaceActivationChecklistText() {
  return [
    'Marketplace activation checklist',
    '',
    ...marketplaceActivationRunway().map(
      (item) => `- ${item.step}: ${item.title}. ${item.body}`,
    ),
    '',
    'Use this checklist before restarting NanoCrab or handing the plugin to Copilot, Cowork, Code, or System work.',
    'Keep external writes behind Approvals until one read-only dry run succeeds in the right workspace lane.',
  ].join('\n');
}

function marketplacePluginFitBriefText(plugin) {
  const lane = marketplacePluginLane(plugin || {});
  const status = marketplacePluginStatus(plugin || {});
  const source = plugin?.source || plugin?.url || 'local plugin';
  return [
    'Marketplace plugin fit brief',
    '',
    `Plugin: ${plugin?.name || plugin?.dir || 'Plugin'}`,
    `Lane: ${lane}`,
    `Status: ${status}`,
    `Version: ${plugin?.version || '0.0.0'}`,
    `Source: ${source}`,
    plugin?.description ? `Description: ${plugin.description}` : 'Description: none provided',
    '',
    'Decide the first useful workflow',
    '- Name the exact Copilot, Cowork, Code, or System workflow this plugin should improve before restart.',
    '- Identify which routes, frontend pages, credentials, MCP tools, skills, or container permissions it adds.',
    '- Confirm the operator who owns the workflow and where the first successful result should appear.',
    '',
    'Lane checks',
    lane === 'Copilot'
      ? '- Keep outputs conversational unless the result should become a Cowork project artifact.'
      : lane === 'Cowork'
        ? '- Verify project-chat prompts, MCP credentials, document/artifact outputs, source ledgers, and approval boundaries together.'
        : lane === 'Code'
          ? '- Verify repository scope, issue/PR permissions, test commands, review rules, and Code handoff evidence before assigning agents.'
          : '- Verify admin routes, monitoring, credentials, backup, and platform safety before enabling operators.',
    '',
    'Activation proof',
    '- Run one read-only dry run before enabling publish, send, update, repository, or document-write actions.',
    '- Keep external writes behind Approvals until the plugin proves the workflow in the right lane.',
    '- Restart NanoCrab only after credentials, plugin metadata, permissions, and rollback path are understood.',
  ].join('\n');
}

function renderMarketplaceActivationRunway() {
  return `
    <section class="marketplace-activation-runway" aria-label="Marketplace activation runway">
      <div class="marketplace-activation-head">
        <div>
          <span class="marketplace-kicker">Activation runway</span>
          <h3>Turn a plugin into a useful workflow without opening the floodgates</h3>
        </div>
        <div>
          <p>Use these checkpoints after install and before restart. The goal is one trusted workflow, one scoped access path, and proof before writes or agent handoff.</p>
          <button class="btn btn-sm btn-ghost" onclick="copyMarketplaceActivationChecklist()">Copy activation checklist</button>
        </div>
      </div>
      <div class="marketplace-activation-grid">
        ${marketplaceActivationRunway()
          .map(
            (item) => `
          <button class="marketplace-activation-card" type="button" onclick="navigate('${esc(item.target)}')">
            <span>${esc(item.step)}</span>
            <strong>${esc(item.title)}</strong>
            <small>${esc(item.body)}</small>
          </button>`,
          )
          .join('')}
      </div>
    </section>`;
}

function renderMarketplaceEmptyState() {
  const steps = [
    {
      label: '01',
      title: 'Match capability',
      body: 'Decide whether the plugin belongs in Copilot, Cowork, Code, or System before exposing new routes, tools, or skills.',
    },
    {
      label: '02',
      title: 'Review source',
      body: 'Check plugin.json, frontend pages, credentials, MCP tools, skills, and container permissions before install.',
    },
    {
      label: '03',
      title: 'Restart deliberately',
      body: 'Install from a trusted Git repository, add required credentials, then restart NanoCrab when you are ready to activate it.',
    },
  ];
  return `
    <section class="marketplace-empty-state" aria-label="Marketplace first install guidance">
      <div class="marketplace-empty-copy">
        <span class="marketplace-kicker">No marketplace plugins installed</span>
        <h3>Start with the workflow gap, then install the plugin.</h3>
        <p>Use Marketplace when NanoCrab needs a new capability: a channel, a Cowork document helper, a Code automation loop, or a platform integration that is not already built in.</p>
        <div class="marketplace-empty-actions">
          <button class="btn btn-sm btn-primary" onclick="togglePluginInstall(true)">Install trusted Git repo</button>
          <button class="btn btn-sm btn-ghost" onclick="copyMarketplaceReviewBrief()">Copy review brief</button>
          <button class="btn btn-sm btn-ghost" onclick="navigate('credentials')">Check credentials</button>
        </div>
      </div>
      <div class="marketplace-empty-flow">
        ${steps
          .map(
            (step) => `<div class="marketplace-empty-step">
              <span>${esc(step.label)}</span>
              <strong>${esc(step.title)}</strong>
              <p>${esc(step.body)}</p>
            </div>`,
          )
          .join('')}
      </div>
    </section>`;
}

function renderMarketplaceLoadError(message) {
  window._marketplaceReviewState = {
    installed: [],
    laneCounts: { Copilot: 0, Cowork: 0, Code: 0, System: 0 },
    restartNeeded: 0,
    loadIssues: ['Marketplace plugin registry unavailable'],
  };
  return `
    <section class="card marketplace-error-state">
      <div>
        <span class="marketplace-kicker">Marketplace unavailable</span>
        <h3>We could not read the local plugin registry.</h3>
        <p>${esc(message || 'Check the admin logs, plugin settings, and local plugin directory before installing or updating extensions.')}</p>
      </div>
      <div class="marketplace-empty-actions">
        <button class="btn btn-sm btn-ghost" onclick="navigate('settings')">Plugin settings</button>
        <button class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">System logs</button>
        <button class="btn btn-sm btn-ghost" onclick="copyMarketplaceReviewBrief()">Copy review brief</button>
        <button class="btn btn-sm btn-primary" onclick="renderMarketplace(document.getElementById('page-content'))">Retry</button>
      </div>
    </section>`;
}

function renderMarketplaceLoadingState() {
  return `
    <section class="marketplace-loading-state" aria-busy="true" aria-label="Loading marketplace plugins">
      <div class="marketplace-loading-copy">
        <span class="marketplace-kicker">Extension cockpit</span>
        <h3>Reading trusted plugin metadata.</h3>
        <p>Marketplace installs can add pages, routes, skills, MCP tools, and credentials. NanoCrab is checking the local registry before showing install, update, or disable actions.</p>
      </div>
      <div class="marketplace-loading-steps">
        <span>Registry</span>
        <span>Capabilities</span>
        <span>Routes</span>
        <span>Restart queue</span>
      </div>
    </section>`;
}

function marketplaceActionErrorMessage(kind, err) {
  const detail = err?.error || err?.message ? ': ' + (err.error || err.message) : '';
  if (kind === 'install') {
    return 'Plugin install failed. Check the Git URL, plugin.json, credentials, and local plugin permissions before retrying' + detail;
  }
  if (kind === 'uninstall') {
    return 'Plugin uninstall failed. Check active routes, running work, and restart requirements before retrying' + detail;
  }
  if (kind === 'update') {
    return 'Plugin update failed. Review the plugin diff, credentials, and restart plan before retrying' + detail;
  }
  return 'Marketplace action failed' + detail;
}

async function renderMarketplace(el) {
  el.innerHTML = renderMarketplaceLoadingState();
  try {
    const installed = await api('/marketplace');
    if (!Array.isArray(installed)) {
      throw new Error('Marketplace plugin registry unavailable');
    }
    const laneCounts = installed.reduce(
      (acc, plugin) => {
        const lane = marketplacePluginLane(plugin);
        acc[lane] = (acc[lane] || 0) + 1;
        return acc;
      },
      { Copilot: 0, Cowork: 0, Code: 0, System: 0 },
    );
    const restartNeeded = installed.filter((plugin) =>
      ['installed', 'updated', 'disabled'].includes(marketplacePluginStatus(plugin)),
    ).length;
    window._marketplaceReviewState = {
      installed,
      laneCounts,
      restartNeeded,
      loadIssues: [],
    };
    const marketplaceStats = [
      {
        label: 'Installed',
        value: installed.length,
        detail: 'Local marketplace plugins',
        tone: installed.length ? 'ready' : 'muted',
      },
      {
        label: 'Product lanes',
        value: Object.values(laneCounts).filter(Boolean).length,
        detail: 'Copilot, Cowork, Code, and system reach',
        tone: installed.length ? 'active' : 'muted',
      },
      {
        label: 'Restart queue',
        value: restartNeeded,
        detail: 'Changes activate after restart',
        tone: restartNeeded ? 'attention' : 'ready',
      },
      {
        label: 'Source',
        value: 'Git',
        detail: 'Install trusted plugin repositories',
        tone: 'ready',
      },
    ];
    const laneCards = ['Copilot', 'Cowork', 'Code', 'System']
      .map(
        (lane) => `<div class="marketplace-lane-card">
          <span>${esc(lane)}</span>
          <strong>${Number(laneCounts[lane] || 0)}</strong>
          <small>${lane === 'Copilot' ? 'Conversation channels and inbox tools' : lane === 'Cowork' ? 'Projects, documents, workflows, and MCP helpers' : lane === 'Code' ? 'Repos, pull requests, and coding agents' : 'Admin, monitoring, credentials, and platform tools'}</small>
        </div>`,
      )
      .join('');
    const pluginRows = installed
      .map((p) => {
        const lane = marketplacePluginLane(p);
        const status = marketplacePluginStatus(p);
        const version = p.version || '0.0.0';
        const source = p.source || p.url || 'local plugin';
        const dir = p.dir || p.name;
        return `
          <div class="marketplace-plugin-row is-${esc(status)}">
            <div class="marketplace-plugin-main">
              <div class="marketplace-plugin-head">
                <strong>${esc(p.name || dir || 'Plugin')}</strong>
                <span class="badge badge-muted">${esc(lane)}</span>
                <span class="badge ${status === 'disabled' ? 'badge-warning' : 'badge-success'}">${esc(status)}</span>
              </div>
              <p>${esc(p.description || 'No plugin description provided yet.')}</p>
              <div class="marketplace-plugin-meta">
                <span>v${esc(version)}</span>
                ${p.author ? `<span>by ${esc(p.author)}</span>` : ''}
                <span>${esc(source)}</span>
                ${p.installedAt ? `<span>${timeAgo(p.installedAt)}</span>` : ''}
              </div>
            </div>
            <div class="marketplace-plugin-actions">
              <button class="btn btn-sm btn-ghost" onclick="copyMarketplacePluginFit('${esc(dir)}')">Copy fit brief</button>
              <button class="btn btn-sm btn-ghost" onclick="updatePlugin('${esc(dir)}',this)">Update</button>
              <button class="btn btn-sm btn-ghost danger-link" onclick="uninstallPlugin('${esc(dir)}',this)">Uninstall</button>
            </div>
          </div>`;
      })
      .join('');
    el.innerHTML = `
      <div class="page-header marketplace-page-header">
        <div>
          <h2>Plugin Marketplace</h2>
          <p>Add trusted extensions that expand Copilot, Cowork, Code, and platform operations.</p>
        </div>
        <div class="marketplace-header-actions">
          <button class="btn btn-sm btn-ghost" onclick="navigate('settings')">Plugin settings</button>
          <button class="btn btn-sm btn-primary" onclick="togglePluginInstall()">Install plugin</button>
        </div>
      </div>

      <section class="marketplace-command-center">
        <div class="marketplace-command-main">
          <div class="marketplace-kicker">Extension cockpit</div>
          <h3>Choose capabilities before installing code</h3>
          <p>Marketplace plugins can add pages, routes, tools, skills, and integrations. Keep this as the review point before pulling code into the local plugin directory.</p>
          <div class="marketplace-command-actions">
            <button class="btn btn-sm btn-primary" onclick="togglePluginInstall()">Install from Git</button>
            <button class="btn btn-sm btn-ghost" onclick="copyMarketplaceReviewBrief()">Copy review brief</button>
            <button class="btn btn-sm btn-ghost" onclick="navigate('help')">Plugin guide</button>
            <button class="btn btn-sm btn-ghost" onclick="navigate('credentials')">Credentials</button>
          </div>
        </div>
        <div class="marketplace-command-stats">
          ${marketplaceStats
            .map(
              (stat) => `<div class="marketplace-command-stat is-${stat.tone}">
                <span>${esc(stat.label)}</span>
                <strong>${esc(String(stat.value))}</strong>
                <small>${esc(stat.detail)}</small>
              </div>`,
            )
            .join('')}
        </div>
      </section>

      <section class="marketplace-lanes" aria-label="Plugin capability lanes">
        ${laneCards}
      </section>

      ${renderMarketplaceActivationRunway()}

      <div id="install-plugin-form" class="card marketplace-install-card is-hidden">
        <div class="marketplace-install-head">
          <div>
            <div class="card-title">Install from Git</div>
            <p>Only install repositories you trust. NanoCrab clones the plugin locally, installs dependencies if needed, and requires restart before activation.</p>
          </div>
          <button class="btn btn-sm btn-ghost" onclick="togglePluginInstall(false)">Close</button>
        </div>
        <div class="marketplace-install-grid">
          <div class="form-group">
            <label>Git URL</label>
            <input class="search-input" id="plugin-url" placeholder="https://github.com/user/nanocrab-plugin-example.git">
          </div>
          <div class="form-group">
            <label>Name (optional)</label>
            <input class="search-input" id="plugin-name" placeholder="auto-detect">
          </div>
          <button class="btn btn-primary" onclick="installPlugin()">Install</button>
        </div>
        <div class="marketplace-install-checklist">
          <span>Review plugin.json</span>
          <span>Confirm routes and credentials</span>
          <span>Restart after install</span>
        </div>
      </div>

      <div class="card marketplace-installed-card">
        <div class="card-title">Installed Plugins <span class="badge badge-muted marketplace-count-badge">${installed.length}</span></div>
        ${installed.length === 0 ? renderMarketplaceEmptyState() : pluginRows}
      </div>

      <div class="card marketplace-guide-card">
        <div class="card-title">How to Create a Plugin</div>
        <div class="marketplace-guide-grid">
          <div>
            <p>A NanoCrab plugin is a git repository with metadata, routes, optional frontend pages, and optional container skills.</p>
            <button class="btn btn-sm btn-ghost" onclick="navigate('help')">Open plugin guide</button>
          </div>
          <pre>my-plugin/
  plugin.json    \u2190 metadata (name, version, description)
  index.ts       \u2190 exports AdminPlugin
  routes.ts      \u2190 Express router
  SKILL.md       \u2190 optional container skill
  README.md</pre>
        </div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = renderMarketplaceLoadError(
      e?.message || 'Marketplace plugin registry unavailable',
    );
  }
}

window.togglePluginInstall = function (force) {
  const form = document.getElementById('install-plugin-form');
  if (!form) return;
  const shouldOpen =
    typeof force === 'boolean' ? force : form.classList.contains('is-hidden');
  form.classList.toggle('is-hidden', !shouldOpen);
  if (shouldOpen) {
    document.getElementById('plugin-url')?.focus();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

window.installPlugin = async function () {
  const url = document.getElementById('plugin-url').value.trim();
  const name = document.getElementById('plugin-name').value.trim();
  if (!url) { toast('Git URL required', 'warning'); return; }
  toast('Installing plugin...', 'info');
  try {
    const r = await api('/marketplace/install', { method: 'POST', body: JSON.stringify({ url, name: name || undefined }) });
    if (r.ok) { toast('Plugin installed. Restart to activate.', 'success'); navigate('marketplace'); }
    else toast(marketplaceActionErrorMessage('install', r), 'error');
  } catch (e) { toast(marketplaceActionErrorMessage('install', e), 'error'); }
};

window.copyMarketplaceReviewBrief = async function () {
  const state = window._marketplaceReviewState;
  if (!state) {
    toast('Marketplace review state is not ready', 'error');
    return;
  }
  const text = marketplaceReviewBriefText(state);
  await copyTextWithFallback(
    text,
    'Marketplace review brief copied',
    'Copy marketplace review brief',
  );
};

window.copyMarketplaceActivationChecklist = async function () {
  await copyTextWithFallback(
    marketplaceActivationChecklistText(),
    'Marketplace activation checklist copied',
    'Copy marketplace activation checklist',
  );
};

window.copyMarketplacePluginFit = async function (dir) {
  const state = window._marketplaceReviewState;
  const plugin = state?.installed?.find(
    (item) => String(item.dir || item.name || '') === String(dir),
  );
  if (!state || !plugin) {
    toast('Plugin fit state is not ready', 'error');
    return;
  }
  await copyTextWithFallback(
    marketplacePluginFitBriefText(plugin),
    'Marketplace plugin fit brief copied',
    'Copy marketplace plugin fit brief',
  );
};

window.uninstallPlugin = function (name, btn) {
  inlineConfirm(btn, 'Uninstall?', async () => {
    try {
      const r = await api('/marketplace/' + encodeURIComponent(name), { method: 'DELETE' });
      if (r.ok !== false) {
        toast('Plugin uninstalled. Restart to apply.', 'success');
        navigate('marketplace');
      } else toast(marketplaceActionErrorMessage('uninstall', r), 'error');
    } catch (e) { toast(marketplaceActionErrorMessage('uninstall', e), 'error'); }
  });
};

window.updatePlugin = async function (name, btn) {
  btn.disabled = true; btn.textContent = 'Updating...';
  try {
    const r = await api('/marketplace/' + encodeURIComponent(name) + '/update', { method: 'POST' });
    if (r.ok) toast('Plugin updated. Restart to apply.', 'success');
    else toast(marketplaceActionErrorMessage('update', r), 'error');
  } catch (e) { toast(marketplaceActionErrorMessage('update', e), 'error'); }
  btn.disabled = false; btn.textContent = 'Update';
};
