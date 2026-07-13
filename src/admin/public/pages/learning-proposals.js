// NanoCrab Admin — Learning Proposals Page

function learningProposalBadge(status) {
  if (status === 'approved') return 'badge-success';
  if (status === 'pending') return 'badge-warning';
  if (status === 'rejected') return 'badge-error';
  return 'badge-muted';
}

function learningProposalCard(proposal) {
  return `<div class="card learning-proposal-card">
    <div class="card-title">
      <span class="learning-proposal-type">${esc(proposal.type)}</span>
      <span class="learning-proposal-status ${learningProposalBadge(proposal.status)}">${esc(proposal.status)}</span>
    </div>
    <div class="learning-proposal-summary">${esc(proposal.sourceRunSummary || '')}</div>
    <div class="learning-proposal-meta">
      <span>confidence: ${esc(String(proposal.confidence))}</span>
      <span>sensitivity: ${esc(proposal.sensitivity)}</span>
      <span>source: ${esc(proposal.sourceRunId)}</span>
    </div>
    <div class="learning-proposal-actions">
      ${proposal.status === 'pending' ? `<button class="btn" onclick="approveLearningProposal('${esc(proposal.id)}')">Approve</button>` : ''}
      ${proposal.status === 'pending' ? `<button class="btn btn-danger" onclick="rejectLearningProposal('${esc(proposal.id)}')">Reject</button>` : ''}
    </div>
  </div>`;
}

async function approveLearningProposal(id) {
  try {
    await api(`/learning-proposals/${id}/approve`, { method: 'PUT' });
    await renderLearningProposals(document.getElementById('page-content'));
    toast('Learning proposal approved');
  } catch (err) {
    toast('Failed to approve proposal: ' + (err.message || err));
  }
}

async function rejectLearningProposal(id) {
  try {
    await api(`/learning-proposals/${id}/reject`, { method: 'PUT', body: JSON.stringify({ note: 'rejected from admin' }) });
    await renderLearningProposals(document.getElementById('page-content'));
    toast('Learning proposal rejected');
  } catch (err) {
    toast('Failed to reject proposal: ' + (err.message || err));
  }
}

async function renderLearningProposals(el) {
  el.innerHTML = `<div class="page-header"><h2>Learning Proposals</h2><span class="muted">Review lessons extracted from coding runs</span></div><div class="learning-proposals-loading">Loading…</div>`;
  try {
    const proposals = await api('/learning-proposals');
    const cards = (proposals || []).map((p) => learningProposalCard(p)).join('');
    el.innerHTML = `
      <div class="page-header">
        <h2>Learning Proposals</h2>
        <span class="muted">Review lessons extracted from coding runs</span>
      </div>
      <div class="learning-proposals-grid">
        ${cards || '<p class="muted">No learning proposals.</p>'}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `
      <div class="page-header">
        <h2>Learning Proposals</h2>
        <span class="muted">Review lessons extracted from coding runs</span>
      </div>
      <p class="error">Failed to load learning proposals: ${esc(err.message || String(err))}</p>
    `;
  }
}

window.renderLearningProposals = renderLearningProposals;
window.approveLearningProposal = approveLearningProposal;
window.rejectLearningProposal = rejectLearningProposal;
