import { getAgentProfileByHandle } from '../agent-profiles.js';
import {
  cancelCodingJob,
  loadCodingJobs,
  type CodingJob as _CodingJob,
} from '../coding-jobs.js';
import { getTriggerPattern } from '../config.js';
import {
  resolveDecision,
  DecisionResolutionError,
  DecisionStaleError,
} from './decisions.js';
import {
  DefaultGitHubProjectClient,
  type GitHubProjectClient,
} from './github-projects.js';
import {
  getPipeline,
  listDecisionsForIssue,
  listProjectItemSnapshots,
} from './store.js';
import type {
  PipelineStageKind,
  ProjectItemSnapshot,
  PipelineWithStages,
} from './types.js';
import type { ControlPlaneDecision } from './types.js';

export type ControlPlaneCommand =
  | { action: 'status'; repository?: string; issueNumber: number }
  | { action: 'show_plan'; repository?: string; issueNumber: number }
  | { action: 'show_decision'; repository?: string; issueNumber: number }
  | { action: 'follow'; repository?: string; issueNumber: number }
  | {
      action: 'approve';
      repository?: string;
      issueNumber: number;
      targetStage?: string;
    }
  | {
      action: 'reject' | 'revise';
      repository?: string;
      issueNumber: number;
      note: string;
    }
  | {
      action: 'reassign';
      repository?: string;
      issueNumber: number;
      stage: PipelineStageKind;
      agentHandle: string;
    }
  | {
      action: 'pause' | 'cancel';
      repository?: string;
      issueNumber: number;
      note?: string;
    };

export interface ControlPlaneCommandResult {
  text: string;
  decisionId: string | null;
  actions: Array<{
    id: 'approve' | 'reject' | 'revise' | 'reassign';
    label: string;
    enabled: boolean;
  }>;
}

export interface ControlPlaneCommandContext {
  channel: string;
  chatJid: string;
  senderId: string;
  senderName: string;
  messageId?: string;
  isAuthorized: boolean;
  actor: string;
  githubProjectClient?: GitHubProjectClient;
}

export interface ParseControlPlaneCommandOptions {
  trigger?: string;
}

const ACTION_PATTERN =
  /^(status|show plan|show decision|approve|reject|revise|reassign|pause|cancel|follow)(?:\s+(.+))?$/i;

function parseIssueRef(text: string): {
  repository: string | undefined;
  issueNumber: number;
  rest: string;
} | null {
  const match = text.match(
    /^\s*(?:([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)\s*)?#(\d+)(.*)$/,
  );
  if (!match) return null;
  const repository = match[1]?.trim();
  const issueNumber = parseInt(match[2], 10);
  const rest = match[3] ?? '';
  return { repository, issueNumber, rest };
}

function stripTrigger(text: string, trigger?: string): string {
  if (!trigger) return text;
  const pattern = getTriggerPattern(trigger);
  return text.replace(pattern, '').trim();
}

function trimLeadingMentions(text: string): string {
  return text.replace(/^\s*(?:@[A-Za-z0-9_.-]+\s+)+/, '').trim();
}

export function parseControlPlaneCommand(
  rawText: string,
  options: ParseControlPlaneCommandOptions = {},
): ControlPlaneCommand | null {
  let text = stripTrigger(rawText.trim(), options.trigger);
  text = trimLeadingMentions(text);
  if (!text) return null;

  const actionMatch = text.match(ACTION_PATTERN);
  if (!actionMatch) return null;

  const action = actionMatch[1].toLowerCase();
  const rest = actionMatch[2] || '';
  const issueRef = parseIssueRef(rest);
  if (!issueRef) return null;

  const { repository, issueNumber } = issueRef;
  const remainder = issueRef.rest.trim();

  switch (action) {
    case 'status':
      return { action: 'status', repository, issueNumber };
    case 'show plan':
      return { action: 'show_plan', repository, issueNumber };
    case 'show decision':
      return { action: 'show_decision', repository, issueNumber };
    case 'follow':
      return { action: 'follow', repository, issueNumber };
    case 'approve': {
      let targetStage: string | undefined;
      const toMatch = remainder.match(/^\s*to\s+(\w+)\s*$/i);
      if (toMatch) targetStage = toMatch[1].toLowerCase();
      return { action: 'approve', repository, issueNumber, targetStage };
    }
    case 'reject':
    case 'revise': {
      const note = remainder.replace(/^\s*:\s*/, '').trim();
      return { action, repository, issueNumber, note };
    }
    case 'reassign': {
      const reassignMatch = remainder.match(
        /^\s*(planning|implement|review)\s+(?:to\s+)?@?([A-Za-z0-9_.-]+)\s*$/i,
      );
      if (!reassignMatch) return null;
      return {
        action: 'reassign',
        repository,
        issueNumber,
        stage: reassignMatch[1].toLowerCase() as PipelineStageKind,
        agentHandle: reassignMatch[2].toLowerCase(),
      };
    }
    case 'pause':
    case 'cancel': {
      const note = remainder.replace(/^\s*:\s*/, '').trim();
      return { action, repository, issueNumber, note: note || undefined };
    }
    default:
      return null;
  }
}

type FindIssueSnapshotResult =
  | {
      found: true;
      snapshot: ProjectItemSnapshot;
      pipeline: PipelineWithStages;
      issueNodeId: string;
    }
  | { found: false; text: string };

function matchesRepository(
  commandRepo: string | undefined,
  snapshotRepo: string,
): boolean {
  if (!commandRepo) return true;
  if (commandRepo === snapshotRepo) return true;
  if (!commandRepo.includes('/')) {
    return (
      snapshotRepo === commandRepo || snapshotRepo.endsWith('/' + commandRepo)
    );
  }
  return false;
}

function findIssueSnapshot(
  command: ControlPlaneCommand,
): FindIssueSnapshotResult {
  const snapshots = listProjectItemSnapshots().filter(
    (s) => s.issueNumber === command.issueNumber,
  );
  const matches = snapshots.filter((s) =>
    matchesRepository(command.repository, s.repository),
  );

  if (matches.length === 0) {
    return {
      found: false,
      text: command.repository
        ? `Issue #${command.issueNumber} not found in ${command.repository}.`
        : `Issue #${command.issueNumber} not found.`,
    };
  }

  if (matches.length > 1) {
    return {
      found: false,
      text: `Issue #${command.issueNumber} appears in multiple repositories: ${matches.map((s) => s.repository).join(', ')}. Use <repo>#${command.issueNumber} to specify.`,
    };
  }

  const snapshot = matches[0];
  const pipeline = getPipeline(snapshot.pipelineId);
  if (!pipeline) {
    return {
      found: false,
      text: `Pipeline for issue #${command.issueNumber} was not found.`,
    };
  }

  return { found: true, snapshot, pipeline, issueNodeId: snapshot.issueNodeId };
}

function currentStageKind(
  pipeline: PipelineWithStages,
  snapshot: ProjectItemSnapshot,
): string {
  return (
    pipeline.stages.find(
      (s) => s.githubFieldOptionId === snapshot.githubFieldOptionId,
    )?.stageKind || 'unknown'
  );
}

function nextStageKind(
  pipeline: PipelineWithStages,
  decision: ControlPlaneDecision,
): string {
  if (!decision.proposedStageId) return 'done';
  return (
    pipeline.stages.find((s) => s.id === decision.proposedStageId)?.stageKind ||
    'unknown'
  );
}

function buildActions(
  isAuthorized: boolean,
  decision?: ControlPlaneDecision,
): ControlPlaneCommandResult['actions'] {
  const enabled = isAuthorized && decision?.status === 'pending';
  return [
    { id: 'approve', label: 'Approve', enabled },
    { id: 'reject', label: 'Reject', enabled },
    { id: 'revise', label: 'Revise', enabled },
    { id: 'reassign', label: 'Reassign', enabled },
  ];
}

function findPendingDecisionForTargetStage(
  pipeline: PipelineWithStages,
  decisions: ControlPlaneDecision[],
  targetStage: string,
): ControlPlaneDecision | undefined {
  const stageId = pipeline.stages.find((s) => s.stageKind === targetStage)?.id;
  if (!stageId) return undefined;
  return decisions.find((d) => d.proposedStageId === stageId);
}

function findPendingDecisionForStage(
  pipeline: PipelineWithStages,
  decisions: ControlPlaneDecision[],
  stage: PipelineStageKind,
): ControlPlaneDecision | undefined {
  const stageId = pipeline.stages.find((s) => s.stageKind === stage)?.id;
  if (!stageId) return undefined;
  return decisions.find((d) => d.stageId === stageId);
}

const processedMessageIds = new Set<string>();
const messageResultCache = new Map<string, ControlPlaneCommandResult>();

export function resetControlPlaneCommandCache(): void {
  processedMessageIds.clear();
  messageResultCache.clear();
}

export async function executeControlPlaneCommand(
  command: ControlPlaneCommand,
  context: ControlPlaneCommandContext,
): Promise<ControlPlaneCommandResult> {
  const { messageId } = context;
  if (messageId && processedMessageIds.has(messageId)) {
    return messageResultCache.get(messageId)!;
  }

  const findResult = findIssueSnapshot(command);
  if (!findResult.found) {
    return { text: findResult.text, decisionId: null, actions: [] };
  }

  const { snapshot, pipeline, issueNodeId } = findResult;
  const repo = snapshot.repository;
  const issue = snapshot.issueNumber;
  const stage = currentStageKind(pipeline, snapshot);
  const decisions = listDecisionsForIssue(pipeline.pipeline.id, issueNodeId);
  const latestDecision = decisions[0];
  const pendingDecisions = decisions.filter((d) => d.status === 'pending');
  const latestPendingDecision = pendingDecisions[0];

  const source = `${context.channel}:${context.chatJid}:${context.senderId}`;
  const client =
    context.githubProjectClient || new DefaultGitHubProjectClient();

  const mutationActions = new Set([
    'approve',
    'reject',
    'revise',
    'reassign',
    'pause',
    'cancel',
    'follow',
  ]);
  if (mutationActions.has(command.action) && !context.isAuthorized) {
    return {
      text: `Unauthorized. Only authorized operators may ${command.action} ${repo}#${issue}.`,
      decisionId: null,
      actions: [],
    };
  }

  let result: ControlPlaneCommandResult;

  try {
    switch (command.action) {
      case 'status': {
        const pendingCount = pendingDecisions.length;
        let text = `Issue ${repo}#${issue} is in ${stage} stage. Pending decisions: ${pendingCount}.`;
        if (latestDecision) {
          text += `\nLatest decision: ${latestDecision.id} (${latestDecision.status}). ${latestDecision.summary}`;
          if (
            latestDecision.proposedStageId &&
            latestDecision.status === 'pending'
          ) {
            text += `\nProposed next stage: ${nextStageKind(pipeline, latestDecision)}.`;
          }
        }
        result = {
          text,
          decisionId: latestDecision?.id || null,
          actions: buildActions(context.isAuthorized, latestDecision),
        };
        break;
      }
      case 'show_plan': {
        if (!latestDecision) {
          result = {
            text: `No proposed plan for ${repo}#${issue} (current stage: ${stage}).`,
            decisionId: null,
            actions: [],
          };
        } else {
          result = {
            text: `Plan for ${repo}#${issue} (current stage: ${stage}):\n${latestDecision.summary}`,
            decisionId: latestDecision.id,
            actions: buildActions(context.isAuthorized, latestDecision),
          };
        }
        break;
      }
      case 'show_decision': {
        if (!latestDecision) {
          result = {
            text: `No decision found for ${repo}#${issue} (current stage: ${stage}).`,
            decisionId: null,
            actions: [],
          };
        } else {
          let text = `Decision ${latestDecision.id} for ${repo}#${issue} is ${latestDecision.status}. ${latestDecision.summary}`;
          if (latestDecision.proposedStageId) {
            text += `\nProposed next stage: ${nextStageKind(pipeline, latestDecision)}.`;
          }
          result = {
            text,
            decisionId: latestDecision.id,
            actions: buildActions(context.isAuthorized, latestDecision),
          };
        }
        break;
      }
      case 'follow': {
        if (!latestDecision) {
          result = {
            text: `No decision to follow for ${repo}#${issue}.`,
            decisionId: null,
            actions: [],
          };
          break;
        }
        const decision = await resolveDecision(
          latestDecision.id,
          {
            action: 'follow',
            actor: context.actor,
            source,
          },
          client,
        );
        let text = `Decision ${decision.id} for ${repo}#${issue} is ${decision.status}.`;
        if (decision.summary) {
          text += ` ${decision.summary}`;
        }
        if (decision.proposedStageId) {
          text += `\nProposed next stage: ${nextStageKind(pipeline, decision)}.`;
        }
        if (decision.dispatchStatus) {
          text += `\nDispatch status: ${decision.dispatchStatus}.`;
        }
        if (decision.dispatchJobId) {
          text += `\nRun: ${decision.dispatchJobId}.`;
        }
        if (decision.dispatchError) {
          text += `\nError: ${decision.dispatchError}`;
        }
        result = {
          text,
          decisionId: decision.id,
          actions: buildActions(context.isAuthorized, decision),
        };
        break;
      }
      case 'approve': {
        const pendingDecision = command.targetStage
          ? findPendingDecisionForTargetStage(
              pipeline,
              pendingDecisions,
              command.targetStage,
            )
          : latestPendingDecision;
        if (!pendingDecision) {
          const target = command.targetStage
            ? ` to ${command.targetStage}`
            : '';
          result = {
            text: `No pending decision to approve${target} for ${repo}#${issue}.`,
            decisionId: null,
            actions: [],
          };
          break;
        }
        const decision = await resolveDecision(
          pendingDecision.id,
          { action: 'approve', actor: context.actor, source },
          client,
        );
        const next = nextStageKind(pipeline, decision);
        let text = `Approved ${repo}#${issue} to ${next}. Dispatch ${decision.dispatchStatus || 'none'}.`;
        if (
          decision.dispatchStatus === 'dispatch_failed' &&
          decision.dispatchError
        ) {
          text += `\n${decision.dispatchError}`;
        } else if (decision.dispatchStatus === 'awaiting_fallback_approval') {
          text += '\nFallback approval is required before dispatch.';
        } else if (
          decision.dispatchStatus === 'dispatched' &&
          decision.dispatchJobId
        ) {
          text += `\nRun ${decision.dispatchJobId} started.`;
        }
        result = { text, decisionId: decision.id, actions: [] };
        break;
      }
      case 'reject': {
        if (!latestPendingDecision) {
          result = {
            text: `No pending decision to reject for ${repo}#${issue}.`,
            decisionId: null,
            actions: [],
          };
          break;
        }
        const decision = await resolveDecision(
          latestPendingDecision.id,
          {
            action: 'reject',
            actor: context.actor,
            note: command.note,
            source,
          },
          client,
        );
        result = {
          text: `Rejected ${repo}#${issue}. Decision ${decision.id} is rejected.`,
          decisionId: decision.id,
          actions: [],
        };
        break;
      }
      case 'revise': {
        if (!latestPendingDecision) {
          result = {
            text: `No pending decision to revise for ${repo}#${issue}.`,
            decisionId: null,
            actions: [],
          };
          break;
        }
        const decision = await resolveDecision(
          latestPendingDecision.id,
          {
            action: 'revise',
            actor: context.actor,
            note: command.note,
            source,
          },
          client,
        );
        let text = `Revised ${repo}#${issue} with feedback: ${command.note}`;
        if (
          decision.dispatchStatus === 'dispatched' &&
          decision.dispatchJobId
        ) {
          text += `\nRun ${decision.dispatchJobId} started.`;
        } else if (
          decision.dispatchStatus === 'dispatch_failed' &&
          decision.dispatchError
        ) {
          text += `\nDispatch failed: ${decision.dispatchError}`;
        }
        result = { text, decisionId: decision.id, actions: [] };
        break;
      }
      case 'reassign': {
        const pendingDecision = findPendingDecisionForStage(
          pipeline,
          pendingDecisions,
          command.stage,
        );
        if (!pendingDecision) {
          result = {
            text: `No pending decision to reassign for ${command.stage} on ${repo}#${issue}.`,
            decisionId: null,
            actions: [],
          };
          break;
        }
        // Pre-validate the agent handle so we get a clear error before resolving.
        if (!getAgentProfileByHandle(command.agentHandle)) {
          result = {
            text: `Agent @${command.agentHandle} was not found for ${repo}#${issue}.`,
            decisionId: null,
            actions: [],
          };
          break;
        }
        const decision = await resolveDecision(
          pendingDecision.id,
          {
            action: 'reassign',
            actor: context.actor,
            agentHandle: command.agentHandle,
            source,
          },
          client,
        );
        let text = `Reassigned ${repo}#${issue} to ${command.agentHandle}.`;
        if (
          decision.dispatchStatus === 'dispatched' &&
          decision.dispatchJobId
        ) {
          text += `\nRun ${decision.dispatchJobId} started.`;
        } else if (
          decision.dispatchStatus === 'dispatch_failed' &&
          decision.dispatchError
        ) {
          text += `\nDispatch failed: ${decision.dispatchError}`;
        }
        result = { text, decisionId: decision.id, actions: [] };
        break;
      }
      case 'cancel': {
        // Try to cancel a pending decision first
        if (latestPendingDecision) {
          const decision = await resolveDecision(
            latestPendingDecision.id,
            {
              action: 'cancel',
              actor: context.actor,
              note: command.note,
              source,
            },
            client,
          );
          result = {
            text: `Cancelled decision ${decision.id} for ${repo}#${issue}. Status: ${decision.status}.`,
            decisionId: decision.id,
            actions: [],
          };
          break;
        }
        // Fall back to cancelling coding jobs
        const jobs = loadCodingJobs().filter(
          (j) =>
            j.repo === repo &&
            j.issueNumber === issue &&
            !['completed', 'failed', 'cancelled'].includes(j.status),
        );
        if (jobs.length === 0) {
          result = {
            text: `No active run or pending decision to cancel for ${repo}#${issue}.`,
            decisionId: null,
            actions: [],
          };
        } else {
          try {
            const cancelledIds: string[] = [];
            for (const job of jobs) {
              cancelCodingJob(job.id, 'control-plane');
              cancelledIds.push(job.id);
            }
            result = {
              text: `Cancelled active run(s) ${cancelledIds.join(', ')} for ${repo}#${issue}.`,
              decisionId: null,
              actions: [],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result = {
              text: `Cancel failed for ${repo}#${issue}: ${message}`,
              decisionId: null,
              actions: [],
            };
          }
        }
        break;
      }
      case 'pause': {
        // Try to pause a pending decision first
        if (latestPendingDecision) {
          const decision = await resolveDecision(
            latestPendingDecision.id,
            {
              action: 'pause',
              actor: context.actor,
              note: command.note,
              source,
            },
            client,
          );
          result = {
            text: `Paused decision ${decision.id} for ${repo}#${issue}. Status: ${decision.status}.`,
            decisionId: decision.id,
            actions: [],
          };
          break;
        }
        result = {
          text: `No pending decision to pause for ${repo}#${issue}.`,
          decisionId: null,
          actions: [],
        };
        break;
      }
      default: {
        result = {
          text: `Unknown control plane action: ${(command as any).action}`,
          decisionId: null,
          actions: [],
        };
      }
    }
  } catch (err) {
    if (err instanceof DecisionStaleError) {
      const decision = err.decision;
      result = {
        text: `Decision ${decision.id} is stale: ${err.message}\nCurrent status: ${decision.status}. Dispatch: ${decision.dispatchStatus || 'none'}.`,
        decisionId: decision.id,
        actions: [],
      };
    } else if (err instanceof DecisionResolutionError) {
      const decision = err.decision;
      result = {
        text: `Could not resolve decision ${decision.id}: ${err.message}\nCurrent status: ${decision.status}.`,
        decisionId: decision.id,
        actions: [],
      };
    } else {
      const message = err instanceof Error ? err.message : String(err);
      result = {
        text: `Command failed for ${repo}#${issue}: ${message}`,
        decisionId: null,
        actions: [],
      };
    }
  }

  if (messageId) {
    processedMessageIds.add(messageId);
    messageResultCache.set(messageId, result);
  }

  return result;
}
