import {
  approveCodingJob,
  cancelCodingJob,
  getCodingJob,
  loadCodingJobs,
  openCodingJobPr,
  pickGitHubIssue,
  refreshCodingJobCi,
} from './coding-jobs.js';
import { resolveCodingRuntimeProfile } from './coding-runtime-profiles.js';

type CodingCommandAction =
  | 'help'
  | 'list'
  | 'show'
  | 'approve'
  | 'open-pr'
  | 'refresh-ci'
  | 'cancel'
  | 'pick';

export interface ParsedCodingCommand {
  action: CodingCommandAction;
  jobId?: string;
  repo?: string;
  labels?: string[];
  provider?: string;
  model?: string;
  runtimeProfileId?: string;
  createPr?: boolean;
}

function splitArgs(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean);
}

export function parseCodingCommand(input: string): ParsedCodingCommand | null {
  const args = splitArgs(input);
  const command = args[0]?.toLowerCase();
  if (!command) return null;
  if (command === '/coding-help') return { action: 'help' };
  if (command === '/coding-jobs') return { action: 'list' };
  if (command === '/coding-job') return { action: 'show', jobId: args[1] };
  if (command === '/coding-approve') {
    return { action: 'approve', jobId: args[1] };
  }
  if (command === '/coding-pr') return { action: 'open-pr', jobId: args[1] };
  if (command === '/coding-ci') return { action: 'refresh-ci', jobId: args[1] };
  if (command === '/coding-cancel') {
    return { action: 'cancel', jobId: args[1] };
  }
  if (command !== '/coding-pick') return null;

  const parsed: ParsedCodingCommand = {
    action: 'pick',
    repo: args[1],
    labels: [],
    createPr: true,
  };
  for (const arg of args.slice(2)) {
    const [key, ...rest] = arg.split('=');
    const value = rest.join('=');
    if (key === 'labels' && value) {
      parsed.labels = value
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean);
    } else if (key === 'provider' && value) {
      parsed.provider = value;
    } else if (key === 'model' && value) {
      parsed.model = value;
    } else if ((key === 'profile' || key === 'runtime-profile') && value) {
      parsed.runtimeProfileId = value;
    } else if (key === 'no-pr') {
      parsed.createPr = false;
    } else if (key === 'pr') {
      parsed.createPr = true;
    }
  }
  return parsed;
}

function summarizeJob(
  job: NonNullable<ReturnType<typeof getCodingJob>>,
): string {
  return [
    `${job.id}: ${job.status} ${job.repo}${job.issueNumber ? `#${job.issueNumber}` : ''}`,
    job.issueTitle || job.prompt.slice(0, 120),
    job.investigationSummary ? `Plan: ${job.investigationSummary}` : '',
    job.prUrl ? `PR: ${job.prUrl}` : '',
    job.testSummary ? `Tests: ${job.testSummary}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function runCodingCommand(
  command: ParsedCodingCommand,
  actor: string,
): Promise<string> {
  if (command.action === 'help') {
    return [
      'Coding commands:',
      '/coding-jobs',
      '/coding-job <jobId>',
      '/coding-pick owner/repo labels=a,b profile=codex-default [no-pr]',
      '  (or provider=codex model=gpt-5.4)',
      '/coding-approve <jobId>',
      '/coding-pr <jobId>',
      '/coding-ci <jobId>',
      '/coding-cancel <jobId>',
    ].join('\n');
  }

  if (command.action === 'list') {
    const jobs = loadCodingJobs()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8);
    if (jobs.length === 0) return 'No coding jobs yet.';
    return jobs.map(summarizeJob).join('\n\n');
  }

  if (command.action === 'pick') {
    if (!command.repo) return 'Usage: /coding-pick owner/repo labels=a,b';
    const actualRuntime = command.runtimeProfileId
      ? resolveCodingRuntimeProfile(command.runtimeProfileId)
      : undefined;
    const result = await pickGitHubIssue({
      repo: command.repo,
      labels: command.labels,
      provider: command.provider,
      model: command.model,
      actualRuntime,
      createPr: command.createPr,
      requestedBy: actor,
    });
    if (!result) return `No matching open issue found for ${command.repo}.`;
    return [
      `Picked ${command.repo}#${result.issue.number}: ${result.issue.title}`,
      `Job: ${result.job.id}`,
      result.job.investigationSummary || '',
      `Approve with /coding-approve ${result.job.id}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (!command.jobId) return 'A coding job id is required.';
  const existing = getCodingJob(command.jobId);
  if (!existing) return `Coding job not found: ${command.jobId}`;

  if (command.action === 'show') return summarizeJob(existing);
  if (command.action === 'approve') {
    return summarizeJob(approveCodingJob(command.jobId, actor));
  }
  if (command.action === 'cancel') {
    return summarizeJob(cancelCodingJob(command.jobId, actor));
  }
  if (command.action === 'refresh-ci') {
    return summarizeJob(await refreshCodingJobCi(command.jobId));
  }
  if (command.action === 'open-pr') {
    return summarizeJob(await openCodingJobPr(command.jobId, actor));
  }

  return 'Unsupported coding command.';
}
