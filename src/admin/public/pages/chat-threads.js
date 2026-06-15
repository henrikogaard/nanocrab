// WebChat — web thread conversation module
// Loaded as a classic <script defer> page module. Exposes window.WebChat.
(function () {
  'use strict';

  var _activeThreadId = null;
  var _modalEl = null;

  // ── helpers ────────────────────────────────────────────────────────────────

  function closeModal() {
    if (_modalEl) {
      _modalEl.remove();
      _modalEl = null;
    }
  }

  // ── public API ─────────────────────────────────────────────────────────────

  async function loadThreads() {
    try {
      return await api('/threads');
    } catch (_) {
      return [];
    }
  }

  function renderThreadList(threads, currentId) {
    var newBtn =
      '<a class="nav-link" onclick="WebChat.openNewConversationModal()">' +
      navIcon('chat') +
      '<span class="nav-label">&#xFE0E;＋ New conversation</span></a>';

    var threadItems = '';
    if (!threads || threads.length === 0) {
      threadItems =
        '<div class="nav-empty" style="padding:8px 16px;font-size:12px;color:var(--text-muted)">No conversations yet</div>';
    } else {
      threadItems =
        '<div class="thread-list">' +
        threads
          .map(function (t) {
            var isActive = t.id === currentId;
            return (
              '<a class="nav-link' +
              (isActive ? ' active' : '') +
              '" onclick="WebChat.openThread(' +
              JSON.stringify(t.id) +
              ')">' +
              navIcon('messages') +
              '<span class="nav-label">' +
              esc(t.title || t.id) +
              '</span></a>'
            );
          })
          .join('') +
        '</div>';
    }

    var channelBtn =
      '<a class="nav-link" onclick="navigate(\'messages\')">' +
      navIcon('messages') +
      '<span class="nav-label">Channel messages</span></a>';

    return newBtn + threadItems + channelBtn;
  }

  function openThread(id) {
    _activeThreadId = id;
    location.hash = '#/chat/' + encodeURIComponent(id.replace(/^web:/, ''));
  }

  // Render thread conversation into el, or an empty state if threadId is null.
  async function renderConversation(el, threadId) {
    // Clean up any leftover progress timer from a previous page
    if (window._progressTimeout) {
      clearTimeout(window._progressTimeout);
      window._progressTimeout = null;
    }

    if (!threadId) {
      el.innerHTML =
        '<div class="card empty" style="margin:40px auto;max-width:420px;text-align:center">' +
        '<div class="card-title">Web Conversations</div>' +
        '<p style="color:var(--text-muted);margin-bottom:16px">Start a new AI conversation thread that lives in the browser — independent of your chat channels.</p>' +
        '<button class="btn btn-primary" onclick="WebChat.openNewConversationModal()">＋ New conversation</button>' +
        '</div>';
      return;
    }

    _activeThreadId = threadId;

    // Render shell immediately so the user sees the layout fast
    el.innerHTML =
      '<div class="page-header"><h2 id="thread-title" style="margin:0">Loading…</h2></div>' +
      '<div class="card" style="padding:0;overflow:hidden;display:flex;flex-direction:column">' +
      '<div class="chat-messages" id="chat-messages-area"><div class="loading">Loading</div></div>' +
      '<div class="chat-progress-bar" id="chat-progress-bar" onclick="toggleProgressHistory()">' +
      '<span class="progress-spinner" id="progress-spinner"></span>' +
      '<span class="progress-phase" id="progress-phase">Thinking…</span>' +
      '<div class="progress-track"><div class="progress-fill" id="progress-fill" style="width:0%"></div></div>' +
      '<span class="progress-pct" id="progress-pct">0%</span>' +
      '</div>' +
      '<div class="chat-progress-history" id="chat-progress-history"></div>' +
      '<div class="chat-input">' +
      '<input type="text" id="chat-msg-input" placeholder="Type a message…" autocomplete="off">' +
      '<button class="btn btn-sm btn-primary" id="chat-send-btn">Send</button>' +
      '</div>' +
      '</div>' +
      '<div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end">' +
      '<button class="btn btn-sm btn-ghost" id="thread-rename-btn" style="font-size:11px">Rename</button>' +
      '<button class="btn btn-sm btn-danger" id="thread-delete-btn" style="font-size:11px">Delete</button>' +
      '</div>';

    var chatMessages = [];
    var messagesArea = document.getElementById('chat-messages-area');

    function renderMessages() {
      if (!messagesArea) return;
      if (chatMessages.length === 0) {
        messagesArea.innerHTML =
          '<div class="empty">No messages yet. Send one below.</div>';
        return;
      }
      messagesArea.innerHTML = chatMessages
        .slice()
        .reverse()
        .map(function (m) {
          return (
            '<div class="chat-msg ' +
            (m.is_bot_message ? 'chat-msg-bot' : 'chat-msg-user') +
            '">' +
            '<div>' +
            esc(m.content) +
            '</div>' +
            '<div class="chat-msg-meta">' +
            esc(m.sender_name || (m.is_bot_message ? 'Agent' : 'You')) +
            ' • ' +
            formatTime(m.timestamp) +
            '</div>' +
            '</div>'
          );
        })
        .join('');
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }

    // Load messages
    try {
      var data = await api('/threads/' + encodeURIComponent(threadId) + '/messages');
      chatMessages = Array.isArray(data) ? data : [];
    } catch (e) {
      chatMessages = [];
    }
    renderMessages();

    // Load title
    try {
      var threads = await api('/threads');
      var thisThread = threads.find(function (t) { return t.id === threadId; });
      var titleEl = document.getElementById('thread-title');
      if (titleEl && thisThread) titleEl.textContent = thisThread.title || threadId;
    } catch (_) {}

    // Send message
    async function sendMessage() {
      var input = document.getElementById('chat-msg-input');
      if (!input) return;
      var msg = input.value.trim();
      if (!msg) return;
      input.value = '';

      // Fallback progress timer
      if (window._progressTimeout) clearTimeout(window._progressTimeout);
      window._progressTimeout = setTimeout(function () {
        var bar = document.getElementById('chat-progress-bar');
        if (bar && !bar.classList.contains('visible')) {
          bar.classList.add('visible');
          var spinner = document.getElementById('progress-spinner');
          if (spinner) spinner.style.display = '';
          var phase = document.getElementById('progress-phase');
          if (phase) phase.textContent = 'Agent is thinking…';
          var fill = document.getElementById('progress-fill');
          if (fill) fill.style.width = '0%';
          var pct = document.getElementById('progress-pct');
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
      renderMessages();

      try {
        await api('/threads/' + encodeURIComponent(threadId) + '/messages', {
          method: 'POST',
          body: JSON.stringify({ message: msg }),
        });
      } catch (_) {
        toast('Failed to send message', 'error');
      }
    }

    var sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) sendBtn.onclick = sendMessage;
    var inputEl = document.getElementById('chat-msg-input');
    if (inputEl) {
      inputEl.onkeydown = function (e) {
        if (e.key === 'Enter') sendMessage();
      };
    }

    // Rename
    var renameBtn = document.getElementById('thread-rename-btn');
    if (renameBtn) {
      renameBtn.onclick = async function () {
        var titleEl = document.getElementById('thread-title');
        var current = titleEl ? titleEl.textContent : '';
        var newTitle = window.prompt('Rename conversation:', current);
        if (!newTitle || !newTitle.trim()) return;
        try {
          await api('/threads/' + encodeURIComponent(threadId), {
            method: 'PATCH',
            body: JSON.stringify({ title: newTitle.trim() }),
          });
          if (titleEl) titleEl.textContent = newTitle.trim();
          toast('Renamed', 'success');
          // Refresh sidebar
          var navEl = document.getElementById('chat-thread-nav');
          if (navEl && window.WebChat) {
            WebChat.loadThreads().then(function (ts) {
              navEl.innerHTML = WebChat.renderThreadList(ts, _activeThreadId);
            });
          }
        } catch (e) {
          toast('Rename failed: ' + e.message, 'error');
        }
      };
    }

    // Delete
    var deleteBtn = document.getElementById('thread-delete-btn');
    if (deleteBtn) {
      deleteBtn.onclick = async function () {
        if (!window.confirm('Delete this conversation?')) return;
        try {
          await api('/threads/' + encodeURIComponent(threadId), { method: 'DELETE' });
          toast('Deleted', 'success');
          _activeThreadId = null;
          location.hash = '#/chat';
        } catch (e) {
          toast('Delete failed: ' + e.message, 'error');
        }
      };
    }

    // Patch WebSocket handler — filter all events to this thread's jid
    var origHandler = handleWsMessage;
    var threadWsHandler = function (msg) {
      // Always call the original for non-chat events (notifications, terminal etc.)
      origHandler(msg);

      // Only handle chat events that belong to this thread.
      // new_message uses data.chat_jid; task_progress/tool_call/tool_result/
      // approval_request are broadcast with data.groupJid — accept either.
      var evJid = msg.data ? (msg.data.chat_jid ?? msg.data.groupJid) : undefined;
      if (evJid !== undefined && evJid !== threadId) return;

      if (msg.type === 'task_progress') {
        if (window._progressTimeout) {
          clearTimeout(window._progressTimeout);
          window._progressTimeout = null;
        }
        var bar = document.getElementById('chat-progress-bar');
        var phase = document.getElementById('progress-phase');
        var fill = document.getElementById('progress-fill');
        var pct = document.getElementById('progress-pct');
        var spinner = document.getElementById('progress-spinner');
        if (!bar || !phase || !fill || !pct) return;
        bar.classList.add('visible');
        phase.textContent = msg.data.message || msg.data.phase;
        fill.style.width = Math.min(msg.data.pct, 100) + '%';
        pct.textContent = msg.data.pct + '%';
        var history = document.getElementById('chat-progress-history');
        if (history) {
          var entry = document.createElement('div');
          entry.className =
            'phase-entry' + (msg.data.pct >= 100 ? ' done' : ' active');
          entry.innerHTML =
            '<span style="font-size:10px">' +
            (msg.data.pct >= 100 ? '✓' : '●') +
            '</span> ' +
            esc(msg.data.message || msg.data.phase);
          history.appendChild(entry);
          history.classList.add('visible');
        }
        if (msg.data.pct >= 100 || msg.data.phase === 'done') {
          setTimeout(function () {
            bar.classList.remove('visible');
          }, 3000);
        } else if (spinner) {
          spinner.style.display = '';
        }
        return;
      }

      if (msg.type === 'new_message') {
        var m = msg.data;
        chatMessages.unshift(m);
        renderMessages();
        return;
      }

      if (msg.type === 'tool_call') {
        var container = document.getElementById('chat-messages-area');
        if (!container) return;
        if (document.getElementById('tool-card-' + msg.data.id)) return;
        var card = document.createElement('div');
        card.id = 'tool-card-' + msg.data.id;
        card.className = 'chat-tool-call';
        card.innerHTML =
          '<div class="chat-tool-call-header" onclick="this.nextElementSibling.classList.toggle(\'expanded\')">' +
          '<span class="tool-icon">&#x1F527;</span>' +
          '<span class="tool-name">' + esc(msg.data.name) + '</span>' +
          '<span class="tool-status running">&#x25CF; Running…</span>' +
          '</div>' +
          '<div class="chat-tool-call-body">' +
          '<div class="section-label">Input</div>' +
          '<pre>' + esc(prettyPrint(msg.data.input)) + '</pre>' +
          '</div>';
        container.appendChild(card);
        container.scrollTop = container.scrollHeight;
        return;
      }

      if (msg.type === 'tool_result') {
        var container2 = document.getElementById('chat-messages-area');
        var card2 = document.getElementById('tool-card-' + msg.data.id);
        if (!card2) {
          card2 = document.createElement('div');
          card2.id = 'tool-card-' + msg.data.id;
          card2.className = 'chat-tool-call';
          card2.innerHTML =
            '<div class="chat-tool-call-header" onclick="this.nextElementSibling.classList.toggle(\'expanded\')">' +
            '<span class="tool-icon">&#x1F527;</span>' +
            '<span class="tool-name">tool</span>' +
            '<span class="tool-status done">&#x2713; ' + esc(msg.data.duration) + 's</span>' +
            '</div>' +
            '<div class="chat-tool-call-body">' +
            '<div class="section-label">Result</div>' +
            '<pre>' + esc(prettyPrint(msg.data.output)) + '</pre>' +
            '</div>';
          if (container2) container2.appendChild(card2);
        } else {
          var header2 = card2.querySelector('.chat-tool-call-header');
          var status2 = header2 && header2.querySelector('.tool-status');
          if (status2) {
            status2.className = 'tool-status done';
            status2.textContent = '✓ ' + (msg.data.duration || '') + 's';
          }
          var body2 = card2.querySelector('.chat-tool-call-body');
          if (body2) {
            var resultDiv = document.createElement('div');
            resultDiv.innerHTML =
              '<div class="section-label" style="margin-top:8px">Result</div>' +
              '<pre>' + esc(prettyPrint(msg.data.output)) + '</pre>';
            body2.appendChild(resultDiv);
          }
        }
        return;
      }

      if (msg.type === 'approval_request') {
        var container3 = document.getElementById('chat-messages-area');
        if (!container3) return;
        if (document.getElementById('approval-card-' + msg.data.id)) return;
        var approvalCard = document.createElement('div');
        approvalCard.id = 'approval-card-' + msg.data.id;
        approvalCard.className = 'chat-approval-card';
        approvalCard.dataset.approvalId = msg.data.id;
        approvalCard.dataset.groupJid = threadId;
        approvalCard.innerHTML =
          '<div class="chat-approval-header">&#x26A0;&#xFE0F; Approval Required</div>' +
          '<div class="chat-approval-body">' +
          '<div class="approval-detail">Tool: <strong>' + esc(msg.data.tool) + '</strong></div>' +
          '<div class="approval-detail">Reason: ' + esc(msg.data.reason) + '</div>' +
          '<div class="approval-input">' + esc(prettyPrint(msg.data.input)) + '</div>' +
          '</div>' +
          '<div class="chat-approval-actions">' +
          '<button class="btn btn-sm btn-deny" data-chat-approval-action="deny">Deny</button>' +
          '<button class="btn btn-sm btn-primary" data-chat-approval-action="approve">Approve</button>' +
          '</div>';
        container3.appendChild(approvalCard);
        bindChatApprovalActions(container3);
        container3.scrollTop = container3.scrollHeight;
        return;
      }
    };

    // Save original and install patched handler
    window._chatWsRestore = handleWsMessage;
    handleWsMessage = threadWsHandler;
  }

  async function openNewConversationModal() {
    // Close any existing modal
    closeModal();

    var templates = [];
    try {
      templates = await api('/threads/agent-templates');
    } catch (_) {
      templates = [];
    }

    var lastTemplate = localStorage.getItem('webchat_last_template') || '';

    var templateRadios = templates.length
      ? templates
          .map(function (t) {
            var checked = t.id === lastTemplate ? ' checked' : (lastTemplate === '' && templates[0].id === t.id ? ' checked' : '');
            return (
              '<label class="webchat-template-option" style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;cursor:pointer;border-bottom:1px solid var(--border-subtle, var(--border))">' +
              '<input type="radio" name="wc_template" value="' + esc(t.id) + '"' + checked + ' style="margin-top:3px">' +
              '<span><strong>' + esc(t.label || t.id) + '</strong>' +
              '<span style="color:var(--text-muted);font-size:11px;margin-left:6px">' + esc(t.provider) + ' / ' + esc(t.model) + '</span></span>' +
              '</label>'
            );
          })
          .join('')
      : '<p style="color:var(--text-muted);font-size:12px">No agent templates configured.</p>';

    var modalHtml =
      '<div id="webchat-modal-overlay" style="position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center">' +
      '<div id="webchat-modal-panel" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;width:min(440px,92vw);max-height:80vh;overflow-y:auto;box-shadow:var(--shadow-lg)">' +
      '<h3 style="margin:0 0 16px">New conversation</h3>' +
      '<div style="margin-bottom:12px">' +
      '<div class="section-label" style="margin-bottom:6px">Agent template</div>' +
      templateRadios +
      '</div>' +
      '<div style="margin-bottom:12px">' +
      '<button type="button" id="wc-advanced-toggle" class="btn btn-sm btn-ghost" style="font-size:12px">&#9654; Advanced</button>' +
      '<div id="wc-advanced-fields" style="display:none;margin-top:10px;display:none">' +
      '<div style="margin-bottom:8px"><label style="font-size:12px;color:var(--text-muted)">Provider<br>' +
      '<input type="text" id="wc-provider-input" class="search-input" placeholder="e.g. anthropic" style="margin-top:4px;width:100%"></label></div>' +
      '<div><label style="font-size:12px;color:var(--text-muted)">Model<br>' +
      '<input type="text" id="wc-model-input" class="search-input" placeholder="e.g. claude-opus-4-5" style="margin-top:4px;width:100%"></label></div>' +
      '</div>' +
      '</div>' +
      '<div style="margin-bottom:20px"><label style="font-size:12px;color:var(--text-muted)">Title (optional)<br>' +
      '<input type="text" id="wc-title-input" class="search-input" placeholder="My conversation" style="margin-top:4px;width:100%"></label></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button type="button" class="btn btn-ghost" id="wc-cancel-btn">Cancel</button>' +
      '<button type="button" class="btn btn-primary" id="wc-create-btn">Create</button>' +
      '</div>' +
      '</div>' +
      '</div>';

    var wrapper = document.createElement('div');
    wrapper.innerHTML = modalHtml;
    _modalEl = wrapper.firstElementChild;
    document.body.appendChild(_modalEl);

    // Advanced toggle
    var advToggle = document.getElementById('wc-advanced-toggle');
    var advFields = document.getElementById('wc-advanced-fields');
    var _advancedOpen = false;
    if (advToggle && advFields) {
      advToggle.onclick = function () {
        _advancedOpen = !_advancedOpen;
        advFields.style.display = _advancedOpen ? 'block' : 'none';
        advToggle.textContent = (_advancedOpen ? '▼' : '►') + ' Advanced';
      };
    }

    // Cancel / overlay close
    var cancelBtn = document.getElementById('wc-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = closeModal;
    _modalEl.addEventListener('click', function (e) {
      if (e.target === _modalEl) closeModal();
    });

    // Create
    var createBtn = document.getElementById('wc-create-btn');
    if (createBtn) {
      createBtn.onclick = async function () {
        var body = {};

        var advProvider = document.getElementById('wc-provider-input');
        var advModel = document.getElementById('wc-model-input');
        if (_advancedOpen && advProvider && advProvider.value.trim() && advModel && advModel.value.trim()) {
          body.provider = advProvider.value.trim();
          body.model = advModel.value.trim();
        } else {
          var selectedRadio = _modalEl.querySelector('input[name="wc_template"]:checked');
          if (selectedRadio) {
            body.templateAgentId = selectedRadio.value;
            localStorage.setItem('webchat_last_template', selectedRadio.value);
          }
        }

        var titleInput = document.getElementById('wc-title-input');
        if (titleInput && titleInput.value.trim()) {
          body.title = titleInput.value.trim();
        }

        createBtn.disabled = true;
        createBtn.textContent = 'Creating…';
        try {
          var resp = await api('/threads', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          closeModal();
          openThread(resp.id);
        } catch (e) {
          toast('Failed to create: ' + e.message, 'error');
          createBtn.disabled = false;
          createBtn.textContent = 'Create';
        }
      };
    }
  }

  // ── expose ─────────────────────────────────────────────────────────────────

  window.WebChat = {
    loadThreads: loadThreads,
    renderThreadList: renderThreadList,
    openThread: openThread,
    renderConversation: renderConversation,
    openNewConversationModal: openNewConversationModal,
    get activeThreadId() { return _activeThreadId; },
  };
})();
