#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const dryRun = process.argv.includes('--dry-run');
const homeArg = process.argv.find((arg) => arg.startsWith('--home='));
const home = homeArg ? path.resolve(homeArg.slice('--home='.length)) : os.homedir();
const pairs = [
  [path.join(home, '.config', 'nanoclaw'), path.join(home, '.config', 'nanocrab')],
  [path.join(home, 'Library', 'LaunchAgents', 'com.nanoclaw.plist'), path.join(home, 'Library', 'LaunchAgents', 'com.nanocrab.plist')],
];

function moveIfNeeded(from, to) {
  if (!fs.existsSync(from)) return false;
  if (fs.existsSync(to)) {
    const backup = `${from}.migrated-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    if (!dryRun) fs.renameSync(from, backup);
    console.log(`${dryRun ? '[dry-run] ' : ''}Existing target found; backed up ${from} -> ${backup}`);
    return true;
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}Moved ${from} -> ${to}`);
  return true;
}

let changed = false;
for (const [from, to] of pairs) changed = moveIfNeeded(from, to) || changed;

try {
  if (!dryRun) {
    execFileSync('docker', ['image', 'tag', 'nanoclaw-agent:latest', 'nanocrab-agent:latest'], { stdio: 'ignore' });
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}Tagged Docker image nanoclaw-agent:latest -> nanocrab-agent:latest`);
  changed = true;
} catch {
  // Docker may not be installed or the old image may not exist.
}

if (!changed) console.log('No legacy NanoClaw state found to migrate.');
