# Agent Profiles

Agent Profiles are named operating identities for NanoCrab agents. A profile is
durable policy and attribution layered over the existing NanoCrab execution
paths: registered groups, web threads, scheduled tasks, coding jobs, report and
research jobs, approvals, short-lived isolated containers, and the opt-in
host-native Devin coding runner.

An Agent Profile is not a long-running process or a permanently online worker.
Profiles shape how normal NanoCrab runs are started, attributed, and bounded.
Container-backed paths start containers only when needed; a Devin coding profile
starts an attempt-owned host process only through the approved coding-job path.

## Profile Fields

The Agents cockpit stores profile identity, model choice, and capability policy:

| Field                | Meaning                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handle`             | Unique mention handle, such as `RepoFixer`. Users invoke it as `@RepoFixer`.                                                                                           |
| `displayName`        | Human-readable name shown in the roster, activity, and run attribution.                                                                                                |
| `personality`        | Profile-level instructions added to the run context.                                                                                                                   |
| `providerProfileId`  | Preferred provider profile, such as chat or coding defaults, for execution paths that consume profile preferences.                                                     |
| `provider` / `model` | Optional explicit provider/model override for this profile.                                                                                                            |
| `toolPolicy`         | Stored profile-level tool posture for operator policy and future enforcement; host policy remains the active gate unless a run path explicitly consumes it.            |
| `allowedMcpServers`  | MCP connector allowlist. `null` inherits the runtime boundary; an empty list means NanoCrab-only.                                                                      |
| `skills`             | Skill hints or allowed skill references. Runtime skill scope and visibility still apply and are not bypassed by this list.                                             |
| `memoryScopes`       | Intended memory/wiki scopes for the profile. Runtime memory injection remains controlled by existing memory and boundary logic.                                        |
| `taskKinds`          | Allowed work types, such as chat, cowork task, coding job, report, research, or scheduled check. Subscriptions and UI validation use this list.                        |
| `channelBindings`    | Channel-specific aliases or handles when a channel needs different naming.                                                                                             |
| `writePolicy`        | Stored write-policy intent for the profile layer. Existing host policy and approvals remain the enforced write gate.                                                   |
| `instructions`       | Extra operating instructions added to the profile context.                                                                                                             |
| `primaryRuntime`     | Preferred Runner CLI, provider, and model for the profile, e.g. `{ cli: 'devin', provider: 'claude', model: 'claude-opus-4-6' }`. These are three distinct selections. |
| `fallbackRuntimes`   | Ordered list of alternate CLI/provider/model combinations to try when the primary runtime is missing or unhealthy.                                                     |
| `stageRoles`         | Which control-plane pipeline stages this profile can perform: `planning`, `implement`, and/or `review`.                                                                |
| `repositoryScopes`   | Repositories (`owner/repo`) this profile is allowed to work on. Required for control-plane pipeline assignment.                                                        |
| `maxConcurrency`     | Maximum number of simultaneous runs this profile may have. Defaults to `1`.                                                                                            |

Profiles add identity, attribution, preferences, and narrower routing choices.
They cannot widen runtime access. If a channel group cannot use a private skill,
connector, filesystem mount, provider profile, or external write path, listing
it on the profile does not grant access.

## Direct Invocation

Profiles can be invoked in two user-facing ways:

- From the **Agents** cockpit by selecting a profile and entering a prompt.
- From current web and channel surfaces by mentioning `@handle` after the group
  trigger has allowed NanoCrab to process the message.

Examples:

```text
@NanoCrab @RepoFixer investigate the flaky dashboard test and propose a plan.
@NanoCrab @ManualHost summarize this thread and keep the answer read-only.
```

The group trigger still comes first in channel chats. `@RepoFixer` and
`@ManualHost` are profile mentions, not slash commands and not Discord commands.

In this MVP slice, `POST /api/agent-profiles/:id/invoke` records manual
invocation activity for the selected enabled profile. The direct run hookup
exists separately through mention routing and the existing run/job paths.
`/invoke` itself does not bypass approvals, does not start unsafe writes, and
does not create a privileged execution path.

## Subscriptions

Profiles can also have explicit subscriptions for background detection. The MVP
subscription sources are GitHub and channel mentions.

GitHub subscriptions are for investigation and planning first. A matching issue
can start the normal coding-job lifecycle with profile attribution, but code
implementation and PR creation still stop at the existing approval gates.

Channel mention subscriptions watch for messages that target a profile. They
dedupe by source message/event id, ignore bot-generated messages, and must not
loop on NanoCrab's own output.

Subscription safety rules:

- Disabled profiles cannot be invoked or triggered by subscriptions.
- Disabled subscriptions do not scan or match.
- Duplicate external events should not start duplicate runs.
- Subscription output and jobs should show profile attribution.
- Autonomous sends and writes require approval by default.

## Approval And Safety Boundaries

The enforced runtime boundary remains:

1. The source group or web thread boundary.
2. Connector permissions and mounted runtime scopes.
3. Host policy and approval rules.
4. The run type, such as chat, coding job, report, research, or scheduled check.

Profiles participate where the specific run path consumes their fields:
enabled/disabled state, handle resolution, attribution, subscription task-kind
checks, provider/model preference, and MCP narrowing where wired. Stored fields
such as `toolPolicy`, `skills`, `memoryScopes`, and `writePolicy` are visible
operator configuration in this MVP, but they do not replace container
isolation, mount checks, connector permissions, skill visibility, provider
profile restrictions, audit logging, or approvals.

Direct read-only answers can return to the invoking channel when the source
group allows normal replies. Autonomous subscription-triggered sends, file
writes, connector writes, uploads, PR creation, external webhooks, and other
write-capable actions remain approval-gated by default.

## CLI Health And Runtime Fallback

The host probes the installed CLI tools that a profile can use (`claude`,
`codex`, `devin`, `opencode`, `pi`, `mistral`) and records each runtime's
status, executable, version, and last check. A probe may report `healthy`,
`missing`, `unsupported`, `unauthenticated`, or `error`.

When `primaryRuntime` is healthy, the control plane uses it for the matching
stage. When it is missing or fails the probe, the control plane considers the
profile's `fallbackRuntimes` in order. Read-only tasks can fall back
automatically; write-capable work such as `implement` and `review` stages
requires explicit approval before the fallback runtime is used. If no healthy
fallback is available and approved, dispatch fails with a clear runtime error.

Devin is a host-native Runner CLI, not a provider and not a container runner.
NanoCrab itself must run directly on macOS or Linux as the same dedicated OS
user that owns the authenticated Devin installation. Run interactive
`devin auth login` as that user, set the credential file to exact mode `0600`,
and configure its exact canonical absolute path as `DEVIN_CREDENTIAL_PATH`.
NanoCrab does not guess the path, manage the credential, or read its contents.

Runner CLI, provider, and model remain distinct throughout selection,
attribution, and fallback. The mapped example
`devin / claude / claude-opus-4-6` resolves to the Devin CLI alias
`claude-opus-4.6`. Operator extensions are configured through
`DEVIN_CLI_MODEL_ALIASES_JSON`; built-in mappings cannot be overridden.

Assign Devin profiles deliberately. Start with planning/review, then select one
low-risk issue for implementation only after owner approval. The readiness
probe must be `healthy` when the profile or Autofix project is assigned, and it
is repeated after approval immediately before checkout creation or mutation.
For coding jobs, NanoCrab does not silently fall back from an explicitly
selected runtime. The Approvals UI requires the owner to select a healthy,
complete replacement Runner CLI / Provider / Model triple before dispatch can
resume.

Devin sends the prompt, selected repository content, and tool results to
Devin's external service. Live smoke testing is not part of repository
verification and requires Henrik's separate approval for cost and external
processing.

## Stage Roles

Control-plane pipelines move an issue through `planning`, `implement`, and
`review` stages. An agent profile can be assigned to one or more stages through
`stageRoles`:

- `planning` — read-only investigation and plan artifact generation.
- `implement` — writes commits, runs tests, pushes a branch, and opens a PR.
- `review` — reviews the PR or branch and produces a review artifact.

The same profile cannot be both `implement` and `review` for the same pipeline.
Profiles must also include the pipeline's `repositoryScopes` to be assigned to a
stage.

## Disable And Recovery

Disabling a profile prevents new direct invocations and new subscription
matches. It does not rewrite historical activity or automatically delete
existing jobs, approvals, or artifacts that were already created.

When a profile does not run:

1. Check that the profile is enabled in **Agents**.
2. Check that the subscription is enabled, if this was subscription-triggered.
3. Confirm the mention uses the group trigger first, then the profile handle.
4. Confirm the profile allows the requested `taskKind`.
5. Review recent profile activity for blocked, duplicate, or disabled records.
6. Review **Approvals** for paused implementation, sends, PR creation, uploads,
   connector writes, or provider fallback.
7. Check the source group boundary, MCP connector permissions, provider profile,
   and host policy if the profile is missing tools or context.

To recover, re-enable the profile or subscription, narrow overly broad filters,
fix the provider/model or connector policy, and retry from the Agents cockpit or
the original channel. Failed subscription matches should be retried manually
rather than replaying duplicate external events blindly.

For a Devin-specific rollback, disable or reassign the affected profiles,
cancel each exact active attempt, preserve the checkout and captured evidence,
and revert the host adapter/readiness support. Never delete Devin authentication
or sessions as part of NanoCrab rollback.

## Out Of Scope And Follow-Ons

This MVP does not include:

- A visual office control plane. A visual office can be added later as a
  read-only view of profiles, activity, and approvals.
- Additional Slack or Discord-specific profile routing beyond the shared channel
  contract. The base Slack and Discord channel adapters use the same mention and
  approval boundaries as other channels.
- Role templates for common profile types.
- Additional subscription sources beyond the initial GitHub and channel mention
  sources.
- Long-running per-profile containers or always-on workers.
