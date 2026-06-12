# Agent Session Page — Design Spec

## Overview

Replace the current inline session viewer (simple flat message list) with a dedicated Agent Session Detail page featuring a customizable stats header bar and full-featured transcript with inline tool call details.

Belongs to the Better Web Chat/Terminal v1 epic (Sub-project C). Follows Sub-project A (Terminal Improvements) and Sub-project B (Chat Workflow) which are complete.

## Page Architecture

### Navigation flow

Two pages:

1. **Sessions list** (`renderSessions`)— unchanged from today. Shows all sessions with search/filter. "View" button navigates to detail page.

2. **Session Detail** (`renderSessionDetail`) — new dedicated page registered in the page router (`_pageMap`). Accessible via `navigate('session-detail', { sessionId, group })`.

Breadcrumb at top: `Sessions > {sessionId}` linking back to sessions list.

The detail page replaces the current inline viewer (`viewSession` function in app.js) which loads session content into a div within the sessions page. The new approach uses the same page routing system as all other admin pages.

### API

A new consolidated session detail endpoint:

```
GET /api/sessions/:group/:sessionId/detail

Response:
{
  "id": "session-abc123",
  "group": "my-group",
  "stats": {
    "messageCount": 12,
    "duration": 154,
    "toolCount": 7,
    "model": "claude-3.5-sonnet",
    "tokenCount": 4201,
    "cost": 0.08,
    "errorCount": 0,
    "createdAt": "2026-06-12T10:00:00Z",
    "endedAt": "2026-06-12T10:02:34Z"
  },
  "messages": [
    {
      "role": "user",
      "content": "What's in config.ts?",
      "timestamp": "2026-06-12T10:00:05Z",
      "type": "user"
    },
    {
      "role": "assistant",
      "content": "The config defines the port and host.",
      "timestamp": "2026-06-12T10:00:15Z",
      "type": "assistant",
      "toolCalls": [
        {
          "id": "tc_1",
          "name": "read_file",
          "input": "{\"path\":\"config.ts\"}",
          "output": "{\"content\":\"module.exports = ...\"}",
          "duration": "0.342"
        }
      ]
    }
  ]
}
```

The existing `GET /:group/:sessionId` endpoint is preserved for backward compatibility but the new detail endpoint adds stats computation and structured tool call data.

Stats are computed server-side by scanning the JSONL file:
- `messageCount` — total user + assistant messages
- `duration` — seconds between first and last message
- `toolCount` — total tool_use blocks across all assistant messages
- `model` — extracted from session metadata or first assistant message
- `tokenCount` — from session metadata if available
- `cost` — from session metadata if available
- `errorCount` — count of error-type messages
- `createdAt` / `endedAt` — from first/last message timestamps

## Stats Header Bar

### Layout

Two-row compact bar at the top of the session detail page:

```
┌─────────────────────────────────────────────────────────────┐
│ Messages: 12  │  Duration: 2m 34s  │  Tools: 7  │  ⚙      │
│ Model: claude-3.5-sonnet  │  Tokens: 4,201  │  Cost: $0.08  │
└─────────────────────────────────────────────────────────────┘
```

### Available stats

| Stat | Source | Default visible |
|------|--------|-----------------|
| Messages | `messageCount` | Row 1 |
| Duration | Formatted from `duration` (seconds → human) | Row 1 |
| Tools | `toolCount` | Row 1 |
| Model | `model` | Row 2 |
| Tokens | `tokenCount` (formatted with commas) | Row 2 |
| Cost | `cost` (formatted as currency) | Row 2 |
| Errors | `errorCount` if > 0 | Row 2 |
| Session ID | `id` (truncated) | Off by default |
| Created | Formatted `createdAt` | Off by default |

### Customization

- Click ⚙ to toggle which stats are visible
- Choices stored in localStorage key `session_stat_visibility`
- Affects all session views (not per-session)
- First row always shows at least 2 stats, second row always shows at least 1

### Implementation

Pure frontend: stat visibility is a UI preference stored in localStorage. The stats data comes from the API response. No backend changes needed for customization.

## Full Transcript

### Message rendering

Each message renders as a clear card in a vertical flow:

**User messages:**
- Right-aligned accent bubble (reuses existing `.chat-msg-user` style)
- Timestamp in header
- Full content (no 2000-char truncation)

**Assistant messages:**
- Left-aligned (reuses existing `.chat-msg-bot` style)
- Role label + model name in header
- Full content text
- Collapsible tool call cards below the text, rendered after each assistant message that triggered them
- Tool calls use the same `.chat-tool-call` CSS that was added for Chat Workflow (Task 4), ensuring visual consistency between the chat page and session transcript

**System/event messages (errors, session boundaries):**
- Subtle centered timeline entry with muted styling
- Displayed as: `Session started`, `Agent processing`, `Error: connection refused`

### Tool call rendering

Tool calls are extracted from the session JSONL data (the backend already detects `tool_use` blocks in the existing `GET /:group/:sessionId` endpoint). The new detail endpoint returns them as structured `toolCalls` arrays on each assistant message.

Each tool call renders as a collapsible card:
```
┌─ 🔧 read_file ──────────────────── ✓ 0.3s ─┐
│ Input: { "path": "config.ts" }              │
│ Output: { "content": "..." }                │
└─────────────────────────────────────────────┘
```

- Cards collapsed by default
- Click header to expand and show input/output
- Duration shown in header
- Multiple tool calls in one message stack vertically

## Files Changed

### Backend

| File | Change |
|------|--------|
| `src/admin/routes/sessions.ts` | Add `GET /:group/:sessionId/detail` endpoint that computes stats + extracts structured tool calls |

### Frontend

| File | Change |
|------|--------|
| `src/admin/public/app.js` | Add `renderSessionDetail()` page function, update `_pageMap`, update `renderSessions` to navigate to detail page, add stat customization UI, wire existing `.chat-tool-call` CSS into session transcript |
| `src/admin/public/style.css` | Add CSS for stats header bar, session detail page layout |

## Out of Scope (v1)

- Session comparison (diff two sessions side-by-side)
- Session replay (step through messages one at a time)
- Export session as PDF/markdown
- Session annotations/user notes
- Real-time session watching (live agent output in session view)
