// WebChat — web thread conversation module
// Loaded as a classic <script defer> page module. Exposes window.WebChat.
(function () {
  'use strict';

  var _activeThreadId = null;
  var _activeThreadTitle = null;
  var _modalEl = null;
  var _threadListHandlersInstalled = false;
  var _webChatActionHandlersInstalled = false;
  var _chatProjects = [];
  function setProgressFill(el, pct) {
    if (!el) return;
    el.style.setProperty('--progress-pct', Math.min(Number(pct) || 0, 100) + '%');
  }
  function conversationRoot() {
    return document.getElementById('page-content');
  }
  var CHAT_STARTERS = [
    {
      title: 'Triage my inbox',
      description: 'Find what needs attention and turn it into a short action list.',
      prompt:
        'Help me triage what needs my attention today. If you need access to email, calendar, or another source, tell me what you can check and ask before taking actions that write or send anything.',
    },
    {
      title: 'Draft a decision',
      description: 'Turn a messy situation into options, tradeoffs, and a recommendation.',
      prompt:
        'Help me make a decision. Ask me for the context you need, then summarize the options, tradeoffs, risks, and a recommended next step.',
    },
    {
      title: 'Plan the work',
      description: 'Break an idea into practical next steps with crisp sequencing.',
      prompt:
        'Help me plan this work. Start by asking for the goal and constraints, then turn it into a prioritized checklist with next actions.',
    },
    {
      title: 'Polish my writing',
      description: 'Improve tone, structure, and clarity while keeping my voice.',
      prompt:
        'Help me polish a piece of writing. Ask me to paste the draft, then improve it for clarity, tone, and structure while keeping my voice.',
    },
  ];
  var PROJECT_TOOL_STARTERS = [
    {
      title: 'Latest email summary',
      description: 'Use configured mail MCP, then save a project brief if document tools are available.',
      prompt:
        'Use the configured mail MCP server to review the latest relevant emails for this project. Summarize important updates, decisions, deadlines, risks, and follow-up actions. Include a source ledger naming the MCP server, query window, and files created. If document tools are available, create or update a concise project summary document in the project workspace. Ask before sending email or writing to external systems.',
    },
    {
      title: 'Emails from someone',
      description: 'Check a sender or domain and turn the thread into decisions and next actions.',
      prompt:
        'Use the configured mail MCP server to check recent emails from [person or domain]. Create a concise summary of the thread, open questions, deadlines, promised follow-ups, and suggested replies. Include a source ledger naming the sender filter, query window, MCP calls used, and project artifact path. Ask me before sending anything or writing to external systems.',
    },
    {
      title: 'Create document',
      description: 'Use project files, chat history, and document MCP tools to draft an artifact.',
      prompt:
        'Create a polished document for this project using project files, chat history, and any approved document MCP tools. Draft it in markdown in the project workspace first, include assumptions, missing facts, and a source ledger with MCP servers, tool-call purpose, source files, and output path. Ask before publishing or updating external documents.',
    },
    {
      title: 'Calendar follow-up',
      description: 'Check meetings and commitments, then produce a short action brief.',
      prompt:
        'Use approved calendar and mail MCP tools to find recent meetings and follow-ups related to this project. Summarize commitments, owners, dates, blockers, and the next three actions. Do not create or modify calendar events without approval.',
    },
    {
      title: 'Custom MCP task',
      description: 'Use any approved connector to gather context and produce a project artifact.',
      prompt:
        'Use the approved MCP servers that fit this project request. Gather the needed external context, summarize what you found, cite the source systems or files you used, and create a durable project artifact when useful. Ask before publishing, sending, or changing anything outside NanoCrab.',
    },
  ];
  var PROJECT_MCP_COMMANDS = [
    {
      title: 'Latest emails -> summary doc',
      source: 'Mail MCP',
      output: 'Project summary draft',
      approval: 'Ask before publishing externally',
      prompt:
        'Use the configured mail MCP server to review the latest emails relevant to this Cowork project. Produce a markdown summary document in the project workspace with sections for source window, decisions, deadlines, risks, waiting items, next actions, and a source ledger naming MCP server, query window, tool-call purpose, and output path. Ask before creating or updating any external document.',
    },
    {
      title: 'Emails from sender -> brief',
      source: 'Mail MCP',
      output: 'Sender/thread brief',
      approval: 'Ask before sending replies',
      prompt:
        'Use the configured mail MCP server to check recent emails from [person or domain] for this Cowork project. Generate a concise brief with thread summary, commitments, deadlines, open questions, suggested replies, source citations, and a source ledger naming sender filter, query window, MCP calls, and created project files. Save the draft in the project workspace when useful. Ask before sending or changing anything outside NanoCrab.',
    },
    {
      title: 'Project context -> document',
      source: 'Files + chats + MCP',
      output: 'Durable project document',
      approval: 'Approve external document writes',
      prompt:
        'Combine project files, recent project chat history, and approved MCP source context into a concise project summary document. Save the draft in this project workspace, cite source systems and files used, include a source ledger with MCP servers, tool-call purpose, source files, and artifact path, list assumptions, and flag any external document write that needs approval.',
    },
    {
      title: 'Mailbox topic sweep',
      source: 'Mail search MCP',
      output: 'Evidence-backed action list',
      approval: 'Read-only until approved',
      prompt:
        'Use the configured mail MCP server to search for emails about [topic, customer, project, or keyword]. Summarize the evidence, decisions, promised follow-ups, owners, and due dates. Create a project action list draft with a source ledger naming query terms, date window, MCP calls, and artifact path. Ask before sending messages or modifying external records.',
    },
  ];
  var PROJECT_MCP_SOURCE_STEPS = [
    {
      label: 'Source',
      detail: 'Name the MCP server, sender/topic, date window, and project question.',
    },
    {
      label: 'Evidence',
      detail: 'Collect citations, decisions, deadlines, waiting items, and gaps.',
    },
    {
      label: 'Draft',
      detail: 'Save a markdown summary or document in the Cowork project workspace first.',
    },
    {
      label: 'Ledger',
      detail: 'Record MCP server, tool-call purpose, query window or sender filter, and created project files.',
    },
    {
      label: 'Approval',
      detail: 'Ask before publishing documents, sending mail, or changing external systems.',
    },
  ];

  // ── helpers ────────────────────────────────────────────────────────────────

  function closeModal() {
    if (_modalEl) {
      _modalEl.remove();
      _modalEl = null;
    }
  }

  function openConfirmModal(options) {
    closeModal();
    var wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div id="webchat-modal-overlay">' +
      '<div id="webchat-modal-panel" class="webchat-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="webchat-confirm-title">' +
      '<div class="webchat-modal-head">' +
      '<h3 id="webchat-confirm-title">' + esc(options.title || 'Confirm action') + '</h3>' +
      '<p>' + esc(options.body || '') + '</p>' +
      '</div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-sm btn-ghost" id="webchat-confirm-cancel">Cancel</button>' +
      '<button class="btn btn-sm btn-danger" id="webchat-confirm-action">' + esc(options.actionLabel || 'Confirm') + '</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    _modalEl = wrapper.firstElementChild;
    document.body.appendChild(_modalEl);
    var cancelBtn = document.getElementById('webchat-confirm-cancel');
    var actionBtn = document.getElementById('webchat-confirm-action');
    if (cancelBtn) cancelBtn.onclick = closeModal;
    if (actionBtn) {
      actionBtn.onclick = async function () {
        actionBtn.disabled = true;
        try {
          await options.onConfirm();
          closeModal();
        } catch (e) {
          actionBtn.disabled = false;
          toast((options.errorPrefix || 'Action failed') + ': ' + e.message, 'error');
        }
      };
      actionBtn.focus();
    }
    _modalEl.addEventListener('click', function (e) {
      if (e.target === _modalEl) closeModal();
    });
  }

  function openInputModal(options) {
    closeModal();
    var wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div id="webchat-modal-overlay">' +
      '<div id="webchat-modal-panel" class="webchat-input-panel" role="dialog" aria-modal="true" aria-labelledby="webchat-input-title">' +
      '<div class="webchat-modal-head">' +
      '<h3 id="webchat-input-title">' + esc(options.title || 'Update value') + '</h3>' +
      '<p>' + esc(options.body || '') + '</p>' +
      '</div>' +
      '<label class="webchat-modal-field">' + esc(options.label || 'Value') +
      '<input class="search-input" id="webchat-input-value" value="' + esc(options.value || '') + '">' +
      '</label>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-sm btn-ghost" id="webchat-input-cancel">Cancel</button>' +
      '<button class="btn btn-sm btn-primary" id="webchat-input-action">' + esc(options.actionLabel || 'Save') + '</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    _modalEl = wrapper.firstElementChild;
    document.body.appendChild(_modalEl);
    var input = document.getElementById('webchat-input-value');
    var cancelBtn = document.getElementById('webchat-input-cancel');
    var actionBtn = document.getElementById('webchat-input-action');
    async function submit() {
      var value = input ? input.value.trim() : '';
      if (!value) {
        toast(options.emptyMessage || 'Enter a value', 'warning');
        if (input) input.focus();
        return;
      }
      if (actionBtn) actionBtn.disabled = true;
      try {
        await options.onSubmit(value);
        closeModal();
      } catch (e) {
        if (actionBtn) actionBtn.disabled = false;
        toast((options.errorPrefix || 'Save failed') + ': ' + e.message, 'error');
      }
    }
    if (cancelBtn) cancelBtn.onclick = closeModal;
    if (actionBtn) actionBtn.onclick = submit;
    if (input) {
      input.onkeydown = function (e) {
        if (e.key === 'Enter') submit();
      };
      input.focus();
      input.select();
    }
    _modalEl.addEventListener('click', function (e) {
      if (e.target === _modalEl) closeModal();
    });
  }

  function getStarter(index) {
    var numeric = Number(index);
    if (!Number.isInteger(numeric)) return null;
    return CHAT_STARTERS[numeric] || null;
  }

  function getProjectToolStarter(index) {
    var numeric = Number(index);
    if (!Number.isInteger(numeric)) return null;
    return PROJECT_TOOL_STARTERS[numeric] || null;
  }

  function toggleToolCall(target) {
    var header =
      target && target.closest ? target.closest('.chat-tool-call-header') : null;
    var body = header && header.nextElementSibling;
    if (body) body.classList.toggle('expanded');
  }

  function refreshThreadList() {
    var nav = document.getElementById('chat-thread-nav');
    if (!nav) return;
    loadThreads().then(function (threads) {
      nav.innerHTML = renderThreadList(threads, _activeThreadId);
    });
  }

  function installWebChatActionHandlers() {
    if (_webChatActionHandlersInstalled) return;
    _webChatActionHandlersInstalled = true;
    document.addEventListener('click', function (event) {
      var target =
        event.target && event.target.closest
          ? event.target.closest('[data-webchat-action]')
          : null;
      if (!target) return;
      var action = target.dataset.webchatAction;
      if (!action) return;
      event.preventDefault();
      if (action === 'open-new-conversation') {
        openNewConversationSurface();
      } else if (action === 'start-from-prompt') {
        startFromPrompt(target.dataset.starterIndex);
      } else if (action === 'use-starter') {
        useStarterPrompt(target.dataset.starterIndex);
      } else if (action === 'fill-start-prompt') {
        fillStartPrompt(target);
      } else if (action === 'send-start-prompt') {
        startConversationFromComposer();
      } else if (action === 'focus-chat-input') {
        var input = document.getElementById('chat-msg-input');
        if (input) input.focus();
      } else if (action === 'open-projects') {
        navigate('projects');
      } else if (action === 'retry-thread') {
        var el = conversationRoot();
        if (el) renderConversation(el, target.dataset.threadId || _activeThreadId);
      } else if (action === 'open-project-context') {
        openProjectContext(target.dataset.projectId);
      } else if (action === 'use-project-runbook') {
        useProjectMcpRunbook();
      } else if (action === 'use-project-tool') {
        useProjectToolPrompt(target.dataset.starterIndex);
      } else if (action === 'use-project-mcp-command') {
        useProjectMcpCommand(target.dataset.commandIndex);
      } else if (action === 'retry-thread-list') {
        refreshThreadList();
      } else if (action === 'create-chat-project') {
        createChatProject();
      } else if (action === 'assign-chat-project') {
        assignChatProject(target.dataset.threadId, target.dataset.chatProjectId || null);
      } else if (action === 'toggle-progress-history') {
        if (typeof window.toggleProgressHistory === 'function') {
          window.toggleProgressHistory();
        }
      } else if (action === 'toggle-tool-call') {
        toggleToolCall(target);
      }
    });
  }

  function openNewConversationSurface() {
    closeModal();
    _activeThreadId = null;
    _activeThreadTitle = null;
    if (location.hash === '#/chat') {
      var el = conversationRoot();
      if (el) renderConversation(el, null);
      return;
    }
    location.hash = '#/chat';
  }

  function renderStarterCards() {
    return CHAT_STARTERS.map(function (starter, index) {
      return (
        '<button type="button" class="webchat-starter-card" data-webchat-action="start-from-prompt" data-starter-index="' +
        index +
        '">' +
        '<span class="webchat-starter-title">' +
        esc(starter.title) +
        '</span>' +
        '<span class="webchat-starter-desc">' +
        esc(starter.description) +
        '</span>' +
        '</button>'
      );
    }).join('');
  }

  function renderStartSuggestionRows() {
    return CHAT_STARTERS.map(function (starter, index) {
      return (
        '<button type="button" class="webchat-start-row" data-webchat-action="fill-start-prompt" data-starter-index="' +
        index +
        '">' +
        esc(starter.title) +
        '</button>'
      );
    }).join('');
  }

  function fallbackProviderDefinitions() {
    return {
      claude: { id: 'claude', name: 'Claude' },
      codex: { id: 'codex', name: 'Codex' },
      ollama: { id: 'ollama', name: 'Ollama' },
      openrouter: { id: 'openrouter', name: 'OpenRouter' },
      'openai-responses': { id: 'openai-responses', name: 'OpenAI' },
      'anthropic-messages': { id: 'anthropic-messages', name: 'Anthropic' },
      gemini: { id: 'gemini', name: 'Gemini' },
      mistral: { id: 'mistral', name: 'Mistral' },
      'openai-compatible': { id: 'openai-compatible', name: 'OpenAI-compatible' },
    };
  }

  async function loadWebChatProviderChoices() {
    var providerInfo = {};
    try {
      providerInfo = await api('/system/provider');
    } catch (_) {
      providerInfo = {};
    }

    var fallbackDefinitions = fallbackProviderDefinitions();
    var providerDefinitions = providerInfo.definitions || fallbackDefinitions;
    var providerModels = providerInfo.models || {};
    var providerDefaults = providerInfo.defaults || {};
    var available = providerInfo.available || {};
    var rawProviders = Object.values(providerDefinitions)
      .filter(function (p) { return p && p.selectable !== false; })
      .map(function (p) {
        return {
          id: p.id,
          name: p.name || p.id,
          available: available[p.id] !== false,
        };
      });
    if (!rawProviders.length) {
      rawProviders = Object.values(fallbackDefinitions).map(function (p) {
        return { id: p.id, name: p.name || p.id, available: true };
      });
    }

    var configuredProviders = rawProviders.filter(function (p) { return p.available; });
    var providerOptions = configuredProviders.length ? configuredProviders : rawProviders;

    function modelsFor(providerId) {
      var models = providerModels[providerId] || [];
      if (models.length) return models;
      if (providerDefaults[providerId]) return [providerDefaults[providerId]];
      if (providerId === providerInfo.provider && providerInfo.model) return [providerInfo.model];
      return ['model-id'];
    }

    var lastProvider = localStorage.getItem('webchat_last_provider') || providerInfo.provider || providerOptions[0].id;
    if (!providerOptions.some(function (p) { return p.id === lastProvider; })) {
      lastProvider = providerOptions[0].id;
    }
    var lastModel =
      localStorage.getItem('webchat_last_model_' + lastProvider) ||
      providerDefaults[lastProvider] ||
      providerInfo.model ||
      modelsFor(lastProvider)[0];
    if (!modelsFor(lastProvider).includes(lastModel)) {
      lastModel = modelsFor(lastProvider)[0];
    }

    var modelOptions = [];
    providerOptions.forEach(function (provider) {
      modelsFor(provider.id).forEach(function (model) {
        modelOptions.push({
          providerId: provider.id,
          providerName: provider.name,
          model: model,
          value: provider.id + '::' + model,
          selected: provider.id === lastProvider && model === lastModel,
        });
      });
    });
    if (!modelOptions.some(function (option) { return option.selected; }) && modelOptions[0]) {
      modelOptions[0].selected = true;
    }

    return {
      providerInfo: providerInfo,
      providerDefinitions: providerDefinitions,
      providerModels: providerModels,
      providerDefaults: providerDefaults,
      available: available,
      providerOptions: providerOptions,
      modelOptions: modelOptions,
      modelsFor: modelsFor,
    };
  }

  function renderStartModelOptions(choices) {
    return choices.modelOptions
      .map(function (option) {
        return (
          '<option value="' +
          esc(option.value) +
          '" data-model-search-text="' +
          esc((option.providerName + ' ' + option.providerId + ' ' + option.model).toLowerCase()) +
          '"' +
          (option.selected ? ' selected' : '') +
          '>' +
          esc(option.providerName + ' · ' + option.model) +
          '</option>'
        );
      })
      .join('');
  }

  function renderNewConversationStart(choices) {
    return (
      '<section class="webchat-start" aria-label="Start a chat">' +
      '<div class="webchat-start-main">' +
      '<h2>How can I help you?</h2>' +
      '<div class="webchat-start-modes" aria-label="Prompt categories">' +
      '<button type="button" data-webchat-action="fill-start-prompt" data-start-prompt="Help me create something useful. Ask for the goal, audience, constraints, and desired format before drafting.">Create</button>' +
      '<button type="button" data-webchat-action="fill-start-prompt" data-start-prompt="Help me explore this topic. Start with clarifying questions, then map the important angles, risks, and next checks.">Explore</button>' +
      '<button type="button" data-webchat-action="fill-start-prompt" data-start-prompt="Help me with code. Ask for the repo, target behavior, and failure evidence, then propose the smallest verified change.">Code</button>' +
      '<button type="button" data-webchat-action="fill-start-prompt" data-start-prompt="Help me learn this. Explain it plainly, show examples, and check what I already know before going deeper.">Learn</button>' +
      '</div>' +
      '<div class="webchat-start-suggestions">' +
      renderStartSuggestionRows() +
      '</div>' +
      '</div>' +
      '<div class="webchat-start-composer" role="group" aria-label="New chat composer">' +
      '<textarea id="webchat-start-input" rows="1" placeholder="Type your message here..." autocomplete="off"></textarea>' +
      renderStartProjectSelect() +
      '<div class="webchat-start-toolbar">' +
      '<input id="webchat-start-model-search" type="search" autocomplete="off" placeholder="Search models" aria-label="Search models">' +
      '<select id="webchat-start-model-select" aria-label="Model">' +
      renderStartModelOptions(choices) +
      '</select>' +
      '<button type="button" id="webchat-start-send" class="btn btn-primary" data-webchat-action="send-start-prompt" aria-label="Send message" title="Send message">Send</button>' +
      '</div>' +
      '</div>' +
      '</section>'
    );
  }

  function renderStartProjectSelect() {
    var projects = Array.isArray(_chatProjects) ? _chatProjects : [];
    return (
      '<label class="webchat-start-project">' +
      '<span>Project</span>' +
      '<select id="webchat-start-project-select" aria-label="Chat project">' +
      '<option value="">No project</option>' +
      projects
        .map(function (project) {
          return '<option value="' + esc(project.id) + '">' + esc(project.name) + '</option>';
        })
        .join('') +
      '</select>' +
      '</label>'
    );
  }

  async function loadChatProjects() {
    try {
      var projectsPayload = await api('/threads/projects');
      _chatProjects = Array.isArray(projectsPayload.projects) ? projectsPayload.projects : [];
    } catch (_) {
      _chatProjects = [];
    }
    return _chatProjects;
  }

  function filterStartModelOptions() {
    var search = document.getElementById('webchat-start-model-search');
    var select = document.getElementById('webchat-start-model-select');
    if (!search || !select) return;
    var query = search.value.trim().toLowerCase();
    var firstVisible = null;
    Array.prototype.forEach.call(select.options, function (option) {
      var text = option.dataset.modelSearchText || option.textContent.toLowerCase();
      var visible = !query || text.indexOf(query) !== -1;
      option.hidden = !visible;
      option.disabled = !visible;
      if (visible && !firstVisible) firstVisible = option;
    });
    if (firstVisible && (select.selectedOptions[0] || {}).disabled) {
      select.value = firstVisible.value;
    }
  }

  function parseStartModelValue(value) {
    var parts = String(value || '').split('::');
    return {
      provider: parts[0] || '',
      model: parts.slice(1).join('::') || '',
    };
  }

  function fillStartPrompt(target) {
    var input = document.getElementById('webchat-start-input');
    if (!input) return;
    var starter = getStarter(target.dataset.starterIndex);
    input.value = starter ? starter.prompt : target.dataset.startPrompt || '';
    resizeChatInput(input);
    input.focus();
  }

  async function startConversationFromComposer() {
    var input = document.getElementById('webchat-start-input');
    var select = document.getElementById('webchat-start-model-select');
    var projectSelect = document.getElementById('webchat-start-project-select');
    var btn = document.getElementById('webchat-start-send');
    if (!input || !select || !btn || btn.disabled) return;
    var prompt = input.value.trim();
    if (!prompt) {
      input.focus();
      return;
    }

    var selected = parseStartModelValue(select.value);
    var body = {};
    if (selected.provider) {
      body.provider = selected.provider;
      localStorage.setItem('webchat_last_provider', selected.provider);
    }
    if (selected.model) {
      body.model = selected.model;
      if (selected.provider) {
        localStorage.setItem('webchat_last_model_' + selected.provider, selected.model);
      }
    }
    if (projectSelect && projectSelect.value) {
      body.chatProjectId = projectSelect.value;
    }

    btn.disabled = true;
    btn.textContent = 'Starting...';
    try {
      var resp = await api('/threads', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      var sendError = null;
      try {
        await api('/threads/' + encodeURIComponent(resp.id) + '/messages', {
          method: 'POST',
          body: JSON.stringify({ message: prompt }),
        });
      } catch (e) {
        sendError = e;
      }
      refreshThreadList();
      openThread(resp.id);
      if (sendError) {
        toast(chatActionErrorMessage('starter', sendError), 'error');
      }
    } catch (e) {
      toast(chatActionErrorMessage('create', e), 'error');
      btn.disabled = false;
      btn.textContent = 'Send';
      input.focus();
    }
  }

  function renderWebchatLoadingState() {
    return (
      '<section class="webchat-loading-state" aria-busy="true" aria-label="Loading conversation context">' +
      '<div>' +
      '<span>Conversation loading</span>' +
      '<strong>Loading chat context</strong>' +
      '<p>Checking whether this is a plain Chat thread or a Cowork project thread, then loading messages, context, MCP access, and starter actions.</p>' +
      '</div>' +
      '<div class="webchat-loading-flow">' +
      '<span>Thread</span>' +
      '<span>Context</span>' +
      '<span>Messages</span>' +
      '<span>Actions</span>' +
      '</div>' +
      '</section>'
    );
  }

  function renderProjectThreadStartState(threadMeta) {
    var projectName = (threadMeta && threadMeta.projectName) || 'this Cowork project';
    var mcpSummary = formatMcpAccessSummary(threadMeta);
    var toolsAvailable = mcpSummary.enabled;
    return (
      '<section class="webchat-project-start" aria-label="Start Cowork project chat">' +
      '<div class="webchat-project-start-copy">' +
      '<span>Cowork chat</span>' +
      '<h3>Work from ' +
      esc(projectName) +
      '</h3>' +
      '<p>Ask for a project brief, source-backed summary, document draft, or next action. Files, prior project chats, and approved tools stay attached to this thread.</p>' +
      '</div>' +
      '<div class="webchat-project-start-actions">' +
      (toolsAvailable
        ? '<button type="button" class="btn btn-sm btn-primary" data-webchat-action="use-project-runbook">Use MCP runbook</button>'
        : '') +
      '<button type="button" class="btn btn-sm btn-ghost" data-webchat-action="focus-chat-input">Write custom prompt</button>' +
      '</div>' +
      '<div class="webchat-project-start-meta">' +
      '<span>' +
      esc(toolsAvailable ? mcpSummary.projectScope : 'Project files and chat history only') +
      '</span>' +
      '<span>' +
      esc(mcpSummary.writeGuard) +
      '</span>' +
      '</div>' +
      '<div class="webchat-project-start-grid">' +
      PROJECT_TOOL_STARTERS.slice(0, 4)
        .map(function (starter, index) {
          return (
            '<button type="button" data-webchat-action="use-project-tool" data-starter-index="' +
            index +
            '">' +
            '<strong>' +
            esc(starter.title) +
            '</strong>' +
            '<small>' +
            esc(starter.description) +
            '</small>' +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      (toolsAvailable
        ? '<div class="webchat-project-command-row">' +
          PROJECT_MCP_COMMANDS.slice(0, 3)
            .map(function (command, index) {
              return (
                '<button type="button" data-webchat-action="use-project-mcp-command" data-command-index="' +
                index +
                '">' +
                esc(command.title) +
                '</button>'
              );
            })
            .join('') +
          '</div>'
        : '') +
      '</section>'
    );
  }

  function renderEmptyThreadState(threadMeta) {
    if (threadMeta && threadMeta.projectId) return renderProjectThreadStartState(threadMeta);
    return (
      '<section class="webchat-thread-empty-state">' +
      '<div class="webchat-thread-empty-copy">' +
      '<span>First message</span>' +
      '<strong>Start with a plain chat prompt.</strong>' +
      '<p>This thread has no project files, artifacts, or agent template. Use it for quick thinking, writing, planning, and questions. Move to Cowork when you need durable project context or MCP-backed documents.</p>' +
      '</div>' +
      '<div class="webchat-thread-empty-actions">' +
      '<button type="button" class="btn btn-sm btn-primary" data-webchat-action="focus-chat-input">Write message</button>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-webchat-action="open-projects">Open Cowork projects</button>' +
      '</div>' +
      '<div class="webchat-thread-empty-starters">' +
      CHAT_STARTERS.slice(0, 3)
        .map(function (starter, index) {
          return (
            '<button type="button" data-webchat-action="use-starter" data-starter-index="' +
            index +
            '">' +
            '<strong>' +
            esc(starter.title) +
            '</strong>' +
            '<small>' +
            esc(starter.description) +
            '</small>' +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '</section>'
    );
  }

  function renderThreadMessageLoadIssue(message) {
    return (
      '<section class="webchat-message-error-state" role="status">' +
      '<span>Messages unavailable</span>' +
      '<strong>Could not load this chat history.</strong>' +
      '<p>' +
      esc(message || 'The composer still works, but previous messages are not visible right now. Retry the thread before relying on this conversation context.') +
      '</p>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-webchat-action="retry-thread">Retry thread</button>' +
      '</section>'
    );
  }

  function resizeChatInput(input) {
    if (!input || input.tagName !== 'TEXTAREA') return;
    input.style.setProperty(
      '--chat-input-height',
      Math.min(input.scrollHeight, 148) + 'px',
    );
  }

  function formatMcpAccessSummary(threadMeta) {
    var mcpAccess = (threadMeta && threadMeta.mcpAccess) || {};
    var servers = Array.isArray(mcpAccess.servers) ? mcpAccess.servers.filter(Boolean) : [];
    var enabled = mcpAccess.enabled !== false;
    var configured = mcpAccess.scope === 'configured';
    var restricted = mcpAccess.scope === 'restricted';
    var serverList = servers.join(', ');
    var internalOnly = 'Internal NanoCrab tools only';
    var configuredCopy = 'All configured MCP servers allowed by connector permissions';
    var restrictedCopy = 'Restricted MCP servers: ' + serverList;
    var projectScope = !enabled
      ? internalOnly
      : configured
        ? configuredCopy
        : restricted && servers.length
          ? restrictedCopy
          : internalOnly;
    var plainScope = !enabled
      ? internalOnly
      : servers.length
        ? 'Plain chat can use MCP scope: ' + serverList
        : configured
          ? 'Plain chat can use MCP scope: configured connectors'
          : internalOnly;
    var promptScope = configured
      ? 'all configured MCP servers allowed by connector permissions'
      : servers.length
        ? serverList
        : 'approved MCP servers exposed to this project chat';
    var writeGuard = mcpAccess.requiresApprovalForWrites
      ? 'External writes and document publishing request approval first.'
      : enabled && mcpAccess.writesEnabled
        ? 'External MCP writes are available without an approval gate.'
        : 'External writes are not enabled for this chat.';
    var briefScope = configured
      ? 'all configured MCP servers allowed by connector permissions'
      : restricted && servers.length
        ? 'restricted MCP servers: ' + serverList
        : 'internal NanoCrab tools only';
    return {
      enabled: enabled,
      plainScope: plainScope,
      projectScope: projectScope,
      promptScope: promptScope,
      writeGuard: writeGuard,
      briefScope: briefScope,
    };
  }

  function plainChatMcpAccessText(threadMeta) {
    return formatMcpAccessSummary(threadMeta).plainScope;
  }

  function renderThreadContextBanner(threadMeta) {
    if (!threadMeta || !threadMeta.projectId) return '';
    var projectName = threadMeta.projectName || 'Project';
    var mcpSummary = formatMcpAccessSummary(threadMeta);
    var toolsAvailable = mcpSummary.enabled;
    return (
      '<div class="webchat-context-banner" data-project-id="' +
      esc(threadMeta.projectId) +
      '" data-mcp-enabled="' +
      esc(String(toolsAvailable)) +
      '">' +
      '<div class="webchat-context-copy">' +
      '<span>Cowork project</span>' +
      '<strong>' +
      esc(projectName) +
      '</strong>' +
      '<small>' +
      esc(
        toolsAvailable
          ? 'Project files, prior project chats, and approved MCP tools are available to this chat.'
          : 'Project files and prior project chats are available. External MCP tools are not enabled for this chat.',
      ) +
      '</small>' +
      '<div class="webchat-mcp-status">' +
      '<span>' +
      esc(mcpSummary.projectScope) +
      '</span>' +
      '<span>' +
      esc(mcpSummary.writeGuard) +
      '</span>' +
      '</div>' +
      '</div>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-project-id="' +
      esc(threadMeta.projectId) +
      '" data-webchat-action="open-project-context">Back to project</button>' +
      '</div>'
    );
  }

  function renderThreadContextUnavailable(threadId) {
    return (
      '<section class="webchat-context-warning" role="status">' +
      '<div>' +
      '<span>Context unavailable</span>' +
      '<strong>Thread metadata could not be loaded.</strong>' +
      '<p>This chat may be a plain Chat thread or a Cowork project thread. Project files, MCP scope, and artifact context are hidden until the thread detail request recovers.</p>' +
      '</div>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-thread-id="' +
      esc(threadId) +
      '" data-webchat-action="retry-thread">Retry context</button>' +
      '</section>'
    );
  }

  function chatActionErrorMessage(kind, error) {
    var detail = error && error.message ? ' Detail: ' + error.message : '';
    if (kind === 'send') {
      return 'Message was not sent. Your draft was restored so you can retry after the thread recovers.' + detail;
    }
    if (kind === 'starter') {
      return 'Conversation was created, but the starter prompt was not sent. Open the chat and resend the prompt if it still matters.' + detail;
    }
    if (kind === 'create') {
      return 'Conversation was not created. Check provider/model readiness and thread storage before retrying.' + detail;
    }
    return 'Chat action failed.' + detail;
  }

  function renderProjectMcpServerRibbon(threadMeta) {
    var mcpAccess = (threadMeta && threadMeta.mcpAccess) || {};
    var servers = Array.isArray(mcpAccess.servers) ? mcpAccess.servers.filter(Boolean) : [];
    var examples = Array.isArray(mcpAccess.examples) ? mcpAccess.examples.filter(Boolean) : [];
    var serverCopy = servers.length
      ? servers.slice(0, 8).join(', ')
      : mcpAccess.scope === 'configured'
        ? 'All configured MCP servers allowed by connector permissions'
        : 'Approved project MCP servers';
    var extraCount = servers.length > 8 ? ' +' + (servers.length - 8) + ' more' : '';
    var exampleCopy = examples.length
      ? examples.slice(0, 3).join(' / ')
      : 'Latest emails, sender summaries, document drafts, and custom source reads';
    return (
      '<div class="webchat-mcp-server-ribbon" aria-label="Available MCP server scope">' +
      '<span>Available MCP scope</span>' +
      '<strong>' +
      esc(serverCopy + extraCount) +
      '</strong>' +
      '<small>Use these for read-only source gathering. External document publishing, email sends, calendar edits, and third-party updates ask for approval first.</small>' +
      '<small>Examples: ' +
      esc(exampleCopy) +
      '</small>' +
      '</div>'
    );
  }

  function renderProjectToolStarters(threadMeta) {
    return (
      '<div class="webchat-project-tools" aria-label="Cowork MCP starters">' +
      '<div class="webchat-project-tools-head">' +
      '<span>MCP actions</span>' +
      '<small>Ask for email summaries, sender checks, project documents, calendar follow-ups, or any approved connector workflow. Writes stay behind approvals.</small>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-webchat-action="use-project-runbook">Use MCP runbook</button>' +
      '</div>' +
      renderProjectMcpServerRibbon(threadMeta) +
      '<div class="webchat-project-tool-grid">' +
      PROJECT_TOOL_STARTERS.map(function (starter, index) {
        return (
          '<button type="button" class="webchat-project-tool" data-webchat-action="use-project-tool" data-starter-index="' +
          index +
          '">' +
          '<span>' +
          esc(starter.title) +
          '</span>' +
          '<small>' +
          esc(starter.description) +
          '</small>' +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '<div class="webchat-mcp-command-strip">' +
      PROJECT_MCP_COMMANDS.map(function (command, index) {
        return (
          '<button type="button" data-webchat-action="use-project-mcp-command" data-command-index="' +
          index +
          '">' +
          '<span>' +
          esc(command.title) +
          '</span>' +
          '<small><strong>Source</strong> ' +
          esc(command.source) +
          '</small>' +
          '<small><strong>Output</strong> ' +
          esc(command.output) +
          '</small>' +
          '<small><strong>Approval</strong> ' +
          esc(command.approval) +
          '</small>' +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '<div class="webchat-mcp-source-flow" aria-label="MCP source-to-document checklist">' +
      PROJECT_MCP_SOURCE_STEPS.map(function (step) {
        return (
          '<article>' +
          '<span>' +
          esc((step.label || '').split(' ')[0] || 'Source') +
          '</span>' +
          '<strong>' +
          esc(step.label) +
          '</strong>' +
          '<small>' +
          esc(step.detail) +
          '</small>' +
          '</article>'
        );
      }).join('') +
      '</div>' +
      '</div>'
    );
  }

  function projectMcpRunbookPromptText(state) {
    state = state || window._webchatThreadBriefState || {};
    var threadMeta = state.threadMeta || {};
    var projectName = threadMeta.projectName || threadMeta.projectId || 'this Cowork project';
    var scope = formatMcpAccessSummary(threadMeta).promptScope;
    return [
      'Use MCP tools from this Cowork project chat.',
      '',
      'Project: ' + projectName,
      'Available MCP scope: ' + scope,
      'Goal: gather approved external context, then create a durable local project artifact.',
      '',
      'Source request',
      '- If I ask for latest emails, use the configured mail MCP server and state the date/window you searched.',
      '- If I ask for emails from someone, search that sender or domain and summarize commitments, deadlines, open questions, and suggested replies.',
      '- If I ask for a document or summary, combine MCP evidence with project files and previous project chat context when useful.',
      '',
      'Output rules',
      '- Save the first summary, brief, or document draft inside the Cowork project workspace before publishing anywhere else.',
      '- Include a source ledger naming each MCP server, tool-call purpose, query window or sender filter, and created project file path.',
      '- Separate confirmed facts, assumptions, missing facts, and recommended next actions.',
      '',
      'Approval boundary',
      '- Reading approved source systems and writing local project drafts can happen in chat.',
      '- Ask for approval before sending email, publishing or updating external documents, changing calendar events, calling webhooks, or updating third-party records.',
      '- If the needed MCP tool is not exposed, say exactly what connector or permission is missing instead of inventing source results.',
    ].join('\n');
  }

  function projectMcpPromptContextText(state) {
    state = state || window._webchatThreadBriefState || {};
    var threadMeta = state.threadMeta || {};
    var projectName = threadMeta.projectName || threadMeta.projectId || 'this Cowork project';
    var scope = formatMcpAccessSummary(threadMeta).promptScope;
    return [
      'Cowork MCP context:',
      '- Project: ' + projectName,
      '- Available MCP scope: ' + scope,
      '- Use approved MCP servers for email, calendar, document, storage, or custom source gathering when they fit the request.',
      '- Local output default: save the first summary, brief, document, or artifact inside the Cowork project workspace.',
      '- Source ledger required: MCP server, tool-call purpose, query window or sender/topic filter, cited evidence, and created project file path.',
      '- Approval boundary: ask before sending email, publishing or updating external documents, changing calendar events, calling webhooks, or mutating third-party systems.',
      '- Missing tool behavior: say which connector or permission is missing instead of inventing source results.',
    ].join('\n');
  }

  function projectMcpScopedPrompt(prompt, state) {
    return [
      projectMcpPromptContextText(state),
      '',
      'Request:',
      String(prompt || '').trim(),
    ].join('\n');
  }

  function renderPlainThreadBrief(threadMeta) {
    var title = threadMeta?.title || _activeThreadTitle || 'New conversation';
    var mcpText = plainChatMcpAccessText(threadMeta);
    return (
      '<section class="webchat-plain-brief" aria-label="Plain chat context">' +
      '<div class="webchat-plain-main">' +
      '<span>Plain chat</span>' +
      '<strong>' +
      esc(title) +
      '</strong>' +
      '<p>Quick AI conversation without project files or agent templates. Use it for thinking, writing, planning, and lightweight questions.</p>' +
      '</div>' +
      '<div class="webchat-plain-meta">' +
      '<span>No project context</span>' +
      '<span>' +
      esc(mcpText) +
      '</span>' +
      '</div>' +
      '<div class="webchat-plain-starters">' +
      CHAT_STARTERS.map(function (starter, index) {
        return (
          '<button type="button" data-webchat-action="use-starter" data-starter-index="' +
          index +
          '">' +
          esc(starter.title) +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '</section>'
    );
  }

  function chatThreadBriefText(state) {
    state = state || window._webchatThreadBriefState || {};
    var threadMeta = state.threadMeta || {};
    var isProjectChat = Boolean(threadMeta.projectId);
    var title = state.title || threadMeta.title || _activeThreadTitle || 'New conversation';
    var messages = Array.isArray(state.messages) ? state.messages : [];
    var messageLines = messages
      .slice(0, 6)
      .map(function (message) {
        var speaker = message.is_bot_message ? 'Agent' : 'User';
        var content = String(message.content || '').replace(/\s+/g, ' ').trim();
        if (content.length > 180) content = content.slice(0, 177) + '...';
        return '- ' + speaker + ': ' + content;
      })
      .filter(Boolean);
    var starters = Array.isArray(state.starters) ? state.starters : CHAT_STARTERS;
    var projectCommands = Array.isArray(state.projectCommands)
      ? state.projectCommands
      : PROJECT_MCP_COMMANDS;
    var loadIssues = Array.isArray(state.loadIssues)
      ? state.loadIssues.filter(Boolean)
      : [];
    var mcpAccess = threadMeta.mcpAccess || {};
    var mcpSummary = formatMcpAccessSummary(threadMeta);
    var mcpEnabled = isProjectChat && mcpSummary.enabled;
    var lines = [
      'Web chat thread brief',
      'Title: ' + title,
      'Thread id: ' + (state.threadId || _activeThreadId || 'unknown'),
      '',
      isProjectChat
        ? 'Mode: Cowork project chat. Project chat can use Cowork context, approved MCP tools, and project artifacts.'
        : 'Mode: Plain chat. Plain chat has no project files, artifacts, or agent template.',
      isProjectChat
        ? 'Project: ' + (threadMeta.projectName || threadMeta.projectId || 'Project')
        : 'Scope: Quick AI conversation for thinking, writing, planning, and lightweight questions.',
      isProjectChat
        ? 'MCP access: ' + (mcpEnabled ? mcpSummary.briefScope : 'not enabled for this project chat')
        : 'MCP access: ' + plainChatMcpAccessText(threadMeta),
      'Approval boundary: External writes, sent messages, published documents, and calendar changes stay approval-gated.',
      'Data health: ' +
        (loadIssues.length
          ? loadIssues.join('; ')
          : 'Thread messages and metadata loaded without known fallback.'),
      '',
      'Useful starters:',
    ];
    starters.slice(0, 4).forEach(function (starter) {
      lines.push('- ' + starter.title + ': ' + starter.description);
    });
    if (isProjectChat && mcpEnabled) {
      lines.push('', 'Cowork MCP commands:');
      projectCommands.forEach(function (command) {
        lines.push(
          '- ' +
            command.title +
            ' | source: ' +
            command.source +
            ' | output: ' +
            command.output +
            ' | approval: ' +
            command.approval,
        );
      });
      if (Array.isArray(mcpAccess.examples) && mcpAccess.examples.length) {
        lines.push('', 'MCP request examples:');
        mcpAccess.examples.forEach(function (example) {
          lines.push('- ' + example);
        });
      }
      lines.push('', 'MCP source-to-document checklist:');
      PROJECT_MCP_SOURCE_STEPS.forEach(function (step) {
        lines.push('- ' + step.label + ': ' + step.detail);
      });
    }
    lines.push('', 'Recent visible messages:');
    lines.push(messageLines.length ? messageLines.join('\n') : '- No messages yet.');
    return lines.join('\n');
  }

  function openProjectContext(projectId) {
    if (projectId) {
      try {
        sessionStorage.setItem('project_focus_id', String(projectId));
      } catch (_) {
        // Ignore private-mode/sessionStorage failures; navigation still works.
      }
    }
    navigate('projects');
  }

  // ── public API ─────────────────────────────────────────────────────────────

  async function loadThreads() {
    installWebChatActionHandlers();
    await loadChatProjects();
    try {
      var t = await api('/threads');
      window._webchatThreadListLoadIssue = '';
      return Array.isArray(t) ? t : [];
    } catch (e) {
      window._webchatThreadListLoadIssue =
        'Thread list unavailable' + (e && e.message ? ': ' + e.message : '');
      return [];
    }
  }

  function renderThreadList(threads, currentId) {
    installWebChatActionHandlers();
    installThreadListHandlers();
    if (!Array.isArray(threads)) threads = [];
    var newBtn =
      '<button type="button" class="webchat-project-create" data-webchat-action="create-chat-project">＋ Project</button>' +
      '<a class="nav-link" data-webchat-action="open-new-conversation">' +
      navIcon('chat') +
      '<span class="nav-label">&#xFE0E;＋ New conversation</span></a>';

    var threadItems = '';
    if (!threads || threads.length === 0) {
      threadItems = renderThreadSidebarEmptyState(
        window._webchatThreadListLoadIssue ? 'error' : 'empty',
      );
    } else {
      threadItems =
        renderChatProjectSections(threads, currentId) +
        '<div class="thread-list">' +
        threads
          .filter(function (t) { return !t.chatProjectId; })
          .map(function (t) {
            var isActive = t.id === currentId;
            return renderThreadListItem(t, isActive);
          })
          .join('') +
        '</div>';
    }

    return newBtn + threadItems;
  }

  function renderThreadListItem(t, isActive) {
    var projectButtons = (_chatProjects || [])
      .map(function (project) {
        if (project.id === t.chatProjectId) return '';
        return (
          '<button type="button" data-webchat-action="assign-chat-project" data-thread-id="' +
          esc(t.id) +
          '" data-chat-project-id="' +
          esc(project.id) +
          '" title="Move to ' +
          esc(project.name) +
          '">Move to ' +
          esc(project.name) +
          '</button>'
        );
      })
      .join('');
    var ungroupButton = t.chatProjectId
      ? '<button type="button" data-webchat-action="assign-chat-project" data-thread-id="' +
        esc(t.id) +
        '" data-chat-project-id="" title="Remove from project">Remove from project</button>'
      : '';
    return (
      '<div class="webchat-thread-row">' +
      '<a class="nav-link webchat-thread-link' +
      (isActive ? ' active' : '') +
      '" data-thread-id="' +
      esc(t.id) +
      '" data-thread-title="' +
      esc(t.title || t.id) +
      '">' +
      navIcon('messages') +
      '<span class="nav-label">' +
      esc(t.title || t.id) +
      '</span></a>' +
      '<div class="webchat-thread-move" aria-label="Move chat">' +
      ungroupButton +
      projectButtons +
      '</div>' +
      '</div>'
    );
  }

  function renderChatProjectSections(threads, currentId) {
    var projects = Array.isArray(_chatProjects) ? _chatProjects : [];
    if (!projects.length) return '';
    return projects
      .map(function (project) {
        var projectThreads = threads.filter(function (thread) {
          return thread.chatProjectId === project.id;
        });
        return (
          '<section class="webchat-project-section" aria-label="' +
          esc(project.name) +
          '">' +
          '<div class="webchat-project-section-head">' +
          '<span>' +
          esc(project.name) +
          '</span>' +
          '<small>' +
          projectThreads.length +
          '</small>' +
          '</div>' +
          (projectThreads.length
            ? projectThreads
                .map(function (thread) {
                  return renderThreadListItem(thread, thread.id === currentId);
                })
                .join('')
            : '<p>Virtual folders for related chats</p>') +
          '</section>'
        );
      })
      .join('');
  }

  function createChatProject() {
    openInputModal({
      title: 'New chat project',
      body: 'Create a virtual folder for related Chat conversations.',
      label: 'Project name',
      actionLabel: 'Create',
      emptyMessage: 'Enter a project name',
      errorPrefix: 'Project creation failed',
      onSubmit: async function (name) {
        await api('/threads/projects', {
          method: 'POST',
          body: JSON.stringify({ name: name }),
        });
        refreshThreadList();
      },
    });
  }

  async function assignChatProject(threadId, chatProjectId) {
    if (!threadId) return;
    try {
      await api('/threads/' + encodeURIComponent(threadId), {
        method: 'PATCH',
        body: JSON.stringify({ chatProjectId: chatProjectId || null }),
      });
      refreshThreadList();
    } catch (e) {
      toast('Could not move chat: ' + e.message, 'error');
    }
  }

  function installThreadListHandlers() {
    if (_threadListHandlersInstalled) return;
    _threadListHandlersInstalled = true;
    document.addEventListener('click', function (event) {
      var target =
        event.target && event.target.closest
          ? event.target.closest('.webchat-thread-link')
          : null;
      if (!target) return;
      event.preventDefault();
      openThread(target.dataset.threadId, target.dataset.threadTitle);
    });
  }

  function renderThreadSidebarEmptyState(kind) {
    var isError = kind === 'error';
    var issue = window._webchatThreadListLoadIssue || 'Thread list unavailable';
    return (
      '<section class="thread-sidebar-empty' +
      (isError ? ' is-error' : '') +
      '" aria-label="' +
      (isError ? 'Chat conversation list unavailable' : 'No Chat conversations yet') +
      '">' +
      '<span>' +
      (isError ? 'Data health' : 'Chat queue') +
      '</span>' +
      '<strong>' +
      (isError ? 'Chat list unavailable' : 'No chats yet') +
      '</strong>' +
      '<p>' +
      (isError
        ? esc(issue) + '. Retry the list, or start a new chat if thread storage is healthy.'
        : 'Start a plain chat for quick thinking. Use Cowork when the request needs project files, MCP tools, or durable artifacts.') +
      '</p>' +
      '<button type="button" data-webchat-action="' +
      (isError ? 'retry-thread-list' : 'open-new-conversation') +
      '">' +
      (isError ? 'Retry list' : 'New chat') +
      '</button>' +
      '</section>'
    );
  }

  function setActiveThreadId(id) {
    _activeThreadId = id;
  }

  function openThread(id, title) {
    _activeThreadId = id;
    if (typeof title === 'string') _activeThreadTitle = title;
    var nextHash = '#/chat/' + encodeURIComponent(String(id).replace(/^web:/, ''));
    if (location.hash === nextHash) {
      var el = conversationRoot();
      if (el) renderConversation(el, _activeThreadId, _activeThreadTitle);
      return;
    }
    location.hash = nextHash;
  }

  // Render thread conversation into el, or an empty state if threadId is null.
  // When `title` is provided (sidebar nav), use it directly instead of fetching
  // the full thread list. Deep-link/reload paths pass no title → fallback fetch.
  async function renderConversation(el, threadId, title) {
    installWebChatActionHandlers();
    // Clean up any leftover progress timer from a previous page
    if (window._progressTimeout) {
      clearTimeout(window._progressTimeout);
      window._progressTimeout = null;
    }

    if (!threadId) {
      await loadChatProjects();
      var choices = await loadWebChatProviderChoices();
      el.innerHTML = renderNewConversationStart(choices);
      var modelSearch = document.getElementById('webchat-start-model-search');
      if (modelSearch) modelSearch.oninput = filterStartModelOptions;
      var startInput = document.getElementById('webchat-start-input');
      if (startInput) {
        startInput.oninput = function () {
          resizeChatInput(startInput);
        };
        startInput.onkeydown = function (e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            startConversationFromComposer();
          }
        };
        resizeChatInput(startInput);
        setTimeout(function () {
          if (document.activeElement === document.body) startInput.focus();
        }, 0);
      }
      return;
    }

    _activeThreadId = threadId;
    var threadLoadIssues = [];
    var messagesLoadFailed = false;

    // Render shell immediately so the user sees the layout fast
    el.innerHTML =
      '<section class="webchat-chatgpt-shell">' +
      '<div class="webchat-chatgpt-topbar">' +
      '<h2 class="webchat-thread-title" id="thread-title">Loading…</h2>' +
      '<div class="webchat-thread-actions">' +
      '<button class="btn btn-sm btn-ghost webchat-thread-action" id="thread-copy-brief-btn">Copy chat brief</button>' +
      '<button class="btn btn-sm btn-ghost webchat-thread-action" id="thread-rename-btn">Rename</button>' +
      '<button class="btn btn-sm btn-danger webchat-thread-action" id="thread-delete-btn">Delete</button>' +
      '</div>' +
      '</div>' +
      '<div class="webchat-chatgpt-context" id="thread-context-banner"></div>' +
      '<div class="webchat-thread-card">' +
      '<div class="chat-messages" id="chat-messages-area">' +
      renderWebchatLoadingState() +
      '</div>' +
      '<div class="chat-progress-bar" id="chat-progress-bar" data-webchat-action="toggle-progress-history">' +
      '<span class="progress-spinner" id="progress-spinner"></span>' +
      '<span class="progress-phase" id="progress-phase">Thinking…</span>' +
      '<div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>' +
      '<span class="progress-pct" id="progress-pct">0%</span>' +
      '</div>' +
      '<div class="chat-progress-history" id="chat-progress-history"></div>' +
      '<div class="webchat-chatgpt-composer">' +
      '<div class="chat-input">' +
      '<textarea id="chat-msg-input" rows="1" placeholder="Message Taskekrabben" autocomplete="off"></textarea>' +
      '<button class="btn btn-sm btn-primary" id="chat-send-btn" aria-label="Send message" title="Send message">Send</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</section>';

    var chatMessages = [];
    var messagesArea = document.getElementById('chat-messages-area');

    function renderMessages() {
      if (!messagesArea) return;
      if (messagesLoadFailed) {
        messagesArea.innerHTML = renderThreadMessageLoadIssue(
          'The message API failed while opening this thread.',
        );
        return;
      }
      if (chatMessages.length === 0) {
        messagesArea.innerHTML = renderEmptyThreadState(threadMeta);
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

    function updateThreadBriefState(threadMeta) {
      window._webchatThreadBriefState = {
        threadId: threadId,
        title: _activeThreadTitle || title || (threadMeta && threadMeta.title) || 'New conversation',
        threadMeta: threadMeta || {},
        messages: chatMessages.slice(),
        starters: CHAT_STARTERS,
        projectCommands: PROJECT_MCP_COMMANDS,
        loadIssues: threadLoadIssues.slice(),
      };
    }

    // Load messages
    try {
      var data = await api('/threads/' + encodeURIComponent(threadId) + '/messages');
      chatMessages = Array.isArray(data) ? data : [];
    } catch (e) {
      messagesLoadFailed = true;
      threadLoadIssues.push(
        'Thread messages unavailable' + (e && e.message ? ': ' + e.message : ''),
      );
      chatMessages = [];
    }
    renderMessages();

    // Load thread metadata and title. Project-scoped threads are intentionally
    // hidden from the plain thread list, so detail lookup is the canonical path.
    var threadMeta = null;
    try {
      threadMeta = await api('/threads/' + encodeURIComponent(threadId));
    } catch (e) {
      threadLoadIssues.push(
        'Thread metadata unavailable' + (e && e.message ? ': ' + e.message : ''),
      );
      threadMeta = null;
    }
    updateThreadBriefState(threadMeta);
    renderMessages();
    var contextBanner = document.getElementById('thread-context-banner');
    if (contextBanner) {
      contextBanner.innerHTML =
        threadLoadIssues.some(function (issue) {
          return issue.indexOf('Thread metadata unavailable') === 0;
        })
          ? renderThreadContextUnavailable(threadId)
          : renderThreadContextBanner(threadMeta) || renderPlainThreadBrief(threadMeta);
    }

    // Load title — use the known title when provided, then detail metadata,
    // otherwise fetch the list for older/mock routes.
    var knownTitle = typeof title === 'string' ? title : null;
    if (knownTitle) {
      _activeThreadTitle = knownTitle;
      updateThreadBriefState(threadMeta);
      var titleElDirect = document.getElementById('thread-title');
      if (titleElDirect) titleElDirect.textContent = knownTitle;
    } else if (threadMeta && threadMeta.title) {
      _activeThreadTitle = threadMeta.title;
      updateThreadBriefState(threadMeta);
      var titleElMeta = document.getElementById('thread-title');
      if (titleElMeta) titleElMeta.textContent = threadMeta.title;
    } else {
      try {
        var threads = await api('/threads');
        var thisThread = threads.find(function (t) { return t.id === threadId; });
        var titleEl = document.getElementById('thread-title');
        if (titleEl && thisThread) {
          titleEl.textContent = thisThread.title || threadId;
          _activeThreadTitle = thisThread.title || threadId;
          updateThreadBriefState(threadMeta);
        }
      } catch (e) {
        threadLoadIssues.push(
          'Thread title lookup unavailable' + (e && e.message ? ': ' + e.message : ''),
        );
        updateThreadBriefState(threadMeta);
        var titleElFallback = document.getElementById('thread-title');
        if (titleElFallback) titleElFallback.textContent = threadId;
        _activeThreadTitle = threadId;
      }
    }

    // Send message
    async function sendMessage() {
      var input = document.getElementById('chat-msg-input');
      var btn = document.getElementById('chat-send-btn');
      if (!input || !btn || btn.disabled) return;
      var msg = input.value.trim();
      if (!msg) return;
      input.value = '';
      resizeChatInput(input);
      btn.disabled = true;

      // Fallback progress timer
      if (window._progressTimeout) clearTimeout(window._progressTimeout);
      window._progressTimeout = setTimeout(function () {
        var bar = document.getElementById('chat-progress-bar');
        if (bar && !bar.classList.contains('visible')) {
          bar.classList.add('visible');
          var phase = document.getElementById('progress-phase');
          if (phase) phase.textContent = 'Agent is thinking…';
          var fill = document.getElementById('progress-fill');
          setProgressFill(fill, 0);
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
      updateThreadBriefState(threadMeta);

      try {
        await api('/threads/' + encodeURIComponent(threadId) + '/messages', {
          method: 'POST',
          body: JSON.stringify({ message: msg }),
        });
      } catch (e) {
        if (window._progressTimeout) {
          clearTimeout(window._progressTimeout);
          window._progressTimeout = null;
        }
        chatMessages = chatMessages.filter(function (message) {
          return message.content !== msg || message.sender_name !== 'You' || message.is_bot_message !== false;
        });
        input.value = msg;
        resizeChatInput(input);
        renderMessages();
        threadLoadIssues.push(
          'Last message send failed' + (e && e.message ? ': ' + e.message : ''),
        );
        updateThreadBriefState(threadMeta);
        toast(chatActionErrorMessage('send', e), 'error');
      } finally {
        btn.disabled = false;
        if (input) input.focus();
      }
    }

    var sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) sendBtn.onclick = sendMessage;
    var inputEl = document.getElementById('chat-msg-input');
    if (inputEl) {
      inputEl.oninput = function () {
        resizeChatInput(inputEl);
      };
      inputEl.onkeydown = function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      };
      resizeChatInput(inputEl);
    }

    var copyBriefBtn = document.getElementById('thread-copy-brief-btn');
    if (copyBriefBtn) {
      copyBriefBtn.onclick = function () {
        updateThreadBriefState(threadMeta);
        WebChat.copyThreadBrief();
      };
    }

    // Rename
    var renameBtn = document.getElementById('thread-rename-btn');
    if (renameBtn) {
      renameBtn.onclick = function () {
        var titleEl = document.getElementById('thread-title');
        var current = titleEl ? titleEl.textContent : '';
        openInputModal({
          title: 'Rename conversation',
          body: 'Give this chat a title that makes it easy to find later.',
          label: 'Conversation title',
          value: current,
          actionLabel: 'Rename',
          emptyMessage: 'Enter a conversation title',
          errorPrefix: 'Rename failed',
          onSubmit: async function (newTitle) {
            await api('/threads/' + encodeURIComponent(threadId), {
              method: 'PATCH',
              body: JSON.stringify({ title: newTitle }),
            });
            if (titleEl) titleEl.textContent = newTitle;
            _activeThreadTitle = newTitle;
            updateThreadBriefState(threadMeta);
            toast('Renamed', 'success');
            // Refresh sidebar
            var navEl = document.getElementById('chat-thread-nav');
            if (navEl && window.WebChat) {
              WebChat.loadThreads().then(function (ts) {
                navEl.innerHTML = WebChat.renderThreadList(ts, _activeThreadId);
              });
            }
          },
        });
      };
    }

    // Delete
    var deleteBtn = document.getElementById('thread-delete-btn');
    if (deleteBtn) {
      deleteBtn.onclick = function () {
        openConfirmModal({
          title: 'Delete conversation',
          body: 'This removes the conversation and its local thread history from the chat workspace.',
          actionLabel: 'Delete',
          errorPrefix: 'Delete failed',
          onConfirm: async function () {
            await api('/threads/' + encodeURIComponent(threadId), { method: 'DELETE' });
            toast('Deleted', 'success');
            _activeThreadId = null;
            location.hash = '#/chat';
          },
        });
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
        if (!bar || !phase || !fill || !pct) return;
        bar.classList.add('visible');
        phase.textContent = msg.data.message || msg.data.phase;
        setProgressFill(fill, msg.data.pct);
        pct.textContent = msg.data.pct + '%';
        var history = document.getElementById('chat-progress-history');
        if (history) {
          var entry = document.createElement('div');
          entry.className =
            'phase-entry' + (msg.data.pct >= 100 ? ' done' : ' active');
          entry.innerHTML =
            '<span class="phase-entry-marker">' +
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
        }
        return;
      }

      if (msg.type === 'new_message') {
        var m = msg.data;
        chatMessages.unshift(m);
        renderMessages();
        updateThreadBriefState(threadMeta);
        return;
      }

      if (msg.type === 'thread_title') {
        _activeThreadTitle = msg.data.title;
        updateThreadBriefState(threadMeta);
        var threadTitleEl = document.getElementById('thread-title');
        if (threadTitleEl) threadTitleEl.textContent = msg.data.title;
        var threadNavEl = document.getElementById('chat-thread-nav');
        if (threadNavEl && window.WebChat) {
          WebChat.loadThreads().then(function (ts) {
            threadNavEl.innerHTML = WebChat.renderThreadList(ts, _activeThreadId);
          });
        }
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
          '<div class="chat-tool-call-header" data-webchat-action="toggle-tool-call">' +
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
            '<div class="chat-tool-call-header" data-webchat-action="toggle-tool-call">' +
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
              '<div class="section-label section-label-result">Result</div>' +
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

  async function openNewConversationModal(starter) {
    // Close any existing modal
    closeModal();
    var selectedStarter =
      starter && typeof starter.prompt === 'string' ? starter : null;

    var providerInfo = {};
    try {
      providerInfo = await api('/system/provider');
    } catch (_) {
      providerInfo = {};
    }

    var fallbackDefinitions = fallbackProviderDefinitions();
    var providerDefinitions = providerInfo.definitions || fallbackDefinitions;
    var providerModels = providerInfo.models || {};
    var providerDefaults = providerInfo.defaults || {};
    var available = providerInfo.available || {};
    var providerOptions = Object.values(providerDefinitions)
      .filter(function (p) { return p && p.selectable !== false; })
      .map(function (p) {
        return {
          id: p.id,
          name: p.name || p.id,
          available: available[p.id] !== false,
        };
      });
    if (!providerOptions.length) {
      providerOptions = Object.values(fallbackDefinitions).map(function (p) {
        return { id: p.id, name: p.name || p.id, available: true };
      });
    }

    var lastProvider = localStorage.getItem('webchat_last_provider') || providerInfo.provider || providerOptions[0].id;
    if (!providerOptions.some(function (p) { return p.id === lastProvider; })) {
      lastProvider = providerOptions[0].id;
    }

    function modelsFor(providerId) {
      var models = providerModels[providerId] || [];
      if (models.length) return models;
      if (providerDefaults[providerId]) return [providerDefaults[providerId]];
      if (providerId === providerInfo.provider && providerInfo.model) return [providerInfo.model];
      return ['model-id'];
    }

    var lastModel = localStorage.getItem('webchat_last_model_' + lastProvider) || providerDefaults[lastProvider] || providerInfo.model || modelsFor(lastProvider)[0];
    if (!modelsFor(lastProvider).includes(lastModel)) {
      lastModel = modelsFor(lastProvider)[0];
    }

    function renderProviderOptions() {
      return providerOptions
        .map(function (p) {
          return (
            '<option value="' + esc(p.id) + '"' + (p.id === lastProvider ? ' selected' : '') + '>' +
            esc(p.name) +
            (p.available ? '' : ' (not configured)') +
            '</option>'
          );
        })
        .join('');
    }

    function renderModelOptions(providerId, selectedModel) {
      return modelsFor(providerId)
        .map(function (model) {
          return '<option value="' + esc(model) + '"' + (model === selectedModel ? ' selected' : '') + '>' + esc(model) + '</option>';
        })
        .join('');
    }

    var starterPreview = selectedStarter
      ? '<div class="webchat-starter-preview">' +
        '<div class="webchat-starter-preview-label">Starter prompt</div>' +
        '<div class="webchat-starter-preview-title">' + esc(selectedStarter.title) + '</div>' +
        '<div class="webchat-starter-preview-text">' + esc(selectedStarter.prompt) + '</div>' +
        '</div>'
      : '';

    var modalHtml =
      '<div id="webchat-modal-overlay">' +
      '<div id="webchat-modal-panel" role="dialog" aria-modal="true" aria-labelledby="webchat-modal-title">' +
      '<div class="webchat-modal-head">' +
      '<h3 id="webchat-modal-title">New conversation</h3>' +
      '<p>Choose the provider for this chat. Leave the title blank to let the first exchange name it.</p>' +
      '</div>' +
      starterPreview +
      '<div class="webchat-modal-grid">' +
      '<label class="webchat-modal-field">Provider' +
      '<select id="wc-provider-select" class="search-input">' + renderProviderOptions() + '</select></label>' +
      '<label class="webchat-modal-field">Model' +
      '<select id="wc-model-select" class="search-input">' + renderModelOptions(lastProvider, lastModel) + '</select></label>' +
      '</div>' +
      '<label class="webchat-modal-field">Title <span>(optional)</span>' +
      '<input type="text" id="wc-title-input" class="search-input" placeholder="Optional"></label>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" id="wc-cancel-btn">Cancel</button>' +
      '<button type="button" class="btn btn-primary" id="wc-create-btn">Create</button>' +
      '</div>' +
      '</div>' +
      '</div>';

    var wrapper = document.createElement('div');
    wrapper.innerHTML = modalHtml;
    _modalEl = wrapper.firstElementChild;
    document.body.appendChild(_modalEl);

    var providerSelect = document.getElementById('wc-provider-select');
    var modelSelect = document.getElementById('wc-model-select');
    if (providerSelect && modelSelect) {
      providerSelect.onchange = function () {
        var selectedProvider = providerSelect.value;
        var selectedModel =
          localStorage.getItem('webchat_last_model_' + selectedProvider) ||
          providerDefaults[selectedProvider] ||
          modelsFor(selectedProvider)[0];
        modelSelect.innerHTML = renderModelOptions(selectedProvider, selectedModel);
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

        var selectedProvider = document.getElementById('wc-provider-select');
        var selectedModel = document.getElementById('wc-model-select');
        if (selectedProvider && selectedProvider.value) {
          body.provider = selectedProvider.value;
          localStorage.setItem('webchat_last_provider', selectedProvider.value);
        }
        if (selectedModel && selectedModel.value) {
          body.model = selectedModel.value;
          if (selectedProvider && selectedProvider.value) {
            localStorage.setItem('webchat_last_model_' + selectedProvider.value, selectedModel.value);
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
          var starterError = null;
          if (selectedStarter && selectedStarter.prompt) {
            createBtn.textContent = 'Starting…';
            try {
              await api('/threads/' + encodeURIComponent(resp.id) + '/messages', {
                method: 'POST',
                body: JSON.stringify({ message: selectedStarter.prompt }),
              });
            } catch (e) {
              starterError = e;
            }
          }
          closeModal();
          openThread(resp.id);
          if (starterError) {
            toast(chatActionErrorMessage('starter', starterError), 'error');
          }
        } catch (e) {
          toast(chatActionErrorMessage('create', e), 'error');
          createBtn.disabled = false;
          createBtn.textContent = 'Create';
        }
      };
    }
  }

  function startFromPrompt(index) {
    var starter = getStarter(index);
    if (!starter) return;
    var input = document.getElementById('webchat-start-input');
    if (!input) {
      openNewConversationSurface();
      setTimeout(function () {
        var nextInput = document.getElementById('webchat-start-input');
        if (!nextInput) return;
        nextInput.value = starter.prompt;
        resizeChatInput(nextInput);
        nextInput.focus();
      }, 0);
      return;
    }
    input.value = starter.prompt;
    resizeChatInput(input);
    input.focus();
  }

  function useProjectToolPrompt(index) {
    var starter = getProjectToolStarter(index);
    if (!starter) return;
    var input = document.getElementById('chat-msg-input');
    if (!input) {
      toast('Open the chat input before using this prompt', 'warning');
      return;
    }
    input.value = projectMcpScopedPrompt(starter.prompt, window._webchatThreadBriefState);
    resizeChatInput(input);
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function useProjectMcpCommand(index) {
    var numeric = Number(index);
    if (!Number.isInteger(numeric)) return;
    var command = PROJECT_MCP_COMMANDS[numeric];
    if (!command) return;
    var input = document.getElementById('chat-msg-input');
    if (!input) {
      toast('Open the chat input before using this command', 'warning');
      return;
    }
    input.value = projectMcpScopedPrompt(command.prompt, window._webchatThreadBriefState);
    resizeChatInput(input);
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function useProjectMcpRunbook() {
    var input = document.getElementById('chat-msg-input');
    if (!input) {
      toast('Open the chat input before using the MCP runbook', 'warning');
      return;
    }
    input.value = projectMcpRunbookPromptText(window._webchatThreadBriefState);
    resizeChatInput(input);
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function useStarterPrompt(index) {
    var starter = getStarter(index);
    if (!starter) return;
    var input = document.getElementById('chat-msg-input');
    if (!input) {
      openNewConversationSurface();
      setTimeout(function () {
        var nextInput = document.getElementById('webchat-start-input');
        if (!nextInput) return;
        nextInput.value = starter.prompt;
        resizeChatInput(nextInput);
        nextInput.focus();
      }, 0);
      return;
    }
    input.value = starter.prompt;
    resizeChatInput(input);
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function copyThreadBrief() {
    var text = chatThreadBriefText(window._webchatThreadBriefState);
    await copyTextWithFallback(text, 'Copied chat brief', 'Copy web chat thread brief');
  }

  // ── expose ─────────────────────────────────────────────────────────────────

  window.WebChat = {
    loadThreads: loadThreads,
    renderThreadList: renderThreadList,
    openThread: openThread,
    setActiveThreadId: setActiveThreadId,
    renderConversation: renderConversation,
    openNewConversationModal: openNewConversationModal,
    startFromPrompt: startFromPrompt,
    useStarterPrompt: useStarterPrompt,
    useProjectToolPrompt: useProjectToolPrompt,
    useProjectMcpCommand: useProjectMcpCommand,
    useProjectMcpRunbook: useProjectMcpRunbook,
    projectMcpRunbookPromptText: projectMcpRunbookPromptText,
    openProjectContext: openProjectContext,
    chatThreadBriefText: chatThreadBriefText,
    copyThreadBrief: copyThreadBrief,
    get activeThreadId() { return _activeThreadId; },
  };
})();
