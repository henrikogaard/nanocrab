import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  getMigrationStatus,
  isValidBackupFilename,
  listBackupStatus,
} from './backup-service.js';

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocrab-backup-'));
  fs.mkdirSync(path.join(root, 'store'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'groups'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(root, '.env'), 'ADMIN_PASSWORD_HASH=test\n');
  fs.writeFileSync(path.join(root, 'store', 'messages.db'), 'sqlite');
  fs.writeFileSync(path.join(root, 'groups', 'main.json'), '{}');
  fs.writeFileSync(
    path.join(root, 'backups', 'nanocrab-backup-2026-06-13.tar.gz'),
    'archive',
  );
  fs.writeFileSync(path.join(root, 'backups', '../ignored.txt'), 'ignored');
  return root;
}

describe('backup service', () => {
  it('lists backup inputs and existing archives', () => {
    const root = makeRoot();
    const status = listBackupStatus({
      projectRoot: root,
      storeDir: path.join(root, 'store'),
      dataDir: path.join(root, 'data'),
      groupsDir: path.join(root, 'groups'),
      backupDir: path.join(root, 'backups'),
      homeDir: root,
    });

    expect(status.backupDir).toBe(path.join(root, 'backups'));
    expect(status.backups).toEqual([
      expect.objectContaining({
        name: 'nanocrab-backup-2026-06-13.tar.gz',
      }),
    ]);
    expect(status.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '.env (credentials)', exists: true }),
        expect.objectContaining({
          label: 'store/ (database, auth, configs)',
          exists: true,
        }),
      ]),
    );
  });

  it('rejects traversal and non-archive backup filenames', () => {
    expect(isValidBackupFilename('nanocrab-backup.tar.gz')).toBe(true);
    expect(isValidBackupFilename('../nanocrab-backup.tar.gz')).toBe(false);
    expect(isValidBackupFilename('nested/nanocrab-backup.tar.gz')).toBe(false);
    expect(isValidBackupFilename('nanocrab-backup.tar.gz.enc')).toBe(false);
  });

  it('reports legacy NanoClaw state that can be migrated', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocrab-migrate-'));
    fs.mkdirSync(path.join(home, '.config', 'nanoclaw'), { recursive: true });

    const status = getMigrationStatus({ homeDir: home });

    expect(status.summary).toEqual({
      legacyFound: 1,
      readyToMigrate: 1,
      targetConflicts: 0,
    });
    expect(status.checks).toContainEqual(
      expect.objectContaining({
        id: 'config',
        status: 'ready',
      }),
    );
  });
});
