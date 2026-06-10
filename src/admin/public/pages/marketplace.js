// NanoCrab Admin — Marketplace Page

// --- Marketplace ---

async function renderMarketplace(el) {
  el.innerHTML = '<div class="loading">Loading marketplace</div>';
  try {
    const installed = await api('/marketplace').catch(() => []);
    el.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h2>Plugin Marketplace</h2>
        <button class="btn btn-sm btn-primary" onclick="document.getElementById('install-plugin-form').style.display=document.getElementById('install-plugin-form').style.display==='none'?'block':'none'">Install Plugin</button>
      </div>

      <div id="install-plugin-form" class="card" style="display:none;margin-bottom:16px;border-left:3px solid var(--accent)">
        <div class="card-title">Install from Git</div>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Paste a git URL to install a plugin. The plugin must export an AdminPlugin from index.ts.</p>
        <div style="display:flex;gap:8px;align-items:flex-end">
          <div style="flex:1">
            <label style="font-size:12px;color:var(--text-muted)">Git URL</label>
            <input class="search-input" id="plugin-url" placeholder="https://github.com/user/nanocrab-plugin-example.git" style="width:100%">
          </div>
          <div style="width:150px">
            <label style="font-size:12px;color:var(--text-muted)">Name (optional)</label>
            <input class="search-input" id="plugin-name" placeholder="auto-detect" style="width:100%">
          </div>
          <button class="btn btn-primary" onclick="installPlugin()">Install</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Installed Plugins <span class="badge badge-muted" style="font-size:10px">${installed.length}</span></div>
        ${installed.length === 0 ? '<div class="empty">No marketplace plugins installed. Use "Install Plugin" to add one from a git URL.</div>' : installed.map(p => `
          <div class="channel-card" style="padding:10px 0">
            <div style="flex:1">
              <strong>${esc(p.name)}</strong> <span style="font-size:11px;color:var(--text-muted)">v${esc(p.version)}</span>
              ${p.author ? `<span style="font-size:11px;color:var(--text-muted)">by ${esc(p.author)}</span>` : ''}
              <div style="font-size:12px;color:var(--text-muted)">${esc(p.description)}</div>
              <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${esc(p.source)} \u2022 ${timeAgo(p.installedAt)}</div>
            </div>
            <div style="display:flex;gap:4px">
              <button class="btn btn-sm btn-ghost" onclick="updatePlugin('${esc(p.dir)}',this)">Update</button>
              <button class="btn btn-sm btn-ghost" onclick="uninstallPlugin('${esc(p.dir)}',this)" style="color:var(--error)">Uninstall</button>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="card">
        <div class="card-title">How to Create a Plugin</div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.8">
          <p>A NanoCrab plugin is a git repository with:</p>
          <pre style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin:8px 0;font-size:11px">my-plugin/
  plugin.json    \u2190 metadata (name, version, description)
  index.ts       \u2190 exports AdminPlugin
  routes.ts      \u2190 Express router
  SKILL.md       \u2190 optional container skill
  README.md</pre>
          <p>See the <a style="color:var(--accent);cursor:pointer" onclick="navigate('help')">Help manual</a> for the full plugin development guide.</p>
        </div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = '<div class="card empty">Failed to load marketplace: ' + esc(e.message) + '</div>';
  }
}

window.installPlugin = async function () {
  const url = document.getElementById('plugin-url').value.trim();
  const name = document.getElementById('plugin-name').value.trim();
  if (!url) { toast('Git URL required', 'warning'); return; }
  toast('Installing plugin...', 'info');
  try {
    const r = await api('/marketplace/install', { method: 'POST', body: JSON.stringify({ url, name: name || undefined }) });
    if (r.ok) { toast('Plugin installed! Restart to activate.', 'success'); navigate('marketplace'); }
    else toast(r.error || 'Install failed', 'error');
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
};

window.uninstallPlugin = function (name, btn) {
  inlineConfirm(btn, 'Uninstall?', async () => {
    try {
      await api('/marketplace/' + encodeURIComponent(name), { method: 'DELETE' });
      toast('Plugin uninstalled. Restart to apply.', 'success');
      navigate('marketplace');
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  });
};

window.updatePlugin = async function (name, btn) {
  btn.disabled = true; btn.textContent = 'Updating...';
  try {
    const r = await api('/marketplace/' + encodeURIComponent(name) + '/update', { method: 'POST' });
    if (r.ok) toast('Plugin updated. Restart to apply.', 'success');
    else toast(r.error || 'Update failed', 'error');
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
  btn.disabled = false; btn.textContent = 'Update';
};

