import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Code editor file workbench UI', () => {
  it('frames the editor as a focused file workbench', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('File workbench');
    expect(source).toContain('editor-command-center');
    expect(source).toContain('editor-workflow-map');
    expect(source).toContain('editor-layout');
    expect(source).toContain('editor-tree-panel');
    expect(source).toContain('editor-main-panel');
    expect(source).toContain(
      'Select a file from the repository tree to start editing.',
    );
    expect(source).toContain(
      'Open the smallest relevant file, keep the diff tight',
    );
    expect(source).toContain('renderEditorFileIdleState()');
    expect(source).toContain('editorWorkflowCards');
    expect(source).toContain('editorReadinessGate');
    expect(source).toContain('editorHandoffBriefText');
    expect(source).toContain('editorScopedEditPromptText');
    expect(source).toContain('_editorHandoffState');
    expect(source).toContain('copyEditorHandoffBrief');
    expect(source).toContain('copyEditorScopedEditPrompt');
    expect(source).toContain('Copy edit brief');
    expect(source).toContain('Copy scoped prompt');
    expect(source).toContain('Editor handoff brief');
    expect(source).toContain('Prepare a scoped NanoCrab editor change.');
    expect(source).toContain(
      'Choose the mounted repository and the smallest file that needs attention.',
    );
    expect(source).toContain(
      'Make surgical changes in one file before expanding scope.',
    );
    expect(source).toContain(
      'Use the status panel to see what changed before handoff.',
    );
    expect(source).toContain(
      'Move to Git Ops or Test Runner once the file edit is saved.',
    );
    expect(source).toContain(
      'Keep the edit scope narrow, explain the intended behavior change, save the file, review Git Ops diff, then run the smallest verification that proves the change.',
    );
    expect(source).toContain(
      'If the file is readonly or no file is open, ask the agent to inspect mounts and choose the smallest editable file before making changes.',
    );
    expect(source).toContain(
      'Inspect the selected file and explain the intended behavior change before editing.',
    );
    expect(source).toContain(
      'Keep the change surgical. Stay in this file unless the evidence clearly requires a second file.',
    );
    expect(source).toContain(
      'After saving, review Git Ops diff before asking another agent to continue.',
    );
    expect(source).toContain(
      'Queue the smallest Test Runner command that proves the changed behavior, then broaden only if shared behavior changed.',
    );
    expect(source).toContain(
      'If the behavior needs project context, route that context through Cowork instead of embedding project facts in code.',
    );
    expect(source).toContain(
      'If the edit affects external writes, credentials, MCP tools, or approvals, stop and name the approval or security check first.',
    );
    expect(source).toContain(
      'Whether the next workspace should be Git Ops, Test Runner, Cowork, or Approvals.',
    );
    expect(source).toContain('Scoped edit prompt copied');
    expect(source).toContain('Copy scoped editor prompt');
    expect(source).not.toContain("prompt('Copy scoped editor prompt:'");
    expect(source).toContain('Edit readiness gate');
    expect(source).toContain(
      'Leave the editor with a reviewable change, not loose edits.',
    );
    expect(source).toContain(
      'Use this before jumping to Git Ops, Test Runner, or another Code agent.',
    );
    expect(source).toContain('File selected');
    expect(source).toContain('Scope explained');
    expect(source).toContain('Saved locally');
    expect(source).toContain('Proof queued');
    expect(source).toContain(
      'The work is anchored to one mounted repository file, not a vague code area.',
    );
    expect(source).toContain(
      'The intended behavior change is clear enough for Git Ops and Test Runner to verify.',
    );
    expect(source).toContain(
      'The editor write is saved before asking another agent to review or continue.',
    );
    expect(source).toContain(
      'The next handoff names the Git diff review and smallest verification command.',
    );
  });

  it('keeps repository, file open, save, and git status wiring intact', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const saveSource = source.slice(
      source.indexOf('window.saveEditorFile = async () => {'),
      source.indexOf(
        '  loadTree();',
        source.indexOf('window.saveEditorFile = async () => {'),
      ),
    );

    expect(source).toContain("api('/files/repos')");
    expect(source).toContain('id="editor-repo"');
    expect(source).toContain('id="editor-tree"');
    expect(source).toContain('id="editor-container"');
    expect(source).toContain('id="editor-save"');
    expect(source).toContain(
      'class="btn btn-primary btn-sm editor-save-button is-hidden" id="editor-save"',
    );
    expect(source).toContain('id="editor-path"');
    expect(source).toContain('id="editor-git"');
    expect(source).toContain('renderEditorLoadingState');
    expect(source).toContain('renderEditorErrorState');
    expect(source).toContain(
      'Scanning files and folders for the selected repository.',
    );
    expect(source).toContain(
      'Loading file contents into the workbench before enabling save.',
    );
    expect(source).toContain('Repository tree unavailable');
    expect(source).toContain('Could not open file');
    expect(source).toContain('window.openEditorFile = async (repo, filePath)');
    expect(source).toContain('window.saveEditorFile = async ()');
    expect(source).toContain("classList.toggle('is-hidden', !!data.readonly)");
    expect(source).toContain(
      '`/files/repos/${encodeURIComponent(currentRepo)}/tree`',
    );
    expect(source).toContain(
      '`/files/repos/${encodeURIComponent(repo)}/file?path=${encodeURIComponent(filePath)}`',
    );
    expect(source).not.toContain(
      '<aside class="editor-tree-panel" id="editor-tree"><div class="loading">Loading</div></aside>',
    );
    expect(source).not.toContain(
      'id="editor-save" onclick="saveEditorFile()" style="display:none"',
    );
    expect(source).not.toContain(
      "document.getElementById('editor-save').style.display",
    );
    expect(saveSource).toContain("setInlineStatus(msg, 'Saved', 'success')");
    expect(saveSource).toContain(
      "setInlineStatus(msg, r.error || 'Failed', 'error')",
    );
    expect(saveSource).toContain("setInlineStatus(msg, '')");
    expect(saveSource).not.toContain('msg.style.color');
  });

  it('replaces inline tree rows with reusable editor classes', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('editor-tree-dir');
    expect(source).toContain('editor-tree-file');
    expect(source).toContain('data-editor-file');
    expect(source).toContain('editor-textarea');
    expect(source).toContain('editor-git-status');
    expect(source).not.toContain('onmouseover="this.style.color');
  });

  it('uses class-based empty repository guidance', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('function renderEditorNoReposState');
    expect(source).toContain('editor-setup-state');
    expect(source).toContain('Code workspace setup');
    expect(source).toContain('No repositories mounted yet.');
    expect(source).toContain(
      'Mount a trusted repo before editing so Code, Git Ops, and Test Runner can share the same file context and verification path.',
    );
    expect(source).toContain('Approve host root');
    expect(source).toContain('Add group mount');
    expect(source).toContain('Open one file');
    expect(source).toContain('Verify in Test Runner');
    expect(source).toContain("navigate('devhub')");
    expect(source).toContain("navigate('gitcode')");
    expect(source).toContain("navigate('projects')");
    expect(source).toContain('renderEditorNoReposState()');
    expect(source).not.toContain('card empty editor-empty-state');
    expect(source).not.toContain('Dev Hub &gt; Mounts');
    expect(source).not.toContain(
      'a style="color:var(--accent);cursor:pointer"',
    );
  });

  it('styles the editor workbench and mobile stacking', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.editor-command-center');
    expect(source).toContain('.editor-workflow-map');
    expect(source).toContain('.editor-workflow-card');
    expect(source).toContain('.editor-readiness-gate');
    expect(source).toContain('.editor-readiness-head');
    expect(source).toContain('.editor-readiness-actions');
    expect(source).toContain('.editor-readiness-grid');
    expect(source).toContain('.editor-readiness-card');
    expect(source).toContain('.editor-layout');
    expect(source).toContain('.editor-tree-panel');
    expect(source).toContain('.editor-tree-file.active');
    expect(source).toContain('.editor-textarea');
    expect(source).toContain('.editor-save-button.is-hidden');
    expect(source).toContain('.editor-msg.is-success');
    expect(source).toContain('.editor-msg.is-error');
    expect(source).toContain('.editor-git-panel');
    expect(source).toContain('.editor-setup-state');
    expect(source).toContain('.editor-setup-flow');
    expect(source).toContain('.editor-setup-actions');
    expect(source).toContain('.editor-empty-state');
    expect(source).toContain('.editor-file-idle-state');
    expect(source).toContain('.editor-file-idle-flow');
    expect(source).toContain('.editor-loading-state');
    expect(source).toContain('.editor-loading-state.is-compact');
    expect(source).toContain('.editor-loading-state.is-error');
    expect(source).toContain('.editor-loading-bars');
    expect(source).toContain('@keyframes editorLoadingBar');
    expect(source).toContain(
      '.editor-workflow-map {\n    grid-template-columns: 1fr;',
    );
    expect(source).toContain(
      '.editor-readiness-grid {\n    grid-template-columns: 1fr;',
    );
    expect(source).toContain(
      '.editor-layout {\n    grid-template-columns: 1fr;',
    );
  });
});
