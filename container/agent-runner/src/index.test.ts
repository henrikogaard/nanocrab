import fs from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildAllowedTools,
  buildMcpServers,
  isOpenAiCompatibleAgentProvider,
  openAiCompatibleBaseUrl,
} from './index.js';

describe('agent-runner connector tool boundaries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('proxies scoped MCP servers so runtime policy is enforced server-side', () => {
    const servers = buildMcpServers(
      {
        prompt: 'check issue status',
        groupFolder: 'main',
        chatJid: 'wa:main',
        isMain: true,
        allowedMcpServers: ['github'],
        allowedMcpToolPatterns: ['mcp__github__get_*', 'mcp__github__list_*'],
      },
      '/tmp/dist/ipc-mcp-stdio.js',
      { requireWildcardToolAccess: true },
    );

    expect(servers.github.command).toBe('node');
    expect(servers.github.args).toEqual(['/tmp/dist/mcp-tool-proxy.js']);
    expect(servers.github.env.NANOCRAB_MCP_TARGET_COMMAND).toBe('npx');
    expect(
      JSON.parse(servers.github.env.NANOCRAB_MCP_ALLOWED_TOOL_PATTERNS),
    ).toEqual(['mcp__github__get_*', 'mcp__github__list_*']);
  });

  it('keeps wildcard MCP servers direct when policy grants all tools', () => {
    const servers = buildMcpServers(
      {
        prompt: 'check issue status',
        groupFolder: 'main',
        chatJid: 'wa:main',
        isMain: true,
        allowedMcpServers: ['github'],
        allowedMcpToolPatterns: ['mcp__github__*'],
      },
      '/tmp/dist/ipc-mcp-stdio.js',
      { requireWildcardToolAccess: true },
    );

    expect(servers.github.command).toBe('npx');
    expect(servers.github.args).toEqual(['-y', '@iflow-mcp/server-github']);
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

  it('prefers live project MCP config over copied runtime snapshots', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((target) => {
      const value = String(target);
      return (
        value === '/workspace/mcp-config/mcp-servers.json' ||
        value === '/workspace/project/store/mcp-servers.json'
      );
    });
    vi.spyOn(fs, 'readFileSync').mockImplementation((target) => {
      const value = String(target);
      if (value === '/workspace/mcp-config/mcp-servers.json') {
        return JSON.stringify([
          {
            name: 'infomaniak',
            command: 'npx',
            args: ['-y', '@old/infomaniak-mcp'],
          },
        ]);
      }
      if (value === '/workspace/project/store/mcp-servers.json') {
        return JSON.stringify([
          {
            name: 'infomaniak',
            command: 'npx',
            args: ['-y', '@new/infomaniak-mcp'],
          },
        ]);
      }
      return '';
    });

    const servers = buildMcpServers(
      {
        prompt: 'check inbox',
        groupFolder: 'main',
        chatJid: 'wa:main',
        isMain: true,
        allowedMcpServers: ['infomaniak'],
      },
      '/tmp/dist/ipc-mcp-stdio.js',
    );

    expect(servers.infomaniak.args).toEqual(['-y', '@new/infomaniak-mcp']);
  });
});

describe('agent-runner OpenAI-compatible dispatch', () => {
  afterEach(() => {
    delete process.env.AGENT_PROVIDER_BASE_URL;
    delete process.env.DEFAULT_OPENAI_COMPATIBLE_BASE_URL;
    delete process.env.OPENAI_COMPATIBLE_BASE_URL;
  });

  it('recognizes the custom OpenAI-compatible provider without defaulting to Google', () => {
    expect(isOpenAiCompatibleAgentProvider('openai-compatible')).toBe(true);
    expect(isOpenAiCompatibleAgentProvider('google')).toBe(true);

    expect(openAiCompatibleBaseUrl('openai-compatible')).toBe('');
    process.env.AGENT_PROVIDER_BASE_URL = 'https://custom.example/v1/';
    expect(openAiCompatibleBaseUrl('openai-compatible')).toBe(
      'https://custom.example/v1',
    );
  });
});
