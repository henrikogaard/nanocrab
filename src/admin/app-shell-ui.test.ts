import { describe, expect, it } from 'vitest';
import fs from 'fs';
import * as vm from 'node:vm';
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
const shellNavigationUiPath = path.join(
  process.cwd(),
  'src/admin/public/ui/shell-navigation.js',
);
const recoveryUiPath = path.join(
  process.cwd(),
  'src/admin/public/ui/recovery.js',
);
const providerParityUiPath = path.join(
  process.cwd(),
  'src/admin/public/ui/provider-parity.js',
);
const routineStatesUiPath = path.join(
  process.cwd(),
  'src/admin/public/ui/routine-states.js',
);
const fileVaultStatesUiPath = path.join(
  process.cwd(),
  'src/admin/public/ui/file-vault-states.js',
);
const commandPaletteUiPath = path.join(
  process.cwd(),
  'src/admin/public/ui/command-palette.js',
);

function loadShellNavigation(role = 'owner') {
  const context = {
    window: {
      _userRole: role,
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(shellNavigationUiPath, 'utf8'), context);
  return (context.window as any).NanoShellNavigation;
}

function loadCommandPalette() {
  const inputMock = {
    value: '',
    addEventListener: () => {},
    focus: () => {},
  };
  const elMock = {
    id: '',
    className: '',
    setAttribute: () => {},
    addEventListener: () => {},
    appendChild: (child: any) => child,
    innerHTML: '',
    querySelector: (sel: string) =>
      sel === '.cp-input' || sel === '.cp-results'
        ? sel === '.cp-input'
          ? inputMock
          : {
              innerHTML: '',
              querySelector: () => null,
              addEventListener: () => {},
            }
        : null,
    querySelectorAll: () => [],
    closest: (_s: string) => null,
    scrollIntoView: () => {},
    focus: () => {},
  };
  const doc = {
    getElementById: () => null,
    createElement: (_tag: string) => elMock,
    addEventListener: () => {},
    body: { appendChild: () => {} },
    readyState: 'complete',
  };
  const context: any = {
    window: { document: doc },
    document: doc,
    navigator: {},
    location: { hash: '' },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(shellNavigationUiPath, 'utf8'), context);
  vm.runInContext(fs.readFileSync(commandPaletteUiPath, 'utf8'), context);
  return context.window.NanoCommandPalette;
}

function loadSharedUi() {
  const context: any = {
    window: {},
    document: {
      createElement: () => ({ textContent: '', innerHTML: '' }),
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(sharedUiPath, 'utf8'), context);
  return context.window.NanoShared;
}

describe('App shell accessibility UI', () => {
  it('fails closed when a coding runtime catalog response is malformed', () => {
    const shared = loadSharedUi();
    const validRuntime = {
      cli: 'codex',
      provider: 'codex',
      model: 'gpt-5.4',
      cliModel: null,
      available: true,
      readiness: {
        cli: 'codex',
        executable: 'codex',
        status: 'healthy',
        version: '1.0.0',
        checkedAt: '2026-07-14T00:00:00.000Z',
        detail: 'ready',
      },
    };

    expect(shared.normalizeCodingRuntimeCatalog([validRuntime])).toEqual({
      runtimes: [validRuntime],
      error: '',
    });
    const validUnavailableRuntime = {
      ...validRuntime,
      cli: 'devin',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      cliModel: 'claude-sonnet-4',
      available: false,
      readiness: {
        ...validRuntime.readiness,
        cli: 'devin',
        executable: 'devin',
        status: 'unauthenticated',
        version: null,
        detail: 'Devin CLI is not authenticated',
      },
    };
    expect(
      shared.normalizeCodingRuntimeCatalog([validUnavailableRuntime]),
    ).toEqual({ runtimes: [validUnavailableRuntime], error: '' });
    const validErrorRuntime = {
      ...validRuntime,
      cli: 'opencode',
      provider: 'openrouter',
      model: 'openai/gpt-oss-120b',
      available: false,
      readiness: {
        ...validRuntime.readiness,
        cli: 'opencode',
        executable: 'opencode',
        status: 'error',
        version: null,
        detail: 'Failed to start opencode\nstderr: connection refused\n',
      },
    };
    expect(
      shared.normalizeCodingRuntimeCatalog([validRuntime, validErrorRuntime]),
    ).toEqual({
      runtimes: [validRuntime, validErrorRuntime],
      error: '',
    });
    const malformedRuntimeEntries = [
      { ...validRuntime, cli: ' ' },
      { ...validRuntime, provider: '' },
      { ...validRuntime, model: ' gpt-5.4 ' },
      { ...validRuntime, cliModel: undefined },
      { ...validRuntime, cliModel: 42 },
      { ...validRuntime, cliModel: ' ' },
      {
        ...validRuntime,
        readiness: { ...validRuntime.readiness, status: 'unknown' },
      },
      {
        ...validRuntime,
        readiness: { ...validRuntime.readiness, status: undefined },
      },
      {
        ...validRuntime,
        readiness: { ...validRuntime.readiness, cli: 'claude' },
      },
      {
        ...validRuntime,
        readiness: { ...validRuntime.readiness, cli: undefined },
      },
      {
        ...validRuntime,
        readiness: { ...validRuntime.readiness, executable: null },
      },
      {
        ...validRuntime,
        readiness: { ...validRuntime.readiness, executable: ' ' },
      },
      {
        ...validRuntime,
        readiness: { ...validRuntime.readiness, executable: undefined },
      },
      {
        ...validRuntime,
        readiness: { ...validRuntime.readiness, version: 1 },
      },
      {
        ...validRuntime,
        readiness: { ...validRuntime.readiness, version: ' ' },
      },
      {
        ...validRuntime,
        readiness: { ...validRuntime.readiness, version: undefined },
      },
      {
        ...validRuntime,
        readiness: { ...validRuntime.readiness, checkedAt: 'not-a-date' },
      },
      {
        ...validRuntime,
        readiness: { ...validRuntime.readiness, checkedAt: undefined },
      },
      {
        ...validRuntime,
        readiness: {
          ...validRuntime.readiness,
          checkedAt: '2026-07-14 00:00:00',
        },
      },
      {
        ...validRuntime,
        readiness: { ...validRuntime.readiness, detail: ' ' },
      },
      {
        ...validRuntime,
        readiness: { ...validRuntime.readiness, detail: undefined },
      },
      { ...validRuntime, available: false },
      {
        ...validRuntime,
        available: true,
        readiness: { ...validRuntime.readiness, status: 'missing' },
      },
    ];
    for (const malformed of [
      { ok: true },
      [null],
      [{ cli: 'codex' }],
      ...malformedRuntimeEntries.map((runtime) => [runtime]),
    ]) {
      expect(shared.normalizeCodingRuntimeCatalog(malformed)).toEqual({
        runtimes: [],
        error: 'Coding runtime catalog returned an unexpected response',
      });
    }
  });

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

  it('keeps the primary shell focused on Chat, Cowork, and Code while gating tools behind More', () => {
    const modesSource = fs.readFileSync(
      path.join(process.cwd(), 'src/admin/public/modes.js'),
      'utf8',
    );
    const appSource = fs.readFileSync(appPath, 'utf8');

    expect(modesSource).toContain("pages: ['chat']");
    expect(modesSource).toContain("pages: ['projects']");
    expect(modesSource).toContain("pages: ['gitcode']");
    expect(modesSource).toContain("'agents'");
    expect(modesSource).toContain("'tasks'");
    expect(modesSource).toContain("'workflows'");
    expect(modesSource).toContain("'reports'");
    expect(modesSource).toContain("'artifacts'");
    expect(modesSource).toContain("'approvals'");
    expect(modesSource).toContain("'devhub'");
    expect(modesSource).toContain("'autofix'");
    expect(modesSource).toContain("'copilot'");
    expect(appSource).toContain('<span class="nav-label">More</span>');
    expect(appSource).not.toContain(
      '<span class="nav-label">Settings</span></a>',
    );
  });

  it('restores chat thread deep links without double-prefixing legacy web ids', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const shellNavigationSource = fs.readFileSync(
      shellNavigationUiPath,
      'utf8',
    );

    expect(shellNavigationSource).toContain(
      "chat: { label: 'Chat', icon: 'chat' }",
    );
    expect(appSource).toContain('function parseChatHash(hash)');
    expect(appSource).toContain(
      "decoded.startsWith('web:') ? decoded : 'web:' + decoded",
    );
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
    const providerParitySource = fs.readFileSync(providerParityUiPath, 'utf8');
    const routineStatesSource = fs.readFileSync(routineStatesUiPath, 'utf8');
    const fileVaultStatesSource = fs.readFileSync(
      fileVaultStatesUiPath,
      'utf8',
    );
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
    expect(indexSource).toContain('/ui/shell-navigation.js');
    expect(indexSource).toContain('/ui/command-palette.js');
    expect(indexSource).toContain('/ui/recovery.js');
    expect(indexSource).toContain('/ui/provider-parity.js');
    expect(indexSource).toContain('/ui/routine-states.js');
    expect(indexSource).toContain('/ui/file-vault-states.js');
    expect(indexSource.indexOf('/ui/shared.js')).toBeLessThan(
      indexSource.indexOf('/ui/routine-states.js'),
    );
    expect(indexSource.indexOf('/ui/routine-states.js')).toBeLessThan(
      indexSource.indexOf('/ui/file-vault-states.js'),
    );
    expect(indexSource.indexOf('/ui/file-vault-states.js')).toBeLessThan(
      indexSource.indexOf('/ui/data-health.js'),
    );
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
      indexSource.indexOf('/ui/shell-navigation.js'),
    );
    expect(indexSource.indexOf('/ui/shell-navigation.js')).toBeLessThan(
      indexSource.indexOf('/ui/recovery.js'),
    );
    expect(indexSource.indexOf('/ui/command-palette.js')).toBeLessThan(
      indexSource.indexOf('/ui/recovery.js'),
    );
    expect(indexSource.indexOf('/ui/recovery.js')).toBeLessThan(
      indexSource.indexOf('/ui/provider-parity.js'),
    );
    expect(indexSource.indexOf('/ui/provider-parity.js')).toBeLessThan(
      indexSource.indexOf('/app.js'),
    );
    expect(sharedSource).toContain('window.NanoShared');
    expect(sharedSource).toContain('window.esc = esc');
    expect(helperSource).toContain('window.NanoDataHealth');
    expect(feedbackSource).toContain('window.NanoFeedback');
    expect(shellSource).toContain('window.NanoShell');
    expect(recoverySource).toContain('window.NanoRecovery');
    expect(providerParitySource).toContain('window.NanoProviderParity');
    expect(routineStatesSource).toContain('window.NanoRoutineStates');
    expect(fileVaultStatesSource).toContain('window.NanoFileVaultStates');
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
    expect(appSource).toContain('} = window.NanoShellNavigation;');
    expect(appSource).not.toContain('const PAGE_META = {');
  });

  it('exposes shell navigation metadata as a runtime module for the app shell', () => {
    const navigation = loadShellNavigation();

    expect(navigation.metaLabel('projects')).toBe('Cowork Projects');
    expect(navigation.metaIcon('projects')).toBe('agents');
    expect(navigation.metaLabel('unknown-route')).toBe('unknown-route');
    expect(navigation.metaIcon('unknown-route')).toBe('integrations');
    expect(navigation.PAGE_META['session-detail']).toEqual({
      label: 'Session Detail',
      icon: 'sessions',
    });
    expect(
      navigation
        .moreDrawerSections(['dashboard', 'memory', 'skills', 'audit'])
        .map((section: any) => ({
          title: section.title,
          pages: section.pages,
        })),
    ).toEqual([
      { title: 'Operate', pages: ['dashboard'] },
      { title: 'Personal', pages: ['memory', 'skills'] },
      { title: 'Govern', pages: ['audit'] },
    ]);
    expect(navigation.isVisibleForRole('gitcode')).toBe(true);

    const viewerNavigation = loadShellNavigation('viewer');

    expect(viewerNavigation.isVisibleForRole('chat')).toBe(true);
    expect(viewerNavigation.isVisibleForRole('gitcode')).toBe(false);
    expect(viewerNavigation.isVisibleForRole('security')).toBe(false);
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
    const shellNavigationSource = fs.readFileSync(
      shellNavigationUiPath,
      'utf8',
    );

    expect(shellNavigationSource).toContain('const MORE_DRAWER_SECTIONS = [');
    expect(shellNavigationSource).toContain("title: 'Cowork'");
    expect(shellNavigationSource).toContain("title: 'Code'");
    expect(shellNavigationSource).toContain("title: 'Operate'");
    expect(shellNavigationSource).toContain("title: 'Connect'");
    expect(shellNavigationSource).toContain("title: 'Personal'");
    expect(shellNavigationSource).toContain("title: 'Govern'");
    for (const id of [
      'channels',
      'agents',
      'tasks',
      'workflows',
      'reports',
      'artifacts',
      'approvals',
      'devhub',
      'autofix',
      'copilot',
      'integrations',
      'webhooks',
      'credentials',
      'containers',
      'groups',
      'sessions',
      'memory',
      'skills',
      'settings',
      'timeline',
      'marketplace',
      'help',
    ]) {
      expect(shellNavigationSource).toContain(`'${id}'`);
    }
    expect(shellNavigationSource).toContain('function moreDrawerSections(ids)');
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
    expect(appSource).not.toContain(
      '<span class="nav-label">Settings</span></a>',
    );
    expect(appSource).toContain('moreDrawerSections(moreDrawerIds)');
    expect(shellNavigationSource).toContain(
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
    const shellNavigationSource = fs.readFileSync(
      shellNavigationUiPath,
      'utf8',
    );

    expect(shellNavigationSource).toContain(
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

    const pageMetaBlock = shellNavigationSource.slice(
      shellNavigationSource.indexOf('const PAGE_META = {'),
      shellNavigationSource.indexOf('const MORE_DRAWER_SECTIONS = ['),
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
      [...pageMetaBlock.matchAll(/^ +['"]?([a-zA-Z0-9_-]+)['"]?:/gm)].map(
        (match) => match[1],
      ),
    );
    const aliasIds = new Set(
      [
        ...aliasBlock.matchAll(/^ {2}['"]?([a-zA-Z0-9_-]+)['"]?:/gm),
        ...tabAliasBlock.matchAll(/^ {2}['"]?([a-zA-Z0-9_-]+)['"]?:/gm),
      ].map((match) => match[1]),
    );
    const missing = [
      ...pageMapBlock.matchAll(/^ {2}['"]?([a-zA-Z0-9_-]+)['"]?:/gm),
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

  it('loads the command palette after shell-navigation and before app.js, with Cmd+K binding', () => {
    const source = fs.readFileSync(commandPaletteUiPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const indexSource = fs.readFileSync(
      path.join(process.cwd(), 'src/admin/public/index.html'),
      'utf8',
    );

    expect(indexSource.indexOf('/ui/shell-navigation.js')).toBeLessThan(
      indexSource.indexOf('/ui/command-palette.js'),
    );
    expect(indexSource.indexOf('/ui/command-palette.js')).toBeLessThan(
      indexSource.indexOf('/ui/recovery.js'),
    );
    expect(source).toContain("'k'");
    expect(source).toContain('e.metaKey || e.ctrlKey');
    expect(source).toContain("cp-overlay'");
    expect(source).toContain('cp-modal');
    expect(source).toContain('cp-input');
    expect(source).toContain('cp-results');
    expect(source).toContain('cp-item');
    expect(source).toContain('cp-empty');
    expect(source).toContain('cp-footer');
    expect(source).toContain('Search pages, tools, and views');
    expect(source).toContain('ArrowDown');
    expect(source).toContain('ArrowUp');
    expect(source).toContain('dialog');
    expect(source).toContain('option');
    expect(source).toContain('group');
    expect(source).toContain('listbox');
    expect(source).toContain('aria-selected');
    expect(source).toContain('aria-label');
    expect(source).toContain('aria-modal');
    expect(styleSource).toContain('.cp-overlay');
    expect(styleSource).toContain('.cp-modal');
    expect(styleSource).toContain('.cp-item');
    expect(styleSource).toContain('.cp-selected');
    expect(styleSource).toContain('.cp-empty');
    expect(styleSource).toContain('.cp-footer');
    expect(styleSource).toContain('.cp-overlay.cp-visible');
    expect(styleSource).toContain('z-index: 100');
    expect(styleSource).toContain('cp-results');
  });

  it('registers NanoCommandPalette with open and close methods', () => {
    const palette = loadCommandPalette();
    expect(palette).toBeDefined();
    expect(typeof palette.open).toBe('function');
    expect(typeof palette.close).toBe('function');
  });
});
