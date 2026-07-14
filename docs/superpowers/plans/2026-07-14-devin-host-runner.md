# Devin Host Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `actualRuntime.cli === 'devin'` execute the authenticated host Devin CLI safely inside NanoCrab's existing approval-gated coding-job lifecycle without exposing credentials or changing existing container runners.

**Architecture:** Add a provider-neutral runner contract and attempt-aware process registry, then implement a one-shot host Devin adapter around an already-isolated job checkout. Runtime compatibility and readiness fail closed before workspace mutation; the adapter uses strict stage configuration, an allowlisted environment, a command broker, stateful output redaction, exact process leases, and existing post-run diff/PR evidence. Existing Claude, Codex, OpenCode, Pi, and Mistral jobs stay on their container paths.

**Tech Stack:** TypeScript ESM, Node.js `>=20 <26` (repository verification uses Node 24), Vitest fake transports/timers/filesystems, Express admin routes, JSON job persistence, direct `child_process.spawn`/`execFile`, Git argument arrays, Linux `/usr/bin/bwrap` or macOS `/usr/bin/sandbox-exec`.

## Global Constraints

- Issue: GitHub issue `#129`; implementation branch `feature/devin-host-runner`; integration target `main`.
- Devin is an `AgentCliId`, never an `AgentProvider`; do not add provider definitions, provider credentials, credential-proxy routes, or container image changes.
- Never copy, mount, serialize, read, log, rotate, or pass Devin credentials to a container, generated file, argument, prompt, or child environment.
- GitHub credentials may enter only a short-lived approved host Git child through a mode-`0700` askpass helper; Devin and local-only Git receive no token.
- Persist `runnerCli`, `activeAttemptId`, and append-only `executionAttempts` in existing JSON job records; normalize legacy records on read; add no SQLite migration.
- Every invocation gets a new opaque `attemptId`; stale callbacks must match `(jobId, attemptId, leaseToken)` before output, state, signal, or cleanup.
- Preserve legacy Pi and Mistral execution exactly: `pi -> pi` and `mistral -> mistral`, through their existing container `pi` and `vibe` cases.
- Planning/review are read-only; implement/direct may write only within the canonical repository workspace.
- Devin child and probe environments are allowlists, never spreads of `process.env`; exclude GitHub, provider, channel, cookie, proxy, credential-proxy, and arbitrary `DEVIN_*` secrets.
- Required Devin arguments are `--prompt-file`, `--model`, `--permission-mode auto`, `--sandbox`, `--agent-config`, `--respect-workspace-trust true`, and `-p`, spawned with `shell: false`, `detached: true`, and piped stdout/stderr.
- `CODING_JOB_RUNNER_TIMEOUT_MS` defaults to `CONTAINER_TIMEOUT`; non-finite or non-positive values fail configuration loading; termination grace is exactly `5_000` ms.
- Built-in model mappings are exactly `claude/claude-sonnet-4-6 -> claude-sonnet-4` and `claude/claude-opus-4-6 -> claude-opus-4.6`; operator mappings extend but never override built-ins.
- No live/paid Devin invocation, network access, real credential read, release, deployment, version bump, merge, issue closure, or move to `Done` is part of implementation.
- Each behavior slice follows red-green-refactor, commits only the explicit paths listed in that task, and receives a fresh task review before the next slice.

---

## File Responsibility Map

| Path                                                | Responsibility                                                                                                  | Owning task |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------- |
| `src/config.ts`                                     | Parse positive runner timeout and typed Devin alias JSON with immutable built-ins                               | 1           |
| `src/config.test.ts`                                | Timeout and alias parsing failures, conflicts, and built-in preservation                                        | 1           |
| `src/agent-runtime-registry.ts`                     | CLI/provider/model compatibility, alias resolution, runtime definitions, and later readiness probing            | 1, 7        |
| `src/agent-runtime-registry.test.ts`                | Compatibility, exact aliases, scrubbed readiness, auth/mode/capability/privacy cases                            | 1, 7        |
| `src/coding-runners/types.ts`                       | Provider-neutral runner, process, timer, filesystem, and lease-facing contracts                                 | 2           |
| `src/coding-jobs.ts`                                | Persist/normalize attempts and `runnerCli`; later own dispatch, gates, terminal mapping, and exact cancellation | 2, 9        |
| `src/coding-jobs.test.ts`                           | Legacy identity/attempt normalization and end-to-end orchestration coverage                                     | 2, 9        |
| `src/logger.ts`                                     | Stateful per-stream redaction with known-secret replacement and safe final flush                                | 3           |
| `src/logger.test.ts`                                | Every-boundary split-token and known-secret streaming tests                                                     | 3           |
| `src/coding-runners/process-registry.ts`            | Attempt/lease ownership, compare-and-delete, exact signaling, TERM-to-KILL escalation                           | 4           |
| `src/coding-runners/process-registry.test.ts`       | Lease mismatch, stale callbacks, races, escalation, and idempotent cancellation                                 | 4           |
| `src/container-runner.ts`                           | Compatibility wrappers delegating active process ownership to the shared registry                               | 4           |
| `src/container-runner.test.ts`                      | Preserve existing wrapper behavior and prove exact-attempt overload                                             | 4           |
| `src/coding-workspace.ts`                           | Canonical workspace validation, first-run setup, retry preservation, Git transport, askpass seam                | 5           |
| `src/coding-workspace.test.ts`                      | Fake Git/filesystem tests, origin/branch/symlink rejection, credential scoping                                  | 5           |
| `src/coding-runners/command-broker.ts`              | Stage command policy, immutable launcher, and platform network/filesystem sandbox                               | 6           |
| `src/coding-runners/command-broker.test.ts`         | Exact accepted/denied argv matrix and sandbox invocation                                                        | 6           |
| `src/coding-runners/devin-host.ts`                  | Strict config/environment generation, Devin spawn/output/result/timeout/cancel adapter                          | 6, 8        |
| `src/coding-runners/devin-host.test.ts`             | Deep-equality config and fake process/timer/output lifecycle                                                    | 6, 8        |
| `src/coding-runner-readiness.ts`                    | Route Devin to host readiness while preserving container-specific Pi behavior                                   | 7           |
| `src/agent-profiles.ts`                             | Reuse full runtime-triple compatibility for profile validation                                                  | 7           |
| `src/agent-profiles.test.ts`                        | Accept mapped Devin triples and reject catalog-only/incompatible triples                                        | 7           |
| `src/admin/routes/agents.ts`                        | Return runtime compatibility/readiness and validate complete coding-job runtime selections                      | 10          |
| `src/admin/routes/agents-runtime-selection.test.ts` | Express-route rejection/acceptance and response attribution                                                     | 10          |
| `src/admin/public/pages/agents.js`                  | CLI/provider/model selectors, filtering, readiness warning, and job attribution                                 | 10          |
| `src/admin/agents-ui.test.ts`                       | Source contract for three-part selection and rendered runtime identity                                          | 10          |
| `src/admin/plugins/autofix/routes.ts`               | Persist/validate complete runtime triples and expose job attribution                                            | 10          |
| `src/admin/plugins/autofix/routes.test.ts`          | Autofix normalization and incompatible-triple rejection                                                         | 10          |
| `src/admin/public/pages/autofix.js`                 | Autofix CLI/provider/model selector and actual-runtime job cards                                                | 10          |
| `src/admin/autofix-ui.test.ts`                      | Autofix filtering/readiness/three-part display source contract                                                  | 10          |
| `.env.example`                                      | Runner timeout and typed alias configuration examples                                                           | 11          |
| `README.md`                                         | Host-native runner/operator setup and supported runtime summary                                                 | 11          |
| `docs/SECURITY.md`                                  | Credential boundary, external processing, sandbox residual risk, rollback                                       | 11          |
| `docs/AGENT_PROFILES.md`                            | Truthful CLI/provider/model selection, readiness, fallback, opt-in rollout                                      | 11          |
| `docs/ROADMAP.md`                                   | Mark #129 implementation complete only after automated evidence and ready PR                                    | 11          |

### Task 1: Typed Devin model compatibility and runner timeout configuration

**Files:**

- Modify: `src/config.ts`
- Create: `src/config.test.ts`
- Modify: `src/agent-runtime-registry.ts`
- Modify: `src/agent-runtime-registry.test.ts`

**Interfaces:**

- Consumes: `AgentRuntimeSelection`, `AgentProvider`, `CONTAINER_TIMEOUT`.
- Produces:

```ts
export const DEVIN_BUILTIN_MODEL_ALIASES: Readonly<Record<string, string>>;
export function parseDevinCliModelAliases(
  raw: string | undefined,
): Readonly<Record<string, string>>;
export const DEVIN_CLI_MODEL_ALIASES: Readonly<Record<string, string>>;
export const CODING_JOB_RUNNER_TIMEOUT_MS: number;
export const DEVIN_CREDENTIAL_PATH: string | null;
export function inferLegacyRunnerCli(provider: AgentProvider): AgentCliId;
export function resolveDevinCliModelAlias(
  runtime: AgentRuntimeSelection,
  aliases?: Readonly<Record<string, string>>,
  advertisedAliases?: ReadonlySet<string>,
): string;
export function validateCodingRuntimeSelection(
  runtime: AgentRuntimeSelection,
  options?: {
    aliases?: Readonly<Record<string, string>>;
    advertisedDevinAliases?: ReadonlySet<string>;
  },
): void;
```

- Compatibility table is exact: Claude/Claude, Codex/Codex, OpenCode with OpenCode/OpenRouter/Ollama/OpenAI-compatible, Pi/Pi, Mistral/Mistral, or Devin with a configured and advertised alias.

- [ ] **Step 1: Write failing configuration tests**

Add table-driven tests with these exact assertions:

```ts
it('merges operator Devin aliases without overriding built-ins', () => {
  expect(
    parseDevinCliModelAliases(
      JSON.stringify({ 'claude/claude-haiku-4-5': 'claude-haiku-4.5' }),
    ),
  ).toEqual({
    'claude/claude-sonnet-4-6': 'claude-sonnet-4',
    'claude/claude-opus-4-6': 'claude-opus-4.6',
    'claude/claude-haiku-4-5': 'claude-haiku-4.5',
  });
});

it.each([
  ['[]', 'must be a JSON object'],
  ['{"unknown/model":"alias"}', 'unknown provider'],
  ['{"claude/claude-sonnet-4-6":"replacement"}', 'cannot override built-in'],
  ['{"claude/model":""}', 'non-empty string'],
])('rejects invalid DEVIN_CLI_MODEL_ALIASES_JSON %s', (raw, message) => {
  expect(() => parseDevinCliModelAliases(raw)).toThrow(message);
});
```

Extract timeout parsing into an exported pure helper `parsePositiveMilliseconds(raw, fallback, key)` and test `undefined -> CONTAINER_TIMEOUT`, `"45000" -> 45000`, and rejection of `0`, `-1`, `NaN`, `Infinity`, and fractional input.

Extend the non-secret `envConfig` key list with `CODING_JOB_RUNNER_TIMEOUT_MS`, `DEVIN_CREDENTIAL_PATH`, and `DEVIN_CLI_MODEL_ALIASES_JSON`. `DEVIN_CREDENTIAL_PATH` is `null` when omitted and must reject a configured relative path; readiness reports the missing operator configuration without guessing or scanning host credential directories.

- [ ] **Step 2: Run the focused tests and verify red**

Run: `mise exec node@24 -- npm test -- src/config.test.ts src/agent-runtime-registry.test.ts`

Expected: FAIL because `parseDevinCliModelAliases`, `DEVIN_BUILTIN_MODEL_ALIASES`, `resolveDevinCliModelAlias`, and `validateCodingRuntimeSelection` are not exported.

- [ ] **Step 3: Implement strict parsing and compatibility**

Use these immutable built-ins and key validation:

```ts
export const DEVIN_BUILTIN_MODEL_ALIASES = Object.freeze({
  'claude/claude-sonnet-4-6': 'claude-sonnet-4',
  'claude/claude-opus-4-6': 'claude-opus-4.6',
});

const DEVIN_ALIAS_KEY = /^([a-z0-9-]+)\/(\S+)$/;

export function inferLegacyRunnerCli(provider: AgentProvider): AgentCliId {
  if (provider === 'claude' || provider === 'codex' || provider === 'pi') {
    return provider;
  }
  if (provider === 'mistral') return 'mistral';
  return 'opencode';
}
```

Parse JSON only when non-empty, require a non-array object, require known `AgentProvider` prefixes, reject empty/whitespace aliases, reject built-in keys even when the supplied value matches, and return a frozen merged copy. `resolveDevinCliModelAlias` must build `${runtime.provider}/${runtime.model}`, reject absence before consulting provider catalogs, and reject when `advertisedAliases` is provided but lacks the mapped alias. `validateCodingRuntimeSelection` must reject all pairs outside the compatibility table and must call `resolveDevinCliModelAlias` for Devin.

- [ ] **Step 4: Verify focused green and types**

Run: `mise exec node@24 -- npm test -- src/config.test.ts src/agent-runtime-registry.test.ts`

Expected: PASS with no process/network calls.

Run: `mise exec node@24 -- npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the configuration slice**

```bash
git add src/config.ts src/config.test.ts src/agent-runtime-registry.ts src/agent-runtime-registry.test.ts
git commit -m "feat: validate Devin runner configuration"
```

### Task 2: Runner contracts, persisted CLI identity, and attempt history normalization

**Files:**

- Create: `src/coding-runners/types.ts`
- Modify: `src/coding-jobs.ts`
- Modify: `src/coding-jobs.test.ts`

**Interfaces:**

- Consumes: `AgentCliId`, `PipelineStageKind`, `inferLegacyRunnerCli` from Task 1.
- Produces the approved runner interfaces plus:

```ts
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
```

Add required `CodingJob` fields `runnerCli: AgentCliId`, `activeAttemptId: string | null`, `executionAttempts: CodingExecutionAttempt[]`. New jobs derive `runnerCli` from `actualRuntime.cli` when a complete runtime is present; otherwise they use `inferLegacyRunnerCli(provider)`. Do not add a loose `runnerCli` request field that could contradict `actualRuntime`.

- [ ] **Step 1: Add failing persistence and legacy tests**

Add these named tests to `src/coding-jobs.test.ts`:

```ts
it('persists runner CLI from the complete actual runtime', async () => {
  const job = await startCodingJob({
    repo: 'owner/repo',
    prompt: 'Use Devin',
    requestedBy: 'control-plane',
    actualRuntime: {
      cli: 'devin',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
    },
  });
  expect(job.runnerCli).toBe('devin');
  expect(loadCodingJobs()[0].runnerCli).toBe('devin');
  expect(job.executionAttempts).toEqual([]);
  expect(job.activeAttemptId).toBeNull();
});

it.each([
  ['claude', 'claude'],
  ['codex', 'codex'],
  ['opencode', 'opencode'],
  ['openrouter', 'opencode'],
  ['ollama', 'opencode'],
  ['openai-compatible', 'opencode'],
  ['pi', 'pi'],
  ['mistral', 'mistral'],
])('normalizes legacy provider %s to runner %s', (provider, runnerCli) => {
  writeLegacyJob({ provider });
  expect(loadCodingJobs()[0]).toMatchObject({
    runnerCli,
    activeAttemptId: null,
    executionAttempts: [],
  });
});
```

Add a legacy Pi/Mistral dispatch assertion against the generated container script: Pi still contains `pi -p` and Mistral still equals `buildMistralVibeShellCommand(...)`; neither script contains `devin`.

- [ ] **Step 2: Verify the expected red failure**

Run: `mise exec node@24 -- npm test -- src/coding-jobs.test.ts -t "runner CLI|normalizes legacy provider|legacy Pi and Mistral"`

Expected: FAIL because `runnerCli`, `activeAttemptId`, and `executionAttempts` are absent.

- [ ] **Step 3: Add the contracts and read-time defaults**

Create `src/coding-runners/types.ts` with the exact interfaces above plus injectable process primitives used by later tasks:

```ts
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
```

In `ensureJobDefaults`, infer only when `job.runnerCli` is absent and clone any existing attempt array so callers cannot mutate the raw parsed reference. Do not rewrite the JSON file during load. New jobs validate the full runtime selection from Task 1 before persistence.

- [ ] **Step 4: Verify identity green and regression coverage**

Run: `mise exec node@24 -- npm test -- src/coding-jobs.test.ts src/coding-runner-adapters.test.ts`

Expected: PASS; existing Pi/Vibe test cases remain unchanged.

- [ ] **Step 5: Commit the identity slice**

```bash
git add src/coding-runners/types.ts src/coding-jobs.ts src/coding-jobs.test.ts
git commit -m "feat: persist coding runner identity and attempts"
```

### Task 3: Stateful streaming log redaction

**Files:**

- Modify: `src/logger.ts`
- Create: `src/logger.test.ts`

**Interfaces:**

- Consumes: existing `redactLogString(value: string): string`.
- Produces:

```ts
export interface StreamingLogRedactor {
  write(chunk: string): string;
  flush(): string;
}

export function createStreamingLogRedactor(options?: {
  knownSecrets?: readonly string[];
  carryLength?: number;
}): StreamingLogRedactor;
```

- `knownSecrets` uses only already-held values of at least eight characters; the caller must never read Devin credential contents.
- Each stdout/stderr stream owns a separate instance. Raw carry is never returned or persisted.

- [ ] **Step 1: Write every-boundary failing tests**

Use one helper to split each secret at every index:

```ts
function everySplit(value: string): Array<[string, string]> {
  return Array.from({ length: value.length + 1 }, (_, index) => [
    value.slice(0, index),
    value.slice(index),
  ]);
}

it.each([
  'Authorization: Bearer abc.def.ghi',
  'OPENAI_API_KEY=sk-secret-token-value',
  'cookie=session-value-123456',
])('redacts pattern secrets across every chunk boundary: %s', (secret) => {
  for (const [left, right] of everySplit(secret)) {
    const redactor = createStreamingLogRedactor();
    const persisted =
      redactor.write(left) + redactor.write(right) + redactor.flush();
    expect(persisted).not.toContain(secret.split(/[:=]\s*/).at(-1));
    expect(persisted).toContain('[REDACTED]');
  }
});

it('redacts known literals across every boundary and ignores short values', () => {
  const secret = 'github-token-123456';
  for (const [left, right] of everySplit(secret)) {
    const redactor = createStreamingLogRedactor({
      knownSecrets: [secret, 'short'],
    });
    const persisted =
      redactor.write(left) + redactor.write(right) + redactor.flush();
    expect(persisted).not.toContain(secret);
    expect(persisted).toContain('[REDACTED]');
  }
});
```

Also test `flush()` emits a safe suffix exactly once, `write()` after flush throws, stdout/stderr instances do not share carry, and `redactLogString` retains its current complete-string behavior.

- [ ] **Step 2: Run and verify red**

Run: `mise exec node@24 -- npm test -- src/logger.test.ts`

Expected: FAIL because `createStreamingLogRedactor` is not exported.

- [ ] **Step 3: Implement delimiter-aware carry and literal replacement**

Compile escaped known-secret literals sorted longest-first. On each `write`, append the chunk to private raw carry, replace complete known literals, and find the earliest still-open suffix beginning with `Bearer `, `sk-`, `/__nanocrab/providers/`, a sensitive-key assignment, or a prefix of any known literal. Redact and return only the complete prefix before that suffix. Retain at most `carryLength` raw characters (default `4_096` or the longest known literal length, whichever is greater); if an open token reaches that bound without a delimiter, emit its redacted marker and discard its raw bytes instead of releasing them. Recognized token delimiters are whitespace, quote, comma, ampersand, or end of stream. `flush()` must pass the final carry through known-secret replacement and `redactLogString`, clear it, and return the safe result exactly once. Keep `redactKnownSecrets(value, secrets)` private; raw carry must never be returned, logged, or persisted.

Use replacement order: known literals first, then `redactLogString`. Filter known literals with `value.length >= 8` and deduplicate them.

- [ ] **Step 4: Verify green and boundary safety**

Run: `mise exec node@24 -- npm test -- src/logger.test.ts`

Expected: PASS for every split index and final flush.

Run: `mise exec node@24 -- npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the redactor slice**

```bash
git add src/logger.ts src/logger.test.ts
git commit -m "feat: redact streaming runner output"
```

### Task 4: Attempt-aware shared process leases

**Files:**

- Create: `src/coding-runners/process-registry.ts`
- Create: `src/coding-runners/process-registry.test.ts`
- Modify: `src/container-runner.ts`
- Modify: `src/container-runner.test.ts`

**Interfaces:**

- Consumes: `SpawnedCodingProcess`, injected random token/timers/signal transport.
- Produces:

```ts
export interface ProcessLease {
  jobId: string;
  attemptId: string;
  leaseToken: string;
  process: SpawnedCodingProcess;
}

export interface ProcessRegistry {
  register(input: {
    jobId: string;
    attemptId: string;
    process: SpawnedCodingProcess;
  }): ProcessLease;
  owns(lease: ProcessLease): boolean;
  get(jobId: string, attemptId: string): ProcessLease | null;
  compareAndDelete(lease: ProcessLease): boolean;
  terminate(lease: ProcessLease, terminal: 'timed_out' | 'cancelled'): boolean;
}

export function createProcessRegistry(options?: {
  randomToken?: () => string;
  signalGroup?: (pid: number, signal: NodeJS.Signals) => void;
  timers?: CodingTimerTransport;
  graceMs?: number;
}): ProcessRegistry;

export const codingProcessRegistry: ProcessRegistry;
```

Update compatibility wrappers without breaking existing callers:

```ts
export function registerContainerProcess(
  key: string,
  proc: ChildProcess,
  containerName: string,
  attemptId?: string,
): string; // returns leaseToken

export function cancelContainerProcess(
  key: string,
  reason?: string,
  attemptId?: string,
): { cancelled: boolean; containerName?: string; error?: string };
```

- [ ] **Step 1: Write failing lease/race tests**

Create fakes with positive PIDs and fake timers. Cover these exact test names:

```ts
it('compares job, attempt, and token before deleting a lease', () => {
  const registry = createProcessRegistry({ randomToken: () => 'lease-a' });
  const lease = registry.register({
    jobId: 'job',
    attemptId: 'attempt-a',
    process,
  });
  expect(registry.compareAndDelete({ ...lease, leaseToken: 'wrong' })).toBe(
    false,
  );
  expect(registry.owns(lease)).toBe(true);
  expect(registry.compareAndDelete(lease)).toBe(true);
});

it('does not let a stale close delete a newer retry lease', () => {
  const oldLease = registry.register({
    jobId: 'job',
    attemptId: 'old',
    process: oldProcess,
  });
  registry.compareAndDelete(oldLease);
  const newLease = registry.register({
    jobId: 'job',
    attemptId: 'new',
    process: newProcess,
  });
  expect(registry.compareAndDelete(oldLease)).toBe(false);
  expect(registry.owns(newLease)).toBe(true);
});

it('signals only the exact attempt with TERM then KILL', () => {
  expect(registry.terminate(oldLease, 'cancelled')).toBe(true);
  expect(signalGroup).toHaveBeenCalledWith(-oldProcess.pid, 'SIGTERM');
  vi.advanceTimersByTime(5_000);
  expect(signalGroup).toHaveBeenCalledWith(-oldProcess.pid, 'SIGKILL');
  expect(registry.owns(newLease)).toBe(true);
});
```

Also assert repeated termination returns false after the first request, a mismatched attempt cannot signal, explicit owner cleanup is compare-and-delete, and the first terminal event handled by the adapter owns cleanup. The generic registry must not subscribe to process `close` or `error`: doing so could delete a lease before the adapter's terminal callback verifies ownership and settles its result.

- [ ] **Step 2: Run and verify red**

Run: `mise exec node@24 -- npm test -- src/coding-runners/process-registry.test.ts src/container-runner.test.ts -t "process lease|container process"`

Expected: FAIL because the shared registry and attempt-aware overload do not exist.

- [ ] **Step 3: Implement lease ownership and compatibility wrappers**

Store leases by a composite key `${jobId}\0${attemptId}`. `register` must reject a live identical key and generate a cryptographically unguessable token by default. It stores ownership only; it must not attach `close` or `error` listeners. The adapter or compatibility wrapper that owns the process attaches terminal listeners and calls `compareAndDelete(capturedLease)` after it has settled the terminal result. `terminate` must call `signalGroup(-pid, 'SIGTERM')`, schedule exactly one `SIGKILL` after `5_000`, and never fall back to a different attempt. If a PID is absent, call only that captured process's `kill('SIGTERM')` and schedule `kill('SIGKILL')`.

Keep a terminating lease registered during the grace period. A matching close/error clears the escalation timer and compare-deletes it; otherwise the escalation callback first verifies the same three identifiers, sends `SIGKILL`, and compare-deletes that lease. A repeated `terminate` for a lease already marked terminating returns `false`. This preserves TERM-to-KILL escalation even though the adapter result may settle before the OS process closes.

Move `containerProcessRegistry` ownership behind `codingProcessRegistry`. Keep a small map from wrapper key to `{ attemptId, leaseToken, containerName }` only for compatibility metadata. When `attemptId` is supplied, cancellation must require it to equal the wrapper record; omitted IDs preserve non-coding callers' current behavior.

- [ ] **Step 4: Verify shared and legacy green**

Run: `mise exec node@24 -- npm test -- src/coding-runners/process-registry.test.ts src/container-runner.test.ts`

Expected: PASS; existing unknown-key and process-group cancellation assertions remain green.

- [ ] **Step 5: Commit the process ownership slice**

```bash
git add src/coding-runners/process-registry.ts src/coding-runners/process-registry.test.ts src/container-runner.ts src/container-runner.test.ts
git commit -m "feat: lease coding runner processes by attempt"
```

### Task 5: Host Git workspace and credential-only askpass seam

**Files:**

- Create: `src/coding-workspace.ts`
- Create: `src/coding-workspace.test.ts`

**Interfaces:**

- Consumes: canonical `CodingJob` identity, `CodingRepo`, `getGitHubToken()` only at approved remote-operation call sites.
- Produces:

```ts
export type GitTransport = (
  args: readonly string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface CodingWorkspaceInput {
  jobId: string;
  repo: string;
  defaultBranch: string;
  branch: string;
  workspace: string;
  isFirstRun: boolean;
}

export interface PreparedCodingWorkspace {
  jobRoot: string;
  metadataDir: string;
  workspace: string;
  resumed: boolean;
  gitState: {
    staged: string;
    unstaged: string;
    untracked: string;
    unpushed: string;
  };
}

export function validateCodingRepoSlug(value: string): void;
export function validateCodingBranch(value: string): void;

export async function prepareCodingWorkspace(
  input: CodingWorkspaceInput,
  deps: {
    git: GitTransport;
    realpath: (value: string) => Promise<string>;
    lstat: (value: string) => Promise<fs.Stats>;
    mkdir: typeof fs.promises.mkdir;
    githubToken?: string | null;
    createAskpass?: (
      token: string,
    ) => Promise<{ path: string; dispose(): Promise<void> }>;
  },
): Promise<PreparedCodingWorkspace>;

export async function runApprovedHostGit(
  args: readonly string[],
  options: {
    cwd?: string;
    token: string;
    git: GitTransport;
    createAskpass: NonNullable<
      Parameters<typeof prepareCodingWorkspace>[1]['createAskpass']
    >;
  },
): Promise<{ stdout: string; stderr: string; exitCode: number }>;
```

- [ ] **Step 1: Write failing fake-Git workspace tests**

Create tests named:

```ts
it('prepares a missing first-run checkout with argument-array Git calls', async () => {
  const prepared = await prepareCodingWorkspace(firstRunInput, deps);
  expect(git.mock.calls.map(([args]) => args)).toEqual([
    ['clone', '--depth', '50', 'https://github.com/owner/repo.git', workspace],
    ['fetch', 'origin', 'main', '--depth', '50'],
    ['checkout', '-B', 'main', 'origin/main'],
    ['checkout', '-B', 'nanocrab/issue-129'],
  ]);
  expect(prepared.resumed).toBe(false);
});

it('resumes a dirty retry without fetch reset checkout clean or delete', async () => {
  const prepared = await prepareCodingWorkspace(
    { ...input, isFirstRun: false },
    deps,
  );
  expect(prepared.gitState).toEqual({
    staged: 'M  staged.ts',
    unstaged: ' M dirty.ts',
    untracked: 'new.ts',
    unpushed: 'abc123 subject',
  });
  expect(flattenedGitArgs).not.toMatch(/fetch|reset|checkout|clean/);
});
```

Also cover unexpected existing first-run checkout (validate/resume or reject, no rewrite), credential-free exact origin, exact branch, corrupt `.git`, symlink escape, unsafe repo/branch/path rejection before Git, and preservation of unpushed work.

For askpass, create a mode-`0700` helper whose file contains only logic: it prints `x-access-token` for a username prompt and `$NANOCRAB_GIT_TOKEN` for a password prompt; the token value must never appear in the file. Assert clone/fetch/push receive exactly `GIT_ASKPASS=<helper path>`, `GIT_TERMINAL_PROMPT=0`, `NANOCRAB_GIT_TOKEN=<token>`, trusted `PATH`, `LANG`, and `LC_ALL`. Assert local `status/diff/log/rev-parse` receive the trusted path and locale but no askpass or token; the helper is disposed in `finally`; the token is absent from args, remote URL, error, and returned result.

- [ ] **Step 2: Run and verify red**

Run: `mise exec node@24 -- npm test -- src/coding-workspace.test.ts`

Expected: FAIL because `prepareCodingWorkspace` and `runApprovedHostGit` do not exist.

- [ ] **Step 3: Implement first-run versus resume rules**

Define and export `validateCodingRepoSlug(value: string): void` and `validateCodingBranch(value: string): void` in `src/coding-workspace.ts`. The repository validator accepts exactly two GitHub path components matching `[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+` and rejects components equal to `.` or `..`. The branch validator rejects empty values, a leading `-`, leading/trailing `/`, trailing `.`, components ending `.lock`, `..`, `@{`, `//`, characters matching `[\x00-\x20\x7f~^:?*\\[]`, and any component equal to `.` or `..`. Call both before filesystem or Git work. Canonicalize `jobRoot`, metadata parent, and workspace; require workspace to remain below `CODING_WORKSPACE_DIR/jobs/<jobId>` and reject any symlink component escape. On an existing checkout, run only credential-free local queries:

```ts
const localInspectionQueries = [
  ['rev-parse', '--is-inside-work-tree'],
  ['remote', 'get-url', 'origin'],
  ['branch', '--show-current'],
  ['status', '--porcelain=v1'],
  ['log', '--format=%H %s', `origin/${defaultBranch}..HEAD`],
] as const;
```

Accept only `https://github.com/<repo>.git` or `git@github.com:<repo>.git` after canonical credential stripping; never persist the tokenized URL. Retry does not invoke remote Git. First-run remote clone/fetch goes through `runApprovedHostGit`, whose `finally` always disposes the helper.

- [ ] **Step 4: Verify workspace green**

Run: `mise exec node@24 -- npm test -- src/coding-workspace.test.ts`

Expected: PASS with no real GitHub/network access and no raw test token in snapshots or thrown messages.

Run: `mise exec node@24 -- npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the workspace slice**

```bash
git add src/coding-workspace.ts src/coding-workspace.test.ts
git commit -m "feat: prepare credential-safe host workspaces"
```

### Task 6: Exact stage configuration and sandboxed command broker

**Files:**

- Create: `src/coding-runners/command-broker.ts`
- Create: `src/coding-runners/command-broker.test.ts`
- Create: `src/coding-runners/devin-host.ts`
- Create: `src/coding-runners/devin-host.test.ts`

**Interfaces:**

- Consumes: `PipelineStageKind`, canonical workspace/job-root/sensitive paths.
- Produces:

```ts
export type DevinStageKind = PipelineStageKind | 'direct';

export interface DevinAgentConfig {
  system_instructions: string;
  allowed_tools: string[];
  permissions: {
    allow: string[];
    ask: [];
    deny: string[];
  };
}

export function buildDevinAgentConfig(input: {
  stageKind: DevinStageKind;
  workspace: string;
  jobRoot: string;
  brokerPath: string;
  devinCredentialPath: string;
  home: string;
  nanocrabConfigRoot: string;
}): DevinAgentConfig;

export function buildDevinChildEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;

export interface BrokerRequest {
  stageKind: DevinStageKind;
  workspace: string;
  cwd: string;
  argv: readonly string[];
  home: string;
  protectedPaths: readonly string[];
  trustedRuntimeReadRoots: readonly string[];
}

export type BrokerCommandExecutor = (
  executable: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    stdio: 'inherit';
  },
) => Promise<number>;

export interface CommandBrokerDependencies {
  platform: NodeJS.Platform;
  execute: BrokerCommandExecutor;
  readFile(path: string): Promise<string>;
  realpath(path: string): Promise<string>;
  environmentSource: NodeJS.ProcessEnv;
  sandboxExecutable: '/usr/bin/bwrap' | '/usr/bin/sandbox-exec';
}

export function validateBrokerCommand(request: BrokerRequest): void;
export function buildSandboxedCommand(
  request: BrokerRequest,
  deps: Pick<
    CommandBrokerDependencies,
    'platform' | 'sandboxExecutable' | 'environmentSource'
  >,
): { executable: string; args: string[]; env: NodeJS.ProcessEnv };
export async function runCommandBrokerCli(
  request: BrokerRequest,
  deps: CommandBrokerDependencies,
): Promise<number>;
```

- [ ] **Step 1: Write failing deep-equality configuration tests**

For planning and review, deep-equal this shape after substituting canonical paths:

```ts
expect(buildDevinAgentConfig(readOnlyInput)).toEqual({
  system_instructions: expect.stringContaining(
    'Do not modify repository files',
  ),
  allowed_tools: ['read', 'grep', 'glob', 'exec'],
  permissions: {
    allow: [
      'Read(/jobs/job/repo/**)',
      'Exec(/jobs/job/.nanocrab/bin/nanocrab-job-exec)',
    ],
    ask: [],
    deny: [
      'Read(/jobs/job/.nanocrab/**)',
      'Read(/home/service/.config/devin/credentials.json)',
      'Read(/home/service/.ssh/**)',
      'Read(/home/service/.gnupg/**)',
      'Read(/home/service/.config/nanocrab/**)',
      'Write(/jobs/job/.nanocrab/**)',
      'Write(/home/service/.config/devin/credentials.json)',
      'Write(/home/service/.ssh/**)',
      'Write(/home/service/.gnupg/**)',
      'Write(/home/service/.config/nanocrab/**)',
    ],
  },
});
```

Implement/direct must use `['read', 'grep', 'glob', 'edit', 'write', 'exec']` and add exactly `Write(<workspace>/**)` to `allow`. Test paths containing quotes/backslashes through JSON round-trip. Assert no MCP, browser, connector, computer-use, or host-control key exists.

Test the child environment equals only allowed `HOME`, trusted `PATH`, temp, locale, optional XDG values, `TERM: 'dumb'`, and `NO_COLOR: '1'`; seed representative `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `DEVIN_API_KEY`, `COOKIE`, `HTTP_PROXY`, channel tokens, and `PATH=.:<workspace>` and assert all are absent or sanitized.

- [ ] **Step 2: Write the command policy red matrix**

Use `it.each` for the exact allowed read commands and Git subcommands listed in the approved spec. For implement/direct, test these package-manager forms separately: `npm test`, `npm run test:unit`, `pnpm test`, `pnpm run test:unit`, `yarn test`, `yarn run test:unit`, `bun test`, and `bun run test:unit`; also test `cargo test|check|build`, `go test|build|vet`, `pytest`, and `python -m pytest`. Use another table that must throw for:

```ts
[
  ['git', 'commit'],
  ['git', 'push'],
  ['git', 'reset', '--hard'],
  ['npm', 'install'],
  ['npm', 'run', 'deploy'],
  ['pnpm', 'publish'],
  ['curl', 'https://example.com'],
  ['ssh', 'host'],
  ['bash', '-c', 'id'],
  ['docker', 'run', 'x'],
  ['sudo', 'id'],
  ['rm', '-rf', '.'],
  ['python', '-c', 'import os'],
  ['node', '-e', 'process.exit()'],
  ['rg', '--pre', 'bash -c id', 'needle'],
  ['git', '-c', 'core.pager=cat', 'status'],
];
```

Reject absolute/path-traversing executables, `--config`, environment assignment prefixes, NUL/newline args, cwd outside workspace, script names containing install/publish/release/deploy, and missing platform isolation before spawning.

Deep-equal the Linux bind list and macOS profile. Prove package scripts cannot
read the service home, Devin credential, NanoCrab config, or job metadata while
the explicit trusted runtime roots remain readable. Reject missing,
noncanonical, duplicate, and protected/runtime-overlapping roots before spawn.
Prove every accepted command uses OS isolation: Linux always includes network,
PID, IPC, session, parent-death, and private-proc isolation; macOS always uses
the explicit profile. Inspection and Git commands receive a read-only
workspace, while only implement/direct build/test commands receive a writable
workspace. Assert broker-injected Git reads use `--no-optional-locks` and
`GIT_OPTIONAL_LOCKS=0` without accepting user-supplied global options. Assert
the launcher embeds a canonical Node executable inside an approved runtime
root and never uses `/usr/bin/env`.
For every command kind, assert the resolved canonical temp path is reused in
the sandbox mount/profile and child environment; the original symlink spelling
must not survive validation.

- [ ] **Step 3: Run and verify red**

Run: `mise exec node@24 -- npm test -- src/coding-runners/command-broker.test.ts src/coding-runners/devin-host.test.ts -t "config|environment|command"`

Expected: FAIL because the command broker and config builders do not exist.

- [ ] **Step 4: Implement strict config, launcher, and OS sandbox**

Use exact allowlists, not prefix-only acceptance. Parse `<workspace>/package.json` through the injected `readFile` before allowing `npm|pnpm|yarn|bun run <name>`; require the script name to exist and reject names matching `/(install|publish|release|deploy)/i`. Spawn accepted commands through the injected `execute` with `shell: false` and the same scrubbed environment. The broker request embeds canonical service-home, protected-path, and trusted-runtime-root values; canonicalize them again and reject missing, noncanonical, duplicate, or overlapping protected/runtime roots before spawn. Route every accepted command through the platform sandbox, including Git and read inspections. Linux executes `/usr/bin/bwrap` from an empty root with `--unshare-net`, `--unshare-pid`, `--unshare-ipc`, `--new-session`, `--die-with-parent`, and a private `/proc`; bind only explicit runtime roots read-only and temp writable. Bind workspace read-only for Git/inspection and writable only for implement/direct build/test; never bind host `/`. macOS executes `/usr/bin/sandbox-exec -p <profile> -- <command...>`; the generated profile denies network, permits reads only below trusted runtime roots/workspace/temp, permits temp writes for all commands, and permits workspace writes only for implement/direct build/test. Service home, credentials, NanoCrab config, and job metadata are absent from both sandbox views. Inject `--no-optional-locks` and `GIT_OPTIONAL_LOCKS=0` for Git reads in addition to the fixed Git hardening arguments. If the platform is neither Linux nor macOS, the exact platform executable is unavailable, or isolation roots are unsafe, readiness fails before this function can be called.

Write the broker launcher at `<jobRoot>/.nanocrab/bin/nanocrab-job-exec` as a mode-`0555` Node entrypoint outside the writable repository. It imports the built `command-broker.js`, embeds only canonical workspace/stage/home/protected-path/runtime-root values, and embeds a readiness-approved canonical Node executable only after rechecking it lies below an approved runtime read root. The shebang must use that exact path, never `/usr/bin/env`. Construct the production `CommandBrokerDependencies` from fixed Node transports and the readiness-approved `/usr/bin/bwrap` or `/usr/bin/sandbox-exec` path, and forward `process.argv.slice(2)`; no shell or secret value is embedded.

- [ ] **Step 5: Verify green and exact snapshots**

Run: `mise exec node@24 -- npm test -- src/coding-runners/command-broker.test.ts src/coding-runners/devin-host.test.ts -t "config|environment|command"`

Expected: PASS with fake spawns only.

Run: `mise exec node@24 -- npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the policy slice**

```bash
git add docs/superpowers/plans/2026-07-14-devin-host-runner.md docs/superpowers/specs/2026-07-14-devin-host-runner-design.md src/coding-runners/command-broker.ts src/coding-runners/command-broker.test.ts src/coding-runners/devin-host.ts src/coding-runners/devin-host.test.ts
git commit -m "feat: constrain Devin stage tools and commands"
```

### Task 7: Fail-closed Devin readiness and profile compatibility

**Files:**

- Modify: `src/agent-runtime-registry.ts`
- Modify: `src/agent-runtime-registry.test.ts`
- Modify: `src/coding-runner-readiness.ts`
- Modify: `src/agent-profiles.ts`
- Modify: `src/agent-profiles.test.ts`

**Interfaces:**

- Consumes: `buildDevinChildEnvironment`, configured aliases, compatibility validator, platform sandbox checks.
- Produces:

```ts
export interface DevinProbeDependencies {
  execFile: (
    executable: string,
    args: readonly string[],
    options: { env: NodeJS.ProcessEnv; timeout: number },
  ) => Promise<{ stdout: string; stderr: string }>;
  realpath(value: string): Promise<string>;
  stat(value: string): Promise<fs.Stats>;
  lstat(value: string): Promise<fs.Stats>;
  getuid(): number;
  platform: NodeJS.Platform;
  commandAvailable(
    command: '/usr/bin/bwrap' | '/usr/bin/sandbox-exec',
  ): Promise<boolean>;
  env: NodeJS.ProcessEnv;
  credentialPath: string | null;
}

export async function probeDevinRuntime(
  deps: DevinProbeDependencies,
): Promise<AgentRuntimeHealth>;

export function getVerifiedDevinAliases(): ReadonlySet<string>;
```

`probeAgentRuntime('devin', options)` delegates to `probeDevinRuntime`; successful probes replace the cached advertised alias set atomically. Failed probes clear it. `probeCodingRunnerReadiness('devin')` uses the host probe, while Pi retains its container-specific readiness branch.

- [ ] **Step 1: Replace the unsupported test with a failing readiness matrix**

Use a fake `execFile` keyed by argument arrays. A healthy sequence must be exactly:

```ts
[['--version'], ['--help'], ['auth', 'status']];
```

Assert every call receives the exact scrubbed environment and `timeout: 10_000`; no call includes `-p`, `--prompt-file`, or `--model`. The help fixture must advertise both built-in aliases and the required flags. The credential fake has matching `lstat` and `stat` results for a regular file with `uid === getuid()` and `(mode & 0o777) === 0o600`. The platform fake reports `/usr/bin/bwrap` on Linux or `/usr/bin/sandbox-exec` on macOS.

Add named tests for:

```ts
it(
  'reports healthy only after version capabilities credential sandbox and auth checks',
);
it('reports unauthenticated and discards auth output containing personal data');
it.each([0o644, 0o640, 0o660, 0o666, 0o400])(
  'rejects credential mode %o',
  (mode) => {},
);
it('rejects a credential owned by another uid');
it('rejects a symlink or non-regular credential');
it('rejects a CLI missing prompt model config print or sandbox capability');
it('rejects missing /usr/bin/bwrap or /usr/bin/sandbox-exec support');
it('accepts only configured aliases advertised by non-network help');
it(
  'stores no auth stdout stderr name email user id team id or credential value',
);
it('marks Devin coding supported only when the host probe is healthy');
```

In `agent-profiles.test.ts`, assert mapped `devin/claude/claude-sonnet-4-6` passes and `devin/claude/opus`, `devin/codex/gpt-5.4`, and a provider-catalog-only model fail.

- [ ] **Step 2: Run and verify red**

Run: `mise exec node@24 -- npm test -- src/agent-runtime-registry.test.ts src/agent-profiles.test.ts -t "Devin|devin|credential|sandbox"`

Expected: FAIL because installed Devin is still reported `unsupported` and profile validation checks only provider-catalog membership.

- [ ] **Step 3: Implement readiness without reading credential contents**

Canonicalize, `lstat`, and `stat` only the configured credential path. Reject when `lstat.isSymbolicLink()` is true or when the canonical path differs from the configured absolute path; require macOS/Linux, a regular file, owner UID match, and exact `0600`. Require `/usr/bin/bwrap` on Linux and `/usr/bin/sandbox-exec` on macOS. Use `--version`, then `--help`, then `auth status`; discard auth stdout/stderr before forming health. Parse only the model examples in help into a set and require every configured mapping value to be advertised. Persist generic details such as `Devin host runner is ready` or `Run devin auth login as the NanoCrab service user`; never interpolate subprocess output.

When `credentialPath` is `null`, return `error` with the fixed action `Configure an absolute DEVIN_CREDENTIAL_PATH for the NanoCrab service user`; do not scan the home directory.

Update the Devin runtime definition to `codingRunnerSupported: true`, but return `healthy` only through the full probe. Update `validateRuntimeSelection` in `agent-profiles.ts` to call `validateCodingRuntimeSelection` when the profile includes the `coding` task kind or a stage role; ordinary non-coding profile validation remains provider-compatible.

- [ ] **Step 4: Verify readiness green and privacy**

Run: `mise exec node@24 -- npm test -- src/agent-runtime-registry.test.ts src/agent-profiles.test.ts src/coding-runner-adapters.test.ts`

Expected: PASS; runtime registry completeness now includes Devin among supported CLIs only under healthy readiness semantics.

Run: `mise exec node@24 -- npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the readiness slice**

```bash
git add src/agent-runtime-registry.ts src/agent-runtime-registry.test.ts src/coding-runner-readiness.ts src/agent-profiles.ts src/agent-profiles.test.ts
git commit -m "feat: probe Devin host runner readiness"
```

### Task 8: One-shot Devin host process adapter

**Files:**

- Modify: `src/coding-runners/devin-host.ts`
- Modify: `src/coding-runners/devin-host.test.ts`

**Interfaces:**

- Consumes: runner contracts, strict config/environment, shared registry, streaming redactor, mapped Devin CLI alias.
- Produces:

```ts
export interface DevinHostRunnerDependencies {
  spawn: CodingProcessSpawner;
  registry: ProcessRegistry;
  timers: CodingTimerTransport;
  executable: string;
  environmentSource: NodeJS.ProcessEnv;
  knownSecrets: readonly string[];
  writeFile(
    path: string,
    data: string,
    options: { mode: number },
  ): Promise<void>;
  realpath(path: string): Promise<string>;
}

export function createDevinHostRunner(
  deps: DevinHostRunnerDependencies,
): CodingRunnerAdapter;
```

`CodingRunnerInput.model` is already the exact mapped Devin CLI alias, not the provider model ID.
When `CodingRunnerInput.stageKind` is `null`, map it to `direct` before generating the stage policy; never pass `null` to `buildDevinAgentConfig`.

- [ ] **Step 1: Write exact invocation and output tests**

Assert the spawn call deep-equals:

```ts
expect(spawn).toHaveBeenCalledWith(
  'devin',
  [
    '--prompt-file',
    '/jobs/job/.nanocrab/prompt.txt',
    '--model',
    'claude-sonnet-4',
    '--permission-mode',
    'auto',
    '--sandbox',
    '--agent-config',
    '/jobs/job/.nanocrab/devin-agent.json',
    '--respect-workspace-trust',
    'true',
    '-p',
  ],
  {
    cwd: '/jobs/job/owner__repo',
    env: expectedScrubbedEnvironment,
    shell: false,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
```

Assert config is written outside the writable repository at mode `0600`, process registration occurs before handlers may mutate output, stdout/stderr preserve stream attribution and arrival order, safe output is bounded after redaction, and known secrets split across chunks never reach `onOutput`.

- [ ] **Step 2: Write failing terminal-race tests**

Use fake timers/process emitters and exact names:

```ts
it(
  'maps exit zero to succeeded and nonzero to failed with a redacted stderr tail',
);
it('maps spawn error once and ignores a later close');
it('times out with TERM then KILL and remains timed_out after close');
it('cancels the exact attempt and remains cancelled after error or close');
it('makes repeated cancellation idempotent');
it('does not emit stale output after a newer retry owns the job');
it('does not let stale close error or timeout delete a newer lease');
it('cancel followed by retry signals only the old process group');
it('flushes redactor carry safely on close and error');
```

- [ ] **Step 3: Run and verify red**

Run: `mise exec node@24 -- npm test -- src/coding-runners/devin-host.test.ts`

Expected: FAIL because `createDevinHostRunner` does not yet own the process lifecycle.

- [ ] **Step 4: Implement first-terminal-event-wins**

Inside `run`, create independent stdout/stderr redactors, spawn, register a lease, and capture it in every callback. Keep an adapter-local map keyed by `${jobId}\0${attemptId}` so `cancel` can settle that exact run. Use one `settle(result, releaseLease)` closure guarded by a boolean. Before `onOutput`, require both `!settled` and `registry.owns(lease)`; safe-flush both streams exactly once during settlement. Normal close/error uses `releaseLease: true`; timeout/cancellation uses `releaseLease: false` so the registry retains the terminating lease through TERM-to-KILL escalation. Timeout calls `registry.terminate(lease, 'timed_out')` and resolves `timed_out` regardless of later close. `cancel(jobId, attemptId)` retrieves only the exact active run, calls `terminate(..., 'cancelled')`, and triggers that run's cancellation settlement; no job-ID-only fallback is allowed.

Nonzero detail is `Devin exited with code <n>: <bounded-redacted-stderr>`; spawn/timeout/cancel details are fixed non-sensitive categories. Never serialize the environment or auth data.

- [ ] **Step 5: Verify adapter green**

Run: `mise exec node@24 -- npm test -- src/coding-runners/devin-host.test.ts src/coding-runners/process-registry.test.ts src/logger.test.ts`

Expected: PASS with no real Devin/network invocation.

Run: `mise exec node@24 -- npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the adapter slice**

```bash
git add src/coding-runners/devin-host.ts src/coding-runners/devin-host.test.ts
git commit -m "feat: run Devin as an attempt-owned host process"
```

### Task 9: Coding-job approval, attempt, workspace, dispatch, and evidence integration

**Files:**

- Modify: `src/coding-jobs.ts`
- Modify: `src/coding-jobs.test.ts`

**Interfaces:**

- Consumes: `prepareCodingWorkspace`, `probeCodingRunnerReadiness`, `resolveDevinCliModelAlias`, `createDevinHostRunner`, existing container runner, exact attempt types.
- Produces these testable orchestration seams:

```ts
export interface CodingJobExecutionDependencies {
  createAttemptId(): string;
  probeReadiness(cli: AgentCliId): Promise<AgentRuntimeHealth>;
  prepareWorkspace(
    input: CodingWorkspaceInput,
  ): Promise<PreparedCodingWorkspace>;
  devinRunner: CodingRunnerAdapter;
  runContainer(
    job: CodingJob,
    repo: CodingRepo,
    attemptId: string,
  ): Promise<number>;
  now(): string;
}

export function configureCodingJobExecutionForTests(
  overrides: Partial<CodingJobExecutionDependencies> | null,
): void;
```

Keep the production default private except for this resettable test seam. Resetting with `null` must restore every production dependency so test state cannot leak between cases; this issue does not refactor the whole state machine.

- [ ] **Step 1: Write failing attempt sequencing and selection tests**

Add tests that drive the real approval state machine with injected fakes:

```ts
it('persists a preparing attempt before first workspace mutation', async () => {
  await approveAndRun(job);
  expect(events).toEqual([
    'probe:devin',
    'persist:attempt-1:preparing',
    'workspace:first=true',
    'runner:attempt-1',
  ]);
});

it(
  'computes first run from prior attempts before appending the current attempt',
);
it('retries only after the prior terminal attempt is persisted');
it('selects Devin from actualRuntime.cli and never spawns Docker');
it('keeps legacy Pi and Mistral on their existing container cases');
it(
  'persists CLI provider model job run pipeline stage agent and decision attribution',
);
```

The first-run test must snapshot `priorAttempts = []`, append `attempt-1`, and still observe `isFirstRun: true`. The retry test starts with one terminal attempt and observes `isFirstRun: false` without clearing diff/output/commit/PR/workspace fields.

- [ ] **Step 2: Write failing gate/fallback/terminal tests**

Cover:

```ts
it('rechecks healthy Devin readiness after approval before workspace mutation');
it('blocks workspace and spawn when the post-approval probe becomes unhealthy');
it('rejects an incompatible retained CLI after provider fallback');
it('atomically applies an approved complete fallback runtime triple');
it(
  'rejects provider-model-only fallback and requests a control-plane decision',
);
it('rejects a catalog-only Devin model before a per-job Devin process');
it('maps timed_out to failed and cancelled to the explicit cancelled state');
it(
  'preserves workspace branch output diff files commit push PR and attempt history on timeout',
);
it(
  'cancels using persisted activeAttemptId and ignores stale callbacks from a retry',
);
it('does not silently fall back after a Devin runner failure');
it('runner success still requires test evidence and PR approval');
```

- [ ] **Step 3: Run and verify red**

Run: `mise exec node@24 -- npm test -- src/coding-jobs.test.ts -t "attempt|Devin|legacy Pi|legacy Mistral|post-approval|fallback|timed_out|activeAttemptId"`

Expected: FAIL because execution remains provider-selected/container-only and has no attempt lease sequencing.

- [ ] **Step 4: Implement exact attempt setup and dispatch order**

After fallback resolution, complete-triple validation, implementation approval, and the fresh fail-closed readiness probe:

```ts
const readiness = await deps.probeReadiness(job.runnerCli);
if (readiness.status !== 'healthy') {
  throw new Error(readiness.detail);
}
const priorAttempts = [...job.executionAttempts];
const isFirstRun = priorAttempts.length === 0;
const attemptId = deps.createAttemptId();
job.executionAttempts.push({
  id: attemptId,
  state: 'preparing',
  startedAt: deps.now(),
  completedAt: null,
});
job.activeAttemptId = attemptId;
upsertCodingJob(job);

const prepared = await deps.prepareWorkspace({
  jobId: job.id,
  repo: job.repo,
  defaultBranch: repo.defaultBranch,
  branch: job.branch,
  workspace: job.workspace,
  isFirstRun,
});
```

For Devin, resolve the CLI alias from the already-verified alias set and pass it as `CodingRunnerInput.model`. For all other CLIs call the existing container route and register it with the exact `attemptId`. Terminalize only the matching active attempt; sanitize detail, clear `activeAttemptId` only when it still matches, and preserve append-only history. A preparation/spawn exception terminalizes this same attempt.

Build the adapter's `knownSecrets` from GitHub/provider/NanoCrab credential values already loaded in memory for existing runtime operation, filter to values at least eight characters, and never add the Devin credential contents. This list is used only by the streaming redactors and is never persisted or logged.

Change fallback handling to accept only a complete `AgentRuntimeSelection`. Atomically assign `actualRuntime`, `runnerCli`, `provider`, and `model` after validation; otherwise keep the job gated and create/request the existing owner decision. Do not infer a new CLI from provider after an explicit runtime exists.

- [ ] **Step 5: Route exact cancellation and retry preservation**

`cancelCodingJob` reads `activeAttemptId`; for Devin call `devinRunner.cancel(job.id, activeAttemptId)`, for container call `cancelContainerProcess(job.id, reason, activeAttemptId)`. If no active attempt exists, cancellation may transition a queued/gated job without signaling. `retryCodingJob` must reject while the previous attempt is nonterminal, retain all evidence fields, and create no attempt until approval/fallback/readiness flow reaches execution again.

- [ ] **Step 6: Verify integration green and existing lifecycle**

Run: `mise exec node@24 -- npm test -- src/coding-jobs.test.ts src/coding-workspace.test.ts src/coding-runners/devin-host.test.ts`

Expected: PASS; approval -> implement -> test -> PR approval behavior remains intact.

Run: `mise exec node@24 -- npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the orchestration slice**

```bash
git add src/coding-jobs.ts src/coding-jobs.test.ts
git commit -m "feat: dispatch coding jobs by approved runner CLI"
```

### Task 10: Admin and Autofix runtime selection and attribution

**Files:**

- Modify: `src/admin/routes/agents.ts`
- Create: `src/admin/routes/agents-runtime-selection.test.ts`
- Modify: `src/admin/public/pages/agents.js`
- Modify: `src/admin/agents-ui.test.ts`
- Modify: `src/admin/plugins/autofix/routes.ts`
- Modify: `src/admin/plugins/autofix/routes.test.ts`
- Modify: `src/admin/public/pages/autofix.js`
- Modify: `src/admin/autofix-ui.test.ts`

**Interfaces:**

- Consumes: complete `AgentRuntimeSelection`, runtime definitions/readiness, `validateCodingRuntimeSelection`.
- Produces API catalog items:

```ts
interface CodingRuntimeOption {
  cli: AgentCliId;
  provider: AgentProvider;
  model: string;
  cliModel: string | null;
  available: boolean;
  readiness: AgentRuntimeHealth;
}
```

Extend `Project` with `runtime: AgentRuntimeSelection`; normalize legacy `{provider, model}` by `inferLegacyRunnerCli(provider)`, but persist new/updated records as a complete triple. `buildAutofixStartInput` passes `actualRuntime: project.runtime`.

- [ ] **Step 1: Write failing server-route and Autofix tests**

Create an Express route test following `agents-providers-openai-compatible.test.ts`. Mock `startCodingJob` and assert:

```ts
it('accepts a mapped complete Devin runtime', async () => {
  const response = await post('/api/agents/coding/jobs', {
    repo: 'owner/repo',
    prompt: 'Plan issue 129',
    actualRuntime: {
      cli: 'devin',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
    },
  });
  expect(response.status).toBe(200);
  expect(startCodingJob).toHaveBeenCalledWith(
    expect.objectContaining({
      actualRuntime: {
        cli: 'devin',
        provider: 'claude',
        model: 'claude-sonnet-4-6',
      },
    }),
  );
});
```

Reject missing CLI, Devin/provider-catalog-only model, OpenCode/Claude mismatch, and unhealthy Devin readiness with status `400` before `startCodingJob`.

In Autofix tests, assert legacy Codex normalizes to `{cli:'codex',provider:'codex',model:'gpt-5.4'}`, mapped Devin persists exactly, incompatible triples throw, and `buildAutofixStartInput` carries `actualRuntime` rather than loose provider/model.

- [ ] **Step 2: Write failing UI source contracts**

In both UI tests require selectors/labels for `Runner CLI`, `Provider`, and `Model`; compatibility filtering by complete runtime options; unavailable readiness detail; an external-processing warning when Devin is selected; and job cards/details rendering:

```js
runtimeLabel(
  job.actualRuntime || {
    cli: job.runnerCli,
    provider: job.provider,
    model: job.model,
  },
);
```

The rendered label must be `devin / claude / claude-sonnet-4-6`, not provider/model only. Assert both POST bodies contain `actualRuntime: { cli, provider, model }` and no UI treats `devin` as a provider.

- [ ] **Step 3: Run and verify red**

Run: `mise exec node@24 -- npm test -- src/admin/routes/agents-runtime-selection.test.ts src/admin/plugins/autofix/routes.test.ts src/admin/agents-ui.test.ts src/admin/autofix-ui.test.ts`

Expected: FAIL because routes and pages currently accept/display only provider/model for coding jobs.

- [ ] **Step 4: Implement server-side validation first**

Add `GET /agents/coding/runtimes` returning only compatible triples with readiness. `POST /agents/coding/jobs` and pick-issue parse a complete runtime object, call `validateCodingRuntimeSelection`, require healthy readiness for Devin, and pass the unchanged object to `startCodingJob`. Do the same for Autofix create/update/run/workbench/auto-pick/webhook paths. Legacy project reads normalize in memory; writes persist the triple.

Do not trust UI filtering. Reject incompatible values with a stable operator message containing all three identities and no secrets.

- [ ] **Step 5: Implement three-part UI selection and display**

Load runtime options once, derive provider/model choices from the selected CLI's compatible entries, and disable dispatch when readiness is not healthy. Display the non-sensitive readiness detail and this exact warning for Devin: `Devin sends the prompt, selected repository content, and tool results to Devin's external service.` Preserve existing implementation and PR approval buttons.

- [ ] **Step 6: Verify routes and rendered-source contracts**

Run: `mise exec node@24 -- npm test -- src/admin/routes/agents-runtime-selection.test.ts src/admin/plugins/autofix/routes.test.ts src/admin/agents-ui.test.ts src/admin/autofix-ui.test.ts`

Expected: PASS.

Run: `mise exec node@24 -- npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the admin slice**

```bash
git add src/admin/routes/agents.ts src/admin/routes/agents-runtime-selection.test.ts src/admin/public/pages/agents.js src/admin/agents-ui.test.ts src/admin/plugins/autofix/routes.ts src/admin/plugins/autofix/routes.test.ts src/admin/public/pages/autofix.js src/admin/autofix-ui.test.ts
git commit -m "feat: expose Devin runtime identity in coding UI"
```

### Task 11: Operator, security, profiles, roadmap, and configuration documentation

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/AGENT_PROFILES.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**

- Consumes: implemented environment names, health statuses, alias map, timeout, exact `0600` requirement, UI wording.
- Produces: operator setup/rollback and truthful completion evidence; no runtime code.

- [ ] **Step 1: Add exact environment examples**

Document:

```dotenv
# Host-native coding runner timeout; defaults to CONTAINER_TIMEOUT.
CODING_JOB_RUNNER_TIMEOUT_MS=1800000

# Absolute path to the service user's Devin credential file. NanoCrab stats
# this file but never reads its contents. Owner must match the service UID and
# POSIX mode must be exactly 0600.
DEVIN_CREDENTIAL_PATH=/home/nanocrab/.config/devin/credentials.json

# Optional exact provider/model -> Devin CLI alias extensions. Built-ins are
# claude-sonnet-4-6 and claude-opus-4-6 and cannot be overridden.
DEVIN_CLI_MODEL_ALIASES_JSON={"claude/claude-haiku-4-5":"claude-haiku-4.5"}
```

The path is an example for the dedicated service account, not a claim that NanoCrab manages that file.

- [ ] **Step 2: Update operator and profile docs**

README and `docs/AGENT_PROFILES.md` must state:

- NanoCrab itself runs directly on macOS/Linux as the same dedicated OS user that owns the authenticated Devin installation;
- run interactive `devin auth login` as that user and set the credential to exact `0600`;
- profile assignment is opt-in; start with planning/review, then a deliberately selected low-risk issue after owner approval;
- CLI/provider/model remain distinct and a mapped example is `devin / claude / claude-opus-4-6`;
- readiness is repeated after approval before workspace mutation;
- no silent fallback; owner must approve a complete replacement triple;
- live smoke testing is excluded unless Henrik separately approves cost/external processing.

- [ ] **Step 3: Update the security boundary and rollback**

`docs/SECURITY.md` must name trusted host process/Git children, constrained model tools, environment allowlist, Git-only askpass, stateful redaction, external processing, Research Preview sandbox residual risk, preserved dirty workspaces, and TERM-to-KILL ownership. State that mounting credentials into a NanoCrab container is unsupported.

Rollback is: disable/reassign Devin profiles, cancel exact active attempts, preserve checkout/evidence, and revert the adapter/readiness support. Never delete Devin authentication or sessions.

- [ ] **Step 4: Update roadmap truthfully**

Mark #129 implemented only if Tasks 1-10 and the repository verification below pass. Keep live operator rollout unchecked or explicitly marked as a separate approval-dependent operation. Do not state deployed, released, live-tested, merged, closed, or `Done`.

- [ ] **Step 5: Verify documentation consistency**

Run: `rtk rg -n "Devin|DEVIN_CLI_MODEL_ALIASES_JSON|CODING_JOB_RUNNER_TIMEOUT_MS|0600|external service|Research Preview" README.md docs/SECURITY.md docs/AGENT_PROFILES.md docs/ROADMAP.md .env.example`

Expected: every configuration name and security boundary appears in the intended docs; no document describes Devin as a provider or container runner.

Run: `git diff --check`

Expected: PASS.

- [ ] **Step 6: Commit the documentation slice**

```bash
git add .env.example README.md docs/SECURITY.md docs/AGENT_PROFILES.md docs/ROADMAP.md
git commit -m "docs: document Devin host runner operations"
```

## Final Verification and Delivery Gate

After every task has passed its fresh task review, run an independent final code review against `main..HEAD`. Resolve findings with a new TDD slice and focused commit before continuing.

- [ ] Run formatting: `mise exec node@24 -- npm run format:check`

Expected: PASS.

- [ ] Run lint: `mise exec node@24 -- npm run lint`

Expected: PASS with zero errors; report the existing warning count separately.

- [ ] Run typecheck: `mise exec node@24 -- npm run typecheck`

Expected: PASS.

- [ ] Run full tests: `mise exec node@24 -- npm test`

Expected: PASS with no network, GitHub, real Devin, or paid model invocation.

- [ ] Run build: `mise exec node@24 -- npm run build`

Expected: PASS.

- [ ] Check whitespace and scope: `git diff --check && git status --short && git diff --stat main...HEAD`

Expected: no whitespace errors, only issue #129 files, and a clean worktree after commits.

- [ ] Prove no forbidden provider/container changes: `git diff main...HEAD -- src/agent-provider.ts src/credential-proxy.ts container/Dockerfile`

Expected: empty output.

- [ ] Prove no test can launch a paid session: `rtk rg -n "spawn\(['\"]devin|execFile\(['\"]devin|devin .* -p" src/**/*.test.ts`

Expected: only fake transport expectations; no unmocked production process call.

- [ ] Push `feature/devin-host-runner`, create a ready-for-review PR targeting `main`, link `#129`, and include red/green evidence, the full verification results, skipped live testing, external-processing boundary, and sandbox residual risk.

- [ ] Move issue #129 to `In review`. Do not merge, close the issue, move it to `Done`, release, deploy, or run live Devin without Henrik's separate explicit approval.
