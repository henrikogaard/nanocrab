import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';

import type { AgentCliId } from '../../types.js';
import { listAgentProfiles } from '../../agent-profiles.js';
import { probeAllAgentRuntimes } from '../../agent-runtime-registry.js';
import { loadCodingJobs, getCodingJob as _getCodingJob } from '../../coding-jobs.js';
import {
  DefaultGitHubProjectClient,
  StageConflictError,
} from '../../control-plane/github-projects.js';
import {
  createPipeline,
  updatePipeline,
} from '../../control-plane/pipelines.js';
import { syncPipeline } from '../../control-plane/sync.js';
import {
  resolveDecision,
  DecisionResolutionError,
  DecisionStaleError,
} from '../../control-plane/decisions.js';
import {
  getDecision,
  getPipeline,
  listDecisions,
  listProjectItemSnapshots,
  listPipelines,
  getStageAssignment,
} from '../../control-plane/store.js';
import { auditLog } from '../security.js';

const router = Router();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sendError(res: Response, status: number, err: unknown): void {
  res.status(status).json({ error: errorMessage(err) });
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

function isGitHubUnavailable(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  return (
    message.includes('github_token') ||
    message.includes('github token') ||
    message.includes('github is not configured') ||
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('fetch failed') ||
    message.includes('unavailable github') ||
    message.includes('github api')
  );
}

function isRuntimeUnavailable(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  return (
    message.includes('runtime unavailable') ||
    message.includes('cli is missing') ||
    message.includes('cli is unavailable') ||
    message.includes('no healthy fallback is available') ||
    (message.includes('primary cli') && message.includes('is missing')) ||
    message.includes('not a coding-job runtime')
  );
}

function decisionDispatchUnavailable(decision: {
  dispatchStatus?: string | null;
  dispatchError?: string | null;
}): boolean {
  if (decision.dispatchStatus !== 'dispatch_failed' || !decision.dispatchError)
    return false;
  return (
    isGitHubUnavailable(decision.dispatchError) ||
    isRuntimeUnavailable(decision.dispatchError)
  );
}

function userActor(req: Request): string {
  // requireRole('admin') upstream guarantees admin/owner, but fall back to the
  // username for the audit trail.
  return (
    ((req as any).user?.role as string | undefined) ||
    ((req as any).user?.username as string | undefined) ||
    'admin'
  );
}

interface RuntimeResponse {
  cli: AgentCliId;
  health: Awaited<ReturnType<typeof probeAllAgentRuntimes>>[number] | null;
}

const AGENT_CLIS: AgentCliId[] = [
  'claude',
  'codex',
  'opencode',
  'devin',
  'pi',
  'mistral',
];

function buildBoardCards() {
  const pipelines = listPipelines();
  const snapshots = listProjectItemSnapshots();
  const decisions = listDecisions();
  const profiles = new Map(
    listAgentProfiles().map((profile) => [profile.id, profile]),
  );
  const jobs = new Map(loadCodingJobs().map((job) => [job.id, job]));

  const cards: Array<Record<string, unknown>> = [];
  for (const snapshot of snapshots) {
    const pipeline = pipelines.find(
      (p) => p.pipeline.id === snapshot.pipelineId,
    );
    if (!pipeline) continue;
    const stage = pipeline.stages.find(
      (s) => s.githubFieldOptionId === snapshot.githubFieldOptionId,
    );
    if (!stage) continue;

    const assignment = getStageAssignment(
      snapshot.pipelineId,
      snapshot.issueNodeId,
      stage.id,
    );
    const agentProfileId = assignment?.agentProfileId || stage.agentProfileId;
    const agent = profiles.get(agentProfileId);

    const issueDecisions = decisions
      .filter(
        (d) =>
          d.pipelineId === snapshot.pipelineId &&
          d.issueNodeId === snapshot.issueNodeId,
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    const activeDecision =
      issueDecisions.find((d) => d.status === 'pending') || issueDecisions[0];

    const run = activeDecision
      ? jobs.get(activeDecision.runId || activeDecision.dispatchJobId || '') ||
        null
      : null;

    const actualRuntime =
      activeDecision?.actualRuntime || agent?.primaryRuntime || null;

    cards.push({
      issue: {
        number: snapshot.issueNumber,
        repo: snapshot.repository,
        title: snapshot.title,
        nodeId: snapshot.issueNodeId,
      },
      stage: {
        id: stage.id,
        kind: stage.stageKind,
        name: stage.githubFieldOptionName,
        requiredEvidence: stage.requiredEvidence,
      },
      agent: agent
        ? {
            id: agent.id,
            handle: agent.handle,
            displayName: agent.displayName,
            runtime: agent.primaryRuntime,
          }
        : null,
      actualRuntime,
      run: run
        ? {
            id: run.id,
            status: run.status,
            branch: run.branch,
            prUrl: run.prUrl,
            checks: run.ciStatus,
            commitSha: run.commitSha,
          }
        : null,
      decision: activeDecision
        ? {
            id: activeDecision.id,
            kind: activeDecision.kind,
            status: activeDecision.status,
            summary: activeDecision.summary,
            dispatchStatus: activeDecision.dispatchStatus,
          }
        : null,
    });
  }
  return cards;
}

// --- Runtimes ---

router.get('/runtimes', async (_req: Request, res: Response) => {
  try {
    const health = await probeAllAgentRuntimes();
    const byCli = new Map(health.map((h) => [h.cli, h]));
    const runtimes: RuntimeResponse[] = AGENT_CLIS.map((cli) => ({
      cli,
      health: byCli.get(cli) || null,
    }));
    res.json({ runtimes });
  } catch (err) {
    sendError(res, 503, err);
  }
});

// --- Pipelines ---

router.get('/pipelines', (_req: Request, res: Response) => {
  res.json({ pipelines: listPipelines() });
});

function buildPipelineWithStages(body: unknown): {
  candidate: any;
  validationError: string | null;
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {
      candidate: null,
      validationError: 'pipeline body must be an object',
    };
  }
  const record = body as Record<string, unknown>;
  const pipelineBody = record.pipeline;
  const stagesBody = record.stages;

  if (typeof pipelineBody !== 'object' || pipelineBody === null) {
    return {
      candidate: null,
      validationError: 'pipeline.pipeline must be an object',
    };
  }
  if (!Array.isArray(stagesBody)) {
    return {
      candidate: null,
      validationError: 'pipeline.stages must be an array',
    };
  }

  const pipelineInput = pipelineBody as Record<string, unknown>;
  const id = `pipeline_${randomUUID()}`;
  const now = new Date().toISOString();
  const pipeline = {
    id,
    name: String(pipelineInput.name || ''),
    githubOwner: String(pipelineInput.githubOwner || ''),
    githubProjectNumber: Number(pipelineInput.githubProjectNumber || 0),
    githubProjectId: String(pipelineInput.githubProjectId || ''),
    workflowFieldId: String(pipelineInput.workflowFieldId || ''),
    repositoryScopes: Array.isArray(pipelineInput.repositoryScopes)
      ? pipelineInput.repositoryScopes.filter(
          (s): s is string => typeof s === 'string',
        )
      : [],
    enabled: pipelineInput.enabled !== false,
    syncCursor: null,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const stages = stagesBody.map((stageBody: unknown, position: number) => {
    if (typeof stageBody !== 'object' || stageBody === null) {
      throw new Error('each stage must be an object');
    }
    const stage = stageBody as Record<string, unknown>;
    return {
      id: `stage_${randomUUID()}`,
      pipelineId: id,
      githubFieldOptionId: String(stage.githubFieldOptionId || ''),
      githubFieldOptionName: String(stage.githubFieldOptionName || ''),
      stageKind: String(stage.stageKind || '') as any,
      agentProfileId: String(stage.agentProfileId || ''),
      requiredEvidence: Array.isArray(stage.requiredEvidence)
        ? stage.requiredEvidence.filter(
            (s): s is string => typeof s === 'string',
          )
        : [],
      position,
    };
  });

  return { candidate: { pipeline, stages }, validationError: null };
}

router.post('/pipelines', (req: Request, res: Response) => {
  try {
    const { candidate, validationError } = buildPipelineWithStages(req.body);
    if (validationError) {
      sendError(res, 400, validationError);
      return;
    }
    const pipeline = createPipeline(candidate);
    auditLog(req, 'control_plane.pipeline.created', pipeline.pipeline.id);
    res.status(201).json({ ok: true, pipeline });
  } catch (err) {
    if (err instanceof StageConflictError) {
      sendError(res, 409, err);
      return;
    }
    sendError(res, 400, err);
  }
});

router.put('/pipelines/:id', (req: Request, res: Response) => {
  const id = routeParam(req, 'id');
  try {
    if (!getPipeline(id)) {
      sendError(res, 404, `pipeline ${id} was not found`);
      return;
    }
    const body = req.body as Partial<{
      pipeline: Record<string, unknown>;
      stages: Array<Partial<Record<string, unknown>>>;
    }>;
    const pipeline = updatePipeline(id, body as any);
    auditLog(req, 'control_plane.pipeline.updated', id);
    res.json({ ok: true, pipeline });
  } catch (err) {
    if (err instanceof Error && err.message.includes('was not found')) {
      sendError(res, 404, err);
      return;
    }
    if (err instanceof StageConflictError) {
      sendError(res, 409, err);
      return;
    }
    sendError(res, 400, err);
  }
});

router.post('/pipelines/:id/sync', async (req: Request, res: Response) => {
  const id = routeParam(req, 'id');
  try {
    if (!getPipeline(id)) {
      sendError(res, 404, `pipeline ${id} was not found`);
      return;
    }
    const client = new DefaultGitHubProjectClient();
    const result = await syncPipeline(id, client);
    auditLog(req, 'control_plane.pipeline.synced', id);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof Error && err.message.includes('was not found')) {
      sendError(res, 404, err);
      return;
    }
    if (isGitHubUnavailable(err)) {
      sendError(res, 503, err);
      return;
    }
    sendError(res, 400, err);
  }
});

// --- Runs ---

router.get('/runs', (_req: Request, res: Response) => {
  const jobs = loadCodingJobs();
  const runs = jobs.filter((job) => job.pipelineId || job.decisionId);
  res.json({ runs });
});

// --- Decisions ---

router.get('/decisions', (_req: Request, res: Response) => {
  res.json({ decisions: listDecisions() });
});

interface DecisionActionBody {
  note?: string;
  agentHandle?: string;
}

async function handleDecisionAction(
  req: Request,
  res: Response,
  action: 'approve' | 'reject' | 'revise' | 'reassign',
) {
  const id = routeParam(req, 'id');
  const body = (req.body || {}) as DecisionActionBody;
  const client = new DefaultGitHubProjectClient();
  try {
    if (!getDecision(id)) {
      sendError(res, 404, `decision ${id} was not found`);
      return;
    }
    const decision = await resolveDecision(
      id,
      {
        action,
        actor: userActor(req),
        note: typeof body.note === 'string' ? body.note : undefined,
        agentHandle:
          typeof body.agentHandle === 'string' ? body.agentHandle : undefined,
        source: 'control-plane-ui',
      },
      client,
    );
    auditLog(req, `control_plane.decision.${action}`, id);
    if (decisionDispatchUnavailable(decision)) {
      sendError(
        res,
        503,
        decision.dispatchError || 'GitHub/runtime unavailable',
      );
      return;
    }
    res.status(200).json({ ok: true, decision });
  } catch (err) {
    if (err instanceof Error && err.message.includes('was not found')) {
      sendError(res, 404, err);
      return;
    }
    if (
      err instanceof DecisionResolutionError ||
      err instanceof DecisionStaleError ||
      err instanceof StageConflictError
    ) {
      if (
        err instanceof DecisionStaleError ||
        err instanceof StageConflictError
      ) {
        sendError(res, 409, err);
        return;
      }
      sendError(res, 400, err);
      return;
    }
    if (isGitHubUnavailable(err) || isRuntimeUnavailable(err)) {
      sendError(res, 503, err);
      return;
    }
    sendError(res, 400, err);
  }
}

router.post('/decisions/:id/approve', (req: Request, res: Response) =>
  handleDecisionAction(req, res, 'approve'),
);
router.post('/decisions/:id/reject', (req: Request, res: Response) =>
  handleDecisionAction(req, res, 'reject'),
);
router.post('/decisions/:id/revise', (req: Request, res: Response) =>
  handleDecisionAction(req, res, 'revise'),
);
router.post('/decisions/:id/reassign', (req: Request, res: Response) =>
  handleDecisionAction(req, res, 'reassign'),
);

// --- Overview ---

router.get('/overview', async (_req: Request, res: Response) => {
  try {
    const [pipelines, decisions, snapshots, runtimes, agents] =
      await Promise.all([
        Promise.resolve(listPipelines()),
        Promise.resolve(listDecisions()),
        Promise.resolve(listProjectItemSnapshots()),
        probeAllAgentRuntimes(),
        Promise.resolve(listAgentProfiles()),
      ]);
    const jobs = loadCodingJobs();
    const boardCards = buildBoardCards();
    const pendingDecisions = decisions.filter((d) => d.status === 'pending');
    const stats = {
      pipelines: pipelines.length,
      agents: agents.length,
      pendingDecisions: pendingDecisions.length,
      runs: jobs.filter((j) => j.pipelineId || j.decisionId).length,
      runtimesHealthy: runtimes.filter((r) => r.status === 'healthy').length,
    };
    res.json({
      ok: true,
      boardCards,
      stats,
      loadIssues: [],
      pipelines: pipelines.map((p) => ({
        id: p.pipeline.id,
        name: p.pipeline.name,
        enabled: p.pipeline.enabled,
        repositoryScopes: p.pipeline.repositoryScopes,
        stages: p.stages.map((s) => ({
          id: s.id,
          kind: s.stageKind,
          name: s.githubFieldOptionName,
          agentProfileId: s.agentProfileId,
        })),
      })),
      agents: agents.map((a) => ({
        id: a.id,
        handle: a.handle,
        displayName: a.displayName,
        enabled: a.enabled,
        primaryRuntime: a.primaryRuntime,
        stageRoles: a.stageRoles,
      })),
      decisions: pendingDecisions,
      snapshots,
    });
  } catch (err) {
    sendError(res, 503, err);
  }
});

export default router;
