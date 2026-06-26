import { describe, expect, it } from 'vitest';

import { buildAllowedTools } from './index.js';

describe('agent-runner connector tool boundaries', () => {
  it('uses host-provided MCP tool patterns instead of connector wildcards', () => {
    const tools = buildAllowedTools({
      prompt: 'check issue status',
      groupFolder: 'main',
      chatJid: 'wa:main',
      isMain: true,
      allowedMcpServers: ['github'],
      allowedMcpToolPatterns: ['mcp__github__get_*', 'mcp__github__list_*'],
    });

    expect(tools).toContain('mcp__nanocrab__*');
    expect(tools).toContain('mcp__github__get_*');
    expect(tools).toContain('mcp__github__list_*');
    expect(tools).not.toContain('mcp__github__*');
    expect(tools).not.toContain('mcp__github__create_*');
  });

  it('does not expose approval-required connector tools when none are allowed', () => {
    const tools = buildAllowedTools({
      prompt: 'create an issue',
      groupFolder: 'main',
      chatJid: 'wa:main',
      isMain: true,
      allowedMcpServers: ['github'],
      allowedMcpToolPatterns: [],
    });

    expect(tools).toContain('mcp__nanocrab__*');
    expect(tools).not.toContain('mcp__github__*');
  });

  it('canonicalizes allowed MCP server names before exposing wildcard tools', () => {
    const tools = buildAllowedTools({
      prompt: 'check issue status',
      groupFolder: 'main',
      chatJid: 'wa:main',
      isMain: false,
      allowedMcpServers: ['GitHub'],
    });

    expect(tools).toContain('mcp__github__*');
  });
});
