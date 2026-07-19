import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_DIR = path.join(
  os.tmpdir(),
  `nanocrab-briefing-history-${Date.now()}`,
);
const HISTORY_PATH = path.join(TEST_DIR, 'briefing-history.json');
const PREFERENCES_PATH = path.join(TEST_DIR, 'delivery-preferences.json');

vi.mock('./config.js', () => ({
  STORE_DIR: TEST_DIR,
  MAX_SESSION_RETENTION_DAYS: 90,
}));

// redactAuditValue is not mocked so the real secret-redaction logic runs

vi.mock('./approvals.js', () => ({
  createApproval: vi.fn(() => ({ id: 'approval-1', status: 'pending' })),
  findPendingApprovalForTarget: vi.fn(() => undefined),
  hasApprovedTarget: vi.fn(() => false),
  listApprovals: vi.fn(() => []),
}));

const {
  recordBriefingRun,
  listBriefingHistory,
  getBriefingAnalytics,
  setDeliveryPreference,
  getDeliveryPreference,
  resolveDeliveryMode,
  exportBriefingHistory,
  pruneBriefingHistory,
  sendChannelFollowUp,
  loadBriefingHistoryStore,
} = await import('./briefing-history.js');

function seedHistory() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const store = {
    entries: [
      {
        id: 'b-1',
        taskId: 'task-a',
        source: 'scheduled',
        routine: 'daily-briefing',
        mission: 'main',
        groupFolder: 'main',
        channel: 'wa:main',
        status: 'completed',
        delivery: {
          mode: 'chat',
          target: 'wa:main',
          attemptedAt: '2026-01-01T08:00:00.000Z',
          deliveredAt: '2026-01-01T08:00:01.000Z',
          failureContext: null,
        },
        approvalState: 'none',
        latencyMs: 1200,
        retryCount: 0,
        retriedFrom: null,
        redacted: true,
        timestamp: '2026-01-01T08:00:00.000Z',
        resultPreview: null,
      },
      {
        id: 'b-2',
        taskId: 'task-b',
        source: 'manual',
        routine: 'weekly-briefing',
        mission: 'main',
        groupFolder: 'main',
        channel: 'wa:main',
        status: 'failed',
        delivery: {
          mode: 'chat',
          target: 'wa:main',
          attemptedAt: '2026-01-02T08:00:00.000Z',
          deliveredAt: null,
          failureContext: 'network error',
        },
        approvalState: 'none',
        latencyMs: 3000,
        retryCount: 1,
        retriedFrom: null,
        redacted: true,
        timestamp: '2026-01-02T08:00:00.000Z',
        resultPreview: null,
      },
      {
        id: 'b-3',
        taskId: 'task-c',
        source: 'scheduled',
        routine: 'daily-briefing',
        mission: 'ops',
        groupFolder: 'ops',
        channel: 'sig:ops',
        status: 'approval-blocked',
        delivery: {
          mode: 'chat',
          target: 'sig:ops',
          attemptedAt: '2026-01-03T08:00:00.000Z',
          deliveredAt: null,
          failureContext: null,
        },
        approvalState: 'pending',
        latencyMs: 500,
        retryCount: 0,
        retriedFrom: null,
        redacted: true,
        timestamp: '2026-01-03T08:00:00.000Z',
        resultPreview: null,
      },
    ],
  };
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(store));
}

describe('briefing history', () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    vi.clearAllMocks();
  });

  it('records and lists history entries', () => {
    const entry = recordBriefingRun(
      {
        taskId: 't1',
        source: 'scheduled',
        routine: 'daily-briefing',
        mission: 'main',
        groupFolder: 'main',
        channel: 'wa:main',
        status: 'completed',
        deliveryMode: 'chat',
        deliveryTarget: 'wa:main',
        latencyMs: 1000,
        resultPreview: 'result preview',
      },
      { historyPath: HISTORY_PATH, preferencesPath: PREFERENCES_PATH },
    );

    expect(entry.id).toMatch(/^briefing-/);
    expect(entry.routine).toBe('daily-briefing');
    expect(entry.status).toBe('completed');
    expect(entry.delivery.mode).toBe('chat');

    const entries = listBriefingHistory(
      {},
      { historyPath: HISTORY_PATH, preferencesPath: PREFERENCES_PATH },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].taskId).toBe('t1');
  });

  it('filters history by status and group', () => {
    seedHistory();
    const completed = listBriefingHistory(
      { status: 'completed' },
      { historyPath: HISTORY_PATH, preferencesPath: PREFERENCES_PATH },
    );
    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe('b-1');

    const ops = listBriefingHistory(
      { groupFolder: 'ops' },
      { historyPath: HISTORY_PATH, preferencesPath: PREFERENCES_PATH },
    );
    expect(ops).toHaveLength(1);
    expect(ops[0].id).toBe('b-3');
  });

  it('aggregates analytics by routine, mission, channel, outcome, and approval state', () => {
    seedHistory();
    const analytics = getBriefingAnalytics(
      {},
      { historyPath: HISTORY_PATH, preferencesPath: PREFERENCES_PATH },
    );

    expect(analytics.total).toBe(3);
    expect(analytics.byOutcome).toMatchObject({
      completed: 1,
      failed: 1,
      'approval-blocked': 1,
    });
    expect(analytics.byApprovalState).toMatchObject({
      none: 2,
      pending: 1,
    });
    expect(analytics.byRoutine['daily-briefing']).toBe(2);
    expect(analytics.byMission['main']).toBe(2);
    expect(analytics.byChannel['wa:main']).toBe(2);

    const bucket = analytics.buckets.find(
      (b) => b.routine === 'daily-briefing' && b.channel === 'wa:main',
    );
    expect(bucket).toBeDefined();
    expect(bucket?.outcome).toBe('completed');
    expect(bucket?.count).toBe(1);
    expect(bucket?.avgLatencyMs).toBe(1200);
  });

  it('aggregates every retained entry instead of the newest 100', () => {
    seedHistory();
    const store = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')) as {
      entries: Array<Record<string, unknown>>;
    };
    const template = store.entries[0]!;
    store.entries = Array.from({ length: 150 }, (_, index) => ({
      ...template,
      id: `entry-${index}`,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }));
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(store));

    expect(
      getBriefingAnalytics(
        {},
        { historyPath: HISTORY_PATH, preferencesPath: PREFERENCES_PATH },
      ).total,
    ).toBe(150);
  });

  it('sets and resolves delivery preferences per group/channel', () => {
    setDeliveryPreference(
      {
        groupFolder: 'main',
        channelId: 'wa:main',
        mode: 'disabled',
      },
      { historyPath: HISTORY_PATH, preferencesPath: PREFERENCES_PATH },
    );

    const pref = getDeliveryPreference('main', 'wa:main', {
      historyPath: HISTORY_PATH,
      preferencesPath: PREFERENCES_PATH,
    });
    expect(pref?.mode).toBe('disabled');

    const resolved = resolveDeliveryMode('main', 'wa:main', 'chat', {
      historyPath: HISTORY_PATH,
      preferencesPath: PREFERENCES_PATH,
    });
    expect(resolved.allowed).toBe(false);
    expect(resolved.reason).toMatch(/disabled/i);
  });

  it('exports history with redaction preserved', () => {
    recordBriefingRun(
      {
        taskId: 't-redact',
        source: 'scheduled',
        routine: 'daily-briefing',
        mission: 'main',
        groupFolder: 'main',
        channel: 'wa:main',
        status: 'failed',
        deliveryMode: 'chat',
        failureContext: 'token sk-1234567890 failed',
        latencyMs: 100,
      },
      { historyPath: HISTORY_PATH, preferencesPath: PREFERENCES_PATH },
    );

    const exported = exportBriefingHistory(
      {},
      { historyPath: HISTORY_PATH, preferencesPath: PREFERENCES_PATH },
    );
    expect(exported.entries[0].delivery.failureContext).not.toContain(
      'sk-1234567890',
    );
  });

  it('prunes entries older than retention days', () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    const oldEntry = {
      id: 'old',
      taskId: 't-old',
      source: 'scheduled',
      routine: 'r',
      mission: 'm',
      groupFolder: 'g',
      channel: 'c',
      status: 'completed',
      delivery: {
        mode: 'dashboard',
        target: null,
        attemptedAt: '2020-01-01T00:00:00.000Z',
        deliveredAt: null,
        failureContext: null,
      },
      approvalState: 'none',
      latencyMs: 0,
      retryCount: 0,
      retriedFrom: null,
      redacted: true,
      timestamp: '2020-01-01T00:00:00.000Z',
      resultPreview: null,
    };
    fs.writeFileSync(HISTORY_PATH, JSON.stringify({ entries: [oldEntry] }));

    pruneBriefingHistory(undefined, {
      historyPath: HISTORY_PATH,
      preferencesPath: PREFERENCES_PATH,
      maxRetentionDays: 30,
    });

    const store = loadBriefingHistoryStore(HISTORY_PATH);
    expect(store.entries).toHaveLength(0);
  });

  it('honors disabled delivery preference for mobile follow-ups', async () => {
    const send = vi.fn();
    setDeliveryPreference(
      {
        groupFolder: 'ops',
        channelId: 'wa:ops',
        mode: 'disabled',
      },
      { historyPath: HISTORY_PATH, preferencesPath: PREFERENCES_PATH },
    );

    const entry = await sendChannelFollowUp({
      groupFolder: 'ops',
      channelId: 'wa:ops',
      text: 'follow up',
      sendMessage: send,
      options: { historyPath: HISTORY_PATH, preferencesPath: PREFERENCES_PATH },
    });

    expect(send).not.toHaveBeenCalled();
    expect(entry.status).toBe('skipped');
    expect(entry.delivery.mode).toBe('dashboard');
  });

  it('blocks mobile follow-ups when approval is required', async () => {
    const send = vi.fn();
    setDeliveryPreference(
      {
        groupFolder: 'ops',
        channelId: 'wa:ops',
        mode: 'approval-required',
      },
      { historyPath: HISTORY_PATH, preferencesPath: PREFERENCES_PATH },
    );

    const entry = await sendChannelFollowUp({
      groupFolder: 'ops',
      channelId: 'wa:ops',
      text: 'follow up',
      sendMessage: send,
      options: { historyPath: HISTORY_PATH, preferencesPath: PREFERENCES_PATH },
    });

    expect(send).not.toHaveBeenCalled();
    expect(entry.status).toBe('approval-blocked');
    expect(entry.approvalState).toBe('pending');
  });
});
