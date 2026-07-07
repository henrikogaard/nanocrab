import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');
const sharedUiPath = path.join(process.cwd(), 'src/admin/public/ui/shared.js');
const feedbackUiPath = path.join(
  process.cwd(),
  'src/admin/public/ui/feedback.js',
);
const shellUiPath = path.join(
  process.cwd(),
  'src/admin/public/ui/shell-states.js',
);
const recoveryUiPath = path.join(
  process.cwd(),
  'src/admin/public/ui/recovery.js',
);

describe('App shell accessibility UI', () => {
  it('adds a keyboard skip link and main content landmark to the dashboard shell', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const shellSource = fs.readFileSync(shellUiPath, 'utf8');

    expect(source).toContain(
      '<a class="skip-link" href="#page-content">Skip to content</a>',
    );
    expect(source).toContain(
      '<main class="main" id="main-content" tabindex="-1">',
    );
    expect(source).not.toContain('Mock dashboard mode: sample data only.');
    expect(source).toContain('window.NanoDataHealth.renderAlerts(alerts');
    expect(source).toContain(
      'const renderShellLoadingState = window.NanoShell.renderShellLoadingState;',
    );
    expect(shellSource).toContain('function renderShellLoadingState');
    expect(source).toContain(
      '<div id="page-content" tabindex="-1">${renderShellLoadingState()}</div>',
    );
    expect(shellSource).toContain('Loading workspace');
    expect(shellSource).toContain(
      'Preparing navigation, live status, and page tools.',
    );
    expect(source).toContain('Loading chats');
    expect(source).toContain('Loading workspace tool');
    expect(shellSource).toContain('Loading tab');
    expect(shellSource).toContain('shell-loading-state-compact');
    expect(source).not.toContain(
      '<div id="page-content" tabindex="-1"><div class="loading">Loading</div></div>',
    );
    expect(source).toContain('</main>');
  });

  it('shows active focus guidance for Chat, Cowork, and Code modes', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');

    expect(appSource).toContain('id="more-drawer" aria-hidden="true" inert');
    expect(appSource).toContain("drawer.toggleAttribute('inert', !isOpen)");
    expect(appSource).toContain('title="${esc(cfg.guidance || \'\')}"');
    expect(appSource).toContain('function shellModeCue(mode)');
    expect(appSource).toContain('const modeCue = shellModeCue(activeMode)');
    expect(appSource).toContain('class="mode-route-cue compact"');
    expect(appSource).toContain('Active focus route cue');
    expect(appSource).toContain('SIDEBAR_WIDTH_STORAGE_KEY');
    expect(appSource).toContain('function initSidebarResize()');
    expect(appSource).toContain('id="sidebar-resize-handle"');
    expect(appSource).toContain('Resize sidebar');
    expect(appSource).toContain('Plain chat');
    expect(appSource).toContain('Project work');
    expect(appSource).toContain('Code work');
    expect(appSource).toContain('Questions, drafting, and quick thinking.');
    expect(appSource).toContain('Files, artifacts, chats, and approved tools.');
    expect(appSource).toContain('Repos, issues, tests, PRs, and handoffs.');
    expect(styleSource).not.toContain('.mode-guidance');
    expect(styleSource).toContain('.mode-route-cue');
    expect(styleSource).toContain('.mode-route-cue span');
    expect(styleSource).toContain('.mode-route-cue p');
    expect(styleSource).toContain('--sidebar-width: 280px;');
    expect(styleSource).toContain('width: var(--sidebar-width);');
    expect(styleSource).toContain('margin-left: var(--sidebar-width);');
    expect(styleSource).toContain('.sidebar-resize-handle');
    expect(styleSource).toContain(
      'grid-template-columns: repeat(3, minmax(0, 1fr));',
    );
    expect(styleSource).toContain('.mode-tab span:not(.nav-icon)');
    expect(styleSource).toContain('.alert-compact');
  });

  it('restores chat thread deep links without double-prefixing legacy web ids', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');

    expect(appSource).toContain("chat: { label: 'Chat', icon: 'chat' }");
    expect(appSource).toContain('function parseChatHash(hash)');
    expect(appSource).toContain("decoded.startsWith('web:') ? decoded : 'web:' + decoded");
    expect(appSource).toContain('function parseProjectChatHash(hash)');
    expect(appSource).toContain("decodedThreadId.startsWith('web:')");
  });

  it('loads shared data-health helpers before the shell and surfaces plugin registry issues', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const sharedSource = fs.readFileSync(sharedUiPath, 'utf8');
    const feedbackSource = fs.readFileSync(feedbackUiPath, 'utf8');
    const shellSource = fs.readFileSync(shellUiPath, 'utf8');
    const recoverySource = fs.readFileSync(recoveryUiPath, 'utf8');
    const indexSource = fs.readFileSync(
      path.join(process.cwd(), 'src/admin/public/index.html'),
      'utf8',
    );
    const helperSource = fs.readFileSync(
      path.join(process.cwd(), 'src/admin/public/ui/data-health.js'),
      'utf8',
    );

    expect(indexSource).toContain('/ui/shared.js');
    expect(indexSource).toContain('/ui/data-health.js');
    expect(indexSource).toContain('/ui/feedback.js');
    expect(indexSource).toContain('/ui/shell-states.js');
    expect(indexSource).toContain('/ui/recovery.js');
    expect(indexSource.indexOf('/ui/shared.js')).toBeLessThan(
      indexSource.indexOf('/ui/data-health.js'),
    );
    expect(indexSource.indexOf('/ui/data-health.js')).toBeLessThan(
      indexSource.indexOf('/ui/feedback.js'),
    );
    expect(indexSource.indexOf('/ui/feedback.js')).toBeLessThan(
      indexSource.indexOf('/ui/shell-states.js'),
    );
    expect(indexSource.indexOf('/ui/shell-states.js')).toBeLessThan(
      indexSource.indexOf('/ui/recovery.js'),
    );
    expect(indexSource.indexOf('/ui/recovery.js')).toBeLessThan(
      indexSource.indexOf('/app.js'),
    );
    expect(sharedSource).toContain('window.NanoShared');
    expect(sharedSource).toContain('window.esc = esc');
    expect(helperSource).toContain('window.NanoDataHealth');
    expect(feedbackSource).toContain('window.NanoFeedback');
    expect(shellSource).toContain('window.NanoShell');
    expect(recoverySource).toContain('window.NanoRecovery');
    expect(helperSource).toContain('loadPluginsList');
    expect(helperSource).toContain('renderAlerts');
    expect(helperSource).toContain('if (!/^[a-z0-9_-]+$/i.test(type)) type =');
    expect(helperSource).toContain('Plugin registry unavailable');
    expect(appSource).toContain(
      "const loadShellPluginsList = (context = 'workspace shell')",
    );
    expect(appSource).toContain(
      'window.NanoDataHealth.loadPluginsList(api, context)',
    );
    expect(appSource).toContain('window.NanoDataHealth.renderAlerts(alerts');
    expect(appSource).toContain('sidebar-data-health');
    expect(styleSource).toContain('.sidebar-data-health');
    expect(appSource).not.toContain("api('/plugins').catch(() => [])");
    expect(appSource).not.toContain('alert-${a.type}');
  });

  it('styles shared shell loading states as route-shaped placeholders', () => {
    const styleSource = fs.readFileSync(stylePath, 'utf8');

    expect(styleSource).toContain('.shell-loading-state');
    expect(styleSource).toContain('.shell-loading-state::after');
    expect(styleSource).toContain('.shell-loading-copy');
    expect(styleSource).toContain('.shell-loading-steps');
    expect(styleSource).toContain('.shell-loading-state-compact');
    expect(styleSource).toContain('@keyframes shellLoadingSweep');
  });

  it('makes consolidated workspace tabs keyboard-accessible and recoverable', () => {
    const shellSource = fs.readFileSync(shellUiPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const appSource = fs.readFileSync(appPath, 'utf8');

    expect(appSource).not.toContain('function renderTabLoadErrorState');
    expect(shellSource).toContain('function renderTabLoadErrorState');
    expect(shellSource).toContain('function renderTabs');
    expect(shellSource).toContain('role="tablist"');
    expect(shellSource).toContain('role="tab"');
    expect(shellSource).toContain('role="tabpanel"');
    expect(shellSource).toContain('aria-selected');
    expect(shellSource).toContain('aria-controls');
    expect(shellSource).toContain('handleTabKeydown');
    expect(shellSource).toContain('ArrowLeft');
    expect(shellSource).toContain('ArrowRight');
    expect(shellSource).toContain('Home');
    expect(shellSource).toContain('End');
    expect(shellSource).toContain('Tab unavailable');
    expect(shellSource).toContain('Retry tab');
    expect(shellSource).toContain('loaded.delete(tabId)');
    expect(shellSource).toContain(
      'renderTabLoadErrorState(containerId, tabId, err)',
    );
    expect(shellSource).not.toContain(
      "<div class=\"tab ${t.id === defaultTab ? 'active' : ''}\"",
    );
    expect(styleSource).toContain('.tab:focus-visible');
    expect(styleSource).toContain('.tab-load-error-state');
    expect(styleSource).toContain('.tab-load-error-actions');
    expect(styleSource).toContain('.tab-load-error-state code');
    expect(styleSource).toContain('@media (max-width: 720px)');
  });

  it('groups More drawer tools by operator intent instead of one flat admin list', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');

    expect(appSource).toContain('const MORE_DRAWER_SECTIONS = [');
    expect(appSource).toContain("title: 'Operate'");
    expect(appSource).toContain("title: 'Connect'");
    expect(appSource).toContain("title: 'Personal'");
    expect(appSource).toContain("title: 'Govern'");
    expect(appSource).toContain(
      "pages: ['channels', 'integrations', 'webhooks', 'credentials', 'containers', 'groups', 'sessions']",
    );
    expect(appSource).toContain(
      "pages: ['memory', 'skills', 'settings', 'timeline', 'marketplace', 'help']",
    );
    expect(appSource).toContain('function moreDrawerSections(ids)');
    expect(appSource).toContain(
      '<div class="more-drawer-header"><span>Workspace tools</span>',
    );
    expect(appSource).toContain('more-drawer-route-map');
    expect(appSource).toContain('Where to configure work');
    expect(appSource).toContain('Personal');
    expect(appSource).toContain('Memory, skills, identity');
    expect(appSource).toContain('Connectors');
    expect(appSource).toContain('MCP, channels, credentials');
    expect(appSource).toContain('Recovery');
    expect(appSource).toContain('Backups, monitoring, audit');
    expect(appSource).toContain('<span class="nav-label">Settings</span>');
    expect(appSource).toContain('moreDrawerSections(moreDrawerIds)');
    expect(appSource).toContain(
      "channels: { label: 'Channels', icon: 'messages' }",
    );
    expect(styleSource).not.toContain('.more-drawer-intro');
    expect(styleSource).toContain('.more-drawer-route-map');
    expect(styleSource).toContain(
      '.more-drawer-route-map button:focus-visible',
    );
    expect(styleSource).toContain('.more-section');
    expect(styleSource).toContain('.more-section-head');
    expect(styleSource).toContain('.more-section-links');
  });

  it('keeps built-in route metadata complete for recovery and hidden detail pages', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain(
      "'session-detail': { label: 'Session Detail', icon: 'sessions' }",
    );
    expect(source).toContain("'session-detail': 'renderSessionDetail'");
    expect(source).toContain(
      "editor: { page: 'gitcode', container: 'gc-tabs', tab: 'editor' }",
    );
    expect(source).toContain(
      "'test-runner': { page: 'gitcode', container: 'gc-tabs', tab: 'tests' }",
    );
    expect(source).toContain(
      "'review-rules': { page: 'gitcode', container: 'gc-tabs', tab: 'rules' }",
    );

    const pageMetaBlock = source.slice(
      source.indexOf('const PAGE_META = {'),
      source.indexOf('function metaLabel'),
    );
    const pageMapBlock = source.slice(
      source.indexOf('const _pageMap = {'),
      source.indexOf('};', source.indexOf('const _pageMap = {')),
    );
    const aliasBlock = source.slice(
      source.indexOf('const PAGE_ALIASES = {'),
      source.indexOf('};', source.indexOf('const PAGE_ALIASES = {')),
    );
    const tabAliasBlock = source.slice(
      source.indexOf('const PAGE_TAB_ALIASES = {'),
      source.indexOf('};', source.indexOf('const PAGE_TAB_ALIASES = {')),
    );
    const pageMetaIds = new Set(
      [...pageMetaBlock.matchAll(/^  ['"]?([a-zA-Z0-9_-]+)['"]?:/gm)].map(
        (match) => match[1],
      ),
    );
    const aliasIds = new Set(
      [
        ...aliasBlock.matchAll(/^  ['"]?([a-zA-Z0-9_-]+)['"]?:/gm),
        ...tabAliasBlock.matchAll(/^  ['"]?([a-zA-Z0-9_-]+)['"]?:/gm),
      ].map((match) => match[1]),
    );
    const missing = [
      ...pageMapBlock.matchAll(/^  ['"]?([a-zA-Z0-9_-]+)['"]?:/gm),
    ]
      .map((match) => match[1])
      .filter(
        (id) =>
          id !== 'project-chat' && !pageMetaIds.has(id) && !aliasIds.has(id),
      );

    expect(missing).toEqual([]);
  });

  it('uses class-based toast layout, tones, and dismissal state', () => {
    const feedbackSource = fs.readFileSync(feedbackUiPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');

    expect(feedbackSource).toContain("container.className = 'toast-container'");
    expect(feedbackSource).toContain("el.className = 'toast toast-' + tone");
    expect(feedbackSource).toContain("el.classList.add('is-leaving')");
    expect(feedbackSource).toContain('window.toast = toast');
    expect(feedbackSource).not.toContain('style.cssText');
    expect(feedbackSource).not.toContain('style.opacity');
    expect(styleSource).toContain('.toast-container');
    expect(styleSource).toContain('.toast-success');
    expect(styleSource).toContain('.toast-error');
    expect(styleSource).toContain('.toast-warning');
    expect(styleSource).toContain('.toast.is-leaving');
  });

  it('uses an in-app manual copy panel when clipboard access is blocked', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const feedbackSource = fs.readFileSync(feedbackUiPath, 'utf8');
    const recoverySource = fs.readFileSync(recoveryUiPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');

    expect(appSource).toContain(
      'const copyTextWithFallback = window.NanoFeedback.copyTextWithFallback;',
    );
    expect(feedbackSource).toContain('window.copyTextWithFallback');
    expect(feedbackSource).toContain('function showCopyFallback(title, text)');
    expect(appSource).toContain('window.shareContent = async function');
    expect(appSource).toContain(
      "copyTextWithFallback(text, 'Shared text copied', title || 'Copy shared text')",
    );
    expect(feedbackSource).toContain('copy-fallback-overlay');
    expect(feedbackSource).toContain('copy-fallback-text');
    expect(feedbackSource).toContain(
      'Clipboard access blocked. Copy from the panel.',
    );
    expect(recoverySource).toContain('window.copyRouteRecoveryBrief');
    expect(appSource).not.toContain(
      'navigator.clipboard.writeText(text).catch(() => {})',
    );
    expect(appSource).not.toContain("toast('Copied to clipboard', 'success')");
    expect(appSource).not.toContain("prompt('Copy route recovery brief:'");
    expect(styleSource).toContain('.copy-fallback-overlay');
    expect(styleSource).toContain('.copy-fallback-panel');
    expect(styleSource).toContain('.copy-fallback-text');
    expect(styleSource).toContain('.copy-fallback-actions');
  });

  it('styles the skip link as hidden until focus and keeps focus visible', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.skip-link');
    expect(source).toContain('transform: translateY(-160%);');
    expect(source).toContain('.skip-link:focus-visible');
    expect(source).toContain('transform: translateY(0);');
    expect(source).toContain('#main-content:focus-visible');
    expect(source).toContain('#page-content:focus-visible');
  });

  it('styles the no-script fallback as a workspace recovery panel', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.noscript-workspace');
    expect(source).toContain('.noscript-kicker');
    expect(source).toContain('.noscript-lanes');
    expect(source).toContain('.noscript-lanes span');
    expect(source).toContain('.noscript-lanes strong');
    expect(source).toContain('.noscript-note');
  });

  it('respects reduced-motion preferences for the animated dashboard shell', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain('animation-duration: 0.001ms !important;');
    expect(source).toContain('transition-duration: 0.001ms !important;');
    expect(source).toContain('.loading::after,');
    expect(source).toContain('.shell-loading-state::after,');
    expect(source).toContain('.progress-spinner');
    expect(source).toContain('animation: none !important;');
  });
});
