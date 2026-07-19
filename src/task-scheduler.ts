import { ChildProcess } from 'child_process';
import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';
import path from 'path';

import {
  briefingApprovalTargetId,
  webhookApprovalTargetId,
} from './briefing-delivery.js';

import {
  ASSISTANT_NAME,
  SCHEDULER_POLL_INTERVAL,
  STORE_DIR,
  TIMEZONE,
} from './config.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  createApproval,
  findPendingApprovalForTarget,
  hasApprovedTarget,
} from './approvals.js';
import {
  getAllTasks,
  getDueTasks,
  getTaskById,
  getTaskRunLogs,
  logTaskRun,
  updateTask,
  updateTaskAfterRun,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { getAgentProviderConfig, isAgentProvider } from './agent-provider.js';
import { logger } from './logger.js';
import {
  getProviderProfile,
  ProviderPurpose,
  PROVIDER_PURPOSES,
} from './provider-router.js';
import { RegisteredGroup, ScheduledTask } from './types.js';
import { sendScheduledTaskWebhook } from './webhook-delivery.js';
import {
  BriefingHistoryEntry,
  BriefingOutcome,
  BriefingSource,
  getNextRetryCountForTask,
  recordBriefingRun,
  resolveDeliveryMode,
} from './briefing-history.js';

interface HeartbeatPolicy {
  quietHours?: {
    start?: string;
    end?: string;
  };
  activeHours?: {
    start?: string;
    end?: string;
  };
  staleAfterMinutes?: number;
}

/**
 * Compute the next run time for a recurring task, anchored to the
 * task's scheduled time rather than Date.now() to prevent cumulative
 * drift on interval-based tasks.
 *
 * Co-authored-by: @community-pr-601
 */
export function computeNextRun(task: ScheduledTask): string | null {
  if (task.schedule_type === 'once') return null;

  const now = Date.now();

  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, {
      tz: TIMEZONE,
    });
    return interval.next().toISOString();
  }

  if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    if (!ms || ms <= 0) {
      // Guard against malformed interval that would cause an infinite loop
      logger.warn(
        { taskId: task.id, value: task.schedule_value },
        'Invalid interval value',
      );
      return new Date(now + 60_000).toISOString();
    }
    // Anchor to the scheduled time, not now, to prevent drift.
    // Skip past any missed intervals so we always land in the future.
    let next = new Date(task.next_run!).getTime() + ms;
    while (next <= now) {
      next += ms;
    }
    return new Date(next).toISOString();
  }

  return null;
}

export interface SchedulerDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: GroupQueue;
  onProcess: (
    groupJid: string,
    proc: ChildProcess,
    containerName: string,
    groupFolder: string,
  ) => void;
  sendMessage: (jid: string, text: string) => Promise<void>;
  saveSession?: (key: string, sessionId: string) => void;
}

function parseStringArrayJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseHeartbeatPolicy(
  value: string | null | undefined,
): HeartbeatPolicy {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parseClockMinutes(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function isWithinClockWindow(
  nowMinutes: number,
  startValue: string | undefined,
  endValue: string | undefined,
): boolean {
  const start = parseClockMinutes(startValue);
  const end = parseClockMinutes(endValue);
  if (start === null || end === null) return false;
  if (start === end) return true;
  if (start < end) return nowMinutes >= start && nowMinutes < end;
  return nowMinutes >= start || nowMinutes < end;
}

function isHeartbeatStale(
  task: ScheduledTask,
  policy: HeartbeatPolicy,
  now: Date,
): boolean {
  const staleAfterMinutes = Number(policy.staleAfterMinutes);
  if (!Number.isFinite(staleAfterMinutes) || staleAfterMinutes <= 0) {
    return false;
  }
  if (!task.last_run) return true;
  const lastRunMs = new Date(task.last_run).getTime();
  if (!Number.isFinite(lastRunMs)) return true;
  return now.getTime() - lastRunMs >= staleAfterMinutes * 60_000;
}

function heartbeatSkipReason(
  task: ScheduledTask,
  now = new Date(),
): string | null {
  const policy = parseHeartbeatPolicy(task.heartbeat_policy_json);
  if (task.routine_type !== 'heartbeat' && !task.heartbeat_policy_json) {
    return null;
  }
  if (isHeartbeatStale(task, policy, now)) return null;

  const nowMinutes = minutesSinceMidnight(now);
  if (
    policy.quietHours &&
    isWithinClockWindow(
      nowMinutes,
      policy.quietHours.start,
      policy.quietHours.end,
    )
  ) {
    return 'Skipped: quiet hours';
  }

  if (
    policy.activeHours &&
    !isWithinClockWindow(
      nowMinutes,
      policy.activeHours.start,
      policy.activeHours.end,
    )
  ) {
    return 'Skipped: outside active hours';
  }

  return null;
}

function getTaskSessionStorageKey(task: ScheduledTask): string | undefined {
  if (task.context_mode === 'group') return task.group_folder;
  if (task.context_mode === 'session') {
    const key = task.session_key?.trim() || task.id;
    return `task:${key}`;
  }
  return undefined;
}

function buildPromptWithChainedContext(task: ScheduledTask): string {
  const sourceTaskIds = parseStringArrayJson(task.context_task_ids_json);
  if (sourceTaskIds.length === 0) return task.prompt;

  const sections: string[] = [];
  for (const taskId of sourceTaskIds) {
    const logs = getTaskRunLogs(taskId, 3);
    if (!logs.length) continue;
    const rows = logs.map((log) => {
      const body = log.status === 'error' ? log.error : log.result;
      return `- ${log.run_at} ${log.status}: ${body || '(no output)'}`;
    });
    sections.push(`Source task ${taskId} recent results:\n${rows.join('\n')}`);
  }

  if (!sections.length) return task.prompt;
  return [
    'Recent scheduled-task context for this routine:',
    sections.join('\n\n'),
    'Current routine request:',
    task.prompt,
  ].join('\n\n');
}

function resolveDeliveryFilePath(task: ScheduledTask): string {
  const root = path.resolve(STORE_DIR, 'task-deliveries');
  const rawTarget = task.delivery_target?.trim() || `${task.id}.md`;
  const relativeTarget = path.isAbsolute(rawTarget)
    ? path.basename(rawTarget)
    : rawTarget;
  const normalized = path
    .normalize(relativeTarget)
    .replace(/^(\.\.(\/|\\|$))+/, '');
  const safeTarget =
    normalized && normalized !== '.' && !normalized.startsWith('..')
      ? normalized
      : `${task.id}.md`;
  const resolved = path.resolve(root, safeTarget);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return path.join(root, `${task.id}.md`);
  }
  return resolved;
}

interface DeliveryOutcome {
  mode: BriefingHistoryEntry['delivery']['mode'];
  status: BriefingOutcome;
  failureContext?: string | null;
  approvalState: BriefingHistoryEntry['approvalState'];
}

const manualRunIds = new Set<string>();

/** Mark a task as manually triggered so the next run records source=manual. */
export function markTaskManualRun(taskId: string): void {
  manualRunIds.add(taskId);
}

async function deliverTaskResult(
  task: ScheduledTask,
  result: string | null,
  dryRun: boolean,
  deps: SchedulerDependencies,
  source: BriefingSource = 'scheduled',
): Promise<DeliveryOutcome | undefined> {
  if (!result) return undefined;

  if (dryRun) {
    return {
      mode: 'dashboard',
      status: 'completed',
      approvalState: 'none',
    };
  }

  const silentMarker = task.silent_marker?.trim();
  if (silentMarker && result.includes(silentMarker)) {
    logger.info(
      { taskId: task.id, marker: silentMarker },
      'Scheduled task result suppressed by silent marker',
    );
    return {
      mode: 'dashboard',
      status: 'skipped',
      failureContext: 'Suppressed by silent marker',
      approvalState: 'none',
    };
  }

  const channelId = task.delivery_target || task.chat_jid;
  const taskDeliveryMode = task.delivery_mode || 'chat';
  const resolved = resolveDeliveryMode(
    task.group_folder,
    channelId,
    taskDeliveryMode,
  );

  if (!resolved.allowed) {
    if (resolved.requiresApproval) {
      const approvalMode =
        resolved.mode === 'dashboard' ||
        resolved.mode === 'file' ||
        resolved.mode === 'webhook'
          ? resolved.mode
          : 'chat';
      const approvalTargetId = briefingApprovalTargetId({
        taskId: task.id,
        mode: approvalMode,
        target: channelId,
        result,
      });
      const approved = hasApprovedTarget(
        'briefing-delivery',
        'scheduled-task-result',
        approvalTargetId,
      );
      if (!approved) {
        const existingApproval = findPendingApprovalForTarget(
          'briefing-delivery',
          'scheduled-task-result',
          approvalTargetId,
        );
        if (!existingApproval) {
          createApproval({
            kind: 'briefing-delivery',
            title: `Deliver briefing for ${task.title || task.id}`,
            summary: `Approve delivery of scheduled task output to ${channelId}.`,
            risk: 'medium',
            requester: 'task-scheduler',
            targetType: 'scheduled-task-result',
            targetId: approvalTargetId,
            source: source === 'manual' ? 'manual-run' : 'scheduled-task',
            correlationId: `scheduled-task:${task.id}`,
            actionPreview: result.slice(0, 1000),
            resourceSummary: channelId,
            payload: {
              taskId: task.id,
              channelId,
              mode: approvalMode,
              result,
            },
          });
        }
        logger.info(
          { taskId: task.id, channelId },
          'Scheduled task delivery blocked pending approval',
        );
        return {
          mode: approvalMode,
          status: 'approval-blocked',
          failureContext: resolved.reason,
          approvalState: 'pending',
        };
      }
      // The approval route delivers this exact stored result. Do not deliver it
      // again if the same result is observed during a retry.
      return {
        mode: approvalMode,
        status: 'completed',
        approvalState: 'approved',
      };
    } else {
      logger.info(
        { taskId: task.id, channelId, reason: resolved.reason },
        'Scheduled task delivery skipped by channel preference',
      );
      return {
        mode: resolved.mode,
        status: 'skipped',
        failureContext: resolved.reason,
        approvalState: 'none',
      };
    }
  }

  const effectiveMode = resolved.mode;

  if (effectiveMode === 'dashboard') {
    return {
      mode: 'dashboard',
      status: 'completed',
      approvalState: resolved.requiresApproval ? 'approved' : 'none',
    };
  }

  if (effectiveMode === 'file') {
    try {
      const outputPath = resolveDeliveryFilePath(task);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, result, 'utf-8');
      logger.info(
        { taskId: task.id, outputPath },
        'Scheduled task result written to file',
      );
      return {
        mode: 'file',
        status: 'completed',
        approvalState: resolved.requiresApproval ? 'approved' : 'none',
      };
    } catch (err) {
      const failureContext = err instanceof Error ? err.message : String(err);
      logger.error(
        { taskId: task.id, error: failureContext },
        'Scheduled task file delivery failed',
      );
      return {
        mode: 'file',
        status: 'failed',
        failureContext,
        approvalState: 'none',
      };
    }
  }

  if (effectiveMode === 'webhook') {
    const url = task.delivery_target?.trim();
    if (!url) {
      const failureContext =
        'Scheduled task webhook delivery skipped because no URL is configured';
      logger.warn({ taskId: task.id }, failureContext);
      return {
        mode: 'webhook',
        status: 'skipped',
        failureContext,
        approvalState: 'none',
      };
    }

    const approvalTargetId = webhookApprovalTargetId(task.id, url);
    const approved = hasApprovedTarget(
      'webhook-delivery',
      'scheduled-task',
      approvalTargetId,
    );
    if (!approved) {
      const existingApproval = findPendingApprovalForTarget(
        'webhook-delivery',
        'scheduled-task',
        approvalTargetId,
      );
      if (!existingApproval) {
        createApproval({
          kind: 'webhook-delivery',
          title: `Send webhook for ${task.title || task.id}`,
          summary: `Approve delivery of scheduled task output to ${url}.`,
          risk: 'medium',
          requester: 'task-scheduler',
          targetType: 'scheduled-task',
          targetId: approvalTargetId,
          source: source === 'manual' ? 'manual-run' : 'scheduled-task',
          correlationId: `scheduled-task:${task.id}`,
          actionPreview: result.slice(0, 1000),
          resourceSummary: url,
          payload: {
            taskId: task.id,
            url,
            result,
          },
        });
      }
      logger.info(
        { taskId: task.id, target: url, approvalId: existingApproval?.id },
        'Scheduled task webhook delivery is awaiting approval',
      );
      return {
        mode: 'webhook',
        status: 'approval-blocked',
        failureContext: 'Awaiting webhook delivery approval',
        approvalState: 'pending',
      };
    }

    try {
      await sendScheduledTaskWebhook({ url, taskId: task.id, result });
      logger.info(
        { taskId: task.id, target: url },
        'Scheduled task webhook delivered via pre-approved target',
      );
      return {
        mode: 'webhook',
        status: 'completed',
        approvalState: 'approved',
      };
    } catch (err) {
      const failureContext = err instanceof Error ? err.message : String(err);
      logger.error(
        { taskId: task.id, target: url, error: failureContext },
        'Scheduled task webhook delivery failed',
      );
      return {
        mode: 'webhook',
        status: 'failed',
        failureContext,
        approvalState: 'approved',
      };
    }
  }

  // chat delivery
  try {
    await deps.sendMessage(channelId, result);
    return {
      mode: 'chat',
      status: 'completed',
      approvalState: resolved.requiresApproval ? 'approved' : 'none',
    };
  } catch (err) {
    const failureContext = err instanceof Error ? err.message : String(err);
    logger.error(
      { taskId: task.id, channelId, error: failureContext },
      'Scheduled task chat delivery failed',
    );
    return {
      mode: 'chat',
      status: 'failed',
      failureContext,
      approvalState: 'none',
    };
  }
}

function skipTaskRun(
  task: ScheduledTask,
  startTime: number,
  resultSummary: string,
  source: BriefingSource = 'scheduled',
): void {
  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
    status: 'success',
    result: resultSummary,
    error: null,
  });
  updateTaskAfterRun(task.id, computeNextRun(task), resultSummary);

  try {
    recordBriefingRun({
      taskId: task.id,
      source,
      routine: task.title || task.routine_type || task.id,
      mission: task.group_folder,
      groupFolder: task.group_folder,
      channel: task.delivery_target || task.chat_jid,
      status: 'skipped',
      deliveryMode: task.delivery_mode || 'dashboard',
      deliveryTarget: task.delivery_target || task.chat_jid,
      failureContext: resultSummary,
      latencyMs: Date.now() - startTime,
      retryCount: 0,
      approvalState: 'none',
      resultPreview: null,
    });
  } catch (historyErr) {
    logger.warn(
      { taskId: task.id, err: historyErr },
      'Failed to record skip in briefing history',
    );
  }
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): Promise<void> {
  const startTime = Date.now();
  const source: BriefingSource = manualRunIds.has(task.id)
    ? 'manual'
    : 'scheduled';
  manualRunIds.delete(task.id);

  function recordTaskHistory(
    status: BriefingOutcome,
    failureContext: string | null,
    deliveryMode: BriefingHistoryEntry['delivery']['mode'] = task.delivery_mode ||
      'dashboard',
    approvalState: BriefingHistoryEntry['approvalState'] = 'none',
    resultPreview: string | null = null,
  ): void {
    try {
      recordBriefingRun({
        taskId: task.id,
        source,
        routine: task.title || task.routine_type || task.id,
        mission: task.group_folder,
        groupFolder: task.group_folder,
        channel: task.delivery_target || task.chat_jid,
        status,
        deliveryMode,
        deliveryTarget: task.delivery_target || task.chat_jid,
        failureContext,
        latencyMs: Date.now() - startTime,
        retryCount: source === 'manual' ? getNextRetryCountForTask(task.id) : 0,
        approvalState,
        resultPreview,
      });
    } catch (historyErr) {
      logger.warn(
        { taskId: task.id, err: historyErr },
        'Failed to record briefing history',
      );
    }
  }

  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(task.group_folder);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Stop retry churn for malformed legacy rows.
    updateTask(task.id, { status: 'paused' });
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder, error },
      'Task has invalid group folder',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error,
    });
    recordTaskHistory('failed', error);
    return;
  }
  fs.mkdirSync(groupDir, { recursive: true });

  logger.info(
    { taskId: task.id, group: task.group_folder },
    'Running scheduled task',
  );

  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(
    (g) => g.folder === task.group_folder,
  );

  if (!group) {
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder },
      'Group not found for task',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error: `Group not found: ${task.group_folder}`,
    });
    recordTaskHistory('failed', `Group not found: ${task.group_folder}`);
    return;
  }

  const activeRunCount = task.active_run_count || 0;
  const maxActiveRuns = task.max_active_runs || 0;
  if (maxActiveRuns > 0 && activeRunCount >= maxActiveRuns) {
    skipTaskRun(task, startTime, 'Skipped: active run limit', source);
    logger.info(
      { taskId: task.id, activeRunCount, maxActiveRuns },
      'Scheduled task skipped because active-run limit is reached',
    );
    return;
  }

  const heartbeatReason = heartbeatSkipReason(task);
  if (heartbeatReason) {
    skipTaskRun(task, startTime, heartbeatReason, source);
    logger.info(
      { taskId: task.id, reason: heartbeatReason },
      'Scheduled heartbeat skipped by local policy',
    );
    return;
  }

  updateTask(task.id, {
    active_run_count: activeRunCount + 1,
    last_started_at: new Date().toISOString(),
  });

  // Update tasks snapshot for container to read (filtered by group)
  const isMain = group.isMain === true;
  const tasks = getAllTasks();
  writeTasksSnapshot(
    task.group_folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      script: t.script,
      title: t.title,
      routine_type: t.routine_type,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      delivery_mode: t.delivery_mode,
      status: t.status,
      active_run_count: t.active_run_count,
      last_started_at: t.last_started_at,
      next_run: t.next_run,
    })),
  );

  let result: string | null = null;
  let error: string | null = null;

  const sessions = deps.getSessions();
  const sessionStorageKey = getTaskSessionStorageKey(task);
  const sessionId = sessionStorageKey ? sessions[sessionStorageKey] : undefined;
  const prompt = buildPromptWithChainedContext(task);
  const defaultProvider = getAgentProviderConfig().provider;
  const taskProfile =
    task.provider_profile_id &&
    PROVIDER_PURPOSES.includes(task.provider_profile_id as ProviderPurpose)
      ? getProviderProfile(task.provider_profile_id as ProviderPurpose)
      : undefined;
  const taskProvider =
    task.provider && isAgentProvider(task.provider) ? task.provider : undefined;
  const effectiveProvider =
    taskProvider ||
    taskProfile?.provider ||
    group.containerConfig?.provider ||
    defaultProvider;
  const effectiveModel =
    task.model ||
    taskProfile?.model ||
    group.containerConfig?.model ||
    group.containerConfig?.models?.[effectiveProvider];
  const fallbackPurpose = (taskProfile?.id ||
    'default_automation') as ProviderPurpose;
  const dryRun = task.tool_policy === 'dry-run';
  const runnerGroup =
    task.max_runtime_ms && task.max_runtime_ms > 0
      ? {
          ...group,
          containerConfig: {
            ...(group.containerConfig || {}),
            timeout: task.max_runtime_ms,
          },
        }
      : group;

  // After the task produces a result, close the container promptly.
  // Tasks are single-turn — no need to wait IDLE_TIMEOUT (30 min) for the
  // query loop to time out. A short delay handles any final MCP calls.
  const TASK_CLOSE_DELAY_MS = 10000;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let deliveryOutcome: DeliveryOutcome | undefined;
  let deliveredResult = false;

  const doDeliver = async (resultText: string): Promise<void> => {
    if (deliveredResult || !resultText) return;
    const outcome = await deliverTaskResult(
      task,
      resultText,
      dryRun,
      deps,
      source,
    );
    if (outcome) {
      deliveredResult = true;
      deliveryOutcome = outcome;
      if (outcome.status === 'failed') {
        throw new Error(
          outcome.failureContext || 'Scheduled task delivery failed',
        );
      }
    }
  };

  const scheduleClose = () => {
    if (closeTimer) return; // already scheduled
    closeTimer = setTimeout(() => {
      logger.debug({ taskId: task.id }, 'Closing task container after result');
      deps.queue.closeStdin(task.chat_jid);
    }, TASK_CLOSE_DELAY_MS);
  };

  try {
    const output = await runContainerAgent(
      runnerGroup,
      {
        prompt,
        sessionId,
        groupFolder: task.group_folder,
        chatJid: task.chat_jid,
        isMain,
        isScheduledTask: true,
        assistantName: ASSISTANT_NAME,
        script: task.script || undefined,
        allowedMcpServers: runnerGroup.containerConfig?.allowedMcpServers,
        restrictions: runnerGroup.containerConfig?.restrictions,
        provider: effectiveProvider,
        model: effectiveModel,
        providerFallbackPurpose: fallbackPurpose,
        providerFallbackAction: 'automation-execution',
        dryRun,
      },
      (proc, containerName) =>
        deps.onProcess(task.chat_jid, proc, containerName, task.group_folder),
      async (streamedOutput: ContainerOutput) => {
        if (streamedOutput.newSessionId && sessionStorageKey) {
          deps.saveSession?.(sessionStorageKey, streamedOutput.newSessionId);
        }
        if (streamedOutput.result) {
          result = streamedOutput.result;
          await doDeliver(streamedOutput.result);
          scheduleClose();
        }
        if (streamedOutput.status === 'success') {
          deps.queue.notifyIdle(task.chat_jid);
          scheduleClose(); // Close promptly even when result is null (e.g. IPC-only tasks)
        }
        if (streamedOutput.status === 'error') {
          error = streamedOutput.error || 'Unknown error';
        }
      },
    );

    if (closeTimer) clearTimeout(closeTimer);

    if (output.newSessionId && sessionStorageKey) {
      deps.saveSession?.(sessionStorageKey, output.newSessionId);
    }

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else if (output.result) {
      result = output.result;
      if (!deliveredResult) {
        await doDeliver(output.result);
      }
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    if (closeTimer) clearTimeout(closeTimer);
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  }

  const durationMs = Date.now() - startTime;

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });

  const nextRun = computeNextRun(task);
  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);
  updateTask(task.id, { active_run_count: activeRunCount });

  const historyStatus: BriefingOutcome = error
    ? 'failed'
    : (deliveryOutcome?.status ?? 'completed');
  const historyApproval: BriefingHistoryEntry['approvalState'] =
    deliveryOutcome?.approvalState ?? 'none';
  const historyFailure = error ?? deliveryOutcome?.failureContext ?? null;
  const historyMode =
    deliveryOutcome?.mode ?? (task.delivery_mode || 'dashboard');

  recordTaskHistory(
    historyStatus,
    historyFailure,
    historyMode,
    historyApproval,
    result?.slice(0, 500) ?? null,
  );
}

let schedulerRunning = false;

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;
  logger.info('Scheduler loop started');

  const loop = async () => {
    try {
      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        // Re-check task status in case it was paused/cancelled
        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') {
          continue;
        }

        deps.queue.enqueueTask(currentTask.chat_jid, currentTask.id, () =>
          runTask(currentTask, deps),
        );
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}

/** @internal - for tests only. */
export function _resetSchedulerLoopForTests(): void {
  schedulerRunning = false;
}
