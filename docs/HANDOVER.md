# NanoCrab Handover

Last updated: 2026-06-10

## Repository State

- Canonical repository: `https://github.com/henrikogaard/nanocrab.git`
- Main branch: `main`
- Functional baseline before this note: `5673d48` (`Format skill registry changes`)
- NanoCrab version: `2.0.0-beta.1`
- The repo is standalone. Do not use the old `nanoclaw` upstream as a source of truth.

## What Is Ready

- Local workstation changes are committed and pushed through `origin/main`.
- The GitHub issue tracker has a roadmap index plus milestones, epics, and child issues for the Hermes/OpenClaw expansion.
- README, command docs, roadmap, changelog, and repository agent instructions describe the 2.0-Beta1 direction.
- Skills are provider-neutral and managed through the skill registry.
- Runtime memories and generated `MEMORY.md` files are private state and gitignored.

## Important Current Capabilities

- Multi-channel bot agents for WhatsApp, Telegram, and Signal.
- Admin dashboard with mock mode for local UI/UX work.
- Provider profiles for Claude, Codex, OpenCode, Ollama, OpenRouter, Google, and related OpenAI-compatible flows.
- Structured memory proposals, journal events/summaries, skill drafts, skill suggestions, and skill timeline surfaces.
- Skill registry with enabled/scope/visibility controls and relevance-based skill injection.
- Dedicated coding job containers for GitHub work.
- Reports, research jobs, deliverables, artifacts, approvals, and Playwright support.
- Optional Infomaniak kSuite MCP preset.

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

- Build the Agent Cockpit and unified approval inbox.
- Harden provider live probes and write-capable fallback approval.
- Expand memory/skill timelines with review filters and contradiction handling.
- Finish OpenClaw-style GitHub coding workflows with staged approvals, PR/CI dashboard, diffs, and mobile commands.
- Grow the connector catalog with permissioned email, calendar, kDrive, GitHub, and document workflows.
