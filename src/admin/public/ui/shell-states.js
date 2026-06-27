(function () {
  var esc =
    (window.NanoShared && window.NanoShared.esc) ||
    window.esc ||
    function (value) {
      return String(value || '');
    };

  function renderShellLoadingState(
    title,
    detail,
    compact,
  ) {
    var safeTitle = title || 'Loading workspace';
    var safeDetail =
      detail || 'Preparing navigation, live status, and page tools.';
    return (
      '<section class="shell-loading-state ' +
      (compact ? 'shell-loading-state-compact' : '') +
      '" aria-busy="true" aria-label="' +
      esc(safeTitle) +
      '">' +
      '<div class="shell-loading-copy">' +
      '<span>Workspace loading</span>' +
      '<strong>' +
      esc(safeTitle) +
      '</strong>' +
      '<p>' +
      esc(safeDetail) +
      '</p>' +
      '</div>' +
      '<div class="shell-loading-steps" aria-hidden="true">' +
      '<i></i><i></i><i></i>' +
      '</div>' +
      '</section>'
    );
  }

  function renderTabLoadErrorState(containerId, tabId, err) {
    return `<section class="tab-load-error-state" role="status">
    <div>
      <span>Tab unavailable</span>
      <strong>Could not load this workspace section</strong>
      <p>Keep the current page open, then retry the tab or route the work through Monitoring, Help, or the active Copilot, Cowork, or Code focus.</p>
      ${err?.message ? `<code>${esc(err.message)}</code>` : ''}
    </div>
    <div class="tab-load-error-actions">
      <button type="button" class="btn btn-sm btn-primary" onclick="window._tabLoaderRegistry?.['${esc(containerId)}']?.('${esc(tabId)}')">Retry tab</button>
      <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('monitoring')">Monitoring</button>
      <button type="button" class="btn btn-sm btn-ghost" onclick="navigate('help')">Help</button>
    </div>
  </section>`;
  }

  function renderTabs(containerId, tabs, defaultTab) {
    var tabBar = tabs
      .map(
        function (t) {
          return `<button type="button" role="tab" id="${containerId}-tab-${t.id}" aria-selected="${t.id === defaultTab ? 'true' : 'false'}" aria-controls="${containerId}-${t.id}" tabindex="${t.id === defaultTab ? '0' : '-1'}" class="tab ${t.id === defaultTab ? 'active' : ''}" data-tab-id="${t.id}" onclick="switchTab('${containerId}','${t.id}')" onkeydown="handleTabKeydown(event,'${containerId}','${t.id}')">${t.label}</button>`;
        },
      )
      .join('');
    var tabContents = tabs
      .map(
        function (t) {
          return `<div role="tabpanel" aria-labelledby="${containerId}-tab-${t.id}" class="tab-content ${t.id === defaultTab ? 'active' : ''}" id="${containerId}-${t.id}"></div>`;
        },
      )
      .join('');
    return `<div class="tab-bar" role="tablist">${tabBar}</div>${tabContents}`;
  }

  function switchTab(containerId, tabId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.tab').forEach(function (t) {
      var isActive = t.dataset.tabId === tabId;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      t.tabIndex = isActive ? 0 : -1;
      if (isActive) t.focus({ preventScroll: true });
    });
    container
      .querySelectorAll('.tab-content')
      .forEach(function (t) {
        return t.classList.remove('active');
      });
    var activeContent = document.getElementById(containerId + '-' + tabId);
    if (activeContent) activeContent.classList.add('active');
    window._tabLoaderRegistry?.[containerId]?.(tabId);
  }

  function handleTabKeydown(event, containerId, tabId) {
    if (
      !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(
        event.key,
      )
    ) {
      return;
    }
    event.preventDefault();
    var container = document.getElementById(containerId);
    var tabs = Array.from(container?.querySelectorAll('.tab') || []);
    var index = tabs.findIndex(function (tab) {
      return tab.dataset.tabId === tabId;
    });
    if (!tabs.length || index < 0) return;
    var nextIndex = index;
    if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    }
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    var nextTab = ['Enter', ' '].includes(event.key)
      ? tabs[index]
      : tabs[nextIndex];
    if (nextTab?.dataset.tabId) switchTab(containerId, nextTab.dataset.tabId);
  }

  window._tabLoaderRegistry = window._tabLoaderRegistry || {};

  function registerTabLoaders(containerId, loaders, loadedTabs) {
    var loaded = loadedTabs || new Set();
    window._tabLoaderRegistry[containerId] = async function (tabId) {
      if (loaded.has(tabId)) return;
      var loader = loaders?.[tabId];
      var target = document.getElementById(containerId + '-' + tabId);
      if (!loader || !target) return;
      target.innerHTML = renderShellLoadingState(
        'Loading tab',
        'Preparing this section without leaving the current page.',
        true,
      );
      try {
        await loader(target);
        loaded.add(tabId);
      } catch (err) {
        loaded.delete(tabId);
        target.innerHTML = renderTabLoadErrorState(containerId, tabId, err);
      }
    };
  }

  window.NanoShell = {
    renderShellLoadingState,
    renderTabLoadErrorState,
    renderTabs,
    switchTab,
    handleTabKeydown,
    registerTabLoaders,
  };
  window.renderShellLoadingState = renderShellLoadingState;
  window.renderTabLoadErrorState = renderTabLoadErrorState;
  window.renderTabs = renderTabs;
  window.switchTab = switchTab;
  window.handleTabKeydown = handleTabKeydown;
  window.registerTabLoaders = registerTabLoaders;
})();
