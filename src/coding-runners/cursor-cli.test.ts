import { describe, expect, it } from 'vitest';

import {
  buildCursorCliInvocation,
  buildCursorChildEnvironment,
  buildCursorSandboxedLaunch,
  validateCursorWorkspace,
} from './cursor-cli.js';

describe('Cursor CLI adapter', () => {
  it('builds a non-interactive model-selected invocation without a shell', () => {
    expect(
      buildCursorCliInvocation({
        executable: '/opt/cursor/bin/agent',
        model: 'gpt-5',
        prompt: 'Fix the failing test',
      }),
    ).toEqual({
      executable: '/opt/cursor/bin/agent',
      args: [
        '--print',
        '--output-format',
        'text',
        '--model',
        'gpt-5',
        '--force',
        'Fix the failing test',
      ],
    });
  });

  it('rejects an unsafe workspace before launch', () => {
    expect(() => validateCursorWorkspace('/')).toThrow(/workspace/i);
    expect(() =>
      buildCursorCliInvocation({
        executable: '/opt/cursor/bin/agent',
        model: 'gpt-5',
        prompt: 'Fix it',
        workspace: '/tmp/../etc',
      }),
    ).toThrow(/workspace/i);
  });

  it('passes only a minimal environment and requires an API key handoff', () => {
    expect(
      buildCursorChildEnvironment({
        HOME: '/Users/service',
        PATH: '/tmp/attacker',
        CURSOR_API_KEY: 'cursor-secret',
        GITHUB_TOKEN: 'must-not-pass',
        ANTHROPIC_API_KEY: 'must-not-pass',
      }),
    ).toEqual({
      HOME: '/Users/service',
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
      CURSOR_API_KEY: 'cursor-secret',
      TERM: 'dumb',
      NO_COLOR: '1',
    });
    expect(() => buildCursorChildEnvironment({})).toThrow(/CURSOR_API_KEY/i);
  });

  it('builds a deny-by-default macOS launch that only permits workspace writes', () => {
    const launch = buildCursorSandboxedLaunch({
      platform: 'darwin',
      sandboxExecutable: '/usr/bin/sandbox-exec',
      workspace: '/jobs/abc/repo',
      executable: '/usr/local/bin/agent',
      args: ['--print', 'Fix it'],
      temporaryDirectory: '/tmp',
    });
    expect(launch.executable).toBe('/usr/bin/sandbox-exec');
    expect(launch.args).toContain('--');
    expect(launch.args.join(' ')).toContain('deny default');
    expect(launch.args.join(' ')).toContain('/jobs/abc/repo/.git');
  });
});
