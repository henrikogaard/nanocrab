import { execFileSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';

import {
  AGENT_PROVIDER_DEFINITIONS,
  AgentProvider,
  isAgentProvider,
} from './agent-provider.js';
import { getCodexAuthStatus } from './codex-auth.js';
import { CREDENTIAL_PROXY_PORT } from './config.js';
import { redactLogValue } from './logger.js';

export type SetupPreflightSeverity = 'required' | 'advisory';

export interface SetupPreflightCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: SetupPreflightSeverity;
  detail: string;
  hint?: string;
}

export interface SetupPreflightResult {
  ok: boolean;
  checks: SetupPreflightCheck[];
}

export interface SetupPreflightOptions {
  projectRoot?: string;
  env?: Record<string, string | undefined>;
  commandExists?: (command: string) => boolean;
  runCommand?: (
    command: string,
    args: string[],
  ) => { ok: boolean; detail: string };
  isPortAvailable?: (port: number) => Promise<boolean>;
  nodeVersion?: string;
  dryRun?: boolean;
  occupiedPortsOk?: number[];
}

const SECRET_ENV_KEYS = [
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD_HASH',
  'DEFAULT_PROVIDER',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'MISTRAL_API_KEY',
  'OPENAI_COMPATIBLE_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'SIGNAL_PHONE_NUMBER',
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'DISCORD_BOT_TOKEN',
  'WHATSAPP_PHONE_NUMBER',
  'ADMIN_PORT',
  'CREDENTIAL_PROXY_PORT',
];

function defaultCommandExists(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function defaultRunCommand(
  command: string,
  args: string[],
): { ok: boolean; detail: string } {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 10000,
    }).trim();
    return { ok: true, detail: output || `${command} ${args.join(' ')}` };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export function detectContainerRuntime(
  commandExists: (command: string) => boolean = defaultCommandExists,
  runCommand: (
    command: string,
    args: string[],
  ) => { ok: boolean; detail: string } = defaultRunCommand,
): '' | 'docker' | 'apple-container' {
  if (commandExists('docker') && runCommand('docker', ['info']).ok) {
    return 'docker';
  }
  if (commandExists('container')) return 'apple-container';
  return '';
}

async function defaultPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

function parseEnvFile(projectRoot: string): Record<string, string> {
  const envPath = path.join(projectRoot, '.env');
  let content = '';
  try {
    content = fs.readFileSync(envPath, 'utf-8');
  } catch {
    return {};
  }

  const parsed: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!SECRET_ENV_KEYS.includes(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function getEnv(
  key: string,
  provided: Record<string, string | undefined>,
  fileEnv: Record<string, string>,
): string {
  return provided[key] || fileEnv[key] || process.env[key] || '';
}

function parseNodeMajor(version: string): number | null {
  const match = version.match(/^v?(\d+)/);
  return match ? Number(match[1]) : null;
}

function canWriteDirectory(targetPath: string, createProbe: boolean): boolean {
  try {
    if (fs.existsSync(targetPath)) {
      fs.accessSync(targetPath, fs.constants.W_OK);
      if (createProbe) {
        const probe = path.join(targetPath, `.setup-write-test-${process.pid}`);
        fs.writeFileSync(probe, '');
        fs.unlinkSync(probe);
      }
      return true;
    }
    fs.accessSync(path.dirname(targetPath), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function canWriteFile(targetPath: string, createProbe: boolean): boolean {
  try {
    if (fs.existsSync(targetPath)) {
      fs.accessSync(targetPath, fs.constants.W_OK);
      return true;
    }
    fs.accessSync(path.dirname(targetPath), fs.constants.W_OK);
    if (createProbe) {
      fs.writeFileSync(targetPath, '');
      fs.unlinkSync(targetPath);
    }
    return true;
  } catch {
    return false;
  }
}

function hasWhatsAppAuth(projectRoot: string): boolean {
  try {
    const authDir = path.join(projectRoot, 'store', 'auth');
    return fs.existsSync(authDir) && fs.readdirSync(authDir).length > 0;
  } catch {
    return false;
  }
}

function providerCredentialReady(
  provider: AgentProvider,
  env: (key: string) => string,
): { ok: boolean; detail: string; hint?: string } {
  if (provider === 'ollama') {
    return { ok: true, detail: 'Ollama uses a local base URL' };
  }
  if (provider === 'claude') {
    const ready = Boolean(
      env('ANTHROPIC_API_KEY') ||
      env('CLAUDE_CODE_OAUTH_TOKEN') ||
      env('ANTHROPIC_AUTH_TOKEN'),
    );
    return {
      ok: ready,
      detail: ready
        ? 'Claude credentials are configured'
        : 'Claude credentials are missing',
      hint: 'Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in .env or the service environment',
    };
  }
  if (provider === 'codex') {
    const auth = getCodexAuthStatus();
    return {
      ok: auth.configured || auth.hasHostAuth,
      detail: auth.configured
        ? 'Codex OAuth is configured for containers'
        : auth.hasHostAuth
          ? 'Host Codex OAuth can be imported'
          : 'Codex OAuth is not configured',
      hint: `Run CODEX_HOME=${auth.persistedDir} codex login --device-auth`,
    };
  }
  if (provider === 'opencode') {
    return {
      ok: true,
      detail: 'OpenCode can use its persisted auth/config or provider env vars',
    };
  }

  const definition = AGENT_PROVIDER_DEFINITIONS[provider];
  const envKey = definition.envKey;
  if (!definition.requiresAuth || !envKey) {
    return {
      ok: true,
      detail: `${definition.name} does not require an API key`,
    };
  }

  return {
    ok: Boolean(env(envKey)),
    detail: env(envKey) ? `${envKey} is configured` : `${envKey} is missing`,
    hint: `Set ${envKey} in .env or the service environment`,
  };
}

function redactCheck(check: SetupPreflightCheck): SetupPreflightCheck {
  return redactLogValue(check) as SetupPreflightCheck;
}

export async function runSetupPreflight(
  options: SetupPreflightOptions = {},
): Promise<SetupPreflightResult> {
  const projectRoot = options.projectRoot || process.cwd();
  const fileEnv = parseEnvFile(projectRoot);
  const providedEnv = options.env || {};
  const env = (key: string) => getEnv(key, providedEnv, fileEnv);
  const commandExists = options.commandExists || defaultCommandExists;
  const runCommand = options.runCommand || defaultRunCommand;
  const isPortAvailable = options.isPortAvailable || defaultPortAvailable;
  const checks: SetupPreflightCheck[] = [];

  const nodeMajor = parseNodeMajor(options.nodeVersion || process.version);
  checks.push({
    id: 'node',
    label: 'Node.js',
    ok: nodeMajor != null && nodeMajor >= 20 && nodeMajor < 26,
    severity: 'required',
    detail:
      nodeMajor == null
        ? 'Could not detect Node.js version'
        : `Node ${nodeMajor}.x detected`,
    hint: 'Use Node.js >=20 and <26',
  });

  const npmExists = commandExists('npm');
  const npmVersion = npmExists ? runCommand('npm', ['--version']) : null;
  checks.push({
    id: 'npm',
    label: 'npm',
    ok: npmExists && Boolean(npmVersion?.ok),
    severity: 'required',
    detail: npmExists
      ? `npm ${npmVersion?.detail || 'is available'}`
      : 'npm is not installed',
    hint: 'Install npm with Node.js',
  });

  const dockerExists = commandExists('docker');
  const containerExists = commandExists('container');
  const dockerInfo = dockerExists ? runCommand('docker', ['info']) : null;
  checks.push({
    id: 'container-runtime',
    label: 'Container runtime',
    ok: Boolean(dockerInfo?.ok || containerExists),
    severity: 'required',
    detail: dockerInfo?.ok
      ? 'Docker is installed and running'
      : containerExists
        ? 'Apple Container is available'
        : dockerExists
          ? 'Docker is installed but not running'
          : 'Docker or Apple Container is not installed',
    hint: 'Start Docker or install a supported container runtime',
  });

  const adminPort = Number(env('ADMIN_PORT') || '9744');
  const proxyPort = Number(
    env('CREDENTIAL_PROXY_PORT') || CREDENTIAL_PROXY_PORT,
  );
  const occupiedPortsOk = new Set(options.occupiedPortsOk || []);
  for (const [id, label, port] of [
    ['admin-port', 'Admin dashboard port', adminPort],
    ['credential-proxy-port', 'Credential proxy port', proxyPort],
  ] as const) {
    const validPort = Number.isInteger(port) && port > 0;
    const available = validPort ? await isPortAvailable(port) : false;
    const acceptedOccupied =
      validPort && !available && occupiedPortsOk.has(port);
    checks.push({
      id,
      label,
      ok: validPort && (available || acceptedOccupied),
      severity: 'required',
      detail: !validPort
        ? `Invalid port: ${String(port)}`
        : available
          ? `Port ${port} is available`
          : acceptedOccupied
            ? `Port ${port} is in use by running NanoCrab`
            : `Port ${port} is in use`,
      hint: `Free port ${port} or configure a different ${id}`,
    });
  }

  for (const [id, label, target] of [
    ['project-writable', 'Project directory permissions', projectRoot],
    [
      'logs-writable',
      'Logs directory permissions',
      path.join(projectRoot, 'logs'),
    ],
    [
      'store-writable',
      'Store directory permissions',
      path.join(projectRoot, 'store'),
    ],
    [
      'data-writable',
      'Data directory permissions',
      path.join(projectRoot, 'data'),
    ],
  ] as const) {
    checks.push({
      id,
      label,
      ok: canWriteDirectory(target, !options.dryRun),
      severity: 'required',
      detail: `${target} is ${canWriteDirectory(target, false) ? 'writable' : 'not writable'}`,
      hint: `Fix ownership or permissions for ${target}`,
    });
  }

  const envPath = path.join(projectRoot, '.env');
  checks.push({
    id: 'env-writable',
    label: '.env writability',
    ok: canWriteFile(envPath, !options.dryRun),
    severity: 'required',
    detail: fs.existsSync(envPath)
      ? '.env exists and is writable'
      : '.env can be created',
    hint: 'Create .env or fix project directory permissions',
  });

  const hasAdminAuth = Boolean(
    env('ADMIN_USERNAME') && env('ADMIN_PASSWORD_HASH'),
  );
  checks.push({
    id: 'admin-auth',
    label: 'Admin auth configuration',
    ok: hasAdminAuth,
    severity: 'required',
    detail: hasAdminAuth
      ? 'ADMIN_USERNAME and ADMIN_PASSWORD_HASH are configured'
      : 'Admin username/password hash are not configured',
    hint: 'Run setup admin with --username and --password before container build',
  });

  const rawProvider = env('DEFAULT_PROVIDER') || 'claude';
  const provider = isAgentProvider(rawProvider) ? rawProvider : 'claude';
  const providerReady = providerCredentialReady(provider, env);
  checks.push({
    id: 'provider-credentials',
    label: 'Provider credential readiness',
    ok: providerReady.ok,
    severity: 'required',
    detail: `${provider}: ${providerReady.detail}`,
    hint: providerReady.hint,
  });

  const channelReady =
    hasWhatsAppAuth(projectRoot) ||
    Boolean(
      env('TELEGRAM_BOT_TOKEN') ||
      env('SIGNAL_PHONE_NUMBER') ||
      env('SLACK_BOT_TOKEN') ||
      env('DISCORD_BOT_TOKEN'),
    );
  checks.push({
    id: 'channel-credentials',
    label: 'Channel credential readiness',
    ok: channelReady,
    severity: 'required',
    detail: channelReady
      ? 'At least one channel has credentials or auth state'
      : 'No channel credentials or auth state found',
    hint: 'Configure WhatsApp auth, TELEGRAM_BOT_TOKEN, SIGNAL_PHONE_NUMBER, Slack, or Discord',
  });

  const redactedChecks = checks.map(redactCheck);
  return {
    ok: redactedChecks.every(
      (check) => check.ok || check.severity === 'advisory',
    ),
    checks: redactedChecks,
  };
}
