(function () {
  var activeProjectId = null;
  var activeProjectFilePath = null;
  var activeProjectDetail = null;
  var activeProjectRunId = null;
  var projectProviderState = null;
  var projectRunActionFeedback = {};
  var projectRunCitationFeedback = {};
  var PROJECT_ACTIONS = [
    {
      label: 'Email summary',
      meta: 'Mail MCP -> project brief',
      prompt:
        'Review the latest emails available through the configured mail MCP server. Summarize the important updates, decisions, deadlines, and recommended follow-up actions for this project. If document tools are available, draft a project summary document in the project workspace.',
    },
    {
      label: 'Project brief',
      meta: 'Files + chats -> plan',
      prompt:
        'Read the project files and recent project chat history. Create a concise project brief with current goals, open questions, blockers, next actions, and any documents or artifacts that should be created next.',
    },
    {
      label: 'Document draft',
      meta: 'Outcome-focused writing',
      prompt:
        'Create a polished document draft for this project. Use the project files as context, ask only for missing facts that block the draft, and save a markdown version in the project workspace when ready.',
    },
    {
      label: 'Attention scan',
      meta: 'Find what needs work',
      prompt:
        'Scan this project for anything that needs attention. Check files, previous chats, and available MCP context. Return a prioritized list of risks, waiting items, stale decisions, and the next three actions.',
    },
  ];
  var PROJECT_TOOL_LANES = [
    {
      label: 'Mail',
      meta: 'Search recent email and source threads',
      actionIndex: 0,
    },
    {
      label: 'Docs',
      meta: 'Draft summaries, briefs, and artifacts',
      actionIndex: 2,
    },
    {
      label: 'Calendar',
      meta: 'Check deadlines and follow-up windows',
      prompt:
        'Use the configured calendar MCP server to check project-related upcoming events, deadlines, and follow-up windows. Summarize anything that changes the project plan and suggest the next action.',
    },
    {
      label: 'MCP workflow',
      meta: 'Use any approved connector',
      prompt:
        'Use the approved MCP servers that fit this project request. Gather the needed external context, summarize what matters, cite the source systems or files used, and create a durable project artifact when useful. Ask before publishing, sending, or changing anything outside NanoCrab.',
    },
    {
      label: 'Code',
      meta: 'Review workspace files and implementation tasks',
      actionIndex: 1,
    },
  ];
  var PROJECT_MCP_RECIPES = [
    {
      label: 'Latest emails -> summary',
      prompt:
        'Use the configured mail MCP server to review the latest emails relevant to this project. Summarize decisions, deadlines, risks, and follow-up actions. Then draft a markdown summary in the project workspace and ask before publishing it externally.',
    },
    {
      label: 'Emails from X -> brief',
      prompt:
        'Use the configured mail MCP server to check recent emails from [person or domain]. Generate a concise project brief with the thread summary, promised follow-ups, open questions, and suggested replies. Do not send anything without approval.',
    },
    {
      label: 'Source context -> document',
      prompt:
        'Use project files, recent project chats, and approved document MCP tools to create a polished document. Save a markdown draft in the project workspace first, list assumptions, and request approval before creating or updating an external document.',
    },
  ];
  var PROJECT_TEMPLATES = [
    {
      name: 'Inbox digest',
      description: 'Turn recent email into a short source-backed project brief.',
      instructions:
        'Use approved mail MCP tools for source gathering. Save markdown summaries in the project workspace first. Ask before sending replies, publishing documents, or changing external systems.',
    },
    {
      name: 'Document workspace',
      description: 'Draft and refine a durable document from files, chats, and MCP context.',
      instructions:
        'Use project files as source-of-truth. Cite source systems and assumptions. Draft locally in markdown before creating or updating external documents.',
    },
    {
      name: 'Launch plan',
      description: 'Coordinate tasks, artifacts, risks, and code handoffs in one Cowork project.',
      instructions:
        'Track decisions, blockers, owners, and next actions. Route repository implementation to Code and keep external writes approval-gated.',
    },
  ];

  function renderProjectLoadingState() {
    return (
      '<section class="project-loading-state" aria-busy="true" aria-label="Loading Cowork projects">' +
      '<aside class="project-loading-sidebar">' +
      '<div><span></span><strong></strong></div>' +
      '<div><span></span><strong></strong></div>' +
      '<div><span></span><strong></strong></div>' +
      '</aside>' +
      '<div class="project-loading-main">' +
      '<span class="messages-kicker">Cowork loading</span>' +
      '<h2>Loading project workspaces</h2>' +
      '<p>Collecting virtual folders, source files, project chats, artifacts, and approved MCP context before opening the workbench.</p>' +
      '<div class="project-loading-flow">' +
      '<span>Projects</span>' +
      '<span>Files</span>' +
      '<span>Chats</span>' +
      '<span>MCP context</span>' +
      '</div>' +
      '</div>' +
      '</section>'
    );
  }

  function projectChatHash(projectId, threadId) {
    return (
      '#/projects/' +
      encodeURIComponent(String(projectId)) +
      '/chat/' +
      encodeURIComponent(String(threadId).replace(/^web:/, ''))
    );
  }

  function fileIcon(kind) {
    if (kind === 'image') return 'IMG';
    if (kind === 'document') return 'DOC';
    return 'ART';
  }

  function jsStringAttr(value) {
    return JSON.stringify(String(value || '')).replace(/"/g, '&quot;');
  }

  function projectFileDownloadHref(filePath) {
    if (!activeProjectId || !filePath) return '#';
    return (
      '/api/projects/' +
      encodeURIComponent(activeProjectId) +
      '/files/download?path=' +
      encodeURIComponent(filePath)
    );
  }

  function projectFileDownloadName(filePath) {
    var parts = String(filePath || '').split('/');
    return parts[parts.length - 1] || 'project-file';
  }

  function projectHandoffBriefText(detail) {
    if (!detail || !detail.project) return '';
    var project = detail.project;
    var files = detail.files || [];
    var threads = detail.threads || [];
    var mcpAccess = project.mcpAccess || {};
    var mcpServers = Array.isArray(mcpAccess.servers) ? mcpAccess.servers : [];
    var mcpExamples = Array.isArray(mcpAccess.examples) ? mcpAccess.examples : [];
    var providerLoadIssue = projectProviderState?.loadIssue || '';
    var lines = [
      'Cowork project handoff',
      '',
      'Project: ' + (project.name || 'Untitled project'),
      'Description: ' + (project.description || 'No description'),
      'Workspace: /workspace/extra/project-' + (project.slug || project.id || 'project'),
      'Files: ' + files.length,
      'Chats: ' + threads.length,
      'Instructions: ' + (project.instructions || 'No project instructions yet'),
      'MCP status: ' + (mcpAccess.enabled ? 'external tools available' : 'no external MCP servers connected'),
      'Provider data health: ' + (providerLoadIssue || 'Provider catalog loaded without known fallback.'),
      '',
      'Files',
      files.length
        ? files
            .slice(0, 12)
            .map(function (file) {
              return '- ' + file.path + ' (' + (file.kind || 'artifact') + ')';
            })
            .join('\n')
        : '- No project files yet',
      files.length > 12 ? '- ...and ' + (files.length - 12) + ' more files' : null,
      '',
      'Recent chats',
      threads.length
        ? threads
            .slice(0, 8)
            .map(function (thread) {
              return (
                '- ' +
                (thread.title || 'New conversation') +
                (thread.lastMessage ? ': ' + thread.lastMessage : '')
              );
            })
            .join('\n')
        : '- No project chats yet',
      threads.length > 8 ? '- ...and ' + (threads.length - 8) + ' more chats' : null,
      '',
      'MCP tools',
      mcpServers.length
        ? mcpServers
            .slice(0, 8)
            .map(function (server) {
              return '- ' + server;
            })
            .join('\n')
        : '- No external MCP servers connected yet. Use project files and local drafts, or configure mail, calendar, document, storage, or custom MCP servers before source gathering.',
      mcpServers.length > 8 ? '- ...and ' + (mcpServers.length - 8) + ' more MCP servers' : null,
      '',
      'MCP-ready requests',
      mcpExamples.length
        ? mcpExamples
            .slice(0, 8)
            .map(function (example) {
              return '- ' + example;
            })
            .join('\n')
        : [
            '- Latest emails -> source-backed project summary document.',
            '- Emails from a person or domain -> brief with follow-ups and open questions.',
            '- Project files plus document tools -> markdown draft saved in the workspace first.',
          ].join('\n'),
      mcpExamples.length > 8 ? '- ...and ' + (mcpExamples.length - 8) + ' more MCP examples' : null,
      '',
      'Agent use',
      '- Use project files and prior project chats as source context.',
      '- Use approved MCP tools for mail, calendar, documents, storage, and custom connector context when useful.',
      '- Save drafts, summaries, and artifacts in the project workspace first.',
      '- Ask before publishing external documents, sending messages, changing calendar events, or updating third-party data.',
      '',
      'Suggested next request',
      'Review this project handoff, identify what needs attention, and propose the next three useful actions.',
    ];
    return lines.filter(function (line) { return line !== null; }).join('\n');
  }

  function projectActionErrorMessage(kind, err) {
    var detail =
      typeof err === 'string'
        ? err
        : err?.error || err?.message || err?.statusText || '';
    var suffix = detail ? ' ' + detail : '';
    var messages = {
      create:
        'Project was not created. Check the name, instructions, and whether the Cowork project store is writable.',
      file:
        'Project file was not created. Check the relative path, file name, and whether this workspace should hold the draft or artifact.',
      context:
        'Project context was not saved. Keep using the current instructions, then retry after checking the project store.',
      handoff:
        'Project handoff could not be loaded. Refresh the project before copying context into another chat or agent lane.',
      chat:
        'Project chat was not started. Check provider/model readiness, project context, and whether MCP-backed source work should wait.',
      firstMessage:
        'Project chat was created, but the first message was not sent. Open the chat and resend the prompt before assuming the agent received it.',
    };
    return (messages[kind] || 'Project action failed.') + suffix;
  }

  function modelsForProjectProvider(state, providerId) {
    if (!state || !providerId) return [''];
    var models = state.providerModels[providerId] || [];
    if (models.length) return models;
    if (state.providerDefaults[providerId]) return [state.providerDefaults[providerId]];
    if (providerId === state.currentProvider && state.currentModel) {
      return [state.currentModel];
    }
    return [''];
  }

  function renderProjectProviderOptions(state) {
    if (!state || !state.options.length) {
      return '<option value="">Default provider</option>';
    }
    return state.options
      .map(function (provider) {
        var label =
          provider.label ||
          provider.displayName ||
          provider.name ||
          provider.id ||
          'Provider';
        var suffix = provider.available === false ? ' (not configured)' : '';
        return (
          '<option value="' +
          esc(provider.id || '') +
          '"' +
          (provider.id === state.selectedProvider ? ' selected' : '') +
          '>' +
          esc(label + suffix) +
          '</option>'
        );
      })
      .join('');
  }

  function renderProjectModelOptions(state, providerId, selectedModel) {
    return modelsForProjectProvider(state, providerId)
      .filter(Boolean)
      .map(function (model) {
        return (
          '<option value="' +
          esc(model) +
          '"' +
          (model === selectedModel ? ' selected' : '') +
          '>' +
          esc(model) +
          '</option>'
        );
      })
      .join('');
  }

  async function loadProjectProviderState() {
    if (projectProviderState) return projectProviderState;
    var providerInfo = {};
    var loadIssue = '';
    try {
      providerInfo = await api('/system/provider');
    } catch (err) {
      loadIssue =
        'Provider catalog unavailable. Project chats can still use the backend default, but provider/model choices may be incomplete.';
      providerInfo = {};
    }
    var definitions = providerInfo.definitions || {};
    var options = Object.values(definitions)
      .filter(function (provider) {
        return provider && provider.selectable !== false;
      })
      .map(function (provider) {
        return {
          id: provider.id,
          label: provider.label,
          displayName: provider.displayName,
          name: provider.name,
          available:
            providerInfo.available && provider.id
              ? providerInfo.available[provider.id]
              : undefined,
        };
      })
      .filter(function (provider) {
        return provider.id;
      });
    if (!options.length && providerInfo.provider) {
      options = [{ id: providerInfo.provider, label: providerInfo.provider }];
    }
    var providerModels = providerInfo.models || {};
    var providerDefaults = providerInfo.defaults || {};
    var selectedProvider =
      localStorage.getItem('projectchat_last_provider') ||
      providerInfo.provider ||
      (options[0] && options[0].id) ||
      '';
    if (options.length && !options.some(function (provider) { return provider.id === selectedProvider; })) {
      selectedProvider = options[0].id;
    }
    var selectedModel =
      localStorage.getItem('projectchat_last_model_' + selectedProvider) ||
      providerDefaults[selectedProvider] ||
      providerInfo.model ||
      modelsForProjectProvider(
        {
          providerModels: providerModels,
          providerDefaults: providerDefaults,
          currentProvider: providerInfo.provider,
          currentModel: providerInfo.model,
        },
        selectedProvider,
      )[0] ||
      '';
    projectProviderState = {
      options: options,
      providerModels: providerModels,
      providerDefaults: providerDefaults,
      currentProvider: providerInfo.provider,
      currentModel: providerInfo.model,
      selectedProvider: selectedProvider,
      selectedModel: selectedModel,
      loadIssue: loadIssue,
    };
    return projectProviderState;
  }

  function renderProjectList(projects) {
    if (!projects.length) {
      return (
        '<section class="projects-empty-list">' +
        '<span>Cowork queue</span>' +
        '<strong>No projects yet</strong>' +
        '<p>Pick a starter or create a virtual folder for files, artifacts, chats, and approved MCP context.</p>' +
        '<button type="button" class="btn btn-sm btn-primary" onclick="toggleProjectCreate(true)">New project</button>' +
        '</section>'
      );
    }
    return projects
      .map(function (project) {
        var active = project.id === activeProjectId ? ' active' : '';
        return (
          '<button class="project-list-item' +
          active +
          '" onclick="selectProject(\'' +
          esc(String(project.id)) +
          '\')">' +
          '<span class="project-list-name">' +
          esc(project.name) +
          '</span>' +
          '<span class="project-list-meta">' +
          esc(String(project.fileCount || 0)) +
          ' files &middot; ' +
          esc(String(project.chatCount || 0)) +
          ' chats</span>' +
          '</button>'
        );
      })
      .join('');
  }

  function renderFiles(files) {
    if (!files.length) {
      return (
      '<div class="project-panel-empty project-files-empty">' +
      '<span>Workspace files</span>' +
      '<strong>Add the material this project should use.</strong>' +
      '<p>Notes, briefs, drafts, and artifacts stay with the project.</p>' +
        '<div class="project-panel-empty-actions">' +
        '<button type="button" class="btn btn-sm btn-primary" onclick="toggleProjectFileForm(true)">Create file</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="applyProjectMcpRecipe(2)">Draft from context</button>' +
        '</div>' +
        '</div>'
      );
    }
    return (
      '<div class="project-file-list">' +
      files
        .map(function (file) {
          return (
            '<div class="project-file-row" data-file-path="' +
            esc(file.path) +
            '">' +
            '<button type="button" class="project-file-open" onclick="previewProjectFile(' +
            jsStringAttr(file.path) +
            ')">' +
            '<span class="project-file-kind">' +
            fileIcon(file.kind) +
            '</span>' +
            '<span class="project-file-path">' +
            esc(file.path) +
            '</span>' +
            '<span class="project-file-meta">' +
            esc(file.kind || 'artifact') +
            '</span>' +
            '</button>' +
            '<a class="project-file-download" href="' +
            esc(projectFileDownloadHref(file.path)) +
            '" download="' +
            esc(projectFileDownloadName(file.path)) +
            '" title="Download ' +
            esc(file.path) +
            '">Download</a>' +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function renderThreads(projectId, threads) {
    if (!threads.length) {
      return (
      '<div class="project-panel-empty project-threads-empty">' +
      '<span>Thread history</span>' +
      '<strong>Start the first project chat.</strong>' +
      '<p>Threads stay attached to the files and context here.</p>' +
        '<div class="project-panel-empty-actions">' +
        '<button type="button" class="btn btn-sm btn-primary" onclick="document.getElementById(\'project-prompt\')?.focus()">Write prompt</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="applyProjectMcpRecipe(0)">Latest emails</button>' +
        '</div>' +
        '</div>'
      );
    }

    function runStatusLabel(status) {
      var map = {
        draft: 'Draft',
        planning: 'Planning',
        waiting_for_approval: 'Waiting for approval',
        running: 'Running',
        blocked: 'Blocked',
        completed: 'Completed',
        failed: 'Failed',
        cancelled: 'Cancelled',
      };
      return map[status] || 'Unknown';
    }

    function runStatusClass(status) {
      if (status === 'completed') return 'is-ready';
      if (status === 'running') return 'is-active';
      if (status === 'waiting_for_approval' || status === 'blocked') return 'is-attention';
      if (status === 'failed' || status === 'cancelled') return 'is-stale';
      return 'is-idle';
    }

    function researchCoverageClass(status) {
      if (status === 'sufficient') return 'is-ready';
      if (status === 'partial') return 'is-idle';
      if (status === 'missing') return 'is-attention';
      return 'is-neutral';
    }

    function renderRuns(runs) {
      if (!runs.length) {
        return (
          '<div class="project-panel-empty project-runs-empty">' +
          '<span>Run workspace</span>' +
          '<strong>No tracked runs yet.</strong>' +
          '<p>Create a run from the project prompt to track plan, progress, approvals, and outputs.</p>' +
          '<div class="project-panel-empty-actions">' +
          '<button type="button" class="btn btn-sm btn-primary" onclick="createProjectRunFromPrompt()">Track run</button>' +
          '</div>' +
          '</div>'
        );
      }
      var activeRun =
        runs.find(function (run) {
          return run.id === activeProjectRunId;
        }) || runs[0];
      if (!activeProjectRunId) activeProjectRunId = activeRun.id;
      return (
        '<div class="project-runs-layout">' +
        '<div class="project-run-list">' +
        runs
          .map(function (run) {
            return (
              '<button type="button" class="project-run-row ' +
              (run.id === activeRun.id ? 'active' : '') +
              '" onclick="selectProjectRun(' +
              jsStringAttr(run.id) +
              ')">' +
              '<span class="project-run-title">' +
              esc(run.title || 'Cowork run') +
              '</span>' +
              '<span class="project-run-meta">' +
              esc(
                runStatusLabel(run.status) +
                  ' · ' +
                  ((run.intent && run.intent.mode) || 'execution') +
                  ' · ' +
                  ((run.complexity && run.complexity.level) || 'moderate') +
                  ' complexity',
              ) +
              '</span>' +
              '</button>'
            );
          })
          .join('') +
        '</div>' +
        renderRunDetail(activeRun) +
        '</div>'
      );
    }

    function renderRunDetail(run) {
      var planSteps = Array.isArray(run.planSteps) ? run.planSteps : [];
      var events = Array.isArray(run.events) ? run.events : [];
      var actionFeedback = projectRunActionFeedback[run.id] || null;
      var citationFeedback = projectRunCitationFeedback[run.id] || null;
      var coverage = run.researchCoverage || {
        citationCount: 0,
        status: 'not_applicable',
        guidance: 'Research coverage applies only to research-mode runs.',
      };
      return (
        '<div class="project-run-detail">' +
        '<div class="project-run-header">' +
        '<strong>' +
        esc(run.title || 'Cowork run') +
        '</strong>' +
        '<span class="project-context-chip ' +
        runStatusClass(run.status) +
        '">' +
        esc(runStatusLabel(run.status)) +
        '</span>' +
        '</div>' +
        '<p>' +
        esc(run.summary || run.prompt || 'No run summary yet.') +
        '</p>' +
        '<div class="project-run-section"><span>Estimate</span>' +
        '<p>' +
        esc(
          ((run.complexity && run.complexity.level) || 'moderate') +
            ' complexity · ~' +
            ((run.complexity && run.complexity.estimatedSteps) || 3) +
            ' steps · ' +
            (((run.complexity && run.complexity.budgetTier) || 'medium') + ' budget'),
        ) +
        '</p>' +
        '</div>' +
        '<div class="project-run-section"><span>Mode</span>' +
        '<p>' +
        esc(
          ((run.intent && run.intent.mode) || 'execution') +
            ' · ' +
            ((run.intent && run.intent.requiresCitations
              ? 'citations required'
              : 'citations optional')),
        ) +
        '</p>' +
        '<small>' +
        esc(
          (run.intent && run.intent.sourceExpectation) ||
            'Use project context and files as your source baseline.',
        ) +
        '</small>' +
        '</div>' +
        '<div class="project-run-section"><span>Approval</span>' +
        '<p>' +
        esc(
          (run.approvalPreview && run.approvalPreview.required ? 'Required' : 'Not required') +
            ' · ' +
            ((run.approvalPreview && run.approvalPreview.risk) || 'low') +
            ' risk',
        ) +
        '</p>' +
        '<small>' +
        esc(
          (run.approvalPreview && run.approvalPreview.reason) ||
            'No approval signals recorded.',
        ) +
        '</small>' +
        '</div>' +
        '<div class="project-run-section"><span>Research coverage</span>' +
        '<p>' +
        '<span class="project-context-chip ' +
        researchCoverageClass(coverage.status) +
        '">' +
        esc(coverage.status || 'not_applicable') +
        '</span> ' +
        esc(String(coverage.citationCount || 0) + ' citations') +
        '</p>' +
        '<small>' +
        esc(coverage.guidance || 'No guidance available.') +
        '</small>' +
        '<div class="project-context-new">' +
        '<button type="button" class="btn btn-sm btn-primary" onclick="exportProjectRunCitationLedger(' +
        jsStringAttr(run.id) +
        ')">Export citation ledger</button>' +
        '</div>' +
        '</div>' +
        '<div class="project-run-section"><span>Add citation</span>' +
        '<div class="project-context-new">' +
        '<input id="project-run-citation-title-' +
        esc(run.id) +
        '" class="search-input" placeholder="Citation title">' +
        '<input id="project-run-citation-url-' +
        esc(run.id) +
        '" class="search-input" placeholder="Source URL">' +
        '<button type="button" class="btn btn-sm btn-primary" onclick="addProjectRunCitation(' +
        jsStringAttr(run.id) +
        ')">Add citation</button>' +
        '</div>' +
        '<input id="project-run-citation-note-' +
        esc(run.id) +
        '" class="search-input" placeholder="Optional note">' +
        '<div class="project-settings-msg" id="project-run-citation-msg-' +
        esc(run.id) +
        '">' +
        esc(citationFeedback ? citationFeedback.message : '') +
        '</div>' +
        '</div>' +
        '<div class="project-run-section"><span>Connector action request</span>' +
        '<div class="project-context-new">' +
        '<input id="project-run-connector-' +
        esc(run.id) +
        '" class="search-input" placeholder="connector id (e.g. gmail)">' +
        '<input id="project-run-action-' +
        esc(run.id) +
        '" class="search-input" placeholder="action (e.g. gmail.read)">' +
        '<input id="project-run-note-' +
        esc(run.id) +
        '" class="search-input" placeholder="Optional note">' +
        '<button type="button" class="btn btn-sm btn-primary" onclick="requestProjectRunAction(' +
        jsStringAttr(run.id) +
        ')">Request action</button>' +
        '</div>' +
        '<div class="project-settings-msg" id="project-run-action-msg-' +
        esc(run.id) +
        '">' +
        esc(actionFeedback ? actionFeedback.message : '') +
        '</div>' +
        '</div>' +
        '<div class="project-run-section"><span>Plan</span>' +
        (planSteps.length
          ? '<ul>' +
            planSteps
              .map(function (step) {
                return (
                  '<li><strong>' +
                  esc(step.title || step.id || 'Step') +
                  '</strong> — ' +
                  esc(runStatusLabel(step.status || 'draft')) +
                  '</li>'
                );
              })
              .join('') +
            '</ul>'
          : '<p>No plan steps recorded.</p>') +
        '</div>' +
        '<div class="project-run-section"><span>Recent events</span>' +
        (events.length
          ? '<ul>' +
            events
              .slice(-6)
              .reverse()
              .map(function (event) {
                return (
                  '<li><strong>' +
                  esc(event.kind || 'event') +
                  '</strong> — ' +
                  esc(event.message || 'Updated') +
                  '</li>'
                );
              })
              .join('') +
            '</ul>'
          : '<p>No events yet.</p>') +
        '</div>' +
        '<div class="project-run-actions">' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="setProjectRunAction(' +
        jsStringAttr(run.id) +
        ', \'start\')">Start</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="setProjectRunAction(' +
        jsStringAttr(run.id) +
        ', \'checkpoint\')">Need approval</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="setProjectRunAction(' +
        jsStringAttr(run.id) +
        ', \'resume\')">Resume</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="setProjectRunAction(' +
        jsStringAttr(run.id) +
        ', \'complete\')">Complete</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="setProjectRunAction(' +
        jsStringAttr(run.id) +
        ', \'retry\')">Retry</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="setProjectRunAction(' +
        jsStringAttr(run.id) +
        ', \'cancel\')">Cancel</button>' +
        '</div>' +
        '</div>'
      );
    }

    function renderContextNotebook(items) {
      return (
        '<section class="project-context-notebook">' +
        '<div class="project-context-notebook-head">' +
        '<div><span>Context notebook</span><small>Files, chats, runs, sources, notes, and inclusion state.</small></div>' +
        '</div>' +
        '<div class="project-context-new">' +
        '<input id="project-context-title" class="search-input" placeholder="Add context note or source title">' +
        '<input id="project-context-source" class="search-input" placeholder="Source (optional)">' +
        '<button type="button" class="btn btn-sm btn-primary" onclick="addProjectContextItem()">Add note</button>' +
        '</div>' +
        '<div class="project-context-list">' +
        (items.length
          ? items
              .map(function (item) {
                return (
                  '<div class="project-context-item">' +
                  '<div class="project-context-item-main">' +
                  '<strong>' +
                  esc(item.title || item.path || item.kind || 'Context item') +
                  '</strong>' +
                  '<div class="project-context-item-badges">' +
                  '<span class="project-context-chip ' +
                  (item.sensitivity === 'sensitive'
                    ? 'is-attention'
                    : item.sensitivity === 'review-required'
                      ? 'is-idle'
                      : 'is-ready') +
                  '">' +
                  esc(item.sensitivity || 'normal') +
                  '</span>' +
                  (item.provenance
                    ? '<span class="project-context-chip is-neutral">' +
                      esc(item.provenance) +
                      '</span>'
                    : '') +
                  '</div>' +
                  '<small>' +
                  esc(
                    [item.kind || 'item', item.provenance || item.source || 'local', item.sensitivity || 'normal']
                      .filter(Boolean)
                      .join(' · '),
                  ) +
                  '</small>' +
                  '</div>' +
                  '<div class="project-context-item-actions">' +
                  '<button type="button" class="btn btn-sm btn-ghost" onclick="toggleProjectContextInclude(' +
                  jsStringAttr(item.id) +
                  ', ' +
                  (item.included ? 'false' : 'true') +
                  ')">' +
                  (item.included ? 'Exclude' : 'Include') +
                  '</button>' +
                  '<button type="button" class="btn btn-sm btn-ghost" onclick="toggleProjectContextPin(' +
                  jsStringAttr(item.id) +
                  ', ' +
                  (item.pinned ? 'false' : 'true') +
                  ')">' +
                  (item.pinned ? 'Unpin' : 'Pin') +
                  '</button>' +
                  (item.autoGenerated
                    ? ''
                    : '<button type="button" class="btn btn-sm btn-ghost" onclick="removeProjectContextItem(' +
                      jsStringAttr(item.id) +
                      ')">Remove</button>') +
                  '</div>' +
                  '</div>'
                );
              })
              .join('')
          : '<div class="project-panel-empty project-context-empty"><strong>No context items yet.</strong><p>Add a note, source link, or promote files and chats.</p></div>') +
        '</div>' +
        '</section>'
      );
    }

    function renderProjectCapabilities(project) {
      var capabilities = (project && project.capabilities) || {};
      var skills = capabilities.skills?.enabled || [];
      var plugins = capabilities.plugins?.enabled || [];
      var connectors = capabilities.connectors?.configured || [];
      return (
        '<div class="project-capabilities">' +
        '<div class="project-rail-title">Active capabilities</div>' +
        '<p>' +
        esc(
          String(skills.length) +
            ' skills · ' +
            String(plugins.length) +
            ' plugins · ' +
            String(connectors.length) +
            ' connectors',
        ) +
        '</p>' +
        (skills.length
          ? '<div class="project-capability-group"><span>Skills</span><small>' +
            esc(
              skills
                .slice(0, 8)
                .map(function (item) {
                  return item.name;
                })
                .join(', '),
            ) +
            '</small></div>'
          : '') +
        (plugins.length
          ? '<div class="project-capability-group"><span>Plugins</span><small>' +
            esc(
              plugins
                .slice(0, 8)
                .map(function (item) {
                  return item.name;
                })
                .join(', '),
            ) +
            '</small></div>'
          : '') +
        (connectors.length
          ? '<div class="project-capability-group"><span>Connector scope</span><small>' +
            esc(
              connectors
                .slice(0, 8)
                .map(function (item) {
                  return item.id + (item.requiresApproval ? ' (approval)' : '');
                })
                .join(', '),
            ) +
            '</small></div>'
          : '<div class="project-capability-group"><span>Connector scope</span><small>No external connectors configured for this project.</small></div>') +
        '</div>'
      );
    }
    return (
      '<div class="project-thread-list">' +
      threads
        .map(function (thread) {
          return (
            '<a class="project-thread-row" href="' +
            projectChatHash(projectId, thread.id) +
            '">' +
            '<span class="project-thread-title">' +
            esc(thread.title || 'New conversation') +
            '</span>' +
            '<span class="project-thread-meta">' +
            esc(thread.lastMessage || 'Open thread') +
            '</span>' +
            '</a>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function renderProjectActions() {
    return (
      '<div class="project-launchpad" aria-label="Project quick starts">' +
      '<div class="project-launchpad-head">' +
      '<div><span>Quick starts</span></div>' +
      '</div>' +
      '<div class="project-action-grid">' +
      PROJECT_ACTIONS.map(function (action, index) {
        return (
          '<button class="project-action-card" onclick="applyProjectPrompt(' +
          index +
          ')">' +
          '<span class="project-action-label">' +
          esc(action.label) +
          '</span>' +
          '<span class="project-action-meta">' +
          esc(action.meta) +
          '</span>' +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '</div>'
    );
  }

  function renderProjectMcpRecipes() {
    return (
      '<div class="project-mcp-recipes" aria-label="MCP project recipes">' +
      '<div class="project-mcp-recipes-head">' +
      '<div><span>Source tools</span><small>Use approved connectors from this project chat.</small></div>' +
      '<button type="button" class="btn btn-sm btn-ghost" onclick="navigate(\'mcp\')">Manage MCP</button>' +
      '</div>' +
      '<div class="project-mcp-recipe-grid">' +
      PROJECT_MCP_RECIPES.map(function (recipe, index) {
        return (
          '<button type="button" class="project-mcp-recipe" onclick="applyProjectMcpRecipe(' +
          index +
          ')">' +
          '<span>' +
          esc(recipe.label) +
          '</span>' +
          '<small>' +
          esc(recipe.prompt.split('.')[0] + '.') +
          '</small>' +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '<p>Draft locally first. External writes go through approvals.</p>' +
      '</div>'
    );
  }

  function renderProjectSourcePack() {
    return (
      '<section class="project-source-pack" aria-label="MCP source pack builder">' +
      '<div class="project-source-pack-head">' +
      '<div>' +
      '<strong>Shape a source request</strong>' +
      '<p>Useful for email summaries, sender checks, briefs, and document drafts.</p>' +
      '</div>' +
      '<button type="button" class="btn btn-sm btn-ghost" onclick="copyProjectSourcePackPrompt()">Copy prompt</button>' +
      '</div>' +
      '<div class="project-source-pack-grid">' +
      '<label>MCP server or source<input id="project-source-server" class="search-input" placeholder="mail, gmail, docs, calendar"></label>' +
      '<label>Sender, topic, or filter<input id="project-source-filter" class="search-input" placeholder="from:alex@example.com OR invoice approvals"></label>' +
      '<label>Date window<input id="project-source-window" class="search-input" placeholder="last 7 days"></label>' +
      '<label>Artifact to create<select id="project-source-output" class="search-input">' +
      '<option value="markdown summary">Markdown summary</option>' +
      '<option value="project brief">Project brief</option>' +
      '<option value="document draft">Document draft</option>' +
      '<option value="reply draft">Reply draft</option>' +
      '</select></label>' +
      '</div>' +
      '<div class="project-source-pack-actions">' +
      '<button type="button" class="btn btn-sm btn-primary" onclick="applyProjectSourcePackPrompt()">Use source</button>' +
      '<button type="button" class="btn btn-sm btn-ghost" onclick="clearProjectSourcePack()">Clear</button>' +
      '</div>' +
      '</section>'
    );
  }

  function renderProjectMcpAccess(project) {
    var access = (project && project.mcpAccess) || {};
    var servers = Array.isArray(access.servers) ? access.servers : [];
    var examples = Array.isArray(access.examples) ? access.examples : [];
    var setupHint =
      access.setupHint ||
      (servers.length
        ? 'Available in project chat.'
        : 'Connect mail, calendar, docs, storage, or a custom server.');
    return (
      '<div class="project-mcp-access">' +
      '<div class="project-mcp-access-head">' +
      '<div><span>Tools</span><small>' +
      esc(setupHint) +
      '</small></div>' +
      '</div>' +
      (servers.length
        ? '<div class="project-mcp-server-list">' +
          servers
            .slice(0, 8)
            .map(function (server) {
              return '<span>' + esc(server) + '</span>';
            })
            .join('') +
          '</div>'
        : '') +
      '<ul>' +
      (examples.length
        ? examples
            .map(function (example) {
              return '<li>' + esc(example) + '</li>';
            })
            .join('')
        : '<li>Summarize source context.</li>') +
      '</ul>' +
      '<p>External writes require approval.</p>' +
      '</div>'
    );
  }

  function renderProjectBrief(project, detail, providerState) {
    var files = detail.files || [];
    var threads = detail.threads || [];
    var runs = detail.runs || [];
    var hasInstructions = Boolean(project.instructions && project.instructions.trim());
    var providerLoadIssue = providerState?.loadIssue || '';
    var tone = !files.length
      ? 'attention'
        : !threads.length
          ? 'active'
          : hasInstructions
            ? 'ready'
            : 'active';
    var title = !files.length
      ? 'Add project files'
      : !threads.length
        ? 'Start a project chat'
        : hasInstructions
          ? 'Project context is ready'
          : 'Add project rules';
    var detailText = !files.length
      ? 'Create or import notes, briefs, source documents, or artifacts.'
      : !threads.length
        ? 'Use a quick start or write a prompt.'
        : hasInstructions
          ? 'Files, chats, and instructions are attached.'
          : 'Tone, source, and approval rules can be added anytime.';
    var nextAction = !files.length
      ? 'Create file'
        : !threads.length
          ? 'Start project chat'
        : hasInstructions
          ? 'Review context'
          : 'Draft rules';
    var nextOnclick = !files.length
      ? 'toggleProjectFileForm()'
        : !threads.length
          ? "document.getElementById('project-prompt')?.focus()"
        : hasInstructions
          ? "document.getElementById('project-file-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' })"
          : 'applyProjectInstructionPrompt()';
    return (
      '<section class="project-status-brief is-' +
      tone +
      '">' +
      '<div class="project-status-main">' +
      '<strong>' +
      esc(title) +
      '</strong>' +
      '<p>' +
      esc(detailText) +
      '</p>' +
      '<small>' +
      esc(String(files.length)) +
      ' files &middot; ' +
      esc(String(threads.length)) +
      ' threads &middot; ' +
      esc(String(runs.length)) +
      ' runs</small>' +
      '</div>' +
      (providerLoadIssue
        ? '<p class="project-provider-health">' +
          esc(providerLoadIssue) +
          '</p>'
        : '') +
      '<button type="button" class="btn btn-sm btn-primary" onclick="' +
      nextOnclick +
      '">' +
      esc(nextAction) +
      '</button>' +
      '</section>'
    );
  }

  function renderProjectChatComposer(providerState) {
    var selectedProvider = providerState?.selectedProvider || '';
    var selectedModel = providerState?.selectedModel || '';
    var providerLoadIssue = providerState?.loadIssue || '';
    return (
      '<div class="project-composer project-chat-entry" id="project-chat-entry">' +
      '<div class="project-composer-topline"><div><span>Ask in this project</span><small>Files, history, and approved tools are attached.</small></div><button type="button" class="btn btn-sm btn-ghost" onclick="applyProjectMcpRecipe(0)">Latest emails</button></div>' +
      (providerLoadIssue
        ? '<div class="project-composer-health" role="status">' +
          esc(providerLoadIssue) +
          '</div>'
        : '') +
      '<div class="project-composer-provider">' +
      '<label>Provider<select id="project-chat-provider" class="search-input" onchange="updateProjectChatModels()">' +
      renderProjectProviderOptions(providerState) +
      '</select></label>' +
      '<label>Model<select id="project-chat-model" class="search-input">' +
      renderProjectModelOptions(providerState, selectedProvider, selectedModel) +
      '</select></label>' +
      '<label>Title<input id="project-chat-title" class="search-input" placeholder="Optional chat title"></label>' +
      '</div>' +
      '<textarea id="project-prompt" placeholder="Summarize files, draft a document, check emails from a sender, or plan the next step."></textarea>' +
      '<div class="project-composer-actions">' +
      '<button class="btn btn-sm btn-ghost" onclick="toggleProjectFileForm()">New file</button>' +
      '<button class="btn btn-sm btn-ghost" onclick="createProjectRunFromPrompt()">Track run</button>' +
      '<button class="btn btn-primary" id="project-chat-start-btn" onclick="startProjectChat()">Start project chat</button>' +
      '</div>' +
      '</div>'
    );
  }

  function renderToolLanes() {
    return (
      '<div class="project-tool-lanes">' +
      PROJECT_TOOL_LANES.map(function (lane, index) {
        var action =
          typeof lane.actionIndex === 'number'
            ? 'applyProjectPrompt(' + lane.actionIndex + ')'
            : 'applyProjectToolPrompt(' + index + ')';
        return (
          '<div class="project-tool-lane">' +
          '<div>' +
          '<span>' +
          esc(lane.label) +
          '</span>' +
          '<small>' +
          esc(lane.meta) +
          '</small>' +
          '</div>' +
          '<button type="button" class="btn btn-sm btn-ghost" onclick="' +
          action +
          '">Ask</button>' +
          '</div>'
        );
      }).join('') +
      '</div>'
    );
  }

  function renderProjectEmptyWorkbench() {
    return (
      '<section class="project-workbench project-empty-workbench">' +
      '<div class="project-empty-state">' +
      '<span class="report-kicker">Cowork projects</span>' +
      '<h2>Create a project workspace.</h2>' +
      '<p>Keep files, chats, drafts, and artifacts together.</p>' +
      '<div class="project-empty-actions">' +
      '<button type="button" class="btn btn-primary" onclick="toggleProjectCreate(true)">New project</button>' +
      '<button type="button" class="btn btn-sm btn-ghost" onclick="navigate(\'mcp\')">Check MCP tools</button>' +
      '</div>' +
      '<div class="project-template-grid">' +
      PROJECT_TEMPLATES.map(function (template, index) {
        return (
          '<button type="button" class="project-template-card" onclick="applyProjectTemplate(' +
          index +
          ')">' +
          '<span>' +
          esc(template.name) +
          '</span>' +
          '<strong>' +
          esc(template.description) +
          '</strong>' +
          '<small>' +
          esc(template.instructions) +
          '</small>' +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '</div>' +
      '<aside class="project-context-rail">' +
      '<div class="project-rail-card project-rail-card-primary">' +
      '<div class="project-rail-title">What belongs here</div>' +
      '<p>Project files, summaries, drafts, artifacts, and chats.</p>' +
      '</div>' +
      '<div class="project-rail-card project-approval-card">' +
      '<div class="project-rail-title">Safe by default</div>' +
      '<p>Draft locally. Approve external writes.</p>' +
      '</div>' +
      '</aside>' +
      '</section>'
    );
  }

  function renderProjectRail(project, detail) {
    var fileCount = (detail.files || []).length;
    var threadCount = (detail.threads || []).length;
    var runCount = (detail.runs || []).length;
    var description = project.description || '';
    var instructions = project.instructions || '';
    return (
      '<aside class="project-context-rail">' +
      '<div class="project-rail-card project-rail-card-primary">' +
      '<div class="project-rail-title">Context</div>' +
      '<div class="project-context-stats">' +
      '<span><strong>' +
      esc(String(fileCount)) +
      '</strong><small>files</small></span>' +
      '<span><strong>' +
      esc(String(threadCount)) +
      '</strong><small>threads</small></span>' +
      '<span><strong>' +
      esc(String(runCount)) +
      '</strong><small>runs</small></span>' +
      '</div>' +
      '<p>Chats use this workspace, project files, and prior threads.</p>' +
      '<code>/workspace/extra/project-' +
      esc(project.slug) +
      '</code>' +
      '<button type="button" class="btn btn-sm btn-ghost" onclick="copyProjectHandoffBrief()">Copy handoff</button>' +
      '</div>' +
      '<div class="project-rail-card">' +
      '<div class="project-rail-title project-rail-title-row"><span>Settings</span><button type="button" class="btn btn-sm btn-ghost" onclick="toggleProjectSettings()">Edit</button></div>' +
      '<div class="project-settings-summary">' +
      '<span>Description</span>' +
      '<p>' +
      esc(description || 'No project description yet.') +
      '</p>' +
      '<span>Instructions</span>' +
      '<p>' +
          esc(instructions || 'No project instructions yet.') +
      '</p>' +
      '</div>' +
      '<div class="project-settings-form is-hidden" id="project-settings-form">' +
      '<label for="project-settings-description">Description</label>' +
      '<textarea id="project-settings-description" placeholder="What is this project for?">' +
      esc(description) +
      '</textarea>' +
      '<label for="project-settings-instructions">Agent instructions</label>' +
      '<textarea id="project-settings-instructions" placeholder="Tone, sources, document style, and approval rules.">' +
      esc(instructions) +
      '</textarea>' +
      '<div class="project-settings-actions">' +
      '<button type="button" class="btn btn-sm btn-ghost" onclick="toggleProjectSettings(false)">Cancel</button>' +
      '<button type="button" class="btn btn-sm btn-primary" id="project-settings-save-btn" onclick="saveProjectSettings()">Save context</button>' +
      '</div>' +
      '<div class="project-settings-msg" id="project-settings-msg"></div>' +
      '</div>' +
      '</div>' +
      '<div class="project-rail-card">' +
      '<div class="project-rail-title">Connectors</div>' +
      renderProjectCapabilities(project) +
      renderProjectMcpAccess(project) +
      renderToolLanes() +
      '</div>' +
      '<div class="project-rail-card project-approval-card">' +
      '<div class="project-rail-title">Approvals</div>' +
      '<p>Publishing, sending, webhooks, and external writes need approval.</p>' +
      '<button type="button" class="btn btn-sm btn-ghost" onclick="navigate(\'approvals\')">Review approvals</button>' +
      '</div>' +
      '</aside>'
    );
  }

  function renderFilePreview() {
    return (
      '<div class="project-file-preview" id="project-file-preview">' +
      renderProjectFilePreviewState('select') +
      '</div>'
    );
  }

  function renderProjectFilePreviewState(kind, detail) {
    var states = {
      select: {
        title: 'Select a project file',
        detail:
          'Preview source material, drafts, and artifacts.',
        flow: ['Inspect', 'Use in prompt', 'Create artifact'],
        actions:
          '<button type="button" class="btn btn-sm btn-primary" onclick="toggleProjectFileForm(true)">New file</button>' +
          '<button type="button" class="btn btn-sm btn-ghost" onclick="applyProjectMcpRecipe(2)">Source -> document</button>',
      },
      unsupported: {
        title: 'Preview is not available for this file type yet',
        detail:
          'The file is still available to project chats.',
        flow: ['Reference path', 'Ask agent', 'Save output'],
        actions: '',
      },
      error: {
        title: 'Could not load file preview',
        detail:
          detail ||
          'The file remains in the project. Check the path and try again.',
        flow: ['Check path', 'Retry', 'Ask agent'],
        actions:
          '<button type="button" class="btn btn-sm btn-ghost" onclick="refreshProjects()">Refresh project</button>',
      },
    };
    var state = states[kind] || states.select;
    return (
      '<section class="project-file-preview-empty project-file-preview-state is-' +
      esc(kind || 'select') +
      '">' +
      '<div>' +
      '<span class="report-kicker">Project file preview</span>' +
      '<strong>' +
      esc(state.title) +
      '</strong>' +
      '<p>' +
      esc(state.detail) +
      '</p>' +
      '</div>' +
      '<div class="project-file-preview-flow">' +
      state.flow
        .map(function (item) {
          return '<span>' + esc(item) + '</span>';
        })
        .join('') +
      '</div>' +
      (state.actions
        ? '<div class="project-file-preview-state-actions">' +
          state.actions +
          '</div>'
        : '') +
      '</section>'
    );
  }

  function renderProjectDetail(detail, providerState) {
    var project = detail.project;
    var contextItems = detail.contextItems || [];
    return (
      '<section class="project-workbench">' +
      '<div class="project-main">' +
      '<div class="project-heading">' +
      '<div>' +
      '<h2>' +
      esc(project.name) +
      '</h2>' +
      '<p>' +
      esc(project.description || 'A shared workspace for files, artifacts, and agent threads.') +
      '</p>' +
      '</div>' +
      '<div class="project-heading-actions">' +
      '<button type="button" class="btn btn-sm btn-ghost" onclick="copyProjectHandoffBrief()">Copy handoff</button>' +
      '<button type="button" class="btn btn-sm btn-ghost" onclick="toggleProjectSettings(true)">Edit context</button>' +
      '<span class="project-path">' +
      esc(project.path || project.slug || '') +
      '</span>' +
      '</div>' +
      '</div>' +
      renderProjectChatComposer(providerState) +
      renderProjectBrief(project, detail, providerState) +
      renderProjectActions(project) +
      renderProjectMcpRecipes() +
      renderProjectSourcePack() +
      '<div class="project-file-form is-hidden" id="project-file-form">' +
      '<input class="search-input" id="project-file-path" placeholder="docs/brief.md">' +
      '<textarea id="project-file-content" placeholder="Write notes, drafts, or artifact text here."></textarea>' +
      '<button class="btn btn-sm btn-primary" onclick="createProjectFile()">Create file</button>' +
      '</div>' +
      '<div class="project-section-grid">' +
      '<div class="project-section">' +
      '<div class="project-section-title">Project files</div>' +
      renderFiles(detail.files || []) +
      '</div>' +
      '<div class="project-section">' +
      '<div class="project-section-title">Chat history</div>' +
      renderThreads(project.id, detail.threads || []) +
      '</div>' +
      '<div class="project-section">' +
      '<div class="project-section-title">Run workspace</div>' +
      renderRuns(detail.runs || []) +
      '</div>' +
      '</div>' +
      renderContextNotebook(contextItems) +
      renderFilePreview() +
      '</div>' +
      renderProjectRail(project, detail) +
      '</section>'
    );
  }

  async function loadProjects() {
    var data = await api('/projects');
    return Array.isArray(data.projects) ? data.projects : [];
  }

  async function loadProjectDetail(id) {
    return api('/projects/' + encodeURIComponent(id));
  }

  async function refreshProjects() {
    var el = document.getElementById('page-content');
    if (!el) return;
    var projects = await loadProjects();
    var providerState = await loadProjectProviderState();
    var focusedProjectId = null;
    try {
      focusedProjectId = sessionStorage.getItem('project_focus_id');
      if (focusedProjectId) sessionStorage.removeItem('project_focus_id');
    } catch {
      focusedProjectId = null;
    }
    if (focusedProjectId && projects.some(function (project) { return project.id === focusedProjectId; })) {
      activeProjectId = focusedProjectId;
    }
    if (!activeProjectId && projects.length) activeProjectId = projects[0].id;
    var detail = activeProjectId ? await loadProjectDetail(activeProjectId) : null;
    activeProjectDetail = detail;
    if (
      detail &&
      !activeProjectFilePath &&
      Array.isArray(detail.files) &&
      detail.files.length
    ) {
      activeProjectFilePath = detail.files[0].path;
    }

    el.innerHTML =
      '<div class="projects-page">' +
      '<aside class="projects-sidebar">' +
      '<div class="projects-sidebar-head">' +
      '<div><h2>Projects</h2><p>Virtual folders for agent work</p></div>' +
      '<button class="btn btn-sm btn-primary" onclick="toggleProjectCreate()">New</button>' +
      '</div>' +
      '<div class="project-create is-hidden" id="project-create">' +
      '<div class="project-create-head">' +
      '<span>Create Cowork project</span>' +
      '<p>Use a project when files, source systems, artifacts, and multiple chats should stay together.</p>' +
      '</div>' +
      '<label><span>Project name</span><input class="search-input" id="project-name" placeholder="Inbox digest"></label>' +
      '<label><span>Description</span><input class="search-input" id="project-description" placeholder="What should agents help organize or produce?"></label>' +
      '<label><span>Agent instructions</span><textarea id="project-instructions" placeholder="Tone, sources to trust, approval boundaries, and where drafts should be saved."></textarea></label>' +
      '<div class="project-create-shortcuts">' +
      '<button type="button" class="btn btn-sm btn-ghost" onclick="applyProjectTemplate(0)">Inbox digest</button>' +
      '<button type="button" class="btn btn-sm btn-ghost" onclick="applyProjectTemplate(1)">Document workspace</button>' +
      '</div>' +
      '<button class="btn btn-sm btn-primary" onclick="createProject()">Create project</button>' +
      '</div>' +
      '<div class="project-list">' +
      renderProjectList(projects) +
      '</div>' +
      '</aside>' +
      (detail
        ? renderProjectDetail(detail, providerState)
        : renderProjectEmptyWorkbench()) +
      '</div>';
    if (detail && activeProjectFilePath) {
      setTimeout(function () {
        previewProjectFile(activeProjectFilePath);
      }, 0);
    }
  }

  window.renderProjects = function (el) {
    el.innerHTML = renderProjectLoadingState();
    refreshProjects().catch(function (err) {
      renderPageError(el, err, 'Could not load projects');
    });
  };

  window.selectProject = function (id) {
    activeProjectId = id;
    activeProjectFilePath = null;
    refreshProjects();
  };

  function toggleProjectPanel(id, forceOpen, focusId) {
    var panel = document.getElementById(id);
    if (!panel) return false;
    var shouldOpen =
      typeof forceOpen === 'boolean'
        ? forceOpen
        : panel.classList.contains('is-hidden');
    panel.classList.toggle('is-hidden', !shouldOpen);
    if (shouldOpen && focusId) {
      var target = document.getElementById(focusId);
      if (target) target.focus();
    }
    return shouldOpen;
  }

  window.toggleProjectCreate = function (forceOpen) {
    toggleProjectPanel('project-create', forceOpen, 'project-name');
  };

  window.applyProjectTemplate = function (index) {
    var template = PROJECT_TEMPLATES[index];
    if (!template) return;
    toggleProjectCreate(true, 'project-name');
    var name = document.getElementById('project-name');
    var description = document.getElementById('project-description');
    var instructions = document.getElementById('project-instructions');
    if (name) name.value = template.name;
    if (description) description.value = template.description;
    if (instructions) instructions.value = template.instructions;
    if (name) name.focus();
  };

  window.toggleProjectFileForm = function (forceOpen) {
    toggleProjectPanel('project-file-form', forceOpen, 'project-file-path');
  };

  window.updateProjectChatModels = function () {
    var providerSelect = document.getElementById('project-chat-provider');
    var modelSelect = document.getElementById('project-chat-model');
    if (!providerSelect || !modelSelect || !projectProviderState) return;
    var selectedProvider = providerSelect.value;
    var selectedModel =
      localStorage.getItem('projectchat_last_model_' + selectedProvider) ||
      projectProviderState.providerDefaults[selectedProvider] ||
      modelsForProjectProvider(projectProviderState, selectedProvider)[0] ||
      '';
    projectProviderState.selectedProvider = selectedProvider;
    projectProviderState.selectedModel = selectedModel;
    modelSelect.innerHTML = renderProjectModelOptions(
      projectProviderState,
      selectedProvider,
      selectedModel,
    );
  };

  window.toggleProjectSettings = function (forceOpen) {
    toggleProjectPanel(
      'project-settings-form',
      forceOpen,
      'project-settings-instructions',
    );
  };

  window.applyProjectPrompt = function (index) {
    var action = PROJECT_ACTIONS[index];
    var promptEl = document.getElementById('project-prompt');
    if (!action || !promptEl) return;
    promptEl.value = action.prompt;
    promptEl.setSelectionRange(0, 0);
    promptEl.scrollTop = 0;
    promptEl.focus();
    promptEl.dispatchEvent(new Event('input', { bubbles: true }));
  };

  window.applyProjectToolPrompt = function (index) {
    var lane = PROJECT_TOOL_LANES[index];
    var promptEl = document.getElementById('project-prompt');
    if (!lane || !promptEl || !lane.prompt) return;
    promptEl.value = lane.prompt;
    promptEl.setSelectionRange(0, 0);
    promptEl.scrollTop = 0;
    promptEl.focus();
    promptEl.dispatchEvent(new Event('input', { bubbles: true }));
  };

  window.applyProjectMcpRecipe = function (index) {
    var recipe = PROJECT_MCP_RECIPES[index];
    var promptEl = document.getElementById('project-prompt');
    if (!recipe || !promptEl) return;
    promptEl.value = recipe.prompt;
    promptEl.setSelectionRange(0, 0);
    promptEl.scrollTop = 0;
    promptEl.focus();
    promptEl.dispatchEvent(new Event('input', { bubbles: true }));
  };

  function projectSourcePackPromptText() {
    var project = activeProjectDetail?.project || activeProjectDetail || {};
    var access = project.mcpAccess || {};
    var servers = Array.isArray(access.servers)
      ? access.servers.filter(Boolean)
      : [];
    var serverScope = servers.length
      ? servers.join(', ')
      : access.enabled
        ? 'configured MCP servers allowed by connector permissions'
        : 'no external MCP servers connected yet';
    var server =
      document.getElementById('project-source-server')?.value.trim() ||
      'the configured MCP source';
    var filter =
      document.getElementById('project-source-filter')?.value.trim() ||
      'the latest relevant project items';
    var dateWindow =
      document.getElementById('project-source-window')?.value.trim() ||
      'the relevant recent window';
    var output =
      document.getElementById('project-source-output')?.value ||
      'markdown summary';
    return [
      'Use ' +
        server +
        ' through the approved MCP tool boundary for this Cowork project.',
      '',
      'Project context:',
      '- Project: ' + (project.name || activeProjectId || 'current Cowork project'),
      '- Available MCP scope: ' + serverScope,
      '- Project workspace: ' + (project.path || project.slug || 'current project workspace'),
      '',
      'Source scope:',
      '- Filter: ' + filter,
      '- Date window: ' + dateWindow,
      '- Output artifact: ' + output,
      '',
      'Work plan:',
      '- Gather only the source context needed for this project question.',
      '- Summarize decisions, deadlines, risks, waiting items, source references, and recommended follow-up actions.',
      '- Save a ' +
        output +
        ' inside the project workspace before creating or updating anything outside NanoCrab.',
      '- Include a source ledger naming the MCP server, tool-call purpose, sender/topic filter, date window, and local artifact path.',
      '- If the requested MCP server or tool is not exposed, say which connector or permission is missing instead of inventing source results.',
      '- Ask for approval before sending email, publishing documents, changing calendar events, updating third-party records, or calling write-capable MCP tools.',
    ].join('\n');
  }

  window.applyProjectSourcePackPrompt = function () {
    var promptEl = document.getElementById('project-prompt');
    if (!promptEl) return;
    promptEl.value = projectSourcePackPromptText();
    promptEl.setSelectionRange(0, 0);
    promptEl.scrollTop = 0;
    promptEl.focus();
    promptEl.dispatchEvent(new Event('input', { bubbles: true }));
  };

  window.copyProjectSourcePackPrompt = async function () {
    await copyTextWithFallback(
      projectSourcePackPromptText(),
      'Source pack prompt copied',
      'Copy source pack prompt',
    );
  };

  window.clearProjectSourcePack = function () {
    ['project-source-server', 'project-source-filter', 'project-source-window'].forEach(function (id) {
      var field = document.getElementById(id);
      if (field) field.value = '';
    });
    var output = document.getElementById('project-source-output');
    if (output) output.value = 'markdown summary';
    document.getElementById('project-source-server')?.focus();
  };

  window.applyProjectInstructionPrompt = function () {
    var promptEl = document.getElementById('project-prompt');
    if (!promptEl) return;
    promptEl.value =
      'Help me draft durable project instructions for this workspace. Review the project files and chat history, then propose concise rules for tone, source-of-truth files, approval boundaries, MCP tool usage, document style, and recurring follow-up habits.';
    promptEl.setSelectionRange(0, 0);
    promptEl.scrollTop = 0;
    promptEl.focus();
    promptEl.dispatchEvent(new Event('input', { bubbles: true }));
  };

  window.createProject = async function () {
    var name = document.getElementById('project-name')?.value || '';
    var description = document.getElementById('project-description')?.value || '';
    var instructions = document.getElementById('project-instructions')?.value || '';
    if (!name.trim()) {
      toast('Project name is required', 'error');
      return;
    }
    try {
      var result = await api('/projects', {
        method: 'POST',
        body: JSON.stringify({ name: name, description: description, instructions: instructions }),
      });
      if (result.error || !result.project?.id) throw new Error(result.error || 'Project response was missing an id');
      activeProjectId = result.project.id;
      activeProjectFilePath = null;
      toast('Project created', 'success');
      refreshProjects();
    } catch (err) {
      toast(projectActionErrorMessage('create', err), 'error');
    }
  };

  window.createProjectFile = async function () {
    if (!activeProjectId) return;
    var filePath = document.getElementById('project-file-path')?.value || '';
    var content = document.getElementById('project-file-content')?.value || '';
    if (!filePath.trim()) {
      toast('File path is required', 'error');
      return;
    }
    try {
      var result = await api('/projects/' + encodeURIComponent(activeProjectId) + '/files', {
        method: 'POST',
        body: JSON.stringify({ path: filePath, content: content }),
      });
      if (result.error) throw new Error(result.error);
      activeProjectFilePath = result.file?.path || filePath;
      toast('File created', 'success');
      refreshProjects();
    } catch (err) {
      toast(projectActionErrorMessage('file', err), 'error');
    }
  };

  window.saveProjectSettings = async function () {
    if (!activeProjectId) return;
    var description =
      document.getElementById('project-settings-description')?.value || '';
    var instructions =
      document.getElementById('project-settings-instructions')?.value || '';
    var saveBtn = document.getElementById('project-settings-save-btn');
    var msg = document.getElementById('project-settings-msg');
    if (saveBtn && saveBtn.disabled) return;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }
    if (msg) msg.textContent = '';
    try {
      await api('/projects/' + encodeURIComponent(activeProjectId), {
        method: 'PATCH',
        body: JSON.stringify({
          description: description,
          instructions: instructions,
        }),
      });
      toast('Project context saved', 'success');
      refreshProjects();
    } catch (err) {
      var message = projectActionErrorMessage('context', err);
      if (msg) msg.textContent = message;
      toast(message, 'error');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save context';
      }
    }
  };

  window.previewProjectFile = async function (filePath) {
    if (!activeProjectId || !filePath) return;
    activeProjectFilePath = filePath;
    var preview = document.getElementById('project-file-preview');
    if (!preview) return;
    document.querySelectorAll('.project-file-row').forEach(function (row) {
      row.classList.toggle('active', row.dataset.filePath === filePath);
    });
    preview.innerHTML =
      '<div class="project-file-preview-loading">Loading ' + esc(filePath) + '</div>';
    try {
      var data = await api(
        '/projects/' +
          encodeURIComponent(activeProjectId) +
          '/files/read?path=' +
          encodeURIComponent(filePath),
      );
      if (data.error) throw new Error(data.error);
      var file = data.file || {};
      var content = typeof file.content === 'string' ? file.content : '';
      var previewBody =
        file.previewable && content
          ? '<pre class="project-file-preview-content" id="project-file-preview-content">' +
            esc(content) +
            '</pre>'
          : renderProjectFilePreviewState('unsupported');
      preview.innerHTML =
        '<div class="project-file-preview-head">' +
        '<div><span>File preview</span><strong>' +
        esc(file.path || filePath) +
        '</strong></div>' +
        '<div class="project-file-preview-actions">' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="useProjectFileInPrompt(' +
        jsStringAttr(file.path || filePath) +
        ')">Use in prompt</button>' +
        '<a class="btn btn-sm btn-ghost" href="' +
        esc(projectFileDownloadHref(file.path || filePath)) +
        '" download="' +
        esc(projectFileDownloadName(file.path || filePath)) +
        '">Download</a>' +
        (file.previewable
          ? '<button type="button" class="btn btn-sm btn-ghost" onclick="copyProjectFilePreview()">Copy</button>'
          : '') +
        '</div>' +
        '</div>' +
        previewBody +
        (file.truncated
          ? '<div class="project-file-preview-note">Preview truncated to the first 256 KB.</div>'
          : '');
    } catch (err) {
      preview.innerHTML =
        renderProjectFilePreviewState(
          'error',
          'Could not load file preview: ' + (err.message || 'unknown error'),
        );
    }
  };

  window.useProjectFileInPrompt = function (filePath) {
    var promptEl = document.getElementById('project-prompt');
    if (!promptEl || !filePath) return;
    var instruction =
      'Use the project file "' +
      filePath +
      '" as context. Summarize what matters, identify missing facts, and propose the next action.';
    var existing = promptEl.value.trim();
    promptEl.value = existing ? existing + '\n\n' + instruction : instruction;
    promptEl.focus();
    promptEl.dispatchEvent(new Event('input', { bubbles: true }));
  };

  window.copyProjectFilePreview = async function () {
    var content = document.getElementById('project-file-preview-content')?.textContent || '';
    if (!content) return;
    await copyTextWithFallback(
      content,
      'File preview copied',
      'Copy project file preview',
    );
  };

  window.copyProjectHandoffBrief = async function () {
    if (!activeProjectDetail && activeProjectId) {
      try {
        activeProjectDetail = await loadProjectDetail(activeProjectId);
      } catch (err) {
        toast(projectActionErrorMessage('handoff', err), 'error');
        return;
      }
    }
    var text = projectHandoffBriefText(activeProjectDetail);
    if (!text) {
      toast('Project handoff is not available', 'error');
      return;
    }
    await copyTextWithFallback(text, 'Project handoff copied', 'Copy project handoff');
  };

  window.selectProjectRun = function (runId) {
    activeProjectRunId = runId;
    refreshProjects();
  };

  window.createProjectRunFromPrompt = async function () {
    if (!activeProjectId) return;
    var prompt = document.getElementById('project-prompt')?.value || '';
    var title =
      document.getElementById('project-chat-title')?.value ||
      'Project run ' + new Date().toLocaleString();
    var provider = document.getElementById('project-chat-provider')?.value || '';
    var model = document.getElementById('project-chat-model')?.value || '';
    if (!prompt.trim()) {
      toast('Add a run prompt first', 'warning');
      document.getElementById('project-prompt')?.focus();
      return;
    }
    try {
      var result = await api('/projects/' + encodeURIComponent(activeProjectId) + '/runs', {
        method: 'POST',
        body: JSON.stringify({
          title: title,
          prompt: prompt,
          provider: provider || undefined,
          model: model || undefined,
        }),
      });
      if (result.error || !result.run?.id) {
        throw new Error(result.error || 'Could not create run');
      }
      activeProjectRunId = result.run.id;
      toast('Run created', 'success');
      refreshProjects();
    } catch (err) {
      toast('Run was not created. ' + (err.message || ''), 'error');
    }
  };

  window.setProjectRunAction = async function (runId, action) {
    if (!activeProjectId || !runId || !action) return;
    try {
      var body = { action: action };
      if (action === 'checkpoint') body.message = 'Waiting for operator approval';
      if (action === 'complete') body.summary = 'Run completed from project workspace';
      await api(
        '/projects/' +
          encodeURIComponent(activeProjectId) +
          '/runs/' +
          encodeURIComponent(runId),
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      );
      activeProjectRunId = runId;
      toast('Run updated', 'success');
      refreshProjects();
    } catch (err) {
      toast('Run update failed: ' + (err.message || ''), 'error');
    }
  };

  window.addProjectRunCitation = async function (runId) {
    if (!activeProjectId || !runId) return;
    var title =
      document.getElementById('project-run-citation-title-' + runId)?.value.trim() || '';
    var sourceUrl =
      document.getElementById('project-run-citation-url-' + runId)?.value.trim() || '';
    var note =
      document.getElementById('project-run-citation-note-' + runId)?.value.trim() || '';
    var msg = document.getElementById('project-run-citation-msg-' + runId);
    if (msg) msg.textContent = '';
    if (!title || !sourceUrl) {
      var inputError = 'Citation title and source URL are required';
      projectRunCitationFeedback[runId] = { tone: 'error', message: inputError };
      if (msg) msg.textContent = inputError;
      toast(inputError, 'warning');
      return;
    }
    try {
      var body = { title: title, sourceUrl: sourceUrl };
      if (note) body.note = note;
      await api(
        '/projects/' +
          encodeURIComponent(activeProjectId) +
          '/runs/' +
          encodeURIComponent(runId) +
          '/research/citations',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );
      activeProjectRunId = runId;
      var successMessage = 'Citation added';
      projectRunCitationFeedback[runId] = { tone: 'success', message: successMessage };
      if (msg) msg.textContent = successMessage;
      toast(successMessage, 'success');
      refreshProjects();
    } catch (err) {
      var failureMessage = 'Could not add citation: ' + (err.message || '');
      projectRunCitationFeedback[runId] = { tone: 'error', message: failureMessage };
      if (msg) msg.textContent = failureMessage;
      toast(failureMessage, 'error');
      refreshProjects();
    }
  };

  window.exportProjectRunCitationLedger = async function (runId) {
    if (!activeProjectId || !runId) return;
    var msg = document.getElementById('project-run-citation-msg-' + runId);
    if (msg) msg.textContent = '';
    try {
      var payload = await api(
        '/projects/' +
          encodeURIComponent(activeProjectId) +
          '/runs/' +
          encodeURIComponent(runId) +
          '/research/export-ledger',
        {
          method: 'POST',
        },
      );
      activeProjectRunId = runId;
      var successMessage =
        'Citation ledger exported to ' + ((payload.file && payload.file.path) || 'project file');
      projectRunCitationFeedback[runId] = { tone: 'success', message: successMessage };
      if (msg) msg.textContent = successMessage;
      toast(successMessage, 'success');
      refreshProjects();
    } catch (err) {
      var failureMessage = 'Could not export citation ledger: ' + (err.message || '');
      projectRunCitationFeedback[runId] = { tone: 'error', message: failureMessage };
      if (msg) msg.textContent = failureMessage;
      toast(failureMessage, 'error');
      refreshProjects();
    }
  };

  window.requestProjectRunAction = async function (runId) {
    if (!activeProjectId || !runId) return;
    var connectorId =
      document.getElementById('project-run-connector-' + runId)?.value.trim() || '';
    var action =
      document.getElementById('project-run-action-' + runId)?.value.trim() || '';
    var note = document.getElementById('project-run-note-' + runId)?.value.trim() || '';
    var msg = document.getElementById('project-run-action-msg-' + runId);
    if (msg) msg.textContent = '';
    if (!connectorId || !action) {
      var inputError = 'Connector id and action are required';
      projectRunActionFeedback[runId] = { tone: 'error', message: inputError };
      if (msg) msg.textContent = inputError;
      toast(inputError, 'warning');
      return;
    }
    try {
      var requestBody = {
        connectorId: connectorId,
        action: action,
      };
      if (note) requestBody.note = note;
      var response = await api(
        '/projects/' +
          encodeURIComponent(activeProjectId) +
          '/runs/' +
          encodeURIComponent(runId) +
          '/actions/request',
        {
          method: 'POST',
          body: JSON.stringify(requestBody),
        },
      );
      activeProjectRunId = runId;
      var successMessage = response.approvalRequired
        ? 'Action request submitted and waiting for approval.'
        : 'Action request authorized.';
      projectRunActionFeedback[runId] = { tone: 'success', message: successMessage };
      if (msg) msg.textContent = successMessage;
      toast(successMessage, 'success');
      refreshProjects();
    } catch (err) {
      var failureMessage = 'Action request failed: ' + (err.message || '');
      projectRunActionFeedback[runId] = { tone: 'error', message: failureMessage };
      if (msg) msg.textContent = failureMessage;
      toast(failureMessage, 'error');
      refreshProjects();
    }
  };

  window.addProjectContextItem = async function () {
    if (!activeProjectId) return;
    var title = document.getElementById('project-context-title')?.value || '';
    var source = document.getElementById('project-context-source')?.value || '';
    if (!title.trim()) {
      toast('Context title is required', 'warning');
      return;
    }
    try {
      await api('/projects/' + encodeURIComponent(activeProjectId) + '/context', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          source: source.trim() || 'manual',
          kind: 'note',
          included: true,
        }),
      });
      toast('Context note added', 'success');
      refreshProjects();
    } catch (err) {
      toast('Could not add context item: ' + (err.message || ''), 'error');
    }
  };

  window.toggleProjectContextInclude = async function (itemId, included) {
    if (!activeProjectId || !itemId || String(itemId).startsWith('auto:')) return;
    try {
      await api(
        '/projects/' +
          encodeURIComponent(activeProjectId) +
          '/context/' +
          encodeURIComponent(itemId),
        {
          method: 'PATCH',
          body: JSON.stringify({ included: Boolean(included) }),
        },
      );
      refreshProjects();
    } catch (err) {
      toast('Could not update context inclusion', 'error');
    }
  };

  window.toggleProjectContextPin = async function (itemId, pinned) {
    if (!activeProjectId || !itemId || String(itemId).startsWith('auto:')) return;
    try {
      await api(
        '/projects/' +
          encodeURIComponent(activeProjectId) +
          '/context/' +
          encodeURIComponent(itemId),
        {
          method: 'PATCH',
          body: JSON.stringify({ pinned: Boolean(pinned) }),
        },
      );
      refreshProjects();
    } catch (err) {
      toast('Could not update context pin state', 'error');
    }
  };

  window.removeProjectContextItem = async function (itemId) {
    if (!activeProjectId || !itemId || String(itemId).startsWith('auto:')) return;
    try {
      await api(
        '/projects/' +
          encodeURIComponent(activeProjectId) +
          '/context/' +
          encodeURIComponent(itemId),
        { method: 'DELETE' },
      );
      toast('Context item removed', 'success');
      refreshProjects();
    } catch (err) {
      toast('Could not remove context item', 'error');
    }
  };

  window.startProjectChat = async function () {
    if (!activeProjectId) return;
    var prompt = document.getElementById('project-prompt')?.value || '';
    var provider = document.getElementById('project-chat-provider')?.value || '';
    var model = document.getElementById('project-chat-model')?.value || '';
    var title = document.getElementById('project-chat-title')?.value || '';
    var startBtn = document.getElementById('project-chat-start-btn');
    if (startBtn && startBtn.disabled) return;
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = prompt.trim() ? 'Starting...' : 'Creating...';
    }

    try {
      if (provider) {
        localStorage.setItem('projectchat_last_provider', provider);
        projectProviderState = projectProviderState || {};
        projectProviderState.selectedProvider = provider;
      }
      if (provider && model) {
        localStorage.setItem('projectchat_last_model_' + provider, model);
        if (projectProviderState) projectProviderState.selectedModel = model;
      }
      var threadBody = {};
      if (provider) threadBody.provider = provider;
      if (model) threadBody.model = model;
      if (title.trim()) threadBody.title = title.trim();
      var result = await api('/projects/' + encodeURIComponent(activeProjectId) + '/threads', {
        method: 'POST',
        body: JSON.stringify(threadBody),
      });
      var promptError = null;
      if (prompt.trim()) {
        try {
          await api('/threads/' + encodeURIComponent(result.id) + '/messages', {
            method: 'POST',
            body: JSON.stringify({ message: prompt }),
          });
        } catch (err) {
          promptError = err;
        }
      }
      window.location.hash = projectChatHash(activeProjectId, result.id);
      if (promptError) {
        toast(projectActionErrorMessage('firstMessage', promptError), 'error');
      }
    } catch (err) {
      toast(projectActionErrorMessage('chat', err), 'error');
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.textContent = 'Start project chat';
      }
    }
  };
})();
