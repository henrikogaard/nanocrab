import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const mocks = vi.hoisted(() => {
  const envValues: Record<string, string> = {};
  return {
    envValues,
    readEnvFile: vi.fn((keys: string[]) =>
      Object.fromEntries(
        keys
          .filter((key) => envValues[key])
          .map((key) => [key, envValues[key]]),
      ),
    ),
    updateEnvVar: vi.fn((key: string, value: string) => {
      envValues[key] = value;
      process.env[key] = value;
    }),
    removeEnvVar: vi.fn((key: string) => {
      delete envValues[key];
      delete process.env[key];
    }),
    auditLog: vi.fn(),
  };
});

vi.mock('../../env.js', () => ({
  readEnvFile: mocks.readEnvFile,
}));

vi.mock('../auth.js', () => ({
  updateEnvVar: mocks.updateEnvVar,
  removeEnvVar: mocks.removeEnvVar,
}));

vi.mock('../security.js', () => ({
  auditLog: mocks.auditLog,
}));

vi.mock('../../codex-auth.js', () => ({
  getCodexAuthStatus: vi.fn(() => ({ configured: false })),
}));

vi.mock('../../probe-scheduler.js', () => ({
  runAllProbes: vi.fn(async () => ({ entries: [] })),
  getProbeHealth: vi.fn(() => ({ version: 1, entries: [] })),
  refreshProbeHealth: vi.fn(),
}));

vi.mock('../../model-metrics.js', () => ({
  getModelMetricsData: vi.fn(() => ({ providers: [] })),
}));

const { default: providersRouter } = await import('./providers.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'admin', username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/providers', providersRouter);
  return app;
}

async function withServer<T>(
  handler: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const app = buildApp();
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('test server did not bind to a port');
    }
    return await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('/api/providers custom OpenAI-compatible endpoint', () => {
  afterEach(() => {
    for (const key of Object.keys(mocks.envValues)) {
      delete mocks.envValues[key];
      delete process.env[key];
    }
    mocks.readEnvFile.mockClear();
    mocks.updateEnvVar.mockClear();
    mocks.removeEnvVar.mockClear();
    mocks.auditLog.mockClear();
  });

  it('enables a custom endpoint with base URL and model without requiring an API key', async () => {
    await withServer(async (base) => {
      const res = await fetch(
        `${base}/api/providers/openai-compatible/enable`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            baseUrl: 'http://127.0.0.1:8080/v1',
            model: 'qwen3-coder',
          }),
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; message: string };
      expect(body.ok).toBe(true);
      expect(mocks.updateEnvVar).toHaveBeenCalledWith(
        'OPENAI_COMPATIBLE_BASE_URL',
        'http://127.0.0.1:8080/v1',
      );
      expect(mocks.updateEnvVar).toHaveBeenCalledWith(
        'DEFAULT_OPENAI_COMPATIBLE_MODEL',
        'qwen3-coder',
      );
      expect(mocks.updateEnvVar).not.toHaveBeenCalledWith(
        'OPENAI_COMPATIBLE_API_KEY',
        expect.any(String),
      );

      const catalogRes = await fetch(`${base}/api/providers`);
      const catalog = (await catalogRes.json()) as {
        providers: Array<{
          id: string;
          configured: boolean;
          defaultModel?: string;
          baseUrl?: string;
        }>;
      };
      expect(
        catalog.providers.find(
          (provider) => provider.id === 'openai-compatible',
        ),
      ).toMatchObject({
        configured: true,
        defaultModel: 'qwen3-coder',
        baseUrl: 'http://127.0.0.1:8080/v1',
      });
    });
  });

  it('disables the custom endpoint by removing key, base URL, and model config', async () => {
    mocks.envValues.OPENAI_COMPATIBLE_BASE_URL = 'http://127.0.0.1:8080/v1';
    mocks.envValues.OPENAI_COMPATIBLE_API_KEY = 'sk-test';
    mocks.envValues.DEFAULT_OPENAI_COMPATIBLE_MODEL = 'qwen3-coder';

    await withServer(async (base) => {
      const res = await fetch(
        `${base}/api/providers/openai-compatible/disable`,
        { method: 'POST' },
      );
      expect(res.status).toBe(200);
    });

    expect(mocks.removeEnvVar).toHaveBeenCalledWith(
      'OPENAI_COMPATIBLE_API_KEY',
    );
    expect(mocks.removeEnvVar).toHaveBeenCalledWith(
      'OPENAI_COMPATIBLE_BASE_URL',
    );
    expect(mocks.removeEnvVar).toHaveBeenCalledWith(
      'DEFAULT_OPENAI_COMPATIBLE_MODEL',
    );
  });
});
