import fs from 'fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanocrab-terminal-transcripts-test';

vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/nanocrab-terminal-transcripts-test/data',
}));

import {
  appendTerminalTranscript,
  listTerminalTranscriptSummaries,
  redactTerminalTranscript,
  searchTerminalTranscripts,
} from './terminal-transcripts.js';

describe('terminal transcripts', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('persists terminal ownership and searches transcript output', () => {
    appendTerminalTranscript({
      sessionId: 'term-main',
      owner: 'henrik',
      type: 'spawn',
      data: 'spawned',
      timestamp: '2026-06-10T00:00:00.000Z',
    });
    appendTerminalTranscript({
      sessionId: 'term-main',
      owner: 'henrik',
      type: 'output',
      data: 'npm test passed',
      timestamp: '2026-06-10T00:01:00.000Z',
    });

    expect(listTerminalTranscriptSummaries()).toEqual([
      expect.objectContaining({
        sessionId: 'term-main',
        owner: 'henrik',
        eventCount: 2,
      }),
    ]);
    expect(searchTerminalTranscripts({ query: 'passed' })).toEqual([
      expect.objectContaining({
        sessionId: 'term-main',
        owner: 'henrik',
        type: 'output',
      }),
    ]);
  });

  it('rejects empty transcript searches', () => {
    expect(() => searchTerminalTranscripts({ query: '  ' })).toThrow(
      'terminal transcript query is required',
    );
  });

  it('redacts credential material from transcript data', () => {
    expect(
      redactTerminalTranscript('Authorization: Bearer sk-live-abc123'),
    ).toBe('Authorization: Bearer ***');
    expect(redactTerminalTranscript('export API_KEY=super-secret-value')).not.toContain(
      'super-secret-value',
    );
    expect(
      redactTerminalTranscript('{"password": "hunter2", "user": "henrik"}'),
    ).not.toContain('hunter2');
    expect(redactTerminalTranscript('plain build output')).toBe(
      'plain build output',
    );
  });

  it('persists redacted data when appending transcripts', () => {
    appendTerminalTranscript({
      sessionId: 'term-secret',
      owner: 'henrik',
      type: 'output',
      data: 'token=abc123def deploy done',
      timestamp: '2026-06-10T00:00:00.000Z',
    });
    const matches = searchTerminalTranscripts({ query: 'deploy' });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.snippet).not.toContain('abc123def');
  });
});
