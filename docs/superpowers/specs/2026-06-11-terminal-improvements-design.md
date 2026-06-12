# Terminal Improvements — Design Spec

## Overview

Replace the current DevHub > Terminal tab (simple xterm.js shell) with a split-pane tab-in-pane layout featuring file-backed persistent sessions, history search, and robust WebSocket reconnection.

Belongs to the larger Better Web Chat/Terminal v1 epic, decomposed into three sequential sub-projects (A: Terminal, B: Chat Workflow, C: Agent Session Page). This spec covers Sub-project A only.

## Backend: File-Backed Session Persistence

Currently terminal sessions are pure in-memory (bash process + transcript string). Server restart loses everything.

### Session storage

- On terminal spawn, open a write stream to `store/sessions/{sessionId}.log`
- Write all stdout/stderr to both the in-memory transcript AND the log file
- On server start, scan `store/sessions/` for `.log` files, load metadata into a `historicalSessions` map
- `terminal_attach` works for both active (has running process) and historical (file-only, ended) sessions
- Prune logs older than 30 days
- Session metadata written to `store/sessions/index.json` (id, name, owner, created_at, ended_at, bytes)

### Session lifecycle

- `terminal_spawn` — creates bash process + log file. If session ID already exists for an ended session, reuses it (new bash, old transcript available in history)
- `terminal_input` — stdin to bash (unchanged)
- `terminal_attach` — reconnects to active or historical session, sends transcript
- `terminal_close` — kill bash, finalize log file, update index
- `terminal_output` — broadcast from bash stdout/stderr (unchanged)
- Idle timeout: increased from 30 min to configurable (default 2 hours) since file-backed sessions are cheap. Light process-kill timer still exists to avoid stale bash processes.

## WebSocket Reconnect Handling

- Frontend stores session ID in localStorage (already done)
- After WS reconnects, frontend auto-sends `terminal_attach` with the stored session ID
- Backend re-adds the WS client to the session's client set, replays transcript from file or memory
- If the session process has died, the user gets a read-only view with a "Start New" button
- No change to existing WebSocket auth flow (token in query param)

## Session History API

### Endpoints

- `GET /api/sessions/terminal/history` — list past sessions (id, name, owner, duration, byte size, created_at, ended_at)
- `GET /api/sessions/terminal/:id/transcript` — full transcript content
- `POST /api/sessions/terminal/search` — `{ query, sessionId?, dateFrom?, dateTo? }` returns matching lines with line numbers

### Directory layout

```
store/sessions/
  ├── {sessionId}.log         # Full terminal output
  └── index.json               # Session metadata index
```

`index.json` format:

```json
[
  {
    "id": "term-abc123",
    "name": "term-abc123",
    "owner": "owner",
    "createdAt": "2026-06-11T12:00:00Z",
    "endedAt": null,
    "bytes": 48291,
    "file": "store/sessions/term-abc123.log"
  }
]
```

## Frontend: Split-Pane Layout

### Location

DevHub > Terminal tab (replaces current simple xterm.js view)

### Layout

- Two-column flex layout with a draggable CSS divider between them
- Divider position stored in localStorage (`terminal_split_pos`)
- On mobile (<768px): stacks vertically, terminal on top

### Left column tabs

| Tab | Content |
|-----|---------|
| Terminal | xterm.js shell (unchanged, but re-mounted in new container) |
| Files | File tree from Git & Code > Editor, reusing existing `openEditorFile` API |

### Right column tabs

| Tab | Content |
|-----|---------|
| Logs | Reuses existing log streamer from Monitoring > Logs (`subscribe_logs` WS message) |
| Search | New search UI: input + date range + results list |

### Implementation approach

- **Approach 3: Native Split Layout** — CSS flex + existing `renderTabs()` + `switchTab()` functions
- No new dependencies
- Reuses existing file tree, log viewer, and xterm components
- Reuses existing `loadScript`/`loadCss` helpers for xterm.js loading

## Search

Two layers:

### Inline Ctrl+F (terminal buffer)

- Load `@xterm/addon-search` from CDN alongside xterm.js
- Ctrl+Shift+F opens a search overlay within the terminal
- Highlight matches, Enter/Shift+Enter to navigate

### History search (right column Search tab)

- Text input with autocomplete (recent searches from sessionStorage)
- Optional date range filter (start/end date inputs)
- Optional session filter (dropdown from history list)
- Results list showing: session name, matching line (with context), timestamp
- Each result has "View in Transcript" button that opens the full session transcript in read-only terminal mode

### API

```
POST /api/sessions/terminal/search
{ "query": "error", "dateFrom": "2026-06-01", "dateTo": "2026-06-11", "sessionId": "term-abc" }

Response:
{ "results": [
  { "sessionId": "term-abc", "line": 142, "text": "error: connection refused", "context": "...", "timestamp": "..." }
]}
```

## Files Changed

### Backend (`src/admin/`)

- `websocket.ts` — file-backed session logging, improved attach, session history API routes
- `routes/sessions.ts` — add terminal history/search endpoints (or add to websocket.ts)
- `config.ts` — add `SESSIONS_DIR` constant, `TERMINAL_IDLE_TIMEOUT_MS`

### Frontend (`src/admin/public/`)

- `app.js` — `renderTerminal()` completely rewritten for split-pane layout; file tree and log viewer embedding
- `style.css` — new split-pane CSS classes (`.split-container`, `.split-divider`, `.pane`, `.pane-tabs`)

## Out of Scope (v1)

- Tab dragging to rearrange
- Layout configuration UI (save/load presets)
- Session sharing or broadcast
- Embedded Monaco/code editor in the split pane (files tab links to editor page)
- Terminal themes UI (uses existing xterm theme from CSS variables)
