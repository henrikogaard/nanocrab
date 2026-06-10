/**
 * Express middleware for admin authentication and role-based access control.
 */
import { Request, Response, NextFunction } from 'express';
import { validateSession, getSessionUser, AdminUser } from './auth.js';
import { validateApiToken } from './routes/tokens.js';

// Extend Express Request to carry user info
declare global {
  namespace Express {
    interface Request {
      user?: AdminUser;
    }
  }
}

const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 0,
  admin: 1,
  owner: 2,
};

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) cookies[key] = rest.join('=');
  }
  return cookies;
}

export function getSessionToken(req: Request): string | null {
  const cookieHeader = req.headers.cookie || '';
  const cookies = parseCookies(cookieHeader);
  return cookies['nanocrab_session'] || null;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Check Authorization: Bearer <token> header (API tokens)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const apiToken = authHeader.slice(7);
    if (validateApiToken(apiToken)) {
      // API tokens get owner role
      req.user = { id: '__api_token__', username: 'api', role: 'owner' };
      next();
      return;
    }
  }

  const token = getSessionToken(req);

  if (!token || !validateSession(token)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Resolve user from session
  const user = getSessionUser(token);
  if (user) {
    req.user = user;
  } else {
    // Fallback for legacy sessions without user_id (single-user mode)
    req.user = { id: '__env__', username: 'admin', role: 'owner' };
  }

  next();
}

/**
 * Middleware factory that checks the user's role meets a minimum level.
 * Must be used AFTER requireAuth.
 *
 * Role hierarchy: owner > admin > viewer
 */
export function requireRole(minRole: 'viewer' | 'admin' | 'owner') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userLevel = ROLE_HIERARCHY[user.role] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[minRole] ?? 0;

    if (userLevel < requiredLevel) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
