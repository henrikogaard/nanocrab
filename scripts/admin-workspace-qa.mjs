#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const repoRoot = process.cwd();
const port = Number(process.env.MOCK_ADMIN_PORT || 5187);
const baseUrl = process.env.ADMIN_QA_BASE_URL || `http://127.0.0.1:${port}`;
const screenshotRoot = path.resolve(
  process.env.ADMIN_QA_SCREENSHOT_ROOT ||
    path.join(
      repoRoot,
      'artifacts',
      'admin-workspace-qa',
      new Date().toISOString().replace(/[:.]/g, '-'),
    ),
);

const routes = [
  {
    name: 'dashboard',
    hash: '#/dashboard',
    mode: 'today',
    section: 'overview',
  },
  { name: 'reports', hash: '#/reports', mode: 'cowork', section: 'report' },
  {
    name: 'source-collections',
    hash: '#/source-collections',
    mode: 'cowork',
    section: 'source',
  },
  { name: 'tasks', hash: '#/tasks', mode: 'cowork', section: 'routine' },
  { name: 'sessions', hash: '#/sessions', mode: 'code', section: 'session' },
  { name: 'devhub', hash: '#/devhub', mode: 'code', section: 'terminal' },
  { name: 'security', hash: '#/security', mode: 'more', section: 'security' },
];

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 768, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The mock server is still starting.
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startMockServer() {
  if (process.env.ADMIN_QA_BASE_URL) return null;
  const child = spawn('npm', ['run', 'mock:admin'], {
    cwd: repoRoot,
    env: { ...process.env, MOCK_ADMIN_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitForWorkspace(page) {
  await page.waitForSelector('.focus-stack-shell', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const shell = document.querySelector('.focus-stack-shell');
      const content = document.getElementById('page-content');
      if (!shell || !content || !content.firstElementChild) return false;
      if (!shell.dataset.workspaceMode || !shell.dataset.workspaceSection)
        return false;
      return !content.querySelector(
        '.shell-loading-state, .dashboard-loading-grid',
      );
    },
    undefined,
    { timeout: 20000 },
  );
  await page.waitForTimeout(150);
}

async function unnamedVisibleControls(page) {
  return page
    .locator(
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])',
    )
    .evaluateAll((controls) => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || 1) > 0
        );
      };
      const referencedText = (value) =>
        String(value || '')
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() || '')
          .filter(Boolean)
          .join(' ');
      const labelText = (element) => {
        const labelledBy = referencedText(
          element.getAttribute('aria-labelledby'),
        );
        const labels = Array.from(element.labels || [])
          .map((label) => label.textContent?.trim() || '')
          .filter(Boolean)
          .join(' ');
        const tagName = element.tagName.toLowerCase();
        const role = element.getAttribute('role');
        const type = element.getAttribute('type');
        const textEligible =
          tagName === 'button' || tagName === 'a' || role === 'button';
        const valueEligible =
          tagName === 'input' && ['button', 'submit', 'reset'].includes(type);
        return (
          element.getAttribute('aria-label')?.trim() ||
          labelledBy ||
          labels ||
          (textEligible ? element.textContent?.trim() : '') ||
          (valueEligible ? element.value?.trim() : '') ||
          element.getAttribute('alt')?.trim() ||
          element.getAttribute('title')?.trim() ||
          element.getAttribute('placeholder')?.trim() ||
          ''
        );
      };

      return controls
        .filter(visible)
        .filter((element) => !labelText(element))
        .map((element) => ({
          tagName: element.tagName,
          id: element.id || '',
          className: String(element.className || ''),
          role: element.getAttribute('role') || '',
        }));
    });
}

async function keyboardReachability(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  const reached = [];
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || element === document.body)
        return null;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        descriptor:
          element.getAttribute('aria-label') ||
          element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ||
          element.id ||
          element.tagName,
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.bottom >= 0 &&
          rect.right >= 0 &&
          rect.top <= window.innerHeight &&
          rect.left <= window.innerWidth,
      };
    });
    if (!active) continue;
    reached.push(active);
    if (!active.visible) break;
  }
  const issue =
    reached.length === 0
      ? 'Tab did not reach a focusable control'
      : reached.some((entry) => !entry.visible)
        ? 'Tab reached a hidden or offscreen control'
        : '';
  return { reached, issue };
}

async function selectedWorkspaceControl(page, expectedMode) {
  return page.evaluate((mode) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    };
    const modeControls = Array.from(
      document.querySelectorAll(
        '.focus-stack-rail .mode-tab, .focus-stack-more, .bottom-tabs .bottom-tab',
      ),
    ).filter(visible);
    const selected = modeControls.filter(
      (element) => element.getAttribute('aria-pressed') === 'true',
    );
    const expectedLabel =
      mode === 'cowork'
        ? 'Cowork'
        : mode === 'code'
          ? 'Code'
          : mode === 'more'
            ? 'More'
            : 'Today';
    const issues = [];

    if (mode === 'today') {
      if (selected.length > 0)
        issues.push('Today must not select a persisted primary mode');
      const desktopHome = document.querySelector('.focus-stack-home');
      const mobileHome = document.querySelector('.mobile-brand');
      const visibleHome = [desktopHome, mobileHome].find(
        (element) => element && visible(element),
      );
      if (!visibleHome) issues.push('No visible Today control');
      if (
        visibleHome === desktopHome &&
        desktopHome.getAttribute('aria-current') !== 'page'
      ) {
        issues.push('Desktop Today control is not current');
      }
      return {
        expected: expectedLabel,
        selected: visibleHome
          ? visibleHome.getAttribute('aria-label') ||
            visibleHome.textContent?.trim() ||
            ''
          : '',
        selectedCount: selected.length,
        issues,
      };
    }

    if (selected.length !== 1)
      issues.push(`Expected one selected ${expectedLabel} control`);
    const selectedLabel = selected[0]?.textContent?.trim() || '';
    if (selected.length === 1 && selectedLabel !== expectedLabel) {
      issues.push(`Expected ${expectedLabel}, found ${selectedLabel}`);
    }
    return {
      expected: expectedLabel,
      selected: selectedLabel,
      selectedCount: selected.length,
      issues,
    };
  }, expectedMode);
}

async function layoutIssues(page) {
  return page.evaluate(() => {
    const visibleRect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        style.display === 'none' ||
        style.visibility === 'hidden'
      ) {
        return null;
      }
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const overlaps = (first, second) =>
      first.left < second.right - 1 &&
      first.right > second.left + 1 &&
      first.top < second.bottom - 1 &&
      first.bottom > second.top + 1;
    const issues = [];
    const canvas = visibleRect('.focus-stack-canvas');
    const content = visibleRect('#page-content');
    if (!canvas) return ['Primary workspace canvas is not visible'];
    if (!content) issues.push('Primary page content is not visible');
    if (canvas.left < -2 || canvas.right > window.innerWidth + 2) {
      issues.push('Primary workspace canvas extends beyond the viewport');
    }
    if (
      content &&
      (content.left < canvas.left - 2 || content.right > canvas.right + 2)
    ) {
      issues.push('Primary page content extends beyond its canvas');
    }
    for (const [name, selector] of [
      ['rail', '.focus-stack-rail'],
      ['context', '.focus-stack-context'],
      ['inspector', '.focus-stack-inspector'],
    ]) {
      const rect = visibleRect(selector);
      if (rect && overlaps(rect, canvas))
        issues.push(`${name} overlaps the primary workspace canvas`);
    }
    return issues;
  });
}

async function collectRouteEvidence(page, route, viewport) {
  const shell = page.locator('.focus-stack-shell');
  const dataWorkspaceMode = await shell.getAttribute('data-workspace-mode');
  const dataWorkspaceSection = await shell.getAttribute(
    'data-workspace-section',
  );
  const mainCount = await page.locator('main').count();
  const visibleMainCount = await page.locator('main').evaluateAll(
    (elements) =>
      elements.filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      }).length,
  );
  const documentOverflowPx = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  const unnamedControls = await unnamedVisibleControls(page);
  const selection = await selectedWorkspaceControl(page, route.mode);
  const shellLayoutIssues = await layoutIssues(page);
  const keyboard = await keyboardReachability(page);
  const mobileBottomBarActionCount = await page
    .locator('.bottom-tabs .bottom-tab')
    .evaluateAll(
      (elements) =>
        elements.filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        }).length,
    );
  const storedActiveMode = await page.evaluate(() =>
    window.localStorage.getItem('active_mode'),
  );
  const issues = [];

  if (dataWorkspaceMode !== route.mode)
    issues.push(`mode ${dataWorkspaceMode || 'missing'} != ${route.mode}`);
  if (dataWorkspaceSection !== route.section) {
    issues.push(
      `section ${dataWorkspaceSection || 'missing'} != ${route.section}`,
    );
  }
  if (mainCount !== 1 || visibleMainCount !== 1) {
    issues.push(
      `expected one runtime/visible main landmark, found ${mainCount}/${visibleMainCount}`,
    );
  }
  if (documentOverflowPx > 2)
    issues.push(`horizontal document overflow ${documentOverflowPx}px`);
  if (unnamedControls.length > 0) {
    issues.push(
      `${unnamedControls.length} visible control(s) lack accessible names`,
    );
  }
  issues.push(...selection.issues, ...shellLayoutIssues);
  if (keyboard.issue) issues.push(keyboard.issue);
  const expectedBottomBarActions = viewport.width <= 768 ? 4 : 0;
  if (mobileBottomBarActionCount !== expectedBottomBarActions) {
    issues.push(
      `mobile bottom bar action count ${mobileBottomBarActionCount} != ${expectedBottomBarActions}`,
    );
  }
  if (route.name === 'dashboard' && storedActiveMode !== null) {
    issues.push(`Today persisted unexpected mode ${storedActiveMode}`);
  }

  return {
    dataWorkspaceMode,
    dataWorkspaceSection,
    mainCount,
    visibleMainCount,
    documentOverflowPx,
    unnamedVisibleControls: unnamedControls,
    selectedWorkspaceControl: selection,
    layoutIssues: shellLayoutIssues,
    keyboardReachability: keyboard,
    mobileBottomBarActionCount,
    storedActiveMode,
    issues,
  };
}

async function firstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) return candidate;
  }
  return null;
}

async function exerciseInspector(page, screenshotPath = '') {
  const errors = [];
  const trigger = await firstVisible(
    page.locator('.focus-stack-inspector-trigger'),
  );
  if (!trigger) return { errors: ['Inspector trigger is not visible'] };

  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    document
      .getElementById('workspace-inspector')
      ?.classList.contains('is-open'),
  );
  const opened = await page.evaluate(() => {
    const inspector = document.getElementById('workspace-inspector');
    const trigger = document.querySelector('.focus-stack-inspector-trigger');
    return {
      ariaHidden: inspector?.getAttribute('aria-hidden'),
      inert: inspector?.hasAttribute('inert'),
      expanded: trigger?.getAttribute('aria-expanded'),
      focusOnClose: document.activeElement?.classList.contains(
        'focus-stack-inspector-close',
      ),
    };
  });
  if (opened.ariaHidden !== 'false' || opened.inert)
    errors.push('Inspector open state is not exposed to assistive technology');
  if (opened.expanded !== 'true')
    errors.push('Inspector trigger did not expose aria-expanded=true');
  if (!opened.focusOnClose)
    errors.push('Inspector did not move focus to its close control');
  if (screenshotPath) await page.screenshot({ path: screenshotPath });

  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () =>
      !document
        .getElementById('workspace-inspector')
        ?.classList.contains('is-open'),
  );
  const closed = await page.evaluate(() => {
    const inspector = document.getElementById('workspace-inspector');
    const trigger = document.querySelector('.focus-stack-inspector-trigger');
    return {
      ariaHidden: inspector?.getAttribute('aria-hidden'),
      inert: inspector?.hasAttribute('inert'),
      expanded: trigger?.getAttribute('aria-expanded'),
      focusReturned: document.activeElement === trigger,
    };
  });
  if (closed.ariaHidden !== 'true' || !closed.inert)
    errors.push('Inspector close state is not hidden/inert');
  if (closed.expanded !== 'false')
    errors.push('Inspector trigger did not reset aria-expanded=false');
  if (!closed.focusReturned)
    errors.push('Inspector did not return focus to its trigger');

  return { opened, closed, errors, screenshotPath };
}

async function exerciseMoreDrawer(page, screenshotPath = '') {
  const errors = [];
  const inspectorTrigger = await firstVisible(
    page.locator('.focus-stack-inspector-trigger'),
  );
  const moreTrigger = await firstVisible(
    page.locator(
      '.focus-stack-more[aria-controls="more-drawer"], .bottom-tabs .bottom-tab[aria-controls="more-drawer"]',
    ),
  );
  if (!inspectorTrigger || !moreTrigger) {
    return { errors: ['Inspector or More trigger is not visible'] };
  }

  await inspectorTrigger.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    document
      .getElementById('workspace-inspector')
      ?.classList.contains('is-open'),
  );
  await moreTrigger.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    document.getElementById('more-drawer')?.classList.contains('open'),
  );

  const opened = await page.evaluate(() => {
    const drawer = document.getElementById('more-drawer');
    const inspector = document.getElementById('workspace-inspector');
    const expandedValues = Array.from(
      document.querySelectorAll('[aria-controls="more-drawer"]'),
    ).map((element) => element.getAttribute('aria-expanded'));
    return {
      ariaHidden: drawer?.getAttribute('aria-hidden'),
      inert: drawer?.hasAttribute('inert'),
      inspectorOpen: inspector?.classList.contains('is-open'),
      inspectorInert: inspector?.hasAttribute('inert'),
      expandedValues,
      focusOnClose: document.activeElement?.classList.contains('more-close'),
    };
  });
  if (opened.ariaHidden !== 'false' || opened.inert)
    errors.push(
      'More drawer open state is not exposed to assistive technology',
    );
  if (opened.inspectorOpen || !opened.inspectorInert)
    errors.push('More drawer did not exclude the inspector panel');
  if (opened.expandedValues.some((value) => value !== 'true'))
    errors.push('More controls did not synchronize aria-expanded=true');
  if (!opened.focusOnClose)
    errors.push('More drawer did not move focus to its close control');
  if (screenshotPath) await page.screenshot({ path: screenshotPath });

  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => !document.getElementById('more-drawer')?.classList.contains('open'),
  );
  const closed = await moreTrigger.evaluate((trigger) => {
    const drawer = document.getElementById('more-drawer');
    return {
      ariaHidden: drawer?.getAttribute('aria-hidden'),
      inert: drawer?.hasAttribute('inert'),
      expanded: trigger.getAttribute('aria-expanded'),
      focusReturned: document.activeElement === trigger,
    };
  });
  if (closed.ariaHidden !== 'true' || !closed.inert)
    errors.push('More drawer close state is not hidden/inert');
  if (closed.expanded !== 'false')
    errors.push('More trigger did not reset aria-expanded=false');
  if (!closed.focusReturned)
    errors.push('More drawer did not return focus to its trigger');

  return { opened, closed, errors, screenshotPath };
}

async function runRouteCase(
  browser,
  route,
  viewport,
  interactions,
  screenshots,
) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: 'reduce',
  });
  await context.addInitScript(() => {
    window.localStorage.removeItem('active_mode');
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const screenshotPath = path.join(
    screenshotRoot,
    `${viewport.name}-${route.name}.png`,
  );
  const record = {
    viewport: viewport.name,
    route: route.name,
    hash: route.hash,
    expectedMode: route.mode,
    expectedSection: route.section,
    screenshotPath,
    evidence: null,
    pageErrors,
    consoleErrors,
    issues: [],
  };

  try {
    await page.goto(`${baseUrl}/${route.hash}`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForWorkspace(page);
    await page.screenshot({ path: screenshotPath });
    screenshots.push(screenshotPath);
    record.evidence = await collectRouteEvidence(page, route, viewport);
    record.issues.push(...record.evidence.issues);

    if (route.name === 'dashboard' || route.name === 'reports') {
      const inspectorScreenshot = path.join(
        screenshotRoot,
        `${viewport.name}-${route.name}-inspector-open.png`,
      );
      const moreScreenshot = path.join(
        screenshotRoot,
        `${viewport.name}-${route.name}-more-open.png`,
      );
      const inspector = await exerciseInspector(page, inspectorScreenshot);
      const more = await exerciseMoreDrawer(page, moreScreenshot);
      screenshots.push(inspectorScreenshot, moreScreenshot);
      interactions.push({
        viewport: viewport.name,
        route: route.name,
        inspector,
        more,
      });
      record.issues.push(
        ...inspector.errors.map((error) => `inspector: ${error}`),
        ...more.errors.map((error) => `more: ${error}`),
      );
    }
    await page.waitForTimeout(100);
    if (pageErrors.length > 0)
      record.issues.push(`${pageErrors.length} uncaught page error(s)`);
    if (consoleErrors.length > 0)
      record.issues.push(`${consoleErrors.length} console error(s)`);
  } catch (error) {
    record.issues.push(
      `QA execution failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await context.close();
  }

  return record;
}

async function main() {
  fs.mkdirSync(screenshotRoot, { recursive: true });
  const server = startMockServer();
  const cases = [];
  const interactions = [];
  const screenshots = [];
  let browser;
  try {
    await waitForServer(baseUrl);
    browser = await chromium.launch({ headless: true });
    for (const viewport of viewports) {
      for (const route of routes) {
        cases.push(
          await runRouteCase(
            browser,
            route,
            viewport,
            interactions,
            screenshots,
          ),
        );
      }
    }
  } finally {
    if (browser) await browser.close();
    if (server) server.kill('SIGTERM');
  }

  const issues = cases.flatMap((entry) =>
    entry.issues.map((issue) => `${entry.viewport}/${entry.route}: ${issue}`),
  );
  const summaryPath = path.join(screenshotRoot, 'summary.json');
  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    screenshotRoot,
    summaryPath,
    routeCount: routes.length,
    viewportCount: viewports.length,
    expectedCaseCount: routes.length * viewports.length,
    completedCaseCount: cases.length,
    interactionCaseCount: interactions.length,
    capturedScreenshotCount: screenshots.length,
    routeContract: routes,
    viewportContract: viewports,
    cases,
    interactions,
    screenshots,
    issueCount: issues.length,
    issues,
    passed: issues.length === 0,
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Admin workspace QA screenshots: ${screenshotRoot}`);
  console.log(
    `Admin workspace QA: ${cases.length}/${routes.length * viewports.length} cases, ${screenshots.length} screenshots, ${issues.length} issues`,
  );
  if (issues.length > 0) {
    console.error(issues.map((issue) => `- ${issue}`).join('\n'));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
