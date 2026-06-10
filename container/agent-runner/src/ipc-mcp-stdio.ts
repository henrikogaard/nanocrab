/**
 * Stdio MCP Server for NanoCrab
 * Standalone process that agent teams subagents can inherit.
 * Reads context from environment variables, writes IPC files for the host.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');
const RESPONSES_DIR = path.join(IPC_DIR, 'responses');
const ARTIFACTS_DIR = '/workspace/group/artifacts';

// Context from environment variables (set by the agent runner)
const chatJid = process.env.NANOCRAB_CHAT_JID!;
const groupFolder = process.env.NANOCRAB_GROUP_FOLDER!;
const isMain = process.env.NANOCRAB_IS_MAIN === '1';

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

function safeFilename(filename: string): string {
  const cleaned = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error('Invalid filename');
  }
  return cleaned;
}

async function requestHostTask(
  type: string,
  data: Record<string, unknown>,
  timeoutMs = 15000,
): Promise<unknown> {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  writeIpcFile(TASKS_DIR, {
    ...data,
    type,
    requestId,
    timestamp: new Date().toISOString(),
  });

  const responsePath = path.join(RESPONSES_DIR, `${requestId}.json`);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(responsePath)) {
      const response = JSON.parse(fs.readFileSync(responsePath, 'utf-8')) as {
        ok: boolean;
        data?: unknown;
        error?: string;
      };
      try {
        fs.unlinkSync(responsePath);
      } catch {
        /* ignore */
      }
      if (!response.ok) throw new Error(response.error || 'Host task failed');
      return response.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for host response to ${type}`);
}

function hostResultContent(data: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [
      {
        type: 'text',
        text:
          typeof data === 'string'
            ? data
            : JSON.stringify(data, null, 2).slice(0, 20000),
      },
    ],
  };
}

function hostErrorContent(error: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return {
    content: [
      {
        type: 'text',
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}

const server = new McpServer({
  name: 'nanocrab',
  version: '1.0.0',
});

server.tool(
  'send_message',
  "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times.",
  {
    text: z.string().describe('The message text to send'),
    sender: z
      .string()
      .optional()
      .describe(
        'Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.',
      ),
  },
  async (args) => {
    const data: Record<string, string | undefined> = {
      type: 'message',
      chatJid,
      text: args.text,
      sender: args.sender || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(MESSAGES_DIR, data);

    return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
  },
);

server.tool(
  'send_file',
  'Send a file (document, image, video, audio) to the user or group via WhatsApp. The file must exist in the container filesystem (e.g. /workspace/group/, /tmp/, or a downloaded file). Use this after creating or downloading a file that the user requested.',
  {
    file_path: z
      .string()
      .describe('Absolute path to the file inside the container'),
    caption: z
      .string()
      .optional()
      .describe('Optional caption/message to include with the file'),
    filename: z
      .string()
      .optional()
      .describe('Override the filename shown to the recipient'),
  },
  async (args) => {
    if (!fs.existsSync(args.file_path)) {
      return {
        content: [
          { type: 'text' as const, text: `File not found: ${args.file_path}` },
        ],
        isError: true,
      };
    }

    const data: Record<string, string | undefined> = {
      type: 'file',
      chatJid,
      filePath: args.file_path,
      caption: args.caption || undefined,
      filename: args.filename || path.basename(args.file_path),
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(MESSAGES_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `File queued for sending: ${args.filename || path.basename(args.file_path)}`,
        },
      ],
    };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools. Returns the task ID for future reference. To modify an existing task, use update_task instead.

CONTEXT MODE - Choose based on task type:
\u2022 "group": Task runs in the group's conversation context, with access to chat history. Use for tasks that need context about ongoing discussions, user preferences, or recent interactions.
\u2022 "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, you can ask the user. Examples:
- "Remind me about our discussion" \u2192 group (needs conversation context)
- "Check the weather every morning" \u2192 isolated (self-contained task)
- "Follow up on my request" \u2192 group (needs to know what was requested)
- "Generate a daily report" \u2192 isolated (just needs instructions in prompt)

MESSAGING BEHAVIOR - The task agent's output is sent to the user or group. It can also use send_message for immediate delivery, or wrap output in <internal> tags to suppress it. Include guidance in the prompt about whether the agent should:
\u2022 Always send a message (e.g., reminders, daily briefings)
\u2022 Only send a message when there's something to report (e.g., "notify me if...")
\u2022 Never send a message (background maintenance tasks)

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
\u2022 interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
\u2022 once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
  {
    prompt: z
      .string()
      .describe(
        'What the agent should do when the task runs. For isolated mode, include all necessary context here.',
      ),
    schedule_type: z
      .enum(['cron', 'interval', 'once'])
      .describe(
        'cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time',
      ),
    schedule_value: z
      .string()
      .describe(
        'cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)',
      ),
    context_mode: z
      .enum(['group', 'isolated'])
      .default('group')
      .describe(
        'group=runs with chat history and memory, isolated=fresh session (include context in prompt)',
      ),
    target_group_jid: z
      .string()
      .optional()
      .describe(
        '(Main group only) JID of the group to schedule the task for. Defaults to the current group.',
      ),
    script: z
      .string()
      .optional()
      .describe(
        'Optional bash script to run before waking the agent. Script must output JSON on the last line of stdout: { "wakeAgent": boolean, "data"?: any }. If wakeAgent is false, the agent is not called. Test your script with bash -c "..." before scheduling.',
      ),
  },
  async (args) => {
    // Validate schedule_value before writing IPC
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).`,
            },
          ],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).`,
            },
          ],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      if (
        /[Zz]$/.test(args.schedule_value) ||
        /[+-]\d{2}:\d{2}$/.test(args.schedule_value)
      ) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Timestamp must be local time without timezone suffix. Got "${args.schedule_value}" — use format like "2026-02-01T15:30:00".`,
            },
          ],
          isError: true,
        };
      }
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid timestamp: "${args.schedule_value}". Use local time format like "2026-02-01T15:30:00".`,
            },
          ],
          isError: true,
        };
      }
    }

    // Non-main groups can only schedule for themselves
    const targetJid =
      isMain && args.target_group_jid ? args.target_group_jid : chatJid;

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const data = {
      type: 'schedule_task',
      taskId,
      prompt: args.prompt,
      script: args.script || undefined,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'group',
      targetJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${taskId} scheduled: ${args.schedule_type} - ${args.schedule_value}`,
        },
      ],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    try {
      if (!fs.existsSync(tasksFile)) {
        return {
          content: [
            { type: 'text' as const, text: 'No scheduled tasks found.' },
          ],
        };
      }

      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

      const tasks = isMain
        ? allTasks
        : allTasks.filter(
            (t: { groupFolder: string }) => t.groupFolder === groupFolder,
          );

      if (tasks.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: 'No scheduled tasks found.' },
          ],
        };
      }

      const formatted = tasks
        .map(
          (t: {
            id: string;
            prompt: string;
            schedule_type: string;
            schedule_value: string;
            status: string;
            next_run: string;
          }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');

      return {
        content: [
          { type: 'text' as const, text: `Scheduled tasks:\n${formatted}` },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task. It will not run until resumed.',
  { task_id: z.string().describe('The task ID to pause') },
  async (args) => {
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${args.task_id} pause requested.`,
        },
      ],
    };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string().describe('The task ID to resume') },
  async (args) => {
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${args.task_id} resume requested.`,
        },
      ],
    };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string().describe('The task ID to cancel') },
  async (args) => {
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${args.task_id} cancellation requested.`,
        },
      ],
    };
  },
);

server.tool(
  'update_task',
  'Update an existing scheduled task. Only provided fields are changed; omitted fields stay the same.',
  {
    task_id: z.string().describe('The task ID to update'),
    prompt: z.string().optional().describe('New prompt for the task'),
    schedule_type: z
      .enum(['cron', 'interval', 'once'])
      .optional()
      .describe('New schedule type'),
    schedule_value: z
      .string()
      .optional()
      .describe('New schedule value (see schedule_task for format)'),
    script: z
      .string()
      .optional()
      .describe(
        'New script for the task. Set to empty string to remove the script.',
      ),
  },
  async (args) => {
    // Validate schedule_value if provided
    if (
      args.schedule_type === 'cron' ||
      (!args.schedule_type && args.schedule_value)
    ) {
      if (args.schedule_value) {
        try {
          CronExpressionParser.parse(args.schedule_value);
        } catch {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Invalid cron: "${args.schedule_value}".`,
              },
            ],
            isError: true,
          };
        }
      }
    }
    if (args.schedule_type === 'interval' && args.schedule_value) {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid interval: "${args.schedule_value}".`,
            },
          ],
          isError: true,
        };
      }
    }

    const data: Record<string, string | undefined> = {
      type: 'update_task',
      taskId: args.task_id,
      groupFolder,
      isMain: String(isMain),
      timestamp: new Date().toISOString(),
    };
    if (args.prompt !== undefined) data.prompt = args.prompt;
    if (args.script !== undefined) data.script = args.script;
    if (args.schedule_type !== undefined)
      data.schedule_type = args.schedule_type;
    if (args.schedule_value !== undefined)
      data.schedule_value = args.schedule_value;

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${args.task_id} update requested.`,
        },
      ],
    };
  },
);

server.tool(
  'register_group',
  `Register a new chat/group so the agent can respond to messages there. Main group only.

Use available_groups.json to find the JID for a group. The folder name must be channel-prefixed: "{channel}_{group-name}" (e.g., "whatsapp_family-chat", "telegram_dev-team", "discord_general"). Use lowercase with hyphens for the group name part.`,
  {
    jid: z
      .string()
      .describe(
        'The chat JID (e.g., "1234567890-1234567890@g.us", "tg:-1001234567890", "dc:1234567890123456")',
      ),
    name: z.string().describe('Display name for the group'),
    folder: z
      .string()
      .describe(
        'Channel-prefixed folder name (e.g., "whatsapp_family-chat", "telegram_dev-team")',
      ),
    trigger: z.string().describe('Trigger word (e.g., "@Andy")'),
    requiresTrigger: z
      .boolean()
      .optional()
      .describe(
        'Whether messages must start with the trigger word. Default: false (respond to all messages). Set to true for busy groups with many participants where you only want the agent to respond when explicitly mentioned.',
      ),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Only the main group can register new groups.',
          },
        ],
        isError: true,
      };
    }

    const data = {
      type: 'register_group',
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      trigger: args.trigger,
      requiresTrigger: args.requiresTrigger ?? false,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Group "${args.name}" registered. It will start receiving messages immediately.`,
        },
      ],
    };
  },
);

server.tool(
  'register_coding_repo',
  'Main group only. Register/allow a GitHub repository for host-managed coding jobs. Coding jobs clone into data/coding-workspaces outside the WhatsApp/Signal chat sandbox.',
  {
    repo: z.string().describe('GitHub repo in owner/name format'),
    labels: z
      .array(z.string())
      .optional()
      .describe('Default labels to use when picking issues, e.g. ["autofix"]'),
  },
  async (args) => {
    if (!isMain)
      return hostErrorContent('Only the main group can register coding repos.');
    try {
      return hostResultContent(
        await requestHostTask('register_coding_repo', {
          repo: args.repo,
          labels: args.labels || [],
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'list_coding_repos',
  'Main group only. List GitHub repositories registered for host-managed coding jobs.',
  {},
  async () => {
    if (!isMain)
      return hostErrorContent('Only the main group can list coding repos.');
    try {
      return hostResultContent(await requestHostTask('list_coding_repos', {}));
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'list_github_issues',
  'Main group only. List open GitHub issues from a registered coding repository so the agent can pick work.',
  {
    repo: z.string().describe('GitHub repo in owner/name format'),
    labels: z.array(z.string()).optional().describe('Filter labels'),
    assignee: z.string().optional().describe('Optional GitHub assignee filter'),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async (args) => {
    if (!isMain)
      return hostErrorContent('Only the main group can list GitHub issues.');
    try {
      return hostResultContent(
        await requestHostTask('list_github_issues', {
          repo: args.repo,
          labels: args.labels || [],
          assignee: args.assignee,
          limit: args.limit,
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'start_coding_job',
  'Main group only. Start a host-managed coding job in data/coding-workspaces. Use this for cloning repos, writing code, fixing GitHub issues, and optionally creating a PR. This runs outside the WhatsApp/Signal chat sandbox.',
  {
    repo: z.string().describe('Registered GitHub repo in owner/name format'),
    prompt: z.string().optional().describe('Coding instructions'),
    issue_number: z.number().int().positive().optional(),
    provider: z
      .enum(['claude', 'codex', 'opencode'])
      .optional()
      .describe('Coding runtime. Defaults to configured coding provider.'),
    model: z.string().optional(),
    create_pr: z
      .boolean()
      .default(false)
      .describe('If true, commit, push a branch, and open a pull request.'),
    branch_name: z.string().optional(),
  },
  async (args) => {
    if (!isMain)
      return hostErrorContent('Only the main group can start coding jobs.');
    try {
      return hostResultContent(
        await requestHostTask('start_coding_job', {
          repo: args.repo,
          prompt: args.prompt,
          issueNumber: args.issue_number,
          provider: args.provider,
          model: args.model,
          createPr: args.create_pr,
          branchName: args.branch_name,
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'pick_github_issue',
  'Main group only. Pick the first matching open issue from a registered repo and start a coding job for it.',
  {
    repo: z.string().describe('Registered GitHub repo in owner/name format'),
    labels: z.array(z.string()).optional().describe('Filter labels'),
    provider: z.enum(['claude', 'codex', 'opencode']).optional(),
    model: z.string().optional(),
    create_pr: z.boolean().default(false),
  },
  async (args) => {
    if (!isMain)
      return hostErrorContent('Only the main group can pick GitHub issues.');
    try {
      return hostResultContent(
        await requestHostTask('pick_github_issue', {
          repo: args.repo,
          labels: args.labels || [],
          provider: args.provider,
          model: args.model,
          createPr: args.create_pr,
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'schedule_github_issue_loop',
  'Main group only. Schedule a recurring loop that asks the agent to pick a matching GitHub issue and start a host-managed coding job.',
  {
    repo: z.string().describe('Registered GitHub repo in owner/name format'),
    labels: z.array(z.string()).optional().describe('Filter labels'),
    schedule_type: z.enum(['cron', 'interval']).default('cron'),
    schedule_value: z
      .string()
      .default('0 * * * *')
      .describe('Cron or interval value. Defaults hourly.'),
    provider: z.enum(['claude', 'codex', 'opencode']).optional(),
    model: z.string().optional(),
    create_pr: z.boolean().default(false),
  },
  async (args) => {
    if (!isMain)
      return hostErrorContent('Only the main group can schedule issue loops.');
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const prompt = [
      `Check registered GitHub repo ${args.repo} for an open issue`,
      args.labels?.length ? `with labels: ${args.labels.join(', ')}` : '',
      'using mcp__nanocrab__pick_github_issue.',
      args.provider ? `Use provider ${args.provider}.` : '',
      args.model ? `Use model ${args.model}.` : '',
      args.create_pr
        ? 'If an issue is picked, create a pull request when the coding job completes.'
        : 'If an issue is picked, leave changes in the job workspace unless I later ask for a PR.',
      'If there are no matching issues, send no chat message.',
    ]
      .filter(Boolean)
      .join(' ');
    writeIpcFile(TASKS_DIR, {
      type: 'schedule_task',
      taskId,
      prompt,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: 'isolated',
      targetJid: chatJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    });
    return {
      content: [
        {
          type: 'text' as const,
          text: `GitHub issue loop scheduled as ${taskId}: ${args.schedule_type} ${args.schedule_value}`,
        },
      ],
    };
  },
);

server.tool(
  'list_coding_jobs',
  'Main group only. List recent host-managed coding jobs.',
  { limit: z.number().int().min(1).max(50).optional() },
  async (args) => {
    if (!isMain)
      return hostErrorContent('Only the main group can list coding jobs.');
    try {
      return hostResultContent(
        await requestHostTask('list_coding_jobs', { limit: args.limit }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'get_coding_job',
  'Main group only. Get full status/output for a host-managed coding job.',
  { job_id: z.string() },
  async (args) => {
    if (!isMain)
      return hostErrorContent('Only the main group can inspect coding jobs.');
    try {
      return hostResultContent(
        await requestHostTask('get_coding_job', { jobId: args.job_id }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'control_coding_job',
  'Main group only. Approve, cancel, retry, open a PR for, or request revert of a host-managed coding job.',
  {
    job_id: z.string(),
    action: z.enum(['approve', 'cancel', 'retry', 'open-pr', 'revert']),
  },
  async (args) => {
    if (!isMain)
      return hostErrorContent('Only the main group can control coding jobs.');
    try {
      return hostResultContent(
        await requestHostTask('control_coding_job', {
          jobId: args.job_id,
          action: args.action,
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'propose_memory',
  'Propose a structured long-term memory. The owner must approve it before it becomes active shared memory.',
  {
    scope: z.enum(['global', 'group', 'user', 'project', 'repo']),
    type: z.enum([
      'preference',
      'fact',
      'habit',
      'relationship',
      'project',
      'credential-note',
      'game-knowledge',
      'warning',
    ]),
    content: z.string().min(1).max(4000),
    source: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    visibility: z
      .enum(['private', 'group', 'global', 'superuser-only'])
      .optional(),
    expires_at: z.string().nullable().optional(),
  },
  async (args) => {
    try {
      return hostResultContent(
        await requestHostTask('propose_memory', {
          scope: args.scope,
          memoryType: args.type,
          content: args.content,
          source: args.source,
          confidence: args.confidence,
          visibility: args.visibility,
          expiresAt: args.expires_at,
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'list_memories',
  'Main group only. List structured memory records and pending proposals.',
  {
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    scope: z.enum(['global', 'group', 'user', 'project', 'repo']).optional(),
    visibility: z
      .enum(['private', 'group', 'global', 'superuser-only'])
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  async (args) => {
    if (!isMain)
      return hostErrorContent('Only the main group can list memories.');
    try {
      return hostResultContent(
        await requestHostTask('list_memories', {
          status: args.status,
          scope: args.scope,
          visibility: args.visibility,
          limit: args.limit,
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'approve_memory',
  'Main group only. Approve a proposed memory and regenerate shared MEMORY.md when applicable.',
  { memory_id: z.string() },
  async (args) => {
    if (!isMain)
      return hostErrorContent('Only the main group can approve memories.');
    try {
      return hostResultContent(
        await requestHostTask('approve_memory', { memoryId: args.memory_id }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'reject_memory',
  'Main group only. Reject a proposed memory so it is not used as active long-term memory.',
  { memory_id: z.string() },
  async (args) => {
    if (!isMain)
      return hostErrorContent('Only the main group can reject memories.');
    try {
      return hostResultContent(
        await requestHostTask('reject_memory', { memoryId: args.memory_id }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'record_journal_event',
  'Record a notable event from the current conversation or task so users can later ask when something happened.',
  {
    title: z.string().min(1).max(500),
    timestamp: z.string().optional(),
    entities: z.array(z.string()).optional(),
    location_context: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    source_ids: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  },
  async (args) => {
    try {
      return hostResultContent(
        await requestHostTask('record_journal_event', {
          title: args.title,
          timestamp: args.timestamp,
          entities: args.entities,
          locationContext: args.location_context,
          confidence: args.confidence,
          sourceIds: args.source_ids,
          tags: args.tags,
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'search_journal_events',
  'Search notable journal events. Main group searches all events; other groups search only their own journal scope.',
  {
    query: z.string().min(1),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async (args) => {
    try {
      return hostResultContent(
        await requestHostTask('search_journal_events', {
          query: args.query,
          limit: args.limit,
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'list_skills',
  'List active provider-neutral skills available to this group, including scope, visibility, triggers, and descriptions.',
  {},
  async () => {
    try {
      return hostResultContent(await requestHostTask('list_skills', {}));
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'search_skills',
  'Find skills related to a request or task. Use when the user asks what skill applies, or before deciding whether to propose a new skill.',
  {
    query: z.string().min(1),
    limit: z.number().int().min(1).max(30).optional(),
  },
  async (args) => {
    try {
      return hostResultContent(
        await requestHostTask('search_skills', {
          query: args.query,
          limit: args.limit,
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'propose_skill_draft',
  'Propose a provider-neutral skill draft. The owner must approve it before it is installed into container/skills.',
  {
    skill_md: z
      .string()
      .min(1)
      .max(50000)
      .describe(
        'Complete SKILL.md content with name and description frontmatter',
      ),
  },
  async (args) => {
    try {
      return hostResultContent(
        await requestHostTask('propose_skill_draft', {
          skillMd: args.skill_md,
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'list_skill_drafts',
  'Main group only. List pending, approved, or rejected skill drafts.',
  {
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
  },
  async (args) => {
    if (!isMain)
      return hostErrorContent('Only the main group can list skill drafts.');
    try {
      return hostResultContent(
        await requestHostTask('list_skill_drafts', { status: args.status }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'approve_skill_draft',
  'Main group only. Approve and install a skill draft into container/skills.',
  { draft_id: z.string() },
  async (args) => {
    if (!isMain)
      return hostErrorContent('Only the main group can approve skill drafts.');
    try {
      return hostResultContent(
        await requestHostTask('approve_skill_draft', {
          draftId: args.draft_id,
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'reject_skill_draft',
  'Main group only. Reject a skill draft without installing it.',
  { draft_id: z.string() },
  async (args) => {
    if (!isMain)
      return hostErrorContent('Only the main group can reject skill drafts.');
    try {
      return hostResultContent(
        await requestHostTask('reject_skill_draft', {
          draftId: args.draft_id,
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'request_report',
  'Request a report/document job. The host collects sources, creates an outline, and requires approval before delivery.',
  {
    title: z.string().optional(),
    request: z.string().min(1),
    output_formats: z
      .array(z.enum(['markdown', 'html', 'docx', 'pdf']))
      .optional(),
    source_scopes: z
      .array(z.enum(['journal', 'memory', 'github', 'wiki', 'kdrive', 'web']))
      .optional(),
  },
  async (args) => {
    try {
      return hostResultContent(
        await requestHostTask('request_report', {
          title: args.title,
          request: args.request,
          outputFormats: args.output_formats,
          sourceScopes: args.source_scopes,
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'list_report_jobs',
  'Main group only. List recent report/document jobs.',
  {},
  async () => {
    if (!isMain)
      return hostErrorContent('Only the main group can list report jobs.');
    try {
      return hostResultContent(await requestHostTask('list_report_jobs', {}));
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'request_research',
  'Request a host-managed research job. URLs are fetched with Playwright in the host job workspace and saved as artifacts.',
  {
    query: z.string().min(1),
    urls: z.array(z.string().url()).optional(),
  },
  async (args) => {
    try {
      return hostResultContent(
        await requestHostTask('request_research', {
          query: args.query,
          urls: args.urls,
        }),
      );
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'list_research_jobs',
  'Main group only. List recent host-managed research jobs.',
  {},
  async () => {
    if (!isMain)
      return hostErrorContent('Only the main group can list research jobs.');
    try {
      return hostResultContent(await requestHostTask('list_research_jobs', {}));
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'create_artifact',
  'Create a text/markdown/HTML/CSV artifact in the current group workspace. Use send_file afterward if the user wants it delivered.',
  {
    filename: z
      .string()
      .describe('Safe filename such as report.md or data.csv'),
    content: z.string().describe('Artifact content'),
  },
  async (args) => {
    try {
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
      const filename = safeFilename(args.filename);
      const filePath = path.join(ARTIFACTS_DIR, filename);
      fs.writeFileSync(filePath, args.content);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Artifact written: ${filePath}`,
          },
        ],
      };
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

server.tool(
  'list_artifacts',
  'List artifacts created in the current group workspace.',
  {},
  async () => {
    try {
      if (!fs.existsSync(ARTIFACTS_DIR)) {
        return {
          content: [{ type: 'text' as const, text: 'No artifacts found.' }],
        };
      }
      const artifacts = fs
        .readdirSync(ARTIFACTS_DIR)
        .map((name) => {
          const filePath = path.join(ARTIFACTS_DIR, name);
          const stat = fs.statSync(filePath);
          return {
            name,
            path: filePath,
            size: stat.size,
            modified: stat.mtime.toISOString(),
          };
        })
        .sort((a, b) => b.modified.localeCompare(a.modified));
      return hostResultContent(artifacts);
    } catch (err) {
      return hostErrorContent(err);
    }
  },
);

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
