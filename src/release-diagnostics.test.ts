import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { runReleaseDiagnostics } from './release-diagnostics.js';

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocrab-release-'));
  fs.mkdirSync(path.join(root, 'dist', 'admin', 'public'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'store'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'groups'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'index.js'), '');
  fs.writeFileSync(path.join(root, 'dist', 'admin', 'public', 'app.js'), '');
  fs.writeFileSync(path.join(root, 'docs', 'DEBUG_CHECKLIST.md'), '');
  fs.writeFileSync(path.join(root, 'docs', 'FIRST_RUN_VPS_TEST.md'), '');
  fs.writeFileSync(path.join(root, 'docs', 'SECURITY.md'), '');
  fs.writeFileSync(path.join(root, 'store', 'backup-auto.json'), '{}');
  fs.writeFileSync(path.join(root, 'groups', 'main.json'), '{}');
  return root;
}

const passingPreflight = {
  ok: true,
  checks: [
    {
      id: 'node',
      label: 'Node.js',
      ok: true,
      severity: 'required' as const,
      detail: 'Node 22.x detected',
    },
  ],
};

describe('release diagnostics', () => {
  it('reports ready when required release gates pass', async () => {
    const root = makeProject();
    const result = await runReleaseDiagnostics({
      projectRoot: root,
      storeDir: path.join(root, 'store'),
      dataDir: path.join(root, 'data'),
      groupsDir: path.join(root, 'groups'),
      setupPreflight: passingPreflight,
      commandExists: () => true,
      runCommand: () => ({ ok: true, detail: '' }),
    });

    expect(result.summary.failedRequired).toBe(0);
    expect(result.status).toBe('ready');
    expect(result.sections.find((s) => s.id === 'release')?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'git-clean', ok: true }),
        expect.objectContaining({ id: 'compiled-output', ok: true }),
      ]),
    );
  });

  it('blocks release on dirty worktree without exposing secret-like values', async () => {
    const root = makeProject();
    const result = await runReleaseDiagnostics({
      projectRoot: root,
      storeDir: path.join(root, 'store'),
      dataDir: path.join(root, 'data'),
      groupsDir: path.join(root, 'groups'),
      setupPreflight: passingPreflight,
      commandExists: () => true,
      runCommand: () => ({
        ok: true,
        detail: ' M .env\n?? token=super-secret-value\n',
      }),
    });

    expect(result.status).toBe('blocked');
    const allText = JSON.stringify(result);
    expect(allText).not.toContain('super-secret-value');
    expect(allText).not.toContain('token=');
    expect(
      result.sections.find((s) => s.id === 'release')?.checks,
    ).toContainEqual(
      expect.objectContaining({
        id: 'git-clean',
        ok: false,
        severity: 'required',
      }),
    );
  });
});
