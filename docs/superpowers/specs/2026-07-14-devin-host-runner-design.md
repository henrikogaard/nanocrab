# Devin Host Runner - Design Spec

## Context

NanoCrab's coding control plane stores the selected runtime as an
`AgentRuntimeSelection` containing a CLI, provider, and model. The merged
control-plane implementation discovers the installed `devin` CLI and can assign
it to an agent profile, but it deliberately reports Devin as unsupported for
coding jobs. Coding-job execution still selects a container command from
`job.provider`; it persists `actualRuntime`, but does not use
`actualRuntime.cli` to choose the executable. A profile configured with Devin
as its CLI and Claude as its provider therefore runs Claude rather than Devin.

The installed Devin CLI provides the primitives needed for a bounded adapter:
non-interactive print mode, prompt files, explicit model selection, declarative
agent configuration, a filesystem sandbox, and host-local authentication. Its
authentication cannot currently be routed through NanoCrab's provider
credential proxy without copying or mounting Devin's own credentials. This
design keeps those credentials in place and runs the CLI as a host process
against NanoCrab's existing per-job isolated checkout.

Issue #129 tracks this work. This specification supersedes its earlier proposal
to add Devin provider configuration: Devin is a CLI runtime, not an
`AgentProvider`.

## Goal

Add the installed Devin CLI as a credential-safe, host-native coding runner
behind NanoCrab's existing approval-gated coding-job and control-plane
lifecycle.

The runner must preserve:

- per-job isolated checkouts, branches, prompts, and evidence;
- canonical job, run, pipeline, stage, agent, CLI, provider, and model identity;
- stage-appropriate read/write boundaries;
- bounded, redacted output;
- explicit success, failure, timeout, and cancellation behavior;
- existing implementation and PR decision gates; and
- fake-transport tests that never create a paid or network Devin session.

## Non-Goals

- Running Devin inside the NanoCrab agent image.
- Copying, mounting, proxying, rotating, or otherwise managing Devin
  credentials.
- Adding `devin` to `AgentProvider`, provider models, provider credentials, or
  credential-proxy routes.
- Implementing Devin ACP, Cloud, REST API, remote-session continuation, or
  follow-up messages.
- Scraping an unstable remote session identifier from human-oriented CLI
  output.
- Replacing the coding-job state machine, approval model, PR workflow, or
  existing container runners.
- Refactoring all container process management beyond the compatibility seam
  required to own and cancel a host runner.
- Fixing broader planning/review artifact handoff or checkout behavior outside
  what the coding-job orchestrator supplies to this adapter.
- Running a live Devin smoke test as part of implementation, CI, or normal
  verification.

## Decision Summary

| Decision             | Selected direction                                                              |
| -------------------- | ------------------------------------------------------------------------------- |
| Execution boundary   | One-shot host-native Devin CLI process                                          |
| Runtime selection    | Persisted `runnerCli`, sourced from `actualRuntime.cli`                         |
| Provider identity    | Existing provider/model remain separate from CLI                                |
| Authentication       | Existing host Devin authentication, used in place                               |
| Credential exposure  | No credential copy, mount, argument, generated file, or child environment value |
| Filesystem isolation | Required Devin sandbox plus strict generated permission scopes                  |
| Git access           | Dedicated host Git subprocesses with Git-only askpass environment               |
| Process ownership    | Detached process group owned by the coding job                                  |
| Timeout              | Explicit runner timeout with TERM-to-KILL escalation                            |
| Tests                | Fake process, Git, timer, and filesystem transports; no paid session            |
| Database changes     | None; JSON job records normalize legacy values on read                          |

## Considered Approaches

### 1. Host-native one-shot CLI

NanoCrab prepares the job checkout, generates a prompt and strict Devin agent
configuration, and spawns the installed CLI in non-interactive mode from that
checkout.

Advantages:

- reuses the authenticated local installation without moving credentials;
- writes directly to NanoCrab's existing isolated job checkout;
- maps naturally to the existing job, output, timeout, and cancellation model;
- requires no paid session in automated tests; and
- is the smallest implementation that makes `actualRuntime.cli` truthful.

Costs and risks:

- the trusted host process, rather than Docker, owns the CLI;
- isolation depends on Devin's permission enforcement and filesystem sandbox;
- selected repository content is processed by Devin's external service; and
- network use by commands inside the host runner is not a container network
  boundary.

This is the selected approach. Fail-closed readiness checks and the existing
owner implementation gate mitigate its host boundary.

### 2. Devin inside the agent container

This would match the current coding-runner shape, but the CLI requires its own
authenticated state. Supplying that state would require copying or mounting a
raw host credential into the container or reverse-engineering an unsupported
authentication flow. Both conflict with NanoCrab's credential model and create
more image and platform work. This approach is rejected unless Devin later
provides a supported proxyable authentication interface.

### 3. ACP stdio or remote API sessions

ACP could provide typed events and richer session lifecycle, while the remote
API supports dedicated service users and RBAC. Both are larger integrations.
ACP still consumes host authentication, and cloud sessions change the local
checkout, repository access, cost, and evidence model. The runner interface
will not prevent a future ACP or cloud adapter, but neither belongs in issue
#129.

## Architecture

### Runner contract

Introduce a provider-neutral coding-runner contract under
`src/coding-runners/`:

```ts
interface CodingRunnerInput {
  jobId: string;
  cli: AgentCliId;
  model: string;
  stageKind: PipelineStageKind | null;
  workspace: string;
  promptFile: string;
  timeoutMs: number;
  onOutput(chunk: CodingRunnerOutputChunk): void;
}

interface CodingRunnerOutputChunk {
  stream: 'stdout' | 'stderr';
  text: string;
}

interface CodingRunnerResult {
  state: 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  detail?: string;
}

interface CodingRunnerAdapter {
  run(input: CodingRunnerInput): Promise<CodingRunnerResult>;
  cancel(jobId: string): boolean;
}
```

Process creation, Git execution, timers, signals, and relevant filesystem
queries must be injectable. Unit tests use fakes and never invoke the installed
CLI, GitHub, or Devin's network.

Existing container execution remains in `coding-jobs.ts` for this slice, while
runner resolution provides the new adapter seam. A shared process registry owns
both host and container processes. `container-runner.ts` keeps compatibility
wrapper exports so current callers and tests do not change unnecessarily.

### Runner selection and identity

Add `runnerCli: AgentCliId` to new `CodingJob` records. It is the executable
identity and is distinct from `provider` and `model`.

For a new job:

1. If `actualRuntime` is present, set `runnerCli` to `actualRuntime.cli` and
   preserve the entire runtime selection.
2. Otherwise infer the current executable from the selected provider:
   - `claude` -> `claude`;
   - `codex` -> `codex`;
   - `opencode`, `openrouter`, `ollama`, and `openai-compatible` -> `opencode`.
3. Validate that the resulting CLI has a supported coding adapter before the
   job becomes dispatchable.

For persisted jobs without `runnerCli`, `ensureJobDefaults` applies the same
legacy inference. This is an in-memory/read-time JSON normalization; no data
rewrite or SQLite migration is required.

The UI, audit context, output header, and stage evidence display
`runnerCli / provider / model`. A Devin profile can therefore truthfully show,
for example, `devin / claude / claude-opus-4.6`. Devin remains absent from
provider definitions and credential configuration.

### Host workspace preparation

The Devin adapter reuses the existing path:

```text
data/coding-workspaces/jobs/<job-id>/
  .nanocrab/
    prompt.txt
    devin-agent.json
    diff-stat.txt
    changed-files.txt
    untracked.txt
    test-summary.txt
  <owner>__<repo>/
    .git/
    ...repository files...
```

The repository directory is the only agent-writable root. Prompt and agent
configuration files live in the metadata parent, outside that root. The Devin
CLI may read them at startup, but agent tools cannot modify them.

Before starting Devin, a host workspace helper performs the same clone, fetch,
default-branch reset, and job-branch creation currently performed by the
container script. It uses argument arrays and an injectable Git transport. For
private repositories, `GITHUB_TOKEN` is exposed only to these short-lived Git
subprocesses through a mode-`0700` askpass helper and a Git-specific environment.
The token is not embedded in a remote URL, `.git/config`, prompt, output, or
Devin environment.

After Devin exits successfully, NanoCrab uses the existing diff, untracked-file,
test-summary, commit, push, PR, and evidence paths. Devin continues to receive
the instruction not to commit, push, or open a PR itself.

### Devin invocation

Spawn the allowlisted Devin executable directly with `shell: false`,
`detached: true`, piped stdout/stderr, and `cwd` set to `job.workspace`.
Arguments are equivalent to:

```text
devin
  --prompt-file <job-root>/.nanocrab/prompt.txt
  --model <selected-model>
  --permission-mode auto
  --sandbox
  --agent-config <job-root>/.nanocrab/devin-agent.json
  --respect-workspace-trust true
  -p
```

`--permission-mode auto` is deliberate. Automation permissions come from the
generated strict agent configuration, not the broad `dangerous` mode. Required
tool and command scopes must be explicitly allowed there. If the installed CLI
cannot execute the scoped job non-interactively with this configuration, the
job fails; NanoCrab must not retry with broader permissions.

The generated configuration exposes only file reading/search, stage-appropriate
editing, and command execution required for repository work. It contains no
MCP servers, browser, connectors, computer-use tools, or host-control tools.

Permission policy by stage:

| Stage             | Read                      | Write                     | Commands                                                     |
| ----------------- | ------------------------- | ------------------------- | ------------------------------------------------------------ |
| Planning          | Repository workspace only | None                      | Scoped repository inspection commands                        |
| Implement         | Repository workspace only | Repository workspace only | Repository build/test/edit commands inside the sandbox       |
| Review            | Repository workspace only | None                      | Scoped diff, inspection, and read-only verification commands |
| Direct legacy job | Repository workspace only | Repository workspace only | Same as Implement after the existing implementation approval |

Sensitive paths are explicitly denied as defense in depth, including the
Devin credential, `.ssh`, `.gnupg`, NanoCrab `.env`, channel authentication,
mount allowlists, and host credential/config directories. Because the sandbox
derives readable and writable roots from active `Read(...)` and `Write(...)`
scopes, the workspace allowlist is authoritative; sensitive-path denies must
not be used as a substitute for it.

### Child environment

Build the Devin child environment from an allowlist, not `process.env`. It may
contain only what the executable needs to start and locate its own host state:

- `HOME`;
- a trusted host `PATH` that does not include the repository or `.`;
- `TMPDIR` and platform-required temp variables;
- locale values;
- `XDG_CONFIG_HOME` and `XDG_DATA_HOME` when configured;
- `TERM=dumb`; and
- `NO_COLOR=1`.

Do not forward GitHub/provider/API keys, tokens, cookies, authorization
headers, credential-proxy values, arbitrary `DEVIN_*` secrets, or the complete
NanoCrab service environment. The model is an argument, not an environment
override. Proxy variables are excluded because they may contain credentials;
deployments that require an authenticated proxy are unsupported in this slice.

## Host Deployment and Readiness

The host runner is supported only when the NanoCrab Node.js process itself runs
on macOS or Linux under the same dedicated operating-system account that owns
the Devin installation and authenticated state. Running NanoCrab itself inside
a container does not make the host runner available; mounting host credentials
into that container is explicitly unsupported.

A Devin runtime probe is healthy only when all of these checks pass:

1. the allowlisted executable exists and `--version` succeeds within the probe
   timeout;
2. the installed CLI exposes the required non-interactive, prompt-file, model,
   agent-config, and sandbox capabilities;
3. the canonical credential file can be located without reading its contents;
4. the credential is a regular file owned by the NanoCrab service user;
5. its POSIX mode is exactly `0600`, with no group or world permissions;
6. sandbox prerequisites for the current platform are available; and
7. `devin auth status` exits successfully.

Authentication output may contain personal account details. Probes discard its
stdout/stderr and persist only a generic status and detail. A failed auth check
maps to `unauthenticated`; missing executable maps to `missing`; unsafe
ownership/mode, missing sandbox support, unsupported CLI capabilities, or other
failures map to `error` with a non-sensitive operator action.

Any credential with mode `0644`, including the pre-implementation state
observed during design research, fails readiness. NanoCrab reports the exact
required `0600` mode but does not modify, copy, delete, or rotate the
credential.

Runtime health remains a pre-dispatch check. A profile assignment opts into the
runner, and implementation still requires the existing owner approval. If
Devin is unavailable, the control plane uses its existing explicit fallback
decision flow; it never silently substitutes another CLI for write-capable
work.

## Security and Privacy Boundaries

### Trusted components

- The NanoCrab host process prepares the workspace, invokes Git, starts Devin,
  owns the process group, and reads the exit result.
- The installed Devin CLI may read its own host authentication to connect to
  Devin's service.
- Dedicated host Git subprocesses may temporarily receive GitHub authentication
  for clone/fetch/push operations already approved by NanoCrab.

### Untrusted or constrained components

- Model-directed file and command tools are constrained to generated
  stage-specific scopes and the required filesystem sandbox.
- Repository content, issue text, generated prompts, and tool results are
  untrusted inputs and must not influence executable paths, shell syntax,
  permission scopes, metadata paths, or environment keys.
- The repository cannot modify the prompt or agent configuration because both
  are outside its writable root.

### Credential boundary

No raw Devin, GitHub, provider, channel, connector, or NanoCrab credential may
enter:

- runner arguments;
- prompts or generated agent configuration;
- the repository checkout;
- the Devin child environment;
- output or audit events;
- a container mount; or
- test fixtures.

Output passes through `redactLogString` before persistence. Audit events record
only job identity, runtime identity, paths already considered operator-visible,
terminal state, and non-sensitive failure categories. Neither auth-status
output nor a serialized environment is logged.

### External processing

Running Devin sends prompts, selected repository content, and tool results to
Devin's service. The UI and operator docs must state this clearly. Assignment
of a Devin profile plus the existing implementation approval is the explicit
operator decision to cross that boundary. Zero-data-retention or account policy
reported by the CLI is not treated as a substitute for NanoCrab's own warning.

### Residual risk

The installed CLI labels its filesystem sandbox as Research Preview. NanoCrab
must fail closed when sandbox support is absent, but cannot independently prove
the implementation of that third-party sandbox. Deployments requiring a
stronger multi-user or production boundary should use a dedicated OS account
and may later adopt a service-user/cloud adapter. The implementation must not
weaken permissions to make a job succeed.

## Output and Evidence

The adapter emits stream-tagged chunks. `coding-jobs.ts` redacts each chunk,
preserves stdout/stderr attribution in the persisted job output, and retains
the existing output cap. A command that prints a secret-like value therefore
does not persist it verbatim.

NanoCrab `job.id` and `runId` are canonical. `runnerCli`, provider, model,
agent profile, pipeline, stage, decision, workspace, and branch remain explicit
in the job and audit history. One-shot CLI execution is process-based, so a
remote Devin session ID is neither required nor scraped. A future ACP adapter
may add a typed optional remote-session reference without changing job identity.

On successful runner exit, existing metadata collection determines changed
files, diff summary, and test summary. Runner success means only that the CLI
process completed; it does not bypass test evidence, PR approval, CI, stage
completion validation, or the Project swimlane decision gate.

## Timeout and Cancellation

Add `CODING_JOB_RUNNER_TIMEOUT_MS`, defaulting to `CONTAINER_TIMEOUT`. Reject
non-finite, non-positive configuration rather than treating it as unlimited.

Each active runner owns one detached process group keyed by `job.id`. Exactly
one terminal result may win. Completion clears timeout and escalation timers
and removes the registry entry.

Timeout flow:

1. Mark the in-memory run as timing out.
2. Send `SIGTERM` to the negative process-group PID.
3. Wait a fixed five-second grace period.
4. Send `SIGKILL` if the group remains active.
5. Resolve the adapter result as `timed_out` even if the later close event
   reports a signal or exit code.
6. Transition the coding job to `failed` with a sanitized timeout reason.

Cancellation uses the same TERM-to-KILL path but resolves `cancelled` and keeps
the coding job in its existing explicit cancellation transition. Repeated
cancellation is idempotent. Spawn errors, timeout callbacks, cancellation, and
close events must not overwrite one another.

Timeout and cancellation preserve workspace, branch, output, changed files,
commit/PR fields, and audit history. They never delete a checkout or unpushed
work.

## Error Handling

| Failure                          | Job/runtime result                          | Operator-visible behavior                                  |
| -------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| Executable missing               | Runtime `missing`; dispatch blocked         | Install Devin on the NanoCrab host                         |
| Authentication absent/expired    | Runtime `unauthenticated`; dispatch blocked | Run interactive `devin auth login` as the service user     |
| Credential ownership/mode unsafe | Runtime `error`; dispatch blocked           | Correct ownership and set mode `0600`                      |
| Sandbox/capability unavailable   | Runtime `error`; dispatch blocked           | Upgrade/configure the CLI; no unsandboxed retry            |
| Git workspace preparation fails  | Coding job `failed` before Devin spawn      | Preserve metadata and sanitized Git failure                |
| Spawn fails                      | Coding job `failed`                         | Preserve checkout; report non-sensitive executable failure |
| CLI exits nonzero                | Coding job `failed`                         | Include redacted stderr tail and exit code                 |
| Runner times out                 | Coding job `failed`                         | Record explicit timeout and process escalation             |
| Owner cancels                    | Coding job `cancelled`                      | Preserve workspace and evidence                            |
| Output exceeds cap               | Continue with bounded tail                  | Record that earlier output was truncated                   |

Runner errors never trigger an unapproved CLI fallback. The control plane may
propose a fallback through its existing owner decision mechanism.

## Exact Change Surface

| Path                                     | Intended change                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/coding-runners/types.ts`            | New adapter input, output, result, and injectable transport contracts                                                    |
| `src/coding-runners/devin-host.ts`       | New host runner: arguments, strict config, environment, output, timeout, and cancellation                                |
| `src/coding-runners/process-registry.ts` | Host/container-neutral process ownership and TERM-to-KILL escalation                                                     |
| `src/coding-workspace.ts`                | Host checkout preparation with injectable Git transport and Git-only credential environment                              |
| `src/coding-jobs.ts`                     | Persist/normalize `runnerCli`, select adapter from the CLI, map terminal results, reuse diff/PR flow, route cancellation |
| `src/agent-runtime-registry.ts`          | Auth-, sandbox-, ownership-, and mode-aware Devin readiness; coding support enabled only when healthy                    |
| `src/agent-runtime-registry.test.ts`     | Readiness and privacy regression coverage                                                                                |
| `src/coding-jobs.test.ts`                | Selection, legacy normalization, state mapping, evidence, and cancellation integration coverage                          |
| `src/coding-runners/devin-host.test.ts`  | Fake process/timer/filesystem tests for the adapter                                                                      |
| `src/coding-workspace.test.ts`           | Fake Git tests for workspace and credential scoping                                                                      |
| `README.md`                              | Supported runtime and host deployment/operator summary                                                                   |
| `docs/SECURITY.md`                       | Host credential, sandbox, external-processing, environment, and residual-risk boundary                                   |
| `docs/AGENT_PROFILES.md`                 | Truthful CLI/provider/model display and readiness/fallback behavior                                                      |
| `docs/ROADMAP.md`                        | Mark Devin coding support complete only after implementation and evidence                                                |
| `.env.example`                           | Document runner timeout configuration                                                                                    |

No database migration, container image change, credential-proxy route, provider
definition, version bump, deployment, or release is part of this work.

## Test Strategy

Implementation follows TDD. Each behavior-changing step begins with a focused
failing test, verifies the expected red failure, adds the smallest production
change, and verifies green before refactoring.

### Runtime readiness tests

- version plus successful auth and sandbox checks produce `healthy`;
- failed auth produces `unauthenticated`;
- unsafe owner or any group/world permission produces `error`;
- exact mode `0600` passes;
- required capability/sandbox failure produces `error`;
- stored health detail contains no name, email, user/team ID, auth output, or
  credential value; and
- Devin changes from installed-but-unsupported to coding-supported only for a
  ready host.

### Runner unit tests

- exact executable and argument array, with `shell: false`, detached process,
  selected cwd/model/prompt/config, and no shell interpolation;
- generated scopes are read-only for planning/review and workspace-only
  read/write for implement/direct jobs;
- sensitive host paths are denied and metadata is outside the writable root;
- environment allowlist excludes representative GitHub, provider, Devin,
  channel, cookie, and proxy secrets;
- stdout/stderr ordering and attribution, redaction, and bounding;
- exit zero, nonzero, and spawn error terminal mapping;
- timeout and manual cancellation with fake timers;
- `SIGTERM` then `SIGKILL` escalation and registry cleanup;
- first-terminal-event-wins races; and
- repeated cancellation is idempotent.

### Workspace tests

- clone/fetch/checkout use argument arrays and the expected branch;
- unsafe repository/branch/path input is rejected before Git;
- the Git fake receives a token only through the Git-specific askpass
  environment;
- the Devin fake never receives that token;
- credentials are absent from remotes, generated files, output, and errors; and
- retry reuses the same preserved workspace without deleting unrelated data.

### Coding-job integration tests

- `actualRuntime.cli === 'devin'` selects the host adapter, never Docker;
- CLI/provider/model attribution survives persistence and reload;
- legacy jobs infer the same existing container executable as before;
- unsupported CLI/provider/model combinations fail before dispatch;
- approval -> implement -> test/PR approval remains intact;
- timeout maps to failed and cancellation maps to cancelled;
- cancellation preserves workspace, branch, commit, push, and PR evidence; and
- no silent fallback occurs after a runner failure.

### Repository verification

Run:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
```

Automated verification must use the repository-supported Node runtime. No test
may invoke a paid Devin model, rely on network access, or read the real
credential value. A live smoke test is skipped by default and requires a
separate explicit operator decision because it crosses the external-processing
boundary and may incur cost.

## Rollout

1. Land the adapter, readiness checks, docs, and fake-transport tests while
   leaving existing agent profiles unchanged.
2. On the target host, install a supported Devin CLI, authenticate as the
   dedicated NanoCrab service user, set the credential mode to `0600`, and
   verify the non-sensitive runtime health result.
3. Assign Devin to one planning or review profile first and exercise only a
   deliberately selected low-risk issue after owner approval.
4. Inspect output redaction, filesystem scope, timeout/cancellation, branch,
   diff, and audit evidence.
5. Assign Devin to implement work only after that operator verification.

Profile assignment is the opt-in; this slice does not add a second global
feature flag. Existing profiles and container jobs are unchanged until an
operator selects Devin.

## Rollback

Immediate operational rollback is to disable or reassign Devin profiles to an
existing runtime. Active jobs may be cancelled through the existing decision
surface; their checkouts and evidence remain available. Because no database
migration or credential rewrite occurs, rollback does not require data
conversion.

Code rollback removes the host adapter and changes the runtime definition back
to unsupported. Legacy `runnerCli` values remain harmless JSON fields and can
continue to normalize to existing container runners. Never delete Devin's host
credentials, sessions, or user configuration as part of NanoCrab rollback.

## Completion Criteria

Issue #129 is implementation-complete only when:

- every acceptance behavior above has automated fake-transport coverage;
- the full repository verification set passes;
- security and operator docs match the implemented boundary;
- the implementation branch is pushed and a ready-for-review PR targets
  `main` with red/green evidence;
- issue #129 is moved to `In review`; and
- skipped live testing and the sandbox residual risk are stated explicitly.

A green test suite is implementation evidence, not permission to run a paid
session, merge the PR, close the issue, move it to Done, release, or deploy.
