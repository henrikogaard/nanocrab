(function () {
  var esc =
    (window.NanoShared && window.NanoShared.esc) ||
    window.esc ||
    function (value) {
      return String(value || '');
    };

  function routeRecoveryBriefText(state) {
    var recoveryState = state || {};
    return [
      'NanoCrab route recovery brief',
      '',
      `Page: ${recoveryState.page || 'unknown'}`,
      `Title: ${recoveryState.title || 'Route recovery'}`,
      `Error: ${recoveryState.message || 'unknown'}`,
      `Request path: ${recoveryState.path || 'unknown'}`,
      `HTTP status: ${recoveryState.status || 'unknown'}`,
      `Retry after: ${recoveryState.retryAfter || 'not provided'}`,
      '',
      'Recovery routes:',
      '- Copilot: switch to plain conversation or draft the next request.',
      '- Cowork: preserve project work, files, artifacts, and MCP context.',
      '- Code: inspect repository or implementation issues.',
      '- Help: confirm the correct surface and route.',
      '',
      'Operator guidance:',
      '- Try the failed page again after checking any retry-after hint.',
      '- Open Logs or Monitoring if the same page fails repeatedly.',
      '- Keep any external MCP/document/email/calendar writes approval-gated while recovering.',
    ].join('\n');
  }

  function renderRouteRecoveryActions(retryPage, includeCopy) {
    return `<div class="route-recovery-actions">
    <button class="btn btn-sm btn-primary" onclick="navigate('${esc(retryPage)}')">Retry</button>
    ${includeCopy ? '<button class="btn btn-sm btn-ghost" onclick="copyRouteRecoveryBrief()">Copy recovery brief</button>' : ''}
    <button class="btn btn-sm btn-ghost" onclick="navigate('chat')">Copilot</button>
    <button class="btn btn-sm btn-ghost" onclick="navigate('projects')">Cowork</button>
    <button class="btn btn-sm btn-ghost" onclick="navigate('gitcode')">Code</button>
    <button class="btn btn-sm btn-ghost" onclick="navigate('help')">Help</button>
  </div>`;
  }

  function setRouteRecoveryState(state) {
    window._routeRecoveryState = state;
  }

  function renderPageError(el, err, title, options) {
    var currentPage = (options && options.currentPage) || 'dashboard';
    var safeTitle = title || 'Could not load this page';
    setRouteRecoveryState({
      page: currentPage,
      title: safeTitle,
      message: err?.message || 'Unknown dashboard error',
      retryAfter: err?.retryAfter || '',
      path: err?.path || '',
      status: err?.status || '',
    });
    var retry = err?.retryAfter
      ? `<p class="route-recovery-retry">Retry after ${esc(err.retryAfter)} seconds.</p>`
      : '';
    el.innerHTML = `
    <section class="route-recovery-card is-error">
      <span class="route-recovery-kicker">Page recovery</span>
      <h2>${esc(safeTitle)}</h2>
      <p>Try again or move to another workspace lane.</p>
      <div class="route-recovery-facts">
        <span>${esc(err?.message || 'Unknown dashboard error')}</span>
        ${retry}
      </div>
      ${renderRouteRecoveryActions(currentPage, true)}
    </section>`;
  }

  function renderNotFoundPage(el, page) {
    setRouteRecoveryState({
      page,
      title: 'Route not found',
      message: 'This workspace route is not available',
      retryAfter: '',
      path: '',
      status: '404',
    });
    el.innerHTML = `
    <section class="route-recovery-card is-missing">
      <span class="route-recovery-kicker">Route not found</span>
      <h2>This workspace route is not available</h2>
      <p>The requested page "${esc(page)}" is not registered in this dashboard.</p>
      <div class="route-recovery-facts">
        <span>Copilot for plain chat</span>
        <span>Cowork for projects and agents</span>
        <span>Code for repositories</span>
      </div>
      ${renderRouteRecoveryActions('dashboard', true)}
    </section>`;
  }

  async function copyRouteRecoveryBrief() {
    var text = routeRecoveryBriefText(window._routeRecoveryState || {});
    await window.copyTextWithFallback(
      text,
      'Route recovery brief copied',
      'Copy route recovery brief',
    );
  }

  window.NanoRecovery = {
    routeRecoveryBriefText,
    renderRouteRecoveryActions,
    renderPageError,
    renderNotFoundPage,
    copyRouteRecoveryBrief,
  };
  window.copyRouteRecoveryBrief = copyRouteRecoveryBrief;
})();
