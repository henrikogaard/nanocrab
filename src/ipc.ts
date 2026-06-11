import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import {
  getCodingJob,
  approveCodingJob,
  cancelCodingJob,
  openCodingJobPr,
  refreshCodingJobCi,
  retryCodingJob,
  revertCodingJob,
  listGitHubIssues,
  loadCodingJobs,
  loadCodingRepos,
  pickGitHubIssue,
  registerCodingRepo,
  startCodingJob,
} from './coding-jobs.js';
import { isAgentProvider } from './agent-provider.js';
import { DATA_DIR, IPC_POLL_INTERVAL, TIMEZONE } from './config.js';
import { AvailableGroup } from './container-runner.js';
import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import { findJournalEvents, recordJournalEvent } from './journal-store.js';
import {
  approveMemory,
  listMemoryRecords,
  proposeMemory,
  rejectMemory,
} from './memory-store.js';
import {
  approveSkillDraft,
  listSkillDrafts,
  proposeSkillDraft,
  rejectSkillDraft,
} from './skill-factory.js';
import { createReportJob, listReportJobs } from './report-jobs.js';
import { createResearchJob, listResearchJobs } from './research-jobs.js';
import { listSkillRegistry, scoreSkillsForRequest } from './skill-registry.js';
import { ProviderPurpose, PROVIDER_PURPOSES } from './provider-router.js';
import { RegisteredGroup } from './types.js';

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  sendFile?: (
    jid: string,
    filePath: string,
    filename: string,
    caption?: string,
  ) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroups: (force: boolean) => Promise<void>;
  getAvailableGroups: (sourceGroup?: RegisteredGroup) => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
  onTasksChanged: () => void;
}

let ipcWatcherRunning = false;

function writeIpcResponse(
  sourceGroup: string,
  requestId: string | undefined,
  payload: unknown,
): void {
  if (!requestId) return;
  const responsesDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'responses');
  fs.mkdirSync(responsesDir, { recursive: true });
  const responsePath = path.join(responsesDir, `${requestId}.json`);
  const tempPath = `${responsePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tempPath, responsePath);
}

function writeIpcOk(
  sourceGroup: string,
  requestId: string | undefined,
  data: unknown,
): void {
  writeIpcResponse(sourceGroup, requestId, { ok: true, data });
}

function writeIpcError(
  sourceGroup: string,
  requestId: string | undefined,
  error: unknown,
): void {
  writeIpcResponse(sourceGroup, requestId, {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    // Scan all group IPC directories (identity determined by directory)
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    const registeredGroups = deps.registeredGroups();

    // Build folder→isMain lookup from registered groups
    const folderIsMain = new Map<string, boolean>();
    for (const group of Object.values(registeredGroups)) {
      if (group.isMain) folderIsMain.set(group.folder, true);
    }

    for (const sourceGroup of groupFolders) {
      const isMain = folderIsMain.get(sourceGroup) === true;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages from this group's IPC directory
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (
                data.type === 'file' &&
                data.chatJid &&
                data.filePath &&
                deps.sendFile
              ) {
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  // Translate container paths to host paths
                  let hostFilePath = data.filePath as string;
                  if (hostFilePath.startsWith('/workspace/group/')) {
                    hostFilePath = path.join(
                      process.cwd(),
                      'groups',
                      sourceGroup,
                      hostFilePath.slice('/workspace/group/'.length),
                    );
                  } else if (hostFilePath.startsWith('/workspace/project/')) {
                    hostFilePath = path.join(
                      process.cwd(),
                      hostFilePath.slice('/workspace/project/'.length),
                    );
                  }
                  await deps.sendFile(
                    data.chatJid,
                    hostFilePath,
                    data.filename || path.basename(data.filePath),
                    data.caption,
                  );
                  logger.info(
                    {
                      chatJid: data.chatJid,
                      filePath: data.filePath,
                      sourceGroup,
                    },
                    'IPC file sent',
                  );
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC file attempt blocked',
                  );
                }
              } else if (data.type === 'message' && data.chatJid && data.text) {
                // Authorization: verify this group can send to this chatJid
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  await deps.sendMessage(data.chatJid, data.text);
                  logger.info(
                    { chatJid: data.chatJid, sourceGroup },
                    'IPC message sent',
                  );
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              // Pass source group identity to processTaskIpc for authorization
              await processTaskIpc(data, sourceGroup, isMain, deps);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC task',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
}

export async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    script?: string;
    provider_profile_id?: string;
    providerProfileId?: string;
    tool_policy?: string;
    toolPolicy?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    requiresTrigger?: boolean;
    containerConfig?: RegisteredGroup['containerConfig'];
    requestId?: string;
    repo?: string;
    labels?: string[];
    defaultProvider?: string;
    defaultModel?: string;
    codingRules?: string;
    trustedForPr?: boolean;
    assignee?: string;
    milestone?: string;
    limit?: number;
    issueNumber?: number;
    provider?: string;
    model?: string;
    createPr?: boolean;
    branchName?: string;
    jobId?: string;
    action?: string;
    memoryId?: string;
    scope?: string;
    memoryType?: string;
    content?: string;
    source?: string;
    confidence?: number;
    visibility?: string;
    status?: string;
    expiresAt?: string | null;
    title?: string;
    timestamp?: string;
    entities?: string[];
    locationContext?: string;
    sourceIds?: string[];
    tags?: string[];
    query?: string;
    skillMd?: string;
    draftId?: string;
    request?: string;
    outputFormats?: string[];
    sourceScopes?: string[];
    urls?: string[];
  },
  sourceGroup: string, // Verified identity from IPC directory
  isMain: boolean, // Verified from directory path
  deps: IpcDeps,
): Promise<void> {
  const registeredGroups = deps.registeredGroups();

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.targetJid
      ) {
        // Resolve the target group from JID
        const targetJid = data.targetJid as string;
        const targetGroupEntry = registeredGroups[targetJid];

        if (!targetGroupEntry) {
          logger.warn(
            { targetJid },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const targetFolder = targetGroupEntry.folder;

        // Authorization: non-main groups can only schedule for themselves
        if (!isMain && targetFolder !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetFolder },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const date = new Date(data.schedule_value);
          if (isNaN(date.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = date.toISOString();
        }

        const taskId =
          data.taskId ||
          `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
        const providerProfileId =
          typeof data.provider_profile_id === 'string' &&
          PROVIDER_PURPOSES.includes(
            data.provider_profile_id as ProviderPurpose,
          )
            ? data.provider_profile_id
            : typeof data.providerProfileId === 'string' &&
                PROVIDER_PURPOSES.includes(
                  data.providerProfileId as ProviderPurpose,
                )
              ? data.providerProfileId
              : null;
        const provider =
          typeof data.provider === 'string' && isAgentProvider(data.provider)
            ? data.provider
            : null;
        const model =
          typeof data.model === 'string' && data.model.trim()
            ? data.model.trim()
            : null;
        const toolPolicy =
          typeof data.tool_policy === 'string' && data.tool_policy.trim()
            ? data.tool_policy.trim()
            : typeof data.toolPolicy === 'string' && data.toolPolicy.trim()
              ? data.toolPolicy.trim()
              : null;
        createTask({
          id: taskId,
          group_folder: targetFolder,
          chat_jid: targetJid,
          prompt: data.prompt,
          script: data.script || null,
          provider_profile_id: providerProfileId,
          provider,
          model,
          tool_policy: toolPolicy,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          { taskId, sourceGroup, targetFolder, contextMode },
          'Task created via IPC',
        );
        deps.onTasksChanged();
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
          deps.onTasksChanged();
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
          deps.onTasksChanged();
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
          deps.onTasksChanged();
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'update_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (!task) {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Task not found for update',
          );
          break;
        }
        if (!isMain && task.group_folder !== sourceGroup) {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task update attempt',
          );
          break;
        }

        const updates: Parameters<typeof updateTask>[1] = {};
        if (data.prompt !== undefined) updates.prompt = data.prompt;
        if (data.script !== undefined) updates.script = data.script || null;
        if (data.schedule_type !== undefined)
          updates.schedule_type = data.schedule_type as
            | 'cron'
            | 'interval'
            | 'once';
        if (data.schedule_value !== undefined)
          updates.schedule_value = data.schedule_value;

        // Recompute next_run if schedule changed
        if (data.schedule_type || data.schedule_value) {
          const updatedTask = {
            ...task,
            ...updates,
          };
          if (updatedTask.schedule_type === 'cron') {
            try {
              const interval = CronExpressionParser.parse(
                updatedTask.schedule_value,
                { tz: TIMEZONE },
              );
              updates.next_run = interval.next().toISOString();
            } catch {
              logger.warn(
                { taskId: data.taskId, value: updatedTask.schedule_value },
                'Invalid cron in task update',
              );
              break;
            }
          } else if (updatedTask.schedule_type === 'interval') {
            const ms = parseInt(updatedTask.schedule_value, 10);
            if (!isNaN(ms) && ms > 0) {
              updates.next_run = new Date(Date.now() + ms).toISOString();
            }
          }
        }

        updateTask(data.taskId, updates);
        logger.info(
          { taskId: data.taskId, sourceGroup, updates },
          'Task updated via IPC',
        );
        deps.onTasksChanged();
      }
      break;

    case 'register_coding_repo':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can register coding repositories',
        );
        logger.warn(
          { sourceGroup, repo: data.repo },
          'Unauthorized register_coding_repo attempt blocked',
        );
        break;
      }
      try {
        if (!data.repo) throw new Error('repo is required');
        const repo = await registerCodingRepo({
          repo: data.repo,
          labels: Array.isArray(data.labels) ? data.labels : undefined,
          assignee:
            typeof data.assignee === 'string' ? data.assignee : undefined,
          milestone:
            typeof data.milestone === 'string' ? data.milestone : undefined,
          defaultProvider: data.defaultProvider,
          defaultModel: data.defaultModel,
          codingRules:
            typeof data.codingRules === 'string' ? data.codingRules : undefined,
          trustedForPr: data.trustedForPr === true,
        });
        writeIpcOk(sourceGroup, data.requestId, repo);
        logger.info(
          { sourceGroup, repo: repo.fullName },
          'Coding repo registered via IPC',
        );
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'list_coding_repos':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can list coding repositories',
        );
        break;
      }
      writeIpcOk(sourceGroup, data.requestId, loadCodingRepos());
      break;

    case 'list_github_issues':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can list GitHub issues for coding jobs',
        );
        break;
      }
      try {
        if (!data.repo) throw new Error('repo is required');
        const issues = await listGitHubIssues({
          repo: data.repo,
          labels: Array.isArray(data.labels) ? data.labels : undefined,
          assignee: data.assignee,
          limit: data.limit,
        });
        writeIpcOk(sourceGroup, data.requestId, issues);
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'start_coding_job':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can start coding jobs',
        );
        logger.warn(
          { sourceGroup, repo: data.repo },
          'Unauthorized start_coding_job attempt blocked',
        );
        break;
      }
      try {
        if (!data.repo) throw new Error('repo is required');
        const job = await startCodingJob({
          repo: data.repo,
          prompt: data.prompt,
          issueNumber: data.issueNumber,
          provider: data.provider,
          model: data.model,
          createPr: data.createPr,
          branchName: data.branchName,
          requestedBy: sourceGroup,
        });
        writeIpcOk(sourceGroup, data.requestId, job);
        logger.info(
          { sourceGroup, repo: data.repo, jobId: job.id },
          'Coding job started via IPC',
        );
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'pick_github_issue':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can pick GitHub issues for coding jobs',
        );
        break;
      }
      try {
        if (!data.repo) throw new Error('repo is required');
        const picked = await pickGitHubIssue({
          repo: data.repo,
          labels: Array.isArray(data.labels) ? data.labels : undefined,
          provider: data.provider,
          model: data.model,
          createPr: data.createPr,
          requestedBy: sourceGroup,
        });
        writeIpcOk(sourceGroup, data.requestId, picked);
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'list_coding_jobs':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can list coding jobs',
        );
        break;
      }
      writeIpcOk(
        sourceGroup,
        data.requestId,
        loadCodingJobs()
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )
          .slice(0, Math.min(Math.max(data.limit || 20, 1), 50))
          .map((job) => ({
            ...job,
            output:
              job.output.length > 1200
                ? `${job.output.slice(-1200)}`
                : job.output,
          })),
      );
      break;

    case 'get_coding_job':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can inspect coding jobs',
        );
        break;
      }
      if (!data.jobId) {
        writeIpcError(sourceGroup, data.requestId, 'jobId is required');
        break;
      }
      writeIpcOk(sourceGroup, data.requestId, getCodingJob(data.jobId) || null);
      break;

    case 'control_coding_job':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can control coding jobs',
        );
        break;
      }
      try {
        if (!data.jobId) throw new Error('jobId is required');
        const actor = sourceGroup;
        let job;
        if (data.action === 'approve')
          job = approveCodingJob(data.jobId, actor);
        else if (data.action === 'cancel')
          job = cancelCodingJob(data.jobId, actor);
        else if (data.action === 'retry')
          job = await retryCodingJob(data.jobId, actor);
        else if (data.action === 'open-pr')
          job = await openCodingJobPr(data.jobId, actor);
        else if (data.action === 'refresh-ci')
          job = await refreshCodingJobCi(data.jobId);
        else if (data.action === 'revert')
          job = await revertCodingJob(data.jobId, actor);
        else
          throw new Error(
            'action must be approve, cancel, retry, open-pr, refresh-ci, or revert',
          );
        writeIpcOk(sourceGroup, data.requestId, job);
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'request_report':
      try {
        if (!data.request) throw new Error('request is required');
        const job = createReportJob({
          title: data.title,
          request: data.request,
          requester: sourceGroup,
          outputFormats: data.outputFormats,
          sourceScopes: data.sourceScopes,
        });
        writeIpcOk(sourceGroup, data.requestId, job);
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'list_report_jobs':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can list report jobs',
        );
        break;
      }
      writeIpcOk(sourceGroup, data.requestId, listReportJobs());
      break;

    case 'request_research':
      try {
        if (!data.query) throw new Error('query is required');
        const job = createResearchJob({
          query: data.query,
          urls: data.urls,
          requester: sourceGroup,
        });
        writeIpcOk(sourceGroup, data.requestId, job);
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'list_research_jobs':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can list research jobs',
        );
        break;
      }
      writeIpcOk(sourceGroup, data.requestId, listResearchJobs());
      break;

    case 'propose_memory':
      try {
        if (!data.content) throw new Error('content is required');
        const memory = proposeMemory({
          scope: data.scope || 'group',
          type: data.memoryType || 'fact',
          content: data.content,
          source: data.source,
          confidence: data.confidence,
          visibility: data.visibility,
          createdBy: sourceGroup,
          expiresAt: data.expiresAt,
        });
        writeIpcOk(sourceGroup, data.requestId, memory);
        logger.info(
          { sourceGroup, memoryId: memory.id },
          'Memory proposed via IPC',
        );
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'list_memories':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can list memory records',
        );
        break;
      }
      writeIpcOk(
        sourceGroup,
        data.requestId,
        listMemoryRecords({
          status:
            data.status === 'approved' ||
            data.status === 'rejected' ||
            data.status === 'pending'
              ? data.status
              : undefined,
          scope: data.scope,
          visibility: data.visibility,
          limit: data.limit,
        }),
      );
      break;

    case 'approve_memory':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can approve memories',
        );
        break;
      }
      try {
        if (!data.memoryId) throw new Error('memoryId is required');
        writeIpcOk(sourceGroup, data.requestId, approveMemory(data.memoryId));
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'reject_memory':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can reject memories',
        );
        break;
      }
      try {
        if (!data.memoryId) throw new Error('memoryId is required');
        writeIpcOk(sourceGroup, data.requestId, rejectMemory(data.memoryId));
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'record_journal_event':
      try {
        if (!data.title) throw new Error('title is required');
        const event = recordJournalEvent({
          title: data.title,
          timestamp: data.timestamp,
          entities: Array.isArray(data.entities) ? data.entities : undefined,
          locationContext: data.locationContext,
          confidence: data.confidence,
          sourceIds: Array.isArray(data.sourceIds) ? data.sourceIds : undefined,
          tags: Array.isArray(data.tags) ? data.tags : undefined,
          groupFolder: sourceGroup,
        });
        writeIpcOk(sourceGroup, data.requestId, event);
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'search_journal_events':
      try {
        if (!data.query) throw new Error('query is required');
        writeIpcOk(
          sourceGroup,
          data.requestId,
          findJournalEvents({
            query: data.query,
            groupFolder: isMain ? undefined : sourceGroup,
            limit: data.limit,
          }),
        );
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'propose_skill_draft':
      try {
        if (!data.skillMd) throw new Error('skillMd is required');
        const draft = proposeSkillDraft({
          skillMd: data.skillMd,
          createdBy: sourceGroup,
        });
        writeIpcOk(sourceGroup, data.requestId, draft);
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'list_skills':
      writeIpcOk(
        sourceGroup,
        data.requestId,
        listSkillRegistry().filter((skill) => {
          if (!skill.enabled) return false;
          if (!isMain && skill.visibility === 'private') return false;
          if (!isMain && skill.scope === 'main') return false;
          if (isMain && skill.scope === 'channels') return false;
          return true;
        }),
      );
      break;

    case 'search_skills':
      try {
        if (!data.query) throw new Error('query is required');
        writeIpcOk(
          sourceGroup,
          data.requestId,
          scoreSkillsForRequest(String(data.query), {
            isMain,
            limit: typeof data.limit === 'number' ? data.limit : undefined,
          }),
        );
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'list_skill_drafts':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can list skill drafts',
        );
        break;
      }
      writeIpcOk(
        sourceGroup,
        data.requestId,
        listSkillDrafts(
          data.status === 'approved' ||
            data.status === 'rejected' ||
            data.status === 'pending'
            ? data.status
            : undefined,
        ),
      );
      break;

    case 'approve_skill_draft':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can approve skill drafts',
        );
        break;
      }
      try {
        if (!data.draftId) throw new Error('draftId is required');
        writeIpcOk(
          sourceGroup,
          data.requestId,
          approveSkillDraft(data.draftId),
        );
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'reject_skill_draft':
      if (!isMain) {
        writeIpcError(
          sourceGroup,
          data.requestId,
          'Only the main group can reject skill drafts',
        );
        break;
      }
      try {
        if (!data.draftId) throw new Error('draftId is required');
        writeIpcOk(sourceGroup, data.requestId, rejectSkillDraft(data.draftId));
      } catch (err) {
        writeIpcError(sourceGroup, data.requestId, err);
      }
      break;

    case 'refresh_groups':
      // Only main group can request a refresh
      if (isMain) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await deps.syncGroups(true);
        // Write updated snapshot immediately
        const sourceRegisteredGroup = registeredGroups[sourceGroup];
        const availableGroups = deps.getAvailableGroups(sourceRegisteredGroup);
        deps.writeGroupsSnapshot(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      } else {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
      }
      break;

    case 'register_group':
      // Only main group can register new groups
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        if (!isValidGroupFolder(data.folder)) {
          logger.warn(
            { sourceGroup, folder: data.folder },
            'Invalid register_group request - unsafe folder name',
          );
          break;
        }
        const sourceRegisteredGroup = registeredGroups[sourceGroup];
        const channelScope =
          sourceRegisteredGroup?.containerConfig?.channelScope || 'all';
        const allowedFolders = new Set(
          sourceRegisteredGroup?.containerConfig?.allowedGroupFolders || [],
        );
        if (
          channelScope === 'registered' &&
          !registeredGroups[data.jid as string]
        ) {
          logger.warn(
            { sourceGroup, jid: data.jid },
            'register_group blocked by registered-only channel scope',
          );
          break;
        }
        if (channelScope === 'allowed' && !allowedFolders.has(data.folder)) {
          logger.warn(
            { sourceGroup, folder: data.folder },
            'register_group blocked by allowed channel scope',
          );
          break;
        }
        // Defense in depth: agent cannot set isMain via IPC.
        // Preserve isMain from the existing registration so IPC config
        // updates (e.g. adding additionalMounts) don't strip the flag.
        const existingGroup = registeredGroups[data.jid];
        deps.registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
          requiresTrigger: data.requiresTrigger,
          isMain: existingGroup?.isMain,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}
