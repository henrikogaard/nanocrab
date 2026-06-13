# NanoCrab

<p align="center">
  <img src="src/admin/public/static/nanocrab-logo.png" alt="NanoCrab logo" width="420">
</p>

> Standalone personal AI assistant platform with multi-channel messaging, an admin dashboard, provider-neutral agent skills, autonomous coding agents, memory, journal, and plugin support.

**NanoCrab 2.0-Beta1**

---

## What Is NanoCrab?

NanoCrab is a standalone personal assistant platform for running AI agents in isolated containers. It combines messaging channels, a web dashboard, provider routing, autonomous coding, long-term memory, journal/event tracking, and provider-neutral skills in one understandable Node.js process.

NanoCrab is its own product now. It is not an upstream-compatible fork of any upstream project. NanoCrab 2.0-Beta1 uses NanoCrab-native container images, MCP names, config paths, cookies, logs, and service identifiers.

## Learning, Memory, And Skills

NanoCrab 2.0-Beta1 is a major step toward a long-running personal agent. It can learn over time, keep memories, reuse those memories across channels, and grow its own provider-neutral skills, but it does this with review and provenance instead of silently absorbing everything it sees.

- **Structured memory** is stored as reviewed records with scope, type, content, source, confidence, sensitivity, visibility, stale-review state, and contradiction metadata.
- **Shared context** is generated from approved memories into runtime `MEMORY.md` files, so chat, automations, coding jobs, journal extraction, and reports can all benefit from the same remembered facts and preferences.
- **Provider-neutral skills** live as `SKILL.md` packages. Agents can propose new skills, validate them, show a diff in the dashboard, and request approval before installation into `container/skills`.
- **Skill suggestions** appear in the dashboard when recent conversation history looks like a reusable workflow. The agent is also instructed to ask whether it should make a skill when the user repeats a task or gives durable operating instructions.
- **Skill Registry v1** tracks enabled state, scope, visibility, trigger hints, examples, and risk level for every skill. New agent containers receive only the active skills for their group, and the runtime injects the most relevant registry slice for each request.
- **Cross-channel continuity** means a useful approved memory or installed skill is no longer trapped inside one WhatsApp, Signal, Telegram, or dashboard conversation.
- **Safety by default** means memories, skills, report delivery, PR creation, publishing, uploads, external messages, and provider fallback for write-capable work all pass through explicit approval surfaces.

In short: yes, NanoCrab now has governed long-term learning. It remembers what you approve, keeps source/provenance data, and avoids turning casual chat into permanent truth without review.

## Features

### Messaging Channels

- **WhatsApp** — via Baileys (QR code auth)
- **Telegram** — via Grammy bot framework
- **Signal** — via signal-cli native daemon

### Admin Dashboard

Full web dashboard at your domain with 7-layer security (firewall, TLS, IP allowlist, rate limiting, CSP headers, session auth, audit logging).

- **Overview** — live stats, weather, channel status, message feed
- **Agents** — bot agents, coding agents, GitHub issue pickup, coding-job output, and task launcher
- **Messages** — search, filter, export conversations across all channels
- **Approvals** — unified inbox for pending and reviewed risky actions with provenance, filters, and approve/deny controls
- **Memory** — shared cross-channel memory + wiki knowledge base
- **Settings** — 2FA (TOTP), themes, API tokens, bot personality editor, plugin management

### Plugin System

Optional features that can be enabled/disabled from the dashboard:

| Plugin             | Description                                                                             |
| ------------------ | --------------------------------------------------------------------------------------- |
| **GitHub Autofix** | Label an issue `autofix` → an agent clones repo, writes fix, opens PR. Auto-review PRs. |
| **GitHub Copilot** | Multi-account OAuth, assign Copilot to issues, track PRs                                |
| **Uptime Monitor** | HTTP + file-freshness health checks with bot alerts                                     |
| **Chat**           | Send messages to the bot from the dashboard                                             |
| **Workflows**      | Automation workflows with triggers and actions                                          |
| **Wiki**           | Markdown knowledge base                                                                 |

Additional plugins can be installed from git URLs via the Marketplace page, or created as personal plugins that stay local (gitignored).

### Autonomous Coding

- **Coding Task Launcher** — pick tool (Claude Code / Codex / Copilot), model, working directory, and describe the task
- **GitHub Coding Jobs** — register enabled repos, pick issues by repo/label/assignee/milestone/number, inspect diffs/output/tests/CI, approve implementation, approve PRs, retry, cancel, and revert
- **Isolated Coding Jobs** — WhatsApp/Signal/Telegram agents can request repo coding jobs through MCP; an ephemeral coding container clones and edits inside `data/coding-workspaces`
- **Scheduled Tasks** — recurring coding jobs (hourly, daily, weekly)
- **GitHub Autofix Pipeline** — webhook-driven: issue created/labeled → approval-gated coding job → reviewed PR publish → bot notifies you
- **GitHub Connector Health** — Webhooks shows the receiver URL, secret/target/event setup, recent deliveries, and read-only connector health checks without revealing credentials
- **PR Review** — an agent reviews every new PR and posts comments

Coding jobs are available only from the main group. Add
`GITHUB_TOKEN=...` to `.env` or the service environment, then ask the bot things
like:

```text
Register henrikogaard/nanocrab as a coding repo with the autofix label.
List open GitHub issues for henrikogaard/nanocrab.
Pick an autofix issue from henrikogaard/nanocrab and start a coding job.
Start a Codex coding job for henrikogaard/nanocrab to improve the settings page.
Create a scheduled task that periodically asks the main agent to pick an autofix issue and open a PR.
```

The agent calls MCP tools such as `register_coding_repo`,
`list_github_issues`, `start_coding_job`, `pick_github_issue`, and
the scheduled-task tools. The dashboard exposes the same flow under
**Agents -> GitHub Coding Jobs** and **Autofix**. Issue pickup only runs for
enabled repo configs and supports repo, label, assignee, milestone, and direct
issue-number filters. Jobs move through `queued -> investigate -> plan ->
await_approval -> implement -> test -> await_pr_approval -> open_pr ->
ci_running -> completed`, with transition timestamps and failure reasons stored
on the job record.

The host creates job metadata and launches a short-lived agent container with
only that job directory mounted at `/workspace/coding-job`. The container clones
and edits the repo, then emits diff, changed-file, and test summaries for
dashboard review. Implementation requires an approved `coding-implement` record
tied to the job id before the container can mutate the workspace. Commit, push,
and GitHub PR creation require an approved `coding-open-pr` record tied to the
same job id before the host performs those repo mutations. Job metadata is
stored in `store/coding-jobs.json`, registered repos live in
`store/coding-repos.json`, and workspaces live under
`data/coding-workspaces/jobs/`.

Coding runtimes are limited to `claude`, `codex`, and `opencode`; chat-only
providers such as Ollama/OpenRouter/Google stay in the normal agent path unless
a dedicated coding runtime is added.

### Browser Automation

The agent image includes Chromium, `agent-browser`, and Playwright. Playwright
uses system Chromium via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`
and skips bundled browser downloads during image builds. Use it for development
verification, screenshots, repeatable browser tests, and research jobs that need
direct browser-control APIs.

### Mock Admin Dashboard

Use the mock dashboard when you want to redesign or test the admin UI locally
without connecting to live channels, containers, credentials, webhooks, or
servers.

```bash
npm run mock:admin
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The mock server serves
the same dashboard frontend as production, but intercepts `/api/*` and `/ws`
with sample data. The dashboard auto-authenticates as a mock owner, shows a
visible mock-mode banner, and includes placeholder content for the main
surfaces: Dashboard, Agents, Chat, Messages, Groups, Tasks, Memory,
Approvals, Integrations, Developer tools, Git & Code, Monitoring, Containers,
Security, Settings, Marketplace, Uptime, Wiki, Workflows, Autofix, and Copilot.

To use another port:

```bash
MOCK_ADMIN_PORT=5180 npm run mock:admin
```

To verify the compiled build path:

```bash
npm run mock:admin:build
```

Mock mode is intentionally read-safe: POST/PUT/DELETE actions return sample
success responses and do not mutate live files or services.

### Memory, Journal, And Skills

- **Memory v2** — agents can propose structured memories with sensitivity, source, stale, and contradiction metadata; the dashboard reviews what becomes active.
- **Journal v2** — agents can record notable events, extract daily/weekly summaries, and answer natural questions like "when was that fleet crash?" with cited events.
- **Skill Factory v2** — agents can propose provider-neutral `SKILL.md` drafts with version/provenance metadata, validation, diff review, and approval before installation into `container/skills`.
- **Bundled Default Skills** — NanoCrab ships with generic skills for memory curation, journaling, task planning, reports, GitHub issue work, code review, release management, email assistance, browser research, documents, images, and capabilities/status.
- **Suggested Skills** — the dashboard Skills page highlights reusable workflow candidates from recent history, such as private operations planning or dashboard design review. Suggestions become inactive drafts first and still require approval.
- **Skill Registry** — skills can be enabled/disabled and scoped to all agents, main-only, or channel agents. Visibility can be shared, private, or system. Agents can also call `list_skills` and `search_skills` to find skills related to a user request.
- **Reports And Research** — agents and admins can request report jobs, outline approval, Markdown/HTML/DOCX/PDF exports, Playwright-backed research notes, and optional official NotebookLM Enterprise configuration.
- **Unified Approvals** — risky actions such as provider fallback, repo changes, PR creation, report delivery, publishing, uploads, external messages, and tool actions flow through `/api/approvals` and the dashboard Approvals inbox. Approval records include provenance (`source`, `correlationId`, `policyDecisionId`), action/resource previews, expiry metadata, and server-side filters for status, risk, kind, requester, target type, correlation ID, and created date range. Expired pending approvals are marked `expired` and cannot be approved or denied later.
- **Backup, Restore, And Migration** — owners can create essential or full backups, download encrypted archives, configure automatic backup cadence/retention, review manual restore steps, and check legacy NanoClaw migration readiness from the dashboard Backup page.

### Default Integrations

The repository ships only generic defaults. Private runtime state is not source
code:

- `store/mcp-servers.json` is instance-specific and gitignored.
- `store/custom-containers.json` is instance-specific and gitignored.
- Custom Docker containers shown in the dashboard are discovered from the local
  Docker host and custom-container store; they are not default NanoCrab product
  features.
- Private MCP servers such as game, hobby, company, or one-off data collectors
  should stay in runtime state or private plugins unless they are useful to
  generic NanoCrab users.

Built-in/default MCP behavior is intentionally small: NanoCrab IPC and GitHub.
Optional dashboard presets can add provider integrations. NanoCrab currently
includes an opt-in Infomaniak kSuite preset and an `infomaniak-ksuite` skill for
mail, kDrive, and DAV workflows. Google Workspace remains a bundled skill and
credential surface for deployments that provide a compatible MCP server.
The MCP dashboard includes a connector catalog and setup checklist for built-in,
preset, and manually added connectors. It shows install state, missing
credential names, permission exposure, and whether write-capable integrations
remain behind explicit approval gates. The same page also reports Infomaniak
document workflow readiness, covering kDrive search/read, report drafting from
approved sources, approval-gated uploads/sharing, and optional DAV/mail context.
Calendar workflow readiness is also shown there for Google Calendar and
Infomaniak DAV: agenda review, availability checks, meeting briefings,
approval-gated scheduling changes, and follow-up reminders.
Email workflow readiness covers Gmail and Infomaniak Mail: narrow search,
thread summaries, inbox triage, reply drafts, approval-gated sending, and
mailbox cleanup.

### Security

- 2FA with TOTP (QR code setup)
- Encrypted backups (AES-256-GCM with passphrase)
- Hashed API tokens (SHA-256, never stored plaintext)
- Encrypted OAuth tokens at rest
- Container resource limits (CPU/memory caps)
- Password complexity requirements
- Credential audit logging
- Shell injection prevention through argv-based process spawning

## Quick Start

Install and build NanoCrab:

```bash
git clone https://github.com/henrikogaard/nanocrab.git
cd nanocrab
npm install
npm run build
./container/build.sh
```

Then choose which engine should power bot replies.

### Start With Codex

Use this path if you want NanoCrab to run through your ChatGPT subscription
instead of an OpenAI API key.

```bash
# 1. Install/authenticate Codex on the host
codex login --device-auth

# 2. Import the Codex OAuth login into NanoCrab's container mount
#    and make Codex the default engine.
npx tsx setup/index.ts --step provider -- --provider=codex --model=gpt-5.4
```

The Codex setup step copies your host `~/.codex/auth.json` into `data/codex/`.
Agent containers mount that directory as `/home/node/.codex`, so Codex runs as
`Logged in using ChatGPT`.

When Codex is the active agent provider, NanoCrab does not pass
`OPENAI_API_KEY` into the agent container. This prevents Codex from silently
falling back to API billing. Keep `OPENAI_API_KEY` only if you use API-only
features such as transcription or image generation.

You can also authenticate directly into the persisted NanoCrab Codex directory:

```bash
CODEX_HOME="$PWD/data/codex" codex login --device-auth
npx tsx setup/index.ts --step provider -- --provider=codex --model=gpt-5.4
```

### Start With Claude

Use this path if you want NanoCrab to run through Claude Code.

```bash
claude setup-token
npx tsx setup/index.ts --step provider -- --provider=claude --model=claude-sonnet-4-6
```

Claude credentials are handled by NanoCrab's credential proxy. Containers receive
placeholder Claude credentials only; the real token stays on the host.

### Start With OpenCode

Use this path if you want the OpenCode CLI as the coding-agent runtime.

```bash
opencode auth login
npx tsx setup/index.ts --step provider -- --provider=opencode --model=opencode/grok-code-fast-1
```

The container image installs `opencode-ai`. NanoCrab mounts persisted OpenCode
config/auth directories from `data/opencode/`, so provider logins survive
container restarts.

### Start With Ollama, OpenRouter, Or Google

These providers use OpenAI-compatible `/chat/completions` endpoints.

```bash
# Ollama on the host or LAN
npx tsx setup/index.ts --step provider -- \
  --provider=ollama \
  --model=gemma4:e2b \
  --base-url=http://127.0.0.1:11434/v1

# OpenRouter
# Add OPENROUTER_API_KEY=... to .env or your service environment first.
npx tsx setup/index.ts --step provider -- \
  --provider=openrouter \
  --model=openrouter/auto

# Google Gemini OpenAI-compatible endpoint
# Add GEMINI_API_KEY=... to .env or your service environment first.
npx tsx setup/index.ts --step provider -- \
  --provider=google \
  --model=gemini-2.5-flash
```

OpenRouter defaults to `https://openrouter.ai/api/v1`. Google defaults to
`https://generativelanguage.googleapis.com/v1beta/openai/`. In containers,
OpenRouter and Google traffic goes through NanoCrab's credential proxy, so the
real API keys stay on the host. Ollama is translated to the Docker host gateway
when needed, which is the normal VPS/Linux container path.

### Switching Providers Later

- **Settings -> Agent Provider** changes the global default.
- **Settings -> Provider Profiles** chooses provider/model/tool policy for chat, coding, automations, memory, journal, skill factory, reports, documents, and vision.
- **Groups -> Provider** overrides the provider per group.
- **Integrations -> AI Providers** enables/disables API-key providers.

Settings can close active agent sessions while switching providers. Main-group
persistent containers restart automatically and new containers pick up the
selected provider/model. Group model choices are remembered per provider, so a
group can keep a Claude model and a Codex model without reselecting them each
time.

Scheduled tasks can also store a provider profile, explicit provider, model,
and tool policy. This lets an automation use a cheap local summary model or a
strong coding runtime without changing the global bot default.

### Updating NanoCrab

From the main control group, run:

```text
/update-nanocrab
```

The command starts a host-side updater in the background. It looks up the latest
GitHub release for `henrikogaard/nanocrab`, fetches the release tag, checks it
out, installs dependencies, builds the host app, rebuilds the agent container,
and restarts the NanoCrab service. The bot replies immediately with the update
log path under `store/updates/`.

You can run the same updater from the host:

```bash
npm run update:nanocrab
```

The updater refuses to run on a dirty worktree by default. Commit or stash local
changes before updating.

### Command Reference

See [docs/COMMANDS.md](docs/COMMANDS.md) for the full NanoCrab command surface:
chat commands, host/operator commands, setup steps, and agent MCP tools.

### Dashboard Setup

```bash
# Report first-run readiness without writing secrets
npm run setup -- --dry-run

# Configure admin credentials
npx tsx setup/index.ts --step admin -- \
  --username youruser \
  --password yourpass \
  --domain yourdomain.com \
  --port 9743

# Set up Caddy reverse proxy (auto-SSL)
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

The setup preflight checks Node.js, npm, Docker or Apple Container, required
ports, writable runtime directories, `.env` writability, admin auth, provider
credentials, and channel credentials before the container build step. Setup
state is persisted in `.setup-state.json` with `pending`, `running`,
`completed`, and `failed` statuses so reruns resume at the failed or next
incomplete step.

Owners can also use **Settings -> Production Release Diagnostics** before a
deployment. The checklist combines first-run preflight results with release
gates for a clean Git worktree, compiled server/admin output, operator docs,
runtime state, backups, and service supervision. Required failures block the
release status; advisory failures flag operational work to finish before going
live.

Setup logs are written to `logs/setup.log`; credential-looking material is
redacted before it is logged. For a disposable VPS rehearsal, see
[docs/FIRST_RUN_VPS_TEST.md](docs/FIRST_RUN_VPS_TEST.md).

### Configuration

All personal configuration lives in `.env` (never committed):

```bash
ASSISTANT_NAME=YourBot          # Bot name
WEATHER_LAT=58.97               # Dashboard weather location
WEATHER_LNG=5.73
WEATHER_LOCATION=Stavanger
CONTAINER_MEMORY_LIMIT=2g       # Container resource limits
CONTAINER_CPU_LIMIT=2
NANOCRAB_API_TOKEN=<token>      # For container skill API access
```

## Architecture

```
Channels (WhatsApp/Telegram/Signal)
    ↓
SQLite message DB
    ↓
Polling loop (src/index.ts)
    ↓
Container Runner → Docker container (Claude, Codex/GPT, or local model)
    ↓                    ↓
Response → Router    Admin Dashboard (Express + plugins)
```

Single Node.js process. Channels self-register at startup. Agents execute in isolated Docker containers. Admin dashboard runs in the same process on a separate port. Plugins are self-contained modules that register routes, sidebar items, and startup hooks.

### Key Files

| File                       | Purpose                                                                |
| -------------------------- | ---------------------------------------------------------------------- |
| `src/index.ts`             | Orchestrator: state, message loop, agent invocation                    |
| `src/edition.ts`           | NanoCrab edition identity and version                                  |
| `src/admin/index.ts`       | Admin dashboard Express server                                         |
| `src/admin/mock-server.ts` | Local mock dashboard server for UI/UX work without live data           |
| `src/admin/mock-data.ts`   | Sample API payloads used by the mock dashboard                         |
| `src/admin/plugins/`       | Plugin system (registry, types, individual plugins)                    |
| `src/channels/`            | Channel adapters (WhatsApp, Telegram, Signal)                          |
| `src/container-runner.ts`  | Spawns agent containers with mounts                                    |
| `src/credential-proxy.ts`  | Provider credential injection (secrets never enter containers)         |
| `src/coding-jobs.ts`       | Isolated coding-container orchestration and GitHub PR jobs             |
| `src/memory-store.ts`      | Structured long-term memory proposals, approval, and MEMORY.md render  |
| `src/journal-store.ts`     | Notable-event journal storage and search                               |
| `src/skill-factory.ts`     | Provider-neutral skill draft, validation, approval, and installation   |
| `src/codex-auth.ts`        | Codex OAuth detection/import for ChatGPT subscription auth             |
| `container/skills/`        | Provider-neutral skills loaded inside agent containers                 |
| `groups/*/AGENTS.md`       | Per-group agent instructions; canonical filename read by all providers |

`groups/**/MEMORY.md` is runtime memory, not source code. It is intentionally ignored by git so personal facts, habits, and cross-channel memories do not get committed.

## Release And Upgrade Notes

NanoCrab 2.0-Beta1 is tested with Node.js 24. Node.js 20-24 are the supported range; avoid Node.js 26 for now because native dependencies such as SQLite bindings may not install cleanly there yet.

Useful release checks:

```bash
npm install
npm run typecheck
npm run build
npm test
npm audit --audit-level=moderate
npm run mock:admin:build
./container/build.sh
```

`npm run mock:admin` starts a complete sample-data dashboard for UI work without touching live channels or credentials.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the Hermes/OpenClaw-inspired roadmap. The non-epic P0 closure sweep is complete; the remaining P0-labeled GitHub issues are roadmap epics that still track lower-priority follow-up children.

### Plugin Architecture

```
src/admin/plugins/
  types.ts          — AdminPlugin interface
  registry.ts       — Discovery, mounting, enable/disable
  loader.ts         — Optional/private plugin discovery
  autofix/          — GitHub auto-fix pipeline
  copilot/          — GitHub Copilot OAuth
  uptime/           — Service monitoring
  chat/             — Dashboard messaging
  wiki/             — Knowledge base
  workflows/        — Automation
```

Each plugin exports: `id`, `name`, `router` (Express), `sidebar` config, and optional `onInit` hook. Plugins can be enabled/disabled from Settings without touching code.

## Standalone Product

NanoCrab 2.0-Beta1 is a standalone product, not an upstream-compatible fork.

New capabilities should land as normal NanoCrab code, optional private plugins, or approved provider-neutral skills through the Skill Factory.

If upgrading an old local install that still has NanoClaw-named runtime state, run:

```bash
npm run migrate:nanocrab
```

Before releasing or deploying a roadmap-sized change, refresh the README, roadmap, security docs, setup notes, and operator instructions so the documentation matches the running system.

## Requirements

- Linux or macOS (Windows via WSL2)
- Node.js 20+ and npm
- Docker or Apple Container
- [Claude Code](https://claude.ai/download) or [OpenAI Codex CLI](https://developers.openai.com/codex)

## License

MIT
