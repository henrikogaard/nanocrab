import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

import type { CodingJob } from '../../../coding-jobs.js';
import {
  buildAutofixWorkbenchResponse,
  buildAutofixStartInput,
  hasAutofixCapacity,
  normalizeAutofixProject,
  runAutofixAutoPickOnce,
} from './routes.js';

const routesPath = path.join(
  process.cwd(),
  'src/admin/plugins/autofix/routes.ts',
);

function job(overrides: Partial<CodingJob>): CodingJob {
  return {
    id: 'job-1',
    repo: 'owner/repo',
    type: 'issue',
    prompt: 'Fix issue',
    issueNumber: 7,
    issueTitle: 'Bug',
    provider: 'codex',
    model: 'gpt-5.4',
    status: 'queued',
    branch: 'coding/issue-7',
    workspace: '/tmp/workspace',
    createPr: true,
    dryRun: false,
    prUrl: null,
    commitSha: null,
    changedFiles: [],
    diffSummary: null,
    testSummary: null,
    ciStatus: 'unknown',
    lastCiError: null,
    transitionedAt: {},
    transitionHistory: [],
    failureReason: null,
    approvalHistory: [],
    output: '',
    requestedBy: 'test',
    agentProfileId: null,
    sourceSubscriptionId: null,
    runnerCli: 'codex',
    activeAttemptId: null,
    executionAttempts: [],
    createdAt: new Date(0).toISOString(),
    completedAt: null,
    ...overrides,
  };
}

describe('autofix project automation settings', () => {
  it('normalizes provider, PR, and concurrency defaults for saved projects', () => {
    const project = normalizeAutofixProject({
      id: 'project-1',
      owner: 'owner',
      repo: 'repo',
      triggerLabel: '',
      model: '',
      notifyJid: '',
      autoReview: false,
      createdAt: new Date(0).toISOString(),
    });

    expect(project.triggerLabel).toBe('autofix');
    expect(project.provider).toBe('claude');
    expect(project.model).toBe('claude-sonnet-4-6');
    expect(project.createPr).toBe(true);
    expect(project.maxActiveJobs).toBe(1);
    expect(project.autoPickEnabled).toBe(false);
    expect(project.pollIntervalMinutes).toBe(15);
  });

  it('builds webhook coding-job input from project provider settings', () => {
    const project = normalizeAutofixProject({
      id: 'project-1',
      owner: 'owner',
      repo: 'repo',
      triggerLabel: 'p0',
      provider: 'codex',
      model: 'gpt-5.4',
      createPr: false,
      maxActiveJobs: 2,
      notifyJid: '',
      autoReview: false,
      createdAt: new Date(0).toISOString(),
    });

    expect(buildAutofixStartInput(project, 42, 'github-webhook')).toMatchObject(
      {
        repo: 'owner/repo',
        issueNumber: 42,
        provider: 'codex',
        model: 'gpt-5.4',
        createPr: false,
        requestedBy: 'github-webhook',
      },
    );
  });

  it('blocks new webhook jobs when the project active-job limit is reached', () => {
    const project = normalizeAutofixProject({
      id: 'project-1',
      owner: 'owner',
      repo: 'repo',
      triggerLabel: 'autofix',
      provider: 'codex',
      model: 'gpt-5.4',
      maxActiveJobs: 1,
      notifyJid: '',
      autoReview: false,
      createdAt: new Date(0).toISOString(),
    });

    expect(hasAutofixCapacity(project, [job({ status: 'queued' })])).toBe(
      false,
    );
    expect(hasAutofixCapacity(project, [job({ status: 'completed' })])).toBe(
      true,
    );
    expect(hasAutofixCapacity(project, [job({ repo: 'other/repo' })])).toBe(
      true,
    );
  });

  it('normalizes enabled auto-pick polling settings', () => {
    const project = normalizeAutofixProject({
      id: 'project-1',
      owner: 'owner',
      repo: 'repo',
      triggerLabel: 'p0',
      autoPickEnabled: true,
      pollIntervalMinutes: 3,
      notifyJid: '',
      autoReview: false,
      createdAt: new Date(0).toISOString(),
    } as any);

    expect(project.autoPickEnabled).toBe(true);
    expect(project.pollIntervalMinutes).toBe(5);
    expect(project.lastAutoPickAt).toBeNull();
  });

  it('auto-picks labeled GitHub issues while honoring capacity and duplicates', async () => {
    const project = normalizeAutofixProject({
      id: 'project-1',
      owner: 'owner',
      repo: 'repo',
      triggerLabel: 'p0',
      provider: 'codex',
      model: 'gpt-5.4',
      maxActiveJobs: 2,
      autoPickEnabled: true,
      pollIntervalMinutes: 15,
      notifyJid: '',
      autoReview: false,
      createdAt: new Date(0).toISOString(),
    } as any);
    const started: Array<{ issueNumber?: number; requestedBy?: string }> = [];
    const savedProjects: (typeof project)[][] = [];

    const result = await runAutofixAutoPickOnce({
      now: new Date('2026-06-15T09:00:00.000Z'),
      projects: [project],
      loadCodingJobs: () => [
        job({
          id: 'active-duplicate',
          issueNumber: 8,
          status: 'implement',
        }),
      ],
      listIssues: async () => [
        {
          number: 7,
          title: 'P0 crash',
          labels: [{ name: 'p0' }],
        },
        {
          number: 8,
          title: 'Already running',
          labels: [{ name: 'p0' }],
        },
        {
          number: 9,
          title: 'Different label',
          labels: [{ name: 'feature' }],
        },
      ],
      startJob: async (input) => {
        started.push(input);
        return job({
          id: `started-${input.issueNumber}`,
          issueNumber: input.issueNumber,
          status: 'queued',
          requestedBy: input.requestedBy,
        });
      },
      saveProjects: (projects) => savedProjects.push(projects),
    });

    expect(started).toEqual([
      expect.objectContaining({
        issueNumber: 7,
        requestedBy: 'github-auto-pick',
      }),
    ]);
    expect(result).toMatchObject({
      scanned: 1,
      started: 1,
      skippedDuplicate: 1,
      skippedLabel: 1,
    });
    expect(savedProjects[0][0].lastAutoPickAt).toBe('2026-06-15T09:00:00.000Z');
  });

  it('builds a GitHub workbench response with boards, issues, and active coding assignments', () => {
    const project = normalizeAutofixProject({
      id: 'project-1',
      owner: 'owner',
      repo: 'repo',
      triggerLabel: 'autofix',
      provider: 'codex',
      model: 'gpt-5.4',
      notifyJid: '',
      autoReview: false,
      createdAt: new Date(0).toISOString(),
    });

    const response = buildAutofixWorkbenchResponse({
      projects: [project],
      repos: [
        {
          id: 'owner-repo',
          fullName: 'owner/repo',
          defaultBranch: 'main',
          labels: ['autofix'],
          enabled: true,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
      selectedRepo: 'owner/repo',
      issues: [
        {
          number: 7,
          title: 'Fix dashboard issue',
          body: 'Broken workbench',
          labels: ['autofix'],
          assignees: ['henrik'],
          milestone: 'MVP',
          author: 'reporter',
          htmlUrl: 'https://github.com/owner/repo/issues/7',
          updatedAt: '2026-06-15T09:00:00Z',
        },
      ],
      projectBoards: [
        {
          type: 'project_v2',
          number: 12,
          title: 'Roadmap',
          url: 'https://github.com/orgs/owner/projects/12',
          description: 'Current delivery board',
          updatedAt: '2026-06-15T09:00:00Z',
          closed: false,
        },
      ],
      jobs: [
        job({
          id: 'active-job',
          issueNumber: 7,
          status: 'implement',
        }),
      ],
      projectBoardsError: 'GitHub Projects scope is missing',
    });

    expect(response.selectedRepo).toBe('owner/repo');
    expect(response.projectBoards[0]).toMatchObject({ title: 'Roadmap' });
    expect(response.projectBoardsError).toBe(
      'GitHub Projects scope is missing',
    );
    expect(response.issues[0]).toMatchObject({
      number: 7,
      activeJob: expect.objectContaining({
        id: 'active-job',
        status: 'implement',
      }),
    });
  });

  it('mirrors coding job lifecycle routes for Autofix job review actions', () => {
    const source = fs.readFileSync(routesPath, 'utf8');

    expect(source).toContain("router.post('/jobs/:id/open-pr'");
    expect(source).toContain("router.post('/jobs/:id/revert'");
    expect(source).toContain("router.post('/jobs/:id/close-pr'");
    expect(source).toContain('openCodingJobPr(');
    expect(source).toContain('revertCodingJob(');
    expect(source).toContain('closeCodingJobPr(');
  });
});
