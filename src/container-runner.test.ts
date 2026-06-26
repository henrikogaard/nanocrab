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

vi.mock('./skill-registry.js', async () => {
  const actual = await vi.importActual<typeof import('./skill-registry.js')>(
    './skill-registry.js',
  );
  return {
    ...actual,
    prepareActiveSkillsDirectory: vi.fn(() => '/tmp/nanocrab-runtime-skills'),
    recordSkillRoutingDecision: vi.fn(),
  };
});

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
import {
  prepareActiveSkillsDirectory,
  recordSkillRoutingDecision,
} from './skill-registry.js';
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
    vi.mocked(prepareActiveSkillsDirectory).mockClear();
    vi.mocked(recordSkillRoutingDecision).mockClear();
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

  it('simulates dry-run container execution without spawning and keeps mounts read-only', async () => {
    const onOutput = vi.fn(async () => {});
    vi.mocked(spawn).mockClear();

    const result = await runContainerAgent(
      testGroup,
      {
        ...testInput,
        isScheduledTask: true,
        dryRun: true,
      },
      () => {
        throw new Error('dry-run should not register a spawned process');
      },
      onOutput,
    );

    expect(result.status).toBe('success');
    expect(result.result).toContain('Dry-run simulated');
    expect(onOutput).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success' }),
    );
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('container-runner skill routing provenance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = createFakeProcess();
    mockedReadEnvFile.mockReturnValue({});
    vi.mocked(prepareActiveSkillsDirectory).mockClear();
    vi.mocked(recordSkillRoutingDecision).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes request context to skill selection and records routing decisions', async () => {
    const resultPromise = runContainerAgent(
      testGroup,
      {
        ...testInput,
        prompt: 'Please remember the release workflow',
        sessionId: 'session-routing',
      },
      () => {},
    );

    emitOutputMarker(fakeProc, { status: 'success', result: 'Done' });
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    expect(prepareActiveSkillsDirectory).toHaveBeenCalledWith(
      expect.objectContaining({
        groupFolder: 'test-group',
        isMain: false,
        request: 'Please remember the release workflow',
      }),
    );
    expect(recordSkillRoutingDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        groupFolder: 'test-group',
        isMain: false,
        request: 'Please remember the release workflow',
        sessionId: 'session-routing',
      }),
    );
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
        provider: 'openrouter',
        model: 'openrouter/auto',
        providerFallbackPurpose: 'default_chat',
        providerFallbackAction: 'external-message',
      },
      () => {},
    );

    emitOutputMarker(fakeProc, { status: 'success', result: 'Done' });
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    expect(resolveProviderFallbackForAction).toHaveBeenCalledWith({
      purpose: 'default_chat',
      action: 'external-message',
      requester: 'test-group',
      correlationId: null,
      sourceProvider: 'openrouter',
      sourceModel: 'openrouter/auto',
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

  it('denies provider fallback purposes outside the agent boundary', async () => {
    vi.mocked(spawn).mockClear();

    const result = await runContainerAgent(
      testGroup,
      {
        ...testInput,
        providerFallbackPurpose: 'default_coding',
        providerFallbackAction: 'coding-implementation',
      },
      () => {
        throw new Error('disallowed provider profile should not spawn');
      },
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('Agent boundary denied provider profile');
    expect(resolveProviderFallbackForAction).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
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
      if (String(file).endsWith('connector-permissions.json')) {
        return JSON.stringify([
          {
            connectorId: 'infomaniak',
            scope: 'all',
            allowedActions: ['tools.expose', '*.read'],
            requiresApproval: false,
            groups: [],
            agents: [],
            createdAt: '2026-06-13T10:00:00.000Z',
            updatedAt: '2026-06-13T10:00:00.000Z',
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

  it('does not pass MCP env vars for connectors outside the agent boundary', async () => {
    const restrictedGroup: RegisteredGroup = {
      ...testGroup,
      containerConfig: { allowedMcpServers: ['github'] },
    };
    vi.mocked(spawn).mockClear();
    vi.mocked(fs.writeFileSync).mockClear();

    const resultPromise = runContainerAgent(
      restrictedGroup,
      {
        ...testInput,
        groupFolder: restrictedGroup.folder,
      },
      () => {},
    );

    emitOutputMarker(fakeProc, { status: 'success', result: 'Done' });
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalledWith(
      '/tmp/nanocrab-env-test/env',
      expect.stringContaining('MAIL_PASSWORD=secret'),
      { mode: 0o600 },
    );
  });

  it('passes MCP env vars for approval-required read connectors', async () => {
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
      if (String(file).endsWith('connector-permissions.json')) {
        return JSON.stringify([
          {
            connectorId: 'infomaniak',
            scope: 'all',
            allowedActions: ['*.read'],
            requiresApproval: true,
            groups: [],
            agents: [],
            createdAt: '2026-06-13T10:00:00.000Z',
            updatedAt: '2026-06-13T10:00:00.000Z',
          },
        ]);
      }
      return '';
    });
    vi.mocked(fs.writeFileSync).mockClear();

    const resultPromise = runContainerAgent(
      testGroup,
      {
        ...testInput,
        allowedMcpServers: ['infomaniak'],
      },
      () => {},
    );

    emitOutputMarker(fakeProc, { status: 'success', result: 'Done' });
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      '/tmp/nanocrab-env-test/env',
      expect.stringContaining('MAIL_PASSWORD=secret'),
      { mode: 0o600 },
    );
  });

  it('does not pass Google Workspace credentials outside allowed connectors', async () => {
    const restrictedGroup: RegisteredGroup = {
      ...testGroup,
      containerConfig: { allowedMcpServers: ['github'] },
    };
    vi.mocked(fs.existsSync).mockImplementation((file) =>
      String(file).endsWith('connector-permissions.json'),
    );
    vi.mocked(fs.readFileSync).mockImplementation((file) => {
      if (String(file).endsWith('connector-permissions.json')) {
        return JSON.stringify([
          {
            connectorId: 'github',
            scope: 'all',
            allowedActions: ['tools.expose', 'issues.read'],
            requiresApproval: false,
            groups: [],
            agents: [],
            createdAt: '2026-06-13T10:00:00.000Z',
            updatedAt: '2026-06-13T10:00:00.000Z',
          },
        ]);
      }
      return '';
    });
    mockedReadEnvFile.mockReturnValue({
      GOOGLE_OAUTH_CLIENT_ID: 'client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
      GOOGLE_REFRESH_TOKEN: 'refresh-token',
    });
    vi.mocked(fs.writeFileSync).mockClear();

    const resultPromise = runContainerAgent(
      restrictedGroup,
      {
        ...testInput,
        groupFolder: restrictedGroup.folder,
      },
      () => {},
    );

    emitOutputMarker(fakeProc, { status: 'success', result: 'Done' });
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    const envFileWrite = vi
      .mocked(fs.writeFileSync)
      .mock.calls.find((call) => call[0] === '/tmp/nanocrab-env-test/env');
    expect(String(envFileWrite?.[1] || '')).not.toContain(
      'GOOGLE_REFRESH_TOKEN=refresh-token',
    );
    expect(String(envFileWrite?.[1] || '')).not.toContain(
      'GOOGLE_OAUTH_CLIENT_SECRET=client-secret',
    );
  });

  it('passes Google Workspace credentials for allowed mail connectors', async () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (file) =>
        String(file).endsWith('connector-permissions.json') ||
        String(file).endsWith('mcp-servers.json'),
    );
    vi.mocked(fs.readFileSync).mockImplementation((file) => {
      if (String(file).endsWith('mcp-servers.json')) {
        return JSON.stringify([
          {
            name: 'gmail',
            command: 'npx',
            args: ['-y', '@example/gmail-mcp'],
          },
        ]);
      }
      if (String(file).endsWith('connector-permissions.json')) {
        return JSON.stringify([
          {
            connectorId: 'gmail',
            scope: 'all',
            allowedActions: ['tools.expose', 'mail.read'],
            requiresApproval: false,
            groups: [],
            agents: [],
            createdAt: '2026-06-13T10:00:00.000Z',
            updatedAt: '2026-06-13T10:00:00.000Z',
          },
        ]);
      }
      return '';
    });
    mockedReadEnvFile.mockReturnValue({
      GOOGLE_OAUTH_CLIENT_ID: 'client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
      GOOGLE_REFRESH_TOKEN: 'refresh-token',
    });
    vi.mocked(fs.writeFileSync).mockClear();

    const resultPromise = runContainerAgent(
      testGroup,
      {
        ...testInput,
        allowedMcpServers: ['gmail'],
      },
      () => {},
    );

    emitOutputMarker(fakeProc, { status: 'success', result: 'Done' });
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    const envFileWrite = vi
      .mocked(fs.writeFileSync)
      .mock.calls.find((call) => call[0] === '/tmp/nanocrab-env-test/env');
    expect(String(envFileWrite?.[1] || '')).toContain(
      'GOOGLE_REFRESH_TOKEN=refresh-token',
    );
    expect(String(envFileWrite?.[1] || '')).toContain(
      'GOOGLE_OAUTH_CLIENT_SECRET=client-secret',
    );
  });
});

describe('container-runner cowork project mounts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = createFakeProcess();
    mockedReadEnvFile.mockReturnValue({});
    vi.mocked(spawn).mockClear();
    vi.mocked(fs.existsSync).mockImplementation((file) =>
      String(file).includes('/tmp/nanocrab-test-store/projects/research-notes'),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  it('mounts a project workspace for project-scoped web threads', async () => {
    const projectGroup: RegisteredGroup = {
      ...testGroup,
      kind: 'web',
      projectId: 'project-1',
      projectSlug: 'research-notes',
    };

    const resultPromise = runContainerAgent(
      projectGroup,
      {
        ...testInput,
        groupFolder: projectGroup.folder,
        chatJid: 'web:project-thread',
      },
      () => {},
    );

    emitOutputMarker(fakeProc, { status: 'success', result: 'Done' });
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    const spawnArgs = vi.mocked(spawn).mock.calls.at(-1)?.[1] as string[];
    expect(spawnArgs).toContain(
      '/tmp/nanocrab-test-store/projects/research-notes:/workspace/extra/project-research-notes',
    );
  });

  it('passes MCP runtime capabilities into project-scoped web threads', async () => {
    const stdinChunks: string[] = [];
    fakeProc.stdin.on('data', (chunk) => {
      stdinChunks.push(chunk.toString());
    });
    vi.mocked(fs.existsSync).mockImplementation((file) => {
      const value = String(file);
      return (
        value.includes('/tmp/nanocrab-test-store/projects/research-notes') ||
        value.endsWith('mcp-servers.json') ||
        value.endsWith('connector-permissions.json')
      );
    });
    vi.mocked(fs.readFileSync).mockImplementation((file) => {
      if (String(file).endsWith('mcp-servers.json')) {
        return JSON.stringify([
          {
            name: 'gmail',
            command: 'npx',
            args: ['-y', '@example/gmail-mcp'],
          },
          {
            name: 'Google Docs',
            command: 'npx',
            args: ['-y', '@example/google-docs-mcp'],
          },
        ]);
      }
      if (String(file).endsWith('connector-permissions.json')) {
        return JSON.stringify([
          {
            connectorId: 'gmail',
            scope: 'main',
            allowedActions: ['mail.read', 'tools.expose'],
            requiresApproval: true,
            groups: [],
            agents: [],
            createdAt: '2026-06-17T12:00:00.000Z',
            updatedAt: '2026-06-17T12:00:00.000Z',
          },
          {
            connectorId: 'google-docs',
            scope: 'main',
            allowedActions: ['document.write', 'tools.expose'],
            requiresApproval: false,
            groups: [],
            agents: [],
            createdAt: '2026-06-17T12:00:00.000Z',
            updatedAt: '2026-06-17T12:00:00.000Z',
          },
        ]);
      }
      return '';
    });

    const projectGroup: RegisteredGroup = {
      ...testGroup,
      kind: 'web',
      projectId: 'project-1',
      projectSlug: 'research-notes',
    };

    const resultPromise = runContainerAgent(
      projectGroup,
      {
        ...testInput,
        groupFolder: projectGroup.folder,
        chatJid: 'web:project-thread',
      },
      () => {},
    );

    emitOutputMarker(fakeProc, { status: 'success', result: 'Done' });
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    const payload = JSON.parse(stdinChunks.join(''));
    expect(payload.allowedMcpServers).toEqual(
      expect.arrayContaining(['github', 'gmail', 'google-docs']),
    );
    expect(payload.allowedMcpToolPatterns).toEqual(
      expect.arrayContaining([
        'mcp__gmail__list_mail*',
        'mcp__google-docs__create_document*',
      ]),
    );
    expect(payload.runtimeCapabilities).toEqual(
      expect.objectContaining({
        allowExternalWrites: true,
        externalWritesRequireApproval: true,
      }),
    );
    expect(payload.runtimeCapabilities.allowedConnectorIds).toEqual(
      expect.arrayContaining(['nanocrab', 'github', 'gmail', 'google-docs']),
    );
    expect(payload.runtimeCapabilities.allowedToolActions).toContain(
      'external.write',
    );
  });
});
