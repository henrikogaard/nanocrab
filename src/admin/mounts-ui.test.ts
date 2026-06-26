import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

const mountsEditorSource = (source: string) =>
  source.slice(
    source.indexOf('<div class="mounts-panel">'),
    source.indexOf('let mountAllowlistData = null'),
  );

describe('Mounts workspace access UI', () => {
  it('frames mounts as the workspace access trust boundary', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Workspace access');
    expect(source).toContain('Decide which host paths agents may see');
    expect(source).toContain('Mounts are the trust boundary');
    expect(source).toContain('mounts-command-center');
    expect(source).toContain('mounts-stats');
    expect(source).toContain('function mountAccessBriefText');
    expect(source).toContain('window._mountAccessState');
    expect(source).toContain('window.copyMountAccessBrief');
    expect(source).toContain('Copy access brief');
    expect(source).toContain('NanoCrab workspace access brief');
    expect(source).toContain('mounts-access-map');
    expect(source).toContain('mounts-trust-brief');
    expect(source).toContain('Access decision');
    expect(source).toContain('mountStats');
    expect(source).toContain('mountAccessCards');
    expect(source).toContain('mountPreflightChecklist');
    expect(source).toContain('mountDestinationRoutes');
    expect(source).toContain('Mount preflight');
    expect(source).toContain(
      'Give agents the smallest useful filesystem window.',
    );
    expect(source).toContain(
      'Use this before attaching local files to Cowork projects, Code runs, channel agents, reports, or MCP-backed workflows.',
    );
    expect(source).toContain('Name the work lane');
    expect(source).toContain('Prefer read-only first');
    expect(source).toContain('Validate the exact path');
    expect(source).toContain('Attach approval policy');
    expect(source).toContain(
      'Use for reference material agents can inspect but not change.',
    );
    expect(source).toContain(
      'Reserve for narrow project folders where agents may create artifacts.',
    );
    expect(source).toContain(
      'Attach project-specific context to Cowork and channel agents.',
    );
    expect(source).toContain(
      'Check each requested path before exposing it to a container.',
    );
    expect(source).toContain(
      'Prefer read-only roots for reference material, repositories, notes, and source documents.',
    );
    expect(source).toContain(
      'Use read-write only for narrow Cowork project folders where agents may create artifacts.',
    );
    expect(source).toContain(
      'Keep secrets, credentials, private memory, and broad home directories out of mounts.',
    );
    expect(source).toContain(
      'Route filesystem-changing work through Approvals when it may affect external projects or shared documents.',
    );
    expect(source).toContain('Mount preflight checklist:');
    expect(source).toContain('Mount destination routes:');
    expect(source).toContain('${item.lane} -> ${item.target}: ${item.detail}');
    expect(source).toContain('mountPreflightChecklist().map');
    expect(source).toContain('mountDestinationRoutes().map');
    expect(source).toContain('Destination router');
    expect(source).toContain(
      'Send approved paths to the workspace that owns the work.',
    );
    expect(source).toContain(
      'After validation, choose whether the path belongs with project artifacts, repository automation, channel context, or source-backed documents.',
    );
    expect(source).toContain('Project files');
    expect(source).toContain('Repository work');
    expect(source).toContain('Group context');
    expect(source).toContain('Source packs');
    expect(source).toContain(
      'Use when agents should create, revise, or inspect project artifacts beside chats and MCP context.',
    );
    expect(source).toContain(
      'Use when the path is a repo that needs diffs, tests, PR work, review rules, or Git Ops evidence.',
    );
    expect(source).toContain(
      'Use when a channel agent needs scoped local reference files without seeing broad host directories.',
    );
    expect(source).toContain(
      'Use when files should feed summaries, documents, evidence packs, or generated artifacts.',
    );
  });

  it('preserves allowlist editing hooks and controls', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/mounts')");
    expect(source).toContain('id="roots-table"');
    expect(source).toContain('id="blocked-patterns"');
    expect(source).toContain('id="non-main-ro"');
    expect(source).toContain('id="mount-msg"');
    expect(source).toContain('addRoot');
    expect(source).toContain('removeRoot');
    expect(source).toContain('saveAllowlist');
  });

  it('uses class-based allowlist and path validation controls', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const editor = mountsEditorSource(appSource);
    const saveAllowlistSource = appSource.slice(
      appSource.indexOf('function mountActionErrorMessage'),
      appSource.indexOf('window.validatePath = async () => {'),
    );

    expect(editor).toContain('mounts-panel-note');
    expect(editor).toContain('mounts-root-input');
    expect(editor).toContain('mounts-panel-actions is-secondary');
    expect(editor).toContain('mounts-save-msg');
    expect(editor).toContain('mounts-group-name');
    expect(editor).toContain('mounts-validate-row');
    expect(editor).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-bottom:16px"',
    );
    expect(editor).not.toContain('style="max-width:100%"');
    expect(editor).not.toContain(
      'style="margin-top:12px;display:flex;gap:8px"',
    );
    expect(editor).not.toContain(
      'style="margin-top:12px;display:flex;gap:8px;align-items:center"',
    );
    expect(editor).not.toContain('style="color:var(--text)"');
    expect(editor).not.toContain(
      'style="display:flex;gap:8px;align-items:end"',
    );
    expect(saveAllowlistSource).toContain(
      "setInlineStatus(msg, 'Saved', 'success')",
    );
    expect(saveAllowlistSource).toContain('function mountActionErrorMessage');
    expect(saveAllowlistSource).toContain('Mount allowlist was not saved.');
    expect(saveAllowlistSource).toContain(
      'validate each host path, prefer read-only access',
    );
    expect(saveAllowlistSource).toContain(
      'avoid broad home, credential, or private memory folders',
    );
    expect(saveAllowlistSource).toContain(
      "setInlineStatus(msg, mountActionErrorMessage('save', r), 'error')",
    );
    expect(saveAllowlistSource).toContain("setInlineStatus(msg, '')");
    expect(saveAllowlistSource).not.toContain('msg.style.color');
    expect(saveAllowlistSource).not.toContain(
      "setInlineStatus(msg, r.error || 'Failed', 'error')",
    );
    expect(styleSource).toContain('.mounts-panel-note');
    expect(styleSource).toContain('.mounts-root-input');
    expect(styleSource).toContain('.mounts-group-name');
    expect(styleSource).toContain('.mounts-save-msg.is-success');
    expect(styleSource).toContain('.mounts-save-msg.is-error');
  });

  it('keeps per-group mounts and path validation visible', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('groupMounts');
    expect(source).toContain('writableGroupMounts');
    expect(source).toContain('mountRisk');
    expect(source).toContain('No host paths are approved for agent work');
    expect(source).toContain('Writable access needs an operator review');
    expect(source).toContain('mounts-group-card');
    expect(source).toContain('mounts-path-row');
    expect(source).toContain('id="validate-path"');
    expect(source).toContain('id="validate-result"');
    expect(source).toContain('validatePath');
    expect(source).toContain('/mounts/validate?hostPath=');
    expect(source).toContain('Mount path validation could not run.');
    expect(source).toContain("mountActionErrorMessage('validate', err)");
  });

  it('turns missing group mounts into a guided setup path', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderMountsGroupEmptyState');
    expect(source).toContain('mounts-group-empty-state');
    expect(source).toContain('No per-group mounts configured');
    expect(source).toContain(
      'Per-group mounts are how Cowork, channel, and Code agents get focused filesystem context',
    );
    expect(source).toContain('Approve a narrow root');
    expect(source).toContain('Validate the path');
    expect(source).toContain('Attach it to a group');
    expect(source).toContain(
      "document.getElementById('validate-path')?.focus()",
    );
    expect(source).toContain("navigate('groups')");
    expect(source).toContain('copyMountAccessBrief()');
    expect(source).not.toContain(
      "'<div class=\"empty\">No groups have additional mounts configured. Edit a group\\'s containerConfig to add mounts.</div>'",
    );
    expect(styleSource).toContain('.mounts-group-empty-state');
    expect(styleSource).toContain('.mounts-empty-flow');
    expect(styleSource).toContain('.mounts-empty-flow article button');
    expect(styleSource).toContain('.mounts-empty-actions');
    expect(styleSource).toContain('.mounts-empty-flow,');
  });

  it('styles mounts panels, path rows, and responsive layout', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.mounts-command-center');
    expect(source).toContain('.mounts-trust-brief');
    expect(source).toContain('.mounts-trust-brief.is-attention');
    expect(source).toContain('.mounts-trust-facts');
    expect(source).toContain('.mounts-stats');
    expect(source).toContain('.mounts-access-map');
    expect(source).toContain('.mounts-access-card');
    expect(source).toContain('.mounts-preflight-panel');
    expect(source).toContain('.mounts-preflight-copy');
    expect(source).toContain('.mounts-preflight-grid');
    expect(source).toContain('.mounts-preflight-card');
    expect(source).toContain('.mounts-destination-router');
    expect(source).toContain('.mounts-destination-copy');
    expect(source).toContain('.mounts-destination-grid');
    expect(source).toContain('.mounts-destination-card');
    expect(source).toContain('.mounts-destination-card:hover');
    expect(source).toContain('.mounts-panel');
    expect(source).toContain('.mounts-panel-note');
    expect(source).toContain('.mounts-root-input');
    expect(source).toContain('.mounts-toggle-row');
    expect(source).toContain('.mounts-group-card');
    expect(source).toContain('.mounts-group-name');
    expect(source).toContain('.mounts-path-row');
    expect(source).toContain('.mounts-validate-result');
    expect(source).toContain('.mounts-group-empty-state');
    expect(source).toContain('.mounts-empty-flow');
    expect(source).toContain('.mounts-trust-actions');
    expect(source).toContain('.mounts-stats,');
    expect(source).toContain('.mounts-access-map,');
    expect(source).toContain('.mounts-preflight-panel,');
    expect(source).toContain('.mounts-preflight-grid,');
    expect(source).toContain('.mounts-destination-router,');
    expect(source).toContain('.mounts-destination-grid,');
    expect(source).toContain('.mounts-path-row {');
  });
});
