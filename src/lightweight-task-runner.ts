import { execFile, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import {
  CODING_WORKSPACE_DIR,
  CONTAINER_IMAGE,
  CREDENTIAL_PROXY_PORT,
  TIMEZONE,
} from './config.js';
import { readEnvFile } from './env.js';
import {
  getGitHubToken,
  getCodingRepo,
  type CodingRepo,
} from './coding-jobs.js';
import {
  CONTAINER_RUNTIME_BIN,
  agentNetworkArgs,
  hostGatewayArgs,
  CONTAINER_HOST_GATEWAY,
} from './container-runtime.js';
import { detectAuthMode } from './credential-proxy.js';
import { registerContainerProcess } from './container-runner.js';
import { logger } from './logger.js';
import {
  listLightweightTasks,
  updateLightweightTask,
  appendTaskOutput,
  flushTaskOutput,
  type LightweightTask,
} from './lightweight-tasks.js';

let runnerActive = false;
const execFileAsync = promisify(execFile);

/**
 * Pick up queued lightweight tasks and execute them one at a time.
 * Called periodically from the admin server or on-demand after task creation.
 */
export async function runLightweightTaskQueue(): Promise<void> {
  if (runnerActive) return;
  runnerActive = true;
  try {
    const tasks = listLightweightTasks();
    const queued = tasks.filter((t) => t.status === 'queued');
    for (const task of queued) {
      await executeLightweightTask(task);
    }
  } finally {
    runnerActive = false;
  }
}

async function executeLightweightTask(task: LightweightTask): Promise<void> {
  const taskId = task.id;
  logger.info({ taskId, repo: task.repo }, 'Executing lightweight task');

  updateLightweightTask(taskId, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });

  try {
    const repo = getCodingRepo(task.repo);
    if (!repo) {
      throw new Error(`Repo ${task.repo} is not registered for coding`);
    }

    const workspace = await prepareTaskWorkspace(task, repo);
    updateLightweightTask(taskId, {
      workspace,
      branch: `nanocrab/ltask-${taskId.slice(-8)}`,
    });

    const exitCode = await runTaskContainer(task, repo, workspace);
    flushTaskOutput();

    updateLightweightTask(taskId, {
      status: exitCode === 0 ? 'completed' : 'failed',
      exitCode,
      completedAt: new Date().toISOString(),
      error: exitCode !== 0 ? `Container exited with code ${exitCode}` : null,
    });

    logger.info({ taskId, exitCode }, 'Lightweight task finished');
  } catch (err) {
    flushTaskOutput();
    const message = err instanceof Error ? err.message : String(err);
    updateLightweightTask(taskId, {
      status: 'failed',
      error: message,
      completedAt: new Date().toISOString(),
    });
    logger.error({ err, taskId }, 'Lightweight task failed');
  }
}

async function prepareTaskWorkspace(
  task: LightweightTask,
  repo: CodingRepo,
): Promise<string> {
  const repoDirName = task.repo.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const workspace = path.join(
    CODING_WORKSPACE_DIR,
    'lightweight',
    task.id,
    repoDirName,
  );
  fs.mkdirSync(path.dirname(workspace), { recursive: true });

  const githubToken = getGitHubToken();
  const askpassDir = fs.mkdtempSync(path.join('/tmp', 'nanocrab-ltask-git-'));
  const askpassPath = path.join(askpassDir, 'askpass.sh');
  fs.writeFileSync(
    askpassPath,
    '#!/bin/sh\nprintf "%s" "$NANOCRAB_GIT_TOKEN"\n',
    { mode: 0o700 },
  );
  try {
    await execFileAsync(
      'git',
      [
        'clone',
        '--depth',
        '50',
        `https://github.com/${task.repo}.git`,
        workspace,
      ],
      {
        timeout: 120_000,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          ...(githubToken
            ? {
                GIT_ASKPASS: askpassPath,
                NANOCRAB_GIT_TOKEN: githubToken,
              }
            : {}),
        },
      },
    );
  } finally {
    fs.rmSync(askpassDir, { recursive: true, force: true });
  }

  // Write a minimal run script
  const nanocrabDir = path.join(workspace, '.nanocrab');
  fs.mkdirSync(nanocrabDir, { recursive: true });

  const branch = `nanocrab/ltask-${task.id.slice(-8)}`;
  const runScript = [
    '#!/bin/bash',
    'set -e',
    `cd /workspace/${repoDirName}`,
    `git checkout -b "${branch}" 2>/dev/null || git checkout "${branch}" 2>/dev/null || true`,
    '',
    '# Run the agent with the task prompt',
    'if command -v claude &>/dev/null && [ "$JOB_PROVIDER" = "claude" ]; then',
    '  claude --print --dangerously-skip-permissions "$TASK_PROMPT" 2>&1',
    'elif command -v codex &>/dev/null && [ "$JOB_PROVIDER" = "codex" ]; then',
    '  codex --full-auto -q "$TASK_PROMPT" 2>&1',
    'elif command -v opencode &>/dev/null; then',
    '  opencode run "$TASK_PROMPT" 2>&1',
    'else',
    '  echo "No supported agent CLI found in container"',
    '  exit 1',
    'fi',
    '',
    'echo "Task completed"',
  ].join('\n');

  fs.writeFileSync(path.join(nanocrabDir, 'run.sh'), runScript, {
    mode: 0o755,
  });

  return workspace;
}

function buildTaskContainerEnv(
  task: LightweightTask,
  repo: CodingRepo,
): Record<string, string> {
  const envFileValues = readEnvFile([
    'GITHUB_TOKEN',
    'OPENCODE_API_KEY',
    'OPENROUTER_API_KEY',
    'OPENROUTER_BASE_URL',
    'OLLAMA_BASE_URL',
    'OPENAI_COMPATIBLE_API_KEY',
    'OPENAI_COMPATIBLE_BASE_URL',
    'MISTRAL_API_KEY',
  ]);

  const provider = task.provider || 'claude';
  const model = task.model || '';
  const repoDirName = task.repo.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const env: Record<string, string> = {
    TZ: TIMEZONE,
    TERM: 'dumb',
    HOME: '/home/node',
    TASK_PROMPT: task.prompt,
    GITHUB_REPO: task.repo,
    DEFAULT_BRANCH: repo.defaultBranch,
    REPO_DIR: repoDirName,
    JOB_PROVIDER: provider,
    JOB_MODEL: model,
    DEFAULT_PROVIDER: provider,
    DEFAULT_MODEL: model,
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'NanoCrab Bot',
    GIT_AUTHOR_EMAIL: 'nanocrab@localhost',
  };

  // Route provider credentials through the credential proxy
  if (provider === 'claude') {
    env.ANTHROPIC_BASE_URL = `http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}`;
    if (detectAuthMode() === 'api-key') {
      env.ANTHROPIC_API_KEY = 'placeholder';
    } else {
      env.CLAUDE_CODE_OAUTH_TOKEN = 'placeholder';
    }
  }
  if (provider === 'openrouter') {
    const proxyUrl = `http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}/__nanocrab/providers/openrouter`;
    env.OPENROUTER_API_KEY = 'placeholder';
    env.AGENT_PROVIDER_API_KEY = 'placeholder';
    env.OPENROUTER_BASE_URL = proxyUrl;
    env.AGENT_PROVIDER_BASE_URL = proxyUrl;
  }
  if (provider === 'airouter') {
    const proxyUrl = `http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}/__nanocrab/providers/airouter`;
    env.AIROUTER_API_KEY = 'placeholder';
    env.AGENT_PROVIDER_API_KEY = 'placeholder';
    env.AIROUTER_BASE_URL = proxyUrl;
    env.AGENT_PROVIDER_BASE_URL = proxyUrl;
  }
  if (provider === 'ollama') {
    env.OLLAMA_BASE_URL =
      process.env.OLLAMA_BASE_URL ||
      envFileValues.OLLAMA_BASE_URL ||
      'http://host.docker.internal:11434/v1';
  }

  return env;
}

function writeTaskEnvFile(env: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join('/tmp', 'nanocrab-ltask-env-'));
  const envFilePath = path.join(dir, 'env');
  const lines = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  fs.writeFileSync(envFilePath, `${lines.join('\n')}\n`, { mode: 0o600 });
  return envFilePath;
}

function removeTaskEnvFile(envFilePath: string): void {
  try {
    fs.rmSync(path.dirname(envFilePath), { recursive: true, force: true });
  } catch {
    // Non-critical
  }
}

function runTaskContainer(
  task: LightweightTask,
  repo: CodingRepo,
  workspace: string,
): Promise<number> {
  const env = buildTaskContainerEnv(task, repo);
  const envFilePath = writeTaskEnvFile(env);
  const repoDirName = task.repo.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const safeName = task.id.replace(/[^a-zA-Z0-9_.-]/g, '-');
  const containerName = `nanocrab-ltask-${safeName}`;

  const args: string[] = ['run', '--rm', '--name', containerName];
  args.push(...hostGatewayArgs());
  args.push(...agentNetworkArgs());

  const hostUid = process.getuid?.();
  const hostGid = process.getgid?.();
  if (hostUid != null && hostUid !== 0 && hostUid !== 1000) {
    args.push('--user', `${hostUid}:${hostGid}`);
  }

  // Mount workspace
  args.push('-v', `${workspace}:/workspace/${repoDirName}`);
  args.push('--env-file', envFilePath);
  args.push('--memory', process.env.CONTAINER_MEMORY_LIMIT || '4g');
  args.push('--cpus', process.env.CONTAINER_CPU_LIMIT || '2');
  args.push('--entrypoint', '/bin/bash');
  args.push(CONTAINER_IMAGE);
  args.push(`/workspace/${repoDirName}/.nanocrab/run.sh`);

  appendTaskOutput(task.id, `\nStarting container ${containerName}\n`);

  return new Promise((resolve, reject) => {
    const proc = spawn(CONTAINER_RUNTIME_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    registerContainerProcess(task.id, proc, containerName, task.id);

    proc.stdout?.on('data', (data: Buffer) => {
      appendTaskOutput(task.id, data.toString());
    });
    proc.stderr?.on('data', (data: Buffer) => {
      appendTaskOutput(task.id, data.toString());
    });
    proc.on('error', (err) => {
      removeTaskEnvFile(envFilePath);
      reject(err);
    });
    proc.on('close', (code) => {
      removeTaskEnvFile(envFilePath);
      resolve(code ?? 1);
    });
  });
}
