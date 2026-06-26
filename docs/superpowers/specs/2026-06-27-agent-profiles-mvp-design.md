# Agent Profiles MVP - Design Spec

## Overview

Add first-class virtual agent profiles to NanoCrab.

The goal is to let the owner create named agents such as `ManualHost`,
`RepoFixer`, or `Researcher`, configure each agent's identity, model/provider,
skills, connectors, memory/wiki scope, and autonomous subscriptions in one
place, then invoke those agents from the web UI and currently active messaging
channels.

The MVP uses a separate durable `AgentProfile` identity layer. Profiles route
work into the execution surfaces NanoCrab already has: registered groups, web
threads, scheduled tasks, coding jobs, report/research jobs, approvals, and
isolated containers. A profile is not a permanently running process. Autonomous
behavior is implemented through explicit subscriptions that detect work and
start normal NanoCrab runs or jobs under the existing policy and approval model.

## Approved Direction

| Decision | Selected |
| --- | --- |
| First slice | Agent Profiles MVP |
| Invocation surfaces | Agents UI, Copilot/Cowork web chat, WhatsApp, Telegram, and Signal |
| Runtime identity model | Separate `AgentProfile` records |
| Autonomy level | True background subscriptions |
| First subscription model | Generic subscriptions with GitHub and channel mention sources in v1 |
| Write safety | Start investigation/planning automatically, pause before writes |
| UI location | Integrated into the existing Agents cockpit |

## Non-Goals

- Do not implement Slack or Discord adapters in this MVP. The routing contract
  should be channel-neutral so those adapters can plug in later.
- Do not build the visual office as the v1 control plane. The office view is a
  follow-on read-only visualization fed by profile and activity data.
- Do not create long-running per-profile worker containers. The host owns
  subscription scanning; containers remain short-lived execution sandboxes.
- Do not duplicate coding jobs, scheduled tasks, report jobs, or approvals.
  Existing systems gain profile attribution where needed.
- Do not allow autonomous subscriptions to bypass approval gates for code
  mutation, external sends, PR creation, uploads, connector writes, or
  write-capable provider fallback.

## Core Model

`AgentProfile` is the durable user-facing identity.

Each profile stores:

| Field | Purpose |
| --- | --- |
| `id` | Stable internal id. |
| `handle` | Unique mention handle, case-insensitive, such as `repofixer`. |
| `displayName` | Human-readable name shown in UI and run attribution. |
| `avatar` | Built-in avatar id, uploaded avatar reference, or visual-office sprite metadata. |
| `description` | Short purpose statement for the roster. |
| `personality` | Profile-level instructions appended to the run context. |
| `enabled` | Disabled profiles cannot be invoked or triggered by subscriptions. |
| `providerProfileId` | Preferred provider profile, such as `default_chat` or `default_coding`. |
| `provider` / `model` | Optional explicit provider/model override when the profile should not inherit the provider profile default. |
| `toolPolicy` | Read-only, approval-required, or allow policy for profile-launched work. |
| `allowedMcpServers` | Connector allowlist. Undefined inherits allowed connectors from the resolved runtime boundary; empty means NanoCrab-only. |
| `skills` | Optional skill hints or explicit enabled-skill references. Runtime skill routing still enforces scope and visibility. |
| `memoryScopes` | Approved memory/wiki scopes the profile may use. |
| `taskKinds` | Allowed work types, such as chat, cowork task, coding job, report, research, or scheduled check. |
| `channelBindings` | Handles or aliases per channel where needed. |
| `writePolicy` | Whether sends/writes require approval for direct and autonomous runs. |
| `createdAt` / `updatedAt` | Audit and UI sorting metadata. |

`RegisteredGroup` remains the channel/thread execution context. A profile may be
invoked from a registered group or web thread, but the group still determines
channel context, filesystem mounts, and baseline boundary behavior.

## Boundaries And Capabilities

Profile execution must continue to pass through `resolveAgentBoundary`.

The effective runtime permission is the intersection of:

1. The source group or web thread boundary.
2. The profile's configured provider/tool/connector/skill policy.
3. Host policy and approval rules.
4. The target run type, such as coding job or report job.

This means a profile can narrow a run but cannot widen an unauthorized group.
For example, a channel-scoped profile cannot receive private/system skills just
because the profile lists them, and a channel invocation cannot gain main-group
connector privileges unless the host policy explicitly allows it through the
normal boundary path.

## Direct Invocation Routing

Direct invocation is the first visible user workflow.

Supported v1 sources:

- Agents cockpit: start a run from a selected profile.
- Copilot/Cowork web chat: `@handle` resolves the target profile.
- WhatsApp, Telegram, and Signal: `@handle` inside a registered group resolves
  the target profile after the group trigger rules allow the message to be
  processed.

Routing steps:

1. Normalize mention handles case-insensitively.
2. Resolve exactly one enabled profile.
3. If no profile matches, show a visible unknown-profile response.
4. If more than one profile would match an alias, reject the invocation and ask
   for a more specific handle. The data model should enforce unique primary
   handles so ambiguity only applies to aliases.
5. Build a run request containing `agentProfileId`, source `chatJid`, source
   group folder, current project/thread context when present, requested task
   text, and detected invocation mode.
6. Start the existing run/job path with the profile's effective provider and
   capabilities.
7. Attribute the resulting session, task, coding job, report job, approval, and
   activity event to the profile.

Channel adapters should not implement profile-specific logic beyond providing
normalized message metadata. The shared router owns handle resolution.

## Autonomous Subscriptions

Autonomous agents are implemented as explicit profile subscriptions.

`AgentSubscription` stores:

| Field | Purpose |
| --- | --- |
| `id` | Stable subscription id. |
| `agentProfileId` | Owning profile. |
| `sourceType` | Source category, initially `github` or `channel_mention`. |
| `enabled` | Disabled subscriptions do not scan or match. |
| `filters` | Source-specific filter JSON. |
| `taskKind` | Run type to start when matched. |
| `autonomyMode` | V1 value: `investigate_then_pause`. |
| `dedupeKeyStrategy` | How external events become stable dedupe keys. |
| `lastSeenAt` | Latest scanned event timestamp. |
| `lastMatchedAt` | Latest event that started a run/job. |
| `lastRunId` | Latest NanoCrab run/job started by this subscription. |
| `createdAt` / `updatedAt` | Audit and UI metadata. |

### GitHub Subscription

V1 GitHub subscriptions support filters such as:

- Repository full name.
- Issue assignee.
- Labels.
- Milestone.
- Direct issue number.

Pull request review-request watching is out of scope unless the current GitHub
integration already exposes the needed data without new GitHub API plumbing.

When matched, the subscription can start a coding job in investigation/planning
mode. The coding job still uses the existing lifecycle and must stop at
implementation approval before mutating files.

### Channel Mention Subscription

V1 channel mention subscriptions support filters such as:

- Channel/group id.
- Profile handle or alias.
- Optional keyword set.
- Optional project/cowork context.

This source is for background detection of messages that target a profile. It
must not create loops from bot messages or profile-generated output. The scanner
dedupes by channel message id and ignores messages marked as bot messages.

### Dedupe And Loop Prevention

Every matched event records a stable dedupe key:

```text
<sourceType>:<sourceId>:<externalEventId>:<agentProfileId>
```

If the same key has already produced an active or completed run, the scanner
does not start another run. If a previous run failed before any useful output,
manual retry is done from the Agents cockpit.

## Execution And Safety

Autonomous work uses "start safely, pause before writes".

| Phase | Allowed automatically | Requires approval |
| --- | --- | --- |
| Detect | Match explicit subscriptions and dedupe events. | Enabling broad subscriptions or changing connector scope. |
| Investigate | Read allowed context, inspect read-only MCP tools, search web if enabled, summarize context, draft a plan. | Expanding MCP servers, accessing private/system skills from a channel-scoped profile. |
| Prepare | Draft coding plan, response, report outline, source ledger, or handoff. | Mutating files, sending external messages, opening PRs, uploads, connector writes, webhooks. |
| Execute writes | Nothing by default for autonomous runs. | Existing approvals unlock implementation, PR creation, sends, uploads, or connector writes. |

Direct mention replies can send normal read-only answers back to the invoking
channel. Autonomous subscription-triggered sends require approval by default.
The owner may later add a profile-level opt-in for safe automatic sends, but
that is not required for this MVP.

Coding subscriptions may start a coding job automatically, but implementation
and PR creation still require the existing `await_approval` and
`await_pr_approval` gates.

## Agents Cockpit UI

The existing Agents page becomes the virtual-agent control center.

V1 adds an Agent Profiles area:

- Left roster: profile avatar, display name, handle, enabled state, current
  status, active run count, blocked approval count, and latest activity.
- Right detail panel with tabs:

| Tab | Contents |
| --- | --- |
| Identity | Name, handle, avatar, description, personality, enabled/disabled. |
| Model | Provider profile, provider/model override, tool policy, fallback display. |
| Capabilities | Skills, MCP servers/connectors, memory/wiki scopes, allowed task kinds. |
| Subscriptions | GitHub/channel rules, enabled state, dedupe metadata, last match, last run. |
| Activity | Current run/job, recent detections, approval gates, latest output, session/job links. |

Existing Bot Agents, Coding Agents, Tasks, Questions, Messages, and Approvals
sections remain. Where those records are profile-attributed, they show a profile
badge and link back to the profile detail panel.

The profile UI should avoid false-empty states. Loading, unavailable data,
empty roster, disabled subscriptions, and no activity are distinct states.

## API Surface

New profile routes:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/agent-profiles` | List profiles with roster summaries. |
| `POST /api/agent-profiles` | Create a profile. |
| `GET /api/agent-profiles/:id` | Read full profile detail. |
| `PUT /api/agent-profiles/:id` | Update profile fields. |
| `POST /api/agent-profiles/:id/invoke` | Start a direct profile-attributed run from the dashboard. |
| `POST /api/agent-profiles/:id/enable` | Enable a profile. |
| `POST /api/agent-profiles/:id/disable` | Disable a profile and stop new subscription matches. |

Subscription routes:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/agent-profiles/:id/subscriptions` | List subscriptions for one profile. |
| `POST /api/agent-profiles/:id/subscriptions` | Create a subscription. |
| `PUT /api/agent-profiles/:id/subscriptions/:subscriptionId` | Update a subscription. |
| `POST /api/agent-profiles/:id/subscriptions/:subscriptionId/enable` | Enable a subscription. |
| `POST /api/agent-profiles/:id/subscriptions/:subscriptionId/disable` | Disable a subscription. |
| `GET /api/agent-profiles/:id/activity` | List recent detections, runs, approvals, and linked jobs. |

Existing routes should gain optional `agentProfileId` attribution where needed:

- Agent tasks.
- Coding jobs.
- Scheduled tasks.
- Sessions/cockpit records.
- Approvals.
- Audit events.

## Persistence

Use SQLite for profiles, subscriptions, subscription events, and profile
activity if the implementation fits the local database patterns cleanly.

Suggested tables:

- `agent_profiles`
- `agent_subscriptions`
- `agent_subscription_events`
- `agent_profile_activity`

SQLite is preferred over JSON because handles must be unique, subscriptions need
dedupe queries, activity needs sorting/filtering, and the cockpit needs joined
summaries. JSON storage is acceptable only if implementation constraints make a
smaller first step necessary, but the spec assumes SQLite.

## Failure Handling

| Failure | Behavior |
| --- | --- |
| Unknown handle | Reply visibly that no enabled profile matched. |
| Disabled profile | Do not start work; show disabled status and link to profile settings in the dashboard. |
| Invalid provider/model | Reject profile save or invocation with a specific validation error. |
| Connector unavailable | Start only if the task can proceed without the connector; otherwise create a blocked activity item. |
| Subscription scan failure | Record an activity/audit event and keep the subscription enabled for the next scan. |
| Duplicate event | Suppress run creation and update last-seen metadata. |
| Autonomous run reaches write step | Create or reuse the existing approval record and mark the profile activity as blocked on approval. |

## Verification

Focused verification targets:

| Target | Check |
| --- | --- |
| Profile CRUD | Unique handles, invalid provider/model/tool scopes rejected, disabled profiles cannot run. |
| Direct routing | `@handle` resolves exactly one profile across web and current channels; unknown handles fail visibly. |
| Subscription matching | GitHub/channel events dedupe; disabled subscriptions do not run; matched work starts only the allowed phase. |
| Safety | Autonomous coding stops before implementation approval; PR/send/write actions remain approval-gated. |
| Boundary enforcement | Profile policy cannot widen a group boundary or expose private/system skills to channel profiles. |
| UI states | Profiles, subscriptions, activity, loading, empty, blocked, and unavailable states render distinctly. |

Suggested test coverage:

- Unit tests for profile validation and handle normalization.
- Unit tests for subscription matching and dedupe keys.
- Route tests for profile and subscription CRUD.
- Integration tests around direct `@handle` invocation in web/current channel
  routing helpers.
- Coding-job test proving `agentProfileId` attribution and approval gates.
- Admin UI source tests or browser verification for the profile roster/detail
  states.

## Rollout

1. Add storage, types, validation, and route tests.
2. Add direct profile invocation from the Agents cockpit.
3. Add shared mention resolution for web and current channels.
4. Add profile attribution to existing sessions/tasks/coding jobs/approvals.
5. Add subscriptions with GitHub and channel mention sources.
6. Add Agents cockpit roster/detail UI.
7. Update README, SECURITY, and operator docs after behavior exists.

The first implementation plan should keep each step independently verifiable.
If the subscription scanner expands beyond GitHub and channel mentions, split
that expansion into a separate design.

## Follow-On Work

- Visual office read-only view backed by profile status/activity data.
- Slack and Discord channel adapters using the same profile routing contract.
- More subscription sources such as webhooks, calendar/mail connectors, report
  schedules, or project queues.
- Profile templates for common roles such as game host, repo maintainer,
  researcher, inbox triage, release manager, and document drafter.
- Profile-level auto-send policy for low-risk autonomous outputs.
