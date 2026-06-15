# Automation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining routines/autofix suggestions: approval-gated webhook delivery, heartbeat policies, run-limit enforcement, GitHub auto-pickup, and routine observability.

**Architecture:** Keep scheduled execution in `src/task-scheduler.ts` and GitHub issue work in the Autofix plugin. Use the existing file-backed approvals store for risky outbound effects. Add additive metadata and opt-in controls so existing routines and Autofix projects keep working.

**Tech Stack:** Node.js, Express, TypeScript, SQLite, Vitest, vanilla dashboard JavaScript/CSS.

---

### Task 1: Approval-Gated Routine Webhooks

**Files:**
- Modify: `src/approvals.ts`
- Modify: `src/task-scheduler.ts`
- Test: `src/task-scheduler.test.ts`

- [x] **Step 1: Write failing tests**

Assert a webhook-delivered scheduled task creates a pending approval with `kind: "webhook-delivery"`, `targetType: "scheduled-task"`, the task ID as target, the webhook URL in the payload, and no outbound chat message.

- [x] **Step 2: Implement approval kind and scheduler approval creation**

Add `webhook-delivery` to `ApprovalKind`. In `deliverTaskResult()`, when `delivery_mode === "webhook"`, create or reuse a pending approval instead of sending an HTTP request.

- [x] **Step 3: Verify**

Run `npm test -- --run src/task-scheduler.test.ts src/approvals.test.ts`.

### Task 2: Heartbeat Policies And Run Limits

**Files:**
- Modify: `src/types.ts`
- Modify: `src/db.ts`
- Modify: `src/task-scheduler.ts`
- Test: `src/db.test.ts`
- Test: `src/task-scheduler.test.ts`

- [x] **Step 1: Write failing tests**

Assert quiet-hours heartbeat tasks skip without invoking the container, stale heartbeat tasks run even when otherwise quiet, and concurrent runs beyond `max_active_runs` are skipped with a useful `last_result`.

- [x] **Step 2: Implement additive policy fields**

Add `heartbeat_policy_json`, `last_started_at`, and `active_run_count` columns. Update create/update helpers and scheduler bookkeeping.

- [x] **Step 3: Implement scheduler decisions**

Before queueing/running a task, evaluate quiet hours, stale minutes, and active-run limits. Mark skipped runs with `last_result` summaries and task run logs.

### Task 3: GitHub Auto-Pickup

**Files:**
- Modify: `src/admin/plugins/autofix/routes.ts`
- Test: `src/admin/plugins/autofix/routes.test.ts`

- [x] **Step 1: Write failing tests**

Assert Autofix projects can enable polling, normalize `pollIntervalMinutes`, and start coding jobs for labeled GitHub issues that do not already have active jobs.

- [x] **Step 2: Implement polling helper**

Add `autoPickEnabled`, `pollIntervalMinutes`, and `lastAutoPickAt` project fields. Export `runAutofixAutoPickOnce()` for startup hooks/tests; it lists matching issues and starts jobs while honoring `maxActiveJobs`.

### Task 4: Dashboard And Templates

**Files:**
- Modify: `src/admin/public/app.js`
- Modify: `src/admin/public/pages/autofix.js`
- Modify: `src/admin/public/style.css`
- Modify: `src/routine-blueprints.ts`
- Modify: `src/admin/mock-data.ts`
- Test: `src/routine-blueprints.test.ts`
- Test: `src/admin/mock-data.test.ts`

- [x] **Step 1: Add UI fields and badges**

Expose heartbeat policy JSON, webhook approval status, active run counts, and Autofix auto-pick controls in dashboard forms/cards.

- [x] **Step 2: Add templates**

Add flaky test tracker, dependency security watch, PR merge release-note draft, inbox SLA monitor, and GitHub auto-pick review templates.

- [x] **Step 3: Browser QA**

Open `/#/tasks` and `/#/autofix` in mock mode, verify new controls render, console is clean, and mobile layout has no horizontal overflow.

### Task 5: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-06-14-routines-scheduled-tasks-design.md`
- Modify: `docs/superpowers/plans/2026-06-14-routines-scheduled-tasks.md`

- [x] **Step 1: Document behavior**

Document approval-gated webhooks, heartbeat policies, run-limit enforcement, and Autofix auto-pick.

- [x] **Step 2: Verify**

Run focused tests, `npm run typecheck`, `npm run build`, `node --check src/admin/public/app.js`, Prettier check, targeted ESLint, `git diff --check`, and Browser QA.
