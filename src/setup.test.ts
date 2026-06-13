import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { redactLogValue } from './logger.js';
import {
  createInitialSetupState,
  getNextSetupStep,
  markSetupStep,
  readSetupState,
} from './setup-state.js';
import { runSetupPreflight } from './setup-preflight.js';

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
