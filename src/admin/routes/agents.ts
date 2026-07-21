/**
 * Agent task launcher — spawn coding tasks on Claude Code, Codex, OpenCode, or GitHub Copilot.
 * Tracks running/completed tasks with output logs.
 */
import { Router, Request, Response } from 'express';
import { execFileSync, spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { DEVIN_CLI_MODEL_ALIASES, STORE_DIR } from '../../config.js';
import { auditLog } from '../security.js';
import { logger } from '../../logger.js';
import {
  AGENT_PROVIDER_DEFINITIONS,
  AGENT_PROVIDER_MODELS,
  DEFAULT_AGENT_MODELS,
  getAgentProviderConfig,
  getProviderAvailability,
  isAgentProvider,
  isCodingCapableProvider,
  codingProviderUnavailableReason,
} from '../../agent-provider.js';
import {
  isAgentCliId,
  listAgentRuntimeDefinitions,
  resolveDevinCliModelAlias,
  validateCodingRuntimeSelection,
} from '../../agent-runtime-registry.js';
import { probeCodingRunnerReadiness } from '../../coding-runner-readiness.js';
import type { AgentRuntimeHealth, AgentRuntimeSelection } from '../../types.js';
import {
  buildCodingRuntimeProfile,
  deleteCodingRuntimeProfile,
  getCodingRuntimeProfile,
  listCodingRuntimeProfiles,
  resolveCodingRuntimeProfile,
  saveCodingRuntimeProfile,
  type CodingRuntimeProfile,
} from '../../coding-runtime-profiles.js';
import {
  getAllRegisteredGroups as _getAllRegisteredGroups,
  getNonWebRegisteredGroups,
} from '../../db.js';
import {
  deriveRuntimeCapabilities,
  resolveAgentBoundary,
} from '../../agent-boundaries.js';
import {
  getCodingJob,
  approveCodingJob,
  approveCodingJobPr,
  cancelCodingJob,
  closeCodingJobPr,
  denyCodingJob,
  listGitHubIssues,
  loadCodingJobs,
  loadCodingRepos,
  saveCodingRepos,
  openCodingJobPr,
  pickGitHubIssue,
  refreshCodingJobCi,
  registerCodingRepo,
  retryCodingJob,
  revertCodingJob,
  startCodingJob,
} from '../../coding-jobs.js';
import {
  listAllRepoRules,
  listRepoRules,
  upsertRepoRule,
} from '../../repo-preferences.js';

const router = Router();
const TASKS_PATH = path.join(STORE_DIR, 'agent-tasks.json');

function loadConfiguredConnectorIds(): string[] {
  const ids = new Set(['nanocrab', 'github']);
  try {
    const mcpConfigPath = path.join(STORE_DIR, 'mcp-servers.json');
    if (fs.existsSync(mcpConfigPath)) {
      const servers = JSON.parse(
        fs.readFileSync(mcpConfigPath, 'utf-8'),
      ) as Array<{ name?: string }>;
      for (const server of servers) {
        if (server.name) ids.add(server.name);
      }
    }
  } catch {
    // intentional
  }
  return Array.from(ids);
}

interface AgentTask {
  id: string;
  tool: 'claude' | 'codex' | 'opencode' | 'gh-copilot';
  model: string;
  prompt: string;
  workDir: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  output: string;
  exitCode: number | null;
  pid: number | null;
  budget: number | null;
  createdAt: string;
  completedAt: string | null;
}

const runningProcesses = new Map<string, ChildProcess>();

function loadTasks(): AgentTask[] {
  try {
    return JSON.parse(fs.readFileSync(TASKS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveTasks(tasks: AgentTask[]): void {
  fs.mkdirSync(path.dirname(TASKS_PATH), { recursive: true });
  fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2));
}

// Available container agent providers (for multi-provider support)
router.get('/providers', (_req: Request, res: Response) => {
  const availability = getProviderAvailability();
  const config = getAgentProviderConfig();
  res.json(
    Object.values(AGENT_PROVIDER_DEFINITIONS).map((provider) => {
      const defaultModel =
        config.modelsByProvider[provider.id] ||
        DEFAULT_AGENT_MODELS[provider.id];
      const modelIds = [
        ...new Set([
          defaultModel,
          ...(AGENT_PROVIDER_MODELS[provider.id] || []),
        ]),
      ];
      const codingCapable = modelIds.some((model) =>
        isCodingCapableProvider(provider.id, model),
      );
      return {
        id: provider.id,
        name: provider.name,
        runtime: provider.runtime,
        available: availability[provider.id],
        codingCapable,
        codingUnavailableReason: codingCapable
          ? null
          : codingProviderUnavailableReason(provider.id, defaultModel),
        models: modelIds.map((id) => ({
          id,
          label: id,
          codingCapable: isCodingCapableProvider(provider.id, id),
        })),
        defaultModel,
      };
    }),
  );
});

interface CodingRuntimeOption extends AgentRuntimeSelection {
  cliModel: string | null;
  available: boolean;
  readiness: AgentRuntimeHealth;
}

function codingRuntimeIdentity(input: unknown): string {
  const runtime = input as Partial<AgentRuntimeSelection> | null;
  return [runtime?.cli, runtime?.provider, runtime?.model]
    .map((part) =>
      typeof part === 'string' && part.trim() ? part.trim() : '(missing)',
    )
    .join(' / ');
}

async function parseCodingRuntimeSelection(
  input: unknown,
): Promise<AgentRuntimeSelection> {
  const identity = codingRuntimeIdentity(input);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(
      `Invalid coding runtime ${identity}: expected a complete CLI, provider, and model selection`,
    );
  }
  const raw = input as Record<string, unknown>;
  if (
    typeof raw.cli !== 'string' ||
    !isAgentCliId(raw.cli) ||
    typeof raw.provider !== 'string' ||
    !isAgentProvider(raw.provider) ||
    typeof raw.model !== 'string' ||
    !raw.model.trim()
  ) {
    throw new Error(
      `Invalid coding runtime ${identity}: expected a complete CLI, provider, and model selection`,
    );
  }
  const runtime: AgentRuntimeSelection = {
    cli: raw.cli,
    provider: raw.provider,
    model: raw.model.trim(),
  };
  try {
    validateCodingRuntimeSelection(runtime);
  } catch (err) {
    throw new Error(
      `Invalid coding runtime ${identity}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (runtime.cli === 'devin') {
    const readiness = await probeCodingRunnerReadiness('devin');
    if (readiness.status !== 'healthy') {
      throw new Error(
        `Coding runtime ${identity} is unavailable: ${readiness.detail}`,
      );
    }
  }
  return runtime;
}

router.get('/coding/runtimes', async (_req: Request, res: Response) => {
  try {
    const definitions = listAgentRuntimeDefinitions().filter(
      (runtime) => runtime.codingRunnerSupported,
    );
    const readiness = new Map(
      await Promise.all(
        definitions.map(
          async (runtime) =>
            [
              runtime.cli,
              await probeCodingRunnerReadiness(runtime.cli),
            ] as const,
        ),
      ),
    );
    const config = getAgentProviderConfig();
    const candidates = new Map<string, AgentRuntimeSelection>();
    for (const definition of definitions) {
      if (definition.cli === 'devin') {
        for (const key of Object.keys(DEVIN_CLI_MODEL_ALIASES)) {
          const separator = key.indexOf('/');
          const provider = key.slice(0, separator);
          const model = key.slice(separator + 1);
          if (!isAgentProvider(provider) || !model) continue;
          const runtime = { cli: definition.cli, provider, model } as const;
          candidates.set(`${runtime.cli}/${key}`, runtime);
        }
        continue;
      }
      for (const provider of Object.keys(AGENT_PROVIDER_DEFINITIONS).filter(
        isAgentProvider,
      )) {
        const models = new Set([
          config.modelsByProvider[provider] || DEFAULT_AGENT_MODELS[provider],
          ...(AGENT_PROVIDER_MODELS[provider] || []),
        ]);
        for (const model of models) {
          if (!model || !isCodingCapableProvider(provider, model)) continue;
          const runtime = { cli: definition.cli, provider, model };
          try {
            validateCodingRuntimeSelection(runtime);
            candidates.set(
              `${runtime.cli}/${runtime.provider}/${runtime.model}`,
              runtime,
            );
          } catch {
            // Only expose complete triples accepted by the server validator.
          }
        }
      }
    }
    const options: CodingRuntimeOption[] = Array.from(candidates.values()).map(
      (runtime) => {
        const runtimeReadiness = readiness.get(runtime.cli);
        if (!runtimeReadiness) {
          throw new Error(
            `Missing readiness for coding runtime ${runtime.cli}`,
          );
        }
        return {
          ...runtime,
          cliModel:
            runtime.cli === 'devin' ? resolveDevinCliModelAlias(runtime) : null,
          available: runtimeReadiness.status === 'healthy',
          readiness: runtimeReadiness,
        };
      },
    );
    res.json(options);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

async function runtimeProfileResponse(
  profile: CodingRuntimeProfile,
): Promise<Record<string, unknown>> {
  const readiness = await probeCodingRunnerReadiness(profile.runtime.cli);
  return {
    ...profile,
    available: readiness.status === 'healthy',
    readiness,
  };
}

router.get('/coding/runtime-profiles', async (_req: Request, res: Response) => {
  try {
    res.json(
      await Promise.all(
        listCodingRuntimeProfiles().map(runtimeProfileResponse),
      ),
    );
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/coding/runtime-profiles', async (req: Request, res: Response) => {
  try {
    const profile = buildCodingRuntimeProfile({
      id: req.body?.id,
      label: req.body?.label,
      description: req.body?.description,
      runtime: req.body?.runtime,
      enabled: req.body?.enabled,
    });
    const saved = saveCodingRuntimeProfile(profile);
    auditLog(req, 'coding_runtime_profile_created', saved.id);
    res.json({ ok: true, profile: await runtimeProfileResponse(saved) });
  } catch (err) {
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.put(
  '/coding/runtime-profiles/:id',
  async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      const existing = getCodingRuntimeProfile(id);
      if (!existing) {
        res.status(404).json({ error: 'Coding runtime profile not found' });
        return;
      }
      const profile = buildCodingRuntimeProfile({
        id: existing.id,
        label: req.body?.label ?? existing.label,
        description: req.body?.description ?? existing.description,
        runtime: req.body?.runtime ?? existing.runtime,
        enabled: req.body?.enabled ?? existing.enabled,
      });
      const saved = saveCodingRuntimeProfile({
        ...profile,
        createdAt: existing.createdAt,
      });
      auditLog(req, 'coding_runtime_profile_updated', saved.id);
      res.json({ ok: true, profile: await runtimeProfileResponse(saved) });
    } catch (err) {
      res
        .status(400)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.delete('/coding/runtime-profiles/:id', (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    deleteCodingRuntimeProfile(id);
    auditLog(req, 'coding_runtime_profile_deleted', id);
    res.json({ ok: true });
  } catch (err) {
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/boundaries', (_req: Request, res: Response) => {
  const connectorIds = loadConfiguredConnectorIds();
  const groups = getNonWebRegisteredGroups();
  res.json(
    Object.entries(groups).map(([jid, group]) => {
      const boundary = resolveAgentBoundary({
        group,
        isMain: group.isMain === true,
        agentId: group.folder,
        availableConnectorIds: connectorIds,
      });
      return {
        jid,
        name: group.name,
        folder: group.folder,
        isMain: boundary.isMain,
        boundary,
        capabilities: deriveRuntimeCapabilities(boundary, { connectorIds }),
      };
    }),
  );
});

router.get('/coding/repos', (_req: Request, res: Response) => {
  res.json(loadCodingRepos());
});

router.post('/coding/repos', async (req: Request, res: Response) => {
  try {
    const repo = await registerCodingRepo({
      repo: req.body.repo,
      defaultBranch: req.body.defaultBranch,
      labels: Array.isArray(req.body.labels) ? req.body.labels : [],
      commitSigningPolicy:
        req.body.commitSigningPolicy === 'prefer' ||
        req.body.commitSigningPolicy === 'require'
          ? req.body.commitSigningPolicy
          : 'off',
    });
    auditLog(req, 'coding_repo_registered', repo.fullName);
    res.json({ ok: true, repo });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get(
  '/coding/repos/:owner/:name/commit-signing',
  (req: Request, res: Response) => {
    try {
      const repo = loadCodingRepos().find(
        (item) =>
          item.fullName.toLowerCase() ===
          `${req.params.owner}/${req.params.name}`.toLowerCase(),
      );
      if (!repo) {
        res.status(404).json({ error: 'Coding repo not found' });
        return;
      }
      res.json({
        repo: repo.fullName,
        policy: repo.commitSigningPolicy || 'off',
        signingKeyConfigured: Boolean(process.env.NANOCRAB_GIT_SIGNING_KEY),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.put(
  '/coding/repos/:owner/:name/commit-signing',
  (req: Request, res: Response) => {
    try {
      const repo = `${req.params.owner}/${req.params.name}`;
      const policy = req.body.policy;
      if (policy !== 'off' && policy !== 'prefer' && policy !== 'require') {
        res
          .status(400)
          .json({ error: 'policy must be off, prefer, or require' });
        return;
      }
      const repos = loadCodingRepos();
      const registered = repos.find(
        (item) => item.fullName.toLowerCase() === repo.toLowerCase(),
      );
      if (!registered) {
        res.status(404).json({ error: 'Coding repo not found' });
        return;
      }
      registered.commitSigningPolicy = policy;
      registered.updatedAt = new Date().toISOString();
      saveCodingRepos(repos);
      auditLog(
        req,
        'coding_repo_commit_signing_policy_updated',
        `${repo}:${policy}`,
      );
      res.json({
        ok: true,
        repo: registered.fullName,
        policy,
        signingKeyConfigured: Boolean(process.env.NANOCRAB_GIT_SIGNING_KEY),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.get('/coding/repo-rules', (_req: Request, res: Response) => {
  res.json(listAllRepoRules());
});

router.get(
  '/coding/repos/:owner/:name/rules',
  (req: Request, res: Response) => {
    try {
      const repo = `${req.params.owner}/${req.params.name}`;
      res.json(listRepoRules(repo));
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.post(
  '/coding/repos/:owner/:name/rules',
  (req: Request, res: Response) => {
    try {
      const repo = `${req.params.owner}/${req.params.name}`;
      const rule = upsertRepoRule({
        id: typeof req.body.id === 'string' ? req.body.id : undefined,
        repo,
        title: req.body.title,
        content: req.body.content,
        source: req.body.source || 'dashboard',
        visibility: req.body.visibility === 'private' ? 'private' : 'shared',
        status: req.body.status === 'disabled' ? 'disabled' : 'approved',
      });
      auditLog(req, 'coding_repo_rule_upserted', `${repo}:${rule.id}`);
      res.json({ ok: true, rule });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.get('/coding/jobs', (_req: Request, res: Response) => {
  res.json(
    loadCodingJobs()
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 50)
      .map((job) => ({
        ...job,
        output:
          job.output.length > 1200 ? `${job.output.slice(-1200)}` : job.output,
      })),
  );
});

router.get('/coding/jobs/:id', (req: Request, res: Response) => {
  const job = getCodingJob(req.params.id as string);
  if (!job) {
    res.status(404).json({ error: 'Coding job not found' });
    return;
  }
  res.json(job);
});

router.post('/coding/jobs/:id/approve', (req: Request, res: Response) => {
  try {
    const job = approveCodingJob(
      req.params.id as string,
      req.user?.username || 'dashboard',
    );
    auditLog(req, 'coding_job_approved', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post(
  '/coding/jobs/:id/deny-implementation',
  (req: Request, res: Response) => {
    try {
      const job = denyCodingJob(
        req.params.id as string,
        req.user?.username || 'dashboard',
        typeof req.body?.note === 'string' ? req.body.note : undefined,
      );
      auditLog(req, 'coding_job_denied', job.id);
      res.json({ ok: true, job });
    } catch (err) {
      res
        .status(400)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post('/coding/jobs/:id/cancel', (req: Request, res: Response) => {
  try {
    const job = cancelCodingJob(
      req.params.id as string,
      req.user?.username || 'dashboard',
    );
    auditLog(req, 'coding_job_cancelled', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/coding/jobs/:id/retry', async (req: Request, res: Response) => {
  try {
    const job = await retryCodingJob(
      req.params.id as string,
      req.user?.username || 'dashboard',
    );
    auditLog(req, 'coding_job_retried', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/coding/jobs/:id/open-pr', async (req: Request, res: Response) => {
  try {
    const job = await openCodingJobPr(
      req.params.id as string,
      req.user?.username || 'dashboard',
    );
    auditLog(req, 'coding_job_open_pr', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post(
  '/coding/jobs/:id/approve-pr',
  async (req: Request, res: Response) => {
    try {
      approveCodingJobPr(
        req.params.id as string,
        req.user?.username || 'dashboard',
      );
      const job = await openCodingJobPr(
        req.params.id as string,
        req.user?.username || 'dashboard',
      );
      auditLog(req, 'coding_job_pr_approved', job.id);
      res.json({ ok: true, job });
    } catch (err) {
      res
        .status(400)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  '/coding/jobs/:id/refresh-ci',
  async (req: Request, res: Response) => {
    try {
      const job = await refreshCodingJobCi(req.params.id as string);
      auditLog(req, 'coding_job_ci_refreshed', job.id);
      res.json({ ok: true, job });
    } catch (err) {
      res
        .status(400)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post('/coding/jobs/:id/revert', async (req: Request, res: Response) => {
  try {
    const job = await revertCodingJob(
      req.params.id as string,
      req.user?.username || 'dashboard',
    );
    auditLog(req, 'coding_job_revert_requested', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post(
  '/coding/jobs/:id/close-pr',
  async (req: Request, res: Response) => {
    try {
      const job = await closeCodingJobPr(
        req.params.id as string,
        req.user?.username || 'dashboard',
      );
      auditLog(req, 'coding_job_close_pr', job.id);
      res.json({ ok: true, job });
    } catch (err) {
      res
        .status(400)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.get('/coding/issues', async (req: Request, res: Response) => {
  try {
    const repo = String(req.query.repo || '');
    const labels =
      typeof req.query.labels === 'string' && req.query.labels.trim()
        ? req.query.labels
            .split(',')
            .map((label) => label.trim())
            .filter(Boolean)
        : undefined;
    const assignee =
      typeof req.query.assignee === 'string' && req.query.assignee.trim()
        ? req.query.assignee.trim()
        : undefined;
    const issues = await listGitHubIssues({ repo, labels, assignee });
    res.json(issues);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/coding/jobs', async (req: Request, res: Response) => {
  try {
    const selectedRuntime =
      typeof req.body.runtimeProfileId === 'string' &&
      req.body.runtimeProfileId.trim()
        ? resolveCodingRuntimeProfile(req.body.runtimeProfileId.trim())
        : req.body.actualRuntime;
    const actualRuntime = await parseCodingRuntimeSelection(selectedRuntime);
    const job = await startCodingJob({
      repo: req.body.repo,
      prompt: req.body.prompt,
      issueNumber:
        typeof req.body.issueNumber === 'number'
          ? req.body.issueNumber
          : undefined,
      actualRuntime,
      createPr: req.body.createPr === true,
      branchName: req.body.branchName,
      requestedBy: req.user?.username || 'dashboard',
    });
    auditLog(req, 'coding_job_started', `${job.repo}/${job.id}`);
    res.json({ ok: true, job });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/coding/pick-issue', async (req: Request, res: Response) => {
  try {
    const selectedRuntime =
      typeof req.body.runtimeProfileId === 'string' &&
      req.body.runtimeProfileId.trim()
        ? resolveCodingRuntimeProfile(req.body.runtimeProfileId.trim())
        : req.body.actualRuntime;
    const actualRuntime = await parseCodingRuntimeSelection(selectedRuntime);
    const result = await pickGitHubIssue({
      repo: req.body.repo,
      labels: Array.isArray(req.body.labels) ? req.body.labels : undefined,
      actualRuntime,
      createPr: req.body.createPr === true,
      requestedBy: req.user?.username || 'dashboard',
    });
    if (!result) {
      res.json({ ok: true, issue: null, job: null });
      return;
    }
    auditLog(
      req,
      'coding_issue_picked',
      `${result.issue.htmlUrl} -> ${result.job.id}`,
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// Available tools and their models
router.get('/tools', (_req: Request, res: Response) => {
  const tools = [
    {
      id: 'claude',
      name: 'Claude Code',
      available: true,
      models: [
        { id: 'sonnet', label: 'Sonnet 4.6 (fast)' },
        { id: 'opus', label: 'Opus 4.6 (powerful)' },
        { id: 'haiku', label: 'Haiku 4.5 (cheapest)' },
      ],
      defaultModel: 'sonnet',
    },
    {
      id: 'codex',
      name: 'OpenAI Codex CLI',
      available: false, // Not installed
      models: [
        { id: 'o4-mini', label: 'o4-mini' },
        { id: 'o3', label: 'o3' },
        { id: 'gpt-4.1', label: 'GPT-4.1' },
      ],
      defaultModel: 'o4-mini',
    },
    {
      id: 'opencode',
      name: 'OpenCode CLI',
      available: false,
      models: AGENT_PROVIDER_MODELS.opencode.map((id) => ({ id, label: id })),
      defaultModel: DEFAULT_AGENT_MODELS.opencode,
    },
    {
      id: 'gh-copilot',
      name: 'GitHub Copilot',
      available: true,
      models: [{ id: 'default', label: 'Default (Copilot)' }],
      defaultModel: 'default',
    },
  ];

  // Check what's actually installed
  try {
    execFileSync('which', ['codex'], { stdio: 'pipe' });
    tools[1].available = true;
  } catch {
    // intentional
  }
  try {
    execFileSync('which', ['opencode'], { stdio: 'pipe' });
    tools[2].available = true;
  } catch {
    // intentional
  }

  res.json(tools);
});

// List tasks
router.get('/tasks', (_req: Request, res: Response) => {
  const tasks = loadTasks();
  // Don't send full output in list view
  res.json(
    tasks
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 30)
      .map((t) => ({
        ...t,
        output: t.output.length > 300 ? t.output.slice(-300) + '...' : t.output,
        isRunning: runningProcesses.has(t.id),
      })),
  );
});

// Get single task with full output
router.get('/tasks/:id', (req: Request, res: Response) => {
  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({ ...task, isRunning: runningProcesses.has(task.id) });
});

// Launch a new task
router.post('/tasks', (req: Request, res: Response) => {
  const { tool, model, prompt, workDir, budget } = req.body;
  if (!tool || !prompt) {
    res.status(400).json({ error: 'tool and prompt required' });
    return;
  }

  const resolvedDir = workDir || process.cwd();
  if (!fs.existsSync(resolvedDir)) {
    res
      .status(400)
      .json({ error: `Working directory not found: ${resolvedDir}` });
    return;
  }

  const task: AgentTask = {
    id: crypto.randomUUID(),
    tool,
    model: model || 'sonnet',
    prompt,
    workDir: resolvedDir,
    status: 'running',
    output: '',
    exitCode: null,
    pid: null,
    budget: budget ? parseFloat(budget) : null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  // Build command
  let cmd: string;
  let args: string[];

  switch (tool) {
    case 'claude':
      cmd = 'claude';
      args = ['-p', '--model', model || 'sonnet', '--output-format', 'text'];
      if (task.budget) args.push('--max-budget-usd', String(task.budget));
      args.push(prompt);
      break;

    case 'codex':
      cmd = 'codex';
      args = ['--model', model || 'o4-mini', '--quiet', prompt];
      break;

    case 'opencode':
      cmd = 'opencode';
      args = ['run', '--model', model || DEFAULT_AGENT_MODELS.opencode, prompt];
      break;

    case 'gh-copilot':
      cmd = 'gh';
      args = ['copilot', 'suggest', '-t', 'shell', prompt];
      break;

    default:
      res.status(400).json({ error: `Unknown tool: ${tool}` });
      return;
  }

  logger.info(
    { tool, model, workDir: resolvedDir, taskId: task.id },
    'Launching agent task',
  );

  try {
    const proc = spawn(cmd, args, {
      cwd: resolvedDir,
      env: { ...process.env, TERM: 'dumb' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    task.pid = proc.pid || null;
    runningProcesses.set(task.id, proc);

    proc.stdout?.on('data', (data: Buffer) => {
      task.output += data.toString();
      // Keep output bounded
      if (task.output.length > 500000) {
        task.output = task.output.slice(-400000);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      task.output += data.toString();
    });

    proc.on('close', (code) => {
      task.status = code === 0 ? 'completed' : 'failed';
      task.exitCode = code;
      task.completedAt = new Date().toISOString();
      runningProcesses.delete(task.id);

      const tasks = loadTasks();
      const idx = tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) tasks[idx] = task;
      else tasks.push(task);
      saveTasks(tasks);

      logger.info(
        { taskId: task.id, tool, exitCode: code },
        'Agent task completed',
      );
    });

    proc.on('error', (err) => {
      task.status = 'failed';
      task.output += `\nProcess error: ${err.message}`;
      task.completedAt = new Date().toISOString();
      runningProcesses.delete(task.id);

      const tasks = loadTasks();
      const idx = tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) tasks[idx] = task;
      else tasks.push(task);
      saveTasks(tasks);
    });

    // Save initial task
    const tasks = loadTasks();
    tasks.push(task);
    saveTasks(tasks);

    auditLog(req, 'agent_task_launched', `${tool}:${model} in ${resolvedDir}`);
    res.json({
      ok: true,
      task: {
        id: task.id,
        tool,
        model: task.model,
        status: 'running',
        pid: task.pid,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to launch: ${err.message}` });
  }
});

// Cancel a running task
router.post('/tasks/:id/cancel', (req: Request, res: Response) => {
  const proc = runningProcesses.get(req.params.id as string);
  if (!proc) {
    res.status(404).json({ error: 'Task not running' });
    return;
  }

  proc.kill('SIGTERM');
  setTimeout(() => {
    if (runningProcesses.has(req.params.id as string)) {
      proc.kill('SIGKILL');
    }
  }, 5000);

  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === req.params.id);
  if (task) {
    task.status = 'cancelled';
    task.completedAt = new Date().toISOString();
    saveTasks(tasks);
  }

  runningProcesses.delete(req.params.id as string);
  auditLog(req, 'agent_task_cancelled', req.params.id as string);
  res.json({ ok: true });
});

// Delete a task (only if not running)
router.delete('/tasks/:id', (req: Request, res: Response) => {
  if (runningProcesses.has(req.params.id as string)) {
    res
      .status(400)
      .json({ error: 'Cannot delete a running task. Cancel it first.' });
    return;
  }
  const tasks = loadTasks();
  const idx = tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  tasks.splice(idx, 1);
  saveTasks(tasks);
  res.json({ ok: true });
});

// --- Scheduled Tasks ---

interface ScheduledTask {
  id: string;
  tool: string;
  model: string;
  prompt: string;
  workDir: string;
  cron: string; // simple: "daily 08:00" | "hourly" | "weekly mon 09:00"
  enabled: boolean;
  lastRun: string | null;
  createdAt: string;
}

const SCHEDULED_PATH = path.join(STORE_DIR, 'scheduled-tasks.json');
const scheduledTimers = new Map<string, ReturnType<typeof setTimeout>>();

function loadScheduled(): ScheduledTask[] {
  try {
    return JSON.parse(fs.readFileSync(SCHEDULED_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveScheduled(tasks: ScheduledTask[]): void {
  fs.mkdirSync(path.dirname(SCHEDULED_PATH), { recursive: true });
  fs.writeFileSync(SCHEDULED_PATH, JSON.stringify(tasks, null, 2));
}

function parseCronInterval(cron: string): number {
  if (cron === 'hourly') return 3600000;
  if (cron.startsWith('daily')) return 86400000;
  if (cron.startsWith('weekly')) return 604800000;
  // Default: every 6 hours
  return 21600000;
}

function getNextRunDelay(cron: string): number {
  const now = new Date();
  if (cron === 'hourly') {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.getTime() - now.getTime();
  }
  if (cron.startsWith('daily')) {
    const timeMatch = cron.match(/(\d{2}):(\d{2})/);
    const h = timeMatch ? parseInt(timeMatch[1]) : 8;
    const m = timeMatch ? parseInt(timeMatch[2]) : 0;
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }
  return parseCronInterval(cron);
}

function scheduleTask(task: ScheduledTask): void {
  if (!task.enabled) return;
  const delay = getNextRunDelay(task.cron);
  const timer = setTimeout(async () => {
    // Execute the task
    const { spawn: spawnChild } = await import('child_process');
    let cmd: string, args: string[];
    switch (task.tool) {
      case 'claude':
        cmd = 'claude';
        args = [
          '-p',
          '--model',
          task.model || 'sonnet',
          '--output-format',
          'text',
          task.prompt,
        ];
        break;
      case 'codex':
        cmd = 'codex';
        args = ['--model', task.model || 'o4-mini', '--quiet', task.prompt];
        break;
      default:
        return;
    }

    logger.info({ taskId: task.id, tool: task.tool }, 'Running scheduled task');
    spawnChild(cmd, args, {
      cwd: task.workDir || process.cwd(),
      env: { ...process.env, TERM: 'dumb' },
      stdio: 'ignore',
      detached: true,
    }).unref();

    // Update last run
    const tasks = loadScheduled();
    const t = tasks.find((s) => s.id === task.id);
    if (t) {
      t.lastRun = new Date().toISOString();
      saveScheduled(tasks);
    }

    // Schedule next run
    scheduleTask(task);
  }, delay);

  scheduledTimers.set(task.id, timer);
}

// Start all scheduled tasks on module load
try {
  for (const task of loadScheduled()) {
    if (task.enabled) scheduleTask(task);
  }
} catch {
  // intentional
}

router.get('/scheduled', (_req: Request, res: Response) => {
  res.json(loadScheduled());
});

router.post('/scheduled', (req: Request, res: Response) => {
  const { tool, model, prompt, workDir, cron } = req.body;
  if (!tool || !prompt || !cron) {
    res.status(400).json({ error: 'tool, prompt, and cron required' });
    return;
  }

  const task: ScheduledTask = {
    id: crypto.randomUUID(),
    tool,
    model: model || 'sonnet',
    prompt,
    workDir: workDir || process.cwd(),
    cron,
    enabled: true,
    lastRun: null,
    createdAt: new Date().toISOString(),
  };

  const tasks = loadScheduled();
  tasks.push(task);
  saveScheduled(tasks);
  scheduleTask(task);

  auditLog(req, 'scheduled_task_created', `${tool}: ${prompt.slice(0, 50)}`);
  res.json({ ok: true, task });
});

router.put('/scheduled/:id', (req: Request, res: Response) => {
  const tasks = loadScheduled();
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const { enabled, cron, prompt, model } = req.body;
  if (enabled !== undefined) task.enabled = enabled;
  if (cron) task.cron = cron;
  if (prompt) task.prompt = prompt;
  if (model) task.model = model;
  saveScheduled(tasks);

  // Restart timer
  const timer = scheduledTimers.get(task.id);
  if (timer) clearTimeout(timer);
  scheduledTimers.delete(task.id);
  if (task.enabled) scheduleTask(task);

  res.json({ ok: true });
});

router.delete('/scheduled/:id', (req: Request, res: Response) => {
  const tasks = loadScheduled();
  const idx = tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const timer = scheduledTimers.get(tasks[idx].id);
  if (timer) clearTimeout(timer);
  scheduledTimers.delete(tasks[idx].id);

  tasks.splice(idx, 1);
  saveScheduled(tasks);
  auditLog(req, 'scheduled_task_deleted', req.params.id as string);
  res.json({ ok: true });
});

export default router;
