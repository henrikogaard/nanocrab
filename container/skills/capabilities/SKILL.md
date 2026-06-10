---
name: capabilities
description: Show what this NanoCrab instance can do — installed skills, available tools, and system info. Read-only. Use when the user asks what the bot can do, what's installed, or runs /capabilities.
---

# /capabilities — System Capabilities Report

Generate a structured read-only report of what this NanoCrab instance can do.

**Main-channel check:** Only the main channel has `/workspace/project` mounted. Run:

```bash
test -d /workspace/project && echo "MAIN" || echo "NOT_MAIN"
```

If `NOT_MAIN`, respond with:

> This command is available in your main chat only. Send `/capabilities` there to see what I can do.

Then stop — do not generate the report.

## How to gather the information

Run these commands and compile the results into the report format below.

### 1. Installed skills

List skill directories available to you:

```bash
ls -1 /workspace/skills/ 2>/dev/null || ls -1 /home/node/.codex/skills/ 2>/dev/null || ls -1 /home/node/.claude/skills/ 2>/dev/null || echo "No skills found"
```

Each directory is an installed skill. The directory name is the skill name (e.g., `agent-browser` → `/agent-browser`).

### 2. Available tools

Read the allowed tools from your SDK configuration. You always have access to:

- **Core:** Bash, Read, Write, Edit, Glob, Grep
- **Web:** WebSearch, WebFetch
- **Orchestration:** Task, TaskOutput, TaskStop, TeamCreate, TeamDelete, SendMessage
- **Other:** TodoWrite, ToolSearch, Skill, NotebookEdit
- **MCP:** `mcp__nanocrab__*` (messaging, tasks, group management)

### 3. MCP server tools

NanoCrab exposes these MCP tools via the compatibility `mcp__nanocrab__*` prefix:

- `send_message` — send a message to the user/group
- `schedule_task` — schedule a recurring or one-time task
- `list_tasks` — list scheduled tasks
- `pause_task` — pause a scheduled task
- `resume_task` — resume a paused task
- `cancel_task` — cancel and delete a task
- `update_task` — update an existing task
- `register_group` — register a new chat/group (main only)
- `register_coding_repo` — allow a GitHub repo for host-managed coding jobs (main only)
- `list_coding_repos` — list registered coding repos (main only)
- `list_github_issues` — list open issues from registered repos (main only)
- `start_coding_job` — clone/fix/code in `data/coding-workspaces` outside the chat sandbox (main only)
- `pick_github_issue` — pick a matching issue and start a coding job (main only)
- `schedule_github_issue_loop` — schedule automatic issue picking (main only)
- `list_coding_jobs` / `get_coding_job` — inspect coding job status/output (main only)
- `propose_memory` — propose structured long-term memory for owner approval
- `list_memories` / `approve_memory` / `reject_memory` — review memory records (main only)
- `record_journal_event` / `search_journal_events` — store and search notable events
- `propose_skill_draft` — propose provider-neutral skill drafts
- `list_skill_drafts` / `approve_skill_draft` / `reject_skill_draft` — review and install skills (main only)
- `create_artifact` / `list_artifacts` — create and list group artifacts

### 4. Container skills (Bash tools)

Check for executable tools in the container:

```bash
which agent-browser 2>/dev/null && echo "agent-browser: available" || echo "agent-browser: not found"
node -e "import('playwright').then(() => console.log('playwright: available')).catch(() => console.log('playwright: not found'))" 2>/dev/null
echo "chromium: ${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-${AGENT_BROWSER_EXECUTABLE_PATH:-unknown}}"
```

### 5. Group info

```bash
ls /workspace/group/AGENTS.md /workspace/group/CLAUDE.md 2>/dev/null | head -1 >/dev/null && echo "Group instructions: yes" || echo "Group instructions: no"
ls /workspace/extra/ 2>/dev/null && echo "Extra mounts: $(ls /workspace/extra/ 2>/dev/null | wc -l | tr -d ' ')" || echo "Extra mounts: none"
```

## Report format

Present the report as a clean, readable message. Example:

```
📋 *NanoCrab Capabilities*

*Installed Skills:*
• /agent-browser — Browse the web, fill forms, extract data
• /capabilities — This report
(list all found skills)

*Tools:*
• Core: Bash, Read, Write, Edit, Glob, Grep
• Web: WebSearch, WebFetch
• Orchestration: Task, TeamCreate, SendMessage
• MCP: send_message, schedule_task, task controls, register_group, coding jobs, memories, journal, skill drafts, artifacts

*Container Tools:*
• agent-browser: ✓
• playwright: ✓
• chromium: /usr/bin/chromium

*System:*
• Group instructions: yes/no
• Extra mounts: N directories
• Main channel: yes
```

Adapt the output based on what you actually find — don't list things that aren't installed.

**See also:** `/status` for a quick health check of session, workspace, and tasks.
