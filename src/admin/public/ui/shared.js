(function () {
  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function normalizeCodingRuntimeCatalog(value) {
    const healthStatuses = new Set([
      'healthy',
      'missing',
      'unsupported',
      'unauthenticated',
      'error',
    ]);
    const isTrimmedText = (input) =>
      typeof input === 'string' && input.length > 0 && input === input.trim();
    const isNonBlankText = (input) =>
      typeof input === 'string' && input.trim().length > 0;
    const isNullableTrimmedText = (input) =>
      input === null || isTrimmedText(input);
    const isIsoTimestamp = (input) => {
      if (!isTrimmedText(input)) return false;
      const timestamp = Date.parse(input);
      return (
        Number.isFinite(timestamp) &&
        new Date(timestamp).toISOString() === input
      );
    };
    const valid =
      Array.isArray(value) &&
      value.every(
        (runtime) =>
          runtime &&
          typeof runtime === 'object' &&
          !Array.isArray(runtime) &&
          isTrimmedText(runtime.cli) &&
          isTrimmedText(runtime.provider) &&
          isTrimmedText(runtime.model) &&
          isNullableTrimmedText(runtime.cliModel) &&
          typeof runtime.available === 'boolean' &&
          runtime.readiness &&
          typeof runtime.readiness === 'object' &&
          !Array.isArray(runtime.readiness) &&
          runtime.readiness.cli === runtime.cli &&
          healthStatuses.has(runtime.readiness.status) &&
          isTrimmedText(runtime.readiness.executable) &&
          isNullableTrimmedText(runtime.readiness.version) &&
          isIsoTimestamp(runtime.readiness.checkedAt) &&
          isNonBlankText(runtime.readiness.detail) &&
          runtime.available === (runtime.readiness.status === 'healthy'),
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
