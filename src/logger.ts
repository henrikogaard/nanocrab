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
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/g,
  /\bsk-[A-Za-z0-9._-]+/g,
  /\/__nanocrab\/providers\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/g,
  /\b(credential[_-]?proxy|authorization|cookie|password|token|api[_-]?key)(\s*[:=]\s*)[^\s"',&]+/gi,
];

export function redactLogString(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, (match, key, sep) => {
      if (key && sep) return `${key}${sep}[REDACTED]`;
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
