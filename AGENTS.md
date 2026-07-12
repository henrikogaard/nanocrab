# NanoCrab

Standalone personal AI assistant platform. See [README.md](README.md) for full documentation.

## Quick Context

Single Node.js process with multi-channel messaging (WhatsApp, Telegram, Signal), admin dashboard with plugin system, and containerized agent providers. Messages route to isolated Docker containers that can run Claude, Codex/GPT, OpenCode, or OpenAI-compatible/local-model providers. Each group has isolated filesystem state, while approved global memory and enabled shared skills can be reused across channels.

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
| `src/provider-router.ts`  | Provider profiles, capability matrix, model preflights                 |
| `src/skill-registry.ts`   | Skill metadata, enable/scope/visibility, relevance scoring             |
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

## Memory And Skills

Skills loaded at runtime inside agent containers (`container/skills/`). These are provider-neutral; the runner builds an active per-group skill directory under `data/runtime-skills/`, mounts it at `/workspace/skills`, and mirrors it into provider-specific homes when needed.

The skill registry controls:

- enabled/disabled state
- scope: all agents, main-only, or channel agents
- visibility: shared, private, or system
- relevance triggers/examples used by the agent runner to inject only the most relevant skills

Important bundled skill families include memory curation, journaling, task planning, report writing, GitHub issue work, code review, release management, email/calendar support, inbox triage, document review, web research, incident analysis, security review, operations planning, image/PDF/DOCX helpers, and status/capability reporting.

Agents can call `mcp__nanocrab__list_skills` and `mcp__nanocrab__search_skills` to discover skills related to a request. If repeated instructions or a reusable workflow appears, the agent should ask whether NanoCrab should create a skill draft. Drafts must be approved before installation.

`groups/**/MEMORY.md` is private runtime memory and must stay out of commits. The root `.gitignore` explicitly excludes it. Approved shared memories generate provider-neutral memory context for all configured channels.

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

## GitHub Issue Workflow

When starting work on a GitHub issue, move it to `In progress` in the NanoCrab project. When the implementation is complete and ready for review, move it to `In review`. If an issue is only partially advanced by a slice, leave it `In progress` and call out the remaining scope.

When Henrik asks to test, validate, or drive issues to closure, treat that as authorization to run the necessary checks, post or preserve evidence, update issue/project state, and close evidence-backed issues when acceptance criteria are satisfied. Do not close or move issues to `Done` when closure depends on subjective QA, production credentials, release/deploy decisions, or external signoff unless Henrik explicitly confirms that signoff and asks for closure.

### Issue And PR Completion Discipline

- When work is tied to an issue, identify the issue number, target branch, and
  expected integration branch before implementation. Default integration branch
  is `development` when it exists; otherwise use repo-level instructions or
  ask.
- Before starting implementation, record the current branch/worktree and
  whether the branch already has an open PR.
- Implementation is not complete until all of these are true:
  - relevant tests/checks have run, or skipped checks are explicitly justified
  - changes are committed on a named branch
  - the branch is pushed
  - a PR exists targeting the correct integration branch, usually `development`
  - the PR description links the issue and includes verification evidence
  - project/issue status is moved to `In review` when repo rules use that state
- If the agent cannot push or create a PR because of auth, detached HEAD,
  sandbox, CI, or branch protection, it must stop with a clear handoff
  containing branch name, commit SHA, target branch, exact PR title/body,
  commands already run, and remaining manual action.
- Do not report an issue as `done`, `complete`, or `ready` when code exists
  only in an unpushed branch, local worktree, stash, or detached commit.
- TDD green is implementation evidence, not closure evidence. Before closing an
  issue or moving it to `Done`, verify the issue acceptance criteria against the
  changed surface, preserve the red/green/manual evidence in the PR, issue
  comment, or worklog, confirm the PR/merge/board state, and call out any
  residual risk.
- When asked for progress/status, check for stale local branches, unpushed
  commits, open PRs, and issue/project status before summarizing.
- For issue work, prefer the lifecycle: branch -> implement -> verify ->
  commit -> push -> PR to integration branch -> move issue to `In review`.
- Never leave completed implementation work only in a local branch without
  either creating a PR or explicitly handing off why PR creation was blocked.
- Before final response on implementation tasks, run `git status --short`,
  `git branch --show-current`, and check whether the branch is pushed / has a
  PR when the repo uses GitHub.

## Container Build Cache

The container buildkit caches aggressively. `--no-cache` alone does NOT invalidate COPY steps. To force a clean rebuild, prune the builder then re-run `./container/build.sh`.
