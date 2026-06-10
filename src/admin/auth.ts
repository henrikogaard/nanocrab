/**
 * Admin authentication: password verification and session management.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';

import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { getState } from './state.js';

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

let db: Database.Database;

export function initAuth(database: Database.Database): void {
  db = database;
  // Clean expired sessions on startup
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(
    new Date().toISOString(),
  );
}

export function getAuthDb(): Database.Database {
  return db;
}

function getPasswordHash(): string {
  const envVars = readEnvFile(['ADMIN_PASSWORD_HASH']);
  const hash =
    process.env.ADMIN_PASSWORD_HASH || envVars.ADMIN_PASSWORD_HASH || '';
  if (!hash) {
    throw new Error('ADMIN_PASSWORD_HASH not set in .env');
  }
  return hash;
}

function getUsername(): string {
  const envVars = readEnvFile(['ADMIN_USERNAME']);
  return process.env.ADMIN_USERNAME || envVars.ADMIN_USERNAME || 'admin';
}

export interface AdminUser {
  id: string;
  username: string;
  role: 'owner' | 'admin' | 'viewer';
}

/**
 * Check if multi-user mode is active (admin_users table has entries).
 */
export function isMultiUserMode(): boolean {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM admin_users').get() as {
    cnt: number;
  };
  return row.cnt > 0;
}

/**
 * Get user by ID from admin_users table.
 */
export function getUserById(id: string): AdminUser | null {
  const row = db
    .prepare('SELECT id, username, role FROM admin_users WHERE id = ?')
    .get(id) as AdminUser | undefined;
  return row || null;
}

/**
 * Get the user associated with a session token.
 * Assumes the session has already been validated by requireAuth.
 * In single-user mode (no admin_users rows), returns a synthetic owner.
 */
export function getSessionUser(token: string): AdminUser | null {
  const session = db
    .prepare('SELECT user_id FROM admin_sessions WHERE token = ?')
    .get(token) as { user_id: string | null } | undefined;

  if (!session) return null;

  // If session has a user_id, look up multi-user
  if (session.user_id) {
    return getUserById(session.user_id);
  }

  // Single-user mode: return synthetic owner
  return { id: '__env__', username: getUsername(), role: 'owner' };
}

export async function verifyLogin(
  username: string,
  password: string,
): Promise<{ valid: boolean; user?: AdminUser }> {
  // Multi-user mode: check admin_users table first
  if (isMultiUserMode()) {
    const row = db
      .prepare(
        'SELECT id, username, password_hash, role FROM admin_users WHERE username = ?',
      )
      .get(username) as
      | { id: string; username: string; password_hash: string; role: string }
      | undefined;
    if (row) {
      const valid = await bcrypt.compare(password, row.password_hash);
      if (valid) {
        // Update last_login
        db.prepare('UPDATE admin_users SET last_login = ? WHERE id = ?').run(
          new Date().toISOString(),
          row.id,
        );
        return {
          valid: true,
          user: {
            id: row.id,
            username: row.username,
            role: row.role as AdminUser['role'],
          },
        };
      }
      return { valid: false };
    }
  }

  // Fall back to env-based single-user auth
  if (username !== getUsername()) return { valid: false };
  const hash = getPasswordHash();
  const valid = await bcrypt.compare(password, hash);
  if (valid) {
    return {
      valid: true,
      user: { id: '__env__', username: getUsername(), role: 'owner' },
    };
  }
  return { valid: false };
}

export async function verifyPassword(password: string): Promise<boolean> {
  const hash = getPasswordHash();
  return bcrypt.compare(password, hash);
}

export function createSession(
  userAgent: string,
  ipAddress: string,
  userId?: string,
): string {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS);

  db.prepare(
    'INSERT INTO admin_sessions (token, created_at, expires_at, user_agent, ip_address, user_id) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    token,
    now.toISOString(),
    expiresAt.toISOString(),
    userAgent,
    ipAddress,
    userId || null,
  );

  // Notify via bot
  notifyLogin(ipAddress, userAgent).catch((err) =>
    logger.warn({ err }, 'Failed to send login notification'),
  );

  return token;
}

export function validateSession(token: string): boolean {
  const row = db
    .prepare('SELECT expires_at FROM admin_sessions WHERE token = ?')
    .get(token) as { expires_at: string } | undefined;

  if (!row) return false;

  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
    return false;
  }

  // Sliding window: extend session on each validation
  const newExpiry = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
  db.prepare('UPDATE admin_sessions SET expires_at = ? WHERE token = ?').run(
    newExpiry,
    token,
  );

  return true;
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
}

export function getSessionCookieMaxAge(): number {
  return SESSION_MAX_AGE_MS / 1000; // in seconds for Set-Cookie
}

async function notifyLogin(ip: string, userAgent: string): Promise<void> {
  try {
    const state = getState();
    const groups = state.registeredGroups();

    // Find the main group
    const mainEntry = Object.entries(groups).find(([, g]) => g.isMain);
    if (!mainEntry) return;

    const [mainJid] = mainEntry;
    const time = new Date().toLocaleString('en-GB', {
      timeZone: 'Europe/Oslo',
    });
    const shortUA =
      userAgent.length > 80 ? userAgent.slice(0, 80) + '...' : userAgent;

    await state.sendMessage(
      mainJid,
      `Admin dashboard login\nIP: ${ip}\nTime: ${time}\nDevice: ${shortUA}`,
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to send login notification');
  }
}

/**
 * Change the admin password. Updates .env file in place.
 */
export async function changePassword(newPassword: string): Promise<void> {
  const hash = await bcrypt.hash(newPassword, 12);
  updateEnvVar('ADMIN_PASSWORD_HASH', hash);
  logger.info('Admin password changed');
}

/**
 * Update or add an env var in .env and process.env.
 */
export function updateEnvVar(key: string, value: string): void {
  const envPath = path.join(process.cwd(), '.env');
  let content = fs.readFileSync(envPath, 'utf-8');

  // Match both active and commented-out versions
  const activeRegex = new RegExp(`^${key}=.*$`, 'm');
  const commentedRegex = new RegExp(`^#\\s*${key}=.*$`, 'm');

  if (activeRegex.test(content)) {
    content = content.replace(activeRegex, `${key}=${value}`);
  } else if (commentedRegex.test(content)) {
    content = content.replace(commentedRegex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }

  fs.writeFileSync(envPath, content, { mode: 0o600 });
  process.env[key] = value;
}

/**
 * Remove (comment out) an env var from .env and process.env.
 */
export function removeEnvVar(key: string): void {
  const envPath = path.join(process.cwd(), '.env');
  let content = fs.readFileSync(envPath, 'utf-8');

  const regex = new RegExp(`^${key}=(.*)$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `# ${key}=`);
    fs.writeFileSync(envPath, content, { mode: 0o600 });
  }
  delete process.env[key];
}
