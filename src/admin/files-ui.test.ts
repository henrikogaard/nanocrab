import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');
const fileVaultStatesUiPath = path.join(
  process.cwd(),
  'src/admin/public/ui/file-vault-states.js',
);

const fileDetailSource = (source: string) =>
  source.slice(
    source.indexOf('window.selectGroup = async'),
    source.indexOf('window.copyFileVaultBrief'),
  );

describe('Group Files context vault UI', () => {
  it('frames group files as a context vault', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Context vault');
    expect(source).toContain('Inspect the files that shape each agent group');
    expect(source).toContain('private runtime memory');
    expect(source).toContain('files-command-center');
    expect(source).toContain('files-stats');
    expect(source).toContain('files-context-map');
    expect(source).toContain('files-layout');
    expect(source).toContain('fileStats');
    expect(source).toContain('loadIssues');
    expect(source).toContain('Data health:');
    expect(source).toContain(
      'File vault catalog loaded without known fallback.',
    );
    expect(source).toContain('File vault catalog unavailable');
    expect(source).toContain('files-stat ${loadIssues.length ?');
    expect(source).toContain(
      "Data health</span><strong>${loadIssues.length ? loadIssues.length : 'ok'}",
    );
    expect(source).toContain('fileContextCards');
    expect(source).toContain('filePromotionChecklist');
    expect(source).toContain('Promotion checklist');
    expect(source).toContain(
      'Move raw context into the right productivity surface.',
    );
    expect(source).toContain(
      'Use this before turning channel uploads, saved threads, memory, or instructions into Cowork files, reports, artifacts, or durable personal knowledge.',
    );
    expect(source).toContain('Classify the source');
    expect(source).toContain('Pick the durable home');
    expect(source).toContain('Preserve provenance');
    expect(source).toContain('Require approval for edits');
    expect(source).toContain('fileVaultBriefText');
    expect(source).toContain('_fileVaultState');
    expect(source).toContain('copyFileVaultBrief');
    expect(source).toContain('Copy vault brief');
    expect(source).toContain('Files context vault brief');
    expect(source).toContain('Global MEMORY.md stays personal and private.');
    expect(source).toContain('AGENTS.md defines group-specific behavior.');
    expect(source).toContain(
      'Saved threads support audit and context recovery.',
    );
    expect(source).toContain('Uploaded files and media from channels.');
    expect(source).toContain(
      'Keep personal memory in the personal Memory space, group behavior in AGENTS.md, project work in Cowork projects, and raw channel uploads here until promoted into an artifact.',
    );
    expect(source).toContain('filePromotionChecklist().map');
  });

  it('preserves group selection and editable instruction hooks', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const fileVaultStatesSource = fs.readFileSync(fileVaultStatesUiPath, 'utf8');

    expect(source).toContain("api('/files')");
    expect(source).toContain('id="file-detail"');
    expect(source).toContain('file-group-link');
    expect(source).toContain('selectGroup');
    expect(source).toContain('id="agents-md-editor"');
    expect(source).toContain('saveAgentsMd');
    expect(source).toContain('id="memory-file-editor"');
    expect(source).toContain('saveMemoryFromFiles');
    expect(source).toContain('fileGroupBriefText');
    expect(source).toContain('_fileGroupState');
    expect(source).toContain('copyFileGroupBrief');
    expect(source).toContain('Copy group brief');
    expect(source).toContain('window.NanoFileVaultStates.renderFilesLoadingState');
    expect(source).toContain('renderFilesLoadingState');
    expect(fileVaultStatesSource).toContain('Loading group context');
    expect(fileVaultStatesSource).toContain(
      'Gathering AGENTS.md, memory, saved conversations, and uploads',
    );
    expect(source).toContain('Group context brief');
    expect(source).toContain('Group files loaded without known fallback.');
    expect(source).toContain('groupLoadIssues');
    expect(source).toContain('Data health needs review');
    expect(source).toContain(
      'Retry this group before asking agents to rely on saved threads, uploads, or instruction context.',
    );
    expect(source).toContain(
      'For MCP-enabled Cowork work, cite the group folder and request explicit approval before editing memory, instructions, external documents, or channel-visible content.',
    );
  });

  it('keeps conversation and attachment affordances wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const fileVaultStatesSource = fs.readFileSync(fileVaultStatesUiPath, 'utf8');

    expect(source).toContain('viewConversation');
    expect(source).toContain('id="conv-viewer"');
    expect(source).toContain("renderFilesLoadingState('conversation')");
    expect(fileVaultStatesSource).toContain('Loading conversation transcript');
    expect(fileVaultStatesSource).toContain(
      'Opening the saved thread so it can be inspected, copied, or routed into Cowork.',
    );
    expect(source).toContain('/download/conversations/');
    expect(source).toContain('/download/attachments/');
    expect(source).toContain('files-viewer-card');
    expect(fileVaultStatesSource).toContain('Failed to load file');
  });

  it('turns missing group files into context routing actions', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const fileVaultStatesSource = fs.readFileSync(fileVaultStatesUiPath, 'utf8');
    const detail = fileDetailSource(source);

    expect(source).toContain('window.NanoFileVaultStates.renderFilesEmptyState');
    expect(source).toContain(
      'window.NanoFileVaultStates.renderFilesLoadingState',
    );
    expect(source).not.toContain('function renderFilesEmptyState');
    expect(source).not.toContain('function renderFilesLoadingState');
    expect(fileVaultStatesSource).toContain('function renderFilesEmptyState');
    expect(fileVaultStatesSource).toContain('function renderFilesLoadingState');
    expect(fileVaultStatesSource).toContain('files-action-empty');
    expect(fileVaultStatesSource).toContain('files-empty-flow');
    expect(fileVaultStatesSource).toContain('files-empty-actions');
    expect(fileVaultStatesSource).toContain('No group folders found');
    expect(fileVaultStatesSource).toContain(
      'Select a group to browse its files',
    );
    expect(fileVaultStatesSource).toContain('No saved conversations');
    expect(fileVaultStatesSource).toContain('No attachments');
    expect(fileVaultStatesSource).toContain('Failed to load file');
    expect(fileVaultStatesSource).toContain('File vault unavailable');
    expect(fileVaultStatesSource).toContain(
      'Conversation archive unavailable',
    );
    expect(fileVaultStatesSource).toContain('Attachment archive unavailable');
    expect(source).toContain(
      "renderFilesEmptyState('conversations-unavailable')",
    );
    expect(source).toContain(
      "renderFilesEmptyState('attachments-unavailable')",
    );
    expect(source).toContain('Promise.allSettled');
    expect(source).not.toContain(
      'api(`/files/${encodeURIComponent(folder)}/conversations`).catch(() => [])',
    );
    expect(source).not.toContain(
      'api(`/files/${encodeURIComponent(folder)}/attachments`).catch(() => [])',
    );
    expect(source).toContain(
      "renderFilesEmptyState(loadIssues.length ? 'unavailable' : 'groups')",
    );
    expect(source).toContain("renderFilesEmptyState('group-select')");
    expect(detail).toContain("renderFilesEmptyState('conversations')");
    expect(detail).toContain("renderFilesEmptyState('attachments')");
    expect(source).toContain("renderFilesEmptyState('failed')");
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('memory')");
    expect(source).toContain("navigate('artifacts')");
    expect(source).not.toContain(
      '\'<div class="empty">No group folders found</div>\'',
    );
    expect(detail).not.toContain(
      '\'<div class="empty">No conversations</div>\'',
    );
    expect(detail).not.toContain('\'<div class="empty">No attachments</div>\'');
    expect(detail).not.toContain(
      'detail.innerHTML = \'<div class="loading">Loading</div>\'',
    );
    expect(detail).not.toContain(
      'viewer.innerHTML = \'<div class="loading">Loading</div>\'',
    );
    expect(style).toContain('.files-action-empty');
    expect(style).toContain('.files-data-health-warning');
    expect(style).toContain('.files-stat.is-warning');
    expect(style).toContain('.files-stat.is-ready');
    expect(style).toContain('.files-empty-state.is-warning');
    expect(style).toContain('.files-empty-flow');
    expect(style).toContain('.files-empty-actions');
    expect(fileVaultStatesSource).toContain('files-loading-state');
    expect(style).toContain('.files-loading-state');
    expect(style).toContain('.files-loading-bars');
    expect(style).toContain('@keyframes filesLoadingBar');
  });

  it('uses class-based file editor actions, table cells, and previews', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const detail = fileDetailSource(appSource);
    const saveHandlers = appSource.slice(
      appSource.indexOf('function setInlineStatus'),
      appSource.indexOf('window.viewConversation'),
    );

    expect(saveHandlers).toContain('function setInlineStatus');
    expect(saveHandlers).toContain(
      "el.classList.remove('is-success', 'is-error', 'is-muted')",
    );
    expect(saveHandlers).toContain("setInlineStatus(msg, 'Saved', 'success')");
    expect(saveHandlers).toContain('function fileSaveActionErrorMessage');
    expect(saveHandlers).toContain('Private memory file was not saved.');
    expect(saveHandlers).toContain('Group instructions were not saved.');
    expect(saveHandlers).toContain(
      'durable personal Memory, project context for Cowork, or a reusable Skill',
    );
    expect(saveHandlers).toContain(
      'group folder, channel ownership, and whether this behavior belongs in group instructions or a Skill',
    );
    expect(saveHandlers).toContain(
      "setInlineStatus(msg, fileSaveActionErrorMessage('memory', r), 'error')",
    );
    expect(saveHandlers).toContain(
      "setInlineStatus(msg, fileSaveActionErrorMessage('memory', err), 'error')",
    );
    expect(saveHandlers).toContain(
      "setInlineStatus(msg, fileSaveActionErrorMessage('agents', r), 'error')",
    );
    expect(saveHandlers).toContain(
      "setInlineStatus(msg, fileSaveActionErrorMessage('agents', err), 'error')",
    );
    expect(saveHandlers).toContain(
      "setTimeout(() => setInlineStatus(msg, ''), 3000)",
    );
    expect(saveHandlers).not.toContain('msg.style.color');
    expect(saveHandlers).not.toContain(
      "setInlineStatus(msg, r.error || 'Failed', 'error')",
    );
    expect(saveHandlers).not.toContain(
      "setInlineStatus(msg, 'Error', 'error')",
    );
    expect(detail).toContain('files-editor-actions');
    expect(detail).toContain('files-save-msg');
    expect(detail).toContain('files-name-cell');
    expect(detail).toContain('files-action-cell');
    expect(detail).toContain('files-download-link');
    expect(detail).toContain('files-attachment-thumb');
    expect(detail).toContain('files-conversation-preview');
    expect(detail).not.toContain(
      'style="display:flex;gap:8px;align-items:center"',
    );
    expect(detail).not.toContain(
      'style="color:var(--text);font-family:var(--mono);font-size:12px"',
    );
    expect(detail).not.toContain('style="white-space:nowrap"');
    expect(detail).not.toContain('download style="text-decoration:none"');
    expect(detail).not.toContain(
      'style="width:40px;height:40px;object-fit:cover',
    );
    expect(detail).not.toContain('style="max-height:500px"');
    expect(styleSource).toContain('.files-name-cell');
    expect(styleSource).toContain('.files-save-msg.is-success');
    expect(styleSource).toContain('.files-save-msg.is-error');
    expect(styleSource).toContain('.files-attachment-thumb');
    expect(styleSource).toContain('.files-conversation-preview');
  });

  it('styles the context vault, group rail, editors, and responsive state', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.files-command-center');
    expect(source).toContain('.files-stats');
    expect(source).toContain('.files-context-map');
    expect(source).toContain('.files-context-card');
    expect(source).toContain('.files-promotion-panel');
    expect(source).toContain('.files-promotion-copy');
    expect(source).toContain('.files-promotion-grid');
    expect(source).toContain('.files-promotion-card');
    expect(source).toContain('.files-layout');
    expect(source).toContain('.files-group-list');
    expect(source).toContain('.files-editor-card');
    expect(source).toContain('.files-table-card');
    expect(source).toContain('.files-editor-textarea.compact');
    expect(source).toContain('.files-name-cell');
    expect(source).toContain('.files-action-cell');
    expect(source).toContain('.files-attachment-thumb');
    expect(source).toContain(
      '.files-context-map,\n  .files-promotion-grid,\n  .mounts-stats',
    );
    expect(source).toContain('.files-promotion-panel,');
    expect(source).toContain('.files-promotion-grid,');
    expect(source).toContain('.files-loading-state');
    expect(source).toContain('.files-action-empty');
    expect(source).toContain('.files-empty-actions');
    expect(source).toContain('.files-data-health-warning');
    expect(source).toContain('.files-stat.is-warning');
  });
});
