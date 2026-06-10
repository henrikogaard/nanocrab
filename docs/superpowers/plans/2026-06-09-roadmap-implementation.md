# NanoCrab Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Hermes/OpenClaw-style NanoCrab roadmap while preserving isolated containers, scoped data folders, explicit approvals, and provider-neutral skills.

**Architecture:** Implement the roadmap in vertical slices that each ship usable behavior: provider routing, isolated coding jobs, memory, journal, skill drafts, artifacts/reports, and web UI observability. Chat containers keep narrow MCP tools; high-risk work is delegated to host-managed services or dedicated ephemeral containers with explicit allowlists.

**Tech Stack:** Node.js 24 LTS, TypeScript, Docker-compatible runtime, SQLite/store JSON files, MCP stdio server, GitHub REST API, Playwright with system Chromium, provider CLIs/APIs.

---

### Task 1: Dedicated Coding Job Containers

**Status:** Complete. Coding jobs now run through short-lived dedicated containers with job-scoped mounts.

**Files:**

- Modify: `src/coding-jobs.ts`
- Modify: `src/coding-jobs.test.ts`
- Modify: `src/config.ts`
- Modify: `README.md`

- [x] **Step 1: Move repo work out of the host process**

Replace host `git` and host agent command execution with an ephemeral container runner that mounts only `data/coding-workspaces/jobs/<jobId>` at `/workspace/coding-job`.

- [x] **Step 2: Preserve coding runtime auth**

Mount persisted provider homes as needed:

```text
data/codex -> /home/node/.codex
data/opencode/config -> /home/node/.config/opencode
data/opencode/data -> /home/node/.local/share/opencode
data/sessions/<requesting-group>/.agents -> /home/node/.agents
```

- [x] **Step 3: Keep GitHub credentials scoped**

Pass `GITHUB_TOKEN` only to the ephemeral coding container, delete its generated env file after the container exits, and keep regular chat containers on the existing narrower path.

- [x] **Step 4: Verify**

Run:

```bash
npm run typecheck
npm run build
npm run build --prefix container/agent-runner
npx vitest run src/coding-jobs.test.ts src/container-runner.test.ts src/ipc-auth.test.ts
```

Expected: all commands pass.

### Task 2: Playwright Development Capability

**Status:** Complete. Playwright is installed for the agent runtime and wired to system Chromium.

**Files:**

- Modify: `container/Dockerfile`
- Modify: `container/agent-runner/package.json`
- Modify: `container/agent-runner/package-lock.json`
- Modify: `container/skills/capabilities/SKILL.md`
- Modify: `container/skills/status/SKILL.md`
- Modify: `README.md`

- [x] **Step 1: Install Playwright without bundled browsers**

Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, install Playwright, and use the existing system Chromium path.

- [x] **Step 2: Expose the capability in skill docs**

Make `/capabilities` and `/status` mention Playwright and the Chromium executable path.

- [x] **Step 3: Verify**

Run the container-agent TypeScript build and, after rebuilding the image, verify:

```bash
node -e "import('playwright').then(() => console.log('ok'))"
```

Expected: `ok`.

### Task 3: Provider Router v1

**Status:** Partial. Provider registry, selectable defaults, model suggestions, base URLs, preflight checks, and OpenAI-compatible routing are present. Capability-aware profiles and per-task routing policy remain future work.

**Files:**

- Create: `src/provider-router.ts`
- Create: `src/provider-router.test.ts`
- Modify: `src/agent-provider.ts`
- Modify: `src/types.ts`
- Modify: `src/task-scheduler.ts`
- Modify: `src/container-runner.ts`
- Modify: `src/admin/routes/providers.ts`
- Modify: `src/admin/public/pages/settings.js`

- [ ] **Step 1: Add provider capability metadata**

Define capability fields: `tool_calls`, `structured_output`, `streaming`, `vision`, `code_strength`, `context_window`, `cost_tier`, `privacy_tier`, and `supports_mcp_strategy`.

- [ ] **Step 2: Add routing profiles**

Create profile ids: `default_chat`, `default_coding`, `default_automation`, `default_memory`, `default_journal`, `default_skill_factory`, `default_reports`, `default_docs`, and `default_vision`.

- [ ] **Step 3: Wire task/model overrides**

Store provider/model overrides on scheduled tasks and pass them into the container runner.

- [ ] **Step 4: Verify**

Add tests for fallback policy and write-capable task refusal when provider capabilities are insufficient.

### Task 4: Memory v1

**Status:** Complete foundation. Structured proposals, approval/rejection, MCP tools, tests, and generated global `MEMORY.md` exist.

**Files:**

- Create: `src/memory-store.ts`
- Create: `src/memory-store.test.ts`
- Modify: `src/db.ts`
- Modify: `src/ipc.ts`
- Modify: `container/agent-runner/src/ipc-mcp-stdio.ts`
- Modify: `src/admin/public/pages/settings.js`

- [x] **Step 1: Add structured memory records**

Implement fields: scope, type, content, source, confidence, visibility, created_at, updated_at, reviewed_at, and expires_at.

- [x] **Step 2: Add proposal and approval flow**

Expose MCP tools to propose memories. Only approved memories become active.

- [x] **Step 3: Generate runtime markdown**

Generate `groups/global/MEMORY.md` from approved global memories and keep it gitignored.

### Task 5: Journal v1

**Status:** Partial. Journal entries/events, event search, MCP tools, and tests exist. Scheduled extraction and recurring summaries remain future work.

**Files:**

- Create: `src/journal.ts`
- Create: `src/journal.test.ts`
- Modify: `src/db.ts`
- Modify: `src/task-scheduler.ts`
- Modify: `container/agent-runner/src/ipc-mcp-stdio.ts`

- [x] **Step 1: Add journal storage**

Create journal entries and notable events from message history.

- [ ] **Step 2: Add daily/weekly summaries**

Schedule summaries per group and write searchable events.

- [x] **Step 3: Add question lookup**

Expose MCP search for questions like "when did that happen?"

### Task 6: Skill Factory v1

**Status:** Complete foundation. Draft storage, validation, owner approval/rejection, MCP tools, and tests exist.

**Files:**

- Create: `src/skill-factory.ts`
- Create: `src/skill-factory.test.ts`
- Modify: `src/admin/routes/skills.ts`
- Modify: `container/agent-runner/src/ipc-mcp-stdio.ts`

- [x] **Step 1: Save skill drafts**

Store proposed `SKILL.md` drafts under `store/skill-drafts/`.

- [x] **Step 2: Validate drafts**

Validate frontmatter, path safety, file size, and allowed tool declarations.

- [x] **Step 3: Require approval**

Install into `container/skills/` only after owner approval.

### Task 7: Reports, Documents, And Research v1

**Status:** Partial. Artifact MCP tools and document-generation skills exist, and Playwright/browser automation is available. A full report pipeline with provenance, approval, and dashboard surfaces remains future work.

**Files:**

- Create: `src/artifacts.ts`
- Create: `src/research-jobs.ts`
- Modify: `container/agent-runner/src/ipc-mcp-stdio.ts`
- Modify: `src/admin/routes/files.ts`
- Modify: `README.md`

- [x] **Step 1: Add artifact basics**

Store generated Markdown, HTML, CSV, PDF, and DOCX outputs with provenance.

- [ ] **Step 2: Add browser-backed research jobs**

Use `agent-browser` and Playwright for source collection, screenshots, summaries, and citations.

- [x] **Step 3: Keep NotebookLM optional**

Add NotebookLM Enterprise as an optional connector later; do not depend on unofficial consumer automation in core.

### Task 8: Better Web Chat And Terminal v1

**Status:** Partial. Existing task output/log panels remain available. The new session timeline, terminal panes, and per-session provider selector are still future work.

**Files:**

- Create: `src/admin/routes/sessions.ts`
- Modify: `src/admin/public/app.js`
- Modify: `src/admin/public/style.css`
- Modify: `src/admin/websocket.ts`

- [ ] **Step 1: Add session timeline**

Show prompts, tool calls, job status, artifacts, changed files, and approvals.

- [ ] **Step 2: Add terminal panels**

Provide persistent terminal-like logs with copy/search and cancellation controls.

- [ ] **Step 3: Add provider/model selector**

Allow per-session and per-task provider/model selection.

---

## Current Execution Slice

The first implementation slice completed Task 1, Task 2, Memory v1 foundation, Journal v1 foundation, Skill Factory v1 foundation, artifact basics, provider basics, and standalone cleanup. Next slices should focus on capability-aware provider profiles, automatic journal extraction/summaries, the report pipeline, and the improved web chat/terminal.
