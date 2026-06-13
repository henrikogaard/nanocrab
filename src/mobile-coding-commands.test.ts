import { describe, expect, it, vi } from 'vitest';
import {
  handleMobileCodingCommand,
  type MobileCodingJobSummary,
} from './mobile-coding-commands.js';

function jobSummary(
  overrides: Partial<MobileCodingJobSummary> = {},
): MobileCodingJobSummary {
  return {
    id: 'job-1',
    repo: 'owner/repo',
    status: 'queued',
    branch: 'nanocrab/job-1',
    ...overrides,
  };
}

describe('mobile coding commands', () => {
  it('starts a coding job from a main-group /code start command', async () => {
    const sendMessage = vi.fn();
    const startCodingJob = vi.fn(async () =>
      jobSummary({
        id: 'job-1',
        branch: 'nanocrab/mobile-job-1',
      }),
    );

    const handled = await handleMobileCodingCommand({
      text: '/code start owner/repo Fix the settings page on mobile --pr',
      chatJid: 'wa:main',
      sender: 'Henrik',
      group: { isMain: true, folder: 'main' },
      sendMessage,
      deps: {
        startCodingJob,
        pickGitHubIssue: vi.fn(),
        loadCodingRepos: vi.fn(),
        loadCodingJobs: vi.fn(),
        getCodingJob: vi.fn(),
        controlCodingJob: vi.fn(),
      },
    });

    expect(handled).toBe(true);
    expect(startCodingJob).toHaveBeenCalledWith({
      repo: 'owner/repo',
      prompt: 'Fix the settings page on mobile',
      requestedBy: 'mobile:wa:main:Henrik',
      createPr: true,
    });
    expect(sendMessage).toHaveBeenCalledWith(
      'wa:main',
      expect.stringContaining('Coding job queued: job-1'),
    );
  });

  it('rejects coding commands outside the main control group', async () => {
    const sendMessage = vi.fn();
    const startCodingJob = vi.fn();

    const handled = await handleMobileCodingCommand({
      text: '/code start owner/repo Try to mutate a repo',
      chatJid: 'wa:side',
      sender: 'Scout',
      group: { isMain: false, folder: 'side' },
      sendMessage,
      deps: {
        startCodingJob,
        pickGitHubIssue: vi.fn(),
        loadCodingRepos: vi.fn(),
        loadCodingJobs: vi.fn(),
        getCodingJob: vi.fn(),
        controlCodingJob: vi.fn(),
      },
    });

    expect(handled).toBe(true);
    expect(startCodingJob).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      'wa:side',
      expect.stringContaining('main control group'),
    );
  });

  it('picks a GitHub issue and starts a coding job from mobile', async () => {
    const sendMessage = vi.fn();
    const pickGitHubIssue = vi.fn(async () => ({
      issue: { number: 42, title: 'Fix mobile controls' },
      job: jobSummary({
        id: 'job-42',
        branch: 'nanocrab/issue-42',
      }),
    }));

    await handleMobileCodingCommand({
      text: '/code pick owner/repo --labels=bug,mobile --pr',
      chatJid: 'wa:main',
      sender: 'Henrik',
      group: { isMain: true, folder: 'main' },
      sendMessage,
      deps: {
        startCodingJob: vi.fn(),
        pickGitHubIssue,
        loadCodingRepos: vi.fn(),
        loadCodingJobs: vi.fn(),
        getCodingJob: vi.fn(),
        controlCodingJob: vi.fn(),
      },
    });

    expect(pickGitHubIssue).toHaveBeenCalledWith({
      repo: 'owner/repo',
      labels: ['bug', 'mobile'],
      requestedBy: 'mobile:wa:main:Henrik',
      createPr: true,
    });
    expect(sendMessage).toHaveBeenCalledWith(
      'wa:main',
      expect.stringContaining('Picked issue #42'),
    );
  });

  it('lists recent coding jobs and controls approval from mobile', async () => {
    const sendMessage = vi.fn();
    const controlCodingJob = vi.fn(async () =>
      jobSummary({
        id: 'job-1',
        status: 'implement',
      }),
    );
    const deps = {
      startCodingJob: vi.fn(),
      pickGitHubIssue: vi.fn(),
      loadCodingRepos: vi.fn(),
      loadCodingJobs: vi.fn(() => [
        jobSummary({
          id: 'job-1',
          status: 'await_approval',
        }),
      ]),
      getCodingJob: vi.fn(),
      controlCodingJob,
    };

    await handleMobileCodingCommand({
      text: '/code status',
      chatJid: 'wa:main',
      sender: 'Henrik',
      group: { isMain: true, folder: 'main' },
      sendMessage,
      deps,
    });
    await handleMobileCodingCommand({
      text: '/code approve job-1',
      chatJid: 'wa:main',
      sender: 'Henrik',
      group: { isMain: true, folder: 'main' },
      sendMessage,
      deps,
    });

    expect(sendMessage).toHaveBeenCalledWith(
      'wa:main',
      expect.stringContaining('job-1 owner/repo await_approval'),
    );
    expect(controlCodingJob).toHaveBeenCalledWith(
      'approve',
      'job-1',
      'mobile:wa:main:Henrik',
    );
    expect(sendMessage).toHaveBeenCalledWith(
      'wa:main',
      expect.stringContaining('Coding job updated: job-1'),
    );
  });
});
