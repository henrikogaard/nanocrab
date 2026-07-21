# NanoCrab Capabilities

Last updated: 2026-07-09

This matrix is the current source of truth for what NanoCrab exposes to users.
A capability is considered wired when it has a discoverable dashboard route, a
documented chat command or MCP path, or both. Internal helper functions and
superseded route modules are not product capabilities.

## Product Model

NanoCrab is organized around four operator entry points:

- **Copilot**: plain web chat and quick thinking.
- **Cowork**: durable project, document, artifact, MCP, and source-backed work.
- **Code**: repositories, issues, PRs, tests, snippets, coding agents, and handoffs.
- **More**: operations, setup, governance, monitoring, recovery, and personal context.

## Capability Matrix

| Capability | UI route | Backend/API | Command or MCP path | Status |
| --- | --- | --- | --- | --- |
| Copilot chat | `#/chat` | `/api/threads`, `/api/chat`, web channel runtime | Dashboard chat thread composer | Ready |
| Cowork projects | `#/projects` | `/api/projects`, project files, context, runs, approvals | Channel workspace-intent prompts can resolve Cowork projects | Ready |
| Git & Code workspace | `#/gitcode` | `/api/files/repos`, `/api/dev/git/*`, `/api/dev/test/*`, `/api/dev/snippets`, `/api/dev/review-rules` | Main group `/code ...` commands and coding-job MCP tools | Ready |
| GitHub Autofix | `#/autofix` | `/api/autofix/*`, GitHub webhook route | GitHub issue label or dashboard workbench | Ready |
| GitHub Copilot | `#/copilot` | `/api/copilot/*`, OAuth callback | Dashboard assignment flow | Ready |
| AI Coding Control Plane | `#/control-plane` | `/api/control-plane/*` | Main group `status #n`, `approve #n`, `reject #n`, `revise #n`, `reassign #n`, `pause #n`, `cancel #n`, `follow #n` | Ready |
| Provider profiles | `#/integrations`, `#/settings` | `/api/providers`, `/api/system/provider`, `/api/system/provider/profiles` | Provider/profile/model selection on chat, tasks, reports, and coding jobs | Ready |
| Memory, Journal, and Skills | `#/memory`, `#/skills`, `#/timeline` | `/api/memory`, `/api/journal`, `/api/skills` | `propose_memory`, `record_journal_event`, `propose_skill_draft`, `list_skills`, `search_skills` | Ready |
| Reports, Research, and Artifacts | `#/reports`, `#/artifacts`, Cowork run detail | `/api/reports`, `/api/research`, `/api/artifacts`, `/api/projects/:id/runs/*` | `request_report` (memory, journal, research, artifact, GitHub, and bounded allowlisted `file` sources), `request_research`, `create_artifact`, `list_artifacts` | Ready |
| Tasks, Workflows, Missions, and Briefings | `#/tasks`, `#/workflows`, `#/reports` | `/api/tasks`, `/api/workflows`, `/api/missions`, `/api/briefings` | `schedule_task`, `list_tasks`, `pause_task`, `resume_task`, `cancel_task`, `update_task` | Ready |
| Approvals, Audit, and Security | `#/approvals`, `#/audit`, `#/security` | `/api/approvals`, `/api/runtime-audit`, auth/audit/security routes | Approval prompts in chat, Cowork, reports, coding jobs, and connector workflows | Ready |
| Integrations, MCP, and Credentials | `#/integrations`, `#/credentials`, `#/webhooks` | `/api/mcp`, `/api/credentials`, `/api/webhooks` | MCP connector tools exposed by runtime boundary and approval policy | Ready |
| Channels and Messages | `#/channels`, `#/messages`, `#/groups` | `/api/channels`, `/api/messages`, `/api/groups` | WhatsApp, Telegram, Signal, Slack, Discord, web threads, Slack Socket Mode, Discord gateway, `/chatid`, `/ping` | Ready |
| Monitoring, Backup, and Usage | `#/monitoring`, `#/backup`, `#/usage`, `#/uptime` | `/api/system`, `/api/providers/health`, `/api/dev/monitoring`, `/api/backup`, `/api/usage`, `/api/uptime` | Host commands and setup diagnostics | Ready |
| Marketplace and plugins | `#/marketplace`, `#/settings` | `/api/marketplace`, `/api/plugins`, plugin route registry | Plugin install/update/enable paths | Ready |
| Custom containers and sidecars | `#/containers` | `/api/custom-containers`, `/api/docker` | Admin-only sidecar operations | Ready |
| Route hygiene | Source-level regression test | `src/admin/index.ts` plus `src/admin/routes/*.ts` | N/A | Every admin route module must be intentionally mounted or removed |

## Command And MCP Coverage

The main command surfaces are documented in [COMMANDS.md](COMMANDS.md):

- Chat commands for host-level operations such as `/update-nanocrab`, `/remote-control`, and `/code`.
- Host commands such as `npm run build`, `npm test`, `npm run mock:admin`, setup steps, and container builds.
- MCP tools for messaging, files, scheduled tasks, coding jobs, memories, journal events, skill drafts, reports, research, and artifacts.

## Hermes alignment

NanoCrab overlaps with Hermes on persistent memory, reusable skills, scheduled
work, provider routing, browser/research support, and local execution. NanoCrab's
deliberate difference is governance: memory, skills, external writes, reports,
PR creation, provider fallback, uploads, and connector writes are reviewed and
audited instead of silently becoming permanent behavior.

## OpenClaw alignment

NanoCrab overlaps with OpenClaw on a self-hosted gateway, web control surface,
plugins, skills, coding work, and multi-channel messaging. NanoCrab's deliberate
difference is a smaller local-first core with explicit container isolation,
scoped mounts, credential proxying, and approval-first operator workflows. The
main remaining parity gaps are channel breadth, install polish, native/mobile
nodes, voice/media workflows, and plugin ecosystem scale.

## Known Product Gaps

| Gap | Current status | Preferred next move |
| --- | --- | --- |
| More drawer discoverability | Many high-value surfaces are reachable but hidden behind More. | Add stronger in-app capability routing and mode subnavs before adding more pages. |
| Documentation drift | README, User Guide, roadmap, and Help exist but can fall out of sync. | Keep this file current whenever a feature gains or loses a route, command, or MCP path. |
| Channel breadth | WhatsApp, Telegram, Signal, Slack, Discord, and web threads are supported. | Add voice/media-specific workflows only when they have concrete operator demand. |
| Native/mobile control nodes | Not a core NanoCrab surface today. | Treat as plugin or companion app work, not core runtime expansion. |
| Autonomous learning loop | Skills and memories are governed and review-first. | Add "learn from this run" prompts that create reviewable memory or skill proposals. |
