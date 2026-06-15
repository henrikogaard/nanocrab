# NanoCrab User Guide

Last updated: 2026-06-15

Applies to: NanoCrab 2.0-RC3

This guide is for the person operating NanoCrab day to day. It focuses on the
web UI, messaging workflow, coding agents, scheduled routines, approvals, and
maintenance tasks.

## Core Ideas

- **Main group**: your trusted owner/control chat. It can register groups,
  manage scheduled tasks, approve risky actions, and start coding jobs.
- **Channel groups**: normal WhatsApp, Telegram, Signal, or dashboard chats.
  They can ask NanoCrab for help in their own context but cannot manage other
  groups.
- **Dashboard**: the owner UI for setup, approvals, coding jobs, routines,
  memory, monitoring, backups, and plugins.
- **Approvals**: risky actions pause until you approve them. This includes repo
  changes, PR creation, external delivery, provider fallback for write-capable
  work, publishing, uploads, and some connector actions.
- **Runtime state**: local data such as messages, sessions, memories, backups,
  and generated files lives under `store/`, `data/`, `groups/`, and runtime
  config paths. Personal runtime memory files are gitignored.

## Dashboard Map

| Page | Use It For |
| ---- | ---------- |
| Dashboard | Live service overview, recent messages, weather, and channel health. |
| Agents | Assign one-off coding work, pick GitHub issues, configure Autofix pickup, and inspect agent runs. |
| Tasks | Create routines, scheduled tasks, webhook deliveries, heartbeat checks, and run-now jobs. |
| Approvals | Review, approve, deny, filter, or audit risky actions. |
| Messages | Search, filter, and export conversation history. |
| Groups | Register groups, review channel settings, and manage provider overrides. |
| Memory | Review proposed memories, approved shared context, journal entries, wiki pages, and skill activity. |
| Integrations | Configure providers, connectors, MCP presets, GitHub, and external service readiness. |
| Monitoring | Check inference health, containers, model probes, uptime, and production diagnostics. |
| Security | Review audit data, policy decisions, tokens, sessions, and safety controls. |
| Settings | Configure admin auth, 2FA, assistant profile, provider defaults, themes, plugins, and backups. |
| Marketplace | Install optional plugins or keep personal plugins local. |

## First Run

1. Install dependencies and build the host app:

   ```bash
   npm install
   npm run build
   ./container/build.sh
   ```

2. Run the setup preflight:

   ```bash
   npm run setup -- --dry-run
   ```

3. Configure the admin dashboard:

   ```bash
   npx tsx setup/index.ts --step admin -- \
     --username youruser \
     --password yourpass \
     --domain yourdomain.com \
     --port 9743
   ```

4. Configure at least one provider in **Settings -> Agent Provider** or with
   the setup CLI:

   ```bash
   npx tsx setup/index.ts --step provider -- --provider=codex --model=gpt-5.4
   ```

5. Configure a channel such as Telegram, WhatsApp, or Signal. Use
   **Settings -> First-Run Preflight** to confirm that credentials, ports,
   runtime directories, provider checks, and channel checks are ready.

6. Open the dashboard, set up 2FA, and send a test message from the main group.

## Messaging Workflow

Most requests are natural language. In channel groups, address the assistant
with the configured trigger, for example:

```text
@NanoCrab summarize today's conversation.
@NanoCrab remember that short weekly updates are preferred here.
@NanoCrab create a scheduled task to check this group every weekday morning.
```

The main group can do more:

```text
@NanoCrab register henrikogaard/nanocrab as a coding repo.
@NanoCrab pick an autofix issue and prepare a PR.
@NanoCrab show pending approvals.
@NanoCrab create a daily briefing for the operations group.
```

Hard-coded slash commands are reserved for host-level actions and mobile coding
control. See [COMMANDS.md](COMMANDS.md) for the full command reference.

## Assigning Coding Work

Use **Agents -> Assign Work** when you want NanoCrab to work on code.

### One-Off Task

1. Open **Agents -> Assign Work**.
2. Choose the repo.
3. Describe the change in plain language.
4. Choose provider/model if the default is not right for the job.
5. Start the job.
6. Review the investigation plan.
7. Approve implementation only after the plan makes sense.
8. Review changed files, diffs, logs, and test output.
9. Approve PR creation when the result is ready.

### GitHub Issue Pickup

1. Register the repo in **Agents -> GitHub Coding Jobs** or ask the main group
   to register it.
2. Configure labels, assignee, milestone, and max active jobs if needed.
3. Use **Pick Issue** to select the next matching GitHub issue.
4. Review the selected issue before starting the coding job.

### Autofix Auto-Pickup

Use **Autofix** when you want NanoCrab to watch GitHub issues automatically.

1. Enable the Autofix plugin in **Settings -> Plugins** if needed.
2. Add a project and repo.
3. Set the label filter, usually `autofix`.
4. Set pickup cadence and max active jobs.
5. Confirm PR behavior.
6. Check the webhook receiver URL and connector health.
7. Keep implementation and PR publishing approval-gated unless the repo is
   intentionally trusted for unattended changes.

### Mobile Coding Commands

From the main group:

```text
/code repos
/code start owner/repo describe the change --pr
/code pick owner/repo --labels=bug,autofix --pr
/code status
/code approve jobId
/code open-pr jobId
/code cancel jobId
```

Dashboard and chat commands drive the same host-managed coding-job lifecycle.
The agent container works in an isolated job workspace under
`data/coding-workspaces/jobs/`.

## Routines And Scheduled Tasks

Use **Tasks** when you want NanoCrab to run later or repeatedly.

### Create From A Blueprint

1. Open **Tasks**.
2. Choose a blueprint such as daily briefing, issue triage, PR digest,
   dependency update check, flaky-test tracker, release notes drafter, webhook
   notifier, or system health check.
3. Confirm the prompt and target group.
4. Choose the schedule.
5. Choose provider/profile/model if needed.
6. Choose delivery mode.
7. Save, then use **Run now** for a dry check.

### Draft From Natural Language

Use the freeform routine prompt when the blueprint is close but not exact:

```text
Summarize open PRs every weekday morning, include blocked reviews, and keep the
result dashboard-only unless I approve chat delivery.
```

The draft should show:

- What the routine will do.
- When it will run.
- Where results will go.
- Whether it needs approvals.
- Which provider/profile/model it will use.
- Safety limits such as max runtime and max active runs.

### Schedule Types

| Type | Best For |
| ---- | -------- |
| Cron | Weekday or calendar-like schedules, such as every weekday at 09:00. |
| Interval | Repeating checks, such as every 30 minutes. |
| One-time | Reminders, one-off reports, or delayed follow-up work. |

### Delivery Modes

| Mode | Behavior |
| ---- | -------- |
| Dashboard | Store output in the task run history only. Good default for noisy jobs. |
| Chat | Send the result to the target group. Use approvals for sensitive outputs. |
| File | Write reviewable output under `store/task-deliveries/`. |
| Webhook | Create an approval-gated delivery request before calling an external URL. |

### Safety Controls

- **Silent marker**: prevent routine noise unless there is something important.
- **Named session**: keep continuity across related runs.
- **Heartbeat checks**: run scripts or checks and report stale/failed states.
- **Quiet hours**: avoid routine notifications during off-hours.
- **Max runtime**: stop long-running tasks.
- **Max active runs**: prevent overlapping jobs.
- **Chained context**: let a routine use recent output from other task IDs.
- **Tool policy**: use dry-run or approval-required policies for sensitive work.

### Good Starter Routines

- Daily owner briefing from journal, messages, and pending approvals.
- Weekday GitHub issue triage for repos labeled `autofix`.
- PR review digest with blocked reviews and CI status.
- Dependency update check with security-only escalation.
- Release notes draft when PRs merge.
- Flaky test tracker from recent CI runs.
- Inbox or calendar triage once the relevant connector is configured.

## Approvals

Approvals appear in **Approvals** and sometimes inline on the related page.

Review these fields before approving:

- **Action**: what NanoCrab wants to do.
- **Requester/source**: which agent, routine, job, or connector requested it.
- **Resource**: repo, PR, file, webhook, provider, or channel target.
- **Preview**: diff, message, payload, or delivery summary.
- **Risk**: why the host policy flagged it.
- **Expiry**: stale approvals expire and cannot be approved later.

Prefer deny/retry when a preview is vague, the target is wrong, or the result
would publish externally before you have reviewed it.

## Memory, Journal, And Skills

Use **Memory** to control what NanoCrab learns.

- **Memory proposals** are inactive until approved.
- **Approved memories** can be rendered into runtime `MEMORY.md` context for
  agents and scheduled tasks.
- **Journal events** answer "when did that happen?" questions with citations.
- **Skill drafts** let agents propose reusable workflows as `SKILL.md`
  packages. Review the diff before approval.
- **Skill registry** controls enabled state, scope, visibility, trigger hints,
  and risk level.

Good practice:

- Approve durable preferences and facts.
- Reject casual guesses, secrets, or temporary details.
- Mark stale or contradicted memories instead of deleting history blindly.
- Keep private/system skills scoped away from normal channel agents.

## Reports, Research, And Artifacts

Use Report Studio or natural language requests when you need a document.

Typical flow:

1. Request a report with topic, sources, and output formats.
2. Review and approve the outline.
3. Let NanoCrab draft the document.
4. Review Markdown/HTML/DOCX/PDF outputs.
5. Approve delivery or publishing only after reviewing the artifact.

Generated artifacts should keep citations, source links, and provenance where
possible. External uploads, shares, and messages remain approval-gated.

## Backups And Updates

### Backups

Use **Settings -> Backups** before risky changes, upgrades, or migration work.

- Essential backups cover core runtime state.
- Full backups include more generated/runtime material.
- Encrypted archives use AES-256-GCM with a passphrase.
- Keep backups off the same host when preparing for deployment.

### Updates

From the main group:

```text
/update-nanocrab
```

From the host:

```bash
npm run update:nanocrab
```

The updater expects a clean worktree. For release checks, run:

```bash
npm run typecheck
npm run build
npm test
npm run mock:admin:build
```

## Troubleshooting

| Symptom | First Place To Check |
| ------- | -------------------- |
| Dashboard does not load | `npm run setup -- --dry-run`, service logs, reverse proxy config, firewall. |
| Provider fails | **Monitoring -> Inference Health**, provider credentials, base URL, model name. |
| Channel does not respond | Channel auth state, group registration, trigger name, message logs. |
| Coding job stuck | **Agents -> GitHub Coding Jobs**, job timeline, approvals, container logs. |
| Routine did not run | **Tasks** run history, paused state, schedule timezone, max active runs. |
| Webhook did not send | Pending delivery approval, webhook target, connector policy, audit log. |
| Memory feels wrong | **Memory** proposals, approved records, stale/contradicted markers. |
| Update fails | Dirty worktree, Node version, Docker availability, setup logs. |

Useful logs and checks:

```bash
npm run setup -- --dry-run
npm run typecheck
npm run build
npm test
docker ps -a
```

## Operating Habits

- Start new automation in dashboard-only or file delivery mode.
- Use **Run now** before trusting a schedule.
- Keep external delivery approval-gated until previews are consistently right.
- Use max active runs for every repeating job.
- Prefer repo-specific coding rules for repositories with special test,
  formatting, or release requirements.
- Review approved memories and installed skills periodically.
- Run production diagnostics before deploying a new RC.
