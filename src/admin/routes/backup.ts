import express, { Router, Request, Response } from 'express';
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR, DATA_DIR, GROUPS_DIR } from '../../config.js';
import { auditLog } from '../security.js';
import { logger } from '../../logger.js';
import {
  defaultBackupDir,
  formatBackupSize,
  getBackupPaths,
  getMigrationStatus,
  isValidBackupFilename,
  listBackupStatus,
  restoreGuide,
} from '../../backup-service.js';

const router = Router();
const PROJECT_ROOT = process.cwd();
const BACKUP_DIR = defaultBackupDir({ projectRoot: PROJECT_ROOT });

// List what would be backed up + existing backups
router.get('/', (_req: Request, res: Response) => {
  res.json(
    listBackupStatus({
      projectRoot: PROJECT_ROOT,
      storeDir: STORE_DIR,
      dataDir: DATA_DIR,
      groupsDir: GROUPS_DIR,
      backupDir: BACKUP_DIR,
    }),
  );
});

// Create a backup
router.post('/', (req: Request, res: Response) => {
  const { includeAll } = req.body;
  auditLog(req, 'backup_created', includeAll ? 'full' : 'essential');

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `nanocrab-backup-${timestamp}.tar.gz`;
  const filepath = path.join(BACKUP_DIR, filename);

  const paths = getBackupPaths({
    projectRoot: PROJECT_ROOT,
    storeDir: STORE_DIR,
    dataDir: DATA_DIR,
    groupsDir: GROUPS_DIR,
  })
    .filter((p) => includeAll || p.critical)
    .map((p) => p.path)
    .filter((p) => fs.existsSync(p));

  if (paths.length === 0) {
    res.status(400).json({ error: 'No data to back up' });
    return;
  }

  try {
    execFileSync('tar', ['-czf', filepath, ...paths], {
      timeout: 120000,
    });

    const stat = fs.statSync(filepath);
    logger.info({ filename, size: stat.size }, 'Backup created');

    res.json({
      ok: true,
      filename,
      size: stat.size,
      sizeFormatted: formatBackupSize(stat.size),
      path: filepath,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'Backup failed');
    res.status(500).json({ error: `Backup failed: ${msg.slice(0, 200)}` });
  }
});

// Download a backup (plain)
router.get('/download/:filename', (req: Request, res: Response) => {
  const filename = req.params.filename as string;
  if (!isValidBackupFilename(filename)) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }

  auditLog(req, 'backup_downloaded', filename);
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  fs.createReadStream(filepath).pipe(res);
});

// Download encrypted backup (AES-256-GCM)
router.post('/download-encrypted/:filename', (req: Request, res: Response) => {
  const filename = req.params.filename as string;
  const { passphrase } = req.body;
  if (!passphrase || passphrase.length < 8) {
    res.status(400).json({ error: 'Passphrase required (min 8 characters)' });
    return;
  }
  if (!isValidBackupFilename(filename)) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }

  try {
    const data = fs.readFileSync(filepath);
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(passphrase, salt, 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: salt(16) + iv(12) + tag(16) + encrypted data
    const output = Buffer.concat([salt, iv, tag, encrypted]);

    auditLog(req, 'backup_downloaded_encrypted', filename);
    const encName = filename.replace('.tar.gz', '.tar.gz.enc');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encName}"`);
    res.send(output);
  } catch (err: any) {
    res.status(500).json({ error: 'Encryption failed' });
  }
});

// Decrypt an uploaded backup
router.post(
  '/decrypt',
  express.raw({ limit: '500mb', type: 'application/octet-stream' }),
  (req: Request, res: Response) => {
    const passphrase = req.headers['x-passphrase'] as string;
    if (!passphrase) {
      res.status(400).json({ error: 'X-Passphrase header required' });
      return;
    }

    try {
      const data = req.body as Buffer;
      if (data.length < 44) {
        res.status(400).json({ error: 'Invalid encrypted file' });
        return;
      }
      const salt = data.subarray(0, 16);
      const iv = data.subarray(16, 28);
      const tag = data.subarray(28, 44);
      const encrypted = data.subarray(44);
      const key = crypto.scryptSync(passphrase, salt, 32);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      res.setHeader('Content-Type', 'application/gzip');
      res.send(decrypted);
    } catch {
      res.status(400).json({ error: 'Decryption failed — wrong passphrase?' });
    }
  },
);

// Delete a backup
router.delete('/:filename', (req: Request, res: Response) => {
  const filename = req.params.filename as string;
  if (!isValidBackupFilename(filename)) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }

  fs.unlinkSync(filepath);
  auditLog(req, 'backup_deleted', filename);
  res.json({ ok: true });
});

// Restore instructions (actual restore is manual for safety)
router.get('/restore-guide', (_req: Request, res: Response) => {
  res.json(restoreGuide());
});

router.get('/migration-status', (_req: Request, res: Response) => {
  res.json(getMigrationStatus({ projectRoot: PROJECT_ROOT }));
});

// --- Auto-backup configuration ---

const AUTO_BACKUP_CONFIG_PATH = path.join(STORE_DIR, 'backup-auto.json');

interface AutoBackupConfig {
  enabled: boolean;
  schedule: string;
  keepCount: number;
}

function loadAutoConfig(): AutoBackupConfig {
  try {
    return JSON.parse(fs.readFileSync(AUTO_BACKUP_CONFIG_PATH, 'utf-8'));
  } catch {
    return { enabled: false, schedule: 'weekly', keepCount: 4 };
  }
}

function saveAutoConfig(config: AutoBackupConfig): void {
  fs.mkdirSync(path.dirname(AUTO_BACKUP_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(AUTO_BACKUP_CONFIG_PATH, JSON.stringify(config, null, 2));
}

router.get('/auto-config', (_req: Request, res: Response) => {
  res.json(loadAutoConfig());
});

router.put('/auto-config', (req: Request, res: Response) => {
  const { enabled, schedule, keepCount } = req.body;
  const config: AutoBackupConfig = {
    enabled: !!enabled,
    schedule: schedule === 'daily' ? 'daily' : 'weekly',
    keepCount: Math.max(1, Math.min(20, parseInt(keepCount) || 4)),
  };
  saveAutoConfig(config);
  auditLog(
    req,
    'auto_backup_config',
    `enabled: ${config.enabled}, schedule: ${config.schedule}, keep: ${config.keepCount}`,
  );
  res.json({ ok: true });
});

/**
 * Check if an automatic backup is due and create one if so.
 * Called on an interval from index.ts.
 */
export async function checkAutoBackup(): Promise<void> {
  const config = loadAutoConfig();
  if (!config.enabled) return;

  const intervalMs =
    config.schedule === 'daily' ? 24 * 3600000 : 7 * 24 * 3600000;

  // Check last backup time
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const existing = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.tar.gz'))
    .sort()
    .reverse();

  if (existing.length > 0) {
    const latestStat = fs.statSync(path.join(BACKUP_DIR, existing[0]));
    if (Date.now() - latestStat.mtimeMs < intervalMs) {
      return; // Not yet due
    }
  }

  // Create backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `nanocrab-auto-${timestamp}.tar.gz`;
  const filepath = path.join(BACKUP_DIR, filename);

  const paths = getBackupPaths({
    projectRoot: PROJECT_ROOT,
    storeDir: STORE_DIR,
    dataDir: DATA_DIR,
    groupsDir: GROUPS_DIR,
  })
    .filter((p) => p.critical)
    .map((p) => p.path)
    .filter((p) => fs.existsSync(p));

  if (paths.length === 0) return;

  try {
    execFileSync('tar', ['-czf', filepath, ...paths], { timeout: 120000 });
    logger.info({ filename }, 'Auto-backup created');
  } catch (err) {
    logger.error({ err }, 'Auto-backup failed');
    return;
  }

  // Prune old auto-backups beyond keepCount
  const autoBackups = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('nanocrab-auto-') && f.endsWith('.tar.gz'))
    .sort()
    .reverse();

  for (let i = config.keepCount; i < autoBackups.length; i++) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, autoBackups[i]));
      logger.info({ file: autoBackups[i] }, 'Pruned old auto-backup');
    } catch {
      /* ignore */
    }
  }
}

export default router;
