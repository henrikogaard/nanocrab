# Agent Profiles

Agent Profiles are named operating identities for NanoCrab agents. A profile is
durable policy and attribution layered over the existing NanoCrab execution
paths: registered groups, web threads, scheduled tasks, coding jobs, report and
research jobs, approvals, and short-lived isolated containers.

An Agent Profile is not a long-running container or a permanently online worker.
Profiles shape how normal NanoCrab runs are started, attributed, and bounded.
Containers still start only when an existing run path needs one.

## Profile Fields

The Agents cockpit stores profile identity, model choice, and capability policy:

| Field | Meaning |
| ----- | ------- |
| `handle` | Unique mention handle, such as `RepoFixer`. Users invoke it as `@RepoFixer`. |
| `displayName` | Human-readable name shown in the roster, activity, and run attribution. |
| `personality` | Profile-level instructions added to the run context. |
| `providerProfileId` | Preferred provider profile, such as chat or coding defaults, for execution paths that consume profile preferences. |
| `provider` / `model` | Optional explicit provider/model override for this profile. |
| `toolPolicy` | Stored profile-level tool posture for operator policy and future enforcement; host policy remains the active gate unless a run path explicitly consumes it. |
| `allowedMcpServers` | MCP connector allowlist. `null` inherits the runtime boundary; an empty list means NanoCrab-only. |
| `skills` | Skill hints or allowed skill references. Runtime skill scope and visibility still apply and are not bypassed by this list. |
| `memoryScopes` | Intended memory/wiki scopes for the profile. Runtime memory injection remains controlled by existing memory and boundary logic. |
| `taskKinds` | Allowed work types, such as chat, cowork task, coding job, report, research, or scheduled check. Subscriptions and UI validation use this list. |
| `channelBindings` | Channel-specific aliases or handles when a channel needs different naming. |
| `writePolicy` | Stored write-policy intent for the profile layer. Existing host policy and approvals remain the enforced write gate. |

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

## Out Of Scope And Follow-Ons

This MVP does not include:

- A visual office control plane. A visual office can be added later as a
  read-only view of profiles, activity, and approvals.
- Slack or Discord adapters. The routing contract is channel-neutral so those
  can be added later.
- Role templates for common profile types.
- Additional subscription sources beyond the initial GitHub and channel mention
  sources.
- Long-running per-profile containers or always-on workers.
