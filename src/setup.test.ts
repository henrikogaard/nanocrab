import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { redactLogValue } from './logger.js';
import {
  applySetupStepResult,
  createInitialSetupState,
  getNextSetupStep,
  markSetupStep,
  readSetupState,
  shouldMarkSetupStepCompleted,
} from './setup-state.js';
import {
  detectContainerRuntime,
  runSetupPreflight,
} from './setup-preflight.js';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nanocrab-setup-test-'));
}

describe('setup state resume', () => {
  it('persists explicit step statuses and resumes at the failed step', () => {
    const statePath = path.join(tempDir(), '.setup-state.json');
    const state = createInitialSetupState(['environment', 'admin', 'provider']);
    markSetupStep(state, 'environment', 'completed', statePath);
    markSetupStep(state, 'admin', 'failed', statePath, 'missing password');

    const persisted = readSetupState(statePath, [
      'environment',
      'admin',
      'provider',
    ]);

    expect(persisted.steps.environment.status).toBe('completed');
    expect(persisted.steps.admin.status).toBe('failed');
    expect(persisted.steps.provider.status).toBe('pending');
    expect(persisted.steps.admin.error).toBe('missing password');
    expect(
      getNextSetupStep(persisted, ['environment', 'admin', 'provider']),
    ).toBe('admin');
  });

  it('treats interrupted running steps as failed on the next read', () => {
    const statePath = path.join(tempDir(), '.setup-state.json');
    const state = createInitialSetupState(['environment', 'container']);
    markSetupStep(state, 'environment', 'completed', statePath);
    markSetupStep(state, 'container', 'running', statePath);

    const resumed = readSetupState(statePath, ['environment', 'container']);

    expect(resumed.steps.container.status).toBe('failed');
    expect(resumed.steps.container.error).toContain('interrupted');
    expect(getNextSetupStep(resumed, ['environment', 'container'])).toBe(
      'container',
    );
  });

  it('migrates legacy completed-list state and enforces 0600 permissions', () => {
    const statePath = path.join(tempDir(), '.setup-state.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({ version: 1, completed: ['environment'] }),
      { mode: 0o644 },
    );

    const migrated = readSetupState(statePath, ['environment', 'admin']);
    const persisted = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const mode = fs.statSync(statePath).mode & 0o777;

    expect(migrated.steps.environment.status).toBe('completed');
    expect(migrated.steps.admin.status).toBe('pending');
    expect(persisted.version).toBe(2);
    expect(mode).toBe(0o600);
  });

  it('persists all-completed legacy state even when resume would skip every step', () => {
    const statePath = path.join(tempDir(), '.setup-state.json');
    const steps = ['environment', 'admin', 'provider'];
    fs.writeFileSync(
      statePath,
      JSON.stringify({ version: 1, completed: steps }),
      { mode: 0o644 },
    );

    const migrated = readSetupState(statePath, steps);
    const persisted = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const mode = fs.statSync(statePath).mode & 0o777;

    expect(getNextSetupStep(migrated, steps)).toBeNull();
    expect(persisted.version).toBe(2);
    expect(Object.keys(persisted.steps).sort()).toEqual(steps.sort());
    expect(mode).toBe(0o600);
  });

  it('does not complete steps that return input-required or failed semantic status', () => {
    const statePath = path.join(tempDir(), '.setup-state.json');
    const state = createInitialSetupState(['admin', 'provider']);

    applySetupStepResult(
      state,
      'admin',
      { status: 'input_required', message: 'credentials needed' },
      statePath,
    );
    applySetupStepResult(
      state,
      'provider',
      { status: 'failed', message: 'codex auth required' },
      statePath,
    );

    const persisted = readSetupState(statePath, ['admin', 'provider']);
    expect(shouldMarkSetupStepCompleted({ status: 'input_required' })).toBe(
      false,
    );
    expect(shouldMarkSetupStepCompleted({ status: 'failed' })).toBe(false);
    expect(persisted.steps.admin.status).toBe('failed');
    expect(persisted.steps.provider.status).toBe('failed');
    expect(getNextSetupStep(persisted, ['admin', 'provider'])).toBe('admin');
  });

  it('completes steps that return success-like semantic status', () => {
    const statePath = path.join(tempDir(), '.setup-state.json');
    const state = createInitialSetupState(['admin']);

    applySetupStepResult(
      state,
      'admin',
      { status: 'already_configured' },
      statePath,
    );

    expect(shouldMarkSetupStepCompleted({ status: 'already_configured' })).toBe(
      true,
    );
    expect(readSetupState(statePath, ['admin']).steps.admin.status).toBe(
      'completed',
    );
  });
});

describe('setup preflight', () => {
  it('reports readiness without exposing secret values or writing credentials', async () => {
    const projectRoot = tempDir();
    fs.writeFileSync(
      path.join(projectRoot, '.env'),
      [
        'ADMIN_USERNAME=owner',
        'ADMIN_PASSWORD_HASH=$2b$12$hashed-secret',
        'DEFAULT_PROVIDER=openai-responses',
        'OPENAI_API_KEY=sk-real-secret-value',
        'TELEGRAM_BOT_TOKEN=123456:telegram-secret',
      ].join('\n'),
    );

    const result = await runSetupPreflight({
      projectRoot,
      env: {
        ADMIN_USERNAME: 'owner',
        ADMIN_PASSWORD_HASH: '$2b$12$hashed-secret',
        DEFAULT_PROVIDER: 'openai-responses',
        OPENAI_API_KEY: 'sk-real-secret-value',
        TELEGRAM_BOT_TOKEN: '123456:telegram-secret',
      },
      commandExists: (command) => ['node', 'npm', 'docker'].includes(command),
      runCommand: () => ({ ok: true, detail: 'ok' }),
      isPortAvailable: async () => true,
      nodeVersion: 'v22.12.0',
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.checks.find((c) => c.id === 'admin-auth')?.ok).toBe(true);
    expect(result.checks.find((c) => c.id === 'provider-credentials')?.ok).toBe(
      true,
    );
    expect(result.checks.find((c) => c.id === 'channel-credentials')?.ok).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toContain('sk-real-secret-value');
    expect(JSON.stringify(result)).not.toContain('telegram-secret');
  });

  it('fails admin and provider readiness when required credentials are missing', async () => {
    const projectRoot = tempDir();
    fs.writeFileSync(
      path.join(projectRoot, '.env'),
      'DEFAULT_PROVIDER=gemini\n',
    );

    const result = await runSetupPreflight({
      projectRoot,
      env: { DEFAULT_PROVIDER: 'gemini' },
      commandExists: (command) => ['node', 'npm', 'docker'].includes(command),
      runCommand: () => ({ ok: true, detail: 'ok' }),
      isPortAvailable: async () => true,
      nodeVersion: 'v22.12.0',
      dryRun: true,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'admin-auth')?.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'provider-credentials')?.ok).toBe(
      false,
    );
  });

  it('fails CLI dry-run when required ports are occupied and reports in-use detail', async () => {
    const projectRoot = tempDir();
    const result = await runSetupPreflight({
      projectRoot,
      env: {
        ADMIN_USERNAME: 'owner',
        ADMIN_PASSWORD_HASH: 'hash',
        DEFAULT_PROVIDER: 'openai-responses',
        OPENAI_API_KEY: 'sk-test',
        TELEGRAM_BOT_TOKEN: 'token',
      },
      commandExists: (command) => ['node', 'npm', 'docker'].includes(command),
      runCommand: () => ({ ok: true, detail: 'ok' }),
      isPortAvailable: async () => false,
      nodeVersion: 'v22.12.0',
      dryRun: true,
    });

    const adminPort = result.checks.find((c) => c.id === 'admin-port');
    expect(result.ok).toBe(false);
    expect(adminPort?.ok).toBe(false);
    expect(adminPort?.detail).toContain('in use');
    expect(adminPort?.detail).not.toContain('available');
  });

  it('accepts occupied service ports for dashboard preflight', async () => {
    const projectRoot = tempDir();
    const result = await runSetupPreflight({
      projectRoot,
      env: {
        ADMIN_USERNAME: 'owner',
        ADMIN_PASSWORD_HASH: 'hash',
        DEFAULT_PROVIDER: 'openai-responses',
        OPENAI_API_KEY: 'sk-test',
        TELEGRAM_BOT_TOKEN: 'token',
        ADMIN_PORT: '9744',
        CREDENTIAL_PROXY_PORT: '3001',
      },
      commandExists: (command) => ['node', 'npm', 'docker'].includes(command),
      runCommand: () => ({ ok: true, detail: 'ok' }),
      isPortAvailable: async () => false,
      occupiedPortsOk: [9744, 3001],
      nodeVersion: 'v22.12.0',
      dryRun: true,
    });

    const adminPort = result.checks.find((c) => c.id === 'admin-port');
    const proxyPort = result.checks.find(
      (c) => c.id === 'credential-proxy-port',
    );
    expect(result.ok).toBe(true);
    expect(adminPort?.ok).toBe(true);
    expect(adminPort?.detail).toContain('running NanoCrab');
    expect(proxyPort?.ok).toBe(true);
  });

  it('detects a default container runtime for full setup', () => {
    expect(
      detectContainerRuntime(
        (command) => command === 'docker',
        () => ({ ok: true, detail: 'ok' }),
      ),
    ).toBe('docker');
    expect(
      detectContainerRuntime(
        (command) => command === 'container',
        () => ({ ok: true, detail: 'ok' }),
      ),
    ).toBe('apple-container');
    expect(
      detectContainerRuntime(
        () => false,
        () => ({ ok: false, detail: 'missing' }),
      ),
    ).toBe('');
  });
});

describe('setup log redaction', () => {
  it('redacts tokens, passwords, API keys, cookies, authorization headers, and proxy material', () => {
    const redacted = redactLogValue({
      password: 'correct-horse-battery-staple',
      apiKey: 'sk-test-123',
      authorization: 'Bearer secret-token',
      cookie: 'session=secret-cookie',
      credentialProxy: 'http://127.0.0.1:3001/__nanocrab/providers/claude',
      nested: {
        OPENAI_API_KEY: 'sk-nested-secret',
      },
    });

    expect(JSON.stringify(redacted)).not.toContain('correct-horse');
    expect(JSON.stringify(redacted)).not.toContain('sk-test-123');
    expect(JSON.stringify(redacted)).not.toContain('secret-token');
    expect(JSON.stringify(redacted)).not.toContain('secret-cookie');
    expect(JSON.stringify(redacted)).not.toContain('sk-nested-secret');
    expect(JSON.stringify(redacted)).toContain('[REDACTED]');
  });
});
