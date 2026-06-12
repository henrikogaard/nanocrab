/**
 * Step: environment — Detect OS, Node, container runtimes, existing config.
 * Replaces 01-check-environment.sh
 */
import fs from 'fs';
import path from 'path';
import net from 'net';

import Database from 'better-sqlite3';

import { STORE_DIR } from '../src/config.js';
import { logger } from '../src/logger.js';
import { commandExists, getPlatform, isHeadless, isWSL, getNodeMajorVersion } from './platform.js';
import { emitStatus } from './status.js';
import { printRecoveryGuide } from './banner.js';

interface CheckResult {
  ok: boolean;
  label: string;
  detail: string;
  hint?: string;
}

async function checkNodeVersion(): Promise<CheckResult> {
  const ver = getNodeMajorVersion();
  if (ver == null) {
    return { ok: false, label: 'Node.js version', detail: 'Could not detect Node.js version', hint: 'Install Node.js >= 20: https://nodejs.org' };
  }
  if (ver < 20) {
    return { ok: false, label: 'Node.js version', detail: `Node ${ver} detected, need >= 20`, hint: 'Upgrade Node.js: https://nodejs.org' };
  }
  return { ok: true, label: 'Node.js version', detail: `Node ${ver}.x detected` };
}

async function checkPort(port: number, label: string): Promise<CheckResult> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve({ ok: false, label, detail: `Port ${port} is already in use`, hint: `Stop the process on port ${port} or configure a different port` });
      } else {
        resolve({ ok: false, label, detail: `Port ${port} check failed: ${err.message}` });
      }
    });
    server.once('listening', () => {
      server.close();
      resolve({ ok: true, label, detail: `Port ${port} is available` });
    });
    server.listen(port, '127.0.0.1');
  });
}

async function checkContainerRuntime(): Promise<CheckResult> {
  const hasDocker = commandExists('docker');
  const hasAppleContainer = commandExists('container');
  if (!hasDocker && !hasAppleContainer) {
    return {
      ok: false,
      label: 'Container runtime',
      detail: 'Neither Docker nor Apple Container found',
      hint: 'Install Docker Desktop (https://docker.com) or use a platform with container support',
    };
  }
  if (hasDocker) {
    try {
      const { execSync } = await import('child_process');
      execSync('docker info', { stdio: 'ignore' });
      return { ok: true, label: 'Container runtime', detail: 'Docker is installed and running' };
    } catch {
      return { ok: false, label: 'Container runtime', detail: 'Docker is installed but not running', hint: 'Start Docker Desktop or run: sudo systemctl start docker' };
    }
  }
  return { ok: true, label: 'Container runtime', detail: 'Apple Container is available' };
}

async function checkStorePermissions(): Promise<CheckResult> {
  const storePath = path.resolve(STORE_DIR);
  try {
    if (!fs.existsSync(storePath)) {
      fs.mkdirSync(storePath, { recursive: true });
    }
    const testFile = path.join(storePath, '.write-test');
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
    return { ok: true, label: 'Store permissions', detail: `${storePath} is writable` };
  } catch {
    return { ok: false, label: 'Store permissions', detail: `Cannot write to ${storePath}`, hint: `Run: mkdir -p ${storePath} && chmod 755 ${storePath}` };
  }
}

async function checkGit(): Promise<CheckResult> {
  if (!commandExists('git')) {
    return { ok: false, label: 'Git', detail: 'Git is not installed', hint: 'Install git: https://git-scm.com' };
  }
  try {
    const { execSync } = await import('child_process');
    execSync('git --version', { stdio: 'ignore' });
    return { ok: true, label: 'Git', detail: 'Git is installed' };
  } catch {
    return { ok: false, label: 'Git', detail: 'Git command failed', hint: 'Verify git installation' };
  }
}

async function checkSystemdOrLaunchd(): Promise<CheckResult> {
  const platform = getPlatform();
  if (platform === 'macos') {
    if (commandExists('launchctl')) {
      return { ok: true, label: 'Service manager', detail: 'launchd is available' };
    }
    return { ok: false, label: 'Service manager', detail: 'launchctl not found', hint: 'macOS should have launchd. Check PATH.' };
  }
  if (platform === 'linux') {
    if (commandExists('systemctl')) {
      return { ok: true, label: 'Service manager', detail: 'systemd is available' };
    }
    return { ok: false, label: 'Service manager', detail: 'systemctl not found', hint: 'Install systemd or use nohup fallback mode' };
  }
  return { ok: true, label: 'Service manager', detail: `${platform} — no service manager needed` };
}

export async function run(_args: string[]): Promise<void> {
  const checks: CheckResult[] = [
    await checkNodeVersion(),
    await checkContainerRuntime(),
    await checkStorePermissions(),
    await checkPort(3000, 'Dashboard port (3000)'),
    await checkGit(),
    await checkSystemdOrLaunchd(),
  ];

  const failures = checks.filter((c) => !c.ok);
  const allOk = failures.length === 0;

  logger.info({ checks: checks.map((c) => ({ ok: c.ok, label: c.label })) }, 'Environment check complete');

  emitStatus('CHECK_ENVIRONMENT', {
    STATUS: allOk ? 'success' : 'failed',
    CHECKS_TOTAL: checks.length,
    CHECKS_PASSED: checks.length - failures.length,
    CHECKS_FAILED: failures.length,
    LOG: 'logs/setup.log',
  });

  for (const c of checks) {
    const icon = c.ok ? '✓' : '✖';
    console.log(`  ${icon} ${c.label}: ${c.detail}`);
  }

  if (!allOk) {
    printRecoveryGuide('environment', `${failures.length} prerequisite check(s) failed`, failures.map((f) => f.hint || f.detail).filter(Boolean));
    process.exit(1);
  }
}
