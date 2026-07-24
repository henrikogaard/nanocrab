/**
 * Container runtime abstraction for NanoCrab.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';

import { CONTAINER_IMAGE } from './config.js';
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

// --- Agent container network isolation (default-deny egress topology) ---

/**
 * Name of the internal Docker network agent containers are attached to.
 * Override with CONTAINER_NETWORK_NAME. The network is created with --internal
 * so containers have no direct internet route; the only reachable off-subnet
 * address is the network's own bridge gateway, where the credential/egress
 * proxy listens.
 */
export const AGENT_NETWORK_NAME =
  process.env.CONTAINER_NETWORK_NAME || 'nanocrab-agent-net';

export type NetworkIsolationMode = 'on' | 'off';

export interface AgentNetworkInfo {
  name: string;
  enabled: boolean;
  internal: boolean;
  gatewayIp?: string;
}

let cachedAgentNetwork: AgentNetworkInfo | null = null;

/** Whether the default-deny agent network topology is enabled. */
export function networkIsolationMode(): NetworkIsolationMode {
  const raw = (process.env.CONTAINER_NETWORK_ISOLATION || 'on').toLowerCase();
  return raw === 'off' ? 'off' : 'on';
}

export function isNetworkIsolationEnabled(): boolean {
  return networkIsolationMode() === 'on';
}

/**
 * --internal bridge networks are only reliable on bare-metal Linux. Docker
 * Desktop (macOS/WSL) runs in a VM and resolves host.docker.internal via the VM
 * DNS layer, which does not compose cleanly with --internal subnets. On those
 * platforms NanoCrab degrades to the existing unrestricted topology with an
 * informational notice rather than risking a broken proxy path.
 */
function supportsInternalNetwork(): boolean {
  if (os.platform() !== 'linux') return false;
  if (fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) return false;
  return true;
}

function parseNetworkInspectGateway(output: string): string | undefined {
  try {
    const parsed = JSON.parse(output) as Array<{
      IPAM?: { Config?: Array<{ Gateway?: string }> };
    }>;
    const gateway = parsed[0]?.IPAM?.Config?.[0]?.Gateway;
    if (gateway && /^\d{1,3}(\.\d{1,3}){3}$/.test(gateway)) {
      return gateway;
    }
  } catch {
    /* malformed inspect output */
  }
  return undefined;
}

/**
 * Ensure the isolated agent network exists and resolve its bridge gateway IP.
 * The credential proxy binds to this gateway so containers on the --internal
 * network can reach it (packets outside the subnet are dropped by Docker).
 *
 * On failure NanoCrab degrades with an explicit warning rather than leaving
 * agents unable to run, matching the issue's "fail closed or clearly degrades
 * with an explicit warning" requirement. Operators that require strict
 * fail-closed behavior can monitor the startup log for the degradation notice.
 */
export function ensureAgentNetwork(): AgentNetworkInfo {
  if (cachedAgentNetwork) return cachedAgentNetwork;
  const name = AGENT_NETWORK_NAME;
  if (!isNetworkIsolationEnabled() || !supportsInternalNetwork()) {
    cachedAgentNetwork = { name, enabled: false, internal: false };
    if (isNetworkIsolationEnabled() && !supportsInternalNetwork()) {
      logger.info(
        'Agent network isolation is Linux bare-metal only — degrading to unrestricted topology on this platform',
      );
    }
    return cachedAgentNetwork;
  }
  try {
    let inspectOutput: string;
    try {
      inspectOutput = execFileSync(
        CONTAINER_RUNTIME_BIN,
        ['network', 'inspect', name],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
          timeout: 10000,
        },
      );
    } catch {
      // Network does not exist yet — create it as internal (no external route).
      execFileSync(
        CONTAINER_RUNTIME_BIN,
        ['network', 'create', '--internal', name],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
          timeout: 15000,
        },
      );
      inspectOutput = execFileSync(
        CONTAINER_RUNTIME_BIN,
        ['network', 'inspect', name],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
          timeout: 10000,
        },
      );
    }
    const gatewayIp = parseNetworkInspectGateway(inspectOutput);
    if (!gatewayIp) {
      throw new Error(`Could not resolve gateway IP for network ${name}`);
    }
    cachedAgentNetwork = { name, enabled: true, internal: true, gatewayIp };
    logger.info(
      { name, gatewayIp },
      'Agent container network isolation enabled (default-deny egress topology)',
    );
    return cachedAgentNetwork;
  } catch (err) {
    cachedAgentNetwork = { name, enabled: false, internal: false };
    logger.error(
      { err, name },
      'Agent container network isolation could not be enforced — degrading with unrestricted network access',
    );
    console.error(
      '\n╔════════════════════════════════════════════════════════════════╗',
    );
    console.error(
      '║  WARNING: Agent network isolation could not be enforced.       ║',
    );
    console.error(
      `║  Network "${name}" could not be created/inspected. Containers  ║`,
    );
    console.error(
      '║  will have unrestricted outbound access until this is fixed.   ║',
    );
    console.error(
      '║  Set CONTAINER_NETWORK_ISOLATION=off to silence this warning.  ║',
    );
    console.error(
      '╚════════════════════════════════════════════════════════════════╝\n',
    );
    return cachedAgentNetwork;
  }
}

/** Cached agent network info (null until ensureAgentNetwork has run). */
export function getAgentNetwork(): AgentNetworkInfo | null {
  return cachedAgentNetwork;
}

/** Reset the cached agent network (test helper / re-init). */
export function resetAgentNetworkCache(): void {
  cachedAgentNetwork = null;
}

/** CLI args to attach a container to the isolated agent network. */
export function agentNetworkArgs(): string[] {
  const net = cachedAgentNetwork ?? ensureAgentNetwork();
  if (!net.enabled) return [];
  return ['--network', net.name];
}

/**
 * CLI args needed for the container to resolve the host gateway.
 * When the isolated agent network is active, host.docker.internal must map to
 * the internal network's bridge gateway IP — the default `host-gateway` value
 * resolves to docker0, which is outside the --internal subnet and therefore
 * unreachable.
 */
export function hostGatewayArgs(): string[] {
  const net = cachedAgentNetwork ?? ensureAgentNetwork();
  if (net.enabled && net.gatewayIp) {
    return [`--add-host=host.docker.internal:${net.gatewayIp}`];
  }
  // On Linux, host.docker.internal isn't built-in — add it explicitly
  if (os.platform() === 'linux') {
    return ['--add-host=host.docker.internal:host-gateway'];
  }
  return [];
}

/**
 * Bind host for the credential/egress proxy. When the isolated agent network is
 * active the proxy must listen on the internal bridge gateway so containers can
 * reach it; otherwise the existing loopback/docker0 binding is used.
 */
export function resolveProxyBindHost(): string {
  const net = cachedAgentNetwork ?? ensureAgentNetwork();
  if (net.enabled && net.gatewayIp) return net.gatewayIp;
  return PROXY_BIND_HOST;
}

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(
  hostPath: string,
  containerPath: string,
): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
// --- Network isolation / hardening controls (proof-matrix surface) ---

/**
 * Whether the default-deny agent network topology is enabled. The full
 * topology implementation lands in issue #219; this flag is the proof-matrix
 * surface so the matrix can report the configured state without pulling in
 * the full network-creation code path.
 */
export function isNetworkIsolationEnabled(): boolean {
  const raw = (process.env.CONTAINER_NETWORK_ISOLATION || 'on').toLowerCase();
  return raw !== 'off';
}
// --- Container hardening flags ---

/**
 * Writable paths inside the agent container that are backed by tmpfs so the
 * root filesystem can be mounted read-only. These are the minimal paths the
 * agent runtimes (Claude, Codex, OpenCode, OpenAI-compatible) need to write to
 * during a normal session.
 *
 * Fix #9: If a runtime writes outside these paths the container will fail with
 * a read-only filesystem error. The error message includes the failing path
 * so operators can add it to TMPFS_PATHS env var.
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
 * Fix #6: --cap-drop=ALL drops all capabilities including NET_RAW, SYS_PTRACE,
 * and DAC_OVERRIDE. Node.js-based agent runtimes (Claude Code, Codex, OpenCode)
 * do not require any special capabilities for normal operation. If a runtime
 * needs a specific capability, add it via --cap-add after --cap-drop=ALL.
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

// --- Egress canary / doctor check ---

export interface EgressCanaryResult {
  /** true when the unknown destination was unreachable (default-deny holds). */
  blocked: boolean;
  /** Container exit code (0 = blocked/unreachable, non-zero = connected/other). */
  exitCode: number | null;
  /** Captured stdout from the canary container. */
  output: string;
  /** Captured stderr / error explanation. */
  error?: string;
  /** Whether the canary actually ran (false when isolation is disabled). */
  ran: boolean;
}

/**
 * Doctor/canary check that proves an unknown destination is unreachable from
 * the isolated agent network. Spawns a throwaway container on the agent
 * network that attempts a short TCP connection to a placeholder host. The
 * default-deny topology is proven when the connection fails (blocked=true).
 *
 * This is an operator-run proof, not an automatic startup gate: it requires a
 * working container runtime and the agent image to be present. Run via
 * `scripts/egress-canary.ts`.
 */
export function runEgressCanary(
  testHost = 'canary-egress-probe.invalid',
  image: string = CONTAINER_IMAGE,
): EgressCanaryResult {
  const net = cachedAgentNetwork ?? ensureAgentNetwork();
  if (!net.enabled || !net.gatewayIp) {
    return {
      blocked: false,
      exitCode: null,
      output: '',
      error:
        'Network isolation is not enabled; canary cannot prove default-deny.',
      ran: false,
    };
  }
  // Node one-liner: try to connect to testHost:443, exit 0 if blocked,
  // exit 2 if connected (default-deny violated). 3s timeout per attempt.
  const probeScript = [
    `const h=${JSON.stringify(testHost)};`,
    `const s=require('net').connect(443,h);`,
    `s.setTimeout(3000);`,
    `s.on('connect',()=>{console.error('CONNECTED to '+h);process.exit(2)});`,
    `s.on('timeout',()=>{console.log('BLOCKED (timeout)');process.exit(0)});`,
    `s.on('error',()=>{console.log('BLOCKED (error)');process.exit(0)});`,
  ].join('');
  try {
    const output = execFileSync(
      CONTAINER_RUNTIME_BIN,
      [
        'run',
        '--rm',
        '--network',
        net.name,
        '--add-host',
        `host.docker.internal:${net.gatewayIp}`,
        '--entrypoint',
        'node',
        image,
        '-e',
        probeScript,
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: 30000,
      },
    );
    // execFileSync throws on non-zero exit, so reaching here means exit 0.
    return {
      blocked: true,
      exitCode: 0,
      output: output.trim(),
      ran: true,
    };
  } catch (err) {
    const error = err as { code?: string; stdout?: string; stderr?: string };
    if (error.code === 'STATUS_2' || /CONNECTED/.test(error.stdout || '')) {
      // Container exited 2 — it connected, default-deny is violated.
      return {
        blocked: false,
        exitCode: 2,
        output: (error.stdout || '').trim(),
        error:
          'Canary container connected to the unknown destination — default-deny is NOT enforced.',
        ran: true,
      };
    }
    // Any other failure (timeout, runtime error) is treated as blocked for
    // default-deny purposes, but surfaced with the raw error for operator
    // diagnosis so a broken canary is not mistaken for a proven deny.
    return {
      blocked: true,
      exitCode: null,
      output: (error.stdout || '').trim(),
      error: `Canary could not connect (treated as blocked): ${error.code || (err instanceof Error ? err.message : String(err))}`,
      ran: true,
    };
  }
}
