import type { PipelineStageKind } from '../control-plane/types.js';
import type { AgentCliId } from '../types.js';

export type CodingExecutionAttemptState =
  | 'preparing'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export interface CodingExecutionAttempt {
  id: string;
  state: CodingExecutionAttemptState;
  startedAt: string;
  completedAt: string | null;
  detail?: string;
}

export interface CodingRunnerInput {
  jobId: string;
  attemptId: string;
  cli: AgentCliId;
  model: string;
  stageKind: PipelineStageKind | null;
  workspace: string;
  promptFile: string;
  timeoutMs: number;
  onOutput(chunk: CodingRunnerOutputChunk): void;
}

export interface CodingRunnerOutputChunk {
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface CodingRunnerResult {
  attemptId: string;
  state: 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  detail?: string;
}

export interface CodingRunnerAdapter {
  run(input: CodingRunnerInput): Promise<CodingRunnerResult>;
  cancel(jobId: string, attemptId: string): boolean;
}

export interface SpawnedCodingProcess {
  pid?: number;
  killed?: boolean;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  once(event: 'error', listener: (error: Error) => void): this;
  once(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export type CodingProcessSpawner = (
  executable: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    detached: true;
    stdio: ['ignore', 'pipe', 'pipe'];
  },
) => SpawnedCodingProcess;

export interface CodingTimerTransport {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}
