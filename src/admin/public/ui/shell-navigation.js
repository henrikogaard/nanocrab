(function () {
  // Page display metadata for every navigable page id.
  const PAGE_META = {
    chat: { label: 'Chat', icon: 'chat' },
    projects: { label: 'Cowork Projects', icon: 'agents' },
    channels: { label: 'Channels', icon: 'messages' },
    messages: { label: 'Messages', icon: 'messages' },
    agents: { label: 'Agents', icon: 'agents' },
    groups: { label: 'Groups', icon: 'groups' },
    tasks: { label: 'Tasks', icon: 'tasks' },
    approvals: { label: 'Approvals', icon: 'approvals' },
    sessions: { label: 'Sessions', icon: 'sessions' },
    'session-detail': { label: 'Session Detail', icon: 'sessions' },
    workflows: { label: 'Workflows', icon: 'workflows' },
    reports: { label: 'Reports', icon: 'audit' },
    artifacts: { label: 'Artifacts', icon: 'artifacts' },
    memory: { label: 'Memory', icon: 'memory' },
    timeline: { label: 'Timeline', icon: 'timeline' },
    gitcode: { label: 'Git & Code', icon: 'gitcode' },
    devhub: { label: 'Terminal', icon: 'devhub' },
    autofix: { label: 'AutoFix', icon: 'autofix' },
    skills: { label: 'Skills', icon: 'skills' },
    marketplace: { label: 'Marketplace', icon: 'marketplace' },
    dashboard: { label: 'Dashboard', icon: 'dashboard' },
    pipelines: { label: 'Deploy', icon: 'pipelines' },
    'control-plane': { label: 'Control Plane', icon: 'control-plane' },
    monitoring: { label: 'Monitoring', icon: 'monitoring' },
    containers: { label: 'Containers', icon: 'containers' },
    integrations: { label: 'Integrations', icon: 'integrations' },
    webhooks: { label: 'Webhooks', icon: 'webhooks' },
    credentials: { label: 'Credentials', icon: 'credentials' },
    security: { label: 'Security', icon: 'security' },
    audit: { label: 'Audit', icon: 'audit' },
    uptime: { label: 'Uptime', icon: 'uptime' },
    copilot: { label: 'Copilot', icon: 'copilot' },
    backup: { label: 'Backup', icon: 'backup' },
    usage: { label: 'Usage', icon: 'usage' },
    settings: { label: 'Settings', icon: 'settings' },
    help: { label: 'Help', icon: 'help' },
  };

  const MORE_DRAWER_SECTIONS = [
    {
      title: 'Cowork',
      detail: 'Project setup, agent work, drafts, and approvals.',
      pages: [
        'agents',
        'tasks',
        'workflows',
        'reports',
        'artifacts',
        'approvals',
      ],
    },
    {
      title: 'Code',
      detail: 'Repos, terminals, delegated fixes, and Copilot jobs.',
      pages: ['devhub', 'autofix', 'copilot'],
    },
    {
      title: 'Operate',
      detail: 'Home, health, delivery, recovery, and costs.',
      pages: [
        'dashboard',
        'messages',
        'pipelines',
        'control-plane',
        'monitoring',
        'uptime',
        'backup',
        'usage',
      ],
    },
    {
      title: 'Connect',
      detail: 'Channels, tools, credentials, and sessions.',
      pages: [
        'channels',
        'integrations',
        'webhooks',
        'credentials',
        'containers',
        'groups',
        'sessions',
      ],
    },
    {
      title: 'Personal',
      detail: 'Memory, skills, settings, and help.',
      pages: [
        'memory',
        'skills',
        'settings',
        'timeline',
        'marketplace',
        'help',
      ],
    },
    {
      title: 'Govern',
      detail: 'Security and audit trail.',
      pages: ['security', 'audit'],
    },
  ];

  const VIEWER_HIDDEN = [
    'devhub',
    'gitcode',
    'pipelines',
    'control-plane',
    'containers',
    'audit',
    'security',
    'integrations',
    'marketplace',
  ];

  function metaLabel(id) {
    return (PAGE_META[id] && PAGE_META[id].label) || id;
  }

  function metaIcon(id) {
    return (PAGE_META[id] && PAGE_META[id].icon) || 'integrations';
  }

  function moreDrawerSections(ids) {
    const available = new Set(ids || []);
    return MORE_DRAWER_SECTIONS.map((section) => ({
      ...section,
      pages: section.pages.filter((id) => available.has(id)),
    })).filter((section) => section.pages.length > 0);
  }

  function isVisibleForRole(id) {
    const role = window._userRole || 'owner';
    if (role === 'viewer') return !VIEWER_HIDDEN.includes(id);
    return true;
  }

  window.NanoShellNavigation = {
    PAGE_META,
    MORE_DRAWER_SECTIONS,
    VIEWER_HIDDEN,
    metaLabel,
    metaIcon,
    moreDrawerSections,
    isVisibleForRole,
  };
})();
