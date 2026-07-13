// NanoCrab Admin — Source Collections Page

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

function sourceCollectionCard(collection) {
  const scopes = (collection.items || []).map((i) => sourceCollectionScopeItem(i)).join('');
  return `<div class="card source-collection-card">
    <div class="card-title">
      <span class="source-collection-id">${esc(collection.id)}</span>
      <span class="source-collection-status ${sourceCollectionBadge(collection.status)}">${esc(collection.status)}</span>
    </div>
    <div class="source-collection-meta">
      <span>report job: ${esc(collection.reportJobId)}</span>
      <span>started: ${esc(new Date(collection.startedAt).toLocaleString())}</span>
    </div>
    <div class="source-collection-scopes">
      ${scopes || '<p class="muted">No scopes.</p>'}
    </div>
    <div class="source-collection-ledger">
      <div class="ledger-count">Ledger entries: ${esc(String((collection.ledger || []).length))}</div>
    </div>
  </div>`;
}

async function renderSourceCollections(el) {
  el.innerHTML = `<div class="page-header"><h2>Source Collections</h2><span class="muted">Inspect source collection records and ledger entries</span></div><div class="source-collections-loading">Loading…</div>`;
  try {
    const collections = await api('/source-collections');
    const cards = (collections || []).map((c) => sourceCollectionCard(c)).join('');
    el.innerHTML = `
      <div class="page-header">
        <h2>Source Collections</h2>
        <span class="muted">Inspect source collection records and ledger entries</span>
      </div>
      <div class="source-collections-grid">
        ${cards || '<p class="muted">No source collections.</p>'}
      </div>
    `;
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

window.renderSourceCollections = renderSourceCollections;
