import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../../config.js';
import { auditLog } from '../security.js';

const router = Router();
const TOKENS_PATH = path.join(STORE_DIR, 'api-tokens.json');

interface ApiToken {
  id: string;
  name: string;
  tokenHash: string; // SHA-256 hash, not plaintext
  tokenPrefix: string; // first 8 chars for display
  createdAt: string;
  lastUsed: string | null;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function loadTokens(): ApiToken[] {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveTokens(tokens: ApiToken[]): void {
  fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

export function validateApiToken(token: string): boolean {
  const tokens = loadTokens();
  const hash = hashToken(token);
  // Also support legacy plaintext tokens during migration
  const found = tokens.find(
    (t) => t.tokenHash === hash || (t as any).token === token,
  );
  if (!found) return false;

  // Migrate legacy plaintext token to hashed
  if ((found as any).token && !found.tokenHash) {
    found.tokenHash = hashToken((found as any).token);
    found.tokenPrefix = (found as any).token.slice(0, 8);
    delete (found as any).token;
  }

  found.lastUsed = new Date().toISOString();
  saveTokens(tokens);
  return true;
}

// List tokens (masked)
router.get('/', (_req: Request, res: Response) => {
  const tokens = loadTokens();
  res.json(
    tokens.map((t) => ({
      id: t.id,
      name: t.name,
      token: (t.tokenPrefix || (t as any).token?.slice(0, 8) || '????') + '...',
      createdAt: t.createdAt,
      lastUsed: t.lastUsed,
    })),
  );
});

// Create new token
router.post('/', (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Name is required' });
    return;
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokens = loadTokens();
  const token: ApiToken = {
    id: crypto.randomUUID(),
    name: name.trim(),
    tokenHash: hashToken(rawToken),
    tokenPrefix: rawToken.slice(0, 8),
    createdAt: new Date().toISOString(),
    lastUsed: null,
  };

  tokens.push(token);
  saveTokens(tokens);
  auditLog(req, 'api_token_created', name);

  // Return full token only on creation — it's never stored
  res.json({ id: token.id, name: token.name, token: rawToken });
});

// Revoke token
router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const tokens = loadTokens();
  const idx = tokens.findIndex((t) => t.id === id);

  if (idx === -1) {
    res.status(404).json({ error: 'Token not found' });
    return;
  }

  const name = tokens[idx].name;
  tokens.splice(idx, 1);
  saveTokens(tokens);
  auditLog(req, 'api_token_revoked', name);

  res.json({ ok: true });
});

export default router;
