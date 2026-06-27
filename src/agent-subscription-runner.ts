import { randomUUID } from 'crypto';

import {
  listGitHubIssues as defaultListGitHubIssues,
  startCodingJob as defaultStartCodingJob,
} from './coding-jobs.js';
import {
  AgentProfileResolutionError,
  resolveAgentProfileInvocation,
} from './agent-profile-router.js';
import {
  buildSubscriptionDedupeKey,
  getAgentProfile,
  listEnabledAgentSubscriptions,
  normalizeAgentHandle,
  recordAgentProfileActivity,
  recordAgentSubscriptionEvent,
  updateAgentSubscription,
} from './agent-profiles.js';
import {
  deleteReservedAgentSubscriptionEvent,
  getAgentSubscriptionEventByDedupeKey,
  getRecentUserMessages,
  markReservedAgentSubscriptionEventMatched,
} from './db.js';
import type {
  AgentProfile,
  AgentProfileActivity,
  AgentSubscription,
  AgentSubscriptionEvent,
} from './types.js';

export interface SubscriptionRunnerDeps {
  now?: () => string;
  listGitHubIssues?: typeof defaultListGitHubIssues;
  startCodingJob?: typeof defaultStartCodingJob;
}

interface ScanCounts {
  scanned: number;
  matched: number;
  skipped: number;
}

type SubscriptionScanResult = 'matched' | 'skipped';

let scanInFlight = false;

export async function runAgentSubscriptionScan(
  deps: SubscriptionRunnerDeps = {},
): Promise<ScanCounts> {
  if (scanInFlight) return { scanned: 0, matched: 0, skipped: 0 };

  scanInFlight = true;
  try {
    const counts: ScanCounts = { scanned: 0, matched: 0, skipped: 0 };
    const scanDeps = {
      now: deps.now ?? (() => new Date().toISOString()),
      listGitHubIssues: deps.listGitHubIssues ?? defaultListGitHubIssues,
      startCodingJob: deps.startCodingJob ?? defaultStartCodingJob,
    };

    for (const subscription of listEnabledAgentSubscriptions()) {
      counts.scanned += 1;

      const profile = getAgentProfile(subscription.agentProfileId);
      if (!profile?.enabled || !subscription.enabled) {
        counts.skipped += 1;
        continue;
      }

      try {
        if (!profile.taskKinds.includes(subscription.taskKind)) {
          recordTaskKindBlocked(profile, subscription);
          counts.skipped += 1;
          continue;
        }

        const result = await scanSubscription(subscription, profile, scanDeps);
        counts[result === 'matched' ? 'matched' : 'skipped'] += 1;
      } catch (err) {
        recordScanError(profile, subscription, err);
        counts.skipped += 1;
      }
    }

    return counts;
  } finally {
    scanInFlight = false;
  }
}

async function scanSubscription(
  subscription: AgentSubscription,
  profile: AgentProfile,
  deps: Required<SubscriptionRunnerDeps>,
): Promise<SubscriptionScanResult> {
  if (subscription.sourceType === 'github') {
    return scanGitHubSubscription(subscription, profile, deps);
  }

  if (subscription.sourceType === 'channel_mention') {
    return scanChannelMentionSubscription(subscription, profile, deps);
  }

  recordActivity(profile, subscription, {
    kind: 'error',
    sourceType: subscription.sourceType,
    sourceId: null,
    summary: `Unsupported subscription source type: ${subscription.sourceType}`,
    metadata: {},
  });
  return 'skipped';
}

async function scanGitHubSubscription(
  subscription: AgentSubscription,
  profile: AgentProfile,
  deps: Required<SubscriptionRunnerDeps>,
): Promise<SubscriptionScanResult> {
  const repo = stringFilter(subscription.filters, 'repo');
  if (!repo) {
    recordActivity(profile, subscription, {
      kind: 'error',
      sourceType: 'github',
      sourceId: null,
      summary: 'GitHub subscription is missing required filters.repo',
      metadata: { filters: subscription.filters },
    });
    return 'skipped';
  }

  const issues = await deps.listGitHubIssues({
    repo,
    labels: stringArrayFilter(subscription.filters, 'labels'),
    assignee: stringFilter(subscription.filters, 'assignee'),
    milestone: stringFilter(subscription.filters, 'milestone'),
    issueNumber: numberFilter(subscription.filters, 'issueNumber'),
    limit: 10,
  });
  safeUpdateSubscription(subscription, { lastSeenAt: deps.now() });

  for (const issue of issues) {
    const externalEventId = `issue-${issue.number}`;
    const dedupeKey = buildSubscriptionDedupeKey({
      sourceType: 'github',
      sourceId: repo,
      externalEventId,
      agentProfileId: profile.id,
    });
    if (getAgentSubscriptionEventByDedupeKey(dedupeKey)) continue;

    const reservationId = randomUUID();
    const metadata = {
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueUrl: issue.htmlUrl,
    };
    const reservation = recordAgentSubscriptionEvent({
      subscriptionId: subscription.id,
      agentProfileId: profile.id,
      dedupeKey,
      sourceType: 'github',
      sourceId: repo,
      externalEventId,
      runId: null,
      status: 'reserved',
      metadata: { ...metadata, reservationId },
    });
    if (!ownsReservation(reservation, reservationId)) continue;

    let runId: string | null = null;
    if (subscription.taskKind === 'coding_job') {
      try {
        const job = await deps.startCodingJob({
          repo,
          issueNumber: issue.number,
          provider: profile.provider ?? undefined,
          model: profile.model ?? undefined,
          createPr: false,
          requestedBy: `agent:${profile.handle}`,
          agentProfileId: profile.id,
          sourceSubscriptionId: subscription.id,
        });
        runId = job.id;
      } catch (err) {
        deleteReservedAgentSubscriptionEvent({
          dedupeKey,
          subscriptionId: subscription.id,
          agentProfileId: profile.id,
        });
        recordActivity(profile, subscription, {
          kind: 'error',
          sourceType: 'github',
          sourceId: repo,
          summary: `Failed to start coding job for ${repo}#${issue.number}: ${errorMessage(err)}`,
          metadata: { ...metadata, error: errorMessage(err) },
        });
        return 'skipped';
      }
    }

    markReservedAgentSubscriptionEventMatched({
      dedupeKey,
      subscriptionId: subscription.id,
      agentProfileId: profile.id,
      runId,
    });
    recordActivity(profile, subscription, {
      kind: runId ? 'run_started' : 'subscription_match',
      sourceType: 'github',
      sourceId: repo,
      summary: runId
        ? `Started coding job ${runId} for ${repo}#${issue.number}: ${issue.title}`
        : `Matched GitHub issue ${repo}#${issue.number}: ${issue.title}`,
      runId,
      metadata,
    });
    safeUpdateSubscription(subscription, {
      lastSeenAt: deps.now(),
      lastMatchedAt: deps.now(),
      lastRunId: runId,
    });

    return 'matched';
  }

  return 'skipped';
}

async function scanChannelMentionSubscription(
  subscription: AgentSubscription,
  profile: AgentProfile,
  deps: Required<SubscriptionRunnerDeps>,
): Promise<SubscriptionScanResult> {
  const chatJid = stringFilter(subscription.filters, 'chatJid');
  if (!chatJid) {
    recordActivity(profile, subscription, {
      kind: 'error',
      sourceType: 'channel_mention',
      sourceId: null,
      summary:
        'Channel mention subscription is missing required filters.chatJid',
      metadata: { filters: subscription.filters },
    });
    return 'skipped';
  }

  let sawDedupedMatch = false;
  for (const message of getRecentUserMessages(chatJid, 50)) {
    if (!messageMatchesProfile(message.content, profile, chatJid)) continue;

    const dedupeKey = buildSubscriptionDedupeKey({
      sourceType: 'channel_mention',
      sourceId: chatJid,
      externalEventId: message.id,
      agentProfileId: profile.id,
    });
    if (getAgentSubscriptionEventByDedupeKey(dedupeKey)) {
      sawDedupedMatch = true;
      continue;
    }

    const metadata = {
      messageId: message.id,
      senderName: message.sender_name,
      timestamp: message.timestamp,
    };
    recordAgentSubscriptionEvent({
      subscriptionId: subscription.id,
      agentProfileId: profile.id,
      dedupeKey,
      sourceType: 'channel_mention',
      sourceId: chatJid,
      externalEventId: message.id,
      runId: null,
      status: 'matched',
      metadata,
    });
    recordActivity(profile, subscription, {
      kind: 'subscription_match',
      sourceType: 'channel_mention',
      sourceId: chatJid,
      summary: `Matched channel mention @${profile.handle} in ${chatJid}`,
      metadata,
    });
    safeUpdateSubscription(subscription, {
      lastSeenAt: deps.now(),
      lastMatchedAt: deps.now(),
      lastRunId: null,
    });
    return 'matched';
  }

  if (sawDedupedMatch) return 'skipped';
  safeUpdateSubscription(subscription, { lastSeenAt: deps.now() });
  return 'skipped';
}

function messageMatchesProfile(
  content: string,
  profile: AgentProfile,
  chatJid: string,
): boolean {
  try {
    return (
      resolveAgentProfileInvocation({
        text: content,
        profiles: buildChannelMentionProfiles(profile, chatJid),
      })?.profileId === profile.id
    );
  } catch (err) {
    if (err instanceof AgentProfileResolutionError) return false;
    throw err;
  }
}

function buildChannelMentionProfiles(
  profile: AgentProfile,
  chatJid: string,
): AgentProfile[] {
  const handles = channelMentionHandles(profile, chatJid);
  return handles.map((handle, index) =>
    index === 0 ? profile : { ...profile, handle },
  );
}

function channelMentionHandles(
  profile: AgentProfile,
  chatJid: string,
): string[] {
  const seen = new Set<string>();
  const handles: string[] = [];

  const addHandle = (value: string): void => {
    const handle = normalizeAgentHandle(value);
    if (!handle || seen.has(handle)) return;
    seen.add(handle);
    handles.push(handle);
  };

  addHandle(profile.handle);

  for (const bindingKey of [chatJid, 'channel_mention', 'channel']) {
    for (const alias of profile.channelBindings[bindingKey] ?? []) {
      addHandle(alias);
    }
  }

  return handles;
}

function stringFilter(
  filters: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = filters[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function stringArrayFilter(
  filters: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = filters[key];
  if (!Array.isArray(value)) return undefined;
  const strings = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return strings.length > 0 ? strings : undefined;
}

function numberFilter(
  filters: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = filters[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function safeUpdateSubscription(
  subscription: AgentSubscription,
  patch: Parameters<typeof updateAgentSubscription>[2],
): void {
  try {
    updateAgentSubscription(
      subscription.agentProfileId,
      subscription.id,
      patch,
    );
  } catch {
    /* subscription metadata is best-effort for scanner progress */
  }
}

function ownsReservation(
  event: AgentSubscriptionEvent,
  reservationId: string,
): boolean {
  return (
    event.status === 'reserved' &&
    event.runId === null &&
    event.metadata.reservationId === reservationId
  );
}

function recordTaskKindBlocked(
  profile: AgentProfile,
  subscription: AgentSubscription,
): void {
  recordActivity(profile, subscription, {
    kind: 'error',
    sourceType: subscription.sourceType,
    sourceId: subscriptionSourceId(subscription),
    summary: `Agent profile @${profile.handle} does not allow subscription task kind ${subscription.taskKind}`,
    metadata: {
      taskKind: subscription.taskKind,
      profileTaskKinds: profile.taskKinds,
    },
  });
}

function recordScanError(
  profile: AgentProfile,
  subscription: AgentSubscription,
  err: unknown,
): void {
  recordActivity(profile, subscription, {
    kind: 'error',
    sourceType: subscription.sourceType,
    sourceId: subscriptionSourceId(subscription),
    summary: `Agent subscription scan failed: ${errorMessage(err)}`,
    metadata: {},
  });
}

function subscriptionSourceId(subscription: AgentSubscription): string | null {
  return (
    stringFilter(subscription.filters, 'repo') ??
    stringFilter(subscription.filters, 'chatJid') ??
    null
  );
}

function recordActivity(
  profile: AgentProfile,
  subscription: AgentSubscription,
  input: {
    kind: AgentProfileActivity['kind'];
    sourceType: string;
    sourceId: string | null;
    summary: string;
    runId?: string | null;
    metadata: Record<string, unknown>;
  },
): void {
  recordAgentProfileActivity({
    agentProfileId: profile.id,
    subscriptionId: subscription.id,
    kind: input.kind,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    summary: input.summary,
    runId: input.runId ?? null,
    approvalId: null,
    metadata: input.metadata,
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
