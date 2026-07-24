import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const envValues: Record<string, string> = {};

vi.mock('../../config.js', () => ({
  STORE_DIR: '/tmp/nanocrab-agents-provider-route-test/store',
  DATA_DIR: '/tmp/nanocrab-agents-provider-route-test/data',
  CODING_WORKSPACE_DIR: '/tmp/nanocrab-agents-provider-route-test/coding',
  CONTAINER_IMAGE: 'nanocrab-agent:latest',
  CREDENTIAL_PROXY_PORT: 3001,
  TIMEZONE: 'UTC',
}));

vi.mock('../../env.js', () => ({
  readEnvFile: vi.fn((keys: string[]) =>
    Object.fromEntries(
      keys.filter((key) => envValues[key]).map((key) => [key, envValues[key]]),
    ),
  ),
}));

vi.mock('../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('../security.js', () => ({
  auditLog: vi.fn(),
}));

vi.mock('../../container-runtime.js', () => ({
  CONTAINER_RUNTIME_BIN: 'docker',
  CONTAINER_HOST_GATEWAY: 'host.docker.internal',
  hostGatewayArgs: () => [],
  containerHardeningArgs: () => [],
}));

vi.mock('../../db.js', () => ({
  getAllRegisteredGroups: vi.fn(() => ({})),
  getNonWebRegisteredGroups: vi.fn(() => ({})),
}));

const { default: agentsRouter } = await import('./agents.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentsRouter);
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

describe('/api/agents/providers custom OpenAI-compatible coding metadata', () => {
  afterEach(() => {
    for (const key of Object.keys(envValues)) delete envValues[key];
  });

  it('includes the configured custom model and marks code-named models coding-capable', async () => {
    envValues.OPENAI_COMPATIBLE_BASE_URL = 'http://127.0.0.1:8080/v1';
    envValues.DEFAULT_OPENAI_COMPATIBLE_MODEL = 'qwen3-coder';

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/agents/providers`);
      expect(res.status).toBe(200);
      const providers = (await res.json()) as Array<{
        id: string;
        codingCapable: boolean;
        models: Array<{ id: string; codingCapable: boolean }>;
        defaultModel: string;
      }>;
      const custom = providers.find(
        (provider) => provider.id === 'openai-compatible',
      );
      expect(custom).toMatchObject({
        codingCapable: true,
        defaultModel: 'qwen3-coder',
      });
      expect(custom?.models).toContainEqual({
        id: 'qwen3-coder',
        label: 'qwen3-coder',
        codingCapable: true,
      });
    });
  });
});
