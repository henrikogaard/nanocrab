import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import fs from 'fs';

// Sentinel markers must match container-runner.ts
const OUTPUT_START_MARKER = '---NANOCRAB_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCRAB_OUTPUT_END---';

// Mock config
vi.mock('./config.js', () => ({
  CONTAINER_IMAGE: 'nanocrab-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 1800000, // 30min
  CREDENTIAL_PROXY_PORT: 3001,
  DATA_DIR: '/tmp/nanocrab-test-data',
  GROUPS_DIR: '/tmp/nanocrab-test-groups',
  IDLE_TIMEOUT: 1800000, // 30min
  STORE_DIR: '/tmp/nanocrab-test-store',
  TIMEZONE: 'America/Los_Angeles',
}));

// Mock logger
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => ''),
      readdirSync: vi.fn(() => []),
      statSync: vi.fn(() => ({ isDirectory: () => false })),
      copyFileSync: vi.fn(),
      mkdtempSync: vi.fn(() => '/tmp/nanocrab-env-test'),
      rmSync: vi.fn(),
    },
  };
});

// Mock mount-security
vi.mock('./mount-security.js', () => ({
  validateAdditionalMounts: vi.fn(() => []),
}));

// Mock container-runtime
vi.mock('./container-runtime.js', () => ({
  CONTAINER_RUNTIME_BIN: 'docker',
  CONTAINER_HOST_GATEWAY: 'host.docker.internal',
  hostGatewayArgs: () => [],
  readonlyMountArgs: (h: string, c: string) => ['-v', `${h}:${c}:ro`],
  stopContainer: vi.fn(),
}));

// Mock credential-proxy
vi.mock('./credential-proxy.js', () => ({
  detectAuthMode: vi.fn(() => 'api-key'),
}));

// Mock env file reader
vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

vi.mock('./provider-router.js', () => ({
  resolveProviderFallbackForAction: vi.fn(() => ({
    approved: true,
    provider: 'codex',
    model: 'gpt-5.4',
  })),
}));

// Create a controllable fake ChildProcess
function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

let fakeProc: ReturnType<typeof createFakeProcess>;

// Mock child_process.spawn
vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(() => fakeProc),
    exec: vi.fn(
      (_cmd: string, _opts: unknown, cb?: (err: Error | null) => void) => {
        if (cb) cb(null);
        return new EventEmitter();
      },
    ),
  };
});

import { runContainerAgent, ContainerOutput } from './container-runner.js';
import { spawn } from 'child_process';
import { readEnvFile } from './env.js';
import { resolveProviderFallbackForAction } from './provider-router.js';
import type { RegisteredGroup } from './types.js';

const mockedReadEnvFile = vi.mocked(readEnvFile);

const testGroup: RegisteredGroup = {
  name: 'Test Group',
  folder: 'test-group',
  trigger: '@Andy',
  added_at: new Date().toISOString(),
};

const testInput = {
  prompt: 'Hello',
  groupFolder: 'test-group',
  chatJid: 'test@g.us',
  isMain: false,
};

function emitOutputMarker(
  proc: ReturnType<typeof createFakeProcess>,
  output: ContainerOutput,
) {
  const json = JSON.stringify(output);
  proc.stdout.push(`${OUTPUT_START_MARKER}\n${json}\n${OUTPUT_END_MARKER}\n`);
}

describe('container-runner timeout behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = createFakeProcess();
    mockedReadEnvFile.mockReturnValue({});
    vi.mocked(resolveProviderFallbackForAction).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('timeout after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output with a result
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Here is my response',
      newSessionId: 'session-123',
    });

    // Let output processing settle
    await vi.advanceTimersByTimeAsync(10);

    // Fire the hard timeout (IDLE_TIMEOUT + 30s = 1830000ms)
    await vi.advanceTimersByTimeAsync(1830000);

    // Emit close event (as if container was stopped by the timeout)
    fakeProc.emit('close', 137);

    // Let the promise resolve
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-123');
    expect(onOutput).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'Here is my response' }),
    );
  });

  it('timeout with no output resolves as error', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // No output emitted — fire the hard timeout
    await vi.advanceTimersByTimeAsync(1830000);

    // Emit close event
    fakeProc.emit('close', 137);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('normal exit after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Done',
      newSessionId: 'session-456',
    });

    await vi.advanceTimersByTimeAsync(10);

    // Normal exit (no timeout)
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-456');
  });
});

describe('container-runner provider fallback metadata', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = createFakeProcess();
    mockedReadEnvFile.mockReturnValue({});
    vi.mocked(resolveProviderFallbackForAction).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves fallback before spawning when workflow metadata is supplied', async () => {
    const resultPromise = runContainerAgent(
      testGroup,
      {
        ...testInput,
        providerFallbackPurpose: 'default_chat',
        providerFallbackAction: 'read',
      },
      () => {},
    );

    emitOutputMarker(fakeProc, { status: 'success', result: 'Done' });
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    expect(resolveProviderFallbackForAction).toHaveBeenCalledWith({
      purpose: 'default_chat',
      action: 'read',
      requester: 'test-group',
      correlationId: null,
    });
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      '/tmp/nanocrab-env-test/env',
      expect.stringContaining('AGENT_PROVIDER=codex'),
      { mode: 0o600 },
    );
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      '/tmp/nanocrab-env-test/env',
      expect.stringContaining('DEFAULT_MODEL=gpt-5.4'),
      { mode: 0o600 },
    );
  });
});

describe('container-runner MCP env forwarding', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = createFakeProcess();
    vi.mocked(fs.existsSync).mockImplementation((file) =>
      String(file).endsWith('mcp-servers.json'),
    );
    vi.mocked(fs.readFileSync).mockImplementation((file) => {
      if (String(file).endsWith('mcp-servers.json')) {
        return JSON.stringify([
          {
            name: 'infomaniak',
            command: 'npx',
            args: ['-y', '@example/infomaniak-mcp'],
            envVars: ['MAIL_USER', 'MAIL_PASSWORD'],
          },
        ]);
      }
      return '';
    });
    mockedReadEnvFile.mockReturnValue({
      MAIL_USER: 'mail@example.com',
      MAIL_PASSWORD: 'secret',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  it('passes custom MCP env vars from .env into the container', async () => {
    const resultPromise = runContainerAgent(testGroup, testInput, () => {});

    emitOutputMarker(fakeProc, { status: 'success', result: 'Done' });
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    const spawnArgs = vi.mocked(spawn).mock.calls.at(-1)?.[1] as string[];
    expect(mockedReadEnvFile).toHaveBeenCalledWith([
      'MAIL_USER',
      'MAIL_PASSWORD',
    ]);
    expect(spawnArgs).toContain('--env-file');
    expect(spawnArgs).toContain('/tmp/nanocrab-env-test/env');
    expect(spawnArgs).not.toContain('MAIL_USER=mail@example.com');
    expect(spawnArgs).not.toContain('MAIL_PASSWORD=secret');
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      '/tmp/nanocrab-env-test/env',
      expect.stringContaining('MAIL_USER=mail@example.com'),
      { mode: 0o600 },
    );
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      '/tmp/nanocrab-env-test/env',
      expect.stringContaining('MAIL_PASSWORD=secret'),
      { mode: 0o600 },
    );
  });
});
