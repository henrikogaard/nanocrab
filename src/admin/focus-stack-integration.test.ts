import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as vm from 'node:vm';

const publicRoot = path.join(process.cwd(), 'src/admin/public');
const scriptPaths = [
  path.join(publicRoot, 'modes.js'),
  path.join(publicRoot, 'ui/shell-navigation.js'),
  path.join(publicRoot, 'ui/workspace-shell.js'),
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

  addEventListener() {}

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
}

type ShellHarness = {
  app: FakeElement;
  document: FakeDocument;
  showShell(pageId: string): void;
  toggleInspector(trigger?: FakeElement): void;
  toggleMore(trigger?: FakeElement): void;
};

function loadShellHarness(): ShellHarness {
  const document = new FakeDocument();
  const storageValues = new Map<string, string>();
  const storage = {
    getItem: (key: string) => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => storageValues.set(key, value),
    removeItem: (key: string) => storageValues.delete(key),
  };
  const context: Record<string, unknown> = {
    console,
    document,
    location: { hash: '', protocol: 'http:', host: 'localhost' },
    navigator: {},
    localStorage: storage,
    sessionStorage: storage,
    fetch: () => new Promise(() => {}),
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

  return {
    app: document.app,
    document,
    showShell: context.showShell as (pageId: string) => void,
    toggleInspector: context.toggleWorkspaceInspector as (
      trigger?: FakeElement,
    ) => void,
    toggleMore: context.toggleMoreDrawer as (trigger?: FakeElement) => void,
  };
}

function markupSection(markup: string, start: string, end: string) {
  const startIndex = markup.indexOf(start);
  return markup.slice(startIndex, markup.indexOf(end, startIndex));
}

describe('Focus Stack executable shell integration', () => {
  it('renders project chat in Cowork with route data and stable mode actions', () => {
    const harness = loadShellHarness();

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

    expect(shell?.dataset.workspaceMode).toBe('cowork');
    expect(shell?.dataset.workspaceSection).toBe('conversation');
    expect(context?.getAttribute('aria-label')).toBe('Project work context');
    expect(harness.app.innerHTML).toContain('href="#/project-chat"');
    expect(railMarkup.match(/<span>More<\/span>/g)).toHaveLength(1);
    expect(mobileMarkup.match(/<button class="bottom-tab/g)).toHaveLength(4);
    expect(mobileMarkup.match(/<span>More<\/span>/g)).toHaveLength(1);
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
    inspector.dispatch('keydown', {
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
});
