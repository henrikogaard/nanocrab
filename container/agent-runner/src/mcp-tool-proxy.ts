/**
 * Policy-filtering stdio MCP proxy.
 *
 * Codex/OpenCode can require a full MCP server to be configured even when
 * NanoCrab only wants to expose a subset of tools. This proxy starts the real
 * server, filters tools/list to allowed wildcard patterns, and rejects any
 * tools/call outside those patterns.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

function log(message: string): void {
  console.error(`[mcp-tool-proxy] ${message}`);
}

function parseJsonArray(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function normalizeConnectorId(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function connectorNameFromToolPattern(pattern: string): string | null {
  const match = pattern.match(/^mcp__([^_]+)__/);
  return match ? match[1] : null;
}

function toolPatternFor(connectorId: string, toolName: string): string {
  return `mcp__${connectorId}__${toolName}`;
}

async function main(): Promise<void> {
  const targetName = normalizeConnectorId(process.env.NANOCRAB_MCP_TARGET_NAME);
  const targetCommand = process.env.NANOCRAB_MCP_TARGET_COMMAND;
  const targetArgs = parseJsonArray('NANOCRAB_MCP_TARGET_ARGS');
  const targetEnvKeys = parseJsonArray('NANOCRAB_MCP_TARGET_ENV_KEYS');
  const allowedPatterns = parseJsonArray(
    'NANOCRAB_MCP_ALLOWED_TOOL_PATTERNS',
  ).filter(
    (pattern) =>
      normalizeConnectorId(connectorNameFromToolPattern(pattern)) ===
      targetName,
  );

  if (!targetName || !targetCommand) {
    throw new Error('Missing target MCP server configuration');
  }

  const allowedRegexps = allowedPatterns.map(globToRegExp);
  const isToolAllowed = (toolName: string): boolean =>
    allowedRegexps.some((pattern) =>
      pattern.test(toolPatternFor(targetName, toolName)),
    );

  const targetEnv: Record<string, string> = {};
  for (const key of targetEnvKeys) {
    const value = process.env[key];
    if (value !== undefined) targetEnv[key] = value;
  }

  const client = new Client(
    { name: `nanocrab-${targetName}-policy-client`, version: '1.0.0' },
    { capabilities: {} },
  );
  const targetTransport = new StdioClientTransport({
    command: targetCommand,
    args: targetArgs,
    env: targetEnv,
    cwd: '/workspace/group',
    stderr: 'pipe',
  });
  targetTransport.stderr?.on('data', (chunk) => {
    log(`${targetName} stderr: ${String(chunk).trimEnd()}`);
  });
  await client.connect(targetTransport);

  const server = new Server(
    { name: `nanocrab-${targetName}-policy-proxy`, version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const result = await client.listTools(request.params);
    return {
      ...result,
      tools: result.tools.filter((tool) => isToolAllowed(tool.name)),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    if (!isToolAllowed(toolName)) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Tool "${toolName}" is not allowed by NanoCrab connector policy.`,
          },
        ],
        isError: true,
      };
    }
    return client.callTool(request.params, CallToolResultSchema);
  });

  const proxyTransport = new StdioServerTransport();
  const close = async () => {
    await Promise.allSettled([client.close(), server.close()]);
  };
  process.once('SIGINT', () => void close().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void close().finally(() => process.exit(0)));
  await server.connect(proxyTransport);
}

main().catch((err) => {
  log(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
