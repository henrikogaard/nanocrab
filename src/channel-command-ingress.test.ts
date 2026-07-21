import { describe, expect, it } from 'vitest';

import {
  normalizeChannelCommandText,
  parseChannelCodingCommand,
} from './channel-command-ingress.js';

describe('channel command ingress', () => {
  it('strips the configured trigger and profile mentions', () => {
    expect(
      normalizeChannelCommandText(
        '@NanoCrab @RepoFixer /coding-pick henrikogaard/nanocrab labels=bug',
        '@NanoCrab',
      ),
    ).toBe('/coding-pick henrikogaard/nanocrab labels=bug');
  });

  it.each([
    ['discord', '@NanoCrab /coding-jobs'],
    ['slack', '@NanoCrab @Coding /coding-jobs'],
    ['telegram', '@NanoCrab /coding-jobs'],
    ['whatsapp', '@NanoCrab /coding-jobs'],
    ['web', '/coding-jobs'],
  ])('accepts normalized %s ingress', (_channel, raw) => {
    expect(parseChannelCodingCommand(raw, { trigger: '@NanoCrab' })).toEqual({
      action: 'list',
    });
  });

  it('does not treat an embedded trigger as a command prefix', () => {
    expect(
      parseChannelCodingCommand('please tell @NanoCrab /coding-jobs', {
        trigger: '@NanoCrab',
      }),
    ).toBeNull();
  });

  it('preserves command arguments and provider flags', () => {
    expect(
      parseChannelCodingCommand(
        '<@BOT> @Coder /coding-pick owner/repo labels=bug,autofix provider=codex model=gpt-5.4 --pr',
        { trigger: '<@BOT>' },
      ),
    ).toEqual({
      action: 'pick',
      repo: 'owner/repo',
      labels: ['bug', 'autofix'],
      provider: 'codex',
      model: 'gpt-5.4',
      createPr: true,
    });
  });

  it('supports a triggerless main control group', () => {
    expect(
      parseChannelCodingCommand('/coding-approve job-1', { isMain: true }),
    ).toEqual({ action: 'approve', jobId: 'job-1' });
  });

  it('requires the configured trigger for non-main groups', () => {
    expect(
      parseChannelCodingCommand('/coding-jobs', {
        trigger: '@NanoCrab',
        requiresTrigger: true,
      }),
    ).toBeNull();
  });
});
