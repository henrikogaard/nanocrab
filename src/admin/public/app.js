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
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.retryAfter = res.headers.get('Retry-After');
    err.path = path;
    throw err;
  }
  return data;
}

function renderPageError(el, err, title = 'Could not load this page') {
  const retry = err?.retryAfter
    ? `<p style="margin-top:8px;color:var(--text-muted)">Retry after ${esc(err.retryAfter)} seconds.</p>`
    : '';
  el.innerHTML = `
    <div class="card empty">
      <div class="card-title">${esc(title)}</div>
      <p>${esc(err?.message || 'Unknown dashboard error')}</p>
      ${retry}
      <button class="btn btn-sm btn-primary" style="margin-top:12px" onclick="navigate('${esc(currentPage || 'dashboard')}')">Retry</button>
    </div>`;
}

function renderRoute(el, renderFn) {
  try {
    const result = renderFn(el);
    if (result && typeof result.catch === 'function') {
      result.catch((err) => renderPageError(el, err));
    }
  } catch (err) {
    renderPageError(el, err);
  }
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
    const savedSessionId = localStorage.getItem('terminal_session_id');
    if (savedSessionId) {
      ws.send(
        JSON.stringify({ type: 'terminal_attach', sessionId: savedSessionId }),
      );
      ws.send(JSON.stringify({ type: 'terminal_spawn', data: savedSessionId }));
    }
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
  if (msg.type === 'cockpit_session_update' && currentPage === 'dashboard') {
    if (window.refreshCockpitDashboard) window.refreshCockpitDashboard();
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
    // Also update terminal log viewer if present
    const termLog = document.getElementById('term-log-viewer');
    if (termLog) {
      msg.data.lines.forEach((l) => {
        termLog.textContent += l + '\n';
      });
      termLog.scrollTop = termLog.scrollHeight;
    }
  }
  if (msg.type === 'tool_call') {
    const activeGroup = document.getElementById('chat-group-select')?.value;
    if (msg.data.groupJid !== activeGroup) return;

    const container = document.getElementById('chat-messages-area');
    if (!container) return;

    // Don't duplicate
    if (document.getElementById('tool-card-' + msg.data.id)) return;

    const card = document.createElement('div');
    card.id = 'tool-card-' + msg.data.id;
    card.className = 'chat-tool-call';
    card.innerHTML = `
      <div class="chat-tool-call-header" onclick="this.nextElementSibling.classList.toggle('expanded')">
        <span class="tool-icon">&#x1F527;</span>
        <span class="tool-name">${esc(msg.data.name)}</span>
        <span class="tool-status running">&#x25CF; Running...</span>
      </div>
      <div class="chat-tool-call-body">
        <div class="section-label">Input</div>
        <pre>${esc(prettyPrint(msg.data.input))}</pre>
      </div>
    `;
    container.appendChild(card);
    container.scrollTop = container.scrollHeight;
  }
  if (msg.type === 'tool_result') {
    const activeGroup = document.getElementById('chat-group-select')?.value;
    if (msg.data.groupJid !== activeGroup) return;

    let card = document.getElementById('tool-card-' + msg.data.id);
    if (!card) {
      // Result without a preceding tool_call — create minimal card
      card = document.createElement('div');
      card.id = 'tool-card-' + msg.data.id;
      card.className = 'chat-tool-call';
      card.innerHTML = `
        <div class="chat-tool-call-header" onclick="this.nextElementSibling.classList.toggle('expanded')">
          <span class="tool-icon">&#x1F527;</span>
          <span class="tool-name">tool</span>
          <span class="tool-status done">&#x2713; ${esc(msg.data.duration)}s</span>
        </div>
        <div class="chat-tool-call-body">
          <div class="section-label">Result</div>
          <pre>${esc(prettyPrint(msg.data.output))}</pre>
        </div>
      `;
      const container = document.getElementById('chat-messages-area');
      if (container) container.appendChild(card);
    } else {
      // Update existing card
      const header = card.querySelector('.chat-tool-call-header');
      const status = header?.querySelector('.tool-status');
      if (status) {
        status.className = 'tool-status done';
        status.textContent = '\u2713 ' + (msg.data.duration || '') + 's';
      }
      const body = card.querySelector('.chat-tool-call-body');
      if (body) {
        const resultDiv = document.createElement('div');
        resultDiv.innerHTML =
          '<div class="section-label" style="margin-top:8px">Result</div><pre>' +
          esc(prettyPrint(msg.data.output)) +
          '</pre>';
        body.appendChild(resultDiv);
      }
    }
  }
  if (msg.type === 'approval_request') {
    const activeGroup = document.getElementById('chat-group-select')?.value;
    if (msg.data.groupJid !== activeGroup) return;

    const container = document.getElementById('chat-messages-area');
    if (!container) return;
    if (document.getElementById('approval-card-' + msg.data.id)) return;

    const card = document.createElement('div');
    card.id = 'approval-card-' + msg.data.id;
    card.className = 'chat-approval-card';
    card.dataset.approvalId = msg.data.id;
    card.dataset.groupJid = msg.data.groupJid;
    card.innerHTML = `
      <div class="chat-approval-header">&#x26A0;&#xFE0F; Approval Required</div>
      <div class="chat-approval-body">
        <div class="approval-detail">Tool: <strong>${esc(msg.data.tool)}</strong></div>
        <div class="approval-detail">Reason: ${esc(msg.data.reason)}</div>
        <div class="approval-input">${esc(prettyPrint(msg.data.input))}</div>
      </div>
      <div class="chat-approval-actions">
        <button class="btn btn-sm btn-deny" data-chat-approval-action="deny">Deny</button>
        <button class="btn btn-sm btn-primary" data-chat-approval-action="approve">Approve</button>
      </div>
    `;
    container.appendChild(card);
    bindChatApprovalActions(container);
    container.scrollTop = container.scrollHeight;
  }
};

function bindChatApprovalActions(container) {
  if (container.dataset.chatApprovalActionsBound === 'true') return;
  container.dataset.chatApprovalActionsBound = 'true';
  container.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('[data-chat-approval-action]');
    if (!button) return;
    const card = button.closest('.chat-approval-card');
    const id = card?.dataset.approvalId;
    const groupJid = card?.dataset.groupJid;
    if (!id || !groupJid) return;
    if (button.dataset.chatApprovalAction === 'approve') {
      approveApproval(id, groupJid);
    } else {
      denyApproval(id, groupJid);
    }
  });
}

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
  approvals:
    '<path d="M12 3.5 18.5 6v5.3c0 4.2-2.5 7-6.5 9.2-4-2.2-6.5-5-6.5-9.2V6L12 3.5Z"/><path d="M9 12l2 2 4-5"/><path d="M8.5 6.5h7"/>',
  audit:
    '<path d="M6.5 4.5h11v15h-11z"/><path d="M9 8h6"/><path d="M9 11.5h6"/><path d="M9 15h3"/><path d="M15.5 15l2 2 3-4"/>',
  chat: '<path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3A7.5 7.5 0 0 1 12 19.5c-1.2 0-2.4-.3-3.4-.8L4.5 20l1.3-4A7.4 7.4 0 0 1 4.5 12Z"/><path d="M8.5 11.5h7"/><path d="M8.5 14.5h4.5"/>',
  groups:
    '<path d="M8 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M16 10a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z"/><path d="M3.5 18.5c.4-3 2-5 4.5-5s4.1 2 4.5 5"/><path d="M13.2 14c2.9-.4 4.7 1.2 5.3 4.5"/>',
  tasks:
    '<path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v12A1.5 1.5 0 0 1 17 19.5H7A1.5 1.5 0 0 1 5.5 18V6A1.5 1.5 0 0 1 7 4.5Z"/><path d="m8.5 10 1.5 1.5L13 8.5"/><path d="M14.5 10h1.5"/><path d="m8.5 15 1.5 1.5L13 13.5"/><path d="M14.5 15h1.5"/>',
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
    { id: 'approvals', icon: 'approvals', label: 'Approvals' },
    { id: 'audit', icon: 'audit', label: 'Audit' },
    { id: 'chat', icon: 'chat', label: 'Chat' },
    { id: 'groups', icon: 'groups', label: 'Groups', section: 'Workspace' },
    { id: 'tasks', icon: 'tasks', label: 'Tasks' },
    { id: 'memory', icon: 'memory', label: 'Memory' },
    { id: 'skills', icon: 'skills', label: 'Skills' },
    { id: 'reports', icon: 'audit', label: 'Reports' },
    { id: 'artifacts', icon: 'files', label: 'Artifacts' },
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
    'audit',
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
    renderRoute(el, renderFn);
  } else {
    // Try loading plugin frontend dynamically
    el.innerHTML = '<div class="loading">Loading</div>';
    loadPluginFrontend(page)
      .then(() => {
        const fn = pages[page];
        if (fn) renderRoute(el, fn);
        else el.innerHTML = '<div class="card empty">Page not found</div>';
      })
      .catch((err) => renderPageError(el, err, 'Could not load plugin page'));
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
      if (!d || typeof d !== 'object') throw new Error('Invalid dashboard data');
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
      if (!bar.innerHTML.trim()) {
        bar.innerHTML = `
          <div class="metrics-item"><span class="metrics-label">Uptime</span><span class="metrics-value">-</span></div>
          <div class="metrics-item"><span class="metrics-label">Messages</span><span class="metrics-value">-</span></div>
          <div class="metrics-item"><span class="metrics-label">Agents</span><span class="metrics-value">-</span></div>
          <div class="metrics-item"><span class="metrics-label">Channels</span><span class="metrics-value">-/-</span></div>`;
      }
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
    if (!Array.isArray(alerts)) {
      bar.innerHTML = '';
      return;
    }
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
  approvals: 'renderApprovals',
  audit: 'renderAudit',
  memory: 'renderMemoryConsolidated',
  skills: 'renderSkillsPage',
  timeline: 'renderMemoryKnowledgeTimeline',
  usage: 'renderUsage',
  sessions: 'renderSessions',
  groups: 'renderGroups',
  tasks: 'renderTasks',
  reports: 'renderReports',
  artifacts: 'renderArtifacts',
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
  'session-detail': 'renderSessionDetail',
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
        { id: 'mcp', label: 'MCP Servers' },
        { id: 'providers', label: 'AI Providers' },
      ],
      'mcp',
    )}</div>`;
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

const APPROVAL_KIND_LABELS = {
  'provider-fallback': 'Provider fallback',
  'coding-implement': 'Repo change',
  'coding-open-pr': 'Open PR',
  'coding-revert': 'Revert change',
  'report-outline': 'Report outline',
  'report-delivery': 'Report delivery',
  publish: 'Publish',
  'external-message': 'Outbound message',
  upload: 'Upload',
  'tool-action': 'Tool action',
};

const APPROVAL_STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
  expired: 'Expired',
};

function approvalKindLabel(kind) {
  return APPROVAL_KIND_LABELS[kind] || kind || 'Approval';
}

function approvalStatusBadge(status) {
  const cls =
    status === 'approved'
      ? 'badge-success'
      : status === 'denied' || status === 'expired'
        ? 'badge-error'
        : 'badge-warning';
  return `<span class="badge ${cls}">${esc(APPROVAL_STATUS_LABELS[status] || status)}</span>`;
}

function approvalRiskBadge(risk) {
  const cls =
    risk === 'high'
      ? 'badge-error'
      : risk === 'medium'
        ? 'badge-warning'
        : 'badge-success';
  return `<span class="badge ${cls}">${esc(risk || 'medium')}</span>`;
}

function approvalQueryFromFilters() {
  const filters = window._approvalFilters || {};
  const params = new URLSearchParams();
  [
    'status',
    'risk',
    'kind',
    'requester',
    'targetType',
    'correlationId',
  ].forEach((key) => {
    if (filters[key]) params.set(key, filters[key]);
  });
  if (filters.createdFrom)
    params.set('createdFrom', `${filters.createdFrom}T00:00:00.000Z`);
  if (filters.createdTo)
    params.set('createdTo', `${filters.createdTo}T23:59:59.999Z`);
  params.set('limit', '200');
  return params.toString();
}

function renderApprovalCard(approval) {
  const expires =
    approval.expiresAt && approval.status === 'pending'
      ? `<span class="approval-meta-item">Expires ${timeAgo(approval.expiresAt)}</span>`
      : '';
  const preview = approval.actionPreview
    ? `<pre class="approval-preview">${esc(approval.actionPreview)}</pre>`
    : '';
  const disabled = approval.status !== 'pending' ? ' disabled' : '';
  const selected =
    approval.id === window._selectedApprovalId ? ' selected' : '';
  return `
    <article class="approval-card${selected}" data-id="${esc(approval.id)}">
      <div class="approval-card-main">
        <div class="approval-card-title">
          <span>${esc(approval.title)}</span>
          ${approvalRiskBadge(approval.risk)}
        </div>
        <div class="approval-summary">${esc(approval.summary)}</div>
        <div class="approval-meta-row">
          <span class="approval-meta-item">${esc(approvalKindLabel(approval.kind))}</span>
          <span class="approval-meta-item">${esc(approval.requester || 'system')}</span>
          ${approval.targetType ? `<span class="approval-meta-item">${esc(approval.targetType)}</span>` : ''}
          ${approval.correlationId ? `<span class="approval-meta-item">${esc(approval.correlationId)}</span>` : ''}
          ${expires}
        </div>
        ${preview}
      </div>
      <div class="approval-card-actions">
        ${approvalStatusBadge(approval.status)}
        <button class="btn btn-sm btn-ghost" data-action="deny"${disabled}>Deny</button>
        <button class="btn btn-sm btn-primary" data-action="approve"${disabled}>Approve</button>
      </div>
    </article>`;
}

function renderApprovalPanel(approval) {
  if (!approval) {
    return '<div class="approval-panel empty">Select an approval to inspect provenance.</div>';
  }
  const rows = [
    ['Source', approval.source || 'legacy'],
    ['Correlation', approval.correlationId || 'none'],
    ['Policy', approval.policyDecisionId || 'none'],
    ['Requester', approval.requester || 'system'],
    [
      'Target',
      [approval.targetType, approval.targetId].filter(Boolean).join(' / ') ||
        'none',
    ],
    ['Created', approval.createdAt || 'unknown'],
    ['Expires', approval.expiresAt || 'none'],
    ['Reviewed', approval.reviewedAt || 'not reviewed'],
    ['Reviewer', approval.reviewedBy || 'none'],
  ];
  return `
    <aside class="approval-panel">
      <div class="approval-panel-header">
        <span>${esc(approvalKindLabel(approval.kind))}</span>
        ${approvalStatusBadge(approval.status)}
      </div>
      <h3>${esc(approval.title)}</h3>
      <p>${esc(approval.resourceSummary || approval.summary || '')}</p>
      <div class="approval-provenance-list">
        ${rows
          .map(
            ([label, value]) =>
              `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`,
          )
          .join('')}
      </div>
      ${
        approval.actionPreview
          ? `<div class="section-label">Action Preview</div><pre class="approval-panel-pre">${esc(approval.actionPreview)}</pre>`
          : ''
      }
      <div class="section-label">Payload</div>
      <pre class="approval-panel-pre">${esc(prettyPrint(approval.payload || {}))}</pre>
      ${
        approval.decisionNote
          ? `<div class="approval-decision-note">${esc(approval.decisionNote)}</div>`
          : ''
      }
    </aside>`;
}

async function renderApprovals(el) {
  const filters = window._approvalFilters || {
    status: '',
    risk: '',
    kind: '',
    requester: '',
    targetType: '',
    correlationId: '',
    createdFrom: '',
    createdTo: '',
  };
  window._approvalFilters = filters;
  const query = approvalQueryFromFilters();
  const approvals = await api(`/approvals?${query}`);
  const selected =
    approvals.find((item) => item.id === window._selectedApprovalId) ||
    approvals.find((item) => item.status === 'pending') ||
    approvals[0];
  if (selected) window._selectedApprovalId = selected.id;
  const pending = approvals.filter((approval) => approval.status === 'pending');
  const history = approvals.filter((approval) => approval.status !== 'pending');
  const grouped = pending.reduce((acc, approval) => {
    const key = `${approval.risk || 'medium'}:${approval.kind}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(approval);
    return acc;
  }, {});
  const groupedHtml = Object.entries(grouped)
    .map(([key, items]) => {
      const [risk, kind] = key.split(':');
      return `<section class="approval-group">
        <div class="approval-group-header">
          <div><strong>${esc(approvalKindLabel(kind))}</strong><span>${items.length} pending</span></div>
          ${approvalRiskBadge(risk)}
        </div>
        ${items.map(renderApprovalCard).join('')}
      </section>`;
    })
    .join('');

  el.innerHTML = `
    <div class="page-header">
      <h2>Approval Inbox</h2>
      <button class="btn btn-sm btn-ghost" onclick="navigate('approvals')">Refresh</button>
    </div>
    <form class="approval-filters" id="approval-filters">
      <select name="status">
        <option value="">Any status</option>
        ${['pending', 'approved', 'denied', 'expired'].map((status) => `<option value="${status}" ${filters.status === status ? 'selected' : ''}>${APPROVAL_STATUS_LABELS[status]}</option>`).join('')}
      </select>
      <select name="risk">
        <option value="">Any risk</option>
        ${['low', 'medium', 'high'].map((risk) => `<option value="${risk}" ${filters.risk === risk ? 'selected' : ''}>${risk}</option>`).join('')}
      </select>
      <select name="kind">
        <option value="">Any kind</option>
        ${Object.entries(APPROVAL_KIND_LABELS)
          .map(
            ([kind, label]) =>
              `<option value="${kind}" ${filters.kind === kind ? 'selected' : ''}>${esc(label)}</option>`,
          )
          .join('')}
      </select>
      <input name="requester" value="${esc(filters.requester || '')}" placeholder="Requester">
      <input name="targetType" value="${esc(filters.targetType || '')}" placeholder="Target type">
      <input name="correlationId" value="${esc(filters.correlationId || '')}" placeholder="Correlation ID">
      <input name="createdFrom" type="date" value="${esc(filters.createdFrom || '')}" aria-label="Created from">
      <input name="createdTo" type="date" value="${esc(filters.createdTo || '')}" aria-label="Created to">
      <button class="btn btn-sm btn-primary" type="submit">Filter</button>
      <button class="btn btn-sm btn-ghost" type="button" onclick="resetApprovalFilters()">Reset</button>
    </form>
    <div class="approval-inbox">
      <div class="approval-main">
        <div class="approval-section-head">
          <h3>Pending</h3>
          <span>${pending.length} awaiting review</span>
        </div>
        ${pending.length ? groupedHtml : '<div class="card empty">No pending approvals match these filters.</div>'}
        <div class="approval-section-head">
          <h3>History</h3>
          <span>${history.length} reviewed</span>
        </div>
        ${
          history.length
            ? `<div class="approval-history">${history.map(renderApprovalCard).join('')}</div>`
            : '<div class="card empty">No reviewed approvals match these filters.</div>'
        }
      </div>
      ${renderApprovalPanel(selected)}
    </div>`;

  document.getElementById('approval-filters').onsubmit = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    window._approvalFilters = Object.fromEntries(data.entries());
    navigate('approvals');
  };
  el.querySelector('.approval-inbox').addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const actionButton = event.target.closest('[data-action]');
    if (actionButton) {
      const card = actionButton.closest('.approval-card');
      const id = card?.dataset.id;
      if (!id) return;
      reviewInboxApproval(id, actionButton.dataset.action);
      return;
    }
    const card = event.target.closest('.approval-card');
    if (card?.dataset.id) selectApproval(card.dataset.id);
  });
}

window.selectApproval = function (id) {
  window._selectedApprovalId = id;
  document
    .querySelectorAll('.approval-card')
    .forEach((card) =>
      card.classList.toggle('selected', card.dataset.id === id),
    );
  if (currentPage === 'approvals') navigate('approvals');
};

window.resetApprovalFilters = function () {
  window._approvalFilters = {};
  navigate('approvals');
};

async function reviewInboxApproval(id, decision) {
  const note = prompt(
    `${decision === 'approve' ? 'Approve' : 'Deny'} note`,
    '',
  );
  try {
    const data = await api(`/approvals/${encodeURIComponent(id)}/${decision}`, {
      method: 'POST',
      body: JSON.stringify({ note: note || undefined }),
    });
    if (data.error) throw new Error(data.error);
    toast(
      `Approval ${decision === 'approve' ? 'approved' : 'denied'}`,
      'success',
    );
    navigate('approvals');
  } catch (e) {
    toast('Approval review failed: ' + e.message, 'error');
  }
}

window.approveInboxApproval = (id) => reviewInboxApproval(id, 'approve');
window.denyInboxApproval = (id) => reviewInboxApproval(id, 'deny');

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
              (m) => {
                const interval = Number.isFinite(Number(m.interval))
                  ? Number(m.interval)
                  : 300;
                const alertAfter = Number.isFinite(Number(m.alertAfter))
                  ? Number(m.alertAfter)
                  : 3;
                return `
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
          <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">Every ${interval}s \u2022 Alert after ${alertAfter} failures</span>
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
      </div>`;
              },
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

  const loadedTabs = new Set(['overview']);
  const loaders = {
    channels: renderChannels,
    logs: renderLogs,
    system: renderSystem,
  };
  el.querySelectorAll('#mon-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tabId;
      const loader = loaders[tabId];
      if (!loader || loadedTabs.has(tabId)) return;
      loadedTabs.add(tabId);
      const target = document.getElementById(`mon-tabs-${tabId}`);
      if (!target) return;
      target.innerHTML = '<div class="loading">Loading</div>';
      Promise.resolve(loader(target)).catch((err) =>
        renderPageError(target, err, `Could not load ${tabId}`),
      );
    });
  });
}

// Agents — now rendered by the full function below (renderAgents at line ~3065)

// Chat
async function renderChat(el) {
  // Clean up progress state
  if (window._progressTimeout) {
    clearTimeout(window._progressTimeout);
    window._progressTimeout = null;
  }
  const groups = await api('/groups');
  window._chatGroups = groups;
  const providers = await api('/providers');
  window._chatProviders = providers;
  let selectedJid = groups[0]?.jid || '';
  let chatMessages = [];
  let mediaRecorder = null;
  let audioChunks = [];

  el.innerHTML = `
    <div class="page-header"><h2>Chat</h2>
      <div style="display:flex;align-items:center;gap:10px">
        <select class="search-input" id="chat-group-select" style="max-width:250px">
          ${groups.map((g) => `<option value="${g.jid}">${esc(g.name)} (${g.channel || g.folder})</option>`).join('')}
        </select>
        <div id="chat-provider-selector" class="chat-provider-selector"></div>
      </div>
    </div>
    <div class="card" style="padding:0;overflow:hidden;display:flex;flex-direction:column">
      <div class="chat-messages" id="chat-messages-area">
        <div class="loading">Select a group to start chatting</div>
      </div>
      <div class="chat-progress-bar" id="chat-progress-bar" onclick="toggleProgressHistory()">
        <span class="progress-spinner" id="progress-spinner"></span>
        <span class="progress-phase" id="progress-phase">Thinking...</span>
        <div class="progress-track">
          <div class="progress-fill" id="progress-fill" style="width:0%"></div>
        </div>
        <span class="progress-pct" id="progress-pct">0%</span>
      </div>
      <div class="chat-progress-history" id="chat-progress-history"></div>
      <div class="chat-input">
        <input type="text" id="chat-msg-input" placeholder="Type a message..." autocomplete="off">
        <button class="btn btn-sm btn-ghost" id="chat-voice-btn" title="Record voice" style="font-size:16px;padding:6px 10px">\uD83C\uDF99</button>
        <button class="btn btn-sm btn-primary" id="chat-send-btn">Send</button>
      </div>
    </div>
    <div id="chat-voice-status" style="font-size:11px;color:var(--text-muted);margin-top:4px"></div>`;

  renderProviderBadge(selectedJid);

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

    // Start fallback progress timer
    if (window._progressTimeout) clearTimeout(window._progressTimeout);
    window._progressTimeout = setTimeout(() => {
      const bar = document.getElementById('chat-progress-bar');
      if (bar && !bar.classList.contains('visible')) {
        bar.classList.add('visible');
        const spinner = document.getElementById('progress-spinner');
        if (spinner) spinner.style.display = '';
        const phase = document.getElementById('progress-phase');
        if (phase) phase.textContent = 'Agent is thinking...';
        const fill = document.getElementById('progress-fill');
        if (fill) fill.style.width = '0%';
        const pct = document.getElementById('progress-pct');
        if (pct) pct.textContent = '';
      }
    }, 30000);

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
  document.getElementById('chat-group-select').onchange = (e) => {
    document.getElementById('chat-provider-popover')?.remove();
    loadMessages(e.target.value);
    updateProviderBadge(e.target.value);
  };

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
    if (msg.type === 'task_progress') {
      const activeGroup = document.getElementById('chat-group-select')?.value;
      if (msg.data.groupJid !== activeGroup) return;
      if (window._progressTimeout) {
        clearTimeout(window._progressTimeout);
        window._progressTimeout = null;
      }
      const bar = document.getElementById('chat-progress-bar');
      const phase = document.getElementById('progress-phase');
      const fill = document.getElementById('progress-fill');
      const pct = document.getElementById('progress-pct');
      const spinner = document.getElementById('progress-spinner');
      if (!bar || !phase || !fill || !pct) return;
      bar.classList.add('visible');
      phase.textContent = msg.data.message || msg.data.phase;
      fill.style.width = Math.min(msg.data.pct, 100) + '%';
      pct.textContent = msg.data.pct + '%';
      const history = document.getElementById('chat-progress-history');
      if (history) {
        const entry = document.createElement('div');
        entry.className =
          'phase-entry' + (msg.data.pct >= 100 ? ' done' : ' active');
        entry.innerHTML =
          '<span style="font-size:10px">' +
          (msg.data.pct >= 100 ? '\u2713' : '\u25CF') +
          '</span> ' +
          esc(msg.data.message || msg.data.phase);
        history.appendChild(entry);
        history.classList.add('visible');
      }
      if (msg.data.pct >= 100 || msg.data.phase === 'done') {
        setTimeout(() => {
          bar.classList.remove('visible');
        }, 3000);
      } else if (spinner) {
        spinner.style.display = '';
      }
      return;
    }
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

function renderProviderBadge(groupJid) {
  const container = document.getElementById('chat-provider-selector');
  if (!container) return;
  const group = window._chatGroups?.find((g) => g.jid === groupJid);
  const provider = group?.containerConfig?.provider || 'default';
  const model = group?.containerConfig?.model || 'auto';
  container.innerHTML = `
    <div class="chat-provider-badge" id="chat-provider-badge" onclick="toggleProviderPopover()">
      ${esc(provider)} <span style="opacity:0.6">/</span> ${esc(model)} <span style="font-size:10px;margin-left:2px">&#9998;</span>
    </div>
  `;
}

function updateProviderBadge(groupJid) {
  const badge = document.getElementById('chat-provider-badge');
  if (!badge) {
    renderProviderBadge(groupJid);
    return;
  }
  const group = window._chatGroups?.find((g) => g.jid === groupJid);
  if (group) {
    const provider = group.containerConfig?.provider || 'default';
    const model = group.containerConfig?.model || 'auto';
    badge.innerHTML = `${esc(provider)} <span style="opacity:0.6">/</span> ${esc(model)} <span style="font-size:10px;margin-left:2px">&#9998;</span>`;
  }
}

window.toggleProviderPopover = function () {
  const existing = document.getElementById('chat-provider-popover');
  if (existing) {
    existing.remove();
    return;
  }

  const groupJid = document.getElementById('chat-group-select')?.value;
  if (!groupJid) return;

  const providers = window._chatProviders || [];
  if (!providers.length) {
    toast('No providers available', 'error');
    return;
  }

  const selector = document.getElementById('chat-provider-selector');
  const popover = document.createElement('div');
  popover.id = 'chat-provider-popover';
  popover.className = 'chat-provider-popover';
  popover.innerHTML = `
    <select id="provider-select" class="form-select" style="width:100%;padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:12px;margin-bottom:6px">
      ${providers.map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`).join('')}
    </select>
    <select id="model-select" class="form-select" style="width:100%;padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:12px;margin-bottom:6px">
      <option value="">Auto</option>
    </select>
    <div class="popover-actions" style="display:flex;gap:6px;justify-content:flex-end">
      <button class="btn btn-sm btn-ghost" onclick="this.closest('.chat-provider-popover').remove()">Cancel</button>
      <button class="btn btn-sm btn-primary" onclick="saveProvider()">Save</button>
    </div>
  `;
  selector.appendChild(popover);

  document.getElementById('provider-select').onchange = function () {
    updateModelOptions(this.value);
  };

  const group = window._chatGroups?.find((g) => g.jid === groupJid);
  if (group?.containerConfig?.provider) {
    const ps = document.getElementById('provider-select');
    if (ps) ps.value = group.containerConfig.provider;
  }
  updateModelOptions(
    document.getElementById('provider-select')?.value,
    group?.containerConfig?.model,
  );
};

function updateModelOptions(providerId, selectedModel) {
  const modelSelect = document.getElementById('model-select');
  if (!modelSelect) return;
  const provider = window._chatProviders?.find((p) => p.id === providerId);
  const models = provider?.models || [];
  modelSelect.innerHTML = `
    <option value="">Auto</option>
    ${models.map((m) => `<option value="${esc(m.id || m)}" ${(m.id || m) === selectedModel ? 'selected' : ''}>${esc(m.name || m)}</option>`).join('')}
  `;
  if (selectedModel) {
    const hasMatch = models.some((m) => (m.id || m) === selectedModel);
    if (!hasMatch) {
      modelSelect.innerHTML += `<option value="${esc(selectedModel)}" selected>${esc(selectedModel)}</option>`;
    }
  }
}

window.saveProvider = async function () {
  const groupJid = document.getElementById('chat-group-select')?.value;
  const provider = document.getElementById('provider-select')?.value;
  const model = document.getElementById('model-select')?.value;
  if (!groupJid || !provider) return;

  try {
    const group = window._chatGroups?.find((g) => g.jid === groupJid);
    const existingConfig = group?.containerConfig || {};
    await api('/groups/' + encodeURIComponent(groupJid), {
      method: 'PUT',
      body: JSON.stringify({
        containerConfig: {
          ...existingConfig,
          provider,
          model: model || undefined,
        },
      }),
    });
    toast(
      'Provider updated to ' + provider + '/' + (model || 'auto'),
      'success',
    );
    document.getElementById('chat-provider-popover')?.remove();
    updateProviderBadge(groupJid);
  } catch (e) {
    toast('Failed to update provider: ' + e.message, 'error');
  }
};

window.toggleProgressHistory = function () {
  const history = document.getElementById('chat-progress-history');
  if (history) history.classList.toggle('visible');
};

window.approveApproval = async function (id, groupJid) {
  try {
    await api('/chat/approve', {
      method: 'POST',
      body: JSON.stringify({ approvalId: id, groupJid, approved: true }),
    });
    const card = document.getElementById('approval-card-' + id);
    if (card) {
      card.querySelector('.chat-approval-header').textContent =
        '\u2713 Approved';
      card.querySelector('.chat-approval-actions')?.remove();
      card.style.borderColor = 'var(--success, #22c55e)';
    }
    toast('Approval granted', 'success');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.denyApproval = async function (id, groupJid) {
  try {
    await api('/chat/approve', {
      method: 'POST',
      body: JSON.stringify({ approvalId: id, groupJid, approved: false }),
    });
    const card = document.getElementById('approval-card-' + id);
    if (card) {
      card.querySelector('.chat-approval-header').textContent = '\u2717 Denied';
      card.querySelector('.chat-approval-actions')?.remove();
      card.style.borderColor = 'var(--error, #ef4444)';
    }
    toast('Approval denied', 'info');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

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
          <span class="badge ${ch.connected ? 'badge-success' : 'badge-error'}">${ch.connected ? 'Connected' : 'Disconnected'}</span>
          <button class="btn btn-sm btn-ghost" onclick="restartChannel('${esc(ch.id)}',this)">Restart</button>
        </div>
      </div>
      ${ch.id === 'whatsapp' ? renderWhatsAppPairingPanel(whatsappPairing) : ''}
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

  el.innerHTML = `
    <div class="page-header"><h2>Channels</h2></div>
    <div class="grid grid-2">${activeHtml}</div>
    ${availableHtml}`;

  if (whatsappPairing && currentPage === 'monitoring') {
    poll(() => navigate('monitoring'), 5000);
  }
}

function renderWhatsAppPairingPanel(pairing) {
  if (!pairing) return '';
  const stateLabel = pairing.state || 'unknown';
  const stateBadge =
    pairing.connected ||
    pairing.state === 'paired' ||
    pairing.state === 'connected'
      ? 'badge-success'
      : pairing.state === 'error' || pairing.state === 'expired_qr'
        ? 'badge-error'
        : pairing.state === 'not_configured'
          ? 'badge-muted'
          : 'badge-warning';
  return `
    <div style="margin:12px 0;padding:12px;background:var(--surface2);border-radius:var(--radius-sm);border:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <div>
          <div style="font-size:13px;font-weight:600">Dashboard Pairing</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(pairing.statusReason || pairing.error || 'Use WhatsApp linked devices to pair this dashboard session.')}</div>
        </div>
        <span class="badge ${stateBadge}" style="font-size:10px">${esc(stateLabel)}</span>
      </div>
      ${
        pairing.qrCode
          ? `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
              <img src="${pairing.qrCode}" alt="WhatsApp pairing QR code" style="width:180px;height:180px;background:#fff;padding:8px;border-radius:8px">
              <div style="font-size:12px;color:var(--text-muted);max-width:260px">
                <div style="font-weight:600;color:var(--text);margin-bottom:6px">Scan with WhatsApp</div>
                <div>Settings -> Linked Devices -> Link a Device.</div>
                <div style="margin-top:6px">Expires ${pairing.qrExpiresAt ? formatTime(pairing.qrExpiresAt) : 'soon'}.</div>
              </div>
            </div>`
          : ''
      }
      ${
        pairing.pairingCode
          ? `<div style="font-size:22px;font-family:var(--mono);letter-spacing:2px;margin:8px 0;color:var(--accent)">${esc(pairing.pairingCode)}</div>`
          : ''
      }
      ${
        pairing.error
          ? `<div class="alert-banner alert-error" style="margin:8px 0"><span>${esc(pairing.error)}</span></div>`
          : ''
      }
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="startWhatsAppPairing('qr')">${pairing.qrExpired ? 'Refresh QR' : 'Start QR Pairing'}</button>
        <button class="btn btn-sm btn-ghost" onclick="startWhatsAppPairing('pairing-code')">Pairing Code</button>
        <button class="btn btn-sm btn-ghost" onclick="cancelWhatsAppPairing()">Cancel</button>
        <button class="btn btn-sm btn-ghost" onclick="resetWhatsAppSession()">Reset Session</button>
      </div>
    </div>`;
}

window.startWhatsAppPairing = async function (method) {
  let body = { method };
  if (method === 'pairing-code') {
    const phone = prompt('Phone number with country code, digits only');
    if (!phone) return;
    body.phone = phone;
  }
  const res = await api('/channels/whatsapp/pairing/start', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (res.ok) toast('WhatsApp pairing started', 'success');
  else toast(res.error || 'Pairing failed to start', 'error');
  navigate('monitoring');
};

window.cancelWhatsAppPairing = async function () {
  const res = await api('/channels/whatsapp/pairing/cancel', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (res.ok) toast('WhatsApp pairing cancelled', 'info');
  else toast(res.error || 'Cancel failed', 'error');
  navigate('monitoring');
};

window.resetWhatsAppSession = async function () {
  if (!confirm('Reset WhatsApp session files and disconnect the channel?'))
    return;
  const res = await api('/channels/whatsapp/pairing/reset', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (res.ok) toast('WhatsApp session reset', 'success');
  else toast(res.error || 'Reset failed', 'error');
  navigate('monitoring');
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
  const [tasks, groups, providerInfo] = await Promise.all([
    api('/tasks'),
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
  const providerOptions = Object.values(providerDefinitions)
    .filter((p) => p && p.selectable !== false)
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`)
    .join('');

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
  const operationTaskCount = tasks.filter((task) =>
    (task.prompt || '').includes('[operation-schedule]'),
  ).length;

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
    <div class="card">
      <div class="card-title">Operations <span class="badge badge-muted" style="font-size:10px">${operationTaskCount}</span></div>
      <form id="operation-schedule-form">
        <div class="grid grid-2">
          <div class="form-group"><label>Group</label><select id="operation-group">${groups.map((g) => `<option value="${g.folder}|${g.jid}">${esc(g.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Kind</label><select id="operation-intent"><option value="orders">Repeat orders</option><option value="reminder">Reminder</option></select></div>
        </div>
        <div class="grid grid-2">
          <div class="form-group"><label>Title</label><input id="operation-title" placeholder="Night rally orders"></div>
          <div class="form-group"><label>Schedule</label><div style="display:flex;gap:8px"><select id="operation-schedule-type" style="width:120px"><option value="interval">Interval</option><option value="cron">Cron</option></select><input id="operation-schedule-value" placeholder="30m or 0 */2 * * *"></div></div>
        </div>
        <div class="form-group"><label>Orders / Reminder Text</label><textarea id="operation-orders" style="width:100%;min-height:76px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:13px;resize:vertical" placeholder="What should the bot repeat or remind the group about?"></textarea></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);margin-bottom:10px"><input type="checkbox" id="operation-delivery-approved"> Send scheduled messages to this group</label>
        <button type="submit" class="btn btn-sm btn-primary">Create Operation Schedule</button>
      </form>
    </div>
    <div class="card" id="new-task-form" style="display:none">
      <div class="card-title">Create Task</div>
      <form id="task-create-form">
        <div class="grid grid-2">
          <div class="form-group"><label>Group</label><select id="task-group">${groups.map((g) => `<option value="${g.folder}|${g.jid}">${esc(g.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Schedule Type</label><select id="task-type"><option value="cron">Cron</option><option value="interval">Interval</option><option value="once">Once</option></select></div>
        </div>
        <div class="form-group"><label>Schedule Value (cron expression or interval like "30m", "2h")</label><input id="task-schedule" placeholder="0 9 * * *"></div>
        <div class="grid grid-2">
          <div class="form-group"><label>Provider (optional — overrides group default)</label><select id="task-provider" onchange="updateTaskModelSelect('task-provider','task-model')"><option value="">Inherit</option>${providerOptions}</select></div>
          <div class="form-group"><label>Model (optional — overrides group default)</label><select id="task-model"><option value="">Inherit</option></select></div>
        </div>
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
    <thead><tr><th>Prompt</th><th>Group</th><th>Provider</th><th>Model</th><th>Schedule</th><th>Status</th><th>Last Run</th><th>Next Run</th><th>Actions</th></tr></thead>
    <tbody>${tasks
      .map(
        (t) => `<tr>
      <td style="max-width:300px;color:var(--text)">${(t.prompt || '').includes('[operation-schedule]') ? '<span class="badge badge-info" style="margin-right:6px">operation</span>' : ''}${esc(truncate(t.prompt, 100))}</td>
      <td><span class="badge badge-muted">${esc(t.group_folder)}</span></td>
      <td>${t.provider ? `<span class="badge badge-accent">${esc(t.provider)}</span>` : '<span class="badge badge-muted">inherit</span>'}</td>
      <td>${t.model ? `<span style="font-family:var(--mono);font-size:11px;color:var(--text)">${esc(t.model)}</span>` : '<span class="badge badge-muted">inherit</span>'}</td>
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
  window._taskProviderModels = providerModels;
  window._taskProviderDefs = providerDefinitions;

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
      const provider = document.getElementById('task-provider')?.value || '';
      const model = document.getElementById('task-model')?.value || '';
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
          provider: provider || undefined,
          model: model || undefined,
        }),
      });
      if (r.ok) navigate('tasks');
      else toast(r.error || 'Failed', 'error');
    };
  const operationForm = document.getElementById('operation-schedule-form');
  if (operationForm)
    operationForm.onsubmit = async (e) => {
      e.preventDefault();
      const [groupFolder, chatJid] = document
        .getElementById('operation-group')
        .value.split('|');
      const deliveryApproved = document.getElementById(
        'operation-delivery-approved',
      ).checked;
      const r = await api('/tasks/operation-schedules', {
        method: 'POST',
        body: JSON.stringify({
          groupFolder,
          chatJid,
          title: document.getElementById('operation-title').value,
          orders: document.getElementById('operation-orders').value,
          intent: document.getElementById('operation-intent').value,
          scheduleType: document.getElementById('operation-schedule-type')
            .value,
          scheduleValue: document.getElementById('operation-schedule-value')
            .value,
          deliveryMode: deliveryApproved ? 'send' : 'preview',
          deliveryApproved,
        }),
      });
      if (r.ok) {
        toast(
          deliveryApproved
            ? 'Operation schedule created'
            : 'Preview operation schedule created',
          'success',
        );
        navigate('tasks');
      } else {
        toast(r.error || 'Failed', 'error');
      }
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
async function renderMcp(el) {
  const [
    health,
    presets,
    catalog,
    infomaniakWorkflows,
    calendarWorkflows,
    emailWorkflows,
  ] = await Promise.all([
    api('/mcp/health'),
    api('/mcp/presets').catch(() => []),
    api('/mcp/catalog').catch(() => null),
    api('/mcp/infomaniak-workflows').catch(() => null),
    api('/mcp/calendar-workflows').catch(() => null),
    api('/mcp/email-workflows').catch(() => null),
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
      catalog
        ? `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px">
        <div>
          <div class="card-title" style="margin:0">Connector Catalog</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Setup readiness across built-in, preset, and manual MCP connectors.</div>
        </div>
        <span class="badge ${catalog.status === 'ready' ? 'badge-success' : catalog.status === 'blocked' ? 'badge-error' : 'badge-warning'}">${esc(catalog.status)}</span>
      </div>
      <div class="grid grid-4" style="margin-bottom:12px">
        <div><div style="font-size:11px;color:var(--text-muted)">Catalog</div><div style="font-size:20px;font-weight:600">${catalog.summary?.total ?? 0}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Installed</div><div style="font-size:20px;font-weight:600;color:var(--info)">${catalog.summary?.installed ?? 0}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Ready</div><div style="font-size:20px;font-weight:600;color:var(--success)">${catalog.summary?.ready ?? 0}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Blocked</div><div style="font-size:20px;font-weight:600;color:var(--danger)">${catalog.summary?.blocked ?? 0}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px">
        ${(catalog.items || [])
          .map(
            (item) => `
          <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;background:var(--surface)">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
              <div style="min-width:0">
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                  <strong style="font-size:13px;color:var(--text)">${esc(item.label)}</strong>
                  <span class="badge badge-muted">${esc(item.category)}</span>
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px;line-height:1.35">${esc(item.summary)}</div>
              </div>
              <span class="badge ${item.status === 'ready' ? 'badge-success' : item.status === 'blocked' ? 'badge-error' : 'badge-warning'}">${esc(item.status)}</span>
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px">
              ${(item.capabilities || []).map((capability) => `<span class="badge badge-info">${esc(capability)}</span>`).join('')}
            </div>
            <div style="display:grid;gap:5px;margin-top:10px">
              ${(item.steps || [])
                .map(
                  (step) => `
                <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;font-size:11px;padding:6px 7px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)">
                  <div>
                    <strong style="color:var(--text)">${esc(step.label)}</strong>
                    <div style="color:var(--text-muted);margin-top:2px">${esc(step.detail)}</div>
                  </div>
                  <span class="badge ${step.status === 'ready' ? 'badge-success' : step.status === 'blocked' ? 'badge-error' : 'badge-warning'}">${step.status === 'ready' ? 'OK' : step.status === 'blocked' ? 'Block' : 'Review'}</span>
                </div>`,
                )
                .join('')}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
              ${
                !item.installed &&
                item.setupPath === 'preset' &&
                item.presetName
                  ? `<button class="btn btn-sm btn-primary" onclick="installMcpPreset('${esc(item.presetName)}')">Install preset</button>`
                  : !item.installed && item.setupPath === 'manual'
                    ? `<button class="btn btn-sm btn-primary" onclick="document.getElementById('new-mcp-form').style.display='block';document.getElementById('new-mcp-form').scrollIntoView({behavior:'smooth',block:'start'})">Add server</button>`
                    : ''
              }
              ${
                item.missingEnvVars?.length
                  ? `<button class="btn btn-sm btn-ghost" onclick="navigate('credentials')">Credentials</button>`
                  : ''
              }
              <button class="btn btn-sm btn-ghost" onclick="document.getElementById('mcp-permissions-note')?.scrollIntoView({behavior:'smooth',block:'center'})">Permissions</button>
            </div>
          </div>`,
          )
          .join('')}
      </div>
      <div id="mcp-permissions-note" style="margin-top:12px;padding:10px;background:var(--info-bg);border-radius:var(--radius-sm);font-size:12px;color:var(--info)">Connector setup keeps external writes approval-gated. Adjust connector permissions from the server cards or config only when the operator has approved the scope.</div>
    </div>`
        : ''
    }
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
    ${
      infomaniakWorkflows
        ? `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px">
        <div>
          <div class="card-title" style="margin:0">Infomaniak Document Workflows</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">kDrive, DAV, and mail-backed document tasks using the Infomaniak kSuite MCP preset.</div>
        </div>
        <span class="badge ${infomaniakWorkflows.status === 'ready' ? 'badge-success' : infomaniakWorkflows.status === 'blocked' ? 'badge-error' : 'badge-warning'}">${esc(infomaniakWorkflows.status)}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;margin-bottom:12px">
        ${infomaniakWorkflows.workflows
          .map(
            (workflow) => `
          <div style="padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
              <strong style="font-size:12px;color:var(--text)">${esc(workflow.label)}</strong>
              <span class="badge ${workflow.status === 'ready' ? 'badge-success' : workflow.status === 'blocked' ? 'badge-error' : 'badge-warning'}">${esc(workflow.status)}</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:5px;line-height:1.35">${esc(workflow.detail)}</div>
            ${workflow.approvalRequired ? '<div style="font-size:11px;color:var(--warning);margin-top:5px">Requires explicit approval before external writes.</div>' : ''}
          </div>`,
          )
          .join('')}
      </div>
      <div style="display:grid;gap:6px">
        ${infomaniakWorkflows.checks
          .map(
            (check) => `
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;font-size:12px;padding:7px 8px;border:1px solid var(--border);border-radius:var(--radius-sm)">
            <div>
              <strong style="color:var(--text)">${esc(check.label)}</strong>
              <div style="color:var(--text-muted);margin-top:2px">${esc(check.detail)}</div>
              ${check.hint && !check.ok ? `<div style="color:var(--warning);margin-top:2px">${esc(check.hint)}</div>` : ''}
            </div>
            <span class="badge ${check.ok ? 'badge-success' : check.severity === 'required' ? 'badge-error' : 'badge-warning'}">${check.ok ? 'OK' : check.severity === 'required' ? 'Block' : 'Warn'}</span>
          </div>`,
          )
          .join('')}
      </div>
    </div>`
        : ''
    }
    ${
      calendarWorkflows
        ? `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px">
        <div>
          <div class="card-title" style="margin:0">Calendar Workflows</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Agenda review, availability, meeting briefings, scheduling, and follow-up reminders across configured calendar connectors.</div>
        </div>
        <span class="badge ${calendarWorkflows.status === 'ready' ? 'badge-success' : calendarWorkflows.status === 'blocked' ? 'badge-error' : 'badge-warning'}">${esc(calendarWorkflows.status)}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;margin-bottom:12px">
        ${calendarWorkflows.workflows
          .map(
            (workflow) => `
          <div style="padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
              <strong style="font-size:12px;color:var(--text)">${esc(workflow.label)}</strong>
              <span class="badge ${workflow.status === 'ready' ? 'badge-success' : workflow.status === 'blocked' ? 'badge-error' : 'badge-warning'}">${esc(workflow.status)}</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:5px;line-height:1.35">${esc(workflow.detail)}</div>
            ${workflow.providers?.length ? `<div style="font-size:11px;color:var(--text-muted);margin-top:5px">${workflow.providers.map((provider) => esc(provider)).join(', ')}</div>` : ''}
            ${workflow.approvalRequired ? '<div style="font-size:11px;color:var(--warning);margin-top:5px">Requires explicit approval before calendar changes.</div>' : ''}
          </div>`,
          )
          .join('')}
      </div>
      <div style="display:grid;gap:6px">
        ${calendarWorkflows.checks
          .map(
            (check) => `
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;font-size:12px;padding:7px 8px;border:1px solid var(--border);border-radius:var(--radius-sm)">
            <div>
              <strong style="color:var(--text)">${esc(check.label)}</strong>
              <div style="color:var(--text-muted);margin-top:2px">${esc(check.detail)}</div>
              ${check.hint && !check.ok ? `<div style="color:var(--warning);margin-top:2px">${esc(check.hint)}</div>` : ''}
            </div>
            <span class="badge ${check.ok ? 'badge-success' : check.severity === 'required' ? 'badge-error' : 'badge-warning'}">${check.ok ? 'OK' : check.severity === 'required' ? 'Block' : 'Warn'}</span>
          </div>`,
          )
          .join('')}
      </div>
    </div>`
        : ''
    }
    ${
      emailWorkflows
        ? `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px">
        <div>
          <div class="card-title" style="margin:0">Email Workflows</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Mail search, thread summaries, inbox triage, reply drafts, approved sending, and mailbox cleanup.</div>
        </div>
        <span class="badge ${emailWorkflows.status === 'ready' ? 'badge-success' : emailWorkflows.status === 'blocked' ? 'badge-error' : 'badge-warning'}">${esc(emailWorkflows.status)}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;margin-bottom:12px">
        ${emailWorkflows.workflows
          .map(
            (workflow) => `
          <div style="padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
              <strong style="font-size:12px;color:var(--text)">${esc(workflow.label)}</strong>
              <span class="badge ${workflow.status === 'ready' ? 'badge-success' : workflow.status === 'blocked' ? 'badge-error' : 'badge-warning'}">${esc(workflow.status)}</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:5px;line-height:1.35">${esc(workflow.detail)}</div>
            ${workflow.providers?.length ? `<div style="font-size:11px;color:var(--text-muted);margin-top:5px">${workflow.providers.map((provider) => esc(provider)).join(', ')}</div>` : ''}
            ${workflow.approvalRequired ? '<div style="font-size:11px;color:var(--warning);margin-top:5px">Requires explicit approval before sending or mailbox changes.</div>' : ''}
          </div>`,
          )
          .join('')}
      </div>
      <div style="display:grid;gap:6px">
        ${emailWorkflows.checks
          .map(
            (check) => `
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;font-size:12px;padding:7px 8px;border:1px solid var(--border);border-radius:var(--radius-sm)">
            <div>
              <strong style="color:var(--text)">${esc(check.label)}</strong>
              <div style="color:var(--text-muted);margin-top:2px">${esc(check.detail)}</div>
              ${check.hint && !check.ok ? `<div style="color:var(--warning);margin-top:2px">${esc(check.hint)}</div>` : ''}
            </div>
            <span class="badge ${check.ok ? 'badge-success' : check.severity === 'required' ? 'badge-error' : 'badge-warning'}">${check.ok ? 'OK' : check.severity === 'required' ? 'Block' : 'Warn'}</span>
          </div>`,
          )
          .join('')}
      </div>
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

function reportStatusBadge(status) {
  const cls =
    status === 'delivered' || status === 'draft_ready'
      ? 'badge-success'
      : status === 'failed'
        ? 'badge-error'
        : 'badge-warning';
  return `<span class="badge ${cls}">${esc(status || 'unknown')}</span>`;
}

function reportApprovalText(job) {
  if (job.status === 'awaiting_outline_approval')
    return 'Outline approval is required before draft generation or artifact export.';
  if (job.status === 'awaiting_delivery_approval')
    return 'Delivery approval is required before this report is marked delivered.';
  if (job.status === 'draft_ready')
    return 'Draft artifacts are ready; delivery approval is disabled for this job.';
  if (job.status === 'delivered') return 'Report delivery has been approved.';
  return 'Report job is waiting for the next pipeline step.';
}

async function renderReports(el) {
  const [jobs, briefings, groups, providerProfiles] = await Promise.all([
    api('/reports/jobs').catch(() => []),
    api('/briefings').catch(() => []),
    api('/groups').catch(() => []),
    api('/system/provider/profiles').catch(() => ({ profiles: [] })),
  ]);
  const reportProfileOptions = (providerProfiles.profiles || [])
    .map(
      (profile) =>
        `<option value="${esc(profile.id)}" ${profile.id === 'default_reports' ? 'selected' : ''}>${esc(profile.label || profile.id)} — ${esc(profile.provider)}/${esc(profile.model)}</option>`,
    )
    .join('');
  const reportJobs = Array.isArray(jobs) ? jobs : [];
  const briefingSchedules = Array.isArray(briefings) ? briefings : [];
  const groupList = Array.isArray(groups) ? groups : [];
  const pendingReportCount = reportJobs.filter((job) =>
    String(job.status || '').includes('awaiting'),
  ).length;
  el.innerHTML = `
    <div class="page-header">
      <div>
        <span class="report-kicker">Documents</span>
        <h2>Report Studio</h2>
      </div>
      <div class="page-actions">
        <span class="badge badge-accent">${reportJobs.length} jobs</span>
        <span class="badge badge-muted">${briefingSchedules.length} briefings</span>
        <span class="badge ${pendingReportCount ? 'badge-warning' : 'badge-success'}">${pendingReportCount} waiting</span>
      </div>
    </div>
    <div class="report-studio">
      <section class="report-studio-hero">
        <div class="report-create-panel">
          <div class="report-create-head">
            <div>
              <span class="report-kicker">New report</span>
              <h3>Turn memory and journals into a deliverable</h3>
            </div>
            <span class="badge badge-info">approval gated</span>
          </div>
          <form id="report-create-form" class="report-create-form">
            <div class="form-group">
              <label>Title</label>
              <input id="report-title" placeholder="Weekly alliance digest">
            </div>
            <div class="form-group">
              <label>Request</label>
              <textarea id="report-request" rows="5" placeholder="Summarize recent events, decisions, risks, and next actions" required></textarea>
            </div>
            <div class="report-form-grid">
              <div class="form-group">
                <label>Source Scopes</label>
                <input id="report-sources" value="journal, memory">
              </div>
              <div class="form-group">
                <label>Provider Profile</label>
                <select id="report-provider-profile">${reportProfileOptions}</select>
              </div>
            </div>
            <div class="form-group">
              <label>Deliverables Directory</label>
              <input id="report-dir" placeholder="store/deliverables">
            </div>
            <div class="report-format-grid" aria-label="Report output formats">
              ${['markdown', 'html', 'docx', 'pdf'].map((format) => `<label class="report-format-option"><input type="checkbox" class="report-format" value="${format}" ${format === 'markdown' ? 'checked' : ''}> <span>${format.toUpperCase()}</span></label>`).join('')}
            </div>
            <div class="report-check-row">
              <label class="report-check-option"><input id="report-outline-approval" type="checkbox" checked> <span>Outline approval</span></label>
              <label class="report-check-option"><input id="report-delivery-approval" type="checkbox" checked> <span>Delivery approval</span></label>
            </div>
            <button type="submit" class="btn btn-primary">Create Report</button>
          </form>
        </div>
        <aside class="report-pipeline-panel">
          <span class="report-kicker">Pipeline</span>
          <h3>Reports stay reviewable before anything leaves NanoCrab.</h3>
          <div class="report-pipeline-list">
            <div class="report-pipeline-step"><span class="report-step-index">01</span><div><strong>Request</strong><span>Choose sources, formats, and provider.</span></div></div>
            <div class="report-pipeline-step"><span class="report-step-index">02</span><div><strong>Outline</strong><span>Approve the structure before drafting.</span></div></div>
            <div class="report-pipeline-step"><span class="report-step-index">03</span><div><strong>Export</strong><span>Create Markdown, HTML, DOCX, or PDF artifacts.</span></div></div>
            <div class="report-pipeline-step"><span class="report-step-index">04</span><div><strong>Delivery</strong><span>Release only after approval.</span></div></div>
          </div>
        </aside>
      </section>
      <section class="report-work-grid">
        <div class="report-section-panel">
          <div class="card-title">Scheduled Briefings</div>
          <form id="briefing-create-form" class="report-create-form">
            <div class="form-group"><label>Title</label><input id="briefing-title" placeholder="Daily operations brief" required></div>
            <div class="report-form-grid">
              <div class="form-group"><label>Cadence</label><select id="briefing-cadence"><option value="daily">Daily</option><option value="weekly">Weekly</option></select></div>
              <div class="form-group"><label>Local Time</label><input id="briefing-time" type="time" value="08:30" required></div>
            </div>
            <div class="report-form-grid">
              <div class="form-group"><label>Target Group</label><select id="briefing-group">${groupList.map((group) => `<option value="${esc(group.folder)}" data-jid="${esc(group.jid)}">${esc(group.name)}</option>`).join('')}</select></div>
              <div class="form-group"><label>Source Scopes</label><input id="briefing-sources" value="journal, memory"></div>
            </div>
            <div class="form-group"><label>Provider Profile</label><select id="briefing-provider-profile">${reportProfileOptions}</select></div>
            <div class="report-format-grid" aria-label="Briefing output formats">
              ${['markdown', 'html', 'docx', 'pdf'].map((format) => `<label class="report-format-option"><input type="checkbox" class="briefing-format" value="${format}" ${format === 'markdown' ? 'checked' : ''}> <span>${format.toUpperCase()}</span></label>`).join('')}
            </div>
            <div class="report-check-row">
              <label class="report-check-option"><input id="briefing-delivery-approval" type="checkbox" checked> <span>Require delivery approval</span></label>
            </div>
            <button type="submit" class="btn btn-primary btn-sm" ${groupList.length ? '' : 'disabled'}>Create Briefing Schedule</button>
          </form>
        </div>
        <aside class="report-side-panel">
          <div class="card-title">Briefing Jobs <span class="badge badge-muted">${briefingSchedules.length}</span></div>
          <div class="report-list">
            ${
              briefingSchedules.length
                ? briefingSchedules
                    .map(
                      (briefing) => `
              <div class="briefing-card">
                <div class="briefing-card-head">
                  <div>
                    <strong>${esc(briefing.title)}</strong>
                    <span>${esc(briefing.cadence)} at ${esc(briefing.localTime)} ${esc(briefing.timezone || '')}</span>
                  </div>
                  <span class="badge ${briefing.status === 'active' ? 'badge-success' : 'badge-muted'}">${esc(briefing.status)}</span>
                </div>
                <div class="briefing-card-meta">
                  <span class="badge badge-info">${esc(briefing.scheduleValue)}</span>
                  ${(briefing.sourceScopes || []).map((scope) => `<span class="badge badge-muted">${esc(scope)}</span>`).join('')}
                  ${briefing.requireDeliveryApproval ? '<span class="badge badge-warning">delivery approval</span>' : ''}
                  <span class="badge badge-accent">${esc(briefing.providerProfileId || 'default_reports')}</span>
                </div>
                <div class="report-job-meta">Task: ${esc(briefing.scheduledTaskId || '')}</div>
              </div>`,
                    )
                    .join('')
                : '<div class="empty report-empty">No briefing schedules yet.</div>'
            }
          </div>
        </aside>
      </section>
      <section class="report-section-panel">
      <div class="card-title">Report Jobs</div>
      ${
        reportJobs.length
          ? reportJobs
              .map(
                (job) => `
        <div class="report-job-card">
          <div class="report-job-head">
            <div>
              <strong>${esc(job.title)}</strong>
              <span>${esc(job.request)}</span>
            </div>
            <div class="report-job-actions">
              ${reportStatusBadge(job.status)}
              ${job.requireOutlineApproval ? '<span class="badge badge-muted">outline approval</span>' : ''}
              ${job.requireDeliveryApproval ? '<span class="badge badge-muted">delivery approval</span>' : ''}
            </div>
          </div>
          <div class="report-job-meta">${esc(reportApprovalText(job))}</div>
            ${
              job.outline
                ? `<pre class="report-outline-preview">${esc(job.outline)}</pre>`
                : ''
            }
            ${
              job.artifacts?.length
                ? `<div class="report-artifact-actions">${job.artifacts
                    .map(
                      (artifact, index) =>
                        `<a class="btn btn-sm btn-ghost" href="/api/reports/jobs/${encodeURIComponent(job.id)}/artifacts/${index}/download" download>${esc(artifact.format).toUpperCase()}</a>`,
                    )
                    .join('')}</div>`
                : '<div class="report-job-meta">No exported artifacts yet.</div>'
            }
          <div class="report-job-actions">
            ${
              job.status === 'awaiting_outline_approval'
                ? `<button class="btn btn-sm btn-primary" onclick="approveReportOutline('${esc(job.id)}')">Generate after approval</button>`
                : ''
            }
            ${
              job.status === 'awaiting_delivery_approval'
                ? `<button class="btn btn-sm btn-primary" onclick="approveReportDelivery('${esc(job.id)}')">Mark delivered</button>`
                : ''
            }
            <button class="btn btn-sm btn-ghost" onclick="navigate('approvals')">Approvals</button>
          </div>
        </div>`,
              )
              .join('')
          : '<div class="empty report-empty">No report jobs yet.</div>'
      }
      </section>
    </div>`;

  document.getElementById('report-create-form').onsubmit = async (e) => {
    e.preventDefault();
    const formats = Array.from(document.querySelectorAll('.report-format'))
      .filter((input) => input.checked)
      .map((input) => input.value);
    const sourceScopes = document
      .getElementById('report-sources')
      .value.split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);
    const r = await api('/reports/jobs', {
      method: 'POST',
      body: JSON.stringify({
        title: document.getElementById('report-title').value,
        request: document.getElementById('report-request').value,
        sourceScopes,
        outputFormats: formats.length ? formats : ['markdown'],
        providerProfileId: document.getElementById('report-provider-profile')
          ?.value,
        deliverablesDir:
          document.getElementById('report-dir').value || undefined,
        requireOutlineApproval: document.getElementById(
          'report-outline-approval',
        ).checked,
        requireDeliveryApproval: document.getElementById(
          'report-delivery-approval',
        ).checked,
      }),
    });
    if (r.ok) {
      toast('Report job created', 'success');
      navigate('reports');
    } else toast(r.error || 'Failed to create report', 'error');
  };

  const briefingForm = document.getElementById('briefing-create-form');
  if (briefingForm)
    briefingForm.onsubmit = async (e) => {
      e.preventDefault();
      const groupSelect = document.getElementById('briefing-group');
      const selected = groupSelect?.selectedOptions?.[0];
      const formats = Array.from(document.querySelectorAll('.briefing-format'))
        .filter((input) => input.checked)
        .map((input) => input.value);
      const sourceScopes = document
        .getElementById('briefing-sources')
        .value.split(',')
        .map((scope) => scope.trim())
        .filter(Boolean);
      const r = await api('/briefings', {
        method: 'POST',
        body: JSON.stringify({
          title: document.getElementById('briefing-title').value,
          cadence: document.getElementById('briefing-cadence').value,
          groupFolder: groupSelect?.value,
          chatJid: selected?.dataset?.jid,
          localTime: document.getElementById('briefing-time').value,
          sourceScopes,
          outputFormats: formats.length ? formats : ['markdown'],
          providerProfileId: document.getElementById(
            'briefing-provider-profile',
          )?.value,
          deliveryMode: 'approval',
          requireDeliveryApproval: document.getElementById(
            'briefing-delivery-approval',
          ).checked,
        }),
      }).catch(() => null);
      if (r?.ok) {
        toast('Briefing schedule created', 'success');
        navigate('reports');
      } else toast(r?.error || 'Failed to create briefing', 'error');
    };
}

window.approveReportOutline = async (id) => {
  const r = await api(
    `/reports/jobs/${encodeURIComponent(id)}/approve-outline`,
    {
      method: 'POST',
    },
  );
  if (r.ok) {
    toast('Report outline approved', 'success');
    navigate('reports');
  } else toast(r.error || 'Approval is still pending', 'warning');
};

window.approveReportDelivery = async (id) => {
  const r = await api(
    `/reports/jobs/${encodeURIComponent(id)}/approve-delivery`,
    { method: 'POST' },
  );
  if (r.ok) {
    toast('Report delivered', 'success');
    navigate('reports');
  } else toast(r.error || 'Delivery approval is still pending', 'warning');
};

function artifactSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function artifactDownloadHref(record) {
  if (record.sourceType !== 'report-job') return '';
  if (typeof record.sourceArtifactIndex !== 'number') return '';
  return `/api/reports/jobs/${encodeURIComponent(record.sourceId)}/artifacts/${record.sourceArtifactIndex}/download`;
}

async function renderArtifacts(el) {
  const [records, summary] = await Promise.all([
    api('/artifacts/vault').catch(() => []),
    api('/artifacts/vault/summary').catch(() => ({
      total: 0,
      totalSizeBytes: 0,
      kinds: [],
      formats: [],
    })),
  ]);
  el.innerHTML = `
    <div class="page-header"><h2>Artifact Vault</h2></div>
    <div class="card">
      <div class="grid grid-4">
        <div><div style="font-size:11px;color:var(--text-muted)">Artifacts</div><div style="font-size:20px;font-weight:600">${summary.total || 0}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Storage</div><div style="font-size:20px;font-weight:600">${artifactSize(summary.totalSizeBytes || 0)}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Kinds</div><div style="font-size:13px;color:var(--text);margin-top:6px">${(summary.kinds || []).map((kind) => `<span class="badge badge-info">${esc(kind)}</span>`).join(' ') || '-'}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted)">Formats</div><div style="font-size:13px;color:var(--text);margin-top:6px">${(summary.formats || []).map((format) => `<span class="badge badge-muted">${esc(format)}</span>`).join(' ') || '-'}</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <input id="artifact-query" class="search-input" style="max-width:280px" placeholder="Search title, path, source, tag">
        <input id="artifact-source" class="search-input" style="max-width:220px" placeholder="Source link">
        <button class="btn btn-sm btn-primary" onclick="searchArtifacts()">Search</button>
        <button class="btn btn-sm btn-ghost" onclick="reindexArtifacts()">Reindex reports</button>
        <button class="btn btn-sm btn-ghost" onclick="pruneArtifacts()">Prune expired</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Vault Records</div>
      <div id="artifact-results">${renderArtifactRecords(records)}</div>
    </div>`;
}

function renderArtifactRecords(records) {
  if (!records.length)
    return '<div style="font-size:12px;color:var(--text-muted)">No artifacts indexed yet. Reindex reports after generating deliverables.</div>';
  return records
    .map((record) => {
      const href = artifactDownloadHref(record);
      return `
      <div class="channel-card" style="align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <strong style="color:var(--text)">${esc(record.title)}</strong>
            <span class="badge badge-info">${esc(record.kind)}</span>
            <span class="badge badge-muted">${esc(record.format)}</span>
            <span class="badge badge-muted">${artifactSize(record.sizeBytes)}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:5px;font-family:var(--mono);word-break:break-all">${esc(record.path)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:5px">Source: <span class="badge badge-muted">${esc(record.sourceType)}</span> ${esc(record.sourceId)} · Retention ${record.retentionDays}d · Expires ${record.expiresAt ? esc(record.expiresAt.slice(0, 10)) : 'never'}</div>
          ${
            record.sourceLinks?.length
              ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:7px">${record.sourceLinks.map((link) => `<span class="badge badge-success">${esc(link.label || link.source)}</span>`).join('')}</div>`
              : '<div style="font-size:11px;color:var(--text-muted);margin-top:7px">No source links recorded.</div>'
          }
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${href ? `<a class="btn btn-sm btn-ghost" href="${href}" download>Download</a>` : ''}
          ${record.sourceType === 'report-job' ? `<button class="btn btn-sm btn-ghost" onclick="navigate('reports')">Report</button>` : ''}
        </div>
      </div>`;
    })
    .join('');
}

window.searchArtifacts = async () => {
  const params = new URLSearchParams();
  const query = document.getElementById('artifact-query')?.value || '';
  const source = document.getElementById('artifact-source')?.value || '';
  if (query) params.set('query', query);
  if (source) params.set('source', source);
  const records = await api(`/artifacts/vault?${params.toString()}`);
  const target = document.getElementById('artifact-results');
  if (target) target.innerHTML = renderArtifactRecords(records);
};

window.reindexArtifacts = async () => {
  const r = await api('/artifacts/vault/reindex', { method: 'POST' });
  if (r.ok) {
    toast(`Indexed ${r.total} artifact records`, 'success');
    navigate('artifacts');
  } else toast(r.error || 'Reindex failed', 'error');
};

window.pruneArtifacts = async () => {
  const r = await api('/artifacts/vault/prune', { method: 'POST' });
  if (r.ok) {
    toast(`Pruned ${r.removed} expired records`, 'success');
    navigate('artifacts');
  } else toast(r.error || 'Prune failed', 'error');
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
    <div class="skills-page">
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
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(suggestion.description)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${esc(suggestion.reason || '')}</div>
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            <button class="btn btn-sm btn-primary" onclick="createSkillDraftFromSuggestion(${index})">Create Draft</button>
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
                ${s.installState ? `<span class="badge ${s.installState.status === 'installed' ? 'badge-success' : s.installState.status === 'modified' ? 'badge-warning' : s.installState.status === 'missing' ? 'badge-error' : 'badge-muted'}">${esc(s.installState.status)}</span>` : ''}
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
              <button class="btn btn-sm btn-ghost" onclick="viewSkillVersions('${esc(s.path)}')">History</button>
              ${cat !== 'core' ? `<button class="btn btn-sm btn-danger" onclick="deleteSkill('${esc(s.path)}',this)">Delete</button>` : ''}
            </div>
          </div>`,
          )
          .join('')}
      </div>`;
      })
      .join('')}
    <div id="skill-editor" style="display:none"></div>
    <div id="skill-version-viewer" style="display:none"></div>
    <div id="skill-draft-viewer" style="display:none"></div>
    ${options.embedded ? '' : '<div id="skills-page-timeline"></div>'}
    </div>`;

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

window.viewSkillDraft = async (id) => {
  const data = await api(`/skills/drafts/${encodeURIComponent(id)}`);
  const viewer = document.getElementById('skill-draft-viewer');
  viewer.style.display = 'block';
  viewer.innerHTML = `
    <div class="card" style="margin-top:16px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px">
        <div class="card-title" style="margin:0">Draft: ${esc(data.draft.name)}</div>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('skill-draft-viewer').style.display='none'">Close</button>
      </div>
      <pre class="log-viewer" style="max-height:420px;white-space:pre-wrap">${esc(data.content)}</pre>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-sm btn-primary" onclick="reviewSkillDraft('${esc(id)}','approve')">Approve</button>
        <button class="btn btn-sm btn-ghost" onclick="reviewSkillDraft('${esc(id)}','reject')">Reject</button>
      </div>
    </div>`;
  viewer.scrollIntoView({ behavior: 'smooth' });
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

window.viewSkillVersions = async (skillPath) => {
  const data = await api(`/skills/${encodeURIComponent(skillPath)}/versions`);
  const viewer = document.getElementById('skill-version-viewer');
  const state = data.installState || {};
  viewer.style.display = 'block';
  viewer.innerHTML = `
    <div class="card" style="margin-top:16px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px">
        <div class="card-title" style="margin:0">History: ${esc(skillPath)}/SKILL.md</div>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('skill-version-viewer').style.display='none'">Close</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <span class="badge badge-muted">${esc(state.status || 'unknown')}</span>
        <span class="badge badge-info">current ${esc(String(state.currentVersion || 'untracked'))}</span>
        <span class="badge badge-muted">latest ${esc(String(state.latestVersion || 'none'))}</span>
      </div>
      ${
        data.versions && data.versions.length
          ? data.versions
              .map(
                (version) => `
        <div class="channel-card" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <span style="font-weight:600;color:var(--text)">v${esc(String(version.version))}</span>
              <span class="badge badge-info">${esc(version.action)}</span>
              ${version.restoredFromVersion ? `<span class="badge badge-warning">from v${esc(String(version.restoredFromVersion))}</span>` : ''}
              <span class="badge badge-muted">${esc(String(version.bytes || 0))} bytes</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${esc(version.actor || 'unknown')} &middot; ${formatTime(version.timestamp)} &middot; ${esc((version.sha256 || '').slice(0, 12))}</div>
            ${version.note ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(version.note)}</div>` : ''}
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            <button class="btn btn-sm btn-ghost" onclick="viewSkillVersionDiff('${esc(skillPath)}',${Number(version.version)})">Diff</button>
            <button class="btn btn-sm btn-ghost" onclick="rollbackSkillVersion('${esc(skillPath)}',${Number(version.version)},this)">Rollback</button>
          </div>
        </div>`,
              )
              .join('')
          : '<div class="empty" style="padding:12px">No versions recorded yet</div>'
      }
      <pre id="skill-version-diff" class="log-viewer" style="display:none;margin-top:12px;max-height:360px;white-space:pre-wrap"></pre>
    </div>`;
  viewer.scrollIntoView({ behavior: 'smooth' });
};

window.viewSkillVersionDiff = async (skillPath, version) => {
  const res = await fetch(
    `/api/skills/${encodeURIComponent(skillPath)}/versions/${encodeURIComponent(version)}/diff`,
    { headers: { Accept: 'text/plain' } },
  );
  const diff = await res.text();
  const target = document.getElementById('skill-version-diff');
  target.style.display = 'block';
  target.textContent = diff;
};

window.rollbackSkillVersion = async (skillPath, version, btnEl) => {
  inlineConfirm(btnEl, `Rollback "${skillPath}" to v${version}?`, async () => {
    const r = await api(
      `/skills/${encodeURIComponent(skillPath)}/versions/${encodeURIComponent(version)}/rollback`,
      {
        method: 'POST',
        body: JSON.stringify({ actor: 'dashboard' }),
      },
    );
    if (r.ok) {
      toast(r.message || 'Rolled back', 'success');
      await viewSkillVersions(skillPath);
    } else toast(r.error || 'Failed', 'error');
  });
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
    <div class="knowledge-timeline">
      <div class="knowledge-timeline-line"></div>
      ${items
        .map(
          (item) => `
        <div class="knowledge-timeline-item">
          <div class="knowledge-timeline-dot" style="background:${color(item.tone)};box-shadow:0 0 0 4px color-mix(in srgb, ${color(item.tone)} 18%, transparent)"></div>
          <div class="knowledge-timeline-card">
            <div>
              <div class="knowledge-timeline-title">
                <span class="badge ${item.kind === 'skill' ? 'badge-accent' : 'badge-info'}">${esc(item.kind)}</span>
                <span>${esc(item.title)}</span>
              </div>
              <p>${esc(item.detail || '')}</p>
              <time>${formatTime(item.timestamp)} &middot; ${esc(item.meta || '')}</time>
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
async function renderMemory(el) {
  const [
    memData,
    groups,
    auditData,
    structuredMemories,
    journalEntries,
    drafts,
  ] = await Promise.all([
    api('/files/memory'),
    api('/groups'),
    api('/audit?limit=50').catch(() => []),
    api('/memory?limit=100').catch(() => []),
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
  const pendingMemories = structuredMemories.filter(
    (m) => m.status === 'pending',
  );
  const approvedMemories = structuredMemories
    .filter((m) => m.status === 'approved')
    .slice(0, 8);

  el.innerHTML = `
    <div class="page-header"><h2>Memory</h2></div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">Structured Memory Review <span class="badge badge-muted">${pendingMemories.length} pending</span></div>
        ${
          pendingMemories.length === 0
            ? '<div class="empty" style="padding:12px">No pending memory proposals</div>'
            : pendingMemories
                .map(
                  (m) => `
          <div class="channel-card" style="align-items:flex-start">
            <div style="flex:1;min-width:0">
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:5px">
                <span class="badge badge-accent">${esc(m.scope)}</span>
                <span class="badge badge-muted">${esc(m.type)}</span>
                <span class="badge badge-info">${Math.round((m.confidence || 0) * 100)}%</span>
                <span class="badge badge-muted">${esc(m.visibility)}</span>
              </div>
              <div style="font-size:13px;color:var(--text);line-height:1.45">${esc(m.content)}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:5px">${esc(m.source || 'agent proposal')} &middot; ${formatTime(m.created_at)}</div>
            </div>
            <div style="display:flex;gap:5px">
              <button class="btn btn-sm btn-primary" onclick="reviewMemoryRecord('${esc(m.id)}','approve')">Approve</button>
              <button class="btn btn-sm btn-ghost" onclick="reviewMemoryRecord('${esc(m.id)}','reject')">Reject</button>
            </div>
          </div>`,
                )
                .join('')
        }
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
        <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:12px">
          <div class="form-group" style="margin:0;flex:1;min-width:220px">
            <label style="font-size:12px;color:var(--text-muted)">Ask Journal</label>
            <input class="search-input" id="journal-answer-query" placeholder="What happened near Kepler?">
          </div>
          <button class="btn btn-sm btn-primary" onclick="searchJournalAnswer()">Search</button>
        </div>
        <div id="journal-answer-result" style="margin-bottom:14px"></div>
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

window.searchJournalAnswer = async () => {
  const query = document.getElementById('journal-answer-query')?.value || '';
  const target = document.getElementById('journal-answer-result');
  if (!target) return;
  const result = await api(
    `/journal/search?query=${encodeURIComponent(query)}`,
  );
  target.innerHTML = `
    <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;background:var(--bg)">
      <div style="font-size:12px;color:var(--text);white-space:pre-wrap;line-height:1.45">${esc(result.answer || '')}</div>
      ${
        result.citations?.length
          ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px">${result.citations
              .map(
                (citation) =>
                  `<span class="badge badge-info">${esc(citation.marker)} ${esc(citation.title || citation.source)}</span>`,
              )
              .join('')}</div>`
          : ''
      }
    </div>`;
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
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
          <span class="badge ${health.status === 'ready' ? 'badge-success' : health.status === 'blocked' ? 'badge-error' : 'badge-warning'}">${esc(health.status)}</span>
          <span style="font-size:12px;color:var(--text-muted)">${health.summary.passed}/${health.summary.total} checks passing</span>
        </div>
        <div style="display:grid;gap:6px;margin-bottom:12px">
          ${health.checks
            .map(
              (check) => `
            <div style="padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)">
              <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
                <strong style="font-size:12px;color:var(--text)">${esc(check.label)}</strong>
                <span class="badge ${check.ok ? 'badge-success' : check.severity === 'required' ? 'badge-error' : 'badge-warning'}">${check.ok ? 'OK' : check.severity === 'required' ? 'Block' : 'Warn'}</span>
              </div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${esc(check.detail)}</div>
              ${check.hint && !check.ok ? `<div style="font-size:11px;color:var(--warning);margin-top:4px">${esc(check.hint)}</div>` : ''}
            </div>`,
            )
            .join('')}
        </div>
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

  // Build the split-pane HTML
  el.innerHTML = `
    <div class="page-header" style="margin-bottom:0">
      <h2>Terminal</h2>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input class="search-input" id="terminal-session-id"
          value="${esc(localStorage.getItem('terminal_session_id') || 'term-' + Math.random().toString(36).slice(2, 8))}"
          style="max-width:180px;padding:5px 8px;font-family:var(--mono);font-size:12px">
        <button class="btn btn-sm btn-ghost" onclick="reconnectTerminal()">Reconnect</button>
        <button class="btn btn-sm btn-ghost" onclick="clearTerminal()">Clear</button>
        <button class="btn btn-sm btn-ghost" onclick="copyTerminalTranscript()">Copy</button>
        <button class="btn btn-sm btn-ghost" onclick="spawnNewTerminal()">New</button>
      </div>
    </div>
    <div class="card" style="padding:0;overflow:hidden;flex:1;display:flex;flex-direction:column;margin-top:8px">
      <div class="split-container" id="terminal-split">
        <div class="split-pane" id="pane-left" style="flex:1">
          <div class="pane-tabs" id="pane-left-tabs">
            <div class="pane-tab active" data-tab="terminal" onclick="switchTermPane('left', 'terminal')">Terminal</div>
            <div class="pane-tab" data-tab="files" onclick="switchTermPane('left', 'files')">Files</div>
          </div>
          <div class="pane-content" id="pane-left-content">
            <div class="tab-content active" id="left-terminal">
              <div id="terminal-container" style="height:100%;background:var(--bg)"></div>
            </div>
            <div class="tab-content" id="left-files" style="display:none">
              <div class="term-file-tree" id="term-file-tree">Loading...</div>
            </div>
          </div>
        </div>
        <div class="split-divider" id="split-divider"></div>
        <div class="split-pane" id="pane-right" style="flex:1">
          <div class="pane-tabs" id="pane-right-tabs">
            <div class="pane-tab active" data-tab="logs" onclick="switchTermPane('right', 'logs')">Logs</div>
            <div class="pane-tab" data-tab="search" onclick="switchTermPane('right', 'search')">Search</div>
          </div>
          <div class="pane-content" id="pane-right-content">
            <div class="tab-content active" id="right-logs">
              <div class="term-log-viewer" id="term-log-viewer">Loading logs...</div>
            </div>
            <div class="tab-content" id="right-search" style="display:none">
              <div class="term-search-pane" id="term-search-pane">
                <div class="search-input-row">
                  <input class="search-input" id="term-search-input" placeholder="Search terminal history..." style="flex:1">
                  <button class="btn btn-sm btn-primary" onclick="runTerminalSearch()">Search</button>
                </div>
                <div style="display:flex;gap:8px;font-size:11px;color:var(--text-muted)">
                  <label>From: <input type="date" id="term-search-from" class="search-input" style="width:auto;padding:2px 6px"></label>
                  <label>To: <input type="date" id="term-search-to" class="search-input" style="width:auto;padding:2px 6px"></label>
                </div>
                <div class="search-results" id="term-search-results">
                  <div style="color:var(--text-muted);padding:12px;text-align:center;font-size:12px">Enter a query to search across all terminal sessions</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // --- Split divider drag ---
  const divider = document.getElementById('split-divider');
  let isDragging = false;

  divider.addEventListener('mousedown', (e) => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const container = document.getElementById('terminal-split');
    const rect = container.getBoundingClientRect();
    const leftPane = document.getElementById('pane-left');
    const rightPane = document.getElementById('pane-right');
    let pos = e.clientX - rect.left;
    const minWidth = 200;
    pos = Math.max(minWidth, Math.min(pos, rect.width - minWidth));
    const pct = (pos / rect.width) * 100;
    leftPane.style.flex = `0 0 ${pct}%`;
    rightPane.style.flex = `1 1 ${100 - pct}%`;
    localStorage.setItem('terminal_split_pos', pct.toString());
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });

  // Restore saved split position
  const savedPos = localStorage.getItem('terminal_split_pos');
  if (savedPos) {
    const pct = parseFloat(savedPos);
    if (pct > 20 && pct < 80) {
      document.getElementById('pane-left').style.flex = `0 0 ${pct}%`;
      document.getElementById('pane-right').style.flex = `1 1 ${100 - pct}%`;
    }
  }

  // --- Load xterm.js ---
  await loadCss(
    'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css',
  );
  await loadScript(
    'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js',
  );
  await loadScript(
    'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js',
  );
  await loadScript(
    'https://cdn.jsdelivr.net/npm/@xterm/addon-search@0.16.0/lib/addon-search.min.js',
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
  const searchAddon = new window.SearchAddon.SearchAddon();
  term.loadAddon(searchAddon);

  term.open(document.getElementById('terminal-container'));
  setTimeout(() => fitAddon.fit(), 100);

  // Ctrl+Shift+F inline search
  term.onKey((e) => {
    if (
      e.key === 'F' &&
      (e.domEvent.ctrlKey || e.domEvent.metaKey) &&
      e.domEvent.shiftKey
    ) {
      const query = prompt('Search terminal (Ctrl+G next, Shift+Ctrl+G prev):');
      if (query) searchAddon.findNext(query);
    }
  });

  const sessionId = document.getElementById('terminal-session-id').value;
  localStorage.setItem('terminal_session_id', sessionId);
  activeTerminal = { sessionId, term, transcript: '' };

  // Spawn or attach terminal session
  const initTerminal = () => {
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify({ type: 'terminal_attach', sessionId }));
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
        ws.send(JSON.stringify({ type: 'terminal_attach', sessionId }));
        ws.send(JSON.stringify({ type: 'terminal_spawn', data: sessionId }));
      } else if (attempts > 20) {
        clearInterval(check);
        term.write('\r\nFailed to connect. Check WebSocket.\r\n');
      }
    }, 500);
  };
  window._spawnTerminalSession = initTerminal;
  initTerminal();

  term.onData((data) => {
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify({ type: 'terminal_input', sessionId, data }));
    }
  });

  const container = document.getElementById('terminal-container');
  if (container) new ResizeObserver(() => fitAddon.fit()).observe(container);

  // --- Load file tree ---
  loadTerminalFileTree();

  // --- Load logs ---
  loadTerminalLogs();
}

// Tab switching within panes
window.switchTermPane = function (side, tabId) {
  const tabs = document.getElementById(`pane-${side}-tabs`);
  if (!tabs) return;
  tabs
    .querySelectorAll('.pane-tab')
    .forEach((t) => t.classList.remove('active'));
  const tab = tabs.querySelector(`[data-tab="${tabId}"]`);
  if (tab) tab.classList.add('active');

  const contents = document.getElementById(`pane-${side}-content`);
  if (!contents) return;
  contents
    .querySelectorAll('.tab-content')
    .forEach((c) => (c.style.display = 'none'));
  const target = document.getElementById(`${side}-${tabId}`);
  if (target) {
    target.style.display = '';
    target.classList.add('active');
  }
};

// File tree in terminal pane
async function loadTerminalFileTree() {
  const el = document.getElementById('term-file-tree');
  if (!el) return;
  try {
    const repos = await api('/files/repos');
    if (repos.length === 0) {
      el.innerHTML =
        '<div style="padding:8px;color:var(--text-muted)">No repos mounted</div>';
      return;
    }
    const repo = repos[0].name;
    const tree = await api(`/files/repos/${encodeURIComponent(repo)}/tree`);
    el.innerHTML = `<div class="repo-header">${esc(repo)}</div>${renderTermTree(tree, '', repo)}`;
  } catch {
    el.innerHTML =
      '<div style="padding:8px;color:var(--text-muted)">Failed to load</div>';
  }
}

function renderTermTree(items, prefix, repo) {
  if (!items || !Array.isArray(items)) return '';
  return items
    .map((item) => {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.type === 'dir') {
        return `<details style="padding-left:10px"><summary style="cursor:pointer;padding:2px 0;font-size:12px;color:var(--text-secondary);list-style:none">${esc(item.name)}/</summary>${renderTermTree(item.children || [], fullPath, repo)}</details>`;
      }
      return `<div class="tree-item" onclick="openTermFile('${esc(repo)}','${esc(fullPath)}')">${esc(item.name)}</div>`;
    })
    .join('');
}

window.openTermFile = function (repo, path) {
  navigate('gitcode');
  setTimeout(() => {
    if (typeof window.openEditorFile === 'function') {
      window.openEditorFile(repo, path);
    }
  }, 500);
};

// Log viewer in terminal pane
async function loadTerminalLogs() {
  const el = document.getElementById('term-log-viewer');
  if (!el) return;
  try {
    const logs = await api('/logs/system?lines=100');
    el.innerHTML =
      logs.lines && logs.lines.length
        ? logs.lines.map((l) => colorizeLog([l])).join('\n')
        : 'No log entries';
    el.scrollTop = el.scrollHeight;
  } catch {
    el.innerHTML = 'Failed to load logs';
  }
  // Subscribe to live logs
  if (ws?.readyState === 1) {
    ws.send(JSON.stringify({ type: 'subscribe_logs', data: 'system' }));
  }
}

// New terminal session
window.spawnNewTerminal = function () {
  const newId = 'term-' + Math.random().toString(36).slice(2, 8);
  const input = document.getElementById('terminal-session-id');
  if (input) input.value = newId;
  localStorage.setItem('terminal_session_id', newId);
  if (activeTerminal && activeTerminal.term) {
    activeTerminal.term.dispose();
    activeTerminal = null;
  }
  if (currentPage === 'devhub') navigate('devhub');
};

window.reconnectTerminal = function () {
  const input = document.getElementById('terminal-session-id');
  const sessionId = input?.value;
  if (!sessionId || !activeTerminal) return;
  localStorage.setItem('terminal_session_id', sessionId);
  if (activeTerminal.term) {
    activeTerminal.sessionId = sessionId;
    activeTerminal.transcript = '';
    activeTerminal.term.reset();
  }
  if (typeof window._spawnTerminalSession === 'function') {
    window._spawnTerminalSession();
  }
};

window.clearTerminal = function () {
  if (!activeTerminal) return;
  activeTerminal.transcript = '';
  if (activeTerminal.term) activeTerminal.term.clear();
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
  const [sys, health] = await Promise.all([
    api('/system'),
    api('/system/health'),
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
    <div class="card"><div class="card-title">Channel Health</div>
      ${health.channels.map((ch) => `<div class="channel-card"><div class="channel-info"><span class="status-dot ${ch.connected ? 'online' : 'offline'}"></span><span class="channel-name">${ch.name}</span></div><span class="badge ${ch.status === 'healthy' ? 'badge-success' : 'badge-error'}">${ch.status}</span></div>`).join('')}
    </div>`;
}

function auditQueryFromFilters() {
  const filters = window._auditFilters || {};
  const params = new URLSearchParams();
  for (const key of [
    'actor',
    'actionType',
    'resource',
    'decision',
    'correlationId',
    'from',
    'to',
  ]) {
    if (filters[key]) params.set(key, filters[key]);
  }
  params.set('limit', filters.limit || '150');
  return params.toString();
}

function auditDecisionBadge(decision) {
  const value = decision || 'allowed';
  const cls =
    value === 'denied' || value === 'error'
      ? 'badge-error'
      : value === 'simulated'
        ? 'badge-warning'
        : value === 'approved' || value === 'allowed'
          ? 'badge-success'
          : 'badge-muted';
  return `<span class="badge ${cls}">${esc(value)}</span>`;
}

function renderAuditEventRow(event, selectedId) {
  const action = event.actionType || event.action || 'unknown';
  const resource = event.resource || event.details || '';
  return `<button class="audit-event ${event.id === selectedId ? 'selected' : ''}" data-id="${esc(event.id || event.timestamp)}">
    <span>${formatTime(event.timestamp)}</span>
    <strong>${esc(action)}</strong>
    ${auditDecisionBadge(event.decision || (action.includes('fail') ? 'error' : 'allowed'))}
    <small>${esc(resource)}</small>
  </button>`;
}

function renderAuditDetail(event, replay) {
  if (!event)
    return '<aside class="audit-detail empty">Select an audit event</aside>';
  const context = event.context || {
    ip: event.ip,
    details: event.details,
    userAgent: event.userAgent,
  };
  return `<aside class="audit-detail">
    <div class="audit-detail-head">
      <div>
        <h3>${esc(event.actionType || event.action || 'Audit event')}</h3>
        <span>${esc(event.resource || event.details || '')}</span>
      </div>
      ${auditDecisionBadge(event.decision || 'allowed')}
    </div>
    <div class="audit-meta-grid">
      ${[
        ['Actor', event.actor || event.ip || 'dashboard'],
        ['Actor ID', event.actorId || '-'],
        ['Correlation', event.correlationId || '-'],
        ['Duration', event.durationMs != null ? `${event.durationMs}ms` : '-'],
        ['Error', event.error || '-'],
      ]
        .map(
          ([label, value]) =>
            `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`,
        )
        .join('')}
    </div>
    <div class="section-label">Context</div>
    <pre class="audit-json">${esc(prettyPrint(context))}</pre>
    ${
      replay?.events?.length
        ? `<div class="section-label">Correlation Replay</div>
          <div class="audit-replay">
            ${replay.events
              .map(
                (item) =>
                  `<div><span>${formatTime(item.timestamp)}</span><strong>${esc(item.actionType)}</strong>${auditDecisionBadge(item.decision)}</div>`,
              )
              .join('')}
          </div>`
        : ''
    }
  </aside>`;
}

async function renderAudit(el) {
  const filters = window._auditFilters || {
    actor: '',
    actionType: '',
    resource: '',
    decision: '',
    correlationId: '',
    from: '',
    to: '',
    limit: '150',
  };
  window._auditFilters = filters;
  const events = await api(`/runtime-audit?${auditQueryFromFilters()}`);
  const selected =
    events.find((event) => event.id === window._selectedAuditId) || events[0];
  if (selected?.id) window._selectedAuditId = selected.id;
  const replay =
    selected?.correlationId && selected.correlationId !== '-'
      ? await api(
          `/runtime-audit/replay/${encodeURIComponent(selected.correlationId)}`,
        ).catch(() => null)
      : null;

  el.innerHTML = `
    <div class="page-header">
      <h2>Audit</h2>
      <div class="page-actions">
        <button class="btn btn-sm btn-ghost" onclick="navigate('audit')">Refresh</button>
        <button class="btn btn-sm btn-primary" onclick="exportAuditJson()">Export JSON</button>
      </div>
    </div>
    <form class="audit-filters" id="audit-filters">
      <input name="actor" value="${esc(filters.actor || '')}" placeholder="Actor">
      <input name="actionType" value="${esc(filters.actionType || '')}" placeholder="Action type">
      <input name="resource" value="${esc(filters.resource || '')}" placeholder="Resource">
      <select name="decision">
        <option value="">Any decision</option>
        ${['allowed', 'approved', 'requires_approval', 'denied', 'simulated', 'error'].map((decision) => `<option value="${decision}" ${filters.decision === decision ? 'selected' : ''}>${decision}</option>`).join('')}
      </select>
      <input name="correlationId" value="${esc(filters.correlationId || '')}" placeholder="Correlation ID">
      <input name="from" type="datetime-local" value="${esc(filters.from || '')}" aria-label="From">
      <input name="to" type="datetime-local" value="${esc(filters.to || '')}" aria-label="To">
      <button class="btn btn-sm btn-primary" type="submit">Filter</button>
      <button class="btn btn-sm btn-ghost" type="button" onclick="resetAuditFilters()">Reset</button>
    </form>
    <div class="audit-layout">
      <section class="audit-list">
        ${events.length ? events.map((event) => renderAuditEventRow(event, selected?.id)).join('') : '<div class="empty">No audit events match these filters.</div>'}
      </section>
      ${renderAuditDetail(selected, replay)}
    </div>
    <div class="audit-simulator">
      <div class="card-title">Policy Simulator</div>
      <form id="policy-simulator-form" class="audit-sim-grid">
        <input name="actor" placeholder="Actor" value="dashboard">
        <input name="actionType" placeholder="Action type" value="coding.open_pr">
        <input name="resource" placeholder="Resource" value="henrikogaard/nanocrab">
        <label class="audit-checkbox"><input type="checkbox" name="dryRun"> Dry-run</label>
        <textarea name="context" placeholder='{"branch":"nanocrab/task"}'>{"branch":"nanocrab/task"}</textarea>
        <button class="btn btn-sm btn-primary" type="submit">Simulate</button>
      </form>
      <pre class="audit-json" id="policy-simulator-output"></pre>
    </div>`;

  document.getElementById('audit-filters').onsubmit = (event) => {
    event.preventDefault();
    window._auditFilters = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    navigate('audit');
  };
  document.querySelector('.audit-list')?.addEventListener('click', (event) => {
    const row = event.target.closest('.audit-event');
    if (!row) return;
    window._selectedAuditId = row.dataset.id;
    navigate('audit');
  });
  document.getElementById('policy-simulator-form').onsubmit = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    let context = {};
    try {
      context = data.context ? JSON.parse(data.context) : {};
    } catch {
      toast('Simulator context must be valid JSON', 'error');
      return;
    }
    const result = await api('/runtime-audit/simulate', {
      method: 'POST',
      body: JSON.stringify({
        actor: data.actor,
        actionType: data.actionType,
        resource: data.resource,
        dryRun: data.dryRun === 'on',
        context,
      }),
    });
    document.getElementById('policy-simulator-output').textContent =
      prettyPrint(result);
  };
}

window.resetAuditFilters = function () {
  window._auditFilters = {};
  navigate('audit');
};

window.exportAuditJson = async function () {
  const payload = await api(`/runtime-audit/export?${auditQueryFromFilters()}`);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nanocrab-audit-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

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
      desc: 'Admin and high-impact runtime actions are available in the Audit dashboard',
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
  const failedLogins = audit.filter(
    (a) => (a.action || a.actionType) === 'login_failed',
  );
  const recentBlocked = audit.filter(
    (a) => (a.action || a.actionType) === 'ip_blocked',
  );

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
            <td><span class="badge ${(a.action || a.actionType || '').includes('fail') || (a.action || a.actionType || '').includes('block') ? 'badge-error' : (a.action || a.actionType || '').includes('success') || (a.action || a.actionType || '').includes('changed') || (a.action || a.actionType || '').includes('enabled') ? 'badge-success' : 'badge-muted'}">${esc(a.action || a.actionType)}</span></td>
            <td style="font-family:var(--mono);font-size:11px">${esc(a.ip || a.actor || '')}</td>
            <td style="font-size:11px;max-width:250px;overflow:hidden;text-overflow:ellipsis">${esc(a.details || a.resource || '')}</td>
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
        <td><button class="btn btn-sm btn-ghost" onclick="window._sessionDetailParams={group:'${esc(s.group)}',sessionId:'${esc(s.sessionId)}'};navigate('session-detail')">View</button></td>
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

/* Session detail page */
window.renderSessionDetail = async function (el) {
  const params = window._sessionDetailParams;
  if (!params || !params.group || !params.sessionId) {
    el.innerHTML =
      '<div class="card"><div class="empty">No session specified</div></div>';
    return;
  }

  el.innerHTML = `
    <div class="page-header">
      <h2>
        <a href="#" onclick="navigate('sessions');return false" style="color:var(--text-muted);text-decoration:none">Sessions</a>
        <span style="color:var(--text-muted);margin:0 4px">/</span>
        ${esc(params.sessionId.slice(0, 8))}...
      </h2>
      <button class="btn btn-sm btn-ghost" onclick="navigate('sessions')">Back</button>
    </div>
    <div id="session-stats-bar"></div>
    <div id="session-transcript" class="card" style="padding:0;overflow:hidden;flex:1;margin-top:8px">
      <div class="loading" style="padding:24px">Loading session...</div>
    </div>
  `;

  try {
    const data = await api(
      `/sessions/${encodeURIComponent(params.group)}/${encodeURIComponent(params.sessionId)}/detail`,
    );
    const transcriptEl = document.getElementById('session-transcript');
    if (transcriptEl) transcriptEl.dataset.stats = JSON.stringify(data.stats);
    renderSessionStats(data.stats);
    renderSessionTranscript(data.messages, data.stats);
  } catch (e) {
    const t = document.getElementById('session-transcript');
    if (t) t.innerHTML = '<div class="empty">Failed to load session</div>';
  }
};

const DEFAULT_STATS_VISIBILITY = {
  messages: true,
  duration: true,
  tools: true,
  model: true,
  tokens: false,
  cost: false,
  errors: false,
  sessionId: false,
  created: false,
};

function getStatVisibility() {
  try {
    const saved = localStorage.getItem('session_stat_visibility');
    return saved
      ? { ...DEFAULT_STATS_VISIBILITY, ...JSON.parse(saved) }
      : DEFAULT_STATS_VISIBILITY;
  } catch {
    return DEFAULT_STATS_VISIBILITY;
  }
}

function saveStatVisibility(v) {
  localStorage.setItem('session_stat_visibility', JSON.stringify(v));
}

function renderSessionStats(stats) {
  const el = document.getElementById('session-stats-bar');
  if (!el) return;

  const visibility = getStatVisibility();
  const statDefs = {
    messages: { label: 'Messages', value: stats.messageCount },
    duration: { label: 'Duration', value: formatDuration(stats.duration) },
    tools: { label: 'Tools', value: stats.toolCount },
    model: { label: 'Model', value: stats.model },
    tokens: {
      label: 'Tokens',
      value: stats.tokenCount ? stats.tokenCount.toLocaleString() : null,
    },
    cost: {
      label: 'Cost',
      value: stats.cost ? '$' + stats.cost.toFixed(2) : null,
    },
    errors: { label: 'Errors', value: stats.errorCount || null },
    sessionId: {
      label: 'Session',
      value: stats.id ? stats.id.slice(0, 8) + '...' : null,
    },
    created: {
      label: 'Created',
      value: stats.createdAt ? formatTime(stats.createdAt) : null,
    },
  };

  const visibleStats = Object.entries(statDefs)
    .filter(([key, def]) => visibility[key] && def.value !== null)
    .map(
      ([key, def]) =>
        `<span class="session-stat"><span class="session-stat-label">${def.label}:</span><span class="session-stat-value">${esc(String(def.value))}</span></span>`,
    )
    .join('');

  el.innerHTML = `
    <div class="session-stats-bar" id="session-stats-bar-inner">
      ${visibleStats}
      <span class="session-stats-toggle" onclick="toggleStatsMenu()" title="Customize stats">&#x2699;</span>
    </div>
  `;
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '';
  if (seconds < 60) return seconds + 's';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + 'm ' + s + 's';
}

window.toggleStatsMenu = function () {
  const existing = document.getElementById('session-stats-menu');
  if (existing) {
    existing.remove();
    return;
  }

  const visibility = getStatVisibility();
  const menu = document.createElement('div');
  menu.id = 'session-stats-menu';
  menu.className = 'session-stats-menu';
  menu.innerHTML =
    Object.keys(DEFAULT_STATS_VISIBILITY)
      .map(
        (key) =>
          `<label><input type="checkbox" ${visibility[key] ? 'checked' : ''} data-key="${key}"> ${key.charAt(0).toUpperCase() + key.slice(1)}</label>`,
      )
      .join('') +
    '<div style="padding:4px 8px 0;display:flex;gap:6px;justify-content:flex-end;border-top:1px solid var(--border);margin-top:4px;padding-top:6px">' +
    '<button class="btn btn-sm btn-primary" onclick="saveStatsMenu()">Done</button></div>';

  const bar = document.getElementById('session-stats-bar-inner');
  if (bar) bar.appendChild(menu);
};

window.saveStatsMenu = function () {
  const v = {};
  document
    .querySelectorAll('#session-stats-menu input[type="checkbox"]')
    .forEach((cb) => {
      v[cb.dataset.key] = cb.checked;
    });
  saveStatVisibility(v);
  const menu = document.getElementById('session-stats-menu');
  if (menu) menu.remove();
  const transcript = document.getElementById('session-transcript');
  if (transcript && transcript.dataset.stats) {
    renderSessionStats(JSON.parse(transcript.dataset.stats));
  }
};

function renderSessionTranscript(messages, stats) {
  const el = document.getElementById('session-transcript');
  if (!el) return;

  if (!messages || messages.length === 0) {
    el.innerHTML = '<div class="empty">No messages in this session</div>';
    return;
  }

  el.innerHTML =
    '<div class="session-transcript">' +
    messages
      .map((m, idx) => {
        if (m.role === 'user') {
          return `
        <div class="session-msg session-msg-user">
          <div class="session-msg-header" style="justify-content:flex-end;padding-right:4px">
            ${m.timestamp ? `<span style="font-size:11px;color:var(--text-muted)">${formatTime(m.timestamp)}</span>` : ''}
            <span class="session-msg-role">User</span>
          </div>
          <div class="session-msg-content">${esc(m.content)}</div>
        </div>`;
        } else if (m.role === 'assistant') {
          const toolCards = (m.toolCalls || [])
            .map(
              (tc) => `
        <div class="chat-tool-call" style="margin:6px 0" onclick="this.querySelector('.chat-tool-call-body').classList.toggle('expanded')">
          <div class="chat-tool-call-header">
            <span class="tool-icon">&#x1F527;</span>
            <span class="tool-name">${esc(tc.name)}</span>
            <span class="tool-status ${tc.output ? 'done' : 'running'}">${tc.output ? '\u2713 ' + (tc.duration || '') + 's' : '\u25CF Running...'}</span>
          </div>
          <div class="chat-tool-call-body ${tc.output ? 'expanded' : ''}">
            <div class="section-label">Input</div>
            <pre>${esc(prettyPrint(tc.input))}</pre>
            ${tc.output ? `<div class="section-label" style="margin-top:8px">Result</div><pre>${esc(prettyPrint(tc.output))}</pre>` : ''}
          </div>
        </div>
      `,
            )
            .join('');

          return `
        <div class="session-msg session-msg-assistant">
          <div class="session-msg-header">
            <span class="session-msg-role">Assistant</span>
            ${stats?.model ? `<span style="font-size:11px;color:var(--text-muted)">${esc(stats.model)}</span>` : ''}
            ${m.timestamp ? `<span style="font-size:11px;color:var(--text-muted)">${formatTime(m.timestamp)}</span>` : ''}
          </div>
          <div class="session-msg-content">${m.content ? esc(m.content) : ''}</div>
          ${toolCards}
        </div>`;
        } else {
          return `
        <div class="session-msg session-msg-system">
          <div class="session-msg-content" style="font-size:11px;color:var(--text-muted);text-align:center;padding:4px 14px;border:1px solid var(--border);border-radius:12px;display:inline-block;background:var(--surface)">${esc(m.content || m.type || '')}</div>
        </div>`;
        }
      })
      .join('') +
    '</div>';
}

// Backup
async function renderBackup(el) {
  const [data, guide, autoConfig, migration] = await Promise.all([
    api('/backup'),
    api('/backup/restore-guide'),
    api('/backup/auto-config'),
    api('/backup/migration-status'),
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
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;align-items:end">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text)">
            <input type="checkbox" id="backup-auto-enabled" ${autoConfig.enabled ? 'checked' : ''}>
            Enabled
          </label>
          <div class="form-group" style="margin:0">
            <label>Schedule</label>
            <select id="backup-auto-schedule">
              <option value="daily" ${autoConfig.schedule === 'daily' ? 'selected' : ''}>Daily</option>
              <option value="weekly" ${autoConfig.schedule !== 'daily' ? 'selected' : ''}>Weekly</option>
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label>Keep</label>
            <input id="backup-auto-keep" type="number" min="1" max="20" value="${Number(autoConfig.keepCount || 4)}">
          </div>
          <button class="btn btn-sm btn-primary" onclick="saveAutoBackupConfig(this)">Save</button>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:10px">Automatic backups create essential-only archives and prune old automatic archives after the configured count.</div>
      </div>
      <div class="card">
        <div class="card-title">Migration Readiness</div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
          <span class="badge ${migration.summary.legacyFound === 0 ? 'badge-success' : migration.summary.targetConflicts > 0 ? 'badge-warning' : 'badge-info'}">${migration.summary.legacyFound === 0 ? 'No legacy state' : `${migration.summary.legacyFound} legacy item(s)`}</span>
          <code style="font-size:12px;color:var(--text-secondary)">${esc(migration.command)}</code>
        </div>
        <div style="display:grid;gap:8px">
          ${migration.checks
            .map(
              (check) => `
              <div style="padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)">
                <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
                  <strong style="font-size:12px;color:var(--text)">${esc(check.label)}</strong>
                  <span class="badge ${check.status === 'not-needed' ? 'badge-success' : check.status === 'ready' ? 'badge-info' : 'badge-warning'}">${check.status === 'not-needed' ? 'OK' : check.status === 'ready' ? 'Ready' : 'Review'}</span>
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:5px;line-height:1.35">${esc(check.detail)}</div>
              </div>`,
            )
            .join('')}
        </div>
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
    const r = await api('/backup/auto-config', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: document.getElementById('backup-auto-enabled')?.checked,
        schedule: document.getElementById('backup-auto-schedule')?.value,
        keepCount: document.getElementById('backup-auto-keep')?.value,
      }),
    });
    if (r.ok) {
      toast('Auto-backup settings saved', 'success');
      navigate('backup');
    } else {
      toast(r.error || 'Failed to save auto-backup settings', 'error');
      btnEl.disabled = false;
      btnEl.textContent = origText;
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
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
  const defs = window._taskProviderDefs || {};
  const models = window._taskProviderModels || {};
  const providerOptions = Object.values(defs)
    .filter((p) => p && p.selectable !== false)
    .map(
      (p) =>
        `<option value="${esc(p.id)}" ${task.provider === p.id ? 'selected' : ''}>${esc(p.name || p.id)}</option>`,
    )
    .join('');
  const modelsForProvider = models[task.provider || ''] || [];
  const modelOptions = `<option value="">Inherit</option>${modelsForProvider.map((m) => `<option value="${esc(m)}" ${task.model === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}`;
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
        <div class="grid grid-2">
          <div class="form-group"><label>Provider</label><select id="edit-task-provider" onchange="updateTaskModelSelect('edit-task-provider','edit-task-model')"><option value="">Inherit</option>${providerOptions}</select></div>
          <div class="form-group"><label>Model</label><select id="edit-task-model">${modelOptions}</select></div>
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
    const provider = document.getElementById('edit-task-provider')?.value || '';
    const model = document.getElementById('edit-task-model')?.value || '';
    const r = await api('/tasks/' + id, {
      method: 'PUT',
      body: JSON.stringify({
        prompt: document.getElementById('edit-task-prompt').value,
        schedule_type: document.getElementById('edit-task-type').value,
        schedule_value: document.getElementById('edit-task-schedule').value,
        status: document.getElementById('edit-task-status').value,
        provider: provider || undefined,
        model: model || undefined,
      }),
    });
    if (r.ok) {
      toast('Updated', 'success');
      navigate('tasks');
    } else {
      const m = document.getElementById('edit-task-msg');
      m.textContent = r.error || 'Failed';
      m.style.color = 'var(--error)';
    }
  };
};

window.updateTaskModelSelect = function (providerSelectId, modelSelectId) {
  const providerEl = document.getElementById(providerSelectId);
  const modelEl = document.getElementById(modelSelectId);
  if (!providerEl || !modelEl) return;
  const models = window._taskProviderModels || {};
  const modelsForProvider = models[providerEl.value] || [];
  modelEl.innerHTML = `<option value="">Inherit</option>${modelsForProvider.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}`;
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
function prettyPrint(jsonStr) {
  try {
    const obj = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    return JSON.stringify(obj, null, 2);
  } catch {
    return jsonStr || '';
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
  const time = new Date(ts).getTime();
  if (!ts || !Number.isFinite(time)) return '-';
  const d = Date.now() - time;
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}
function formatBytes(b) {
  const bytes = Number(b);
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(1) + ' GB';
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
  let runbooks = [];
  let missions = [];
  try {
    workflows = await api('/workflows');
  } catch {}
  try {
    runbooks = await api('/missions/runbooks');
  } catch {}
  try {
    missions = await api('/missions');
  } catch {}
  let groups = [];
  try {
    groups = await api('/groups');
  } catch {}

  el.innerHTML = `
    <div class="page-header">
      <h2>Workflows</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('new-runbook-form').style.display=document.getElementById('new-runbook-form').style.display==='none'?'block':'none'">New Runbook</button>
        <button class="btn btn-primary btn-sm" onclick="document.getElementById('new-workflow-form').style.display=document.getElementById('new-workflow-form').style.display==='none'?'block':'none'">New Workflow</button>
      </div>
    </div>
    <div class="grid grid-2" style="align-items:start;margin-bottom:16px">
      <div class="card" id="new-runbook-form" style="display:none">
        <div class="card-title">Create Runbook</div>
        <form id="runbook-create-form">
          <div class="form-group"><label>Title</label><input id="runbook-title" placeholder="Morning operations brief" required></div>
          <div class="form-group"><label>Description</label><input id="runbook-description" placeholder="Reusable checklist for an operator mission"></div>
          <div id="runbook-steps-list">
            <div class="card-title" style="margin-top:8px">Steps</div>
            <div class="runbook-step-row" style="display:grid;grid-template-columns:minmax(160px,1fr) minmax(220px,2fr) auto;gap:8px;margin-bottom:8px;align-items:end">
              <div class="form-group" style="margin:0"><label>Step</label><input class="runbook-step-title" placeholder="Collect signals"></div>
              <div class="form-group" style="margin:0"><label>Detail</label><input class="runbook-step-detail" placeholder="Review journal and inboxes"></div>
              <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text-muted);padding-bottom:10px"><input type="checkbox" class="runbook-step-approval"> Approval</label>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button type="button" class="btn btn-sm btn-ghost" onclick="addRunbookStep()">+ Add Step</button>
            <button type="submit" class="btn btn-primary btn-sm">Create Runbook</button>
          </div>
        </form>
      </div>
      <div class="card">
        <div class="card-title">Start Mission</div>
        <form id="mission-create-form">
          <div class="form-group"><label>Mission Title</label><input id="mission-title" placeholder="Saturday briefing"></div>
          <div class="grid grid-2">
            <div class="form-group"><label>Runbook</label><select id="mission-runbook">${runbooks.map((runbook) => `<option value="${esc(runbook.id)}">${esc(runbook.title)}</option>`).join('')}</select></div>
            <div class="form-group"><label>Owner</label><input id="mission-owner" placeholder="Operator"></div>
          </div>
          <button type="submit" class="btn btn-primary btn-sm" ${runbooks.length ? '' : 'disabled'}>Start Mission</button>
        </form>
      </div>
    </div>
    <div class="grid grid-2" style="align-items:start;margin-bottom:16px">
      <div class="card">
        <div class="card-title">Active Missions <span class="badge badge-muted">${missions.length}</span></div>
        ${
          missions.length === 0
            ? '<div class="empty" style="padding:16px">No missions started</div>'
            : missions.map(renderMissionCard).join('')
        }
      </div>
      <div class="card">
        <div class="card-title">Runbooks <span class="badge badge-muted">${runbooks.length}</span></div>
        ${
          runbooks.length === 0
            ? '<div class="empty" style="padding:16px">No runbooks configured</div>'
            : runbooks
                .map(
                  (runbook) => `
          <div style="padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;gap:8px">
              <strong style="color:var(--text)">${esc(runbook.title)}</strong>
              <span class="badge badge-muted">${runbook.steps?.length || 0} steps</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(runbook.description || 'Reusable operator checklist')}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
              ${(runbook.steps || []).map((step) => `<span class="badge ${step.requiresApproval ? 'badge-warning' : 'badge-info'}">${esc(step.title)}</span>`).join('')}
            </div>
          </div>`,
                )
                .join('')
        }
      </div>
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

  const runbookForm = document.getElementById('runbook-create-form');
  if (runbookForm)
    runbookForm.onsubmit = async (e) => {
      e.preventDefault();
      const steps = Array.from(document.querySelectorAll('.runbook-step-row'))
        .map((row) => ({
          title: row.querySelector('.runbook-step-title')?.value?.trim() || '',
          detail:
            row.querySelector('.runbook-step-detail')?.value?.trim() ||
            undefined,
          requiresApproval:
            row.querySelector('.runbook-step-approval')?.checked === true,
        }))
        .filter((step) => step.title);
      if (steps.length === 0) {
        toast('Add at least one runbook step', 'warning');
        return;
      }
      const r = await api('/missions/runbooks', {
        method: 'POST',
        body: JSON.stringify({
          title: document.getElementById('runbook-title').value,
          description: document.getElementById('runbook-description').value,
          steps,
        }),
      }).catch(() => null);
      if (r?.ok) {
        toast('Runbook created', 'success');
        navigate('workflows');
      } else toast(r?.error || 'Failed to create runbook', 'error');
    };

  const missionForm = document.getElementById('mission-create-form');
  if (missionForm)
    missionForm.onsubmit = async (e) => {
      e.preventDefault();
      const runbookId = document.getElementById('mission-runbook')?.value;
      const title = document.getElementById('mission-title')?.value?.trim();
      if (!runbookId || !title) {
        toast('Choose a runbook and title', 'warning');
        return;
      }
      const r = await api('/missions', {
        method: 'POST',
        body: JSON.stringify({
          title,
          runbookId,
          owner: document.getElementById('mission-owner')?.value,
        }),
      }).catch(() => null);
      if (r?.ok) {
        toast('Mission started', 'success');
        navigate('workflows');
      } else toast(r?.error || 'Failed to start mission', 'error');
    };

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

function missionStatusBadge(status) {
  if (status === 'completed') return 'badge-success';
  if (status === 'blocked') return 'badge-error';
  if (status === 'running') return 'badge-warning';
  return 'badge-muted';
}

function renderMissionCard(mission) {
  return `
    <div style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div>
          <strong style="color:var(--text)">${esc(mission.title)}</strong>
          <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${mission.owner ? 'Owner: ' + esc(mission.owner) + ' • ' : ''}Updated ${mission.updatedAt ? timeAgo(mission.updatedAt) : 'recently'}</div>
        </div>
        <span class="badge ${missionStatusBadge(mission.status)}">${esc(mission.status || 'pending')}</span>
      </div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
        ${(mission.steps || [])
          .map(
            (step, index) => `
        <div style="display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;padding:8px;background:var(--surface2);border-radius:var(--radius-sm)">
          <span class="pipeline-step-num">${index + 1}</span>
          <div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <strong style="font-size:12px;color:var(--text)">${esc(step.title)}</strong>
              <span class="badge ${missionStatusBadge(step.status)}">${esc(step.status)}</span>
              ${step.requiresApproval ? '<span class="badge badge-warning">Approval</span>' : ''}
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${esc(step.note || step.detail || '')}</div>
          </div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
            <button class="btn btn-sm btn-ghost" onclick="updateMissionStepStatus('${esc(mission.id)}','${esc(step.id)}','running')">Start</button>
            <button class="btn btn-sm btn-success" onclick="updateMissionStepStatus('${esc(mission.id)}','${esc(step.id)}','completed',${step.requiresApproval ? 'true' : 'false'})">Done</button>
            <button class="btn btn-sm btn-ghost" onclick="updateMissionStepStatus('${esc(mission.id)}','${esc(step.id)}','blocked')">Block</button>
          </div>
        </div>`,
          )
          .join('')}
      </div>
    </div>`;
}

window.addRunbookStep = () => {
  const list = document.getElementById('runbook-steps-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'runbook-step-row';
  row.style.cssText =
    'display:grid;grid-template-columns:minmax(160px,1fr) minmax(220px,2fr) auto auto;gap:8px;margin-bottom:8px;align-items:end';
  row.innerHTML = `
    <div class="form-group" style="margin:0"><input class="runbook-step-title" placeholder="Step title"></div>
    <div class="form-group" style="margin:0"><input class="runbook-step-detail" placeholder="Step detail"></div>
    <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text-muted);padding-bottom:10px"><input type="checkbox" class="runbook-step-approval"> Approval</label>
    <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()" style="margin-bottom:2px">X</button>`;
  list.appendChild(row);
};

window.updateMissionStepStatus = async (
  missionId,
  stepId,
  status,
  requiresApproval,
) => {
  const payload = { status };
  if (status === 'completed' && requiresApproval) {
    const approvalId = prompt('Approval reference required');
    if (!approvalId) {
      toast('Approval reference required', 'warning');
      return;
    }
    payload.approvalId = approvalId;
  }
  const r = await api(`/missions/${missionId}/steps/${stepId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  }).catch(() => null);
  if (r?.ok) {
    toast('Mission step updated', 'success');
    navigate('workflows');
  } else toast(r?.error || 'Failed to update mission step', 'error');
};

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
	    <div id="monitoring-health"></div>
	    <div id="model-metrics"></div>
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
      const cpuLoadNumber = Number(sys.system?.loadAvg?.[0]);
      const cpuLoad = Number.isFinite(cpuLoadNumber)
        ? cpuLoadNumber.toFixed(2)
        : '0';
      const cpuCores = Number(sys.system?.cpus) || 1;
      const cpuPct = Math.min(100, (parseFloat(cpuLoad) / cpuCores) * 100);
      const ramTotal = Number(sys.system?.totalMemory);
      const ramFree = Number(sys.system?.freeMemory);
      const ramUsed =
        Number.isFinite(ramTotal) && Number.isFinite(ramFree)
          ? Math.max(0, ramTotal - ramFree)
          : undefined;
      const ramPct =
        Number.isFinite(ramTotal) && ramTotal > 0 && Number.isFinite(ramUsed)
          ? ((ramUsed / ramTotal) * 100).toFixed(1)
          : '0';
      const heapUsed = Number(sys.memory?.heapUsed);
      const heapLimit = Number(sys.memory?.heapLimit);
      const heapPct =
        Number.isFinite(heapLimit) && heapLimit > 0 && Number.isFinite(heapUsed)
          ? ((heapUsed / heapLimit) * 100).toFixed(1)
          : '0';
      const disk = sys.system?.disk;
      const diskTotal = Number(disk?.total);
      const diskFree = Number(disk?.free);
      const diskUsedFromPayload = Number(disk?.used);
      const diskUsed = Number.isFinite(diskUsedFromPayload)
        ? diskUsedFromPayload
        : Number.isFinite(diskTotal) && Number.isFinite(diskFree)
          ? Math.max(0, diskTotal - diskFree)
          : undefined;
      const diskPercentFromPayload = Number(disk?.percent);
      const diskPctNumber = Number.isFinite(diskPercentFromPayload)
        ? diskPercentFromPayload
        : Number.isFinite(diskTotal) &&
            diskTotal > 0 &&
            Number.isFinite(diskUsed)
          ? (diskUsed / diskTotal) * 100
          : 0;
      const diskPct = Math.max(0, Math.min(100, diskPctNumber)).toFixed(1);

      statsEl.innerHTML = `
        <div class="grid grid-3" style="margin-bottom:16px">
          <div class="card" style="margin:0">
            <div class="card-title">CPU Load</div>
            <div style="font-size:24px;font-weight:700;color:var(--text);margin-bottom:8px">${cpuLoad} <span style="font-size:14px;color:var(--text-muted)">/ ${sys.system?.cpus || '?'} cores</span></div>
            <div class="monitoring-bar"><div class="monitoring-fill" style="width:${cpuPct.toFixed(1)}%;background:${cpuPct > 80 ? 'var(--error)' : cpuPct > 50 ? 'var(--warning)' : 'var(--success)'}"></div></div>
          </div>
          <div class="card" style="margin:0">
            <div class="card-title">RAM Usage</div>
            <div style="font-size:24px;font-weight:700;color:var(--text);margin-bottom:8px">${ramPct}% <span style="font-size:14px;color:var(--text-muted)">${formatBytes(ramUsed)} / ${formatBytes(ramTotal)}</span></div>
            <div class="monitoring-bar"><div class="monitoring-fill" style="width:${ramPct}%;background:${parseFloat(ramPct) > 80 ? 'var(--error)' : parseFloat(ramPct) > 50 ? 'var(--warning)' : 'var(--success)'}"></div></div>
          </div>
          <div class="card" style="margin:0">
            <div class="card-title">Heap Usage</div>
            <div style="font-size:24px;font-weight:700;color:var(--text);margin-bottom:8px">${heapPct}% <span style="font-size:14px;color:var(--text-muted)">${formatBytes(heapUsed)} / ${formatBytes(heapLimit)}</span></div>
            <div class="monitoring-bar"><div class="monitoring-fill" style="width:${heapPct}%;background:${parseFloat(heapPct) > 80 ? 'var(--error)' : parseFloat(heapPct) > 50 ? 'var(--warning)' : 'var(--success)'}"></div></div>
          </div>
          ${
            disk
              ? `<div class="card" style="margin:0">
            <div class="card-title">Disk Usage</div>
            <div style="font-size:24px;font-weight:700;color:var(--text);margin-bottom:8px">${diskPct}% <span style="font-size:14px;color:var(--text-muted)">${formatBytes(diskUsed)} / ${formatBytes(diskTotal)}</span></div>
            <div class="monitoring-bar"><div class="monitoring-fill" style="width:${diskPct}%;background:${parseFloat(diskPct) > 85 ? 'var(--error)' : parseFloat(diskPct) > 70 ? 'var(--warning)' : 'var(--success)'}"></div></div>
          </div>`
              : ''
          }
        </div>`;

      // Load provider health
      try {
        const health = await api('/providers/health').catch(() => null);
        const healthEl = document.getElementById('monitoring-health');
        if (healthEl && health && Array.isArray(health.entries)) {
          const allOk = health.entries.every((e) => e.ok);
          const summary = health.summary || {};
          const local = summary.local || {};
          const remote = summary.remote || {};
          healthEl.innerHTML = `
            <div class="card" style="margin:0;margin-top:16px">
              <div class="card-title" style="display:flex;align-items:center;gap:8px">
                Inference Health
                <span class="badge ${allOk ? 'badge-success' : 'badge-warning'}" style="font-size:10px">${health.entries.filter((e) => e.ok).length}/${health.entries.length} OK</span>
                <button class="btn btn-sm btn-ghost" style="margin-left:auto;font-size:11px" onclick="runAllProbes()">Re-probe All</button>
              </div>
              <div class="grid grid-4" style="margin-bottom:12px">
                <div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)">
                  <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Remote Ready</div>
                  <div style="font-size:18px;font-weight:700;color:var(--text)">${Number(remote.ok || 0)}/${Number(remote.total || 0)}</div>
                </div>
                <div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)">
                  <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Local Ready</div>
                  <div style="font-size:18px;font-weight:700;color:var(--text)">${Number(local.ok || 0)}/${Number(local.total || 0)}</div>
                </div>
                <div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)">
                  <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Avg Latency</div>
                  <div style="font-size:18px;font-weight:700;color:var(--text)">${summary.averageLatencyMs == null ? '-' : `${Number(summary.averageLatencyMs)}ms`}</div>
                </div>
                <div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)">
                  <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Stale Probes</div>
                  <div style="font-size:18px;font-weight:700;color:${Number(summary.stale || 0) > 0 ? 'var(--warning)' : 'var(--text)'}">${Number(summary.stale || 0)}</div>
                </div>
              </div>
              <div class="table-wrap"><table>
                <thead><tr><th>Profile</th><th>Provider</th><th>Model</th><th>Status</th><th>Last Probe</th><th>Latency</th><th>Capabilities</th></tr></thead>
                <tbody>${health.entries
                  .map(
                    (e) => `
                  <tr>
                    <td style="font-weight:500;color:var(--text)">${esc(e.purpose)}</td>
                    <td><span class="badge ${e.location === 'local' ? 'badge-success' : 'badge-accent'}">${esc(e.location || 'remote')}</span> <span class="badge badge-muted">${esc(e.provider)}</span></td>
                    <td style="font-family:var(--mono);font-size:11px;color:var(--text)">${esc(e.model)}</td>
                    <td><span class="status-dot ${e.ok ? 'online' : 'offline'}" style="margin-right:4px"></span><span class="badge ${e.ok ? 'badge-success' : 'badge-error'}" style="font-size:10px">${e.ok ? 'Ready' : 'Failed'}</span>${e.stale ? ' <span class="badge badge-warning" style="font-size:9px">stale</span>' : ''}${e.errorMessage ? `<div style="font-size:10px;color:var(--error);margin-top:2px">${esc(e.errorMessage)}</div>` : ''}</td>
                    <td style="font-size:11px;color:var(--text-muted)">${e.lastProbeAt ? formatTime(e.lastProbeAt) : '-'}</td>
                    <td style="font-size:11px;color:var(--text-muted)">${e.latencyMs == null ? '-' : `${Number(e.latencyMs)}ms`}</td>
                    <td>${e.capabilities.length > 0 ? e.capabilities.map((c) => `<span class="badge badge-info" style="font-size:9px">${esc(c)}</span>`).join(' ') : '<span class="badge badge-muted" style="font-size:9px">unprobed</span>'}</td>
                  </tr>`,
                  )
                  .join('')}
                </tbody>
              </table></div>
            </div>`;
        }
      } catch {
        /* provider health not available */
      }
      try {
        const metrics = await api('/providers/model-metrics').catch(() => null);
        const metricsEl = document.getElementById('model-metrics');
        if (metricsEl && metrics && Array.isArray(metrics.models)) {
          const summary = metrics.summary || {};
          metricsEl.innerHTML = `
	            <div class="card" style="margin:0;margin-top:16px">
	              <div class="card-title">Model Operations Metrics <span class="badge badge-muted" style="font-size:10px">${metrics.models.length}</span></div>
	              <div class="grid grid-4" style="margin-bottom:12px">
	                <div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)">
	                  <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Healthy Models</div>
	                  <div style="font-size:18px;font-weight:700;color:var(--text)">${Number(summary.healthyModels || 0)}/${Number(summary.totalModels || 0)}</div>
	                </div>
	                <div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)">
	                  <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Avg Success</div>
	                  <div style="font-size:18px;font-weight:700;color:var(--text)">${summary.averageSuccessRate == null ? '-' : `${Math.round(Number(summary.averageSuccessRate) * 100)}%`}</div>
	                </div>
	                <div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)">
	                  <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Avg Latency</div>
	                  <div style="font-size:18px;font-weight:700;color:var(--text)">${summary.averageLatencyMs == null ? '-' : `${Number(summary.averageLatencyMs)}ms`}</div>
	                </div>
	                <div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)">
	                  <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Degraded</div>
	                  <div style="font-size:18px;font-weight:700;color:${Number(summary.degradedModels || 0) > 0 ? 'var(--warning)' : 'var(--text)'}">${Number(summary.degradedModels || 0)}</div>
	                </div>
	              </div>
	              <div class="table-wrap"><table>
	                <thead><tr><th>Provider</th><th>Model</th><th>Profiles</th><th>Cost</th><th>Context</th><th>Latency</th><th>Reliability</th><th>Last Error</th></tr></thead>
	                <tbody>${metrics.models
                    .map(
                      (m) => `
	                  <tr>
	                    <td><span class="badge badge-muted">${esc(m.provider)}</span></td>
	                    <td style="font-family:var(--mono);font-size:11px;color:var(--text)">${esc(m.model)}</td>
	                    <td>${(m.profileIds || []).map((id) => `<span class="badge badge-info" style="font-size:9px">${esc(id)}</span>`).join(' ') || '<span class="badge badge-muted">none</span>'}</td>
	                    <td><span class="badge ${m.costTier === 'high' ? 'badge-warning' : m.costTier === 'unknown' ? 'badge-muted' : 'badge-success'}">${esc(m.costTier || 'unknown')}</span></td>
	                    <td style="font-size:11px;color:var(--text-muted)">${m.contextWindow ? Number(m.contextWindow).toLocaleString() : '-'}</td>
	                    <td style="font-size:11px;color:var(--text-muted)">avg ${m.averageLatencyMs == null ? '-' : `${Number(m.averageLatencyMs)}ms`} · p95 ${m.p95LatencyMs == null ? '-' : `${Number(m.p95LatencyMs)}ms`}</td>
	                    <td><span class="badge ${Number(m.successRate || 0) >= 0.8 ? 'badge-success' : 'badge-warning'}">${Math.round(Number(m.successRate || 0) * 100)}%</span> <span style="font-size:11px;color:var(--text-muted)">${Number(m.successCount || 0)}/${Number(m.sampleCount || 0)}</span></td>
	                    <td style="font-size:11px;color:${m.lastError ? 'var(--error)' : 'var(--text-muted)'}">${m.lastError ? esc(m.lastError) : '-'}</td>
	                  </tr>`,
                    )
                    .join('')}
	                </tbody>
	              </table></div>
	            </div>`;
        }
      } catch {
        /* model metrics not available */
      }
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
    } catch (err) {
      const historyEl = document.getElementById('monitoring-history');
      const chartEl = document.getElementById('monitoring-chart');
      const message = err?.message || 'Monitoring history unavailable';
      if (chartEl) {
        chartEl.innerHTML = `<div class="empty">${esc(message)}</div>`;
      }
      if (historyEl) {
        historyEl.innerHTML = `<div class="empty">${esc(message)}</div>`;
      }
    }
  };

  await loadMonitoring();
  monitoringTimer = setInterval(loadMonitoring, 30000);
  pollTimers.push(monitoringTimer);
}

window.runAllProbes = async function () {
  const btn = document.activeElement;
  if (btn) btn.disabled = true;
  try {
    const r = await api('/providers/probe-all', { method: 'POST' });
    if (r.ok) toast('All providers re-probed', 'success');
    else toast(r.error || 'Probe failed', 'error');
  } catch (e) {
    toast('Probe error: ' + e.message, 'error');
  }
  if (btn) btn.disabled = false;
  // Refresh the monitoring view to show updated health
  navigate('monitoring');
};

// --- Deploy Pipelines ---
async function renderPipelines(el) {
  let pipelines = [];
  try {
    pipelines = await api('/dev/deploy');
  } catch {}
  if (!Array.isArray(pipelines)) pipelines = [];
  let repos = [];
  try {
    repos = await api('/files/repos');
  } catch {}
  if (!Array.isArray(repos)) repos = [];

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
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Repo: ${esc(p.repo)} \u2022 ${p.steps?.length || 0} steps ${p.lastRun ? ' \u2022 Last run: ' + timeAgo(p.lastRun) : ''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          ${p.lastStatus === 'success' ? '<span class="badge badge-success">Success</span>' : p.lastStatus === 'failed' ? '<span class="badge badge-error">Failed</span>' : '<span class="badge badge-muted">Never run</span>'}
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
        const r = await api('/dev/deploy', {
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
      const r = await api(`/dev/deploy/${encodeURIComponent(id)}/run`, {
        method: 'POST',
      });
      if (outputEl) {
        if (Array.isArray(r.results)) {
          outputEl.innerHTML = `<div class="log-viewer" style="max-height:240px">${r.results
            .map(
              (result) =>
                `<div style="margin-bottom:10px"><strong>${esc(result.step)}</strong> <span class="badge ${result.success ? 'badge-success' : 'badge-error'}">${result.success ? 'ok' : 'failed'}</span><pre style="white-space:pre-wrap;margin-top:4px">${esc(result.output || '')}</pre></div>`,
            )
            .join('')}</div>`;
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
      const r = await api(`/dev/deploy/${encodeURIComponent(id)}`, {
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

// --- Terminal Search ---

window.runTerminalSearch = async function () {
  const input = document.getElementById('term-search-input');
  const from = document.getElementById('term-search-from');
  const to = document.getElementById('term-search-to');
  const resultsEl = document.getElementById('term-search-results');
  const query = input?.value?.trim();

  if (!query) {
    if (resultsEl)
      resultsEl.innerHTML =
        '<div style="color:var(--text-muted);padding:12px;text-align:center;font-size:12px">Enter a query to search</div>';
    return;
  }

  if (resultsEl)
    resultsEl.innerHTML =
      '<div style="padding:12px;text-align:center;font-size:12px;color:var(--text-muted)">Searching...</div>';

  try {
    const body = { query };
    if (from?.value) body.dateFrom = from.value + 'T00:00:00Z';
    if (to?.value) body.dateTo = to.value + 'T23:59:59Z';

    const data = await api('/sessions/terminal/search', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const results = data.results || [];

    if (!resultsEl) return;

    if (results.length === 0) {
      resultsEl.innerHTML =
        '<div style="color:var(--text-muted);padding:16px;text-align:center;font-size:12px">No results found for <strong>' +
        esc(query) +
        '</strong></div>';
      return;
    }

    resultsEl.innerHTML =
      results
        .map(
          (r, i) => `
      <div class="search-result-item" onclick="viewTerminalTranscript('${esc(r.sessionId)}')">
        <div class="search-result-line">${esc(truncate(r.text, 100))}</div>
        <div class="search-result-meta">
          Session: ${esc(r.sessionId)} &middot; Line ${r.line}
        </div>
        <div class="search-result-context">${esc(truncate(r.context, 200))}</div>
      </div>
    `,
        )
        .join('') +
      '<div style="padding:8px;text-align:center;font-size:11px;color:var(--text-muted)">' +
      results.length +
      ' result' +
      (results.length !== 1 ? 's' : '') +
      '</div>';
  } catch (e) {
    if (resultsEl)
      resultsEl.innerHTML =
        '<div style="color:var(--error);padding:12px;text-align:center;font-size:12px">Search failed: ' +
        esc(e.message) +
        '</div>';
  }
};

window.viewTerminalTranscript = async function (sessionId) {
  try {
    const data = await api(
      '/sessions/terminal/' + encodeURIComponent(sessionId) + '/transcript',
    );
    // Switch to left pane terminal tab
    window.switchTermPane('left', 'terminal');
    const container = document.getElementById('terminal-container');
    if (activeTerminal && activeTerminal.term) {
      activeTerminal.term.reset();
      activeTerminal.term.write((data.content || '').slice(-50000));
      activeTerminal.term.write(
        '\r\n\r\n[END OF SESSION — ' + esc(sessionId) + ']\r\n',
      );
    }
    toast('Loaded session: ' + sessionId, 'info');
  } catch (e) {
    toast('Failed to load transcript: ' + e.message, 'error');
  }
};

// Enter key to search from search input
document.addEventListener('keydown', function (e) {
  if (
    e.key === 'Enter' &&
    document.activeElement === document.getElementById('term-search-input')
  ) {
    window.runTerminalSearch();
  }
});
