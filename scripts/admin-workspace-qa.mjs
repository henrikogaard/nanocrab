#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const repoRoot = process.cwd();
const port = Number(process.env.MOCK_ADMIN_PORT || 5187);
const baseUrl = process.env.ADMIN_QA_BASE_URL || `http://127.0.0.1:${port}`;
const screenshotRoot = path.join(
  repoRoot,
  'artifacts',
  'admin-workspace-qa',
  new Date().toISOString().replace(/[:.]/g, '-'),
);

const routes = [
  ['dashboard', '#/dashboard'],
  ['copilot-chat', '#/chat'],
  ['cowork-projects', '#/projects'],
  ['code-workspace', '#/gitcode'],
  ['settings', '#/settings'],
  ['tasks', '#/tasks'],
  ['files', '#/files'],
  ['snippets', '#/snippets'],
  ['uptime', '#/uptime'],
];

const viewports = [
  ['desktop', { width: 1440, height: 1000 }],
  ['narrow', { width: 390, height: 844 }],
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
      // server still starting
    }
    await wait(500);
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

async function visibleButtonNameIssues(page) {
  return page.locator('button').evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        const style = window.getComputedStyle(button);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        );
      })
      .map((button) => ({
        text: button.textContent?.trim() || '',
        aria: button.getAttribute('aria-label') || '',
        title: button.getAttribute('title') || '',
        id: button.id || '',
        className: String(button.className || ''),
      }))
      .filter((button) => !button.text && !button.aria && !button.title),
  );
}

async function keyboardProbe(page) {
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return 'No focusable element reached';
    const rect = active.getBoundingClientRect();
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth;
    return visible ? '' : `Focused element is offscreen: ${active.tagName}`;
  });
}

async function layoutOverflowIssue(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;
    return overflow > 2 ? `Horizontal overflow ${overflow}px` : '';
  });
}

async function main() {
  fs.mkdirSync(screenshotRoot, { recursive: true });
  const server = startMockServer();
  const issues = [];
  try {
    await waitForServer(baseUrl);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const [viewportName, viewport] of viewports) {
        const page = await browser.newPage({ viewport });
        for (const [routeName, route] of routes) {
          await page.goto(`${baseUrl}/${route}`, { waitUntil: 'networkidle' });
          await page.waitForTimeout(350);
          const screenshotPath = path.join(
            screenshotRoot,
            `${viewportName}-${routeName}.png`,
          );
          await page.screenshot({ path: screenshotPath, fullPage: true });

          const buttonIssues = await visibleButtonNameIssues(page);
          const keyboardIssue = await keyboardProbe(page);
          const overflowIssue = await layoutOverflowIssue(page);
          if (buttonIssues.length) {
            issues.push(
              `${viewportName}/${routeName}: ${buttonIssues.length} visible button(s) lack text, aria-label, or title`,
            );
          }
          if (keyboardIssue) issues.push(`${viewportName}/${routeName}: ${keyboardIssue}`);
          if (overflowIssue) issues.push(`${viewportName}/${routeName}: ${overflowIssue}`);
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (server) server.kill('SIGTERM');
  }

  const summaryPath = path.join(screenshotRoot, 'summary.json');
  fs.writeFileSync(
    summaryPath,
    JSON.stringify({ baseUrl, screenshotRoot, routes, viewports, issues }, null, 2),
  );
  console.log(`Admin workspace QA screenshots: ${screenshotRoot}`);
  if (issues.length) {
    console.error(issues.map((issue) => `- ${issue}`).join('\n'));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
