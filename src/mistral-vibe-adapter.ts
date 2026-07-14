import { spawn } from 'child_process';

export interface CodingRunnerProcess {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CodingRunnerProcessExecutor = (
  command: string,
  args: string[],
  options: { cwd?: string; signal?: AbortSignal },
) => Promise<CodingRunnerProcess>;

export interface MistralVibeInput {
  prompt: string;
  cwd: string;
  maxTurns?: number;
  maxPrice?: number;
  signal?: AbortSignal;
}

export interface MistralVibeInvocation {
  runtime: 'mistral';
  command: 'vibe';
  args: string[];
  cwd: string;
}

export interface MistralVibeCommandValues {
  prompt: string;
  maxTurns: string;
  maxPrice: string;
}

export type MistralVibeResult =
  | {
      status: 'succeeded';
      output: unknown;
      stdout: string;
      stderr: string;
      exitCode: 0;
    }
  | {
      status: 'failed';
      output: null;
      stdout: string;
      stderr: string;
      error: string;
      exitCode: number | null;
    }
  | {
      status: 'cancelled';
      output: null;
      stdout: string;
      stderr: string;
      exitCode: null;
    };

function boundedTurns(value: number | undefined): number {
  if (!Number.isFinite(value)) return 30;
  return Math.min(Math.max(Math.trunc(value as number), 1), 100);
}

function boundedPrice(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) <= 0) return 5;
  return Math.min(value as number, 100);
}

function mistralVibeCommand(values: MistralVibeCommandValues): {
  command: 'vibe';
  args: string[];
} {
  return {
    command: 'vibe',
    args: [
      '--prompt',
      values.prompt,
      '--output',
      'json',
      '--max-turns',
      values.maxTurns,
      '--max-price',
      values.maxPrice,
    ],
  };
}

export function buildMistralVibeShellCommand(
  values: MistralVibeCommandValues,
): string {
  const command = mistralVibeCommand(values);
  return [command.command, ...command.args].join(' ');
}

export function buildMistralVibeShellBlock(
  values: MistralVibeCommandValues,
): string[] {
  const command = buildMistralVibeShellCommand(values);
  return [
    'VIBE_STDERR_FILE="$(mktemp)"',
    'trap \'rm -f "$VIBE_STDERR_FILE"\' EXIT',
    'set +e',
    `${command} 2>"$VIBE_STDERR_FILE"`,
    'VIBE_EXIT_CODE=$?',
    'set -e',
    'if [ -s "$VIBE_STDERR_FILE" ]; then cat "$VIBE_STDERR_FILE" >&2; fi',
    'if [ "$VIBE_EXIT_CODE" -ne 0 ]; then exit "$VIBE_EXIT_CODE"; fi',
    'if [ -s "$VIBE_STDERR_FILE" ]; then exit 1; fi',
    'rm -f "$VIBE_STDERR_FILE"',
    'trap - EXIT',
  ];
}

export function buildMistralVibeInvocation(
  input: MistralVibeInput,
): MistralVibeInvocation {
  const command = mistralVibeCommand({
    prompt: input.prompt,
    maxTurns: String(boundedTurns(input.maxTurns)),
    maxPrice: String(boundedPrice(input.maxPrice)),
  });
  return {
    runtime: 'mistral',
    command: command.command,
    args: command.args,
    cwd: input.cwd,
  };
}

function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

export const executeCodingRunnerProcess: CodingRunnerProcessExecutor = (
  command,
  args,
  options,
) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      signal: options.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'ABORT_ERR')
  );
}

export async function runMistralVibe(
  input: MistralVibeInput,
  options: { runner?: CodingRunnerProcessExecutor } = {},
): Promise<MistralVibeResult> {
  if (input.signal?.aborted) {
    return {
      status: 'cancelled',
      output: null,
      stdout: '',
      stderr: '',
      exitCode: null,
    };
  }

  const invocation = buildMistralVibeInvocation(input);
  const runner = options.runner || executeCodingRunnerProcess;
  try {
    const process = await runner(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      signal: input.signal,
    });
    if (input.signal?.aborted) {
      return {
        status: 'cancelled',
        output: null,
        stdout: process.stdout,
        stderr: process.stderr,
        exitCode: null,
      };
    }
    if (process.exitCode !== 0 || process.stderr.trim()) {
      return {
        status: 'failed',
        output: null,
        stdout: process.stdout,
        stderr: process.stderr,
        error:
          process.stderr.trim() ||
          `vibe exited with status ${process.exitCode}`,
        exitCode: process.exitCode,
      };
    }
    return {
      status: 'succeeded',
      output: parseJsonOutput(process.stdout),
      stdout: process.stdout,
      stderr: process.stderr,
      exitCode: 0,
    };
  } catch (error) {
    if (input.signal?.aborted || isAbortError(error)) {
      return {
        status: 'cancelled',
        output: null,
        stdout: '',
        stderr: '',
        exitCode: null,
      };
    }
    return {
      status: 'failed',
      output: null,
      stdout: '',
      stderr: '',
      error: error instanceof Error ? error.message : String(error),
      exitCode: null,
    };
  }
}

export async function probeMistralVibe(
  options: { runner?: CodingRunnerProcessExecutor } = {},
): Promise<{
  runtime: 'mistral';
  status: 'healthy' | 'missing' | 'error';
  version: string | null;
  detail: string;
}> {
  const runner = options.runner || executeCodingRunnerProcess;
  try {
    const result = await runner('vibe', ['--version'], {});
    if (result.exitCode !== 0) {
      return {
        runtime: 'mistral',
        status: 'error',
        version: null,
        detail: result.stderr.trim() || `vibe exited with ${result.exitCode}`,
      };
    }
    const version = result.stdout.match(/\d+\.\d+(?:\.\d+)?/)?.[0] || null;
    return {
      runtime: 'mistral',
      status: 'healthy',
      version,
      detail: result.stdout.trim() || 'vibe is available',
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return {
      runtime: 'mistral',
      status: code === 'ENOENT' ? 'missing' : 'error',
      version: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
