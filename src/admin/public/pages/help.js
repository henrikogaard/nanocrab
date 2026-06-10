// NanoCrab Admin — Help Page

// --- Help / Manual ---
function renderHelp(el) {
  const sections = [
    {
      title: 'Overview',
      id: 'help-overview',
      items: [
        {
          name: 'Dashboard',
          desc: 'Your home screen. Shows system stats (CPU, memory, uptime), a weather widget, channel and agent status indicators, a live message feed updated via WebSocket, and a message volume chart. Widgets can be reordered or hidden via the Customize button.',
        },
        {
          name: 'Agents',
          desc: 'Manage all agent types. Bot agents handle WhatsApp, Telegram, and Signal conversations. Coding agents integrate Claude Code, Codex, and GitHub Copilot. Launch coding tasks with model selection (Claude, GPT, etc.) and view scheduled tasks that run on cron intervals.',
        },
        {
          name: 'Messages',
          desc: 'Full message history across all channels with search and filtering. Pin important messages for quick reference. Click any message to see its full context and metadata.',
        },
        {
          name: 'Memory',
          desc: 'Shared memory store accessible across all channels. The agent remembers context from previous conversations. Also includes a wiki knowledge base for persistent reference material.',
        },
        {
          name: 'Usage',
          desc: 'Message statistics and conversation analytics. Track volume by channel, time of day, and agent. Monitor token usage and API costs over time.',
        },
        {
          name: 'Sessions',
          desc: 'View active admin sessions and session transcripts. See which groups have active conversations and review past interactions.',
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
          name: 'Integrations',
          desc: 'MCP (Model Context Protocol) servers, AI providers, and container skills. Connect external tools and services that agents can use during conversations.',
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
          name: 'Chat',
          desc: 'Send messages to the bot directly from the dashboard. Useful for testing agent responses without switching to a messaging app.',
        },
        {
          name: 'Copilot',
          desc: 'GitHub Copilot integration with multi-account OAuth. Assign Copilot to GitHub issues, browse repositories, and manage multiple GitHub accounts.',
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
          desc: 'Markdown knowledge base. Create and organize reference documents that the agent can access during conversations. Supports full markdown with syntax highlighting.',
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
          desc: 'Git operations (status, diff, log, branch), integrated code editor with syntax highlighting, test runner, code snippets library, and review rules configuration.',
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
      html += `<div class="card" style="margin-bottom:16px" id="${sec.id}">`;
      html += `<div class="card-title" style="font-size:1.1em;margin-bottom:4px">${esc(sec.title)}</div>`;
      if (sec.description)
        html += `<div style="color:var(--text2);font-size:0.85em;margin-bottom:12px">${esc(sec.description)}</div>`;
      html += '<div style="display:grid;gap:12px">';
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
            '<mark style="background:var(--accent);color:var(--bg);border-radius:2px;padding:0 2px">$1</mark>',
          );
          desc = desc.replace(
            re,
            '<mark style="background:var(--accent);color:var(--bg);border-radius:2px;padding:0 2px">$1</mark>',
          );
        }
        html += `<div style="padding:10px 12px;background:var(--bg);border-radius:8px;border:1px solid var(--border)">`;
        html += `<div style="font-weight:600;margin-bottom:4px;color:var(--text)">${name}</div>`;
        html += `<div style="font-size:0.85em;color:var(--text2);line-height:1.5">${desc}</div>`;
        html += '</div>';
      }
      html += '</div></div>';
    }
    if (!html) {
      html = '<div class="card empty">No results matching your search</div>';
    }
    return html;
  }

  // Table of contents
  const tocHtml = sections
    .map(
      (s) =>
        `<a onclick="document.getElementById('${s.id}')?.scrollIntoView({behavior:'smooth',block:'start'})" style="cursor:pointer;color:var(--accent);font-size:0.85em;text-decoration:none;padding:2px 0;display:block">${esc(s.title)}</a>`,
    )
    .join('');

  el.innerHTML = `
    <div class="page-header"><h2>Help & Manual</h2><span class="badge badge-muted">${allItems.length} topics</span></div>
    <div style="display:flex;gap:16px;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div class="card" style="margin-bottom:16px">
          <input type="text" id="help-search" placeholder="Search the manual..." style="width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:0.95em;outline:none" />
        </div>
        <div id="help-sections">${buildSectionsHtml('')}</div>
      </div>
      <div class="card" style="min-width:140px;max-width:180px;position:sticky;top:16px;display:none" id="help-toc">
        <div class="card-title" style="font-size:0.85em;margin-bottom:8px">Sections</div>
        ${tocHtml}
      </div>
    </div>`;

  // Show TOC on wider screens
  const toc = document.getElementById('help-toc');
  if (toc && window.innerWidth > 900) toc.style.display = 'block';

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
}
