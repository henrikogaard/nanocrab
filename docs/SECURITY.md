# NanoCrab Security Model

## Trust Model

| Entity            | Trust Level | Rationale                        |
| ----------------- | ----------- | -------------------------------- |
| Main group        | Trusted     | Private self-chat, admin control |
| Non-main groups   | Untrusted   | Other users may be malicious     |
| Container agents  | Sandboxed   | Isolated execution environment   |
| Incoming messages | User input  | Potential prompt injection       |

## Security Boundaries

### 1. Container Isolation (Primary Boundary)

Agents execute in containers (lightweight Linux VMs), providing:

- **Process isolation** - Container processes cannot affect the host
- **Filesystem isolation** - Only explicitly mounted directories are visible
- **Non-root execution** - Runs as unprivileged `node` user (uid 1000)
- **Ephemeral containers** - Fresh environment per invocation (`--rm`)

This is the primary security boundary. Rather than relying on application-level permission checks, the attack surface is limited by what's mounted.

### 2. Mount Security

**External Allowlist** - Mount permissions stored at `~/.config/nanocrab/mount-allowlist.json`, which is:

- Outside project root
- Never mounted into containers
- Cannot be modified by agents

**Default Blocked Patterns:**

```
.ssh, .gnupg, .aws, .azure, .gcloud, .kube, .docker,
credentials, .env, .netrc, .npmrc, id_rsa, id_ed25519,
private_key, .secret
```

**Protections:**

- Symlink resolution before validation (prevents traversal attacks)
- Container path validation (rejects `..` and absolute paths)
- `nonMainReadOnly` option forces read-only for non-main groups

**Read-Only Project Root:**

The main group's project root is mounted read-only. Writable paths the agent needs (store, group folder, IPC, and provider runtime homes such as `.claude`, `.codex`, and OpenCode config/auth directories) are mounted separately. This prevents the agent from modifying host application code (`src/`, `dist/`, `package.json`, etc.) which would bypass the sandbox entirely on next restart. The `store/` directory is mounted read-write so the main agent can access the SQLite database directly.

### 3. Session Isolation

Each group has isolated provider session state under `data/sessions/{group}/`. Claude SDK compatibility data currently lives at `data/sessions/{group}/.claude/`:

- Groups cannot see other groups' conversation history
- The `search_message_history` MCP tool is read-only and applies the same boundary: channel agents search only their own chat, while the main group can target registered chats
- Session data includes full message history and file contents read
- Prevents cross-group information disclosure

Hosted OpenAI-compatible provider calls such as OpenRouter and Google Gemini are routed through NanoCrab's credential proxy for normal agent containers. Containers receive a local proxy URL and placeholder bearer token; the real provider API keys stay on the host. Ollama uses its configured local/LAN endpoint and normally does not require a secret. Some tool runtimes still require scoped secrets inside the container; these are listed under Credential Isolation.

Shared runtime memory files such as `groups/global/MEMORY.md` are operator data and are ignored by git. They should be backed up with runtime state, not committed to the repository.

### 3a. Memory And Skill Router Controls

Memory and skills are treated as provenance-tracked runtime context:

- Memory proposals are pending until an admin approves, rejects, marks stale, or marks contradicted.
- Skill suggestions, drafts, installs, state changes, and routing decisions appear in the admin provenance timeline.
- Skill visibility is explicit: `shared`, `private`, or `system`.
- Skill scope is explicit: `all`, `main`, or `channels`.
- Visibility and scope changes are only accepted through admin-authorized routes.
- Skills.sh catalog search is a server-side read to `SKILLS_SH_API_BASE_URL`
  and install is an explicit admin action. NanoCrab downloads `SKILL.md`
  content, writes it locally under `container/skills`, records a version
  snapshot, and applies the same scope/visibility router controls; it does not
  execute `npx skills` or run downloaded code during installation.

Skill injection is bounded before a container starts. The router clamps relevance scores, excludes score `<= 0`, caps the number of injected skills, caps total skill context bytes, and records why each skill was injected or excluded. Channel agents do not receive `private` or `system` skills; those are reserved for the main/admin context. Runtime skill registry snapshots include only the skills that survived this selection step.

### 3b. Policy, Dry-Run, And Audit Replay

High-impact actions are evaluated by the host-side policy engine before execution. Policy rules live in `store/policies.json` and support wildcard action patterns, risk classification, approval requirements, dry-run eligibility, and sanitized explanations. If no custom rules exist, NanoCrab applies conservative defaults for coding writes, provider fallback, container spawn, uploads, and outbound sends.

Audit events are stored in SQLite (`audit_events`) with actor, action, resource, decision, sanitized context, correlation id, duration, and error fields. The admin Audit page can filter events, replay a correlation timeline, export JSON, and simulate policy decisions. Audit context redacts tokens, passwords, API keys, secrets, cookies, authorization headers, and common bearer/API-key values before persistence.

Dry-run mode records `decision: simulated` audit events and avoids external writes. Coding-job dry-runs skip container execution, Git commits, pushes, and pull request creation while still recording the workflow timeline. Scheduled automations can run with `tool_policy: dry-run`; the container runner returns a simulated result without spawning a container and treats mounts as read-only in the recorded decision.

### 3c. Connector Permissions And Agent Boundaries

MCP connectors have explicit permission records in `store/connector-permissions.json`: `connectorId`, `scope`, `allowedActions`, `requiresApproval`, `groups`, `agents`, `createdAt`, and `updatedAt`. Before connector tools are exposed to a container or connector actions are authorized, NanoCrab checks the active group/agent scope and then evaluates host policy for the connector action. Write-capable connector actions should either require approval on the connector permission or be allowed by an explicit policy rule.

When an agent runtime requires a whole MCP server to be configured, NanoCrab does not treat that as permission to expose every tool. Scoped external connectors are started behind a container-local stdio MCP proxy that filters `tools/list` to the allowed tool patterns and rejects `tools/call` outside those patterns. This lets read-scoped connectors remain usable in Codex/OpenCode without granting wildcard write access.

Every container invocation also resolves an agent boundary from the group identity before runtime assembly. The boundary declares channel scopes, filesystem scopes, skill scopes, provider profile permissions, allowed connector ids, and external write permissions. Container mounts, runtime skill snapshots, provider fallback profile selection, channel capability metadata, connector tool exposure, and MCP credential forwarding are derived from that boundary. Unauthorized channel agents therefore cannot receive private skills, out-of-scope connector credentials, coding-only provider profiles, broad channel scopes, or write-capable external tools.

Cowork project runs follow the same default: source-backed reads and local project artifacts can be recorded in the project workspace, but external writes such as document publishing, channel sends, uploads, repo writes, calendar edits, webhooks, file delivery, or connector mutations create or reuse a run-scoped approval record before execution. Uploaded design systems are stored as local admin/project metadata and injected only as prompt context for generated documents, presentations, and artifacts unless a separate approval-gated external write is requested. New Cowork context writes normalize provenance and sensitivity to canonical labels while keeping legacy stored strings readable, and approval prompts consume the normalized sensitivity signal.

### 3d. Scheduled Task And Webhook Delivery Controls

Scheduled tasks inherit the boundary of the group that owns the task. Main-group
tasks can target other registered groups only through host authorization; normal
channel groups can manage only their own tasks. Task delivery mode is explicit:
dashboard-only runs stay in task history, chat delivery targets a registered
group, file delivery writes reviewable output under `store/task-deliveries/`,
and webhook delivery creates an approval record before an external request is
sent.

Routine safety controls are evaluated before execution: max runtime, max active
runs, heartbeat stale policy, quiet hours, dry-run/tool policy, provider
fallback policy, and delivery approval policy. Webhook targets and payload
previews are shown in the approval inbox so operators can deny stale, vague, or
incorrect deliveries before any external side effect occurs.

### 4. IPC Authorization

Messages and task operations are verified against group identity:

| Operation                   | Main Group | Non-Main Group |
| --------------------------- | ---------- | -------------- |
| Send message to own chat    | ✓          | ✓              |
| Send message to other chats | ✓          | ✗              |
| Schedule task for self      | ✓          | ✓              |
| Schedule task for others    | ✓          | ✗              |
| View all tasks              | ✓          | Own only       |
| Manage other groups         | ✓          | ✗              |

### 5. Credential Isolation (Built-In Proxy)

Provider credentials should stay behind NanoCrab's built-in credential proxy whenever the runtime supports it. The proxy (`src/credential-proxy.ts`) forwards provider requests and injects credentials in the trusted host process.

**How it works:**

1. Credentials are stored in `.env` or the service environment on the host.
2. NanoCrab starts a loopback-only credential proxy on the host.
3. Containers receive provider base URLs that route through the proxy plus placeholder tokens where needed.
4. The proxy matches the provider route, injects the real credential, and forwards the request.
5. For proxied providers, agents cannot discover real credentials — not in environment, stdin, files, or `/proc`.

**Provider routes:**
Claude, OpenRouter, Google Gemini, and custom OpenAI-compatible API traffic can
be proxied this way. OpenRouter and custom OpenAI-compatible coding jobs also
use the proxy URL plus a placeholder key when a key is configured. Authless
local custom endpoints are allowed through the provider route without injecting
Anthropic credentials. Ollama normally uses a local or LAN endpoint without a
secret. NanoCrab has provider profiles for chat, coding, automations, memory,
journal extraction, skill factory, reports, documents, and vision. Write-capable
profiles should keep `approval-required` tool policy unless the deployment is
explicitly trusted. Live per-model capability probes, per-model coding
capability metadata, and fallback enforcement are implemented; Agents and
Autofix coding selectors use that metadata instead of hardcoded provider
exceptions.

**Explicit Runtime Secret Exceptions:**

- OpenCode coding jobs may receive `OPENCODE_API_KEY` because the OpenCode CLI reads its own credential environment.
- GitHub coding jobs may receive `GITHUB_TOKEN` through an env file plus `GIT_ASKPASS` so clone/fetch/PR flows can run without interactive prompts. Dashboard issue and project-board browsing uses the same host-side token for read-only GitHub API calls.
- Custom MCP servers receive only the env vars listed on that server and only when the connector is inside the agent boundary; scoped connectors are additionally filtered through the MCP tool proxy.
- Google Workspace OAuth vars are forwarded only when a mail, calendar, docs, or drive connector is inside the active boundary.
- Image-generation helpers may receive provider keys such as `FAL_KEY`, `LEONARDO_API_KEY`, or `OPENAI_API_KEY` when those helpers are enabled.
- `NANOCRAB_API_TOKEN` is passed to containers so bundled skills can call the local NanoCrab API; keep it scoped to local runtime use and out of logs, handoff briefs, issue comments, and commits.

**NOT Mounted:**

- Channel auth sessions (`store/auth/`) — host only
- Mount allowlist — external, never mounted
- Any credentials matching blocked patterns
- `.env` is shadowed with `/dev/null` in the project root mount

## Privilege Comparison

| Capability          | Main Group                      | Non-Main Group           |
| ------------------- | ------------------------------- | ------------------------ |
| Project root access | `/workspace/project` (ro)       | None                     |
| Store (SQLite DB)   | `/workspace/project/store` (rw) | None                     |
| Group folder        | `/workspace/group` (rw)         | `/workspace/group` (rw)  |
| Global memory       | Implicit via project            | `/workspace/global` (ro) |
| Additional mounts   | Configurable                    | Read-only unless allowed |
| Network access      | Unrestricted                    | Unrestricted             |
| MCP tools           | Boundary-filtered               | Boundary-filtered        |

## Security Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        UNTRUSTED ZONE                             │
│  Incoming Messages (potentially malicious)                         │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼ Trigger check, input escaping
┌──────────────────────────────────────────────────────────────────┐
│                     HOST PROCESS (TRUSTED)                        │
│  • Message routing                                                │
│  • IPC authorization                                              │
│  • Mount validation (external allowlist)                          │
│  • Container lifecycle                                            │
│  • Credential proxy (injects provider secrets)                   │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼ Explicit mounts only, no secrets
┌──────────────────────────────────────────────────────────────────┐
│                CONTAINER (ISOLATED/SANDBOXED)                     │
│  • Agent execution                                                │
│  • Bash commands (sandboxed)                                      │
│  • File operations (limited to mounts)                            │
│  • Provider API calls routed through NanoCrab credential proxy   │
│  • Runtime secrets limited to explicit tool/CLI exceptions       │
└──────────────────────────────────────────────────────────────────┘
```
