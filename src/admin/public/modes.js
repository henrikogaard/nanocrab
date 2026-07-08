// NanoCrab — mode-first navigation config & pure helpers.
// Loaded as a classic <script defer> BEFORE app.js (sets window.NanoModes),
// and imported by vitest for unit tests (sets globalThis.NanoModes).
// Plain classic-script JS only: no import/export (build copies this verbatim).
(function () {
  const MODES = {
    chat: {
      id: 'chat',
      label: 'Chat',
      icon: 'chat',
      guidance: 'Plain chat for quick questions, writing, and thinking.',
      pages: ['chat'],
    },
    cowork: {
      id: 'cowork',
      label: 'Cowork',
      icon: 'agents',
      guidance: 'Projects, files, artifacts, chats, and approved tools.',
      pages: ['projects'],
    },
    code: {
      id: 'code',
      label: 'Code',
      icon: 'gitcode',
      guidance: 'Repositories, Copilot, tests, PRs, and handoffs.',
      pages: ['gitcode'],
    },
  };
  const MODE_ORDER = ['chat', 'cowork', 'code'];
  const HIDDEN_PAGE_MODES = {
    'project-chat': 'cowork',
  };

  // Admin / operations pages — reachable via the "More" drawer, not a mode.
  const MORE_IDS = [
    'dashboard',
    'agents',
    'tasks',
    'workflows',
    'reports',
    'artifacts',
    'approvals',
    'devhub',
    'autofix',
    'copilot',
    'channels',
    'messages',
    'pipelines',
    'monitoring',
    'containers',
    'integrations',
    'webhooks',
    'credentials',
    'security',
    'audit',
    'uptime',
    'memory',
    'skills',
    'timeline',
    'settings',
    'groups',
    'sessions',
    'marketplace',
    'backup',
    'usage',
    'help',
  ];

  function resolveMode(pageId) {
    if (HIDDEN_PAGE_MODES[pageId]) return HIDDEN_PAGE_MODES[pageId];
    for (const m of MODE_ORDER) {
      if (MODES[m] && MODES[m].pages.indexOf(pageId) !== -1) return m;
    }
    return null;
  }

  function navPagesForMode(modeId) {
    return MODES[modeId] ? MODES[modeId].pages.slice() : [];
  }

  function modeGuidance(modeId) {
    return MODES[modeId] ? MODES[modeId].guidance : '';
  }

  function loadActiveMode(storage) {
    let saved = null;
    try {
      saved = storage && storage.getItem('active_mode');
    } catch {
      saved = null;
    }
    if (saved === 'work') return 'cowork';
    return MODE_ORDER.indexOf(saved) !== -1 ? saved : MODE_ORDER[0];
  }

  function saveActiveMode(modeId, storage) {
    if (MODE_ORDER.indexOf(modeId) === -1) return false;
    try {
      if (storage) storage.setItem('active_mode', modeId);
      return true;
    } catch {
      return false;
    }
  }

  const NanoModes = { MODES, MODE_ORDER, MORE_IDS, resolveMode, navPagesForMode, modeGuidance, loadActiveMode, saveActiveMode };
  const g = typeof globalThis !== 'undefined' ? globalThis : window;
  g.NanoModes = NanoModes;
})();
