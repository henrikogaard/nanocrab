# NanoCrab

Standalone personal AI assistant platform. See [README.md](README.md) for full documentation.

## Quick Context

Single Node.js process with multi-channel messaging (WhatsApp, Telegram, Signal), admin dashboard with plugin system, and containerized agent providers. Messages route to isolated Docker containers that can run Claude, Codex/GPT, or local-model providers. Each group has isolated filesystem and memory.

## Key Files

| File                      | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `src/index.ts`            | Orchestrator: state, message loop, agent invocation                    |
| `src/edition.ts`          | NanoCrab edition identity and version                                  |
| `src/admin/index.ts`      | Admin dashboard Express server                                         |
| `src/admin/plugins/`      | Plugin system (registry + 8 plugins)                                   |
| `src/channels/`           | Channel adapters (WhatsApp, Telegram, Signal)                          |
| `src/container-runner.ts` | Spawns agent containers with mounts + resource limits                  |
| `src/credential-proxy.ts` | Credential injection (secrets never enter containers)                  |
| `src/db.ts`               | SQLite operations (messages, groups, sessions)                         |
| `src/config.ts`           | Trigger pattern, paths, intervals                                      |
| `src/router.ts`           | Message formatting and outbound routing                                |
| `container/skills/`       | Provider-neutral skills loaded inside agent containers                 |
| `groups/{name}/AGENTS.md` | Per-group agent instructions; canonical filename read by all providers |

## Plugins

Plugins live in `src/admin/plugins/` and self-register routes, sidebar items, and startup hooks. Enable/disable from Settings.

| Plugin    | Path                 | Purpose                                |
| --------- | -------------------- | -------------------------------------- |
| Autofix   | `plugins/autofix/`   | GitHub issue → agent fix → PR pipeline |
| Copilot   | `plugins/copilot/`   | GitHub OAuth, Copilot coding agent     |
| Uptime    | `plugins/uptime/`    | HTTP + file-freshness monitoring       |
| Chat      | `plugins/chat/`      | Dashboard messaging                    |
| Wiki      | `plugins/wiki/`      | Markdown knowledge base                |
| Workflows | `plugins/workflows/` | Automation with triggers               |

Personal/regional plugins (gitignored) are loaded dynamically if present in `src/admin/plugins/` or `plugins/`.

## Container Skills

Skills loaded at runtime inside agent containers (`container/skills/`). These are provider-neutral; the runner mounts them at `/workspace/skills` and mirrors them into provider-specific homes when needed.

| Skill           | Trigger                                         |
| --------------- | ----------------------------------------------- |
| `agent-browser` | Browser automation and web inspection           |
| `capabilities`  | Report installed skills, tools, and system info |
| `status`        | Report container/session status                 |

Personal container skills (gitignored) can be added to `container/skills/` and will be discovered automatically.

`groups/**/MEMORY.md` is private runtime memory and must stay out of commits. The root `.gitignore` explicitly excludes it.

## Credentials

API keys and tokens are managed via `.env` file with the built-in credential proxy. Containers never see raw secrets — outbound API requests route through the proxy which injects credentials at request time.

NanoCrab uses the built-in credential proxy (`src/credential-proxy.ts`). Containers should not receive raw provider secrets directly.

## Development

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management (Linux):

```bash
systemctl --user start nanocrab
systemctl --user stop nanocrab
systemctl --user restart nanocrab
```

## Standalone Direction

NanoCrab is a standalone product. Keep changes NanoCrab-first: normal code changes, optional private plugins, or approved provider-neutral skills through the Skill Factory.

After roadmap-sized work, update README, docs, roadmap status, security notes, and operator instructions before calling the work complete.

## Container Build Cache

The container buildkit caches aggressively. `--no-cache` alone does NOT invalidate COPY steps. To force a clean rebuild, prune the builder then re-run `./container/build.sh`.
