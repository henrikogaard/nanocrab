/**
 * Container runtime abstraction for NanoCrab.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';

import { logger } from './logger.js';

/** Resolve the configured container runtime binary. */
export function resolveContainerRuntimeBin(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.CONTAINER_RUNTIME_BIN || 'docker';
}

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = resolveContainerRuntimeBin();

/** Hostname containers use to reach the host machine. */
export const CONTAINER_HOST_GATEWAY = 'host.docker.internal';

/**
 * Address the credential proxy binds to.
 * Docker Desktop (macOS): 127.0.0.1 — the VM routes host.docker.internal to loopback.
 * Docker (Linux): bind to the docker0 bridge IP so only containers can reach it,
 *   falling back to 0.0.0.0 if the interface isn't found.
 */
export const PROXY_BIND_HOST =
  process.env.CREDENTIAL_PROXY_HOST || detectProxyBindHost();

function detectProxyBindHost(): string {
  if (os.platform() === 'darwin') return '127.0.0.1';

  // WSL uses Docker Desktop (same VM routing as macOS) — loopback is correct.
  // Check /proc filesystem, not env vars — WSL_DISTRO_NAME isn't set under systemd.
  if (fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) return '127.0.0.1';

  // Bare-metal Linux: bind to the docker0 bridge IP instead of 0.0.0.0
  const ifaces = os.networkInterfaces();
  const docker0 = ifaces['docker0'];
  if (docker0) {
    const ipv4 = docker0.find((a) => a.family === 'IPv4');
    if (ipv4) return ipv4.address;
  }
  return '0.0.0.0';
}

/** CLI args needed for the container to resolve the host gateway. */
export function hostGatewayArgs(): string[] {
  // On Linux, host.docker.internal isn't built-in — add it explicitly
  if (os.platform() === 'linux') {
    return ['--add-host=host.docker.internal:host-gateway'];
  }
  return [];
}

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(
  hostPath: string,
  containerPath: string,
): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

// --- Container hardening flags ---

/**
 * Writable paths inside the agent container that are backed by tmpfs so the
 * root filesystem can be mounted read-only. These are the minimal paths the
 * agent runtimes (Claude, Codex, OpenCode, OpenAI-compatible) need to write to
 * during a normal session.
 */
export const DEFAULT_TMPFS_PATHS = [
  '/tmp',
  '/run',
  '/var/run',
  '/home/node/.cache',
  '/home/node/.npm',
  '/home/node/.config',
  '/home/node/.local',
] as const;

export type ContainerHardeningMode = 'on' | 'off';

/** Whether container hardening flags are enabled. */
export function containerHardeningMode(): ContainerHardeningMode {
  const raw = (process.env.CONTAINER_HARDENING || 'on').toLowerCase();
  return raw === 'off' ? 'off' : 'on';
}

export function isContainerHardeningEnabled(): boolean {
  return containerHardeningMode() === 'on';
}

/**
 * Docker hardening flags for agent containers:
 *   --read-only                  - root filesystem read-only
 *   --cap-drop=ALL               - drop all Linux capabilities
 *   --security-opt no-new-privileges - prevent privilege escalation
 *   --tmpfs <path>               - writable tmpfs for required paths
 *
 * The agent image's entrypoint writes to /tmp, /run, and the node user's home
 * cache/config directories; those are mounted as tmpfs so the read-only root
 * does not break normal operation. Returns an empty array when hardening is
 * disabled (CONTAINER_HARDENING=off) or on platforms where the flags are not
 * supported.
 */
export function containerHardeningArgs(
  tmpfsPaths: readonly string[] = DEFAULT_TMPFS_PATHS,
): string[] {
  if (!isContainerHardeningEnabled()) return [];
  // The flags are Docker-specific; on non-Docker runtimes they may be ignored
  // or rejected. The container runtime is Docker on all supported platforms.
  const args: string[] = [
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt',
    'no-new-privileges',
  ];
  for (const p of tmpfsPaths) {
    args.push('--tmpfs', `${p}:rw,noexec,nosuid,nodev,size=64m`);
  }
  return args;
}

/** Stop a container by name. Uses execFileSync to avoid shell injection. */
export function stopContainer(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    throw new Error(`Invalid container name: ${name}`);
  }
  execFileSync(CONTAINER_RUNTIME_BIN, ['stop', '-t', '1', name], {
    stdio: 'pipe',
  });
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  try {
    execFileSync(CONTAINER_RUNTIME_BIN, ['info'], {
      stdio: 'pipe',
      timeout: 10000,
    });
    logger.debug('Container runtime already running');
  } catch (err) {
    logger.error({ err }, 'Failed to reach container runtime');
    console.error(
      '\n╔════════════════════════════════════════════════════════════════╗',
    );
    console.error(
      '║  FATAL: Container runtime failed to start                      ║',
    );
    console.error(
      '║                                                                ║',
    );
    console.error(
      '║  Agents cannot run without a container runtime. To fix:        ║',
    );
    console.error(
      '║  1. Ensure Docker is installed and running                     ║',
    );
    console.error(
      '║  2. Run: docker info                                           ║',
    );
    console.error(
      '║  3. Restart NanoCrab                                           ║',
    );
    console.error(
      '╚════════════════════════════════════════════════════════════════╝\n',
    );
    throw new Error('Container runtime is required but failed to start', {
      cause: err,
    });
  }
}

/** Kill orphaned NanoCrab containers from previous runs. */
export function cleanupOrphans(): void {
  try {
    const output = execFileSync(
      CONTAINER_RUNTIME_BIN,
      ['ps', '--filter', 'name=nanocrab-', '--format', '{{.Names}}'],
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    );
    const orphans = output.trim().split('\n').filter(Boolean);
    for (const name of orphans) {
      try {
        stopContainer(name);
      } catch {
        /* already stopped */
      }
    }
    if (orphans.length > 0) {
      logger.info(
        { count: orphans.length, names: orphans },
        'Stopped orphaned containers',
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}
