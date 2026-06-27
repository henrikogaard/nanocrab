import { describe, expect, it } from 'vitest';

import { buildAgentProfile } from './agent-profiles.js';
import {
  extractAgentProfileHandles,
  resolveAgentProfileInvocation,
} from './agent-profile-router.js';

describe('agent profile direct invocation router', () => {
  const repoFixer = buildAgentProfile({
    handle: 'RepoFixer',
    displayName: 'Repo Fixer',
    personality: 'Fix repository issues precisely.',
    provider: 'codex',
    model: 'gpt-5-codex',
    allowedMcpServers: ['github'],
  });

  it('extracts one @handle mention from message text', () => {
    expect(extractAgentProfileHandles('Please ask @RepoFixer to look')).toEqual(
      ['repofixer'],
    );
  });

  it('resolves enabled profile by normalized handle', () => {
    expect(
      resolveAgentProfileInvocation({
        text: '@RepoFixer fix issue 12',
        profiles: [repoFixer],
      }),
    ).toMatchObject({
      profileId: repoFixer.id,
      handle: 'repofixer',
      taskText: 'fix issue 12',
    });
  });

  it('rejects disabled profiles with a visible reason', () => {
    const disabled = buildAgentProfile({
      handle: 'Manual_Host',
      displayName: 'Manual Host',
      enabled: false,
    });

    expect(() =>
      resolveAgentProfileInvocation({
        text: '@manual_host check this',
        profiles: [disabled],
      }),
    ).toThrow('Agent profile @manual_host is disabled');
  });

  it('returns no invocation when no handle is present', () => {
    expect(
      resolveAgentProfileInvocation({
        text: 'Please fix issue 12',
        profiles: [repoFixer],
      }),
    ).toBeNull();
  });

  it('strips the addressed handle from the task text', () => {
    expect(
      resolveAgentProfileInvocation({
        text: 'Could @repo-fixer fix issue 12 with @ManualHost?',
        profiles: [
          {
            ...repoFixer,
            handle: 'repo-fixer',
          },
        ],
      }),
    ).toMatchObject({
      handle: 'repo-fixer',
      taskText: 'Could fix issue 12 with @ManualHost?',
    });
  });

  it('throws a visible error for unknown handles', () => {
    expect(() =>
      resolveAgentProfileInvocation({
        text: '@UnknownAgent fix issue 12',
        profiles: [repoFixer],
      }),
    ).toThrow('No enabled agent profile matched @unknownagent');
  });
});
