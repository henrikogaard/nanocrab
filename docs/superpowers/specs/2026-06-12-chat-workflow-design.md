# Chat Workflow Improvements — Design Spec

## Overview

Enhance the Dashboard Chat page with four integrated features: provider/model selection, tool-call timeline, inline approve/deny, and live task progress. Uses a structured marker protocol embedded in the agent's text output stream — the same pattern as existing `<internal>...</internal>` tag stripping.

Belongs to the larger Better Web Chat/Terminal v1 epic (Sub-project B). Follows Sub-project A (Terminal Improvements) which is complete.

## Architecture: Structured Marker Protocol

All four features share a common mechanism: the agent emits parseable XML-style markers in its text output. The backend extracts these in the `onOutput` streaming callback (`processGroupMessages` in `src/index.ts`), strips them from visible text, and routes them as typed WebSocket events to the dashboard.

No container rebuilds required. Works with all providers. Markers are invisible to end users on WhatsApp/Telegram/Signal channels — only the dashboard sees them.

### Marker format rules
- Self-closing tags: `<tool_call ... />`, `<tool_result ... />`, `<approval_request ... />`, `<progress ... />`
- Attributes are JSON-stringified where needed (e.g., `input='{"path":"file.ts"}'`)
- Backend strips any unknown markers from output as well (forward-compatible)
- If markers contain newlines or special chars, use `CDATA` or base64 encoding — start with simple attribute values

## Provider/Model Selector

### Backend

- `GET /api/groups/:jid/provider` — returns `{ providerId: string, model: string }` from group config
- `PUT /api/groups/:jid/provider` — accepts `{ providerId, model }`, updates group's provider config, invalidates active container so it picks up changes on next message
- Endpoints added to `routes/groups.ts` (existing groups router)
- Available providers list already served by `GET /api/providers` (mock-data.ts / provider-router)

### Frontend

- Chat page: next to the group selector dropdown, show a compact badge: `claude-3.5-sonnet` with a pencil icon
- Clicking opens a small inline popover listing available providers from `GET /api/providers`
- Selecting a provider shows its available models; selecting a model sends `PUT` and shows a toast confirmation
- Read-only view shows current selection at all times; pencil icon toggles edit mode

## Tool-Call Timeline

### Marker format

Agent emits in output stream:
```
<tool_call id="tc_1" name="read_file" input='{"path":"src/config.ts"}' />
<tool_result id="tc_1" output='{"content":"..."}' duration="0.342" />
```

`id` correlates call with result. `input` and `output` are JSON-stringified objects.

### Backend

In `onOutput` callback (`src/index.ts` `processGroupMessages`):
- Regex extract `<tool_call ... />` and `<tool_result ... />`
- Strip from visible text before forwarding to channel
- Broadcast typed WS events:
  - `{ type: 'tool_call', data: { id, name, input, groupJid, timestamp } }`
  - `{ type: 'tool_result', data: { id, output, duration, groupJid } }`
- Maintain a `pendingToolCalls` map per group (id → tool_call) to track unresolved calls

### Frontend

- Chat page subscribes to `tool_call`/`tool_result` WS events for the selected group
- Tool calls render as collapsible inline cards below the message that triggered them
- Pending state (no matching `tool_result` yet): spinner + "Running..."
- Completed state: green checkmark + duration
- Cards collapsed by default; click to expand and show input/output
- Pre-existing tool calls (from session history JSONL) rendered identically when viewing past sessions

## Inline Approve/Deny

### Marker format

Agent emits when it needs approval for a sensitivity-matched action:
```
<approval_request id="ar_1" tool="write_file" reason="Modifying /etc/config.yaml" input='{"path":"/etc/config.yaml"}' />
```

### Sensitivity config

Each group's configuration defines which tool categories require approval:
```
approval_rules: ["write_file", "command", "external_api"]
```

Defined in group metadata (stored alongside existing group config). AGENTS.md instructions tell the agent to emit `<approval_request>` for matching tool types.

### Backend flow

1. Agent emits `<approval_request>` in output stream
2. `onOutput` callback extracts it, strips from visible text, broadcasts `{ type: 'approval_request', data: { id, tool, reason, input, groupJid } }` to dashboard
3. Backend pauses further output forwarding for this group's agent (holds the streaming callback; buffers non-structured output)
4. Dashboard user clicks Approve/Deny → `POST /api/chat/approve` with `{ approvalId, groupJid, approved: boolean }`
5. Backend writes decision file to `data/runtime-skills/{group}/.approval/{id}.{approved|denied}`
6. On next message loop poll, the agent's prompt includes: `[Approval granted/denied for write_file /etc/config.yaml]`
7. If denied, agent receives the denial and adjusts behavior; if granted, agent re-executes the tool
8. Output buffering resumes, held output is released

### Frontend

- `approval_request` WS event shows an inline card:
  - Warning icon + "Approval Required" header
  - Tool name, reason, expandable input details
  - Approve (green) and Deny (red) buttons
- Card persists until user acts or timeout (configurable, default 5 min)
- Multiple pending approvals stack chronologically

## Live Task Progress

### Marker format

Agent emits in output stream:
```
<progress phase="researching" pct="15">Researching codebase structure...</progress>
<progress phase="writing" pct="50">Writing implementation...</progress>
<progress phase="testing" pct="85">Running tests...</progress>
<progress phase="done" pct="100">Complete</progress>
```

### Backend

- In `onOutput` callback, extract `<progress ... />` markers via regex
- Strip from visible text
- Broadcast `{ type: 'task_progress', data: { phase, pct, message, groupJid } }`
- Maintain a `groupProgress` map (groupJid → last progress state) so late-connecting chat clients get current status

### Frontend

- Minimal status bar below chat input area, only visible while agent is processing
- Shows phase name + animated progress bar + percentage
- Clicking the bar expands to show a phase history timeline
- Status bar auto-hides 3 seconds after receiving `pct="100"` or `phase="done"`
- Fallback: if no progress markers received within 30s of sending a message, shows generic "Agent is thinking..." with a spinner
- Transitions between phases are animated (smooth bar fill, phase label crossfade)

## WebSocket Protocol

New server → client message types (added to existing `websocket.ts` handler):

| Type | Payload | Source |
|------|---------|--------|
| `tool_call` | `{ id, name, input, groupJid, timestamp }` | Marker extracted from agent output |
| `tool_result` | `{ id, output, duration, groupJid }` | Marker extracted from agent output |
| `approval_request` | `{ id, tool, reason, input, groupJid }` | Marker extracted from agent output |
| `task_progress` | `{ phase, pct, message, groupJid }` | Marker extracted from agent output |
| `approval_result` | `{ id, groupJid, approved }` | Confirmation after POST /api/chat/approve |

## Files Changed

### Backend

| File | Change |
|------|--------|
| `src/index.ts` | Update `processGroupMessages` streaming callback to extract markers, broadcast WS events, pause/resume output on approval |
| `src/admin/routes/groups.ts` | Add `GET /api/groups/:jid/provider`, `PUT /api/groups/:jid/provider` endpoints |
| `src/admin/routes/chat.ts` (new) | `POST /api/chat/approve` endpoint |
| `src/admin/websocket.ts` | Add WS broadcast helpers for `tool_call`, `tool_result`, `approval_request`, `task_progress`, `approval_result` types |
| `src/admin/state.ts` or group config | Add `approval_rules` storage per group |

### Frontend

| File | Change |
|------|--------|
| `src/admin/public/app.js` | Update `renderChat()` — provider selector, tool-call cards, approve/deny UI, progress bar; update `handleWsMessage` for new event types |
| `src/admin/public/style.css` | New CSS classes for tool-call cards, approve/deny inline UI, progress bar, provider selector |

## Out of Scope (v1)

- Agent-initiated inline edits (user edits file content inline before approval)
- Tool-call replay (re-run a tool call with modified args)
- Multi-user approval workflow (only single dashboard admin)
- Approval audit log (beyond the existing message history)
- Progress sharing to WhatsApp/Telegram (dashboard-only)

## Marker Protocol Maintenance

The marker protocol is intentionally simple. If agent output formatting is unreliable, tighten via AGENTS.md:
```
When calling tools, emit <tool_call id="..." name="..." input="..." /> before executing.
After the result, emit <tool_result id="..." output="..." duration="..." />.
For sensitive tool types (write_file, command, external_api), pause and emit
<approval_request id="..." tool="..." reason="..." input="..." /> and wait for approval.
Emit <progress phase="..." pct="...">message</progress> periodically during long tasks.
```

The backend tolerates missing markers gracefully (fallback to generic spinner, or skip tool-call cards if no structured data).
