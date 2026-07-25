import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Git & Code workspace shell UI', () => {
  it('frames the code workspace around review, verification, and guidance lanes', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Code workspace');
    expect(source).toContain('gitcode-command-center');
    expect(source).toContain('gitcode-lane-grid');
    expect(source).toContain(
      'Move from repository state to edits, tests, reusable snippets, and review rules',
    );
    expect(source).toContain('Copy code brief');
    expect(source).toContain('<strong>Git Ops</strong>');
    expect(source).toContain('<strong>Tests</strong>');
    expect(source).toContain('<strong>Review rules</strong>');
  });

  it('copies the Code workspace operating loop for agent handoffs', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('function gitCodeWorkspaceBriefText');
    expect(source).toContain('window.copyGitCodeWorkspaceBrief');
    expect(source).toContain('NanoCrab Code workspace brief');
    expect(source).toContain(
      'Use this when handing repository work to a code agent',
    );
    expect(source).toContain(
      'Inspect Git Ops before editing, committing, pushing, or launching automation',
    );
    expect(source).toContain(
      'Ask before external writes, pushes, deployments, destructive git commands, or third-party system changes',
    );
    expect(source).toContain('Code workspace brief copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("prompt('Copy Code workspace brief:'");
    expect(source).toContain('window._gitCodeWorkspaceState');
  });

  it('keeps Git Ops first and lazy-loads heavier code tabs', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("const loadedTabs = new Set(['git'])");
    expect(source).toContain("window.registerTabLoaders?.(\n    'gc-tabs'");
    expect(source).toContain('editor: renderEditor');
    expect(source).toContain('tests: renderTestRunner');
    expect(source).toContain('snippets: renderSnippets');
    expect(source).toContain('rules: renderReviewRules');
    expect(source).toContain(
      "await renderGitOps(document.getElementById('gc-tabs-git'))",
    );
    expect(source).not.toContain(
      "await renderEditor(document.getElementById('gc-tabs-editor'))",
    );
  });

  it('preserves tab ids and quick lane navigation hooks', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("{ id: 'git', label: 'Git Ops' }");
    expect(source).toContain("{ id: 'editor', label: 'Editor' }");
    expect(source).toContain("{ id: 'tests', label: 'Tests' }");
    expect(source).toContain("{ id: 'snippets', label: 'Snippets' }");
    expect(source).toContain("{ id: 'rules', label: 'Review Rules' }");
    expect(source).toContain("window.switchTab('gc-tabs','tests')");
    expect(source).toContain(
      "window._tabLoaderRegistry?.['gc-tabs']?.('tests')",
    );
  });

  it('adds a Quick Tasks tab for lightweight coding without full agent setup', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const panelStart = source.indexOf(
      'async function renderLightweightTasksPanel',
    );
    const panelEnd = source.indexOf('window.updateLtaskModels');
    const panelSource =
      panelStart >= 0 && panelEnd > panelStart
        ? source.slice(panelStart, panelEnd)
        : '';

    expect(source).toContain("{ id: 'ltasks', label: 'Quick Tasks' }");
    expect(source).toContain(
      'ltasks: (tabEl) => renderLightweightTasksPanel(tabEl)',
    );
    expect(panelSource).toContain(
      'window._ltaskProviderModels = providerModels',
    );
    expect(panelSource).toContain('preserveDraft: true');
    expect(panelSource).toContain("api('/lightweight-tasks'");
  });

  it('styles the Git & Code command center and responsive lane layout', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.gitcode-command-center');
    expect(source).toContain('.gitcode-command-copy');
    expect(source).toContain('.gitcode-command-actions');
    expect(source).toContain('.gitcode-lane-grid');
    expect(source).toContain('.gitcode-lane:hover');
    expect(source).toContain('@media (max-width: 920px)');
    expect(source).toContain('.gitcode-command-center,');
    expect(source).toContain('.gitcode-lane-grid {');
  });
});
