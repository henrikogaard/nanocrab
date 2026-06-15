# Routines And Scheduled Tasks Design

## Goal

Make NanoCrab's scheduled automation feel like user-friendly routines instead of raw cron rows, while preserving the existing scheduler, approval, provider-routing, and container safety model.

## Context

Hermes frames automations as templated blueprints that can run on schedules, webhooks, or API triggers. OpenClaw separates exact cron jobs from heartbeat-style periodic awareness, standing orders, commitments, and task history. NanoCrab already has scheduled tasks, task run logs, operation schedules, provider/model overrides, dry-run tool policy, and connected skills. The gap is mostly dashboard UX plus a few small API affordances.

## Product Model

Scheduled work is presented as four related surfaces:

- Routines: template-backed automations such as daily briefing, issue triage, dependency scan, PR digest, release notes, and operation reminders.
- Scheduled Tasks: exact cron, interval, and one-shot jobs for users who need precision.
- Heartbeat: periodic awareness checks that should usually stay silent unless something needs attention.
- History: run logs, failures, outputs, provider/model, and manual controls.

## First Implementation Slice

This pass builds the foundation without replacing the scheduler:

- Add routine blueprint metadata served by the Tasks API.
- Redesign the Tasks dashboard with a Claude/Hermes-style creation surface, template cards, search, chips, and task detail drawer.
- Add task suggestions from built-in routine blueprints and current integrations.
- Add a run-now action that marks a task due for the existing scheduler loop.
- Add first-class "script gate / no-agent when quiet" UI using the existing scheduled-task script contract.
- Improve task cards with next run, last result, provider/model, context, and safety badges.

## Second Implementation Slice

This pass extends the foundation with durable routine metadata and safer delivery controls:

- Add scheduled-task fields for title, description, routine type, delivery mode/target, skill hints, max runtime/max active run metadata, silent markers, named session keys, and chained source task IDs.
- Support dashboard-only, chat, and file delivery from the scheduler. Webhook targets can be stored by the API/UI, but the scheduler does not emit webhooks until an approval flow exists.
- Add named scheduled sessions via `context_mode = "session"` and `session_key`, persisted under `task:<sessionKey>`.
- Add chained context by appending recent run results from source task IDs to the next routine prompt.
- Let skills declare routine templates with `container/skills/<skill>/ROUTINES.json`.
- Expand the Tasks dashboard wizard and edit/detail views so operators can configure delivery, sessions, silent markers, skill hints, and chained context without editing raw rows.

## Safety

All scheduled execution remains inside the existing scheduled task runner. Script gates use the current container-side scheduled script behavior: scripts output JSON on the final line with `{ "wakeAgent": boolean, "data"?: unknown }`. If `wakeAgent` is false, the agent is not called. Dry-run/preview remains the default for operation schedules.

## Hardening Slice

The follow-up implementation added the remaining safety and automation pieces:

- Heartbeat policies are stored as `heartbeat_policy_json` and support quiet hours, active hours, and stale-after minutes. Non-stale heartbeat tasks can skip locally without waking a container.
- Webhook delivery creates a `webhook-delivery` approval record. Approval execution performs the outbound POST, so routines never emit arbitrary webhooks directly from the scheduler path.
- Per-task active-run enforcement uses `active_run_count`, `last_started_at`, `max_active_runs`, and `max_runtime_ms` so long-running automations do not pile up.
- Autofix projects can opt into GitHub auto-pick polling with `autoPickEnabled`, `pollIntervalMinutes`, and `lastAutoPickAt`; the poller skips duplicates and honors `maxActiveJobs`.
- The dashboard exposes heartbeat quiet hours/stale fields, runtime/concurrency limits, approval-gated webhook templates, and Autofix auto-pick controls.
