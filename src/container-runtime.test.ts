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

// Mock child_process — store the mock fn so tests can configure it
const mockExecFileSync = vi.fn();
vi.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

import {
  CONTAINER_RUNTIME_BIN,
  resolveContainerRuntimeBin,
  readonlyMountArgs,
  stopContainer,
  ensureContainerRuntimeRunning,
  cleanupOrphans,
  containerHardeningArgs,
  isContainerHardeningEnabled,
  DEFAULT_TMPFS_PATHS,
} from './container-runtime.js';
import { logger } from './logger.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CONTAINER_HARDENING;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
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

// --- Container hardening flags ---

describe('containerHardeningArgs', () => {
  it('is enabled by default and emits read-only, cap-drop, no-new-privileges, and tmpfs flags', () => {
    delete process.env.CONTAINER_HARDENING;
    const args = containerHardeningArgs();
    expect(args).toContain('--read-only');
    expect(args).toContain('--cap-drop=ALL');
    expect(args).toContain('no-new-privileges');
    // tmpfs entries for each default writable path
    for (const p of DEFAULT_TMPFS_PATHS) {
      const idx = args.indexOf('--tmpfs');
      expect(args.slice(idx + 1)).toContain(
        `${p}:rw,noexec,nosuid,nodev,size=64m`,
      );
    }
  });

  it('returns an empty array when CONTAINER_HARDENING=off', () => {
    process.env.CONTAINER_HARDENING = 'off';
    expect(containerHardeningArgs()).toEqual([]);
    expect(isContainerHardeningEnabled()).toBe(false);
  });

  it('respects a custom tmpfs path list', () => {
    const args = containerHardeningArgs(['/custom/tmp']);
    const tmpfsValues = args.filter((_v, i) => args[i - 1] === '--tmpfs');
    expect(tmpfsValues).toEqual([
      '/custom/tmp:rw,noexec,nosuid,nodev,size=64m',
    ]);
  });

  it('marks tmpfs mounts with noexec,nosuid,nodev', () => {
    const args = containerHardeningArgs(['/tmp']);
    const tmpfsValue = args[args.indexOf('--tmpfs') + 1];
    expect(tmpfsValue).toMatch(/noexec/);
    expect(tmpfsValue).toMatch(/nosuid/);
    expect(tmpfsValue).toMatch(/nodev/);
  });
});
