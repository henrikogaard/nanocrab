(function () {
  var esc =
    (window.NanoShared && window.NanoShared.esc) ||
    window.esc ||
    function (value) {
      return String(value || '');
    };

  function renderProviderParityPanel(parity) {
    if (!parity?.surfaces?.length) return '';
    return `
    <section class="provider-parity-panel" aria-label="Provider parity">
      <div class="provider-parity-head">
        <span class="report-kicker">Provider parity</span>
        <strong>Conformance across key surfaces</strong>
        <p>Readiness for chat, coding, automation, reports, and tool-style work.</p>
      </div>
      <div class="provider-parity-summary">
        <span><strong>${Number(parity.summary?.ready || 0)}</strong> ready</span>
        <span><strong>${Number(parity.summary?.degraded || 0)}</strong> degraded</span>
        <span><strong>${Number(parity.summary?.blocked || 0)}</strong> blocked</span>
      </div>
      <div class="provider-parity-grid">
        ${parity.surfaces
          .map((surface) => {
            var parityStatusClass =
              {
                ready: 'is-ready',
                degraded: 'is-degraded',
                blocked: 'is-blocked',
              }[surface.status] || 'is-ready';
            var parityStatusLabel =
              surface.status === 'blocked'
                ? 'Blocked'
                : surface.status === 'degraded'
                  ? 'Degraded'
                  : 'Ready';
            var parityStatusBadgeClass =
              surface.status === 'blocked'
                ? 'badge-error'
                : surface.status === 'degraded'
                  ? 'badge-warning'
                  : 'badge-success';
            var firstParityNote = surface.notes?.[0] || '';
            var isBaselineReadyNote =
              firstParityNote ===
              'Provider and capabilities satisfy this surface.';
            var showParityNote = surface.status !== 'ready' || !isBaselineReadyNote;
            var parityNote = showParityNote
              ? esc(firstParityNote || 'Profile requires review.')
              : '';
            return `
          <article class="provider-parity-row ${parityStatusClass}">
            <div class="provider-parity-row-head">
              <span>${esc(surface.label)}</span>
              <span class="badge ${parityStatusBadgeClass}">${parityStatusLabel}</span>
            </div>
            <strong>${esc(surface.provider)}/${esc(surface.model)}</strong>
            <small>profile: ${esc(surface.profileId)}</small>
            ${parityNote ? `<p class="provider-parity-note">${parityNote}</p>` : ''}
          </article>`;
          })
          .join('')}
      </div>
    </section>`;
  }

  window.NanoProviderParity = {
    renderProviderParityPanel,
  };
})();
