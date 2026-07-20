import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const qaScriptPath = path.join(process.cwd(), 'scripts/admin-workspace-qa.mjs');
const durableSummaryPath = path.join(
  process.cwd(),
  'docs/audits/2026-07-20-focus-stack-qa/summary.json',
);

function qaScriptSource() {
  return fs.readFileSync(qaScriptPath, 'utf8');
}

type QaServerHelpers = {
  selectAvailablePort(): Promise<number>;
  waitForSpawnedServer(
    child: EventEmitter & { stdout: EventEmitter },
    expectedUrl: string,
    timeoutMs?: number,
  ): Promise<void>;
};

async function loadServerHelpers(): Promise<QaServerHelpers> {
  const helperPath = pathToFileURL(
    path.join(process.cwd(), 'scripts/admin-workspace-qa-server.mjs'),
  ).href;
  return (await import(helperPath)) as QaServerHelpers;
}

function fakeQaServerChild() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
  });
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

  it('exercises scoped Chat progress, promotion handoff, and terminal recovery states at desktop and mobile widths', () => {
    const source = qaScriptSource();

    for (const contractMarker of [
      'async function exerciseChatRunFlow',
      'async function exercisePromotionHandoff',
      'async function exerciseTerminalSessionStates',
      "name: 'desktop'",
      "name: 'mobile'",
      '#/chat',
      '#/terminal',
      '#thread-run-strip',
      '.work-session-run-strip',
      'data-work-session-promotion',
      '#terminal-session-state',
      'data-terminal-state',
      "'loading'",
      "'ready'",
      "'reconnecting'",
      "'unavailable'",
      "'interrupted'",
      'Resume',
      'chat-run-before-progress',
      'chat-run-progress-active',
      'promotion-handoff',
      'terminal-session-',
    ]) {
      expect(source).toContain(contractMarker);
    }

    expect(source).toContain('await exerciseChatRunFlow(page, viewport');
    expect(source).toContain(
      'record.promotion = await exercisePromotionHandoff(',
    );
    expect(source).toContain('await exerciseTerminalSessionStates(');
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

  it('requires associated labels instead of accepting placeholder hints as names', () => {
    const source = qaScriptSource();
    const nameAudit = source.slice(
      source.indexOf('async function unnamedVisibleControls'),
      source.indexOf('async function keyboardReachability'),
    );

    expect(nameAudit).toContain("element.getAttribute('aria-label')");
    expect(nameAudit).toContain("element.getAttribute('aria-labelledby')");
    expect(nameAudit).toContain('element.labels');
    expect(nameAudit).not.toContain("element.getAttribute('placeholder')");
  });

  it('requires the visible Today control to expose current and active state at every viewport', () => {
    const source = qaScriptSource();
    const selectionAudit = source.slice(
      source.indexOf('async function selectedWorkspaceControl'),
      source.indexOf('async function layoutIssues'),
    );

    expect(selectionAudit).toContain('visibleTodayControls');
    expect(selectionAudit).toContain("getAttribute('aria-current')");
    expect(selectionAudit).toContain("classList.contains('active')");
    expect(selectionAudit).toContain('visibleTodayControlCount');
    expect(selectionAudit).not.toContain(
      'Desktop Today control is not current',
    );
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
      'minimumCloseTargetPx',
      'closeMeetsMinimumTarget',
      "page.keyboard.press('Escape')",
    ]) {
      expect(moreBlock).toContain(contractMarker);
    }
  });

  it('moves focus outside the non-modal inspector before testing global Escape dismissal', () => {
    const source = qaScriptSource();
    const inspectorBlock = source.slice(
      source.indexOf('async function exerciseInspector'),
      source.indexOf('async function exerciseMoreDrawer'),
    );

    expect(inspectorBlock).toContain('focusMovedOutsideInspector');
    expect(inspectorBlock).toContain('tabOutsideInspector');
    expect(inspectorBlock).toContain("page.keyboard.press('Escape')");
    expect(inspectorBlock).toContain('focusReturned');
  });

  it('proves global alerts stay visible outside Inspector and collapse when empty', () => {
    const source = qaScriptSource();
    const alertsBlock = source.slice(
      source.indexOf('async function exerciseGlobalAlerts'),
      source.indexOf('async function exerciseInspector'),
    );

    for (const contractMarker of [
      "closest('#workspace-inspector')",
      "getAttribute('role')",
      "getAttribute('aria-live')",
      "getAttribute('aria-atomic')",
      'activeAlertCount',
      'activeVisible',
      'inspectorClosed',
      'overlapsPageContent',
      'overlapsMobileControls',
      "page.route('**/api/system/alerts'",
      'window.loadAlerts',
      'emptyAlertCount',
      'emptyDisplay',
      'emptyHeight',
      'pageContentVisible',
    ]) {
      expect(alertsBlock).toContain(contractMarker);
    }
    expect(source).toContain('await exerciseGlobalAlerts(page)');
  });

  it('uses a dynamic default port and waits for its spawned child to announce readiness', () => {
    const source = qaScriptSource();

    expect(source).toContain('selectAvailablePort');
    expect(source).toContain('waitForSpawnedServer');
    expect(source).toContain('process.env.MOCK_ADMIN_PORT');
    expect(source).toContain('process.env.ADMIN_QA_BASE_URL');
    expect(source).not.toContain('|| 5187');
  });

  it('selects and releases a dynamically available localhost port', async () => {
    const { selectAvailablePort } = await loadServerHelpers();
    const port = await selectAvailablePort();
    const server = net.createServer();

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('rejects when the spawned child exits before announcing its listener', async () => {
    const { waitForSpawnedServer } = await loadServerHelpers();
    const child = fakeQaServerChild();
    const ready = waitForSpawnedServer(child, 'http://127.0.0.1:54321', 100);

    child.emit('exit', 1, null);

    await expect(ready).rejects.toThrow('exited before announcing');
  });

  it('resolves only after the spawned child announces the expected URL', async () => {
    const { waitForSpawnedServer } = await loadServerHelpers();
    const child = fakeQaServerChild();
    const ready = waitForSpawnedServer(child, 'http://127.0.0.1:54321', 100);

    child.stdout.emit('data', Buffer.from('ready http://127.0.0.1:54321\n'));

    await expect(ready).resolves.toBeUndefined();
  });

  it('keeps the committed summary portable and all referenced screenshots durable', () => {
    const summary = JSON.parse(fs.readFileSync(durableSummaryPath, 'utf8'));
    const evidenceRoot = path.dirname(durableSummaryPath);
    const referencedPaths = [
      ...summary.screenshots,
      ...summary.cases.map(
        (entry: { screenshotPath: string }) => entry.screenshotPath,
      ),
      ...summary.interactions.flatMap(
        (entry: {
          inspector: { screenshotPath: string };
          more: { screenshotPath: string };
        }) => [entry.inspector.screenshotPath, entry.more.screenshotPath],
      ),
    ];

    expect(summary.screenshotRoot).toBe('.');
    expect(summary.summaryPath).toBe('summary.json');
    for (const evidencePath of new Set(referencedPaths)) {
      expect(path.isAbsolute(evidencePath)).toBe(false);
      expect(fs.existsSync(path.join(evidenceRoot, evidencePath))).toBe(true);
    }
  });
});
