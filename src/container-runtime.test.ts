import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock child_process — store the mock fn so tests can configure it.
// Preserve real exports so transitive imports (e.g. execFile via promisify)
// still work after container-runtime started importing config.js.
const mockExecFileSync = vi.fn();
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
  };
});

import {
  CONTAINER_RUNTIME_BIN,
  resolveContainerRuntimeBin,
  readonlyMountArgs,
  stopContainer,
  ensureContainerRuntimeRunning,
  cleanupOrphans,
  ensureAgentNetwork,
  resetAgentNetworkCache,
  agentNetworkArgs,
  hostGatewayArgs,
  resolveProxyBindHost,
  isNetworkIsolationEnabled,
  runEgressCanary,
} from './container-runtime.js';
import { logger } from './logger.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  resetAgentNetworkCache();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
  resetAgentNetworkCache();
});

// --- Pure functions ---

describe('readonlyMountArgs', () => {
  it('returns -v flag with :ro suffix', () => {
    const args = readonlyMountArgs('/host/path', '/container/path');
    expect(args).toEqual(['-v', '/host/path:/container/path:ro']);
  });
});

describe('resolveContainerRuntimeBin', () => {
  it('uses the configured runtime binary', () => {
    expect(
      resolveContainerRuntimeBin({ CONTAINER_RUNTIME_BIN: 'podman' }),
    ).toBe('podman');
  });

  it('defaults to docker', () => {
    expect(resolveContainerRuntimeBin({})).toBe('docker');
  });
});

describe('stopContainer', () => {
  it('calls docker stop for valid container names', () => {
    stopContainer('nanocrab-test-123');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      CONTAINER_RUNTIME_BIN,
      ['stop', '-t', '1', 'nanocrab-test-123'],
      { stdio: 'pipe' },
    );
  });

  it('rejects names with shell metacharacters', () => {
    expect(() => stopContainer('foo; rm -rf /')).toThrow(
      'Invalid container name',
    );
    expect(() => stopContainer('foo$(whoami)')).toThrow(
      'Invalid container name',
    );
    expect(() => stopContainer('foo`id`')).toThrow('Invalid container name');
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});

// --- ensureContainerRuntimeRunning ---

describe('ensureContainerRuntimeRunning', () => {
  it('does nothing when runtime is already running', () => {
    mockExecFileSync.mockReturnValueOnce('');

    ensureContainerRuntimeRunning();

    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      CONTAINER_RUNTIME_BIN,
      ['info'],
      {
        stdio: 'pipe',
        timeout: 10000,
      },
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'Container runtime already running',
    );
  });

  it('throws when docker info fails', () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('Cannot connect to the Docker daemon');
    });

    expect(() => ensureContainerRuntimeRunning()).toThrow(
      'Container runtime is required but failed to start',
    );
    expect(logger.error).toHaveBeenCalled();
  });
});

// --- cleanupOrphans ---

describe('cleanupOrphans', () => {
  it('stops orphaned nanocrab containers', () => {
    // docker ps returns container names, one per line
    mockExecFileSync.mockReturnValueOnce(
      'nanocrab-group1-111\nnanocrab-group2-222\n',
    );
    // stop calls succeed
    mockExecFileSync.mockReturnValue('');

    cleanupOrphans();

    // ps + 2 stop calls
    expect(mockExecFileSync).toHaveBeenCalledTimes(3);
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      CONTAINER_RUNTIME_BIN,
      ['stop', '-t', '1', 'nanocrab-group1-111'],
      { stdio: 'pipe' },
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      3,
      CONTAINER_RUNTIME_BIN,
      ['stop', '-t', '1', 'nanocrab-group2-222'],
      { stdio: 'pipe' },
    );
    expect(logger.info).toHaveBeenCalledWith(
      { count: 2, names: ['nanocrab-group1-111', 'nanocrab-group2-222'] },
      'Stopped orphaned containers',
    );
  });

  it('does nothing when no orphans exist', () => {
    mockExecFileSync.mockReturnValueOnce('');

    cleanupOrphans();

    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('warns and continues when ps fails', () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('docker not available');
    });

    cleanupOrphans(); // should not throw

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to clean up orphaned containers',
    );
  });

  it('continues stopping remaining containers when one stop fails', () => {
    mockExecFileSync.mockReturnValueOnce('nanocrab-a-1\nnanocrab-b-2\n');
    // First stop fails
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('already stopped');
    });
    // Second stop succeeds
    mockExecFileSync.mockReturnValueOnce('');

    cleanupOrphans(); // should not throw

    expect(mockExecFileSync).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith(
      { count: 2, names: ['nanocrab-a-1', 'nanocrab-b-2'] },
      'Stopped orphaned containers',
    );
  });
});

// --- Agent network isolation ---

function networkInspectOutput(gateway: string): string {
  return JSON.stringify([
    {
      Name: 'nanocrab-agent-net',
      IPAM: { Config: [{ Gateway: gateway }] },
    },
  ]);
}

describe('isNetworkIsolationEnabled', () => {
  it('defaults to on', () => {
    delete process.env.CONTAINER_NETWORK_ISOLATION;
    expect(isNetworkIsolationEnabled()).toBe(true);
  });

  it('can be disabled with off', () => {
    process.env.CONTAINER_NETWORK_ISOLATION = 'off';
    expect(isNetworkIsolationEnabled()).toBe(false);
  });
});

describe('ensureAgentNetwork', () => {
  it('returns disabled info when isolation is off', () => {
    process.env.CONTAINER_NETWORK_ISOLATION = 'off';
    const net = ensureAgentNetwork();
    expect(net.enabled).toBe(false);
    expect(net.internal).toBe(false);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('inspects an existing network and resolves its gateway', () => {
    mockExecFileSync.mockReturnValueOnce(networkInspectOutput('172.30.0.1'));
    const net = ensureAgentNetwork();
    expect(net.enabled).toBe(true);
    expect(net.internal).toBe(true);
    expect(net.gatewayIp).toBe('172.30.0.1');
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      CONTAINER_RUNTIME_BIN,
      ['network', 'inspect', 'nanocrab-agent-net'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('creates the network as internal when inspect fails', () => {
    // First call (inspect) throws — network missing
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('network not found');
    });
    // Second call (create) succeeds
    mockExecFileSync.mockReturnValueOnce('');
    // Third call (re-inspect) returns gateway
    mockExecFileSync.mockReturnValueOnce(networkInspectOutput('172.31.0.1'));

    const net = ensureAgentNetwork();
    expect(net.enabled).toBe(true);
    expect(net.gatewayIp).toBe('172.31.0.1');
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      CONTAINER_RUNTIME_BIN,
      ['network', 'create', '--internal', 'nanocrab-agent-net'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('degrades with a warning when network creation fails', () => {
    // inspect fails, create also fails
    mockExecFileSync.mockImplementation(() => {
      throw new Error('docker daemon unavailable');
    });
    const net = ensureAgentNetwork();
    expect(net.enabled).toBe(false);
    expect(net.gatewayIp).toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('degrades when inspect returns no parseable gateway', () => {
    mockExecFileSync.mockReturnValueOnce('[]');
    const net = ensureAgentNetwork();
    expect(net.enabled).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('caches the result across calls', () => {
    mockExecFileSync.mockReturnValueOnce(networkInspectOutput('172.30.0.1'));
    ensureAgentNetwork();
    ensureAgentNetwork();
    ensureAgentNetwork();
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });
});

describe('agentNetworkArgs', () => {
  it('returns --network flag when isolation is active', () => {
    mockExecFileSync.mockReturnValueOnce(networkInspectOutput('172.30.0.1'));
    expect(agentNetworkArgs()).toEqual(['--network', 'nanocrab-agent-net']);
  });

  it('returns empty when isolation is off', () => {
    process.env.CONTAINER_NETWORK_ISOLATION = 'off';
    expect(agentNetworkArgs()).toEqual([]);
  });
});

describe('hostGatewayArgs (isolation-aware)', () => {
  it('maps host.docker.internal to the internal gateway when active', () => {
    mockExecFileSync.mockReturnValueOnce(networkInspectOutput('172.30.0.1'));
    expect(hostGatewayArgs()).toEqual([
      '--add-host=host.docker.internal:172.30.0.1',
    ]);
  });

  it('falls back to host-gateway keyword when isolation is off on linux', () => {
    process.env.CONTAINER_NETWORK_ISOLATION = 'off';
    // On the test platform (linux) the fallback uses the host-gateway keyword.
    expect(hostGatewayArgs()).toEqual([
      '--add-host=host.docker.internal:host-gateway',
    ]);
  });
});

describe('resolveProxyBindHost', () => {
  it('binds to the internal gateway when isolation is active', () => {
    mockExecFileSync.mockReturnValueOnce(networkInspectOutput('172.30.0.1'));
    expect(resolveProxyBindHost()).toBe('172.30.0.1');
  });

  it('falls back to the default bind host when isolation is off', () => {
    process.env.CONTAINER_NETWORK_ISOLATION = 'off';
    // Should not throw and should return a non-empty host.
    expect(typeof resolveProxyBindHost()).toBe('string');
    expect(resolveProxyBindHost().length).toBeGreaterThan(0);
  });
});

describe('runEgressCanary', () => {
  it('reports not-run when isolation is disabled', () => {
    process.env.CONTAINER_NETWORK_ISOLATION = 'off';
    const result = runEgressCanary();
    expect(result.ran).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.error).toMatch(/not enabled/);
  });

  it('reports blocked when the canary container exits 0', () => {
    mockExecFileSync.mockReturnValueOnce(networkInspectOutput('172.30.0.1'));
    // ensureAgentNetwork runs via runEgressCanary's first call; the next
    // execFileSync call is the canary container run, returning empty (exit 0).
    mockExecFileSync.mockReturnValueOnce('BLOCKED (timeout)\n');
    const result = runEgressCanary();
    expect(result.ran).toBe(true);
    expect(result.blocked).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('reports not-blocked when the canary container connects (exit 2)', () => {
    mockExecFileSync.mockReturnValueOnce(networkInspectOutput('172.30.0.1'));
    const canaryError = Object.assign(new Error('exit 2'), {
      code: 'STATUS_2',
      stdout: 'CONNECTED to canary-egress-probe.invalid\n',
    });
    mockExecFileSync.mockImplementationOnce(() => {
      throw canaryError;
    });
    const result = runEgressCanary();
    expect(result.ran).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/NOT enforced/);
  });
});
