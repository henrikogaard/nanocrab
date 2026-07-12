# AI Coding Control Plane - Design Spec

## Overview

Add a web-based control plane that coordinates coding agents through GitHub
issues and GitHub Projects v2. The owner creates named agent profiles, assigns a
different profile to each delivery stage, follows work from the NanoCrab board,
and approves every proposed swimlane transition from the web UI or a supported
bot channel.

The first slice is one complete `Planning -> Implement -> Review` workflow. It
reuses NanoCrab's existing Agent Profiles, provider routing, coding jobs,
approvals, channel adapters, and audit trail. GitHub Projects remains the source
of truth for issue workflow state.

## Goals

- Create and manage agents with distinct instructions, personality, CLI,
  provider/model, optional fallbacks, capabilities, and stage roles.
- Connect a GitHub Project and map a Projects v2 single-select field to
  NanoCrab stages.
- Assign a different agent profile to Planning, Implement, and Review.
- Make the current agent, CLI, model, run, decision, checks, branch, and PR easy
  to see.
- Require a recorded owner decision before NanoCrab changes a GitHub swimlane.
- Expose status, follow-up, approval, revision, reassignment, pause, and cancel
  through the web UI and WhatsApp, Discord, Slack, Signal, and Telegram.
- Run implementation and review work in isolated managed worktrees, with a
  pushed branch and PR required before Review.

## Non-Goals For The First Slice

- Multiple GitHub Projects in one dashboard.
- Arbitrary visual workflow builders or branching pipelines.
- Automatic load balancing, cost optimization, or agent bidding.
- Unattended merges, issue closure, releases, or deployment.
- Silently switching a write-capable run to another CLI or model.
- Replacing GitHub Projects with a NanoCrab-owned issue state database.
- Long-running per-agent containers.

## Approved Product Decisions

| Decision | Selected direction |
| --- | --- |
| Workflow source of truth | GitHub Projects v2 single-select field |
| Assignment model | Separate agent assignment per stage |
| Transition policy | Hybrid: agent proposes, owner decides |
| Runtime selection | Visible primary CLI/model with optional ordered fallbacks |
| Fallback safety | Approval required before write-capable work continues on fallback |
| First delivery | One vertical `Planning -> Implement -> Review` slice |
| Operator surfaces | Web plus WhatsApp, Discord, Slack, Signal, and Telegram |
| Implementation isolation | Managed worktree per implementation or review run |
| Delivery evidence | Pushed branch and PR required before entering Review |

## Architecture

The control plane is a thin orchestration layer over existing NanoCrab systems.
It coordinates identity, GitHub workflow state, execution, decisions, and
operator surfaces without duplicating those systems.

### Agent Profiles

`AgentProfile` remains the durable identity for a named agent. The control-plane
slice makes the coding-runtime fields explicit and enforceable:

| Field | Purpose |
| --- | --- |
| `displayName` / `handle` | Stable visible identity and channel reference |
| `description` | Short role summary |
| `personality` | Voice, collaboration style, and behavioral posture |
| `instructions` | Stage execution rules and durable operating constraints |
| `primaryCli` | Exact CLI runtime, such as Claude, Codex, Pi, OpenCode, Devin, or Mistral |
| `provider` / `model` | Visible primary provider and model selection |
| `fallbacks` | Ordered CLI/provider/model alternatives, each explicitly displayed |
| `stageRoles` | Allowed roles, initially `planning`, `implement`, and `review` |
| `skills` / `allowedMcpServers` | Existing bounded capability configuration |
| `writePolicy` | Approval and mutation posture, intersected with host policy |
| `repositoryScopes` | Repositories the profile may operate on |
| `maxConcurrency` | Maximum concurrent runs for this profile |
| `enabled` | Disabled profiles cannot receive new assignments |

Profiles narrow existing host and source boundaries; they never expand them.
The profile detail view must distinguish configured policy from policy that is
actively enforced by a specific run path.

### Delivery Pipelines

A `DeliveryPipeline` binds one GitHub Project to NanoCrab:

| Field | Purpose |
| --- | --- |
| `githubOwner` | User or organization that owns the Project |
| `githubProjectNumber` | Projects v2 project number |
| `repositoryScopes` | Repositories whose issues may be dispatched |
| `workflowFieldId` | Authoritative single-select Project field |
| `enabled` | Pauses synchronization and dispatch when false |
| `syncCursor` / `lastSyncedAt` | Incremental synchronization bookkeeping |

Each `PipelineStage` maps one GitHub field option to an execution contract:

| Field | Purpose |
| --- | --- |
| `pipelineId` | Owning pipeline |
| `githubFieldOptionId` | Stable GitHub option id, not the display label |
| `stageKind` | `planning`, `implement`, or `review` |
| `agentProfileId` | Default agent assigned to the stage |
| `requiredEvidence` | Structured checks required before proposing completion |
| `nextStageId` | Next stage for the first linear workflow |

The first slice supports exactly one stage of each kind and a linear sequence.
Renaming a GitHub field option does not break the mapping because NanoCrab
stores option ids. Removing a mapped option disables dispatch and creates an
operator-visible configuration error.

### Runs And Worktrees

Existing coding jobs remain the execution engine and gain explicit pipeline,
stage, assignment, and decision attribution. Each implementation and review run
records:

- issue and Project item ids;
- pipeline, stage, and agent profile ids;
- actual CLI, provider, and model;
- fallback decision, when applicable;
- worktree, branch, commit, and PR;
- status, logs, artifacts, verification evidence, and timestamps;
- the GitHub field revision observed at dispatch.

Implementation and review use separate managed worktrees. Planning may use a
read-only repository checkout when repository inspection is needed. A run never
switches CLI/model silently. An unavailable primary runtime creates a decision
request before a fallback can continue write-capable work.

### Decision Gates

Every agent-completed stage creates a `DecisionGate`; completion alone never
mutates the GitHub workflow field. A decision contains:

- current stage and synchronized GitHub state;
- structured completion summary and evidence;
- proposed next stage and assigned next agent, CLI, and model;
- decision type and available actions;
- operator identity, source channel, timestamps, and audit references.

Supported actions are:

- **Approve:** update GitHub and dispatch the next stage.
- **Reject:** keep the issue in its current stage and end the proposal.
- **Revise:** keep the issue in its current stage and resume it with feedback.
- **Reassign:** change the assignment for this issue and stage, then dispatch or
  resume only after confirmation.

Decision processing is idempotent. Only one terminal action may win. Stale
decisions are rejected after NanoCrab refreshes the Project item.

## Source Of Truth And Synchronization

GitHub Projects v2 owns the workflow value. NanoCrab stores configuration,
runs, decisions, audit history, and a synchronized snapshot for display and
conflict detection.

Synchronization rules:

1. Fetch the Project, selected workflow field, field options, and eligible
   issue items.
2. Update NanoCrab's display snapshot without treating it as authoritative.
3. Dispatch only when the mapped GitHub option, issue assignment, pipeline
   state, and idempotency key permit it.
4. Before an approved transition, refresh the Project item and compare the
   observed field revision/value.
5. If GitHub changed since the proposal, stop, invalidate the decision, and
   show the new state. Never overwrite a newer human transition blindly.
6. Write the new Project field option, verify the mutation by reading it back,
   then dispatch the next stage.

The dispatch key is derived from pipeline, Project item, issue, stage, effective
assignment, and observed GitHub field revision. Repeated webhooks, polling, or
channel commands cannot start a duplicate run for the same revision.

## Execution Flow

1. The owner connects a GitHub Project, selects its workflow field, maps
   Planning, Implement, and Review, and assigns an agent to each stage.
2. An issue moved into Planning becomes dispatchable to the configured planner.
3. The planner produces a structured plan package and proposes Implement.
4. NanoCrab creates a decision visible in the web inbox and configured bot
   channels.
5. Approval updates the GitHub Project field and dispatches the implementer.
   Rejection leaves the stage unchanged. Revision resumes Planning with the
   owner's feedback. Reassignment changes the issue-specific stage assignment.
6. The implementer works in a dedicated worktree and produces focused test
   evidence, a pushed branch, and a PR.
7. Only then may the implementer propose Review.
8. Approval moves the GitHub item to Review and dispatches a different reviewer
   profile.
9. The reviewer reads the issue, approved plan, diff, checks, and PR state, then
   submits findings and a recommended outcome through another decision gate.

The first slice stops at the Review decision outcome. Automated merge, Done
transition, issue closure, release, and deployment remain outside scope.

## Web UI

Add a Control Plane surface with six sections.

### Overview And Board

Show the synchronized GitHub Project as swimlanes. Each issue card displays:

- issue number, title, and repository;
- current stage and run state;
- current agent identity;
- actual CLI, provider, and model;
- pending decision or blocked fallback;
- branch, PR, and verification summary when present.

Loading, sync failure, configuration error, empty Project, idle issue, active
run, blocked decision, and stale GitHub state are distinct UI states.

### Agents

Create, edit, clone, disable, and test profiles. The editor groups fields into
Identity, Instructions, Runtime, Capabilities, Scope, and Safety. Runtime health
tests show whether each configured CLI exists, is authenticated, supports the
selected model, and is currently usable. Saving an unavailable CLI is allowed
only with a visible warning; dispatch remains blocked or fallback-gated.

### Pipelines

Connect one GitHub Project, select its workflow field, map the three stages,
assign agents, configure required evidence, validate repository scopes, and
test read/write access. The UI shows field option ids and labels so renamed or
deleted options can be diagnosed.

### Runs

Show live and historical runs with issue, stage, agent, runtime, worktree,
branch, logs, artifacts, checks, fallback events, PR, and follow-up controls.

### Decisions

Provide a single inbox for stage transitions, CLI/model fallback, and existing
write approvals. Each card shows the proposal, evidence, current and proposed
stage, current and next agent/runtime, freshness, and the four supported
actions.

### Settings

Manage CLI discovery and health probes, GitHub Project access, channel targets,
concurrency defaults, synchronization interval, and audit retention.

## Bot Channel Control

WhatsApp, Discord, Slack, Signal, and Telegram must use one shared control-plane
command service. Channel adapters only normalize sender, conversation, reply,
and authorization metadata. They do not implement workflow rules.

The shared service supports natural language and explicit commands equivalent
to:

```text
status #128
show plan #128
show decision #128
approve #128 to implement
reject #128: acceptance criteria are incomplete
revise #128: add migration rollback tests
reassign #128 implement to @Forge
pause #128
cancel #128
```

Every mutating channel command requires an authorized operator identity and an
exact pending issue/decision match. Ambiguous repository or issue references,
stale decisions, unauthorized senders, and unsupported actions return a safe
status response without mutation. Web and channel actions use the same service,
authorization, idempotency, and audit paths.

Decision notifications include issue, stage, summary, evidence link, proposed
next stage, next agent, CLI/model, and an expiry/freshness indicator. Channels
that support buttons may render actions, but text commands remain the portable
contract.

## Safety And Failure Handling

- Profiles and pipelines cannot widen repository, connector, skill, or host
  permissions.
- CLI discovery uses an allowlisted adapter registry; arbitrary executable
  paths or shell fragments are not accepted as profile configuration.
- Credentials remain outside agent containers and worktrees.
- Primary runtime failure produces a visible blocked state. Write-capable
  fallback requires approval and records the actual runtime.
- GitHub permission or rate-limit failure preserves the current stage and
  retries read-only synchronization with bounded backoff.
- GitHub conflict invalidates the pending transition instead of overwriting it.
- A reviewer cannot approve its own implementation when the same profile ran
  the Implement stage. Pipeline validation rejects identical Implement and
  Review profiles in the first slice.
- Cancellation terminates the process group safely and preserves logs,
  worktree, branch, and audit evidence until explicit cleanup.
- Worktree cleanup is never automatic while a run is active, a decision is
  pending, a branch is unpushed, or a PR is open.
- Channel replies never expose raw credentials, full environment dumps, or
  unredacted command output.

## Persistence And API Boundaries

Use SQLite and existing migration patterns for pipeline configuration,
issue-specific assignments, synchronized snapshots, runs, and decisions.
Agent Profile schema changes should extend the existing profile tables rather
than introduce a second identity store.

Suggested service boundaries:

- `AgentRuntimeRegistry`: allowlisted CLI adapters, discovery, health, model
  validation, and invocation contracts.
- `GitHubProjectSyncService`: Project metadata, item snapshots, field mutation,
  read-back verification, and conflicts.
- `DeliveryPipelineService`: stage mappings, assignment resolution, validation,
  and dispatch idempotency.
- `DecisionService`: proposal creation, authorization, terminal action,
  revision/reassignment feedback, and audit.
- `ControlPlaneCommandService`: shared read and mutation commands for web and
  all bot channels.

HTTP routes should remain thin adapters over these services. The exact endpoint
shape belongs in the implementation plan, but the web and channel paths must
not duplicate transition logic.

## Verification

Automated verification must cover:

- Agent Profile persistence, validation, CLI adapter allowlisting, runtime
  health states, and fallback ordering.
- Pipeline persistence, field-option mapping, deleted/renamed options,
  repository scope, and distinct Implement/Review agents.
- GitHub synchronization, field mutation read-back, permission failures,
  revision conflicts, polling/webhook dedupe, and dispatch idempotency.
- Decision authorization, freshness, concurrent actions, approve/reject/revise/
  reassign behavior, and audit records.
- Worktree isolation, branch naming, focused verification evidence, push/PR
  requirements, cancellation preservation, and cleanup guards.
- Shared command parsing and behavior parity for web, WhatsApp, Discord, Slack,
  Signal, and Telegram.
- An integration flow from Planning through Implement to Review using separate
  agent profiles and simulated GitHub Project mutations.

Manual verification must cover:

- Creating and testing agents in the web UI.
- Connecting a GitHub Project and mapping all three stages.
- Seeing agent, CLI, model, decisions, branch, PR, and checks on the board.
- Approving, rejecting, revising, and reassigning from the Decisions UI.
- Performing equivalent authorized follow-up and decision actions from all five
  requested bot channels.
- Running a real isolated implementation worktree through a pushed branch and
  PR before Review becomes available.

## Delivery Constraints

Implementation must be performed by subagents in an isolated worktree. It must
use test-driven development for behavior changes, preserve unrelated work, and
finish with focused verification, a named committed branch, a push, and a PR to
the repository's integration branch. The PR description must link the tracking
issue and include verification evidence and residual risks.

Because this first slice crosses persistence, GitHub synchronization, runtime
adapters, orchestration, web UI, and five channel surfaces, the tracking issue
should be treated as an epic and decomposed into dependency-ordered child
issues or reviewable PR slices during implementation. The first PR should
establish the durable domain/service contracts and migrations; later slices
can add GitHub synchronization, decision dispatch, UI, and channel parity
without creating a single unreviewable branch.

## Acceptance Criteria

1. An operator can create and edit an agent with instructions, personality,
   primary CLI/model, optional ordered fallbacks, stage roles, and bounded
   capabilities.
2. NanoCrab discovers configured allowlisted CLIs and shows their health and
   effective model without silently substituting runtimes.
3. An operator can connect one GitHub Project, select a single-select workflow
   field, and map Planning, Implement, and Review to different agents.
4. The board shows GitHub issues in their authoritative swimlanes with the
   current agent, actual CLI/model, run, decision, checks, branch, and PR.
5. A completed agent stage creates a decision proposal and cannot mutate the
   GitHub workflow field by itself.
6. An authorized operator can approve, reject, revise, or reassign through the
   web UI or any requested bot channel, using the same service and audit path.
7. Approval refreshes GitHub state, rejects conflicts, writes the new field
   option, verifies the mutation, and only then dispatches the next stage.
8. Implementation and review use isolated managed worktrees and separate agent
   profiles. Review is unavailable until the implementation branch is pushed
   and a PR exists.
9. Unavailable primary runtimes block safely; an ordered fallback can continue
   write-capable work only after explicit approval and remains visibly
   attributed.
10. Duplicate GitHub events, sync polls, button clicks, and channel messages do
    not create duplicate runs or decisions.
11. Automated tests cover the domain, GitHub, decision, runtime, worktree, and
    channel contracts, and manual QA verifies the complete vertical slice.

## Done Means

The vertical slice is complete only when a real issue can traverse Planning,
Implement, and Review on a real GitHub Project; each stage uses its configured
agent/runtime; every transition is decision-gated; implementation produces a
pushed PR from an isolated worktree; web and all five requested bot channels
can inspect and control the same state; focused automated tests pass; browser
and channel QA evidence is recorded; and the implementation PR is ready for
review with the tracking issue linked.
