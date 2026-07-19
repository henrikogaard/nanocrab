import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({
  getTaskById: vi.fn(() => ({
    id: 'task-1',
    title: 'Daily briefing',
    group_folder: 'main',
    chat_jid: 'wa:main',
    delivery_mode: 'chat',
  })),
}));

vi.mock('./briefing-history.js', () => ({
  recordBriefingRun: vi.fn(),
}));

vi.mock('./webhook-delivery.js', () => ({
  sendScheduledTaskWebhook: vi.fn(async () => ({ ok: true, status: 200 })),
}));

import {
  briefingApprovalTargetId,
  executeBriefingDeliveryApproval,
  webhookApprovalTargetId,
} from './briefing-delivery.js';
import { recordBriefingRun } from './briefing-history.js';

describe('approved briefing delivery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delivers the exact approved chat result and records completion', async () => {
    const sendMessage = vi.fn(async () => {});
    await executeBriefingDeliveryApproval(
      {
        id: 'approval-1',
        kind: 'briefing-delivery',
        status: 'approved',
        targetType: 'scheduled-task-result',
        targetId: briefingApprovalTargetId({
          taskId: 'task-1',
          mode: 'chat',
          target: 'wa:main',
          result: 'Approved result',
        }),
        payload: {
          taskId: 'task-1',
          mode: 'chat',
          channelId: 'wa:main',
          result: 'Approved result',
        },
      } as any,
      { sendMessage },
    );

    expect(sendMessage).toHaveBeenCalledWith('wa:main', 'Approved result');
    expect(recordBriefingRun).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        status: 'completed',
        approvalState: 'approved',
      }),
    );
  });

  it('scopes target identifiers to the result and webhook URL', () => {
    expect(
      briefingApprovalTargetId({
        taskId: 'task-1',
        mode: 'chat',
        target: 'wa:main',
        result: 'one',
      }),
    ).not.toBe(
      briefingApprovalTargetId({
        taskId: 'task-1',
        mode: 'chat',
        target: 'wa:main',
        result: 'two',
      }),
    );
    expect(webhookApprovalTargetId('task-1', 'https://one.example')).not.toBe(
      webhookApprovalTargetId('task-1', 'https://two.example'),
    );
  });
});
