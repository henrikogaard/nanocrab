/* global window */

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

  window.NanoFileVaultStates = {
    renderFilesEmptyState,
    renderFilesLoadingState,
  };
})();
