# Changelog — NanoCrab

All notable changes to NanoCrab are documented here.

## [2.0.0-beta.1] - 2026-06-10

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
