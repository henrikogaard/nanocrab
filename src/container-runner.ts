/**
 * Container Runner for NanoCrab
 * Spawns agent execution in containers and handles IPC
 */
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  CREDENTIAL_PROXY_PORT,
  DATA_DIR,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  STORE_DIR,
  TIMEZONE,
} from './config.js';
import { resolveGroupFolderPath, resolveGroupIpcPath } from './group-folder.js';
import { logger } from './logger.js';
import {
  CONTAINER_HOST_GATEWAY,
  CONTAINER_RUNTIME_BIN,
  hostGatewayArgs,
  readonlyMountArgs,
  stopContainer,
} from './container-runtime.js';
import { readEnvFile } from './env.js';
import {
  AgentProvider,
  DEFAULT_AGENT_MODELS,
  getAgentProviderDefinition,
  getAgentProviderConfig,
  isAgentProvider,
  providerBaseUrlEnvKey,
} from './agent-provider.js';
import { detectAuthMode } from './credential-proxy.js';
import { validateAdditionalMounts } from './mount-security.js';
import {
  prepareActiveSkillsDirectory,
  recordSkillRoutingDecision,
  selectSkillsForRequest,
} from './skill-registry.js';
import { RegisteredGroup } from './types.js';
import {
  resolveProviderFallbackForAction,
  type ProviderPurpose,
} from './provider-router.js';
import type { FallbackAction } from './providers/fallback-policy.js';
import { logAuditEvent } from './audit-log.js';
import { evaluatePolicy } from './policy-engine.js';
import {
  canUseProviderProfile,
  deriveRuntimeCapabilities,
  resolveAgentBoundary,
  type AgentBoundary,
} from './agent-boundaries.js';
import {
  filterAllowedConnectorIds,
  getAllowedConnectorToolPatterns,
  normalizeConnectorId,
} from './connector-permissions.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---NANOCRAB_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCRAB_OUTPUT_END---';

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  script?: string;
  allowedMcpServers?: string[];
  allowedMcpToolPatterns?: string[];
  restrictions?: string;
  model?: string;
  provider?: AgentProvider;
  providerFallbackPurpose?: ProviderPurpose;
  providerFallbackAction?: FallbackAction;
  dryRun?: boolean;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

interface BuiltContainerArgs {
  args: string[];
  envFilePath?: string;
}

function writeDockerEnvFile(
  containerName: string,
  env: Record<string, string>,
): string {
  const dir = fs.mkdtempSync(path.join('/tmp', `${containerName}-env-`));
  const envFilePath = path.join(dir, 'env');
  const lines = Object.entries(env).map(([key, value]) => {
    if (value.includes('\n') || value.includes('\r')) {
      throw new Error(`Environment variable ${key} contains a newline`);
    }
    return `${key}=${value}`;
  });
  fs.writeFileSync(envFilePath, `${lines.join('\n')}\n`, { mode: 0o600 });
  return envFilePath;
}

function removeDockerEnvFile(envFilePath?: string): void {
  if (!envFilePath) return;
  try {
    fs.rmSync(path.dirname(envFilePath), { recursive: true, force: true });
  } catch (err) {
    logger.warn({ envFilePath, err }, 'Failed to remove container env file');
  }
}

function syncSkillDirectory(sourceDir: string, destinationDir: string): void {
  if (!fs.existsSync(sourceDir)) return;

  fs.rmSync(destinationDir, { recursive: true, force: true });
  fs.mkdirSync(destinationDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir)) {
    const src = path.join(sourceDir, entry);
    const dst = path.join(destinationDir, entry);
    if (fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dst, { recursive: true });
    }
  }
}

function latestMtimeMs(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let latest = fs.statSync(dir).mtimeMs;
  for (const entry of fs.readdirSync(dir)) {
    const filePath = path.join(dir, entry);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      latest = Math.max(latest, latestMtimeMs(filePath));
    } else {
      latest = Math.max(latest, stat.mtimeMs);
    }
  }
  return latest;
}

function loadConfiguredConnectorIds(): string[] {
  const ids = new Set(['nanocrab', 'github']);
  try {
    const mcpConfigPath = path.join(STORE_DIR, 'mcp-servers.json');
    if (fs.existsSync(mcpConfigPath)) {
      const servers = JSON.parse(
        fs.readFileSync(mcpConfigPath, 'utf-8'),
      ) as Array<{ name?: string }>;
      for (const server of servers) {
        const connectorId = normalizeConnectorId(server.name);
        if (connectorId) ids.add(connectorId);
      }
    }
  } catch {
    /* ignore malformed MCP server config */
  }
  return Array.from(ids);
}

function prepareRuntimeMcpConfigMount(
  groupFolder: string,
  connectorIds: string[],
  isMain: boolean,
): string | null {
  if (isMain || !connectorIds.length) return null;
  const sourcePath = path.join(STORE_DIR, 'mcp-servers.json');
  if (!fs.existsSync(sourcePath)) return null;

  const allowed = new Set(connectorIds.map((id) => normalizeConnectorId(id)));
  const configured = JSON.parse(fs.readFileSync(sourcePath, 'utf-8')) as Array<{
    name?: string;
    command?: string;
    args?: string[];
    envVars?: string[];
  }>;
  const runtimeServers = configured
    .filter((server) => allowed.has(normalizeConnectorId(server.name)))
    .map((server) => ({
      name: server.name,
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      envVars: Array.isArray(server.envVars) ? server.envVars : [],
    }))
    .filter((server) => server.name && server.command);
  if (!runtimeServers.length) return null;

  const safeFolder = groupFolder.replace(/[^a-zA-Z0-9-]/g, '-') || 'default';
  const targetDir = path.join(DATA_DIR, 'runtime-mcp-config', safeFolder);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, 'mcp-servers.json'),
    `${JSON.stringify(runtimeServers, null, 2)}\n`,
  );
  return targetDir;
}

function connectorIdsFromMcpToolPatterns(patterns: string[]): string[] {
  return Array.from(
    new Set(
      patterns
        .map((pattern) => pattern.match(/^mcp__([^_]+)__/)?.[1])
        .filter((connectorId): connectorId is string => Boolean(connectorId)),
    ),
  );
}

function isCoworkProjectWebGroup(group: RegisteredGroup): boolean {
  return group.kind === 'web' && Boolean(group.projectId || group.projectSlug);
}

function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
  request?: string,
  sessionId?: string,
  agentBoundary?: AgentBoundary,
  runtimeMcpConnectorIds: string[] = [],
): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const projectRoot = process.cwd();
  const groupDir = resolveGroupFolderPath(group.folder);
  const skillSelection = request
    ? selectSkillsForRequest(request, { isMain, agentBoundary })
    : undefined;
  const skillsSrc = prepareActiveSkillsDirectory({
    groupFolder: group.folder,
    isMain,
    request,
    agentBoundary,
  });
  if (request) {
    recordSkillRoutingDecision({
      groupFolder: group.folder,
      isMain,
      request,
      sessionId,
      selection: skillSelection,
    });
  }

  if (isMain) {
    // Main gets the project root read-only. Writable paths the agent needs
    // (store, group folder, IPC, provider homes) are mounted separately below.
    // Read-only prevents the agent from modifying host application code
    // (src/, dist/, package.json, etc.) which would bypass the sandbox
    // entirely on next restart.
    mounts.push({
      hostPath: projectRoot,
      containerPath: '/workspace/project',
      readonly: true,
    });

    // Shadow .env so the agent cannot read secrets from the mounted project root.
    // Credentials are injected by the credential proxy, never exposed to containers.
    const envFile = path.join(projectRoot, '.env');
    if (fs.existsSync(envFile)) {
      mounts.push({
        hostPath: '/dev/null',
        containerPath: '/workspace/project/.env',
        readonly: true,
      });
    }

    // Main gets writable access to the store (SQLite DB) so it can
    // query and write to the database directly.
    const storeDir = path.join(projectRoot, 'store');
    mounts.push({
      hostPath: storeDir,
      containerPath: '/workspace/project/store',
      readonly: false,
    });

    // Main also gets its group folder as the working directory
    mounts.push({
      hostPath: groupDir,
      containerPath: '/workspace/group',
      readonly: false,
    });

    // Global memory directory — writable for main so it can update shared context
    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({
        hostPath: globalDir,
        containerPath: '/workspace/global',
        readonly: false,
      });
    }
  } else {
    // Other groups only get their own folder
    mounts.push({
      hostPath: groupDir,
      containerPath: '/workspace/group',
      readonly: false,
    });

    // Global memory directory (read-only for non-main)
    // Only directory mounts are supported, not file mounts
    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({
        hostPath: globalDir,
        containerPath: '/workspace/global',
        readonly: true,
      });
    }
  }

  if (
    group.kind === 'web' &&
    group.projectSlug &&
    /^[a-z0-9-]+$/.test(group.projectSlug)
  ) {
    const projectDir = path.join(STORE_DIR, 'projects', group.projectSlug);
    if (fs.existsSync(projectDir)) {
      mounts.push({
        hostPath: projectDir,
        containerPath: `/workspace/extra/project-${group.projectSlug}`,
        readonly: false,
      });
    }
  }

  const mcpConfigDir = prepareRuntimeMcpConfigMount(
    group.folder,
    runtimeMcpConnectorIds,
    isMain,
  );
  if (mcpConfigDir) {
    mounts.push({
      hostPath: mcpConfigDir,
      containerPath: '/workspace/mcp-config',
      readonly: true,
    });
  }

  // Per-group Claude SDK home (isolated from other groups).
  // Claude Code still expects ~/.claude for session state and native skill
  // discovery, but NanoCrab treats container/skills as the provider-neutral
  // source of truth and mirrors it into provider-specific homes below.
  const groupSessionsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.claude',
  );
  fs.mkdirSync(groupSessionsDir, { recursive: true });
  const settingsFile = path.join(groupSessionsDir, 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(
      settingsFile,
      JSON.stringify(
        {
          env: {
            // Enable agent swarms (subagent orchestration)
            // https://code.claude.com/docs/en/agent-teams#orchestrate-teams-of-claude-code-sessions
            CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
            // Keep Claude's legacy CLAUDE.md directory loading enabled.
            // NanoCrab itself reads AGENTS.md first.
            // https://code.claude.com/docs/en/memory#load-memory-from-additional-directories
            CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
            // Enable Claude's memory feature (persists user preferences between sessions)
            // https://code.claude.com/docs/en/memory#manage-auto-memory
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
          },
        },
        null,
        2,
      ) + '\n',
    );
  }

  syncSkillDirectory(skillsSrc, path.join(groupSessionsDir, 'skills'));
  mounts.push({
    hostPath: skillsSrc,
    containerPath: '/workspace/skills',
    readonly: true,
  });
  // Optional shared data directories for custom MCP servers
  // Auto-mount any subdirectory of data/ that has a .mount marker file
  // or is listed in data/.mounts (one dir name per line)
  const mountsFile = path.join(DATA_DIR, '.mounts');
  const autoMountDirs = fs.existsSync(mountsFile)
    ? fs.readFileSync(mountsFile, 'utf-8').split('\n').filter(Boolean)
    : [];
  for (const dirName of autoMountDirs) {
    const dirPath = path.join(DATA_DIR, dirName);
    if (fs.existsSync(dirPath)) {
      mounts.push({
        hostPath: dirPath,
        containerPath: `/home/node/.${dirName}`,
        readonly: false,
      });
    }
  }

  // Shared Codex OAuth tokens (persists ChatGPT login across containers)
  const codexDir = path.join(DATA_DIR, 'codex');
  fs.mkdirSync(codexDir, { recursive: true });
  syncSkillDirectory(skillsSrc, path.join(codexDir, 'skills'));
  mounts.push({
    hostPath: codexDir,
    containerPath: '/home/node/.codex',
    readonly: false,
  });

  // Shared OpenCode config/auth storage.
  const opencodeConfigDir = path.join(DATA_DIR, 'opencode', 'config');
  const opencodeDataDir = path.join(DATA_DIR, 'opencode', 'data');
  fs.mkdirSync(opencodeConfigDir, { recursive: true });
  fs.mkdirSync(opencodeDataDir, { recursive: true });
  mounts.push({
    hostPath: opencodeConfigDir,
    containerPath: '/home/node/.config/opencode',
    readonly: false,
  });
  mounts.push({
    hostPath: opencodeDataDir,
    containerPath: '/home/node/.local/share/opencode',
    readonly: false,
  });

  mounts.push({
    hostPath: groupSessionsDir,
    containerPath: '/home/node/.claude',
    readonly: false,
  });

  // Per-group IPC namespace: each group gets its own IPC directory
  // This prevents cross-group privilege escalation via IPC
  const groupIpcDir = resolveGroupIpcPath(group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });
  mounts.push({
    hostPath: groupIpcDir,
    containerPath: '/workspace/ipc',
    readonly: false,
  });

  // Copy agent-runner source into a per-group writable location so agents
  // can customize it (add tools, change behavior) without affecting other
  // groups. Recompiled on container startup via entrypoint.sh.
  const agentRunnerSrc = path.join(
    projectRoot,
    'container',
    'agent-runner',
    'src',
  );
  const groupAgentRunnerDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    'agent-runner-src',
  );
  if (fs.existsSync(agentRunnerSrc)) {
    const needsCopy =
      !fs.existsSync(groupAgentRunnerDir) ||
      latestMtimeMs(agentRunnerSrc) > latestMtimeMs(groupAgentRunnerDir);
    if (needsCopy) {
      fs.cpSync(agentRunnerSrc, groupAgentRunnerDir, { recursive: true });
    }
  }
  mounts.push({
    hostPath: groupAgentRunnerDir,
    containerPath: '/app/src',
    readonly: false,
  });

  // Additional mounts validated against external allowlist (tamper-proof from containers)
  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      isMain,
    );
    mounts.push(...validatedMounts);
  }

  return mounts;
}

function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
  allowedMcpServers?: string[],
  provider?: AgentProvider,
  model?: string,
): BuiltContainerArgs {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];
  const env: Record<string, string> = {};
  const setEnv = (key: string, value: string | undefined) => {
    if (value) env[key] = value;
  };
  const defaults = getAgentProviderConfig();
  const effectiveProvider = provider || defaults.provider;
  const effectiveModel =
    model ||
    defaults.modelsByProvider[effectiveProvider] ||
    DEFAULT_AGENT_MODELS[effectiveProvider];
  const providerDefinition = getAgentProviderDefinition(effectiveProvider);
  const allowedMcpServerSet = new Set(
    (allowedMcpServers || []).map((server) => normalizeConnectorId(server)),
  );
  const isMcpAllowed = (serverName: string): boolean =>
    allowedMcpServers === undefined ||
    allowedMcpServerSet.has(normalizeConnectorId(serverName));
  const providerEnvKeys = [
    providerDefinition.envKey,
    providerDefinition.baseUrlEnvKey,
    providerBaseUrlEnvKey(effectiveProvider),
    'DEFAULT_MODEL',
    'DEFAULT_PROVIDER',
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'OPENCODE_API_KEY',
    'OLLAMA_BASE_URL',
    'OLLAMA_HOST',
    'FAL_KEY',
    'LEONARDO_API_KEY',
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_REFRESH_TOKEN',
    'GITHUB_TOKEN',
    'NANOCRAB_API_TOKEN',
  ].filter(Boolean) as string[];
  const envFileValues = readEnvFile([...new Set(providerEnvKeys)]);
  const envValue = (key: string): string | undefined =>
    process.env[key] || envFileValues[key];

  // Pass host timezone so container's local time matches the user's
  setEnv('TZ', TIMEZONE);

  // Route API traffic through the credential proxy (containers never see real secrets)
  setEnv(
    'ANTHROPIC_BASE_URL',
    `http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}`,
  );

  // Mirror the host's auth method with a placeholder value.
  // API key mode: SDK sends x-api-key, proxy replaces with real key.
  // OAuth mode:   SDK exchanges placeholder token for temp API key,
  //               proxy injects real OAuth token on that exchange request.
  const authMode = detectAuthMode();
  if (authMode === 'api-key') {
    setEnv('ANTHROPIC_API_KEY', 'placeholder');
  } else {
    setEnv('CLAUDE_CODE_OAUTH_TOKEN', 'placeholder');
  }

  // Pass AI service credentials to container. When Codex is the agent provider,
  // do not pass OPENAI_API_KEY; Codex should use the mounted ChatGPT OAuth login
  // at /home/node/.codex instead of falling back to API billing.
  const aiVars =
    effectiveProvider === 'codex'
      ? ['FAL_KEY', 'LEONARDO_API_KEY']
      : ['OPENAI_API_KEY', 'FAL_KEY', 'LEONARDO_API_KEY'];
  for (const key of aiVars) {
    setEnv(key, envValue(key));
  }

  // Pass Google Workspace credentials only when a connector inside the active
  // boundary needs them. This keeps unrelated chat/code containers from
  // receiving mail/calendar credentials by default.
  const needsGoogleWorkspaceCredentials =
    isMcpAllowed('gmail') ||
    isMcpAllowed('google-mail') ||
    isMcpAllowed('calendar') ||
    isMcpAllowed('google-calendar') ||
    isMcpAllowed('google-docs') ||
    isMcpAllowed('gdrive') ||
    isMcpAllowed('google-drive');
  if (needsGoogleWorkspaceCredentials) {
    const googleVars = [
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'GOOGLE_REFRESH_TOKEN',
    ];
    for (const key of googleVars) {
      setEnv(key, envValue(key));
    }
  }

  // Pass GitHub token only when the GitHub connector is inside the boundary.
  if (isMcpAllowed('github')) {
    setEnv(
      'GITHUB_TOKEN',
      envValue('GITHUB_TOKEN') || process.env.GITHUB_TOKEN,
    );
  }

  // Pass admin API token for container skills
  setEnv(
    'NANOCRAB_API_TOKEN',
    envValue('NANOCRAB_API_TOKEN') || process.env.NANOCRAB_API_TOKEN,
  );

  // Pass env vars required by custom MCP servers
  try {
    const mcpConfigPath = path.join(STORE_DIR, 'mcp-servers.json');
    if (fs.existsSync(mcpConfigPath)) {
      const servers = JSON.parse(
        fs.readFileSync(mcpConfigPath, 'utf-8'),
      ) as Array<{ name?: string; envVars?: string[] }>;
      const envKeys = [...new Set(servers.flatMap((srv) => srv.envVars || []))];
      const envFileValues = readEnvFile(envKeys);
      const passedKeys = new Set<string>();
      for (const srv of servers) {
        if (!srv.name || !isMcpAllowed(srv.name)) continue;
        for (const key of srv.envVars || []) {
          const value = process.env[key] || envFileValues[key];
          if (
            value &&
            !passedKeys.has(key) &&
            !(effectiveProvider === 'codex' && key === 'OPENAI_API_KEY')
          ) {
            setEnv(key, value);
            passedKeys.add(key);
          }
        }
      }
    }
  } catch {
    /* ignore malformed MCP server config */
  }

  // Runtime-specific args for host gateway resolution
  args.push(...hostGatewayArgs());

  // Run as host user so bind-mounted files are accessible.
  // Skip when running as root (uid 0), as the container's node user (uid 1000),
  // or when getuid is unavailable (native Windows without WSL).
  const hostUid = process.getuid?.();
  const hostGid = process.getgid?.();
  if (hostUid != null && hostUid !== 0 && hostUid !== 1000) {
    args.push('--user', `${hostUid}:${hostGid}`);
    setEnv('HOME', '/home/node');
  }

  for (const mount of mounts) {
    if (mount.readonly) {
      args.push(...readonlyMountArgs(mount.hostPath, mount.containerPath));
    } else {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  // Pass agent provider and model selection to container
  if (effectiveProvider) {
    setEnv('AGENT_PROVIDER', effectiveProvider);
  }
  if (effectiveModel) {
    setEnv('DEFAULT_MODEL', effectiveModel);
  }

  let providerBaseUrl = defaults.baseUrlsByProvider[effectiveProvider];
  if (
    effectiveProvider === 'ollama' &&
    (!providerBaseUrl || providerBaseUrl.includes('host.docker.internal'))
  ) {
    providerBaseUrl = `http://${CONTAINER_HOST_GATEWAY}:11434/v1`;
  }
  if (effectiveProvider === 'openrouter' || effectiveProvider === 'google') {
    providerBaseUrl = `http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}/__nanocrab/providers/${effectiveProvider}`;
  }
  if (providerBaseUrl) {
    setEnv('AGENT_PROVIDER_BASE_URL', providerBaseUrl);
    setEnv(providerBaseUrlEnvKey(effectiveProvider), providerBaseUrl);
    if (providerDefinition.baseUrlEnvKey) {
      setEnv(providerDefinition.baseUrlEnvKey, providerBaseUrl);
    }
    if (effectiveProvider === 'ollama') {
      setEnv('OLLAMA_HOST', providerBaseUrl.replace(/\/v1\/?$/, ''));
    }
  }

  if (providerDefinition.envKey) {
    const apiKey = envValue(providerDefinition.envKey);
    if (
      providerDefinition.runtime === 'openai-compatible' &&
      effectiveProvider !== 'ollama'
    ) {
      setEnv('AGENT_PROVIDER_API_KEY', apiKey ? 'placeholder' : undefined);
    } else {
      setEnv(providerDefinition.envKey, apiKey);
      setEnv('AGENT_PROVIDER_API_KEY', apiKey);
    }
  }
  setEnv('OPENCODE_API_KEY', envValue('OPENCODE_API_KEY'));

  const envFilePath = writeDockerEnvFile(containerName, env);
  args.push('--env-file', envFilePath);

  // Resource limits (configurable via env vars)
  const memLimit = process.env.CONTAINER_MEMORY_LIMIT || '2g';
  const cpuLimit = process.env.CONTAINER_CPU_LIMIT || '2';
  args.push('--memory', memLimit);
  args.push('--cpus', cpuLimit);

  args.push(CONTAINER_IMAGE);

  return { args, envFilePath };
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  const groupDir = resolveGroupFolderPath(group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const connectorIds = loadConfiguredConnectorIds();
  const agentBoundary = resolveAgentBoundary({
    group,
    isMain: input.isMain,
    agentId: input.groupFolder,
    availableConnectorIds: connectorIds,
  });
  const runtimeCapabilities = deriveRuntimeCapabilities(agentBoundary, {
    connectorIds,
    requestedConnectorIds: input.allowedMcpServers
      ? ['nanocrab', ...input.allowedMcpServers]
      : undefined,
  });
  const allowedConnectorIds = filterAllowedConnectorIds({
    connectorIds: runtimeCapabilities.allowedConnectorIds,
    groupFolder: input.groupFolder,
    agentId: agentBoundary.agentId,
    isMain: input.isMain,
    isCoworkProject: isCoworkProjectWebGroup(group),
    action: 'tools.expose',
  });
  const allowedMcpToolPatterns = getAllowedConnectorToolPatterns({
    connectorIds: allowedConnectorIds,
    groupFolder: input.groupFolder,
    agentId: agentBoundary.agentId,
    isMain: input.isMain,
    isCoworkProject: isCoworkProjectWebGroup(group),
    dryRun: input.dryRun,
  });
  const executableConnectorIds = connectorIdsFromMcpToolPatterns(
    allowedMcpToolPatterns,
  );
  const runtimeConnectorIds = Array.from(
    new Set(['nanocrab', ...executableConnectorIds]),
  );

  const mounts = buildVolumeMounts(
    group,
    input.isMain,
    input.prompt,
    input.sessionId,
    agentBoundary,
    executableConnectorIds,
  );
  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `nanocrab-${safeName}-${Date.now()}`;
  const policy = evaluatePolicy({
    actor: input.groupFolder,
    actorId: input.sessionId || null,
    actionType: 'container.spawn',
    resource: group.folder,
    dryRun: input.dryRun === true,
    context: {
      containerName,
      chatJid: input.chatJid,
      isMain: input.isMain,
      isScheduledTask: input.isScheduledTask,
      mountCount: mounts.length,
      boundary: {
        agentId: agentBoundary.agentId,
        channelScopes: agentBoundary.channelScopes,
        connectorIds: allowedConnectorIds,
        connectorToolPatterns: allowedMcpToolPatterns,
        providerProfiles: agentBoundary.providerProfiles,
        externalWrites: agentBoundary.externalWrites,
      },
      mounts: mounts.map((mount) => ({
        containerPath: mount.containerPath,
        readonly: input.dryRun ? true : mount.readonly,
      })),
    },
  });
  logAuditEvent({
    actor: input.groupFolder,
    actorId: input.sessionId || null,
    actionType: 'container.spawn',
    resource: group.folder,
    decision: policy.decision,
    correlationId: input.sessionId || null,
    context: policy,
  });
  if (policy.decision === 'denied' || policy.decision === 'requires_approval') {
    return {
      status: 'error',
      result: null,
      error: `Container spawn ${policy.decision}: ${policy.explanation}`,
    };
  }
  if (policy.decision === 'simulated') {
    const simulated: ContainerOutput = {
      status: 'success',
      result: `Dry-run simulated container execution for ${group.name}. No container was spawned and all mounts were treated as read-only.`,
      newSessionId: input.sessionId,
    };
    if (onOutput) await onOutput(simulated);
    return simulated;
  }
  let effectiveProvider = isAgentProvider(input.provider)
    ? input.provider
    : undefined;
  let effectiveModel = input.model;
  if (input.providerFallbackPurpose && input.providerFallbackAction) {
    if (!canUseProviderProfile(agentBoundary, input.providerFallbackPurpose)) {
      logAuditEvent({
        actor: input.groupFolder,
        actorId: input.sessionId || null,
        actionType: 'agent_boundary.provider_profile',
        resource: input.providerFallbackPurpose,
        decision: 'denied',
        correlationId: input.sessionId || null,
        context: {
          agentId: agentBoundary.agentId,
          allowedProviderProfiles: agentBoundary.providerProfiles,
        },
      });
      return {
        status: 'error',
        result: null,
        error: `Agent boundary denied provider profile: ${input.providerFallbackPurpose}`,
      };
    }
    const fallback = resolveProviderFallbackForAction({
      purpose: input.providerFallbackPurpose,
      action: input.providerFallbackAction,
      requester: input.groupFolder,
      correlationId: input.sessionId || null,
      sourceProvider: effectiveProvider,
      sourceModel: effectiveModel,
    });
    logAuditEvent({
      actor: input.groupFolder,
      actorId: input.sessionId || null,
      actionType: 'provider.fallback',
      resource: input.providerFallbackPurpose,
      decision: fallback.approved ? 'approved' : 'requires_approval',
      correlationId: input.sessionId || null,
      context: {
        action: input.providerFallbackAction,
        ...(fallback.approved
          ? { provider: fallback.provider, model: fallback.model }
          : { reason: fallback.reason, approvalId: fallback.approvalId }),
      },
    });
    if (!fallback.approved) {
      return {
        status: 'error',
        result: null,
        error: `Provider fallback approval required: ${fallback.reason}`,
      };
    }
    effectiveProvider = fallback.provider;
    effectiveModel = fallback.model;
  }
  const builtContainerArgs = buildContainerArgs(
    mounts,
    containerName,
    runtimeConnectorIds,
    effectiveProvider,
    effectiveModel,
  );
  const containerArgs = builtContainerArgs.args;

  logger.debug(
    {
      group: group.name,
      containerName,
      mounts: mounts.map(
        (m) =>
          `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
      ),
      containerArgs: containerArgs.join(' '),
    },
    'Container mount configuration',
  );

  logger.info(
    {
      group: group.name,
      containerName,
      mountCount: mounts.length,
      isMain: input.isMain,
      persistent: input.isMain,
      timeoutMs: input.isMain ? '24h' : `${CONTAINER_TIMEOUT / 1000}s`,
    },
    input.isMain ? 'Spawning persistent container' : 'Spawning container agent',
  );

  const logsDir = path.join(groupDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const container = spawn(CONTAINER_RUNTIME_BIN, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    onProcess(container, containerName);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    container.stdin.write(
      JSON.stringify({
        ...input,
        allowedMcpServers: allowedConnectorIds.filter(
          (connectorId) =>
            connectorId !== 'nanocrab' &&
            executableConnectorIds.includes(connectorId),
        ),
        allowedMcpToolPatterns,
        agentBoundary,
        runtimeCapabilities: {
          ...runtimeCapabilities,
          allowedConnectorIds,
          allowedMcpToolPatterns,
        },
      }),
    );
    container.stdin.end();

    // Streaming output: parse OUTPUT_START/END marker pairs as they arrive
    let parseBuffer = '';
    let newSessionId: string | undefined;
    let outputChain = Promise.resolve();

    container.stdout.on('data', (data) => {
      const chunk = data.toString();

      // Always accumulate for logging
      if (!stdoutTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) {
          stdout += chunk.slice(0, remaining);
          stdoutTruncated = true;
          logger.warn(
            { group: group.name, size: stdout.length },
            'Container stdout truncated due to size limit',
          );
        } else {
          stdout += chunk;
        }
      }

      // Stream-parse for output markers
      if (onOutput) {
        parseBuffer += chunk;
        let startIdx: number;
        while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
          const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
          if (endIdx === -1) break; // Incomplete pair, wait for more data

          const jsonStr = parseBuffer
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
          parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);

          try {
            const parsed: ContainerOutput = JSON.parse(jsonStr);
            if (parsed.newSessionId) {
              newSessionId = parsed.newSessionId;
            }
            hadStreamingOutput = true;
            // Activity detected — reset the hard timeout
            resetTimeout();
            // Call onOutput for all markers (including null results)
            // so idle timers start even for "silent" query completions.
            outputChain = outputChain.then(() => onOutput(parsed));
          } catch (err) {
            logger.warn(
              { group: group.name, error: err },
              'Failed to parse streamed output chunk',
            );
          }
        }
      }
    });

    container.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ container: group.folder }, line);
      }
      // Don't reset timeout on stderr — SDK writes debug logs continuously.
      // Timeout only resets on actual output (OUTPUT_MARKER in stdout).
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
        logger.warn(
          { group: group.name, size: stderr.length },
          'Container stderr truncated due to size limit',
        );
      } else {
        stderr += chunk;
      }
    });

    let timedOut = false;
    let hadStreamingOutput = false;
    // Main groups use persistent containers — 24h hard timeout
    const persistentTimeout = input.isMain
      ? 24 * 60 * 60 * 1000
      : CONTAINER_TIMEOUT;
    const configTimeout = group.containerConfig?.timeout || persistentTimeout;
    // Grace period: hard timeout must be at least IDLE_TIMEOUT + 30s so the
    // graceful _close sentinel has time to trigger before the hard kill fires.
    const timeoutMs = Math.max(configTimeout, IDLE_TIMEOUT + 30_000);

    const killOnTimeout = () => {
      timedOut = true;
      logger.error(
        { group: group.name, containerName },
        'Container timeout, stopping gracefully',
      );
      try {
        stopContainer(containerName);
      } catch (err) {
        logger.warn(
          { group: group.name, containerName, err },
          'Graceful stop failed, force killing',
        );
        container.kill('SIGKILL');
      }
    };

    let timeout = setTimeout(killOnTimeout, timeoutMs);

    // Reset the timeout whenever there's activity (streaming output)
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(killOnTimeout, timeoutMs);
    };

    container.on('close', (code) => {
      clearTimeout(timeout);
      removeDockerEnvFile(builtContainerArgs.envFilePath);
      const duration = Date.now() - startTime;

      if (timedOut) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const timeoutLog = path.join(logsDir, `container-${ts}.log`);
        fs.writeFileSync(
          timeoutLog,
          [
            `=== Container Run Log (TIMEOUT) ===`,
            `Timestamp: ${new Date().toISOString()}`,
            `Group: ${group.name}`,
            `Container: ${containerName}`,
            `Duration: ${duration}ms`,
            `Exit Code: ${code}`,
            `Had Streaming Output: ${hadStreamingOutput}`,
          ].join('\n'),
        );

        // Timeout after output = idle cleanup, not failure.
        // The agent already sent its response; this is just the
        // container being reaped after the idle period expired.
        if (hadStreamingOutput) {
          logger.info(
            { group: group.name, containerName, duration, code },
            'Container timed out after output (idle cleanup)',
          );
          outputChain.then(() => {
            resolve({
              status: 'success',
              result: null,
              newSessionId,
            });
          });
          return;
        }

        logger.error(
          { group: group.name, containerName, duration, code },
          'Container timed out with no output',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Container timed out after ${configTimeout}ms`,
        });
        logAuditEvent({
          actor: input.groupFolder,
          actorId: input.sessionId || null,
          actionType: 'container.spawn',
          resource: group.folder,
          decision: 'error',
          correlationId: input.sessionId || null,
          durationMs: duration,
          error: `Container timed out after ${configTimeout}ms`,
          context: { containerName, code },
        });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `container-${timestamp}.log`);
      const isVerbose =
        process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Container Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsMain: ${input.isMain}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        `Stdout Truncated: ${stdoutTruncated}`,
        `Stderr Truncated: ${stderrTruncated}`,
        ``,
      ];

      const isError = code !== 0;

      if (isVerbose || isError) {
        // On error, log input metadata only — not the full prompt.
        // Full input is only included at verbose level to avoid
        // persisting user conversation content on every non-zero exit.
        if (isVerbose) {
          logLines.push(`=== Input ===`, JSON.stringify(input, null, 2), ``);
        } else {
          logLines.push(
            `=== Input Summary ===`,
            `Prompt length: ${input.prompt.length} chars`,
            `Session ID: ${input.sessionId || 'new'}`,
            ``,
          );
        }
        logLines.push(
          `=== Container Args ===`,
          containerArgs
            .map((a) =>
              a.match(/^-e\s/) || (a.includes('=') && !a.startsWith('-'))
                ? a.replace(/=.+/, '=***REDACTED***')
                : a,
            )
            .join(' '),
          ``,
          `=== Mounts ===`,
          mounts
            .map(
              (m) =>
                `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
            )
            .join('\n'),
          ``,
          `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
          stderr,
          ``,
          `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
          stdout,
        );
      } else {
        logLines.push(
          `=== Input Summary ===`,
          `Prompt length: ${input.prompt.length} chars`,
          `Session ID: ${input.sessionId || 'new'}`,
          ``,
          `=== Mounts ===`,
          mounts
            .map((m) => `${m.containerPath}${m.readonly ? ' (ro)' : ''}`)
            .join('\n'),
          ``,
        );
      }

      fs.writeFileSync(logFile, logLines.join('\n'));
      logger.debug({ logFile, verbose: isVerbose }, 'Container log written');

      if (code !== 0) {
        logger.error(
          {
            group: group.name,
            code,
            duration,
            stderr,
            stdout,
            logFile,
          },
          'Container exited with error',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Container exited with code ${code}: ${stderr.slice(-200)}`,
        });
        logAuditEvent({
          actor: input.groupFolder,
          actorId: input.sessionId || null,
          actionType: 'container.spawn',
          resource: group.folder,
          decision: 'error',
          correlationId: input.sessionId || null,
          durationMs: duration,
          error: stderr.slice(-500),
          context: { containerName, code, logFile },
        });
        return;
      }

      // Streaming mode: wait for output chain to settle, return completion marker
      if (onOutput) {
        outputChain.then(() => {
          logger.info(
            { group: group.name, duration, newSessionId },
            'Container completed (streaming mode)',
          );
          resolve({
            status: 'success',
            result: null,
            newSessionId,
          });
          logAuditEvent({
            actor: input.groupFolder,
            actorId: input.sessionId || null,
            actionType: 'container.spawn',
            resource: group.folder,
            decision: 'allowed',
            correlationId: input.sessionId || null,
            durationMs: duration,
            context: { containerName, streaming: true, newSessionId },
          });
        });
        return;
      }

      // Legacy mode: parse the last output marker pair from accumulated stdout
      try {
        // Extract JSON between sentinel markers for robust parsing
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          // Fallback: last non-empty line (backwards compatibility)
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }

        const output: ContainerOutput = JSON.parse(jsonLine);

        logger.info(
          {
            group: group.name,
            duration,
            status: output.status,
            hasResult: !!output.result,
          },
          'Container completed',
        );

        resolve(output);
        logAuditEvent({
          actor: input.groupFolder,
          actorId: input.sessionId || null,
          actionType: 'container.spawn',
          resource: group.folder,
          decision: output.status === 'success' ? 'allowed' : 'error',
          correlationId: input.sessionId || null,
          durationMs: duration,
          error: output.error,
          context: {
            containerName,
            status: output.status,
            hasResult: !!output.result,
          },
        });
      } catch (err) {
        logger.error(
          {
            group: group.name,
            stdout,
            stderr,
            error: err,
          },
          'Failed to parse container output',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`,
        });
        logAuditEvent({
          actor: input.groupFolder,
          actorId: input.sessionId || null,
          actionType: 'container.spawn',
          resource: group.folder,
          decision: 'error',
          correlationId: input.sessionId || null,
          durationMs: duration,
          error: err,
          context: { containerName },
        });
      }
    });

    container.on('error', (err) => {
      clearTimeout(timeout);
      removeDockerEnvFile(builtContainerArgs.envFilePath);
      logger.error(
        { group: group.name, containerName, error: err },
        'Container spawn error',
      );
      resolve({
        status: 'error',
        result: null,
        error: `Container spawn error: ${err.message}`,
      });
      logAuditEvent({
        actor: input.groupFolder,
        actorId: input.sessionId || null,
        actionType: 'container.spawn',
        resource: group.folder,
        decision: 'error',
        correlationId: input.sessionId || null,
        durationMs: Date.now() - startTime,
        error: err,
        context: { containerName },
      });
    });
  });
}

export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    script?: string | null;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
  }>,
): void {
  // Write filtered tasks to the group's IPC directory
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all tasks, others only see their own
  const filteredTasks = isMain
    ? tasks
    : tasks.filter((t) => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

/**
 * Write available groups snapshot for the container to read.
 * Only main group can see all available groups (for activation).
 * Non-main groups only see their own registration status.
 */
export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  _registeredJids: Set<string>,
): void {
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all groups; others see nothing (they can't activate groups)
  const visibleGroups = isMain ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(
    groupsFile,
    JSON.stringify(
      {
        groups: visibleGroups,
        lastSync: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
