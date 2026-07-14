const LEVELS = { debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } as const;
type Level = keyof typeof LEVELS;

const COLORS: Record<Level, string> = {
  debug: '\x1b[34m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  fatal: '\x1b[41m\x1b[37m',
};
const KEY_COLOR = '\x1b[35m';
const MSG_COLOR = '\x1b[36m';
const RESET = '\x1b[39m';
const FULL_RESET = '\x1b[0m';

const threshold =
  LEVELS[(process.env.LOG_LEVEL as Level) || 'info'] ?? LEVELS.info;

const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|passwd|pwd|secret|token|api[_-]?key|apikey|auth[_-]?token|credential[_-]?proxy|credentialproxy)/i;
const STREAMING_SENSITIVE_KEYS = [
  'credential_proxy',
  'credential-proxy',
  'credentialproxy',
  'authorization',
  'api_key',
  'api-key',
  'apikey',
  'password',
  'cookie',
  'token',
] as const;
const STREAMING_TOKEN_DELIMITER = /[\s"',&]/;
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/g,
  /\bsk-[A-Za-z0-9._-]+/g,
  /\/__nanocrab\/providers\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/g,
  /\b(credential[_-]?proxy|authorization|cookie|password|token|api[_-]?key)(\s*[:=]\s*)(?!Bearer(?:\s|$))[^\s"',&]+/gi,
];

export function redactLogString(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, (match, key, sep) => {
      if (typeof key === 'string' && typeof sep === 'string') {
        return `${key}${sep}[REDACTED]`;
      }
      if (match.startsWith('/__nanocrab/providers/')) {
        return '/__nanocrab/providers/[REDACTED]';
      }
      if (match.startsWith('Bearer ')) return 'Bearer [REDACTED]';
      if (match.startsWith('sk-')) return 'sk-[REDACTED]';
      return '[REDACTED]';
    });
  }
  return redacted;
}

export interface StreamingLogRedactor {
  write(chunk: string): string;
  flush(): string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactKnownSecrets(value: string, secrets: RegExp | null): string {
  return secrets ? value.replace(secrets, '[REDACTED]') : value;
}

function isWordBoundary(value: string, index: number): boolean {
  return index === 0 || !/[A-Za-z0-9_]/.test(value[index - 1]);
}

function isSensitiveAssignmentPrefix(value: string): boolean {
  const lower = value.toLowerCase();
  return STREAMING_SENSITIVE_KEYS.some((key) => {
    if (lower.length < key.length) return key.startsWith(lower);
    if (!lower.startsWith(key)) return false;

    const remainder = value.slice(key.length);
    return /^\s*$/.test(remainder) || /^\s*[:=]\s*$/.test(remainder);
  });
}

function findOpenSuffix(
  value: string,
  knownSecrets: readonly string[],
): number {
  let earliest = value.length;
  const openPatterns = [
    /\bBearer\s+[^\s"',&]*$/,
    /\bsk-[^\s"',&]*$/,
    /\/__nanocrab\/providers\/[^\s"',&]*$/,
    new RegExp(
      `\\b(?:${STREAMING_SENSITIVE_KEYS.map(escapeRegExp).join('|')})(?:\\s*[:=]\\s*)[^\\s"',&]*$`,
      'i',
    ),
  ];

  for (const pattern of openPatterns) {
    const match = pattern.exec(value);
    if (match?.index != null) earliest = Math.min(earliest, match.index);
  }

  const fixedPrefixes = [
    'Bearer ',
    'sk-',
    '/__nanocrab/providers/',
    ...knownSecrets,
  ];
  for (const prefix of fixedPrefixes) {
    for (let length = 1; length < prefix.length; length += 1) {
      if (value.endsWith(prefix.slice(0, length))) {
        earliest = Math.min(earliest, value.length - length);
      }
    }
  }

  for (let index = 0; index < value.length; index += 1) {
    if (
      isWordBoundary(value, index) &&
      isSensitiveAssignmentPrefix(value.slice(index))
    ) {
      earliest = Math.min(earliest, index);
      break;
    }
  }

  return earliest;
}

export function createStreamingLogRedactor(options?: {
  knownSecrets?: readonly string[];
  carryLength?: number;
}): StreamingLogRedactor {
  const knownSecrets = [...new Set(options?.knownSecrets ?? [])]
    .filter((value) => value.length >= 8)
    .sort((left, right) => right.length - left.length);
  const knownSecretPattern = knownSecrets.length
    ? new RegExp(knownSecrets.map(escapeRegExp).join('|'), 'g')
    : null;
  const longestKnownSecret = knownSecrets[0]?.length ?? 0;
  const carryLength = Math.max(
    1,
    Math.floor(options?.carryLength ?? 4_096),
    longestKnownSecret,
  );
  let carry = '';
  let discardingOpenToken = false;
  let flushed = false;

  const redact = (value: string): string =>
    redactLogString(redactKnownSecrets(value, knownSecretPattern));

  return {
    write(chunk: string): string {
      if (flushed) {
        throw new Error(
          'Cannot write after streaming log redactor has been flushed',
        );
      }

      if (discardingOpenToken) {
        const delimiterIndex = chunk.search(STREAMING_TOKEN_DELIMITER);
        if (delimiterIndex === -1) return '';
        chunk = chunk.slice(delimiterIndex);
        discardingOpenToken = false;
      }

      carry += chunk;
      carry = redactKnownSecrets(carry, knownSecretPattern);
      const openSuffix = findOpenSuffix(carry, knownSecrets);
      const completePrefix = carry.slice(0, openSuffix);
      carry = carry.slice(openSuffix);
      let output = redact(completePrefix);

      if (carry.length >= carryLength) {
        const redactedCarry = redact(carry);
        output += redactedCarry === carry ? '[REDACTED]' : redactedCarry;
        carry = '';
        discardingOpenToken = true;
      }

      return output;
    },

    flush(): string {
      if (flushed) return '';
      flushed = true;
      const output = redact(carry);
      carry = '';
      discardingOpenToken = false;
      return output;
    },
  };
}

export function redactLogValue(value: unknown): unknown {
  if (typeof value === 'string') return redactLogString(value);
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    const err = new Error(redactLogString(value.message));
    err.name = value.name;
    err.stack = value.stack ? redactLogString(value.stack) : value.stack;
    return err;
  }
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : redactLogValue(item);
  }
  return out;
}

function formatErr(err: unknown): string {
  err = redactLogValue(err);
  if (err instanceof Error) {
    return `{\n      "type": "${err.constructor.name}",\n      "message": "${err.message}",\n      "stack":\n          ${err.stack}\n    }`;
  }
  return JSON.stringify(redactLogValue(err));
}

function formatData(data: Record<string, unknown>): string {
  let out = '';
  for (const [k, v] of Object.entries(data)) {
    if (k === 'err') {
      out += `\n    ${KEY_COLOR}err${RESET}: ${formatErr(v)}`;
    } else {
      out += `\n    ${KEY_COLOR}${k}${RESET}: ${JSON.stringify(redactLogValue(v))}`;
    }
  }
  return out;
}

function ts(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function log(
  level: Level,
  dataOrMsg: Record<string, unknown> | string,
  msg?: string,
): void {
  if (LEVELS[level] < threshold) return;
  const tag = `${COLORS[level]}${level.toUpperCase()}${level === 'fatal' ? FULL_RESET : RESET}`;
  const stream = LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout;
  if (typeof dataOrMsg === 'string') {
    stream.write(
      `[${ts()}] ${tag} (${process.pid}): ${MSG_COLOR}${redactLogString(dataOrMsg)}${RESET}\n`,
    );
  } else {
    stream.write(
      `[${ts()}] ${tag} (${process.pid}): ${MSG_COLOR}${redactLogString(msg || '')}${RESET}${formatData(dataOrMsg)}\n`,
    );
  }
}

export const logger = {
  debug: (dataOrMsg: Record<string, unknown> | string, msg?: string) =>
    log('debug', dataOrMsg, msg),
  info: (dataOrMsg: Record<string, unknown> | string, msg?: string) =>
    log('info', dataOrMsg, msg),
  warn: (dataOrMsg: Record<string, unknown> | string, msg?: string) =>
    log('warn', dataOrMsg, msg),
  error: (dataOrMsg: Record<string, unknown> | string, msg?: string) =>
    log('error', dataOrMsg, msg),
  fatal: (dataOrMsg: Record<string, unknown> | string, msg?: string) =>
    log('fatal', dataOrMsg, msg),
};

// Route uncaught errors through logger so they get timestamps in stderr
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});
