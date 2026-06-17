# Changelog — NanoCrab

All notable changes to NanoCrab are documented here.

## [Unreleased]

### Mode-First Dashboard (Chat / Work / Code)

- Reorganized the admin dashboard shell around three top-level modes — **Chat**, **Work**, and **Code** — replacing the deep admin navigation tree as the primary surface.
- Each mode shows a mode-scoped sidebar (Chat → conversations/messages; Work → agents, groups, tasks, approvals, sessions, workflows, reports, artifacts, memory, timeline; Code → Git & Code, Terminal, AutoFix, Skills, Marketplace). Operational/admin pages (Dashboard, Deploy, Monitoring, Containers, Integrations, Security, Audit, Uptime, Copilot, Settings, …) moved into a secondary **More** drawer.
- Added a segmented mode switcher, a "New conversation"/context-aware primary action, and an always-present pinned footer (More + Customize).
- The app reopens the last-used mode; page-based routes (`#/<page>`) are preserved and the active mode is derived from the current page, so existing deep links and bookmarks keep working.
- Role-aware navigation: viewer-hidden pages are excluded from the mode sidebar, the More drawer, and mode landing.
- Mobile bottom bar is now Chat / Work / Code / More.
- Frontend-only change: page render functions and all backend APIs are unchanged. Navigation config and pure helpers live in `src/admin/public/modes.js` with vitest coverage.

### Web Chat Threads (Claude Code-style conversations)

- The Chat mode is now a threaded web conversation surface instead of a WhatsApp-style channel feed: conversations are listed in the sidebar with a **New conversation** entry, `#/chat/:threadId` routing, and a per-thread conversation view.
- Threads are delivered through a dedicated, internal **web channel** (`src/channels/web.ts`, owns `web:` JIDs) and ride the existing message loop, queue, container runner, approval flow, and WebSocket pipeline — so tool calls, approvals, and progress render inline per thread.
- Each thread is an isolated `kind:'web'` registered group with its own folder and session, and a container config cloned from a chosen **agent template** (or a custom provider/model via an Advanced option). Picking a template never copies the source agent's files/memory.
- New `/api/threads` API: list, create (template or custom), per-thread messages, rename, and delete (with container-stop, folder, message, and registration cleanup).
- Web threads are kept fully separate from WhatsApp/Signal setup: `kind:'web'` groups are excluded from the Groups page, Channels page, dashboard channel health, public `/health`, Integrations, and agent-boundary listings (via a shared `nonWebGroups` helper), and the group-update route rejects web JIDs.
- Mock admin dashboard (`npm run mock:admin`) now serves sample `/api/threads` data so the threaded Chat UI can be exercised locally.

## [2.0.0-beta.1] - 2026-06-10

### Beta1 Follow-Up Hardening

- Added bot-agent enable/disable controls and primary-bot selection so only the primary bot receives startup warmup messages.
- Added configurable startup notice behavior to reduce noisy restart messages.
- Added Skills and Timeline dashboard surfaces under the workspace navigation.
- Added bundled provider-neutral skills for memory curation, journaling, task planning, reports, GitHub issue work, code review, release management, email assistance, calendar assistance, contact context, web research, document review, meeting briefings, inbox triage, automation design, incident analysis, security review, and operations planning.
- Added a skill registry with enabled state, scope, visibility, triggers, examples, risk level, required tools, relevance scoring, and active per-group skill directory generation.
- Added `list_skills` and `search_skills` MCP tools so agents can discover skills related to a request.
- Added skill suggestion queues and timeline entries based on recent conversation/task history.
- Added the optional Infomaniak kSuite MCP preset while keeping private MCP servers and custom containers out of the default product setup.
- Refreshed NanoCrab branding, logo usage, README positioning, command documentation, and dashboard mock data.
- Linked the fresh NanoCrab v2 repository to `henrikogaard/nanocrab.git` and kept commits authored from the local workstation.
- Created GitHub roadmap milestones, epics, and implementation issues for the Hermes/OpenClaw expansion.

### Hermes-Like Foundations

- Added provider profiles and a static capability matrix for chat, coding, automations, memory, journal, skill factory, reports, documents, and vision.
- Added scheduled-task provider/profile/model/tool-policy fields so automations can route to specific models.
- Added dashboard review APIs and UI for structured memories, journal summaries, and Skill Factory drafts.
- Added deterministic daily/weekly journal summary generation from stored group message history.
- Added GitHub coding-job dashboard controls for repo registration, issue pickup, job output, and PR links.
- Expanded report pipeline configuration with provider profile, source scopes, output formats, deliverables directory, and outline-approval policy.
- Improved the dashboard terminal with a named session id, reconnect, clear, and copy-transcript controls.
- Added `/update-nanocrab` and `npm run update:nanocrab` to update from the latest NanoCrab GitHub release.

### Standalone Direction

- Removed legacy external skill discovery/installation from the Skills admin route and UI.
- Reframed README/CONTRIBUTING/AGENTS docs around NanoCrab as a standalone project.
- Internal compatibility names such as `nanocrab-agent` and `mcp__nanocrab__*` remain for protocol stability.

### Admin Mock Mode

- Added `npm run mock:admin` for a local sample-data dashboard on port 5173.
- Added `npm run mock:admin:build` to compile and run the built mock dashboard server.
- Mock mode serves the production dashboard frontend with placeholder API and WebSocket data, including a visible mock-mode banner.

## [1.1.0] - 2026-04-25

### Plugin System

- Self-contained plugin architecture (`src/admin/plugins/`)
- Plugins register routes, sidebar items, and startup hooks
- Enable/disable from Settings without code changes
- 6 built-in plugins: autofix, copilot, uptime, chat, wiki, workflows
- Personal plugins loaded dynamically if present (gitignored)

### Plugin Hygiene

- Domain-specific plugins are loaded through the optional/private plugin loader rather than bundled into the generic core

### GitHub Autofix Plugin

- Webhook-driven: label issue `autofix` → Claude Code clones, fixes, opens PR
- Manual trigger from dashboard (pick repo → pick issue → fix)
- PR review automation (Claude reviews and posts comments)
- Auto-review mode per project
- Bot notifications on completion

### GitHub Copilot Plugin

- OAuth web flow with multi-account support
- Assign Copilot coding agent to issues
- Browse repos and issues per account
- Job tracking with PR links

### Agents Page

- Shows all bot agents (WhatsApp/Telegram/Signal) with status
- Shows coding agents (Claude Code, Codex, Copilot) as available tools
- Coding task launcher: pick tool, model, working dir, budget
- Scheduled coding tasks (hourly/daily/weekly cron)
- Live output viewer with auto-refresh

### Security Hardening

- 2FA with TOTP (QR code setup, verify on login)
- Backup encryption (AES-256-GCM with passphrase)
- API tokens stored as SHA-256 hashes (never plaintext)
- GitHub OAuth tokens encrypted at rest (AES-256-GCM)
- Password complexity (uppercase + lowercase + number, min 12 chars)
- Shell injection prevention (execFileSync everywhere)
- Credential audit logging
- .env file permissions set to 0o600
- File size validation (10MB max on read endpoints)
- Container resource limits (CPU/memory caps via env vars)

### Dashboard Improvements

- Combined dashboard endpoint (9 API calls → 1, 83ms load)
- Weather widget (local weather from MET Norway, configurable location)
- Conversation analytics (message volume, bot ratio, channel breakdown)
- Bot personality editor (edit global CLAUDE.md from Settings)
- Disk space monitoring in system info
- Heap usage against actual V8 limit
- Searchable help manual (38 topics, 7 sections)
- Crab favicon (SVG with glowing purple eyes)
- Aggressive cache-busting (no-store headers)
- Network-first service worker (replaces cache-first)

### Uptime Monitor

- Moved from core to plugin
- Added file-freshness check type (monitors file modification time)
- Alerts if scraper output goes stale

### NanoCrab Branding

- `src/edition.ts` — application identity layer
- Sidebar shows "NanoCrab" with application version
- About section in Settings with crab favicon and version info
- All personal identifiers removed from source code
- Configurable via ASSISTANT_NAME, WEATHER_LAT/LNG in .env

## [1.0.0] - 2026-04-08 / 2026-04-11

### Project Origin From NanoCrab v1.2.52

#### Signal Channel

- Full Signal channel (`src/channels/signal.ts`) via signal-cli daemon
- UUID-to-phone mapping, attachment support, voice transcription

#### Admin Dashboard

- Express backend with WebSocket, served behind Caddy with auto-SSL
- 7-layer security (firewall, TLS, IP allowlist, rate limiting, CSP, sessions, audit)
- Pages: Dashboard, Messages, Groups, Tasks, Credentials, Logs, System, Settings, Security
- Web terminal (xterm.js), code editor, file browser
- Real-time message feed via WebSocket

#### Container Skills

- Codex, DOCX generation, image generation (fal.ai/DALL-E/Leonardo), image vision, PDF reader

#### Per-Group MCP Restrictions

- `allowedMcpServers` in ContainerConfig for multi-user access control

---

Earlier history reflects the project origin; current development is NanoCrab-first.
