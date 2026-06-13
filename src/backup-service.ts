import fs from 'fs';
import os from 'os';
import path from 'path';

import { DATA_DIR, GROUPS_DIR, STORE_DIR } from './config.js';

export interface BackupPath {
  path: string;
  label: string;
  critical: boolean;
}

export interface BackupItem extends BackupPath {
  exists: boolean;
  size: number;
  sizeFormatted: string;
}

export interface BackupArchive {
  name: string;
  size: number;
  sizeFormatted: string;
  created: string;
}

export interface BackupStatus {
  items: BackupItem[];
  totalSize: number;
  totalSizeFormatted: string;
  backups: BackupArchive[];
  backupDir: string;
}

export interface MigrationCheck {
  id: string;
  label: string;
  legacyPath: string;
  targetPath: string;
  legacyExists: boolean;
  targetExists: boolean;
  status: 'not-needed' | 'ready' | 'target-exists';
  detail: string;
}

export interface MigrationStatus {
  command: string;
  checks: MigrationCheck[];
  summary: {
    legacyFound: number;
    readyToMigrate: number;
    targetConflicts: number;
  };
}

export interface BackupServiceOptions {
  projectRoot?: string;
  storeDir?: string;
  dataDir?: string;
  groupsDir?: string;
  backupDir?: string;
  homeDir?: string;
}

function projectRoot(options: BackupServiceOptions): string {
  return options.projectRoot || process.cwd();
}

export function defaultBackupDir(options: BackupServiceOptions = {}): string {
  return options.backupDir || path.join(projectRoot(options), 'backups');
}

export function formatBackupSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(1) + ' GB';
}

export function getBackupPaths(
  options: BackupServiceOptions = {},
): BackupPath[] {
  const root = projectRoot(options);
  const home = options.homeDir || process.env.HOME || '/root';
  return [
    {
      path: path.join(root, '.env'),
      label: '.env (credentials)',
      critical: true,
    },
    {
      path: path.join(root, '.mcp.json'),
      label: '.mcp.json',
      critical: false,
    },
    {
      path: options.storeDir || STORE_DIR,
      label: 'store/ (database, auth, configs)',
      critical: true,
    },
    {
      path: options.groupsDir || GROUPS_DIR,
      label: 'groups/ (memory, conversations, attachments)',
      critical: true,
    },
    {
      path: options.dataDir || DATA_DIR,
      label: 'data/ (sessions, codex)',
      critical: false,
    },
    {
      path: path.join(root, 'site'),
      label: 'site/ (landing page)',
      critical: false,
    },
    {
      path: path.join(root, 'logs'),
      label: 'logs/ (system logs)',
      critical: false,
    },
    {
      path: path.join(home, '.config', 'nanocrab'),
      label: '~/.config/nanocrab/ (mount allowlist)',
      critical: false,
    },
    {
      path: path.join(home, '.local', 'share', 'signal-cli'),
      label: '~/.local/share/signal-cli/ (Signal account)',
      critical: true,
    },
  ];
}

export function getPathSize(targetPath: string): number {
  try {
    if (!fs.existsSync(targetPath)) return 0;
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    return fs
      .readdirSync(targetPath)
      .reduce(
        (sum, entry) => sum + getPathSize(path.join(targetPath, entry)),
        0,
      );
  } catch {
    return 0;
  }
}

export function isValidBackupFilename(filename: string): boolean {
  return (
    !filename.includes('..') &&
    !filename.includes('/') &&
    !filename.includes('\\') &&
    filename.endsWith('.tar.gz')
  );
}

export function listBackupStatus(
  options: BackupServiceOptions = {},
): BackupStatus {
  const backupDir = defaultBackupDir(options);
  const items = getBackupPaths(options).map((item) => {
    const size = getPathSize(item.path);
    return {
      ...item,
      exists: fs.existsSync(item.path),
      size,
      sizeFormatted: formatBackupSize(size),
    };
  });

  const backups: BackupArchive[] = [];
  try {
    if (fs.existsSync(backupDir)) {
      for (const file of fs
        .readdirSync(backupDir)
        .filter((name) => isValidBackupFilename(name))
        .sort()
        .reverse()) {
        const stat = fs.statSync(path.join(backupDir, file));
        backups.push({
          name: file,
          size: stat.size,
          sizeFormatted: formatBackupSize(stat.size),
          created: stat.mtime.toISOString(),
        });
      }
    }
  } catch {
    /* ok */
  }

  const totalSize = items.reduce((sum, item) => sum + item.size, 0);
  return {
    items,
    totalSize,
    totalSizeFormatted: formatBackupSize(totalSize),
    backups,
    backupDir,
  };
}

export function restoreGuide(): { steps: string[]; notes: string[] } {
  return {
    steps: [
      '1. Stop NanoCrab: systemctl --user stop nanocrab',
      '2. Copy backup to new server',
      '3. Extract: tar -xzf nanocrab-backup-*.tar.gz -C /',
      '4. Clone the repo: git clone <your-nanocrab-repo-url>',
      '5. Copy extracted files into the new repo directory',
      '6. Install dependencies: npm install',
      '7. Build: npm run build && ./container/build.sh',
      '8. Set up admin: npx tsx setup/index.ts --step admin -- --username USER --password PASS --domain DOMAIN --port 9743',
      '9. Start: systemctl --user start nanocrab',
      '10. Verify channels reconnect and data is intact',
    ],
    notes: [
      'WhatsApp auth may need re-pairing if moving to a different server',
      'Signal account transfers automatically if signal-cli data is restored',
      'Telegram bot token works from any server',
      'Update DNS if the server IP changes',
      'Caddy will auto-generate new SSL certificates',
    ],
  };
}

export function getMigrationStatus(
  options: BackupServiceOptions = {},
): MigrationStatus {
  const home = options.homeDir || os.homedir();
  const pairs = [
    {
      id: 'config',
      label: 'Configuration directory',
      legacyPath: path.join(home, '.config', 'nanoclaw'),
      targetPath: path.join(home, '.config', 'nanocrab'),
    },
    {
      id: 'launch-agent',
      label: 'macOS LaunchAgent',
      legacyPath: path.join(
        home,
        'Library',
        'LaunchAgents',
        'com.nanoclaw.plist',
      ),
      targetPath: path.join(
        home,
        'Library',
        'LaunchAgents',
        'com.nanocrab.plist',
      ),
    },
  ];

  const checks = pairs.map((pair): MigrationCheck => {
    const legacyExists = fs.existsSync(pair.legacyPath);
    const targetExists = fs.existsSync(pair.targetPath);
    const status = !legacyExists
      ? 'not-needed'
      : targetExists
        ? 'target-exists'
        : 'ready';
    return {
      ...pair,
      legacyExists,
      targetExists,
      status,
      detail:
        status === 'not-needed'
          ? 'No legacy NanoClaw state found'
          : status === 'ready'
            ? 'Legacy state can be migrated safely'
            : 'NanoCrab target already exists; migration will preserve the legacy source as a timestamped backup',
    };
  });

  return {
    command: 'npm run migrate:nanocrab',
    checks,
    summary: {
      legacyFound: checks.filter((check) => check.legacyExists).length,
      readyToMigrate: checks.filter((check) => check.status === 'ready').length,
      targetConflicts: checks.filter(
        (check) => check.status === 'target-exists',
      ).length,
    },
  };
}
