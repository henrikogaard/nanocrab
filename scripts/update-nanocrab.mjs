#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const repo = process.env.NANOCRAB_UPDATE_REPO || 'henrikogaard/nanocrab';
const remote = process.env.NANOCRAB_UPDATE_REMOTE || 'origin';
const allowDirty = process.env.NANOCRAB_UPDATE_ALLOW_DIRTY === '1';
const skipInstall = process.env.NANOCRAB_UPDATE_SKIP_INSTALL === '1';
const skipBuild = process.env.NANOCRAB_UPDATE_SKIP_BUILD === '1';
const skipContainerBuild =
  process.env.NANOCRAB_UPDATE_SKIP_CONTAINER_BUILD === '1';
const skipRestart = process.env.NANOCRAB_UPDATE_SKIP_RESTART === '1';

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function run(command, args, options = {}) {
  log(`$ ${[command, ...args].join(' ')}`);
  execFileSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
}

function capture(command, args) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  }).trim();
}

function assertSafeTag(tag) {
  if (!tag || tag.startsWith('-') || !/^[A-Za-z0-9._/-]+$/.test(tag)) {
    throw new Error(`Refusing unsafe release tag: ${tag}`);
  }
}

async function fetchLatestRelease() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'nanocrab-updater',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token =
    process.env.NANOCRAB_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(
    `https://api.github.com/repos/${repo}/releases/latest`,
    { headers },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.message ? `: ${body.message}` : '';
    throw new Error(`GitHub latest release lookup failed${detail}`);
  }
  if (!body.tag_name) {
    throw new Error('GitHub latest release response did not include tag_name');
  }
  return body;
}

function ensureCleanWorktree() {
  const status = capture('git', ['status', '--porcelain']);
  if (status && !allowDirty) {
    throw new Error(
      [
        'Refusing to update because the worktree has uncommitted changes.',
        'Commit/stash changes first, or run with NANOCRAB_UPDATE_ALLOW_DIRTY=1 if you know what you are doing.',
      ].join(' '),
    );
  }
}

function installDependencies() {
  if (skipInstall) {
    log('Skipping npm install step');
    return;
  }
  if (fs.existsSync(path.join(projectRoot, 'package-lock.json'))) {
    run('npm', ['ci']);
  } else {
    run('npm', ['install']);
  }
}

function buildHost() {
  if (skipBuild) {
    log('Skipping host build step');
    return;
  }
  run('npm', ['run', 'build']);
}

function buildContainer() {
  if (skipContainerBuild) {
    log('Skipping agent container build step');
    return;
  }
  const buildScript = path.join(projectRoot, 'container', 'build.sh');
  if (!fs.existsSync(buildScript)) {
    log('No container/build.sh found; skipping agent container build');
    return;
  }
  run(buildScript, ['latest']);
}

function restartService() {
  if (skipRestart) {
    log('Skipping service restart step');
    return;
  }
  const explicitService = process.env.NANOCRAB_SERVICE_NAME;
  const candidates = explicitService ? [explicitService] : ['nanocrab'];
  for (const serviceName of candidates) {
    try {
      run('systemctl', ['--user', 'restart', serviceName], {
        stdio: 'pipe',
      });
      log(`Restarted systemd user service: ${serviceName}`);
      return;
    } catch (err) {
      log(`Could not restart ${serviceName}: ${err.message}`);
    }
  }
  log(
    'No systemd user service was restarted. Set NANOCRAB_SERVICE_NAME if your service uses a custom name.',
  );
}

async function main() {
  log(`NanoCrab updater starting in ${projectRoot}`);
  log(`Release source: github.com/${repo}`);

  ensureCleanWorktree();

  const currentCommit = capture('git', ['rev-parse', '--short', 'HEAD']);
  const currentTag = (() => {
    try {
      return capture('git', ['describe', '--tags', '--exact-match']);
    } catch {
      return '';
    }
  })();
  log(
    `Current commit: ${currentCommit}${currentTag ? ` (${currentTag})` : ''}`,
  );

  const release = await fetchLatestRelease();
  const tag = release.tag_name;
  assertSafeTag(tag);
  log(`Latest GitHub release: ${release.name || tag} (${tag})`);

  if (currentTag === tag) {
    log('Already on the latest release tag. Nothing to update.');
    return;
  }

  run('git', ['fetch', remote, '--tags', '--prune']);
  const releaseCommit = capture('git', [
    'rev-parse',
    '--verify',
    `refs/tags/${tag}^{commit}`,
  ]);
  log(`Release commit: ${releaseCommit.slice(0, 12)}`);

  run('git', ['checkout', '--detach', releaseCommit]);
  installDependencies();
  buildHost();
  buildContainer();
  restartService();

  log(`NanoCrab update complete: ${tag}`);
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] Update failed: ${err.message}`);
  process.exit(1);
});
