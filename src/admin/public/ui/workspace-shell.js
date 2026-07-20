(function () {
  function route(mode, section) {
    return Object.freeze([mode, section]);
  }

  const ROUTES = Object.freeze({
    dashboard: route('today', 'overview'),
    chat: route('chat', 'conversation'),
    projects: route('cowork', 'project'),
    reports: route('cowork', 'report'),
    'source-collections': route('cowork', 'source'),
    tasks: route('cowork', 'routine'),
    workflows: route('cowork', 'workflow'),
    artifacts: route('cowork', 'artifact'),
    approvals: route('cowork', 'approval'),
    gitcode: route('code', 'repository'),
    devhub: route('code', 'terminal'),
    autofix: route('code', 'automation'),
    copilot: route('code', 'delegation'),
    sessions: route('code', 'session'),
    'session-detail': route('code', 'session'),
    security: route('more', 'security'),
    audit: route('more', 'audit'),
    settings: route('more', 'settings'),
  });
  const SESSION_PAGES = ['sessions', 'session-detail'];
  const SESSION_MODES = ['chat', 'cowork', 'code'];
  const UNKNOWN_ROUTE = route('more', 'tool');
  const WORKSPACE_STATES = [
    'ready',
    'loading',
    'empty',
    'partial',
    'blocked',
    'error',
  ];

  function escapeHtml(value) {
    const characters = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return String(value ?? '').replace(/[&<>"']/g, function (character) {
      return characters[character];
    });
  }

  function resolveRoute(pageId, preferredMode) {
    const resolved = Object.prototype.hasOwnProperty.call(ROUTES, pageId)
      ? ROUTES[pageId]
      : UNKNOWN_ROUTE;
    const preservesPreferredMode =
      SESSION_PAGES.includes(pageId) &&
      SESSION_MODES.includes(preferredMode) &&
      (!window.NanoModes ||
        window.NanoModes.MODE_ORDER.includes(preferredMode));
    const mode = preservesPreferredMode ? preferredMode : resolved[0];

    return {
      pageId,
      mode,
      section: resolved[1],
      isToday: resolved[0] === 'today',
    };
  }

  function pageLabel(pageId) {
    const metadata =
      window.NanoShellNavigation && window.NanoShellNavigation.PAGE_META;
    return (
      (metadata && metadata[pageId] && metadata[pageId].label) || 'workspace'
    );
  }

  function renderNextAction(model) {
    if (!model) return '';

    const pageId = model.pageId || '';
    const title = model.title || 'Continue this workspace';
    const detail = model.detail || '';
    const actionLabel =
      model.actionLabel || (pageId ? 'Open ' + pageLabel(pageId) : 'Continue');

    return (
      '<article class="focus-next-action" data-page-id="' +
      escapeHtml(pageId) +
      '">' +
      '<span>Next action</span>' +
      '<strong>' +
      escapeHtml(title) +
      '</strong>' +
      (detail ? '<p>' + escapeHtml(detail) + '</p>' : '') +
      (pageId
        ? '<button type="button" data-focus-route="' +
          escapeHtml(pageId) +
          '">' +
          escapeHtml(actionLabel) +
          '</button>'
        : '') +
      '</article>'
    );
  }

  function renderWorkspaceState(model) {
    const resolved = model || {};
    const status = WORKSPACE_STATES.includes(resolved.status)
      ? resolved.status
      : 'neutral';
    const label = resolved.label || 'Workspace state';
    const title = resolved.title || 'Workspace ready';
    const detail = resolved.detail || '';

    return (
      '<section class="focus-workspace-state is-' +
      status +
      '" data-state="' +
      status +
      '" role="status">' +
      '<span>' +
      escapeHtml(label) +
      '</span>' +
      '<strong>' +
      escapeHtml(title) +
      '</strong>' +
      (detail ? '<p>' + escapeHtml(detail) + '</p>' : '') +
      renderNextAction(resolved.nextAction) +
      '</section>'
    );
  }

  window.NanoWorkspaceShell = {
    ROUTES,
    resolveRoute,
    renderNextAction,
    renderWorkspaceState,
  };
})();
