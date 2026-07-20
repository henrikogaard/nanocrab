import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const qaScriptPath = path.join(process.cwd(), 'scripts/admin-workspace-qa.mjs');

function qaScriptSource() {
  return fs.readFileSync(qaScriptPath, 'utf8');
}

describe('Focus Stack rendered QA contract', () => {
  it('audits the exact direct routes with their route-derived mode and section', () => {
    const source = qaScriptSource();
    const routes = [
      ['dashboard', '#/dashboard', 'today', 'overview'],
      ['reports', '#/reports', 'cowork', 'report'],
      ['source-collections', '#/source-collections', 'cowork', 'source'],
      ['tasks', '#/tasks', 'cowork', 'routine'],
      ['sessions', '#/sessions', 'code', 'session'],
      ['devhub', '#/devhub', 'code', 'terminal'],
      ['security', '#/security', 'more', 'security'],
    ];

    for (const [name, hash, mode, section] of routes) {
      expect(source).toMatch(
        new RegExp(
          `\\{\\s*name: '${name}',\\s*hash: '${hash}',\\s*mode: '${mode}',\\s*section: '${section}',?\\s*\\}`,
        ),
      );
    }
  });

  it('covers desktop, the 768px tablet boundary, and the 390px mobile viewport', () => {
    const source = qaScriptSource();

    expect(source).toContain(`{ name: 'desktop', width: 1440, height: 1000 }`);
    expect(source).toContain(`{ name: 'tablet', width: 768, height: 1000 }`);
    expect(source).toContain(`{ name: 'mobile', width: 390, height: 844 }`);
  });

  it('records the route, landmark, overflow, accessibility, selection, layout, error, interaction, screenshot, and summary evidence', () => {
    const source = qaScriptSource();

    for (const contractMarker of [
      'data-workspace-mode',
      'data-workspace-section',
      'visibleMainCount',
      'documentOverflowPx',
      'unnamedVisibleControls',
      'selectedWorkspaceControl',
      'layoutIssues',
      "page.on('pageerror'",
      "page.on('console'",
      'exerciseInspector',
      'exerciseMoreDrawer',
      'keyboardReachability',
      'mobileBottomBarActionCount',
      'ADMIN_QA_SCREENSHOT_ROOT',
      'summary.json',
    ]) {
      expect(source).toContain(contractMarker);
    }
  });

  it('waits for a rendered shell before recording mode mismatches as evidence', () => {
    const source = qaScriptSource();
    const waitBlock = source.slice(
      source.indexOf('async function waitForWorkspace'),
      source.indexOf('async function unnamedVisibleControls'),
    );

    expect(waitBlock).not.toContain("getAttribute('data-workspace-mode')");
    expect(waitBlock).not.toContain("getAttribute('data-workspace-section')");
    expect(source).toContain('await waitForWorkspace(page);');
  });

  it('reaches the inspector and More triggers through natural keyboard navigation', () => {
    const source = qaScriptSource();
    const interactionBlock = source.slice(
      source.indexOf('async function exerciseInspector'),
      source.indexOf('async function runRouteCase'),
    );

    expect(source).toContain('async function tabToTarget');
    expect(interactionBlock).toContain(
      'await tabToTarget(page, inspectorTrigger)',
    );
    expect(interactionBlock).toContain('await tabToTarget(page, moreTrigger)');
    expect(interactionBlock).not.toContain('await inspectorTrigger.focus()');
    expect(interactionBlock).not.toContain('await moreTrigger.focus()');
  });

  it('rejects a More state whose focused controls are obscured or outside the viewport', () => {
    const source = qaScriptSource();
    const moreBlock = source.slice(
      source.indexOf('async function exerciseMoreDrawer'),
      source.indexOf('async function runRouteCase'),
    );

    for (const contractMarker of [
      "matches(':focus-visible')",
      'elementFromPoint',
      'openStateUnnamedControls',
      'openStateDocumentOverflowPx',
      'drawerGeometry',
      'headerGeometry',
      'bodyGeometry',
      'lastControlGeometry',
      'overlayTopmost',
      'closeTopmost',
      'lowerEdgeTopmost',
      'focusIndicatorVisible',
      'modalFocusLoop',
      'lastFocusableOnBackwardTab',
      'focusLoopedToClose',
      "page.keyboard.press('Escape')",
    ]) {
      expect(moreBlock).toContain(contractMarker);
    }
  });
});
