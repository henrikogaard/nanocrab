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
  attemptId: string;
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
  attemptId: string;
  state: 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  detail?: string;
}

interface CodingRunnerAdapter {
  run(input: CodingRunnerInput): Promise<CodingRunnerResult>;
  cancel(jobId: string, attemptId: string): boolean;
}
```

Process creation, Git execution, timers, signals, and relevant filesystem
queries must be injectable. Unit tests use fakes and never invoke the installed
CLI, GitHub, or Devin's network.

Existing container execution remains in `coding-jobs.ts` for this slice, while
runner resolution provides the new adapter seam. A shared process registry owns
both host and container processes. `container-runner.ts` keeps compatibility
wrapper exports so current callers and tests do not change unnecessarily.

### Execution attempts and process leases

Every invocation, including a retry of the same job, receives a fresh opaque
`attemptId`. The JSON job record persists `activeAttemptId` and an append-only
`executionAttempts` history; legacy records normalize these fields on read, so
no SQLite migration is required. An attempt records its ID, timestamps,
terminal state, and sanitized detail. A retry may begin only after the prior
attempt's terminal state has been persisted.

Attempt setup has an explicit order after approval, runtime fallback resolution,
compatibility validation, and the fail-closed readiness recheck:

1. Read and retain `priorAttempts = [...job.executionAttempts]`.
2. Compute `isFirstRun = priorAttempts.length === 0`. The attempt about to be
   created is explicitly not part of this decision.
3. Generate `attemptId`, append a `preparing` attempt, set `activeAttemptId`, and
   persist the job atomically before any workspace operation.
4. Pass the captured `isFirstRun` into workspace preparation.
5. After preparation, register the process lease and spawn. A preparation or
   spawn failure terminally updates this same persisted attempt.

Thus the first invocation is first-run even though its current attempt has been
persisted before workspace preparation; every later invocation is a retry.

The process registry entry is `{ jobId, attemptId, leaseToken, process }`.
Registration returns a unique, unguessable `leaseToken`. All output, timeout,
cancel, error, and close callbacks capture both identifiers and must verify
that the registry still contains the same `(jobId, attemptId, leaseToken)`
before mutating the job. Cleanup is compare-and-delete: it removes the entry
only when all three identifiers match. A stale callback may settle its own
adapter promise, but cannot append output, change state, cancel, or delete the
process lease for a newer attempt.

Cancellation reads the persisted `activeAttemptId` and calls
`cancel(jobId, attemptId)`. A job-ID-only cancellation API is prohibited. This
makes cancel-then-retry safe even when the old process emits delayed `error` or
`close` events after the new attempt has registered.

### Runner selection and identity

Add `runnerCli: AgentCliId` to new `CodingJob` records. It is the executable
identity and is distinct from `provider` and `model`.

For a new job:

1. If `actualRuntime` is present, set `runnerCli` to `actualRuntime.cli` and
   preserve the entire runtime selection.
2. Otherwise infer the current executable from the selected provider:
   - `claude` -> `claude`;
   - `codex` -> `codex`;
   - `opencode`, `openrouter`, `ollama`, and `openai-compatible` -> `opencode`;
   - `pi` -> `pi`; and
   - `mistral` -> `mistral`.
3. Validate that the resulting CLI has a supported execution route before the
   job becomes dispatchable: the new host adapter for Devin or the existing
   container route for Claude, Codex, OpenCode, Pi, and Mistral.

For persisted jobs without `runnerCli`, `ensureJobDefaults` applies the same
legacy inference. This is an in-memory/read-time JSON normalization; no data
rewrite or SQLite migration is required.

Legacy `pi` and `mistral` values remain truthful and dispatchable through their
existing container runner cases (`pi` and `vibe`, respectively). A new
host-native adapter is not required for either CLI. Runner resolution must
distinguish "has the new host-native adapter" from "is supported by the
existing container route" and must never reinterpret either value as a
different executable.

After provider/model fallback resolution, validate the full
`runnerCli / provider / model` triple before persisting it and again immediately
before dispatch. Compatibility is:

- `claude` CLI with the `claude` provider;
- `codex` CLI with the `codex` provider;
- `opencode` CLI with `opencode`, `openrouter`, `ollama`, or
  `openai-compatible`;
- `pi` CLI with the `pi` provider through the existing container route;
- `mistral` CLI with the `mistral` provider through the existing container
  route; and
- `devin` CLI only when the provider/model pair has an explicit Devin CLI model
  mapping described below.

Devin model compatibility is a separate allowlist from
`AGENT_PROVIDER_MODELS`. Add a typed `DEVIN_CLI_MODEL_ALIASES` configuration
whose key is `<provider>/<provider-model>` and whose value is the exact string
passed to `devin --model`. The environment representation is
`DEVIN_CLI_MODEL_ALIASES_JSON`, a JSON object of string keys and string values;
unknown providers, empty values, duplicate/conflicting keys, and non-object
input fail configuration loading. Operator entries extend but cannot silently
override built-in entries. The initial built-in mappings are deliberately narrow:

| Runtime provider/model     | Devin CLI alias   |
| -------------------------- | ----------------- |
| `claude/claude-sonnet-4-6` | `claude-sonnet-4` |
| `claude/claude-opus-4-6`   | `claude-opus-4.6` |

These two aliases are present in the installed CLI's non-network `--help`
output. Although that output also mentions shorthand `opus` and `codex`, they
are not initially enabled because neither identifies an exact provider model.
Additional mappings require explicit operator configuration and must satisfy
the same syntax/alias validation. Runtime startup/readiness runs only
`--version` and `--help` with the scrubbed environment, extracts the documented
model examples, and caches the verified alias set; it never starts a prompt,
auth model call, or paid session. Passing this non-paid check establishes CLI
alias recognition, not model entitlement. Per-job compatibility consults only
the already-validated configuration and cached set. An absent, malformed,
unrecognized, or ambiguous mapping therefore rejects the triple before the
per-job readiness check, workspace mutation, or any new Devin process.

A fallback returning only provider/model must not retain an incompatible CLI or
reuse the old Devin model alias. For Devin, the approved target provider/model
must have its own explicit `DEVIN_CLI_MODEL_ALIASES` entry; otherwise the
fallback is rejected before dispatch. For Pi and Mistral, an approved fallback
to their matching provider retains their existing container route.

The fallback decision must supply and approve a complete
`AgentRuntimeSelection`; otherwise dispatch is rejected and a new control-plane
decision is requested. `actualRuntime`, `runnerCli`, provider, and model are
updated atomically so persisted identity cannot contradict the executable.

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

Workspace preparation distinguishes first execution from retry using the
captured `isFirstRun` value from attempt setup. `isFirstRun` means no _prior_
attempts and excludes the already-persisted current attempt. When it is true and
the checkout is absent, the host helper performs clone, fetch, default-branch
reset, and job-branch creation using argument arrays and an injectable Git
transport. If a workspace unexpectedly already exists, the helper validates it
as described below or rejects it; it never deletes or resets it.

For any retry or existing checkout, the helper canonicalizes the path, rejects
symlink escape, and verifies a regular Git checkout whose credential-free
origin exactly matches the registered repository, current branch exactly
matches `job.branch`, and Git metadata is internally consistent. It records
staged, unstaged, and untracked state, then resumes in place. It must not fetch,
reset, checkout, clean, delete, or otherwise rewrite the checkout. Origin,
branch, ownership, or corruption mismatch fails before spawn. This preserves
dirty and unpushed work from a timed-out or cancelled attempt.

Every approved host Git operation that requires remote authentication uses one
shared `runApprovedHostGit` seam. This includes first-run clone/fetch and later
fetch or push operations when the existing lifecycle has separately approved
them. The seam exposes `GITHUB_TOKEN` only to that single short-lived Git child
through a mode-`0700` askpass helper and a minimal Git-specific environment,
then removes the helper. Local read/diff/commit operations receive no token.
Retries do not fetch merely because they are retries; an authenticated fetch is
allowed only when the lifecycle explicitly requests and approves it. The token
is never placed in a remote URL, `.git/config`, prompt, generated agent config,
output, general Node environment, command broker, or Devin environment.

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

The generated configuration uses this exact schema (with canonical realpaths
JSON-escaped before interpolation):

```json
{
  "system_instructions": "<stage-specific instructions>",
  "allowed_tools": ["read", "grep", "glob", "exec"],
  "permissions": {
    "allow": [
      "Read(<canonical-workspace>/**)",
      "Exec(<canonical-job-root>/.nanocrab/bin/nanocrab-job-exec)"
    ],
    "ask": [],
    "deny": [
      "Read(<canonical-job-root>/.nanocrab/**)",
      "Read(<canonical-devin-credential>)",
      "Read(<canonical-home>/.ssh/**)",
      "Read(<canonical-home>/.gnupg/**)",
      "Read(<canonical-nanocrab-config-root>/**)",
      "Write(<canonical-job-root>/.nanocrab/**)",
      "Write(<canonical-devin-credential>)",
      "Write(<canonical-home>/.ssh/**)",
      "Write(<canonical-home>/.gnupg/**)",
      "Write(<canonical-nanocrab-config-root>/**)"
    ]
  }
}
```

Implement/direct uses
`["read", "grep", "glob", "edit", "write", "exec"]` and adds only
`Write(<canonical-workspace>/**)` to `allow`. Planning/review uses the shown
read-only shape. The CLI reads its prompt/config before model tool permissions
apply; the metadata deny therefore constrains agent tools without preventing
startup. The configuration contains no MCP servers, browser, connectors,
computer-use tools, or host-control tools. Exact deep-equality fixtures, rather
than substring assertions, lock the expected schema for every stage.

The sole executable permission targets an immutable NanoCrab command broker
outside the writable repository. The broker validates an argv array, canonical
cwd, and stage, then uses `shell: false` and a scrubbed environment. Every
accepted command, including read inspections and Git, runs inside the approved
OS sandbox. Planning and review allow only:

- `pwd`, `ls`, workspace-scoped `find`, `rg`, `grep`, `cat`, `head`, `tail`,
  `wc`, `file`, and `stat`; and
- Git read operations: `status`, `diff`, `log`, `show`, `ls-files`,
  `branch --show-current`, and `rev-parse`.

Implement/direct additionally allow dependency-free build/test commands:
`npm test`, approved `npm run <manifest-script>`, corresponding
`pnpm`/`yarn`/`bun` test or run commands, `cargo test|check|build`,
`go test|build|vet`, `pytest`, and `python -m pytest`. Manifest scripts whose
names indicate install, publish, release, or deploy are denied. Dependencies
must be prepared before the model starts.

All other commands are denied, including Git mutation (`commit`, `push`,
`tag`, `reset`, `checkout`, `switch`, `rebase`, `merge`, `clean`, `stash`,
`worktree`, `config`, or `remote`); package installation/removal/publication;
network clients (`curl`, `wget`, `ssh`, `scp`, `rsync`, `nc`, `socat`); shells;
Docker/Podman/Kubernetes/infrastructure tools; privilege/service managers;
destructive file commands and in-place editors; and direct interpreters other
than the exact pytest form. File changes use the scoped edit/write tools.
Broker-injected Git reads use both `--no-optional-locks` and
`GIT_OPTIONAL_LOCKS=0`; user argv still cannot contain Git global options.

Repository-controlled Git configuration, filters, attributes, and package
scripts are executable attack surfaces, so every brokered command executes in
an OS process sandbox with workspace-only filesystem access and no network
namespace. The broker receives immutable canonical protected paths and
an explicit list of canonical trusted runtime read roots. It rejects missing,
noncanonical, duplicate, or protected/runtime-overlapping roots before spawn.
Linux starts from an empty `bwrap` root, exposes only the trusted runtime roots
read-only, and always uses `--unshare-net`, `--unshare-pid`, `--unshare-ipc`,
`--new-session`, and `--die-with-parent` before mounting a private `/proc`.
Inspection and Git commands bind the workspace read-only; only approved
implement/direct build and test commands bind it writable. The temporary
directory remains writable for all commands, and host `/` is never bound.
The broker canonicalizes the temp directory once and uses that resolved path
for every command's sandbox mount/profile and child environment; it never
reuses an unverified symlink spelling after validation.
macOS allows reads only from the explicit runtime roots, workspace, and
temporary directory, denies network, allows temp writes for every command, and
allows workspace writes only for approved implement/direct build and test
commands; it must not use a global `allow file-read*`. The service home, Devin
credential, NanoCrab configuration, and job metadata therefore remain
unavailable to brokered subprocesses. Trusted executable directories below the
service home may be exposed individually, but exposing the home itself or a
root overlapping a protected path is denied. If the required platform
primitive or isolation inputs are absent, readiness fails closed. A repository
whose command needs network or an unlisted host path fails with an
operator-visible restriction; issue #129 adds no bypass.

The mode-`0555` broker launcher uses a canonical Node executable validated by
readiness and rechecked as a descendant of an approved runtime read root. It
embeds that absolute executable directly in the shebang; `/usr/bin/env`, ambient
`PATH` lookup, and repository-controlled runtimes are not permitted.

Permission policy by stage:

| Stage             | Read                      | Write                     | Commands                                                     |
| ----------------- | ------------------------- | ------------------------- | ------------------------------------------------------------ |
| Planning          | Repository workspace only | None                      | Scoped repository inspection commands                        |
| Implement         | Repository workspace only | Repository workspace only | Repository build/test/edit commands inside the sandbox       |
| Review            | Repository workspace only | None                      | Scoped diff, inspection, and read-only verification commands |
| Direct legacy job | Repository workspace only | Repository workspace only | Same as Implement after the existing implementation approval |

Sensitive paths are explicitly denied at the tool layer and omitted from the
subprocess filesystem view as defense in depth, including the
Devin credential, `.ssh`, `.gnupg`, NanoCrab `.env`, channel authentication,
mount allowlists, job metadata, service home, and host credential/config
directories. The explicit sandbox roots are authoritative for subprocesses;
sensitive-path deny strings must not be used as a substitute for OS isolation.

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

A Devin host runtime probe may inspect non-secret installation metadata, but the
coding runner is not enabled in this slice. Because the empty-root sandbox has
no safe authentication handoff, coding readiness is always unavailable with
the exact detail `Sandboxed Devin authentication handoff is unavailable; no
credential or host auth directory is mounted`.

If a future handoff is approved, a Devin runtime probe must require all of
these checks:

1. the allowlisted executable exists and `--version` succeeds within the probe
   timeout;
2. the installed CLI exposes the required non-interactive, prompt-file, model,
   agent-config, and sandbox capabilities;
3. the canonical credential file can be located without reading its contents;
4. the credential is a regular file owned by the NanoCrab service user;
5. its POSIX mode is exactly `0600`, with no group or world permissions;
6. sandbox prerequisites for the current platform are available; and
7. authentication is verified inside the approved sandbox handoff.

No authentication subprocess runs outside that handoff. Authentication output
may contain personal account details and must never be persisted. Until the
handoff exists, no credential or host auth directory is mounted, read, or
forwarded; dispatch fails before workspace mutation or process spawn.

Any credential with mode `0644`, including the pre-implementation state
observed during design research, fails readiness. NanoCrab reports the exact
required `0600` mode but does not modify, copy, delete, or rotate the
credential.

Every version, capability, sandbox, and authentication probe runs with the same
explicitly scrubbed host environment allowlist used by the runner. No probe
inherits `process.env`; auth probing may receive `HOME`/XDG locations but no
provider, GitHub, channel, proxy, or arbitrary `DEVIN_*` secret. Probe output is
discarded.

Runtime health is checked before dispatch and is repeated after implementation
approval and complete runtime fallback resolution, immediately before any
workspace mutation or process spawn. Any changed or unavailable result fails
closed; NanoCrab does not reuse a stale readiness result or retry with broader
permissions. Devin profile assignment and implementation dispatch remain
disabled until the authentication handoff is approved. If Devin is unavailable,
the control plane uses its existing explicit fallback decision flow; it never
silently substitutes another CLI for write-capable work.

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

Output passes through a stateful streaming redactor before persistence. Audit events record
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

The adapter creates an independent `createStreamingLogRedactor` for stdout and
stderr. It uses delimiter-aware carryover so credential-key assignments,
`Bearer` values, `sk-` tokens, and already-held known secret literals remain
recognizable when split at any chunk boundary. Relevant Git/provider/NanoCrab
secret values of at least eight characters are passed from existing in-memory
configuration; the runner must not read Devin credential contents merely to
populate the redactor. Raw carry is never persisted. Close/error flushes the
remaining carry through redaction before persistence, and the existing bounded
tail is applied only to safe output. `redactLogString` remains available for
complete strings, but per-chunk stateless redaction is prohibited here.

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

Each active runner owns one detached process group under its
`(jobId, attemptId, leaseToken)` registry lease. Exactly one terminal result may
win for that attempt. Completion clears timeout and escalation timers and uses
compare-and-delete; it cannot remove a newer attempt's entry.

Timeout flow:

1. Mark the in-memory run as timing out.
2. Send `SIGTERM` to the negative process-group PID.
3. Wait a fixed five-second grace period.
4. Send `SIGKILL` if the group remains active.
5. Resolve the adapter result as `timed_out` even if the later close event
   reports a signal or exit code.
6. Transition the coding job to `failed` with a sanitized timeout reason.

Cancellation targets the exact persisted active attempt, uses the same
TERM-to-KILL path, resolves `cancelled`, and keeps the coding job in its existing
explicit cancellation transition. Repeated cancellation of that attempt is
idempotent. Spawn errors, timeout callbacks, cancellation, and close events
must not overwrite one another, and stale events cannot mutate a retry.

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

| Path                                       | Intended change                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `src/coding-runners/types.ts`              | New adapter input, output, result, and injectable transport contracts                                                    |
| `src/coding-runners/devin-host.ts`         | New host runner: arguments, strict config, environment, output, timeout, and cancellation                                |
| `src/coding-runners/process-registry.ts`   | Attempt-aware process leases, compare-and-delete ownership, and TERM-to-KILL escalation                                  |
| `src/coding-runners/command-broker.ts`     | Exact stage command policy plus sandboxed, network-denied build/test execution                                           |
| `src/coding-workspace.ts`                  | Host checkout preparation with injectable Git transport and Git-only credential environment                              |
| `src/coding-jobs.ts`                       | Persist/normalize `runnerCli`, select adapter from the CLI, map terminal results, reuse diff/PR flow, route cancellation |
| `src/logger.ts`                            | Stateful streaming redactor with known-secret replacement and safe final flush                                           |
| `src/logger.test.ts`                       | Every-boundary split-token and known-secret streaming regression coverage                                                |
| `src/agent-runtime-registry.ts`            | Auth-, sandbox-, ownership-, and mode-aware Devin readiness; coding support enabled only when healthy                    |
| `src/agent-runtime-registry.test.ts`       | Readiness and privacy regression coverage                                                                                |
| `src/coding-jobs.test.ts`                  | Selection, legacy normalization, state mapping, evidence, and cancellation integration coverage                          |
| `src/coding-runners/devin-host.test.ts`    | Fake process/timer/filesystem tests for the adapter                                                                      |
| `src/coding-workspace.test.ts`             | Fake Git tests for workspace and credential scoping                                                                      |
| `src/admin/routes/agents.ts`               | Validate and return compatible CLI/provider/model selections and readiness                                               |
| `src/admin/public/pages/agents.js`         | Display and edit the complete runtime triple with compatibility filtering                                                |
| `src/admin/agents-ui.test.ts`              | Agent UI runtime identity, filtering, and readiness coverage                                                             |
| `src/admin/plugins/autofix/routes.ts`      | Accept, validate, persist, and expose complete runtime selections for autofix jobs                                       |
| `src/admin/plugins/autofix/routes.test.ts` | Server-side fallback and incompatible-triple rejection coverage                                                          |
| `src/admin/public/pages/autofix.js`        | Autofix selection and job cards show actual CLI/provider/model                                                           |
| `src/admin/autofix-ui.test.ts`             | Autofix UI compatibility and actual-runtime display coverage                                                             |
| `README.md`                                | Supported runtime and host deployment/operator summary                                                                   |
| `docs/SECURITY.md`                         | Host credential, sandbox, external-processing, environment, and residual-risk boundary                                   |
| `docs/AGENT_PROFILES.md`                   | Truthful CLI/provider/model display and readiness/fallback behavior                                                      |
| `docs/ROADMAP.md`                          | Mark Devin coding support complete only after implementation and evidence                                                |
| `.env.example`                             | Document runner timeout and typed Devin CLI model-alias configuration                                                    |

No database migration, container image change, credential-proxy route, provider
definition, version bump, deployment, or release is part of this work.

## Test Strategy

Implementation follows TDD. Each behavior-changing step begins with a focused
failing test, verifies the expected red failure, adds the smallest production
change, and verifies green before refactoring.

### Runtime readiness tests

- installation metadata checks never enable coding readiness by themselves;
- the current missing-auth-handoff capability produces `error` before dispatch;
- any future authentication subprocess must run only inside the approved
  sandbox handoff with the exact scrubbed allowlist and no ambient secret key;
- a healthy result before approval followed by a failed post-approval probe
  blocks workspace mutation and spawn;
- a future sandbox-contained auth failure produces `unauthenticated`;
- unsafe owner or any group/world permission produces `error`;
- exact mode `0600` passes;
- required capability/sandbox failure produces `error`;
- the scrubbed, non-network `--help` probe accepts only configured Devin model
  aliases it actually advertises and never invokes print mode or a model;
- each initial Devin mapping resolves to its exact CLI alias, while `opus`,
  `codex`, unknown aliases, and provider-catalog-only models are rejected;
- malformed alias JSON, unknown providers, conflicts, and attempts to override
  a built-in entry fail configuration loading;
- stored health detail contains no name, email, user/team ID, auth output, or
  credential value; and
- Devin changes from installed-but-unsupported to coding-supported only for a
  ready host.

### Runner unit tests

- exact executable and argument array, with `shell: false`, detached process,
  selected cwd/model/prompt/config, and no shell interpolation;
- generated agent configuration deep-equals the exact expected object for each
  stage, including canonical/escaped paths, exact tool names, empty `ask`, and
  no extra permission;
- the command broker accepts every enumerated stage command and rejects every
  denied Git, package, network, shell, infrastructure, privilege, destructive,
  and interpreter form, including argument-smuggling variants;
- build/test subprocesses receive workspace-only filesystem scope, network
  denial, `shell: false`, and the scrubbed environment; missing platform
  isolation fails before spawn;
- sensitive host paths are denied and metadata is outside the writable root;
- environment allowlist excludes representative GitHub, provider, Devin,
  channel, cookie, and proxy secrets;
- stdout/stderr ordering, attribution, and bounding after redaction;
- every recognized secret pattern and each known-secret literal split at every
  possible chunk boundary, including end-of-stream flush, persists no raw
  secret substring;
- exit zero, nonzero, and spawn error terminal mapping;
- timeout and manual cancellation with fake timers;
- `SIGTERM` then `SIGKILL` escalation and registry cleanup;
- first-terminal-event-wins races;
- compare-and-delete refuses a mismatched attempt or lease;
- stale output, close, error, and timeout callbacks cannot mutate or remove a
  newly registered retry;
- cancel followed immediately by retry signals only the exact old attempt; and
- repeated cancellation is idempotent.

### Workspace tests

- first-attempt clone/fetch/checkout use argument arrays and the expected
  branch;
- attempt setup snapshots zero prior attempts, persists the current attempt,
  and still passes `isFirstRun: true` to first workspace preparation;
- setup with one terminal prior attempt persists a new current attempt and
  passes `isFirstRun: false` without resetting the workspace;
- a valid existing retry checkout resumes with staged, unstaged, untracked, and
  unpushed work unchanged and performs no fetch/reset/checkout/clean/delete;
- an unexpected first-run checkout is validated and resumed or rejected, never
  reset;
- origin mismatch, branch mismatch, corrupt metadata, and symlink escape reject
  before spawn;
- unsafe repository/branch/path input is rejected before Git;
- clone, approved fetch, and approved push fakes receive a token only through
  the short-lived Git-specific askpass environment;
- local Git and unapproved remote operations receive no token, and retry alone
  does not trigger fetch;
- the Devin fake never receives that token;
- credentials are absent from remotes, generated files, output, and errors; and
- retry reuses the same preserved workspace without deleting unrelated data.

### Coding-job integration tests

- `actualRuntime.cli === 'devin'` selects the host adapter, never Docker;
- CLI/provider/model attribution survives persistence and reload;
- legacy jobs infer `pi -> pi` and `mistral -> mistral` as well as the existing
  Claude, Codex, and OpenCode mappings;
- legacy Pi and Mistral jobs remain dispatchable through their existing
  container `pi` and `vibe` cases, not the Devin host adapter;
- unsupported CLI/provider/model combinations fail before dispatch;
- Devin accepts only the exact initial or operator-configured verified mapping,
  passes its mapped alias to `--model`, and rejects provider-catalog membership
  alone without running a per-job Devin process;
- provider fallback cannot persist or dispatch an incompatible retained CLI;
- an explicitly approved fallback atomically replaces the complete runtime
  triple;
- agents and autofix routes reject incompatible triples server-side, while
  their UIs filter choices and display actual CLI/provider/model;
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
