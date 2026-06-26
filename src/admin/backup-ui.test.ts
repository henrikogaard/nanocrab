import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Backup and restore cockpit UI', () => {
  it('frames backup as recovery readiness for productive automation', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Recovery cockpit');
    expect(source).toContain(
      'Make automation reversible before agents do important work',
    );
    expect(source).toContain('Recoverable');
    expect(source).toContain('Create first backup');
    expect(source).toContain('backup-command-center');
    expect(source).toContain('backup-recovery-brief');
    expect(source).toContain('backupRollbackGate');
    expect(source).toContain('renderBackupRollbackGate');
    expect(source).toContain('backup-rollback-gate');
    expect(source).toContain('Rollback gate');
    expect(source).toContain(
      'Check recovery before provider, MCP, project, Code, or automation changes',
    );
    expect(source).toContain(
      'Use this gate before assigning agents work that can touch credentials, external systems',
    );
    expect(source).toContain('Recovery decision');
    expect(source).toContain('backupRecoveryBriefText');
    expect(source).toContain(
      'Review this NanoCrab recovery posture before important agent work.',
    );
    expect(source).toContain('Rollback readiness checklist:');
    expect(source).toContain('Coverage confirmed');
    expect(source).toContain('Off-host copy exists');
    expect(source).toContain('Restore path verified');
    expect(source).toContain('Pause if stale');
    expect(source).toContain(
      'Configuration, groups, conversations, credential metadata, MCP setup, runtime state, and project artifacts are covered.',
    );
    expect(source).toContain(
      'Download an encrypted off-host copy before credential rotation, MCP server changes, project imports, or container rebuilds.',
    );
    expect(source).toContain(
      'Verify the restore guide and migration command before starting broad Code, Cowork, or scheduled automation.',
    );
    expect(source).toContain(
      'If the latest backup is stale or missing critical state, pause the work and create an essential backup first.',
    );
    expect(source).toContain(
      'Create or refresh a backup before provider changes, credential rotation, MCP setup, project imports, Code automation, or container rebuilds',
    );
  });

  it('surfaces protected state, automatic policy, restore path, and migration readiness', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Protected state');
    expect(source).toContain('id="protected-state"');
    expect(source).toContain('Automatic backups');
    expect(source).toContain('Restore path');
    expect(source).toContain('Migration readiness');
    expect(source).toContain('backup-state-card');
    expect(source).toContain('backup-restore-steps');
    expect(source).toContain('backup-check-card');
    expect(source).toContain('recoveryBrief');
    expect(source).toContain('backupFresh');
    expect(source).toContain('window._backupRecoveryState');
    expect(source).toContain('Recovery posture is ready for important work');
    expect(source).toContain('Create the first backup before major changes');
  });

  it('keeps archive actions wired for plain, encrypted, and delete flows', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('createBackup(false, this)');
    expect(source).toContain('createBackup(true, this)');
    expect(source).toContain('/api/backup/download/');
    expect(source).toContain('downloadEncryptedBackup');
    expect(source).toContain('backup-encryption-passphrase');
    expect(source).toContain('Enter an encryption passphrase before exporting');
    expect(source).toContain('deleteBackup');
    expect(source).toContain('saveAutoBackupConfig');
    expect(source).toContain('copyBackupRecoveryBrief');
    expect(source).toContain('Copy recovery brief');
    expect(source).toContain('Backup recovery brief copied');
    expect(source).not.toContain(
      "prompt('Enter a passphrase for encryption:')",
    );
  });

  it('uses recovery-specific action errors for backup operations', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const backupBlock = source.slice(
      source.indexOf('// Backup'),
      source.indexOf('// Settings'),
    );

    expect(backupBlock).toContain('function backupActionErrorMessage');
    expect(backupBlock).toContain('Backup was not created.');
    expect(backupBlock).toContain('Encrypted backup was not downloaded.');
    expect(backupBlock).toContain('Automatic backup policy was not saved.');
    expect(backupBlock).toContain('Backup was not deleted.');
    expect(backupBlock).toContain('Pause broad agent work');
    expect(backupBlock).toContain('off-host recovery copy');
    expect(backupBlock).toContain('unattended recovery points');
    expect(backupBlock).toContain(
      'latest rollback point for provider changes, MCP setup, project imports, Code work, or scheduled automation',
    );
    expect(backupBlock).toContain(
      "toast(backupActionErrorMessage('create', r), 'error')",
    );
    expect(backupBlock).toContain(
      "toast(backupActionErrorMessage('create', e), 'error')",
    );
    expect(backupBlock).toContain(
      "toast(backupActionErrorMessage('encrypted', err), 'error')",
    );
    expect(backupBlock).toContain(
      "toast(backupActionErrorMessage('encrypted', e), 'error')",
    );
    expect(backupBlock).toContain(
      "toast(backupActionErrorMessage('auto', r), 'error')",
    );
    expect(backupBlock).toContain(
      "toast(backupActionErrorMessage('auto', e), 'error')",
    );
    expect(backupBlock).toContain(
      "toast(backupActionErrorMessage('delete', r), 'error')",
    );
    expect(backupBlock).toContain(
      "toast(backupActionErrorMessage('delete', e), 'error')",
    );
    expect(backupBlock).not.toContain("toast(r.error || 'Failed', 'error')");
    expect(backupBlock).not.toContain("toast('Backup failed', 'error')");
    expect(backupBlock).not.toContain(
      "toast('Download failed: ' + e.message, 'error')",
    );
    expect(backupBlock).not.toContain(
      "toast(r.error || 'Failed to save auto-backup settings', 'error')",
    );
    expect(backupBlock).not.toContain("toast('Failed: ' + e.message, 'error')");
  });

  it('turns an empty archive list into a recovery setup path', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderBackupArchiveEmptyState');
    expect(source).toContain('backup-empty-state');
    expect(source).toContain('Archive readiness');
    expect(source).toContain('No backups yet');
    expect(source).toContain(
      'Create a recovery point before provider changes, credential rotation, MCP setup, project imports, Code automation, or container rebuilds.',
    );
    expect(source).toContain('Capture essential state');
    expect(source).toContain('Add bulky context when needed');
    expect(source).toContain('Keep an off-host copy');
    expect(source).toContain('Essential backup');
    expect(source).toContain('copyBackupRecoveryBrief()');
    expect(source).not.toContain(
      '\'<div class="empty">No backups yet. Create one above.</div>\'',
    );
    expect(styleSource).toContain('.backup-empty-state');
    expect(styleSource).toContain('.backup-empty-flow');
    expect(styleSource).toContain('.backup-empty-flow article button');
    expect(styleSource).toContain('.backup-empty-actions');
    expect(styleSource).toContain('.backup-empty-flow {');
  });

  it('uses class-based recovery tables, policy controls, and archive rows', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('backup-item-label');
    expect(source).toContain('backup-item-size');
    expect(source).toContain('backup-state-footer');
    expect(source).toContain('backup-inline-actions');
    expect(source).toContain('backup-note-title');
    expect(source).toContain('backup-note-item');
    expect(source).toContain('backup-auto-form');
    expect(source).toContain('backup-auto-note');
    expect(source).toContain('backup-migration-head');
    expect(source).toContain('backup-command-code');
    expect(source).toContain('backup-migration-check');
    expect(source).toContain('backup-migration-check-head');
    expect(source).toContain('backup-migration-detail');
    expect(source).toContain('backup-archive-name');
    expect(source).toContain('backup-archive-head');
    expect(source).toContain('backup-encryption-field');
    expect(source).toContain('backup-archive-actions-cell');
    expect(source).toContain('backup-download-link');
    expect(source).toContain('backup-empty-state');
  });

  it('styles the backup page as a responsive recovery cockpit', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.backup-command-center');
    expect(source).toContain('.backup-recovery-brief');
    expect(source).toContain('.backup-recovery-brief.is-attention');
    expect(source).toContain('.backup-recovery-facts');
    expect(source).toContain('.backup-rollback-gate');
    expect(source).toContain('.backup-rollback-head');
    expect(source).toContain('.backup-rollback-grid');
    expect(source).toContain('.backup-rollback-step');
    expect(source).toContain('.backup-command-stats');
    expect(source).toContain('.backup-work-grid');
    expect(source).toContain('.backup-state-card');
    expect(source).toContain('.backup-archive-card');
    expect(source).toContain('.backup-recovery-actions');
    expect(source).toContain('.backup-stat');
    expect(source).toContain('.backup-state-footer');
    expect(source).toContain('.backup-auto-form');
    expect(source).toContain('.backup-migration-check');
    expect(source).toContain('.backup-archive-head');
    expect(source).toContain('.backup-encryption-field');
    expect(source).toContain('.backup-encryption-field input');
    expect(source).toContain('.backup-archive-actions-cell');
    expect(source).toContain('.backup-empty-state');
    expect(source).toContain('.backup-empty-flow');
    expect(source).toContain('.backup-rollback-grid,');
    expect(source).toContain('.backup-rollback-head,');
    expect(source).toContain(
      '.backup-command-center,\n  .backup-rollback-grid,\n  .backup-work-grid,\n  .backup-auto-grid',
    );
  });
});
