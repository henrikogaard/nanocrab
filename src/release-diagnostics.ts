import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, GROUPS_DIR, STORE_DIR } from './config.js';
import {
  runSetupPreflight,
  SetupPreflightCheck,
  SetupPreflightResult,
} from './setup-preflight.js';

export type ReleaseDiagnosticSeverity = 'required' | 'advisory';
export type ReleaseDiagnosticStatus = 'ready' | 'blocked' | 'attention';

export interface ReleaseDiagnosticCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: ReleaseDiagnosticSeverity;
  detail: string;
  hint?: string;
}

export interface ReleaseDiagnosticSection {
  id: string;
  title: string;
  checks: ReleaseDiagnosticCheck[];
}

export interface ReleaseDiagnosticsResult {
  status: ReleaseDiagnosticStatus;
  generatedAt: string;
  summary: {
    total: number;
    passed: number;
    failedRequired: number;
    failedAdvisory: number;
  };
  sections: ReleaseDiagnosticSection[];
}

export interface ReleaseDiagnosticsOptions {
  projectRoot?: string;
  storeDir?: string;
  dataDir?: string;
  groupsDir?: string;
  runCommand?: (
    command: string,
    args: string[],
  ) => { ok: boolean; detail: string };
  commandExists?: (command: string) => boolean;
  setupPreflight?: SetupPreflightResult;
}

function defaultRunCommand(
  command: string,
  args: string[],
  cwd: string,
): { ok: boolean; detail: string } {
  try {
    return {
      ok: true,
      detail: execFileSync(command, args, {
        cwd,
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 10000,
      }).trim(),
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function defaultCommandExists(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function fileExists(projectRoot: string, relativePath: string): boolean {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function directoryHasEntries(directory: string): boolean {
  try {
    return fs.existsSync(directory) && fs.readdirSync(directory).length > 0;
  } catch {
    return false;
  }
}

function summarize(sections: ReleaseDiagnosticSection[]) {
  const checks = sections.flatMap((section) => section.checks);
  const failedRequired = checks.filter(
    (check) => !check.ok && check.severity === 'required',
  ).length;
  const failedAdvisory = checks.filter(
    (check) => !check.ok && check.severity === 'advisory',
  ).length;
  return {
    total: checks.length,
    passed: checks.filter((check) => check.ok).length,
    failedRequired,
    failedAdvisory,
  };
}

function preflightChecks(
  checks: SetupPreflightCheck[],
): ReleaseDiagnosticCheck[] {
  return checks.map((check) => ({
    id: `setup-${check.id}`,
    label: check.label,
    ok: check.ok,
    severity: check.severity,
    detail: check.detail,
    hint: check.hint,
  }));
}

export async function runReleaseDiagnostics(
  options: ReleaseDiagnosticsOptions = {},
): Promise<ReleaseDiagnosticsResult> {
  const projectRoot = options.projectRoot || process.cwd();
  const storeDir = options.storeDir || STORE_DIR;
  const dataDir = options.dataDir || DATA_DIR;
  const groupsDir = options.groupsDir || GROUPS_DIR;
  const runCommand =
    options.runCommand ||
    ((command, args) => defaultRunCommand(command, args, projectRoot));
  const commandExists = options.commandExists || defaultCommandExists;
  const setup =
    options.setupPreflight ||
    (await runSetupPreflight({
      projectRoot,
      dryRun: true,
      commandExists,
      runCommand,
    }));

  const gitStatus = runCommand('git', ['status', '--porcelain']);
  const backupAutoConfig = path.join(storeDir, 'backup-auto.json');
  const backupsDir = path.join(projectRoot, 'backups');
  const hasRuntimeState =
    directoryHasEntries(storeDir) ||
    directoryHasEntries(dataDir) ||
    directoryHasEntries(groupsDir);

  const sections: ReleaseDiagnosticSection[] = [
    {
      id: 'setup',
      title: 'Install Readiness',
      checks: preflightChecks(setup.checks),
    },
    {
      id: 'release',
      title: 'Release Gate',
      checks: [
        {
          id: 'git-clean',
          label: 'Git worktree',
          ok: gitStatus.ok && gitStatus.detail.trim().length === 0,
          severity: 'required',
          detail:
            gitStatus.ok && gitStatus.detail.trim().length === 0
              ? 'No uncommitted or untracked files'
              : 'Worktree has uncommitted or untracked files',
          hint: 'Commit, stash, or intentionally ignore local files before release',
        },
        {
          id: 'compiled-output',
          label: 'Compiled server output',
          ok: fileExists(projectRoot, 'dist/index.js'),
          severity: 'required',
          detail: fileExists(projectRoot, 'dist/index.js')
            ? 'dist/index.js exists'
            : 'dist/index.js is missing',
          hint: 'Run npm run build before release',
        },
        {
          id: 'admin-assets',
          label: 'Compiled admin assets',
          ok: fileExists(projectRoot, 'dist/admin/public/app.js'),
          severity: 'required',
          detail: fileExists(projectRoot, 'dist/admin/public/app.js')
            ? 'Admin assets are present in dist/admin/public'
            : 'Admin assets are missing from dist/admin/public',
          hint: 'Run npm run build before release',
        },
        {
          id: 'release-docs',
          label: 'Operator docs',
          ok:
            fileExists(projectRoot, 'docs/DEBUG_CHECKLIST.md') &&
            fileExists(projectRoot, 'docs/FIRST_RUN_VPS_TEST.md') &&
            fileExists(projectRoot, 'docs/SECURITY.md'),
          severity: 'advisory',
          detail:
            'Debug checklist, VPS rehearsal notes, and security model docs should be present',
          hint: 'Refresh operator docs when release behavior changes',
        },
      ],
    },
    {
      id: 'operations',
      title: 'Operations Safety',
      checks: [
        {
          id: 'runtime-state',
          label: 'Runtime state detected',
          ok: hasRuntimeState,
          severity: 'advisory',
          detail: hasRuntimeState
            ? 'Runtime store/data/groups directories contain state'
            : 'No runtime state detected yet',
          hint: 'Run setup and at least one channel/provider flow before production use',
        },
        {
          id: 'backup-plan',
          label: 'Backup plan',
          ok:
            fs.existsSync(backupAutoConfig) || directoryHasEntries(backupsDir),
          severity: 'advisory',
          detail: fs.existsSync(backupAutoConfig)
            ? 'Auto-backup configuration exists'
            : directoryHasEntries(backupsDir)
              ? 'At least one backup archive exists'
              : 'No backup archive or auto-backup configuration found',
          hint: 'Create a backup or configure automatic backups before production release',
        },
        {
          id: 'service-manager',
          label: 'Service manager',
          ok: commandExists('systemctl') || process.platform === 'darwin',
          severity: 'advisory',
          detail: commandExists('systemctl')
            ? 'systemctl is available'
            : process.platform === 'darwin'
              ? 'macOS development environment detected'
              : 'systemctl is not available',
          hint: 'Use a supervised service such as systemd for production',
        },
      ],
    },
  ];

  const summary = summarize(sections);
  return {
    status:
      summary.failedRequired > 0
        ? 'blocked'
        : summary.failedAdvisory > 0
          ? 'attention'
          : 'ready',
    generatedAt: new Date().toISOString(),
    summary,
    sections,
  };
}
