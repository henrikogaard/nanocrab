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
      pages: ['chat', 'messages'],
    },
    work: {
      id: 'work',
      label: 'Work',
      icon: 'agents',
      pages: [
        'agents',
        'groups',
        'tasks',
        'approvals',
        'sessions',
        'workflows',
        'reports',
        'artifacts',
        'memory',
        'timeline',
      ],
    },
    code: {
      id: 'code',
      label: 'Code',
      icon: 'gitcode',
      pages: ['gitcode', 'devhub', 'autofix', 'skills', 'marketplace'],
    },
  };
  const MODE_ORDER = ['chat', 'work', 'code'];

  // Admin / operations pages — reachable via the "More" drawer, not a mode.
  const MORE_IDS = [
    'dashboard',
    'pipelines',
    'monitoring',
    'containers',
    'integrations',
    'webhooks',
    'credentials',
    'security',
    'audit',
    'uptime',
    'copilot',
    'backup',
    'usage',
    'settings',
    'help',
  ];

  function resolveMode(pageId) {
    for (const m of MODE_ORDER) {
      if (MODES[m] && MODES[m].pages.indexOf(pageId) !== -1) return m;
    }
    return null;
  }

  function navPagesForMode(modeId) {
    return MODES[modeId] ? MODES[modeId].pages.slice() : [];
  }

  function loadActiveMode(storage) {
    let saved = null;
    try {
      saved = storage && storage.getItem('active_mode');
    } catch {
      saved = null;
    }
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

  const NanoModes = { MODES, MODE_ORDER, MORE_IDS, resolveMode, navPagesForMode, loadActiveMode, saveActiveMode };
  const g = typeof globalThis !== 'undefined' ? globalThis : window;
  g.NanoModes = NanoModes;
})();
