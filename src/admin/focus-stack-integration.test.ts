import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as vm from 'node:vm';

const publicRoot = path.join(process.cwd(), 'src/admin/public');
const scriptPaths = [
  path.join(publicRoot, 'modes.js'),
  path.join(publicRoot, 'ui/shell-navigation.js'),
  path.join(publicRoot, 'ui/workspace-shell.js'),
  path.join(publicRoot, 'pages/dashboard.js'),
  path.join(publicRoot, 'app.js'),
];

type FakeEvent = {
  key?: string;
  preventDefault(): void;
};

class FakeClassList {
  private readonly values = new Set<string>();

  reset(value: string) {
    this.values.clear();
    for (const item of value.split(/\s+/).filter(Boolean))
      this.values.add(item);
  }

  add(...values: string[]) {
    for (const value of values) this.values.add(value);
  }

  remove(...values: string[]) {
    for (const value of values) this.values.delete(value);
  }

  contains(value: string) {
    return this.values.has(value);
  }

  toggle(value: string, force?: boolean) {
    const enabled = force === undefined ? !this.values.has(value) : force;
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }

  toString() {
    return [...this.values].join(' ');
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  readonly style = { setProperty: () => {} };
  focusCount = 0;
  textContent = '';
  private html = '';

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly tagName = 'DIV',
    readonly id = '',
    className = '',
  ) {
    this.classList.reset(className);
  }

  get className() {
    return this.classList.toString();
  }

  set className(value: string) {
    this.classList.reset(value);
  }

  get innerHTML() {
    return this.html;
  }

  set innerHTML(value: string) {
    this.html = String(value);
    if (this.id === 'app') this.ownerDocument.mountShell(this.html);
    if (this.id === 'page-content') this.ownerDocument.mountPage(this.html);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  toggleAttribute(name: string, force?: boolean) {
    const enabled = force === undefined ? !this.attributes.has(name) : force;
    if (enabled) this.attributes.set(name, '');
    else this.attributes.delete(name);
    return enabled;
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, event: FakeEvent) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  focus() {
    this.focusCount += 1;
    this.ownerDocument.activeElement = this;
  }

  querySelector(selector: string) {
    return this.ownerDocument.queryWithin(this, selector);
  }

  querySelectorAll() {
    return [];
  }

  getBoundingClientRect() {
    return {
      width: 280,
      height: 800,
      top: 0,
      right: 280,
      bottom: 800,
      left: 0,
    };
  }

  setPointerCapture() {}
  releasePointerCapture() {}
}

class FakeDocument {
  readonly documentElement = new FakeElement(this, 'HTML');
  readonly body = new FakeElement(this, 'BODY');
  readonly app = new FakeElement(this, 'DIV', 'app');
  readonly elements: FakeElement[] = [this.app];
  readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  activeElement: FakeElement = this.body;
  cookie = '';
  hidden = false;

  getElementById(id: string) {
    return this.elements.find((element) => element.id === id) || null;
  }

  querySelector(selector: string) {
    if (selector.startsWith('#')) return this.getElementById(selector.slice(1));
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return (
        this.elements.find((element) =>
          element.classList.contains(className),
        ) || null
      );
    }
    return null;
  }

  querySelectorAll(selector: string) {
    const controlsMatch = selector.match(/^\[aria-controls="([^"]+)"\]$/);
    if (controlsMatch) {
      return this.elements.filter(
        (element) => element.getAttribute('aria-controls') === controlsMatch[1],
      );
    }
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return this.elements.filter((element) =>
        element.classList.contains(className),
      );
    }
    return [];
  }

  createElement(tagName: string) {
    return new FakeElement(this, tagName.toUpperCase());
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, event: FakeEvent) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.length || 0;
  }

  queryWithin(parent: FakeElement, selector: string) {
    if (
      parent.id === 'workspace-inspector' &&
      selector === '.focus-stack-inspector-close'
    ) {
      return this.querySelector(selector);
    }
    if (parent.id === 'more-drawer' && selector === '.more-close') {
      return this.querySelector(selector);
    }
    return null;
  }

  mountShell(html: string) {
    this.elements.splice(1);
    const attr = (tag: string, name: string) =>
      tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] || '';
    const tagForClass = (className: string) =>
      html.match(
        new RegExp(`<[^>]+class="[^"]*${className}[^"]*"[^>]*>`),
      )?.[0] || '';
    const add = (tagName: string, id: string, className: string, tag = '') => {
      const element = new FakeElement(this, tagName, id, className);
      for (const name of [
        'aria-hidden',
        'aria-controls',
        'aria-expanded',
        'aria-label',
      ]) {
        const value = attr(tag, name);
        if (value) element.setAttribute(name, value);
      }
      if (/\sinert(?:\s|>)/.test(tag)) element.toggleAttribute('inert', true);
      this.elements.push(element);
      return element;
    };

    const shellTag = tagForClass('focus-stack-shell');
    const shell = add('DIV', '', 'app focus-stack-shell', shellTag);
    shell.dataset.workspaceMode = attr(shellTag, 'data-workspace-mode');
    shell.dataset.workspaceSection = attr(shellTag, 'data-workspace-section');
    add(
      'NAV',
      '',
      'sidebar focus-stack-context',
      tagForClass('focus-stack-context'),
    );
    add('DIV', 'sidebar-resize-handle', 'sidebar-resize-handle');
    add('DIV', 'page-content', '');
    add('DIV', 'metrics-bar', 'metrics-bar');
    add('DIV', 'alerts-bar', '');
    add('DIV', '', 'more-overlay', tagForClass('more-overlay'));
    add('DIV', 'more-drawer', 'more-drawer', tagForClass('more-drawer'));
    add('BUTTON', '', 'more-close', tagForClass('more-close'));
    add('BUTTON', '', 'focus-stack-more', tagForClass('focus-stack-more'));
    add(
      'BUTTON',
      '',
      'focus-stack-inspector-trigger',
      tagForClass('focus-stack-inspector-trigger'),
    );
    add(
      'ASIDE',
      'workspace-inspector',
      'focus-stack-inspector',
      tagForClass('focus-stack-inspector'),
    );
    add(
      'BUTTON',
      '',
      'focus-stack-inspector-close',
      tagForClass('focus-stack-inspector-close'),
    );
  }

  mountPage(html: string) {
    this.elements.splice(
      1,
      this.elements.length - 1,
      ...this.elements
        .slice(1)
        .filter((element) => element.dataset.pageMount !== 'true'),
    );
    const buttonPattern = /<button\b[^>]*>Open More<\/button>/g;
    for (const buttonTag of html.match(buttonPattern) || []) {
      const attr = (name: string) =>
        buttonTag.match(new RegExp(`${name}="([^"]*)"`))?.[1] || '';
      const button = new FakeElement(this, 'BUTTON', '', attr('class'));
      button.dataset.pageMount = 'true';
      button.textContent = 'Open More';
      for (const name of ['onclick', 'aria-controls', 'aria-expanded']) {
        const value = attr(name);
        if (value) button.setAttribute(name, value);
      }
      this.elements.push(button);
    }
  }
}

type ShellHarness = {
  app: FakeElement;
  document: FakeDocument;
  showShell(pageId: string): void;
  parseProjectChatHash(hash: string): {
    isProjectChatRoute: boolean;
    projectId: string;
    threadId: string;
  } | null;
  toggleInspector(trigger?: FakeElement): void;
  toggleMore(trigger?: FakeElement): void;
  activateInlineMore(trigger: FakeElement): void;
  closeMore(): void;
};

function loadShellHarness(initialHash = '', persistedMode = ''): ShellHarness {
  const document = new FakeDocument();
  const storageValues = new Map<string, string>();
  if (persistedMode) storageValues.set('active_mode', persistedMode);
  const storage = {
    getItem: (key: string) => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => storageValues.set(key, value),
    removeItem: (key: string) => storageValues.delete(key),
  };
  const response = (data: unknown, ok = true) => ({
    status: ok ? 200 : 503,
    ok,
    headers: { get: () => null },
    json: async () => data,
  });
  const fetchMock = (input: unknown) => {
    const url = String(input);
    if (url === '/api/auth/check') return new Promise(() => {});
    if (url === '/api/sessions/cockpit') {
      return Promise.resolve(response({ error: 'unavailable' }, false));
    }
    if (url === '/api/system/dashboard') {
      return Promise.resolve(
        response({
          channels: [],
          containers: [],
          groups: [],
          messages: [],
          daily: [],
        }),
      );
    }
    if (url === '/api/projects') {
      return Promise.resolve(response({ projects: [] }));
    }
    return Promise.resolve(response([]));
  };
  const context: Record<string, unknown> = {
    console,
    document,
    location: { hash: initialHash, protocol: 'http:', host: 'localhost' },
    navigator: {},
    localStorage: storage,
    sessionStorage: storage,
    fetch: fetchMock,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    Element: FakeElement,
    Notification: { permission: 'denied' },
    NanoShared: {
      esc: (value: unknown) => String(value ?? ''),
    },
    NanoFeedback: {
      toast: () => {},
      copyTextWithFallback: async () => true,
    },
    NanoShell: {
      renderShellLoadingState: () =>
        '<div class="shell-loading-state">Loading</div>',
      renderTabs: () => '',
    },
    NanoDataHealth: {
      loadPluginsList: async () => [],
      renderAlerts: () => '',
    },
    NanoRecovery: {
      renderPageError: () => {},
      renderNotFoundPage: () => {},
    },
    NanoProviderParity: {},
    NanoRoutineStates: {},
    NanoFileVaultStates: {},
    _pluginsList: [],
    _userRole: 'owner',
    _editionShort: 'NanoCrab',
  };
  context.window = context;
  vm.createContext(context);
  for (const scriptPath of scriptPaths) {
    vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), context);
  }

  const toggleMore = context.toggleMoreDrawer as (
    trigger?: FakeElement,
  ) => void;
  return {
    app: document.app,
    document,
    showShell: context.showShell as (pageId: string) => void,
    parseProjectChatHash:
      context.parseProjectChatHash as ShellHarness['parseProjectChatHash'],
    toggleInspector: context.toggleWorkspaceInspector as (
      trigger?: FakeElement,
    ) => void,
    toggleMore,
    activateInlineMore: (trigger) => {
      const handler = trigger.getAttribute('onclick');
      if (handler === 'toggleMoreDrawer(this)') toggleMore(trigger);
      else if (handler === 'toggleMoreDrawer()') toggleMore();
      else throw new Error(`Unexpected inline More handler: ${handler}`);
    },
    closeMore: context.closeMoreDrawer as () => void,
  };
}

function markupSection(markup: string, start: string, end: string) {
  const startIndex = markup.indexOf(start);
  return markup.slice(startIndex, markup.indexOf(end, startIndex));
}

describe('Focus Stack executable shell integration', () => {
  it('closes the non-modal inspector from global Escape after focus moves outside', () => {
    const harness = loadShellHarness('#/reports');
    harness.showShell('reports');
    const trigger = harness.document.querySelector(
      '.focus-stack-inspector-trigger',
    );
    const outside = harness.document.querySelector('.focus-stack-more');
    const inspector = harness.document.getElementById('workspace-inspector');

    harness.toggleInspector(trigger || undefined);
    outside?.focus();
    harness.document.dispatch('keydown', {
      key: 'Escape',
      preventDefault() {},
    });

    expect(inspector?.classList.contains('is-open')).toBe(false);
    expect(inspector?.hasAttribute('inert')).toBe(true);
    expect(inspector?.getAttribute('aria-hidden')).toBe('true');
    expect(harness.document.activeElement).toBe(trigger);
    const listenerCount = harness.document.listenerCount('keydown');
    expect(listenerCount).toBeGreaterThan(0);
    harness.showShell('reports');
    expect(harness.document.listenerCount('keydown')).toBe(listenerCount);
  });

  it('uses Code for a direct Sessions route without a persisted mode', () => {
    const harness = loadShellHarness('#/sessions');

    harness.showShell('sessions');

    const shell = harness.document.querySelector('.focus-stack-shell');
    expect(shell?.dataset.workspaceMode).toBe('code');
    expect(shell?.dataset.workspaceSection).toBe('session');
  });

  it('preserves an explicitly persisted workspace mode for Sessions', () => {
    const harness = loadShellHarness('#/sessions', 'cowork');

    harness.showShell('sessions');

    const shell = harness.document.querySelector('.focus-stack-shell');
    expect(shell?.dataset.workspaceMode).toBe('cowork');
    expect(shell?.dataset.workspaceSection).toBe('session');
  });

  it('preserves the exact durable project chat hash in its active Cowork link', () => {
    const durableHash = '#/projects/project%2Fdelta/chat/web%3Athread-17';
    const harness = loadShellHarness(durableHash);

    harness.showShell('project-chat');

    const shell = harness.document.querySelector('.focus-stack-shell');
    const context = harness.document.querySelector('.focus-stack-context');
    const railMarkup = markupSection(
      harness.app.innerHTML,
      '<nav class="focus-stack-rail"',
      '</nav>',
    );
    const mobileMarkup = markupSection(
      harness.app.innerHTML,
      '<div class="bottom-tabs">',
      '</nav>',
    );
    const mobileMenuMarkup = markupSection(
      harness.app.innerHTML,
      '<div class="mobile-menu"',
      '<div class="mobile-section">',
    );
    const contextMarkup = markupSection(
      harness.app.innerHTML,
      '<nav class="sidebar focus-stack-context"',
      '</nav>',
    );

    expect(shell?.dataset.workspaceMode).toBe('cowork');
    expect(shell?.dataset.workspaceSection).toBe('conversation');
    expect(context?.getAttribute('aria-label')).toBe('Project work context');
    expect(mobileMenuMarkup).toContain(`href="${durableHash}"`);
    expect(contextMarkup).toContain(`href="${durableHash}"`);
    expect(harness.app.innerHTML).not.toContain('href="#/project-chat"');
    expect(harness.app.innerHTML).not.toContain("navigate('project-chat')");
    const parsed = harness.parseProjectChatHash(durableHash);
    expect(parsed?.projectId).toBe('project/delta');
    expect(parsed?.threadId).toBe('web:thread-17');
    expect(railMarkup.match(/<span>More<\/span>/g)).toHaveLength(1);
    expect(mobileMarkup.match(/<button class="bottom-tab/g)).toHaveLength(4);
    expect(mobileMarkup.match(/<span>More<\/span>/g)).toHaveLength(1);
  });

  it('omits a synthetic project chat link when no durable nested hash exists', () => {
    const harness = loadShellHarness();

    harness.showShell('project-chat');

    expect(harness.app.innerHTML).not.toContain('href="#/project-chat"');
    expect(harness.app.innerHTML).not.toContain("navigate('project-chat')");
  });

  it('keeps inspector and More mutually exclusive with deterministic focus return', () => {
    const harness = loadShellHarness();
    harness.showShell('project-chat');

    const inspector = harness.document.getElementById('workspace-inspector')!;
    const drawer = harness.document.getElementById('more-drawer')!;
    const inspectorTrigger = harness.document.querySelector(
      '.focus-stack-inspector-trigger',
    )!;
    const inspectorClose = harness.document.querySelector(
      '.focus-stack-inspector-close',
    )!;
    const moreTrigger = harness.document.querySelector('.focus-stack-more')!;
    const moreClose = harness.document.querySelector('.more-close')!;

    harness.toggleInspector(inspectorTrigger);
    expect(inspector.classList.contains('is-open')).toBe(true);
    expect(inspector.hasAttribute('inert')).toBe(false);
    expect(inspector.getAttribute('aria-hidden')).toBe('false');
    expect(inspectorTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(harness.document.activeElement).toBe(inspectorClose);

    harness.toggleMore(moreTrigger);
    expect(inspector.classList.contains('is-open')).toBe(false);
    expect(inspector.hasAttribute('inert')).toBe(true);
    expect(inspector.getAttribute('aria-hidden')).toBe('true');
    expect(inspectorTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(drawer.classList.contains('open')).toBe(true);
    expect(drawer.hasAttribute('inert')).toBe(false);
    expect(drawer.getAttribute('aria-hidden')).toBe('false');
    expect(moreTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(harness.document.activeElement).toBe(moreClose);
    expect(inspectorTrigger.focusCount).toBe(0);

    harness.toggleMore(moreTrigger);
    expect(drawer.classList.contains('open')).toBe(false);
    expect(drawer.hasAttribute('inert')).toBe(true);
    expect(drawer.getAttribute('aria-hidden')).toBe('true');
    expect(moreTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(harness.document.activeElement).toBe(moreTrigger);

    harness.toggleMore(moreTrigger);
    const moreFocusCount = moreTrigger.focusCount;
    harness.toggleInspector(inspectorTrigger);
    expect(drawer.classList.contains('open')).toBe(false);
    expect(drawer.hasAttribute('inert')).toBe(true);
    expect(moreTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(moreTrigger.focusCount).toBe(moreFocusCount);
    expect(inspector.classList.contains('is-open')).toBe(true);
    expect(harness.document.activeElement).toBe(inspectorClose);

    let prevented = false;
    harness.document.dispatch('keydown', {
      key: 'Escape',
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(inspector.classList.contains('is-open')).toBe(false);
    expect(inspector.hasAttribute('inert')).toBe(true);
    expect(harness.document.activeElement).toBe(inspectorTrigger);
  });

  it('restores focus and synchronizes ARIA for both Today inline More actions', async () => {
    const harness = loadShellHarness();
    harness.showShell('dashboard');
    await new Promise((resolve) => setImmediate(resolve));

    const todayMoreButtons = harness.document.elements.filter(
      (element) => element.textContent === 'Open More',
    );
    const todayMore = todayMoreButtons[0];
    const inspector = harness.document.getElementById('workspace-inspector')!;
    const drawer = harness.document.getElementById('more-drawer')!;
    const inspectorTrigger = harness.document.querySelector(
      '.focus-stack-inspector-trigger',
    )!;
    const moreClose = harness.document.querySelector('.more-close')!;

    expect(todayMoreButtons).toHaveLength(2);
    harness.toggleInspector(inspectorTrigger);
    todayMore.focus();
    harness.activateInlineMore(todayMore);

    expect(inspector.classList.contains('is-open')).toBe(false);
    expect(inspector.hasAttribute('inert')).toBe(true);
    expect(inspectorTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(drawer.classList.contains('open')).toBe(true);
    expect(drawer.hasAttribute('inert')).toBe(false);
    expect(harness.document.activeElement).toBe(moreClose);
    for (const button of todayMoreButtons) {
      expect(button.getAttribute('aria-expanded')).toBe('true');
    }

    harness.closeMore();

    expect(drawer.classList.contains('open')).toBe(false);
    expect(drawer.hasAttribute('inert')).toBe(true);
    expect(harness.document.activeElement).toBe(todayMore);
    for (const button of todayMoreButtons) {
      expect(button.getAttribute('onclick')).toBe('toggleMoreDrawer(this)');
      expect(button.getAttribute('aria-controls')).toBe('more-drawer');
      expect(button.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('synchronizes Today More controls that mount after the drawer opens', async () => {
    const harness = loadShellHarness();
    harness.showShell('dashboard');

    const drawer = harness.document.getElementById('more-drawer')!;
    const shellMore = harness.document.querySelector('.focus-stack-more')!;

    harness.toggleMore(shellMore);
    expect(drawer.classList.contains('open')).toBe(true);

    await new Promise((resolve) => setImmediate(resolve));

    const todayMoreButtons = harness.document.elements.filter(
      (element) => element.textContent === 'Open More',
    );
    expect(todayMoreButtons).toHaveLength(2);
    for (const button of todayMoreButtons) {
      expect(button.getAttribute('aria-controls')).toBe('more-drawer');
      expect(button.getAttribute('aria-expanded')).toBe('true');
    }
  });
});
