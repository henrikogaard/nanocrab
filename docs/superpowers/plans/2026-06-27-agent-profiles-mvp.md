# Agent Profiles MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class virtual agent profiles that can be configured once, invoked from the Agents UI/web/current channels, and triggered by explicit GitHub/channel subscriptions while preserving NanoCrab's existing container and approval boundaries.

**Architecture:** Add a durable `AgentProfile` identity layer backed by SQLite, then route direct mentions and autonomous subscription detections into existing NanoCrab execution surfaces. Profiles narrow runtime capabilities and add attribution; they do not become long-running agent containers or duplicate coding jobs, scheduled tasks, sessions, approvals, or MCP permission systems.

**Tech Stack:** Node.js, TypeScript, Express, better-sqlite3, Vitest, existing NanoCrab admin frontend scripts, existing provider/router/coding-job/approval/container systems.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-06-27-agent-profiles-mvp-design.md`
- Current Agents UI: `src/admin/public/pages/agents.js`
- Current group/runtime identity: `src/types.ts`, `src/db.ts`, `src/agent-boundaries.ts`
- Current message routing: `src/index.ts`, `src/web-threads.ts`, `src/channels/*`
- Current coding jobs: `src/coding-jobs.ts`, `src/admin/routes/agents.ts`
- Current docs requiring updates after behavior exists: `README.md`, `docs/SECURITY.md`, `docs/COMMANDS.md`, `docs/USER_GUIDE.md`

## Epic Map

| Epic | Issue-sized outcome | Ship gate |
| --- | --- | --- |
| E1. Profile data model | Profiles, subscriptions, events, validation, and route-safe types exist. | Unit and route tests pass; invalid handles/provider config rejected. |
| E2. Direct invocation | `@handle` can route web/current-channel work into existing runs with profile attribution. | Web/current-channel routing tests pass; unknown/disabled handles fail visibly. |
| E3. Execution attribution | Agent tasks, coding jobs, sessions, approvals, and audit events can carry `agentProfileId`. | Coding-job tests prove attribution without bypassing approvals. |
| E4. Autonomous subscriptions | GitHub/channel subscription scanner detects work, dedupes events, and starts investigation/planning only. | Subscription tests prove dedupe, disabled-state behavior, and write gates. |
| E5. Agents cockpit UI | Agents page shows profile roster/detail tabs, subscriptions, and activity states. | UI source tests and mock/admin manual check pass without false-empty states. |
| E6. Docs and operator handoff | README/security/command/user docs explain profile model, safety, and follow-on epics. | Docs mention non-goals, approvals, and next backlog. |

## Follow-On Epic Backlog

Keep these out of the MVP implementation plan unless Henrik explicitly expands scope:

| Follow-on epic | Scope |
| --- | --- |
| Visual Office | Read-only spatial visualization fed by profile/activity data: desks, avatars, idle/running/blocked states, click-through to profile detail. |
| Slack/Discord Channels | Add channel adapters, then wire their mention metadata into the same profile router. |
| Role Templates | Preset profiles for game host, repo maintainer, researcher, inbox triage, release manager, and document drafter. |
| More Subscription Sources | Webhooks, calendar/mail connectors, report schedules, project queues, and PR review-request watchers. |
| Safe Auto-Send Policy | Profile-level opt-in for low-risk autonomous channel replies after explicit owner configuration. |

## File Structure

Create focused backend modules instead of expanding `src/index.ts` or `src/admin/routes/agents.ts` further.

| File | Responsibility |
| --- | --- |
| `src/agent-profiles.ts` | Profile/subscription domain types, validation, handle normalization, capability merge helpers, CRUD wrappers around `db.ts`. |
| `src/agent-profiles.test.ts` | Unit tests for validation, handle normalization, dedupe keys, and effective config behavior. |
| `src/agent-profile-router.ts` | Shared direct invocation resolution: parse `@handle`, resolve enabled profile, build profile run context. |
| `src/agent-profile-router.test.ts` | Tests for unknown/disabled/ambiguous/direct invocation handling. |
| `src/agent-subscription-runner.ts` | Host-side scanner for GitHub and channel mention subscriptions; starts allowed run/job types and records activity. |
| `src/agent-subscription-runner.test.ts` | Tests for GitHub/channel matching, dedupe, disabled subscriptions, and investigation-only starts. |
| `src/admin/routes/agent-profiles.ts` | `/api/agent-profiles` and subscription/activity routes. |
| `src/admin/routes/agent-profiles.test.ts` | Express route tests with isolated test DB. |
| `src/db.ts` | SQLite schema, migrations, and low-level profile/subscription/activity accessors. |
| `src/types.ts` | Shared `AgentProfile`, `AgentSubscription`, `AgentProfileActivity`, and attribution fields. |
| `src/index.ts` | Minimal hook into message routing for direct mention resolution and subscription runner startup. |
| `src/coding-jobs.ts` | Add optional `agentProfileId`, `sourceSubscriptionId`, and requested-by attribution. |
| `src/admin/routes/agents.ts` | Include profile attribution in existing task/coding-job responses where needed. |
| `src/admin/index.ts` | Mount `agent-profiles` route. |
| `src/admin/public/pages/agents.js` | Add Agent Profiles roster/detail UI inside the existing Agents cockpit. |
| `src/admin/public/style.css` | Class-driven profile roster/detail/subscription/activity styles. |
| `src/admin/mock-data.ts` | Mock profile/subscription/activity data for `npm run mock:admin`. |
| `src/admin/agents-ui.test.ts` | Source tests for profile UI states and class-driven markup. |
| `src/admin/channels-ui.test.ts` or new focused test | Confirm existing channel surfaces do not show profile false-empty states. |
| `README.md`, `docs/SECURITY.md`, `docs/COMMANDS.md`, `docs/USER_GUIDE.md` | Operator documentation after feature behavior exists. |

## Data Shapes

Use these names consistently across tasks.

```ts
export type AgentProfileToolPolicy = 'read-only' | 'approval-required' | 'allow';
export type AgentProfileTaskKind =
  | 'chat'
  | 'cowork_task'
  | 'coding_job'
  | 'report'
  | 'research'
  | 'scheduled_check';
export type AgentSubscriptionSourceType = 'github' | 'channel_mention';
export type AgentSubscriptionAutonomyMode = 'investigate_then_pause';

export interface AgentProfile {
  id: string;
  handle: string;
  displayName: string;
  avatar: string | null;
  description: string | null;
  personality: string | null;
  enabled: boolean;
  providerProfileId: string | null;
  provider: AgentProvider | null;
  model: string | null;
  toolPolicy: AgentProfileToolPolicy;
  allowedMcpServers: string[] | null;
  skills: string[];
  memoryScopes: string[];
  taskKinds: AgentProfileTaskKind[];
  channelBindings: Record<string, string[]>;
  writePolicy: {
    directSendRequiresApproval: boolean;
    autonomousSendRequiresApproval: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AgentSubscription {
  id: string;
  agentProfileId: string;
  sourceType: AgentSubscriptionSourceType;
  enabled: boolean;
  filters: Record<string, unknown>;
  taskKind: AgentProfileTaskKind;
  autonomyMode: AgentSubscriptionAutonomyMode;
  lastSeenAt: string | null;
  lastMatchedAt: string | null;
  lastRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfileActivity {
  id: string;
  agentProfileId: string;
  subscriptionId: string | null;
  kind: 'invocation' | 'subscription_match' | 'run_started' | 'approval_blocked' | 'error';
  sourceType: string;
  sourceId: string | null;
  summary: string;
  runId: string | null;
  approvalId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
```

## Implementation Tasks

### Task 1: Add Profile Types And Validation

**Files:**
- Modify: `src/types.ts`
- Create: `src/agent-profiles.ts`
- Create: `src/agent-profiles.test.ts`

- [ ] **Step 1: Add failing validation tests**

Create `src/agent-profiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  buildAgentProfile,
  buildSubscriptionDedupeKey,
  normalizeAgentHandle,
  validateAgentProfileInput,
} from './agent-profiles.js';

describe('agent profile validation', () => {
  it('normalizes handles to case-insensitive mention ids', () => {
    expect(normalizeAgentHandle('@Repo-Fixer')).toBe('repo-fixer');
    expect(normalizeAgentHandle(' ManualHost ')).toBe('manualhost');
  });

  it('rejects invalid handles before persistence', () => {
    expect(() =>
      validateAgentProfileInput({
        handle: 'bad handle',
        displayName: 'Bad Handle',
      }),
    ).toThrow(/handle/i);
  });

  it('builds enabled profiles with conservative write policy defaults', () => {
    const profile = buildAgentProfile({
      handle: 'ManualHost',
      displayName: 'Manual Host',
    });

    expect(profile.handle).toBe('manualhost');
    expect(profile.enabled).toBe(true);
    expect(profile.toolPolicy).toBe('approval-required');
    expect(profile.writePolicy).toEqual({
      directSendRequiresApproval: false,
      autonomousSendRequiresApproval: true,
    });
  });

  it('builds stable subscription dedupe keys', () => {
    expect(
      buildSubscriptionDedupeKey({
        sourceType: 'github',
        sourceId: 'henrikogaard/nanocrab',
        externalEventId: 'issue-123',
        agentProfileId: 'agent_repo_fixer',
      }),
    ).toBe('github:henrikogaard/nanocrab:issue-123:agent_repo_fixer');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `rtk npx vitest run src/agent-profiles.test.ts`

Expected: FAIL because `src/agent-profiles.ts` does not exist.

- [ ] **Step 3: Add shared types**

In `src/types.ts`, import nothing new. Add the exported types from the Data Shapes section near the existing memory/task types. Use `AgentProvider` already imported at the top of the file.

- [ ] **Step 4: Implement validation helpers**

Create `src/agent-profiles.ts`:

```ts
import crypto from 'crypto';

import { isAgentProvider } from './agent-provider.js';
import type {
  AgentProfile,
  AgentProfileTaskKind,
  AgentProfileToolPolicy,
  AgentSubscriptionAutonomyMode,
  AgentSubscriptionSourceType,
} from './types.js';

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

export interface AgentProfileInput {
  handle: string;
  displayName: string;
  avatar?: string | null;
  description?: string | null;
  personality?: string | null;
  enabled?: boolean;
  providerProfileId?: string | null;
  provider?: string | null;
  model?: string | null;
  toolPolicy?: AgentProfileToolPolicy;
  allowedMcpServers?: string[] | null;
  skills?: string[];
  memoryScopes?: string[];
  taskKinds?: AgentProfileTaskKind[];
  channelBindings?: Record<string, string[]>;
  writePolicy?: {
    directSendRequiresApproval?: boolean;
    autonomousSendRequiresApproval?: boolean;
  };
}

export function normalizeAgentHandle(value: string): string {
  return value.trim().replace(/^@+/, '').toLowerCase();
}

export function validateAgentProfileInput(input: AgentProfileInput): void {
  const handle = normalizeAgentHandle(input.handle || '');
  if (!HANDLE_RE.test(handle)) {
    throw new Error(
      'agent profile handle must be 2-32 chars using lowercase letters, numbers, underscores, or dashes',
    );
  }
  if (!input.displayName?.trim()) {
    throw new Error('agent profile displayName is required');
  }
  if (input.provider && !isAgentProvider(input.provider)) {
    throw new Error(`agent profile provider is not supported: ${input.provider}`);
  }
}

function stringList(values: unknown): string[] {
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
}

export function buildAgentProfile(input: AgentProfileInput): AgentProfile {
  validateAgentProfileInput(input);
  const now = new Date().toISOString();
  return {
    id: `agent_${crypto.randomUUID()}`,
    handle: normalizeAgentHandle(input.handle),
    displayName: input.displayName.trim(),
    avatar: input.avatar || null,
    description: input.description || null,
    personality: input.personality || null,
    enabled: input.enabled !== false,
    providerProfileId: input.providerProfileId || null,
    provider: input.provider && isAgentProvider(input.provider) ? input.provider : null,
    model: input.model || null,
    toolPolicy: input.toolPolicy || 'approval-required',
    allowedMcpServers:
      input.allowedMcpServers === null
        ? null
        : Array.isArray(input.allowedMcpServers)
          ? stringList(input.allowedMcpServers)
          : null,
    skills: stringList(input.skills),
    memoryScopes: stringList(input.memoryScopes),
    taskKinds: Array.isArray(input.taskKinds) && input.taskKinds.length ? input.taskKinds : ['chat'],
    channelBindings: input.channelBindings || {},
    writePolicy: {
      directSendRequiresApproval:
        input.writePolicy?.directSendRequiresApproval === true,
      autonomousSendRequiresApproval:
        input.writePolicy?.autonomousSendRequiresApproval !== false,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function buildSubscriptionDedupeKey(input: {
  sourceType: AgentSubscriptionSourceType;
  sourceId: string;
  externalEventId: string;
  agentProfileId: string;
}): string {
  return [
    input.sourceType,
    input.sourceId,
    input.externalEventId,
    input.agentProfileId,
  ].join(':');
}

export function validateSubscriptionShape(input: {
  sourceType: AgentSubscriptionSourceType;
  taskKind: AgentProfileTaskKind;
  autonomyMode?: AgentSubscriptionAutonomyMode;
}): void {
  if (!['github', 'channel_mention'].includes(input.sourceType)) {
    throw new Error(`unsupported subscription sourceType: ${input.sourceType}`);
  }
  if (input.autonomyMode && input.autonomyMode !== 'investigate_then_pause') {
    throw new Error(`unsupported subscription autonomyMode: ${input.autonomyMode}`);
  }
  if (!['chat', 'cowork_task', 'coding_job', 'report', 'research', 'scheduled_check'].includes(input.taskKind)) {
    throw new Error(`unsupported subscription taskKind: ${input.taskKind}`);
  }
}
```

- [ ] **Step 5: Verify helper tests pass**

Run: `rtk npx vitest run src/agent-profiles.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/types.ts src/agent-profiles.ts src/agent-profiles.test.ts
rtk git commit -m "feat(agents): add agent profile validation"
```

### Task 2: Add SQLite Persistence For Profiles, Subscriptions, And Activity

**Files:**
- Modify: `src/db.ts`
- Modify: `src/agent-profiles.ts`
- Create or extend: `src/agent-profiles.test.ts`

- [ ] **Step 1: Add persistence tests**

Extend `src/agent-profiles.test.ts`:

```ts
import { beforeEach, afterEach } from 'vitest';
import { _closeDatabase, _initTestDatabase } from './db.js';
import {
  createAgentProfile,
  createAgentSubscription,
  getAgentProfile,
  getAgentProfileByHandle,
  listAgentProfileActivity,
  listAgentProfiles,
  recordAgentProfileActivity,
  recordAgentSubscriptionEvent,
} from './agent-profiles.js';

beforeEach(() => {
  try {
    _closeDatabase();
  } catch {}
  _initTestDatabase();
});

afterEach(() => {
  try {
    _closeDatabase();
  } catch {}
});

describe('agent profile persistence', () => {
  it('stores profiles and enforces unique normalized handles', () => {
    const profile = createAgentProfile({
      handle: 'RepoFixer',
      displayName: 'Repo Fixer',
    });

    expect(getAgentProfile(profile.id)?.handle).toBe('repofixer');
    expect(getAgentProfileByHandle('@REPOFIXER')?.id).toBe(profile.id);
    expect(listAgentProfiles()).toHaveLength(1);
    expect(() =>
      createAgentProfile({ handle: 'repofixer', displayName: 'Duplicate' }),
    ).toThrow(/already exists/i);
  });

  it('stores subscriptions and activity for a profile', () => {
    const profile = createAgentProfile({
      handle: 'RepoFixer',
      displayName: 'Repo Fixer',
    });
    const subscription = createAgentSubscription({
      agentProfileId: profile.id,
      sourceType: 'github',
      enabled: true,
      filters: { repo: 'henrikogaard/nanocrab', labels: ['autofix'] },
      taskKind: 'coding_job',
      autonomyMode: 'investigate_then_pause',
    });
    const event = recordAgentSubscriptionEvent({
      subscriptionId: subscription.id,
      agentProfileId: profile.id,
      dedupeKey: 'github:henrikogaard/nanocrab:issue-1:' + profile.id,
      sourceType: 'github',
      sourceId: 'henrikogaard/nanocrab',
      externalEventId: 'issue-1',
      runId: 'code-1',
      status: 'matched',
      metadata: { issueNumber: 1 },
    });
    recordAgentProfileActivity({
      agentProfileId: profile.id,
      subscriptionId: subscription.id,
      kind: 'subscription_match',
      sourceType: 'github',
      sourceId: 'henrikogaard/nanocrab',
      summary: 'Matched #1',
      runId: 'code-1',
      approvalId: null,
      metadata: { eventId: event.id },
    });

    expect(listAgentProfileActivity(profile.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `rtk npx vitest run src/agent-profiles.test.ts`

Expected: FAIL because persistence helpers do not exist.

- [ ] **Step 3: Add database schema**

In `src/db.ts`, add tables inside `createSchema()`:

```sql
CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar TEXT,
  description TEXT,
  personality TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  provider_profile_id TEXT,
  provider TEXT,
  model TEXT,
  tool_policy TEXT NOT NULL,
  allowed_mcp_servers_json TEXT,
  skills_json TEXT NOT NULL,
  memory_scopes_json TEXT NOT NULL,
  task_kinds_json TEXT NOT NULL,
  channel_bindings_json TEXT NOT NULL,
  write_policy_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_enabled ON agent_profiles(enabled);

CREATE TABLE IF NOT EXISTS agent_subscriptions (
  id TEXT PRIMARY KEY,
  agent_profile_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  filters_json TEXT NOT NULL,
  task_kind TEXT NOT NULL,
  autonomy_mode TEXT NOT NULL,
  last_seen_at TEXT,
  last_matched_at TEXT,
  last_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_agent_subscriptions_profile ON agent_subscriptions(agent_profile_id);
CREATE INDEX IF NOT EXISTS idx_agent_subscriptions_enabled ON agent_subscriptions(enabled, source_type);

CREATE TABLE IF NOT EXISTS agent_subscription_events (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  agent_profile_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_subscription_events_profile ON agent_subscription_events(agent_profile_id, created_at);

CREATE TABLE IF NOT EXISTS agent_profile_activity (
  id TEXT PRIMARY KEY,
  agent_profile_id TEXT NOT NULL,
  subscription_id TEXT,
  kind TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  summary TEXT NOT NULL,
  run_id TEXT,
  approval_id TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_profile_activity_profile ON agent_profile_activity(agent_profile_id, created_at);
```

- [ ] **Step 4: Add low-level `db.ts` accessors**

Add exported CRUD helpers after the registered group accessors. Keep JSON parsing local to mapping functions:

```ts
export function insertAgentProfile(profile: AgentProfile): AgentProfile;
export function updateAgentProfile(profile: AgentProfile): AgentProfile;
export function getAgentProfileRow(id: string): AgentProfile | undefined;
export function getAgentProfileRowByHandle(handle: string): AgentProfile | undefined;
export function listAgentProfileRows(): AgentProfile[];
export function insertAgentSubscription(subscription: AgentSubscription): AgentSubscription;
export function listAgentSubscriptionsForProfile(agentProfileId: string): AgentSubscription[];
export function listEnabledAgentSubscriptions(sourceType?: string): AgentSubscription[];
export function updateAgentSubscription(subscription: AgentSubscription): AgentSubscription;
export function insertAgentSubscriptionEvent(input: NewAgentSubscriptionEvent): AgentSubscriptionEvent;
export function getAgentSubscriptionEventByDedupeKey(dedupeKey: string): AgentSubscriptionEvent | undefined;
export function insertAgentProfileActivity(input: NewAgentProfileActivity): AgentProfileActivity;
export function listAgentProfileActivityRows(agentProfileId: string, limit?: number): AgentProfileActivity[];
```

Add the corresponding `NewAgentSubscriptionEvent`, `AgentSubscriptionEvent`, and `NewAgentProfileActivity` interfaces to `src/types.ts`.

- [ ] **Step 5: Add domain wrappers**

In `src/agent-profiles.ts`, add wrappers named exactly as used by tests:

```ts
export function createAgentProfile(input: AgentProfileInput): AgentProfile;
export function getAgentProfile(id: string): AgentProfile | undefined;
export function getAgentProfileByHandle(handle: string): AgentProfile | undefined;
export function listAgentProfiles(): AgentProfile[];
export function createAgentSubscription(input: AgentSubscriptionInput): AgentSubscription;
export function listAgentSubscriptions(agentProfileId: string): AgentSubscription[];
export function recordAgentSubscriptionEvent(input: NewAgentSubscriptionEventInput): AgentSubscriptionEvent;
export function recordAgentProfileActivity(input: NewAgentProfileActivityInput): AgentProfileActivity;
export function listAgentProfileActivity(agentProfileId: string, limit?: number): AgentProfileActivity[];
```

Each wrapper should call validation before inserting/updating. Convert unique constraint failures into `Agent profile handle already exists: <handle>`.

- [ ] **Step 6: Verify persistence tests**

Run: `rtk npx vitest run src/agent-profiles.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add src/db.ts src/types.ts src/agent-profiles.ts src/agent-profiles.test.ts
rtk git commit -m "feat(agents): persist agent profiles"
```

### Task 3: Add Agent Profile API Routes

**Files:**
- Create: `src/admin/routes/agent-profiles.ts`
- Create: `src/admin/routes/agent-profiles.test.ts`
- Modify: `src/admin/index.ts`

- [ ] **Step 1: Add route tests**

Create `src/admin/routes/agent-profiles.test.ts` using the same isolated DB pattern as `src/admin/routes/threads.test.ts`. Include tests:

```ts
it('POST /api/agent-profiles creates a profile and normalizes handle', async () => {});
it('POST /api/agent-profiles rejects duplicate handles', async () => {});
it('GET /api/agent-profiles lists roster summaries', async () => {});
it('POST /api/agent-profiles/:id/subscriptions creates a GitHub subscription', async () => {});
it('POST /api/agent-profiles/:id/disable prevents enabled roster state', async () => {});
```

Use request bodies:

```json
{
  "handle": "RepoFixer",
  "displayName": "Repo Fixer",
  "providerProfileId": "default_coding",
  "taskKinds": ["coding_job"],
  "toolPolicy": "approval-required"
}
```

and:

```json
{
  "sourceType": "github",
  "enabled": true,
  "filters": { "repo": "henrikogaard/nanocrab", "labels": ["autofix"] },
  "taskKind": "coding_job",
  "autonomyMode": "investigate_then_pause"
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `rtk npx vitest run src/admin/routes/agent-profiles.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement route**

Create `src/admin/routes/agent-profiles.ts` with these handlers:

| Route | Handler behavior |
| --- | --- |
| `GET /` | Return `listAgentProfilesWithSummary()`. |
| `POST /` | Call `createAgentProfile(req.body)`, write `auditLog(req, 'agent_profile_created', profile.id)`, return `{ ok: true, profile }`; return `400` with `{ error }` on validation failure. |
| `GET /:id` | Return the profile plus `subscriptions` and recent `activity`; return `404` if the profile is missing. |
| `PUT /:id` | Merge editable fields onto the existing profile, validate through the domain helper, write `auditLog(req, 'agent_profile_updated', profile.id)`, return `{ ok: true, profile }`. |
| `POST /:id/enable` | Set `enabled: true`, write `auditLog(req, 'agent_profile_enabled', profile.id)`, return `{ ok: true, profile }`. |
| `POST /:id/disable` | Set `enabled: false`, write `auditLog(req, 'agent_profile_disabled', profile.id)`, return `{ ok: true, profile }`. |
| `GET /:id/subscriptions` | Return `listAgentSubscriptions(req.params.id)`. |
| `POST /:id/subscriptions` | Call `createAgentSubscription({ ...req.body, agentProfileId: req.params.id })`, audit `agent_subscription_created`, return `{ ok: true, subscription }`. |
| `PUT /:id/subscriptions/:subscriptionId` | Update the matching subscription after confirming it belongs to `:id`, audit `agent_subscription_updated`, return `{ ok: true, subscription }`. |
| `POST /:id/subscriptions/:subscriptionId/enable` | Enable the matching subscription, audit `agent_subscription_enabled`, return `{ ok: true, subscription }`. |
| `POST /:id/subscriptions/:subscriptionId/disable` | Disable the matching subscription, audit `agent_subscription_disabled`, return `{ ok: true, subscription }`. |
| `GET /:id/activity` | Return `listAgentProfileActivity(req.params.id, 50)`. |

- [ ] **Step 4: Mount route**

In `src/admin/index.ts`, add:

```ts
import agentProfilesRoutes from './routes/agent-profiles.js';
```

and near the existing agents route mounts:

```ts
app.use('/api/agent-profiles', requireAuth, agentProfilesRoutes);
```

- [ ] **Step 5: Verify route tests**

Run: `rtk npx vitest run src/admin/routes/agent-profiles.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/admin/routes/agent-profiles.ts src/admin/routes/agent-profiles.test.ts src/admin/index.ts
rtk git commit -m "feat(api): add agent profile routes"
```

### Task 4: Add Direct Invocation Router

**Files:**
- Create: `src/agent-profile-router.ts`
- Create: `src/agent-profile-router.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add direct router tests**

Create tests for:

```ts
it('extracts one @handle mention from message text', () => {});
it('resolves enabled profile by normalized handle', () => {});
it('rejects disabled profiles with a visible reason', () => {});
it('returns no invocation when no handle is present', () => {});
it('strips the addressed handle from the task text', () => {});
```

Expected shape:

```ts
expect(resolveAgentProfileInvocation({
  text: '@RepoFixer fix issue 12',
  profiles: [repoFixer],
})).toMatchObject({
  profileId: repoFixer.id,
  handle: 'repofixer',
  taskText: 'fix issue 12',
});
```

- [ ] **Step 2: Implement pure router helper**

Create `src/agent-profile-router.ts`:

```ts
export interface AgentProfileInvocation {
  profile: AgentProfile;
  handle: string;
  taskText: string;
}

export function extractAgentProfileHandles(text: string): string[] {
  const matches = text.match(/(^|\s)@([a-zA-Z0-9_-]{2,32})\b/g) || [];
  return matches.map((match) => normalizeAgentHandle(match.trim()));
}

export function resolveAgentProfileInvocation(input: {
  text: string;
  profiles?: AgentProfile[];
}): AgentProfileInvocation | null {
  const profiles = input.profiles || listAgentProfiles();
  const handles = extractAgentProfileHandles(input.text);
  if (!handles.length) return null;
  const handle = handles[0];
  const profile = profiles.find((item) => item.handle === handle);
  if (!profile) throw new Error(`No enabled agent profile matched @${handle}`);
  if (!profile.enabled) throw new Error(`Agent profile @${handle} is disabled`);
  return {
    profile,
    handle,
    taskText: input.text.replace(new RegExp(`(^|\\\\s)@${handle}\\\\b`, 'i'), ' ').trim(),
  };
}
```

- [ ] **Step 3: Wire minimal direct invocation into `src/index.ts`**

In `processGroupMessages`, after `missedMessages` is known and trigger checks pass, detect whether the latest triggering message contains a profile handle. For v1, append profile instructions to the prompt and pass provider/model overrides through an extended `runAgent` options object.

Add a small options type:

```ts
interface RunAgentOptions {
  agentProfileId?: string;
  profileInstructions?: string;
  provider?: AgentProvider;
  model?: string;
  allowedMcpServers?: string[];
}
```

Update `runAgent(group, prompt, chatJid, onOutput)` to accept `options: RunAgentOptions = {}` and use:

```ts
const effectiveProvider = options.provider || group.containerConfig?.provider || defaultProvider;
const effectiveModel =
  options.model ||
  group.containerConfig?.model ||
  group.containerConfig?.models?.[effectiveProvider];
```

When building the prompt:

```ts
const profilePrompt = invocation
  ? [
      `# Active Virtual Agent`,
      `Handle: @${invocation.profile.handle}`,
      `Name: ${invocation.profile.displayName}`,
      invocation.profile.personality ? `Instructions: ${invocation.profile.personality}` : '',
      '',
      invocation.taskText,
    ].filter(Boolean).join('\n')
  : prompt;
```

Do not bypass `resolveAgentBoundary`; the profile only narrows options.

- [ ] **Step 4: Add unknown/disabled visible failures**

If `resolveAgentProfileInvocation` throws, send the error through the existing channel and store it as a bot message. Use the same storage/broadcast path as normal text output.

- [ ] **Step 5: Verify router and focused index tests**

Run: `rtk npx vitest run src/agent-profile-router.test.ts`

Run any existing index/message tests if present:

```bash
rtk npx vitest run src/channels/web.test.ts src/channels/telegram.test.ts src/channels/signal.test.ts src/channels/whatsapp.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/agent-profile-router.ts src/agent-profile-router.test.ts src/index.ts
rtk git commit -m "feat(agents): route direct profile mentions"
```

### Task 5: Add Profile Attribution To Coding Jobs And Existing Runs

**Files:**
- Modify: `src/types.ts`
- Modify: `src/coding-jobs.ts`
- Modify: `src/coding-jobs.test.ts`
- Modify: `src/admin/routes/agents.ts`

- [ ] **Step 1: Add failing coding-job attribution test**

In `src/coding-jobs.test.ts`, add:

```ts
it('stores agent profile attribution on coding jobs', async () => {
  mockGitHubFetch((url) => {
    if (url.includes('/repos/owner/repo')) return { default_branch: 'main' };
    return {};
  });
  await registerCodingRepo({ repo: 'owner/repo', labels: ['autofix'] });

  const job = await startCodingJob({
    repo: 'owner/repo',
    prompt: 'Fix profile attribution',
    requestedBy: 'agent:repofixer',
    agentProfileId: 'agent_repo_fixer',
    sourceSubscriptionId: 'sub_1',
  });

  expect(job.agentProfileId).toBe('agent_repo_fixer');
  expect(job.sourceSubscriptionId).toBe('sub_1');
  expect(loadCodingJobs()[0].agentProfileId).toBe('agent_repo_fixer');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `rtk npx vitest run src/coding-jobs.test.ts -t "stores agent profile attribution"`

Expected: FAIL because `StartCodingJobInput` and `CodingJob` do not include the new fields.

- [ ] **Step 3: Add optional attribution fields**

In `src/coding-jobs.ts`, add optional fields to `StartCodingJobInput` and `CodingJob`:

```ts
agentProfileId?: string | null;
sourceSubscriptionId?: string | null;
```

Set them on the new job:

```ts
agentProfileId: input.agentProfileId || null,
sourceSubscriptionId: input.sourceSubscriptionId || null,
```

Ensure old JSON records load with missing fields by treating them as `null` when mapped.

- [ ] **Step 4: Return attribution from admin routes**

`src/admin/routes/agents.ts` already spreads jobs in responses. Confirm no truncation/remap drops `agentProfileId` or `sourceSubscriptionId`.

- [ ] **Step 5: Verify coding-job suite**

Run: `rtk npx vitest run src/coding-jobs.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/coding-jobs.ts src/coding-jobs.test.ts src/admin/routes/agents.ts
rtk git commit -m "feat(coding): attribute jobs to agent profiles"
```

### Task 6: Add Autonomous Subscription Runner

**Files:**
- Create: `src/agent-subscription-runner.ts`
- Create: `src/agent-subscription-runner.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add runner tests**

Create tests for:

```ts
it('matches enabled GitHub subscriptions and starts one coding job per dedupe key', async () => {});
it('does not match disabled profiles or disabled subscriptions', async () => {});
it('dedupes repeated channel mention events', async () => {});
it('records blocked activity when a connector or run prerequisite is missing', async () => {});
```

Mock `pickGitHubIssue` or `startCodingJob` so tests do not spawn containers.

- [ ] **Step 2: Implement runner interface**

Create `src/agent-subscription-runner.ts`:

```ts
export interface SubscriptionRunnerDeps {
  now?: () => string;
  listGitHubIssues?: typeof listGitHubIssues;
  startCodingJob?: typeof startCodingJob;
}

export async function runAgentSubscriptionScan(deps: SubscriptionRunnerDeps = {}): Promise<{
  scanned: number;
  matched: number;
  skipped: number;
}> {
  const subscriptions = listEnabledAgentSubscriptions();
  let scanned = 0;
  let matched = 0;
  let skipped = 0;
  for (const subscription of subscriptions) {
    scanned += 1;
    const profile = getAgentProfile(subscription.agentProfileId);
    if (!profile?.enabled) {
      skipped += 1;
      continue;
    }
    if (subscription.sourceType === 'github') {
      const result = await scanGitHubSubscription(subscription, profile, deps);
      matched += result.matched;
      skipped += result.skipped;
    }
    if (subscription.sourceType === 'channel_mention') {
      const result = await scanChannelMentionSubscription(subscription, profile, deps);
      matched += result.matched;
      skipped += result.skipped;
    }
  }
  return { scanned, matched, skipped };
}
```

GitHub v1 behavior:

- Read `filters.repo`, `filters.labels`, `filters.assignee`, `filters.milestone`, `filters.issueNumber`.
- List matching issues through existing `listGitHubIssues`.
- Use the first issue only per scan per subscription.
- Build dedupe key `github:<repo>:issue-<number>:<profileId>`.
- If no prior event exists, start a coding job with `requestedBy: agent:<handle>`, `agentProfileId`, `sourceSubscriptionId`, `createPr: false`.
- Record event and activity.

Channel mention v1 behavior:

- Read recent stored messages for configured `filters.chatJid`.
- Ignore `is_bot_message`.
- Match `@profile.handle` or aliases.
- Use message id as external event id.
- Record activity and invoke direct profile routing only if the final implementation exposes a safe host entry point. If no entry point exists yet, create an activity item with kind `subscription_match` and no run id; direct run pickup can be a later task in this MVP plan.

- [ ] **Step 3: Schedule scanner startup**

In `src/index.ts`, start a conservative interval near the other background services:

```ts
const AGENT_SUBSCRIPTION_SCAN_INTERVAL_MS = 60_000;
setInterval(() => {
  void runAgentSubscriptionScan().catch((err) => {
    logger.warn({ err }, 'Agent subscription scan failed');
  });
}, AGENT_SUBSCRIPTION_SCAN_INTERVAL_MS);
```

Gate this with normal service startup only, not tests that import pure helpers.

- [ ] **Step 4: Verify runner tests**

Run: `rtk npx vitest run src/agent-subscription-runner.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/agent-subscription-runner.ts src/agent-subscription-runner.test.ts src/index.ts
rtk git commit -m "feat(agents): scan profile subscriptions"
```

### Task 7: Add Agents Cockpit Profile UI

**Files:**
- Modify: `src/admin/public/pages/agents.js`
- Modify: `src/admin/public/style.css`
- Modify: `src/admin/mock-data.ts`
- Modify: `src/admin/agents-ui.test.ts`

- [ ] **Step 1: Add UI source tests**

Extend `src/admin/agents-ui.test.ts`:

```ts
it('renders agent profile roster and detail tabs from the Agents cockpit', () => {
  const source = fs.readFileSync(agentsPagePath, 'utf8');
  expect(source).toContain("api('/agent-profiles')");
  expect(source).toContain('renderAgentProfileRoster');
  expect(source).toContain('renderAgentProfileDetail');
  expect(source).toContain('agent-profile-roster');
  expect(source).toContain('agent-profile-tabs');
  expect(source).toContain('Identity');
  expect(source).toContain('Capabilities');
  expect(source).toContain('Subscriptions');
  expect(source).toContain('Activity');
});

it('keeps agent profile UI class-driven with explicit empty states', () => {
  const source = fs.readFileSync(agentsPagePath, 'utf8');
  expect(source).toContain('agent-profile-empty-state');
  expect(source).toContain('agent-profile-loading-state');
  expect(source).toContain('agent-profile-unavailable-state');
  expect(source).not.toContain('style="display:flex;gap:12px"');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `rtk npx vitest run src/admin/agents-ui.test.ts -t "agent profile"`

Expected: FAIL because UI functions do not exist.

- [ ] **Step 3: Fetch profiles in `renderAgents`**

Add to the existing `Promise.all` in `renderAgents`:

```js
api('/agent-profiles').catch(() => {
  loadIssues.push('Agent profile roster unavailable');
  return [];
}),
```

Store as `agentProfiles`.

- [ ] **Step 4: Add profile roster/detail render helpers**

Add functions:

```js
function renderAgentProfileRoster(profiles, selectedId) {
  return profiles.map(function (profile) {
    return '<button type="button" class="agent-profile-row' +
      (profile.id === selectedId ? ' is-active' : '') +
      '" onclick="selectAgentProfile(\\'' + esc(profile.id) + '\\')">' +
      '<strong>' + esc(profile.displayName) + '</strong>' +
      '<span>@' + esc(profile.handle) + '</span>' +
      '</button>';
  }).join('');
}

function renderAgentProfileDetail(profile) {
  return [
    '<div class="agent-profile-detail">',
    '<div class="agent-profile-tabs">',
    '<button type="button">Identity</button>',
    '<button type="button">Model</button>',
    '<button type="button">Capabilities</button>',
    '<button type="button">Subscriptions</button>',
    '<button type="button">Activity</button>',
    '</div>',
    '<div class="agent-profile-tab-panel">' + esc(profile.description || 'No description') + '</div>',
    '</div>',
  ].join('');
}

function renderAgentProfileEmptyState(kind) {
  return '<div class="agent-profile-' + esc(kind) + '-state">No agent profile data available.</div>';
}
```

The detail can be read-only in the first UI task if route editing is not wired yet, but it must show:

- display name and handle
- enabled state
- provider/model/tool policy
- task kinds
- MCP/skills/memory scopes
- subscriptions with last match/run state
- activity items and approval blocked state

- [ ] **Step 5: Add class-driven styles**

In `src/admin/public/style.css`, add classes:

```css
.agent-profile-shell {}
.agent-profile-roster {}
.agent-profile-row {}
.agent-profile-row.is-active {}
.agent-profile-detail {}
.agent-profile-tabs {}
.agent-profile-tab-panel {}
.agent-profile-empty-state {}
.agent-profile-loading-state {}
.agent-profile-unavailable-state {}
.agent-profile-subscription-row {}
.agent-profile-activity-row {}
```

Follow existing Agents page color/spacing conventions and avoid inline styles.

- [ ] **Step 6: Add mock data**

In `src/admin/mock-data.ts`, add `/agent-profiles` and detail/subscription/activity mock responses for:

- Manual Host
- Repo Fixer
- Researcher

- [ ] **Step 7: Verify UI tests**

Run: `rtk npx vitest run src/admin/agents-ui.test.ts`

Expected: PASS.

- [ ] **Step 8: Manual mock check**

Run: `rtk npm run mock:admin`

Open the mock dashboard and verify:

- Agents page loads.
- Agent Profiles section renders before or near existing Bot Agents.
- Empty/loading/unavailable states are visually distinct.
- No text overlaps at desktop width and narrow mobile width.

Stop the mock server before continuing.

- [ ] **Step 9: Commit**

```bash
rtk git add src/admin/public/pages/agents.js src/admin/public/style.css src/admin/mock-data.ts src/admin/agents-ui.test.ts
rtk git commit -m "feat(ui): add agent profile cockpit"
```

### Task 8: Add Editing And Invocation From Agents Cockpit

**Files:**
- Modify: `src/admin/public/pages/agents.js`
- Modify: `src/admin/agents-ui.test.ts`
- Modify: `src/admin/routes/agent-profiles.ts`

- [ ] **Step 1: Add source tests for edit/invoke actions**

Extend `src/admin/agents-ui.test.ts`:

```ts
it('exposes profile save and invoke actions without inline prompt dialogs', () => {
  const source = fs.readFileSync(agentsPagePath, 'utf8');
  expect(source).toContain('saveAgentProfile');
  expect(source).toContain('invokeAgentProfile');
  expect(source).toContain("api('/agent-profiles/' + encodeURIComponent");
  expect(source).toContain("'/invoke'");
  expect(source).not.toContain("prompt('");
});
```

- [ ] **Step 2: Implement save action**

Add form fields in the Identity/Model/Capabilities tabs and `saveAgentProfile(id)` that sends `PUT /agent-profiles/:id`. Keep validation errors visible in an inline status element.

- [ ] **Step 3: Implement invoke action**

Add an invocation text area and button:

```js
async function invokeAgentProfile(id) {
  const prompt = document.getElementById('agent-profile-invoke-prompt')?.value || '';
  const result = await api('/agent-profiles/' + encodeURIComponent(id) + '/invoke', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
  toast(result.ok ? 'Agent run started' : 'Agent run could not start', result.ok ? 'success' : 'error');
}
```

The backend `invoke` endpoint can create an activity record in this task. Full run creation is acceptable only after Task 4 has a safe host entry point.

- [ ] **Step 4: Verify tests**

Run: `rtk npx vitest run src/admin/agents-ui.test.ts src/admin/routes/agent-profiles.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/admin/public/pages/agents.js src/admin/agents-ui.test.ts src/admin/routes/agent-profiles.ts
rtk git commit -m "feat(ui): edit and invoke agent profiles"
```

### Task 9: Documentation And Safety Notes

**Files:**
- Modify: `README.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/COMMANDS.md`
- Modify: `docs/USER_GUIDE.md`
- Create: `docs/AGENT_PROFILES.md`

- [ ] **Step 1: Add docs checklist**

Create `docs/AGENT_PROFILES.md` covering:

- What an Agent Profile is.
- How direct `@handle` routing works.
- How GitHub/channel subscriptions work.
- What runs automatically.
- Which actions still require approval.
- How to disable a profile or subscription.
- What is out of scope: visual office, Slack/Discord runtime adapters, long-running profile containers.

- [ ] **Step 2: Update README feature summary**

Add a short Agent Profiles section near the Agents/Cowork/Code dashboard descriptions.

- [ ] **Step 3: Update security docs**

In `docs/SECURITY.md`, add a subsection under connector permissions and agent boundaries explaining:

- Profile policy narrows boundaries.
- Profile policy cannot widen unauthorized channel/group permissions.
- Autonomous subscriptions start investigation/planning and pause before writes.

- [ ] **Step 4: Update commands/user guide**

Add examples:

```text
@RepoFixer investigate issue #123
@ManualHost answer this rules question from the project wiki
```

Describe that Slack/Discord use the same future contract but are not v1 runtime adapters.

- [ ] **Step 5: Verify docs references**

Run: `rtk rg -n "Agent Profiles|agent profile|@RepoFixer|ManualHost|visual office|Slack|Discord" README.md docs/SECURITY.md docs/COMMANDS.md docs/USER_GUIDE.md docs/AGENT_PROFILES.md`

Expected: each doc has the intended references and no stale claim that Slack/Discord are implemented by this MVP.

- [ ] **Step 6: Commit**

```bash
rtk git add README.md docs/SECURITY.md docs/COMMANDS.md docs/USER_GUIDE.md docs/AGENT_PROFILES.md
rtk git commit -m "docs: document agent profiles"
```

### Task 10: Full Verification Sweep

**Files:**
- No source edits expected unless verification exposes a defect.

- [ ] **Step 1: Run focused tests**

```bash
rtk npx vitest run \
  src/agent-profiles.test.ts \
  src/agent-profile-router.test.ts \
  src/agent-subscription-runner.test.ts \
  src/admin/routes/agent-profiles.test.ts \
  src/coding-jobs.test.ts \
  src/admin/agents-ui.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `rtk npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `rtk npm run build`

Expected: PASS and admin public assets copied to `dist/admin/public`.

- [ ] **Step 4: Run mock admin manual QA**

Run: `rtk npm run mock:admin`

Check:

- Agents page profile roster loads.
- Profile detail tabs switch without layout shift.
- Disabled profile state is visible.
- Subscription rows show last-seen/last-run state.
- Activity rows link to run/job/approval detail where data exists.
- Existing Bot Agents, Coding Agents, Tasks, Questions, Messages, and Approvals still render.

Stop the server before committing any fixes.

- [ ] **Step 5: Final status**

Run: `rtk git status --short`

Expected: clean after all task commits, or only intentional docs/plans if the implementer has not committed those.

## Ready-To-Create GitHub Issue Drafts

These are saved issue-sized entries. Do not create live GitHub issues unless Henrik explicitly asks for GitHub issue creation.

### Epic: Agent Profiles MVP

Build durable virtual agent identities that can be configured once, invoked from current UI/channels, and triggered by explicit GitHub/channel subscriptions while preserving existing NanoCrab boundaries and approvals.

### Issue: Add AgentProfile data model and persistence

Implement profile/subscription/activity types, validation, SQLite schema, and CRUD helpers. Acceptance: unique normalized handles, disabled profile behavior, subscription dedupe storage, and activity queries are covered by focused tests.

### Issue: Add Agent Profile API routes

Expose `/api/agent-profiles` CRUD, subscription CRUD, enable/disable, invoke, and activity endpoints. Acceptance: isolated Express route tests cover create/list/update/disable/subscription behavior and validation errors.

### Issue: Route direct `@handle` profile invocations

Resolve enabled profiles from Agents UI, web chat, WhatsApp, Telegram, and Signal after existing group trigger rules. Acceptance: unknown and disabled profiles fail visibly, and successful invocations carry profile instructions/provider policy into the existing run path.

### Issue: Attribute coding jobs and existing runs to profiles

Add optional `agentProfileId` and `sourceSubscriptionId` to coding jobs and expose attribution in existing admin surfaces. Acceptance: coding jobs preserve approval gates and tests prove profile attribution does not bypass implementation or PR approval.

### Issue: Add autonomous subscription scanning

Add a host-side scanner for GitHub and channel mention subscriptions. Acceptance: enabled subscriptions match explicit filters, dedupe repeated external events, start only investigation/planning work, and record activity/blocked state.

### Issue: Add Agent Profiles cockpit UI

Extend the existing Agents page with profile roster/detail tabs for identity, model, capabilities, subscriptions, and activity. Acceptance: UI source tests cover class-driven markup and distinct loading/empty/unavailable/blocked states; mock admin renders without overlap.

### Issue: Document Agent Profiles and safety boundaries

Update README, SECURITY, COMMANDS, USER_GUIDE, and add `docs/AGENT_PROFILES.md`. Acceptance: docs explain direct invocation, subscriptions, approval gates, disabled profiles, and follow-on visual office/Slack/Discord scope.

## Plan Self-Review

- Spec coverage: E1-E6 map to every approved spec section. Follow-on epics are listed separately so visual office, Slack/Discord, role templates, and richer sources are not lost.
- Placeholder scan: no unresolved implementation slots are intended in this plan.
- Type consistency: `AgentProfile`, `AgentSubscription`, `AgentProfileActivity`, `agentProfileId`, and `sourceSubscriptionId` names match across tasks.
