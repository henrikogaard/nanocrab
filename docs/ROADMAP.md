# NanoCrab Roadmap

This roadmap focuses on making NanoCrab more Hermes/OpenClaw-like while keeping the core promise: one understandable process, isolated agent containers, scoped mounts, and explicit approval for risky actions.

## Current Implementation Status

- Playwright is available in the agent image and uses system Chromium.
- GitHub coding jobs are launched through short-lived dedicated coding containers with only the job workspace mounted. The Agents dashboard can register repos, pick issues, launch jobs, show output, and link PRs.
- Memory v1 foundation exists: structured memory proposals, dashboard approval/rejection, and generated `groups/global/MEMORY.md`.
- Journal v1 foundation exists: notable-event recording, scoped event search, dashboard summary listing, and deterministic daily/weekly summary generation from stored message history.
- Skill Factory v1 foundation exists: `SKILL.md` draft validation, draft storage, dashboard review, owner/admin approval, and installation into `container/skills`.
- Artifact basics exist: agents can create/list text artifacts in the group workspace and send generated files through channel tools.
- Provider basics exist: Claude, Codex, OpenCode, Ollama, OpenRouter, and Google are selectable with preflight checks and credential-proxy support where needed. Provider profiles now route chat, coding, automations, memory, journal, skill factory, reports, docs, and vision defaults.
- Report jobs support source scopes, outline approval, Markdown/HTML/DOCX/PDF deliverables, artifacts, and delivery approval.
- Personal operations now include reusable runbooks, missions with step-level status tracking, and daily/weekly briefing schedules backed by approval-gated report tasks.
- Better terminal controls exist in the dashboard: named shell session id, reconnect, clear, copy transcript, and xterm output.
- Standalone cleanup is implemented: NanoCrab is treated as its own product with NanoCrab-first code, plugins, skills, MCP names, container names, docs, and migration tooling.
- P0 closure sweep complete: non-epic P0 issues for cockpit/approvals, provider hardening, memory/skill review surfaces, timeline/router safety, GitHub coding jobs, policy/audit/dry-run controls, connector boundaries, and first-run setup are closed. Remaining P0-labeled GitHub issues are roadmap epics with lower-priority follow-up children still open.
- Still future work: richer CI-status visualization, mobile coding-agent chat commands, more MCP source connectors, and continued dashboard UX polish.

---

## Provider Strategy

### Current State

- **Supported and selectable:** `claude` through Claude Agent SDK, `codex` through OpenAI Codex CLI, and `opencode` through OpenCode CLI.
- **OpenAI-compatible chat providers:** `ollama`, `openrouter`, and `google` are selectable with preconfigured base URLs, model suggestions, preflight checks, and container runner support through `/chat/completions`.
- **Secret handling:** hosted OpenAI-compatible provider calls are routed through NanoCrab's credential proxy, so OpenRouter/Google keys remain on the host. Ollama uses its local/LAN endpoint without a secret by default.
- **Remaining problem:** Provider profiles, live model probes, fallback approvals, and task/workflow overrides exist; continued work is mostly deeper provider coverage, production diagnostics, and UX polish around probe results.

### Provider Requirements

Any provider that powers all NanoCrab features must support, or be wrapped to support:

- Multi-turn chat with persistent context.
- Tool/function calls, so NanoCrab can execute MCP tools, shell actions, GitHub operations, kDrive access, browser automation, and scheduling.
- Structured output or reliable JSON schema mode for memory extraction, journal events, task planning, report outlines, and skill validation.
- Streaming or incremental status output for the dashboard chat/terminal.
- Enough context for repo work, long conversations, and report/document generation.
- Explicit capability metadata: `tool_calls`, `structured_output`, `streaming`, `vision`, `code_strength`, `context_window`, `cost_tier`, `privacy_tier`, and `supports_mcp_strategy`.

### Providers To Add

0. **Provider Router v1 hardening**
   - DONE: provider profiles and static capability matrix exist for chat, coding, automations, memory, journal, skill factory, reports, docs, and vision.
   - DONE: scheduled tasks can store provider profile, provider, model, and tool policy overrides.
   - DONE: added live per-model probes for tool calling, structured output, context length, streaming, and code-editing reliability via `LiveProbeService`.
   - DONE: enhanced fallback policy enforcement — read-only tasks fall back automatically; write-capable tasks require explicit approval.
   - Keep OpenCode/Codex/Claude Code as coding-agent runtimes; use API adapters for extraction, summaries, and report generation where tool calls are predictable.

1. **OpenAI Responses API adapter (`openai-responses`)**
   - DONE: provider adapter implemented with `OpenAIResponsesProvider` class, 11 tests covering capabilities, model validation, and task execution.
   - Endpoints: `GET /v1/models` for validation, `POST /v1/responses` for execution.
   - Capabilities: toolCalls, structuredOutput, streaming, vision, codeStrength high.
   - Reference: [OpenAI tools and MCP docs](https://developers.openai.com/api/docs/guides/tools), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

2. **Anthropic Messages API adapter (`anthropic-messages`)**
   - DONE: provider adapter implemented with `AnthropicMessagesProvider` class, 13 tests.
   - Uses `x-api-key` header auth, `anthropic-version: 2023-06-01` header.
   - Endpoints: `GET /v1/models` for validation, `POST /v1/messages` for execution.
   - All Claude models: toolCalls, structuredOutput, streaming, vision, codeStrength high.
   - Reference: [Anthropic tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview), [Anthropic Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages).

3. **Google Gemini API adapter (`gemini`)**
   - DONE: provider adapter implemented with `GeminiProvider` class, 12 tests.
   - Endpoints: `GET /v1beta/models` for validation, `POST /v1beta/models/{model}:generateContent` for execution.
   - Maps Gemini `contents`/`parts` format to/from ProviderOutput.
   - Models: gemini-3.5-flash (1M context), gemini-2.5-pro (1M context, high cost), gemini-2.5-flash (1M context).
   - Reference: [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling), [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output).

4. **OpenAI-compatible gateway adapter (`openai-compatible`)**
   - DONE: provider adapter implemented with `OpenAICompatibleProvider` class, 14 tests.
   - Flexible endpoint configuration for OpenRouter, vLLM, LM Studio, and compatible hosted endpoints.
   - Conservative default capabilities (toolCalls=false, structuredOutput=false) — live probing determines actual capabilities.
   - Falls back to `GET /models` for discovery, `POST /chat/completions` for execution.
   - Reference: [OpenRouter quickstart](https://openrouter.ai/docs/quickstart), [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling).

5. **Mistral API adapter (`mistral`)**
   - DONE: provider adapter implemented with `MistralProvider` class, 12 tests.
   - OpenAI-compatible chat/completions format with Bearer token auth.
   - Models: mistral-large-latest (128k), mistral-medium-latest (128k, low cost), codestral-latest (256k).
   - Capabilities: toolCalls, structuredOutput, streaming; vision=false for most models.
   - Reference: [Mistral function calling](https://docs.mistral.ai/studio-api/conversations/function-calling), [Mistral structured output](https://docs.mistral.ai/studio-api/conversations/structured-output).

### Provider Settings Surface

Build a single **Providers** admin surface with:

- DONE: Provider registry: enabled/disabled, credential status, base URL, default model, available models, and basic preflight checks.
- DONE: Capability matrix: show providers for chat, coding, automations, memory extraction, journal extraction, skill generation, report generation, docs, and vision.
- Routing profiles:
  - `default_chat`
  - `default_coding`
  - `default_automation`
  - `default_memory`
  - `default_journal`
  - `default_skill_factory`
  - `default_reports`
  - `default_docs`
  - `default_vision`
- Per-group overrides: each channel/group can override provider/profile/model for chat and automations.
- DONE: Per-task and per-automation overrides: task creation can store provider/profile/model/tool policy.
- DONE: Preflight before save: credentials/base URL/static capability checks exist; live model behavior probes implemented via `LiveProbeService`.
- DONE: Fallback policy:
  - Read-only tasks can fall back automatically if configured.
  - Write-capable tasks, GitHub PR work, shell actions, and external messages require explicit approval before falling back to a different provider.

### Data Model Sketch

- `providers`: id, type, display_name, enabled, base_url, credential_ref, created_at, updated_at.
- `provider_models`: provider_id, model, context_window, capabilities_json, cost_tier, privacy_tier, last_probe_at, probe_status.
- `provider_profiles`: id, purpose, provider_id, model, temperature, max_output_tokens, tool_policy, fallback_profile_id.
- `groups`: add default chat and automation profile overrides.
- `tasks`: add provider_profile_id, provider_id, model, tool_policy, approval_policy.
- `workflows`: add provider_profile_id on workflow and optional override on individual agent steps.

---

## Hermes-Like Core

### Memory v2

Add a structured memory store instead of treating markdown as the only source of truth.

- Table: `memories`
  - `id`
  - `scope`: global, group, user, project, repo
  - `type`: preference, fact, habit, relationship, project, credential-note, game-knowledge, warning
  - `content`
  - `source`: message id, task id, manual entry, import, agent proposal
  - `confidence`
  - `visibility`: private, group, global, superuser-only
  - `created_at`
  - `updated_at`
  - `reviewed_at`
  - `expires_at`
- DONE: Agent proposes memories; dashboard approval controls what becomes active.
- Generate `groups/global/MEMORY.md` from approved global memories.
- Keep `MEMORY.md` gitignored and treated as runtime state.
- DONE: Dashboard review queue exists for pending/approved memories with sensitivity, stale-review, and contradiction metadata.

### Skill Factory v2

Let the agent create skills, but never install them silently.

- Agent proposes a skill draft with `SKILL.md` and optional support files.
- Save drafts under `store/skill-drafts/` or a DB-backed draft table.
- Validate frontmatter: name, description, allowed tools, file paths, and size limits.
- DONE: Show draft content in dashboard.
- DONE: Require owner/admin approval before installing into `container/skills`.
- After approval, rebuild/sync skills so the skill becomes shared across all channels.
- DONE: Draft metadata tracks proposer, validation state, installed version, review/install time, provenance, and diff review data.

### Journal v2

Build the "when did that happen?" layer before adding heavy vector systems.

- DONE: Dashboard can generate daily/weekly summaries per registered group from stored message history.
- DONE: Notable-event extraction/search APIs store cited event records with entities, tags, confidence, source message ids, and provenance. Journal search now produces natural-language answers with event and summary citations.
- Tables:
  - `journal_entries`: date, scope, summary, notable_events_json, source_message_ids, provider_profile_id.
  - `journal_events`: timestamp, title, entities, location/context, confidence, source ids, tags.
- DONE: Search APIs support natural questions like "when was that big fleet crash?" or "when did we decide to change provider?"
- Use provider profile `default_journal`; require structured output.

---

## Coding And GitHub Agent

Goal: work with GitHub repos and produce PRs while the owner is on the go.

- GitHub connector:
  - DONE: repo registration/allowlist for coding jobs
  - DONE: issue listing and issue picking through dashboard/API
  - DONE: branch creation inside dedicated coding containers
  - commit signing policy
  - DONE: PR creation when `createPr` is enabled
  - DONE: PR status and CI tracking
- Mobile-safe workflow:
  - DONE: dashboard can start one-off coding jobs or pick issues from registered repos.
  - DONE: "Investigate" creates a read-only plan stage before implementation.
  - DONE: "Implement" requires approval and creates commits.
  - DONE: "Open PR" requires approval before host-side GitHub mutation.
  - NEXT: mobile chat commands for coding jobs.
- Dashboard views:
  - DONE: active/recent coding jobs and output logs
  - DONE: PR links when jobs create PRs
  - DONE: diffs, structured test output, CI status, and approval controls
  - DONE: retry, cancel, and revert controls
- Security:
  - DONE: repository mounts are explicit and validated through the coding repo/workspace allowlist.
  - DONE: non-main groups cannot mount writable repos.
  - DONE: provider fallback cannot happen silently for code-writing tasks.

---

## Reports, Documents, And Design Work

Goal: ask NanoCrab for reports, documents, design notes, and generated assets from chat or dashboard.

- Document/report pipeline:
  - PARTIAL: Report Studio now supports dashboard request intake, outline approval gating, draft/export generation, delivery approval gating, safe artifact downloads, Artifact Vault indexing with retention/search/source links, provider profile, source scopes, output formats, and deliverables directory.
  - NEXT: source collection through MCP servers and mounted data sources
  - NEXT: richer source-link previews and non-report artifact ingestion
  - export to Markdown, HTML, DOCX, PDF, or dashboard artifact
- MCP sources:
  - kDrive
  - mail archives
  - GitHub
  - wiki
  - web/browser
  - mounted project folders
- Design skills:
  - install curated design/report skills through Skill Factory
  - keep design asset generation behind explicit provider profiles
  - store outputs in `store/deliverables/`
- Security:
  - external sources need read/write scopes.
  - generated documents should preserve source citations and provenance.
  - publishing or uploading generated files requires approval.

---

## Research And NotebookLM

Goal: give agents a durable research/reporting workflow without making the core system depend on fragile browser automation.

- Browser research:
  - keep `agent-browser` and system Chromium as the default browsing path.
  - Playwright is available for workflows that need direct browser-control APIs, screenshots, or repeatable UI tests.
  - store research notes, source URLs, snapshots, and final outputs as artifacts.
- Research job profile:
  - browse and collect sources
  - extract citations and provenance
  - summarize findings
  - write Markdown/HTML/PDF artifacts
  - optionally send artifacts back to the requesting channel
- NotebookLM integration:
  - support NotebookLM Enterprise as an optional connector/MCP server where the deployment has Google Cloud access.
  - target official operations first: create notebook, add source URLs/files, list/retrieve/share notebooks, and link generated outputs when supported.
  - keep consumer NotebookLM browser-scraping or unofficial APIs out of the core repo; they can live as private plugins when explicitly enabled.

---

## Web UI Improvements

### Better Terminal And Chat

- Replace the current dev terminal experience with a session-based terminal/chat surface:
  - PARTIAL: named terminal session id, reconnect, clear, and copy transcript controls exist.
  - NEXT: persistent terminal sessions across WebSocket reconnects.
  - NEXT: split panes for terminal, chat, file tree, diff, logs
  - DONE: copyable terminal transcript
  - searchable transcript
  - provider/model selector per chat/task
  - tool-call timeline
  - approve/deny prompts inline
  - live task progress and cancel/retry controls
- Add a "Hermes-style" agent session page:
  - conversation
  - plan/tasks
  - files changed
  - memories proposed
  - skills proposed
  - journal events extracted
  - approvals pending

---

## Security And Isolation Rules

These rules are non-negotiable:

- Agent execution stays inside containers.
- Project root remains read-only unless a task explicitly mounts a writable repo.
- `.env`, credentials, OAuth tokens, and provider keys never enter containers directly.
- Credential proxy or scoped token references are used instead of raw secrets.
- MCP servers are allowlisted and scoped.
- Provider/model fallback for write-capable actions requires approval.
- Memory visibility is enforced at query time and generation time.
- Skills require approval before installation.
- Journal extraction is read-only.
- GitHub PR creation, file publishing, external messages, and document uploads require clear policy gates.
- High-impact actions write sanitized policy/audit events, and dry-run paths avoid external writes while preserving reviewable timelines.

---

## Suggested Build Order

1. **Provider Router v1** - DONE
   - Add provider registry, capability probes, routing profiles, and provider/model selection on tasks and workflows.
2. **Better Web Chat/Terminal v1** - PARTIAL
   - Build the session surface needed to monitor long-running coding and automation work.
3. **Memory v1** - DONE
   - Structured memory DB, review queue, and generated `MEMORY.md`.
4. **Journal v1** - DONE
   - Daily/weekly summaries and notable-event extraction.
5. **GitHub Agent v1** - DONE
   - Repo allowlist, mobile-safe coding sessions, PR creation, CI tracking.
6. **Skill Factory v1** - DONE
   - Draft, validate, diff, approve, install, and sync skills.
7. **Reports/Documents v1**
   - MCP-backed source collection, outlines, exports, and provenance.
8. **Personal Operations v1** - PARTIAL
   - DONE: reusable runbooks, missions started from runbooks, dashboard step tracking, and approval references for sensitive steps.
   - DONE: daily and weekly briefing schedules create approval-gated report tasks from journal/memory sources.
   - NEXT: richer briefing history and per-channel delivery preferences.
9. **Provider Expansion**
   - DONE: OpenAI Responses API adapter with 11 tests
   - DONE: Anthropic Messages API adapter with 13 tests
   - DONE: Google Gemini API adapter with 12 tests
   - DONE: OpenAI-compatible gateway adapter with 14 tests
   - DONE: Mistral API adapter with 12 tests
   - DONE: Live per-model capability probes via `LiveProbeService`
   - DONE: Enhanced fallback policy enforcement for write-capable tasks
   - DONE: Provider/model selectors in Scheduled Tasks UI (creation + edit forms)
   - DONE: Model selector in GitHub coding issue picker
   - DONE: Persistent probe history with dashboard API endpoint
   - DONE: Periodic probe scheduler (5-min interval) with health dashboard display in Monitoring page
   - DONE: `POST /providers/probe-all` for manual re-probe from dashboard
   - DONE: 9 tests for probe scheduler (health data, version tracking, failure handling, scheduler lifecycle)
