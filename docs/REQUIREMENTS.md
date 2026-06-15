# NanoCrab Requirements

Original requirements and design decisions from the project creator.

---

## Why This Exists

This is a lightweight, secure alternative to OpenClaw (formerly ClawBot). That project became a monstrosity - 4-5 different processes running different gateways, endless configuration files, endless integrations. It's a security nightmare where agents don't run in isolated processes; there's all kinds of leaky workarounds trying to prevent them from accessing parts of the system they shouldn't. It's impossible for anyone to realistically understand the whole codebase. When you run it you're kind of just yoloing it.

NanoCrab gives you the core functionality without that mess.

---

## Philosophy

### Small Enough to Understand

The entire codebase should be something you can read and understand. One Node.js process. A handful of source files. No microservices, no message queues, no abstraction layers.

### Security Through True Isolation

Instead of application-level permission systems trying to prevent agents from accessing things, agents run in actual Linux containers. The isolation is at the OS level. Agents can only see what's explicitly mounted. Bash access is safe because commands run inside the container, not on your Mac.

### Built for the Individual User

This isn't a broad framework trying to fit every possible user. It's software that fits this deployment's exact needs. Optional capabilities should live as plugins or approved skills instead of forcing every deployment to inherit code it does not need.

### Customization = Code Changes

No configuration sprawl. If you want different behavior, modify the code. The codebase is small enough that this is safe and practical. Very minimal things like the trigger word are in config. Everything else - just change the code to do what you want.

### AI-Native Development

I don't need an installation wizard for every tiny choice - an AI coding agent can guide setup. I don't need elaborate logging UIs for every edge case - I can ask the coding agent to read the logs. I don't need debugging tools for every internal detail - I describe the problem and the agent investigates.

The codebase assumes you have an AI collaborator. It should still be understandable, but it does not need to grow a UI for every internal operation.

### Skills Over Features

When people contribute, they should avoid broad optional features in core. Add generic foundations to core, optional integrations as plugins, and reusable agent behavior as provider-neutral skills.

---

## RFS (Request for Skills)

Skills we'd like to see contributed:

### Communication Channels

- `/add-signal` - Add Signal as a channel
- `/add-matrix` - Add Matrix integration

> **Note:** NanoCrab currently ships WhatsApp, Telegram, and Signal support. Additional channels should be added deliberately as code or plugins, not through a branch network.

---

## Vision

A personal AI assistant accessible via messaging, with minimal custom code.

**Core components:**

- **Agent provider abstraction** for Claude, Codex/GPT, and local-model backends
- **Containers** for isolated agent execution (Linux VMs)
- **Multi-channel messaging** (WhatsApp, Telegram, Discord, Slack, Gmail) — add exactly the channels you need
- **Persistent memory** per conversation and globally
- **Scheduled tasks** that run the configured agent provider and can message back
- **Web access** for search and browsing
- **Browser automation** via agent-browser

**Implementation approach:**

- Use existing tools (channel libraries, agent provider SDKs/CLIs, MCP servers)
- Minimal glue code
- File-based systems where possible (agent instruction files, folders for groups)

---

## Architecture Decisions

### Message Routing

- A router listens to connected channels and routes messages based on configuration
- Only messages from registered groups are processed
- Trigger: `@Andy` prefix (case insensitive), configurable via `ASSISTANT_NAME` env var
- Unregistered groups are ignored completely

### Memory System

- **Per-group instructions**: Each group has a folder with its own canonical `AGENTS.md`
- **Global instructions and memory policy**: Global instructions are read by all groups, while runtime `MEMORY.md` files stay private and gitignored
- **Files**: Groups can create/read files in their folder and reference them
- Agent runs in the group's folder and receives both group and global instruction context

### Session Management

- Each group maintains a conversation session through the configured provider
- Sessions auto-compact when context gets too long, preserving critical information

### Container Isolation

- All agents run inside containers (lightweight Linux VMs)
- Each agent invocation spawns a container with mounted directories
- Containers provide filesystem isolation - agents can only see mounted paths
- Bash access is safe because commands run inside the container, not on the host
- Browser automation via agent-browser with Chromium in the container

### Scheduled Tasks

- Users can ask the configured agent provider to schedule recurring or one-time tasks from any group
- Tasks run as full agents in the context of the group that created them
- Tasks have access to all tools including Bash (safe in container)
- Tasks can stay dashboard-only, send messages to their group, write review files, or create approval-gated webhook deliveries
- Task runs are logged to the database with duration and result
- Schedule types: cron expressions, intervals (ms), or one-time (ISO timestamp)
- From main: can schedule tasks for any group, view/manage all tasks
- From other groups: can only manage that group's tasks
- Dashboard routines provide guided blueprints, provider/model overrides, delivery modes, heartbeat policies, active-run limits, run history, and run-now checks

### Group Management

- New groups are added explicitly via the main channel
- Groups are registered in SQLite (via the main channel or IPC `register_group` command)
- Each group gets a dedicated folder under `groups/`
- Groups can have additional directories mounted via `containerConfig`

### Main Channel Privileges

- Main channel is the admin/control group (typically self-chat)
- Can write to approved global runtime memory (`groups/global/MEMORY.md`)
- Can schedule tasks for any group
- Can view and manage tasks from all groups
- Can configure additional directory mounts for any group

---

## Integration Points

### Channels

- WhatsApp (baileys), Telegram (grammy), Discord (discord.js), Slack (@slack/bolt), Gmail (googleapis)
- Channels live as normal source modules or plugins and are enabled by configuration
- Messages stored in SQLite, polled by router
- Channels self-register at startup — unconfigured channels are skipped with a warning

### Scheduler

- Built-in scheduler runs on the host, spawns containers for task execution
- Custom `nanocrab` MCP server name is retained as a compatibility identifier and provides scheduling tools inside the container
- Tools: `schedule_task`, `list_tasks`, `pause_task`, `resume_task`, `cancel_task`, `send_message`
- Tasks stored in SQLite with run history
- Scheduler loop checks for due tasks every minute
- Tasks execute the configured provider in containerized group context

### Web Access

- Built-in WebSearch and WebFetch tools
- Standard provider capabilities exposed through the container runner

### Browser Automation

- agent-browser CLI with Chromium in container
- Snapshot-based interaction with element references (@e1, @e2, etc.)
- Screenshots, PDFs, video recording
- Authentication state persistence

---

## Setup & Customization

### Philosophy

- Minimal configuration files
- Setup and customization can be done with Codex, Claude Code, OpenCode, or another configured coding runtime
- Users clone the NanoCrab repo and configure the channels/providers they need
- Each deployment gets a setup matching its exact needs

### Skills

- `/setup` - Install dependencies, configure channels, start services
- `/customize` - General-purpose skill for adding capabilities
- Skill Factory drafts - propose, review, and approve provider-neutral skills

### Deployment

- Runs on macOS (launchd), Linux (systemd), or Windows (WSL2)
- Single Node.js process handles everything

---

## Personal Configuration (Reference)

These are the creator's settings, stored here for reference:

- **Trigger**: `@Andy` (case insensitive)
- **Response prefix**: `Andy:`
- **Persona**: Default Claude (no custom personality)
- **Main channel**: Self-chat (messaging yourself in WhatsApp)

---

## Project Name

**NanoCrab** - A small, practical personal assistant with a wink to the original claw/crab lineage.
