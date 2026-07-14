(function () {
  var esc =
    (window.NanoShared && window.NanoShared.esc) ||
    window.esc ||
    function (value) {
      return String(value || '');
    };

  function renderFilesEmptyState(kind) {
    var resolvedKind = kind || 'group-select';
    var variants = {
      groups: {
        title: 'No group folders found',
        detail:
          'Connect a channel, start in Copilot, or create a Cowork project before expecting reusable group context here.',
        flow: ['Connect', 'Collect', 'Promote'],
        actions: `
        <button type="button" class="btn btn-sm btn-primary" onclick="navigate('channels')">Channels</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('chat')">Copilot</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('projects')">Cowork</button>`,
      },
      'group-select': {
        title: 'Select a group to browse its files',
        detail:
          'Use the group folder to inspect AGENTS.md, private runtime memory, conversations, and raw channel uploads before promoting anything durable.',
        flow: ['Inspect', 'Decide', 'Promote'],
        actions: `
        <button type="button" class="btn btn-sm btn-primary" onclick="copyFileVaultBrief()">Copy vault brief</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('projects')">Open Cowork</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('memory')">Memory</button>`,
      },
      conversations: {
        title: 'No saved conversations',
        detail:
          'This group has no archived threads yet. Start with Copilot or Cowork when you need recoverable working history.',
        flow: ['Copilot', 'Archive', 'Summarize'],
        actions: `
        <button type="button" class="btn btn-sm btn-primary" onclick="navigate('chat')">Start Copilot</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('projects')">Project chats</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="copyFileGroupBrief()">Copy group brief</button>`,
      },
      attachments: {
        title: 'No attachments',
        detail:
          'Raw uploads will appear here before they are promoted into project files, artifacts, memory, or reports.',
        flow: ['Upload', 'Review', 'Promote'],
        actions: `
        <button type="button" class="btn btn-sm btn-primary" onclick="navigate('projects')">Cowork files</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('artifacts')">Artifacts</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="copyFileGroupBrief()">Copy group brief</button>`,
      },
      artifacts: {
        title: 'No group artifacts',
        detail:
          'Raw group artifacts wait here until promoted into a Cowork project.',
        flow: ['Review', 'Promote', 'Continue'],
        actions: `
        <button type="button" class="btn btn-sm btn-primary" onclick="navigate('projects')">Cowork files</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('artifacts')">Artifact vault</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="copyFileGroupBrief()">Copy group brief</button>`,
      },
      failed: {
        title: 'Failed to load file',
        detail:
          'The file preview could not be opened. Use the group brief for handoff, then retry or open the raw download path.',
        flow: ['Retry', 'Brief', 'Route'],
        actions: `
        <button type="button" class="btn btn-sm btn-primary" onclick="copyFileGroupBrief()">Copy group brief</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Monitoring</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('projects')">Cowork</button>`,
      },
      unavailable: {
        title: 'File vault unavailable',
        detail:
          'The group file catalog did not load. Retry before assuming there are no group instructions, memories, conversations, or uploads.',
        flow: ['Retry', 'Monitor', 'Route'],
        actions: `
        <button type="button" class="btn btn-sm btn-primary" onclick="navigate('files')">Retry</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Monitoring</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('projects')">Cowork</button>`,
      },
      'conversations-unavailable': {
        title: 'Conversation archive unavailable',
        detail:
          'Saved thread history did not load for this group. Retry before asking an agent to summarize or resume from prior conversation context.',
        flow: ['Retry', 'Brief', 'Cowork'],
        actions: `
        <button type="button" class="btn btn-sm btn-primary" onclick="selectGroup(window._fileGroupState?.folder)">Retry group</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="copyFileGroupBrief()">Copy group brief</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('projects')">Cowork</button>`,
      },
      'attachments-unavailable': {
        title: 'Attachment archive unavailable',
        detail:
          'Raw channel uploads did not load for this group. Retry before promoting files into Cowork, Artifacts, Memory, or Reports.',
        flow: ['Retry', 'Inspect', 'Promote'],
        actions: `
        <button type="button" class="btn btn-sm btn-primary" onclick="selectGroup(window._fileGroupState?.folder)">Retry group</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('artifacts')">Artifacts</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('projects')">Cowork</button>`,
      },
      'artifacts-unavailable': {
        title: 'Artifact archive unavailable',
        detail:
          'Saved group artifacts did not load for this group. Retry before promoting outputs into Cowork project files.',
        flow: ['Retry', 'Promote', 'Cowork'],
        actions: `
        <button type="button" class="btn btn-sm btn-primary" onclick="selectGroup(window._fileGroupState?.folder)">Retry group</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('artifacts')">Artifact vault</button>
        <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('projects')">Cowork</button>`,
      },
    };
    var empty = variants[resolvedKind] || variants['group-select'];
    return `
    <div class="files-empty-state files-action-empty ${resolvedKind.includes('unavailable') ? 'is-warning' : ''}">
      <div>
        <h3>${esc(empty.title)}</h3>
        <p>${esc(empty.detail)}</p>
      </div>
      <div class="files-empty-flow">
        ${empty.flow.map((item) => `<span>${esc(item)}</span>`).join('')}
      </div>
      <div class="files-empty-actions">${empty.actions}</div>
	    </div>`;
  }

  function renderFilesLoadingState(kind) {
    var resolvedKind = kind || 'group';
    var isConversation = resolvedKind === 'conversation';
    return `
    <section class="files-loading-state ${isConversation ? 'is-conversation' : ''}" aria-busy="true" aria-label="${isConversation ? 'Loading conversation file' : 'Loading group files'}">
      <div>
        <span>Context vault</span>
        <strong>${isConversation ? 'Loading conversation transcript' : 'Loading group context'}</strong>
        <p>${isConversation ? 'Opening the saved thread so it can be inspected, copied, or routed into Cowork.' : 'Gathering AGENTS.md, memory, saved conversations, and uploads for this group folder.'}</p>
      </div>
      <div class="files-loading-bars" aria-hidden="true"><i></i><i></i><i></i></div>
    </section>`;
  }

  function fileContextCards() {
    return [
      {
        title: 'Personal memory',
        body: 'Global MEMORY.md stays personal and private.',
        meta: 'private runtime memory',
      },
      {
        title: 'Group instructions',
        body: 'AGENTS.md defines group-specific behavior.',
        meta: 'agent context',
      },
      {
        title: 'Thread history',
        body: 'Saved threads support audit and context recovery.',
        meta: 'conversation archive',
      },
      {
        title: 'Channel uploads',
        body: 'Uploaded files and media from channels.',
        meta: 'attachments',
      },
    ];
  }

  function filePromotionChecklist() {
    return [
      {
        title: 'Classify the source',
        detail:
          'Decide whether the item is private memory, group instructions, chat history, a channel upload, or project evidence.',
      },
      {
        title: 'Pick the durable home',
        detail:
          'Move reusable project work to Cowork, final outputs to Artifacts, source-backed summaries to Reports, and personal facts to Memory.',
      },
      {
        title: 'Preserve provenance',
        detail:
          'Keep the group folder, filename, sender/channel, timestamp, and conversation reference with any promoted output.',
      },
      {
        title: 'Require approval for edits',
        detail:
          'Ask before changing AGENTS.md, MEMORY.md, external documents, channel-visible files, or MCP-backed source systems.',
      },
    ];
  }

  function formatBytes(bytes) {
    var num = Number(bytes || 0);
    if (Number.isNaN(num) || !Number.isFinite(num) || num <= 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var value = num;
    var unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    if (unit === 0) return value + ' ' + units[unit];
    return value.toFixed(value >= 10 ? 0 : 1) + ' ' + units[unit];
  }

  function formatTime(value) {
    if (!value) return 'unknown';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toISOString().replace('T', ' ').replace('.000Z', 'Z');
  }

  function fileVaultBriefText(state) {
    var groups = state && state.groups ? state.groups : [];
    var stats = state && state.stats ? state.stats : {};
    var cards = state && state.cards ? state.cards : fileContextCards();
    var loadIssues = Array.isArray(state && state.loadIssues)
      ? state.loadIssues.filter(Boolean)
      : [];
    var groupLines = groups
      .slice(0, 12)
      .map(function (group) {
        var signals = [
          group.hasAgentsMd ? 'AGENTS.md' : '',
          group.hasConversations ? 'threads' : '',
          group.hasAttachments ? 'uploads' : '',
        ].filter(Boolean);
        return '- ' + (group.name || 'unnamed') + ': ' + (signals.join(', ') || 'empty');
      });
    var cardLines = cards.map(function (card) {
      return '- ' + card.title + ': ' + card.body;
    });

    return [
      'Files context vault brief',
      '',
      'Groups: ' + (stats.groups || 0),
      'Instruction files: ' + (stats.agentFiles || 0),
      'Conversation archives: ' + (stats.conversations || 0),
      'Attachment folders: ' + (stats.attachments || 0),
      'Data health: ' +
        (loadIssues.length
          ? loadIssues.join('; ')
          : 'File vault catalog loaded without known fallback.'),
      '',
      'Use this vault to inspect group-local context before asking an agent to resume, audit, or summarize work.',
      'Keep personal memory in the personal Memory space, group behavior in AGENTS.md, project work in Cowork projects, and raw channel uploads here until promoted into an artifact.',
      'When asking an agent to work from this context, name the group folder, expected output, files to inspect, and whether any memory or instruction edits need approval.',
      '',
      'Context boundaries',
      ].concat(cardLines).concat([
        '',
        'Promotion checklist',
      ]).concat(
        filePromotionChecklist().map(function (item) {
          return '- ' + item.title + ': ' + item.detail;
        }),
      ).concat([
        '',
        'Group folders',
      ]).concat(groupLines.length ? groupLines : ['- No group folders found.']);
  }

  function fileGroupBriefText(state) {
    var folder = (state && state.folder) || 'unknown';
    var agentsMd = (state && state.agentsMd) || {};
    var memoryMd = state && state.memoryMd ? state.memoryMd : null;
    var conversations = state && Array.isArray(state.conversations)
      ? state.conversations
      : [];
    var attachments = state && Array.isArray(state.attachments)
      ? state.attachments
      : [];
    var loadIssues = Array.isArray(state && state.loadIssues)
      ? state.loadIssues.filter(Boolean)
      : [];
    var conversationLines = conversations
      .slice(0, 8)
      .map(function (file) {
        return (
          '- ' +
          (file.name || 'unknown') +
          ' (' +
          formatBytes(file.size) +
          ', ' +
          formatTime(file.modified) +
          ')'
        );
      });
    var attachmentLines = attachments
      .slice(0, 8)
      .map(function (file) {
        return (
          '- ' +
          (file.name || 'unknown') +
          ' (' +
          formatBytes(file.size) +
          ', ' +
          formatTime(file.modified) +
          ')'
        );
      });

    return [
      'Group context brief',
      '',
      'Group: ' + folder,
      'AGENTS.md: ' + (agentsMd && agentsMd.content ? 'present' : 'empty or missing'),
      'Private memory visible here: ' + (memoryMd ? 'yes' : 'no'),
      'Conversations: ' + conversations.length,
      'Attachments: ' + attachments.length,
      'Data health: ' +
        (loadIssues.length
          ? loadIssues.join('; ')
          : 'Group files loaded without known fallback.'),
      '',
      'Use this when asking an agent to resume work from a group folder or turn channel history into a Cowork project artifact.',
      'Inspect AGENTS.md before changing behavior, treat MEMORY.md as private personal/runtime context, and move durable project outputs into Cowork artifacts instead of leaving them as raw uploads.',
      'For MCP-enabled Cowork work, cite the group folder and request explicit approval before editing memory, instructions, external documents, or channel-visible content.',
      '',
      'Conversation files',
    ]
      .concat(conversationLines.length ? conversationLines : ['- No saved conversations.'])
      .concat([
        '',
        'Attachments',
      ])
      .concat(attachmentLines.length ? attachmentLines : ['- No attachments.'])
      .join('\n');
  }

  async function copyFileVaultBrief() {
    if (!window._fileVaultState) {
      window.NanoFeedback?.toast('Open files first', 'warning');
      return;
    }
    var text = fileVaultBriefText(window._fileVaultState);
    await window.NanoFeedback.copyTextWithFallback(
      text,
      'Files vault brief copied',
      'Copy files vault brief',
    );
  }

  async function copyFileGroupBrief() {
    if (!window._fileGroupState) {
      window.NanoFeedback?.toast('Select a group first', 'warning');
      return;
    }
    var text = fileGroupBriefText(window._fileGroupState);
    await window.NanoFeedback.copyTextWithFallback(
      text,
      'Group context brief copied',
      'Copy group context brief',
    );
  }

  window.NanoFileVaultStates = {
    renderFilesEmptyState,
    renderFilesLoadingState,
    fileContextCards,
    filePromotionChecklist,
    fileVaultBriefText,
    fileGroupBriefText,
    copyFileVaultBrief,
    copyFileGroupBrief,
  };
})();
