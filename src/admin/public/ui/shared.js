(function () {
  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function normalizeCodingRuntimeCatalog(value) {
    const valid =
      Array.isArray(value) &&
      value.every(
        (runtime) =>
          runtime &&
          typeof runtime.cli === 'string' &&
          typeof runtime.provider === 'string' &&
          typeof runtime.model === 'string' &&
          typeof runtime.available === 'boolean' &&
          runtime.readiness &&
          typeof runtime.readiness.status === 'string' &&
          typeof runtime.readiness.detail === 'string',
      );
    if (!valid) {
      return {
        runtimes: [],
        error: 'Coding runtime catalog returned an unexpected response',
      };
    }
    return { runtimes: value, error: '' };
  }

  window.NanoShared = {
    esc,
    normalizeCodingRuntimeCatalog,
  };
  window.esc = esc;
  window.normalizeCodingRuntimeCatalog = normalizeCodingRuntimeCatalog;
})();
