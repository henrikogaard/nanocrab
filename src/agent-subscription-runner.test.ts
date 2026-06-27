import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSubscriptionDedupeKey,
  createAgentProfile,
  createAgentSubscription,
  listAgentProfileActivity,
  recordAgentSubscriptionEvent,
} from './agent-profiles.js';
import { runAgentSubscriptionScan } from './agent-subscription-runner.js';
import {
  _closeDatabase,
  _initTestDatabase,
  getAgentSubscriptionEventByDedupeKey,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import type {
  CodingJob,
  GitHubIssueSummary,
  StartCodingJobInput,
} from './coding-jobs.js';

const NOW = '2026-06-27T10:00:00.000Z';

function resetDb(): void {
  try {
    _closeDatabase();
  } catch {
    /* database may not be initialized */
  }
  _initTestDatabase();
}

function issue(
  overrides: Partial<GitHubIssueSummary> = {},
): GitHubIssueSummary {
  return {
    number: 123,
    title: 'Fix flaky profile subscriptions',
    body: 'Issue body',
    labels: ['agent'],
    assignees: [],
    milestone: null,
    author: 'henrik',
    htmlUrl: 'https://github.com/henrik/nanocrab/issues/123',
    updatedAt: '2026-06-27T09:00:00.000Z',
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function codingJob(id: string, overrides: Partial<CodingJob> = {}): CodingJob {
  return {
    id,
    repo: 'henrik/nanocrab',
    type: 'issue',
    prompt: 'Issue title: Fix flaky profile subscriptions',
    issueNumber: 123,
    issueTitle: 'Fix flaky profile subscriptions',
    provider: 'codex',
    model: 'gpt-5',
    status: 'queued',
    branch: 'nanocrab/issue-123-test',
    workspace: '/tmp/nanocrab-job',
    createPr: false,
    dryRun: false,
    prUrl: null,
    commitSha: null,
    changedFiles: [],
    diffSummary: null,
    testSummary: null,
    ciStatus: 'unknown',
    lastCiError: null,
    transitionedAt: { queued: NOW },
    transitionHistory: [],
    failureReason: null,
    approvalHistory: [],
    output: '',
    requestedBy: 'agent:repofixer',
    agentProfileId: null,
    sourceSubscriptionId: null,
    createdAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

describe('agent subscription runner', () => {
  beforeEach(() => {
    resetDb();
  });

  afterEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* database may not be initialized */
    }
    vi.restoreAllMocks();
  });

  it('reserves enabled GitHub subscriptions before starting one coding job per dedupe key', async () => {
    const profile = createAgentProfile({
      handle: 'RepoFixer',
      displayName: 'Repo Fixer',
      provider: 'codex',
      model: 'gpt-5',
      taskKinds: ['coding_job'],
    });
    const subscription = createAgentSubscription({
      agentProfileId: profile.id,
      sourceType: 'github',
      filters: {
        repo: 'henrik/nanocrab',
        labels: ['agent'],
        assignee: 'henrik',
        milestone: 'MVP',
        issueNumber: 123,
      },
      taskKind: 'coding_job',
    });
    const listGitHubIssues = vi.fn().mockResolvedValue([issue()]);
    const startCodingJob = vi.fn().mockResolvedValue(codingJob('job-123'));

    const first = await runAgentSubscriptionScan({
      now: () => NOW,
      listGitHubIssues,
      startCodingJob,
    });
    const second = await runAgentSubscriptionScan({
      now: () => NOW,
      listGitHubIssues,
      startCodingJob,
    });

    expect(first).toEqual({ scanned: 1, matched: 1, skipped: 0 });
    expect(second).toEqual({ scanned: 1, matched: 0, skipped: 1 });
    expect(listGitHubIssues).toHaveBeenCalledWith({
      repo: 'henrik/nanocrab',
      labels: ['agent'],
      assignee: 'henrik',
      milestone: 'MVP',
      issueNumber: 123,
      limit: 10,
    });
    expect(startCodingJob).toHaveBeenCalledTimes(1);
    expect(startCodingJob).toHaveBeenCalledWith({
      repo: 'henrik/nanocrab',
      issueNumber: 123,
      provider: 'codex',
      model: 'gpt-5',
      createPr: false,
      requestedBy: 'agent:repofixer',
      agentProfileId: profile.id,
      sourceSubscriptionId: subscription.id,
    });

    const dedupeKey = buildSubscriptionDedupeKey({
      sourceType: 'github',
      sourceId: 'henrik/nanocrab',
      externalEventId: 'issue-123',
      agentProfileId: profile.id,
    });
    expect(getAgentSubscriptionEventByDedupeKey(dedupeKey)).toMatchObject({
      subscriptionId: subscription.id,
      agentProfileId: profile.id,
      sourceType: 'github',
      sourceId: 'henrik/nanocrab',
      externalEventId: 'issue-123',
      runId: null,
      status: 'reserved',
    });
    expect(listAgentProfileActivity(profile.id, 10)[0]).toMatchObject({
      kind: 'run_started',
      runId: 'job-123',
      summary: expect.stringContaining('Started coding job job-123'),
    });
  });

  it('returns no-op counts for concurrent scans without duplicating pending coding jobs', async () => {
    const profile = createAgentProfile({
      handle: 'RepoFixer',
      displayName: 'Repo Fixer',
      provider: 'codex',
      model: 'gpt-5',
      taskKinds: ['coding_job'],
    });
    createAgentSubscription({
      agentProfileId: profile.id,
      sourceType: 'github',
      filters: { repo: 'henrik/nanocrab' },
      taskKind: 'coding_job',
    });
    const pendingJob = deferred<CodingJob>();
    let observeJobStart!: () => void;
    const jobStarted = new Promise<void>((resolve) => {
      observeJobStart = resolve;
    });
    const listGitHubIssues = vi.fn().mockResolvedValue([issue()]);
    const startCodingJob = vi.fn(() => {
      observeJobStart();
      return pendingJob.promise;
    });

    const firstPromise = runAgentSubscriptionScan({
      now: () => NOW,
      listGitHubIssues,
      startCodingJob,
    });
    await jobStarted;
    const secondPromise = runAgentSubscriptionScan({
      now: () => NOW,
      listGitHubIssues,
      startCodingJob,
    });
    await Promise.resolve();
    pendingJob.resolve(codingJob('job-123'));

    await expect(firstPromise).resolves.toEqual({
      scanned: 1,
      matched: 1,
      skipped: 0,
    });
    await expect(secondPromise).resolves.toEqual({
      scanned: 0,
      matched: 0,
      skipped: 0,
    });
    expect(startCodingJob).toHaveBeenCalledTimes(1);
  });

  it('skips deduped GitHub issues and starts work for the first new returned issue', async () => {
    const profile = createAgentProfile({
      handle: 'RepoFixer',
      displayName: 'Repo Fixer',
      provider: 'codex',
      model: 'gpt-5',
      taskKinds: ['coding_job'],
    });
    const subscription = createAgentSubscription({
      agentProfileId: profile.id,
      sourceType: 'github',
      filters: { repo: 'henrik/nanocrab' },
      taskKind: 'coding_job',
    });
    recordAgentSubscriptionEvent({
      subscriptionId: subscription.id,
      agentProfileId: profile.id,
      dedupeKey: buildSubscriptionDedupeKey({
        sourceType: 'github',
        sourceId: 'henrik/nanocrab',
        externalEventId: 'issue-123',
        agentProfileId: profile.id,
      }),
      sourceType: 'github',
      sourceId: 'henrik/nanocrab',
      externalEventId: 'issue-123',
      runId: null,
      status: 'reserved',
      metadata: { issueNumber: 123 },
    });
    const issue124 = issue({
      number: 124,
      title: 'Fix the next profile subscription',
      htmlUrl: 'https://github.com/henrik/nanocrab/issues/124',
    });
    const listGitHubIssues = vi.fn().mockResolvedValue([issue(), issue124]);
    const startCodingJob = vi.fn().mockResolvedValue(
      codingJob('job-124', {
        issueNumber: 124,
        issueTitle: issue124.title,
        prompt: `Issue title: ${issue124.title}`,
      }),
    );

    const result = await runAgentSubscriptionScan({
      now: () => NOW,
      listGitHubIssues,
      startCodingJob,
    });

    expect(result).toEqual({ scanned: 1, matched: 1, skipped: 0 });
    expect(startCodingJob).toHaveBeenCalledTimes(1);
    expect(startCodingJob).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 124 }),
    );
    expect(
      getAgentSubscriptionEventByDedupeKey(
        buildSubscriptionDedupeKey({
          sourceType: 'github',
          sourceId: 'henrik/nanocrab',
          externalEventId: 'issue-124',
          agentProfileId: profile.id,
        }),
      ),
    ).toMatchObject({
      subscriptionId: subscription.id,
      runId: null,
      status: 'reserved',
    });
  });

  it('blocks subscriptions whose task kind is outside the profile capability boundary', async () => {
    const profile = createAgentProfile({
      handle: 'ChatOnly',
      displayName: 'Chat Only',
      taskKinds: ['chat'],
    });
    const subscription = createAgentSubscription({
      agentProfileId: profile.id,
      sourceType: 'github',
      filters: { repo: 'henrik/nanocrab' },
      taskKind: 'coding_job',
    });
    const listGitHubIssues = vi.fn().mockResolvedValue([issue()]);
    const startCodingJob = vi.fn().mockResolvedValue(codingJob('job-blocked'));

    const result = await runAgentSubscriptionScan({
      now: () => NOW,
      listGitHubIssues,
      startCodingJob,
    });

    expect(result).toEqual({ scanned: 1, matched: 0, skipped: 1 });
    expect(listGitHubIssues).not.toHaveBeenCalled();
    expect(startCodingJob).not.toHaveBeenCalled();
    expect(listAgentProfileActivity(profile.id, 10)[0]).toMatchObject({
      agentProfileId: profile.id,
      subscriptionId: subscription.id,
      kind: 'error',
      sourceType: 'github',
      summary: expect.stringContaining('coding_job'),
    });
  });

  it('records job start errors and keeps scanning later valid subscriptions', async () => {
    const profile = createAgentProfile({
      handle: 'RepoFixer',
      displayName: 'Repo Fixer',
      provider: 'codex',
      model: 'gpt-5',
      taskKinds: ['coding_job'],
    });
    const failingSubscription = createAgentSubscription({
      agentProfileId: profile.id,
      sourceType: 'github',
      filters: { repo: 'henrik/broken', issueNumber: 123 },
      taskKind: 'coding_job',
    });
    createAgentSubscription({
      agentProfileId: profile.id,
      sourceType: 'github',
      filters: { repo: 'henrik/nanocrab', issueNumber: 124 },
      taskKind: 'coding_job',
    });
    const issue124 = issue({
      number: 124,
      title: 'Fix the healthy subscription',
      htmlUrl: 'https://github.com/henrik/nanocrab/issues/124',
    });
    const listGitHubIssues = vi.fn(async ({ repo }: { repo: string }) =>
      repo === 'henrik/broken'
        ? [
            issue({
              title: 'Fail to start coding job',
              htmlUrl: 'https://github.com/henrik/broken/issues/123',
            }),
          ]
        : [issue124],
    );
    const startCodingJob = vi.fn(async (input: StartCodingJobInput) => {
      if (input.issueNumber === 123) {
        throw new Error('job backend unavailable');
      }
      return codingJob('job-124', {
        issueNumber: 124,
        issueTitle: issue124.title,
        prompt: `Issue title: ${issue124.title}`,
      });
    });

    const result = await runAgentSubscriptionScan({
      now: () => NOW,
      listGitHubIssues,
      startCodingJob,
    });

    expect(result).toEqual({ scanned: 2, matched: 1, skipped: 1 });
    expect(startCodingJob).toHaveBeenCalledTimes(2);
    expect(
      getAgentSubscriptionEventByDedupeKey(
        buildSubscriptionDedupeKey({
          sourceType: 'github',
          sourceId: 'henrik/broken',
          externalEventId: 'issue-123',
          agentProfileId: profile.id,
        }),
      ),
    ).toMatchObject({
      subscriptionId: failingSubscription.id,
      runId: null,
      status: 'reserved',
    });
    expect(
      listAgentProfileActivity(profile.id, 10).some(
        (activity) =>
          activity.subscriptionId === failingSubscription.id &&
          activity.kind === 'error' &&
          activity.summary.includes('job backend unavailable'),
      ),
    ).toBe(true);
  });

  it('does not match disabled profiles or disabled subscriptions', async () => {
    const disabledProfile = createAgentProfile({
      handle: 'DisabledAgent',
      displayName: 'Disabled Agent',
      enabled: false,
      taskKinds: ['coding_job'],
    });
    const enabledProfile = createAgentProfile({
      handle: 'IdleAgent',
      displayName: 'Idle Agent',
      taskKinds: ['coding_job'],
    });
    createAgentSubscription({
      agentProfileId: disabledProfile.id,
      sourceType: 'github',
      filters: { repo: 'henrik/nanocrab' },
      taskKind: 'coding_job',
    });
    createAgentSubscription({
      agentProfileId: enabledProfile.id,
      sourceType: 'github',
      enabled: false,
      filters: { repo: 'henrik/nanocrab' },
      taskKind: 'coding_job',
    });
    const listGitHubIssues = vi.fn().mockResolvedValue([issue()]);
    const startCodingJob = vi.fn().mockResolvedValue(codingJob('job-disabled'));

    const result = await runAgentSubscriptionScan({
      now: () => NOW,
      listGitHubIssues,
      startCodingJob,
    });

    expect(result).toEqual({ scanned: 1, matched: 0, skipped: 1 });
    expect(listGitHubIssues).not.toHaveBeenCalled();
    expect(startCodingJob).not.toHaveBeenCalled();
  });

  it('dedupes repeated channel mention events', async () => {
    const profile = createAgentProfile({
      handle: 'RepoFixer',
      displayName: 'Repo Fixer',
    });
    const subscription = createAgentSubscription({
      agentProfileId: profile.id,
      sourceType: 'channel_mention',
      filters: { chatJid: 'group@g.us' },
      taskKind: 'chat',
    });
    storeChatMetadata('group@g.us', '2026-06-27T09:00:00.000Z');
    storeMessage({
      id: 'msg-1',
      chat_jid: 'group@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'Henrik',
      content: '@RepoFixer please look at this issue',
      timestamp: '2026-06-27T09:01:00.000Z',
      is_bot_message: false,
    });
    storeMessage({
      id: 'msg-2',
      chat_jid: 'group@g.us',
      sender: 'bot@s.whatsapp.net',
      sender_name: 'NanoCrab',
      content: '@RepoFixer bot echo should not trigger',
      timestamp: '2026-06-27T09:02:00.000Z',
      is_bot_message: true,
    });
    const startCodingJob = vi.fn();

    const first = await runAgentSubscriptionScan({
      now: () => NOW,
      startCodingJob,
    });
    const second = await runAgentSubscriptionScan({
      now: () => NOW,
      startCodingJob,
    });

    expect(first).toEqual({ scanned: 1, matched: 1, skipped: 0 });
    expect(second).toEqual({ scanned: 1, matched: 0, skipped: 1 });
    expect(startCodingJob).not.toHaveBeenCalled();

    const dedupeKey = buildSubscriptionDedupeKey({
      sourceType: 'channel_mention',
      sourceId: 'group@g.us',
      externalEventId: 'msg-1',
      agentProfileId: profile.id,
    });
    expect(getAgentSubscriptionEventByDedupeKey(dedupeKey)).toMatchObject({
      subscriptionId: subscription.id,
      sourceType: 'channel_mention',
      sourceId: 'group@g.us',
      externalEventId: 'msg-1',
      status: 'matched',
    });
    expect(listAgentProfileActivity(profile.id, 10)).toHaveLength(1);
  });

  it('records blocked activity when a connector or run prerequisite is missing', async () => {
    const profile = createAgentProfile({
      handle: 'RepoFixer',
      displayName: 'Repo Fixer',
      taskKinds: ['coding_job'],
    });
    const subscription = createAgentSubscription({
      agentProfileId: profile.id,
      sourceType: 'github',
      filters: {},
      taskKind: 'coding_job',
    });
    const listGitHubIssues = vi.fn().mockResolvedValue([issue()]);
    const startCodingJob = vi.fn().mockResolvedValue(codingJob('job-missing'));

    const result = await runAgentSubscriptionScan({
      now: () => NOW,
      listGitHubIssues,
      startCodingJob,
    });

    expect(result).toEqual({ scanned: 1, matched: 0, skipped: 1 });
    expect(listGitHubIssues).not.toHaveBeenCalled();
    expect(startCodingJob).not.toHaveBeenCalled();
    expect(listAgentProfileActivity(profile.id, 10)[0]).toMatchObject({
      agentProfileId: profile.id,
      subscriptionId: subscription.id,
      kind: 'error',
      sourceType: 'github',
      summary: expect.stringContaining('filters.repo'),
    });
  });
});
