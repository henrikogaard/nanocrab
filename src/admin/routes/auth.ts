import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import {
  verifyLogin,
  verifyPassword,
  createSession,
  deleteSession,
  getSessionCookieMaxAge,
  changePassword,
  getAuthDb,
  _isMultiUserMode,
} from '../auth.js';
import { getSessionToken, requireAuth, requireRole } from '../middleware.js';
import {
  rateLimit,
  recordLoginAttempt,
  auditLog,
  getAuditLog,
  getAllowlist,
  setAllowlist,
} from '../security.js';
import { STORE_DIR } from '../../config.js';
import {
  buildAuditReplay,
  type AuditReplaySource,
} from '../../audit-replay.js';

const TOTP_PATH = path.join(STORE_DIR, 'totp.json');

interface TotpConfig {
  enabled: boolean;
  secret: string; // base32
}

function loadTotp(): TotpConfig | null {
  try {
    return JSON.parse(fs.readFileSync(TOTP_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveTotp(config: TotpConfig): void {
  fs.mkdirSync(path.dirname(TOTP_PATH), { recursive: true });
  fs.writeFileSync(TOTP_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function verifyTotp(token: string): boolean {
  const config = loadTotp();
  if (!config?.enabled) return true; // 2FA not enabled
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(config.secret),
    digits: 6,
    period: 30,
  });
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}

const router = Router();

// Login — rate limited, audited
router.post('/login', rateLimit, async (req: Request, res: Response) => {
  const { username, password } = req.body;
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  const result = await verifyLogin(username, password);
  recordLoginAttempt(ip, result.valid);

  if (!result.valid) {
    auditLog(req, 'login_failed', `username: ${username}`);
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  // Check 2FA if enabled
  const totpConfig = loadTotp();
  const { totp: totpCode } = req.body;
  if (totpConfig?.enabled) {
    if (!totpCode) {
      res.json({ ok: false, requires2fa: true });
      return;
    }
    if (!verifyTotp(totpCode)) {
      auditLog(req, 'login_2fa_failed', `username: ${username}`);
      res.status(401).json({ error: 'Invalid 2FA code' });
      return;
    }
  }

  auditLog(req, 'login_success', `username: ${username}`);
  const ua = req.headers['user-agent'] || 'unknown';
  const userId = result.user?.id !== '__env__' ? result.user?.id : undefined;
  const token = createSession(ua, ip, userId);
  const maxAge = getSessionCookieMaxAge();

  res.setHeader(
    'Set-Cookie',
    `nanocrab_session=${token}; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`,
  );
  res.json({ ok: true });
});

router.post('/logout', requireAuth, (req: Request, res: Response) => {
  const token = getSessionToken(req);
  if (token) deleteSession(token);
  auditLog(req, 'logout');

  res.setHeader(
    'Set-Cookie',
    'nanocrab_session=; Secure; SameSite=Strict; Path=/; Max-Age=0',
  );
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = req.user;
  res.json({
    authenticated: true,
    username: user?.username || 'admin',
    role: user?.role || 'owner',
  });
});

router.post(
  '/change-password',
  requireAuth,
  async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current and new password required' });
      return;
    }
    if (newPassword.length < 12) {
      res
        .status(400)
        .json({ error: 'New password must be at least 12 characters' });
      return;
    }
    if (
      !/[A-Z]/.test(newPassword) ||
      !/[a-z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword)
    ) {
      res.status(400).json({
        error:
          'Password must contain uppercase, lowercase, and at least one number',
      });
      return;
    }

    const valid = await verifyPassword(currentPassword);
    if (!valid) {
      auditLog(req, 'password_change_failed', 'wrong current password');
      res.status(400).json({ error: 'Current password is incorrect' });
      return;
    }

    await changePassword(newPassword);
    auditLog(req, 'password_changed');
    res.json({ ok: true });
  },
);

// --- 2FA Management ---

router.get('/2fa/status', requireAuth, (_req: Request, res: Response) => {
  const config = loadTotp();
  res.json({ enabled: config?.enabled || false });
});

// Generate new TOTP secret + QR code
router.post('/2fa/setup', requireAuth, async (_req: Request, res: Response) => {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: 'NanoCrab',
    label: 'Admin',
    secret,
    digits: 6,
    period: 30,
  });
  const uri = totp.toString();
  const qr = await QRCode.toDataURL(uri);
  // Store secret but don't enable yet — user must verify first
  saveTotp({ enabled: false, secret: secret.base32 });
  res.json({ qr, secret: secret.base32, uri });
});

// Verify a code to enable 2FA
router.post('/2fa/enable', requireAuth, (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) {
    res.status(400).json({ error: 'Code required' });
    return;
  }
  const config = loadTotp();
  if (!config) {
    res.status(400).json({ error: 'Run setup first' });
    return;
  }
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(config.secret),
    digits: 6,
    period: 30,
  });
  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    res.status(400).json({ error: 'Invalid code. Try again.' });
    return;
  }
  saveTotp({ enabled: true, secret: config.secret });
  auditLog(req, '2fa_enabled');
  res.json({ ok: true });
});

// Disable 2FA (requires current password)
router.post(
  '/2fa/disable',
  requireAuth,
  async (req: Request, res: Response) => {
    const { password } = req.body;
    if (!password) {
      res.status(400).json({ error: 'Password required' });
      return;
    }
    const valid = await verifyPassword(password);
    if (!valid) {
      res.status(401).json({ error: 'Wrong password' });
      return;
    }
    saveTotp({ enabled: false, secret: '' });
    auditLog(req, '2fa_disabled');
    res.json({ ok: true });
  },
);

// Audit log
router.get('/audit/replay', requireAuth, (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const sources = (req.query.sources as string | undefined)
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean) as AuditReplaySource[] | undefined;
  res.json(
    buildAuditReplay({ adminEvents: getAuditLog(limit), limit, sources }),
  );
});

router.get('/audit', requireAuth, (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  res.json(getAuditLog(limit));
});

// IP allowlist management
router.get('/allowlist', requireAuth, (_req: Request, res: Response) => {
  res.json(getAllowlist());
});

router.put('/allowlist', requireAuth, (req: Request, res: Response) => {
  const { enabled, ips } = req.body;
  if (typeof enabled !== 'boolean' || !Array.isArray(ips)) {
    res.status(400).json({ error: 'Invalid allowlist format' });
    return;
  }
  setAllowlist({ enabled, ips });
  auditLog(
    req,
    'allowlist_updated',
    `enabled: ${enabled}, ips: ${ips.join(', ')}`,
  );
  res.json({ ok: true });
});

// --- User Management (owner only) ---

router.get(
  '/users',
  requireAuth,
  requireRole('owner'),
  (_req: Request, res: Response) => {
    const db = getAuthDb();
    const users = db
      .prepare(
        'SELECT id, username, role, created_at, last_login FROM admin_users ORDER BY created_at ASC',
      )
      .all();
    res.json(users);
  },
);

router.post(
  '/users',
  requireAuth,
  requireRole('owner'),
  async (req: Request, res: Response) => {
    const { username, password, role } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }
    if (!['owner', 'admin', 'viewer'].includes(role)) {
      res
        .status(400)
        .json({ error: 'Invalid role. Must be owner, admin, or viewer' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const db = getAuthDb();

    // Check username not taken (also check env username)
    const existing = db
      .prepare('SELECT id FROM admin_users WHERE username = ?')
      .get(username);
    if (existing) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }

    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);

    db.prepare(
      'INSERT INTO admin_users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, username, passwordHash, role, new Date().toISOString());

    auditLog(req, 'user_created', `username: ${username}, role: ${role}`);
    res.json({ ok: true, id, username, role });
  },
);

router.put(
  '/users/:id',
  requireAuth,
  requireRole('owner'),
  (req: Request, res: Response) => {
    const { id } = req.params;
    const { role } = req.body;

    if (!['owner', 'admin', 'viewer'].includes(role)) {
      res
        .status(400)
        .json({ error: 'Invalid role. Must be owner, admin, or viewer' });
      return;
    }

    const db = getAuthDb();
    const user = db
      .prepare('SELECT id, username FROM admin_users WHERE id = ?')
      .get(id) as { id: string; username: string } | undefined;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    db.prepare('UPDATE admin_users SET role = ? WHERE id = ?').run(role, id);
    auditLog(
      req,
      'user_role_changed',
      `username: ${user.username}, new role: ${role}`,
    );
    res.json({ ok: true });
  },
);

router.delete(
  '/users/:id',
  requireAuth,
  requireRole('owner'),
  (req: Request, res: Response) => {
    const { id } = req.params;

    // Can't delete yourself
    if (req.user?.id === id) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }

    const db = getAuthDb();
    const user = db
      .prepare('SELECT id, username FROM admin_users WHERE id = ?')
      .get(id) as { id: string; username: string } | undefined;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    db.prepare('DELETE FROM admin_users WHERE id = ?').run(id);
    // Also delete their sessions
    db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(id);
    auditLog(req, 'user_deleted', `username: ${user.username}`);
    res.json({ ok: true });
  },
);

export default router;
