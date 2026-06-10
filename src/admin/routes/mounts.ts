import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

import { MOUNT_ALLOWLIST_PATH } from '../../config.js';
import { clearAllowlistCache } from '../../mount-security.js';
import { auditLog } from '../security.js';

const router = Router();

const DEFAULT_ALLOWLIST = {
  allowedRoots: [],
  blockedPatterns: [
    '.ssh',
    '.gnupg',
    '.aws',
    '.docker',
    'credentials',
    '.env',
    '.netrc',
    'id_rsa',
    'id_ed25519',
  ],
  nonMainReadOnly: true,
};

router.get('/', (_req: Request, res: Response) => {
  try {
    if (fs.existsSync(MOUNT_ALLOWLIST_PATH)) {
      const content = JSON.parse(
        fs.readFileSync(MOUNT_ALLOWLIST_PATH, 'utf-8'),
      );
      res.json(content);
    } else {
      res.json(DEFAULT_ALLOWLIST);
    }
  } catch {
    res.json(DEFAULT_ALLOWLIST);
  }
});

router.put('/', (req: Request, res: Response) => {
  const { allowedRoots, blockedPatterns, nonMainReadOnly } = req.body;
  if (!Array.isArray(allowedRoots) || !Array.isArray(blockedPatterns)) {
    res.status(400).json({ error: 'Invalid allowlist format' });
    return;
  }

  const allowlist = {
    allowedRoots: allowedRoots.map(
      (r: {
        path: string;
        allowReadWrite?: boolean;
        description?: string;
      }) => ({
        path: r.path,
        allowReadWrite: !!r.allowReadWrite,
        description: r.description || '',
      }),
    ),
    blockedPatterns,
    nonMainReadOnly: nonMainReadOnly !== false,
  };

  try {
    fs.mkdirSync(path.dirname(MOUNT_ALLOWLIST_PATH), { recursive: true });
    fs.writeFileSync(MOUNT_ALLOWLIST_PATH, JSON.stringify(allowlist, null, 2));
    clearAllowlistCache();
    auditLog(
      req,
      'mount_allowlist_updated',
      `${allowedRoots.length} roots, ${blockedPatterns.length} blocked patterns`,
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write allowlist' });
  }
});

router.get('/validate', (req: Request, res: Response) => {
  const hostPath = req.query.hostPath as string;
  if (!hostPath) {
    res.status(400).json({ error: 'hostPath query param required' });
    return;
  }

  const resolved = hostPath.replace(/^~/, process.env.HOME || '/root');
  if (!fs.existsSync(resolved)) {
    res.json({ valid: false, error: 'Path does not exist' });
    return;
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      res.json({ valid: false, error: 'Path is not a directory' });
      return;
    }
    res.json({ valid: true, resolvedPath: resolved });
  } catch {
    res.json({ valid: false, error: 'Cannot access path' });
  }
});

export default router;
