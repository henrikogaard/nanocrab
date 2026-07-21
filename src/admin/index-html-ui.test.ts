import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const htmlPath = path.join(process.cwd(), 'src/admin/public/index.html');
const manifestPath = path.join(process.cwd(), 'src/admin/public/manifest.json');

describe('Admin HTML entry metadata', () => {
  it('loads the work-session adapter after UI prerequisites and before the app coordinator', () => {
    const source = fs.readFileSync(htmlPath, 'utf8');
    const sharedIndex = source.indexOf('/ui/shared.js');
    const workspaceShellIndex = source.indexOf('/ui/workspace-shell.js');
    const workSessionIndex = source.indexOf('/ui/work-session.js');
    const appIndex = source.indexOf('/app.js');

    expect(workSessionIndex).toBeGreaterThan(sharedIndex);
    expect(workSessionIndex).toBeGreaterThan(workspaceShellIndex);
    expect(workSessionIndex).toBeLessThan(appIndex);
    expect(source).toContain(
      '<script defer src="/ui/work-session.js?v=2.0.0-rc.8"></script>',
    );
  });

  it('loads route context after shell navigation and before the app coordinator', () => {
    const source = fs.readFileSync(htmlPath, 'utf8');
    const navigationIndex = source.indexOf('/ui/shell-navigation.js');
    const workspaceShellIndex = source.indexOf('/ui/workspace-shell.js');
    const appIndex = source.indexOf('/app.js');

    expect(navigationIndex).toBeGreaterThanOrEqual(0);
    expect(workspaceShellIndex).toBeGreaterThan(navigationIndex);
    expect(workspaceShellIndex).toBeLessThan(appIndex);
    expect(source).toContain(
      '<script defer src="/ui/workspace-shell.js?v=2.0.0-rc.8"></script>',
    );
  });

  it('describes NanoCrab as the Copilot, Cowork, Code workspace', () => {
    const source = fs.readFileSync(htmlPath, 'utf8');

    expect(source).toContain('<title>NanoCrab — Personal AI Workspace</title>');
    expect(source).toContain(
      '<meta name="description" content="NanoCrab is a local personal AI workspace for Copilot chat, Cowork projects, Code work, and agent operations.">',
    );
    expect(source).toContain('<meta property="og:title" content="NanoCrab">');
    expect(source).toContain(
      '<meta property="og:description" content="A local personal AI workspace for Copilot chat, Cowork projects, Code work, and agent operations.">',
    );
    expect(source).toContain(
      '<meta property="og:image" content="/static/nanocrab-logo.png">',
    );
    expect(source).toContain('<meta name="twitter:card" content="summary">');
    expect(source).toContain(
      '<meta name="twitter:description" content="Copilot, Cowork, Code, and operations for your local AI workspace.">',
    );
  });

  it('keeps PWA assets and no-script fallback present', () => {
    const source = fs.readFileSync(htmlPath, 'utf8');

    expect(source).toContain(
      '<link rel="manifest" href="/manifest.json?v=2.0.0-rc.8">',
    );
    expect(source).toContain(
      '<link rel="icon" type="image/png" href="/static/nanocrab-mark.png">',
    );
    expect(source).toContain(
      '<link rel="apple-touch-icon" href="/static/nanocrab-mark.png">',
    );
    expect(source).toContain('<noscript>');
    expect(source).toContain('class="noscript-workspace"');
    expect(source).toContain('Enable JavaScript to open NanoCrab');
    expect(source).toContain(
      'Copilot chat, Cowork projects, Code work, approvals, MCP tools, and live operations data.',
    );
    expect(source).toContain(
      '<section class="noscript-lanes" aria-label="Workspace lanes">',
    );
    expect(source).toContain(
      '<strong>Copilot</strong> Plain chat and quick thinking',
    );
    expect(source).toContain(
      '<strong>Cowork</strong> Projects, artifacts, documents, and MCP context',
    );
    expect(source).toContain(
      '<strong>Code</strong> Repository agents, checks, and handoffs',
    );
    expect(source).toContain('After enabling JavaScript, reload this page.');
  });

  it('aligns install metadata and shortcuts with the workspace lanes', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    expect(manifest.name).toBe('NanoCrab Personal AI Workspace');
    expect(manifest.description).toContain('Copilot chat');
    expect(manifest.description).toContain('Cowork projects');
    expect(manifest.description).toContain('Code work');
    expect(
      manifest.shortcuts.map((shortcut: { name: string }) => shortcut.name),
    ).toEqual(
      expect.arrayContaining([
        'Today',
        'Copilot chat',
        'Cowork projects',
        'Code workspace',
      ]),
    );
    expect(
      manifest.shortcuts.map((shortcut: { url: string }) => shortcut.url),
    ).toEqual(
      expect.arrayContaining([
        '/#/dashboard',
        '/#/chat',
        '/#/projects',
        '/#/gitcode',
      ]),
    );
  });
});
