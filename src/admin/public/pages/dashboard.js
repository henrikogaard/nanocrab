// NanoCrab Admin - Dashboard Page

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
      const [d, cockpitData] = await Promise.all([
        api('/system/dashboard'),
        api('/sessions/cockpit').catch(() => []),
      ]);
      const channels = Array.isArray(d.channels) ? d.channels : [];
      const containers = Array.isArray(d.containers) ? d.containers : [];
      const groups = Array.isArray(d.groups) ? d.groups : [];
      const messages = Array.isArray(d.messages) ? d.messages : [];
      const cockpitSessions = Array.isArray(cockpitData) ? cockpitData : [];
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
      const wVis = (id) => (hiddenWidgets.includes(id) ? 'display:none' : '');
      const wBtn = (id) =>
        `<button class="widget-hide-btn dash-widget-hide" data-widget="${id}" onclick="hideWidget('${id}')" style="display:none" aria-label="Hide widget">x</button>`;

      const metricItems = [
        {
          label: 'Uptime',
          value: d.uptimeFormatted || '-',
          detail: 'Current process',
        },
        {
          label: 'Channels',
          value: `${onlineCh}/${totalCh}`,
          detail: `${healthScore}% online`,
        },
        {
          label: 'Agents',
          value: containers.length,
          detail: `${groups.length} registered`,
        },
        {
          label: 'Today',
          value: todayMsgs,
          detail: `${conversationCount} threads`,
        },
        {
          label: 'Failed',
          value: failedLogins,
          detail: 'Login attempts',
          tone: failedLogins > 0 ? 'warn' : 'good',
          action: "navigate('security')",
        },
        {
          label: 'Blocked',
          value: blockedIps,
          detail: 'IP addresses',
          tone: blockedIps > 0 ? 'bad' : 'good',
          action: "navigate('security')",
        },
      ];

      const quickActions = [
        ['Terminal', 'Open shell', "navigate('devhub')"],
        ['Editor', 'Work files', "navigate('gitcode')"],
        ['Logs', 'Inspect events', "navigate('monitoring')"],
        ['Messages', 'Review chat', "navigate('messages')"],
        ['Security', 'Check access', "navigate('security')"],
        ['Usage', 'Track spend', "navigate('usage')"],
        ['Restart', 'Confirm service', 'restartService(this)'],
      ];

      const featureActions = [
        ['Operation Schedules', 'Create group reminders', "navigate('tasks')"],
        ['Model Metrics', 'Latency and reliability', "navigate('monitoring')"],
        ['Connector Catalog', 'Setup and permissions', "navigate('integrations')"],
        ['Assistant Profile', 'Avatar and identity', "navigate('settings')"],
        ['Assign Work', 'Tasks, issues, auto-pickup', "navigate('agents')"],
        ['Connector Skills', 'Review enabled skills', "navigate('skills')"],
      ];

      const channelRows =
        channels
          .map((ch, index) => {
            const status = ch.connected ? 'online' : 'offline';
            return `
              <div class="dash-line-item dash-reveal" style="--i:${index}">
                <div class="dash-line-main">
                  <span class="status-dot ${status}"></span>
                  <span class="dash-line-title">${esc(ch.name || 'channel')}</span>
                </div>
                <span class="dash-pill ${ch.connected ? 'is-good' : 'is-bad'}">${ch.connected ? 'On' : 'Off'}</span>
              </div>`;
          })
          .join('') ||
        '<div class="dash-empty">No channels configured yet.</div>';

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
              <div class="dash-agent-row dash-reveal" style="--i:${index}">
                <div>
                  <div class="dash-line-title">${esc(g.name || g.folder || 'Group')}</div>
                  <div class="dash-line-sub">${esc(channel)} channel</div>
                </div>
                <span class="dash-pill ${isActive ? 'is-good' : 'is-idle'}">${isActive ? 'Active' : 'Idle'}</span>
              </div>`;
          })
          .join('') ||
        '<div class="dash-empty">No registered agents yet.</div>';

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
              <div class="dash-activity-row dash-reveal" style="--i:${index}">
                <div class="dash-activity-index">${String(index + 1).padStart(2, '0')}</div>
                <div>
                  <div class="dash-line-title">${esc(c.groupFolder || c.groupJid || 'agent')}</div>
                  <div class="dash-line-sub">${c.isTask ? 'Scheduled task' : 'Interactive'} for ${durStr}</div>
                </div>
                <span class="dash-pill ${c.idleWaiting ? 'is-idle' : 'is-good'}">${state}</span>
              </div>`;
          })
          .join('') ||
        '<div class="dash-empty">No active agents. Launch one from Agents.</div>';

      const responseRows =
        botResponses
          .slice(0, 4)
          .map(
            (m, index) => `
              <div class="dash-response-row dash-reveal" style="--i:${index}">
                <span>${esc(m.sender_name || 'Bot')}</span>
                <time>${timeAgo(m.timestamp)}</time>
                <p>${esc(truncate(m.content || '', 92))}</p>
              </div>`,
          )
          .join('') || '<div class="dash-empty">No recent bot responses.</div>';

      const feedRows =
        messages
          .slice(0, 9)
          .map(
            (m, index) => `
              <div class="dash-feed-item ${m.is_bot_message ? 'is-bot' : ''} dash-reveal" style="--i:${index}">
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
        '<div class="dash-empty">No messages in the current sample.</div>';

      const actionRows = quickActions
        .map(
          ([label, detail, action], index) => `
            <button class="dash-action dash-reveal" style="--i:${index}" onclick="${action}">
              <span class="dash-action-mark"></span>
              <span>
                <strong>${label}</strong>
                <small>${detail}</small>
              </span>
            </button>`,
        )
        .join('');
      const featureRows = featureActions
        .map(
          ([label, detail, action], index) => `
            <button class="dash-action dash-feature-action dash-reveal" style="--i:${index}" onclick="${action}">
              <span class="dash-action-mark"></span>
              <span>
                <strong>${label}</strong>
                <small>${detail}</small>
              </span>
            </button>`,
        )
        .join('');

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
        '<div class="dash-empty">No agent runs captured yet.</div>';
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

      const latestCopy = latestMessage
        ? `${esc(latestMessage.sender_name || 'Latest')}: ${esc(truncate(latestMessage.content || '', 130))}`
        : 'No recent conversation activity.';
      const humanCopy =
        humanMessages.length > 0
          ? `${humanMessages.length} member messages in the current window`
          : 'No member messages in this window';

      el.innerHTML = `
        <div class="dashboard-shell">
          <div class="dashboard-toolbar">
            <div>
              <div class="dash-kicker">Command surface</div>
              <h2>${esc(botName)}</h2>
              <p>${humanCopy}. ${securityState} security posture.</p>
            </div>
            <div class="dashboard-toolbar-actions">
              <button class="btn btn-sm btn-ghost" id="dashboard-customize-btn" onclick="toggleDashboardEditMode()">Customize</button>
              <button class="btn btn-sm btn-ghost" id="dashboard-reset-btn" onclick="resetDashboardWidgets()" style="${hiddenWidgets.length > 0 ? '' : 'display:none'}">Reset</button>
            </div>
          </div>

          <section class="dash-hero dashboard-widget" data-widget-id="stats" style="${wVis('stats')}">
            ${wBtn('stats')}
            <div class="dash-hero-media" aria-hidden="true">
              <img src="/static/banner.png" alt="" onerror="this.style.display='none'">
            </div>
            <div class="dash-hero-content">
              <div class="dash-kicker">Live operations</div>
              <h3>${esc(window._editionShort || 'NanoCrab')} control room</h3>
              <p>${latestCopy}</p>
              <div class="dash-channel-ribbon">
                ${channels
                  .map(
                    (ch) => `
                      <span class="dash-channel-chip">
                        <span class="status-dot ${ch.connected ? 'online' : 'offline'}"></span>
                        ${esc(ch.name || 'channel')}
                      </span>`,
                  )
                  .join('')}
              </div>
            </div>
            <div class="dash-hero-status">
              <span class="dash-live-badge"><span class="live-dot"></span> Live</span>
              ${alertCount > 0 ? `<span class="dash-pill is-bad">${alertCount} alerts</span>` : ''}
              ${failedLogins > 0 ? `<span class="dash-pill is-warn">${failedLogins} failed logins</span>` : ''}
              ${blockedIps > 0 ? `<span class="dash-pill is-bad">${blockedIps} blocked</span>` : ''}
              ${unregCount > 0 ? `<span class="dash-pill is-muted">${unregCount} unregistered</span>` : ''}
            </div>
          </section>

          <section class="dash-metric-rail dashboard-widget" data-widget-id="security" style="${wVis('security')}">
            ${wBtn('security')}
            ${metricItems
              .map(
                (item, index) => `
                  <button class="dash-metric ${item.tone ? `is-${item.tone}` : ''} dash-reveal" style="--i:${index}" ${item.action ? `onclick="${item.action}"` : 'disabled'}>
                    <span>${item.label}</span>
                    <strong>${esc(String(item.value))}</strong>
                    <small>${item.detail}</small>
                  </button>`,
              )
              .join('')}
          </section>

          <div class="dash-bento">
            <section class="dash-panel dash-panel-cockpit dashboard-widget" data-widget-id="cockpit" style="${wVis('cockpit')}">
              ${wBtn('cockpit')}
              <div class="dash-panel-header">
                <div>
                  <span class="dash-kicker">Cockpit</span>
                  <h3><span class="live-dot" style="${cockpitCounts.active > 0 ? '' : 'display:none'}"></span> Agent runs</h3>
                </div>
                <div class="cockpit-status-strip">
                  <span class="dash-pill is-good">${cockpitCounts.active} active</span>
                  <span class="dash-pill ${cockpitCounts.waiting > 0 ? 'is-warn' : 'is-muted'}">${cockpitCounts.waiting} approvals</span>
                  <span class="dash-pill ${cockpitCounts.failed > 0 ? 'is-bad' : 'is-muted'}">${cockpitCounts.failed} failed</span>
                </div>
              </div>
              <div class="cockpit-grid">
                <div class="cockpit-list" id="cockpit-session-list">${cockpitRows}</div>
                <div class="cockpit-detail" id="cockpit-detail">
                  ${renderCockpitDetailShell(selectedCockpit)}
                </div>
              </div>
            </section>

            <section class="dash-panel dash-panel-channels dashboard-widget" data-widget-id="channels" style="${wVis('channels')}">
              ${wBtn('channels')}
              <div class="dash-panel-header">
                <div>
                  <span class="dash-kicker">Channels</span>
                  <h3>Signal map</h3>
                </div>
                <span class="dash-panel-count">${onlineCh}/${totalCh}</span>
              </div>
              <div class="dash-lines">${channelRows}</div>
              <div class="dash-agent-list">
                <div class="dash-section-label">Registered agents</div>
                ${agentRows}
              </div>
            </section>

            <section class="dash-panel dash-panel-actions">
              <div class="dash-panel-header">
                <div>
                  <span class="dash-kicker">Tools</span>
                  <h3>Quick actions</h3>
                </div>
              </div>
              <div class="dash-section-label">New surfaces</div>
              <div class="dash-action-grid dash-feature-grid">${featureRows}</div>
              <div class="dash-section-label dash-tool-label">Operator tools</div>
              <div class="dash-action-grid">${actionRows}</div>
            </section>

            <section class="dash-panel dash-panel-activity dashboard-widget" data-widget-id="containers" style="${wVis('containers')}">
              ${wBtn('containers')}
              <div class="dash-panel-header">
                <div>
                  <span class="dash-kicker">Agents</span>
                  <h3><span class="live-dot" style="${containers.length > 0 ? '' : 'display:none'}"></span> Activity queue</h3>
                </div>
                <span class="dash-panel-count">${containers.length}</span>
              </div>
              <div class="dash-activity-list">${activityRows}</div>
              <div class="dash-response-list">
                <div class="dash-section-label">Recent bot responses</div>
                ${responseRows}
              </div>
            </section>

            <section id="weather-widget-slot" class="dashboard-widget dash-weather-slot" data-widget-id="weather" style="${wVis('weather')}">
              ${wBtn('weather')}
              <div class="dash-weather-content">
                <div class="dash-panel dash-weather-panel">
                  <div class="dash-skeleton dash-skeleton-weather"></div>
                </div>
              </div>
            </section>

            <section class="dash-panel dash-panel-chart dashboard-widget" data-widget-id="chart" style="${wVis('chart')}">
              ${wBtn('chart')}
              <div class="dash-panel-header">
                <div>
                  <span class="dash-kicker">Volume</span>
                  <h3>Messages over 30 days</h3>
                </div>
                <span class="dash-panel-count">${todayMsgs}</span>
              </div>
              ${renderChart(stats.daily)}
            </section>

            <section class="dash-panel dash-panel-feed dashboard-widget" data-widget-id="feed" style="${wVis('feed')}">
              ${wBtn('feed')}
              <div class="dash-panel-header">
                <div>
                  <span class="dash-kicker">Journal feed</span>
                  <h3><span class="live-dot"></span> Recent messages</h3>
                </div>
                <span class="dash-panel-count">${messages.length}</span>
              </div>
              <div id="live-feed" class="dash-feed-list">${feedRows}</div>
            </section>
          </div>
        </div>`;

      window._cockpitSessions = cockpitSessions;
      window._selectedCockpitSessionId = selectedCockpit?.id || '';
      if (selectedCockpit) loadCockpitDetail(selectedCockpit.id);
      loadDashboardWeather();
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
    try {
      const [containers, sys] = await Promise.all([
        api('/containers'),
        api('/system'),
      ]);
      const cockpit = await api('/sessions/cockpit').catch(() => []);
      const hash = `${containers.length}|${Array.isArray(cockpit) ? cockpit.length : 0}|${sys.uptimeFormatted}|${Math.floor(Date.now() / 60000)}`;
      if (hash === lastDashHash) return;
      lastDashHash = hash;
    } catch {
      return;
    }
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
    <button class="cockpit-session-row dash-reveal ${isActive ? 'active' : ''}" style="--i:${index}" data-session-id="${esc(session.id)}" onclick="selectCockpitSession('${esc(session.id)}')">
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
    return '<div class="dash-empty">Select a run to inspect details.</div>';
  return `
    <div class="cockpit-detail-head">
      <div>
        <span class="dash-kicker">Selected run</span>
        <h4>${esc(session.group || session.id)}</h4>
        <p>${esc(session.currentStep || 'No current step recorded.')}</p>
      </div>
      <span class="dash-pill ${cockpitStatusClass(session.status)}">${esc((session.status || '').replace(/_/g, ' '))}</span>
    </div>
    <div class="cockpit-detail-metrics">
      <div><span>Started</span><strong>${session.startedAt ? formatTime(session.startedAt) : '-'}</strong></div>
      <div><span>Updated</span><strong>${session.updatedAt ? timeAgo(session.updatedAt) : '-'}</strong></div>
      <div><span>Events</span><strong>${session.messageCount || 0}</strong></div>
      <div><span>Files</span><strong>${Array.isArray(session.changedFiles) ? session.changedFiles.length : 0}</strong></div>
    </div>
    <div class="cockpit-preview-loading">Loading cockpit detail</div>`;
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
    const [data, stream] = await Promise.all([
      api(`/sessions/cockpit/${encodeURIComponent(id)}`),
      api(`/sessions/cockpit/${encodeURIComponent(id)}/stream`).catch(() => ({
        events: [],
      })),
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
            <div class="cockpit-progress-track"><span style="width:${pct}%"></span></div>
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
    detail.innerHTML = `
      ${renderCockpitDetailShell(data)}
      <div class="cockpit-detail-sections">
        <section>
          <div class="dash-section-label">Timeline</div>
          <div class="cockpit-timeline">${timeline || '<div class="dash-empty">No timeline events.</div>'}</div>
        </section>
        <section>
          <div class="dash-section-label">Artifacts</div>
          <div class="cockpit-artifacts">${artifacts || '<div class="dash-empty">No artifacts recorded.</div>'}</div>
        </section>
        <section>
          <div class="dash-section-label">Deliverables</div>
          <div class="cockpit-deliverables">${deliverables || '<div class="dash-empty">No deliverables published.</div>'}</div>
        </section>
        <section>
          <div class="dash-section-label">Tool Timeline</div>
          <div class="cockpit-tools">${toolTimeline || '<div class="dash-empty">No tool events recorded.</div>'}</div>
        </section>
        <section>
          <div class="dash-section-label">Progress</div>
          <div class="cockpit-progress">${progressEvents || '<div class="dash-empty">No progress stream yet.</div>'}</div>
        </section>
        <section>
          <div class="dash-section-label">Approvals</div>
          <div class="cockpit-approvals">${approvals || '<div class="dash-empty">No approvals for this run.</div>'}</div>
        </section>
      </div>`;
    const loading = detail.querySelector('.cockpit-preview-loading');
    if (loading) loading.remove();
  } catch {
    const loading = detail.querySelector('.cockpit-preview-loading');
    if (loading) loading.textContent = 'Failed to load cockpit detail';
  }
}

window.refreshCockpitDashboard = async function () {
  const list = document.getElementById('cockpit-session-list');
  if (!list) return;
  const sessions = await api('/sessions/cockpit').catch(() => []);
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
      .join('') || '<div class="dash-empty">No agent runs captured yet.</div>';
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
      slot.style.display = 'none';
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
                <div class="dash-weather-cell dash-reveal" style="--i:${index}">
                  <span>${label}</span>
                  <strong>${value}</strong>
                  <small>${detail}</small>
                </div>`,
            )
            .join('')}
        </div>
      </div>`;
  } catch {
    if (slot) slot.style.display = 'none';
  }
}

function renderChart(daily) {
  if (!daily || daily.length === 0) {
    return '<div class="dash-empty">No message history yet.</div>';
  }

  const max = Math.max(...daily.map((d) => d.count), 1);
  const bars = daily
    .map((d, index) => {
      const h = Math.max(8, (d.count / max) * 178);
      return `
        <div class="dash-chart-bar" style="--bar-h:${h}px;--bar-i:${index}">
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

window.restartChannel = async (name, btnEl) => {
  inlineConfirm(btnEl, `Restart ${name}?`, async () => {
    const r = await api(`/system/restart-channel/${name}`, { method: 'POST' });
    if (r.ok) {
      toast(r.message || 'Restarting...', 'success');
      setTimeout(() => navigate('monitoring'), 3000);
    } else toast(r.error || 'Failed', 'error');
  });
};

window.restartService = async (btnEl) => {
  inlineConfirm(btnEl, 'Restart NanoCrab?', async () => {
    await api('/system/restart', { method: 'POST' });
    toast('Restarting... Page will reload in 10 seconds.', 'warning');
    setTimeout(() => location.reload(), 10000);
  });
};

window.toggleDashboardEditMode = () => {
  const btn = document.getElementById('dashboard-customize-btn');
  const hideBtns = document.querySelectorAll('.widget-hide-btn');
  const isEditing = btn && btn.textContent === 'Done';
  if (isEditing) {
    btn.textContent = 'Customize';
    hideBtns.forEach((b) => (b.style.display = 'none'));
  } else {
    if (btn) btn.textContent = 'Done';
    hideBtns.forEach((b) => (b.style.display = 'block'));
  }
};

window.hideWidget = (id) => {
  const hidden = JSON.parse(localStorage.getItem('hidden_widgets') || '[]');
  if (!hidden.includes(id)) hidden.push(id);
  localStorage.setItem('hidden_widgets', JSON.stringify(hidden));
  const widget = document.querySelector(`[data-widget-id="${id}"]`);
  if (widget) widget.style.display = 'none';
  const resetBtn = document.getElementById('dashboard-reset-btn');
  if (resetBtn) resetBtn.style.display = '';
  toast('Widget hidden. Click Reset to restore.', 'info');
};

window.resetDashboardWidgets = () => {
  localStorage.removeItem('hidden_widgets');
  toast('Dashboard reset', 'success');
  navigate('dashboard');
};
