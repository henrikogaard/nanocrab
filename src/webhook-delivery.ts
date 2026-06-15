import type { ApprovalRequest } from './approvals.js';

export interface WebhookDeliveryResult {
  status: number;
  ok: boolean;
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

export async function executeWebhookDeliveryApproval(
  approval: ApprovalRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<WebhookDeliveryResult> {
  if (approval.kind !== 'webhook-delivery') {
    throw new Error(`Approval ${approval.id} is not a webhook delivery`);
  }
  if (approval.status !== 'approved') {
    throw new Error(`Webhook delivery approval ${approval.id} is not approved`);
  }

  const url = payloadString(approval.payload, 'url');
  const result = payloadString(approval.payload, 'result');
  const taskId = payloadString(approval.payload, 'taskId');
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('Webhook delivery approval is missing a valid URL');
  }

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'NanoCrab-Scheduled-Task',
    },
    body: JSON.stringify({
      taskId,
      result,
      approvalId: approval.id,
      deliveredAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Webhook delivery failed with HTTP ${response.status}`);
  }
  return { ok: response.ok, status: response.status };
}
