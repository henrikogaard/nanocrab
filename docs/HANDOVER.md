# NanoCrab Handover

Last updated: 2026-06-17

## Repository State

- Canonical repository: `https://github.com/henrikogaard/nanocrab.git`
- Main branch: `main`
- Functional baseline before this note: `51ee219` (`chore: apply formatting cleanup`)
- NanoCrab version: `2.0.0-rc.8`
- The repo is standalone. Do not use the old `nanoclaw` upstream as a source of truth.

## What Is Ready

- Local workstation changes are committed and pushed through `origin/main`.
- The GitHub issue tracker has a roadmap index plus milestones, epics, and child issues for the Hermes/OpenClaw expansion.
- README, command docs, user guide, roadmap, and repository agent instructions describe the 2.0-RC8 direction and the completed non-epic P0 closure sweep.
- Skills are provider-neutral and managed through the skill registry.
- Runtime memories and generated `MEMORY.md` files are private state and gitignored.

## Important Current Capabilities

- Multi-channel bot agents for WhatsApp, Telegram, and Signal.
- Admin dashboard with mock mode for local UI/UX work.
- Provider profiles for Claude, Codex, OpenCode, Ollama, OpenRouter, Google, and related OpenAI-compatible flows.
- Structured memory proposals, journal events/summaries, skill drafts, skill suggestions, and skill timeline surfaces.
- Skill registry with enabled/scope/visibility controls and relevance-based skill injection.
- Isolated coding workspaces for GitHub work: container-backed runners remain the default, with an opt-in host-native Devin runner behind host readiness, constrained model tools, sandboxed commands, and the same dashboard/mobile assignment and PR approval gates.
- Routine blueprints and scheduled tasks with delivery modes, webhook approvals, heartbeat checks, active-run limits, run history, and run-now controls.
- Autofix auto-pickup with cadence, max-active-job limits, webhook receiver guidance, and connector health checks.
- Reports, research jobs, deliverables, artifacts, approvals, and Playwright support.
- Optional Infomaniak kSuite MCP preset.
- P0 release foundations are in place: cockpit/approval inbox, provider probes/fallback approval, memory/skill review timelines, coding workflow approvals/PR/CI tracking, policy/audit/dry-run controls, connector boundaries, and first-run setup preflight.

## Recent Work (2026-06-17)

Two dashboard features landed on `main` (each brainstormed → spec → plan → subagent-driven implementation with spec + code-quality review gates):

- **Mode-first dashboard (Chat / Work / Code).** The admin shell now leads with three modes and a secondary "More" admin drawer instead of a deep nav tree. Frontend-only; routes/pages/backend unchanged. Active mode is derived from the current page (deep links preserved) and the last-used mode is restored on load.
  - Spec: `docs/superpowers/specs/2026-06-15-mode-first-dashboard-design.md`
  - Plan: `docs/superpowers/plans/2026-06-15-mode-first-dashboard.md`
  - Key files: `src/admin/public/modes.js` (config + helpers, vitest-covered), `src/admin/public/app.js` (`showShell`, routing), `src/admin/public/style.css`.
- **Web chat threads.** Chat mode is now Claude Code-style threaded web conversations via a dedicated internal **web channel**, reusing the existing message pipeline. Threads are isolated `kind:'web'` registered groups cloned from an agent template, exposed through `/api/threads`, and kept out of all channel/group management surfaces.
  - Spec: `docs/superpowers/specs/2026-06-15-web-chat-threads-design.md`
  - Plan: `docs/superpowers/plans/2026-06-15-web-chat-threads.md`
  - Key files: `src/channels/web.ts`, `src/web-threads.ts`, `src/admin/routes/threads.ts`, `src/admin/public/pages/chat-threads.js`; `kind`/`title` added to `RegisteredGroup` (`src/types.ts`, `src/db.ts`); `nonWebGroups` partition helper (`src/admin/state.ts`).

**Testing note:** in this local environment the `better-sqlite3` native binding is not compiled, so every vitest file that imports `src/db.js` fails at module load (~150+ baseline failures). These are environmental, not regressions — judge a change by `npm run typecheck` (0 errors), DB-free unit tests passing, and no non-bindings failures. DB/route logic is verified by inspection and by the mock admin dashboard.

## VPS State

- Production VPS: `srv01.ogard.cloud`
- Runtime checkout: `/home/taskekrabben/nanocrab`
- Service: `nanocrab.service`
- The VPS is fetch-only:
  - GitHub CLI auth token removed.
  - GitHub credential helper removed.
  - `origin` fetch URL points at `https://github.com/henrikogaard/nanocrab.git`.
  - `origin` push URL is `DISABLED_PUSH_FROM_VPS`.
  - local `pre-commit` and `pre-push` hooks block commits and pushes.
- VPS cleanup backup: `/home/taskekrabben/backups/vps-cleanup-20260610T180528Z`
- Old `nanoclaw`, Polvenn, scraper folders, custom containers, and old images were removed from the VPS.

## Continue From Another Machine

1. Clone `https://github.com/henrikogaard/nanocrab.git`.
2. Run `npm install`.
3. Run `npm run typecheck`, `npm run build`, and `npm test`.
4. Use `npm run mock:admin` for local dashboard design work without live data.
5. Commit and push only from a trusted workstation, not from the VPS.

## Roadmap Entry Points

- GitHub roadmap index: `https://github.com/henrikogaard/nanocrab/issues/51`
- Local roadmap: `docs/ROADMAP.md`
- Commands reference: `docs/COMMANDS.md`
- Repository instructions: `AGENTS.md`

## Next High-Value Work

- Keep the P0 roadmap epics open only for their remaining follow-up children; all non-epic P0 implementation issues are closed.
- Improve CI-status visualization for coding jobs and PRs.
- Continue backup/restore/migration UI and production release diagnostics hardening.
- Grow the connector catalog with permissioned email, calendar, kDrive, GitHub, and document workflows.
