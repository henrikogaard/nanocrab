import { describe, expect, it } from 'vitest';
import fs from 'fs';
import * as vm from 'node:vm';
import path from 'path';

const workspaceShellPath = path.join(
  process.cwd(),
  'src/admin/public/ui/workspace-shell.js',
);
const modesPath = path.join(process.cwd(), 'src/admin/public/modes.js');

type WorkspaceShell = {
  ROUTES: Record<string, readonly [string, string]>;
  resolveRoute(
    pageId: string,
    preferredMode?: string,
  ): {
    pageId: string;
    mode: string;
    section: string;
    isToday: boolean;
  };
  renderNextAction(model?: Record<string, unknown>): string;
  renderWorkspaceState(model?: Record<string, unknown>): string;
};

function loadWorkspaceShell() {
  const context = {
    window: {
      NanoModes: {
        MODE_ORDER: ['chat', 'cowork', 'code', 'more'],
      },
      NanoShellNavigation: {
        PAGE_META: {
          approvals: { label: 'Approvals', icon: 'approvals' },
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(workspaceShellPath, 'utf8'), context);
  return (
    context.window as typeof context.window & {
      NanoWorkspaceShell: WorkspaceShell;
    }
  ).NanoWorkspaceShell;
}

function loadWorkspaceRuntime() {
  const context: {
    window: { NanoModes?: unknown };
    NanoModes?: unknown;
  } = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(modesPath, 'utf8'), context);
  context.window.NanoModes = context.NanoModes;
  vm.runInContext(fs.readFileSync(workspaceShellPath, 'utf8'), context);
  return {
    ...context.window,
    NanoModes: context.NanoModes,
  } as typeof context.window & {
    NanoModes: {
      modePageIds(): string[];
      resolveMode(pageId: string): string | null;
    };
    NanoWorkspaceShell: WorkspaceShell;
  };
}

describe('Focus Stack route context', () => {
  it.each([
    ['dashboard', 'today', 'overview', true],
    ['chat', 'chat', 'conversation', false],
    ['projects', 'cowork', 'project', false],
    ['project-chat', 'cowork', 'conversation', false],
    ['reports', 'cowork', 'report', false],
    ['source-collections', 'cowork', 'source', false],
    ['tasks', 'cowork', 'routine', false],
    ['workflows', 'cowork', 'workflow', false],
    ['artifacts', 'cowork', 'artifact', false],
    ['approvals', 'cowork', 'approval', false],
    ['gitcode', 'code', 'repository', false],
    ['devhub', 'code', 'terminal', false],
    ['autofix', 'code', 'automation', false],
    ['copilot', 'code', 'delegation', false],
    ['sessions', 'code', 'session', false],
    ['session-detail', 'code', 'session', false],
    ['security', 'more', 'security', false],
    ['audit', 'more', 'audit', false],
    ['settings', 'more', 'settings', false],
  ])(
    'resolves %s into its stable workspace context',
    (pageId, mode, section, isToday) => {
      expect(loadWorkspaceShell().resolveRoute(pageId)).toEqual({
        pageId,
        mode,
        section,
        isToday,
      });
    },
  );

  it.each(['chat', 'cowork', 'code'])(
    'preserves an explicit %s preference for session routes',
    (preferredMode) => {
      const shell = loadWorkspaceShell();

      expect(shell.resolveRoute('sessions', preferredMode).mode).toBe(
        preferredMode,
      );
      expect(shell.resolveRoute('session-detail', preferredMode).mode).toBe(
        preferredMode,
      );
    },
  );

  it('rejects non-workspace session preferences and fails unknown pages into More', () => {
    const shell = loadWorkspaceShell();

    expect(shell.resolveRoute('sessions', 'more')).toEqual({
      pageId: 'sessions',
      mode: 'code',
      section: 'session',
      isToday: false,
    });
    expect(shell.resolveRoute('future-tool', 'chat')).toEqual({
      pageId: 'future-tool',
      mode: 'more',
      section: 'tool',
      isToday: false,
    });
    expect(shell.resolveRoute('__proto__')).toEqual({
      pageId: '__proto__',
      mode: 'more',
      section: 'tool',
      isToday: false,
    });
  });

  it('exposes immutable route metadata', () => {
    const shell = loadWorkspaceShell();

    expect(Object.isFrozen(shell.ROUTES)).toBe(true);
    expect(
      Object.values(shell.ROUTES).every((route) => Object.isFrozen(route)),
    ).toBe(true);
  });

  it('covers every current mode-owned page with the same resolver mode', () => {
    const runtime = loadWorkspaceRuntime();

    for (const pageId of runtime.NanoModes.modePageIds()) {
      expect(runtime.NanoWorkspaceShell.ROUTES[pageId]).toBeDefined();
      expect(runtime.NanoWorkspaceShell.resolveRoute(pageId).mode).toBe(
        runtime.NanoModes.resolveMode(pageId),
      );
    }
  });
});

describe('Focus Stack presentation helpers', () => {
  it('renders an escaped next action with route metadata', () => {
    const markup = loadWorkspaceShell().renderNextAction({
      pageId: 'approvals" onclick="alert(1)',
      title: 'Review <approval>',
      detail: 'Confirm owner & scope',
      actionLabel: 'Open >',
    });

    expect(markup).toContain('class="focus-next-action"');
    expect(markup).toContain(
      'data-page-id="approvals&quot; onclick=&quot;alert(1)"',
    );
    expect(markup).toContain('Review &lt;approval&gt;');
    expect(markup).toContain('Confirm owner &amp; scope');
    expect(markup).toContain('Open &gt;');
    expect(markup).not.toContain('<approval>');
    expect(markup).not.toContain('data-page-id="approvals" onclick=');
  });

  it('uses page metadata for the default action label', () => {
    const markup = loadWorkspaceShell().renderNextAction({
      pageId: 'approvals',
      title: 'Review pending decision',
    });

    expect(markup).toContain('Open Approvals');
  });

  it('renders an escaped workspace state and constrains its visual status', () => {
    const shell = loadWorkspaceShell();
    const markup = shell.renderWorkspaceState({
      status: 'blocked" onmouseover="alert(1)',
      label: 'Workspace <state>',
      title: 'Waiting on "review"',
      detail: 'Owner & scope required',
      nextAction: {
        pageId: 'approvals',
        title: 'Review <now>',
      },
    });

    expect(markup).toContain(
      'class="focus-workspace-state is-neutral" data-state="neutral"',
    );
    expect(markup).toContain('Workspace &lt;state&gt;');
    expect(markup).toContain('Waiting on &quot;review&quot;');
    expect(markup).toContain('Owner &amp; scope required');
    expect(markup).toContain('Review &lt;now&gt;');
    expect(markup).not.toContain('onmouseover=');
  });

  it('returns no next-action markup when no action model is provided', () => {
    expect(loadWorkspaceShell().renderNextAction()).toBe('');
  });
});
