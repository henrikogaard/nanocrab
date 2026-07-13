# Devin Handover: AI Coding Control Plane

Last verified: 2026-07-12

> **Status: implementation complete.** All eight work packages are merged into
> `main`; epic #109 and child issues #111, #113, and #115–#120 are closed and
> `Done`. The implementation instructions below are retained as architecture and
> acceptance-history reference. Do not re-run them as new feature work.

## Mission

Maintain and verify the completed [#109 — GitHub-native AI coding control plane](https://github.com/henrikogaard/nanocrab/issues/109).

The finished product lets an operator:

- create named coding agents with instructions, personality, CLI, provider/model, fallbacks, capabilities, and repository scope;
- map different agents to GitHub Projects v2 stages such as Planning, Implement, and Review;
- see the active agent, CLI, model, run, decision, checks, branch, and PR;
- require a human decision before every GitHub swimlane change; and
- inspect and control the same workflow from the web UI, WhatsApp, Discord, Slack, Signal, and Telegram.

GitHub Projects v2 is the workflow source of truth. NanoCrab stores configuration, synchronized snapshots, runs, decisions, evidence, and audit history. Do not create a competing canonical issue-state system.

## Read First

Read these files in order before editing:

1. `AGENTS.md`
2. `docs/superpowers/specs/2026-07-12-ai-coding-control-plane-design.md`
3. `docs/superpowers/plans/2026-07-12-ai-coding-control-plane.md`
4. `docs/AGENT_PROFILES.md`
5. The GitHub parent issue and the child issue for the slice being implemented.

The implementation plan is the detailed source for exact files, interfaces, test cases, and commands. This handover records current state and how Devin should execute it.

## Verified Repository State

- Repository: `henrikogaard/nanocrab`
- Integration branch: `main`
- Completed merged baseline: `76d23a38`
- Parent epic: [#109](https://github.com/henrikogaard/nanocrab/issues/109), closed and `Done`
- Planning PR: [#110](https://github.com/henrikogaard/nanocrab/pull/110), merged
- Task 1: [#111](https://github.com/henrikogaard/nanocrab/issues/111) / [#112](https://github.com/henrikogaard/nanocrab/pull/112), merged and closed
- Task 2: [#113](https://github.com/henrikogaard/nanocrab/issues/113) / [#114](https://github.com/henrikogaard/nanocrab/pull/114), merged and closed
- Task 3: [#115](https://github.com/henrikogaard/nanocrab/issues/115) / [#121](https://github.com/henrikogaard/nanocrab/pull/121), merged and closed
- Task 4: [#116](https://github.com/henrikogaard/nanocrab/issues/116) / [#122](https://github.com/henrikogaard/nanocrab/pull/122), merged and closed
- Task 5: [#117](https://github.com/henrikogaard/nanocrab/issues/117) / [#123](https://github.com/henrikogaard/nanocrab/pull/123), merged and closed
- Task 6: [#118](https://github.com/henrikogaard/nanocrab/issues/118) / [#124](https://github.com/henrikogaard/nanocrab/pull/124), merged and closed
- Task 7: [#119](https://github.com/henrikogaard/nanocrab/issues/119) / [#125](https://github.com/henrikogaard/nanocrab/pull/125), merged and closed
- Task 8: [#120](https://github.com/henrikogaard/nanocrab/issues/120) / [#126](https://github.com/henrikogaard/nanocrab/pull/126), merged and closed

Refresh GitHub and `origin/main` before any maintenance or follow-up work.

The main checkout contained unrelated local state when this note was created:

```text
 M AGENTS.md
?? .worktrees/
```

Treat those paths as user-owned. Do not stage, rewrite, delete, or clean them.

## Mandatory Workflow For Follow-Up Changes

Apply this workflow to any future control-plane follow-up issue:

1. Refresh `origin/main` and verify the previous dependency PR is merged.
2. Create a child issue under #109 using the task title and acceptance criteria below.
3. Add the issue to the NanoCrab GitHub Project and move it to `In progress`.
4. Create a new isolated worktree outside the dirty main checkout and a branch named `feature/<issue>-<slice>`.
5. Install and test with the repository-supported runtime:

   ```bash
   mise exec node@24 -- npm install --include=dev
   mise exec node@24 -- npm run typecheck
   ```

6. Use strict TDD for every behavior change:
   - edit a test first;
   - run it and preserve the expected RED failure;
   - write the smallest production change;
   - run GREEN;
   - refactor only while green.
7. Keep changes inside the task’s declared file surface. Do not perform drive-by refactors.
8. Run focused tests, typecheck, formatting, touched-file lint, and `git diff --check`.
9. Perform two independent read-only reviews:
   - spec/acceptance compliance;
   - code quality, security, migration, and regression risk.
10. Fix all Critical and Important findings with another RED/GREEN cycle and re-review.
11. Commit, push, and open a PR to `main`. Link the child issue and parent #109. Include RED/GREEN and verification evidence.
12. Move the child issue to `In review`. Do not start its dependent task until the PR merges.

Do not merge, close the epic, release, deploy, rotate credentials, or delete useful worktrees without Henrik’s explicit authorization. A PR and green tests are implementation evidence, not epic-closure evidence.

## Global Product Constraints

- Exactly one Project, one single-select workflow field, and one linear `planning -> implement -> review` flow in this vertical slice.
- Planning, Implement, and Review use separate Agent Profiles. Implement and Review may not use the same effective profile.
- An agent proposes a stage transition; an authorized operator decides. The agent never writes the GitHub stage directly.
- Web and all five bot channels use one authorization, command, idempotency, decision, and audit service.
- CLI executables come only from the allowlisted runtime registry.
- A write-capable fallback to another CLI/model requires explicit approval and remains visibly attributed.
- Implementation and review use separate managed worktrees. Review requires a pushed branch and open PR.
- Profiles may narrow permissions but never widen repository, connector, skill, credential, or host boundaries.
- No unattended merge, issue closure, release, deployment, or automatic worktree deletion in this epic.

## The Eight Completed Work Packages

### 1. Agent Runtime Profiles And CLI Registry — Complete

Merged through #111 / PR #112. Do not reimplement it.

What exists:

- Agent Profile instructions, stage roles, primary runtime, ordered fallbacks, repository scopes, and concurrency.
- Allowlisted CLI discovery for Claude, Codex, Pi, OpenCode, Devin, and Mistral Vibe.
- Independent health states for healthy, missing, unsupported, unauthenticated, and error conditions.
- Mistral’s logical runtime id maps to the installed `vibe` executable.
- Coding-runner readiness is separate from host interactive CLI discovery. Pi
  is runnable when the coding image and OpenRouter credential route are ready,
  even when no host `pi` executable is installed.
- Additive migration preserves existing Agent Profiles.

Before depending on it, run its focused profile/registry tests and inspect the merged interfaces rather than copying types from the plan blindly.

### 2. Pipeline Domain And SQLite Persistence — Complete

Merged through #113 / PR #114. Do not reimplement it.

What exists:

- Pipeline, stage, assignment, Project-item snapshot, and dispatch-claim domain contracts.
- Exactly one Planning, Implement, and Review stage using stable GitHub option IDs.
- Validated stage defaults and issue-specific overrides with enabled/role/scope checks.
- Distinct effective Implement and Review profiles.
- Additive control-plane tables, store-boundary relational checks, and transactional dispatch claims.
- Public persistence paths enforce the complete domain contract.

Task 3 must consume these merged interfaces. Do not create a second pipeline store.

### 3. GitHub Projects V2 Synchronization — Complete

Merged through #115 / PR #121. Do not reimplement it.

Create the next child issue with the title `Control plane: GitHub Projects v2 synchronization`.

Implement:

- `src/control-plane/github-projects.ts`
  - typed GraphQL transport;
  - Project/field/option/item pagination;
  - Issue items only in the first slice;
  - stable node and option IDs;
  - permission, rate-limit, and malformed-response errors that never become false-empty Projects.
- `src/control-plane/sync.ts`
  - update local display snapshots from GitHub;
  - preserve renamed field labels while matching option IDs;
  - expose deleted mapped options as configuration errors;
  - claim one dispatch candidate per effective GitHub revision.
- conflict-safe `updateProjectItemStage()`:
  - read current item;
  - compare expected option and observed revision;
  - refuse a newer human change;
  - mutate with `updateProjectV2ItemFieldValue`;
  - read back and verify the requested option.

Required tests:

- multi-page fields, options, and items;
- renamed and deleted options;
- permission/rate-limit failures;
- stale revision conflict with no mutation;
- successful mutation read-back;
- repeated polls/webhooks produce one claimed dispatch candidate;
- existing coding-job GitHub behavior remains green.

Do not start coding jobs or create decisions in this task. Return typed dispatch candidates for Task 4.

### 4. Decision Gates, Stage Dispatch, And Fallback Approval — Complete

Merged through #116 / PR #122. Do not reimplement it.

Start only after Task 3 merges.

Implement:

- durable `ControlPlaneDecision` records for stage transition and runtime fallback;
- atomic terminal resolution so only one approve/reject/revise/reassign action wins;
- authorization and stale-decision checks before mutation;
- approve: refresh GitHub, update/read back stage, then dispatch the next assigned agent;
- reject: leave the GitHub stage unchanged;
- revise: leave the stage unchanged and resume the current agent with feedback;
- reassign: persist an issue-specific validated assignment, then dispatch only after confirmation;
- primary CLI health check and one explicit fallback approval at a time;
- `dispatcher.ts` adapter from a validated stage candidate to a profile-attributed coding job.

Required tests:

- simultaneous approve/reject attempts allow exactly one terminal action;
- unauthorized actor cannot mutate;
- stale GitHub state invalidates the decision;
- revise resumes with feedback and does not write GitHub;
- reassignment preserves all stage/profile policy constraints;
- unavailable primary CLI blocks without starting a job;
- approved fallback records the actual CLI/provider/model;
- failures after a verified GitHub transition remain visible and retryable rather than silently rolling GitHub back.

No web UI or channel-specific parsing in this task.

### 5. Managed Worktree Evidence And Review Preconditions — Complete

Merged through #117 / PR #123. Do not reimplement it.

Start only after Task 4 merges.

Extend the existing coding-job/container execution path; do not create a parallel job engine.

Implement:

- pipeline/stage/assignment/decision attribution on coding jobs;
- explicit `StageRunEvidence` for worktree, branch, commit, push, PR, checks, and artifacts;
- separate worktrees and different profiles for Implement and Review;
- Review transition validation requiring a pushed implementation branch, open PR, and passing required checks;
- cancellation that terminates the owned process group but preserves logs, branch, worktree, and audit history;
- explicit cleanup guards while a run is active, a decision is pending, a branch is unpushed, or a PR remains open.

Required tests:

- implementation cannot propose Review without pushed branch and PR;
- a failed required check blocks completion;
- Implement and Review cannot reuse the same worktree/profile;
- cancellation preserves unpushed work;
- cleanup explains why it is blocked;
- existing coding commands and container-runner behavior remain green.

### 6. Control Plane HTTP API And Web UI — Complete

Merged through #118 / PR #124. Do not reimplement it.

Start only after Task 5 merges.

Implement thin `/api/control-plane/*` routes over the existing services and a `#/control-plane` page with:

- Overview/Board;
- Agents;
- Pipelines;
- Runs;
- Decisions;
- Settings.

The UI must let the operator create, edit, clone, disable, and test agents. It must map Project field options to stages/agents and display issue, stage, current agent, actual CLI/provider/model, run, pending decision, checks, branch, and PR.

Decision actions are Approve, Reject, Revise, and Reassign. A `409` conflict must refresh current GitHub state rather than pretending the action succeeded.

Use the existing vanilla dashboard modules, status helpers, tokens, routing, modal/form patterns, mock API, and mock server. Add distinct loading, empty, sync-error, configuration-error, active, blocked, and stale states. Include realistic mock agents Atlas/Claude, Forge/Codex, and Lens/Devin.

Required verification:

- route tests for all list/create/update/sync/decision endpoints and status codes;
- source-level UI tests for the six sections and visible runtime attribution;
- existing shell/Agents UI regressions;
- typecheck and build;
- browser QA for agent creation, pipeline mapping, board state, decisions, conflicts, keyboard use, focus, and responsive layout.

Do not duplicate SQL, GraphQL, authorization, or transition logic in routes or browser JavaScript.

### 7. Shared Channel Command Service And Five-Channel Parity — Complete

Merged through #119 / PR #125. Do not reimplement it.

Start only after Task 6 merges.

Implement one shared `src/control-plane/commands.ts` parser/executor for:

```text
status #128
show plan #128
show decision #128
approve #128 to implement
reject #128: reason
revise #128: add rollback tests
reassign #128 implement to @Forge
pause #128
cancel #128
```

Requirements:

- resolve ambiguous issue numbers safely and show repository candidates;
- require an authorized operator mapping for every mutation;
- deduplicate by source channel/message id before mutation;
- return current status for stale decisions;
- pass channel, chat, sender, and message identity into decision audit;
- keep text replies as the portable contract;
- allow Slack/Discord/Telegram buttons only as renderers over shared actions;
- route normalized messages once in `src/index.ts` before normal agent invocation;
- keep workflow logic out of WhatsApp, Discord, Slack, Signal, and Telegram adapters.

Required tests and QA cover the same authorized, unauthorized, stale, ambiguous, status, approve, revise, and reassign behavior on all five channels.

### 8. End-To-End Proof, Documentation, And Epic Readiness — Complete

Merged through #120 / PR #126. Do not reimplement it.

Start only after Tasks 1–7 merge.

Add an injected-transport integration test that:

1. creates Atlas/Claude, Forge/Codex, and Lens/Devin profiles;
2. creates a stable-ID pipeline;
3. syncs a Planning issue and dispatches Atlas exactly once;
4. stores a plan and creates the Implement decision;
5. approves through the shared command service and verifies GitHub mutation/read-back before Forge dispatch;
6. records isolated worktree, checks, pushed branch, and PR evidence;
7. approves Review and dispatches Lens with a different profile/worktree;
8. rejects a stale duplicate command without creating another job.

Update:

- `docs/AGENT_PROFILES.md`
- `docs/CAPABILITIES.md`
- `docs/USER_GUIDE.md`
- `docs/ROADMAP.md`
- `README.md`

Run the full verification matrix:

```bash
mise exec node@24 -- npm run typecheck
mise exec node@24 -- npm run lint
mise exec node@24 -- npm run format:check
mise exec node@24 -- npm test
mise exec node@24 -- npm run build
```

Then perform browser QA, one live GitHub Project test issue, and all five live/configured bot-channel checks. Preserve issue/Project before-and-after state, decision IDs, actual runtime attribution, worktree/branch/PR evidence, checks, conflict handling, and retries.

Do not mark #109 `Done` merely because automated tests pass. Close the epic only after every acceptance criterion has linked merged code and QA evidence. External credentials, unavailable live channels, or subjective QA keep the epic in `In review` with the exact gate recorded.

## Recommended Devin Maintenance Prompt

Use this after opening the repository in a clean Devin session:

```text
Maintain the completed NanoCrab control-plane epic #109 using docs/AI_CODING_CONTROL_PLANE_DEVIN_HANDOVER.md as architecture and acceptance-history context.
Read AGENTS.md, the design spec, and the full implementation plan before acting.
All eight tasks are merged and #109 is closed; do not reimplement or reopen them without a new validated gap.
Refresh GitHub and origin/main, reproduce the requested follow-up, create a new focused issue, and use a fresh isolated worktree.
Use strict TDD and preserve RED/GREEN evidence. Keep edits within the new issue's declared scope. Do not merge, release, deploy, reopen/close the epic, or touch unrelated local state without Henrik's explicit authorization.
When the follow-up is review-clean, commit, push, open a PR to main, move the new issue to In review, and stop at the merge gate with exact verification evidence.
```

## Stop And Ask Henrik When

- GitHub Project owner/number or workflow-field choice is ambiguous.
- Implementing the requested behavior would widen repository, credential, connector, skill, or host access.
- A plan requirement conflicts with a validated security, data-loss, or migration finding.
- Live channel or GitHub credentials are required and unavailable.
- A dependency PR is not merged or `main` has changed incompatibly.
- A destructive cleanup, merge, release, deploy, credential change, or issue/epic closure is the next action.

For ordinary code/test/review corrections inside an approved slice, fix them without asking and preserve the evidence in the PR.
