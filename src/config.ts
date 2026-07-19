import os from 'os';
import path from 'path';

import { isAgentProvider } from './agent-provider.js';
import { readEnvFile } from './env.js';
import { isValidTimezone } from './timezone.js';

// Read config values from .env (falls back to process.env).
// Secrets (API keys, tokens) are NOT read here — they are loaded only
// by the credential proxy (credential-proxy.ts), never exposed to containers.
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'TZ',
  'SKILLS_SH_API_BASE_URL',
  'CODING_JOB_RUNNER_TIMEOUT_MS',
  'DEVIN_CREDENTIAL_PATH',
  'DEVIN_CLI_MODEL_ALIASES_JSON',
]);

export const DEVIN_BUILTIN_MODEL_ALIASES = Object.freeze({
  'claude/claude-sonnet-4-6': 'claude-sonnet-4',
  'claude/claude-opus-4-6': 'claude-opus-4.6',
});

const DEVIN_ALIAS_KEY = /^([a-z0-9-]+)\/(\S+)$/;

function rejectDuplicateJsonObjectKeys(raw: string): void {
  let index = 0;

  const skipWhitespace = (): void => {
    while (/\s/.test(raw[index] ?? '')) index += 1;
  };

  const scanString = (): string => {
    const start = index;
    index += 1;
    let escaped = false;
    while (index < raw.length) {
      const character = raw[index++]!;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        return JSON.parse(raw.slice(start, index)) as string;
      }
    }
    throw new Error('DEVIN_CLI_MODEL_ALIASES_JSON must be valid JSON');
  };

  const scanValue = (): void => {
    skipWhitespace();
    const character = raw[index];
    if (character === '"') {
      scanString();
      return;
    }
    if (character === '{') {
      index += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (raw[index] === '}') {
        index += 1;
        return;
      }
      while (index < raw.length) {
        skipWhitespace();
        if (raw[index] !== '"') {
          throw new Error('DEVIN_CLI_MODEL_ALIASES_JSON must be valid JSON');
        }
        const key = scanString();
        if (keys.has(key)) {
          throw new Error(
            `DEVIN_CLI_MODEL_ALIASES_JSON contains duplicate key ${key}`,
          );
        }
        keys.add(key);
        skipWhitespace();
        index += 1; // ':'; JSON.parse already validated the token.
        scanValue();
        skipWhitespace();
        if (raw[index] === '}') {
          index += 1;
          return;
        }
        index += 1; // ','; JSON.parse already validated the token.
      }
      throw new Error('DEVIN_CLI_MODEL_ALIASES_JSON must be valid JSON');
    }
    if (character === '[') {
      index += 1;
      skipWhitespace();
      if (raw[index] === ']') {
        index += 1;
        return;
      }
      while (index < raw.length) {
        scanValue();
        skipWhitespace();
        if (raw[index] === ']') {
          index += 1;
          return;
        }
        index += 1; // ','; JSON.parse already validated the token.
      }
      throw new Error('DEVIN_CLI_MODEL_ALIASES_JSON must be valid JSON');
    }
    while (index < raw.length && !/[,}\]]/.test(raw[index]!)) index += 1;
  };

  scanValue();
}

export function parseDevinCliModelAliases(
  raw: string | undefined,
): Readonly<Record<string, string>> {
  if (!raw?.trim()) {
    return Object.freeze({ ...DEVIN_BUILTIN_MODEL_ALIASES });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_err) {
    throw new Error('DEVIN_CLI_MODEL_ALIASES_JSON must be valid JSON', {
      cause: _err,
    });
  }

  rejectDuplicateJsonObjectKeys(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('DEVIN_CLI_MODEL_ALIASES_JSON must be a JSON object');
  }

  const operatorAliases: Record<string, string> = {};
  for (const [key, alias] of Object.entries(parsed)) {
    const match = key.match(DEVIN_ALIAS_KEY);
    if (!match) {
      throw new Error(
        `DEVIN_CLI_MODEL_ALIASES_JSON key ${key} must use provider/model format`,
      );
    }
    if (!isAgentProvider(match[1])) {
      throw new Error(
        `DEVIN_CLI_MODEL_ALIASES_JSON key ${key} uses unknown provider ${match[1]}`,
      );
    }
    if (Object.hasOwn(DEVIN_BUILTIN_MODEL_ALIASES, key)) {
      throw new Error(
        `DEVIN_CLI_MODEL_ALIASES_JSON cannot override built-in alias ${key}`,
      );
    }
    if (typeof alias !== 'string' || !alias.trim()) {
      throw new Error(
        `DEVIN_CLI_MODEL_ALIASES_JSON alias for ${key} must be a non-empty string`,
      );
    }
    operatorAliases[key] = alias;
  }

  return Object.freeze({
    ...DEVIN_BUILTIN_MODEL_ALIASES,
    ...operatorAliases,
  });
}

export function parsePositiveMilliseconds(
  raw: string | undefined,
  fallback: number,
  key: string,
): number {
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer number of milliseconds`);
  }
  return parsed;
}

function parseAbsolutePath(
  raw: string | undefined,
  key: string,
): string | null {
  if (!raw?.trim()) return null;
  if (!path.isAbsolute(raw)) {
    throw new Error(`${key} must be an absolute path`);
  }
  return raw;
}

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER ||
    envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || os.homedir();

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanocrab',
  'mount-allowlist.json',
);
export const SENDER_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanocrab',
  'sender-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const SESSIONS_DIR = path.resolve(STORE_DIR, 'sessions');
export const TERMINAL_IDLE_TIMEOUT_MS = parseInt(
  process.env.TERMINAL_IDLE_TIMEOUT_MS || '7200000',
  10,
); // 2 hours default
export const MAX_SESSION_LOG_BYTES = parseInt(
  process.env.MAX_SESSION_LOG_BYTES || '10485760',
  10,
); // 10 MB default
export const MAX_SESSION_RETENTION_DAYS = parseInt(
  process.env.MAX_SESSION_RETENTION_DAYS || '90',
  10,
); // 90 days default
export const MAX_SESSIONS_COUNT = parseInt(
  process.env.MAX_SESSIONS_COUNT || '100',
  10,
); // max session index entries
export const SESSION_PRUNE_INTERVAL_MS = parseInt(
  process.env.SESSION_PRUNE_INTERVAL_MS || '21600000',
  10,
); // 6 hours default — enforce retention on long-running servers
export const CODING_WORKSPACE_DIR = path.resolve(DATA_DIR, 'coding-workspaces');
export const CONTAINER_SKILLS_DIR = path.resolve(
  PROJECT_ROOT,
  'container',
  'skills',
);
export const SKILLS_SH_API_BASE_URL =
  process.env.SKILLS_SH_API_BASE_URL ||
  envConfig.SKILLS_SH_API_BASE_URL ||
  'https://www.skills.sh/api';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanocrab-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CODING_JOB_RUNNER_TIMEOUT_MS = parsePositiveMilliseconds(
  process.env.CODING_JOB_RUNNER_TIMEOUT_MS ||
    envConfig.CODING_JOB_RUNNER_TIMEOUT_MS,
  CONTAINER_TIMEOUT,
  'CODING_JOB_RUNNER_TIMEOUT_MS',
);
export const DEVIN_CREDENTIAL_PATH = parseAbsolutePath(
  process.env.DEVIN_CREDENTIAL_PATH || envConfig.DEVIN_CREDENTIAL_PATH,
  'DEVIN_CREDENTIAL_PATH',
);
export const DEVIN_CLI_MODEL_ALIASES = parseDevinCliModelAliases(
  process.env.DEVIN_CLI_MODEL_ALIASES_JSON ||
    envConfig.DEVIN_CLI_MODEL_ALIASES_JSON,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const CREDENTIAL_PROXY_PORT = parseInt(
  process.env.CREDENTIAL_PROXY_PORT || '3001',
  10,
);
export const MAX_MESSAGES_PER_PROMPT = Math.max(
  1,
  parseInt(process.env.MAX_MESSAGES_PER_PROMPT || '10', 10) || 10,
);
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildTriggerPattern(trigger: string): RegExp {
  return new RegExp(`^${escapeRegex(trigger.trim())}\\b`, 'i');
}

export const DEFAULT_TRIGGER = `@${ASSISTANT_NAME}`;

export function getTriggerPattern(trigger?: string): RegExp {
  const normalizedTrigger = trigger?.trim();
  return buildTriggerPattern(normalizedTrigger || DEFAULT_TRIGGER);
}

export const TRIGGER_PATTERN = buildTriggerPattern(DEFAULT_TRIGGER);

// Timezone for scheduled tasks, message formatting, etc.
// Validates each candidate is a real IANA identifier before accepting.
function resolveConfigTimezone(): string {
  const candidates = [
    process.env.TZ,
    envConfig.TZ,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];
  for (const tz of candidates) {
    if (tz && isValidTimezone(tz)) return tz;
  }
  return 'UTC';
}
export const TIMEZONE = resolveConfigTimezone();
