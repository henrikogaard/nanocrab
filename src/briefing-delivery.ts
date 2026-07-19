import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { ApprovalRequest } from './approvals.js';
import { recordBriefingRun } from './briefing-history.js';
import { STORE_DIR } from './config.js';
import { getTaskById } from './db.js';
import { sendScheduledTaskWebhook } from './webhook-delivery.js';

type ApprovedBriefingMode = 'chat' | 'dashboard' | 'file' | 'webhook';

interface BriefingApprovalIdentity {
  taskId: string;
  mode: ApprovedBriefingMode;
  target: string;
  result: string;
}

function digest(parts: readonly string[]): string {
  return crypto.createHash('sha256').update(parts.join('\0')).digest('hex');
}

export function briefingApprovalTargetId(
  input: BriefingApprovalIdentity,
): string {
  return `${input.taskId}:${digest([input.mode, input.target, input.result])}`;
}

export function webhookApprovalTargetId(taskId: string, url: string): string {
  return `${taskId}:${digest([url])}`;
}

function payloadString(approval: ApprovalRequest, key: string): string {
  const value = approval.payload[key];
  return typeof value === 'string' ? value : '';
}

function approvedFilePath(taskId: string, target: string): string {
  const root = path.resolve(STORE_DIR, 'task-deliveries');
  const relative = path.isAbsolute(target) ? path.basename(target) : target;
  const normalized = path
    .normalize(relative || `${taskId}.md`)
    .replace(/^(\.\.(\/|\\|$))+/, '');
  const safeTarget =
    normalized && normalized !== '.' && !normalized.startsWith('..')
      ? normalized
      : `${taskId}.md`;
  const resolved = path.resolve(root, safeTarget);
  return resolved === root || !resolved.startsWith(`${root}${path.sep}`)
    ? path.join(root, `${taskId}.md`)
    : resolved;
}

export async function executeBriefingDeliveryApproval(
  approval: ApprovalRequest,
  deps: {
    sendMessage(jid: string, text: string): Promise<void>;
  },
): Promise<void> {
  if (approval.kind !== 'briefing-delivery' || approval.status !== 'approved') {
    throw new Error(
      `Approval ${approval.id} is not an approved briefing delivery`,
    );
  }

  const taskId = payloadString(approval, 'taskId');
  const mode = payloadString(approval, 'mode') as ApprovedBriefingMode;
  const target = payloadString(approval, 'channelId');
  const result = payloadString(approval, 'result');
  if (
    !taskId ||
    !target ||
    !result ||
    !['chat', 'dashboard', 'file', 'webhook'].includes(mode)
  ) {
    throw new Error('Briefing delivery approval payload is incomplete');
  }
  if (
    approval.targetType !== 'scheduled-task-result' ||
    approval.targetId !==
      briefingApprovalTargetId({ taskId, mode, target, result })
  ) {
    throw new Error(
      'Briefing delivery approval identity does not match payload',
    );
  }

  const task = getTaskById(taskId);
  if (!task) throw new Error(`Scheduled task not found: ${taskId}`);

  try {
    if (mode === 'chat') {
      await deps.sendMessage(target, result);
    } else if (mode === 'file') {
      const outputPath = approvedFilePath(taskId, target);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, result, 'utf8');
    } else if (mode === 'webhook') {
      await sendScheduledTaskWebhook({
        url: target,
        taskId,
        result,
        approvalId: approval.id,
      });
    }

    recordBriefingRun({
      taskId,
      source: approval.source === 'manual-run' ? 'manual' : 'scheduled',
      routine: task.title || task.routine_type || task.id,
      mission: task.group_folder,
      groupFolder: task.group_folder,
      channel: target,
      status: 'completed',
      deliveryMode: mode,
      deliveryTarget: target,
      approvalState: 'approved',
      resultPreview: result.slice(0, 500),
    });
  } catch (error) {
    recordBriefingRun({
      taskId,
      source: approval.source === 'manual-run' ? 'manual' : 'scheduled',
      routine: task.title || task.routine_type || task.id,
      mission: task.group_folder,
      groupFolder: task.group_folder,
      channel: target,
      status: 'failed',
      deliveryMode: mode,
      deliveryTarget: target,
      approvalState: 'approved',
      failureContext: error instanceof Error ? error.message : String(error),
      resultPreview: result.slice(0, 500),
    });
    throw error;
  }
}
