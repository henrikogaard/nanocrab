import type { CodingJob, CodingRepo } from './coding-jobs.js';

export type MobileCodingJobSummary = Pick<
  CodingJob,
  'id' | 'repo' | 'status' | 'branch'
>;

export interface MobileGitHubIssueSummary {
  number: number;
  title: string;
}

export interface MobileCodingCommandGroup {
  isMain?: boolean;
  folder?: string;
}

export interface MobileCodingCommandDeps {
  startCodingJob(input: {
    repo: string;
    prompt?: string;
    requestedBy: string;
    createPr?: boolean;
    cli?: string;
    tool?: string;
    provider?: string;
    model?: string;
  }): Promise<MobileCodingJobSummary>;
  pickGitHubIssue(input: {
    repo: string;
    labels?: string[];
    requestedBy: string;
    createPr?: boolean;
    cli?: string;
    tool?: string;
    provider?: string;
    model?: string;
  }): Promise<{
    issue: MobileGitHubIssueSummary;
    job: MobileCodingJobSummary;
  } | null>;
  loadCodingRepos(): CodingRepo[];
  loadCodingJobs(): MobileCodingJobSummary[];
  getCodingJob(jobId: string): MobileCodingJobSummary | undefined;
  controlCodingJob(
    action: string,
    jobId: string,
    actor: string,
  ): Promise<MobileCodingJobSummary> | MobileCodingJobSummary;
}

export interface HandleMobileCodingCommandInput {
  text: string;
  chatJid: string;
  sender: string;
  isAuthorized?: boolean;
  group?: MobileCodingCommandGroup;
  sendMessage(chatJid: string, text: string): Promise<void> | void;
  deps: MobileCodingCommandDeps;
}

function splitArgs(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function parseFlags(args: string[]) {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (const arg of args) {
    if (arg === '--pr') flags.set('pr', true);
    else if (arg.startsWith('--labels=')) flags.set('labels', arg.slice(9));
    else if (arg.startsWith('--tool=')) flags.set('tool', arg.slice(7));
    else if (arg.startsWith('--cli=')) flags.set('cli', arg.slice(6));
    else if (arg.startsWith('--provider='))
      flags.set('provider', arg.slice(11));
    else if (arg.startsWith('--model=')) flags.set('model', arg.slice(8));
    else positional.push(arg);
  }
  return { positional, flags };
}

function runtimeFlags(flags: Map<string, string | true>): {
  cli?: string;
  tool?: string;
  provider?: string;
  model?: string;
} {
  const result: ReturnType<typeof runtimeFlags> = {};
  for (const key of ['cli', 'tool', 'provider', 'model'] as const) {
    const value = flags.get(key);
    if (typeof value === 'string' && value.trim()) result[key] = value.trim();
  }
  return result;
}

function helpText() {
  return [
    'Mobile coding commands:',
    '/code repos',
    '/code start owner/repo describe the change --pr [--tool=codex --provider=codex --model=gpt-5.4]',
    '/code pick owner/repo --labels=bug,autofix --pr [--tool=codex --provider=codex --model=gpt-5.4]',
    '/code status [jobId]',
    '/code approve|cancel|retry|open-pr jobId',
  ].join('\n');
}

function formatJob(job: MobileCodingJobSummary) {
  return `${job.id} ${job.repo} ${job.status} ${job.branch || ''}`.trim();
}

export async function handleMobileCodingCommand(
  input: HandleMobileCodingCommandInput,
): Promise<boolean> {
  const trimmed = input.text.trim();
  if (trimmed !== '/code' && !trimmed.startsWith('/code ')) return false;
  if (!input.group?.isMain) {
    await input.sendMessage(
      input.chatJid,
      'Coding commands are only available in the main control group.',
    );
    return true;
  }
  if (input.isAuthorized === false) {
    await input.sendMessage(
      input.chatJid,
      'Unauthorized. Coding commands require an authorized operator.',
    );
    return true;
  }

  const args = splitArgs(trimmed).slice(1);
  const command = args.shift() || 'help';
  const actor = `mobile:${input.chatJid}:${input.sender}`;

  try {
    if (command === 'help') {
      await input.sendMessage(input.chatJid, helpText());
      return true;
    }
    if (command === 'start') {
      const { positional, flags } = parseFlags(args);
      const repo = positional.shift();
      const prompt = positional.join(' ').trim();
      if (!repo || !prompt) {
        await input.sendMessage(
          input.chatJid,
          'Usage: /code start owner/repo describe the change --pr',
        );
        return true;
      }
      const job = await input.deps.startCodingJob({
        repo,
        prompt,
        requestedBy: actor,
        createPr: flags.has('pr') || undefined,
        ...runtimeFlags(flags),
      });
      await input.sendMessage(
        input.chatJid,
        `Coding job queued: ${job.id}\nRepo: ${job.repo}\nStatus: ${job.status}\nBranch: ${job.branch}`,
      );
      return true;
    }
    if (command === 'pick') {
      const { positional, flags } = parseFlags(args);
      const repo = positional.shift();
      if (!repo) {
        await input.sendMessage(
          input.chatJid,
          'Usage: /code pick owner/repo --labels=bug,autofix --pr',
        );
        return true;
      }
      const labels =
        typeof flags.get('labels') === 'string'
          ? String(flags.get('labels'))
              .split(',')
              .map((label) => label.trim())
              .filter(Boolean)
          : undefined;
      const picked = await input.deps.pickGitHubIssue({
        repo,
        labels,
        requestedBy: actor,
        createPr: flags.has('pr') || undefined,
        ...runtimeFlags(flags),
      });
      if (!picked) {
        await input.sendMessage(
          input.chatJid,
          `No matching issues found for ${repo}.`,
        );
        return true;
      }
      await input.sendMessage(
        input.chatJid,
        `Picked issue #${picked.issue.number}: ${picked.issue.title}\nCoding job queued: ${picked.job.id}\nStatus: ${picked.job.status}`,
      );
      return true;
    }
    if (command === 'repos') {
      const repos = input.deps.loadCodingRepos();
      await input.sendMessage(
        input.chatJid,
        repos.length
          ? repos
              .map((repo) => `${repo.fullName} (${repo.defaultBranch})`)
              .join('\n')
          : 'No coding repositories are registered.',
      );
      return true;
    }
    if (command === 'status') {
      const jobId = args[0];
      const jobs = jobId
        ? [input.deps.getCodingJob(jobId)].filter(Boolean)
        : input.deps.loadCodingJobs().slice(0, 5);
      await input.sendMessage(
        input.chatJid,
        jobs.length
          ? jobs
              .map((job) => formatJob(job as MobileCodingJobSummary))
              .join('\n')
          : 'No coding jobs found.',
      );
      return true;
    }
    if (['approve', 'cancel', 'retry', 'open-pr'].includes(command)) {
      const jobId = args[0];
      if (!jobId) {
        await input.sendMessage(input.chatJid, `Usage: /code ${command} jobId`);
        return true;
      }
      const job = await input.deps.controlCodingJob(command, jobId, actor);
      await input.sendMessage(
        input.chatJid,
        `Coding job updated: ${formatJob(job)}`,
      );
      return true;
    }

    await input.sendMessage(input.chatJid, helpText());
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await input.sendMessage(input.chatJid, `Coding command failed: ${message}`);
    return true;
  }
}
