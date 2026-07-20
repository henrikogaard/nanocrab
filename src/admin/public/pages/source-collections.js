// NanoCrab Admin — Source Collections Page

function normalizeSourceCollections(value) {
  if (!Array.isArray(value)) {
    throw new Error('Source collection response must be an array');
  }
  return value;
}

function sourceCollectionBadge(status) {
  if (status === 'completed') return 'badge-success';
  if (status === 'collecting' || status === 'pending') return 'badge-warning';
  if (status === 'partial') return 'badge-info';
  if (status === 'failed' || status === 'cancelled') return 'badge-error';
  return 'badge-muted';
}

function sourceCollectionScopeItem(item) {
  return `<div class="source-collection-scope">
    <span class="source-collection-scope-name">${esc(item.scope)}${item.connectorId ? ` (${esc(item.connectorId)})` : ''}</span>
    <span class="source-collection-scope-status ${sourceCollectionBadge(item.status)}">${esc(item.status)}</span>
    <span class="source-collection-scope-count">${esc(String(item.itemCount))}</span>
    ${item.failureReason ? `<span class="source-collection-scope-error">${esc(item.failureReason)}</span>` : ''}
  </div>`;
}

function sourceLedgerEntry(entry) {
  const provenance = (entry.provenance || [])
    .map((p) => `<span class="badge badge-muted">${esc(p)}</span>`)
    .join(' ');
  const sourceUrl = entry.sourceUrl
    ? `<a class="source-ledger-link" href="${esc(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(entry.sourceUrl)}</a>`
    : '';
  return `<div class="source-ledger-entry">
    <div class="source-ledger-header">
      <span class="source-ledger-label">${esc(entry.sourceLabel || 'Untitled source')}</span>
      <span class="source-ledger-scope">${esc(entry.scope)}${entry.connectorId ? ` (${esc(entry.connectorId)})` : ''}</span>
      <span class="muted">${esc(new Date(entry.collectedAt).toLocaleString())}</span>
    </div>
    <blockquote class="source-ledger-citation">${esc(entry.citationText || '')}</blockquote>
    ${sourceUrl ? `<div class="source-ledger-url">${sourceUrl}</div>` : ''}
    ${provenance ? `<div class="source-ledger-provenance">${provenance}</div>` : ''}
  </div>`;
}

function sourceCollectionRetryButton(collection) {
  if (collection.status !== 'failed' && collection.status !== 'partial')
    return '';
  return `<button class="source-collection-retry" data-id="${esc(collection.id)}">Retry failed sources</button>`;
}

function sourceCollectionCard(collection) {
  const scopes = (collection.items || [])
    .map((i) => sourceCollectionScopeItem(i))
    .join('');
  const ledger = (collection.ledger || [])
    .map((e) => sourceLedgerEntry(e))
    .join('');
  return `<div class="card source-collection-card">
    <div class="card-title">
      <span class="source-collection-id">${esc(collection.id)}</span>
      <span class="source-collection-status ${sourceCollectionBadge(collection.status)}">${esc(collection.status)}</span>
      ${sourceCollectionRetryButton(collection)}
    </div>
    <div class="source-collection-meta">
      <span>report job: ${esc(collection.reportJobId)}</span>
      <span>started: ${esc(new Date(collection.startedAt).toLocaleString())}</span>
    </div>
    <div class="source-collection-scopes">
      ${scopes || '<p class="muted">No scopes.</p>'}
    </div>
    <div class="source-collection-ledger">
      <div class="source-collection-ledger-title">Ledger entries (${esc(String((collection.ledger || []).length))})</div>
      ${ledger || '<p class="muted">No ledger entries.</p>'}
    </div>
  </div>`;
}

async function retrySourceCollection(id) {
  const response = await api(`/source-collections/${id}/retry`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(response.error || 'Retry failed');
  }
  return response.collection;
}

async function renderSourceCollections(el) {
  el.innerHTML = `<div class="page-header"><h2>Source Collections</h2><span class="muted">Inspect source collection records and ledger entries</span></div><div class="source-collections-loading">Loading…</div>`;
  try {
    const collections = window.NanoSourceCollections.normalize(
      await api('/source-collections'),
    );
    const cards = collections.map((c) => sourceCollectionCard(c)).join('');
    el.innerHTML = `
      <div class="page-header">
        <h2>Source Collections</h2>
        <span class="muted">Inspect source collection records and ledger entries</span>
      </div>
      <div class="source-collections-grid">
        ${cards || '<p class="muted">No source collections.</p>'}
      </div>
    `;
    el.querySelectorAll('.source-collection-retry').forEach((button) => {
      button.addEventListener('click', async (event) => {
        const id = event.currentTarget.getAttribute('data-id');
        if (!id) return;
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = 'Retrying…';
        try {
          await retrySourceCollection(id);
          await renderSourceCollections(el);
        } catch (err) {
          event.currentTarget.disabled = false;
          event.currentTarget.textContent = 'Retry failed sources';
          console.error('Source collection retry failed:', err);
        }
      });
    });
  } catch (err) {
    el.innerHTML = `
      <div class="page-header">
        <h2>Source Collections</h2>
        <span class="muted">Inspect source collection records and ledger entries</span>
      </div>
      <p class="error">Failed to load source collections: ${esc(err.message || String(err))}</p>
    `;
  }
}

window.NanoSourceCollections = {
  normalize: normalizeSourceCollections,
};
window.renderSourceCollections = renderSourceCollections;
