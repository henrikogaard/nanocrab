#!/usr/bin/env node
/* global document, HTMLElement, sessionStorage, window */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  selectAvailablePort,
  waitForSpawnedServer,
} from './admin-workspace-qa-server.mjs';

const repoRoot = process.cwd();
let port;
let baseUrl = process.env.ADMIN_QA_BASE_URL || '';
const screenshotRoot = path.resolve(
  process.env.ADMIN_QA_SCREENSHOT_ROOT ||
    path.join(
      repoRoot,
      'artifacts',
      'admin-workspace-qa',
      new Date().toISOString().replace(/[:.]/g, '-'),
    ),
);

function evidencePath(filePath) {
  if (!filePath) return '';
  return path.relative(screenshotRoot, filePath).split(path.sep).join('/');
}

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

async function waitForServer(url, timeoutMs = 30000, child = null) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Spawned QA server exited before ${url} became ready`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        if (child && (child.exitCode !== null || child.signalCode !== null)) {
          throw new Error(`Spawned QA server exited while probing ${url}`);
        }
        return;
      }
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
  return {
    child,
    ready: waitForSpawnedServer(child, baseUrl),
  };
}

async function configureServerTarget() {
  if (process.env.ADMIN_QA_BASE_URL) {
    baseUrl = process.env.ADMIN_QA_BASE_URL;
    return;
  }
  port = process.env.MOCK_ADMIN_PORT
    ? Number(process.env.MOCK_ADMIN_PORT)
    : await selectAvailablePort();
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid MOCK_ADMIN_PORT: ${process.env.MOCK_ADMIN_PORT}`);
  }
  baseUrl = `http://127.0.0.1:${port}`;
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
    const visibleTodayControls = Array.from(
      document.querySelectorAll('.focus-stack-home, .mobile-brand'),
    ).filter(visible);
    const currentTodayControls = visibleTodayControls.filter(
      (element) => element.getAttribute('aria-current') === 'page',
    );
    const activeTodayControls = visibleTodayControls.filter((element) =>
      element.classList.contains('active'),
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
      if (visibleTodayControls.length !== 1)
        issues.push('Expected exactly one visible Today control');
      if (currentTodayControls.length !== 1)
        issues.push('Visible Today control does not expose aria-current=page');
      if (activeTodayControls.length !== 1)
        issues.push('Visible Today control lacks active visual state');
      const visibleHome = visibleTodayControls[0];
      return {
        expected: expectedLabel,
        selected: visibleHome
          ? visibleHome.getAttribute('aria-label') ||
            visibleHome.textContent?.trim() ||
            ''
          : '',
        selectedCount: selected.length,
        visibleTodayControlCount: visibleTodayControls.length,
        currentTodayControlCount: currentTodayControls.length,
        activeTodayControlCount: activeTodayControls.length,
        issues,
      };
    }

    if (visibleTodayControls.length !== 1)
      issues.push('Expected exactly one visible Today control');
    if (currentTodayControls.length > 0 || activeTodayControls.length > 0)
      issues.push('Today remains current or active outside the Today route');
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
      visibleTodayControlCount: visibleTodayControls.length,
      currentTodayControlCount: currentTodayControls.length,
      activeTodayControlCount: activeTodayControls.length,
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

async function tabToTarget(page, target, maxSteps = 200) {
  const activeIsTarget = () =>
    target.evaluate((element) => document.activeElement === element);
  if (await activeIsTarget()) return { reached: true, steps: 0 };

  const initialSteps = Math.min(40, maxSteps);
  for (let steps = 1; steps <= initialSteps; steps += 1) {
    await page.keyboard.press('Tab');
    if (await activeIsTarget())
      return { reached: true, steps, seededAtSkipLink: false };
  }

  const skipLink = page.locator('.skip-link');
  if (await skipLink.isVisible()) await skipLink.focus();
  for (let steps = 1; steps <= maxSteps; steps += 1) {
    await page.keyboard.press('Tab');
    if (await activeIsTarget())
      return { reached: true, steps, seededAtSkipLink: true };
  }

  const activeDescriptor = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body)
      return '';
    return (
      element.getAttribute('aria-label') ||
      element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ||
      element.id ||
      element.tagName
    );
  });
  return {
    reached: false,
    steps: initialSteps + maxSteps,
    seededAtSkipLink: true,
    activeDescriptor,
  };
}

async function tabOutsideInspector(page, maxSteps = 100) {
  for (let steps = 1; steps <= maxSteps; steps += 1) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const inspector = document.getElementById('workspace-inspector');
      const active = document.activeElement;
      return {
        outside: Boolean(
          inspector &&
          active instanceof HTMLElement &&
          active !== document.body &&
          !inspector.contains(active),
        ),
        descriptor:
          active instanceof HTMLElement
            ? active.getAttribute('aria-label') ||
              active.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ||
              active.id ||
              active.tagName
            : '',
      };
    });
    if (focus.outside) return { moved: true, steps, ...focus };
  }
  return { moved: false, steps: maxSteps, descriptor: '' };
}

async function exerciseGlobalAlerts(page) {
  const errors = [];
  await page.waitForSelector('#alerts-bar .alert-banner', {
    state: 'visible',
    timeout: 5000,
  });
  const active = await page.evaluate(() => {
    const container = document.getElementById('alerts-bar');
    const inspector = document.getElementById('workspace-inspector');
    const pageContent = document.getElementById('page-content');
    const mobileControls = document.querySelector('.bottom-tabs');
    const rectOf = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const overlaps = (left, right) =>
      Boolean(
        left &&
        right &&
        left.width > 0 &&
        left.height > 0 &&
        right.width > 0 &&
        right.height > 0 &&
        left.left < right.right &&
        left.right > right.left &&
        left.top < right.bottom &&
        left.bottom > right.top,
      );
    const containerRect = rectOf(container);
    const style = container ? window.getComputedStyle(container) : null;
    return {
      idCount: document.querySelectorAll('#alerts-bar').length,
      activeAlertCount:
        container?.querySelectorAll('.alert-banner').length || 0,
      activeVisible: Boolean(
        containerRect &&
        containerRect.width > 0 &&
        containerRect.height > 0 &&
        style?.display !== 'none' &&
        style?.visibility !== 'hidden',
      ),
      outsideInspector: Boolean(
        container && !container.closest('#workspace-inspector'),
      ),
      role: container?.getAttribute('role'),
      ariaLive: container?.getAttribute('aria-live'),
      ariaAtomic: container?.getAttribute('aria-atomic'),
      inspectorClosed: Boolean(
        inspector &&
        inspector.hasAttribute('inert') &&
        inspector.getAttribute('aria-hidden') === 'true' &&
        !inspector.classList.contains('is-open'),
      ),
      position: style?.position,
      overlapsPageContent: overlaps(containerRect, rectOf(pageContent)),
      overlapsMobileControls: overlaps(containerRect, rectOf(mobileControls)),
      text: container?.textContent?.trim() || '',
    };
  });

  if (active.idCount !== 1)
    errors.push(`Expected one global alert container, found ${active.idCount}`);
  if (active.activeAlertCount < 1 || !active.activeVisible || !active.text)
    errors.push('Active system alerts are not visibly rendered');
  if (!active.outsideInspector || !active.inspectorClosed)
    errors.push('Active system alerts depend on the closed Inspector');
  if (
    active.role !== 'status' ||
    active.ariaLive !== 'polite' ||
    active.ariaAtomic !== 'true'
  ) {
    errors.push('Global alerts are missing live-region semantics');
  }
  if (active.position !== 'static')
    errors.push(
      `Global alerts use obstructive positioning: ${active.position}`,
    );
  if (active.overlapsPageContent || active.overlapsMobileControls)
    errors.push('Global alerts obstruct route content or mobile controls');

  const emptyAlertsRoute = (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    });
  await page.route('**/api/system/alerts', emptyAlertsRoute);
  let empty;
  try {
    await page.evaluate(async () => {
      if (typeof window.loadAlerts !== 'function') {
        throw new Error('loadAlerts is unavailable');
      }
      await window.loadAlerts();
    });
    empty = await page.evaluate(() => {
      const container = document.getElementById('alerts-bar');
      const pageContent = document.getElementById('page-content');
      const rect = container?.getBoundingClientRect();
      const contentRect = pageContent?.getBoundingClientRect();
      const contentStyle = pageContent
        ? window.getComputedStyle(pageContent)
        : null;
      return {
        emptyAlertCount:
          container?.querySelectorAll('.alert-banner').length || 0,
        emptyDisplay: container
          ? window.getComputedStyle(container).display
          : 'missing',
        emptyHeight: rect?.height || 0,
        pageContentVisible: Boolean(
          contentRect &&
          contentRect.width > 0 &&
          contentRect.height > 0 &&
          contentStyle?.display !== 'none' &&
          contentStyle?.visibility !== 'hidden',
        ),
      };
    });
  } finally {
    await page.unroute('**/api/system/alerts', emptyAlertsRoute);
  }

  if (
    empty.emptyAlertCount !== 0 ||
    empty.emptyDisplay !== 'none' ||
    empty.emptyHeight !== 0
  ) {
    errors.push('Empty global alert state does not collapse cleanly');
  }
  if (!empty.pageContentVisible)
    errors.push('Empty global alert state disrupts route content');

  return { active, empty, errors };
}

async function exerciseInspector(page, screenshotPath = '') {
  const errors = [];
  const trigger = await firstVisible(
    page.locator('.focus-stack-inspector-trigger'),
  );
  if (!trigger) return { errors: ['Inspector trigger is not visible'] };

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  const keyboardNavigation = await tabToTarget(page, trigger);
  if (!keyboardNavigation.reached) {
    return {
      keyboardNavigation,
      errors: ['Tab did not reach the visible inspector trigger'],
    };
  }
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    document
      .getElementById('workspace-inspector')
      ?.classList.contains('is-open'),
  );
  const opened = await page.evaluate(() => {
    const inspector = document.getElementById('workspace-inspector');
    const trigger = document.querySelector('.focus-stack-inspector-trigger');
    const close = inspector?.querySelector('.focus-stack-inspector-close');
    const closeRect = close?.getBoundingClientRect();
    const closeStyle = close ? window.getComputedStyle(close) : null;
    const closeHit = closeRect
      ? document.elementFromPoint(
          closeRect.left + closeRect.width / 2,
          closeRect.top + closeRect.height / 2,
        )
      : null;
    return {
      ariaHidden: inspector?.getAttribute('aria-hidden'),
      inert: inspector?.hasAttribute('inert'),
      expanded: trigger?.getAttribute('aria-expanded'),
      focusOnClose: document.activeElement === close,
      closeRendered: Boolean(
        closeRect &&
        closeStyle &&
        closeRect.width > 0 &&
        closeRect.height > 0 &&
        closeStyle.display !== 'none' &&
        closeStyle.visibility !== 'hidden' &&
        Number(closeStyle.opacity || 1) > 0,
      ),
      closeWithinViewport: Boolean(
        closeRect &&
        closeRect.left >= 0 &&
        closeRect.top >= 0 &&
        closeRect.right <= window.innerWidth &&
        closeRect.bottom <= window.innerHeight,
      ),
      closeTopmost: Boolean(
        close && closeHit && (close === closeHit || close.contains(closeHit)),
      ),
      focusIndicatorVisible: Boolean(
        close &&
        closeStyle &&
        close.matches(':focus-visible') &&
        ((closeStyle.outlineStyle !== 'none' &&
          Number.parseFloat(closeStyle.outlineWidth) > 0) ||
          closeStyle.boxShadow !== 'none'),
      ),
    };
  });
  if (opened.ariaHidden !== 'false' || opened.inert)
    errors.push('Inspector open state is not exposed to assistive technology');
  if (opened.expanded !== 'true')
    errors.push('Inspector trigger did not expose aria-expanded=true');
  if (!opened.focusOnClose)
    errors.push('Inspector did not move focus to its close control');
  if (!opened.closeRendered || !opened.closeWithinViewport)
    errors.push('Inspector close control is not visibly inside the viewport');
  if (!opened.closeTopmost)
    errors.push('Inspector close control is geometrically occluded');
  if (!opened.focusIndicatorVisible)
    errors.push('Inspector close control lacks visible keyboard focus');
  if (screenshotPath) await page.screenshot({ path: screenshotPath });

  const focusMovedOutsideInspector = await tabOutsideInspector(page);
  if (!focusMovedOutsideInspector.moved)
    errors.push('Tab did not move focus outside the non-modal inspector');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const closedByGlobalEscape = await page.evaluate(
    () =>
      !document
        .getElementById('workspace-inspector')
        ?.classList.contains('is-open'),
  );
  if (!closedByGlobalEscape) {
    errors.push('Inspector did not close from global Escape outside the panel');
    await page.evaluate(() => window.closeWorkspaceInspector?.());
  }
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

  return {
    keyboardNavigation,
    opened,
    focusMovedOutsideInspector,
    closedByGlobalEscape,
    closed,
    errors,
    screenshotPath: evidencePath(screenshotPath),
  };
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

  const inspectorKeyboardNavigation = await tabToTarget(page, inspectorTrigger);
  if (!inspectorKeyboardNavigation.reached) {
    return {
      inspectorKeyboardNavigation,
      errors: ['Tab did not reach the visible inspector trigger'],
    };
  }
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    document
      .getElementById('workspace-inspector')
      ?.classList.contains('is-open'),
  );
  const moreKeyboardNavigation = await tabToTarget(page, moreTrigger);
  if (!moreKeyboardNavigation.reached) {
    return {
      inspectorKeyboardNavigation,
      moreKeyboardNavigation,
      errors: ['Tab did not reach the visible More trigger'],
    };
  }
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    document.getElementById('more-drawer')?.classList.contains('open'),
  );

  const opened = await page.evaluate(() => {
    const drawer = document.getElementById('more-drawer');
    const inspector = document.getElementById('workspace-inspector');
    const overlay = document.querySelector('.more-overlay');
    const header = drawer?.querySelector('.more-drawer-header');
    const body = drawer?.querySelector('.more-drawer-body');
    const close = drawer?.querySelector('.more-close');
    const expandedValues = Array.from(
      document.querySelectorAll('[aria-controls="more-drawer"]'),
    ).map((element) => element.getAttribute('aria-expanded'));
    const geometry = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity || 1),
      };
    };
    const rendered = (rect) =>
      Boolean(
        rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.display !== 'none' &&
        rect.visibility !== 'hidden' &&
        rect.opacity > 0,
      );
    const withinViewport = (rect) =>
      Boolean(
        rect &&
        rect.left >= -1 &&
        rect.top >= -1 &&
        rect.right <= window.innerWidth + 1 &&
        rect.bottom <= window.innerHeight + 1,
      );
    const hitBelongsTo = (element, x, y) => {
      if (!element || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && (hit === element || element.contains(hit)));
    };
    const drawerGeometry = geometry(drawer);
    const headerGeometry = geometry(header);
    const bodyGeometry = geometry(body);
    const closeGeometry = geometry(close);
    const closeStyle = close ? window.getComputedStyle(close) : null;
    const overlayStyle = overlay ? window.getComputedStyle(overlay) : null;
    const minimumCloseTargetPx = window.innerWidth <= 768 ? 44 : 36;
    const overlayPoint = drawerGeometry
      ? {
          x: Math.min(
            window.innerWidth - 2,
            drawerGeometry.right +
              Math.max(2, (window.innerWidth - drawerGeometry.right) / 2),
          ),
          y: Math.min(window.innerHeight - 2, window.innerHeight / 2),
        }
      : null;
    return {
      ariaHidden: drawer?.getAttribute('aria-hidden'),
      inert: drawer?.hasAttribute('inert'),
      role: drawer?.getAttribute('role'),
      ariaModal: drawer?.getAttribute('aria-modal'),
      labelledBy: drawer?.getAttribute('aria-labelledby'),
      labelledByText: drawer?.getAttribute('aria-labelledby')
        ? document
            .getElementById(drawer.getAttribute('aria-labelledby'))
            ?.textContent?.trim() || ''
        : '',
      inspectorOpen: inspector?.classList.contains('is-open'),
      inspectorInert: inspector?.hasAttribute('inert'),
      expandedValues,
      focusOnClose: document.activeElement === close,
      drawerGeometry,
      headerGeometry,
      bodyGeometry,
      closeGeometry,
      drawerWithinViewport:
        rendered(drawerGeometry) && withinViewport(drawerGeometry),
      headerWithinViewport:
        rendered(headerGeometry) && withinViewport(headerGeometry),
      bodyWithinViewport:
        rendered(bodyGeometry) && withinViewport(bodyGeometry),
      closeWithinViewport:
        rendered(closeGeometry) && withinViewport(closeGeometry),
      minimumCloseTargetPx,
      closeMeetsMinimumTarget: Boolean(
        closeGeometry &&
        closeGeometry.width >= minimumCloseTargetPx &&
        closeGeometry.height >= minimumCloseTargetPx,
      ),
      closeTopmost: Boolean(
        closeGeometry &&
        hitBelongsTo(
          close,
          closeGeometry.left + closeGeometry.width / 2,
          closeGeometry.top + closeGeometry.height / 2,
        ),
      ),
      headerTopmost: Boolean(
        headerGeometry &&
        hitBelongsTo(
          header,
          headerGeometry.left + Math.min(24, headerGeometry.width / 2),
          headerGeometry.top + headerGeometry.height / 2,
        ),
      ),
      overlayTopmost: Boolean(
        overlayPoint &&
        drawerGeometry &&
        overlayPoint.x > drawerGeometry.right &&
        hitBelongsTo(overlay, overlayPoint.x, overlayPoint.y),
      ),
      overlayInteractive: Boolean(
        overlayStyle &&
        overlayStyle.pointerEvents !== 'none' &&
        overlay?.getAttribute('aria-hidden') === 'false',
      ),
      focusVisible: Boolean(close?.matches(':focus-visible')),
      focusIndicatorVisible: Boolean(
        close &&
        closeStyle &&
        close.matches(':focus-visible') &&
        ((closeStyle.outlineStyle !== 'none' &&
          Number.parseFloat(closeStyle.outlineWidth) > 0) ||
          closeStyle.boxShadow !== 'none'),
      ),
    };
  });
  const openStateUnnamedControls = await unnamedVisibleControls(page);
  const openStateDocumentOverflowPx = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
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
  if (
    opened.role !== 'dialog' ||
    opened.ariaModal !== 'true' ||
    !opened.labelledBy ||
    !opened.labelledByText
  ) {
    errors.push('More drawer lacks a labelled modal dialog contract');
  }
  if (!opened.drawerWithinViewport)
    errors.push('More drawer extends outside the viewport');
  if (!opened.headerWithinViewport || !opened.headerTopmost)
    errors.push('More drawer header is outside the viewport or occluded');
  if (!opened.bodyWithinViewport)
    errors.push('More drawer scroll body extends outside the viewport');
  if (!opened.closeWithinViewport || !opened.closeTopmost)
    errors.push(
      'More drawer close control is outside the viewport or occluded',
    );
  if (!opened.closeMeetsMinimumTarget)
    errors.push(
      `More drawer close control is smaller than ${opened.minimumCloseTargetPx}px`,
    );
  if (!opened.focusVisible || !opened.focusIndicatorVisible)
    errors.push('More drawer close control lacks visible keyboard focus');
  if (!opened.overlayInteractive || !opened.overlayTopmost)
    errors.push('More drawer modal overlay is not the topmost outside layer');
  if (openStateUnnamedControls.length > 0) {
    errors.push(
      `${openStateUnnamedControls.length} open-state control(s) lack accessible names`,
    );
  }
  if (openStateDocumentOverflowPx > 2) {
    errors.push(
      `More drawer open state has ${openStateDocumentOverflowPx}px horizontal overflow`,
    );
  }
  await page.keyboard.press('Shift+Tab');
  const modalFocusLoop = await page.evaluate(() => {
    const drawer = document.getElementById('more-drawer');
    const controls = Array.from(
      drawer?.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [],
    ).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    });
    const last = controls.at(-1) || null;
    return {
      lastFocusableOnBackwardTab: document.activeElement === last,
      lastFocusableName:
        last?.getAttribute('aria-label') ||
        last?.textContent?.trim().replace(/\s+/g, ' ') ||
        '',
      focusLoopedToClose: false,
    };
  });
  await page.keyboard.press('Tab');
  modalFocusLoop.focusLoopedToClose = await page.evaluate(
    () => document.activeElement === document.querySelector('.more-close'),
  );
  if (!modalFocusLoop.lastFocusableOnBackwardTab)
    errors.push('More drawer did not wrap backward focus to its final control');
  if (!modalFocusLoop.focusLoopedToClose)
    errors.push('More drawer did not contain forward keyboard focus');
  await page.locator('.more-drawer-body').evaluate((body) => {
    body.scrollTop = body.scrollHeight;
  });
  await page.waitForTimeout(50);
  const scrolled = await page.evaluate(() => {
    const drawer = document.getElementById('more-drawer');
    const header = drawer?.querySelector('.more-drawer-header');
    const body = drawer?.querySelector('.more-drawer-body');
    const controls = Array.from(
      drawer?.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [],
    ).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    });
    const lastControl = controls.at(-1) || null;
    const rectOf = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const drawerGeometry = rectOf(drawer);
    const headerGeometry = rectOf(header);
    const bodyGeometry = rectOf(body);
    const lastControlGeometry = rectOf(lastControl);
    const hitBelongsTo = (element, x, y) => {
      if (!element || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && (hit === element || element.contains(hit)));
    };
    return {
      drawerGeometry,
      headerGeometry,
      bodyGeometry,
      lastControlGeometry,
      bodyScrollTop: body?.scrollTop || 0,
      bodyScrollHeight: body?.scrollHeight || 0,
      bodyClientHeight: body?.clientHeight || 0,
      lastControlName:
        lastControl?.getAttribute('aria-label') ||
        lastControl?.textContent?.trim().replace(/\s+/g, ' ') ||
        '',
      headerWithinViewport: Boolean(
        headerGeometry &&
        headerGeometry.top >= -1 &&
        headerGeometry.bottom <= window.innerHeight + 1,
      ),
      lastControlWithinBody: Boolean(
        lastControlGeometry &&
        bodyGeometry &&
        lastControlGeometry.top >= bodyGeometry.top - 1 &&
        lastControlGeometry.bottom <= bodyGeometry.bottom + 1,
      ),
      lastControlTopmost: Boolean(
        lastControlGeometry &&
        hitBelongsTo(
          lastControl,
          lastControlGeometry.left + lastControlGeometry.width / 2,
          lastControlGeometry.top + lastControlGeometry.height / 2,
        ),
      ),
      lowerEdgeTopmost: Boolean(
        drawerGeometry &&
        hitBelongsTo(
          drawer,
          drawerGeometry.left + drawerGeometry.width / 2,
          Math.min(window.innerHeight - 2, drawerGeometry.bottom - 2),
        ),
      ),
    };
  });
  if (!scrolled.headerWithinViewport)
    errors.push('More drawer header did not remain visible while scrolling');
  if (!scrolled.lastControlName || !scrolled.lastControlWithinBody)
    errors.push('More drawer final control is not visible after scrolling');
  if (!scrolled.lastControlTopmost)
    errors.push('More drawer final control is geometrically occluded');
  if (!scrolled.lowerEdgeTopmost)
    errors.push('More drawer lower edge is hidden behind fixed page chrome');
  if (screenshotPath) await page.screenshot({ path: screenshotPath });

  await page.keyboard.press('Escape');
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

  return {
    inspectorKeyboardNavigation,
    moreKeyboardNavigation,
    opened: {
      ...opened,
      openStateUnnamedControls,
      openStateDocumentOverflowPx,
    },
    modalFocusLoop,
    scrolled,
    closed,
    errors,
    screenshotPath: evidencePath(screenshotPath),
  };
}

function targetedViewport(viewport) {
  return viewport.name === 'desktop' || viewport.name === 'mobile';
}

function stateScreenshotPath(viewport, name) {
  return path.join(screenshotRoot, `${viewport.name}-${name}.png`);
}

async function waitForMockWebSocket(page) {
  await page.waitForFunction(
    () =>
      Array.isArray(window.__qaWebSockets) &&
      window.__qaWebSockets.some(
        (socket) => typeof socket?.__qaOnMessage === 'function',
      ),
  );
}

async function deliverMockWebSocketMessage(page, message) {
  await page.evaluate((event) => {
    const socket = [...window.__qaWebSockets]
      .reverse()
      .find((candidate) => typeof candidate.__qaOnMessage === 'function');
    if (!socket) {
      throw new Error('Mock WebSocket onmessage handler is unavailable');
    }
    socket.__qaOnMessage.call(
      socket,
      new MessageEvent('message', { data: JSON.stringify(event) }),
    );
  }, message);
}

async function invokeMockWebSocketCallback(page, callback) {
  await page.evaluate((name) => {
    const socket = [...window.__qaWebSockets]
      .reverse()
      .find((candidate) => typeof candidate.__qaOnMessage === 'function');
    if (!socket) {
      throw new Error('Mock WebSocket is unavailable');
    }
    const handler =
      name === 'onclose' ? socket.__qaOnClose : socket.__qaOnOpen;
    if (typeof handler !== 'function') {
      throw new Error(`Mock WebSocket ${name} handler is unavailable`);
    }
    const event =
      name === 'onclose'
        ? new CloseEvent('close', { code: 1006, reason: 'QA transport loss' })
        : new Event('open');
    handler.call(socket, event);
  }, callback);
}

async function captureVisibleScreenshot(page, selector, screenshotPath) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  const geometry = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      withinViewport:
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth &&
        style.display !== 'none' &&
        style.visibility !== 'hidden',
    };
  });
  if (!geometry.withinViewport) {
    throw new Error(`${selector} is not visibly within the viewport`);
  }
  await page.screenshot({ path: screenshotPath });
}

async function exerciseChatRunFlow(page, viewport, screenshots) {
  const errors = [];
  const screenshotPath = stateScreenshotPath(
    viewport,
    'chat-run-before-progress',
  );
  await page.goto(`${baseUrl}/#/chat/web%3Amock-1`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('#chat-msg-input');
  await page.locator('#thread-run-strip').waitFor({ state: 'attached' });
  await waitForMockWebSocket(page);

  const before = await page.evaluate(() => ({
    runStripCount: document.querySelectorAll(
      '#thread-run-strip .work-session-run-strip',
    ).length,
    progressVisible: document
      .getElementById('chat-progress-bar')
      ?.classList.contains('visible'),
  }));
  if (before.runStripCount !== 0 || before.progressVisible) {
    errors.push('Chat exposed run progress before scoped work started');
  }
  await captureVisibleScreenshot(page, '#chat-msg-input', screenshotPath);
  screenshots.push(evidencePath(screenshotPath));

  await deliverMockWebSocketMessage(page, {
    type: 'task_progress',
    data: {
      groupJid: 'web:mock-1',
      message: 'Scoped QA progress',
      pct: 42,
    },
  });
  await page.waitForSelector('#thread-run-strip .work-session-run-strip');
  const active = await page.evaluate(() => {
    const runStrip = document.querySelector(
      '#thread-run-strip .work-session-run-strip',
    );
    return {
      status: runStrip?.getAttribute('data-session-status') || '',
      text: runStrip?.textContent?.replace(/\s+/g, ' ').trim() || '',
      progressValue: runStrip?.querySelector('progress')?.getAttribute('value'),
      hasResume: Array.from(runStrip?.querySelectorAll('button') || []).some(
        (button) => button.textContent?.trim() === 'Resume',
      ),
    };
  });
  if (active.status !== 'running')
    errors.push(`Chat scoped progress status is ${active.status || 'missing'}`);
  if (!active.text.includes('Scoped QA progress'))
    errors.push('Chat scoped progress did not describe the active event');
  if (active.progressValue !== '42')
    errors.push(
      `Chat scoped progress value is ${active.progressValue || 'missing'}`,
    );
  if (active.hasResume) errors.push('Chat scoped progress exposed Resume');

  const activeScreenshotPath = stateScreenshotPath(
    viewport,
    'chat-run-progress-active',
  );
  await captureVisibleScreenshot(
    page,
    '#thread-run-strip .work-session-run-strip',
    activeScreenshotPath,
  );
  screenshots.push(evidencePath(activeScreenshotPath));

  return {
    before,
    active,
    errors,
    screenshotPaths: [
      evidencePath(screenshotPath),
      evidencePath(activeScreenshotPath),
    ],
  };
}

async function exercisePromotionHandoff(page, viewport, screenshots) {
  const errors = [];
  const trigger = page.locator(
    '[data-webchat-action="promote-thread"][data-promotion-destination="cowork"]',
  );
  await trigger.click();
  await page.waitForSelector('[data-work-session-promotion]');
  const handoff = await page.evaluate(() => {
    const surface = document.querySelector('[data-work-session-promotion]');
    return {
      destination: surface?.getAttribute('data-promotion-destination') || '',
      threadId: surface?.getAttribute('data-promotion-thread-id') || '',
      text: surface?.textContent?.replace(/\s+/g, ' ').trim() || '',
      pendingStorage: sessionStorage.getItem('work_session_promotion'),
    };
  });
  if (handoff.destination !== 'cowork')
    errors.push(`Promotion destination is ${handoff.destination || 'missing'}`);
  if (handoff.threadId !== 'web:mock-1')
    errors.push(`Promotion thread id is ${handoff.threadId || 'missing'}`);
  if (!handoff.text)
    errors.push('Promotion handoff surface is not visibly described');
  if (handoff.pendingStorage !== null)
    errors.push(
      'Promotion context remained in session storage after handoff rendered',
    );

  const screenshotPath = stateScreenshotPath(viewport, 'promotion-handoff');
  await page.screenshot({ path: screenshotPath });
  screenshots.push(evidencePath(screenshotPath));
  return {
    handoff,
    errors,
    screenshotPath: evidencePath(screenshotPath),
  };
}

async function terminalStateEvidence(page) {
  return page.evaluate(() => {
    const container = document.getElementById('terminal-session-state');
    const runStrip = container?.querySelector('.work-session-run-strip');
    return {
      state: container?.getAttribute('data-terminal-state') || '',
      status: runStrip?.getAttribute('data-session-status') || '',
      text: runStrip?.textContent?.replace(/\s+/g, ' ').trim() || '',
      hasResume: Array.from(runStrip?.querySelectorAll('button') || []).some(
        (button) => button.textContent?.trim() === 'Resume',
      ),
      isReadOnly: /transcript only/i.test(runStrip?.textContent || ''),
    };
  });
}

async function exerciseTerminalSessionStates(page, viewport, screenshots) {
  const errors = [];
  await page.evaluate(() => {
    window.location.hash = '#/devhub';
  });
  await page.locator('#dev-tabs .tab[data-tab-id="terminal"]').click();
  await page.waitForSelector('#terminal-session-state .work-session-run-strip');
  const sessionId = await page.locator('#terminal-session-id').inputValue();
  const states = [];
  const recordState = async (expected) => {
    await page.waitForFunction(
      (kind) =>
        document
          .getElementById('terminal-session-state')
          ?.getAttribute('data-terminal-state') === kind,
      expected.kind,
    );
    const evidence = await terminalStateEvidence(page);
    if (evidence.status !== expected.expectedStatus) {
      errors.push(
        `Terminal ${expected.kind} status is ${evidence.status || 'missing'}`,
      );
    }
    if (!evidence.text) errors.push(`Terminal ${expected.kind} is not visible`);
    if (evidence.hasResume)
      errors.push(`Terminal ${expected.kind} exposed Resume`);
    if (evidence.isReadOnly !== expected.isReadOnly) {
      errors.push(
        `Terminal ${expected.kind} read-only state is ${evidence.isReadOnly}`,
      );
    }
    const screenshotPath = stateScreenshotPath(
      viewport,
      `terminal-session-${expected.kind}`,
    );
    await captureVisibleScreenshot(
      page,
      '#terminal-session-state .work-session-run-strip',
      screenshotPath,
    );
    screenshots.push(evidencePath(screenshotPath));
    states.push({
      ...expected,
      evidence,
      screenshotPath: evidencePath(screenshotPath),
    });
  };

  await recordState({
    kind: 'loading',
    expectedStatus: 'running',
    isReadOnly: false,
  });
  await page.waitForSelector('#terminal-container .xterm');
  await waitForMockWebSocket(page);
  await deliverMockWebSocketMessage(page, {
    type: 'terminal_lifecycle',
    sessionId,
    data: { state: 'ready' },
  });
  await recordState({
    kind: 'ready',
    expectedStatus: 'running',
    isReadOnly: false,
  });
  await deliverMockWebSocketMessage(page, {
    type: 'terminal_output',
    sessionId,
    data: '[Process exited]',
  });
  const outputEvidence = await terminalStateEvidence(page);
  if (outputEvidence.state !== 'ready') {
    errors.push('Terminal output changed lifecycle state without a typed event');
  }
  await deliverMockWebSocketMessage(page, {
    type: 'terminal_lifecycle',
    sessionId,
    data: { state: 'unavailable' },
  });
  await recordState({
    kind: 'unavailable',
    expectedStatus: 'failed',
    isReadOnly: false,
  });
  await deliverMockWebSocketMessage(page, {
    type: 'terminal_lifecycle',
    sessionId,
    data: { state: 'ready' },
  });
  await invokeMockWebSocketCallback(page, 'onclose');
  const closeEvidence = await terminalStateEvidence(page);
  if (closeEvidence.state !== 'unavailable') {
    errors.push('Terminal close did not expose unavailable transport state');
  }
  const socketCountBeforeReconnect = await page.evaluate(
    () => window.__qaWebSockets.length,
  );
  await page
    .locator('[onclick="reconnectTerminal()"]')
    .click();
  await page.waitForFunction(
    (previousCount) =>
      window.__qaWebSockets.length > previousCount &&
      window.__qaWebSockets.at(-1)?.readyState === WebSocket.OPEN &&
      typeof window.__qaWebSockets.at(-1)?.__qaOnOpen === 'function',
    socketCountBeforeReconnect,
  );
  await invokeMockWebSocketCallback(page, 'onopen');
  await recordState({
    kind: 'reconnecting',
    expectedStatus: 'running',
    isReadOnly: false,
  });
  await deliverMockWebSocketMessage(page, {
    type: 'terminal_lifecycle',
    sessionId,
    data: { state: 'exited' },
  });
  await recordState({
    kind: 'interrupted',
    expectedStatus: 'interrupted',
    isReadOnly: true,
  });
  return { sessionId, states, outputEvidence, closeEvidence, errors };
}

async function runTargetedFlowCase(browser, viewport, screenshots) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: 'reduce',
  });
  await context.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.__qaWebSockets = [];
    class CapturedWebSocket extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        window.__qaWebSockets.push(this);
      }

      get onopen() {
        return this.__qaOnOpen;
      }

      set onopen(handler) {
        this.__qaOnOpen = handler;
        super.onopen = (event) => {
          this.__qaDeferredOpenEvent = event;
        };
      }

      get onmessage() {
        return this.__qaOnMessage;
      }

      set onmessage(handler) {
        this.__qaOnMessage = handler;
        super.onmessage = handler;
      }

      get onclose() {
        return this.__qaOnClose;
      }

      set onclose(handler) {
        this.__qaOnClose = handler;
        super.onclose = (event) => {
          this.__qaDeferredCloseEvent = event;
        };
      }
    }
    window.WebSocket = CapturedWebSocket;
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const record = {
    viewport: viewport.name,
    routes: ['#/chat', '#/terminal'],
    pageErrors,
    consoleErrors,
    chat: null,
    promotion: null,
    terminal: null,
    issues: [],
  };
  try {
    record.chat = await exerciseChatRunFlow(page, viewport, screenshots);
    record.issues.push(...record.chat.errors.map((error) => `chat: ${error}`));
    record.promotion = await exercisePromotionHandoff(
      page,
      viewport,
      screenshots,
    );
    record.issues.push(
      ...record.promotion.errors.map((error) => `promotion: ${error}`),
    );
    record.terminal = await exerciseTerminalSessionStates(
      page,
      viewport,
      screenshots,
    );
    record.issues.push(
      ...record.terminal.errors.map((error) => `terminal: ${error}`),
    );
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
    screenshotPath: evidencePath(screenshotPath),
    evidence: null,
    pageErrors,
    consoleErrors,
    alerts: null,
    issues: [],
  };

  try {
    await page.goto(`${baseUrl}/${route.hash}`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForWorkspace(page);
    await page.screenshot({ path: screenshotPath });
    screenshots.push(evidencePath(screenshotPath));
    record.evidence = await collectRouteEvidence(page, route, viewport);
    record.issues.push(...record.evidence.issues);

    if (route.name === 'dashboard') {
      record.alerts = await exerciseGlobalAlerts(page);
      record.issues.push(
        ...record.alerts.errors.map((error) => `alerts: ${error}`),
      );
    }

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
      screenshots.push(
        evidencePath(inspectorScreenshot),
        evidencePath(moreScreenshot),
      );
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
  await configureServerTarget();
  const targetedOnly = process.env.ADMIN_QA_TARGETED_ONLY === '1';
  fs.mkdirSync(screenshotRoot, { recursive: true });
  const server = startMockServer();
  const cases = [];
  const interactions = [];
  const targetedFlows = [];
  const screenshots = [];
  let browser;
  try {
    if (server) await server.ready;
    await waitForServer(baseUrl, 30000, server?.child || null);
    browser = await chromium.launch({ headless: true });
    if (!targetedOnly) {
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
    }
    for (const viewport of viewports.filter(targetedViewport)) {
      targetedFlows.push(
        await runTargetedFlowCase(browser, viewport, screenshots),
      );
    }
  } finally {
    if (browser) await browser.close();
    if (server?.child) server.child.kill('SIGTERM');
  }

  const issues = cases.flatMap((entry) =>
    entry.issues.map((issue) => `${entry.viewport}/${entry.route}: ${issue}`),
  );
  issues.push(
    ...targetedFlows.flatMap((entry) =>
      entry.issues.map((issue) => `${entry.viewport}/targeted-flows: ${issue}`),
    ),
  );
  const summaryPath = path.join(screenshotRoot, 'summary.json');
  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    screenshotRoot: '.',
    summaryPath: 'summary.json',
    routeCount: routes.length,
    viewportCount: viewports.length,
    expectedCaseCount: targetedOnly ? 0 : routes.length * viewports.length,
    completedCaseCount: cases.length,
    interactionCaseCount: interactions.length,
    targetedFlowCaseCount: targetedFlows.length,
    capturedScreenshotCount: screenshots.length,
    routeContract: routes,
    viewportContract: viewports,
    cases,
    interactions,
    targetedFlows,
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
