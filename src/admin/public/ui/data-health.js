(function () {
  async function loadPluginsList(api, context = 'workspace shell') {
    try {
      window._pluginsList = await api('/plugins');
      window._pluginsLoadIssue = '';
    } catch (err) {
      window._pluginsList = [];
      window._pluginsLoadIssue =
        'Plugin registry unavailable. Built-in Copilot, Cowork, Code, and More surfaces remain available, but optional plugin routes may be missing.';
      console.warn(`Could not load plugins for ${context}`, err);
    }
    return window._pluginsList;
  }

  function renderAlerts(alerts, options = {}) {
    if (!Array.isArray(alerts) || alerts.length === 0) return '';
    var esc = typeof options.esc === 'function' ? options.esc : String;
    var mockMode = options.mockMode === true;
    return alerts
      .map(function (alert, index) {
        var type = String(alert && alert.type ? alert.type : 'info').trim();
        if (!/^[a-z0-9_-]+$/i.test(type)) type = 'info';
        var message = String(alert && alert.message ? alert.message : '');
        var isMockNotice =
          mockMode && type === 'info' && /mock|sample data/i.test(message);
        return (
          '<div class="alert-banner alert-' +
          esc(type) +
          (isMockNotice ? ' alert-compact' : '') +
          '" id="alert-' +
          index +
          '">' +
          '<span>' +
          esc(isMockNotice ? 'Mock data' : message) +
          '</span>' +
          '<button class="alert-dismiss" onclick="document.getElementById(\'alert-' +
          index +
          '\').remove()">x</button>' +
          '</div>'
        );
      })
      .join('');
  }

  window.NanoDataHealth = {
    loadPluginsList,
    renderAlerts,
  };
})();
