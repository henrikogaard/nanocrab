import {
  approveCodingJob,
  cancelCodingJob,
  getCodingJob,
  loadCodingJobs,
  openCodingJobPr,
  approveAndCloseCodingPullRequest,
  pickGitHubIssue,
  refreshCodingJobCi,
  requestCodingPullRequestClose,
  startCodingPullRequestReview,
} from './coding-jobs.js';

type CodingCommandAction =
  | 'help'
  | 'list'
  | 'show'
  | 'approve'
  | 'open-pr'
  | 'refresh-ci'
  | 'cancel'
  | 'pick'
  | 'review-pr'
  | 'close-pr'
  | 'approve-close-pr';

export interface ParsedCodingCommand {
  action: CodingCommandAction;
  jobId?: string;
  repo?: string;
  pullRequestNumber?: number;
  labels?: string[];
  assignee?: string;
  milestone?: string;
  issueNumber?: number;
  cli?: string;
  provider?: string;
  model?: string;
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
  if (
    command === '/coding-review-pr' ||
    command === '/coding-close-pr' ||
    command === '/coding-approve-close-pr'
  ) {
    const parsed: ParsedCodingCommand = {
      action:
        command === '/coding-review-pr'
          ? 'review-pr'
          : command === '/coding-close-pr'
            ? 'close-pr'
            : 'approve-close-pr',
      repo: args[1],
    };
    const refMatch = parsed.repo?.match(/^([^#]+)#(\d+)$/);
    if (refMatch) {
      parsed.repo = refMatch[1];
      parsed.pullRequestNumber = Number(refMatch[2]);
    } else if (args[2] && /^\d+$/.test(args[2])) {
      parsed.pullRequestNumber = Number(args[2]);
    }
    const flagStart = refMatch ? 2 : 3;
    for (const arg of args.slice(flagStart)) {
      const [key, ...rest] = arg.split('=');
      const value = rest.join('=');
      if ((key === 'tool' || key === 'cli') && value) parsed.cli = value;
      else if (key === 'provider' && value) parsed.provider = value;
      else if (key === 'model' && value) parsed.model = value;
    }
    return parsed;
  }
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
    } else if ((key === 'tool' || key === 'cli') && value) {
      parsed.cli = value;
    } else if (key === 'provider' && value) {
      parsed.provider = value;
    } else if (key === 'model' && value) {
      parsed.model = value;
    } else if (key === 'assignee' && value) {
      parsed.assignee = value;
    } else if (key === 'milestone' && value) {
      parsed.milestone = value;
    } else if (key === 'issue' && /^\d+$/.test(value)) {
      parsed.issueNumber = Number(value);
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
    job.type === 'review' && job.pullRequestNumber
      ? `Review: PR #${job.pullRequestNumber}${job.pullRequestUrl ? ` (${job.pullRequestUrl})` : ''}`
      : '',
    `Runtime: ${job.runnerCli}/${job.provider}/${job.model}`,
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
      '/coding-pick owner/repo labels=a,b tool=codex provider=codex model=gpt-5.4 [no-pr]',
      '/coding-approve <jobId>',
      '/coding-pr <jobId>',
      '/coding-review-pr owner/repo#<pr> tool=codex provider=codex model=gpt-5.4',
      '/coding-close-pr owner/repo#<pr>',
      '/coding-approve-close-pr owner/repo#<pr>',
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
    const result = await pickGitHubIssue({
      repo: command.repo,
      labels: command.labels,
      cli: command.cli,
      provider: command.provider,
      model: command.model,
      assignee: command.assignee,
      milestone: command.milestone,
      issueNumber: command.issueNumber,
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

  if (command.action === 'review-pr') {
    if (!command.repo || !command.pullRequestNumber) {
      return 'Usage: /coding-review-pr owner/repo#<pr> [tool=codex provider=codex model=gpt-5.4]';
    }
    const job = await startCodingPullRequestReview({
      repo: command.repo,
      pullRequestNumber: command.pullRequestNumber,
      cli: command.cli,
      provider: command.provider,
      model: command.model,
      requestedBy: actor,
    });
    return [
      `PR review job queued: ${job.id}`,
      `${job.repo}#${job.pullRequestNumber}`,
      `Runtime: ${job.runnerCli}/${job.provider}/${job.model}`,
      `Review output: /coding-job ${job.id}`,
    ].join('\n');
  }

  if (command.action === 'close-pr' || command.action === 'approve-close-pr') {
    if (!command.repo || !command.pullRequestNumber) {
      return `Usage: /coding-${command.action} owner/repo#<pr>`;
    }
    const ref = `${command.repo}#${command.pullRequestNumber}`;
    if (command.action === 'close-pr') {
      const requested = await requestCodingPullRequestClose(
        command.repo,
        command.pullRequestNumber,
        actor,
      );
      return `Close approval required for ${ref}. Approval: ${requested.approvalId}\nUse /coding-approve-close-pr ${ref} after review.`;
    }
    const closed = await approveAndCloseCodingPullRequest(
      command.repo,
      command.pullRequestNumber,
      actor,
    );
    return `Closed ${ref}. The PR was not merged and its branch was not deleted. Approval: ${closed.approvalId}`;
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
