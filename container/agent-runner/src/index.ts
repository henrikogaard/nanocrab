/**
 * NanoCrab Agent Runner
 * Runs inside a container, receives config via stdin, outputs result to stdout
 *
 * Input protocol:
 *   Stdin: Full ContainerInput JSON (read until EOF, like before)
 *   IPC:   Follow-up messages written as JSON files to /workspace/ipc/input/
 *          Files: {type:"message", text:"..."}.json — polled and consumed
 *          Sentinel: /workspace/ipc/input/_close — signals session end
 *
 * Stdout protocol:
 *   Each result is wrapped in OUTPUT_START_MARKER / OUTPUT_END_MARKER pairs.
 *   Multiple results may be emitted (one per agent teams result).
 *   Final marker after loop ends signals completion.
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import {
  query,
  HookCallback,
  PreCompactHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { fileURLToPath } from 'url';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  script?: string;
  allowedMcpServers?: string[];
  allowedMcpToolPatterns?: string[];
  restrictions?: string;
  provider?:
    | 'claude'
    | 'codex'
    | 'opencode'
    | 'ollama'
    | 'openrouter'
    | 'google'
    | 'airouter'
    | 'openai-compatible';
  model?: string;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  summary: string;
  firstPrompt: string;
}

interface SessionsIndex {
  entries: SessionEntry[];
}

interface SDKUserMessage {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

const IPC_INPUT_DIR = '/workspace/ipc/input';
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_POLL_MS = 500;
const OPENAI_COMPATIBLE_PROVIDERS = new Set([
  'ollama',
  'openrouter',
  'google',
  'airouter',
  'openai-compatible',
]);

/**
 * Push-based async iterable for streaming user messages to the SDK.
 * Keeps the iterable alive until end() is called, preventing isSingleUserTurn.
 */
class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private done = false;

  push(text: string): void {
    this.queue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    });
    this.waiting?.();
  }

  end(): void {
    this.done = true;
    this.waiting?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.done) return;
      await new Promise<void>((r) => {
        this.waiting = r;
      });
      this.waiting = null;
    }
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const OUTPUT_START_MARKER = '---NANOCRAB_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCRAB_OUTPUT_END---';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

interface SkillRegistryEntry {
  name: string;
  description: string;
  path: string;
  triggers?: string[];
  examples?: string[];
  riskLevel?: string;
  requiredTools?: string[];
}

function readActiveSkillRegistry(skillsDir: string): SkillRegistryEntry[] {
  const registryPath = path.join(skillsDir, 'registry.json');
  if (fs.existsSync(registryPath)) {
    try {
      return JSON.parse(
        fs.readFileSync(registryPath, 'utf-8'),
      ) as SkillRegistryEntry[];
    } catch (err) {
      log(
        `Skill registry parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const entries: SkillRegistryEntry[] = [];
  for (const dirName of fs.readdirSync(skillsDir)) {
    const skillDir = path.join(skillsDir, dirName);
    if (!fs.statSync(skillDir).isDirectory()) continue;

    const skillMd = path.join(skillDir, 'SKILL.md');
    let name = dirName;
    let description = '';
    if (fs.existsSync(skillMd)) {
      const content = fs.readFileSync(skillMd, 'utf-8');
      const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const fm = fmMatch[1];
        const nameMatch = fm.match(/^name:\s*(.+)$/m);
        const descMatch = fm.match(/^description:\s*(.+)$/m);
        if (nameMatch) name = nameMatch[1].trim();
        if (descMatch) description = descMatch[1].trim();
      }
    }
    entries.push({ name, description, path: dirName });
  }
  return entries;
}

function scoreSkill(skill: SkillRegistryEntry, request: string): number {
  const text = request.toLowerCase();
  const terms = new Set(
    text
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
  let score = 0;
  for (const trigger of skill.triggers || []) {
    const normalized = trigger.toLowerCase();
    if (text.includes(normalized) || terms.has(normalized)) score += 6;
  }
  const haystack = `${skill.name} ${skill.description}`.toLowerCase();
  for (const term of terms) {
    if (haystack.includes(term)) score += 2;
  }
  if (text.includes(skill.name.toLowerCase())) score += 20;
  return score;
}

function readProviderNeutralSkillsContext(request = ''): string | undefined {
  const skillsDir = '/workspace/skills';
  if (!fs.existsSync(skillsDir)) return undefined;

  const registry = readActiveSkillRegistry(skillsDir);
  const ranked = registry
    .map((skill) => ({ ...skill, score: scoreSkill(skill, request) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const likely = ranked.filter((skill) => skill.score > 0).slice(0, 8);
  const fallback = ranked
    .filter(
      (skill) =>
        skill.riskLevel !== 'high' &&
        (!skill.requiredTools || skill.requiredTools.length === 0),
    )
    .slice(0, 12);
  const selected = likely.length ? likely : fallback;
  const entries = selected.map((skill) => {
    const label =
      skill.name === skill.path ? skill.path : `${skill.path} (${skill.name})`;
    const risk = skill.riskLevel ? ` risk:${skill.riskLevel}` : '';
    const tools = skill.requiredTools?.length
      ? ` tools:${skill.requiredTools.join(',')}`
      : '';
    return skill.description
      ? `- ${label}:${risk}${tools} ${skill.description}`
      : `- ${label}:${risk}${tools}`;
  });

  if (entries.length === 0) return undefined;

  return [
    'Provider-neutral agent skills are available at /workspace/skills.',
    'The entries below are the currently active/relevant skill registry slice for this request.',
    "When a user request matches a listed skill, read that skill's SKILL.md before acting.",
    'If the user asks what skills exist or which skills relate to a request, use mcp__nanocrab__list_skills or mcp__nanocrab__search_skills when available.',
    'Skill growth policy: when the user repeats a workflow, gives durable operating instructions, or asks for a reusable way of doing something, briefly ask whether NanoCrab should make a skill from it. If the user agrees, use mcp__nanocrab__propose_skill_draft with a complete provider-neutral SKILL.md. Drafts require owner approval before installation.',
    entries.join('\n'),
  ].join('\n');
}

function readDashboardWorkspaceContext(): string {
  return [
    'NanoCrab dashboard workspace map:',
    '- Copilot: plain AI chat and quick thinking. Use it when the user just wants a conversation and no durable project or repository state is needed.',
    '- Cowork: project workspaces, files, artifacts, documents, project chats, history, scheduled work, and approved MCP source tools. When a channel user says "check Cowork", "project", "artifact", "document", or asks to update/send a project file, use the Cowork project MCP tools.',
    '- Code: repositories, GitHub Copilot, coding agents, tests, pull requests, snippets, review rules, terminal, and repository automation.',
    '- More/Settings: integrations, credentials, providers, channels, approvals, memory, skills, marketplace, logs, backups, monitoring, and platform setup.',
    'Memory is personal/shared knowledge across agents. Skills are reusable agent capabilities and workflows. Keep Cowork project facts in the project workspace unless the user explicitly asks for cross-agent memory.',
    'Channel messages are durable history in NanoCrab. When the user asks about earlier conversations, a specific past time, or details from days/weeks ago, use mcp__nanocrab__search_message_history instead of relying on the current prompt window.',
  ].join('\n');
}

function readRuntimeRestrictionsContext(
  restrictions?: string,
): string | undefined {
  const trimmed = restrictions?.trim();
  if (!trimmed) return undefined;
  return ['Runtime dashboard instructions and restrictions:', trimmed].join(
    '\n',
  );
}

function joinSystemContext(
  parts: Array<string | undefined>,
): string | undefined {
  const context = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('\n\n');

  return context || undefined;
}

function readAgentInstructionsFromDir(dir: string): string | undefined {
  const agentsPath = path.join(dir, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    return fs.readFileSync(agentsPath, 'utf-8');
  }

  const legacyPath = path.join(dir, 'CLAUDE.md');
  if (fs.existsSync(legacyPath)) {
    return fs.readFileSync(legacyPath, 'utf-8');
  }

  return undefined;
}

function discoverExtraDirs(): string[] {
  const extraDirs: string[] = [];
  const extraBase = '/workspace/extra';
  if (fs.existsSync(extraBase)) {
    for (const entry of fs.readdirSync(extraBase)) {
      const fullPath = path.join(extraBase, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        extraDirs.push(fullPath);
      }
    }
  }
  return extraDirs;
}

function buildSharedSystemContext(
  extraDirs: string[] | undefined = discoverExtraDirs(),
  request = '',
  restrictions?: string,
): string {
  const resolvedExtraDirs = extraDirs || discoverExtraDirs();
  return (
    joinSystemContext([
      readAgentInstructionsFromDir('/workspace/group'),
      readAgentInstructionsFromDir('/workspace/global'),
      ...resolvedExtraDirs.map(readAgentInstructionsFromDir),
      readDashboardWorkspaceContext(),
      readRuntimeRestrictionsContext(restrictions),
      readProviderNeutralSkillsContext(request),
    ]) || ''
  );
}

function getSessionSummary(
  sessionId: string,
  transcriptPath: string,
): string | null {
  const projectDir = path.dirname(transcriptPath);
  const indexPath = path.join(projectDir, 'sessions-index.json');

  if (!fs.existsSync(indexPath)) {
    log(`Sessions index not found at ${indexPath}`);
    return null;
  }

  try {
    const index: SessionsIndex = JSON.parse(
      fs.readFileSync(indexPath, 'utf-8'),
    );
    const entry = index.entries.find((e) => e.sessionId === sessionId);
    if (entry?.summary) {
      return entry.summary;
    }
  } catch (err) {
    log(
      `Failed to read sessions index: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return null;
}

/**
 * Archive the full transcript to conversations/ before compaction.
 */
function createPreCompactHook(assistantName?: string): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preCompact = input as PreCompactHookInput;
    const transcriptPath = preCompact.transcript_path;
    const sessionId = preCompact.session_id;

    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      log('No transcript found for archiving');
      return {};
    }

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const messages = parseTranscript(content);

      if (messages.length === 0) {
        log('No messages to archive');
        return {};
      }

      const summary = getSessionSummary(sessionId, transcriptPath);
      const name = summary ? sanitizeFilename(summary) : generateFallbackName();

      const conversationsDir = '/workspace/group/conversations';
      fs.mkdirSync(conversationsDir, { recursive: true });

      const date = new Date().toISOString().split('T')[0];
      const filename = `${date}-${name}.md`;
      const filePath = path.join(conversationsDir, filename);

      const markdown = formatTranscriptMarkdown(
        messages,
        summary,
        assistantName,
      );
      fs.writeFileSync(filePath, markdown);

      log(`Archived conversation to ${filePath}`);
    } catch (err) {
      log(
        `Failed to archive transcript: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {};
  };
}

function sanitizeFilename(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function generateFallbackName(): string {
  const time = new Date();
  return `conversation-${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
}

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

function parseTranscript(content: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' && entry.message?.content) {
        const text =
          typeof entry.message.content === 'string'
            ? entry.message.content
            : entry.message.content
                .map((c: { text?: string }) => c.text || '')
                .join('');
        if (text) messages.push({ role: 'user', content: text });
      } else if (entry.type === 'assistant' && entry.message?.content) {
        const textParts = entry.message.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text);
        const text = textParts.join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    } catch {}
  }

  return messages;
}

function formatTranscriptMarkdown(
  messages: ParsedMessage[],
  title?: string | null,
  assistantName?: string,
): string {
  const now = new Date();
  const formatDateTime = (d: Date) =>
    d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

  const lines: string[] = [];
  lines.push(`# ${title || 'Conversation'}`);
  lines.push('');
  lines.push(`Archived: ${formatDateTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : assistantName || 'Assistant';
    const content =
      msg.content.length > 2000
        ? msg.content.slice(0, 2000) + '...'
        : msg.content;
    lines.push(`**${sender}**: ${content}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Check for _close sentinel.
 */
function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try {
      fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL);
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
}

/**
 * Drain all pending IPC input messages.
 * Returns messages found, or empty array.
 */
function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs
      .readdirSync(IPC_INPUT_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();

    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch (err) {
        log(
          `Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`,
        );
        try {
          fs.unlinkSync(filePath);
        } catch {
          /* ignore */
        }
      }
    }
    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Wait for a new IPC message or _close sentinel.
 * Returns the messages as a single string, or null if _close.
 */
function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) {
        resolve(null);
        return;
      }
      const messages = drainIpcInput();
      if (messages.length > 0) {
        resolve(messages.join('\n'));
        return;
      }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

/**
 * Build the MCP servers config, filtering by allowedMcpServers.
 * The nanocrab server is always included (core IPC).
 * Main groups always get all servers.
 */
function connectorNameFromToolPattern(pattern: string): string | null {
  const match = pattern.match(/^mcp__([^_]+)__/);
  return match ? match[1] : null;
}

function normalizeConnectorId(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function explicitMcpToolPatterns(
  containerInput: ContainerInput,
): string[] | null {
  if (!Array.isArray(containerInput.allowedMcpToolPatterns)) return null;
  return Array.from(
    new Set(
      containerInput.allowedMcpToolPatterns.filter((pattern) =>
        /^mcp__[A-Za-z0-9-]+__/.test(pattern),
      ),
    ),
  );
}

interface CustomMcpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  envVars?: string[];
}

type McpServerDefinition = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

function readCustomMcpServers(): CustomMcpServerConfig[] {
  const customPaths = [
    '/workspace/project/store/mcp-servers.json',
    '/workspace/mcp-config/mcp-servers.json',
  ];
  for (const customPath of customPaths) {
    try {
      if (!fs.existsSync(customPath)) continue;
      const parsed = JSON.parse(
        fs.readFileSync(customPath, 'utf-8'),
      ) as unknown;
      return Array.isArray(parsed) ? (parsed as CustomMcpServerConfig[]) : [];
    } catch (err) {
      log(
        `Custom MCP server config load failed from ${customPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }
  return [];
}

function mcpToolPatternsForServer(
  serverName: string,
  patterns: string[] | null,
): string[] {
  if (!patterns) return [];
  return patterns.filter(
    (pattern) =>
      normalizeConnectorId(connectorNameFromToolPattern(pattern)) ===
      normalizeConnectorId(serverName),
  );
}

function hasMcpServerWildcard(serverName: string, patterns: string[]): boolean {
  return patterns.includes(`mcp__${normalizeConnectorId(serverName)}__*`);
}

function isMcpServerAllowedByToolPatterns(
  serverName: string,
  patterns: string[] | null,
  requireWildcardToolAccess: boolean,
): boolean {
  if (!patterns) return true;
  const serverPatterns = mcpToolPatternsForServer(serverName, patterns);
  if (serverPatterns.length === 0) return false;
  if (!requireWildcardToolAccess) return true;
  return true;
}

function maybeProxyMcpServer(
  serverName: string,
  server: McpServerDefinition,
  serverPatterns: string[],
  mcpServerPath: string,
): McpServerDefinition {
  if (
    serverName === 'nanocrab' ||
    serverPatterns.length === 0 ||
    hasMcpServerWildcard(serverName, serverPatterns)
  ) {
    return server;
  }

  return {
    command: 'node',
    args: [path.join(path.dirname(mcpServerPath), 'mcp-tool-proxy.js')],
    env: {
      ...server.env,
      NANOCRAB_MCP_TARGET_NAME: normalizeConnectorId(serverName),
      NANOCRAB_MCP_TARGET_COMMAND: server.command,
      NANOCRAB_MCP_TARGET_ARGS: JSON.stringify(server.args),
      NANOCRAB_MCP_TARGET_ENV_KEYS: JSON.stringify(Object.keys(server.env)),
      NANOCRAB_MCP_ALLOWED_TOOL_PATTERNS: JSON.stringify(serverPatterns),
    },
  };
}

export function buildMcpServers(
  containerInput: ContainerInput,
  mcpServerPath: string,
  options: { requireWildcardToolAccess?: boolean } = {},
): Record<string, McpServerDefinition> {
  const allServers: Record<string, McpServerDefinition> = {
    nanocrab: {
      command: 'node',
      args: [mcpServerPath],
      env: {
        NANOCRAB_CHAT_JID: containerInput.chatJid,
        NANOCRAB_GROUP_FOLDER: containerInput.groupFolder,
        NANOCRAB_IS_MAIN: containerInput.isMain ? '1' : '0',
      },
    },
    github: {
      command: 'npx',
      args: ['-y', '@iflow-mcp/server-github'],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN || '' },
    },
  };

  // Load custom MCP servers from store config (managed via dashboard)
  for (const srv of readCustomMcpServers()) {
    const serverName = normalizeConnectorId(srv.name);
    if (serverName && srv.command && !allServers[serverName]) {
      const env: Record<string, string> = {};
      for (const key of srv.envVars || []) {
        if (process.env[key]) env[key] = process.env[key]!;
      }
      allServers[serverName] = {
        command: srv.command,
        args: srv.args || [],
        env,
      };
    }
  }

  const toolPatterns = explicitMcpToolPatterns(containerInput);
  const requireWildcardToolAccess = options.requireWildcardToolAccess === true;

  // Main gets everything only when the host has not provided an explicit
  // connector tool allowlist. Once present, the allowlist is authoritative.
  if (containerInput.isMain && !toolPatterns) return allServers;

  // No restriction defined = all servers (backward compatible)
  const allowed = containerInput.allowedMcpServers;
  if (allowed === undefined && !toolPatterns) return allServers;

  // Filter: nanocrab is always included, others must be in allowlist
  const filtered: typeof allServers = { nanocrab: allServers.nanocrab };
  const allowedNames = new Set([
    ...(allowed || []).map((name) => normalizeConnectorId(name)),
    ...(toolPatterns || [])
      .map((pattern) => connectorNameFromToolPattern(pattern))
      .map((name) => normalizeConnectorId(name))
      .filter((name): name is string => Boolean(name)),
  ]);
  for (const name of allowedNames) {
    if (name !== 'nanocrab' && allServers[name]) {
      const serverPatterns = mcpToolPatternsForServer(name, toolPatterns);
      if (
        !isMcpServerAllowedByToolPatterns(
          name,
          toolPatterns,
          requireWildcardToolAccess,
        )
      ) {
        continue;
      }
      filtered[name] = maybeProxyMcpServer(
        name,
        allServers[name],
        serverPatterns,
        mcpServerPath,
      );
    }
  }
  return filtered;
}

/**
 * Build allowedTools list, including MCP tool wildcards only for allowed servers.
 */
export function buildAllowedTools(containerInput: ContainerInput): string[] {
  const baseTools = [
    'Bash',
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    'WebSearch',
    'WebFetch',
    'Task',
    'TaskOutput',
    'TaskStop',
    'TeamCreate',
    'TeamDelete',
    'SendMessage',
    'TodoWrite',
    'ToolSearch',
    'Skill',
    'NotebookEdit',
    'mcp__nanocrab__*',
  ];
  const explicitTools = explicitMcpToolPatterns(containerInput);
  if (explicitTools) return [...baseTools, ...explicitTools];

  const allMcpTools = ['mcp__github__*'];

  // Add custom MCP tool wildcards
  for (const srv of readCustomMcpServers()) {
    const serverName = normalizeConnectorId(srv.name);
    if (serverName) allMcpTools.push(`mcp__${serverName}__*`);
  }

  // Main always gets everything
  if (containerInput.isMain) return [...baseTools, ...allMcpTools];

  // No restriction = all tools
  const allowed = containerInput.allowedMcpServers;
  if (allowed === undefined) return [...baseTools, ...allMcpTools];

  // Add MCP tool wildcards only for allowed servers
  const tools = [...baseTools];
  for (const name of allowed) {
    const toolPattern = `mcp__${normalizeConnectorId(name)}__*`;
    if (allMcpTools.includes(toolPattern)) tools.push(toolPattern);
  }
  return tools;
}

/**
 * Run a single query and stream results via writeOutput.
 * Uses MessageStream (AsyncIterable) to keep isSingleUserTurn=false,
 * allowing agent teams subagents to run to completion.
 * Also pipes IPC messages into the stream during the query.
 */
async function runQuery(
  prompt: string,
  sessionId: string | undefined,
  mcpServerPath: string,
  containerInput: ContainerInput,
  sdkEnv: Record<string, string | undefined>,
  resumeAt?: string,
): Promise<{
  newSessionId?: string;
  lastAssistantUuid?: string;
  closedDuringQuery: boolean;
}> {
  const stream = new MessageStream();
  stream.push(prompt);

  // Poll IPC for follow-up messages and _close sentinel during the query
  let ipcPolling = true;
  let closedDuringQuery = false;
  const pollIpcDuringQuery = () => {
    if (!ipcPolling) return;
    if (shouldClose()) {
      log('Close sentinel detected during query, ending stream');
      closedDuringQuery = true;
      stream.end();
      ipcPolling = false;
      return;
    }
    const messages = drainIpcInput();
    for (const text of messages) {
      log(`Piping IPC message into active query (${text.length} chars)`);
      stream.push(text);
    }
    setTimeout(pollIpcDuringQuery, IPC_POLL_MS);
  };
  setTimeout(pollIpcDuringQuery, IPC_POLL_MS);

  let newSessionId: string | undefined;
  let lastAssistantUuid: string | undefined;
  let messageCount = 0;
  let resultCount = 0;

  // Discover additional directories mounted at /workspace/extra/*
  // These are passed to the SDK for legacy CLAUDE.md loading when applicable.
  const extraDirs = discoverExtraDirs();
  if (extraDirs.length > 0) {
    log(`Additional directories: ${extraDirs.join(', ')}`);
  }

  // Load shared system context for all groups. AGENTS.md is canonical;
  // CLAUDE.md is only a backward-compatible fallback.
  const sharedSystemContext = buildSharedSystemContext(
    extraDirs,
    containerInput.prompt,
    containerInput.restrictions,
  );

  for await (const message of query({
    prompt: stream,
    options: {
      model: containerInput.model || undefined,
      cwd: '/workspace/group',
      additionalDirectories: extraDirs.length > 0 ? extraDirs : undefined,
      resume: sessionId,
      resumeSessionAt: resumeAt,
      systemPrompt: sharedSystemContext
        ? {
            type: 'preset' as const,
            preset: 'claude_code' as const,
            append: sharedSystemContext,
          }
        : undefined,
      allowedTools: buildAllowedTools(containerInput),
      env: sdkEnv,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: ['project', 'user'],
      mcpServers: buildMcpServers(containerInput, mcpServerPath),
      hooks: {
        PreCompact: [
          { hooks: [createPreCompactHook(containerInput.assistantName)] },
        ],
      },
    },
  })) {
    messageCount++;
    const msgType =
      message.type === 'system'
        ? `system/${(message as { subtype?: string }).subtype}`
        : message.type;
    log(`[msg #${messageCount}] type=${msgType}`);

    if (message.type === 'assistant' && 'uuid' in message) {
      lastAssistantUuid = (message as { uuid: string }).uuid;
    }

    if (message.type === 'system' && message.subtype === 'init') {
      newSessionId = message.session_id;
      log(`Session initialized: ${newSessionId}`);
    }

    if (
      message.type === 'system' &&
      (message as { subtype?: string }).subtype === 'task_notification'
    ) {
      const tn = message as {
        task_id: string;
        status: string;
        summary: string;
      };
      log(
        `Task notification: task=${tn.task_id} status=${tn.status} summary=${tn.summary}`,
      );
    }

    if (message.type === 'result') {
      resultCount++;
      const textResult =
        'result' in message ? (message as { result?: string }).result : null;
      log(
        `Result #${resultCount}: subtype=${message.subtype}${textResult ? ` text=${textResult.slice(0, 200)}` : ''}`,
      );
      writeOutput({
        status: 'success',
        result: textResult || null,
        newSessionId,
      });
    }
  }

  ipcPolling = false;
  log(
    `Query done. Messages: ${messageCount}, results: ${resultCount}, lastAssistantUuid: ${lastAssistantUuid || 'none'}, closedDuringQuery: ${closedDuringQuery}`,
  );
  return { newSessionId, lastAssistantUuid, closedDuringQuery };
}

interface ScriptResult {
  wakeAgent: boolean;
  data?: unknown;
}

const SCRIPT_TIMEOUT_MS = 30_000;

async function runScript(script: string): Promise<ScriptResult | null> {
  const scriptPath = '/tmp/task-script.sh';
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  return new Promise((resolve) => {
    execFile(
      'bash',
      [scriptPath],
      {
        timeout: SCRIPT_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        env: process.env,
      },
      (error, stdout, stderr) => {
        if (stderr) {
          log(`Script stderr: ${stderr.slice(0, 500)}`);
        }

        if (error) {
          log(`Script error: ${error.message}`);
          return resolve(null);
        }

        // Parse last non-empty line of stdout as JSON
        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        if (!lastLine) {
          log('Script produced no output');
          return resolve(null);
        }

        try {
          const result = JSON.parse(lastLine);
          if (typeof result.wakeAgent !== 'boolean') {
            log(
              `Script output missing wakeAgent boolean: ${lastLine.slice(0, 200)}`,
            );
            return resolve(null);
          }
          resolve(result as ScriptResult);
        } catch {
          log(`Script output is not valid JSON: ${lastLine.slice(0, 200)}`);
          resolve(null);
        }
      },
    );
  });
}

/**
 * Run a query using Codex CLI instead of Claude Agent SDK.
 * Spawns `codex` with full capabilities: MCP servers, file access, bash.
 */
async function runQueryCodex(
  prompt: string,
  containerInput: ContainerInput,
  mcpServerPath: string,
): Promise<{ output: string }> {
  const model = containerInput.model || process.env.DEFAULT_MODEL || 'gpt-5.4';
  log(`Running Codex query (model: ${model})...`);

  // Build system prompt from instruction and skill files.
  // AGENTS.md is canonical; CLAUDE.md is only a backward-compatible fallback.
  const extraDirs = discoverExtraDirs();
  const systemPrompt = buildSharedSystemContext(
    extraDirs,
    prompt,
    containerInput.restrictions,
  );

  const tomlString = (value: string) => JSON.stringify(value);
  const tomlArray = (values: string[]) =>
    `[${values.map((value) => tomlString(value)).join(', ')}]`;
  const tomlInlineTable = (values: Record<string, string>) =>
    `{ ${Object.entries(values)
      .map(([key, value]) => `${key} = ${tomlString(value)}`)
      .join(', ')} }`;
  const mcpConfigArgs: string[] = [];
  const mcpServers = buildMcpServers(containerInput, mcpServerPath, {
    requireWildcardToolAccess: true,
  });
  log(
    `Codex MCP servers: ${Object.entries(mcpServers)
      .map(([name, server]) => `${name}(env:${Object.keys(server.env).length})`)
      .join(', ')}`,
  );
  for (const [name, server] of Object.entries(mcpServers)) {
    mcpConfigArgs.push(
      '-c',
      `mcp_servers.${name}.command=${tomlString(server.command)}`,
      '-c',
      `mcp_servers.${name}.args=${tomlArray(server.args)}`,
    );
    if (Object.keys(server.env).length > 0) {
      mcpConfigArgs.push(
        '-c',
        `mcp_servers.${name}.env=${tomlInlineTable(server.env)}`,
      );
    }
  }

  return new Promise((resolve) => {
    const effectivePrompt = systemPrompt.trim()
      ? `${systemPrompt.trim()}\n\nUser request:\n${prompt}`
      : prompt;
    const args = [
      '--ask-for-approval',
      'never',
      'exec',
      '--model',
      model,
      '--sandbox',
      'danger-full-access',
      '--cd',
      '/workspace/group',
      '--skip-git-repo-check',
      '--color',
      'never',
      ...extraDirs.flatMap((dir) => ['--add-dir', dir]),
      ...mcpConfigArgs,
    ];

    // Add the prompt
    args.push(effectivePrompt);

    log(
      `Codex args: ${args.slice(0, 4).join(' ')}... (prompt: ${prompt.slice(0, 100)})`,
    );

    const proc = execFile(
      'codex',
      args,
      {
        cwd: '/workspace/group',
        timeout: 600000, // 10 min
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, TERM: 'dumb' },
      },
      (error, stdout, stderr) => {
        const output = stdout?.trim() || stderr?.trim() || '';
        if (error && !output) {
          log(`Codex error: ${error.message}`);
          writeOutput({
            status: 'error',
            result: null,
            error: `Codex error: ${error.message}`,
          });
          resolve({ output: '' });
          return;
        }
        log(`Codex completed. Output length: ${output.length}`);
        writeOutput({ status: 'success', result: output || null });
        resolve({ output });
      },
    );
    proc.stdin?.end();
  });
}

export function isOpenAiCompatibleAgentProvider(provider: string): boolean {
  return OPENAI_COMPATIBLE_PROVIDERS.has(provider);
}

function providerEnvSlug(provider: string): string {
  return provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

export function openAiCompatibleBaseUrl(provider: string): string {
  const providerKey = providerEnvSlug(provider);
  const legacyProviderKey = provider.toUpperCase();
  const fallback =
    provider === 'ollama'
      ? 'http://127.0.0.1:11434/v1'
      : provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1'
        : provider === 'google'
          ? 'https://generativelanguage.googleapis.com/v1beta/openai'
          : provider === 'airouter'
            ? 'https://api.airouter.ch/v1'
            : '';
  return (
    process.env.AGENT_PROVIDER_BASE_URL ||
    process.env[`DEFAULT_${providerKey}_BASE_URL`] ||
    process.env[`DEFAULT_${legacyProviderKey}_BASE_URL`] ||
    process.env[`${providerKey}_BASE_URL`] ||
    process.env[`${legacyProviderKey}_BASE_URL`] ||
    fallback
  ).replace(/\/+$/, '');
}

function openAiCompatibleApiKey(provider: string): string | undefined {
  if (process.env.AGENT_PROVIDER_API_KEY) {
    return process.env.AGENT_PROVIDER_API_KEY;
  }
  if (provider === 'openrouter') return process.env.OPENROUTER_API_KEY;
  if (provider === 'google') {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  }
  if (provider === 'airouter') return process.env.AIROUTER_API_KEY;
  if (provider === 'openai-compatible') {
    return process.env.OPENAI_COMPATIBLE_API_KEY;
  }
  return process.env.OPENAI_API_KEY;
}

function chatContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text || '');
        }
        return '';
      })
      .join('');
  }
  return '';
}

async function runQueryOpenAiCompatible(
  prompt: string,
  containerInput: ContainerInput,
): Promise<{ output: string }> {
  const provider =
    process.env.AGENT_PROVIDER || containerInput.provider || 'ollama';
  const model =
    containerInput.model ||
    process.env.DEFAULT_MODEL ||
    process.env.MODEL ||
    'llama3';
  const baseUrl = openAiCompatibleBaseUrl(provider);
  const apiKey = openAiCompatibleApiKey(provider);

  if (!baseUrl) {
    throw new Error(
      `${provider} requires AGENT_PROVIDER_BASE_URL or its provider base URL environment variable`,
    );
  }

  if (provider !== 'ollama' && provider !== 'openai-compatible' && !apiKey) {
    throw new Error(
      `${provider} requires AGENT_PROVIDER_API_KEY or its provider API key environment variable`,
    );
  }

  const systemPrompt = buildSharedSystemContext(
    undefined,
    prompt,
    containerInput.restrictions,
  );
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (provider === 'openrouter') headers['X-Title'] = 'NanoCrab';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        ...(systemPrompt
          ? [{ role: 'system' as const, content: systemPrompt }]
          : []),
        { role: 'user' as const, content: prompt },
      ],
      temperature: 0.2,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `${provider} returned HTTP ${response.status}: ${responseText.slice(0, 800)}`,
    );
  }

  const json = JSON.parse(responseText) as {
    choices?: Array<{ message?: { content?: unknown }; text?: string }>;
  };
  const output =
    chatContentToText(json.choices?.[0]?.message?.content) ||
    json.choices?.[0]?.text ||
    '';
  writeOutput({ status: 'success', result: output || null });
  return { output };
}

function buildOpenCodeConfig(
  model: string,
  containerInput: ContainerInput,
  mcpServerPath: string,
): string {
  const mcpServers = buildMcpServers(containerInput, mcpServerPath, {
    requireWildcardToolAccess: true,
  });
  const mcp: Record<
    string,
    {
      type: 'local';
      command: string[];
      enabled: boolean;
      environment: Record<string, string>;
    }
  > = {};
  for (const [name, server] of Object.entries(mcpServers)) {
    mcp[name] = {
      type: 'local',
      command: [server.command, ...server.args],
      enabled: true,
      environment: server.env,
    };
  }

  const provider: Record<string, unknown> = {};
  if (process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_BASE_URL) {
    provider.openrouter = {
      options: {
        apiKey: '{env:OPENROUTER_API_KEY}',
        baseURL:
          process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      },
    };
  }
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_OPENAI_BASE_URL) {
    provider.google = {
      npm: '@ai-sdk/openai-compatible',
      name: 'Google Gemini',
      options: {
        apiKey: '{env:GEMINI_API_KEY}',
        baseURL:
          process.env.GOOGLE_OPENAI_BASE_URL ||
          'https://generativelanguage.googleapis.com/v1beta/openai/',
      },
      models: {
        'gemini-2.5-flash': { name: 'Gemini 2.5 Flash' },
        'gemini-2.5-pro': { name: 'Gemini 2.5 Pro' },
      },
    };
  }
  if (process.env.AIROUTER_API_KEY || process.env.AIROUTER_BASE_URL) {
    provider.airouter = {
      npm: '@ai-sdk/openai-compatible',
      name: 'AI Router Switzerland',
      options: {
        apiKey: '{env:AIROUTER_API_KEY}',
        baseURL: process.env.AIROUTER_BASE_URL || 'https://api.airouter.ch/v1',
      },
      models: {
        'Qwen3.6': { name: 'Qwen3.6' },
        'DeepSeek-V4-Flash': { name: 'DeepSeek-V4-Flash' },
        'deepseek-v4': { name: 'DeepSeek V4 alias' },
      },
    };
  }
  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST) {
    const baseURL =
      process.env.OLLAMA_BASE_URL ||
      `${(process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '')}/v1`;
    provider.ollama = {
      npm: '@ai-sdk/openai-compatible',
      name: 'Ollama',
      options: {
        apiKey: 'ollama',
        baseURL,
      },
      models: {
        llama3: { name: 'Llama 3' },
        'llama3.1': { name: 'Llama 3.1' },
        mistral: { name: 'Mistral' },
        codestral: { name: 'Codestral' },
        'gemma4:e2b': { name: 'Gemma 4 E2B' },
      },
    };
  }

  return JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    model,
    share: 'disabled',
    autoupdate: 'notify',
    permission: {
      bash: 'allow',
      edit: 'allow',
      read: 'allow',
      grep: 'allow',
      glob: 'allow',
      webfetch: 'allow',
      websearch: 'allow',
      task: 'allow',
      todowrite: 'allow',
    },
    provider,
    mcp,
  });
}

async function runQueryOpenCode(
  prompt: string,
  containerInput: ContainerInput,
  mcpServerPath: string,
): Promise<{ output: string }> {
  const model =
    containerInput.model ||
    process.env.DEFAULT_MODEL ||
    'opencode/grok-code-fast-1';
  const systemPrompt = buildSharedSystemContext(
    undefined,
    containerInput.prompt,
    containerInput.restrictions,
  );
  const effectivePrompt = systemPrompt.trim()
    ? `${systemPrompt.trim()}\n\nUser request:\n${prompt}`
    : prompt;
  const configContent = buildOpenCodeConfig(
    model,
    containerInput,
    mcpServerPath,
  );

  return new Promise((resolve) => {
    const args = ['run', '--model', model, effectivePrompt];
    log(`OpenCode args: ${args.slice(0, 3).join(' ')}...`);
    const proc = execFile(
      'opencode',
      args,
      {
        cwd: '/workspace/group',
        timeout: 600000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          OPENCODE_CONFIG_CONTENT: configContent,
          TERM: 'dumb',
        },
      },
      (error, stdout, stderr) => {
        const output = stdout?.trim() || stderr?.trim() || '';
        if (error && !output) {
          log(`OpenCode error: ${error.message}`);
          writeOutput({
            status: 'error',
            result: null,
            error: `OpenCode error: ${error.message}`,
          });
          resolve({ output: '' });
          return;
        }
        log(`OpenCode completed. Output length: ${output.length}`);
        writeOutput({ status: 'success', result: output || null });
        resolve({ output });
      },
    );
    proc.stdin?.end();
  });
}

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    try {
      fs.unlinkSync('/tmp/input.json');
    } catch {
      /* may not exist */
    }
    log(`Received input for group: ${containerInput.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
  }

  // Credentials are injected by the host's credential proxy via ANTHROPIC_BASE_URL.
  // No real secrets exist in the container environment.
  const sdkEnv: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: '165000',
  };

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = path.join(__dirname, 'ipc-mcp-stdio.js');

  let sessionId = containerInput.sessionId;
  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });

  // Clean up stale _close sentinel from previous container runs
  try {
    fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL);
  } catch {
    /* ignore */
  }

  // Build initial prompt (drain any pending IPC messages too)
  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }
  const pending = drainIpcInput();
  if (pending.length > 0) {
    log(`Draining ${pending.length} pending IPC messages into initial prompt`);
    prompt += '\n' + pending.join('\n');
  }

  // Script phase: run script before waking agent
  if (containerInput.script && containerInput.isScheduledTask) {
    log('Running task script...');
    const scriptResult = await runScript(containerInput.script);

    if (!scriptResult || !scriptResult.wakeAgent) {
      const reason = scriptResult
        ? 'wakeAgent=false'
        : 'script error/no output';
      log(`Script decided not to wake agent: ${reason}`);
      writeOutput({
        status: 'success',
        result: null,
      });
      return;
    }

    // Script says wake agent — enrich prompt with script data
    log(`Script wakeAgent=true, enriching prompt with data`);
    prompt = `[SCHEDULED TASK]\n\nScript output:\n${JSON.stringify(scriptResult.data, null, 2)}\n\nInstructions:\n${containerInput.prompt}`;
  }

  // Check provider — Codex uses a simpler execution path
  const provider =
    process.env.AGENT_PROVIDER || process.env.DEFAULT_PROVIDER || 'claude';
  if (provider === 'codex') {
    log('Using Codex provider');
    await runQueryCodex(prompt, containerInput, mcpServerPath);
    return;
  }
  if (provider === 'opencode') {
    log('Using OpenCode provider');
    await runQueryOpenCode(prompt, containerInput, mcpServerPath);
    return;
  }
  if (isOpenAiCompatibleAgentProvider(provider)) {
    log(`Using OpenAI-compatible provider: ${provider}`);
    try {
      await runQueryOpenAiCompatible(prompt, containerInput);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log(`OpenAI-compatible provider error: ${errorMessage}`);
      writeOutput({
        status: 'error',
        result: null,
        error: errorMessage,
      });
      process.exit(1);
    }
    return;
  }

  // Claude query loop: run query → wait for IPC message → run new query → repeat
  let resumeAt: string | undefined;
  try {
    while (true) {
      log(
        `Starting query (session: ${sessionId || 'new'}, resumeAt: ${resumeAt || 'latest'})...`,
      );

      const queryResult = await runQuery(
        prompt,
        sessionId,
        mcpServerPath,
        containerInput,
        sdkEnv,
        resumeAt,
      );
      if (queryResult.newSessionId) {
        sessionId = queryResult.newSessionId;
      }
      if (queryResult.lastAssistantUuid) {
        resumeAt = queryResult.lastAssistantUuid;
      }

      // If _close was consumed during the query, exit immediately.
      // Don't emit a session-update marker (it would reset the host's
      // idle timer and cause a 30-min delay before the next _close).
      if (queryResult.closedDuringQuery) {
        log('Close sentinel consumed during query, exiting');
        break;
      }

      // Emit session update so host can track it
      writeOutput({ status: 'success', result: null, newSessionId: sessionId });

      log('Query ended, waiting for next IPC message...');

      // Wait for the next message or _close sentinel
      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      prompt = nextMessage;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId: sessionId,
      error: errorMessage,
    });
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
