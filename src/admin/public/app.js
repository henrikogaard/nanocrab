// NanoCrab Admin Dashboard — Modern SPA

const app = document.getElementById('app');
let currentPage = '';
let pollTimers = [];
let ws = null;
let sessionToken = null;
let botName = 'NanoCrab'; // Loaded dynamically from API

// --- Theme ---
const THEMES = ['dark', 'light', 'midnight', 'forest', 'amber'];
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
}
window.toggleTheme = function () {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const idx = THEMES.indexOf(current);
  const next = THEMES[(idx + 1) % THEMES.length];
  setTheme(next);
};
window.setTheme = function (name) {
  document.documentElement.setAttribute('data-theme', name);
  localStorage.setItem('theme', name);
  // Update active state in settings if visible
  document.querySelectorAll('.theme-option').forEach((el) => {
    el.classList.toggle('active', el.dataset.theme === name);
  });
};
initTheme();

// --- API ---
async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401 && currentPage !== 'login') {
    showLogin();
    throw new Error('Unauthorized');
  }
  const data = await res.json();
  return data;
}

function stopPolling() {
  pollTimers.forEach((t) => clearInterval(t));
  pollTimers = [];
  activeTerminal = null;
  if (window._chatWsRestore) {
    handleWsMessage = window._chatWsRestore;
    delete window._chatWsRestore;
  }
}
function poll(fn, ms) {
  fn();
  pollTimers.push(setInterval(fn, ms));
}

// --- WebSocket ---
function connectWs() {
  if (ws && ws.readyState <= 1) ws.close();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const match = document.cookie.match(/nanocrab_session=([^;]+)/);
  const token = match?.[1] || '';
  if (!token) {
    console.warn('WS: no session cookie found');
    return;
  }
  const url = `${proto}://${location.host}/ws?token=${token}`;
  console.log(
    'WS connecting to:',
    url.replace(token, token.slice(0, 8) + '...'),
  );
  ws = new WebSocket(url);
  ws.onopen = () => {
    console.log('WS connected');
  };
  ws.onmessage = (e) => {
    try {
      handleWsMessage(JSON.parse(e.data));
    } catch {}
  };
  ws.onclose = (e) => {
    console.log('WS closed:', e.code, e.reason);
    ws = null;
    setTimeout(connectWs, 5000);
  };
  ws.onerror = (e) => {
    console.error('WS error:', e);
  };
}

let activeTerminal = null; // { sessionId, term }

const PAGE_ALIASES = {
  terminal: 'devhub',
  developer: 'devhub',
  mounts: 'devhub',
  files: 'devhub',
  code: 'gitcode',
  git: 'gitcode',
  deploy: 'pipelines',
  docker: 'containers',
  providers: 'integrations',
  mcp: 'integrations',
};

function canonicalPage(page) {
  return PAGE_ALIASES[page] || page || 'dashboard';
}

let handleWsMessage = function (msg) {
  // Route terminal output to active terminal
  if (
    msg.type === 'terminal_output' &&
    activeTerminal &&
    msg.sessionId === activeTerminal.sessionId
  ) {
    activeTerminal.term.write(msg.data.replace(/\n/g, '\r\n'));
    activeTerminal.transcript =
      (activeTerminal.transcript || '') + String(msg.data || '');
    return;
  }
  // Browser notifications for new messages
  if (
    msg.type === 'new_message' &&
    document.hidden &&
    Notification.permission === 'granted' &&
    localStorage.getItem('notifications_enabled') === 'true'
  ) {
    new Notification(msg.data.sender_name, {
      body: msg.data.content?.slice(0, 100),
      icon: '/static/nanocrab-mark.png',
    });
  }
  if (msg.type === 'new_message' && currentPage === 'dashboard') {
    const feed = document.getElementById('live-feed');
    if (feed) {
      const m = msg.data;
      const div = document.createElement('div');
      div.className = 'message message-new';
      div.innerHTML = `<div class="message-meta"><span class="live-dot"></span><span class="message-sender">${esc(m.sender_name)}</span><span>${timeAgo(m.timestamp)}</span></div><div class="message-content">${esc(truncate(m.content, 200))}</div>`;
      feed.prepend(div);
      if (feed.children.length > 20) feed.lastChild.remove();
      setTimeout(() => div.classList.remove('message-new'), 3000);
    }
  }
  if (msg.type === 'agent_question') {
    toast(
      'New question from agent: ' + (msg.data?.question || '').slice(0, 60),
      'warning',
    );
    if (currentPage === 'agents') navigate('agents');
  }
  if (msg.type === 'agent_message') {
    toast(
      'Agent message: ' +
        (msg.data?.fromGroup || '') +
        ' \u2192 ' +
        (msg.data?.toGroup || ''),
      'info',
    );
  }
  if (msg.type === 'log_lines') {
    const viewer = document.getElementById('live-log');
    if (viewer) {
      msg.data.lines.forEach((l) => {
        viewer.textContent += l + '\n';
      });
      viewer.scrollTop = viewer.scrollHeight;
    }
  }
};

// --- Auth ---
async function checkAuth() {
  try {
    await api('/me');
    return true;
  } catch {
    return false;
  }
}

function showLogin() {
  stopPolling();
  currentPage = 'login';
  app.innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <div class="login-brand">
          ${brandLogo('brand-logo-lockup', 'lockup')}
          <div class="login-brand-copy">
            <h1 class="sr-only">NanoCrab</h1>
            <p>${esc(botName)} Admin</p>
          </div>
        </div>
        <div class="login-error" id="login-error"></div>
        <form id="login-form">
          <input type="text" id="login-username" placeholder="Username" autocomplete="username" autofocus>
          <input type="password" id="login-password" placeholder="Password" autocomplete="current-password">
          <button type="submit" class="btn btn-primary" style="width:100%">Log in</button>
        </form>
      </div>
    </div>`;
  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const u = document.getElementById('login-username').value;
    const p = document.getElementById('login-password').value;
    const totpInput = document.getElementById('login-totp');
    const totp = totpInput ? totpInput.value : undefined;
    const err = document.getElementById('login-error');
    try {
      const body = { username: u, password: p };
      if (totp) body.totp = totp;
      const res = await api('/login', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await loadBotName();
        window._pluginsList = await api('/plugins').catch(() => []);
        connectWs();
        navigate('dashboard');
      } else if (res.requires2fa) {
        // Show TOTP input field
        if (!document.getElementById('login-totp')) {
          const totpGroup = document.createElement('div');
          totpGroup.innerHTML =
            '<input type="text" id="login-totp" placeholder="6-digit code" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" inputmode="numeric" style="margin-top:8px;text-align:center;font-size:18px;letter-spacing:6px">';
          document
            .getElementById('login-form')
            .insertBefore(
              totpGroup,
              document.getElementById('login-form').querySelector('button'),
            );
          document.getElementById('login-totp').focus();
        }
        err.textContent = 'Enter your 2FA code';
        err.style.display = 'block';
        err.style.background = 'var(--accent-bg, var(--surface2))';
        err.style.color = 'var(--accent)';
      } else {
        err.textContent = res.error || 'Invalid credentials';
        err.style.display = 'block';
      }
    } catch {
      err.textContent = 'Connection error';
      err.style.display = 'block';
    }
  };
}

// --- Shell ---
const navIconPaths = {
  dashboard:
    '<path d="M4 10.5 12 4l8 6.5"/><path d="M6.5 10v8.5h11V10"/><path d="M10 18.5v-5h4v5"/>',
  agents:
    '<path d="M12 3.5 20.5 8v8L12 20.5 3.5 16V8L12 3.5Z"/><path d="M12 8.5v7"/><path d="M8.5 10.5 12 8.5l3.5 2"/><path d="M7.5 15.5 12 18l4.5-2.5"/>',
  messages:
    '<path d="M5 6.5h14v9H9l-4 3v-12Z"/><path d="M8 10h8"/><path d="M8 13h5"/>',
  chat: '<path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3A7.5 7.5 0 0 1 12 19.5c-1.2 0-2.4-.3-3.4-.8L4.5 20l1.3-4A7.4 7.4 0 0 1 4.5 12Z"/><path d="M8.5 11.5h7"/><path d="M8.5 14.5h4.5"/>',
  groups:
    '<path d="M8 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M16 10a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z"/><path d="M3.5 18.5c.4-3 2-5 4.5-5s4.1 2 4.5 5"/><path d="M13.2 14c2.9-.4 4.7 1.2 5.3 4.5"/>',
  tasks:
    '<path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v12A1.5 1.5 0 0 1 17 19.5H7A1.5 1.5 0 0 1 5.5 18V6A1.5 1.5 0 0 1 7 4.5Z"/><path d="m8.5 10 1.5 1.5L13 8.5"/><path d="M14.5 10h1.5"/><path d="m8.5 15 1.5 1.5L13 13.5"/><path d="M14.5 15h1.5"/>',
  missions:
    '<path d="M5 5.5h14v4.5H5z"/><path d="M7 10v8.5h10V10"/><path d="M9 14h6"/><path d="M9 16.5h4"/><path d="M8.5 3.5v2"/><path d="M15.5 3.5v2"/>',
  memory:
    '<path d="M7.5 5.5h9A1.5 1.5 0 0 1 18 7v10.5l-2.5-1-2 2-2-2-2 2-2-2-2.5 1V7a1.5 1.5 0 0 1 1.5-1.5Z"/><path d="M8.5 9.5h7"/><path d="M8.5 12.5h5"/>',
  skills:
    '<path d="M12 3.5 19 7.5v8L12 20.5l-7-5v-8l7-4Z"/><path d="M8.5 10.5 12 8.5l3.5 2"/><path d="M8.5 14 12 16l3.5-2"/><path d="M12 8.5v7.5"/>',
  timeline:
    '<path d="M7 5.5v13"/><circle cx="7" cy="7" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="7" cy="17" r="2"/><path d="M10 7h8"/><path d="M10 12h6"/><path d="M10 17h8"/>',
  wiki: '<path d="M6.5 4.5h8a3 3 0 0 1 3 3v12h-8a3 3 0 0 1-3-3v-12Z"/><path d="M6.5 4.5v12"/><path d="M9.5 8h5"/><path d="M9.5 11h4"/>',
  workflows:
    '<path d="M5 7.5h5v5H5z"/><path d="M14 12h5v5h-5z"/><path d="M10 10h2.5a2 2 0 0 1 2 2"/><path d="M14 14.5h-2.5a2 2 0 0 1-2-2"/>',
  uptime:
    '<path d="M12 20a8 8 0 1 0-8-8"/><path d="M12 7.5V12l3 2"/><path d="M4 17h4"/><path d="M4 13h3"/>',
  autofix:
    '<path d="M12 3.5v4"/><path d="M12 16.5v4"/><path d="M20.5 12h-4"/><path d="M7.5 12h-4"/><path d="m17.7 6.3-2.8 2.8"/><path d="m9.1 14.9-2.8 2.8"/><path d="m17.7 17.7-2.8-2.8"/><path d="m9.1 9.1-2.8-2.8"/><circle cx="12" cy="12" r="3"/>',
  copilot:
    '<path d="M7.5 8.5h9a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3Z"/><path d="M9 8.5V6.8a3 3 0 0 1 6 0v1.7"/><path d="M9 13h.1"/><path d="M15 13h.1"/><path d="M10 16h4"/>',
  devhub: '<path d="m5.5 8.5 4 3.5-4 3.5"/><path d="M11.5 16h7"/>',
  gitcode:
    '<path d="M7.5 7.5 4 11l3.5 3.5"/><path d="m16.5 7.5 3.5 3.5-3.5 3.5"/><path d="m13.5 5.5-3 13"/>',
  pipelines:
    '<path d="M5 6.5h5v5H5z"/><path d="M14 12.5h5v5h-5z"/><path d="M10 9h2.2a2.8 2.8 0 0 1 2.8 2.8v.7"/><path d="M12.8 15H10a2.8 2.8 0 0 1-2.8-2.8v-.7"/>',
  monitoring:
    '<path d="M4.5 15.5h3l2-7 4 11 2.5-7h3.5"/><path d="M4.5 5.5h15v13h-15z"/>',
  containers:
    '<path d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z"/><path d="M4.5 8.5 12 13l7.5-4.5"/><path d="M12 13v7"/>',
  integrations:
    '<path d="M8.5 8.5h-2A2.5 2.5 0 0 0 4 11v0A2.5 2.5 0 0 0 6.5 13.5h2"/><path d="M15.5 8.5h2A2.5 2.5 0 0 1 20 11v0a2.5 2.5 0 0 1-2.5 2.5h-2"/><path d="M8.5 11h7"/><path d="M12 5v2"/><path d="M12 17v2"/>',
  security:
    '<path d="M12 3.5 18.5 6v5.3c0 4.2-2.5 7-6.5 9.2-4-2.2-6.5-5-6.5-9.2V6L12 3.5Z"/><path d="m9.5 12 1.8 1.8 3.5-4"/>',
  marketplace:
    '<path d="M6.5 8.5h11l-1 10h-9l-1-10Z"/><path d="M8 8.5a4 4 0 0 1 8 0"/><path d="M8.5 12h7"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2"/><path d="M12 18.5v2"/><path d="m18 6 1.4 1.4"/><path d="m4.6 16.6 1.4 1.4"/><path d="M20.5 12h-2"/><path d="M5.5 12h-2"/><path d="m18 18-1.4-1.4"/><path d="m7.4 7.4-1.4-1.4"/>',
  help: '<circle cx="12" cy="12" r="8"/><path d="M9.8 9.5a2.4 2.4 0 0 1 4.6 1c0 1.8-2.4 1.9-2.4 3.4"/><path d="M12 17h.1"/>',
  logout:
    '<path d="M9.5 5.5h-3A1.5 1.5 0 0 0 5 7v10a1.5 1.5 0 0 0 1.5 1.5h3"/><path d="M13.5 8.5 17 12l-3.5 3.5"/><path d="M17 12H9"/>',
  menu: '<path d="M5 7h14"/><path d="M5 12h14"/><path d="M5 17h14"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
};

function navIcon(name, extraClass = '') {
  const key = navIconPaths[name] ? name : 'integrations';
  return `<span class="nav-icon ${extraClass}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${navIconPaths[key]}</svg></span>`;
}

function brandLogo(extraClass = '', variant = 'mark') {
  const className = ['brand-logo', extraClass].filter(Boolean).join(' ');
  const isLockup = variant === 'lockup';
  const src = isLockup
    ? '/static/nanocrab-logo.png'
    : '/static/nanocrab-mark.png';
  const alt = isLockup ? 'NanoCrab' : '';
  const hidden = isLockup ? '' : ' aria-hidden="true"';
  return `<img class="${className}" src="${src}" alt="${alt}"${hidden}>`;
}

function showShell(page) {
  stopPolling();
  currentPage = page;
  // Core navigation
  const navItems = [
    { id: 'dashboard', icon: 'dashboard', label: 'Dashboard', section: 'Home' },
    { id: 'agents', icon: 'agents', label: 'Agents' },
    { id: 'messages', icon: 'messages', label: 'Messages' },
    { id: 'chat', icon: 'chat', label: 'Chat' },
    { id: 'groups', icon: 'groups', label: 'Groups', section: 'Workspace' },
    { id: 'tasks', icon: 'tasks', label: 'Tasks' },
    { id: 'missions', icon: 'missions', label: 'Missions' },
    { id: 'memory', icon: 'memory', label: 'Memory' },
    { id: 'skills', icon: 'skills', label: 'Skills' },
    { id: 'timeline', icon: 'timeline', label: 'Timeline' },
  ];

  // Inject enabled plugins
  const cachedPlugins = window._pluginsList || [];
  if (cachedPlugins.length > 0) {
    let first = true;
    for (const p of cachedPlugins) {
      if (!p.enabled || !p.sidebar) continue;
      if (p.sidebar.id === 'chat') continue; // chat already in Home
      navItems.push({
        id: p.sidebar.id,
        icon: navIconPaths[p.sidebar.id] ? p.sidebar.id : 'integrations',
        label: p.sidebar.label,
        section: first ? 'Tools' : undefined,
      });
      first = false;
    }
  }

  // Developer & System
  navItems.push(
    { id: 'devhub', icon: 'devhub', label: 'Terminal', section: 'Developer' },
    { id: 'gitcode', icon: 'gitcode', label: 'Git & Code' },
    { id: 'pipelines', icon: 'pipelines', label: 'Deploy' },
    {
      id: 'monitoring',
      icon: 'monitoring',
      label: 'Monitoring',
      section: 'System',
    },
    { id: 'containers', icon: 'containers', label: 'Containers' },
    { id: 'integrations', icon: 'integrations', label: 'Integrations' },
    { id: 'security', icon: 'security', label: 'Security' },
    { id: 'marketplace', icon: 'marketplace', label: 'Marketplace' },
    { id: 'settings', icon: 'settings', label: 'Settings' },
  );

  // Role-based sidebar filtering
  const role = window._userRole || 'owner';
  const viewerHidden = [
    'devhub',
    'gitcode',
    'pipelines',
    'containers',
    'security',
    'integrations',
    'marketplace',
  ];
  const adminHidden = []; // admins see everything except terminal (checked at runtime)
  const filteredNavItems = navItems.filter((item) => {
    if (role === 'owner') return true;
    if (role === 'viewer') return !viewerHidden.includes(item.id);
    return true; // admin sees all nav items
  });

  // Build nav with collapsible sections
  const savedCollapsed = JSON.parse(
    localStorage.getItem('nav_collapsed') || '{}',
  );
  let navHtml = '';
  let lastSection = '';
  let sectionIdx = 0;
  for (const item of filteredNavItems) {
    if (item.section && item.section !== lastSection) {
      if (lastSection) navHtml += '</div>'; // close previous group
      const secId = item.section.toLowerCase().replace(/\s/g, '-');
      const isCollapsed =
        savedCollapsed[secId] &&
        !filteredNavItems
          .filter(
            (n) =>
              n.section === item.section ||
              (!n.section && lastSection === item.section),
          )
          .some((n) => n.id === page);
      navHtml += `<button class="nav-section nav-section-toggle" onclick="toggleNavSection('${secId}')" type="button"><span>${item.section}</span><span class="toggle-arrow ${isCollapsed ? 'collapsed' : ''}" id="arrow-${secId}">${navIcon('chevron', 'nav-icon-sm')}</span></button><div class="nav-group ${isCollapsed ? 'collapsed' : ''}" id="navgroup-${secId}">`;
      lastSection = item.section;
      sectionIdx++;
    }
    navHtml += `<a class="nav-link ${page === item.id ? 'active' : ''}" onclick="navigate('${item.id}')">${navIcon(item.icon)}<span class="nav-label">${item.label}</span></a>`;
  }
  if (lastSection) navHtml += '</div>'; // close last group

  // Build mobile menu HTML
  let mobileMenuHtml = '';
  let mobileLastSection = '';
  for (const item of filteredNavItems) {
    if (item.section && item.section !== mobileLastSection) {
      mobileMenuHtml += `<div class="mobile-section">${item.section}</div>`;
      mobileLastSection = item.section;
    }
    mobileMenuHtml += `<a class="${page === item.id ? 'active' : ''}" onclick="navigate('${item.id}')">${navIcon(item.icon)}<span>${item.label}</span></a>`;
  }

  app.innerHTML = `
    <div class="app">
      <div class="mobile-nav">
        <div class="mobile-nav-header">
          <div class="mobile-brand"><span class="brand-mark">${brandLogo()}</span><div><h1>${esc(botName)}</h1><span>${window._editionShort || 'NanoCrab'}</span></div></div>
          <button class="hamburger" onclick="toggleMobileMenu()" aria-label="Open menu">${navIcon('menu')}</button>
        </div>
        <div class="mobile-menu" id="mobile-menu">
          ${mobileMenuHtml}
          <div class="mobile-section">Account</div>
          <a onclick="navigate('help')">${navIcon('help')}<span>Help</span></a>
          <a onclick="logout()">${navIcon('logout')}<span>Logout</span></a>
        </div>
      </div>
      <div class="sidebar-overlay" onclick="toggleMobileMenu()"></div>
      <nav class="sidebar">
        <div class="sidebar-header"><span class="brand-mark">${brandLogo()}</span><div><h1>${esc(botName)}</h1><span>${window._editionShort || 'NanoCrab'}</span></div></div>
        <div class="sidebar-nav">${navHtml}</div>
        <div class="sidebar-footer">
          <div class="sidebar-footer-actions">
            <button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme"></button>
            <a class="nav-link nav-link-icon-only" onclick="navigate('help')" title="Help & Manual">${navIcon('help')}</a>
            <a class="nav-link nav-link-icon-only" onclick="logout()" title="Logout">${navIcon('logout')}</a>
          </div>
        </div>
      </nav>
      <div class="main">
        ${window._mockMode ? '<div class="alert-banner alert-info"><span>Mock dashboard mode: sample data only. Live channels, containers, credentials, and servers are not touched.</span></div>' : ''}
        <div class="metrics-bar" id="metrics-bar"></div>
        <div id="alerts-bar"></div>
        <div id="page-content"><div class="loading">Loading</div></div>
      </div>
      <div class="bottom-tabs">
        <nav>
          <button class="bottom-tab ${page === 'dashboard' ? 'active' : ''}" onclick="navigate('dashboard')">${navIcon('dashboard', 'tab-icon')}<span>Home</span></button>
          <button class="bottom-tab ${page === 'chat' ? 'active' : ''}" onclick="navigate('chat')">${navIcon('chat', 'tab-icon')}<span>Chat</span></button>
          <button class="bottom-tab ${page === 'agents' ? 'active' : ''}" onclick="navigate('agents')">${navIcon('agents', 'tab-icon')}<span>Agents</span></button>
          <button class="bottom-tab ${page === 'messages' ? 'active' : ''}" onclick="navigate('messages')">${navIcon('messages', 'tab-icon')}<span>Messages</span></button>
          <button class="bottom-tab" onclick="toggleMobileMenu()">${navIcon('menu', 'tab-icon')}<span>More</span></button>
        </nav>
      </div>
    </div>`;
  loadMetricsBar();
  loadAlerts();
  // Load plugin frontend if needed, then render
  const el = document.getElementById('page-content');
  const renderFn = pages[page];
  if (renderFn) {
    renderFn(el);
  } else {
    // Try loading plugin frontend dynamically
    el.innerHTML = '<div class="loading">Loading</div>';
    loadPluginFrontend(page).then(() => {
      const fn = pages[page];
      if (fn) fn(el);
      else el.innerHTML = '<div class="card empty">Page not found</div>';
    });
  }
}

window.logout = async function () {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  if (ws) ws.close();
  showLogin();
};

// --- Metrics Bar & Alerts ---
let metricsTimer = null;
let lastMetricsHash = '';
async function loadMetricsBar() {
  if (metricsTimer) clearInterval(metricsTimer);
  const update = async () => {
    const bar = document.getElementById('metrics-bar');
    if (!bar) return;
    try {
      const d = await api('/system/dashboard');
      const online = (d.channels || []).filter((c) => c.connected).length;
      const total = (d.channels || []).length;
      const hash = `${d.uptimeFormatted}|${d.todayCount}|${(d.containers || []).length}|${online}/${total}`;
      if (hash === lastMetricsHash) return;
      lastMetricsHash = hash;
      bar.innerHTML = `
        <div class="metrics-item"><span class="metrics-label">Uptime</span><span class="metrics-value">${d.uptimeFormatted}</span></div>
        <div class="metrics-item"><span class="metrics-label">Messages</span><span class="metrics-value">${d.todayCount || 0}</span></div>
        <div class="metrics-item"><span class="metrics-label">Agents</span><span class="metrics-value">${(d.containers || []).length}</span></div>
        <div class="metrics-item"><span class="metrics-label">Channels</span><span class="metrics-value">${online}/${total}</span></div>`;
    } catch {
      // Don't overwrite existing content on error
    }
  };
  await update();
  metricsTimer = setInterval(update, 10000);
  pollTimers.push(metricsTimer);
}

async function loadAlerts() {
  const bar = document.getElementById('alerts-bar');
  if (!bar) return;
  try {
    const alerts = await api('/system/alerts');
    if (alerts.length === 0) {
      bar.innerHTML = '';
      return;
    }
    bar.innerHTML = alerts
      .map(
        (a, i) => `
      <div class="alert-banner alert-${a.type}" id="alert-${i}">
        <span>${esc(a.message)}</span>
        <button class="alert-dismiss" onclick="document.getElementById('alert-${i}').remove()">\u2715</button>
      </div>`,
      )
      .join('');
  } catch {}
}

// --- Pages ---
// Page render functions are split into /pages/*.js files loaded via <script defer>.
// Use a proxy so function references are resolved at call time (after all scripts load).
const _pageMap = {
  dashboard: 'renderDashboard',
  agents: 'renderAgents',
  chat: 'renderChat',
  messages: 'renderMessages',
  memory: 'renderMemoryConsolidated',
  skills: 'renderSkillsPage',
  timeline: 'renderMemoryKnowledgeTimeline',
  usage: 'renderUsage',
  sessions: 'renderSessions',
  groups: 'renderGroups',
  tasks: 'renderTasks',
  missions: 'renderMissions',
  workflows: 'renderWorkflows',
  credentials: 'renderCredentials',
  integrations: 'renderIntegrationsConsolidated',
  webhooks: 'renderWebhooks',
  devhub: 'renderDevHubConsolidated',
  gitcode: 'renderGitCodeConsolidated',
  containers: 'renderContainersConsolidated',
  pipelines: 'renderPipelines',
  monitoring: 'renderMonitoringConsolidated',
  security: 'renderSecurity',
  backup: 'renderBackup',
  settings: 'renderSettings',
  uptime: 'renderUptimeStandalone',
  copilot: 'renderCopilot',
  autofix: 'renderAutofix',
  help: 'renderHelp',
  marketplace: 'renderMarketplace',
};
// Track which plugin frontends we've already loaded
const _loadedFrontends = new Set();

async function loadPluginFrontend(pageId) {
  if (_loadedFrontends.has(pageId)) return;
  _loadedFrontends.add(pageId);

  // Check if this page belongs to a plugin with a frontend file
  const plugins = window._pluginsList || [];
  const plugin = plugins.find(
    (p) => p.pageId === pageId || p.sidebar?.id === pageId,
  );
  if (!plugin) return;

  // Try loading from /pages/<pageId>.js (built-in split pages)
  try {
    await loadScript(`/pages/${pageId}.js`);
    return;
  } catch {}

  // Try loading plugin frontend from marketplace plugins dir
  try {
    await loadScript(`/api/marketplace/${plugin.id}/frontend`);
  } catch {}
}

const pages = new Proxy(_pageMap, {
  get(target, prop) {
    const fnName = target[prop];
    if (fnName && window[fnName]) return window[fnName];

    // Auto-register plugin pages from _pluginsList
    if (!fnName) {
      const plugins = window._pluginsList || [];
      const plugin = plugins.find(
        (p) => p.pageId === prop || p.sidebar?.id === prop,
      );
      if (plugin) {
        // Convert kebab-case to PascalCase: "custom-tool" -> "CustomTool"
        const pascal = String(prop)
          .split('-')
          .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
          .join('');
        const renderName = 'render' + pascal;
        target[prop] = renderName;
        if (window[renderName]) return window[renderName];
      }
    }

    return undefined;
  },
  has(target, prop) {
    if (prop in target) return true;
    // Also check if any plugin claims this pageId
    const plugins = window._pluginsList || [];
    return plugins.some((p) => p.pageId === prop || p.sidebar?.id === prop);
  },
});

// --- Tab helper for consolidated pages ---
function renderTabs(containerId, tabs, defaultTab) {
  const tabBar = tabs
    .map(
      (t) =>
        `<div class="tab ${t.id === defaultTab ? 'active' : ''}" data-tab-id="${t.id}" onclick="switchTab('${containerId}','${t.id}')">${t.label}</div>`,
    )
    .join('');
  const tabContents = tabs
    .map(
      (t) =>
        `<div class="tab-content ${t.id === defaultTab ? 'active' : ''}" id="${containerId}-${t.id}"></div>`,
    )
    .join('');
  return `<div class="tab-bar">${tabBar}</div>${tabContents}`;
}

window.switchTab = (containerId, tabId) => {
  const container = document.getElementById(containerId);
  if (!container) return;
  container
    .querySelectorAll('.tab')
    .forEach((t) => t.classList.remove('active'));
  container
    .querySelectorAll('.tab-content')
    .forEach((t) => t.classList.remove('active'));
  const activeTab = container.querySelector(`.tab[data-tab-id="${tabId}"]`);
  const activeContent = document.getElementById(`${containerId}-${tabId}`);
  if (activeTab) activeTab.classList.add('active');
  if (activeContent) activeContent.classList.add('active');
};

// --- Consolidated render functions ---

async function renderMemoryConsolidated(el) {
  el.innerHTML = `<div class="page-header"><h2>Memory & Knowledge</h2></div>
    <div id="mem-tabs">${renderTabs(
      'mem-tabs',
      [
        { id: 'memory', label: 'Shared Memory' },
        { id: 'skills', label: 'Skills' },
        { id: 'timeline', label: 'Timeline' },
        { id: 'wiki', label: 'Wiki' },
      ],
      'memory',
    )}</div>`;
  await renderMemory(document.getElementById('mem-tabs-memory'));
  await renderSkills(document.getElementById('mem-tabs-skills'), {
    embedded: true,
    returnPage: 'memory',
  });
  await renderMemoryKnowledgeTimeline(
    document.getElementById('mem-tabs-timeline'),
  );
  await renderWiki(document.getElementById('mem-tabs-wiki'));
}

async function renderIntegrationsConsolidated(el) {
  el.innerHTML = `<div class="page-header"><h2>Integrations</h2></div>
    <div id="int-tabs">${renderTabs(
      'int-tabs',
      [
        { id: 'catalog', label: 'Catalog' },
        { id: 'mcp', label: 'MCP Servers' },
        { id: 'providers', label: 'AI Providers' },
      ],
      'catalog',
    )}</div>`;
  await renderConnectorCatalog(document.getElementById('int-tabs-catalog'));
  await renderMcp(document.getElementById('int-tabs-mcp'));
  await renderProviders(document.getElementById('int-tabs-providers'));
}

async function renderDevHubConsolidated(el) {
  el.innerHTML = `<div class="page-header"><h2>Developer Hub</h2></div>
    <div id="dev-tabs">${renderTabs(
      'dev-tabs',
      [
        { id: 'overview', label: 'Overview' },
        { id: 'terminal', label: 'Terminal' },
        { id: 'mounts', label: 'Mounts' },
        { id: 'files', label: 'Files' },
      ],
      'overview',
    )}</div>`;
  await renderDevHub(document.getElementById('dev-tabs-overview'));
  await renderMounts(document.getElementById('dev-tabs-mounts'));
  await renderFiles(document.getElementById('dev-tabs-files'));
  // Terminal renders on tab click (needs to initialize xterm)
  const termTab = document.querySelector(
    '#dev-tabs .tab[data-tab-id="terminal"]',
  );
  if (termTab)
    termTab.addEventListener(
      'click',
      () => {
        const termEl = document.getElementById('dev-tabs-terminal');
        if (termEl && !termEl.innerHTML) renderTerminal(termEl);
      },
      { once: true },
    );
}

async function renderGitCodeConsolidated(el) {
  el.innerHTML = `<div class="page-header"><h2>Git & Code</h2></div>
    <div id="gc-tabs">${renderTabs(
      'gc-tabs',
      [
        { id: 'git', label: 'Git Ops' },
        { id: 'editor', label: 'Editor' },
        { id: 'tests', label: 'Tests' },
        { id: 'snippets', label: 'Snippets' },
        { id: 'rules', label: 'Review Rules' },
      ],
      'git',
    )}</div>`;
  await renderGitOps(document.getElementById('gc-tabs-git'));
  await renderEditor(document.getElementById('gc-tabs-editor'));
  await renderTestRunner(document.getElementById('gc-tabs-tests'));
  await renderSnippets(document.getElementById('gc-tabs-snippets'));
  await renderReviewRules(document.getElementById('gc-tabs-rules'));
}

async function renderContainersConsolidated(el) {
  el.innerHTML = `<div class="page-header"><h2>Containers</h2></div>
    <div id="ct-tabs">${renderTabs(
      'ct-tabs',
      [
        { id: 'docker', label: 'Agent Docker' },
        { id: 'custom', label: 'Custom Containers' },
      ],
      'docker',
    )}</div>`;
  await renderDocker(document.getElementById('ct-tabs-docker'));
  await renderCustomContainers(document.getElementById('ct-tabs-custom'));
}

async function renderUptimeStandalone(el) {
  el.innerHTML =
    '<div class="page-header"><h2>Uptime Monitor</h2></div><div id="uptime-content"></div>';
  await renderUptime(document.getElementById('uptime-content'));
}

async function renderUptime(el) {
  const [monitors, groups] = await Promise.all([
    api('/uptime'),
    api('/groups'),
  ]);

  const upCount = monitors.filter((m) => m.enabled && !m.isDown).length;
  const downCount = monitors.filter((m) => m.enabled && m.isDown).length;
  const totalEnabled = monitors.filter((m) => m.enabled).length;

  el.innerHTML = `
    <div class="page-header">
      <h2>Uptime Monitoring</h2>
      <button class="btn btn-primary btn-sm" onclick="document.getElementById('new-monitor-form').style.display=document.getElementById('new-monitor-form').style.display==='none'?'block':'none'">Add Monitor</button>
    </div>

    ${
      totalEnabled > 0
        ? `<div style="display:flex;gap:12px;margin-bottom:16px">
      <div class="card stat" style="flex:1;margin:0;padding:14px"><div class="stat-value" style="font-size:22px;color:var(--success)">${upCount}</div><div class="stat-label">Up</div></div>
      <div class="card stat" style="flex:1;margin:0;padding:14px"><div class="stat-value" style="font-size:22px;color:${downCount > 0 ? 'var(--error)' : 'var(--success)'}">${downCount}</div><div class="stat-label">Down</div></div>
      <div class="card stat" style="flex:1;margin:0;padding:14px"><div class="stat-value" style="font-size:22px">${totalEnabled}</div><div class="stat-label">Total</div></div>
    </div>`
        : ''
    }

    <div class="card" id="new-monitor-form" style="display:none">
      <div class="card-title">Add Monitor</div>
      <form id="monitor-create-form">
        <div class="grid grid-2">
          <div class="form-group"><label>Name</label><input id="mon-name" placeholder="My Website" required></div>
          <div class="form-group"><label>URL</label><input id="mon-url" placeholder="https://example.com" required></div>
        </div>
        <div class="grid grid-2" style="grid-template-columns: repeat(4, 1fr)">
          <div class="form-group"><label>Method</label><select id="mon-method"><option>GET</option><option>HEAD</option><option>POST</option></select></div>
          <div class="form-group"><label>Expected Status</label><input id="mon-status" value="200" type="number"></div>
          <div class="form-group"><label>Interval (sec)</label><input id="mon-interval" value="300" type="number" min="30"></div>
          <div class="form-group"><label>Timeout (ms)</label><input id="mon-timeout" value="10000" type="number" min="1000"></div>
        </div>
        <div class="grid grid-2">
          <div class="form-group"><label>Alert Channel</label><select id="mon-alert">${groups.map((g) => `<option value="${g.jid}">${esc(g.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Alert After (consecutive failures)</label><input id="mon-alert-after" value="3" type="number" min="1"></div>
        </div>
        <div class="form-group"><label>Body Validation (optional — one check per line, e.g. <code>ok=true</code>)</label><textarea id="mon-expected-body" placeholder="ok=true\nstatus=ready\ndependencies.database.status=up" style="width:100%;min-height:80px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical"></textarea></div>
        <button type="submit" class="btn btn-primary">Add Monitor</button>
      </form>
    </div>

    ${
      monitors.length === 0
        ? '<div class="card empty">No monitors configured. Add one above.</div>'
        : monitors
            .map(
              (m) => `
      <div class="card" style="margin-bottom:8px;border-left:3px solid ${!m.enabled ? 'var(--text-muted)' : m.isDown ? 'var(--error)' : 'var(--success)'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="status-dot ${!m.enabled ? '' : m.isDown ? 'offline' : 'online'}"></span>
              <span style="font-size:15px;font-weight:600;color:var(--text)">${esc(m.name)}</span>
              ${!m.enabled ? '<span class="badge badge-muted">Disabled</span>' : m.isDown ? '<span class="badge badge-error">DOWN</span>' : '<span class="badge badge-success">UP</span>'}
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-family:var(--mono)">${esc(m.url)}</div>
          </div>
          <div style="text-align:right;font-size:12px;color:var(--text-muted)">
            ${m.lastCheck ? `<div>Last check: ${timeAgo(m.lastCheck)}</div>` : ''}
            ${m.lastResponseTime != null ? `<div>${m.lastResponseTime}ms</div>` : ''}
            ${m.lastError ? `<div style="color:var(--error)">${esc(m.lastError)}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-sm btn-ghost" onclick="checkMonitorNow('${m.id}',this)">Check Now</button>
          <button class="btn btn-sm btn-ghost" onclick="showMonitorHistory('${m.id}')">History</button>
          <button class="btn btn-sm btn-ghost" onclick="toggleMonitor('${m.id}',${!m.enabled})">${m.enabled ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-sm btn-danger" onclick="deleteMonitor('${m.id}',this)">Delete</button>
          <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">Every ${m.interval}s \u2022 Alert after ${m.alertAfter} failures</span>
        </div>
        ${
          m.expectedBody
            ? `<div style="margin-top:6px;padding:6px 10px;background:var(--surface2);border-radius:var(--radius-sm);font-family:var(--mono);font-size:11px;color:var(--text-muted)">${m.expectedBody
                .split(',')
                .map((c) => esc(c.trim()))
                .join('<br>')}</div>`
            : ''
        }
        <div style="display:none">
        </div>
        <div id="monitor-history-${m.id}" style="display:none;margin-top:10px"></div>
      </div>`,
            )
            .join('')
    }`;

  // Form handler
  document
    .getElementById('monitor-create-form')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await api('/uptime', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('mon-name').value,
          url: document.getElementById('mon-url').value,
          method: document.getElementById('mon-method').value,
          expectedStatus: document.getElementById('mon-status').value,
          interval: document.getElementById('mon-interval').value,
          timeout: document.getElementById('mon-timeout').value,
          alertJid: document.getElementById('mon-alert').value,
          alertAfter: document.getElementById('mon-alert-after').value,
          expectedBody:
            document
              .getElementById('mon-expected-body')
              .value.trim()
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .join(',') || undefined,
        }),
      });
      if (r.ok) {
        toast('Monitor added', 'success');
        renderUptime(el);
      } else toast(r.error || 'Failed', 'error');
    });
}

window.checkMonitorNow = async (id, btnEl) => {
  btnEl.disabled = true;
  btnEl.textContent = 'Checking...';
  const r = await api(`/uptime/${id}/check`, { method: 'POST' });
  if (r.ok) toast(`${r.status || 'N/A'} — ${r.responseTime}ms`, 'success');
  else toast(`Failed: ${r.error || 'Error'}`, 'error');
  navigate('monitoring');
};

window.showMonitorHistory = async (id) => {
  const el = document.getElementById('monitor-history-' + id);
  if (!el) return;
  if (el.style.display !== 'none') {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  const history = await api(`/uptime/${id}/history?limit=30`);
  el.innerHTML = `<div class="table-wrap" style="max-height:200px;overflow-y:auto"><table>
    <thead><tr><th>Time</th><th>Status</th><th>Response</th><th>Result</th></tr></thead>
    <tbody>${history
      .map(
        (h) => `<tr>
      <td style="font-size:11px">${formatTime(h.timestamp)}</td>
      <td>${h.status || '-'}</td>
      <td>${h.responseTime}ms</td>
      <td><span class="badge ${h.ok ? 'badge-success' : 'badge-error'}">${h.ok ? 'OK' : h.error || 'FAIL'}</span></td>
    </tr>`,
      )
      .join('')}</tbody>
  </table></div>`;
};

window.toggleMonitor = async (id, enabled) => {
  await api(`/uptime/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
  toast(enabled ? 'Enabled' : 'Disabled', 'success');
  navigate('monitoring');
};

window.deleteMonitor = async (id, btnEl) => {
  inlineConfirm(btnEl, 'Delete this monitor?', async () => {
    await api(`/uptime/${id}`, { method: 'DELETE' });
    toast('Deleted', 'success');
    navigate('monitoring');
  });
};

async function renderMonitoringConsolidated(el) {
  el.innerHTML = `<div class="page-header"><h2>Monitoring</h2></div>
    <div id="mon-tabs">${renderTabs(
      'mon-tabs',
      [
        { id: 'overview', label: 'Server' },
        { id: 'channels', label: 'Channels' },
        { id: 'logs', label: 'Logs' },
        { id: 'system', label: 'System Info' },
      ],
      'overview',
    )}</div>`;
  await renderMonitoring(document.getElementById('mon-tabs-overview'));
  await renderChannels(document.getElementById('mon-tabs-channels'));
  await renderLogs(document.getElementById('mon-tabs-logs'));
  await renderSystem(document.getElementById('mon-tabs-system'));
}

// Agents — now rendered by the full function below (renderAgents at line ~3065)

// Chat
async function renderChat(el) {
  const groups = await api('/groups');
  let selectedJid = groups[0]?.jid || '';
  let chatMessages = [];
  let mediaRecorder = null;
  let audioChunks = [];

  el.innerHTML = `
    <div class="page-header"><h2>Chat</h2>
      <select class="search-input" id="chat-group-select" style="max-width:250px">
        ${groups.map((g) => `<option value="${g.jid}">${esc(g.name)} (${g.channel || g.folder})</option>`).join('')}
      </select>
    </div>
    <div class="card" style="padding:0;overflow:hidden;display:flex;flex-direction:column">
      <div class="chat-messages" id="chat-messages-area">
        <div class="loading">Select a group to start chatting</div>
      </div>
      <div class="chat-input">
        <input type="text" id="chat-msg-input" placeholder="Type a message..." autocomplete="off">
        <button class="btn btn-sm btn-ghost" id="chat-voice-btn" title="Record voice" style="font-size:16px;padding:6px 10px">\uD83C\uDF99</button>
        <button class="btn btn-sm btn-primary" id="chat-send-btn">Send</button>
      </div>
    </div>
    <div id="chat-voice-status" style="font-size:11px;color:var(--text-muted);margin-top:4px"></div>`;

  async function loadMessages(jid) {
    if (!jid) return;
    selectedJid = jid;
    const area = document.getElementById('chat-messages-area');
    area.innerHTML = '<div class="loading">Loading</div>';
    try {
      chatMessages = await api(`/messages/${encodeURIComponent(jid)}?limit=50`);
      renderChatMessages();
    } catch {
      area.innerHTML = '<div class="empty">Failed to load messages</div>';
    }
  }

  function renderChatMessages() {
    const area = document.getElementById('chat-messages-area');
    if (!area) return;
    if (chatMessages.length === 0) {
      area.innerHTML =
        '<div class="empty">No messages yet. Send one below.</div>';
      return;
    }
    area.innerHTML = chatMessages
      .slice()
      .reverse()
      .map(
        (m) => `
      <div class="chat-msg ${m.is_bot_message ? 'chat-msg-bot' : 'chat-msg-user'}">
        <div>${esc(m.content)}</div>
        <div class="chat-msg-meta">${esc(m.sender_name)} \u2022 ${formatTime(m.timestamp)}</div>
      </div>`,
      )
      .join('');
    area.scrollTop = area.scrollHeight;
  }

  // Send message
  async function sendMessage() {
    const input = document.getElementById('chat-msg-input');
    const msg = input.value.trim();
    if (!msg || !selectedJid) return;
    input.value = '';
    // Optimistic add
    chatMessages.unshift({
      content: msg,
      sender_name: 'You',
      is_bot_message: false,
      timestamp: new Date().toISOString(),
    });
    renderChatMessages();
    try {
      await api('/chat/send', {
        method: 'POST',
        body: JSON.stringify({ message: msg, targetJid: selectedJid }),
      });
    } catch {
      toast('Failed to send message', 'error');
    }
  }

  document.getElementById('chat-send-btn').onclick = sendMessage;
  document.getElementById('chat-msg-input').onkeydown = (e) => {
    if (e.key === 'Enter') sendMessage();
  };
  document.getElementById('chat-group-select').onchange = (e) =>
    loadMessages(e.target.value);

  // Voice recording
  document.getElementById('chat-voice-btn').onclick = async () => {
    const statusEl = document.getElementById('chat-voice-status');
    const voiceBtn = document.getElementById('chat-voice-btn');
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      voiceBtn.style.color = '';
      statusEl.textContent = 'Processing...';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        try {
          const res = await fetch('/api/chat/voice', {
            method: 'POST',
            body: blob,
            headers: { 'Content-Type': 'audio/webm' },
          });
          const data = await res.json();
          if (data.text) {
            document.getElementById('chat-msg-input').value = data.text;
            statusEl.textContent = 'Transcribed. Press Send or edit.';
          } else {
            statusEl.textContent = 'No transcription returned';
          }
        } catch {
          statusEl.textContent = 'Transcription failed';
        }
      };
      mediaRecorder.start();
      voiceBtn.style.color = 'var(--error)';
      statusEl.textContent = 'Recording... click microphone again to stop';
    } catch {
      statusEl.textContent = 'Microphone access denied';
    }
  };

  // Listen for WebSocket new_message events
  const origHandler = handleWsMessage;
  const chatWsHandler = (msg) => {
    origHandler(msg);
    if (msg.type === 'new_message' && currentPage === 'chat') {
      const m = msg.data;
      if (m.chat_jid === selectedJid) {
        chatMessages.unshift(m);
        renderChatMessages();
      }
    }
  };
  // Patch the global handler while on chat page
  window._chatWsRestore = handleWsMessage;
  handleWsMessage = chatWsHandler;

  // Check for fork prompt from session branching
  const forkPrompt = sessionStorage.getItem('fork_prompt');
  const forkGroup = sessionStorage.getItem('fork_group');
  if (forkPrompt) {
    sessionStorage.removeItem('fork_prompt');
    sessionStorage.removeItem('fork_group');
    // Try to select the matching group
    if (forkGroup) {
      const matchGroup = groups.find(
        (g) => g.folder === forkGroup || g.name === forkGroup,
      );
      if (matchGroup) {
        selectedJid = matchGroup.jid;
        document.getElementById('chat-group-select').value = matchGroup.jid;
      }
    }
    document.getElementById('chat-msg-input').value = forkPrompt.slice(0, 500);
    toast('Session context loaded. Edit and send to continue.', 'info');
  }

  // Load initial messages
  if (selectedJid) loadMessages(selectedJid);
}

// Channels
async function renderChannels(el) {
  const [data, whatsappPairing] = await Promise.all([
    api('/channels'),
    api('/channels/whatsapp/pairing').catch(() => null),
  ]);

  const activeHtml = data.active
    .map(
      (ch) => `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:40px;height:40px;border-radius:var(--radius-sm);background:var(--surface2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:var(--accent)">${esc(ch.icon)}</div>
          <div>
            <div style="font-size:16px;font-weight:600;color:var(--text)">${esc(ch.name)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${esc(ch.description)}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="badge ${ch.status === 'active' ? 'badge-success' : ch.status === 'degraded' ? 'badge-warning' : 'badge-error'}">${esc(ch.status || (ch.connected ? 'active' : 'offline'))}</span>
          <button class="btn btn-sm btn-ghost" onclick="restartChannel('${esc(ch.id)}',this)">Restart</button>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">${esc(ch.healthDetail || '')}${ch.lastActiveAt ? ` · last active ${timeAgo(ch.lastActiveAt)}` : ''}</div>
      <table>
        ${ch.envVars
          .map(
            (key) => `<tr>
          <td style="width:200px;color:var(--text-muted);font-size:12px">${esc(key)}</td>
          <td style="font-family:var(--mono);font-size:12px;color:var(--text)">${ch.config[key] ? esc(ch.config[key]) : '<span class="badge badge-error">Not set</span>'}</td>
        </tr>`,
          )
          .join('')}
      </table>
    </div>`,
    )
    .join('');

  const availableHtml =
    data.available.length === 0
      ? ''
      : `
    <div class="card">
      <div class="card-title">Available Channels</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px">These channels can be added to NanoCrab by adding the channel adapter and required environment variables.</p>
      ${data.available
        .map(
          (ch) => `
        <div style="padding:14px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="display:flex;align-items:center;gap:12px;flex:1">
              <div style="width:36px;height:36px;border-radius:var(--radius-sm);background:var(--surface2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:var(--text-muted)">${esc(ch.icon)}</div>
              <div>
                <div style="font-size:14px;font-weight:600;color:var(--text)">${esc(ch.name)}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${esc(ch.description)}</div>
              </div>
            </div>
            <span class="badge badge-muted">Not installed</span>
          </div>
          <div style="margin-top:8px;padding:10px;background:var(--surface2);border-radius:var(--radius-sm);font-size:12px">
            <div style="color:var(--text-muted);margin-bottom:4px">Required env vars: ${ch.envVars.map((k) => `<code style="color:var(--accent)">${esc(k)}</code>`).join(', ')}</div>
            <div style="color:var(--text-muted)">Install: <code style="color:var(--accent)">${esc(ch.skill)}</code></div>
          </div>
        </div>`,
        )
        .join('')}
    </div>`;

  const pairingState = whatsappPairing?.state || 'not_configured';
  const pairingBadge =
    pairingState === 'connected' || pairingState === 'paired'
      ? 'badge-success'
      : pairingState === 'error' || pairingState === 'expired_qr'
        ? 'badge-error'
        : pairingState === 'not_configured'
          ? 'badge-muted'
          : 'badge-warning';
  const whatsappPairingHtml = whatsappPairing
    ? `<div class="card" style="margin-bottom:16px">
      <div class="card-title">WhatsApp Pairing <span class="badge ${pairingBadge}">${esc(pairingState)}</span></div>
      <div style="display:grid;grid-template-columns:minmax(240px,340px) 1fr;gap:18px;align-items:start">
        <div style="min-height:240px;display:flex;align-items:center;justify-content:center;background:var(--surface2);border-radius:var(--radius-sm);padding:14px">
          ${
            whatsappPairing.qrCodeDataUrl
              ? `<img src="${esc(whatsappPairing.qrCodeDataUrl)}" alt="WhatsApp pairing QR code" style="width:100%;max-width:320px;border-radius:8px;background:#fff;padding:8px">`
              : whatsappPairing.pairingCode
                ? `<div style="text-align:center"><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Pairing Code</div><div style="font-family:var(--mono);font-size:28px;font-weight:700;color:var(--text);letter-spacing:2px">${esc(whatsappPairing.pairingCode)}</div></div>`
                : `<div style="text-align:center;color:var(--text-muted);font-size:13px">${pairingState === 'connected' ? 'WhatsApp is connected' : pairingState === 'paired' ? 'WhatsApp is paired; restart or reconnect the channel if needed' : pairingState === 'expired_qr' ? 'QR expired. Refresh to request a new code.' : 'Start pairing to show a live QR code here.'}</div>`
          }
        </div>
        <div>
          <table style="margin-bottom:12px">
            <tr><td>State</td><td style="color:var(--text)">${esc(pairingState)}</td></tr>
            <tr><td>Method</td><td style="color:var(--text)">${esc(whatsappPairing.method || 'none')}</td></tr>
            <tr><td>Started</td><td style="color:var(--text)">${whatsappPairing.startedAt ? formatTime(whatsappPairing.startedAt) : 'not running'}</td></tr>
            <tr><td>QR expires</td><td style="color:var(--text)">${whatsappPairing.qrExpiresAt ? formatTime(whatsappPairing.qrExpiresAt) : 'n/a'}</td></tr>
            <tr><td>Phone</td><td style="color:var(--text)">${esc(whatsappPairing.phone || 'not paired')}</td></tr>
            ${whatsappPairing.error ? `<tr><td>Error</td><td style="color:var(--error)">${esc(whatsappPairing.error)}</td></tr>` : ''}
          </table>
          <div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:10px">
            <input class="search-input" id="wa-pairing-phone" placeholder="Phone for pairing code, e.g. 4712345678">
            <button class="btn btn-sm btn-ghost" onclick="startWhatsAppPairing('pairing-code')">Code</button>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm btn-primary" onclick="startWhatsAppPairing('qr')">Start QR</button>
            <button class="btn btn-sm btn-ghost" onclick="startWhatsAppPairing('qr')">Refresh QR</button>
            <button class="btn btn-sm btn-ghost" onclick="cancelWhatsAppPairing()">Cancel</button>
            <button class="btn btn-sm btn-danger" onclick="resetWhatsAppPairing(this)">Reset Session</button>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:10px">Only QR images, pairing codes, and minimal state are exposed here. Session files remain on the server in <code>store/auth</code>.</div>
        </div>
      </div>
    </div>`
    : '';

  el.innerHTML = `
    <div class="page-header"><h2>Channels</h2></div>
    ${whatsappPairingHtml}
    <div class="grid grid-2">${activeHtml}</div>
    ${availableHtml}`;
}

window.startWhatsAppPairing = async function (method) {
  const phone = document.getElementById('wa-pairing-phone')?.value || '';
  try {
    const payload = { method };
    if (method === 'pairing-code') payload.phone = phone;
    await api('/channels/whatsapp/pairing/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    toast(
      method === 'pairing-code'
        ? 'Pairing code requested'
        : 'QR pairing started',
      'success',
    );
    navigate('monitoring');
  } catch (e) {
    toast('WhatsApp pairing failed: ' + e.message, 'error');
  }
};

window.cancelWhatsAppPairing = async function () {
  await api('/channels/whatsapp/pairing/cancel', { method: 'POST' });
  toast('WhatsApp pairing cancelled', 'info');
  navigate('monitoring');
};

window.resetWhatsAppPairing = function (btn) {
  inlineConfirm(btn, 'Reset?', async () => {
    await api('/channels/whatsapp/pairing/reset', { method: 'POST' });
    toast('WhatsApp session reset', 'success');
    navigate('monitoring');
  });
};

// Dashboard, agents, settings, coding, plugins, marketplace, and help.
// are loaded from pages/*.js

// Groups
async function renderGroups(el) {
  const [groups, providerInfo] = await Promise.all([
    api('/groups'),
    api('/system/provider').catch(() => ({ provider: 'claude' })),
  ]);
  const providerModels = providerInfo.models || {
    claude: [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
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
  const providerDefinitions = providerInfo.definitions || {
    claude: { id: 'claude', name: 'Claude' },
    codex: { id: 'codex', name: 'Codex' },
    opencode: { id: 'opencode', name: 'OpenCode' },
    ollama: { id: 'ollama', name: 'Ollama' },
    openrouter: { id: 'openrouter', name: 'OpenRouter' },
    google: { id: 'google', name: 'Google' },
  };
  el.innerHTML = `
    <div class="page-header"><h2>Registered Groups</h2></div>
    <div class="card table-wrap">
      <table><thead><tr><th>Name</th><th>JID</th><th>Channel</th><th>Status</th><th>Trigger</th><th>Provider</th><th>Model</th><th>MCP Access</th><th>Restrictions</th><th>Role</th></tr></thead>
      <tbody>${groups
        .map((g) => {
          const selectedProvider = g.containerConfig?.provider || '';
          const effectiveProvider =
            selectedProvider || providerInfo.provider || 'claude';
          const models =
            providerModels[effectiveProvider] || providerModels.claude;
          const selectedModel =
            g.containerConfig?.model ||
            g.containerConfig?.models?.[effectiveProvider] ||
            'default';
          return `<tr>
        <td><strong style="color:var(--text)">${esc(g.name)}</strong><div style="font-size:11px;color:var(--text-muted)">${esc(g.folder)}</div></td>
        <td style="font-family:var(--mono);font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(g.jid)}</td>
        <td>${g.channel ? `<span class="badge badge-accent">${g.channel}</span>` : '-'}</td>
        <td>
          <span class="badge ${g.enabled === false ? 'badge-muted' : 'badge-success'}">${g.enabled === false ? 'Disabled' : 'Enabled'}</span>
          ${g.enabled !== false ? `<button class="btn btn-sm btn-ghost" style="padding:2px 6px;font-size:10px;margin-left:4px" onclick="setGroupEnabled('${esc(g.jid)}',false)">Disable</button>` : `<button class="btn btn-sm btn-ghost" style="padding:2px 6px;font-size:10px;margin-left:4px" onclick="setGroupEnabled('${esc(g.jid)}',true)">Enable</button>`}
        </td>
        <td><code style="color:var(--accent)">${esc(g.trigger)}</code>${g.requiresTrigger === false ? ' <span class="badge badge-muted">auto</span>' : ''}</td>
        <td><select class="search-input" style="max-width:130px;padding:4px 8px;font-size:11px" onchange="setGroupProviderRuntime('${esc(g.jid)}',this.value)">
          <option value="" ${!selectedProvider ? 'selected' : ''}>inherit</option>
          ${Object.values(providerDefinitions)
            .filter((p) => p && p.selectable !== false)
            .map(
              (p) =>
                `<option value="${esc(p.id)}" ${selectedProvider === p.id ? 'selected' : ''}>${esc(p.name || p.id)}</option>`,
            )
            .join('')}
        </select></td>
        <td><select class="search-input" style="max-width:160px;padding:4px 8px;font-size:11px" onchange="setGroupModel('${esc(g.jid)}',this.value)">
          <option value="default" ${selectedModel === 'default' ? 'selected' : ''}>default</option>
          ${models.map((m) => `<option value="${esc(m)}" ${selectedModel === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
        </select></td>
        <td>${!g.containerConfig?.allowedMcpServers ? '<span class="badge badge-success">All</span>' : g.containerConfig.allowedMcpServers.length === 0 ? '<span class="badge badge-warning">None</span>' : g.containerConfig.allowedMcpServers.map((s) => `<span class="badge badge-info">${s}</span>`).join(' ')}</td>
        <td>${g.containerConfig?.restrictions ? `<span class="badge badge-warning" title="${esc(g.containerConfig.restrictions)}">Active</span>` : '<span class="badge badge-muted">None</span>'} <button class="btn btn-sm btn-ghost" style="padding:2px 6px;font-size:10px" onclick="editRestrictions('${esc(g.jid)}')">Edit</button></td>
        <td>
          ${g.isPrimary ? '<span class="badge badge-accent">Primary</span> ' : ''}
          ${g.isMain ? '<span class="badge badge-success">Main</span>' : '<span class="badge badge-muted">User</span>'}
          ${g.isMain && g.enabled !== false && !g.isPrimary ? `<button class="btn btn-sm btn-ghost" style="padding:2px 6px;font-size:10px;margin-left:4px" onclick="setPrimaryGroup('${esc(g.jid)}')">Set Primary</button>` : ''}
        </td>
      </tr>`;
        })
        .join('')}</tbody></table>
    </div>
    <div id="restrictions-editor"></div>`;
}

window.setGroupProviderRuntime = async (jid, provider) => {
  try {
    const groups = await api('/groups');
    const group = groups.find((g) => g.jid === jid);
    const existing = group?.containerConfig || {};
    const currentProvider = provider || undefined;
    const rememberedModel = currentProvider
      ? existing.models?.[currentProvider]
      : undefined;
    const containerConfig = {
      ...existing,
      provider: currentProvider,
      model: rememberedModel,
    };
    if (!containerConfig.provider) delete containerConfig.provider;
    if (!containerConfig.model) delete containerConfig.model;
    const r = await api(`/groups/${encodeURIComponent(jid)}`, {
      method: 'PUT',
      body: JSON.stringify({ containerConfig }),
    });
    if (r.ok) {
      toast('Provider updated', 'success');
      navigate('groups');
    } else toast(r.error || 'Failed', 'error');
  } catch {
    toast('Failed to update provider', 'error');
  }
};

window.setGroupEnabled = async (jid, enabled) => {
  try {
    const groups = await api('/groups');
    const group = groups.find((g) => g.jid === jid);
    if (!group) {
      toast('Group not found', 'error');
      return;
    }
    if (!enabled && group.isPrimary) {
      toast('Choose another primary bot before disabling this one', 'warning');
      return;
    }
    const r = await api(`/groups/${encodeURIComponent(jid)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
    if (r.ok) {
      toast(enabled ? 'Bot agent enabled' : 'Bot agent disabled', 'success');
      navigate('groups');
    } else toast(r.error || 'Failed', 'error');
  } catch {
    toast('Failed to update bot agent', 'error');
  }
};

window.setPrimaryGroup = async (jid) => {
  try {
    const r = await api(`/groups/${encodeURIComponent(jid)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: true, isPrimary: true }),
    });
    if (r.ok) {
      toast('Primary bot selected', 'success');
      navigate('groups');
    } else toast(r.error || 'Failed', 'error');
  } catch {
    toast('Failed to set primary bot', 'error');
  }
};

window.setGroupModel = async (jid, model) => {
  try {
    const groups = await api('/groups');
    const providerInfo = await api('/system/provider').catch(() => ({
      provider: 'claude',
    }));
    const group = groups.find((g) => g.jid === jid);
    const existing = group?.containerConfig || {};
    const effectiveProvider =
      existing.provider || providerInfo.provider || 'claude';
    const modelsByProvider = { ...(existing.models || {}) };
    if (model === 'default') delete modelsByProvider[effectiveProvider];
    else modelsByProvider[effectiveProvider] = model;
    const containerConfig = {
      ...existing,
      models: modelsByProvider,
      model: model === 'default' ? undefined : model,
    };
    if (Object.keys(containerConfig.models).length === 0)
      delete containerConfig.models;
    if (!containerConfig.model) delete containerConfig.model;
    const r = await api(`/groups/${encodeURIComponent(jid)}`, {
      method: 'PUT',
      body: JSON.stringify({ containerConfig }),
    });
    if (r.ok) toast('Model updated', 'success');
    else toast(r.error || 'Failed', 'error');
  } catch {
    toast('Failed to update model', 'error');
  }
};

window.editRestrictions = async (jid) => {
  const groups = await api('/groups');
  const group = groups.find((g) => g.jid === jid);
  if (!group) {
    toast('Group not found', 'error');
    return;
  }
  const editor = document.getElementById('restrictions-editor');
  if (!editor) return;
  editor.innerHTML = `
    <div class="card" style="margin-top:16px;border-color:var(--warning)">
      <div class="card-title">Edit Restrictions: ${esc(group.name)}</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">These restrictions are appended to the group's agent instructions as soft instructions. The agent will follow them as part of its system prompt.</p>
      <textarea id="restrictions-textarea" style="width:100%;min-height:120px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical;line-height:1.6" placeholder="Example: Never run rm -rf, git push --force, or DROP TABLE commands without asking first">${esc(group.containerConfig?.restrictions || '')}</textarea>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
        <button class="btn btn-primary btn-sm" onclick="saveRestrictions('${esc(jid)}')">Save</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('restrictions-editor').innerHTML=''">Cancel</button>
        ${group.containerConfig?.restrictions ? `<button class="btn btn-danger btn-sm" onclick="clearRestrictions('${esc(jid)}')">Clear Restrictions</button>` : ''}
        <span id="restrictions-msg" style="font-size:12px"></span>
      </div>
    </div>`;
  editor.scrollIntoView({ behavior: 'smooth' });
};

window.saveRestrictions = async (jid) => {
  const text = document.getElementById('restrictions-textarea').value.trim();
  try {
    const groups = await api('/groups');
    const group = groups.find((g) => g.jid === jid);
    const existing = group?.containerConfig || {};
    const containerConfig = { ...existing, restrictions: text || undefined };
    if (!containerConfig.restrictions) delete containerConfig.restrictions;
    const r = await api(`/groups/${encodeURIComponent(jid)}`, {
      method: 'PUT',
      body: JSON.stringify({ containerConfig }),
    });
    if (r.ok) {
      toast('Restrictions saved', 'success');
      navigate('groups');
    } else toast(r.error || 'Failed', 'error');
  } catch {
    toast('Failed to save restrictions', 'error');
  }
};

window.clearRestrictions = async (jid) => {
  try {
    const groups = await api('/groups');
    const group = groups.find((g) => g.jid === jid);
    const existing = group?.containerConfig || {};
    const containerConfig = { ...existing };
    delete containerConfig.restrictions;
    const r = await api(`/groups/${encodeURIComponent(jid)}`, {
      method: 'PUT',
      body: JSON.stringify({ containerConfig }),
    });
    if (r.ok) {
      toast('Restrictions cleared', 'success');
      navigate('groups');
    } else toast(r.error || 'Failed', 'error');
  } catch {
    toast('Failed to clear restrictions', 'error');
  }
};

// Messages
async function renderMessages(el) {
  let messages = await api('/messages/recent?limit=50');
  const groups = await api('/groups');
  let pinnedMessages = [];
  try {
    pinnedMessages = await api('/messages/pinned');
  } catch {}

  el.innerHTML = `
    <div class="page-header">
      <h2>Messages</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-sm btn-ghost" onclick="window.print()">Export</button>
        <input class="search-input" id="msg-search" placeholder="Search messages...">
        <select class="search-input" id="msg-filter" style="max-width:180px">
          <option value="">All chats</option>
          ${groups.map((g) => `<option value="${g.jid}">${esc(g.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    ${
      pinnedMessages.length > 0
        ? `<div class="card" style="border-color:var(--accent)">
      <div class="card-title">\u25C6 Pinned Messages</div>
      ${pinnedMessages.map((m) => `<div class="message ${m.is_bot_message ? 'message-bot' : ''}"><div class="message-meta"><span class="message-sender">${esc(m.sender_name)}</span><span>${m.chat_name || m.chat_jid}</span><span>${formatTime(m.timestamp)}</span><span style="cursor:pointer;font-size:11px;color:var(--accent)" onclick="unpinMessage('${esc(m.id)}','${esc(m.chat_jid)}')" title="Unpin">\u2715</span></div><div class="message-content">${esc(m.content)}</div></div>`).join('')}
    </div>`
        : ''
    }
    <div class="card" id="msg-list"></div>
    <div style="margin-top:8px;text-align:right" id="msg-export"></div>`;

  renderMsgList(messages);

  let searchTimeout;
  const doSearch = async () => {
    const q = document.getElementById('msg-search').value.trim();
    const jid = document.getElementById('msg-filter').value;
    if (jid) {
      messages = await api(`/messages/${encodeURIComponent(jid)}?limit=100`);
      document.getElementById('msg-export').innerHTML =
        `<a class="btn btn-sm btn-ghost" href="/api/messages/export/${encodeURIComponent(jid)}?format=csv" download>Export CSV</a> <a class="btn btn-sm btn-ghost" href="/api/messages/export/${encodeURIComponent(jid)}?format=json" download>Export JSON</a>`;
    } else if (q.length >= 2) {
      messages = await api(`/messages/search?q=${encodeURIComponent(q)}`);
      document.getElementById('msg-export').innerHTML = '';
    } else {
      messages = await api('/messages/recent?limit=50');
      document.getElementById('msg-export').innerHTML = '';
    }
    renderMsgList(messages);
  };
  document.getElementById('msg-search').oninput = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(doSearch, 300);
  };
  document.getElementById('msg-filter').onchange = doSearch;

  function renderMsgList(msgs) {
    document.getElementById('msg-list').innerHTML =
      msgs.length === 0
        ? '<div class="empty">No messages found</div>'
        : msgs
            .map(
              (m) =>
                `<div class="message ${m.is_bot_message ? 'message-bot' : ''}"><div class="message-meta"><span class="message-sender">${esc(m.sender_name)}</span><span>${m.chat_name || m.chat_jid}</span><span>${formatTime(m.timestamp)}</span>${m.channel ? `<span class="badge badge-muted">${m.channel}</span>` : ''}<span style="cursor:pointer;opacity:0.5;font-size:11px" onclick="pinMessage('${esc(m.id)}','${esc(m.chat_jid)}',true)" title="Pin message">\u25C6</span></div><div class="message-content">${esc(m.content)}</div></div>`,
            )
            .join('');
  }
}

// Tasks
async function renderTasks(el) {
  const tasks = await api('/tasks');
  const groups = await api('/groups');

  const TASK_TEMPLATES = [
    {
      name: 'Morning Briefing',
      icon: '\u2600',
      desc: 'Daily summary at 8am',
      prompt:
        'Check GitHub notifications, unread emails, calendar events, and recent task results. Send a concise morning briefing.',
      type: 'cron',
      value: '0 8 * * 1-5',
      mode: 'isolated',
    },
    {
      name: 'PR Review',
      icon: '\u2714',
      desc: 'Check open PRs twice daily',
      prompt:
        'Check for open pull requests. Summarize changes, flag issues, and recommend actions.',
      type: 'cron',
      value: '0 10,15 * * 1-5',
      mode: 'isolated',
    },
    {
      name: 'Test Runner',
      icon: '\u2699',
      desc: 'Run tests daily, alert on failures',
      prompt: 'Tests failed. Analyze the output and suggest fixes.',
      type: 'cron',
      value: '0 6 * * *',
      mode: 'isolated',
      script:
        'cd /workspace/extra/* 2>/dev/null && npm test 2>&1 | tail -50\nif [ $? -ne 0 ]; then\n  echo \'{"wakeAgent":true,"data":{"testsFailed":true}}\'\nelse\n  echo \'{"wakeAgent":false}\'\nfi',
    },
    {
      name: 'Dependency Check',
      icon: '\u26A0',
      desc: 'Weekly scan for outdated deps',
      prompt:
        'Check repositories for outdated dependencies and security vulnerabilities.',
      type: 'cron',
      value: '0 7 * * 1',
      mode: 'isolated',
    },
  ];

  el.innerHTML = `
    <div class="page-header"><h2>Scheduled Tasks</h2><div style="display:flex;gap:8px"><button class="btn btn-sm btn-ghost" onclick="window.print()">Export</button><button class="btn btn-primary btn-sm" onclick="document.getElementById('new-task-form').style.display=document.getElementById('new-task-form').style.display==='none'?'block':'none'">New Task</button></div></div>
    <div class="card">
      <div class="card-title">Templates</div>
      <div class="grid grid-4">
        ${TASK_TEMPLATES.map(
          (t, i) => `
          <div class="card" style="cursor:pointer;margin-bottom:0;transition:border-color 0.2s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'" onclick="applyTaskTemplate(${i})">
            <div style="font-size:24px;margin-bottom:8px">${t.icon}</div>
            <div style="font-weight:600;color:var(--text);margin-bottom:4px">${esc(t.name)}</div>
            <div style="font-size:12px;color:var(--text-muted)">${esc(t.desc)}</div>
          </div>`,
        ).join('')}
      </div>
    </div>
    <div class="card" id="new-task-form" style="display:none">
      <div class="card-title">Create Task</div>
      <form id="task-create-form">
        <div class="grid grid-2">
          <div class="form-group"><label>Group</label><select id="task-group">${groups.map((g) => `<option value="${g.folder}|${g.jid}">${esc(g.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Schedule Type</label><select id="task-type"><option value="cron">Cron</option><option value="interval">Interval</option><option value="once">Once</option></select></div>
        </div>
        <div class="form-group"><label>Schedule Value (cron expression or interval like "30m", "2h")</label><input id="task-schedule" placeholder="0 9 * * *"></div>
        <div class="form-group"><label>Prompt</label><textarea id="task-prompt" style="width:100%;min-height:80px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:13px;resize:vertical" placeholder="What should the bot do?"></textarea></div>
        <div class="form-group"><label>Script (optional — runs before the agent, stdout is passed as context)</label><textarea id="task-script" style="width:100%;min-height:60px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical" placeholder="#!/bin/bash\n# Script output is passed to the agent"></textarea></div>
        <div class="form-group">
          <label>Context Mode</label>
          <div style="display:flex;gap:16px;margin-top:4px">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary);cursor:pointer"><input type="radio" name="task-context-mode" value="isolated" checked> Isolated (new conversation)</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary);cursor:pointer"><input type="radio" name="task-context-mode" value="continue"> Continue (resume last conversation)</label>
          </div>
        </div>
        <button type="submit" class="btn btn-primary">Create Task</button>
      </form>
    </div>
    ${
      tasks.length === 0
        ? '<div class="card empty">No scheduled tasks</div>'
        : `<div class="card table-wrap"><table>
    <thead><tr><th>Prompt</th><th>Group</th><th>Schedule</th><th>Status</th><th>Last Run</th><th>Next Run</th><th>Actions</th></tr></thead>
    <tbody>${tasks
      .map(
        (t) => `<tr>
      <td style="max-width:300px;color:var(--text)">${esc(truncate(t.prompt, 100))}</td>
      <td><span class="badge badge-muted">${esc(t.group_folder)}</span></td>
      <td><code>${t.schedule_type}: ${esc(t.schedule_value)}</code></td>
      <td><span class="badge ${t.status === 'active' ? 'badge-success' : t.status === 'paused' ? 'badge-warning' : 'badge-muted'}">${t.status}</span></td>
      <td>${t.last_run ? formatTime(t.last_run) : '-'}</td>
      <td>${t.next_run ? formatTime(t.next_run) : '-'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-ghost" onclick="editTask('${t.id}')">Edit</button>
        ${t.status === 'active' ? `<button class="btn btn-sm btn-ghost" onclick="taskAction('${t.id}','pause',this)">Pause</button>` : ''}
        ${t.status === 'paused' ? `<button class="btn btn-sm btn-success" onclick="taskAction('${t.id}','resume',this)">Resume</button>` : ''}
        <button class="btn btn-sm btn-danger" onclick="taskAction('${t.id}','delete',this)">Delete</button>
      </td>
    </tr>`,
      )
      .join('')}</tbody></table></div>`
    }
    <div id="task-editor"></div>`;

  window._taskTemplates = TASK_TEMPLATES;

  const form = document.getElementById('task-create-form');
  if (form)
    form.onsubmit = async (e) => {
      e.preventDefault();
      const [groupFolder, chatJid] = document
        .getElementById('task-group')
        .value.split('|');
      const contextMode =
        document.querySelector('input[name="task-context-mode"]:checked')
          ?.value || 'isolated';
      const script = document.getElementById('task-script').value;
      const r = await api('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          groupFolder,
          chatJid,
          prompt: document.getElementById('task-prompt').value,
          scheduleType: document.getElementById('task-type').value,
          scheduleValue: document.getElementById('task-schedule').value,
          script: script || undefined,
          contextMode,
        }),
      });
      if (r.ok) navigate('tasks');
      else toast(r.error || 'Failed', 'error');
    };
}

window.applyTaskTemplate = (idx) => {
  const t = window._taskTemplates?.[idx];
  if (!t) return;
  const formEl = document.getElementById('new-task-form');
  if (formEl) formEl.style.display = 'block';
  const typeEl = document.getElementById('task-type');
  if (typeEl) typeEl.value = t.type;
  const schedEl = document.getElementById('task-schedule');
  if (schedEl) schedEl.value = t.value;
  const promptEl = document.getElementById('task-prompt');
  if (promptEl) promptEl.value = t.prompt;
  const scriptEl = document.getElementById('task-script');
  if (scriptEl) scriptEl.value = t.script || '';
  const modeRadio = document.querySelector(
    `input[name="task-context-mode"][value="${t.mode || 'isolated'}"]`,
  );
  if (modeRadio) modeRadio.checked = true;
  formEl?.scrollIntoView({ behavior: 'smooth' });
};

// Missions
async function renderMissions(el) {
  const data = await api('/runbooks');
  const groups = await api('/groups').catch(() => []);
  const runbooks = data.runbooks || [];
  const progress = (runbook) => {
    const total = runbook.steps.length || 1;
    const done = runbook.steps.filter((step) => step.status === 'done').length;
    const blocked = runbook.steps.filter(
      (step) => step.status === 'blocked',
    ).length;
    return { done, blocked, percent: Math.round((done / total) * 100) };
  };
  const statusBadge = (status) =>
    status === 'completed'
      ? 'badge-success'
      : status === 'blocked'
        ? 'badge-warning'
        : status === 'active'
          ? 'badge-info'
          : 'badge-muted';

  el.innerHTML = `
    <div class="page-header"><h2>Missions</h2><button class="btn btn-primary btn-sm" onclick="document.getElementById('new-runbook-form').style.display=document.getElementById('new-runbook-form').style.display==='none'?'block':'none'">New Runbook</button></div>
    <div class="grid grid-4">
      <div class="card"><div style="font-size:11px;color:var(--text-muted)">Active</div><div style="font-size:22px;font-weight:600">${runbooks.filter((r) => r.status === 'active').length}</div></div>
      <div class="card"><div style="font-size:11px;color:var(--text-muted)">Blocked</div><div style="font-size:22px;font-weight:600;color:var(--warning)">${runbooks.filter((r) => r.status === 'blocked').length}</div></div>
      <div class="card"><div style="font-size:11px;color:var(--text-muted)">Completed</div><div style="font-size:22px;font-weight:600;color:var(--success)">${runbooks.filter((r) => r.status === 'completed').length}</div></div>
      <div class="card"><div style="font-size:11px;color:var(--text-muted)">Open Steps</div><div style="font-size:22px;font-weight:600">${runbooks.reduce((sum, r) => sum + r.steps.filter((s) => !['done', 'skipped'].includes(s.status)).length, 0)}</div></div>
    </div>
    <div class="card" id="new-runbook-form" style="display:none">
      <div class="card-title">Create Runbook</div>
      <form id="runbook-create-form">
        <div class="grid grid-2">
          <div class="form-group"><label>Title</label><input id="runbook-title" placeholder="Release readiness"></div>
          <div class="form-group"><label>Group</label><select id="runbook-group"><option value="">Unassigned</option>${groups.map((g) => `<option value="${esc(g.folder)}">${esc(g.name)}</option>`).join('')}</select></div>
        </div>
        <div class="grid grid-2">
          <div class="form-group"><label>Owner</label><input id="runbook-owner" placeholder="operator"></div>
          <div class="form-group"><label>Due</label><input id="runbook-due" type="datetime-local"></div>
        </div>
        <div class="form-group"><label>Mission</label><textarea id="runbook-mission" style="width:100%;min-height:64px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:13px;resize:vertical" placeholder="What outcome should this runbook drive?"></textarea></div>
        <div class="form-group"><label>Steps</label><textarea id="runbook-steps" style="width:100%;min-height:92px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:13px;resize:vertical" placeholder="One step per line"></textarea></div>
        <button type="submit" class="btn btn-primary">Create Runbook</button>
      </form>
    </div>
    <div class="card">
      <div class="card-title">Recurring Operations Reminder</div>
      <form id="operation-reminder-form">
        <div class="grid grid-2">
          <div class="form-group"><label>Title</label><input id="operation-reminder-title" placeholder="Rally check"></div>
          <div class="form-group"><label>Group</label><select id="operation-reminder-group">${groups.map((g) => `<option value="${esc(g.folder)}">${esc(g.name)}</option>`).join('')}</select></div>
        </div>
        <div class="form-group"><label>Order</label><textarea id="operation-reminder-order" style="width:100%;min-height:70px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:13px;resize:vertical" placeholder="What should be repeated?"></textarea></div>
        <div class="grid grid-3">
          <div class="form-group"><label>Schedule Type</label><select id="operation-reminder-type"><option value="cron">Cron</option><option value="interval">Interval</option><option value="once">Once</option></select></div>
          <div class="form-group"><label>Schedule Value</label><input id="operation-reminder-schedule" placeholder="0 8 * * *"></div>
          <div class="form-group"><label>Audience</label><input id="operation-reminder-audience" placeholder="Operations team"></div>
        </div>
        <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text-muted);margin-bottom:12px"><input type="checkbox" id="operation-reminder-confirm"> ask for confirmation</label>
        <button type="submit" class="btn btn-primary btn-sm">Create Reminder</button>
      </form>
    </div>
    ${
      runbooks.length === 0
        ? '<div class="card empty">No missions yet</div>'
        : `<div style="display:grid;gap:12px">${runbooks
            .map((runbook) => {
              const p = progress(runbook);
              return `<div class="card">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
                  <div>
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                      <h3 style="font-size:16px;margin:0;color:var(--text)">${esc(runbook.title)}</h3>
                      <span class="badge ${statusBadge(runbook.status)}">${esc(runbook.status)}</span>
                      ${runbook.groupFolder ? `<span class="badge badge-muted">${esc(runbook.groupFolder)}</span>` : ''}
                    </div>
                    <p style="margin:6px 0 0;color:var(--text-secondary);font-size:13px">${esc(runbook.mission)}</p>
                  </div>
                  <div style="text-align:right;font-size:12px;color:var(--text-muted)">
                    <div>${esc(runbook.owner)}</div>
                    <div>${runbook.dueAt ? formatTime(runbook.dueAt) : 'No due date'}</div>
                  </div>
                </div>
                <div style="margin:12px 0;height:8px;background:var(--surface2);border-radius:999px;overflow:hidden"><div style="height:100%;width:${p.percent}%;background:${p.blocked ? 'var(--warning)' : 'var(--success)'}"></div></div>
                <div style="display:grid;gap:8px">
                  ${runbook.steps
                    .map(
                      (
                        step,
                      ) => `<div style="display:grid;grid-template-columns: minmax(0,1fr) auto;gap:10px;align-items:center;border-top:1px solid var(--border);padding-top:8px">
                        <div>
                          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                            <strong style="font-size:13px;color:var(--text)">${esc(step.title)}</strong>
                            <span class="badge ${statusBadge(step.status)}">${esc(step.status)}</span>
                          </div>
                          ${step.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px">${esc(step.notes)}</div>` : ''}
                        </div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                          <button class="btn btn-sm btn-ghost" onclick="updateRunbookStep('${runbook.id}','${step.id}','in_progress')">Start</button>
                          <button class="btn btn-sm btn-success" onclick="updateRunbookStep('${runbook.id}','${step.id}','done')">Done</button>
                          <button class="btn btn-sm btn-ghost" onclick="updateRunbookStep('${runbook.id}','${step.id}','blocked')">Block</button>
                          <button class="btn btn-sm btn-ghost" onclick="updateRunbookStep('${runbook.id}','${step.id}','skipped')">Skip</button>
                        </div>
                      </div>`,
                    )
                    .join('')}
                </div>
                <div style="margin-top:12px;text-align:right"><button class="btn btn-sm btn-ghost" onclick="archiveRunbook('${runbook.id}')">Archive</button></div>
              </div>`;
            })
            .join('')}</div>`
    }`;

  const form = document.getElementById('runbook-create-form');
  if (form)
    form.onsubmit = async (e) => {
      e.preventDefault();
      const steps = document
        .getElementById('runbook-steps')
        .value.split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const dueValue = document.getElementById('runbook-due').value;
      const r = await api('/runbooks', {
        method: 'POST',
        body: JSON.stringify({
          title: document.getElementById('runbook-title').value,
          mission: document.getElementById('runbook-mission').value,
          owner: document.getElementById('runbook-owner').value,
          groupFolder: document.getElementById('runbook-group').value,
          dueAt: dueValue ? new Date(dueValue).toISOString() : undefined,
          steps,
        }),
      });
      if (r.ok) navigate('missions');
      else toast(r.error || 'Failed to create runbook', 'error');
    };
  const reminderForm = document.getElementById('operation-reminder-form');
  if (reminderForm)
    reminderForm.onsubmit = async (e) => {
      e.preventDefault();
      const r = await api('/operations/reminders', {
        method: 'POST',
        body: JSON.stringify({
          groupFolder: document.getElementById('operation-reminder-group')
            .value,
          title: document.getElementById('operation-reminder-title').value,
          order: document.getElementById('operation-reminder-order').value,
          scheduleType: document.getElementById('operation-reminder-type')
            .value,
          scheduleValue: document.getElementById('operation-reminder-schedule')
            .value,
          audience: document.getElementById('operation-reminder-audience')
            .value,
          requireConfirmation: document.getElementById(
            'operation-reminder-confirm',
          ).checked,
        }),
      });
      if (r.ok) {
        toast('Reminder created', 'success');
        navigate('tasks');
      } else toast(r.error || 'Failed to create reminder', 'error');
    };
}

window.updateRunbookStep = async (runbookId, stepId, status) => {
  const notes =
    status === 'blocked' ? prompt('Blocker note?', '') || undefined : undefined;
  const r = await api(`/runbooks/${runbookId}/steps/${stepId}`, {
    method: 'POST',
    body: JSON.stringify({ status, notes }),
  });
  if (r.ok) navigate('missions');
  else toast(r.error || 'Failed to update step', 'error');
};

window.archiveRunbook = async (runbookId) => {
  const r = await api(`/runbooks/${runbookId}/archive`, { method: 'POST' });
  if (r.ok) navigate('missions');
  else toast(r.error || 'Failed to archive runbook', 'error');
};

// Credentials
async function renderCredentials(el) {
  const data = await api('/credentials');

  el.innerHTML = `
    <div class="page-header"><h2>Credentials</h2></div>
    <div class="card">
      <div class="card-title">API Keys & Credentials</div>
      <table><thead><tr><th>Key</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${data.credentials
        .map(
          (c) => `<tr>
        <td><span style="color:var(--text);font-weight:500">${esc(c.label)}</span><div style="font-family:var(--mono);font-size:10px;color:var(--text-muted)">${c.key}</div></td>
        <td><span class="badge ${c.isSet ? 'badge-success' : 'badge-error'}">${c.isSet ? 'Set' : 'Not set'}</span></td>
        <td style="white-space:nowrap"><button class="btn btn-sm btn-ghost" onclick="editCredential('${c.key}','${esc(c.label)}',this)">Edit</button>${c.isSet ? ` <button class="btn btn-sm btn-danger" onclick="deleteCredential('${c.key}',this)">Remove</button>` : ''}</td>
      </tr>`,
        )
        .join('')}</tbody></table>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
        <div class="card-title">Add Custom Key</div>
        <form id="add-cred-form" style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
          <div class="form-group" style="flex:1;min-width:120px;margin:0"><label>Key name</label><input id="cred-new-key" placeholder="MY_API_KEY"></div>
          <div class="form-group" style="flex:2;min-width:200px;margin:0"><label>Value</label><input id="cred-new-val" placeholder="Value" type="password"></div>
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </form>
      </div>
    </div>`;
  document.getElementById('add-cred-form').onsubmit = async (e) => {
    e.preventDefault();
    const k = document.getElementById('cred-new-key').value,
      v = document.getElementById('cred-new-val').value;
    if (!k || !v) return;
    await api('/credentials', {
      method: 'POST',
      body: JSON.stringify({ key: k, value: v }),
    });
    renderCredentials(el);
  };
}

window.editCredential = async (key, label, btnEl) => {
  inlineInput(btnEl, `New value for ${label}`, async (v) => {
    const r = await api(`/credentials/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value: v }),
    });
    if (r.ok) {
      toast(r.note || 'Updated', 'success');
      navigate('credentials');
    } else toast(r.error || 'Failed', 'error');
  });
};
window.deleteCredential = async (key, btnEl) => {
  inlineConfirm(btnEl, `Remove ${key}?`, async () => {
    await api(`/credentials/${key}`, { method: 'DELETE' });
    toast('Removed', 'success');
    navigate('credentials');
  });
};

// MCP Servers
async function renderConnectorCatalog(el) {
  const [data, emailWorkflows, calendarWorkflows, documentWorkflows] =
    await Promise.all([
      api('/connectors'),
      api('/connectors/workflows?domain=email').catch(() => ({
        workflows: [],
      })),
      api('/connectors/workflows?domain=calendar').catch(() => ({
        workflows: [],
      })),
      api('/connectors/workflows?domain=documents').catch(() => ({
        workflows: [],
      })),
    ]);
  const statusBadge = (status) =>
    status === 'ready'
      ? 'badge-success'
      : status === 'configured'
        ? 'badge-info'
        : 'badge-warning';
  const highRisk = data.connectors.filter(
    (connector) => connector.risk === 'high',
  );
  const approvalRequired = data.connectors.filter(
    (connector) => connector.approvalRequired,
  );
  el.innerHTML = `
    <div class="page-header"><h2>Connector Catalog</h2></div>
    <div class="card">
      <div class="card-title">Setup Overview</div>
      <div class="grid grid-4">
        <div><div style="font-size:11px;color:var(--text-muted)">Connectors</div><div style="font-size:20px;font-weight:600">${data.summary.total}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Ready</div><div style="font-size:20px;font-weight:600;color:var(--success)">${data.summary.ready}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Configured</div><div style="font-size:20px;font-weight:600;color:var(--info)">${data.summary.configured}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Needs Setup</div><div style="font-size:20px;font-weight:600;color:var(--warning)">${data.summary.needsSetup}</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Permission Audit</div>
      <div class="grid grid-3">
        <div><div style="font-size:11px;color:var(--text-muted)">High Risk</div><div style="font-size:20px;font-weight:600;color:var(--warning)">${highRisk.length}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Approval-Gated</div><div style="font-size:20px;font-weight:600;color:var(--success)">${approvalRequired.length}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Write Scopes</div><div style="font-size:20px;font-weight:600">${data.connectors.reduce((sum, connector) => sum + connector.permissions.filter((permission) => permission.access === 'write').length, 0)}</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Email Workflows <span class="badge badge-muted">${emailWorkflows.workflows.length}</span></div>
      <div style="display:grid;gap:8px">
        ${emailWorkflows.workflows
          .map(
            (
              workflow,
            ) => `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-bottom:1px solid var(--border);padding-bottom:8px">
              <div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                  <strong style="font-size:13px;color:var(--text)">${esc(workflow.title)}</strong>
                  <span class="badge ${workflow.risk === 'high' ? 'badge-warning' : 'badge-muted'}">${esc(workflow.risk)}</span>
                  ${workflow.approvalRequired ? '<span class="badge badge-success">approval required</span>' : '<span class="badge badge-muted">read/draft</span>'}
                </div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:3px">${esc(workflow.description)}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Connectors: ${workflow.connectors.map((item) => `<code>${esc(item)}</code>`).join(' ')}</div>
              </div>
              <code style="font-size:11px;color:var(--text-muted)">${esc(workflow.id)}</code>
            </div>`,
          )
          .join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-title">Calendar Workflows <span class="badge badge-muted">${calendarWorkflows.workflows.length}</span></div>
      <div style="display:grid;gap:8px">
        ${calendarWorkflows.workflows
          .map(
            (
              workflow,
            ) => `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-bottom:1px solid var(--border);padding-bottom:8px">
              <div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                  <strong style="font-size:13px;color:var(--text)">${esc(workflow.title)}</strong>
                  <span class="badge ${workflow.risk === 'high' ? 'badge-warning' : 'badge-muted'}">${esc(workflow.risk)}</span>
                  ${workflow.approvalRequired ? '<span class="badge badge-success">approval required</span>' : '<span class="badge badge-muted">read/brief</span>'}
                </div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:3px">${esc(workflow.description)}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Connectors: ${workflow.connectors.map((item) => `<code>${esc(item)}</code>`).join(' ')}</div>
              </div>
              <code style="font-size:11px;color:var(--text-muted)">${esc(workflow.id)}</code>
            </div>`,
          )
          .join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-title">kDrive Workflows <span class="badge badge-muted">${documentWorkflows.workflows.length}</span></div>
      <div style="display:grid;gap:8px">
        ${documentWorkflows.workflows
          .map(
            (
              workflow,
            ) => `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-bottom:1px solid var(--border);padding-bottom:8px">
              <div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                  <strong style="font-size:13px;color:var(--text)">${esc(workflow.title)}</strong>
                  <span class="badge ${workflow.risk === 'high' ? 'badge-warning' : 'badge-muted'}">${esc(workflow.risk)}</span>
                  ${workflow.approvalRequired ? '<span class="badge badge-success">approval required</span>' : '<span class="badge badge-muted">read/report</span>'}
                </div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:3px">${esc(workflow.description)}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Connectors: ${workflow.connectors.map((item) => `<code>${esc(item)}</code>`).join(' ')}</div>
              </div>
              <code style="font-size:11px;color:var(--text-muted)">${esc(workflow.id)}</code>
            </div>`,
          )
          .join('')}
      </div>
    </div>
    <div class="grid grid-2">
      ${data.connectors
        .map(
          (connector) => `
        <div class="card">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px">
            <div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <strong style="font-size:15px;color:var(--text)">${esc(connector.name)}</strong>
                <span class="badge badge-muted">${esc(connector.category)}</span>
                <span class="badge ${statusBadge(connector.status)}">${esc(connector.status)}</span>
                <span class="badge ${connector.risk === 'high' ? 'badge-warning' : 'badge-muted'}">${esc(connector.risk)} risk</span>
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(connector.description)}</div>
            </div>
            <span class="badge ${connector.installed ? 'badge-success' : 'badge-muted'}">${connector.installed ? 'Installed' : 'Available'}</span>
          </div>
          <div style="display:grid;gap:8px">
            <div style="font-size:12px;color:var(--text-muted)">Setup: <code style="color:var(--accent)">${esc(connector.installAction)}</code></div>
            ${
              connector.skill
                ? `<div style="font-size:12px;color:var(--text-muted)">Skill: <code>${esc(connector.skill)}</code></div>`
                : ''
            }
            ${
              connector.envVars.length
                ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${connector.envVars
                    .map(
                      (key) =>
                        `<span class="badge ${connector.missingEnvVars.includes(key) ? 'badge-error' : 'badge-success'}">${esc(key)}</span>`,
                    )
                    .join('')}</div>`
                : '<div style="font-size:12px;color:var(--text-muted)">No environment variables required.</div>'
            }
            <ol style="font-size:12px;color:var(--text-secondary);line-height:1.8;padding-left:18px;margin:0">
              ${connector.setupSteps.map((step) => `<li>${esc(step)}</li>`).join('')}
            </ol>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              ${connector.permissions
                .map(
                  (permission) =>
                    `<span class="badge ${permission.access === 'write' || permission.access === 'admin' ? 'badge-warning' : 'badge-muted'}">${esc(permission.scope)}:${esc(permission.access)}${permission.approvalRequired ? ':approval' : ''}</span>`,
                )
                .join('')}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-sm btn-ghost" onclick="navigate('credentials')">Credentials</button>
              ${
                connector.category === 'mcp'
                  ? `<button class="btn btn-sm btn-ghost" onclick="navigate('integrations')">MCP</button>`
                  : `<button class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Channels</button>`
              }
            </div>
          </div>
        </div>`,
        )
        .join('')}
    </div>`;
}

async function renderMcp(el) {
  const [health, presets] = await Promise.all([
    api('/mcp/health'),
    api('/mcp/presets').catch(() => []),
  ]);
  const servers = health.servers || [];
  el.innerHTML = `
    <div class="page-header"><h2>MCP Servers</h2>
      <button class="btn btn-primary btn-sm" onclick="document.getElementById('new-mcp-form').style.display=document.getElementById('new-mcp-form').style.display==='none'?'block':'none'">Add Server</button>
    </div>
    <div class="card">
      <div class="card-title">MCP Health</div>
      <div class="grid grid-3">
        <div><div style="font-size:11px;color:var(--text-muted)">Configured</div><div style="font-size:20px;font-weight:600">${health.summary?.total ?? servers.length}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Ready</div><div style="font-size:20px;font-weight:600;color:var(--success)">${health.summary?.ready ?? servers.filter((s) => s.allEnvSet).length}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Missing Env</div><div style="font-size:20px;font-weight:600;color:var(--warning)">${health.summary?.missingEnv ?? servers.filter((s) => !s.allEnvSet).length}</div></div>
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin-top:10px">Agents load custom MCP servers from <code>${esc(health.summary?.configPath || 'store/mcp-servers.json')}</code>. Rebuild the agent container after changing server code or dependencies.</p>
    </div>
    ${
      presets.length
        ? `<div class="card">
      <div class="card-title">Recommended MCP Presets</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Presets are optional templates. They are not enabled until installed, credentials are added, and the agent container is rebuilt.</p>
      ${presets
        .map(
          (preset) => `
        <div class="channel-card" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <strong style="color:var(--text)">${esc(preset.label)}</strong>
              <span class="badge badge-muted">${esc(preset.toolPattern || `mcp__${preset.name}__*`)}</span>
              ${preset.installed ? '<span class="badge badge-success">Installed</span>' : '<span class="badge badge-info">Optional</span>'}
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(preset.notes || '')}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:6px;font-family:var(--mono)">${esc(preset.command)} ${preset.args.map((arg) => esc(arg)).join(' ')}</div>
          </div>
          <button class="btn btn-sm ${preset.installed ? 'btn-ghost' : 'btn-primary'}" ${preset.installed ? 'disabled' : ''} onclick="installMcpPreset('${esc(preset.name)}')">${preset.installed ? 'Installed' : 'Install'}</button>
        </div>`,
        )
        .join('')}
    </div>`
        : ''
    }
    <div class="card" id="new-mcp-form" style="display:none">
      <div class="card-title">Add MCP Server</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px">MCP servers run inside the agent container and give the bot access to external tools and APIs. After adding, rebuild the container and restart the service.</p>
      <form id="mcp-create-form">
        <div class="grid grid-2">
          <div class="form-group"><label>Name (lowercase, no spaces)</label><input id="mcp-name" placeholder="my-service" required pattern="[a-z0-9-]+"></div>
          <div class="form-group"><label>Display Label</label><input id="mcp-label" placeholder="My Service"></div>
        </div>
        <div class="grid grid-2">
          <div class="form-group"><label>Command</label><input id="mcp-command" placeholder="npx" required></div>
          <div class="form-group"><label>Args (comma-separated)</label><input id="mcp-args" placeholder="-y, @org/my-mcp-server"></div>
        </div>
        <div class="form-group"><label>Required Environment Variables (comma-separated key names)</label><input id="mcp-envvars" placeholder="MY_API_KEY, MY_SECRET"></div>
        <p style="font-size:11px;color:var(--text-muted);margin-bottom:12px">These env vars must be set in <strong>Credentials</strong> for the server to work. They'll be passed from .env into the container.</p>
        <div class="form-group"><label>Setup Notes (optional — shown to admin)</label><input id="mcp-notes" placeholder="e.g. Get API key at example.com/api"></div>
        <button type="submit" class="btn btn-primary">Add Server</button>
      </form>
    </div>
    ${servers
      .map(
        (s) => `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <div style="font-size:16px;font-weight:600;color:var(--text)">${esc(s.label)} ${s.core ? '<span class="badge badge-muted">Core</span>' : ''}</div>
          <div style="font-family:var(--mono);font-size:12px;color:var(--text-muted);margin-top:2px">${esc(s.name)}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="badge ${s.allEnvSet ? 'badge-success' : 'badge-warning'}">${s.allEnvSet ? 'Ready' : 'Missing env vars'}</span>
          <span class="badge badge-muted">${esc(s.toolPattern || `mcp__${s.name}__*`)}</span>
          ${!s.core ? `<button class="btn btn-sm btn-danger" onclick="deleteMcp('${esc(s.name)}',this)">Remove</button>` : ''}
        </div>
      </div>
      <table>
        <tr><td style="width:120px;color:var(--text-muted)">Command</td><td style="font-family:var(--mono);font-size:12px;color:var(--text)">${esc(s.command)} ${s.args.map((a) => esc(a)).join(' ')}</td></tr>
        ${
          s.envVars.length > 0
            ? `<tr><td style="color:var(--text-muted)">Env Vars</td><td>${s.envStatus
                .map(
                  (e) =>
                    `<span class="badge ${e.isSet ? 'badge-success' : 'badge-error'}" style="margin:2px">${esc(e.key)} ${e.isSet ? '\u2713' : '\u2717 not set'}</span>`,
                )
                .join(' ')}</td></tr>`
            : '<tr><td style="color:var(--text-muted)">Env Vars</td><td style="color:var(--text-muted)">None required</td></tr>'
        }
      </table>
      ${
        !s.allEnvSet && s.envVars.length > 0
          ? `<div style="margin-top:12px;padding:10px;background:var(--warning-bg);border-radius:var(--radius-sm);font-size:12px;color:var(--warning)">
        Missing: ${s.envStatus
          .filter((e) => !e.isSet)
          .map((e) => e.key)
          .join(
            ', ',
          )} — add these in <a style="color:var(--accent);cursor:pointer" onclick="navigate('credentials')">Credentials</a>
      </div>`
          : ''
      }
      ${s.notes ? `<div style="margin-top:12px;padding:10px;background:var(--info-bg);border-radius:var(--radius-sm);font-size:12px;color:var(--info)">${esc(s.notes)}</div>` : ''}
    </div>`,
      )
      .join('')}`;

  document.getElementById('mcp-create-form').onsubmit = async (e) => {
    e.preventDefault();
    const args = document
      .getElementById('mcp-args')
      .value.split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const envVars = document
      .getElementById('mcp-envvars')
      .value.split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const r = await api('/mcp', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('mcp-name').value,
        label: document.getElementById('mcp-label').value,
        command: document.getElementById('mcp-command').value,
        args,
        envVars,
        notes: document.getElementById('mcp-notes').value || undefined,
      }),
    });
    if (r.ok) {
      toast(r.message || 'Added', 'success');
      navigate('integrations');
    } else toast(r.error || 'Failed', 'error');
  };
}

window.installMcpPreset = async (name) => {
  const r = await api(`/mcp/presets/${encodeURIComponent(name)}/install`, {
    method: 'POST',
  });
  if (r.ok) {
    toast(r.message || 'Preset installed', 'success');
    navigate('integrations');
  } else toast(r.error || 'Failed', 'error');
};

window.deleteMcp = async (name, btnEl) => {
  inlineConfirm(btnEl, `Remove "${name}"?`, async () => {
    const r = await api(`/mcp/${name}`, { method: 'DELETE' });
    if (r.ok) {
      toast(r.message || 'Removed', 'success');
      navigate('integrations');
    } else toast(r.error || 'Failed', 'error');
  });
};

// AI Providers
async function renderProviders(el) {
  const [data, groups, profileData] = await Promise.all([
    api('/providers'),
    api('/groups'),
    api('/system/provider/profiles').catch(() => ({
      profiles: [],
      capabilityMatrix: {},
      purposes: [],
    })),
  ]);
  const prefs = data.preferences;
  const categoryIcons = {
    'Image Generation': '\uD83C\uDFA8',
    Code: '\uD83D\uDCBB',
    Voice: '\uD83C\uDF99',
    LLM: '\uD83E\uDDE0',
  };

  const categoryHtml = Object.entries(data.categories)
    .map(([cat, providers]) => {
      const globalDefault = prefs.global[cat] || null;
      return `
    <div class="card">
      <div class="card-title">${categoryIcons[cat] || '\u2726'} ${esc(cat)}</div>
      ${providers
        .map((p) => {
          const isDefault = globalDefault === p.id;
          return `
        <div style="padding:14px 0;border-bottom:1px solid var(--border);${providers.indexOf(p) === providers.length - 1 ? 'border-bottom:none' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:15px;font-weight:600;color:var(--text)">${esc(p.name)}</span>
                ${p.configured ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-muted">Not configured</span>'}
                ${isDefault ? '<span class="badge badge-accent">Default</span>' : ''}
                ${p.free ? '<span class="badge badge-info">Free tier</span>' : ''}
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(p.description)}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            ${!p.configured ? `<button class="btn btn-sm btn-primary" onclick="enableProvider('${esc(p.id)}','${esc(p.name)}','${esc(p.envKey)}',this)">Enable</button>` : ''}
            ${p.configured && !p.envKey.startsWith('CODEX_') ? `<button class="btn btn-sm btn-ghost" onclick="disableProvider('${esc(p.id)}')">Disable</button>` : ''}
            ${p.configured && !isDefault ? `<button class="btn btn-sm btn-ghost" onclick="setDefaultProvider('${esc(cat)}','${esc(p.id)}')">Set as Default</button>` : ''}
            ${p.models && p.models.length > 0 ? `<span style="font-size:11px;color:var(--text-muted)">Models: ${p.models.map((m) => `<code style="color:var(--accent)">${esc(m)}</code>`).join(', ')}</span>` : ''}
            <a href="${esc(p.website)}" target="_blank" style="font-size:11px;color:var(--accent);text-decoration:none;margin-left:auto">${esc(p.website.replace('https://', ''))}</a>
          </div>
          ${p.configured && !p.envKey.startsWith('CODEX_') ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted)">Key: <code>${esc(p.envKey)}</code></div>` : ''}
          ${p.envKey.startsWith('CODEX_') ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted)">Auth: browser login via <code>codex login --device-auth</code></div>` : ''}
        </div>`;
        })
        .join('')}
    </div>`;
    })
    .join('');

  // Per-group defaults
  const groupDefaultsHtml =
    groups.length > 0
      ? `
    <div class="card">
      <div class="card-title">Per-Group Defaults</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Override the global default for specific groups. The bot uses the group-specific default when available.</p>
      <table><thead><tr><th>Group</th>${Object.keys(data.categories)
        .map((c) => `<th>${esc(c)}</th>`)
        .join('')}</tr></thead>
      <tbody>${groups
        .map(
          (g) => `<tr>
        <td style="color:var(--text);font-weight:500">${esc(g.name)}</td>
        ${Object.keys(data.categories)
          .map((cat) => {
            const groupPref = prefs.groups?.[g.folder]?.[cat];
            const globalPref = prefs.global[cat];
            const effective = groupPref || globalPref;
            const provider = data.providers.find((p) => p.id === effective);
            const configuredInCat = data.categories[cat].filter(
              (p) => p.configured,
            );
            if (configuredInCat.length <= 1)
              return `<td style="font-size:12px;color:var(--text-muted)">${provider ? esc(provider.name) : '-'}</td>`;
            return `<td><select class="search-input" style="max-width:150px;padding:4px 8px;font-size:11px" onchange="setGroupProvider('${esc(g.folder)}','${esc(cat)}',this.value)">
            <option value="">Global default</option>
            ${configuredInCat.map((p) => `<option value="${p.id}" ${groupPref === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select></td>`;
          })
          .join('')}
      </tr>`,
        )
        .join('')}</tbody></table>
    </div>`
      : '';
  const profileHtml =
    profileData.profiles?.length > 0
      ? `
    <div class="card">
      <div class="card-title">Capability Routing</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Feature defaults used by chat, coding jobs, automations, memory, journal extraction, reports, documents, and vision workflows.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Purpose</th><th>Provider</th><th>Model</th><th>Tool Policy</th><th>Capabilities</th></tr></thead>
        <tbody>${profileData.profiles
          .map((profile) => {
            const caps = profileData.capabilityMatrix?.[profile.provider] || {};
            return `<tr>
              <td style="color:var(--text);font-weight:600">${esc(profile.label || profile.id)}</td>
              <td><span class="badge badge-accent">${esc(profile.provider)}</span></td>
              <td style="font-family:var(--mono);font-size:11px;color:var(--text)">${esc(profile.model)}</td>
              <td><span class="badge badge-muted">${esc(profile.toolPolicy)}</span></td>
              <td style="font-size:11px;color:var(--text-muted)">
                ${caps.tool_calls ? '<span class="badge badge-success">tools</span>' : '<span class="badge badge-muted">no tools</span>'}
                ${caps.structured_output ? '<span class="badge badge-success">json</span>' : '<span class="badge badge-muted">loose</span>'}
                ${caps.vision ? '<span class="badge badge-info">vision</span>' : ''}
                <span class="badge badge-muted">${esc(caps.privacy_tier || 'unknown')}</span>
              </td>
            </tr>`;
          })
          .join('')}</tbody>
      </table></div>
    </div>`
      : '';

  el.innerHTML = `
    <div class="page-header"><h2>AI Providers</h2></div>
    ${profileHtml}
    <div class="grid grid-2">${categoryHtml}</div>
    ${groupDefaultsHtml}`;
}

window.enableProvider = async (id, name, envKey, btnEl) => {
  inlineInput(btnEl, `API key for ${name}`, async (key) => {
    const r = await api(`/providers/${id}/enable`, {
      method: 'POST',
      body: JSON.stringify({ apiKey: key }),
    });
    if (r.ok) {
      toast(r.message || 'Enabled', 'success');
      navigate('integrations');
    } else toast(r.error || 'Failed', 'error');
  });
};

window.disableProvider = async (id) => {
  const r = await api(`/providers/${id}/disable`, { method: 'POST' });
  if (r.ok) {
    toast(r.message || 'Disabled', 'success');
    navigate('integrations');
  } else toast(r.error || 'Failed', 'error');
};

window.setDefaultProvider = async (category, providerId) => {
  const r = await api('/providers/preferences', {
    method: 'PUT',
    body: JSON.stringify({ category, providerId }),
  });
  if (r.ok) {
    toast(`Default set for ${category}`, 'success');
    navigate('integrations');
  } else toast(r.error || 'Failed', 'error');
};

window.setGroupProvider = async (groupFolder, category, providerId) => {
  const r = await api('/providers/preferences', {
    method: 'PUT',
    body: JSON.stringify({
      category,
      providerId: providerId || undefined,
      groupFolder,
    }),
  });
  if (r.ok) toast('Updated', 'success');
  else toast(r.error || 'Failed', 'error');
};

// Skills
async function renderSkillsPage(el) {
  await renderSkills(el, { embedded: false, returnPage: 'skills' });
}

async function renderSkills(el, options = {}) {
  const returnPage = options.returnPage || 'memory';
  const [data, drafts, suggestions] = await Promise.all([
    api('/skills'),
    api('/skills/drafts?status=pending').catch(() => []),
    api('/skills/suggestions').catch(() => []),
  ]);
  window._skillSuggestions = Array.isArray(suggestions) ? suggestions : [];
  el.innerHTML = `
    <div class="page-header"><h2>Skills</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" onclick="document.getElementById('new-skill-draft-form').style.display=document.getElementById('new-skill-draft-form').style.display==='none'?'block':'none'">Draft from Instructions</button>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('new-skill-form').style.display=document.getElementById('new-skill-form').style.display==='none'?'block':'none'">Install Directly</button>
      </div>
    </div>
    <div class="card" id="new-skill-draft-form" style="display:none">
      <div class="card-title">Draft Skill From Instructions <span class="badge badge-info">Approval required</span></div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Create a provider-neutral skill draft from task instructions. It stays inactive until you review and approve it.</p>
      <form id="skill-draft-create-form">
        <div class="grid grid-2">
          <div class="form-group"><label>Name</label><input id="skill-draft-name" placeholder="operation-briefing" required></div>
          <div class="form-group"><label>Allowed Tools (optional)</label><input id="skill-draft-tools" placeholder="Bash(command:*), mcp__nanocrab__*"></div>
        </div>
        <div class="form-group"><label>Description</label><input id="skill-draft-desc" placeholder="When the agent should use this skill" required></div>
        <div class="form-group"><label>Task Instructions</label><textarea id="skill-draft-instructions" style="width:100%;min-height:170px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical;line-height:1.55" placeholder="Describe the repeated task, expected output, rules, sources, safety checks, and examples."></textarea></div>
        <button type="submit" class="btn btn-primary">Create Draft</button>
      </form>
    </div>
    <div class="card" style="margin-bottom:12px">
      <div class="card-title">Suggested Skills <span class="badge badge-muted">${window._skillSuggestions.length}</span></div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">NanoCrab looks for repeated workflows in recent conversation and suggests reusable skills. Suggestions are inactive until you create and approve a draft.</p>
      ${
        window._skillSuggestions.length === 0
          ? '<div class="empty" style="padding:12px">No new skill suggestions from recent history</div>'
          : window._skillSuggestions
              .map(
                (suggestion, index) => `
        <div class="channel-card" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span style="font-weight:600;color:var(--text)">${esc(suggestion.name)}</span>
              <span class="badge badge-info">${Math.round((suggestion.confidence || 0) * 100)}%</span>
              <span class="badge badge-muted">${esc(String(suggestion.evidenceCount || 0))} signals</span>
              <span class="badge badge-muted">${esc(String(suggestion.occurrenceCount || 1))} seen</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(suggestion.description)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${esc(suggestion.reason || '')}</div>
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            <button class="btn btn-sm btn-primary" onclick="createSkillDraftFromSuggestion(${index})">Create Draft</button>
            <button class="btn btn-sm btn-ghost" onclick="dismissSkillSuggestion('${esc(suggestion.id)}')">Dismiss</button>
          </div>
        </div>`,
              )
              .join('')
      }
    </div>
    <div class="card" style="margin-bottom:12px">
      <div class="card-title">Skill Factory Drafts <span class="badge badge-muted">${drafts.length}</span></div>
      ${
        drafts.length === 0
          ? '<div class="empty" style="padding:12px">No pending skill drafts</div>'
          : drafts
              .map(
                (draft) => `
        <div class="channel-card" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span style="font-weight:600;color:var(--text)">${esc(draft.name)}</span>
              <span class="badge badge-warning">${esc(draft.status)}</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(draft.description)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${esc(draft.createdBy)} &middot; ${formatTime(draft.createdAt)}</div>
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            <button class="btn btn-sm btn-ghost" onclick="viewSkillDraft('${esc(draft.id)}')">Review</button>
            <button class="btn btn-sm btn-primary" onclick="reviewSkillDraft('${esc(draft.id)}','approve')">Approve</button>
            <button class="btn btn-sm btn-ghost" onclick="reviewSkillDraft('${esc(draft.id)}','reject')">Reject</button>
          </div>
        </div>`,
              )
              .join('')
      }
    </div>
    <div class="card" id="new-skill-form" style="display:none">
      <div class="card-title">Install Container Skill Directly</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Use this only for trusted admin-authored skills. The safer workflow is to create a draft and approve it.</p>
      <form id="skill-create-form">
        <div class="grid grid-2">
          <div class="form-group"><label>Name</label><input id="skill-name" placeholder="my-skill" required></div>
          <div class="form-group"><label>Allowed Tools (optional)</label><input id="skill-tools" placeholder="Bash(command:*)"></div>
        </div>
        <div class="form-group"><label>Description</label><input id="skill-desc" placeholder="What this skill does" required></div>
        <div class="form-group"><label>Instructions (Markdown)</label><textarea id="skill-content" style="width:100%;min-height:120px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical" placeholder="# My Skill\n\nInstructions for the agent..."></textarea></div>
        <button type="submit" class="btn btn-primary">Create Skill</button>
      </form>
    </div>
    ${['core', 'plugin', 'tool', 'custom']
      .map((cat) => {
        const skills = data.installed.filter(
          (s) => (s.category || 'tool') === cat,
        );
        if (skills.length === 0) return '';
        const label =
          cat === 'core'
            ? 'Core Skills'
            : cat === 'plugin'
              ? 'Plugin Skills'
              : cat === 'custom'
                ? 'Custom Skills (local only)'
                : 'Tool Skills';
        return `<div class="card" style="margin-bottom:12px">
        <div class="card-title">${label} <span class="badge badge-muted" style="font-size:10px">${skills.length}</span></div>
        ${skills
          .map(
            (s) => `
          <div class="channel-card" style="align-items:flex-start">
            <div class="channel-info" style="flex:1;min-width:0">
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <span class="channel-name">${esc(s.name)}</span>
                <span class="badge ${s.enabled ? 'badge-success' : 'badge-muted'}">${s.enabled ? 'Enabled' : 'Disabled'}</span>
                <span class="badge badge-info">${esc(s.scope || 'all')}</span>
                <span class="badge ${s.visibility === 'private' ? 'badge-warning' : 'badge-muted'}">${esc(s.visibility || 'shared')}</span>
                ${s.riskLevel ? `<span class="badge ${s.riskLevel === 'high' ? 'badge-error' : s.riskLevel === 'medium' ? 'badge-warning' : 'badge-muted'}">risk ${esc(s.riskLevel)}</span>` : ''}
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis">${esc(s.description || 'No description')}</div>
              ${
                Array.isArray(s.triggers) && s.triggers.length
                  ? `<div style="font-size:11px;color:var(--text-muted);margin-top:6px">Triggers: ${esc(s.triggers.slice(0, 10).join(', '))}</div>`
                  : ''
              }
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;align-items:center;flex-wrap:wrap;justify-content:flex-end">
              <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);cursor:pointer"><input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="updateSkillState('${esc(s.path)}',{enabled:this.checked})"> Active</label>
              <select class="input-sm" style="width:auto;min-width:92px" onchange="updateSkillState('${esc(s.path)}',{scope:this.value})">
                <option value="all" ${(s.scope || 'all') === 'all' ? 'selected' : ''}>All</option>
                <option value="main" ${s.scope === 'main' ? 'selected' : ''}>Main only</option>
                <option value="channels" ${s.scope === 'channels' ? 'selected' : ''}>Channels</option>
              </select>
              <select class="input-sm" style="width:auto;min-width:98px" onchange="updateSkillState('${esc(s.path)}',{visibility:this.value})">
                <option value="shared" ${(s.visibility || 'shared') === 'shared' ? 'selected' : ''}>Shared</option>
                <option value="private" ${s.visibility === 'private' ? 'selected' : ''}>Private</option>
                <option value="system" ${s.visibility === 'system' ? 'selected' : ''}>System</option>
              </select>
              <button class="btn btn-sm btn-ghost" onclick="editSkill('${esc(s.path)}')">Edit</button>
              ${cat !== 'core' ? `<button class="btn btn-sm btn-danger" onclick="deleteSkill('${esc(s.path)}',this)">Delete</button>` : ''}
            </div>
          </div>`,
          )
          .join('')}
      </div>`;
      })
      .join('')}
    <div id="skill-editor" style="display:none"></div>
    <div id="skill-draft-viewer" style="display:none"></div>
    ${options.embedded ? '' : '<div id="skills-page-timeline"></div>'}`;

  // Create form handler
  document.getElementById('skill-draft-create-form').onsubmit = async (e) => {
    e.preventDefault();
    const r = await api('/skills/drafts', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('skill-draft-name').value,
        description: document.getElementById('skill-draft-desc').value,
        allowedTools:
          document.getElementById('skill-draft-tools').value || undefined,
        instructions:
          document.getElementById('skill-draft-instructions').value ||
          undefined,
        createdBy: 'dashboard',
        provenance: ['source:dashboard', 'kind:instruction-draft'],
      }),
    });
    if (r.ok) {
      toast('Skill draft created for review', 'success');
      navigate(returnPage);
    } else toast(r.error || 'Failed', 'error');
  };

  document.getElementById('skill-create-form').onsubmit = async (e) => {
    e.preventDefault();
    const r = await api('/skills', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('skill-name').value,
        description: document.getElementById('skill-desc').value,
        allowedTools: document.getElementById('skill-tools').value || undefined,
        content: document.getElementById('skill-content').value || undefined,
      }),
    });
    if (r.ok) {
      toast(r.message || 'Created', 'success');
      navigate(returnPage);
    } else toast(r.error || 'Failed', 'error');
  };

  if (!options.embedded) {
    const timelineEl = document.getElementById('skills-page-timeline');
    if (timelineEl) {
      const [auditData, memories, allDrafts] = await Promise.all([
        api('/audit?limit=150').catch(() => []),
        api('/memory?limit=150').catch(() => []),
        api('/skills/drafts').catch(() => []),
      ]);
      const items = memoryKnowledgeTimelineItems({
        auditData,
        memories,
        drafts: allDrafts,
        limit: 20,
      });
      timelineEl.innerHTML = `
        <div class="card" style="margin-top:12px">
          <div class="card-title">Recent Memory & Skill Activity</div>
          ${renderTimelineItems(items)}
        </div>`;
    }
  }
}

window.createSkillDraftFromSuggestion = async (index) => {
  const suggestion = (window._skillSuggestions || [])[index];
  if (!suggestion) return;
  try {
    const r = await api('/skills/drafts', {
      method: 'POST',
      body: JSON.stringify({
        name: suggestion.name,
        description: suggestion.description,
        instructions: suggestion.instructions,
        createdBy: 'dashboard-suggestion',
        suggestionId: suggestion.id,
        provenance: suggestion.provenance || [
          'source:dashboard-suggestion',
          'kind:history-suggestion',
        ],
      }),
    });
    if (r.ok) {
      toast('Suggested skill draft created for review', 'success');
      navigate('skills');
    } else toast(r.error || 'Failed', 'error');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.dismissSkillSuggestion = async (id) => {
  try {
    const r = await api(
      `/skills/suggestions/${encodeURIComponent(id)}/dismiss`,
      {
        method: 'POST',
      },
    );
    if (r.ok) {
      toast('Skill suggestion dismissed', 'success');
      navigate('skills');
    } else toast(r.error || 'Failed', 'error');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.viewSkillDraft = async (id) => {
  const [data, revisions] = await Promise.all([
    api(`/skills/drafts/${encodeURIComponent(id)}`),
    api(`/skills/drafts/${encodeURIComponent(id)}/revisions`).catch(() => []),
  ]);
  const viewer = document.getElementById('skill-draft-viewer');
  viewer.style.display = 'block';
  viewer.innerHTML = `
    <div class="card" style="margin-top:16px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px">
        <div class="card-title" style="margin:0">Draft: ${esc(data.draft.name)}</div>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('skill-draft-viewer').style.display='none'">Close</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <span class="badge badge-muted">version ${esc(String(data.draft.version || 1))}</span>
        <span class="badge ${data.draft.syncStatus === 'installed' ? 'badge-success' : data.draft.syncStatus === 'stale' ? 'badge-warning' : 'badge-muted'}">${esc(data.draft.syncStatus || 'draft')}</span>
        ${
          Array.isArray(data.draft.provenance)
            ? data.draft.provenance
                .slice(0, 4)
                .map(
                  (item) =>
                    `<span class="badge badge-info">${esc(item)}</span>`,
                )
                .join('')
            : ''
        }
      </div>
      <textarea id="skill-draft-edit-content" style="width:100%;min-height:320px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical;line-height:1.6">${esc(data.content)}</textarea>
      ${
        revisions.length
          ? `<div style="margin-top:12px">
              <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Revision History</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${revisions
                  .map(
                    (rev) =>
                      `<button class="btn btn-sm btn-ghost" onclick="rollbackSkillDraft('${esc(id)}',${Number(rev.version)})">v${esc(String(rev.version))} ${esc(rev.reason || 'updated')}</button>`,
                  )
                  .join('')}
              </div>
            </div>`
          : ''
      }
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-sm btn-ghost" onclick="saveSkillDraftRevision('${esc(id)}')">Save Revision</button>
        <button class="btn btn-sm btn-primary" onclick="reviewSkillDraft('${esc(id)}','approve')">Approve</button>
        <button class="btn btn-sm btn-ghost" onclick="reviewSkillDraft('${esc(id)}','reject')">Reject</button>
      </div>
    </div>`;
  viewer.scrollIntoView({ behavior: 'smooth' });
};

window.saveSkillDraftRevision = async (id) => {
  const content = document.getElementById('skill-draft-edit-content')?.value;
  if (!content) return;
  try {
    const r = await api(`/skills/drafts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ skillMd: content, updatedBy: 'dashboard' }),
    });
    if (r.ok) {
      toast('Skill draft revision saved', 'success');
      await viewSkillDraft(id);
    } else toast(r.error || 'Failed', 'error');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.rollbackSkillDraft = async (id, version) => {
  try {
    const r = await api(`/skills/drafts/${encodeURIComponent(id)}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ version, rolledBackBy: 'dashboard' }),
    });
    if (r.ok) {
      toast(`Rolled back into new draft revision`, 'success');
      await viewSkillDraft(id);
    } else toast(r.error || 'Failed', 'error');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.reviewSkillDraft = async (id, action) => {
  try {
    const r = await api(`/skills/drafts/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
    });
    if (r.ok) {
      toast(
        action === 'approve' ? 'Skill draft approved' : 'Skill draft rejected',
        'success',
      );
      navigate(currentPage === 'skills' ? 'skills' : 'memory');
    } else {
      toast(r.error || 'Failed', 'error');
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.toggleSkill = async (skillPath, enabled) => {
  return updateSkillState(skillPath, { enabled });
};

window.updateSkillState = async (skillPath, patch) => {
  try {
    await api(`/skills/${skillPath}/state`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    toast('Skill registry updated', 'success');
    navigate(currentPage === 'skills' ? 'skills' : 'memory');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.editSkill = async (skillPath) => {
  const data = await api(`/skills/${skillPath}`);
  const editor = document.getElementById('skill-editor');
  editor.style.display = 'block';
  editor.innerHTML = `
    <div class="card" style="margin-top:16px">
      <div class="card-title">Edit: ${esc(skillPath)}/SKILL.md</div>
      <textarea id="skill-edit-content" style="width:100%;min-height:300px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical;line-height:1.6">${esc(data.content)}</textarea>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" onclick="saveSkill('${esc(skillPath)}')">Save</button>
        <button class="btn btn-ghost" onclick="document.getElementById('skill-editor').style.display='none'">Cancel</button>
      </div>
    </div>`;
  editor.scrollIntoView({ behavior: 'smooth' });
};

window.saveSkill = async (skillPath) => {
  const content = document.getElementById('skill-edit-content').value;
  const r = await api(`/skills/${skillPath}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
  if (r.ok) {
    toast(r.message || 'Saved', 'success');
    document.getElementById('skill-editor').style.display = 'none';
  } else toast(r.error || 'Failed', 'error');
};

window.deleteSkill = async (skillPath, btnEl) => {
  inlineConfirm(btnEl, `Delete "${skillPath}"?`, async () => {
    const r = await api(`/skills/${skillPath}`, { method: 'DELETE' });
    if (r.ok) {
      toast(r.message || 'Deleted', 'success');
      navigate('memory');
    } else toast(r.error || 'Failed', 'error');
  });
};

// Docker
async function renderDocker(el) {
  const [containers, images] = await Promise.all([
    api('/docker/containers'),
    api('/docker/images'),
  ]);
  el.innerHTML = `
    <div class="page-header"><h2>Docker</h2>
      <button class="btn btn-primary btn-sm" onclick="rebuildContainer(this)">Rebuild Container</button>
    </div>
    <div class="card">
      <div class="card-title">Containers <span class="badge badge-muted">${containers.length}</span></div>
      ${
        containers.length === 0
          ? '<div class="empty">No NanoCrab agent containers found</div>'
          : `
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Status</th><th>Image</th><th>Created</th><th>Ports</th></tr></thead>
        <tbody>${containers
          .map(
            (c) => `<tr>
          <td style="color:var(--text);font-weight:500">${esc(c.name)}</td>
          <td><span class="badge ${c.status.startsWith('Up') ? 'badge-success' : 'badge-error'}">${esc(c.status)}</span></td>
          <td style="font-family:var(--mono);font-size:11px">${esc(c.image)}</td>
          <td>${esc(c.created)}</td>
          <td style="font-size:11px">${esc(c.ports || '-')}</td>
        </tr>`,
          )
          .join('')}</tbody>
      </table></div>`
      }
    </div>
    <div class="card">
      <div class="card-title">Images <span class="badge badge-muted">${images.length}</span></div>
      ${
        images.length === 0
          ? '<div class="empty">No NanoCrab agent images found</div>'
          : `
      <div class="table-wrap"><table>
        <thead><tr><th>Repository</th><th>Tag</th><th>Size</th><th>Created</th></tr></thead>
        <tbody>${images
          .map(
            (i) => `<tr>
          <td style="color:var(--text);font-weight:500">${esc(i.repository)}</td>
          <td><span class="badge badge-muted">${esc(i.tag)}</span></td>
          <td>${esc(i.size)}</td>
          <td>${esc(i.created)}</td>
        </tr>`,
          )
          .join('')}</tbody>
      </table></div>`
      }
    </div>`;
}

window.rebuildContainer = async (btnEl) => {
  inlineConfirm(btnEl, 'Start container rebuild?', async () => {
    const r = await api('/docker/rebuild', { method: 'POST' });
    if (r.ok) toast(r.message || 'Rebuild started', 'success');
    else toast(r.error || 'Failed', 'error');
    navigate('containers');
  });
};

// Files
async function renderFiles(el) {
  const groups = await api('/files');
  el.innerHTML = `
    <div class="page-header"><h2>Group Files</h2></div>
    <div class="files-layout" style="display:flex;gap:16px">
      <div style="min-width:200px;max-width:250px">
        <div class="card">
          <div class="card-title">Groups</div>
          ${groups
            .map(
              (g) => `
            <a class="nav-link file-group-link" data-folder="${esc(g.name)}" onclick="selectGroup('${esc(g.name)}')" style="cursor:pointer">
              <span>${esc(g.name)}</span>
              <span style="font-size:11px;color:var(--text-muted)">${[g.hasAgentsMd ? 'agents' : '', g.hasConversations ? 'conv' : '', g.hasAttachments ? 'att' : ''].filter(Boolean).join(' ')}</span>
            </a>`,
            )
            .join('')}
        </div>
      </div>
      <div style="flex:1" id="file-detail">
        <div class="card empty">Select a group to browse its files</div>
      </div>
    </div>`;
}

window.selectGroup = async (folder) => {
  // Highlight active
  document
    .querySelectorAll('.file-group-link')
    .forEach((el) => el.classList.remove('active'));
  const active = document.querySelector(
    `.file-group-link[data-folder="${folder}"]`,
  );
  if (active) active.classList.add('active');

  const detail = document.getElementById('file-detail');
  detail.innerHTML = '<div class="loading">Loading</div>';

  const [agentsMd, memoryMd, conversations, attachments] = await Promise.all([
    api(`/files/${encodeURIComponent(folder)}/agents-md`),
    folder === 'global' ? api('/files/memory') : Promise.resolve(null),
    api(`/files/${encodeURIComponent(folder)}/conversations`).catch(() => []),
    api(`/files/${encodeURIComponent(folder)}/attachments`).catch(() => []),
  ]);

  detail.innerHTML = `
    ${
      memoryMd
        ? `<div class="card">
      <div class="card-title">MEMORY.md <span class="badge badge-info">Private runtime memory</span></div>
      <div class="form-group">
        <textarea id="memory-file-editor" style="width:100%;min-height:200px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical">${esc(memoryMd.content || '')}</textarea>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-primary btn-sm" onclick="saveMemoryFromFiles()">Save</button>
        <span id="memory-file-msg" style="font-size:12px"></span>
      </div>
    </div>`
        : ''
    }
    <div class="card">
      <div class="card-title">Agent Instructions <span class="badge badge-muted">${esc(folder)}</span><span class="badge badge-muted">AGENTS.md</span></div>
      <div class="form-group">
        <textarea id="agents-md-editor" style="width:100%;min-height:300px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical">${esc(agentsMd.content || '')}</textarea>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-primary btn-sm" onclick="saveAgentsMd('${esc(folder)}')">Save</button>
        <span id="agents-md-msg" style="font-size:12px"></span>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Conversations <span class="badge badge-muted">${conversations.length}</span></div>
      ${
        conversations.length === 0
          ? '<div class="empty">No conversations</div>'
          : `
      <div class="table-wrap"><table>
        <thead><tr><th>File</th><th>Size</th><th>Modified</th><th>Actions</th></tr></thead>
        <tbody>${conversations
          .map(
            (f) => `<tr>
          <td style="color:var(--text);font-family:var(--mono);font-size:12px">${esc(f.name)}</td>
          <td>${formatBytes(f.size)}</td>
          <td>${formatTime(f.modified)}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost" onclick="viewConversation('${esc(folder)}','${esc(f.name)}')">View</button>
            <a class="btn btn-sm btn-ghost" href="/api/files/${encodeURIComponent(folder)}/download/conversations/${encodeURIComponent(f.name)}" target="_blank">Open</a>
            <a class="btn btn-sm btn-ghost" href="/api/files/${encodeURIComponent(folder)}/download/conversations/${encodeURIComponent(f.name)}" download style="text-decoration:none">Download</a>
          </td>
        </tr>`,
          )
          .join('')}</tbody>
      </table></div>`
      }
    </div>
    <div class="card">
      <div class="card-title">Attachments <span class="badge badge-muted">${attachments.length}</span></div>
      ${
        attachments.length === 0
          ? '<div class="empty">No attachments</div>'
          : `
      <div class="table-wrap"><table>
        <thead><tr><th>File</th><th>Size</th><th>Modified</th><th>Actions</th></tr></thead>
        <tbody>${attachments
          .map((f) => {
            const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name);
            return `<tr>
          <td style="color:var(--text);font-family:var(--mono);font-size:12px">${isImage ? `<img src="/api/files/${encodeURIComponent(folder)}/download/attachments/${encodeURIComponent(f.name)}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:8px">` : ''}${esc(f.name)}</td>
          <td>${formatBytes(f.size)}</td>
          <td>${formatTime(f.modified)}</td>
          <td style="white-space:nowrap">
            <a class="btn btn-sm btn-ghost" href="/api/files/${encodeURIComponent(folder)}/download/attachments/${encodeURIComponent(f.name)}" target="_blank">Open</a>
            <a class="btn btn-sm btn-ghost" href="/api/files/${encodeURIComponent(folder)}/download/attachments/${encodeURIComponent(f.name)}" download style="text-decoration:none">Download</a>
          </td>
        </tr>`;
          })
          .join('')}</tbody>
      </table></div>`
      }
    </div>
    <div id="conv-viewer"></div>`;
};

window.saveMemoryFromFiles = async () => {
  const content = document.getElementById('memory-file-editor').value;
  const msg = document.getElementById('memory-file-msg');
  try {
    const r = await api('/files/memory', {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    if (r.ok) {
      msg.textContent = 'Saved';
      msg.style.color = 'var(--success)';
    } else {
      msg.textContent = r.error || 'Failed';
      msg.style.color = 'var(--error)';
    }
  } catch {
    msg.textContent = 'Error';
    msg.style.color = 'var(--error)';
  }
  setTimeout(() => (msg.textContent = ''), 3000);
};

window.saveAgentsMd = async (folder) => {
  const content = document.getElementById('agents-md-editor').value;
  const msg = document.getElementById('agents-md-msg');
  try {
    const r = await api(`/files/${encodeURIComponent(folder)}/agents-md`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    if (r.ok) {
      msg.textContent = 'Saved';
      msg.style.color = 'var(--success)';
    } else {
      msg.textContent = r.error || 'Failed';
      msg.style.color = 'var(--error)';
    }
  } catch {
    msg.textContent = 'Error';
    msg.style.color = 'var(--error)';
  }
  setTimeout(() => (msg.textContent = ''), 3000);
};

window.viewConversation = async (folder, filename) => {
  const viewer = document.getElementById('conv-viewer');
  viewer.innerHTML = '<div class="loading">Loading</div>';
  try {
    const data = await api(
      `/files/${encodeURIComponent(folder)}/conversations/${encodeURIComponent(filename)}`,
    );
    viewer.innerHTML = `
      <div class="card">
        <div class="card-title">${esc(filename)} <button class="btn btn-sm btn-ghost" onclick="document.getElementById('conv-viewer').innerHTML=''">Close</button></div>
        <div class="log-viewer" style="max-height:500px">${esc(data.content)}</div>
      </div>`;
  } catch {
    viewer.innerHTML =
      '<div class="card"><div class="empty">Failed to load file</div></div>';
  }
};

function memoryKnowledgeTimelineItems({
  auditData,
  memories,
  drafts,
  limit = 25,
}) {
  const items = [];
  const seen = new Set();
  const addItem = (item) => {
    const ts = item.timestamp || item.createdAt || item.created_at;
    if (!ts) return;
    const key = item.key || `${item.kind}:${ts}:${item.title}:${item.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ ...item, timestamp: ts });
  };

  for (const memory of Array.isArray(memories) ? memories : []) {
    addItem({
      key: `memory-created:${memory.id}`,
      kind: 'memory',
      tone: memory.status === 'pending' ? 'warning' : 'accent',
      title: 'Memory proposed',
      detail: memory.content,
      meta: `${memory.scope || 'memory'} / ${memory.type || 'fact'} / ${memory.status || 'pending'}`,
      timestamp: memory.created_at,
    });
    if (memory.reviewed_at && memory.status !== 'pending') {
      addItem({
        key: `memory-reviewed:${memory.id}:${memory.status}`,
        kind: 'memory',
        tone:
          memory.status === 'approved'
            ? 'success'
            : memory.status === 'rejected'
              ? 'danger'
              : 'warning',
        title: `Memory ${memory.status}`,
        detail: memory.content,
        meta: `${memory.scope || 'memory'} / ${memory.type || 'fact'}`,
        timestamp: memory.reviewed_at,
      });
    }
  }

  for (const draft of Array.isArray(drafts) ? drafts : []) {
    addItem({
      key: `skill-draft-created:${draft.id}`,
      kind: 'skill',
      tone: draft.status === 'pending' ? 'warning' : 'accent',
      title: 'Skill draft proposed',
      detail: draft.description || draft.name,
      meta: `${draft.name} / version ${draft.version || 1} / ${draft.status}`,
      timestamp: draft.createdAt,
      action:
        draft.status === 'pending'
          ? `<button class="btn btn-sm btn-ghost" onclick="navigate('skills');setTimeout(()=>viewSkillDraft('${esc(draft.id)}'),80)">Review</button>`
          : '',
    });
    if (draft.reviewedAt && draft.status !== 'pending') {
      addItem({
        key: `skill-draft-reviewed:${draft.id}:${draft.status}`,
        kind: 'skill',
        tone: draft.status === 'approved' ? 'success' : 'danger',
        title:
          draft.status === 'approved'
            ? 'Skill installed'
            : `Skill ${draft.status}`,
        detail: draft.description || draft.name,
        meta: `${draft.name} / version ${draft.installedVersion || draft.version || 1}`,
        timestamp: draft.reviewedAt,
      });
    }
  }

  const timelineActions = new Set([
    'memory_edit',
    'memory_approved',
    'memory_rejected',
    'memory_marked_stale',
    'memory_marked_contradicted',
    'skill_draft_created',
    'skill_draft_approved',
    'skill_draft_rejected',
    'skill_created',
    'skill_updated',
    'skill_deleted',
    'skill_enabled',
    'skill_disabled',
  ]);
  for (const event of Array.isArray(auditData) ? auditData : []) {
    if (!timelineActions.has(event.action)) continue;
    const isSkill = event.action.startsWith('skill');
    const isDelete = event.action.endsWith('deleted');
    addItem({
      key: `audit:${event.timestamp}:${event.action}:${event.details || ''}`,
      kind: isSkill ? 'skill' : 'memory',
      tone: isDelete ? 'danger' : isSkill ? 'accent' : 'success',
      title: event.action
        .replaceAll('_', ' ')
        .replace(/^\w/, (letter) => letter.toUpperCase()),
      detail: event.details || '',
      meta: `${event.ip || 'dashboard'} / audit`,
      timestamp: event.timestamp,
    });
  }

  return items
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}

function renderTimelineItems(items) {
  if (!items.length) {
    return '<div class="empty" style="padding:12px">No memory or skill changes recorded yet</div>';
  }
  const color = (tone) =>
    tone === 'success'
      ? 'var(--success)'
      : tone === 'danger'
        ? 'var(--error)'
        : tone === 'warning'
          ? 'var(--warning)'
          : 'var(--accent)';
  return `
    <div style="position:relative;padding-left:26px">
      <div style="position:absolute;left:8px;top:0;bottom:0;width:2px;background:var(--border)"></div>
      ${items
        .map(
          (item) => `
        <div style="position:relative;margin-bottom:16px">
          <div style="position:absolute;left:-22px;top:4px;width:11px;height:11px;border-radius:50%;background:${color(item.tone)};box-shadow:0 0 0 4px color-mix(in srgb, ${color(item.tone)} 18%, transparent)"></div>
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
            <div style="min-width:0">
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
                <span class="badge ${item.kind === 'skill' ? 'badge-accent' : 'badge-info'}">${esc(item.kind)}</span>
                <span style="font-size:13px;font-weight:700;color:var(--text)">${esc(item.title)}</span>
              </div>
              <div style="font-size:12px;color:var(--text-muted);line-height:1.45">${esc(item.detail || '')}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${formatTime(item.timestamp)} &middot; ${esc(item.meta || '')}</div>
            </div>
            ${item.action || ''}
          </div>
        </div>`,
        )
        .join('')}
    </div>`;
}

async function renderMemoryKnowledgeTimeline(el) {
  const [auditData, memories, drafts] = await Promise.all([
    api('/audit?limit=150').catch(() => []),
    api('/memory?limit=150').catch(() => []),
    api('/skills/drafts').catch(() => []),
  ]);
  const items = memoryKnowledgeTimelineItems({
    auditData,
    memories,
    drafts,
    limit: 50,
  });
  el.innerHTML = `
    <div class="page-header"><h2>Memory Timeline</h2></div>
    <div class="card">
      <div class="card-title">Memory & Skill Activity</div>
      ${renderTimelineItems(items)}
    </div>`;
}

// Memory
function renderMemoryReviewRows(memories) {
  if (!Array.isArray(memories) || memories.length === 0) {
    return '<div class="empty" style="padding:12px">No pending memory proposals</div>';
  }
  return memories
    .map(
      (m) => `
          <div class="channel-card" style="align-items:flex-start">
            <div style="flex:1;min-width:0">
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:5px">
                <span class="badge badge-accent">${esc(m.scope)}</span>
                <span class="badge badge-muted">${esc(m.type)}</span>
                <span class="badge badge-info">${Math.round((m.confidence || 0) * 100)}%</span>
                <span class="badge badge-muted">${esc(m.visibility)}</span>
                ${(m.review_reasons || [m.status]).map((reason) => `<span class="badge ${reason === 'secret-note' || reason === 'contradiction' ? 'badge-warning' : 'badge-muted'}">${esc(reason)}</span>`).join('')}
              </div>
              <div style="font-size:13px;color:var(--text);line-height:1.45">${esc(m.content)}</div>
              ${
                m.related_memory
                  ? `<div style="font-size:11px;color:var(--warning);margin-top:5px">Conflicts with: ${esc(m.related_memory.content)}</div>`
                  : ''
              }
              ${
                Array.isArray(m.source_links) && m.source_links.length
                  ? `<div style="font-size:11px;color:var(--text-muted);margin-top:5px">${m.source_links.map((link) => `<a style="color:var(--accent)" href="${esc(link)}" target="_blank" rel="noreferrer">${esc(link)}</a>`).join(' · ')}</div>`
                  : ''
              }
              <div style="font-size:11px;color:var(--text-muted);margin-top:5px">${esc(m.source || 'agent proposal')} &middot; ${formatTime(m.created_at)}</div>
            </div>
            <div style="display:flex;gap:5px">
              ${m.status === 'pending' ? `<button class="btn btn-sm btn-primary" onclick="reviewMemoryRecord('${esc(m.id)}','approve')">Approve</button><button class="btn btn-sm btn-ghost" onclick="reviewMemoryRecord('${esc(m.id)}','reject')">Reject</button>` : ''}
              ${m.status === 'approved' ? `<button class="btn btn-sm btn-ghost" onclick="reviewMemoryRecord('${esc(m.id)}','stale')">Mark stale</button><button class="btn btn-sm btn-ghost" onclick="reviewMemoryRecord('${esc(m.id)}','contradicted')">Contradict</button>` : ''}
            </div>
          </div>`,
    )
    .join('');
}

async function renderMemory(el) {
  const [
    memData,
    groups,
    auditData,
    structuredMemories,
    reviewMemories,
    journalEntries,
    drafts,
  ] = await Promise.all([
    api('/files/memory'),
    api('/groups'),
    api('/audit?limit=50').catch(() => []),
    api('/memory?limit=100').catch(() => []),
    api('/memory?review=true&limit=100').catch(() => []),
    api('/journal/entries?limit=10').catch(() => []),
    api('/skills/drafts').catch(() => []),
  ]);

  const timelineItems = memoryKnowledgeTimelineItems({
    auditData,
    memories: structuredMemories,
    drafts,
    limit: 12,
  });

  // Load per-group instruction snippets for context
  const groupMemories = await Promise.all(
    groups.map(async (g) => {
      const data = await api(
        `/files/${encodeURIComponent(g.folder)}/agents-md`,
      ).catch(() => ({ content: '' }));
      return {
        name: g.name,
        folder: g.folder,
        channel: g.channel,
        content: data.content,
      };
    }),
  );
  const pendingMemories = reviewMemories.length
    ? reviewMemories
    : structuredMemories.filter((m) => m.status === 'pending');
  const approvedMemories = structuredMemories
    .filter((m) => m.status === 'approved')
    .slice(0, 8);

  el.innerHTML = `
    <div class="page-header"><h2>Memory</h2></div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">Structured Memory Review <span class="badge badge-muted">${pendingMemories.length} pending</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <select class="input-sm" id="memory-review-reason-filter" onchange="filterMemoryReviewQueue()" style="min-width:135px">
            <option value="">All reasons</option>
            <option value="pending">Pending</option>
            <option value="sensitive">Sensitive</option>
            <option value="secret-note">Secret note</option>
            <option value="stale">Stale</option>
            <option value="expired">Expired</option>
            <option value="contradiction">Contradiction</option>
          </select>
          <select class="input-sm" id="memory-review-sensitivity-filter" onchange="filterMemoryReviewQueue()" style="min-width:135px">
            <option value="">All sensitivity</option>
            <option value="normal">Normal</option>
            <option value="sensitive">Sensitive</option>
            <option value="secret-note">Secret note</option>
          </select>
        </div>
        <div id="memory-review-queue">
        ${renderMemoryReviewRows(pendingMemories)}
        </div>
        ${
          approvedMemories.length
            ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
              <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">Recent approved memories</div>
              ${approvedMemories
                .map(
                  (m) =>
                    `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px"><span class="badge badge-success">${esc(m.type)}</span> ${esc(m.content)}</div>`,
                )
                .join('')}
            </div>`
            : ''
        }
      </div>
      <div class="card">
        <div class="card-title">Journal Summaries</div>
        <div style="border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:12px">
          <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
            <div class="form-group" style="margin:0;flex:1;min-width:220px">
              <label style="font-size:12px;color:var(--text-muted)">Ask Journal</label>
              <input class="search-input" id="journal-question" placeholder="When was the fleet crash?">
            </div>
            <button class="btn btn-sm btn-primary" onclick="askJournalQuestion()">Ask</button>
          </div>
          <div id="journal-answer" style="margin-top:10px;font-size:12px;color:var(--text-secondary)"></div>
        </div>
        <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:12px">
          <div class="form-group" style="margin:0">
            <label style="font-size:12px;color:var(--text-muted)">Group</label>
            <select class="search-input" id="journal-summary-group" style="min-width:150px">
              ${groups.map((g) => `<option value="${esc(g.folder)}">${esc(g.name || g.folder)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:12px;color:var(--text-muted)">Period</label>
            <select class="search-input" id="journal-summary-period" style="min-width:110px">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <button class="btn btn-sm btn-primary" onclick="createJournalSummary()">Generate</button>
          <span id="journal-summary-msg" style="font-size:12px;color:var(--text-muted)"></span>
        </div>
        ${
          journalEntries.length === 0
            ? '<div class="empty" style="padding:12px">No journal summaries recorded yet</div>'
            : journalEntries
                .map(
                  (entry) => `
          <div style="padding:10px 0;border-top:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:5px">
              <strong style="font-size:13px;color:var(--text)">${esc(entry.date)}</strong>
              <span class="badge badge-muted">${esc(entry.scope)}${entry.group_folder ? ` / ${esc(entry.group_folder)}` : ''}</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);white-space:pre-wrap;max-height:110px;overflow:hidden">${esc(entry.summary)}</div>
          </div>`,
                )
                .join('')
        }
      </div>
    </div>
    <div class="grid grid-2">
      <div class="card" style="grid-column:1/-1">
        <div class="card-title">Shared Memory <span class="badge badge-info">Cross-channel</span></div>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">This memory is shared across all channels (WhatsApp, Telegram, Signal). The bot reads it at the start of every conversation and updates it when learning new things about you.</p>
        <textarea id="memory-editor" style="width:100%;min-height:400px;padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:13px;resize:vertical;line-height:1.6">${esc(memData.content || '')}</textarea>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
          <button class="btn btn-primary" onclick="saveMemory()">Save</button>
          <span id="memory-msg" style="font-size:12px"></span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Recent Memory & Skill Activity</div>
      ${renderTimelineItems(timelineItems)}
    </div>
    <div class="card">
      <div class="card-title">Per-Channel Context</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px">Each channel has its own agent instruction file with channel-specific instructions. Edit these in <a style="color:var(--accent);cursor:pointer" onclick="navigate('devhub')">Files</a>.</p>
      <div class="grid grid-3">
        ${groupMemories
          .map(
            (g) => `
          <div class="card" style="margin-bottom:0">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <span style="font-weight:600;color:var(--text)">${esc(g.name)}</span>
              ${g.channel ? `<span class="badge badge-accent">${g.channel}</span>` : ''}
            </div>
            <div style="font-size:12px;color:var(--text-muted);max-height:100px;overflow:hidden;text-overflow:ellipsis">${esc(g.content.slice(0, 200))}${g.content.length > 200 ? '...' : ''}</div>
            <button class="btn btn-sm btn-ghost" style="margin-top:8px" onclick="selectGroup('${esc(g.folder)}');navigate('devhub')">Edit</button>
          </div>`,
          )
          .join('')}
      </div>
    </div>`;
}

window.saveMemory = async () => {
  const content = document.getElementById('memory-editor').value;
  const msg = document.getElementById('memory-msg');
  try {
    const r = await api('/files/memory', {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    if (r.ok) {
      msg.textContent = 'Saved';
      msg.style.color = 'var(--success)';
      toast('Memory saved', 'success');
    } else {
      msg.textContent = r.error || 'Failed';
      msg.style.color = 'var(--error)';
    }
  } catch {
    msg.textContent = 'Error';
    msg.style.color = 'var(--error)';
  }
  setTimeout(() => (msg.textContent = ''), 3000);
};

window.reviewMemoryRecord = async (id, action) => {
  try {
    const r = await api(`/memory/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
    });
    if (r.ok) {
      toast(
        action === 'approve' ? 'Memory approved' : 'Memory rejected',
        'success',
      );
      navigate('memory');
    } else {
      toast(r.error || 'Failed', 'error');
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.filterMemoryReviewQueue = async () => {
  const reason = document.getElementById('memory-review-reason-filter')?.value;
  const sensitivity = document.getElementById(
    'memory-review-sensitivity-filter',
  )?.value;
  const params = new URLSearchParams({ review: 'true', limit: '100' });
  if (reason) params.set('reason', reason);
  if (sensitivity) params.set('sensitivity', sensitivity);
  const target = document.getElementById('memory-review-queue');
  if (!target) return;
  try {
    const memories = await api(`/memory?${params.toString()}`);
    target.innerHTML = renderMemoryReviewRows(memories);
  } catch (e) {
    target.innerHTML = `<div class="empty" style="padding:12px;color:var(--error)">Failed: ${esc(e.message)}</div>`;
  }
};

window.createJournalSummary = async () => {
  const msg = document.getElementById('journal-summary-msg');
  const groupFolder = document.getElementById('journal-summary-group')?.value;
  const period = document.getElementById('journal-summary-period')?.value;
  if (msg) msg.textContent = 'Generating...';
  try {
    const r = await api('/journal/summaries', {
      method: 'POST',
      body: JSON.stringify({ groupFolder, period }),
    });
    if (r.ok) {
      toast(
        `Journal summary created from ${r.messageCount} messages`,
        'success',
      );
      navigate('memory');
    } else {
      toast(r.error || 'Failed', 'error');
      if (msg) msg.textContent = r.error || 'Failed';
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
    if (msg) msg.textContent = e.message;
  }
};

window.askJournalQuestion = async () => {
  const question = document.getElementById('journal-question')?.value.trim();
  const groupFolder = document.getElementById('journal-summary-group')?.value;
  const target = document.getElementById('journal-answer');
  if (!target || !question) return;
  target.innerHTML = '<span class="badge badge-muted">Searching</span>';
  try {
    const result = await api(
      `/journal/search?query=${encodeURIComponent(question)}${groupFolder ? `&group=${encodeURIComponent(groupFolder)}` : ''}`,
    );
    target.innerHTML = `
      <div style="white-space:pre-wrap;color:var(--text);line-height:1.5">${esc(result.answer || 'No answer available.')}</div>
      ${
        result.citations?.length
          ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${result.citations
              .map(
                (citation, index) =>
                  `<span class="badge badge-muted" title="${esc(citation.source)}">${index + 1}. ${esc(citation.type)} ${citation.timestamp ? esc(citation.timestamp.slice(0, 10)) : ''}</span>`,
              )
              .join('')}</div>`
          : ''
      }`;
  } catch (err) {
    target.innerHTML = `<span style="color:var(--error)">${esc(err.message || String(err))}</span>`;
  }
};

// Mounts
async function renderMounts(el) {
  const [allowlist, groups] = await Promise.all([
    api('/mounts'),
    api('/groups'),
  ]);

  el.innerHTML = `
    <div class="page-header"><h2>Repository Mounts</h2></div>
    <div class="card">
      <div class="card-title">Mount Allowlist</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px">Directories the bot is allowed to access. Stored at ~/.config/nanocrab/mount-allowlist.json</p>
      <table id="roots-table">
        <thead><tr><th>Path</th><th>Read/Write</th><th>Description</th><th>Actions</th></tr></thead>
        <tbody>${(allowlist.allowedRoots || [])
          .map(
            (r, i) => `<tr>
          <td><input class="search-input" value="${esc(r.path)}" data-idx="${i}" data-field="path" style="max-width:100%"></td>
          <td><input type="checkbox" ${r.allowReadWrite ? 'checked' : ''} data-idx="${i}" data-field="rw"></td>
          <td><input class="search-input" value="${esc(r.description || '')}" data-idx="${i}" data-field="desc" style="max-width:100%"></td>
          <td><button class="btn btn-sm btn-danger" onclick="removeRoot(${i})">Remove</button></td>
        </tr>`,
          )
          .join('')}
        </tbody>
      </table>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-sm btn-ghost" onclick="addRoot()">Add Root</button>
      </div>
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
        <div class="form-group">
          <label>Blocked Patterns (comma-separated)</label>
          <input class="search-input" id="blocked-patterns" value="${esc((allowlist.blockedPatterns || []).join(', '))}" style="max-width:100%">
        </div>
        <div class="channel-card" style="padding:8px 0">
          <span>Non-main groups forced read-only</span>
          <input type="checkbox" id="non-main-ro" ${allowlist.nonMainReadOnly ? 'checked' : ''}>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
        <button class="btn btn-primary" onclick="saveAllowlist()">Save Allowlist</button>
        <span id="mount-msg" style="font-size:12px"></span>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Per-Group Mounts</div>
      ${
        groups.filter((g) => g.containerConfig?.additionalMounts?.length > 0)
          .length === 0
          ? '<div class="empty">No groups have additional mounts configured. Edit a group\'s containerConfig to add mounts.</div>'
          : groups
              .filter((g) => g.containerConfig?.additionalMounts?.length > 0)
              .map(
                (g) => `
          <div style="margin-bottom:12px">
            <strong style="color:var(--text)">${esc(g.name)}</strong>
            <table><thead><tr><th>Host Path</th><th>Container Path</th><th>Mode</th></tr></thead>
            <tbody>${g.containerConfig.additionalMounts
              .map(
                (m) => `<tr>
              <td style="font-family:var(--mono);font-size:12px">${esc(m.hostPath)}</td>
              <td style="font-family:var(--mono);font-size:12px">${esc(m.containerPath || 'auto')}</td>
              <td><span class="badge ${m.readonly !== false ? 'badge-muted' : 'badge-warning'}">${m.readonly !== false ? 'Read-only' : 'Read-Write'}</span></td>
            </tr>`,
              )
              .join('')}</tbody></table>
          </div>`,
              )
              .join('')
      }
    </div>
    <div class="card">
      <div class="card-title">Validate Path</div>
      <div style="display:flex;gap:8px;align-items:end">
        <div class="form-group" style="flex:1;margin:0"><label>Host path</label><input class="search-input" id="validate-path" placeholder="/home/user/projects/myrepo" style="max-width:100%"></div>
        <button class="btn btn-sm btn-ghost" onclick="validatePath()">Validate</button>
      </div>
      <div id="validate-result" style="margin-top:8px;font-size:12px"></div>
    </div>`;
}

let mountAllowlistData = null;

window.addRoot = () => {
  const tbody = document.querySelector('#roots-table tbody');
  const idx = tbody.children.length;
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input class="search-input" value="" data-idx="${idx}" data-field="path" style="max-width:100%" placeholder="~/projects/myrepo"></td><td><input type="checkbox" data-idx="${idx}" data-field="rw"></td><td><input class="search-input" value="" data-idx="${idx}" data-field="desc" style="max-width:100%"></td><td><button class="btn btn-sm btn-danger" onclick="this.closest('tr').remove()">Remove</button></td>`;
  tbody.appendChild(tr);
};

window.removeRoot = (idx) => {
  const rows = document.querySelectorAll('#roots-table tbody tr');
  if (rows[idx]) rows[idx].remove();
};

window.saveAllowlist = async () => {
  const rows = document.querySelectorAll('#roots-table tbody tr');
  const allowedRoots = [];
  rows.forEach((row) => {
    const path = row.querySelector('[data-field="path"]')?.value;
    if (!path) return;
    allowedRoots.push({
      path,
      allowReadWrite: row.querySelector('[data-field="rw"]')?.checked || false,
      description: row.querySelector('[data-field="desc"]')?.value || '',
    });
  });
  const blockedPatterns = document
    .getElementById('blocked-patterns')
    .value.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const nonMainReadOnly = document.getElementById('non-main-ro').checked;
  const r = await api('/mounts', {
    method: 'PUT',
    body: JSON.stringify({ allowedRoots, blockedPatterns, nonMainReadOnly }),
  });
  const msg = document.getElementById('mount-msg');
  if (r.ok) {
    msg.textContent = 'Saved';
    msg.style.color = 'var(--success)';
    toast('Allowlist saved', 'success');
  } else {
    msg.textContent = r.error || 'Failed';
    msg.style.color = 'var(--error)';
  }
  setTimeout(() => (msg.textContent = ''), 3000);
};

window.validatePath = async () => {
  const hostPath = document.getElementById('validate-path').value;
  if (!hostPath) return;
  const r = await api(
    `/mounts/validate?hostPath=${encodeURIComponent(hostPath)}`,
  );
  const el = document.getElementById('validate-result');
  if (r.valid) {
    el.innerHTML = `<span class="badge badge-success">Valid</span> Resolved: <code>${esc(r.resolvedPath)}</code>`;
  } else {
    el.innerHTML = `<span class="badge badge-error">Invalid</span> ${esc(r.error)}`;
  }
};

// Webhooks
async function renderWebhooks(el) {
  const [config, events, groups, health] = await Promise.all([
    api('/webhooks/config'),
    api('/webhooks/events'),
    api('/groups'),
    api('/webhooks/github-health'),
  ]);
  const webhookUrl = `${window.location.origin}/api/webhooks/github`;

  el.innerHTML = `
    <div class="page-header"><h2>Webhooks</h2></div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">GitHub Webhook</div>
        <div class="form-group">
          <label>Webhook URL</label>
          <div style="display:flex;gap:8px">
            <input class="search-input" value="${esc(webhookUrl)}" readonly style="max-width:100%;flex:1" id="webhook-url">
            <button class="btn btn-sm btn-ghost" onclick="navigator.clipboard.writeText(document.getElementById('webhook-url').value);toast('Copied','success')">Copy</button>
          </div>
        </div>
        <div class="form-group">
          <label>Secret</label>
          <input class="search-input" id="wh-secret" value="${config.secret === '****' ? '' : esc(config.secret || '')}" placeholder="${config.secret === '****' ? 'Set (hidden)' : 'Enter webhook secret'}" type="password" style="max-width:100%">
        </div>
        <div class="form-group">
          <label>Target Group</label>
          <select class="search-input" id="wh-target" style="max-width:100%">
            <option value="">Select a group</option>
            ${groups.map((g) => `<option value="${g.jid}" ${config.targetJid === g.jid ? 'selected' : ''}>${esc(g.name)} (${g.channel || g.folder})</option>`).join('')}
          </select>
        </div>
        <div class="channel-card" style="padding:8px 0">
          <span>Enabled</span>
          <input type="checkbox" id="wh-enabled" ${config.enabled ? 'checked' : ''}>
        </div>
        <button class="btn btn-primary btn-sm" onclick="saveWebhookConfig()">Save</button>
      </div>
      <div class="card">
        <div class="card-title">Setup Instructions</div>
        <ol style="font-size:13px;color:var(--text-secondary);line-height:1.8;padding-left:20px">
          <li>Go to your GitHub repo → Settings → Webhooks → Add webhook</li>
          <li>Paste the Webhook URL above</li>
          <li>Set Content type to <code>application/json</code></li>
          <li>Enter the secret (must match above)</li>
          <li>Select events: Push, Pull requests</li>
          <li>Save and enable the webhook here</li>
        </ol>
      </div>
    </div>
    <div class="card">
      <div class="card-title">GitHub Connector Health <span class="badge ${health.ok ? 'badge-success' : 'badge-warning'}">${health.ok ? 'Ready' : 'Review'}</span></div>
      <div class="grid grid-2">
        <div>
          <div style="display:grid;gap:6px">
            ${health.checks
              .map(
                (
                  check,
                ) => `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                  <div>
                    <div style="font-size:12px;color:var(--text)">${esc(check.label)}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${esc(check.detail)}</div>
                  </div>
                  <span class="badge ${check.ok ? 'badge-success' : 'badge-warning'}">${check.ok ? 'OK' : 'Missing'}</span>
                </div>`,
              )
              .join('')}
          </div>
        </div>
        <div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Recent deliveries: <strong style="color:var(--text)">${health.recentEvents}</strong></div>
          ${
            health.lastEvent
              ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Last: <span class="badge badge-accent">${esc(health.lastEvent.event || 'event')}</span> ${esc(health.lastEvent.repo || '')} ${health.lastEvent.timestamp ? formatTime(health.lastEvent.timestamp) : ''}</div>`
              : '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">No deliveries recorded yet.</div>'
          }
          <ol style="font-size:12px;color:var(--text-secondary);line-height:1.7;padding-left:18px;margin:0">
            ${health.setupSteps.map((step) => `<li>${esc(step)}</li>`).join('')}
          </ol>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Recent Events <span class="badge badge-muted">${events.length}</span></div>
      ${
        events.length === 0
          ? '<div class="empty">No webhook events received yet</div>'
          : `
      <div class="table-wrap" style="max-height:400px;overflow-y:auto"><table>
        <thead><tr><th>Time</th><th>Event</th><th>Repo</th><th>Summary</th><th>Status</th></tr></thead>
        <tbody>${events
          .map(
            (e) => `<tr>
          <td style="white-space:nowrap;font-size:11px">${formatTime(e.timestamp)}</td>
          <td><span class="badge badge-accent">${esc(e.event)}</span></td>
          <td style="font-family:var(--mono);font-size:11px">${esc(e.repo)}</td>
          <td style="font-size:12px;max-width:300px;overflow:hidden;text-overflow:ellipsis">${esc(e.summary)}</td>
          <td><span class="badge badge-success">${esc(e.status)}</span></td>
        </tr>`,
          )
          .join('')}</tbody>
      </table></div>
      <button class="btn btn-sm btn-danger" style="margin-top:8px" onclick="clearWebhookEvents()">Clear Events</button>`
      }
    </div>`;
}

window.saveWebhookConfig = async () => {
  const secret = document.getElementById('wh-secret').value;
  const targetJid = document.getElementById('wh-target').value;
  const enabled = document.getElementById('wh-enabled').checked;
  const r = await api('/webhooks/config', {
    method: 'PUT',
    body: JSON.stringify({ enabled, secret: secret || undefined, targetJid }),
  });
  if (r.ok) toast('Webhook config saved', 'success');
  else toast(r.error || 'Failed', 'error');
};

window.clearWebhookEvents = async () => {
  await api('/webhooks/events', { method: 'DELETE' });
  toast('Events cleared', 'success');
  navigate('webhooks');
};

// Terminal
async function renderTerminal(el) {
  if ((window._userRole || 'owner') !== 'owner') {
    el.innerHTML =
      '<div class="card"><div class="empty">Terminal access requires owner role.</div></div>';
    return;
  }
  el.innerHTML = `
    <div class="page-header"><h2>Terminal</h2></div>
    <div class="card" style="padding:0;overflow:hidden">
      <div style="display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border);background:var(--surface2);flex-wrap:wrap">
        <input class="search-input" id="terminal-session-id" value="${esc(localStorage.getItem('terminal_session_id') || 'term-' + Math.random().toString(36).slice(2, 8))}" style="max-width:180px;padding:5px 8px;font-family:var(--mono);font-size:12px">
        <button class="btn btn-sm btn-ghost" onclick="reconnectTerminal()">Reconnect</button>
        <button class="btn btn-sm btn-ghost" onclick="clearTerminal()">Clear</button>
        <button class="btn btn-sm btn-ghost" onclick="copyTerminalTranscript()">Copy Transcript</button>
        <span style="font-size:11px;color:var(--text-muted)">Owner-only shell in the NanoCrab process working directory</span>
      </div>
      <div id="terminal-container" style="height:500px;background:#09090b"></div>
    </div>
    <div class="card">
      <div class="card-title">Transcript Search</div>
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:12px">
        <input class="search-input" id="terminal-search-query" placeholder="Search terminal transcripts" style="min-width:240px;flex:1">
        <button class="btn btn-sm btn-ghost" onclick="searchTerminalTranscripts()">Search</button>
        <button class="btn btn-sm btn-ghost" onclick="loadTerminalHistory()">History</button>
      </div>
      <div id="terminal-search-results" style="font-size:12px;color:var(--text-muted)"></div>
    </div>`;

  // Load xterm.js from CDN
  await loadCss(
    'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css',
  );
  await loadScript(
    'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js',
  );
  await loadScript(
    'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js',
  );

  const term = new window.Terminal({
    cursorBlink: true,
    fontSize: 13,
    lineHeight: 1.1,
    fontFamily: "'JetBrains Mono', 'Consolas', monospace",
    theme: { background: '#09090b', foreground: '#e1e4ed', cursor: '#43a79a' },
  });
  const fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal-container'));
  setTimeout(() => fitAddon.fit(), 100);

  const sessionId = document.getElementById('terminal-session-id').value;
  localStorage.setItem('terminal_session_id', sessionId);
  activeTerminal = { sessionId, term, transcript: '' };

  // Wait for WS to be ready, reconnect if needed
  const spawnTerminal = () => {
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify({ type: 'terminal_spawn', data: sessionId }));
      return;
    }
    term.write('Connecting...\r\n');
    connectWs();
    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      if (ws?.readyState === 1) {
        clearInterval(check);
        ws.send(JSON.stringify({ type: 'terminal_spawn', data: sessionId }));
      } else if (attempts > 20) {
        clearInterval(check);
        term.write('\r\nFailed to connect. Check WebSocket.\r\n');
      }
    }, 500);
  };
  window._spawnTerminalSession = spawnTerminal;
  spawnTerminal();

  term.onData((data) => {
    if (ws?.readyState === 1)
      ws.send(JSON.stringify({ type: 'terminal_input', sessionId, data }));
  });

  const container = document.getElementById('terminal-container');
  if (container) new ResizeObserver(() => fitAddon.fit()).observe(container);
}

window.reconnectTerminal = function () {
  const sessionId = document.getElementById('terminal-session-id')?.value;
  if (!sessionId || !activeTerminal) return;
  localStorage.setItem('terminal_session_id', sessionId);
  activeTerminal.sessionId = sessionId;
  activeTerminal.transcript = '';
  activeTerminal.term.reset();
  if (typeof window._spawnTerminalSession === 'function') {
    window._spawnTerminalSession();
  }
};

window.clearTerminal = function () {
  if (!activeTerminal) return;
  activeTerminal.transcript = '';
  activeTerminal.term.clear();
};

window.copyTerminalTranscript = async function () {
  if (!activeTerminal) return;
  try {
    await navigator.clipboard.writeText(activeTerminal.transcript || '');
    toast('Terminal transcript copied', 'success');
  } catch {
    toast('Clipboard access failed', 'error');
  }
};

window.loadTerminalHistory = async function () {
  const target = document.getElementById('terminal-search-results');
  if (!target) return;
  const result = await api('/sessions/terminal/history');
  const sessions = result.sessions || [];
  target.innerHTML = sessions.length
    ? sessions
        .map(
          (
            session,
          ) => `<div style="padding:8px 0;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:12px">
            <div><strong style="color:var(--text)">${esc(session.sessionId)}</strong><div>${esc(session.owner)} · ${session.eventCount} events · ${Math.max(1, Math.round(session.transcriptBytes / 1024))} KB</div></div>
            <div style="text-align:right">${timeAgo(session.lastActivity)}</div>
          </div>`,
        )
        .join('')
    : '<div class="empty" style="padding:12px">No persisted terminal transcripts</div>';
};

window.searchTerminalTranscripts = async function () {
  const target = document.getElementById('terminal-search-results');
  const query = document.getElementById('terminal-search-query')?.value.trim();
  if (!target || !query) return;
  const result = await api(
    `/sessions/terminal/search?query=${encodeURIComponent(query)}&limit=25`,
  );
  const hits = result.hits || [];
  target.innerHTML = hits.length
    ? hits
        .map(
          (
            hit,
          ) => `<div style="padding:8px 0;border-top:1px solid var(--border)">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
              <span class="badge badge-muted">${esc(hit.sessionId)}</span>
              <span class="badge badge-info">${esc(hit.type)}</span>
              <span>${esc(hit.owner)} · ${timeAgo(hit.timestamp)}</span>
            </div>
            <pre style="white-space:pre-wrap;margin:0;color:var(--text);font-size:11px">${esc(hit.snippet)}</pre>
          </div>`,
        )
        .join('')
    : '<div class="empty" style="padding:12px">No transcript matches</div>';
};

// Editor
async function renderEditor(el) {
  const repos = await api('/files/repos');
  if (repos.length === 0) {
    el.innerHTML = `<div class="page-header"><h2>Code Editor</h2></div><div class="card empty">No repositories mounted. Add mounts in the <a style="color:var(--accent);cursor:pointer" onclick="navigate('devhub')">Dev Hub &gt; Mounts</a> tab, then add them to a group's container config.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="page-header"><h2>Code Editor</h2>
      <select class="search-input" id="editor-repo" style="max-width:250px">
        ${repos.map((r) => `<option value="${r.name}">${esc(r.name)} ${r.readonly ? '(readonly)' : ''}</option>`).join('')}
      </select>
    </div>
    <div class="editor-layout" style="display:flex;gap:16px;height:calc(100vh - 200px)">
      <div style="width:250px;overflow-y:auto;flex-shrink:0" class="card" id="editor-tree"><div class="loading">Loading</div></div>
      <div style="flex:1;display:flex;flex-direction:column">
        <div class="card" style="flex:1;padding:0;overflow:hidden;position:relative">
          <div id="editor-container" style="height:100%"></div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <button class="btn btn-primary btn-sm" id="editor-save" onclick="saveEditorFile()" style="display:none">Save</button>
          <span id="editor-path" style="font-family:var(--mono);font-size:12px;color:var(--text-muted)"></span>
          <span id="editor-msg" style="font-size:12px;margin-left:auto"></span>
        </div>
        <div class="card" style="margin-top:8px;max-height:120px;overflow-y:auto" id="editor-git"></div>
      </div>
    </div>`;

  let currentRepo = repos[0].name;
  let currentPath = '';
  let monacoEditor = null;

  document.getElementById('editor-repo').onchange = (e) => {
    currentRepo = e.target.value;
    loadTree();
    loadGit();
  };

  async function loadTree() {
    const tree = await api(
      `/files/repos/${encodeURIComponent(currentRepo)}/tree`,
    );
    document.getElementById('editor-tree').innerHTML =
      `<div class="card-title" style="padding:12px 12px 0">${esc(currentRepo)}</div>` +
      renderTree(tree, '');
  }

  function renderTree(items, prefix) {
    return items
      .map((item) => {
        const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.type === 'dir') {
          return `<details style="padding-left:12px"><summary style="cursor:pointer;padding:3px 0;font-size:12px;color:var(--text-secondary)">\uD83D\uDCC1 ${esc(item.name)}</summary>${renderTree(item.children || [], fullPath)}</details>`;
        }
        return `<div style="padding:3px 0 3px 12px;font-size:12px;cursor:pointer;color:var(--text-muted)" onclick="openEditorFile('${esc(currentRepo)}','${esc(fullPath)}')" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text-muted)'">\uD83D\uDCC4 ${esc(item.name)}</div>`;
      })
      .join('');
  }

  async function loadGit() {
    const git = await api(
      `/files/repos/${encodeURIComponent(currentRepo)}/git`,
    ).catch(() => ({ status: [], log: [], branch: '' }));
    document.getElementById('editor-git').innerHTML = `
      <div class="card-title">Git ${git.branch ? `(${esc(git.branch)})` : ''}</div>
      <div style="font-size:11px;font-family:var(--mono);color:var(--text-muted)">${git.status.length > 0 ? git.status.map((s) => esc(s)).join('\n') : 'Clean'}</div>`;
  }

  window.openEditorFile = async (repo, filePath) => {
    currentRepo = repo;
    currentPath = filePath;
    const data = await api(
      `/files/repos/${encodeURIComponent(repo)}/file?path=${encodeURIComponent(filePath)}`,
    );
    document.getElementById('editor-path').textContent = filePath;
    document.getElementById('editor-save').style.display = data.readonly
      ? 'none'
      : '';

    // Use a simple textarea if Monaco isn't loaded
    const container = document.getElementById('editor-container');
    container.innerHTML = `<textarea style="width:100%;height:100%;padding:12px;background:var(--bg);color:var(--text);border:none;font-family:var(--mono);font-size:13px;resize:none;outline:none">${esc(data.content)}</textarea>`;
  };

  window.saveEditorFile = async () => {
    const textarea = document.querySelector('#editor-container textarea');
    if (!textarea || !currentPath) return;
    const r = await api(
      `/files/repos/${encodeURIComponent(currentRepo)}/file?path=${encodeURIComponent(currentPath)}`,
      { method: 'PUT', body: JSON.stringify({ content: textarea.value }) },
    );
    const msg = document.getElementById('editor-msg');
    if (r.ok) {
      msg.textContent = 'Saved';
      msg.style.color = 'var(--success)';
      toast('File saved', 'success');
      loadGit();
    } else {
      msg.textContent = r.error || 'Failed';
      msg.style.color = 'var(--error)';
    }
    setTimeout(() => (msg.textContent = ''), 3000);
  };

  loadTree();
  loadGit();
}

// Logs
async function renderLogs(el) {
  const [sysLog, errLog] = await Promise.all([
    api('/logs/system?lines=150'),
    api('/logs/errors?lines=50'),
  ]);
  el.innerHTML = `
    <div class="page-header"><h2>Logs</h2><div style="display:flex;gap:8px"><button class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Refresh</button></div></div>
    <div class="card"><div class="card-title"><span class="live-dot"></span>System Log</div><div class="log-viewer" id="live-log">${colorizeLog(sysLog.lines)}</div></div>
    <div class="card"><div class="card-title">Error Log</div><div class="log-viewer">${errLog.lines.length ? colorizeLog(errLog.lines) : 'No errors'}</div></div>`;
  document
    .querySelectorAll('.log-viewer')
    .forEach((el) => (el.scrollTop = el.scrollHeight));
  // Subscribe to live logs
  if (ws?.readyState === 1)
    ws.send(JSON.stringify({ type: 'subscribe_logs', data: 'system' }));
}

function colorizeLog(lines) {
  return lines
    .map((l) => {
      if (!l) return '';
      const escaped = esc(l.replace(/\x1b\[[0-9;]*m/g, ''));
      if (escaped.includes('ERROR'))
        return `<span class="log-error">${escaped}</span>`;
      if (escaped.includes('WARN'))
        return `<span class="log-warn">${escaped}</span>`;
      if (escaped.includes('INFO'))
        return `<span class="log-info">${escaped}</span>`;
      return escaped;
    })
    .join('\n');
}

// System
async function renderSystem(el) {
  const [sys, health, diagnostics, firstRun, inference] = await Promise.all([
    api('/system'),
    api('/system/health'),
    api('/system/install-diagnostics'),
    api('/system/first-run-readiness').catch(() => ({
      overall: 'warn',
      failed: 0,
      warnings: 0,
      productName: 'NanoCrab',
      headline: 'First-run readiness unavailable',
      checks: [],
      setupSteps: [],
      secretPolicy:
        'Credential values are never returned through setup readiness APIs.',
    })),
    api('/system/inference-health').catch(() => ({
      summary: {
        total: 0,
        healthy: 0,
        degraded: 0,
        local: 0,
        remote: 0,
        stale: 0,
      },
      items: [],
    })),
  ]);
  const memPct = ((sys.memory.heapUsed / sys.memory.heapTotal) * 100).toFixed(
    1,
  );
  const sysMem = (
    (1 - sys.system.freeMemory / sys.system.totalMemory) *
    100
  ).toFixed(1);

  el.innerHTML = `
    <div class="page-header"><h2>System</h2>
      <div style="display:flex;gap:8px">
        <span class="badge ${health.overall === 'healthy' ? 'badge-success' : 'badge-warning'}">${health.overall}</span>
        <button class="btn btn-sm btn-danger" onclick="restartService(this)">Restart Service</button>
      </div>
    </div>
    <div class="grid grid-4">
      <div class="card stat"><div class="stat-value">${sys.uptimeFormatted}</div><div class="stat-label">Uptime</div></div>
      <div class="card stat"><div class="stat-value">${memPct}%</div><div class="stat-label">Heap</div></div>
      <div class="card stat"><div class="stat-value">${sysMem}%</div><div class="stat-label">System RAM</div></div>
      <div class="card stat"><div class="stat-value">${sys.system.loadAvg[0].toFixed(1)}</div><div class="stat-label">Load (1m)</div></div>
    </div>
    <div class="grid grid-2">
      <div class="card"><div class="card-title">Process</div><table>
        <tr><td>Node.js</td><td style="color:var(--text)">${sys.nodeVersion}</td></tr>
        <tr><td>Started</td><td style="color:var(--text)">${formatTime(sys.startedAt)}</td></tr>
        <tr><td>RSS</td><td style="color:var(--text)">${formatBytes(sys.memory.rss)}</td></tr>
        <tr><td>Heap</td><td style="color:var(--text)">${formatBytes(sys.memory.heapUsed)} / ${formatBytes(sys.memory.heapTotal)}</td></tr>
      </table></div>
      <div class="card"><div class="card-title">Host</div><table>
        <tr><td>Platform</td><td style="color:var(--text)">${sys.platform} ${sys.arch}</td></tr>
        <tr><td>CPUs</td><td style="color:var(--text)">${sys.system.cpus}</td></tr>
        <tr><td>Memory</td><td style="color:var(--text)">${formatBytes(sys.system.freeMemory)} free / ${formatBytes(sys.system.totalMemory)}</td></tr>
        <tr><td>Load</td><td style="color:var(--text)">${sys.system.loadAvg.map((l) => l.toFixed(2)).join(', ')}</td></tr>
        ${sys.system.disk ? `<tr><td>Disk</td><td style="color:var(--text)">${formatBytes(sys.system.disk.free)} free / ${formatBytes(sys.system.disk.total)} (${sys.system.disk.percent}% used)</td></tr>` : ''}
      </table></div>
    </div>
    <div class="card">
      <div class="card-title">First-Run Setup <span class="badge ${firstRun.overall === 'pass' ? 'badge-success' : firstRun.overall === 'warn' ? 'badge-warning' : 'badge-error'}">${firstRun.overall}</span></div>
      <div style="display:grid;grid-template-columns:minmax(180px,260px) 1fr;gap:16px;align-items:start">
        <div>
          <div style="font-family:monospace;white-space:pre;font-size:10px;line-height:1.15;color:var(--accent);overflow:auto">${esc((firstRun.asciiArt || []).join('\n'))}</div>
          <div style="font-size:12px;color:var(--text);margin-top:8px">${esc(firstRun.productName || 'NanoCrab')}</div>
          <div style="font-size:11px;color:var(--text-muted)">${esc(firstRun.headline || '')}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:8px">${esc(firstRun.secretPolicy || '')}</div>
        </div>
        <div style="display:grid;gap:14px">
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Readiness Checks</div>
            <div style="display:grid;gap:6px">
              ${(firstRun.checks || [])
                .map(
                  (
                    item,
                  ) => `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-top:1px solid var(--border);padding-top:6px">
                    <div>
                      <div style="font-size:12px;color:var(--text)">${esc(item.label)} ${item.required ? '<span class="badge badge-muted">Required</span>' : ''}</div>
                      <div style="font-size:11px;color:var(--text-muted)">${esc(item.detail)}</div>
                      ${item.status === 'pass' || !item.remediation ? '' : `<div style="font-size:11px;color:var(--warning);margin-top:2px">${esc(item.remediation)}</div>`}
                      ${item.status === 'pass' || !item.resumeNote ? '' : `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">Resume: ${esc(item.resumeNote)}</div>`}
                    </div>
                    <span class="badge ${item.status === 'pass' ? 'badge-success' : item.status === 'warn' ? 'badge-warning' : 'badge-error'}">${item.status}</span>
                  </div>`,
                )
                .join('')}
            </div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Clean VPS Path</div>
            <div style="display:grid;gap:6px">
              ${(firstRun.setupSteps || [])
                .map(
                  (
                    step,
                  ) => `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
                    <div>
                      <div style="font-size:12px;color:var(--text)">${esc(step.label)}</div>
                      <code style="font-size:11px;color:var(--text-muted)">${esc(step.command)}</code>
                    </div>
                    <span class="badge ${step.required ? 'badge-info' : 'badge-muted'}">${step.required ? 'Required' : 'Optional'}</span>
                  </div>`,
                )
                .join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Install Diagnostics <span class="badge ${diagnostics.overall === 'pass' ? 'badge-success' : diagnostics.overall === 'warn' ? 'badge-warning' : 'badge-error'}">${diagnostics.overall}</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Runtime Checks</div>
          <div style="display:grid;gap:6px">
            ${diagnostics.diagnostics
              .map(
                (
                  item,
                ) => `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                  <div>
                    <div style="font-size:12px;color:var(--text)">${esc(item.label)}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${esc(item.detail)}</div>
                    ${item.status === 'pass' || !item.remediation ? '' : `<div style="font-size:11px;color:var(--warning);margin-top:2px">${esc(item.remediation)}</div>`}
                  </div>
                  <span class="badge ${item.status === 'pass' ? 'badge-success' : item.status === 'warn' ? 'badge-warning' : 'badge-error'}">${item.status}</span>
                </div>`,
              )
              .join('')}
          </div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Release Checklist</div>
          <div style="display:grid;gap:8px">
            ${diagnostics.releaseChecklist
              .map(
                (
                  item,
                ) => `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                  <div>
                    <div style="font-size:12px;color:var(--text)">${esc(item.label)}</div>
                    <code style="font-size:11px;color:var(--text-muted)">${esc(item.command)}</code>
                  </div>
                  <span class="badge ${item.ok ? 'badge-success' : 'badge-warning'}">${item.ok ? 'Done' : 'Needed'}</span>
                </div>`,
              )
              .join('')}
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Inference Health <span class="badge ${inference.summary.degraded ? 'badge-warning' : 'badge-success'}">${inference.summary.healthy}/${inference.summary.total} healthy</span></div>
      <div class="grid grid-4" style="margin-bottom:12px">
        <div><div style="font-size:11px;color:var(--text-muted)">Local</div><div style="font-size:20px;font-weight:600">${inference.summary.local}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Remote</div><div style="font-size:20px;font-weight:600">${inference.summary.remote}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Stale</div><div style="font-size:20px;font-weight:600;color:var(--warning)">${inference.summary.stale}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Degraded</div><div style="font-size:20px;font-weight:600;color:var(--warning)">${inference.summary.degraded}</div></div>
      </div>
      <div style="display:grid;gap:8px">
        ${(inference.items || [])
          .map(
            (
              item,
            ) => `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-top:1px solid var(--border);padding-top:8px">
              <div>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                  <strong style="font-size:12px;color:var(--text)">${esc(item.label)}</strong>
                  <span class="badge badge-muted">${esc(item.provider)}/${esc(item.model)}</span>
                  <span class="badge badge-info">${esc(item.locality)}</span>
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${esc((item.failedChecks || [])[0] || item.toolPolicy || 'Ready')}</div>
              </div>
              <span class="badge ${item.status === 'healthy' ? 'badge-success' : item.status === 'unconfigured' ? 'badge-error' : 'badge-warning'}">${esc(item.status)}</span>
            </div>`,
          )
          .join('')}
      </div>
    </div>
    <div class="card"><div class="card-title">Channel Health</div>
      ${health.channels.map((ch) => `<div class="channel-card"><div class="channel-info"><span class="status-dot ${ch.connected ? 'online' : 'offline'}"></span><span class="channel-name">${ch.name}</span></div><span class="badge ${ch.status === 'healthy' ? 'badge-success' : 'badge-error'}">${ch.status}</span></div>`).join('')}
    </div>`;
}

async function renderSecurity(el) {
  const [allowlist, audit, health] = await Promise.all([
    api('/allowlist'),
    api('/audit?limit=50'),
    api('/system/health'),
  ]);

  // Security checks
  const checks = [
    {
      name: 'HTTPS / TLS',
      status: location.protocol === 'https:',
      desc: "Traffic encrypted via Caddy with auto-renewing Let's Encrypt certificate",
    },
    {
      name: 'Session Cookies',
      status: true,
      desc: 'HttpOnly, Secure, SameSite=Strict, 7-day expiry',
    },
    {
      name: 'Password Hashing',
      status: true,
      desc: 'bcrypt with 12 rounds, stored in .env (never committed)',
    },
    {
      name: 'Rate Limiting',
      status: true,
      desc: '5 login attempts per IP, 15-minute lockout after exceeded',
    },
    {
      name: 'Security Headers',
      status: true,
      desc: 'HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Permissions-Policy',
    },
    {
      name: 'Audit Logging',
      status: audit.length > 0 || true,
      desc: 'All admin actions logged to logs/admin-audit.log',
    },
    {
      name: 'IP Allowlist',
      status: allowlist.enabled,
      desc: allowlist.enabled
        ? `Enabled — ${allowlist.ips.length} IP${allowlist.ips.length !== 1 ? 's' : ''} allowed`
        : 'Disabled — all IPs can access the dashboard',
    },
    {
      name: 'Container Sandbox',
      status: true,
      desc: 'Agents run in isolated Docker containers with read-only project mounts',
    },
    {
      name: 'Credential Isolation',
      status: true,
      desc: '.env is shadow-mounted as /dev/null in containers — agents cannot read host secrets',
    },
    {
      name: 'MCP Restrictions',
      status: true,
      desc: 'Per-group allowlist controls which MCP servers and credentials are available',
    },
    {
      name: 'Channel Health',
      status: health.overall === 'healthy',
      desc:
        health.overall === 'healthy'
          ? 'All channels connected'
          : 'Some channels are down',
    },
  ];

  const passCount = checks.filter((c) => c.status).length;
  const totalCount = checks.length;
  const score = Math.round((passCount / totalCount) * 100);

  // Failed login attempts from audit
  const failedLogins = audit.filter((a) => a.action === 'login_failed');
  const recentBlocked = audit.filter((a) => a.action === 'ip_blocked');

  el.innerHTML = `
    <div class="page-header"><h2>Security</h2></div>
    <div class="grid grid-3">
      <div class="card stat">
        <div class="stat-value" style="color:${score >= 90 ? 'var(--success)' : score >= 70 ? 'var(--warning)' : 'var(--error)'}">${score}%</div>
        <div class="stat-label">Security Score</div>
      </div>
      <div class="card stat">
        <div class="stat-value">${passCount}<span style="font-size:16px;color:var(--text-muted)">/${totalCount}</span></div>
        <div class="stat-label">Checks Passing</div>
      </div>
      <div class="card stat">
        <div class="stat-value" style="color:${failedLogins.length > 0 ? 'var(--warning)' : 'var(--success)'}">${failedLogins.length}</div>
        <div class="stat-label">Failed Logins (recent)</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Security Checks</div>
      ${checks
        .map(
          (c) => `
        <div style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
          <span class="status-dot ${c.status ? 'online' : 'offline'}" style="margin-top:6px;flex-shrink:0"></span>
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px;color:var(--text)">${esc(c.name)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${esc(c.desc)}</div>
          </div>
          <span class="badge ${c.status ? 'badge-success' : 'badge-warning'}">${c.status ? 'Pass' : 'Action needed'}</span>
        </div>`,
        )
        .join('')}
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">IP Allowlist</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <span class="badge ${allowlist.enabled ? 'badge-success' : 'badge-warning'}">${allowlist.enabled ? 'Enabled' : 'Disabled'}</span>
          <button class="btn btn-sm ${allowlist.enabled ? 'btn-danger' : 'btn-success'}" id="sec-allowlist-toggle">${allowlist.enabled ? 'Disable' : 'Enable'}</button>
        </div>
        <div class="form-group">
          <label>Allowed IPs (one per line, supports CIDR notation like 192.168.1.0/24)</label>
          <textarea id="sec-allowlist-ips" style="width:100%;min-height:80px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical">${allowlist.ips.join('\n')}</textarea>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-primary btn-sm" id="sec-allowlist-save">Save</button>
          <span id="sec-allowlist-msg" style="font-size:12px"></span>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Recommendations</div>
        ${!allowlist.enabled ? `<div style="padding:10px;background:var(--warning-bg);border-radius:var(--radius-sm);font-size:12px;color:var(--warning);margin-bottom:8px">Consider enabling the IP allowlist to restrict dashboard access to your IP only.</div>` : ''}
        <div style="padding:10px;background:var(--info-bg);border-radius:var(--radius-sm);font-size:12px;color:var(--info);margin-bottom:8px">Rotate API keys periodically (Anthropic, fal.ai, OpenAI) — manage in <a style="color:var(--accent);cursor:pointer" onclick="navigate('credentials')">Credentials</a>.</div>
        <div style="padding:10px;background:var(--info-bg);border-radius:var(--radius-sm);font-size:12px;color:var(--info);margin-bottom:8px">Change your admin password regularly in <a style="color:var(--accent);cursor:pointer" onclick="navigate('settings')">Settings</a>.</div>
        <div style="padding:10px;background:var(--info-bg);border-radius:var(--radius-sm);font-size:12px;color:var(--info)">Enable SSH key-only auth and disable password login on the server.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Audit Log</div>
      ${
        audit.length === 0
          ? '<div class="empty">No audit entries yet</div>'
          : `
      <div class="table-wrap" style="max-height:400px;overflow-y:auto">
        <table>
          <thead><tr><th>Time</th><th>Action</th><th>IP</th><th>Details</th><th>Device</th></tr></thead>
          <tbody>${audit
            .map(
              (a) => `<tr>
            <td style="white-space:nowrap;font-size:11px">${formatTime(a.timestamp)}</td>
            <td><span class="badge ${a.action.includes('fail') || a.action.includes('block') ? 'badge-error' : a.action.includes('success') || a.action.includes('changed') || a.action.includes('enabled') ? 'badge-success' : 'badge-muted'}">${esc(a.action)}</span></td>
            <td style="font-family:var(--mono);font-size:11px">${esc(a.ip)}</td>
            <td style="font-size:11px;max-width:250px;overflow:hidden;text-overflow:ellipsis">${esc(a.details || '')}</td>
            <td style="font-size:10px;max-width:150px;overflow:hidden;text-overflow:ellipsis;color:var(--text-muted)">${esc((a.userAgent || '').slice(0, 60))}</td>
          </tr>`,
            )
            .join('')}</tbody>
        </table>
      </div>`
      }
    </div>

    <div class="card" id="unregistered-section">
      <div class="card-title">Unregistered Conversations</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Conversations that have messaged the bot but are not registered as groups.</p>
      <div id="unregistered-list"><div class="loading">Loading</div></div>
    </div>`;

  // Load unregistered conversations
  loadUnregisteredConversations();

  // Allowlist handlers
  document.getElementById('sec-allowlist-toggle').onclick = async () => {
    const ips = document
      .getElementById('sec-allowlist-ips')
      .value.trim()
      .split('\n')
      .filter(Boolean);
    const newEnabled = !allowlist.enabled;
    if (newEnabled && ips.length === 0) {
      toast('Add at least one IP before enabling', 'warning');
      return;
    }
    await api('/allowlist', {
      method: 'PUT',
      body: JSON.stringify({ enabled: newEnabled, ips }),
    });
    toast(
      newEnabled ? 'IP allowlist enabled' : 'IP allowlist disabled',
      'success',
    );
    navigate('security');
  };
  document.getElementById('sec-allowlist-save').onclick = async () => {
    const ips = document
      .getElementById('sec-allowlist-ips')
      .value.trim()
      .split('\n')
      .filter(Boolean);
    await api('/allowlist', {
      method: 'PUT',
      body: JSON.stringify({ enabled: allowlist.enabled, ips }),
    });
    const m = document.getElementById('sec-allowlist-msg');
    m.textContent = 'Saved';
    m.style.color = 'var(--success)';
    setTimeout(() => (m.textContent = ''), 2000);
  };
}

async function loadUnregisteredConversations() {
  const listEl = document.getElementById('unregistered-list');
  if (!listEl) return;
  try {
    const data = await api('/system/unregistered');
    const chats = data.chats || [];
    const messages = data.messages || [];
    if (chats.length === 0) {
      listEl.innerHTML =
        '<div class="empty">No unregistered conversations found</div>';
      return;
    }

    // Group messages by chat_jid
    const msgByChat = {};
    for (const m of messages) {
      if (!msgByChat[m.chat_jid]) msgByChat[m.chat_jid] = [];
      msgByChat[m.chat_jid].push(m);
    }

    listEl.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Channel</th><th>JID</th><th>Last Activity</th><th>Type</th><th>Actions</th></tr></thead>
        <tbody>${chats
          .map(
            (c) => `<tr>
          <td style="color:var(--text);font-weight:500">${esc(c.name)}</td>
          <td><span class="badge badge-accent">${esc(c.channel)}</span></td>
          <td style="font-family:var(--mono);font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(c.jid)}</td>
          <td>${c.lastActivity ? timeAgo(c.lastActivity) : '-'}</td>
          <td><span class="badge ${c.isGroup ? 'badge-info' : 'badge-muted'}">${c.isGroup ? 'Group' : 'DM'}</span></td>
          <td><button class="btn btn-sm btn-ghost" onclick="toggleUnregMessages('${esc(c.jid)}')">Messages</button> <button class="btn btn-sm btn-primary" onclick="navigate('groups')">Register</button></td>
        </tr>
        <tr id="unreg-msgs-${esc(c.jid).replace(/[^a-zA-Z0-9]/g, '_')}" style="display:none">
          <td colspan="6" style="padding:0">
            <div style="max-height:200px;overflow-y:auto;padding:8px 14px;background:var(--bg);border-radius:var(--radius-sm);margin:4px 0">
              ${
                (msgByChat[c.jid] || []).length === 0
                  ? '<span style="color:var(--text-muted);font-size:12px">No stored messages</span>'
                  : (msgByChat[c.jid] || [])
                      .map(
                        (
                          m,
                        ) => `<div class="message" style="padding:6px 0;border-bottom:1px solid var(--border)">
                  <div class="message-meta"><span class="message-sender">${esc(m.sender_name)}</span><span>${formatTime(m.timestamp)}</span></div>
                  <div class="message-content" style="font-size:12px">${esc(m.content?.slice(0, 300) || '')}</div>
                </div>`,
                      )
                      .join('')
              }
            </div>
          </td>
        </tr>`,
          )
          .join('')}</tbody>
      </table></div>`;
  } catch {
    listEl.innerHTML =
      '<div class="empty">Failed to load unregistered conversations</div>';
  }
}

window.toggleUnregMessages = (jid) => {
  const id = 'unreg-msgs-' + jid.replace(/[^a-zA-Z0-9]/g, '_');
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
};

// Usage
async function renderUsage(el) {
  el.innerHTML = '<div class="loading">Loading usage data</div>';
  try {
    const data = await api('/usage');
    const fmtTokens = (n) => {
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
      if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
      return n.toString();
    };
    const fmtCost = (c) => '$' + c.toFixed(4);
    const fmtCostBig = (c) =>
      c >= 1 ? '$' + c.toFixed(2) : '$' + c.toFixed(4);

    // Aggregate daily data into periods
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const periods = {
      today: { label: 'Today', filter: (d) => d.date === today },
      week: {
        label: 'This Week',
        filter: (d) => {
          const dt = new Date(d.date);
          const weekAgo = new Date(now);
          weekAgo.setDate(weekAgo.getDate() - 7);
          return dt >= weekAgo;
        },
      },
      month: {
        label: 'This Month',
        filter: (d) => d.date.slice(0, 7) === today.slice(0, 7),
      },
      year: {
        label: 'This Year',
        filter: (d) => d.date.slice(0, 4) === today.slice(0, 4),
      },
      all: { label: 'All Time', filter: () => true },
    };

    const periodSummaries = {};
    for (const [key, p] of Object.entries(periods)) {
      const filtered = data.daily.filter(p.filter);
      const sum = {
        input: 0,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
        cost: 0,
        days: filtered.length,
      };
      for (const d of filtered) {
        sum.input += d.input;
        sum.output += d.output;
        sum.cacheWrite += d.cacheWrite;
        sum.cacheRead += d.cacheRead;
        sum.cost += d.estimatedCost;
      }
      periodSummaries[key] = sum;
    }

    // Monthly aggregation for table
    const monthlyMap = {};
    for (const d of data.daily) {
      const month = d.date.slice(0, 7);
      if (!monthlyMap[month])
        monthlyMap[month] = {
          input: 0,
          output: 0,
          cacheWrite: 0,
          cacheRead: 0,
          cost: 0,
          days: 0,
        };
      monthlyMap[month].input += d.input;
      monthlyMap[month].output += d.output;
      monthlyMap[month].cacheWrite += d.cacheWrite;
      monthlyMap[month].cacheRead += d.cacheRead;
      monthlyMap[month].cost += d.estimatedCost;
      monthlyMap[month].days++;
    }
    const monthly = Object.entries(monthlyMap).sort(([a], [b]) =>
      b.localeCompare(a),
    );

    // Weekly aggregation
    const weeklyMap = {};
    for (const d of data.daily) {
      const dt = new Date(d.date);
      const weekStart = new Date(dt);
      weekStart.setDate(dt.getDate() - dt.getDay() + 1);
      const weekKey = weekStart.toISOString().slice(0, 10);
      if (!weeklyMap[weekKey])
        weeklyMap[weekKey] = {
          input: 0,
          output: 0,
          cacheWrite: 0,
          cacheRead: 0,
          cost: 0,
          days: 0,
        };
      weeklyMap[weekKey].input += d.input;
      weeklyMap[weekKey].output += d.output;
      weeklyMap[weekKey].cacheWrite += d.cacheWrite;
      weeklyMap[weekKey].cacheRead += d.cacheRead;
      weeklyMap[weekKey].cost += d.estimatedCost;
      weeklyMap[weekKey].days++;
    }
    const weekly = Object.entries(weeklyMap).sort(([a], [b]) =>
      b.localeCompare(a),
    );

    const makeChart = (items, getValue, color) => {
      if (items.length === 0) return '<div class="empty">No data</div>';
      const max = Math.max(...items.map(getValue), 0.001);
      const bars = items
        .map((d) => {
          const h = Math.max(4, (getValue(d) / max) * 150);
          return `<div class="chart-bar" style="height:${h}px;background:${color}"><div class="tooltip">${d.date}: ${fmtCost(d.estimatedCost)}</div></div>`;
        })
        .join('');
      return `<div class="chart-container"><div class="chart-bar-group">${bars}</div><div class="chart-labels"><span>${items[0]?.date?.slice(5) || ''}</span><span>${items[items.length - 1]?.date?.slice(5) || ''}</span></div></div>`;
    };

    el.innerHTML = `
      <div class="page-header"><h2>Usage & Cost</h2><button class="btn btn-sm btn-ghost" onclick="window.print()">Export</button></div>

      <div class="card">
        <div class="card-title">Cost Summary</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Period</th><th>Input Tokens</th><th>Output Tokens</th><th>Cache Write</th><th>Cache Read</th><th>Days</th><th>Est. Cost</th><th>Avg/Day</th></tr></thead>
          <tbody>${Object.entries(periods)
            .map(([key, p]) => {
              const s = periodSummaries[key];
              const avg = s.days > 0 ? s.cost / s.days : 0;
              return `<tr>
            <td style="color:var(--text);font-weight:600">${p.label}</td>
            <td>${fmtTokens(s.input)}</td><td>${fmtTokens(s.output)}</td>
            <td>${fmtTokens(s.cacheWrite)}</td><td>${fmtTokens(s.cacheRead)}</td>
            <td>${s.days}</td>
            <td style="color:var(--success);font-weight:700;font-size:14px">${fmtCostBig(s.cost)}</td>
            <td style="color:var(--text-muted)">${fmtCost(avg)}</td>
          </tr>`;
            })
            .join('')}</tbody>
        </table></div>
      </div>

      <div class="card" id="budget-card">
        <div class="card-title">Budget</div>
        <div id="budget-content"><div class="loading">Loading budget</div></div>
      </div>

      <div class="grid grid-2">
        <div class="card"><div class="card-title">Daily Cost</div>${makeChart(data.daily, (d) => d.estimatedCost, 'var(--success)')}</div>
        <div class="card"><div class="card-title">Daily Tokens</div>${makeChart(data.daily, (d) => d.input + d.output, 'var(--accent)')}</div>
      </div>

      ${
        data.byGroup.length > 0
          ? `<div class="card">
        <div class="card-title">Cost by Group / Channel</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Group</th><th>Input</th><th>Output</th><th>Cache</th><th>Est. Cost</th><th>% of Total</th></tr></thead>
          <tbody>${data.byGroup
            .map((g) => {
              const pct =
                data.totals.cost > 0
                  ? ((g.cost / data.totals.cost) * 100).toFixed(1)
                  : '0';
              return `<tr>
            <td style="color:var(--text);font-weight:500">${esc(g.group)}</td>
            <td>${fmtTokens(g.input)}</td><td>${fmtTokens(g.output)}</td>
            <td>${fmtTokens(g.cacheWrite + g.cacheRead)}</td>
            <td style="color:var(--success);font-weight:600">${fmtCostBig(g.cost)}</td>
            <td><div style="display:flex;align-items:center;gap:8px"><div style="width:60px;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden"><div style="width:${pct}%;height:100%;background:var(--accent);border-radius:3px"></div></div><span style="font-size:11px;color:var(--text-muted)">${pct}%</span></div></td>
          </tr>`;
            })
            .join('')}</tbody>
        </table></div>
      </div>`
          : ''
      }

      ${
        data.byProvider && data.byProvider.length > 0
          ? `<div class="card">
        <div class="card-title">Cost by Provider / Service</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Provider</th><th>Service</th><th>Calls</th><th>Est. Cost</th><th>% of Total</th></tr></thead>
          <tbody>
            <tr style="font-weight:600;color:var(--text)">
              <td>Anthropic</td><td>Claude (LLM)</td><td>-</td>
              <td style="color:var(--success)">${fmtCostBig(data.totals.claudeCost || 0)}</td>
              <td>${data.totals.cost > 0 ? (((data.totals.claudeCost || 0) / data.totals.cost) * 100).toFixed(1) : 0}%</td>
            </tr>
            ${data.byProvider
              .map(
                (p) => `<tr>
              <td style="color:var(--text);font-weight:500;text-transform:capitalize">${esc(p.provider)}</td>
              <td>${esc(p.service)}</td>
              <td>${p.count}</td>
              <td style="color:var(--success);font-weight:600">${fmtCostBig(p.totalCost)}</td>
              <td>${data.totals.cost > 0 ? ((p.totalCost / data.totals.cost) * 100).toFixed(1) : 0}%</td>
            </tr>`,
              )
              .join('')}
            <tr style="border-top:2px solid var(--border);font-weight:700;color:var(--text)">
              <td colspan="3">Total</td>
              <td style="color:var(--success)">${fmtCostBig(data.totals.cost)}</td>
              <td>100%</td>
            </tr>
          </tbody>
        </table></div>
      </div>`
          : ''
      }

      ${
        data.modelMetrics && data.modelMetrics.length > 0
          ? `<div class="card">
        <div class="card-title">Model Operations</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Model</th><th>Calls</th><th>Success</th><th>Avg Latency</th><th>Context</th><th>Cost Tier</th><th>Est. Cost</th><th>Last Error</th></tr></thead>
          <tbody>${data.modelMetrics
            .map(
              (m) => `<tr>
                <td style="color:var(--text);font-weight:500">${esc(m.provider)} / ${esc(m.model)}</td>
                <td>${m.calls}</td>
                <td><span class="badge ${m.successRate >= 95 ? 'badge-success' : m.successRate >= 80 ? 'badge-warning' : 'badge-error'}">${m.successRate}%</span></td>
                <td>${m.avgLatencyMs == null ? '-' : `${m.avgLatencyMs} ms`}</td>
                <td>${fmtTokens(m.contextTokens)} / ${fmtTokens(m.contextWindow)}</td>
                <td><span class="badge badge-muted">${esc(m.costTier)}</span></td>
                <td style="color:var(--success);font-weight:600">${fmtCostBig(m.totalCost)}</td>
                <td style="max-width:220px;color:var(--text-muted)">${esc(m.lastError || '-')}</td>
              </tr>`,
            )
            .join('')}</tbody>
        </table></div>
      </div>`
          : ''
      }

      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Monthly Breakdown</div>
          <div class="table-wrap" style="max-height:300px;overflow-y:auto"><table>
            <thead><tr><th>Month</th><th>Tokens</th><th>Cost</th><th>Avg/Day</th></tr></thead>
            <tbody>${monthly
              .map(
                ([month, m]) => `<tr>
              <td style="color:var(--text);font-weight:500">${month}</td>
              <td>${fmtTokens(m.input + m.output)}</td>
              <td style="color:var(--success);font-weight:600">${fmtCostBig(m.cost)}</td>
              <td style="color:var(--text-muted)">${fmtCost(m.days > 0 ? m.cost / m.days : 0)}</td>
            </tr>`,
              )
              .join('')}</tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-title">Weekly Breakdown</div>
          <div class="table-wrap" style="max-height:300px;overflow-y:auto"><table>
            <thead><tr><th>Week of</th><th>Tokens</th><th>Cost</th><th>Avg/Day</th></tr></thead>
            <tbody>${weekly
              .map(
                ([week, w]) => `<tr>
              <td style="color:var(--text);font-weight:500">${week}</td>
              <td>${fmtTokens(w.input + w.output)}</td>
              <td style="color:var(--success);font-weight:600">${fmtCostBig(w.cost)}</td>
              <td style="color:var(--text-muted)">${fmtCost(w.days > 0 ? w.cost / w.days : 0)}</td>
            </tr>`,
              )
              .join('')}</tbody>
          </table></div>
        </div>
      </div>

      ${
        data.daily.length > 0
          ? `<div class="card">
        <div class="card-title">Daily Detail</div>
        <div class="table-wrap" style="max-height:400px;overflow-y:auto"><table>
          <thead><tr><th>Date</th><th>Input</th><th>Output</th><th>Cache Write</th><th>Cache Read</th><th>Cost</th></tr></thead>
          <tbody>${data.daily
            .slice()
            .reverse()
            .map(
              (d) => `<tr>
            <td style="color:var(--text)">${d.date}</td>
            <td>${fmtTokens(d.input)}</td><td>${fmtTokens(d.output)}</td>
            <td>${fmtTokens(d.cacheWrite)}</td><td>${fmtTokens(d.cacheRead)}</td>
            <td style="color:var(--success);font-weight:600">${fmtCost(d.estimatedCost)}</td>
          </tr>`,
            )
            .join('')}</tbody>
        </table></div>
      </div>`
          : ''
      }

      <div class="card" id="conversation-analytics">
        <div class="card-title">Conversation Analytics</div>
        <div id="conv-analytics-content"><div class="loading">Loading analytics</div></div>
      </div>`;
    // Load budget data
    loadBudget(periodSummaries, fmtCostBig);
    // Load conversation analytics
    loadConversationAnalytics();
  } catch (err) {
    el.innerHTML = '<div class="card empty">Failed to load usage data</div>';
  }
}

async function loadBudget(periodSummaries, fmtCostBig) {
  const budgetEl = document.getElementById('budget-content');
  if (!budgetEl) return;
  try {
    const budget = await api('/system/budget');
    const todaySpend = periodSummaries?.today?.cost || 0;
    const monthSpend = periodSummaries?.month?.cost || 0;
    const dailyPct =
      budget.dailyLimit > 0
        ? Math.min(100, (todaySpend / budget.dailyLimit) * 100).toFixed(1)
        : 0;
    const monthlyPct =
      budget.monthlyLimit > 0
        ? Math.min(100, (monthSpend / budget.monthlyLimit) * 100).toFixed(1)
        : 0;

    budgetEl.innerHTML = `
      <div class="grid grid-2" style="margin-bottom:16px">
        <div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:4px">
            <span>Daily: ${fmtCostBig(todaySpend)} / ${budget.dailyLimit > 0 ? fmtCostBig(budget.dailyLimit) : 'No limit'}</span>
            <span>${dailyPct}%</span>
          </div>
          <div style="width:100%;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden">
            <div style="width:${dailyPct}%;height:100%;background:${parseFloat(dailyPct) > 90 ? 'var(--error)' : parseFloat(dailyPct) > 70 ? 'var(--warning)' : 'var(--success)'};border-radius:4px;transition:width 0.3s"></div>
          </div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:4px">
            <span>Monthly: ${fmtCostBig(monthSpend)} / ${budget.monthlyLimit > 0 ? fmtCostBig(budget.monthlyLimit) : 'No limit'}</span>
            <span>${monthlyPct}%</span>
          </div>
          <div style="width:100%;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden">
            <div style="width:${monthlyPct}%;height:100%;background:${parseFloat(monthlyPct) > 90 ? 'var(--error)' : parseFloat(monthlyPct) > 70 ? 'var(--warning)' : 'var(--success)'};border-radius:4px;transition:width 0.3s"></div>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
        <div class="form-group" style="flex:1;min-width:120px;margin:0"><label>Daily Limit (USD)</label><input id="budget-daily" type="number" step="0.01" min="0" value="${budget.dailyLimit || ''}" placeholder="No limit"></div>
        <div class="form-group" style="flex:1;min-width:120px;margin:0"><label>Monthly Limit (USD)</label><input id="budget-monthly" type="number" step="0.01" min="0" value="${budget.monthlyLimit || ''}" placeholder="No limit"></div>
        <button class="btn btn-primary btn-sm" onclick="saveBudget()">Save</button>
      </div>`;
  } catch {
    budgetEl.innerHTML =
      '<div style="font-size:12px;color:var(--text-muted)">Budget API not available</div>';
  }
}

window.saveBudget = async () => {
  const daily = parseFloat(document.getElementById('budget-daily').value) || 0;
  const monthly =
    parseFloat(document.getElementById('budget-monthly').value) || 0;
  const r = await api('/system/budget', {
    method: 'PUT',
    body: JSON.stringify({ dailyLimit: daily, monthlyLimit: monthly }),
  });
  if (r.ok) toast('Budget saved', 'success');
  else toast(r.error || 'Failed', 'error');
};

// --- Conversation Analytics ---
async function loadConversationAnalytics() {
  const el = document.getElementById('conv-analytics-content');
  if (!el) return;
  try {
    const stats = await api('/system/stats');
    const daily = stats.daily || [];
    const byChannel = stats.byChannel || [];
    const totals = stats.totals || { total: 0, bot: 0, user: 0 };

    if (daily.length === 0) {
      el.innerHTML = '<div class="empty">No message data available</div>';
      return;
    }

    const totalMsgs = daily.reduce((s, d) => s + d.count, 0);
    const avgPerDay =
      daily.length > 0 ? (totalMsgs / daily.length).toFixed(1) : 0;
    const busiest = daily.reduce(
      (max, d) => (d.count > max.count ? d : max),
      daily[0],
    );
    const userMsgs = daily.reduce((s, d) => s + (d.user_count || 0), 0);
    const botMsgs = daily.reduce((s, d) => s + (d.bot_count || 0), 0);

    const channelRows =
      byChannel.length > 0
        ? byChannel
            .map((c) => {
              const pct =
                totalMsgs > 0 ? ((c.count / totalMsgs) * 100).toFixed(1) : 0;
              return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:13px;font-weight:500;text-transform:capitalize;color:var(--text)">${esc(c.channel)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:80px;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden"><div style="width:${pct}%;height:100%;background:var(--accent);border-radius:3px"></div></div>
          <span style="font-size:12px;color:var(--text-muted);min-width:50px;text-align:right">${c.count}</span>
          <span style="font-size:11px;color:var(--text-muted);min-width:40px;text-align:right">${pct}%</span>
        </div>
      </div>`;
            })
            .join('')
        : '<div style="font-size:12px;color:var(--text-muted)">No channel breakdown available</div>';

    el.innerHTML = `
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="card stat" style="padding:14px;margin:0"><div class="stat-value" style="font-size:22px">${totals.total}</div><div class="stat-label">Total Messages</div></div>
        <div class="card stat" style="padding:14px;margin:0"><div class="stat-value" style="font-size:22px">${avgPerDay}</div><div class="stat-label">Avg / Day</div></div>
        <div class="card stat" style="padding:14px;margin:0"><div class="stat-value" style="font-size:22px">${esc(busiest.day)}</div><div class="stat-label">Busiest Day (${busiest.count})</div></div>
        <div class="card stat" style="padding:14px;margin:0"><div class="stat-value" style="font-size:22px">${userMsgs}</div><div class="stat-label">User Messages</div></div>
        <div class="card stat" style="padding:14px;margin:0"><div class="stat-value" style="font-size:22px">${botMsgs}</div><div class="stat-label">Bot Messages</div></div>
        <div class="card stat" style="padding:14px;margin:0"><div class="stat-value" style="font-size:22px">${totals.total > 0 ? ((botMsgs / totals.total) * 100).toFixed(0) : 0}%</div><div class="stat-label">Bot Ratio</div></div>
      </div>
      ${
        byChannel.length > 0
          ? `<div style="margin-top:12px">
        <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">Messages by Channel (30d)</div>
        ${channelRows}
      </div>`
          : ''
      }`;
  } catch {
    el.innerHTML = '<div class="empty">Failed to load analytics</div>';
  }
}

// Sessions
async function renderSessions(el) {
  el.innerHTML = '<div class="loading">Loading sessions</div>';
  try {
    const sessions = await api('/sessions');
    if (sessions.length === 0) {
      el.innerHTML =
        '<div class="page-header"><h2>Sessions</h2></div><div class="card empty">No session transcripts found</div>';
      return;
    }

    // Group by channel group
    const grouped = {};
    for (const s of sessions) {
      if (!grouped[s.group]) grouped[s.group] = [];
      grouped[s.group].push(s);
    }

    el.innerHTML = `
      <div class="page-header"><h2>Sessions</h2><span class="badge badge-muted">${sessions.length} total</span></div>
      <div class="sessions-layout" style="display:flex;gap:16px">
        <div style="min-width:200px;max-width:250px">
          <div class="card">
            <div class="card-title">Groups</div>
            ${Object.keys(grouped)
              .map(
                (g) => `
              <a class="nav-link session-group-link" data-group="${esc(g)}" onclick="filterSessions('${esc(g)}')" style="cursor:pointer">
                <span>${esc(g)}</span>
                <span class="badge badge-muted">${grouped[g].length}</span>
              </a>`,
              )
              .join('')}
            <a class="nav-link session-group-link active" data-group="all" onclick="filterSessions('all')" style="cursor:pointer">
              <span>All</span>
              <span class="badge badge-muted">${sessions.length}</span>
            </a>
          </div>
        </div>
        <div style="flex:1">
          <div class="card" id="session-list"></div>
          <div id="session-viewer"></div>
        </div>
      </div>`;

    window._allSessions = sessions;
    renderSessionList(sessions);
  } catch (err) {
    el.innerHTML = '<div class="card empty">Failed to load sessions</div>';
  }
}

function renderSessionList(sessions) {
  const el = document.getElementById('session-list');
  if (!el) return;
  el.innerHTML =
    sessions.length === 0
      ? '<div class="empty">No sessions</div>'
      : `
    <div class="table-wrap"><table>
      <thead><tr><th>Session</th><th>Group</th><th>Started</th><th>Last Activity</th><th>Events</th><th>Actions</th></tr></thead>
      <tbody>${sessions
        .map(
          (s) => `<tr>
        <td style="font-family:var(--mono);font-size:11px;color:var(--text);max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(s.sessionId.slice(0, 8))}...</td>
        <td><span class="badge badge-accent">${esc(s.group)}</span></td>
        <td>${s.startedAt ? formatTime(s.startedAt) : '-'}</td>
        <td>${s.lastActivity ? timeAgo(s.lastActivity) : '-'}</td>
        <td>${s.messageCount}</td>
        <td><button class="btn btn-sm btn-ghost" onclick="viewSession('${esc(s.group)}','${esc(s.sessionId)}')">View</button></td>
      </tr>`,
        )
        .join('')}</tbody>
    </table></div>`;
}

window.filterSessions = function (group) {
  document
    .querySelectorAll('.session-group-link')
    .forEach((el) => el.classList.remove('active'));
  const active = document.querySelector(
    `.session-group-link[data-group="${group}"]`,
  );
  if (active) active.classList.add('active');
  const filtered =
    group === 'all'
      ? window._allSessions
      : window._allSessions.filter((s) => s.group === group);
  renderSessionList(filtered);
};

window.viewSession = async function (group, sessionId) {
  const viewer = document.getElementById('session-viewer');
  if (!viewer) return;
  viewer.innerHTML = '<div class="loading">Loading session</div>';
  try {
    const messages = await api(
      `/sessions/${encodeURIComponent(group)}/${encodeURIComponent(sessionId)}`,
    );
    viewer.innerHTML = `
      <div class="card" style="margin-top:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="card-title" style="margin:0">Session: ${esc(sessionId.slice(0, 8))}... <span class="badge badge-accent">${esc(group)}</span></div>
          <button class="btn btn-sm btn-ghost" onclick="document.getElementById('session-viewer').innerHTML=''">Close</button>
        </div>
        <div class="session-chat">
          ${
            messages.length === 0
              ? '<div class="empty">No messages in this session</div>'
              : messages
                  .map(
                    (m, idx) => `
            <div class="session-msg session-msg-${m.role}">
              <div class="session-msg-header">
                <span class="session-msg-role">${m.role === 'user' ? 'User' : 'Assistant'}</span>
                ${m.timestamp ? `<span style="font-size:11px;color:var(--text-muted)">${formatTime(m.timestamp)}</span>` : ''}
                ${m.toolUse ? '<span class="badge badge-info" style="font-size:10px">Tool use</span>' : ''}
                <button class="btn btn-sm btn-ghost" style="margin-left:auto;padding:2px 8px;font-size:10px" onclick="forkSession('${esc(group)}','${esc(sessionId)}',${idx})" title="Fork conversation from here">Fork</button>
              </div>
              <div class="session-msg-content">${esc(truncate(m.content, 2000))}</div>
            </div>`,
                  )
                  .join('')
          }
        </div>
      </div>`;
    viewer.scrollIntoView({ behavior: 'smooth' });
  } catch {
    viewer.innerHTML = '<div class="card empty">Failed to load session</div>';
  }
};

// Backup
async function renderBackup(el) {
  const [data, guide, autoConfig, migration] = await Promise.all([
    api('/backup'),
    api('/backup/restore-guide'),
    api('/backup/auto-config'),
    api('/backup/migration-check'),
  ]);

  el.innerHTML = `
    <div class="page-header"><h2>Backup & Restore</h2></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <div class="card-title">What Gets Backed Up</div>
        <table>
          <thead><tr><th>Item</th><th>Size</th><th>Priority</th><th>Status</th></tr></thead>
          <tbody>${data.items
            .map(
              (i) => `<tr>
            <td style="font-size:12px;color:var(--text)">${esc(i.label)}</td>
            <td style="font-size:12px">${i.sizeFormatted}</td>
            <td><span class="badge ${i.critical ? 'badge-error' : 'badge-muted'}">${i.critical ? 'Critical' : 'Optional'}</span></td>
            <td><span class="badge ${i.exists ? 'badge-success' : 'badge-warning'}">${i.exists ? 'Found' : 'Missing'}</span></td>
          </tr>`,
            )
            .join('')}</tbody>
        </table>
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:13px;color:var(--text-muted)">Total: <strong style="color:var(--text)">${data.totalSizeFormatted}</strong></span>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm btn-ghost" onclick="createBackup(false, this)">Essential Only</button>
            <button class="btn btn-primary btn-sm" onclick="createBackup(true, this)">Full Backup</button>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Restore Guide</div>
        <ol style="font-size:12px;color:var(--text-secondary);line-height:2;padding-left:20px">
          ${guide.steps.map((s) => `<li>${esc(s.replace(/^\d+\.\s*/, ''))}</li>`).join('')}
        </ol>
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Notes</div>
          ${guide.notes.map((n) => `<div style="font-size:12px;color:var(--text-muted);padding:4px 0">\u2022 ${esc(n)}</div>`).join('')}
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <div class="card-title">Automatic Backups</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 100px auto;gap:8px;align-items:end">
          <label style="font-size:12px;color:var(--text-muted)">Enabled<br>
            <select id="backup-auto-enabled" class="input" style="margin-top:4px">
              <option value="false" ${autoConfig.enabled ? '' : 'selected'}>Off</option>
              <option value="true" ${autoConfig.enabled ? 'selected' : ''}>On</option>
            </select>
          </label>
          <label style="font-size:12px;color:var(--text-muted)">Schedule<br>
            <select id="backup-auto-schedule" class="input" style="margin-top:4px">
              <option value="weekly" ${autoConfig.schedule === 'weekly' ? 'selected' : ''}>Weekly</option>
              <option value="daily" ${autoConfig.schedule === 'daily' ? 'selected' : ''}>Daily</option>
            </select>
          </label>
          <label style="font-size:12px;color:var(--text-muted)">Keep<br>
            <input id="backup-auto-keep" class="input" type="number" min="1" max="20" value="${autoConfig.keepCount || 4}" style="margin-top:4px">
          </label>
          <button class="btn btn-primary btn-sm" onclick="saveAutoBackupConfig(this)">Save</button>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Migration Readiness <span class="badge ${migration.ok ? 'badge-success' : 'badge-warning'}">${migration.ok ? 'Ready' : 'Review'}</span></div>
        <div style="display:grid;gap:6px">
          ${migration.checks
            .map(
              (
                check,
              ) => `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
                <div>
                  <div style="font-size:12px;color:var(--text)">${esc(check.label)}</div>
                  <div style="font-size:11px;color:var(--text-muted)">${esc(check.detail)}</div>
                </div>
                <span class="badge ${check.ok ? 'badge-success' : check.optional ? 'badge-muted' : 'badge-warning'}">${check.ok ? 'OK' : check.optional ? 'Optional' : 'Missing'}</span>
              </div>`,
            )
            .join('')}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Decrypt Encrypted Backup</div>
      <div style="display:grid;grid-template-columns:1fr 220px auto;gap:8px;align-items:end">
        <label style="font-size:12px;color:var(--text-muted)">Encrypted file<br>
          <input id="backup-decrypt-file" class="input" type="file" accept=".enc,application/octet-stream" style="margin-top:4px">
        </label>
        <label style="font-size:12px;color:var(--text-muted)">Passphrase<br>
          <input id="backup-decrypt-passphrase" class="input" type="password" autocomplete="off" style="margin-top:4px">
        </label>
        <button class="btn btn-sm btn-ghost" onclick="decryptBackupUpload(this)">Decrypt</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Existing Backups <span class="badge badge-muted">${data.backups.length}</span></div>
      ${
        data.backups.length === 0
          ? '<div class="empty">No backups yet. Create one above.</div>'
          : `
      <table>
        <thead><tr><th>Filename</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>${data.backups
          .map(
            (b) => `<tr>
          <td style="font-family:var(--mono);font-size:12px;color:var(--text)">${esc(b.name)}</td>
          <td>${b.sizeFormatted}</td>
          <td>${formatTime(b.created)}</td>
          <td style="white-space:nowrap">
            <a class="btn btn-sm btn-ghost" href="/api/backup/download/${encodeURIComponent(b.name)}" download style="text-decoration:none">\u2913 Download</a>
            <button class="btn btn-sm btn-ghost" onclick="downloadEncryptedBackup('${esc(b.name)}')">\u2616 Encrypted</button>
            <button class="btn btn-sm btn-danger" onclick="deleteBackup('${esc(b.name)}',this)">\u2715 Delete</button>
          </td>
        </tr>`,
          )
          .join('')}</tbody>
      </table>`
      }
    </div>`;
}

window.createBackup = async (includeAll, btnEl) => {
  const origText = btnEl.textContent;
  btnEl.disabled = true;
  btnEl.textContent = 'Creating...';
  try {
    const r = await api('/backup', {
      method: 'POST',
      body: JSON.stringify({ includeAll }),
    });
    if (r.ok) {
      toast(`Backup created: ${r.filename} (${r.sizeFormatted})`, 'success');
      navigate('backup');
    } else {
      toast(r.error || 'Failed', 'error');
      btnEl.disabled = false;
      btnEl.textContent = origText;
    }
  } catch (e) {
    toast('Backup failed', 'error');
    btnEl.disabled = false;
    btnEl.textContent = origText;
  }
};

window.downloadEncryptedBackup = async (filename) => {
  const passphrase = prompt('Enter a passphrase for encryption:');
  if (!passphrase) return;
  if (passphrase.length < 8) {
    toast('Passphrase too short (min 8 characters)', 'warning');
    return;
  }
  try {
    const res = await fetch(
      `/api/backup/download-encrypted/${encodeURIComponent(filename)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Download failed' }));
      toast(err.error || 'Encrypted download failed', 'error');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.replace(/\.(tar\.gz|tgz)$/i, '.enc.$1');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Encrypted backup downloaded', 'success');
  } catch (e) {
    toast('Download failed: ' + e.message, 'error');
  }
};

window.saveAutoBackupConfig = async (btnEl) => {
  const origText = btnEl.textContent;
  btnEl.disabled = true;
  btnEl.textContent = 'Saving...';
  try {
    await api('/backup/auto-config', {
      method: 'PUT',
      body: JSON.stringify({
        enabled:
          document.getElementById('backup-auto-enabled').value === 'true',
        schedule: document.getElementById('backup-auto-schedule').value,
        keepCount: document.getElementById('backup-auto-keep').value,
      }),
    });
    toast('Automatic backup settings saved', 'success');
    navigate('backup');
  } catch (e) {
    toast('Could not save automatic backup settings', 'error');
    btnEl.disabled = false;
    btnEl.textContent = origText;
  }
};

window.decryptBackupUpload = async (btnEl) => {
  const file = document.getElementById('backup-decrypt-file').files?.[0];
  const passphrase = document.getElementById('backup-decrypt-passphrase').value;
  if (!file) {
    toast('Choose an encrypted backup file', 'warning');
    return;
  }
  if (!passphrase) {
    toast('Enter the backup passphrase', 'warning');
    return;
  }
  const origText = btnEl.textContent;
  btnEl.disabled = true;
  btnEl.textContent = 'Decrypting...';
  try {
    const res = await fetch('/api/backup/decrypt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Passphrase': passphrase,
      },
      body: await file.arrayBuffer(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Decrypt failed' }));
      toast(err.error || 'Decrypt failed', 'error');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name.replace(/\\.enc$/i, '') || 'nanocrab-backup.tar.gz';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Backup decrypted', 'success');
  } catch (e) {
    toast('Decrypt failed: ' + e.message, 'error');
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = origText;
  }
};

window.deleteBackup = async (filename, btnEl) => {
  inlineConfirm(btnEl, 'Delete this backup?', async () => {
    await api(`/backup/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    toast('Deleted', 'success');
    navigate('backup');
  });
};

// Settings
// --- Share API ---
window.shareContent = async function (title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
    } catch {} // user cancelled
  } else {
    // Fallback: copy to clipboard
    await navigator.clipboard.writeText(text).catch(() => {});
    toast('Copied to clipboard', 'success');
  }
};

// --- Toast & Modal system ---
function toast(msg, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText =
      'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  const colors = {
    success: 'var(--success)',
    error: 'var(--error)',
    info: 'var(--accent)',
    warning: 'var(--warning)',
  };
  el.style.cssText = `padding:12px 20px;border-radius:var(--radius-sm);background:var(--surface);border:1px solid ${colors[type] || colors.info};color:var(--text);font-size:13px;box-shadow:var(--shadow-lg);animation:fadeInUp 0.3s ease;max-width:400px`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

function inlineConfirm(btnEl, message, onConfirm) {
  const parent = btnEl.parentElement;
  const original = parent.innerHTML;
  parent.innerHTML = `<span style="font-size:12px;color:var(--text-muted);margin-right:8px">${esc(message)}</span><button class="btn btn-sm btn-danger" id="_confirm_yes">Yes</button> <button class="btn btn-sm btn-ghost" id="_confirm_no">Cancel</button>`;
  parent.querySelector('#_confirm_yes').onclick = async () => {
    await onConfirm();
  };
  parent.querySelector('#_confirm_no').onclick = () => {
    parent.innerHTML = original;
  };
}

function inlineInput(btnEl, label, onSubmit) {
  const parent = btnEl.parentElement;
  const original = parent.innerHTML;
  parent.innerHTML = `<div style="display:flex;gap:6px;align-items:center"><input type="password" class="search-input" style="max-width:250px;padding:6px 10px;font-size:12px" id="_inline_input" placeholder="${esc(label)}"><button class="btn btn-sm btn-primary" id="_inline_ok">Save</button><button class="btn btn-sm btn-ghost" id="_inline_cancel">Cancel</button></div>`;
  const input = parent.querySelector('#_inline_input');
  input.focus();
  const submit = async () => {
    const v = input.value;
    if (!v) return;
    await onSubmit(v);
  };
  parent.querySelector('#_inline_ok').onclick = submit;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') submit();
  };
  parent.querySelector('#_inline_cancel').onclick = () => {
    parent.innerHTML = original;
  };
}

// --- Task actions ---
window.editTask = async (id) => {
  const task = await api(`/tasks/${id}`);
  const editor = document.getElementById('task-editor');
  if (!editor) return;
  editor.innerHTML = `
    <div class="card" style="margin-top:12px">
      <div class="card-title">Edit Task <span class="badge badge-muted">${esc(task.id.slice(0, 8))}</span></div>
      <form id="task-edit-form">
        <div class="grid grid-2">
          <div class="form-group"><label>Schedule Type</label><select id="edit-task-type">
            <option value="cron" ${task.schedule_type === 'cron' ? 'selected' : ''}>Cron</option>
            <option value="interval" ${task.schedule_type === 'interval' ? 'selected' : ''}>Interval</option>
            <option value="once" ${task.schedule_type === 'once' ? 'selected' : ''}>Once</option>
          </select></div>
          <div class="form-group"><label>Schedule Value</label><input id="edit-task-schedule" value="${esc(task.schedule_value)}"></div>
        </div>
        <div class="form-group"><label>Prompt</label><textarea id="edit-task-prompt" style="width:100%;min-height:120px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:13px;resize:vertical">${esc(task.prompt)}</textarea></div>
        <div class="form-group"><label>Script (optional)</label><textarea id="edit-task-script" style="width:100%;min-height:60px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical">${esc(task.script || '')}</textarea></div>
        <div class="form-group"><label>Status</label><select id="edit-task-status">
          <option value="active" ${task.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="paused" ${task.status === 'paused' ? 'selected' : ''}>Paused</option>
        </select></div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="submit" class="btn btn-primary">Save</button>
          <button type="button" class="btn btn-ghost" onclick="document.getElementById('task-editor').innerHTML=''">Cancel</button>
          <span id="edit-task-msg" style="font-size:12px"></span>
        </div>
      </form>
    </div>`;
  editor.scrollIntoView({ behavior: 'smooth' });
  document.getElementById('task-edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const r = await api('/tasks/' + id, {
      method: 'PUT',
      body: JSON.stringify({
        prompt: document.getElementById('edit-task-prompt').value,
        schedule_type: document.getElementById('edit-task-type').value,
        schedule_value: document.getElementById('edit-task-schedule').value,
        status: document.getElementById('edit-task-status').value,
      }),
    });
    if (r.ok) {
      toast('Task updated', 'success');
      navigate('tasks');
    } else {
      const m = document.getElementById('edit-task-msg');
      m.textContent = r.error || 'Failed';
      m.style.color = 'var(--error)';
    }
  };
};

window.taskAction = async (id, action, btnEl) => {
  if (action === 'delete') {
    inlineConfirm(btnEl, 'Delete this task?', async () => {
      await api(`/tasks/${id}`, { method: 'DELETE' });
      navigate('tasks');
    });
  } else {
    await api(`/tasks/${id}/${action}`, { method: 'PUT' });
    toast(action === 'pause' ? 'Task paused' : 'Task resumed', 'success');
    navigate('tasks');
  }
};

// --- Helpers ---
async function loadBotName() {
  try {
    const identity = await api('/system/identity');
    if (identity.name) {
      botName = identity.name;
      document.title = `${botName} \u2014 ${identity.editionShort || 'NanoCrab'}`;
    }
    window._editionName = identity.edition || '';
    window._editionShort = identity.editionShort || '';
    window._editionVersion = identity.editionVersion || '';
    window._appVersion = identity.appVersion || identity.nanocrabVersion || '';
    window._projectRoot = identity.projectRoot || '.';
    window._mockMode = Boolean(identity.mockMode);
  } catch {
    /* use default */
  }
  // Fetch current user role
  try {
    const me = await api('/me');
    window._userRole = me.role || 'owner';
    window._username = me.username || 'admin';
  } catch {
    window._userRole = 'owner'; // fallback for single-user mode
  }
}
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n) + '...' : s || '';
}
function formatTime(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function timeAgo(ts) {
  const d = Date.now() - new Date(ts).getTime();
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}
function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(1) + ' GB';
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
function loadCss(href) {
  return new Promise((resolve) => {
    if (document.querySelector(`link[href="${href}"]`)) {
      resolve();
      return;
    }
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.onload = resolve;
    document.head.appendChild(l);
  });
}

// --- Wiki ---
async function renderWiki(el) {
  let pages_list = [];
  try {
    pages_list = await api('/wiki');
  } catch {}
  let selectedPage = null;

  el.innerHTML = `
    <div class="page-header">
      <h2>Wiki</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="search-input" id="wiki-search" placeholder="Search wiki..." style="max-width:250px">
        <button class="btn btn-primary btn-sm" onclick="newWikiPage()">New Page</button>
      </div>
    </div>
    <div class="wiki-layout" style="display:flex;gap:16px">
      <div style="min-width:240px;max-width:280px">
        <div class="card" id="wiki-page-list">
          <div class="card-title">Pages <span class="badge badge-muted">${pages_list.length}</span></div>
          ${
            pages_list.length === 0
              ? '<div class="empty" style="padding:16px">No wiki pages yet</div>'
              : pages_list
                  .map(
                    (p) => `
            <a class="nav-link wiki-page-link" data-name="${esc(p.name)}" onclick="selectWikiPage('${esc(p.name)}')" style="cursor:pointer;justify-content:space-between">
              <span>${esc(p.title)}</span>
              <span style="font-size:10px;color:var(--text-muted)">${timeAgo(p.modified)}</span>
            </a>`,
                  )
                  .join('')
          }
        </div>
      </div>
      <div style="flex:1">
        <div class="card" id="wiki-editor">
          <div class="empty" style="padding:32px">Select a page or create a new one</div>
        </div>
      </div>
    </div>`;

  // Search
  let searchTimeout;
  document.getElementById('wiki-search').oninput = async () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      const q = document.getElementById('wiki-search').value.trim();
      if (q.length < 2) {
        // Reset to full list
        const all = await api('/wiki');
        renderWikiPageList(all);
        return;
      }
      const results = await api(`/wiki/search?q=${encodeURIComponent(q)}`);
      renderWikiPageList(results);
    }, 300);
  };
}

function renderWikiPageList(pages_list) {
  const el = document.getElementById('wiki-page-list');
  if (!el) return;
  el.innerHTML = `
    <div class="card-title">Pages <span class="badge badge-muted">${pages_list.length}</span></div>
    ${
      pages_list.length === 0
        ? '<div class="empty" style="padding:16px">No pages found</div>'
        : pages_list
            .map(
              (p) => `
      <a class="nav-link wiki-page-link" data-name="${esc(p.name)}" onclick="selectWikiPage('${esc(p.name)}')" style="cursor:pointer;justify-content:space-between">
        <span>${esc(p.title)}</span>
        <span style="font-size:10px;color:var(--text-muted)">${p.modified ? timeAgo(p.modified) : ''}</span>
      </a>`,
            )
            .join('')
    }`;
}

window.newWikiPage = () => {
  const editor = document.getElementById('wiki-editor');
  if (!editor) return;
  editor.innerHTML = `
    <div class="card-title">New Page</div>
    <div class="form-group"><label>Page Title</label><input id="wiki-new-title" placeholder="My New Page" class="search-input" style="max-width:100%"></div>
    <div class="form-group" style="margin-top:12px"><label>Content (Markdown)</label>
      <textarea id="wiki-new-content" style="width:100%;min-height:300px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical;line-height:1.6" placeholder="# Page Title\n\nWrite your content here..."></textarea>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-primary" onclick="saveNewWikiPage()">Create</button>
    </div>`;
};

window.saveNewWikiPage = async () => {
  const title = document.getElementById('wiki-new-title').value.trim();
  if (!title) {
    toast('Enter a page title', 'warning');
    return;
  }
  const name = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  let content = document.getElementById('wiki-new-content').value;
  if (!content.trim()) content = `# ${title}\n\n`;
  try {
    const r = await api(`/wiki/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    if (r.ok) {
      toast('Page created', 'success');
      navigate('memory');
    } else toast(r.error || 'Failed', 'error');
  } catch {
    toast('Failed to create page', 'error');
  }
};

window.selectWikiPage = async (name) => {
  document
    .querySelectorAll('.wiki-page-link')
    .forEach((el) => el.classList.remove('active'));
  const active = document.querySelector(`.wiki-page-link[data-name="${name}"]`);
  if (active) active.classList.add('active');

  const editor = document.getElementById('wiki-editor');
  if (!editor) return;
  editor.innerHTML = '<div class="loading">Loading</div>';
  try {
    const page = await api(`/wiki/${encodeURIComponent(name)}`);
    editor.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="card-title" style="margin:0">${esc(name)}</div>
        <span style="font-size:11px;color:var(--text-muted)">${page.modified ? formatTime(page.modified) : ''}</span>
      </div>
      <textarea id="wiki-edit-content" style="width:100%;min-height:400px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical;line-height:1.6">${esc(page.content)}</textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary" onclick="saveWikiPage('${esc(name)}')">Save</button>
        <button class="btn btn-danger" onclick="deleteWikiPage('${esc(name)}')">Delete</button>
      </div>`;
  } catch {
    editor.innerHTML = '<div class="empty">Failed to load page</div>';
  }
};

window.saveWikiPage = async (name) => {
  const content = document.getElementById('wiki-edit-content').value;
  try {
    const r = await api(`/wiki/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    if (r.ok) {
      toast('Page saved', 'success');
    } else toast(r.error || 'Failed', 'error');
  } catch {
    toast('Failed to save page', 'error');
  }
};

window.deleteWikiPage = async (name) => {
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    const r = await api(`/wiki/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (r.ok) {
      toast('Page deleted', 'success');
      navigate('memory');
    } else toast(r.error || 'Failed', 'error');
  } catch {
    toast('Failed to delete page', 'error');
  }
};

// --- Workflows ---
async function renderWorkflows(el) {
  let workflows = [];
  try {
    workflows = await api('/workflows');
  } catch {}
  const groups = await api('/groups');

  el.innerHTML = `
    <div class="page-header">
      <h2>Workflows</h2>
      <button class="btn btn-primary btn-sm" onclick="document.getElementById('new-workflow-form').style.display=document.getElementById('new-workflow-form').style.display==='none'?'block':'none'">New Workflow</button>
    </div>
    <div class="card" id="new-workflow-form" style="display:none">
      <div class="card-title">Create Workflow</div>
      <form id="workflow-create-form">
        <div class="form-group"><label>Name</label><input id="wf-name" placeholder="My Workflow" required></div>
        <div class="grid grid-2">
          <div class="form-group"><label>Trigger Type</label><select id="wf-trigger-type">
            <option value="cron">Cron Schedule</option>
            <option value="webhook">Webhook</option>
            <option value="keyword">Keyword</option>
          </select></div>
          <div class="form-group"><label>Trigger Value</label><input id="wf-trigger-value" placeholder="0 9 * * * or /keyword" required></div>
        </div>
        <div id="wf-actions-list">
          <div class="card-title" style="margin-top:8px">Actions</div>
          <div class="wf-action-row" style="display:flex;gap:8px;margin-bottom:8px;align-items:end">
            <div class="form-group" style="margin:0;flex:0 0 140px"><label>Type</label><select class="wf-action-type"><option value="prompt">Prompt</option><option value="message">Message</option><option value="script">Script</option></select></div>
            <div class="form-group" style="margin:0;flex:1"><label>Value</label><input class="wf-action-value" placeholder="Action content"></div>
            <div class="form-group" style="margin:0;flex:0 0 160px"><label>Target Group (optional)</label><select class="wf-action-target"><option value="">None</option>${groups.map((g) => `<option value="${g.jid}">${esc(g.name)}</option>`).join('')}</select></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button type="button" class="btn btn-sm btn-ghost" onclick="addWorkflowAction()">+ Add Action</button>
        </div>
        <div style="margin-top:16px"><button type="submit" class="btn btn-primary">Create Workflow</button></div>
      </form>
    </div>
    ${
      workflows.length === 0
        ? '<div class="card empty">No workflows configured</div>'
        : `
    <div class="grid grid-2">
      ${workflows
        .map(
          (w) => `
        <div class="card" style="margin:0">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
            <div>
              <div style="font-size:16px;font-weight:600;color:var(--text)">${esc(w.name)}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Created ${formatTime(w.createdAt)}${w.lastTriggered ? ' \u2022 Last triggered ' + timeAgo(w.lastTriggered) : ''}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              <button class="btn btn-sm ${w.enabled ? 'btn-success' : 'btn-ghost'}" onclick="toggleWorkflow('${esc(w.id)}', ${!w.enabled})">${w.enabled ? 'Enabled' : 'Disabled'}</button>
              <button class="btn btn-sm btn-ghost" onclick="triggerWorkflow('${esc(w.id)}')">Trigger</button>
              <button class="btn btn-sm btn-danger" onclick="deleteWorkflow('${esc(w.id)}',this)">Delete</button>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:10px;background:var(--surface2);border-radius:var(--radius-sm)">
            <span class="badge badge-info">${esc(w.trigger.type)}</span>
            <span style="font-family:var(--mono);font-size:12px;color:var(--text)">${esc(w.trigger.value)}</span>
            <span style="color:var(--text-muted);font-size:16px">\u2192</span>
            ${w.actions.map((a) => `<span class="badge badge-accent">${esc(a.type)}</span>`).join('<span style="color:var(--text-muted)">\u2192</span>')}
          </div>
          <div style="font-size:12px;color:var(--text-muted)">
            ${w.actions.map((a, i) => `<div style="padding:4px 0;border-bottom:1px solid var(--border)"><strong>${i + 1}.</strong> <span class="badge badge-muted">${esc(a.type)}</span> ${esc(truncate(a.value, 80))}${a.targetJid ? ` \u2192 <em>${esc(a.targetJid)}</em>` : ''}</div>`).join('')}
          </div>
        </div>`,
        )
        .join('')}
    </div>`
    }`;

  // Store groups for action rows
  window._wfGroups = groups;

  const form = document.getElementById('workflow-create-form');
  if (form)
    form.onsubmit = async (e) => {
      e.preventDefault();
      const actionRows = document.querySelectorAll('.wf-action-row');
      const actions = [];
      actionRows.forEach((row) => {
        const type = row.querySelector('.wf-action-type').value;
        const value = row.querySelector('.wf-action-value').value;
        const targetJid =
          row.querySelector('.wf-action-target').value || undefined;
        if (value) actions.push({ type, value, targetJid });
      });
      if (actions.length === 0) {
        toast('Add at least one action', 'warning');
        return;
      }
      try {
        const r = await api('/workflows', {
          method: 'POST',
          body: JSON.stringify({
            name: document.getElementById('wf-name').value,
            trigger: {
              type: document.getElementById('wf-trigger-type').value,
              value: document.getElementById('wf-trigger-value').value,
            },
            actions,
          }),
        });
        if (r.ok) {
          toast('Workflow created', 'success');
          navigate('workflows');
        } else toast(r.error || 'Failed', 'error');
      } catch {
        toast('Failed to create workflow', 'error');
      }
    };
}

window.addWorkflowAction = () => {
  const list = document.getElementById('wf-actions-list');
  if (!list) return;
  const groups = window._wfGroups || [];
  const row = document.createElement('div');
  row.className = 'wf-action-row';
  row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:end';
  row.innerHTML = `
    <div class="form-group" style="margin:0;flex:0 0 140px"><select class="wf-action-type"><option value="prompt">Prompt</option><option value="message">Message</option><option value="script">Script</option></select></div>
    <div class="form-group" style="margin:0;flex:1"><input class="wf-action-value" placeholder="Action content"></div>
    <div class="form-group" style="margin:0;flex:0 0 160px"><select class="wf-action-target"><option value="">None</option>${groups.map((g) => `<option value="${g.jid}">${esc(g.name)}</option>`).join('')}</select></div>
    <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()" style="flex-shrink:0">X</button>`;
  list.appendChild(row);
};

window.toggleWorkflow = async (id, enabled) => {
  try {
    const r = await api(`/workflows/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
    if (r.ok) {
      toast(enabled ? 'Workflow enabled' : 'Workflow disabled', 'success');
      navigate('workflows');
    } else toast(r.error || 'Failed', 'error');
  } catch {
    toast('Failed to update workflow', 'error');
  }
};

window.triggerWorkflow = async (id) => {
  try {
    const r = await api(`/workflows/${id}/trigger`, { method: 'POST' });
    if (r.ok) {
      toast(r.message || 'Workflow triggered', 'success');
      navigate('workflows');
    } else toast(r.error || 'Failed', 'error');
  } catch {
    toast('Failed to trigger workflow', 'error');
  }
};

window.deleteWorkflow = async (id, btnEl) => {
  inlineConfirm(btnEl, 'Delete this workflow?', async () => {
    const r = await api(`/workflows/${id}`, { method: 'DELETE' });
    if (r.ok) {
      toast('Workflow deleted', 'success');
      navigate('workflows');
    } else toast(r.error || 'Failed', 'error');
  });
};

// --- Developer Hub ---
async function renderDevHub(el) {
  let repos = [];
  try {
    repos = await api('/files/repos');
  } catch {}
  let guideSections = [];
  try {
    const g = await api('/dev/guide');
    guideSections = g.sections || [];
  } catch {}

  const repoCards =
    repos.length === 0
      ? '<div class="card empty">No repositories mounted. Add mounts in the <a style="color:var(--accent);cursor:pointer" onclick="navigate(\'mounts\')">Mounts</a> page.</div>'
      : repos
          .map((r) => {
            const statusBadge = r.dirty
              ? '<span class="badge badge-warning">Dirty</span>'
              : '<span class="badge badge-success">Clean</span>';
            return `<div class="card" style="margin-bottom:0">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <div style="font-size:16px;font-weight:600;color:var(--text)">${esc(r.name)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${r.branch ? 'Branch: ' + esc(r.branch) : ''} ${r.lastCommit ? ' \u2022 ' + esc(truncate(r.lastCommit, 50)) : ''}</div>
          </div>
          ${statusBadge}
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn btn-sm btn-ghost" onclick="devHubRunTests('${esc(r.name)}')">Run Tests</button>
          <button class="btn btn-sm btn-ghost" onclick="devHubPull('${esc(r.name)}')">Pull</button>
          <button class="btn btn-sm btn-primary" onclick="navigate('pipelines')">Deploy</button>
        </div>
      </div>`;
          })
          .join('');

  let guideHtml = guideSections
    .map(
      (s) =>
        `<details style="margin-bottom:8px;border-bottom:1px solid var(--border);padding-bottom:8px"><summary style="cursor:pointer;font-weight:600;font-size:13px;color:var(--text);padding:4px 0">${esc(s.title)}</summary><div style="font-size:12px;color:var(--text-secondary);padding:8px 0;white-space:pre-wrap;line-height:1.6">${esc(s.content)}</div></details>`,
    )
    .join('');

  el.innerHTML = `
    <div class="page-header"><h2>Developer Hub</h2></div>
    <div class="card">
      <div class="card-title">Mounted Repositories <span class="badge badge-muted">${repos.length}</span></div>
      <div class="grid grid-3">${repoCards}</div>
    </div>
    <div class="card">
      <div class="card-title">Quick Links</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm btn-ghost" onclick="navigate('gitcode')">Git & Code</button>
        <button class="btn btn-sm btn-ghost" onclick="navigate('containers')">Containers</button>
        <button class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Monitoring</button>
        <button class="btn btn-sm btn-ghost" onclick="navigate('pipelines')">Deploy Pipelines</button>
        <button class="btn btn-sm btn-ghost" onclick="navigate('integrations')">Integrations</button>
      </div>
    </div>
    ${guideHtml ? `<div class="card"><div class="card-title">Developer Guide</div>${guideHtml}</div>` : ''}`;
}

window.devHubRunTests = async (repo) => {
  toast('Starting tests for ' + repo + '...', 'info');
  try {
    const r = await api(`/dev/test/${encodeURIComponent(repo)}/run`, {
      method: 'POST',
    });
    if (r.ok !== false)
      toast('Tests started. View results in Test Runner.', 'success');
    else toast(r.error || 'Failed to start tests', 'error');
  } catch {
    toast('Failed to start tests', 'error');
  }
};

window.devHubPull = async (repo) => {
  try {
    const r = await api(`/dev/git/${encodeURIComponent(repo)}/pull`, {
      method: 'POST',
    });
    if (r.ok !== false) {
      toast(r.message || 'Pull complete', 'success');
      navigate('devhub');
    } else toast(r.error || 'Pull failed', 'error');
  } catch {
    toast('Pull failed', 'error');
  }
};

// --- Git Ops ---
async function renderGitOps(el) {
  let repos = [];
  try {
    repos = await api('/files/repos');
  } catch {}
  if (repos.length === 0) {
    el.innerHTML =
      '<div class="page-header"><h2>Git Ops</h2></div><div class="card empty">No repositories mounted.</div>';
    return;
  }

  el.innerHTML = `
    <div class="page-header"><h2>Git Ops</h2>
      <select class="search-input" id="gitops-repo" style="max-width:250px">
        ${repos.map((r) => `<option value="${r.name}">${esc(r.name)}</option>`).join('')}
      </select>
    </div>
    <div id="gitops-content"><div class="loading">Loading</div></div>`;

  const loadGitOps = async (repoName) => {
    const content = document.getElementById('gitops-content');
    if (!content) return;
    content.innerHTML = '<div class="loading">Loading</div>';
    try {
      const git = await api(
        `/files/repos/${encodeURIComponent(repoName)}/git`,
      ).catch(() => ({ status: [], log: [], branch: '', branches: [] }));
      const diff = await api(
        `/dev/git/${encodeURIComponent(repoName)}/diff`,
      ).catch(() => ({ diff: '' }));
      const branches = git.branches || [];
      const modified = (git.status || [])
        .filter((s) => s.match(/^\s*M/))
        .map((s) => s.trim());
      const staged = (git.status || [])
        .filter((s) => s.match(/^[MADRC]/))
        .map((s) => s.trim());
      const untracked = (git.status || [])
        .filter((s) => s.match(/^\?\?/))
        .map((s) => s.replace(/^\?\?\s*/, '').trim());
      const allFiles = [...modified, ...staged, ...untracked];

      const diffHtml = (diff.diff || '')
        .split('\n')
        .map((line) => {
          if (line.startsWith('@@'))
            return `<span class="diff-header">${esc(line)}</span>`;
          if (line.startsWith('+'))
            return `<span class="diff-add">${esc(line)}</span>`;
          if (line.startsWith('-'))
            return `<span class="diff-del">${esc(line)}</span>`;
          return esc(line);
        })
        .join('\n');

      content.innerHTML = `
        <div class="grid grid-2">
          <div class="card">
            <div class="card-title">Branch</div>
            <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:12px">${esc(git.branch || 'unknown')}</div>
            ${branches.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:4px">${branches.map((b) => `<button class="btn btn-sm ${b === git.branch ? 'btn-primary' : 'btn-ghost'}" onclick="gitOpsCheckout('${esc(repoName)}','${esc(b)}')">${esc(b)}</button>`).join('')}</div>` : ''}
          </div>
          <div class="card">
            <div class="card-title">Actions</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-sm btn-primary" onclick="gitOpsPull('${esc(repoName)}')">Pull</button>
              <button class="btn btn-sm btn-ghost" onclick="gitOpsPush('${esc(repoName)}')">Push</button>
              <button class="btn btn-sm btn-ghost" onclick="loadGitOpsPage('${esc(repoName)}')">Refresh</button>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-title">Status</div>
          ${
            (git.status || []).length === 0
              ? '<div style="color:var(--success);font-size:13px">Working tree clean</div>'
              : `
          <div style="font-family:var(--mono);font-size:12px;color:var(--text-secondary)">${(
            git.status || []
          )
            .map((s) => {
              const cls = s.match(/^\?\?/)
                ? 'color:var(--info)'
                : s.match(/^\s*M/)
                  ? 'color:var(--warning)'
                  : s.match(/^[MADRC]/)
                    ? 'color:var(--success)'
                    : '';
              return `<div style="${cls}">${esc(s)}</div>`;
            })
            .join('')}</div>`
          }
        </div>
        ${diffHtml ? `<div class="card"><div class="card-title">Diff</div><div class="diff-viewer">${diffHtml}</div></div>` : ''}
        <div class="card">
          <div class="card-title">Commit</div>
          <div class="form-group"><label>Message</label><input class="search-input" id="gitops-commit-msg" placeholder="Commit message" style="max-width:100%"></div>
          ${allFiles.length > 0 ? `<div class="form-group"><label>Files</label><div style="max-height:150px;overflow-y:auto">${allFiles.map((f) => `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);padding:2px 0;cursor:pointer"><input type="checkbox" class="gitops-file-check" value="${esc(f)}" checked> ${esc(f)}</label>`).join('')}</div></div>` : ''}
          <button class="btn btn-primary btn-sm" onclick="gitOpsCommit('${esc(repoName)}')">Commit</button>
        </div>
        <div class="card">
          <div class="card-title">Recent Commits</div>
          <div class="table-wrap" style="max-height:300px;overflow-y:auto"><table>
            <thead><tr><th>Hash</th><th>Message</th><th>Author</th><th>Date</th></tr></thead>
            <tbody>${(git.log || [])
              .slice(0, 20)
              .map(
                (c) => `<tr>
              <td style="font-family:var(--mono);font-size:11px;color:var(--accent)">${esc((c.hash || '').slice(0, 7))}</td>
              <td style="color:var(--text);font-size:12px">${esc(truncate(c.message || c, 80))}</td>
              <td style="font-size:11px;color:var(--text-muted)">${esc(c.author || '')}</td>
              <td style="font-size:11px;color:var(--text-muted)">${c.date ? timeAgo(c.date) : ''}</td>
            </tr>`,
              )
              .join('')}</tbody>
          </table></div>
        </div>`;
    } catch (err) {
      content.innerHTML =
        '<div class="card empty">Failed to load git data</div>';
    }
  };

  window.loadGitOpsPage = loadGitOps;
  document.getElementById('gitops-repo').onchange = (e) =>
    loadGitOps(e.target.value);
  loadGitOps(repos[0].name);
}

window.gitOpsCheckout = async (repo, branch) => {
  try {
    const r = await api(`/dev/git/${encodeURIComponent(repo)}/checkout`, {
      method: 'POST',
      body: JSON.stringify({ branch }),
    });
    if (r.ok !== false) {
      toast('Switched to ' + branch, 'success');
      window.loadGitOpsPage(repo);
    } else toast(r.error || 'Checkout failed', 'error');
  } catch {
    toast('Checkout failed', 'error');
  }
};

window.gitOpsPull = async (repo) => {
  try {
    const r = await api(`/dev/git/${encodeURIComponent(repo)}/pull`, {
      method: 'POST',
    });
    if (r.ok !== false) {
      toast(r.message || 'Pull complete', 'success');
      window.loadGitOpsPage(repo);
    } else toast(r.error || 'Pull failed', 'error');
  } catch {
    toast('Pull failed', 'error');
  }
};

window.gitOpsPush = async (repo) => {
  try {
    const r = await api(`/dev/git/${encodeURIComponent(repo)}/push`, {
      method: 'POST',
    });
    if (r.ok !== false) {
      toast(r.message || 'Push complete', 'success');
      window.loadGitOpsPage(repo);
    } else toast(r.error || 'Push failed', 'error');
  } catch {
    toast('Push failed', 'error');
  }
};

window.gitOpsCommit = async (repo) => {
  const msg = document.getElementById('gitops-commit-msg')?.value?.trim();
  if (!msg) {
    toast('Enter a commit message', 'warning');
    return;
  }
  const checked = document.querySelectorAll('.gitops-file-check:checked');
  const files = Array.from(checked).map((c) => c.value);
  try {
    const r = await api(`/dev/git/${encodeURIComponent(repo)}/commit`, {
      method: 'POST',
      body: JSON.stringify({ message: msg, files }),
    });
    if (r.ok !== false) {
      toast(r.message || 'Committed', 'success');
      window.loadGitOpsPage(repo);
    } else toast(r.error || 'Commit failed', 'error');
  } catch {
    toast('Commit failed', 'error');
  }
};

// --- Test Runner ---
async function renderTestRunner(el) {
  let repos = [];
  try {
    repos = await api('/files/repos');
  } catch {}

  el.innerHTML = `
    <div class="page-header"><h2>Test Runner</h2>
      <select class="search-input" id="testrunner-repo" style="max-width:250px">
        ${repos.map((r) => `<option value="${r.name}">${esc(r.name)}</option>`).join('')}
      </select>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="card-title" style="margin:0">Test Results</div>
        <button class="btn btn-primary btn-sm" id="testrunner-run-btn" onclick="runTests()">Run Tests</button>
      </div>
      <div id="testrunner-status"></div>
      <div id="testrunner-output"></div>
    </div>
    <div class="card">
      <div class="card-title">Last Results</div>
      <div id="testrunner-last"><div class="empty">No test results yet. Click Run Tests to start.</div></div>
    </div>`;

  // Load last results
  if (repos.length > 0) loadTestResults(repos[0].name);
  document.getElementById('testrunner-repo').onchange = (e) =>
    loadTestResults(e.target.value);
}

async function loadTestResults(repo) {
  const lastEl = document.getElementById('testrunner-last');
  if (!lastEl) return;
  try {
    const r = await api(`/dev/test/${encodeURIComponent(repo)}/results`);
    if (r.output) {
      const badge = r.passed
        ? '<span class="badge badge-success">Passed</span>'
        : '<span class="badge badge-error">Failed</span>';
      lastEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          ${badge}
          ${r.timestamp ? `<span style="font-size:12px;color:var(--text-muted)">${formatTime(r.timestamp)}</span>` : ''}
          ${r.duration ? `<span style="font-size:12px;color:var(--text-muted)">Duration: ${r.duration}</span>` : ''}
        </div>
        <div class="log-viewer">${esc(r.output)}</div>`;
    } else {
      lastEl.innerHTML =
        '<div class="empty">No test results for this repo</div>';
    }
  } catch {
    lastEl.innerHTML = '<div class="empty">No test results available</div>';
  }
}

window.runTests = async () => {
  const repo = document.getElementById('testrunner-repo')?.value;
  if (!repo) {
    toast('Select a repository', 'warning');
    return;
  }
  const btn = document.getElementById('testrunner-run-btn');
  const statusEl = document.getElementById('testrunner-status');
  const outputEl = document.getElementById('testrunner-output');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Running...';
  }
  if (statusEl)
    statusEl.innerHTML =
      '<div class="loading">Running tests (this may take a few minutes)</div>';
  if (outputEl) outputEl.innerHTML = '';
  try {
    const r = await api(`/dev/test/${encodeURIComponent(repo)}/run`, {
      method: 'POST',
    });
    if (r.output) {
      const badge = r.passed
        ? '<span class="badge badge-success">Passed</span>'
        : '<span class="badge badge-error">Failed</span>';
      if (statusEl)
        statusEl.innerHTML = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">${badge} ${r.duration ? `<span style="font-size:12px;color:var(--text-muted)">Duration: ${r.duration}</span>` : ''}</div>`;
      if (outputEl)
        outputEl.innerHTML = `<div class="log-viewer">${esc(r.output)}</div>`;
    } else if (r.ok !== false) {
      if (statusEl)
        statusEl.innerHTML =
          '<div style="color:var(--success)">Tests started. Refresh to see results.</div>';
    } else {
      if (statusEl)
        statusEl.innerHTML = `<div style="color:var(--error)">${esc(r.error || 'Tests failed')}</div>`;
    }
    loadTestResults(repo);
  } catch {
    if (statusEl)
      statusEl.innerHTML =
        '<div style="color:var(--error)">Failed to run tests</div>';
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Run Tests';
  }
};

// --- Snippets ---
let snippetsData = [];
async function renderSnippets(el) {
  try {
    snippetsData = await api('/dev/snippets');
  } catch {
    snippetsData = [];
  }

  el.innerHTML = `
    <div class="page-header"><h2>Snippets</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="search-input" id="snippet-search" placeholder="Search snippets..." style="max-width:250px">
        <button class="btn btn-primary btn-sm" onclick="showNewSnippetForm()">New Snippet</button>
      </div>
    </div>
    <div id="snippet-form-area"></div>
    <div id="snippet-list"></div>`;

  renderSnippetList(snippetsData);
  document.getElementById('snippet-search').oninput = () => {
    const q = document.getElementById('snippet-search').value.toLowerCase();
    const filtered = snippetsData.filter(
      (s) =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.language || '').toLowerCase().includes(q) ||
        (s.tags || []).some((t) => t.toLowerCase().includes(q)),
    );
    renderSnippetList(filtered);
  };
}

function renderSnippetList(snippets) {
  const el = document.getElementById('snippet-list');
  if (!el) return;
  if (snippets.length === 0) {
    el.innerHTML =
      '<div class="card empty">No snippets found. Create one to get started.</div>';
    return;
  }
  el.innerHTML = snippets
    .map(
      (s) => `
    <div class="card" style="cursor:pointer" onclick="viewSnippet('${esc(s.id)}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:15px;font-weight:600;color:var(--text)">${esc(s.title)}</div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
            <span class="badge badge-accent">${esc(s.language || 'text')}</span>
            ${(s.tags || []).map((t) => `<span class="badge badge-muted">${esc(t)}</span>`).join('')}
          </div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteSnippet('${esc(s.id)}',this)">Delete</button>
      </div>
      <div class="snippet-code" style="margin-top:8px">${esc(truncate(s.code || '', 200))}</div>
    </div>`,
    )
    .join('');
}

window.showNewSnippetForm = () => {
  const area = document.getElementById('snippet-form-area');
  if (!area) return;
  area.innerHTML = `
    <div class="card">
      <div class="card-title">New Snippet</div>
      <div class="grid grid-2">
        <div class="form-group"><label>Title</label><input id="snippet-title" placeholder="My snippet" class="search-input" style="max-width:100%"></div>
        <div class="form-group"><label>Language</label><select id="snippet-lang" class="search-input" style="max-width:100%">
          <option value="javascript">JavaScript</option><option value="typescript">TypeScript</option><option value="python">Python</option><option value="bash">Bash</option><option value="sql">SQL</option><option value="json">JSON</option><option value="html">HTML</option><option value="css">CSS</option><option value="markdown">Markdown</option><option value="text">Text</option>
        </select></div>
      </div>
      <div class="form-group"><label>Tags (comma-separated)</label><input id="snippet-tags" placeholder="utils, helper" class="search-input" style="max-width:100%"></div>
      <div class="form-group"><label>Code</label><textarea id="snippet-code" style="width:100%;min-height:200px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical;line-height:1.6" placeholder="// Your code here"></textarea></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" onclick="saveNewSnippet()">Save</button>
        <button class="btn btn-ghost" onclick="document.getElementById('snippet-form-area').innerHTML=''">Cancel</button>
      </div>
    </div>`;
};

window.saveNewSnippet = async () => {
  const title = document.getElementById('snippet-title')?.value?.trim();
  if (!title) {
    toast('Enter a title', 'warning');
    return;
  }
  const tags = (document.getElementById('snippet-tags')?.value || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  try {
    const r = await api('/dev/snippets', {
      method: 'POST',
      body: JSON.stringify({
        title,
        language: document.getElementById('snippet-lang')?.value || 'text',
        tags,
        code: document.getElementById('snippet-code')?.value || '',
      }),
    });
    if (r.ok !== false) {
      toast('Snippet saved', 'success');
      navigate('gitcode');
    } else toast(r.error || 'Failed', 'error');
  } catch {
    toast('Failed to save snippet', 'error');
  }
};

window.viewSnippet = async (id) => {
  const area = document.getElementById('snippet-form-area');
  if (!area) return;
  try {
    const s = await api(`/dev/snippets/${encodeURIComponent(id)}`);
    area.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="card-title" style="margin:0">${esc(s.title)}</div>
          <div style="display:flex;gap:6px;align-items:center">
            <span class="badge badge-accent">${esc(s.language || 'text')}</span>
            ${(s.tags || []).map((t) => `<span class="badge badge-muted">${esc(t)}</span>`).join('')}
          </div>
        </div>
        <div class="form-group"><label>Title</label><input id="snippet-edit-title" value="${esc(s.title)}" class="search-input" style="max-width:100%"></div>
        <div class="form-group"><label>Code</label><textarea id="snippet-edit-code" style="width:100%;min-height:300px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;resize:vertical;line-height:1.6">${esc(s.code || '')}</textarea></div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" onclick="updateSnippet('${esc(s.id)}')">Save</button>
          <button class="btn btn-ghost" onclick="document.getElementById('snippet-form-area').innerHTML=''">Close</button>
        </div>
      </div>`;
    area.scrollIntoView({ behavior: 'smooth' });
  } catch {
    toast('Failed to load snippet', 'error');
  }
};

window.updateSnippet = async (id) => {
  try {
    const r = await api(`/dev/snippets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: document.getElementById('snippet-edit-title')?.value?.trim(),
        code: document.getElementById('snippet-edit-code')?.value,
      }),
    });
    if (r.ok !== false) {
      toast('Snippet updated', 'success');
      navigate('gitcode');
    } else toast(r.error || 'Failed', 'error');
  } catch {
    toast('Failed to update snippet', 'error');
  }
};

window.deleteSnippet = async (id, btnEl) => {
  inlineConfirm(btnEl, 'Delete this snippet?', async () => {
    try {
      const r = await api(`/dev/snippets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (r.ok !== false) {
        toast('Snippet deleted', 'success');
        navigate('gitcode');
      } else toast(r.error || 'Failed', 'error');
    } catch {
      toast('Failed to delete snippet', 'error');
    }
  });
};

// --- Monitoring ---
let monitoringTimer = null;
async function renderMonitoring(el) {
  el.innerHTML = `
    <div class="page-header"><h2>Monitoring</h2>
      <span class="badge badge-muted" id="monitoring-refresh-badge">Auto-refresh: 30s</span>
    </div>
    <div id="monitoring-stats"><div class="loading">Loading</div></div>
    <div class="card" id="monitoring-chart-card">
      <div class="card-title">History</div>
      <div id="monitoring-chart"><div class="loading">Loading</div></div>
    </div>
    <div class="card">
      <div class="card-title">Recent Snapshots</div>
      <div id="monitoring-history"><div class="loading">Loading</div></div>
    </div>`;

  const loadMonitoring = async () => {
    try {
      const sys = await api('/system');
      const statsEl = document.getElementById('monitoring-stats');
      if (!statsEl) return;
      const cpuLoad = sys.system?.loadAvg?.[0]?.toFixed(2) || '0';
      const cpuPct = Math.min(
        100,
        (parseFloat(cpuLoad) / (sys.system?.cpus || 1)) * 100,
      ).toFixed(1);
      const ramPct = sys.system?.totalMemory
        ? ((1 - sys.system.freeMemory / sys.system.totalMemory) * 100).toFixed(
            1,
          )
        : '0';
      const heapPct = sys.memory?.heapLimit
        ? ((sys.memory.heapUsed / sys.memory.heapLimit) * 100).toFixed(1)
        : '0';

      statsEl.innerHTML = `
        <div class="grid grid-3" style="margin-bottom:16px">
          <div class="card" style="margin:0">
            <div class="card-title">CPU Load</div>
            <div style="font-size:24px;font-weight:700;color:var(--text);margin-bottom:8px">${cpuLoad} <span style="font-size:14px;color:var(--text-muted)">/ ${sys.system?.cpus || '?'} cores</span></div>
            <div class="monitoring-bar"><div class="monitoring-fill" style="width:${cpuPct}%;background:${parseFloat(cpuPct) > 80 ? 'var(--error)' : parseFloat(cpuPct) > 50 ? 'var(--warning)' : 'var(--success)'}"></div></div>
          </div>
          <div class="card" style="margin:0">
            <div class="card-title">RAM Usage</div>
            <div style="font-size:24px;font-weight:700;color:var(--text);margin-bottom:8px">${ramPct}% <span style="font-size:14px;color:var(--text-muted)">${formatBytes(sys.system?.totalMemory - sys.system?.freeMemory)} / ${formatBytes(sys.system?.totalMemory)}</span></div>
            <div class="monitoring-bar"><div class="monitoring-fill" style="width:${ramPct}%;background:${parseFloat(ramPct) > 80 ? 'var(--error)' : parseFloat(ramPct) > 50 ? 'var(--warning)' : 'var(--success)'}"></div></div>
          </div>
          <div class="card" style="margin:0">
            <div class="card-title">Heap Usage</div>
            <div style="font-size:24px;font-weight:700;color:var(--text);margin-bottom:8px">${heapPct}% <span style="font-size:14px;color:var(--text-muted)">${formatBytes(sys.memory?.heapUsed)} / ${formatBytes(sys.memory?.heapLimit)}</span></div>
            <div class="monitoring-bar"><div class="monitoring-fill" style="width:${heapPct}%;background:${parseFloat(heapPct) > 80 ? 'var(--error)' : parseFloat(heapPct) > 50 ? 'var(--warning)' : 'var(--success)'}"></div></div>
          </div>
          ${
            sys.system?.disk
              ? `<div class="card" style="margin:0">
            <div class="card-title">Disk Usage</div>
            <div style="font-size:24px;font-weight:700;color:var(--text);margin-bottom:8px">${sys.system.disk.percent}% <span style="font-size:14px;color:var(--text-muted)">${formatBytes(sys.system.disk.used)} / ${formatBytes(sys.system.disk.total)}</span></div>
            <div class="monitoring-bar"><div class="monitoring-fill" style="width:${sys.system.disk.percent}%;background:${sys.system.disk.percent > 85 ? 'var(--error)' : sys.system.disk.percent > 70 ? 'var(--warning)' : 'var(--success)'}"></div></div>
          </div>`
              : ''
          }
        </div>`;
    } catch {}

    // Load history
    try {
      const history = await api('/dev/monitoring/history');
      const historyEl = document.getElementById('monitoring-history');
      const chartEl = document.getElementById('monitoring-chart');
      const items = Array.isArray(history) ? history : history.snapshots || [];
      if (chartEl && items.length > 0) {
        const max = Math.max(
          ...items.map((h) => h.cpuLoad || h.cpu || h.load || 0),
          0.01,
        );
        const bars = items
          .slice(-50)
          .map((h) => {
            const val = h.cpuLoad || h.cpu || h.load || 0;
            const height = Math.max(4, (val / max) * 150);
            return `<div class="chart-bar" style="height:${height}px"><div class="tooltip">${h.timestamp ? formatTime(h.timestamp) : ''}: load ${val}</div></div>`;
          })
          .join('');
        chartEl.innerHTML = `<div class="chart-container"><div class="chart-bar-group">${bars}</div></div>`;
      } else if (chartEl) {
        chartEl.innerHTML = '<div class="empty">No history data yet</div>';
      }
      if (historyEl) {
        if (items.length === 0) {
          historyEl.innerHTML =
            '<div class="empty">No monitoring snapshots available</div>';
        } else {
          historyEl.innerHTML = `<div class="table-wrap" style="max-height:400px;overflow-y:auto"><table>
            <thead><tr><th>Time</th><th>CPU Load</th><th>RAM %</th><th>Heap %</th></tr></thead>
            <tbody>${items
              .slice(-50)
              .reverse()
              .map(
                (h) => `<tr>
              <td style="font-size:11px">${h.timestamp ? formatTime(h.timestamp) : '-'}</td>
              <td>${(h.cpuLoad || h.cpu || h.load || 0).toFixed ? (h.cpuLoad || h.cpu || h.load || 0).toFixed(2) : '0'}</td>
              <td>${h.ramPct || (h.memUsed && h.memTotal ? ((h.memUsed / h.memTotal) * 100).toFixed(1) : '-')}%</td>
              <td>${h.heapPct || h.heap || '-'}%</td>
            </tr>`,
              )
              .join('')}</tbody>
          </table></div>`;
        }
      }
    } catch {}
  };

  await loadMonitoring();
  monitoringTimer = setInterval(loadMonitoring, 30000);
  pollTimers.push(monitoringTimer);
}

// --- Deploy Pipelines ---
async function renderPipelines(el) {
  let pipelines = [];
  try {
    pipelines = await api('/dev/pipelines');
  } catch {}
  let repos = [];
  try {
    repos = await api('/files/repos');
  } catch {}

  el.innerHTML = `
    <div class="page-header"><h2>Deploy Pipelines</h2>
      <button class="btn btn-primary btn-sm" onclick="document.getElementById('new-pipeline-form').style.display=document.getElementById('new-pipeline-form').style.display==='none'?'block':'none'">New Pipeline</button>
    </div>
    <div class="card" id="new-pipeline-form" style="display:none">
      <div class="card-title">Create Pipeline</div>
      <form id="pipeline-create-form">
        <div class="grid grid-2">
          <div class="form-group"><label>Name</label><input id="pipeline-name" placeholder="Deploy to production" required></div>
          <div class="form-group"><label>Repository</label><select id="pipeline-repo">
            ${repos.map((r) => `<option value="${r.name}">${esc(r.name)}</option>`).join('')}
          </select></div>
        </div>
        <div class="card-title" style="margin-top:8px">Steps</div>
        <div id="pipeline-steps-list">
          <div class="pipeline-step-row" style="display:flex;gap:8px;margin-bottom:8px;align-items:end">
            <div class="form-group" style="margin:0;flex:0 0 200px"><label>Step Name</label><input class="pipeline-step-name search-input" placeholder="Build" style="max-width:100%"></div>
            <div class="form-group" style="margin:0;flex:1"><label>Command</label><input class="pipeline-step-cmd search-input" placeholder="npm run build" style="max-width:100%"></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button type="button" class="btn btn-sm btn-ghost" onclick="addPipelineStep()">+ Add Step</button>
        </div>
        <div style="margin-top:16px"><button type="submit" class="btn btn-primary">Create Pipeline</button></div>
      </form>
    </div>
    ${
      pipelines.length === 0
        ? '<div class="card empty">No pipelines configured. Create one to automate deployments.</div>'
        : pipelines
            .map(
              (p) => `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <div style="font-size:16px;font-weight:600;color:var(--text)">${esc(p.name)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Repo: ${esc(p.repo)} \u2022 ${p.steps?.length || 0} steps ${p.lastRunAt ? ' \u2022 Last run: ' + timeAgo(p.lastRunAt) : ''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          ${p.lastRunStatus === 'success' ? '<span class="badge badge-success">Success</span>' : p.lastRunStatus === 'failed' ? '<span class="badge badge-error">Failed</span>' : '<span class="badge badge-muted">Never run</span>'}
          <button class="btn btn-sm btn-primary" onclick="runPipeline('${esc(p.id)}',this)">Run</button>
          <button class="btn btn-sm btn-danger" onclick="deletePipeline('${esc(p.id)}',this)">Delete</button>
        </div>
      </div>
      <div class="pipeline-steps">
        ${(p.steps || []).map((s, i) => `<div class="pipeline-step"><span class="pipeline-step-num">${i + 1}</span><span style="font-weight:500;color:var(--text)">${esc(s.name)}</span><span style="font-family:var(--mono);color:var(--text-muted);font-size:11px;flex:1">${esc(s.command)}</span></div>`).join('')}
      </div>
      <div id="pipeline-output-${esc(p.id)}" style="margin-top:8px"></div>
    </div>`,
            )
            .join('')
    }`;

  const form = document.getElementById('pipeline-create-form');
  if (form)
    form.onsubmit = async (e) => {
      e.preventDefault();
      const stepRows = document.querySelectorAll('.pipeline-step-row');
      const steps = [];
      stepRows.forEach((row) => {
        const name = row.querySelector('.pipeline-step-name')?.value?.trim();
        const command = row.querySelector('.pipeline-step-cmd')?.value?.trim();
        if (name && command) steps.push({ name, command });
      });
      if (steps.length === 0) {
        toast('Add at least one step', 'warning');
        return;
      }
      try {
        const r = await api('/dev/pipelines', {
          method: 'POST',
          body: JSON.stringify({
            name: document.getElementById('pipeline-name').value,
            repo: document.getElementById('pipeline-repo').value,
            steps,
          }),
        });
        if (r.ok !== false) {
          toast('Pipeline created', 'success');
          navigate('pipelines');
        } else toast(r.error || 'Failed', 'error');
      } catch {
        toast('Failed to create pipeline', 'error');
      }
    };
}

window.addPipelineStep = () => {
  const list = document.getElementById('pipeline-steps-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'pipeline-step-row';
  row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:end';
  row.innerHTML = `
    <div class="form-group" style="margin:0;flex:0 0 200px"><input class="pipeline-step-name search-input" placeholder="Step name" style="max-width:100%"></div>
    <div class="form-group" style="margin:0;flex:1"><input class="pipeline-step-cmd search-input" placeholder="Command" style="max-width:100%"></div>
    <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()" style="flex-shrink:0">X</button>`;
  list.appendChild(row);
};

window.runPipeline = async (id, btnEl) => {
  inlineConfirm(btnEl, 'Run this pipeline?', async () => {
    const outputEl = document.getElementById('pipeline-output-' + id);
    if (outputEl)
      outputEl.innerHTML = '<div class="loading">Running pipeline</div>';
    try {
      const r = await api(`/dev/pipelines/${encodeURIComponent(id)}/run`, {
        method: 'POST',
      });
      if (outputEl) {
        if (r.output) {
          outputEl.innerHTML = `<div class="log-viewer" style="max-height:200px">${esc(r.output)}</div>`;
        }
        if (r.ok !== false) toast('Pipeline completed', 'success');
        else toast(r.error || 'Pipeline failed', 'error');
      }
      navigate('pipelines');
    } catch {
      if (outputEl) outputEl.innerHTML = '';
      toast('Pipeline failed', 'error');
    }
  });
};

window.deletePipeline = async (id, btnEl) => {
  inlineConfirm(btnEl, 'Delete this pipeline?', async () => {
    try {
      const r = await api(`/dev/pipelines/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (r.ok !== false) {
        toast('Pipeline deleted', 'success');
        navigate('pipelines');
      } else toast(r.error || 'Failed', 'error');
    } catch {
      toast('Failed to delete pipeline', 'error');
    }
  });
};

// --- Review Rules ---
async function renderReviewRules(el) {
  let rules = '';
  try {
    const r = await api('/dev/review-rules');
    rules = r.content || r.rules || '';
  } catch {}

  const defaultTemplate = `# Code Review Rules

## General
- Use TypeScript strict mode
- All functions must have return types
- No console.log in production code

## Testing
- New features require tests
- Minimum 80% code coverage for new code

## Security
- Never commit secrets or credentials
- Validate all user input
- Use parameterized queries for SQL

## Style
- Use const/let, never var
- Async/await over callbacks
- Meaningful variable names`;

  if (!rules) rules = defaultTemplate;

  el.innerHTML = `
    <div class="page-header"><h2>Review Rules</h2></div>
    <div class="card">
      <div class="card-title">Code Review Rules</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Define your team's code review standards. These rules are used during PR reviews and code checks.</p>
      <textarea id="review-rules-editor" style="width:100%;min-height:500px;padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:13px;resize:vertical;line-height:1.6">${esc(rules)}</textarea>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
        <button class="btn btn-primary" onclick="saveReviewRules()">Save</button>
        <span id="review-rules-msg" style="font-size:12px"></span>
      </div>
    </div>`;
}

window.saveReviewRules = async () => {
  const content = document.getElementById('review-rules-editor')?.value;
  const msg = document.getElementById('review-rules-msg');
  try {
    const r = await api('/dev/review-rules', {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    if (r.ok !== false) {
      if (msg) {
        msg.textContent = 'Saved';
        msg.style.color = 'var(--success)';
      }
      toast('Review rules saved', 'success');
    } else {
      if (msg) {
        msg.textContent = r.error || 'Failed';
        msg.style.color = 'var(--error)';
      }
    }
  } catch {
    if (msg) {
      msg.textContent = 'Error';
      msg.style.color = 'var(--error)';
    }
  }
  setTimeout(() => {
    if (msg) msg.textContent = '';
  }, 3000);
};

// --- Session Forking (Feature 14) ---
window.forkSession = async (group, sessionId, messageIndex) => {
  try {
    const messages = await api(
      `/sessions/${encodeURIComponent(group)}/${encodeURIComponent(sessionId)}`,
    );
    const subset = messages.slice(0, messageIndex + 1);
    const contextLines = subset
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
    const prompt = `[Continuing conversation from session ${sessionId.slice(0, 8)}...]\n\nPrevious context:\n${contextLines}\n\n---\nContinue from here:`;
    // Store in sessionStorage so the chat page can pick it up
    sessionStorage.setItem('fork_prompt', prompt);
    sessionStorage.setItem('fork_group', group);
    navigate('chat');
  } catch {
    toast('Failed to fork session', 'error');
  }
};

// --- Router ---
window.toggleNavSection = (secId) => {
  const group = document.getElementById('navgroup-' + secId);
  const arrow = document.getElementById('arrow-' + secId);
  if (!group) return;
  group.classList.toggle('collapsed');
  if (arrow) arrow.classList.toggle('collapsed');
  const saved = JSON.parse(localStorage.getItem('nav_collapsed') || '{}');
  saved[secId] = group.classList.contains('collapsed');
  localStorage.setItem('nav_collapsed', JSON.stringify(saved));
};

window.toggleMobileMenu = () => {
  const menu = document.getElementById('mobile-menu');
  const overlay = document.querySelector('.sidebar-overlay');
  if (menu) menu.classList.toggle('open');
  if (overlay) overlay.classList.toggle('visible');
};

// --- Custom Containers ---
async function renderCustomContainers(el) {
  const containers = await api('/custom-containers');
  el.innerHTML = `
    <div class="page-header"><h2>Custom Containers</h2>
      <button class="btn btn-primary btn-sm" onclick="document.getElementById('cc-form').style.display=document.getElementById('cc-form').style.display==='none'?'block':'none'">New Container</button>
    </div>
    <div id="cc-form" style="display:none" class="card">
      <div class="card-title">New Container</div>
      <div class="form-group"><label>Name</label><input class="search-input" id="cc-name" placeholder="my-service"></div>
      <div class="form-group"><label>Description</label><input class="search-input" id="cc-desc" placeholder="What this container does"></div>
      <div class="form-group"><label>Image (Docker Hub)</label><input class="search-input" id="cc-image" placeholder="redis:latest"></div>
      <div class="form-group"><label>Build Context (path to Dockerfile dir, alternative to image)</label><input class="search-input" id="cc-buildctx" placeholder="/home/user/my-app"></div>
      <div class="form-group"><label>Command Override</label><input class="search-input" id="cc-command" placeholder="optional"></div>
      <div class="form-group"><label>Environment Variables</label><div id="cc-envvars"></div><button class="btn btn-sm btn-ghost" onclick="addEnvRow()">+ Add Env Var</button></div>
      <div class="form-group"><label>Volumes</label><div id="cc-volumes"></div><button class="btn btn-sm btn-ghost" onclick="addVolumeRow()">+ Add Volume</button></div>
      <div class="form-group"><label>Ports</label><div id="cc-ports"></div><button class="btn btn-sm btn-ghost" onclick="addPortRow()">+ Add Port</button></div>
      <div class="form-group"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="cc-autostart"> Auto-start</label></div>
      <button class="btn btn-primary" onclick="createCustomContainer()">Create Container</button>
    </div>
    ${
      containers.length === 0
        ? '<div class="card empty">No custom containers configured</div>'
        : containers
            .map(
              (c) => `
      <div class="card" id="cc-card-${c.id}">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>${esc(c.name)}</span>
          <span class="badge ${c.state.status === 'running' ? 'badge-success' : 'badge-error'}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.state.status === 'running' ? 'var(--success)' : 'var(--error)'};margin-right:6px"></span>${esc(c.state.status)}</span>
        </div>
        ${c.description ? `<div style="color:var(--text-muted);margin-bottom:8px">${esc(c.description)}</div>` : ''}
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
          <div><strong>Image:</strong> <code>${esc(c.image)}</code></div>
          ${c.state.containerId ? `<div><strong>Container ID:</strong> <code>${esc(c.state.containerId)}</code></div>` : ''}
          ${c.ports.length ? `<div><strong>Ports:</strong> ${c.ports.map((p) => `${p.host}:${p.container}`).join(', ')}</div>` : ''}
          ${c.volumes.length ? `<div><strong>Volumes:</strong> ${c.volumes.map((v) => `${esc(v.host)}:${esc(v.container)}${v.readonly ? ' (ro)' : ''}`).join(', ')}</div>` : ''}
          ${
            Object.keys(c.envVars).length
              ? `<div><strong>Env:</strong> ${Object.entries(c.envVars)
                  .map(([k, v]) => `${esc(k)}=${esc(v)}`)
                  .join(', ')}</div>`
              : ''
          }
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${
            c.state.status === 'running'
              ? `<button class="btn btn-sm btn-danger" onclick="stopContainer('${c.id}', this)">Stop</button><button class="btn btn-sm btn-ghost" onclick="restartContainer('${c.id}')">Restart</button>`
              : `<button class="btn btn-sm btn-primary" onclick="startContainer('${c.id}', this)">Start</button>`
          }
          ${c.buildContext ? `<button class="btn btn-sm btn-ghost" onclick="buildContainer('${c.id}', this)">Build</button>` : ''}
          <button class="btn btn-sm btn-ghost" onclick="showContainerLogs('${c.id}')">Logs</button>
          <button class="btn btn-sm btn-ghost" onclick="editContainer('${c.id}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteContainer('${c.id}', this)">Delete</button>
        </div>
        <div id="cc-logs-${c.id}" style="display:none;margin-top:12px"><pre class="log-viewer" style="max-height:300px;overflow:auto;background:var(--bg-secondary);padding:12px;border-radius:6px;font-size:11px;font-family:var(--mono)"></pre></div>
      </div>`,
            )
            .join('')
    }`;
}

window.addEnvRow = () => {
  const container = document.getElementById('cc-envvars');
  container.insertAdjacentHTML(
    'beforeend',
    `<div style="display:flex;gap:6px;margin-top:4px"><input class="search-input" placeholder="KEY" style="flex:1"><input class="search-input" placeholder="value" type="password" style="flex:2"><button class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">\u00d7</button></div>`,
  );
};

window.addVolumeRow = () => {
  const container = document.getElementById('cc-volumes');
  container.insertAdjacentHTML(
    'beforeend',
    `<div style="display:flex;gap:6px;margin-top:4px;align-items:center"><input class="search-input" placeholder="/host/path" style="flex:1"><input class="search-input" placeholder="/container/path" style="flex:1"><label style="font-size:11px;display:flex;align-items:center;gap:4px"><input type="checkbox" class="vol-readonly"> ro</label><button class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">\u00d7</button></div>`,
  );
};

window.addPortRow = () => {
  const container = document.getElementById('cc-ports');
  container.insertAdjacentHTML(
    'beforeend',
    `<div style="display:flex;gap:6px;margin-top:4px"><input class="search-input" placeholder="Host port" type="number" style="flex:1"><input class="search-input" placeholder="Container port" type="number" style="flex:1"><button class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">\u00d7</button></div>`,
  );
};

window.createCustomContainer = async () => {
  const name = document.getElementById('cc-name').value.trim();
  const description = document.getElementById('cc-desc').value.trim();
  const image = document.getElementById('cc-image').value.trim();
  const buildContext = document.getElementById('cc-buildctx').value.trim();
  const command = document.getElementById('cc-command').value.trim();
  const autoStart = document.getElementById('cc-autostart').checked;

  if (!name || (!image && !buildContext)) {
    toast('Name and image (or build context) required', 'error');
    return;
  }

  const envVars = {};
  document.querySelectorAll('#cc-envvars > div').forEach((row) => {
    const inputs = row.querySelectorAll('input');
    if (inputs[0].value.trim())
      envVars[inputs[0].value.trim()] = inputs[1].value;
  });

  const volumes = [];
  document.querySelectorAll('#cc-volumes > div').forEach((row) => {
    const inputs = row.querySelectorAll('input');
    if (inputs[0].value.trim() && inputs[1].value.trim()) {
      volumes.push({
        host: inputs[0].value.trim(),
        container: inputs[1].value.trim(),
        readonly: inputs[2]?.checked || false,
      });
    }
  });

  const ports = [];
  document.querySelectorAll('#cc-ports > div').forEach((row) => {
    const inputs = row.querySelectorAll('input');
    if (inputs[0].value && inputs[1].value) {
      ports.push({
        host: parseInt(inputs[0].value),
        container: parseInt(inputs[1].value),
      });
    }
  });

  try {
    const r = await api('/custom-containers', {
      method: 'POST',
      body: JSON.stringify({
        name,
        description,
        image: image || undefined,
        buildContext: buildContext || undefined,
        envVars,
        volumes,
        ports,
        command: command || undefined,
        autoStart,
      }),
    });
    if (r.ok) {
      toast('Container created', 'success');
      navigate('containers');
    } else toast(r.error || 'Failed', 'error');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
};

window.startContainer = async (id, btnEl) => {
  btnEl.disabled = true;
  btnEl.textContent = 'Starting...';
  try {
    const r = await api(`/custom-containers/${id}/start`, { method: 'POST' });
    if (r.ok) {
      toast('Container started', 'success');
      navigate('containers');
    } else {
      toast(r.error || 'Start failed', 'error');
      navigate('containers');
    }
  } catch (e) {
    toast('Error: ' + e.message, 'error');
    navigate('containers');
  }
};

window.stopContainer = async (id, btnEl) => {
  inlineConfirm(btnEl, 'Stop this container?', async () => {
    try {
      const r = await api(`/custom-containers/${id}/stop`, { method: 'POST' });
      if (r.ok) {
        toast('Container stopped', 'success');
        navigate('containers');
      } else toast(r.error || 'Stop failed', 'error');
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  });
};

window.restartContainer = async (id) => {
  try {
    const r = await api(`/custom-containers/${id}/restart`, { method: 'POST' });
    if (r.ok) toast('Container restarted', 'success');
    else toast(r.error || 'Restart failed', 'error');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
};

window.buildContainer = async (id, btnEl) => {
  btnEl.disabled = true;
  btnEl.textContent = 'Building...';
  try {
    const r = await api(`/custom-containers/${id}/build`, { method: 'POST' });
    if (r.ok) {
      toast('Build complete', 'success');
      navigate('containers');
    } else {
      toast(r.error || 'Build failed', 'error');
      navigate('containers');
    }
  } catch (e) {
    toast('Error: ' + e.message, 'error');
    navigate('containers');
  }
};

window.showContainerLogs = async (id) => {
  const logsDiv = document.getElementById(`cc-logs-${id}`);
  if (!logsDiv) return;
  if (logsDiv.style.display !== 'none') {
    logsDiv.style.display = 'none';
    return;
  }
  logsDiv.style.display = 'block';
  const pre = logsDiv.querySelector('pre');
  pre.textContent = 'Loading...';
  try {
    const r = await api(`/custom-containers/${id}/logs`);
    pre.textContent = r.logs || 'No logs available.';
  } catch {
    pre.textContent = 'Failed to fetch logs.';
  }
};

window.editContainer = async (id) => {
  // For now, open a simple prompt-based edit flow
  try {
    const c = await api(`/custom-containers/${id}`);
    const name = prompt('Name:', c.name);
    if (name === null) return;
    const description = prompt('Description:', c.description);
    if (description === null) return;
    const image = prompt('Image:', c.image);
    if (image === null) return;
    const r = await api(`/custom-containers/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, description, image }),
    });
    if (r.ok) {
      toast('Updated', 'success');
      navigate('containers');
    } else toast(r.error || 'Update failed', 'error');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
};

window.deleteContainer = async (id, btnEl) => {
  inlineConfirm(btnEl, 'Delete this container?', async () => {
    try {
      const r = await api(`/custom-containers/${id}`, { method: 'DELETE' });
      if (r.ok) {
        toast('Container deleted', 'success');
        navigate('containers');
      } else toast(r.error || 'Delete failed', 'error');
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  });
};

window.navigate = (page) => {
  page = canonicalPage(page);
  // Close mobile menu when navigating
  const menu = document.getElementById('mobile-menu');
  const overlay = document.querySelector('.sidebar-overlay');
  if (menu) menu.classList.remove('open');
  if (overlay) overlay.classList.remove('visible');
  const newHash = '#/' + page;
  if (window.location.hash === newHash) {
    showShell(page);
  } else {
    window.location.hash = newHash;
  }
};
window.addEventListener('hashchange', () => {
  const p = canonicalPage(window.location.hash.replace('#/', ''));
  if (pages[p]) showShell(p);
});

// --- Init ---
(async () => {
  if (await checkAuth()) {
    await loadBotName();
    window._pluginsList = await api('/plugins').catch(() => []);
    connectWs();
    const p = canonicalPage(window.location.hash.replace('#/', ''));
    showShell(pages[p] ? p : 'dashboard');
  } else showLogin();
})();
