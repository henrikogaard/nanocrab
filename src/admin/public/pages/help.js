// NanoCrab Admin — Help Page

// --- Help / Manual ---
function renderHelp(el) {
  const quickPaths = [
    {
      mode: 'Copilot',
      title: 'Start a pure conversation',
      desc: 'Open a clean Copilot chat thread, choose a provider and optional title, then talk without agent templates or project context.',
      action: "navigate('chat')",
      actionLabel: 'Open Copilot',
    },
    {
      mode: 'Cowork',
      title: 'Create a project workspace',
      desc: 'Use Projects as virtual folders for documents, artifacts, files, and chat history that agents can work against.',
      action: "navigate('projects')",
      actionLabel: 'Open Projects',
    },
    {
      mode: 'Cowork',
      title: 'Use MCP tools in project chat',
      desc: 'Ask a project agent to read email, summarize a sender, draft a document, or combine context from connected MCP servers.',
      action: "navigate('projects')",
      actionLabel: 'Use Project Chat',
    },
    {
      mode: 'Code',
      title: 'Automate repository work',
      desc: 'Send coding tasks to Codex, Claude Code, OpenCode, or GitHub Copilot from the Code focus area.',
      action: "navigate('agents')",
      actionLabel: 'Open Agents',
    },
  ];

  const decisionCards = [
    {
      intent: 'I need a quick answer',
      place: 'Copilot',
      detail: 'Use a plain conversation with no project files, no agent template, and an optional title.',
      action: "navigate('chat')",
    },
    {
      intent: 'I need a document from external context',
      place: 'Cowork',
      detail: 'Create a project chat, let MCP read approved sources such as email, then save the summary or document to the project.',
      action: "navigate('projects')",
    },
    {
      intent: 'I need repository automation',
      place: 'Code',
      detail: 'Use coding agents or Copilot for issues, PRs, tests, snippets, and review rules.',
      action: "navigate('agents')",
    },
    {
      intent: 'I need platform setup',
      place: 'Settings',
      detail: 'Configure memory, identity, providers, credentials, MCP servers, and plugin availability before delegating work.',
      action: "navigate('settings')",
    },
  ];

  const capabilityRoutes = [
    {
      capability: 'Chat threads',
      route: 'Chat',
      ui: "navigate('chat')",
      command: 'Dashboard composer',
      status: 'Ready',
    },
    {
      capability: 'Cowork projects',
      route: 'Cowork',
      ui: "navigate('projects')",
      command: 'Project chat and workspace-intent routing',
      status: 'Ready',
    },
    {
      capability: 'Code automation',
      route: 'Code',
      ui: "navigate('gitcode')",
      command: '/code and coding-job MCP tools',
      status: 'Ready',
    },
    {
      capability: 'Provider profiles',
      route: 'Integrations',
      ui: "navigate('integrations')",
      command: 'Provider/profile/model selectors',
      status: 'Ready',
    },
    {
      capability: 'Governed memory',
      route: 'Memory',
      ui: "navigate('memory')",
      command: 'propose_memory and journal MCP tools',
      status: 'Ready',
    },
    {
      capability: 'Skill registry',
      route: 'Skills',
      ui: "navigate('skills')",
      command: 'list_skills, search_skills, skill drafts',
      status: 'Ready',
    },
    {
      capability: 'Route hygiene',
      route: 'Docs',
      ui: 'openHelpCapabilities()',
      command: 'docs/CAPABILITIES.md plus route-wiring tests',
      status: 'Guarded',
    },
  ];

  const mcpWorkflowSteps = [
    {
      step: 'Workspace',
      title: 'Start in a Cowork project',
      detail:
        'Create or open a project so files, previous chats, summaries, and documents live beside the work.',
      action: "navigate('projects')",
      actionLabel: 'Open Projects',
    },
    {
      step: 'Provider',
      title: 'Choose a tool-capable provider',
      detail:
        'Pick the provider and model in the project composer before starting chat. MCP work needs a provider that supports tool calls.',
      action: "navigate('integrations')",
      actionLabel: 'Check Providers',
    },
    {
      step: 'Source',
      title: 'Ask for the source and outcome',
      detail:
        'Use prompts like latest emails into a doc, all emails from a sender, calendar follow-up, or generate a project summary.',
      action: "navigate('projects')",
      actionLabel: 'Use MCP prompt',
    },
    {
      step: 'Approval',
      title: 'Approve external writes',
      detail:
        'Reading approved sources can happen in chat. Creating external documents, sending messages, or updating third-party records goes through Approvals.',
      action: "navigate('approvals')",
      actionLabel: 'Review Approvals',
    },
  ];

  const mcpPromptRecipes = [
    {
      label: 'Latest email digest',
      prompt:
        'In this Cowork project, use approved mail MCP tools to review the latest emails. Summarize decisions, deadlines, risks, waiting items, and next actions, then save a markdown summary in the project workspace.',
    },
    {
      label: 'Sender brief',
      prompt:
        'Use approved mail MCP tools to check recent emails from [person or domain]. Create a brief with source threads, promised follow-ups, open questions, suggested replies, and anything that should become a project task.',
    },
    {
      label: 'Source-backed document',
      prompt:
        'Use project files, recent project chats, and approved document MCP tools to draft a polished document. Save the markdown draft in this project first, list assumptions, and ask before publishing externally.',
    },
  ];

  const workspacePromptDeck = [
    {
      lane: 'Copilot',
      label: 'Quick answer',
      route: "navigate('chat')",
      routeLabel: 'Open Copilot',
      prompt:
        'Answer this as a plain Copilot chat. Keep it direct, ask at most one clarifying question if needed, and do not create project files, call MCP tools, or start repository work unless I ask.',
    },
    {
      lane: 'Cowork',
      label: 'Project artifact',
      route: "navigate('projects')",
      routeLabel: 'Open Cowork',
      prompt:
        'In this Cowork project, turn the request into a durable project artifact. Use project files, previous chats, and approved MCP tools when relevant, cite source systems and search windows, save a local draft first, and ask before external writes.',
    },
    {
      lane: 'Code',
      label: 'Repository handoff',
      route: "navigate('gitcode')",
      routeLabel: 'Open Code',
      prompt:
        'Route this to Code. Identify the repository, issue or branch, expected change, tests to run, review risks, and handoff evidence. Do not mix project document work or email summaries into the code task.',
    },
    {
      lane: 'Setup',
      label: 'Readiness check',
      route: "navigate('integrations')",
      routeLabel: 'Check setup',
      prompt:
        'Before delegating this work, check provider, credential, MCP, approval, memory, and skill readiness. Return the missing setup steps, the safest workspace lane, and any approval boundary before starting agent work.',
    },
  ];

  window.copyHelpMcpPromptRecipe = async function (index) {
    const recipe = mcpPromptRecipes[index];
    if (!recipe) {
      toast('Prompt recipe is not available', 'error');
      return;
    }
    await copyTextWithFallback(
      recipe.prompt,
      `${recipe.label} prompt copied`,
      `Copy ${recipe.label} prompt`,
    );
  };

  window.copyHelpWorkspacePrompt = async function (index) {
    const recipe = workspacePromptDeck[index];
    if (!recipe) {
      toast('Workspace prompt is not available', 'error');
      return;
    }
    await copyTextWithFallback(
      recipe.prompt,
      `${recipe.label} workspace prompt copied`,
      `Copy ${recipe.label} workspace prompt`,
    );
  };

  window.openHelpCapabilities = function () {
    navigate('help');
    window.requestAnimationFrame(() => {
      document
        .getElementById('help-capabilities')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const actionLadder = [
    {
      label: 'Answer',
      title: 'Ask in Copilot when nothing needs to persist',
      detail:
        'Use a plain provider-backed conversation for quick clarification, drafting, or thinking.',
      action: "navigate('chat')",
      actionLabel: 'Open Copilot',
    },
    {
      label: 'Artifact',
      title: 'Move durable work into Cowork',
      detail:
        'Create or open a project when the output should become a file, document, artifact, or remembered thread.',
      action: "navigate('projects')",
      actionLabel: 'Open Projects',
    },
    {
      label: 'Automation',
      title: 'Route repository tasks to Code',
      detail:
        'Use Code when the next step needs a repo, issue, branch, diff, tests, or GitHub Copilot.',
      action: "navigate('gitcode')",
      actionLabel: 'Open Code',
    },
    {
      label: 'Control',
      title: 'Check setup before external tools write',
      detail:
        'Use Integrations, Credentials, Providers, and Approvals before MCP tools publish, send, update, or change records.',
      action: "navigate('integrations')",
      actionLabel: 'Check setup',
    },
  ];

  const stuckStateRoutes = [
    {
      state: 'Agent output stalled',
      route: 'Sessions',
      detail:
        'Use Sessions to find the latest transcript, approvals, artifacts, and handoff score before starting over.',
      action: "navigate('sessions')",
    },
    {
      state: 'External tool failed',
      route: 'Logs',
      detail:
        'Check Logs for MCP, email, document, webhook, or provider errors before retrying the request.',
      action: "navigate('logs')",
    },
    {
      state: 'Need proof before acting',
      route: 'Approvals',
      detail:
        'Open Approvals when an external send, document publish, calendar update, webhook, or repository write needs a human decision.',
      action: "navigate('approvals')",
    },
    {
      state: 'Useful result should persist',
      route: 'Artifacts',
      detail:
        'Send finished documents, summaries, and reviewed outputs to Artifacts so future agents can reuse the evidence.',
      action: "navigate('artifacts')",
    },
  ];

  function helpProductivityBriefText() {
    const pathLines = quickPaths.map(
      (path) => `- ${path.mode}: ${path.title} — ${path.desc}`,
    );
    const decisionLines = decisionCards.map(
      (card) => `- ${card.intent}: use ${card.place}. ${card.detail}`,
    );
    const capabilityLines = capabilityRoutes.map(
      (item) =>
        `- ${item.capability}: UI route ${item.route}; command or MCP path ${item.command}; status ${item.status}.`,
    );
    const ladderLines = actionLadder.map(
      (item) => `- ${item.label}: ${item.title}. ${item.detail}`,
    );
    const stuckLines = stuckStateRoutes.map(
      (item) => `- ${item.state}: open ${item.route}. ${item.detail}`,
    );
    const promptLines = workspacePromptDeck.map(
      (item) => `- ${item.lane} / ${item.label}: ${item.prompt}`,
    );
    return [
      'NanoCrab productivity routing brief',
      '',
      'Workspace focus',
      '- Copilot: simple ChatGPT-style conversation with provider and optional title.',
      '- Cowork: project workspaces, files, documents, artifacts, chats, MCP tools, and recurring work.',
      '- Code: repository automation, GitHub Copilot, coding agents, tests, review rules, and pipelines.',
      '- Personal memory: cross-agent knowledge and preferences, not project files.',
      '',
      'Quick paths',
      pathLines.join('\n'),
      '',
      'Action ladder',
      ladderLines.join('\n'),
      '',
      'Stuck state router',
      stuckLines.join('\n'),
      '',
      'Starter prompt deck',
      promptLines.join('\n'),
      '',
      'Decision guide',
      decisionLines.join('\n'),
      '',
      'Capability map',
      capabilityLines.join('\n'),
      '',
      'Default rule',
      'Use the smallest workspace that fits the job: Copilot for plain chat answers, Cowork for durable project/document/MCP work, Code for repositories, and Settings when the platform needs setup first.',
    ].join('\n');
  }

  function helpMcpRunbookText() {
    const stepLines = mcpWorkflowSteps.map(
      (step) => `- ${step.step} ${step.title}: ${step.detail}`,
    );
    const recipeLines = mcpPromptRecipes.map(
      (recipe) => `- ${recipe.label}: ${recipe.prompt}`,
    );
    return [
      'Cowork MCP runbook',
      '',
      'Use this for requests like summarizing the latest emails, checking all emails from a sender, preparing agenda follow-ups, or creating a document from approved MCP sources.',
      '',
      'Steps',
      stepLines.join('\n'),
      '',
      'Copy-ready prompts',
      recipeLines.join('\n'),
      '',
      'Prompt shape',
      'In this Cowork project, use approved MCP tools to gather the requested source context, cite the systems used, save a draft artifact in the project workspace, and ask before publishing, sending, or changing anything outside NanoCrab.',
    ].join('\n');
  }

  const sections = [
    {
      title: 'Capability map',
      id: 'help-capabilities',
      description:
        'Every supported capability has a UI route, a documented command/MCP path, or both.',
      items: [
        {
          name: 'Capability map',
          desc: 'Use this Help page for in-app routing and docs/CAPABILITIES.md for the current durable capability matrix.',
        },
        {
          name: 'UI route',
          desc: 'Dashboard routes expose Chat, Cowork, Code, operations, governance, setup, monitoring, and recovery surfaces.',
        },
        {
          name: 'Command or MCP path',
          desc: 'Some owner and agent workflows are intentionally command or MCP driven, including mobile code control, scheduled tasks, memories, reports, and artifacts.',
        },
        {
          name: 'Route hygiene',
          desc: 'Backend route modules must be mounted by the dashboard server or removed when superseded so backend capability claims stay honest.',
        },
      ],
    },
    {
      title: 'Workspace modes',
      id: 'help-overview',
      description:
        'NanoCrab is organized by intent: simple chat, collaborative project work, and focused code automation.',
      items: [
        {
          name: 'Copilot chat',
          desc: 'A direct ChatGPT-style conversation. Choose a provider and optional title. If the title is blank, the AI names the conversation after the first message.',
        },
        {
          name: 'Cowork',
          desc: 'A project-centered workspace for agent collaboration. Create virtual folders, files, artifacts, documents, chats, and recurring work around a shared context.',
        },
        {
          name: 'Code',
          desc: 'Focused software work. Run coding agents, review GitHub issues and PRs, manage repositories, tests, snippets, review rules, and deploy pipelines.',
        },
        {
          name: 'Admin cockpit',
          desc: 'Operate the platform: channels, messages, approvals, credentials, MCP integrations, monitoring, uptime, backup, audit, and security.',
        },
        {
          name: 'Personal memory',
          desc: 'A personal knowledge space for approved memories and things learned across agents. Keep project files in Cowork; keep durable preferences and cross-agent context in Memory.',
        },
      ],
    },
    {
      title: 'Cowork projects',
      id: 'help-cowork',
      description:
        'Projects are virtual workspaces where chats, documents, artifacts, and MCP-backed tasks share context.',
      items: [
        {
          name: 'Projects',
          desc: 'Create a project for a client, research thread, report, launch plan, or operating area. Each project can hold files, artifacts, documents, and previous chats.',
        },
        {
          name: 'Project chats',
          desc: 'Start chats inside a project so the agent can use project context automatically and keep thread history next to the work it belongs to.',
        },
        {
          name: 'Artifacts and documents',
          desc: 'Ask agents to create summaries, plans, markdown notes, drafts, tables, or other artifacts inside the project rather than scattering them across unrelated threads.',
        },
        {
          name: 'MCP tools from Cowork',
          desc: 'Project chats can call connected MCP servers when allowed. For example: summarize the latest emails, collect messages from a sender, create a status document, or prepare a brief from external tools.',
        },
        {
          name: 'History',
          desc: 'Use previous chats and threads as the project timeline. Pick up where the work left off without rebuilding context from memory.',
        },
      ],
    },
    {
      title: 'Manage',
      id: 'help-manage',
      items: [
        {
          name: 'Groups',
          desc: 'Registered agent groups with channel assignments. Each group gets an isolated filesystem and memory store. Assign channels (WhatsApp, Telegram, Signal) to groups and configure per-group settings.',
        },
        {
          name: 'Tasks',
          desc: 'Scheduled tasks that run on cron expressions. Create, pause, resume, and delete tasks. Tasks execute inside agent containers with full tool access.',
        },
        {
          name: 'Credentials',
          desc: "API keys, OAuth tokens, and MCP server credentials. Managed through NanoCrab's credential proxy where supported, so provider keys stay on the host instead of inside containers.",
        },
        {
          name: 'Integrations and MCP',
          desc: 'Connect MCP servers, AI providers, and container skills. Cowork project chats can use enabled MCP tools for external systems such as email, docs, calendars, and internal data.',
        },
        {
          name: 'Webhooks',
          desc: 'GitHub webhook integration. Receive push events, issue updates, and PR notifications. Used by the Autofix plugin to trigger automated code fixes.',
        },
      ],
    },
    {
      title: 'Tools (Plugins)',
      id: 'help-tools',
      description:
        'Plugins can be enabled or disabled from Settings. When enabled, they appear in the sidebar under the Tools section.',
      items: [
        {
          name: 'Copilot chat',
          desc: 'Talk with the assistant directly from the dashboard when the request does not need project files, MCP tools, or repository context.',
        },
        {
          name: 'GitHub Copilot',
          desc: 'GitHub Copilot integration with multi-account OAuth. GitHub Copilot belongs with Code work: assign it to GitHub issues, browse repositories, and manage coding-agent tasks.',
        },
        {
          name: 'Autofix',
          desc: 'Automated GitHub fix pipeline. Label an issue, an agent analyzes and fixes the code, then opens a PR. Also provides PR review automation for incoming pull requests.',
        },
        {
          name: 'Workflows',
          desc: 'Automation workflows with configurable triggers. Chain actions together: when an event occurs, run a sequence of steps automatically.',
        },
        {
          name: 'Uptime',
          desc: 'Service health monitoring. Track uptime for external services and APIs. Receive alerts when services go down or response times exceed thresholds.',
        },
        {
          name: 'Wiki',
          desc: 'Markdown knowledge base. Create and organize reference documents that agents can access during conversations. Supports full markdown with syntax highlighting.',
        },
      ],
    },
    {
      title: 'Developer',
      id: 'help-developer',
      items: [
        {
          name: 'Dev Hub',
          desc: 'Built-in terminal emulator and file browser. Browse container mounts, inspect files, and run commands directly from the dashboard.',
        },
        {
          name: 'Git & Code',
          desc: 'Git operations, integrated code editor, test runner, code snippets, review rules, deploy pipelines, and custom containers for repeatable engineering work.',
        },
        {
          name: 'Deploy',
          desc: 'Deployment pipelines. Configure and trigger deployments for your projects directly from the dashboard.',
        },
      ],
    },
    {
      title: 'System',
      id: 'help-system',
      items: [
        {
          name: 'Monitoring',
          desc: 'Server stats (CPU, memory, disk), channel health indicators, live log viewer with streaming output, and system information.',
        },
        {
          name: 'Containers',
          desc: 'Docker container management. View running containers, inspect resource usage (CPU, memory limits), restart or stop containers, and view container logs.',
        },
        {
          name: 'Security',
          desc: 'Audit log of all admin actions, IP allowlist configuration, and failed login tracking. Security score shows the status of HTTPS, session cookies, rate limiting, container sandboxing, and credential isolation.',
        },
        {
          name: 'Backup',
          desc: 'Create, download, and restore backups. Supports AES-256-GCM encryption for secure backup files. Schedule automatic backups on a cron interval.',
        },
        {
          name: 'Settings',
          desc: 'Password management, two-factor authentication (TOTP with QR code setup), theme selection (dark, light, midnight, forest, amber), avatar upload, API token generation, plugin enable/disable toggles, bot personality editor, and About page showing the NanoCrab edition and version.',
        },
        {
          name: 'Update NanoCrab',
          desc: 'Run /update-nanocrab from the main control group to update from the latest NanoCrab GitHub release. The updater writes logs under store/updates and restarts the service when complete.',
        },
      ],
    },
    {
      title: 'Bot Integration',
      id: 'help-bot',
      items: [
        {
          name: 'Channels',
          desc: 'The bot responds on WhatsApp, Telegram, and Signal. Each channel self-registers at startup. Messages are routed to the configured agent provider running in isolated Linux containers.',
        },
        {
          name: 'Container Skills',
          desc: 'Provider-neutral skills loaded inside agent containers at runtime. Each group has its own persistent container with isolated filesystem.',
        },
        {
          name: 'Persistent Containers',
          desc: 'Main groups get persistent containers that maintain state between conversations. Container resource limits (CPU, memory) are configurable per group.',
        },
      ],
    },
    {
      title: 'Key Features',
      id: 'help-features',
      items: [
        {
          name: 'Plugin System',
          desc: 'Enable or disable plugins from Settings. Each plugin adds sidebar navigation, API routes, and UI components. Disabled plugins are fully unloaded.',
        },
        {
          name: 'Two-Factor Auth',
          desc: 'TOTP-based 2FA with QR code setup. Compatible with Google Authenticator, Authy, and other TOTP apps. Required at login when enabled.',
        },
        {
          name: 'Encrypted Backups',
          desc: 'Backup encryption uses AES-256-GCM. Set an encryption password in Settings. Encrypted backups can only be restored with the correct password.',
        },
        {
          name: 'GitHub Autofix Pipeline',
          desc: 'End-to-end automation: a webhook receives the issue event, an agent analyzes the codebase and writes a fix, then a PR is opened automatically with the changes.',
        },
        {
          name: 'Container Isolation',
          desc: 'Each agent runs in a sandboxed Docker container with read-only project mounts, shadow-mounted secrets, and configurable resource limits (CPU, memory).',
        },
        {
          name: 'Weather Widget',
          desc: 'Dashboard weather widget showing current conditions, temperature, wind, and forecast. Data refreshes automatically.',
        },
        {
          name: 'Theme System',
          desc: 'Five built-in themes: dark, light, midnight, forest, and amber. Toggle from the sidebar footer or Settings page. Theme preference persists across sessions.',
        },
      ],
    },
  ];

  // Flatten for search
  const allItems = [];
  for (const sec of sections) {
    for (const item of sec.items) {
      allItems.push({
        section: sec.title,
        sectionId: sec.id,
        name: item.name,
        desc: item.desc,
      });
    }
  }

  function buildSectionsHtml(filter) {
    const q = (filter || '').toLowerCase().trim();
    let html = '';
    for (const sec of sections) {
      const matchingItems = sec.items.filter(
        (item) =>
          !q ||
          item.name.toLowerCase().includes(q) ||
          item.desc.toLowerCase().includes(q) ||
          sec.title.toLowerCase().includes(q),
      );
      if (matchingItems.length === 0) continue;
      html += `<section class="help-section-card" id="${sec.id}">`;
      html += `<div class="help-section-head"><h3>${esc(sec.title)}</h3><span>${matchingItems.length} topics</span></div>`;
      if (sec.description)
        html += `<p class="help-section-desc">${esc(sec.description)}</p>`;
      html += '<div class="help-topic-grid">';
      for (const item of matchingItems) {
        let name = esc(item.name);
        let desc = esc(item.desc);
        if (q) {
          const re = new RegExp(
            '(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')',
            'gi',
          );
          name = name.replace(
            re,
            '<mark>$1</mark>',
          );
          desc = desc.replace(
            re,
            '<mark>$1</mark>',
          );
        }
        html += '<article class="help-topic-card">';
        html += `<h4>${name}</h4>`;
        html += `<p>${desc}</p>`;
        html += '</article>';
      }
      html += '</div></section>';
    }
    if (!html) {
      html = renderHelpSearchEmptyState(filter);
    }
    return html;
  }

  function renderHelpSearchEmptyState(filter) {
    const query = (filter || '').trim();
    const starters = ['MCP tools', 'Cowork projects', 'email summary', 'memory', 'GitHub Copilot'];
    const routes = [
      {
        label: 'Copilot',
        title: 'Plain conversation',
        desc: 'Use this when you need a quick answer, draft, or second opinion without project state.',
        action: "navigate('chat')",
      },
      {
        label: 'Cowork',
        title: 'Project and MCP work',
        desc: 'Create files, artifacts, documents, and summaries from external context inside a project.',
        action: "navigate('projects')",
      },
      {
        label: 'Code',
        title: 'Repos and GitHub Copilot',
        desc: 'Use this for branches, diffs, tests, GitHub issues, and coding-agent handoffs.',
        action: "navigate('gitcode')",
      },
      {
        label: 'Memory',
        title: 'Personal knowledge',
        desc: 'Review what NanoCrab has learned across agents, channels, projects, and chats.',
        action: "navigate('memory')",
      },
      {
        label: 'MCP setup',
        title: 'Tool connections',
        desc: 'Check integrations, credentials, providers, and approvals before tools read or write externally.',
        action: "navigate('integrations')",
      },
    ];
    return `
      <section class="help-empty-state">
        <div>
          <span class="report-kicker">Search fallback</span>
          <strong>No manual topics matched${query ? ` "${esc(query)}"` : ''}</strong>
          <p>Try a workspace route or use one of the starter searches below. Copilot is for plain conversation, Cowork is for project files and MCP context, Code is for repository work, and Memory is personal context learned across agents.</p>
        </div>
        <div class="help-empty-routes help-empty-route-grid">
          ${routes
            .map(
              (route) => `
                <button type="button" class="help-empty-route-card" onclick="${route.action}">
                  <span>${esc(route.label)}</span>
                  <strong>${esc(route.title)}</strong>
                  <p>${esc(route.desc)}</p>
                </button>`,
            )
            .join('')}
        </div>
        <div class="help-empty-searches">
          ${starters
            .map(
              (starter) =>
                `<button type="button" onclick="document.getElementById('help-search').value='${esc(starter)}';document.getElementById('help-search').dispatchEvent(new Event('input'))">${esc(starter)}</button>`,
            )
            .join('')}
        </div>
      </section>`;
  }

  // Table of contents
  const tocHtml = sections
    .map(
      (s) =>
        `<a onclick="document.getElementById('${s.id}')?.scrollIntoView({behavior:'smooth',block:'start'})">${esc(s.title)}</a>`,
    )
    .join('');

  const quickPathHtml = quickPaths
    .map(
      (path) => `
        <article class="help-path-card">
          <span>${esc(path.mode)}</span>
          <h3>${esc(path.title)}</h3>
          <p>${esc(path.desc)}</p>
          <button class="btn btn-sm btn-ghost" onclick="${path.action}">${esc(path.actionLabel)}</button>
        </article>`,
    )
    .join('');

  const decisionHtml = decisionCards
    .map(
      (card) => `
        <article class="help-decision-card">
          <div>
            <span>${esc(card.place)}</span>
            <h3>${esc(card.intent)}</h3>
          <p>${esc(card.detail)}</p>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="${card.action}">Go</button>
      </article>`,
    )
    .join('');

  const capabilityMapHtml = capabilityRoutes
    .map(
      (item) => `
        <article class="help-capability-card">
          <span>${esc(item.status)}</span>
          <strong>${esc(item.capability)}</strong>
          <dl>
            <div><dt>UI route</dt><dd>${esc(item.route)}</dd></div>
            <div><dt>Command or MCP path</dt><dd>${esc(item.command)}</dd></div>
          </dl>
          <button class="btn btn-sm btn-ghost" onclick="${item.ui}">${esc(item.capability === 'Route hygiene' ? 'Open capability docs' : 'Open route')}</button>
        </article>`,
    )
    .join('');

  const actionLadderHtml = actionLadder
    .map(
      (item) => `
        <article class="help-action-card">
          <span>${esc(item.label)}</span>
          <div>
            <h3>${esc(item.title)}</h3>
            <p>${esc(item.detail)}</p>
          </div>
          <button class="btn btn-sm btn-ghost" onclick="${item.action}">${esc(item.actionLabel)}</button>
        </article>`,
    )
    .join('');

  const stuckStateHtml = stuckStateRoutes
    .map(
      (item) => `
        <button type="button" class="help-stuck-card" onclick="${item.action}">
          <span>${esc(item.state)}</span>
          <strong>${esc(item.route)}</strong>
          <p>${esc(item.detail)}</p>
        </button>`,
    )
    .join('');

  const workspacePromptHtml = workspacePromptDeck
    .map(
      (item, index) => `
        <article class="help-workspace-prompt">
          <span>${esc(item.lane)}</span>
          <strong>${esc(item.label)}</strong>
          <p>${esc(item.prompt)}</p>
          <div class="help-workspace-prompt-actions">
            <button type="button" class="btn btn-sm btn-ghost" onclick="copyHelpWorkspacePrompt(${index})">Copy prompt</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="${item.route}">${esc(item.routeLabel)}</button>
          </div>
        </article>`,
    )
    .join('');

  const mcpWorkflowHtml = mcpWorkflowSteps
    .map(
      (step) => `
        <article class="help-mcp-step">
          <span>${esc(step.step)}</span>
          <div>
            <h3>${esc(step.title)}</h3>
            <p>${esc(step.detail)}</p>
          </div>
          <button class="btn btn-sm btn-ghost" onclick="${step.action}">${esc(step.actionLabel)}</button>
        </article>`,
    )
    .join('');
  const mcpPromptHtml = mcpPromptRecipes
    .map(
      (recipe, index) => `
        <article class="help-mcp-recipe">
          <span>${esc(recipe.label)}</span>
          <p>${esc(recipe.prompt)}</p>
          <div class="help-mcp-recipe-actions">
            <button type="button" class="btn btn-sm btn-ghost" onclick="copyHelpMcpPromptRecipe(${index})">Copy prompt</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="navigate('projects')">Use in Cowork</button>
          </div>
        </article>`,
    )
    .join('');

  el.innerHTML = `
    <div class="help-command-center">
      <div>
        <span class="eyebrow">Productivity manual</span>
        <h2>Find the right workspace for the job</h2>
        <p>Use Copilot for direct conversation, Cowork for project context and MCP-backed work, and Code for repository automation.</p>
        <div class="help-command-actions">
          <button class="btn btn-sm btn-ghost" onclick="copyHelpProductivityBrief()">Copy routing brief</button>
          <button class="btn btn-sm btn-ghost" onclick="navigate('projects')">Open Cowork</button>
        </div>
      </div>
      <div class="help-command-meta">
        <strong>${allItems.length}</strong>
        <span>indexed topics</span>
      </div>
    </div>
    <div class="help-path-grid">${quickPathHtml}</div>
    <section class="help-capability-map" aria-label="Current capability map">
      <div class="help-capability-head">
        <span class="eyebrow">Current capability map</span>
        <h3>Every supported capability has a route or command path</h3>
        <p>Every supported capability has a UI route, a documented command/MCP path, or both. Use the durable docs file when checking whether a feature is user-facing, command-only, MCP-only, or still partial.</p>
      </div>
      <div class="help-capability-grid">${capabilityMapHtml}</div>
    </section>
    <section class="help-action-ladder" aria-label="Turn manual guidance into work">
      <div class="help-action-head">
        <span class="eyebrow">Action ladder</span>
        <h3>Turn the manual into the next useful move</h3>
        <p>Use this when you know what you need, but not which part of NanoCrab should own it.</p>
      </div>
      <div class="help-action-grid">${actionLadderHtml}</div>
    </section>
    <section class="help-decision-strip" aria-label="Choose a workspace by intent">
      <div class="help-decision-head">
        <span class="eyebrow">Decision guide</span>
        <h3>Pick the smallest workspace that fits the job</h3>
      </div>
      <div class="help-decision-grid">${decisionHtml}</div>
    </section>
    <section class="help-workspace-prompts" aria-label="Copy-ready workspace starter prompts">
      <div class="help-workspace-prompt-head">
        <span class="eyebrow">Starter prompt deck</span>
        <h3>Copy the first useful ask</h3>
        <p>Use these when the route is clear but the first prompt still needs the right boundary.</p>
      </div>
      <div class="help-workspace-prompt-grid">${workspacePromptHtml}</div>
    </section>
    <section class="help-stuck-router" aria-label="Route blocked work">
      <div class="help-stuck-head">
        <span class="eyebrow">Stuck state router</span>
        <h3>When the next step is unclear, recover the work instead of restarting it.</h3>
        <p>Use these routes when context, proof, external tools, or durable outputs are the missing piece.</p>
      </div>
      <div class="help-stuck-grid">${stuckStateHtml}</div>
    </section>
    <section class="help-mcp-runbook" aria-label="Cowork MCP project workflow">
      <div class="help-mcp-runbook-head">
        <div>
          <span class="eyebrow">Cowork MCP runbook</span>
          <h3>Turn external context into project artifacts</h3>
          <p>Use this path for requests like summarizing the latest emails, checking all emails from a sender, or creating a document from approved MCP sources.</p>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="copyHelpMcpRunbook()">Copy runbook</button>
      </div>
      <div class="help-mcp-step-grid">${mcpWorkflowHtml}</div>
      <div class="help-mcp-recipe-grid" aria-label="Copy-ready Cowork MCP prompts">${mcpPromptHtml}</div>
    </section>
    <div class="help-layout">
      <div class="help-main">
        <div class="help-search-panel">
          <label for="help-search">Search the manual</label>
          <input type="text" id="help-search" placeholder="Search projects, MCP, memory, Copilot..." />
        </div>
        <div id="help-sections">${buildSectionsHtml('')}</div>
      </div>
      <aside class="help-toc" id="help-toc">
        <div class="help-toc-title">Sections</div>
        ${tocHtml}
      </aside>
    </div>`;

  // Show TOC on wider screens
  const toc = document.getElementById('help-toc');
  if (toc && window.innerWidth > 900) toc.classList.add('visible');

  // Search handler
  const searchInput = document.getElementById('help-search');
  if (searchInput) {
    let debounce = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        document.getElementById('help-sections').innerHTML = buildSectionsHtml(
          searchInput.value,
        );
      }, 150);
    });
    searchInput.focus();
  }

  window.copyHelpProductivityBrief = async function () {
    const text = helpProductivityBriefText();
    await copyTextWithFallback(
      text,
      'Help routing brief copied',
      'Copy Help routing brief',
    );
  };

  window.copyHelpMcpRunbook = async function () {
    const text = helpMcpRunbookText();
    await copyTextWithFallback(
      text,
      'Help MCP runbook copied',
      'Copy Help MCP runbook',
    );
  };
}
