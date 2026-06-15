# Routines And Scheduled Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the first shippable Routines/Scheduled Tasks UX foundation for NanoCrab.

**Architecture:** Keep the existing scheduler as the execution authority. Add typed routine-blueprint helpers and small Tasks API affordances, then redesign the dashboard Tasks page around blueprints, wizard-style creation, search, detail/history, and run-now controls.

**Tech Stack:** Node.js, Express, TypeScript, Vitest, SQLite, vanilla dashboard JavaScript/CSS.

---

### Task 1: Routine Blueprint API

**Files:**
- Create: `src/routine-blueprints.ts`
- Test: `src/routine-blueprints.test.ts`
- Modify: `src/admin/routes/tasks.ts`

- [x] **Step 1: Write failing tests**

Create tests that assert built-in blueprints include briefing, issue triage, PR digest, dependency scan, release notes, and heartbeat; templates include schedule, prompt, context mode, optional script, and required connectors.

- [x] **Step 2: Implement helper and route**

Add `listRoutineBlueprints()` and expose `GET /api/tasks/blueprints`.

### Task 2: Run-Now API And History

**Files:**
- Modify: `src/admin/routes/tasks.ts`
- Test: `src/admin/routes/tasks.test.ts`

- [x] **Step 1: Write failing tests**

Assert `POST /tasks/:id/run-now` activates the task, sets `next_run` to now, and returns a small next-run result.

- [x] **Step 2: Implement route**

Use `updateTask(id, { status: 'active', next_run: new Date().toISOString() })`. The existing scheduler loop executes the task.

### Task 3: Dashboard Routines UX

**Files:**
- Modify: `src/admin/public/app.js`
- Modify: `src/admin/public/style.css`
- Modify: `src/admin/mock-data.ts`

- [x] **Step 1: Render new Tasks shell**

Add search, sort, routine tabs, New Routine/New Task buttons, template cards, empty state, keep-awake copy, and task cards.

- [x] **Step 2: Add wizard behavior**

Add template apply, schedule preset, advanced cron/interval/once controls, script gate toggle, provider/model, context mode, and operation schedule path.

- [x] **Step 3: Add task detail drawer**

Show task metadata, run history from `/tasks/:id/logs`, run-now, pause/resume, edit, and delete controls.

### Task 4: Verification

**Files:**
- Test commands only.

- [x] **Step 1: Run focused tests**

Run `npm test -- --run src/routine-blueprints.test.ts src/admin/routes/tasks.test.ts src/task-scheduler.test.ts src/admin/mock-data.test.ts`.

- [x] **Step 2: Run typecheck/build**

Run `npm run typecheck` and `npm run build`.

- [x] **Step 3: Browser QA**

Open mock admin dashboard, validate Tasks page loads, search/template/wizard/detail/run-now controls respond, and check mobile layout.

### Task 5: Rich Routine Metadata And Scheduler Semantics

**Files:**
- Modify: `src/types.ts`
- Modify: `src/db.ts`
- Modify: `src/task-scheduler.ts`
- Modify: `src/index.ts`
- Modify: `src/admin/routes/tasks.ts`
- Test: `src/db.test.ts`
- Test: `src/task-scheduler.test.ts`
- Test: `src/admin/routes/tasks.test.ts`

- [x] **Step 1: Write failing tests**

Cover dashboard-only delivery, file delivery, silent markers, named routine sessions, chained task context, route persistence, and DB CRUD for extended metadata.

- [x] **Step 2: Implement additive task metadata**

Add nullable scheduled-task fields for title, description, routine type, delivery, skill hints, max runtime/max active run metadata, silent marker, session key, and chained source tasks.

- [x] **Step 3: Implement scheduler behavior**

Route results to dashboard-only/chat/file modes, suppress silent marker output, persist named routine sessions under `task:<sessionKey>`, and prepend recent source task logs to chained routine prompts.

### Task 6: Skill Blueprints And Wizard Controls

**Files:**
- Modify: `src/routine-blueprints.ts`
- Add: `container/skills/automation-designer/ROUTINES.json`
- Modify: `src/admin/public/app.js`
- Modify: `src/admin/public/style.css`
- Modify: `src/admin/mock-data.ts`
- Modify: `README.md`

- [x] **Step 1: Add skill-declared blueprints**

Load optional `ROUTINES.json` sidecars from installed skills and merge them with built-in routine templates.

- [x] **Step 2: Extend dashboard wizard**

Expose routine name/type, delivery mode/target, named sessions, skill hints, chained task IDs, silent markers, max runtime, and max active run controls in create/edit/detail surfaces.

- [x] **Step 3: Update documentation and mock fixtures**

Document delivery/session/chaining behavior and populate mock tasks with the new metadata for browser QA.
