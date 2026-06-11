---
name: connector-operator
description: Use external connectors safely. Inspect readiness, missing credentials, permission scopes, and approval requirements before reading or writing through channels, MCP servers, email, calendar, GitHub, kDrive, or DAV tools.
triggers: connector, integration, gmail, email, calendar, github, kdrive, infomaniak, mcp, webhook, credentials
examples: check connector setup, use my email, send a calendar invite, upload to kDrive, create a GitHub comment
risk-level: high
allowed-tools: mcp__nanocrab__*, mcp__github__*, mcp__google-workspace__*, mcp__infomaniak__*
---

# Connector Operator

Use this skill whenever a request depends on an external connector such as a
messaging channel, GitHub, Gmail, Calendar, Infomaniak mail, kDrive, contacts,
or DAV-backed resources.

## Workflow

1. Identify the connector and whether the task is read-only or write-capable.
2. Check connector readiness from the dashboard catalog when available, or infer
   it from available MCP tools and missing-credential errors.
3. State missing credentials, missing MCP presets, or unavailable tools before
   attempting work.
4. For read-only work, keep searches narrow and summarize metadata first when
   the source may contain private data.
5. For write-capable work, draft the intended action and ask for explicit
   approval before sending, uploading, deleting, moving, publishing, inviting,
   commenting, assigning, or mutating external state.
6. After approval, perform the smallest action that satisfies the request and
   report what changed, where, and any follow-up needed.

## Permission Model

Treat these scopes as approval-gated unless the user has explicitly approved
the exact action in the current workflow:

- `messages:send`
- `gmail:send`
- `mail:send`
- `calendar:write`
- `issues:write`
- `pull-requests:write`
- `kdrive:write`
- `dav:write`

Read scopes such as `messages:read`, `gmail:read`, `mail:read`, and
`issues:read` do not require approval by themselves, but still require privacy
care and narrow queries.

## Connector Readiness

Common readiness checks:

- GitHub requires `GITHUB_TOKEN` and the GitHub MCP/server tools.
- Google Workspace requires OAuth client credentials and refresh token.
- Infomaniak requires token, kDrive id, mail credentials, and DAV credentials
  depending on the requested workflow.
- Telegram requires `TELEGRAM_BOT_TOKEN`.
- Signal requires `SIGNAL_PHONE_NUMBER` and a working signal-cli account.
- WhatsApp requires a paired account in `store/auth/`.

If a connector is not ready, explain the missing setup and offer the safest
next step. Do not improvise with unrelated channels or accounts.
