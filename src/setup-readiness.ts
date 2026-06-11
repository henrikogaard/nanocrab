import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { CONTAINER_IMAGE, DATA_DIR, GROUPS_DIR, STORE_DIR } from './config.js';
import { CONTAINER_RUNTIME_BIN } from './container-runtime.js';
import { readEnvFile } from './env.js';

export type SetupReadinessStatus = 'pass' | 'warn' | 'fail';

export interface SetupReadinessCheck {
  id: string;
  label: string;
  status: SetupReadinessStatus;
  required: boolean;
  detail: string;
  remediation?: string;
  resumeNote?: string;
}

export interface SetupReadinessResult {
  generatedAt: string;
  productName: 'NanoCrab';
  headline: string;
  asciiArt: string[];
  overall: SetupReadinessStatus;
  failed: number;
  warnings: number;
  checks: SetupReadinessCheck[];
  setupSteps: Array<{ label: string; command: string; required: boolean }>;
  secretPolicy: string;
}

export interface SetupReadinessOptions {
  projectRoot?: string;
  storeDir?: string;
  groupsDir?: string;
  dataDir?: string;
  containerRuntimeBin?: string;
  containerImage?: string;
  env?: Record<string, string | undefined>;
  commandSucceeds?: (command: string, args: string[]) => boolean;
}

export function commandSucceeds(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function directoryWritable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.nanocrab-write-${process.pid}`);
    fs.writeFileSync(probe, 'ok', { mode: 0o600 });
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function nodeVersionSupported(version = process.versions.node): boolean {
  const major = parseInt(version.split('.')[0] || '0', 10);
  return major >= 20 && major < 26;
}

function check(
  id: string,
  label: string,
  status: SetupReadinessStatus,
  required: boolean,
  detail: string,
  remediation?: string,
  resumeNote?: string,
): SetupReadinessCheck {
  return { id, label, status, required, detail, remediation, resumeNote };
}

function envValue(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  return process.env[key] || env[key];
}

function hasAnyFile(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

export function buildSetupReadiness(
  options: SetupReadinessOptions = {},
): SetupReadinessResult {
  const projectRoot = options.projectRoot || process.cwd();
  const storeDir = options.storeDir || STORE_DIR;
  const groupsDir = options.groupsDir || GROUPS_DIR;
  const dataDir = options.dataDir || DATA_DIR;
  const runtimeBin = options.containerRuntimeBin || CONTAINER_RUNTIME_BIN;
  const image = options.containerImage || CONTAINER_IMAGE;
  const runCommand = options.commandSucceeds || commandSucceeds;
  const env =
    options.env ||
    readEnvFile([
      'ADMIN_USERNAME',
      'ADMIN_PASSWORD',
      'DEFAULT_PROVIDER',
      'GITHUB_TOKEN',
      'TELEGRAM_BOT_TOKEN',
      'SIGNAL_PHONE_NUMBER',
      'DISCORD_BOT_TOKEN',
      'SLACK_BOT_TOKEN',
      'SLACK_APP_TOKEN',
      'OPENROUTER_API_KEY',
      'GEMINI_API_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
    ]);

  const envPath = path.join(projectRoot, '.env');
  const authDir = path.join(storeDir, 'auth');
  const packageLock = path.join(projectRoot, 'package-lock.json');
  const nodeModules = path.join(projectRoot, 'node_modules');
  const distEntry = path.join(projectRoot, 'dist', 'index.js');
  const logsDir = path.join(projectRoot, 'logs');
  const envExists = fs.existsSync(envPath);
  const runtimeAvailable = runCommand(runtimeBin, ['--version']);
  const runtimeReady = runCommand(runtimeBin, ['info']);
  const imageReady = runCommand(runtimeBin, ['image', 'inspect', image]);
  const providerConfigured = [
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'OPENROUTER_API_KEY',
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
  ].some((key) => !!envValue(env, key));
  const channelConfigured =
    hasAnyFile(authDir) ||
    !!envValue(env, 'TELEGRAM_BOT_TOKEN') ||
    !!envValue(env, 'SIGNAL_PHONE_NUMBER') ||
    !!envValue(env, 'DISCORD_BOT_TOKEN') ||
    (!!envValue(env, 'SLACK_BOT_TOKEN') && !!envValue(env, 'SLACK_APP_TOKEN'));

  const checks: SetupReadinessCheck[] = [
    check(
      'node-version',
      'Supported Node.js runtime',
      nodeVersionSupported() ? 'pass' : 'fail',
      true,
      `Running ${process.version}; NanoCrab supports Node.js >=20 <26.`,
      'Install Node.js 24 LTS or another supported runtime before continuing.',
      'Rerun setup preflight after switching Node versions.',
    ),
    check(
      'package-lock',
      'Reproducible dependency lockfile',
      fs.existsSync(packageLock) ? 'pass' : 'fail',
      true,
      'package-lock.json is required for clean VPS installs.',
      'Restore package-lock.json or run npm install from a clean checkout.',
    ),
    check(
      'dependencies',
      'Installed host dependencies',
      fs.existsSync(nodeModules) ? 'pass' : 'warn',
      false,
      'node_modules is present for setup commands.',
      'Run npm install before starting the service.',
      'Setup can resume after npm install without deleting generated state.',
    ),
    check(
      'env-file',
      'Environment file',
      envExists ? 'pass' : 'warn',
      false,
      '.env stores service configuration and credential references.',
      'Run setup admin/provider/channel steps or create .env from documented values.',
      'Existing values are preserved; setup steps update individual keys.',
    ),
    check(
      'admin-auth',
      'Admin authentication configured',
      envValue(env, 'ADMIN_PASSWORD') ? 'pass' : 'warn',
      false,
      'Admin password is configured without exposing the secret value.',
      'Run npx tsx setup/index.ts --step admin to configure dashboard login.',
    ),
    check(
      'container-runtime',
      'Container runtime installed',
      runtimeAvailable ? 'pass' : 'fail',
      true,
      `${runtimeBin} must be available for isolated agent execution.`,
      'Install Docker or configure CONTAINER_RUNTIME_BIN for the service user.',
    ),
    check(
      'container-daemon',
      'Container runtime running',
      runtimeReady ? 'pass' : 'fail',
      true,
      `${runtimeBin} responded to a runtime health check.`,
      'Start the container service and make sure the NanoCrab user can access it.',
    ),
    check(
      'container-image',
      'Agent container image built',
      imageReady ? 'pass' : 'warn',
      false,
      `${image} is available locally.`,
      'Run ./container/build.sh after installing dependencies.',
      'This can be rerun safely; rebuilds reuse the container cache.',
    ),
    check(
      'store-writable',
      'Writable store directory',
      directoryWritable(storeDir) ? 'pass' : 'fail',
      true,
      storeDir,
      'Fix ownership/permissions for the NanoCrab service user.',
    ),
    check(
      'groups-writable',
      'Writable groups directory',
      directoryWritable(groupsDir) ? 'pass' : 'fail',
      true,
      groupsDir,
      'Fix ownership/permissions for the NanoCrab service user.',
    ),
    check(
      'data-writable',
      'Writable data directory',
      directoryWritable(dataDir) ? 'pass' : 'fail',
      true,
      dataDir,
      'Fix ownership/permissions for the NanoCrab service user.',
    ),
    check(
      'logs-writable',
      'Writable logs directory',
      directoryWritable(logsDir) ? 'pass' : 'warn',
      false,
      logsDir,
      'Create logs/ or fix permissions so setup failures are diagnosable.',
    ),
    check(
      'provider-config',
      'Provider credential path',
      providerConfigured ? 'pass' : 'warn',
      false,
      'At least one provider credential or OAuth token is configured.',
      'Run the provider setup step for Claude, Codex, OpenRouter, Google, or OpenAI.',
    ),
    check(
      'channel-config',
      'Channel credential path',
      channelConfigured ? 'pass' : 'warn',
      false,
      'At least one channel credential/session is configured.',
      'Run a channel setup step, for example whatsapp-auth, signal-auth, or telegram configuration.',
    ),
    check(
      'built-output',
      'Built server output',
      fs.existsSync(distEntry) ? 'pass' : 'warn',
      false,
      'dist/index.js is present for npm start/systemd runs.',
      'Run npm run build before starting the production service.',
    ),
  ];

  const failed = checks.filter((item) => item.status === 'fail').length;
  const warnings = checks.filter((item) => item.status === 'warn').length;

  return {
    generatedAt: new Date().toISOString(),
    productName: 'NanoCrab',
    headline: 'First-run readiness for clean VPS installs',
    asciiArt: [
      '  _   _                   ____          _     ',
      ' | \\ | | __ _ _ __   ___ / ___|_ __ __ _| |__  ',
      " |  \\| |/ _` | '_ \\ / _ \\ |   | '__/ _` | '_ \\ ",
      ' | |\\  | (_| | | | | (_) | |___| | | (_| | |_) |',
      ' |_| \\_|\\__,_|_| |_|\\___/ \\____|_|  \\__,_|_.__/ ',
    ],
    overall: failed > 0 ? 'fail' : warnings > 0 ? 'warn' : 'pass',
    failed,
    warnings,
    checks,
    setupSteps: [
      {
        label: 'Preflight',
        command: 'npx tsx setup/index.ts --step preflight',
        required: true,
      },
      { label: 'Install dependencies', command: 'npm install', required: true },
      {
        label: 'Configure admin login',
        command: 'npm run setup -- --step admin',
        required: true,
      },
      {
        label: 'Configure provider',
        command: 'npm run setup -- --step provider',
        required: true,
      },
      { label: 'Build host app', command: 'npm run build', required: true },
      {
        label: 'Build agent container',
        command: './container/build.sh',
        required: true,
      },
      {
        label: 'Verify installation',
        command: 'npm run setup -- --step verify',
        required: true,
      },
    ],
    secretPolicy:
      'Readiness checks report only whether credentials exist. Secret values are never returned to the dashboard, setup logs, or agent containers.',
  };
}
