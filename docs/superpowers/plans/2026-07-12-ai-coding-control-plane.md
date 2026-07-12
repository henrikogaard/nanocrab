# AI Coding Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Tracking issue:** [#109 - GitHub-native AI coding control plane](https://github.com/henrikogaard/nanocrab/issues/109)

**Goal:** Deliver one GitHub Projects v2-backed `Planning -> Implement -> Review` workflow where each stage uses a different configurable agent/CLI and every swimlane transition requires an authorized decision from the web UI or a supported bot channel.

**Architecture:** Extend Agent Profiles with enforceable coding-runtime configuration, then add focused runtime-registry, pipeline, GitHub sync, decision, and shared-command services. Existing coding jobs remain the execution engine; GitHub owns stage state, NanoCrab owns configuration/evidence/audit, and thin web/channel adapters call the same services.

**Tech Stack:** Node.js, TypeScript, SQLite (`better-sqlite3`), Express, Vitest, existing vanilla admin dashboard modules, GitHub GraphQL Projects v2 API, existing channel adapters and coding-job runtime.

## Global Constraints

- GitHub Projects v2 is the only authoritative workflow-state source.
- The first slice supports one Project, one single-select field, and exactly one linear `planning -> implement -> review` mapping.
- Planning, Implement, and Review use separately assigned Agent Profiles; Implement and Review cannot share a profile.
- Every stage completion creates a decision proposal. No agent may update the GitHub field directly.
- Web, WhatsApp, Discord, Slack, Signal, and Telegram use one command, authorization, idempotency, and audit path.
- CLI executable names come from an allowlisted adapter registry; profile input never accepts arbitrary paths or shell fragments.
- A write-capable fallback requires explicit approval and visibly records the actual CLI/provider/model.
- Implementation and review use separate managed worktrees. Review requires a pushed branch and open PR.
- Credentials remain outside agent containers and worktrees.
- No unattended merge, issue closure, release, deployment, or automatic worktree deletion is included.
- All implementation work is performed by subagents in isolated worktrees, using TDD and two-stage review.
- Every task below gets a child issue, named `feature/109-<slice>` branch, focused commit(s), push, and PR to the current integration branch. Merge a dependency before starting the next dependent worktree.

## File And Responsibility Map

| File | Responsibility |
| --- | --- |
| `src/types.ts` | Shared Agent Profile runtime types only; control-plane domain types stay out of this general file. |
| `src/agent-profiles.ts` | Validate and persist profile instructions, stage roles, CLI choice, fallbacks, repo scopes, and concurrency. |
| `src/agent-runtime-registry.ts` | Allowlisted CLI definitions, discovery, health probes, model/runtime validation, and invocation metadata. |
| `src/control-plane/types.ts` | Pipeline, stage, snapshot, run attribution, and decision contracts. |
| `src/control-plane/store.ts` | SQLite mappings and transactional persistence for control-plane records. |
| `src/control-plane/pipelines.ts` | Pipeline validation, assignment resolution, and dispatch-key construction. |
| `src/control-plane/github-projects.ts` | GitHub Projects v2 reads, field writes, read-back verification, pagination, and conflict errors. |
| `src/control-plane/sync.ts` | Reconcile GitHub snapshots and idempotently identify dispatchable stages. |
| `src/control-plane/decisions.ts` | Create and resolve approve/reject/revise/reassign/fallback gates. |
| `src/control-plane/dispatcher.ts` | Convert approved stage work into profile-attributed coding jobs. |
| `src/control-plane/commands.ts` | Shared status/follow-up/mutation command parsing and execution for web/channels. |
| `src/coding-jobs.ts` | Add stage/run attribution and enforce worktree, push, PR, cancellation, and cleanup evidence. |
| `src/admin/routes/control-plane.ts` | Thin HTTP adapter over control-plane services. |
| `src/admin/public/pages/control-plane.js` | Agents, Pipelines, Board, Runs, Decisions, and Settings UI. |
| `src/index.ts` | Route normalized incoming channel text through the shared control-plane command service before normal agent invocation. |
| `docs/AGENT_PROFILES.md` | Document enforceable coding-runtime fields and decision-gated stage behavior. |
| `docs/CAPABILITIES.md` | Record the wired control-plane route and channel command surface. |
| `docs/USER_GUIDE.md` | Operator setup and end-to-end workflow. |
| `docs/ROADMAP.md` | Mark only evidence-backed slices complete. |

---

### Task 1: Agent Runtime Profiles And Allowlisted CLI Registry

**PR slice:** Child issue “Control plane: agent runtime profiles and CLI registry”; branch `feature/109-agent-runtime-registry`.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/agent-profiles.ts`
- Modify: `src/db.ts`
- Create: `src/agent-runtime-registry.ts`
- Test: `src/agent-profiles.test.ts`
- Create: `src/agent-runtime-registry.test.ts`
- Modify: `src/admin/routes/agent-profiles.ts`
- Test: `src/admin/routes/agent-profiles.test.ts`

**Interfaces:**
- Produces: `AgentCliId`, `AgentStageRole`, `AgentRuntimeSelection`, `AgentRuntimeHealth`, `listAgentRuntimeDefinitions()`, `probeAgentRuntime(cli)`, and extended `AgentProfile` fields.
- Consumes: existing `AgentProvider`, provider/model validation, profile CRUD, SQLite initialization, and route patterns.

- [ ] **Step 1: Create the child issue, move it to `In progress`, and dispatch a fresh implementation subagent in a new isolated worktree**

Use parent `#109`, target the current integration branch (`main` unless it changes), record the worktree/branch/PR state, and require the subagent to return red/green commands plus changed paths. Do not let the worker edit the planning worktree.

- [ ] **Step 2: Write failing profile and registry tests**

Add test cases equivalent to:

```ts
it('rejects arbitrary CLI executable paths', () => {
  expect(() =>
    buildAgentProfile({
      handle: 'forge',
      displayName: 'Forge',
      primaryRuntime: {
        cli: '/tmp/run-anything',
        provider: 'codex',
        model: 'gpt-5.4',
      },
      stageRoles: ['implement'],
    }),
  ).toThrow(/CLI is not supported/i);
});

it('preserves an ordered fallback chain', () => {
  const profile = buildAgentProfile({
    handle: 'forge',
    displayName: 'Forge',
    instructions: 'Implement only an approved plan.',
    primaryRuntime: { cli: 'codex', provider: 'codex', model: 'gpt-5.4' },
    fallbackRuntimes: [
      { cli: 'claude', provider: 'claude', model: 'claude-sonnet-4-6' },
    ],
    stageRoles: ['implement'],
    repositoryScopes: ['henrikogaard/nanocrab'],
    maxConcurrency: 1,
  });
  expect(profile.fallbackRuntimes.map((runtime) => runtime.cli)).toEqual([
    'claude',
  ]);
});

it('reports missing and healthy allowlisted runtimes', async () => {
  const execFile = vi
    .fn()
    .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    .mockResolvedValueOnce({ stdout: 'codex-cli 1.2.3\n', stderr: '' });
  await expect(probeAgentRuntime('pi', { execFile })).resolves.toMatchObject({
    cli: 'pi',
    status: 'missing',
  });
  await expect(probeAgentRuntime('codex', { execFile })).resolves.toMatchObject({
    cli: 'codex',
    status: 'healthy',
  });
});
```

- [ ] **Step 3: Run the focused tests and prove red**

Run:

```bash
npx vitest run src/agent-profiles.test.ts src/agent-runtime-registry.test.ts src/admin/routes/agent-profiles.test.ts
```

Expected: failures because the new runtime fields and registry do not exist.

- [ ] **Step 4: Add the exact shared profile/runtime types**

Extend the profile contract with:

```ts
export const AGENT_CLI_IDS = [
  'claude',
  'codex',
  'pi',
  'opencode',
  'devin',
  'mistral',
] as const;
export type AgentCliId = (typeof AGENT_CLI_IDS)[number];
export type AgentStageRole = 'planning' | 'implement' | 'review';

export interface AgentRuntimeSelection {
  cli: AgentCliId;
  provider: AgentProvider;
  model: string;
}

export interface AgentRuntimeHealth {
  cli: AgentCliId;
  executable: string;
  status: 'healthy' | 'missing' | 'unsupported' | 'unauthenticated' | 'error';
  version: string | null;
  checkedAt: string;
  detail: string;
}
```

Add `instructions`, `primaryRuntime`, `fallbackRuntimes`, `stageRoles`,
`repositoryScopes`, and `maxConcurrency` to `AgentProfile` and its input type.
Use JSON text columns for arrays/objects, a non-null integer default of `1` for
concurrency, and migration-safe defaults for existing rows.

- [ ] **Step 5: Implement the allowlisted registry without shell evaluation**

Define immutable adapters with exact executable/version arguments and invoke
them through promisified `execFile`:

```ts
const RUNTIMES: Record<AgentCliId, AgentRuntimeDefinition> = {
  claude: { cli: 'claude', executable: 'claude', versionArgs: ['--version'], codingRunnerSupported: true },
  codex: { cli: 'codex', executable: 'codex', versionArgs: ['--version'], codingRunnerSupported: true },
  pi: { cli: 'pi', executable: 'pi', versionArgs: ['--version'], codingRunnerSupported: false },
  opencode: { cli: 'opencode', executable: 'opencode', versionArgs: ['--version'], codingRunnerSupported: true },
  devin: { cli: 'devin', executable: 'devin', versionArgs: ['--version'], codingRunnerSupported: false },
  mistral: { cli: 'mistral', executable: 'vibe', versionArgs: ['--version'], codingRunnerSupported: false },
};
```

Return structured health; never accept executable or args from profile input.
Validate provider/model through existing provider definitions while allowing a
registry adapter to report “unsupported by current runner” distinctly from
“executable missing”.

- [ ] **Step 6: Wire CRUD and health routes, then prove green**

Add `GET /api/agent-profiles/runtime-health` before the `/:id` route. Ensure
create/update round-trips all new fields and old profiles receive safe defaults.

Run:

```bash
npx vitest run src/agent-profiles.test.ts src/agent-runtime-registry.test.ts src/admin/routes/agent-profiles.test.ts
npm run typecheck
```

Expected: focused suites and typecheck pass.

- [ ] **Step 7: Run two-stage review, commit, push, and open the PR**

First dispatch a spec-compliance reviewer, then a code-quality reviewer. Fix
validated findings with another red/green cycle. Stage only the listed files,
commit with `feat: add agent runtime profiles`, push, open a PR linked to the
child issue and `#109`, include verification evidence, and move the child issue
to `In review`.

---

### Task 2: Pipeline Domain And SQLite Persistence

**PR slice:** Child issue “Control plane: pipeline domain and persistence”; branch `feature/109-pipeline-domain`.

**Files:**
- Create: `src/control-plane/types.ts`
- Create: `src/control-plane/store.ts`
- Create: `src/control-plane/pipelines.ts`
- Create: `src/control-plane/store.test.ts`
- Create: `src/control-plane/pipelines.test.ts`
- Modify: `src/db.ts`
- Test: `src/db-migration.test.ts`

**Interfaces:**
- Consumes: `AgentProfile`, `AgentStageRole`, `getAgentProfile()`.
- Produces: `DeliveryPipeline`, `PipelineStage`, `StageAssignment`, `ProjectItemSnapshot`, `createPipeline()`, `validatePipeline()`, `resolveStageAssignment()`, and `buildStageDispatchKey()`.

- [ ] **Step 1: After Task 1 merges, create the child issue and isolated subagent worktree from the updated integration branch**

Record dependency on Task 1 and move only this child issue to `In progress`.

- [ ] **Step 2: Write failing migration, validation, and idempotency tests**

Cover exactly:

```ts
it('requires one planning, implement, and review stage', () => {
  expect(() => validatePipeline(pipelineWith(['planning', 'implement']))).toThrow(
    /exactly one planning, implement, and review/i,
  );
});

it('rejects the same profile for implement and review', () => {
  expect(() =>
    validatePipeline(pipelineWithAgents({ implement: 'agent_forge', review: 'agent_forge' })),
  ).toThrow(/implement and review agents must differ/i);
});

it('uses stable GitHub option ids in the dispatch key', () => {
  expect(
    buildStageDispatchKey({
      pipelineId: 'pipeline_1',
      projectItemId: 'PVTI_1',
      issueNodeId: 'I_1',
      stageId: 'stage_plan',
      agentProfileId: 'agent_atlas',
      githubFieldUpdatedAt: '2026-07-12T10:00:00.000Z',
    }),
  ).toBe(
    'pipeline_1:PVTI_1:I_1:stage_plan:agent_atlas:2026-07-12T10:00:00.000Z',
  );
});
```

Verify migration from a database containing the pre-control-plane
`agent_profiles` table and that unique constraints prevent duplicate Project
bindings and duplicate `(pipeline_id, github_field_option_id)` mappings.

- [ ] **Step 3: Run focused tests and prove red**

Run:

```bash
npx vitest run src/control-plane/store.test.ts src/control-plane/pipelines.test.ts src/db-migration.test.ts
```

Expected: missing module/table/type failures.

- [ ] **Step 4: Define focused domain contracts**

Use these core shapes:

```ts
export type PipelineStageKind = 'planning' | 'implement' | 'review';

export interface DeliveryPipeline {
  id: string;
  name: string;
  githubOwner: string;
  githubProjectNumber: number;
  githubProjectId: string;
  workflowFieldId: string;
  repositoryScopes: string[];
  enabled: boolean;
  syncCursor: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStage {
  id: string;
  pipelineId: string;
  githubFieldOptionId: string;
  githubFieldOptionName: string;
  stageKind: PipelineStageKind;
  agentProfileId: string;
  requiredEvidence: Array<'plan' | 'tests' | 'pushed_branch' | 'open_pr' | 'review'>;
  position: number;
}
```

Add separate tables for pipelines, stages, issue-specific assignments, Project
item snapshots, and stage dispatch records. Keep SQL and row mapping in
`store.ts`; keep validation and assignment rules in `pipelines.ts`.

- [ ] **Step 5: Implement validation, persistence, and assignment resolution**

Validate GitHub ids as opaque non-empty strings, owner/repository syntax,
exactly three stages in the fixed order, stage-role compatibility, enabled
profiles, distinct Implement/Review profiles, and repository scope. Resolve an
issue-specific assignment before the stage default. Insert a dispatch record in
the same transaction that claims a key so concurrent polls cannot both win.

- [ ] **Step 6: Prove green and migration safety**

Run:

```bash
npx vitest run src/control-plane/store.test.ts src/control-plane/pipelines.test.ts src/db-migration.test.ts
npm run typecheck
```

Expected: all pass with existing profile rows preserved.

- [ ] **Step 7: Review, commit, push, and PR**

Run both reviewer gates, fix findings, commit `feat: add control plane pipeline domain`, push, create the linked PR, and move the child issue to `In review`.

---

### Task 3: GitHub Projects V2 Synchronization And Conflict-Safe Mutation

**PR slice:** Child issue “Control plane: GitHub Projects v2 synchronization”; branch `feature/109-github-project-sync`.

**Files:**
- Create: `src/control-plane/github-projects.ts`
- Create: `src/control-plane/github-projects.test.ts`
- Create: `src/control-plane/sync.ts`
- Create: `src/control-plane/sync.test.ts`
- Modify: `src/coding-jobs.ts`
- Test: `src/coding-jobs.test.ts`

**Interfaces:**
- Consumes: pipeline/store contracts and the existing GitHub token loading pattern.
- Produces: `GitHubProjectClient`, `readProjectConfiguration()`, `listProjectItems()`, `updateProjectItemStage()`, `syncPipeline()`, `StageConflictError`, and dispatch candidates.

- [ ] **Step 1: Create the dependent child issue and isolated subagent worktree after Task 2 merges**

- [ ] **Step 2: Write failing GraphQL pagination, rename/delete, conflict, read-back, and dedupe tests**

Use an injected `graphql` transport and fixtures. Include:

```ts
it('refuses to overwrite a newer GitHub stage', async () => {
  client.readProjectItem.mockResolvedValue(
    itemSnapshot({ optionId: 'review', fieldUpdatedAt: '2026-07-12T11:00:00.000Z' }),
  );
  await expect(
    service.updateProjectItemStage({
      projectId: 'PVT_1',
      itemId: 'PVTI_1',
      fieldId: 'PVTSSF_1',
      optionId: 'implement',
      expectedOptionId: 'planning',
      expectedFieldUpdatedAt: '2026-07-12T10:00:00.000Z',
    }),
  ).rejects.toBeInstanceOf(StageConflictError);
  expect(client.updateProjectV2ItemFieldValue).not.toHaveBeenCalled();
});

it('verifies a field mutation by reading it back', async () => {
  client.readProjectItem
    .mockResolvedValueOnce(itemSnapshot({ optionId: 'planning' }))
    .mockResolvedValueOnce(itemSnapshot({ optionId: 'implement' }));
  await expect(service.updateProjectItemStage(validMutation)).resolves.toMatchObject({
    workflowOptionId: 'implement',
  });
});
```

Also prove two concurrent `syncPipeline()` calls produce one dispatch candidate
claim for the same GitHub revision.

- [ ] **Step 3: Run focused tests and prove red**

Run:

```bash
npx vitest run src/control-plane/github-projects.test.ts src/control-plane/sync.test.ts src/coding-jobs.test.ts
```

- [ ] **Step 4: Implement a typed Projects v2 client**

Use GraphQL variables for owner/login, project number, cursors, field ids, item
ids, and option ids. Parse only Issue content; ignore draft issues and PR items
in the first slice. Paginate fields/options/items, retain node ids, and surface
permission/rate-limit errors without converting them into empty Projects.

`updateProjectItemStage()` must read current state, compare expected option and
revision, mutate through `updateProjectV2ItemFieldValue`, then read back and
compare the requested option.

- [ ] **Step 5: Implement synchronization and dispatch candidate claiming**

`syncPipeline()` must update display snapshots, flag deleted mapped options as
configuration errors, preserve renamed labels while matching ids, and claim a
dispatch key transactionally. It must return candidates rather than starting
jobs directly:

```ts
export interface StageDispatchCandidate {
  dispatchKey: string;
  pipelineId: string;
  stageId: string;
  projectItemId: string;
  issueNodeId: string;
  repository: string;
  issueNumber: number;
  agentProfileId: string;
  observedOptionId: string;
  observedFieldUpdatedAt: string;
}
```

- [ ] **Step 6: Prove green, including existing GitHub coding behavior**

Run:

```bash
npx vitest run src/control-plane/github-projects.test.ts src/control-plane/sync.test.ts src/coding-jobs.test.ts
npm run typecheck
```

- [ ] **Step 7: Review, commit, push, and PR**

Complete both review gates, commit `feat: sync GitHub project stages`, push,
open the linked PR with GraphQL fixture evidence, and move the child issue to
`In review`.

---

### Task 4: Decision Gates, Stage Dispatch, And Runtime Fallback Approval

**PR slice:** Child issue “Control plane: decision gates and stage dispatch”; branch `feature/109-decision-gates`.

**Files:**
- Create: `src/control-plane/decisions.ts`
- Create: `src/control-plane/decisions.test.ts`
- Create: `src/control-plane/dispatcher.ts`
- Create: `src/control-plane/dispatcher.test.ts`
- Modify: `src/control-plane/store.ts`
- Modify: `src/approvals.ts`
- Test: `src/approvals.test.ts`
- Modify: `src/coding-jobs.ts`
- Test: `src/coding-jobs.test.ts`

**Interfaces:**
- Consumes: dispatch candidates, profile runtime health, pipeline assignments, GitHub mutation, `startCodingJob()`, existing approval/audit services.
- Produces: `ControlPlaneDecision`, `proposeStageTransition()`, `resolveDecision()`, `dispatchCandidate()`, and `requestRuntimeFallback()`.

- [ ] **Step 1: Create the dependent child issue and isolated subagent worktree after Task 3 merges**

- [ ] **Step 2: Write failing decision state-machine tests**

Cover concurrent terminal decisions, stale GitHub state, revision feedback,
issue-specific reassignment, unauthorized actor, same-profile review, and
fallback approval:

```ts
it('allows exactly one terminal decision', async () => {
  const [first, second] = await Promise.allSettled([
    resolveDecision('decision_1', { action: 'approve', actor: owner }),
    resolveDecision('decision_1', { action: 'reject', actor: owner, note: 'No' }),
  ]);
  expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
});

it('revision keeps the GitHub stage and resumes with feedback', async () => {
  const result = await resolveDecision('decision_1', {
    action: 'revise',
    actor: owner,
    note: 'Add rollback tests.',
  });
  expect(github.updateProjectItemStage).not.toHaveBeenCalled();
  expect(dispatcher.resumeStage).toHaveBeenCalledWith(
    expect.objectContaining({ feedback: 'Add rollback tests.' }),
  );
  expect(result.status).toBe('revised');
});

it('blocks write-capable fallback until approved', async () => {
  runtime.probe.mockResolvedValue({ status: 'missing' });
  const result = await dispatchCandidate(candidate);
  expect(result.status).toBe('awaiting_fallback_approval');
  expect(startCodingJob).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run focused tests and prove red**

Run:

```bash
npx vitest run src/control-plane/decisions.test.ts src/control-plane/dispatcher.test.ts src/approvals.test.ts src/coding-jobs.test.ts
```

- [ ] **Step 4: Implement durable decisions and atomic terminal resolution**

Use:

```ts
export type ControlPlaneDecisionAction =
  | 'approve'
  | 'reject'
  | 'revise'
  | 'reassign';

export interface ControlPlaneDecision {
  id: string;
  kind: 'stage_transition' | 'runtime_fallback';
  status: 'pending' | 'approved' | 'rejected' | 'revised' | 'reassigned' | 'stale';
  pipelineId: string;
  projectItemId: string;
  issueNodeId: string;
  issueNumber: number;
  stageId: string;
  runId: string | null;
  proposedStageId: string | null;
  proposedAgentProfileId: string | null;
  proposedRuntime: AgentRuntimeSelection | null;
  expectedGithubOptionId: string;
  expectedGithubFieldUpdatedAt: string;
  summary: string;
  evidence: Record<string, unknown>;
  decidedBy: string | null;
  decidedFrom: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}
```

Resolve status with a conditional SQL update from `pending`; zero changed rows
means stale/already decided. Authorize before mutation. Approval refreshes and
writes GitHub, verifies it, records the decision, then dispatches next stage.
If dispatch fails after a verified GitHub transition, preserve a visible
`dispatch_failed` stage record for retry; never roll GitHub backward silently.

- [ ] **Step 5: Implement profile-attributed dispatch and fallback gates**

Build the stage prompt from issue context, approved prior-stage artifact,
profile instructions/personality, evidence contract, and repository rules.
Planning is read-only. Implement/Review set `createPr` per stage contract and
pass pipeline/stage/decision attribution into `StartCodingJobInput`. Probe the
primary CLI first. If unavailable, create one fallback decision for the first
configured healthy alternative; do not cascade without another recorded gate.

- [ ] **Step 6: Prove green and verify audit evidence**

Run:

```bash
npx vitest run src/control-plane/decisions.test.ts src/control-plane/dispatcher.test.ts src/approvals.test.ts src/coding-jobs.test.ts src/audit-log.test.ts
npm run typecheck
```

- [ ] **Step 7: Review, commit, push, and PR**

Run spec and quality reviewers, commit `feat: add control plane decision gates`,
push, create the linked PR, and move the child issue to `In review`.

---

### Task 5: Managed Worktree Evidence And Review Preconditions

**PR slice:** Child issue “Control plane: managed worktree and PR evidence”; branch `feature/109-worktree-evidence`.

**Files:**
- Modify: `src/coding-jobs.ts`
- Test: `src/coding-jobs.test.ts`
- Modify: `src/container-runner.ts`
- Test: `src/container-runner.test.ts`
- Create: `src/control-plane/run-evidence.ts`
- Create: `src/control-plane/run-evidence.test.ts`

**Interfaces:**
- Consumes: attributed coding jobs and decision evidence contracts.
- Produces: `StageRunEvidence`, `validateStageCompletion()`, cancellation preservation, and cleanup guards.

- [ ] **Step 1: Create the child issue and isolated subagent worktree after Task 4 merges**

- [ ] **Step 2: Write failing worktree and completion-evidence tests**

Cover unique worktrees for Implement/Review, different agent profiles,
unpushed branch, missing PR, failed checks, cancellation, and cleanup refusal:

```ts
it('refuses review transition without a pushed branch and PR', () => {
  expect(() =>
    validateStageCompletion({
      stageKind: 'implement',
      worktree: '/data/coding-workspaces/job_1',
      branch: 'feature/109-slice',
      commitSha: 'abc123',
      pushed: false,
      prUrl: null,
      checks: [{ name: 'focused', status: 'passed' }],
    }),
  ).toThrow(/pushed branch and open PR/i);
});

it('preserves a cancelled run with an unpushed branch', async () => {
  await cancelCodingJob('job_1', 'owner');
  expect(removeWorktree).not.toHaveBeenCalled();
  expect(getCodingJob('job_1')).toMatchObject({ status: 'cancelled' });
});
```

- [ ] **Step 3: Run focused tests and prove red**

Run:

```bash
npx vitest run src/control-plane/run-evidence.test.ts src/coding-jobs.test.ts src/container-runner.test.ts
```

- [ ] **Step 4: Add explicit stage evidence and cleanup guards**

Use:

```ts
export interface StageRunEvidence {
  stageKind: PipelineStageKind;
  worktree: string;
  branch: string;
  commitSha: string | null;
  pushed: boolean;
  prUrl: string | null;
  checks: Array<{ name: string; status: 'passed' | 'failed' | 'skipped'; detail?: string }>;
  artifacts: Array<{ kind: string; pathOrUrl: string }>;
}
```

Implement requires worktree, branch, commit, pushed branch, open PR, and no
failed required check. Review requires a different worktree/profile and a
review artifact. Cleanup returns a structured blocked reason while a run is
active, a decision is pending, a branch is unpushed, or a PR remains open.

- [ ] **Step 5: Preserve process groups, logs, branch, and worktree on cancellation**

Terminate the owned process group, mark the job cancelled, append audit/history,
and leave workspace artifacts intact. Add an explicit later cleanup operation;
do not attach it to cancellation.

- [ ] **Step 6: Prove green and run the existing coding-job regression suite**

Run:

```bash
npx vitest run src/control-plane/run-evidence.test.ts src/coding-jobs.test.ts src/container-runner.test.ts src/coding-commands.test.ts
npm run typecheck
```

- [ ] **Step 7: Review, commit, push, and PR**

Complete both reviewer gates, commit `feat: enforce control plane run evidence`,
push, open the linked PR, and move the child issue to `In review`.

---

### Task 6: Control Plane HTTP API And Web UI

**PR slice:** Child issue “Control plane: web management UI”; branch `feature/109-control-plane-ui`.

**Files:**
- Create: `src/admin/routes/control-plane.ts`
- Create: `src/admin/routes/control-plane.test.ts`
- Modify: `src/admin/index.ts`
- Create: `src/admin/public/pages/control-plane.js`
- Create: `src/admin/control-plane-ui.test.ts`
- Modify: `src/admin/public/index.html`
- Modify: `src/admin/public/styles.css`
- Modify: `src/admin/public/app.js`
- Modify: `src/admin/public/mock-api.js`
- Modify: `src/admin/mock-server.ts`

**Interfaces:**
- Consumes: Agent Profile CRUD/health, pipeline/sync/decision/run services.
- Produces: `/api/control-plane/*` routes and `#/control-plane` UI.

- [ ] **Step 1: Create the child issue and isolated UI subagent worktree after Task 5 merges**

- [ ] **Step 2: Write failing route and source-level UI tests**

Route tests must prove validation/status semantics for:

```text
GET    /api/control-plane/overview
GET    /api/control-plane/runtimes
GET    /api/control-plane/pipelines
POST   /api/control-plane/pipelines
PUT    /api/control-plane/pipelines/:id
POST   /api/control-plane/pipelines/:id/sync
GET    /api/control-plane/runs
GET    /api/control-plane/decisions
POST   /api/control-plane/decisions/:id/approve
POST   /api/control-plane/decisions/:id/reject
POST   /api/control-plane/decisions/:id/revise
POST   /api/control-plane/decisions/:id/reassign
```

UI tests must assert the page contains six navigable sections, separate loading/
empty/error states, agent/CLI/model labels on cards, decision actions, and no
inline transition logic duplicated from the backend.

- [ ] **Step 3: Run focused tests and prove red**

Run:

```bash
npx vitest run src/admin/routes/control-plane.test.ts src/admin/control-plane-ui.test.ts src/admin/app-shell-ui.test.ts
```

- [ ] **Step 4: Add thin routes with exact status behavior**

Use `201` for creates, `200` for reads/updates/decision results, `400` for input
validation, `401/403` for authentication/authorization, `404` for unknown ids,
`409` for stale GitHub/decision conflicts, and `503` for unavailable GitHub or
runtime dependencies. Routes call services and never execute GraphQL, SQL, or
stage transitions directly.

- [ ] **Step 5: Build the six-section page using existing dashboard patterns**

Implement Overview/Board, Agents, Pipelines, Runs, Decisions, and Settings. Use
the existing modal/form/status helpers and CSS tokens. Board cards display issue,
repo, stage, current agent, actual CLI/provider/model, run, decision, checks,
branch, and PR. The agent editor exposes identity, instructions, personality,
primary runtime, ordered fallbacks, stage roles, capabilities, repository scope,
safety, enable state, clone, and runtime test.

Decision actions must submit the decision id plus note/agent as applicable,
disable while pending, handle `409` by refreshing, and announce success/failure
through the existing accessible status region.

- [ ] **Step 6: Add complete mock data and browser-verifiable states**

Mock at least three agents (`Atlas` planner/Claude, `Forge` implementer/Codex,
`Lens` reviewer/Devin), one configured pipeline, one issue in each stage, one
pending transition, one runtime fallback gate, one failed sync, and one empty
state. Do not make mock responses claim behavior the real routes do not expose.

- [ ] **Step 7: Prove green, build, and perform browser QA**

Run:

```bash
npx vitest run src/admin/routes/control-plane.test.ts src/admin/control-plane-ui.test.ts src/admin/app-shell-ui.test.ts src/admin/agents-ui.test.ts
npm run typecheck
npm run build
```

Then run the mock admin server and verify create/edit/clone/test agent, pipeline
mapping, stage cards, decision actions, stale conflict refresh, runtime fallback,
responsive layout, keyboard operation, and visible focus. Capture screenshots
or a concise browser evidence log in the PR.

- [ ] **Step 8: Review, commit, push, and PR**

Dispatch spec and UI-quality reviewers, fix findings, commit `feat: add AI control plane UI`, push, create the linked PR, and move the child issue to `In review`.

---

### Task 7: Shared Channel Command Service And Five-Channel Parity

**PR slice:** Child issue “Control plane: bot channel command parity”; branch `feature/109-control-plane-channels`.

**Files:**
- Create: `src/control-plane/commands.ts`
- Create: `src/control-plane/commands.test.ts`
- Modify: `src/index.ts`
- Test: `src/index.test.ts`
- Modify: `src/router.ts`
- Test: `src/router.test.ts`
- Test: `src/channels/whatsapp.test.ts`
- Test: `src/channels/discord.test.ts`
- Test: `src/channels/slack.test.ts`
- Test: `src/channels/signal.test.ts`
- Test: `src/channels/telegram.test.ts`

**Interfaces:**
- Consumes: pipeline/status/decision/run services and existing normalized message/sender/group data.
- Produces: `parseControlPlaneCommand()`, `executeControlPlaneCommand()`, portable text replies, and optional channel action descriptors.

- [ ] **Step 1: Create the child issue and isolated channel subagent worktree after Task 6 merges**

- [ ] **Step 2: Write failing parser, authorization, ambiguity, idempotency, and adapter-parity tests**

Use a structured contract:

```ts
export type ControlPlaneCommand =
  | { action: 'status'; repository?: string; issueNumber: number }
  | { action: 'show_plan'; repository?: string; issueNumber: number }
  | { action: 'show_decision'; repository?: string; issueNumber: number }
  | { action: 'approve'; repository?: string; issueNumber: number; targetStage?: string }
  | { action: 'reject' | 'revise'; repository?: string; issueNumber: number; note: string }
  | { action: 'reassign'; repository?: string; issueNumber: number; stage: PipelineStageKind; agentHandle: string }
  | { action: 'pause' | 'cancel'; repository?: string; issueNumber: number };
```

Assert `status #128`, `approve #128 to implement`,
`revise #128: add rollback tests`, and
`reassign #128 implement to @Forge`. Assert ambiguous issue numbers return
candidate repositories, unauthorized mutations do not call services, stale
decisions return current state, and repeated channel message ids resolve once.

For each of five adapters, feed a normalized authorized message and verify it
reaches the shared executor with the same actor/source/message id contract.

- [ ] **Step 3: Run focused tests and prove red**

Run:

```bash
npx vitest run src/control-plane/commands.test.ts src/index.test.ts src/router.test.ts src/channels/whatsapp.test.ts src/channels/discord.test.ts src/channels/slack.test.ts src/channels/signal.test.ts src/channels/telegram.test.ts
```

- [ ] **Step 4: Implement the shared parser and executor**

Parse explicit commands deterministically before optional natural-language
intent routing. Resolve issue references against the connected pipeline. Read
commands may be available to configured viewers; approve/reject/revise/reassign/
pause/cancel require an authorized operator mapping from the source channel.
Pass `{ channel, chatJid, senderId, messageId }` into decision audit and dedupe.

Return a channel-neutral response:

```ts
export interface ControlPlaneCommandResult {
  text: string;
  decisionId: string | null;
  actions: Array<{
    id: 'approve' | 'reject' | 'revise' | 'reassign';
    label: string;
    enabled: boolean;
  }>;
}
```

Text is the portable contract. Slack/Discord/Telegram buttons may be added only
as renderers over these actions; WhatsApp/Signal remain fully functional with
text replies.

- [ ] **Step 5: Route normalized channel messages once in `src/index.ts`**

Detect a control-plane command after group trigger/auth normalization and before
normal agent invocation. On match, execute and send the result through the
existing router. Do not add workflow branching to individual adapter classes.
Record message id before mutation so retries cannot duplicate actions.

- [ ] **Step 6: Prove green and manually verify all five channels**

Run the focused command/adapter suites and `npm run typecheck`. In configured
test channels, verify `status`, `show plan`, approve, revise, reassign, stale
decision, unauthorized sender, and ambiguous issue behavior. Record channel,
command, result, and decision/audit id without storing private message content.

- [ ] **Step 7: Review, commit, push, and PR**

Complete both reviewer gates, commit `feat: control coding stages from bot channels`, push, open the linked PR with five-channel evidence, and move the child issue to `In review`.

---

### Task 8: End-To-End Proof, Documentation, And Epic Readiness

**PR slice:** Child issue “Control plane: end-to-end proof and documentation”; branch `feature/109-control-plane-closeout`.

**Files:**
- Create: `src/control-plane/control-plane.integration.test.ts`
- Modify: `docs/AGENT_PROFILES.md`
- Modify: `docs/CAPABILITIES.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `docs/ROADMAP.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all merged control-plane services, routes, UI, coding-job, and channel contracts.
- Produces: full vertical-slice evidence and operator documentation.

- [ ] **Step 1: Create the final child issue and isolated verification subagent worktree after Tasks 1-7 merge**

The subagent is responsible for evidence and docs only; product gaps discovered
here become fixes on the owning earlier slice or explicit follow-up issues.

- [ ] **Step 2: Write the end-to-end integration test before adjusting integration glue**

The fixture must:

1. Create Atlas/Claude planning, Forge/Codex implementation, and Lens/Devin review profiles.
2. Create a pipeline mapped by stable GitHub option ids.
3. Synchronize an issue in Planning and dispatch Atlas exactly once.
4. Store a plan artifact and create a pending Implement decision.
5. Approve through `executeControlPlaneCommand()` and verify the GitHub field write/read-back occurs before Forge dispatch.
6. Record isolated worktree, passing test, pushed branch, and PR evidence.
7. Approve Review and verify Lens receives a different profile and worktree.
8. Reject a stale duplicate command and prove no duplicate job exists.

Use injected GitHub/runtime/job transports; do not require live GitHub for the
automated integration suite.

- [ ] **Step 3: Run the integration test and prove any missing glue red**

Run:

```bash
npx vitest run src/control-plane/control-plane.integration.test.ts
```

Expected before final glue: fail at the first incomplete cross-service handoff.

- [ ] **Step 4: Add only the minimal integration glue required for green**

Keep service ownership intact. Do not move SQL/GraphQL/transition logic into the
test, HTTP route, UI, or channel adapter. If a public interface must change,
update its focused unit tests first.

- [ ] **Step 5: Update operator and product documentation with exact behavior**

Document CLI health/fallback meaning, agent fields, pipeline mapping, decision
actions, channel commands, authorization, GitHub conflict recovery, worktree/PR
requirements, cancellation preservation, and explicit non-goals. Mark roadmap
items complete only when their acceptance evidence exists. Add the Control Plane
route/commands to `docs/CAPABILITIES.md` using its wired-capability definition.

- [ ] **Step 6: Run the complete verification matrix**

Run:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Then run browser QA against the real admin server, one live GitHub Project test
issue, and all five requested bot channels. Preserve issue/Project before/after
state, agent/runtime attribution, decision ids, worktree/branch/PR evidence,
checks, and conflicts/retry behavior. Do not merge, close, release, or deploy.

- [ ] **Step 7: Cross-check every `#109` acceptance criterion**

Post a compact checklist to the child issue and parent epic linking each
criterion to code, test, browser/channel evidence, and PR. Any unmet subjective,
credential, or live-channel criterion stays open and keeps `#109` out of Done.

- [ ] **Step 8: Review, commit, push, and PR**

Run spec-compliance and quality/documentation reviewers. Commit
`docs: document AI coding control plane`, push, create the linked PR, and move
the child issue to `In review`.

- [ ] **Step 9: Reconcile the epic only after all child PRs merge**

Verify integration branch, merged PRs, CI, Project status, and live evidence.
If every criterion is evidence-backed, comment on `#109` and move it to `Done`/
close it under the repo workflow. If any criterion depends on missing credentials,
subjective QA, live channel access, or external signoff, leave `#109` in
`In review` and name the exact remaining gate.

## Verification Targets

| Target | Required evidence |
| --- | --- |
| Profile/runtime contract | CRUD round-trip, migration, allowlist rejection, CLI health, ordered fallback tests |
| Pipeline domain | Three-stage validation, distinct Implement/Review profiles, stable option ids, transactional dispatch claim |
| GitHub Projects | Pagination, rename/delete, conflict, mutation read-back, permission/rate-limit, duplicate sync tests |
| Decisions | Authorization, concurrent action, stale state, approve/reject/revise/reassign, fallback-gate tests |
| Worktrees/PR | Separate worktrees/profiles, push and PR precondition, cancellation preservation, cleanup guards |
| Web UI | Route tests, source tests, build, responsive and keyboard browser QA, real decision conflict refresh |
| Bot channels | Shared parser/executor tests plus authorized/unauthorized/stale/ambiguous QA on all five channels |
| End-to-end | Planning through Review with distinct agents/runtimes, GitHub read-back, isolated PR evidence, dedupe |

## Done Means

- Parent epic `#109` has dependency-ordered child issues and linked PRs.
- Every implementation task ran through a fresh subagent in its own isolated worktree with two-stage review.
- All intended changes are committed on named branches, pushed, and represented by PRs to the current integration branch.
- The full automated verification matrix passes, or any skipped command is explicitly justified with residual risk.
- Browser, GitHub Project, worktree/PR, and five-channel evidence is preserved.
- GitHub remains authoritative, every transition is decision-gated, actual agent/CLI/model attribution is visible, and duplicate/stale actions are safe.
- `#109` is moved to `Done` only after merged code and acceptance evidence support closure; otherwise it remains `In review` with the exact external gate recorded.
