# NanoCrab Commands

NanoCrab has three command surfaces:

- **Chat commands** typed directly in WhatsApp, Telegram, Signal, or dashboard chat.
- **Host/operator commands** run from a shell in the NanoCrab repo.
- **Agent MCP tools** called by the agent when you ask for tasks like scheduling, reports, coding jobs, memories, or artifacts.

## Chat Commands

These are exact text commands intercepted by the NanoCrab host before they are stored as normal messages.

| Command | Where | Who | What It Does |
| --- | --- | --- | --- |
| `/update-nanocrab` | Main control group | Main group only | Starts the host-side updater from the latest NanoCrab GitHub release. Writes logs under `store/updates/` and may restart the service. |
| `/remote-control` | Main control group | Main group only | Starts Claude Remote Control and replies with the remote-control URL. |
| `/remote-control-end` | Main control group | Main group only | Stops the active Claude Remote Control session. |
| `/chatid` | Telegram | Any Telegram chat with the bot | Replies with the Telegram registration id, name, and chat type. Useful when registering Telegram groups. |
| `/ping` | Telegram | Any Telegram chat with the bot | Replies with a short online status message. |

Most user requests are not hard-coded slash commands. In registered non-main groups, users normally address the bot with the configured trigger, for example:

```text
@NanoCrab summarize the last day
@NanoCrab when did we discuss the fleet crash?
@NanoCrab create a report about this operation
```

The default trigger is `@` plus the configured `ASSISTANT_NAME`, for example `@NanoCrab`. Group-specific triggers are stored in group configuration and can be changed from the dashboard. Examples such as `!wolfclaw` or `!wolfie` are group triggers, not Discord Developer Portal commands.

## Host Commands

Run these from the NanoCrab repository on the host or VPS.

| Command | Purpose |
| --- | --- |
| `npm install` or `npm ci` | Install dependencies. Use `npm ci` for release/deployment verification. |
| `npm run build` | Compile TypeScript and copy the admin frontend into `dist/`. |
| `npm start` | Start the compiled NanoCrab service from `dist/index.js`. |
| `npm run dev` | Start NanoCrab from TypeScript with `tsx`. |
| `npm test` | Run the full Vitest suite. |
| `npm run typecheck` | Run TypeScript without emitting files. |
| `npm run lint` | Run ESLint over `src/`. |
| `npm run lint:fix` | Run ESLint with automatic fixes where possible. |
| `npm run format` or `npm run format:fix` | Format `src/**/*.ts` with Prettier. |
| `npm run format:check` | Check formatting without writing changes. |
| `npm run mock:admin` | Start the sample-data admin dashboard, default `http://127.0.0.1:5173`. |
| `MOCK_ADMIN_PORT=5180 npm run mock:admin` | Start mock admin on another port. |
| `npm run mock:admin:build` | Build first, then start the compiled mock dashboard server. |
| `npm run auth` | Start WhatsApp authentication flow. |
| `npm run setup -- --step <step>` | Run one setup step through the setup CLI. |
| `npm run update:nanocrab` | Update from the latest NanoCrab GitHub release from the host shell. |
| `npm run migrate:nanocrab` | Move old NanoClaw-named local state to NanoCrab paths. |
| `npm run deploy` | Run the deployment verification/build script. |
| `npm run mcp:smoke` | Run the generic MCP smoke test. Does not require optional mail providers. |
| `npm run mcp:smoke:mail` | Run the optional Infomaniak mail smoke test. Requires the Infomaniak MCP preset and credentials. |
| `./container/build.sh` | Build `nanocrab-agent:latest`. |
| `./container/build.sh beta1-smoke` | Build a tagged agent image for smoke testing. |

### Setup Steps

The setup CLI accepts:

```bash
npx tsx setup/index.ts --step <step> [args...]
```

Available steps:

| Step | Purpose |
| --- | --- |
| `timezone` | Configure local timezone. |
| `environment` | Check/create the local environment. |
| `container` | Check container runtime and build agent image. |
| `groups` | Sync or prepare groups. |
| `register` | Register channels/groups. |
| `mounts` | Configure host mount allowlist. |
| `service` | Install/start launchd, systemd, or fallback service wrapper. |
| `verify` | Verify installation state. |
| `provider` | Set default agent provider/model. |
| `codex-auth` | Import/check Codex OAuth for agent containers. |
| `admin` | Configure admin credentials and dashboard settings. |
| `signal-auth` | Register/authenticate Signal. |
| `whatsapp-auth` | Authenticate WhatsApp via QR or pairing code. |

Common examples:

```bash
npx tsx setup/index.ts --step provider -- --provider=codex --model=gpt-5.4
npx tsx setup/index.ts --step provider -- --provider=ollama --model=gemma4:e2b --base-url=http://127.0.0.1:11434/v1
npx tsx setup/index.ts --step admin -- --username admin --password 'change-me' --domain nanocrab.example.com --port 9743
npx tsx setup/index.ts --step verify
```

## Agent MCP Tools

The agent sees these as `mcp__nanocrab__*` tools. You usually do not type these names yourself; you ask naturally and the agent calls the right tool.

### Messaging And Files

| Tool | What It Does |
| --- | --- |
| `mcp__nanocrab__send_message` | Sends an immediate progress update or separate reply to the current chat. |
| `mcp__nanocrab__send_file` | Sends a file from the container filesystem to the current chat. |

### Tasks And Groups

| Tool | What It Does |
| --- | --- |
| `mcp__nanocrab__schedule_task` | Creates recurring or one-time tasks using cron, interval, or local timestamp schedules. |
| `mcp__nanocrab__list_tasks` | Lists scheduled tasks. |
| `mcp__nanocrab__pause_task` | Pauses a scheduled task. |
| `mcp__nanocrab__resume_task` | Resumes a scheduled task. |
| `mcp__nanocrab__cancel_task` | Cancels a scheduled task. |
| `mcp__nanocrab__update_task` | Updates an existing task schedule or prompt. |
| `mcp__nanocrab__register_group` | Main group only. Registers a channel/group so NanoCrab can work there. |

### GitHub And Coding Jobs

| Tool | What It Does |
| --- | --- |
| `mcp__nanocrab__register_coding_repo` | Main group only. Registers a GitHub repo for host-managed coding jobs. |
| `mcp__nanocrab__list_coding_repos` | Main group only. Lists registered coding repos. |
| `mcp__nanocrab__list_github_issues` | Main group only. Lists open issues from a registered repo. |
| `mcp__nanocrab__start_coding_job` | Main group only. Starts a dedicated coding job container/workspace. |
| `mcp__nanocrab__pick_github_issue` | Main group only. Picks a matching GitHub issue and starts a coding job. |
| `mcp__nanocrab__schedule_github_issue_loop` | Main group only. Schedules recurring issue pickup. |
| `mcp__nanocrab__list_coding_jobs` | Main group only. Lists recent coding jobs. |
| `mcp__nanocrab__get_coding_job` | Main group only. Gets full status/output for a coding job. |
| `mcp__nanocrab__control_coding_job` | Main group only. Approves, cancels, retries, opens PR, or requests revert for a coding job. |

### Memory, Journal, And Skills

| Tool | What It Does |
| --- | --- |
| `mcp__nanocrab__propose_memory` | Proposes a structured long-term memory for owner review. |
| `mcp__nanocrab__list_memories` | Main group only. Lists memory records and proposals. |
| `mcp__nanocrab__approve_memory` | Main group only. Approves a memory and refreshes generated memory context. |
| `mcp__nanocrab__reject_memory` | Main group only. Rejects a memory proposal. |
| `mcp__nanocrab__record_journal_event` | Records a notable event for later search. |
| `mcp__nanocrab__search_journal_events` | Searches journal events, for questions like "when did that happen?" |
| `mcp__nanocrab__propose_skill_draft` | Proposes a provider-neutral `SKILL.md` draft for approval. |
| `mcp__nanocrab__list_skill_drafts` | Main group only. Lists pending, approved, or rejected skill drafts. |
| `mcp__nanocrab__approve_skill_draft` | Main group only. Installs an approved skill into `container/skills`. |
| `mcp__nanocrab__reject_skill_draft` | Main group only. Rejects a skill draft. |

### Reports, Research, And Artifacts

| Tool | What It Does |
| --- | --- |
| `mcp__nanocrab__request_report` | Requests a report/document job with sources and output formats. |
| `mcp__nanocrab__list_report_jobs` | Main group only. Lists report/document jobs. |
| `mcp__nanocrab__request_research` | Requests a host-managed Playwright-backed research job. |
| `mcp__nanocrab__list_research_jobs` | Main group only. Lists research jobs. |
| `mcp__nanocrab__create_artifact` | Creates a Markdown, HTML, CSV, or text artifact in the group workspace. |
| `mcp__nanocrab__list_artifacts` | Lists artifacts in the group workspace. |

## Useful Natural-Language Examples

These are normal chat requests, not literal commands:

```text
@NanoCrab remember that I prefer short daily summaries.
@NanoCrab what do you remember about my deployment habits?
@NanoCrab when did we discuss the fleet crash?
@NanoCrab create a daily summary for casual players.
@NanoCrab register henrikogaard/nanocrab as a coding repo with the autofix label.
@NanoCrab pick an autofix issue from henrikogaard/nanocrab and open a PR.
@NanoCrab create a report about the last week of operations as Markdown and PDF.
@NanoCrab make a reusable skill for writing alliance operation summaries.
```
