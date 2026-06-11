/**
 * Security middleware: rate limiting, headers, audit logging, IP allowlist.
 */
import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

import { logger } from '../logger.js';

// --- Rate Limiting (persistent via SQLite) ---

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const WINDOW_MS = 5 * 60 * 1000; // 5-minute sliding window

let rateLimitDb: Database.Database;

export function initRateLimiter(database: Database.Database): void {
  rateLimitDb = database;
}

function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

export function rateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const ip = getClientIp(req);
  const now = Date.now();

  const row = rateLimitDb
    .prepare(
      'SELECT attempts, last_attempt, locked_until FROM rate_limits WHERE ip = ?',
    )
    .get(ip) as
    | { attempts: number; last_attempt: string; locked_until: string | null }
    | undefined;

  if (row) {
    const lockedUntil = row.locked_until
      ? new Date(row.locked_until).getTime()
      : 0;

    // Check if locked out
    if (lockedUntil > now) {
      const remaining = Math.ceil((lockedUntil - now) / 60000);
      logger.warn({ ip, remaining }, 'Login rate limited');
      res.status(429).json({
        error: `Too many attempts. Try again in ${remaining} minute${remaining > 1 ? 's' : ''}.`,
      });
      return;
    }

    // Reset if outside window
    const lastAttempt = new Date(row.last_attempt).getTime();
    if (now - lastAttempt > WINDOW_MS) {
      rateLimitDb.prepare('DELETE FROM rate_limits WHERE ip = ?').run(ip);
    }
  }

  next();
}

export function recordLoginAttempt(ip: string, success: boolean): void {
  if (success) {
    rateLimitDb.prepare('DELETE FROM rate_limits WHERE ip = ?').run(ip);
    return;
  }

  const now = new Date().toISOString();

  const row = rateLimitDb
    .prepare('SELECT attempts FROM rate_limits WHERE ip = ?')
    .get(ip) as { attempts: number } | undefined;

  const attempts = (row?.attempts || 0) + 1;
  const lockedUntil =
    attempts >= MAX_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_MS).toISOString()
      : null;

  if (attempts >= MAX_ATTEMPTS) {
    logger.warn(
      { ip, attempts },
      'Account locked due to failed login attempts',
    );
  }

  rateLimitDb
    .prepare(
      `INSERT INTO rate_limits (ip, attempts, last_attempt, locked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET
         attempts = excluded.attempts,
         last_attempt = excluded.last_attempt,
         locked_until = excluded.locked_until`,
    )
    .run(ip, attempts, now, lockedUntil);
}

// --- API Rate Limiting ---

const apiRequestCounts = new Map<string, { count: number; resetAt: number }>();
const API_RATE_LIMIT = 200;
const API_RATE_WINDOW_MS = 60000;

export function apiRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = apiRequestCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    apiRequestCounts.set(ip, { count: 1, resetAt: now + API_RATE_WINDOW_MS });
    next();
    return;
  }

  entry.count++;
  if (entry.count > API_RATE_LIMIT) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }
  next();
}

// --- Security Headers ---

export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // HSTS — force HTTPS for 1 year
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains',
  );
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Prevent MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // XSS protection (legacy browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // CSP — allow self, inline scripts (SPA), Google Fonts, WebSocket
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://cdn.jsdelivr.net https://unpkg.com",
      "connect-src 'self' wss: ws: https://cdn.jsdelivr.net https://*.tile.openstreetmap.org",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  // Permissions policy
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );

  next();
}

// --- Audit Logging ---

const AUDIT_LOG_PATH = path.join(process.cwd(), 'logs', 'admin-audit.log');

export interface AuditEntry {
  timestamp: string;
  ip: string;
  action: string;
  details?: string;
  userAgent?: string;
}

export function auditLog(req: Request, action: string, details?: string): void {
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    ip: getClientIp(req),
    action,
    details,
    userAgent: req.headers['user-agent']?.slice(0, 120),
  };

  try {
    fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (err) {
    logger.warn({ err }, 'Failed to write audit log');
  }
}

export function getAuditLog(limit = 100): AuditEntry[] {
  try {
    const content = fs.readFileSync(AUDIT_LOG_PATH, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as AuditEntry[];
  } catch {
    return [];
  }
}

// --- IP Allowlist ---

const ALLOWLIST_PATH = path.join(
  process.cwd(),
  'store',
  'admin-ip-allowlist.json',
);

interface IpAllowlist {
  enabled: boolean;
  ips: string[];
}

function loadAllowlist(): IpAllowlist {
  try {
    return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf-8'));
  } catch {
    return { enabled: false, ips: [] };
  }
}

function saveAllowlist(list: IpAllowlist): void {
  fs.mkdirSync(path.dirname(ALLOWLIST_PATH), { recursive: true });
  fs.writeFileSync(ALLOWLIST_PATH, JSON.stringify(list, null, 2));
}

export function ipAllowlist(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const list = loadAllowlist();
  if (!list.enabled || list.ips.length === 0) {
    next();
    return;
  }

  const clientIp = getClientIp(req);
  const allowed = list.ips.some((ip) => {
    // Support CIDR notation (e.g., 192.168.1.0/24) or exact match
    if (ip.includes('/')) {
      return isIpInCidr(clientIp, ip);
    }
    return clientIp === ip;
  });

  if (!allowed) {
    logger.warn({ ip: clientIp }, 'Admin access denied by IP allowlist');
    auditLog(req, 'ip_blocked', `IP ${clientIp} not in allowlist`);
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  next();
}

function isIpInCidr(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits)) - 1);
  const ipNum = ipToNum(ip);
  const rangeNum = ipToNum(range);
  return (
    ipNum !== null && rangeNum !== null && (ipNum & mask) === (rangeNum & mask)
  );
}

function ipToNum(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;
  return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
}

// --- IP Allowlist Management ---

export function getAllowlist(): IpAllowlist {
  return loadAllowlist();
}

export function setAllowlist(list: IpAllowlist): void {
  saveAllowlist(list);
}
