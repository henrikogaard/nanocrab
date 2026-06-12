# P0 Issue Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and close the open P0 GitHub issues by shipping the shared safety, provider, memory/skills, coding-agent, cockpit, and first-run foundations in dependency order.

**Architecture:** Treat the P0 list as six closeable vertical releases, not twenty unrelated tickets. Build shared primitives first: persisted cockpit sessions, unified approvals, provider profiles/probes, memory/skill governance, policy/audit/dry-run, and first-run diagnostics. Each issue closes only after tests, docs, mock dashboard data where relevant, and the corresponding GitHub issue comment/closure are complete.

**Tech Stack:** Node.js/TypeScript, Express admin routes, static dashboard JS/CSS, SQLite and JSON store files, Vitest, Docker-compatible container runner, GitHub REST/CLI integration, existing NanoCrab credential proxy and approval primitives.

---

## Issue Map

| Bundle | Issues | Release Target | Primary Dependency |
| --- | --- | --- | --- |
| Cockpit and approvals | #8, #9 | 2.0-Beta2 | Existing `src/approvals.ts`, session routes, dashboard shell |
| Provider operations | #14, #15, #17 | 2.0-Beta2 | Existing `src/provider-router.ts`, live probe service, fallback policy |
| Memory and skills | #20, #21, #22, #24, #25 | 2.0-Beta3 | Existing `src/memory-store.ts`, `src/journal-store.ts`, `src/skill-registry.ts`, `src/skill-factory.ts` |
| GitHub coding agent | #26, #27, #28, #29 | 2.0-Beta4 | Existing `src/coding-jobs.ts`, approval system, provider profiles |
| Safer autonomy | #43, #45, #46, #47, #49 | 2.2 | Existing approval/provider/coding surfaces plus new policy/audit services |
| First-run hardening | #52 | 2.2 | Existing `setup/`, `setup.sh`, admin setup surfaces |

## Cross-Cutting Closure Rules

- Every write-capable external action must pass through an approval or policy decision before execution.
- Every dashboard feature must include realistic mock data in `src/admin/mock-data.ts` or the relevant page-local mock path.
- Every issue must have at least one success-path test and one safety/error-path test before closure.
- Every issue with user-visible behavior must update `README.md`, `docs/ROADMAP.md`, or a more specific doc.
- Every issue closure must include a GitHub comment listing implemented files, tests run, and any follow-up issue numbers.

---

### Task 1: Branch And Baseline Inventory

**Files:**
- Read: `src/approvals.ts`
- Read: `src/coding-jobs.ts`
- Read: `src/provider-router.ts`
- Read: `src/memory-store.ts`
- Read: `src/skill-registry.ts`
- Read: `src/admin/public/app.js`
- Read: `src/admin/public/pages/dashboard.js`
- Read: `src/admin/index.ts`

- [ ] **Step 1: Create an implementation branch**

Run:

```bash
rtk git checkout -b feature/p0-issue-closure
```

Expected: branch `feature/p0-issue-closure` is checked out.

- [ ] **Step 2: Capture current repo health**

Run:

```bash
rtk npm run typecheck
rtk npm test
```

Expected: record pass/fail in the first implementation PR body. If failures already exist, capture exact failing tests before editing.

- [ ] **Step 3: Confirm P0 issue list before starting**

Run:

```bash
rtk gh issue list --repo henrikogaard/nanocrab --state open --label priority:p0 --limit 100
```

Expected: the list still includes #8, #9, #14, #15, #17, #20, #21, #22, #24, #25, #26, #27, #28, #29, #43, #45, #46, #47, #49, and #52 unless some were closed separately.

---

### Task 2: Cockpit Foundation (#8)

**Files:**
- Modify: `src/admin/routes/sessions.ts`
- Modify: `src/admin/routes/containers.ts`
- Modify: `src/admin/websocket.ts`
- Modify: `src/admin/public/app.js`
- Modify: `src/admin/public/pages/dashboard.js`
- Modify: `src/admin/public/style.css`
- Modify: `src/admin/mock-data.ts`
- Test: `src/admin/routes/sessions.test.ts`
- Test: `src/admin/websocket.test.ts`

- [ ] **Step 1: Add persisted cockpit session model**

Create or extend session APIs so each active or historical agent run exposes `id`, `group`, `provider`, `model`, `status`, `startedAt`, `updatedAt`, `lastEventAt`, `approvalCount`, `artifactCount`, `changedFiles`, and `currentStep`.

- [ ] **Step 2: Add cockpit dashboard page**

Implement a multi-pane cockpit with active jobs, session detail, timeline/log preview, artifacts, and approvals. Keep the page dense and operational; do not make a marketing-style landing page.

- [ ] **Step 3: Add mock cockpit data**

Add realistic mock sessions covering running, waiting for approval, failed, and completed states.

- [ ] **Step 4: Test session listing and detail**

Run:

```bash
rtk npx vitest run src/admin/routes/sessions.test.ts src/admin/websocket.test.ts
```

Expected: cockpit APIs return stable session summaries and websocket updates remain compatible.

- [ ] **Step 5: Close #8**

Run:

```bash
rtk gh issue comment 8 --repo henrikogaard/nanocrab --body "Implemented persistent multi-pane cockpit. Tests: npx vitest run src/admin/routes/sessions.test.ts src/admin/websocket.test.ts. Docs/mock data updated."
rtk gh issue close 8 --repo henrikogaard/nanocrab --reason completed
```

---

### Task 3: Unified Approval Inbox (#9)

**Files:**
- Modify: `src/approvals.ts`
- Modify: `src/admin/routes/approvals.ts`
- Modify: `src/admin/public/app.js`
- Modify: `src/admin/public/style.css`
- Modify: `src/admin/mock-data.ts`
- Modify: `README.md`
- Test: `src/approvals.test.ts`
- Test: `src/admin/routes/approvals.test.ts`

- [ ] **Step 1: Extend approval records**

Add provenance fields: `source`, `correlationId`, `expiresAt`, `actionPreview`, `resourceSummary`, and `policyDecisionId`. Preserve existing JSON compatibility by defaulting missing fields when reading old approvals.

- [ ] **Step 2: Add approval inbox filters**

Expose filters for `status`, `risk`, `kind`, `requester`, `targetType`, `correlationId`, and created date range.

- [ ] **Step 3: Wire dashboard inbox**

Add grouped pending approvals, approve/deny actions, history, provenance panel, and mock risky actions for messages, uploads, repo changes, provider fallback, and tool actions.

- [ ] **Step 4: Test approval safety path**

Run:

```bash
rtk npx vitest run src/approvals.test.ts src/admin/routes/approvals.test.ts
```

Expected: pending approvals can be approved/denied once; stale or already-reviewed approvals cannot be reused.

- [ ] **Step 5: Close #9**

Run:

```bash
rtk gh issue comment 9 --repo henrikogaard/nanocrab --body "Implemented unified approval inbox with provenance, filters, dashboard actions, mock data, and tests."
rtk gh issue close 9 --repo henrikogaard/nanocrab --reason completed
```

---

### Task 4: Provider Probe Runner And Persistence (#14, #15)

**Files:**
- Modify: `src/provider-router.ts`
- Modify: `src/providers/live-probe.ts`
- Modify: `src/probe-scheduler.ts`
- Modify: `src/admin/routes/providers.ts`
- Modify: `src/admin/public/pages/settings.js`
- Modify: `src/admin/mock-data.ts`
- Test: `src/providers/live-probe.test.ts`
- Test: `src/probe-scheduler.test.ts`
- Test: `src/provider-router.test.ts`

- [ ] **Step 1: Finish live probe runner**

Ensure `runLiveProviderProbe` records provider, model, profile id, latency, streaming support, tool support, schema support, vision support, context window, error detail, and timestamp.

- [ ] **Step 2: Persist provider profiles and probe history**

Store profile settings in `store/provider-profiles.json` and probe history in `store/provider-probes.json`. Retain bounded history per provider/model so the dashboard can show recent reliability without unbounded growth.

- [ ] **Step 3: Add provider dashboard controls**

Expose profile editing, run-probe buttons, probe results, last error, and mock profile data.

- [ ] **Step 4: Test probe persistence**

Run:

```bash
rtk npx vitest run src/provider-router.test.ts src/providers/live-probe.test.ts src/probe-scheduler.test.ts
```

Expected: probes persist, profile defaults survive reload, and failed probes produce actionable errors.

- [ ] **Step 5: Close #14 and #15**

Run:

```bash
rtk gh issue comment 14 --repo henrikogaard/nanocrab --body "Implemented live provider/model probe runner with stored capabilities and dashboard controls. Tests: provider-router, live-probe, probe-scheduler."
rtk gh issue close 14 --repo henrikogaard/nanocrab --reason completed
rtk gh issue comment 15 --repo henrikogaard/nanocrab --body "Implemented persisted provider profiles and bounded probe history. Tests: provider-router, live-probe, probe-scheduler."
rtk gh issue close 15 --repo henrikogaard/nanocrab --reason completed
```

---

### Task 5: Fallback Approval Policy (#17)

**Files:**
- Modify: `src/providers/fallback-policy.ts`
- Modify: `src/provider-router.ts`
- Modify: `src/container-runner.ts`
- Modify: `src/coding-jobs.ts`
- Modify: `src/approvals.ts`
- Modify: `src/admin/routes/providers.ts`
- Test: `src/providers/fallback-policy.test.ts`
- Test: `src/provider-router.test.ts`
- Test: `src/coding-jobs.test.ts`

- [ ] **Step 1: Classify write-capable workflows**

Define write-capable purposes and actions: coding implementation, PR creation, external messages, uploads, automation execution, skill installation, and provider fallback from local/private to hosted/third-party.

- [ ] **Step 2: Enforce approval before fallback**

When a write-capable workflow changes provider/model because the preferred profile is unavailable, create a `provider-fallback` approval and block execution until approved.

- [ ] **Step 3: Test blocked fallback**

Run:

```bash
rtk npx vitest run src/providers/fallback-policy.test.ts src/provider-router.test.ts src/coding-jobs.test.ts
```

Expected: read-only fallback may proceed by policy; write-capable fallback creates an approval and does not mutate external systems.

- [ ] **Step 4: Close #17**

Run:

```bash
rtk gh issue comment 17 --repo henrikogaard/nanocrab --body "Implemented fallback approval policy for write-capable workflows. Tests: fallback-policy, provider-router, coding-jobs."
rtk gh issue close 17 --repo henrikogaard/nanocrab --reason completed
```

---

### Task 6: Memory Review And Skill Suggestions (#20, #21, #22)

**Files:**
- Modify: `src/memory-store.ts`
- Modify: `src/journal-store.ts`
- Modify: `src/skill-factory.ts`
- Modify: `src/admin/routes/memory.ts`
- Modify: `src/admin/routes/skills.ts`
- Modify: `src/admin/public/pages/settings.js`
- Modify: `src/admin/mock-data.ts`
- Test: `src/memory-store.test.ts`
- Test: `src/journal-store.test.ts`
- Test: `src/skill-factory.test.ts`

- [ ] **Step 1: Add memory review filters**

Support filters for status, scope, visibility, source, confidence, stale date, and contradiction group.

- [ ] **Step 2: Add stale and contradiction checks**

Mark memories stale after configurable age or when newer approved memory conflicts on the same normalized subject. Do not delete stale memories automatically.

- [ ] **Step 3: Detect repeated skill-worthy behavior**

From message/task/journal history, create skill suggestions when repeated instructions or workflows appear at least three times with similar intent.

- [ ] **Step 4: Add skill suggestion queue**

Persist suggestions with source examples, proposed skill name, confidence, status, and owner decision. Approval creates a skill draft, not an installed skill.

- [ ] **Step 5: Test review and suggestion safety**

Run:

```bash
rtk npx vitest run src/memory-store.test.ts src/journal-store.test.ts src/skill-factory.test.ts
```

Expected: stale/contradiction filters work; suggestions require approval before draft creation.

- [ ] **Step 6: Close #20, #21, and #22**

Run:

```bash
rtk gh issue comment 20 --repo henrikogaard/nanocrab --body "Implemented memory review filters, stale checks, contradiction handling, dashboard/mock data, and tests."
rtk gh issue close 20 --repo henrikogaard/nanocrab --reason completed
rtk gh issue comment 21 --repo henrikogaard/nanocrab --body "Implemented repeated-behavior detection that prompts users to create skill drafts with explicit approval."
rtk gh issue close 21 --repo henrikogaard/nanocrab --reason completed
rtk gh issue comment 22 --repo henrikogaard/nanocrab --body "Implemented persisted skill suggestion queue from conversation and task history."
rtk gh issue close 22 --repo henrikogaard/nanocrab --reason completed
```

---

### Task 7: Memory/Skill Timeline And Router Hardening (#24, #25)

**Files:**
- Modify: `src/skill-registry.ts`
- Modify: `src/container-runner.ts`
- Modify: `src/agent-instructions.ts`
- Modify: `src/admin/routes/memory.ts`
- Modify: `src/admin/routes/skills.ts`
- Modify: `src/admin/public/pages/settings.js`
- Modify: `docs/SECURITY.md`
- Test: `src/skill-registry.test.ts`
- Test: `src/container-runner.test.ts`
- Test: `src/memory-store.test.ts`

- [ ] **Step 1: Add provenance timeline**

Expose a unified timeline of memory proposals, approvals, skill suggestions, skill drafts, installs, scope changes, and routing decisions.

- [ ] **Step 2: Add visibility controls**

Allow shared/private/system visibility to be reviewed and changed only through admin-authorized routes.

- [ ] **Step 3: Harden skill scoring**

Clamp relevance scores, cap injected skill count and total bytes, exclude private/system skills from unauthorized scopes, and record why each skill was injected.

- [ ] **Step 4: Test injection failure path**

Run:

```bash
rtk npx vitest run src/skill-registry.test.ts src/container-runner.test.ts src/memory-store.test.ts
```

Expected: private skills are not injected into unauthorized channel agents; oversized or low-score context is excluded deterministically.

- [ ] **Step 5: Close #24 and #25**

Run:

```bash
rtk gh issue comment 24 --repo henrikogaard/nanocrab --body "Implemented memory/skill timeline with provenance, visibility controls, mock data, and tests."
rtk gh issue close 24 --repo henrikogaard/nanocrab --reason completed
rtk gh issue comment 25 --repo henrikogaard/nanocrab --body "Hardened skill router scoring and context injection with scope enforcement and tests."
rtk gh issue close 25 --repo henrikogaard/nanocrab --reason completed
```

---

### Task 8: GitHub Assignment Loop And Workflow State Machine (#26, #27)

**Files:**
- Modify: `src/coding-jobs.ts`
- Modify: `src/admin/routes/developer.ts`
- Modify: `src/admin/plugins/autofix/routes.ts`
- Modify: `src/admin/public/pages/autofix.js`
- Modify: `src/admin/mock-data.ts`
- Test: `src/coding-jobs.test.ts`

- [ ] **Step 1: Implement issue picker**

Support picking GitHub issues by repo, label, assignee, milestone, direct number, and enabled repo config. Never auto-pick issues without an enabled repo config.

- [ ] **Step 2: Implement staged workflow transitions**

Make job transitions explicit: `queued -> investigate -> plan -> await_approval -> implement -> test -> await_pr_approval -> open_pr -> ci_running -> completed`. Persist transition timestamps and failure reasons.

- [ ] **Step 3: Enforce transition guards**

Block implementation before plan approval and block PR creation before PR approval.

- [ ] **Step 4: Test assignment and transition failures**

Run:

```bash
rtk npx vitest run src/coding-jobs.test.ts
```

Expected: issue selection obeys filters; invalid state transitions throw; implementation and PR opening require approvals.

- [ ] **Step 5: Close #26 and #27**

Run:

```bash
rtk gh issue comment 26 --repo henrikogaard/nanocrab --body "Implemented GitHub issue assignment loop with repo filters, direct issue selection, and tests."
rtk gh issue close 26 --repo henrikogaard/nanocrab --reason completed
rtk gh issue comment 27 --repo henrikogaard/nanocrab --body "Implemented staged coding workflow state machine with approval guards and tests."
rtk gh issue close 27 --repo henrikogaard/nanocrab --reason completed
```

---

### Task 9: PR/CI Dashboard And Code Approval Controls (#28, #29)

**Files:**
- Modify: `src/coding-jobs.ts`
- Modify: `src/admin/routes/developer.ts`
- Modify: `src/admin/public/pages/autofix.js`
- Modify: `src/admin/public/style.css`
- Modify: `src/admin/mock-data.ts`
- Modify: `README.md`
- Test: `src/coding-jobs.test.ts`

- [ ] **Step 1: Add PR and CI summaries**

Capture branch, changed files, diff summary, test summary, commit SHA, PR URL, CI status, and last CI error for each coding job.

- [ ] **Step 2: Add dashboard review controls**

Show diff/log/test/CI panes and provide approve implementation, deny implementation, approve PR, retry, and cancel actions.

- [ ] **Step 3: Block repo mutation without approval**

Ensure code changes, pushes, and PR opening all require explicit approval records tied to the job id.

- [ ] **Step 4: Test mutation guards**

Run:

```bash
rtk npx vitest run src/coding-jobs.test.ts src/approvals.test.ts
```

Expected: PR creation fails without approval and succeeds only after the matching approval is approved.

- [ ] **Step 5: Close #28 and #29**

Run:

```bash
rtk gh issue comment 28 --repo henrikogaard/nanocrab --body "Implemented PR/CI dashboard with diff, logs, test summaries, mock data, and tests."
rtk gh issue close 28 --repo henrikogaard/nanocrab --reason completed
rtk gh issue comment 29 --repo henrikogaard/nanocrab --body "Implemented approval controls for code changes and PR opening with mutation guards."
rtk gh issue close 29 --repo henrikogaard/nanocrab --reason completed
```

---

### Task 10: Policy Engine, Dry-Run, Audit Replay (#45, #46, #47)

**Files:**
- Create: `src/audit-log.ts`
- Create: `src/policy-engine.ts`
- Create: `src/admin/routes/audit.ts`
- Create: `src/audit-log.test.ts`
- Create: `src/policy-engine.test.ts`
- Modify: `src/db.ts`
- Modify: `src/approvals.ts`
- Modify: `src/container-runner.ts`
- Modify: `src/coding-jobs.ts`
- Modify: `src/router.ts`
- Modify: `src/admin/index.ts`
- Modify: `src/admin/public/app.js`
- Modify: `src/admin/public/style.css`
- Modify: `src/admin/mock-data.ts`
- Modify: `docs/SECURITY.md`

- [ ] **Step 1: Add audit event storage**

Add an `audit_events` table or JSON-backed store with `id`, `timestamp`, `actor`, `actorId`, `actionType`, `resource`, `decision`, `context`, `correlationId`, `durationMs`, and `error`.

- [ ] **Step 2: Add policy engine**

Store rules in `store/policies.json`, support action pattern matching, risk classification, approval requirements, dry-run permission, and sanitized decision explanations.

- [ ] **Step 3: Instrument high-impact actions**

Log approvals, provider fallback, container spawn, coding job transitions, channel sends, uploads, PR creation, and policy denials. Redact tokens, passwords, API keys, secrets, cookies, and authorization headers.

- [ ] **Step 4: Add dry-run mode**

Allow coding jobs and automations to simulate risky actions with read-only mounts and simulated tool/action responses. Dry-run results must be visible in audit events as `decision: simulated`.

- [ ] **Step 5: Add audit dashboard**

Add filters, correlation replay, event detail, export JSON, and policy simulator with mock runs.

- [ ] **Step 6: Test safety backbone**

Run:

```bash
rtk npx vitest run src/audit-log.test.ts src/policy-engine.test.ts src/approvals.test.ts src/coding-jobs.test.ts src/container-runner.test.ts
```

Expected: policies require approvals for risky actions, dry-run does not write external state, and audit replay reconstructs a job timeline by correlation id.

- [ ] **Step 7: Close #45, #46, and #47**

Run:

```bash
rtk gh issue comment 45 --repo henrikogaard/nanocrab --body "Implemented policy engine for autonomous versus approval-required actions, including dashboard simulator and tests."
rtk gh issue close 45 --repo henrikogaard/nanocrab --reason completed
rtk gh issue comment 46 --repo henrikogaard/nanocrab --body "Implemented dry-run mode for risky operations with simulated audit events and tests."
rtk gh issue close 46 --repo henrikogaard/nanocrab --reason completed
rtk gh issue comment 47 --repo henrikogaard/nanocrab --body "Implemented full audit replay for agent runs with correlation timeline, dashboard view, and tests."
rtk gh issue close 47 --repo henrikogaard/nanocrab --reason completed
```

---

### Task 11: Connector Permissions And Agent Boundaries (#43, #49)

**Files:**
- Create: `src/connector-permissions.ts`
- Create: `src/agent-boundaries.ts`
- Create: `src/connector-permissions.test.ts`
- Create: `src/agent-boundaries.test.ts`
- Modify: `src/admin/routes/mcp.ts`
- Modify: `src/admin/routes/agents.ts`
- Modify: `src/container-runner.ts`
- Modify: `src/skill-registry.ts`
- Modify: `src/admin/public/pages/agents.js`
- Modify: `src/admin/public/pages/settings.js`
- Modify: `src/admin/mock-data.ts`
- Modify: `docs/SECURITY.md`

- [ ] **Step 1: Define connector permission model**

Represent connector permissions as `connectorId`, `scope`, `allowedActions`, `requiresApproval`, `groups`, `agents`, `createdAt`, and `updatedAt`.

- [ ] **Step 2: Enforce connector permissions**

Before exposing MCP connector tools or executing connector actions, verify the active group/agent scope and policy decision.

- [ ] **Step 3: Define per-agent boundaries**

Represent channel scopes, filesystem scopes, skill scopes, provider profile permissions, and external write permissions for each agent identity.

- [ ] **Step 4: Enforce boundaries in runtime assembly**

When building container mounts, skills, provider profile, channel tools, and connector tools, derive allowed capabilities from `agent-boundaries.ts`.

- [ ] **Step 5: Test denial paths**

Run:

```bash
rtk npx vitest run src/connector-permissions.test.ts src/agent-boundaries.test.ts src/container-runner.test.ts src/skill-registry.test.ts
```

Expected: unauthorized agents cannot receive private skills, out-of-scope connectors, write-capable tools, or disallowed channel scopes.

- [ ] **Step 6: Close #43 and #49**

Run:

```bash
rtk gh issue comment 43 --repo henrikogaard/nanocrab --body "Implemented connector permission model and audit/dashboard visibility with enforcement tests."
rtk gh issue close 43 --repo henrikogaard/nanocrab --reason completed
rtk gh issue comment 49 --repo henrikogaard/nanocrab --body "Implemented per-agent boundaries and channel scopes with runtime enforcement and tests."
rtk gh issue close 49 --repo henrikogaard/nanocrab --reason completed
```

---

### Task 12: First-Run Setup Wizard Hardening (#52)

**Files:**
- Modify: `setup/index.ts`
- Modify: `setup.sh`
- Modify: `scripts/setup-nanocrab.sh`
- Modify: `src/admin/routes/system.ts`
- Modify: `src/admin/public/pages/settings.js`
- Modify: `src/logger.ts`
- Modify: `README.md`
- Modify: `docs/DEBUG_CHECKLIST.md`
- Create: `docs/FIRST_RUN_VPS_TEST.md`
- Test: `src/setup.test.ts` or closest setup test file if one already exists when implementation starts

- [ ] **Step 1: Add prerequisite preflight**

Validate Node version, npm, Docker/container runtime, ports, filesystem permissions, `.env` writability, admin auth configuration, and provider/channel credential readiness before long-running setup steps.

- [ ] **Step 2: Add resume-safe setup state**

Persist setup step state with explicit `pending`, `running`, `completed`, and `failed` statuses. Reruns must resume from the failed or next incomplete step without corrupting secrets or generated files.

- [ ] **Step 3: Add NanoCrab branding**

Show NanoCrab name, edition/version, and ASCII-style crab art in terminal setup. Keep the output readable over SSH.

- [ ] **Step 4: Redact setup logs**

Ensure setup logs redact tokens, passwords, API keys, cookies, authorization headers, and credential proxy material.

- [ ] **Step 5: Add clean VPS rehearsal doc**

Document create VPS, clone repo, run setup, configure credentials, verify dashboard/channel/provider, collect diagnostics, and discard VPS.

- [ ] **Step 6: Test setup failure and resume**

Run:

```bash
rtk npm run typecheck
rtk npm test
rtk npm run setup -- --dry-run
```

Expected: typecheck/tests pass; dry-run setup reports preflight status without writing secrets.

- [ ] **Step 7: Close #52**

Run:

```bash
rtk gh issue comment 52 --repo henrikogaard/nanocrab --body "Implemented reliable first-run setup wizard path with preflight checks, resume safety, NanoCrab branding, redacted logs, and clean VPS rehearsal docs."
rtk gh issue close 52 --repo henrikogaard/nanocrab --reason completed
```

---

### Task 13: Final Verification And Epic Updates

**Files:**
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/HANDOVER.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
rtk npm run typecheck
rtk npm run lint
rtk npm test
rtk npm run build
```

Expected: all commands pass.

- [ ] **Step 2: Verify no P0 issues remain open**

Run:

```bash
rtk gh issue list --repo henrikogaard/nanocrab --state open --label priority:p0 --limit 100
```

Expected: no open non-epic P0 issues remain. If P0 epics remain open, their child checklists must be updated.

- [ ] **Step 3: Update P0 epic checklists**

Update #1, #2, #3, #4, and #7 to mark closed P0 child items complete. If all children for an epic are complete, close that epic.

- [ ] **Step 4: Create final PR**

Run:

```bash
rtk git status --short
rtk git add README.md docs src setup setup.sh scripts
rtk git commit -m "feat: close p0 roadmap foundations"
rtk git push -u origin feature/p0-issue-closure
rtk gh pr create --repo henrikogaard/nanocrab --fill --draft
```

Expected: draft PR exists with verification output, closed issue list, and remaining non-P0 follow-ups.

---

## Recommended Execution Order

1. Ship #8 and #9 first because every later safety feature needs cockpit visibility and approval primitives.
2. Ship #14, #15, and #17 next because provider selection/fallback is a dependency of coding jobs and autonomous workflows.
3. Ship #20, #21, #22, #24, and #25 as the learning-system slice.
4. Ship #26, #27, #28, and #29 as the GitHub coding-agent slice.
5. Ship #45, #46, #47, #43, and #49 as the autonomy/security slice.
6. Ship #52 last, then validate the full system on a clean VPS path.

## Self-Review

- Spec coverage: all currently open P0 issues are mapped to an implementation task and close command.
- Placeholder scan: no task relies on unspecified follow-up work for issue closure; each task names files, tests, and GitHub closure steps.
- Type consistency: shared concepts use existing names where present: approvals, coding jobs, provider profiles, probes, memory store, skill registry, and container runner.
