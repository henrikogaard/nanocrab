import fs from 'fs';
import path from 'path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanocrab-setup-readiness-test';

vi.mock('./config.js', () => ({
  CONTAINER_IMAGE: 'nanocrab-agent:test',
  CONTAINER_RUNTIME_BIN: 'docker',
  DATA_DIR: '/tmp/nanocrab-setup-readiness-test/data',
  GROUPS_DIR: '/tmp/nanocrab-setup-readiness-test/groups',
  STORE_DIR: '/tmp/nanocrab-setup-readiness-test/store',
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

import { buildSetupReadiness } from './setup-readiness.js';

describe('setup readiness', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    fs.writeFileSync(path.join(TEST_ROOT, 'package-lock.json'), '{}');
    fs.mkdirSync(path.join(TEST_ROOT, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(TEST_ROOT, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(TEST_ROOT, 'dist', 'index.js'), 'export {};');
  });

  it('passes required clean-install checks without exposing secret values', () => {
    fs.writeFileSync(path.join(TEST_ROOT, '.env'), 'ADMIN_PASSWORD=redacted\n');
    const readiness = buildSetupReadiness({
      projectRoot: TEST_ROOT,
      storeDir: path.join(TEST_ROOT, 'store'),
      groupsDir: path.join(TEST_ROOT, 'groups'),
      dataDir: path.join(TEST_ROOT, 'data'),
      env: {
        ADMIN_PASSWORD: 'super-secret-password',
        OPENROUTER_API_KEY: 'sk-secret',
        TELEGRAM_BOT_TOKEN: 'telegram-secret',
      },
      commandSucceeds: () => true,
    });

    expect(readiness.overall).toBe('pass');
    expect(readiness.failed).toBe(0);
    const serialized = JSON.stringify(readiness);
    expect(serialized).not.toContain('super-secret-password');
    expect(serialized).not.toContain('sk-secret');
    expect(serialized).not.toContain('telegram-secret');
  });

  it('fails required checks when the container runtime is missing', () => {
    const readiness = buildSetupReadiness({
      projectRoot: TEST_ROOT,
      storeDir: path.join(TEST_ROOT, 'store'),
      groupsDir: path.join(TEST_ROOT, 'groups'),
      dataDir: path.join(TEST_ROOT, 'data'),
      env: { ADMIN_PASSWORD: 'configured' },
      commandSucceeds: (command) => command !== 'docker',
    });

    expect(readiness.overall).toBe('fail');
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'container-runtime',
          required: true,
          status: 'fail',
        }),
      ]),
    );
  });

  it('warns for optional resumable setup work on a partial install', () => {
    const readiness = buildSetupReadiness({
      projectRoot: TEST_ROOT,
      storeDir: path.join(TEST_ROOT, 'store'),
      groupsDir: path.join(TEST_ROOT, 'groups'),
      dataDir: path.join(TEST_ROOT, 'data'),
      env: {},
      commandSucceeds: (command, args) =>
        command === 'docker' &&
        args.join(' ') !== 'image inspect nanocrab-agent:test',
    });

    expect(readiness.overall).toBe('warn');
    expect(
      readiness.checks.find((item) => item.id === 'env-file'),
    ).toMatchObject({
      status: 'warn',
      required: false,
    });
    expect(
      readiness.checks.some(
        (item) => item.status === 'warn' && item.resumeNote,
      ),
    ).toBe(true);
  });
});
