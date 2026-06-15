# Web Chat Threads — Claude Code-style conversations

**Date:** 2026-06-15
**Status:** Approved design, pending implementation plan
**Builds on:** [Mode-first dashboard](2026-06-15-mode-first-dashboard-design.md) (Chat/Work/Code shell)

## Problem

The Chat mode currently mirrors a WhatsApp/Signal agent chat: pick a channel/group
from a dropdown, see one flat message feed, send a message that goes to that group.
There is no notion of a conversation/thread. We want Chat to feel like Claude Code —
independent conversations listed in the sidebar, each its own context, with a
"New conversation" entry point.

## Goal

Add **web threads**: standalone, web-only conversations with an agent, listed in the
Chat-mode sidebar. Each thread is independent and isolated. Web threads are a new,
first-class concept delivered through a dedicated **web channel**, kept entirely
separate from the WhatsApp/Signal channel setup and management.

## Decisions (locked during brainstorming)

- **Thread model:** new first-class concept — standalone web conversations with the
  agent, decoupled from real messaging channels.
- **Agent binding:** pick an agent per thread. The picker offers existing agents as
  **config templates** by default, with an **Advanced** option to set a custom
  provider + model. Picking clones config only (provider/model/MCP/restrictions),
  never the agent's files/memory.
- **Workspace:** **isolated per thread** — each conversation gets its own fresh
  folder + session. The chosen agent is only a config template.
- **Implementation approach:** **dedicated web channel** (Approach B) implementing the
  `Channel` interface. Web threads must NOT mix with WhatsApp/Signal setup or
  management surfaces.
- **UI layout:** threads live in the **Chat-mode sidebar** (Approach A) — single
  sidebar, closest to Claude Code. Raw-channel Messages becomes a secondary link.

## Architecture

### Web channel (`src/channels/web.ts`)

Implements the `Channel` interface and registers in the channel registry:
- `name = 'web'`
- `ownsJid(jid)` → `jid.startsWith('web:')`
- `sendMessage(jid, text)` → **no-op** (resolves successfully, sends nothing). The
  existing reply path in `src/index.ts` already calls `storeMessageDirect(...)` and
  `broadcastMessage(...)` immediately after `channel.sendMessage(...)`, so the reply is
  persisted (`is_bot_message=1`) and pushed to the browser over WebSocket by the
  framework. The web channel must NOT re-store or re-broadcast or it would double-write.
  Nothing leaves the box — the browser is the delivery surface via that existing
  broadcast. (Optional: `setTyping` could drive a typing indicator later; not in v1.)
- `connect` / `disconnect` → no-ops. `ownsJid` is the only routing hook needed.

The web channel is implicit: it is not configured, shown, or health-checked on the
Channels page. Its presence in the registry exists only so the message loop's reply
path (`channel.sendMessage`) resolves for `web:` JIDs instead of throwing
"no channel owns this jid".

### Thread = web-kind conversation

A thread is a registered group with:
- JID `web:<uuid>`
- `kind: 'web'` (new marker field on the registered group)
- an **isolated** folder (e.g. `web-chat-<uuid>`) and a fresh session
- `containerConfig` cloned from the chosen agent template (or a custom
  provider/model), excluding the source agent's folder/memory
- a user-facing `title` (defaults to something like "New conversation", editable;
  may auto-name from the first message — see Open question)

Threads ride the **existing** pipeline unchanged: a user message is stored against the
`web:` JID and `queue.enqueueMessageCheck(jid)` triggers the same message loop →
group processing → container runner → structured-marker parsing → WebSocket broadcast
→ reply persistence used by every channel. Tool calls, approvals, and progress work
for free.

### Separation from real channels (hard requirement)

`kind: 'web'` groups are **excluded** from:
- the Groups page / group management API listings
- the Channels page and channel setup
- dashboard channel health
- Integrations

This is enforced by filtering web-kind groups out of the listing endpoints/state
accessors those surfaces use, and by routing all thread operations through a separate
`/api/threads` namespace rather than `/api/chat` or `/api/groups`.

### API (`src/admin/routes/threads.ts`, mounted at `/api/threads`)

- `GET /api/threads` → list web threads: `{ id, title, lastMessage, lastMessageAt,
  agentLabel }`, newest first.
- `POST /api/threads` → create. Body: `{ templateAgentId?, provider?, model?, title? }`.
  Validates the template (if given) exists; resolves effective config (template clone
  or custom provider/model + default MCP/restrictions); creates the isolated folder;
  registers a `kind:'web'` group with JID `web:<uuid>` and `requiresTrigger:false`
  (so every message in the thread is processed without a trigger prefix); returns
  `{ id }`.
- `GET /api/threads/:id/messages` → messages for that JID (reuses message storage).
- `POST /api/threads/:id/messages` → body `{ message }`: store against the JID +
  `enqueueMessageCheck`.
- `PATCH /api/threads/:id` → body `{ title }`: rename.
- `DELETE /api/threads/:id` → stop/remove the thread's container, delete its folder,
  unregister the group, and delete its messages.
- `GET /api/threads/agent-templates` → list selectable agent templates
  `{ id, label, provider, model }` for the picker (read-only view of existing agent
  configs; does not expose or modify channel setup).

### Frontend

- **Chat-mode sidebar:** when `activeMode === 'chat'`, the mode-scoped section renders
  **"+ New conversation"** then the thread list (from `GET /api/threads`), newest
  first, active thread highlighted, each showing title + relative time. A secondary
  **"Channel messages"** link at the bottom opens the existing raw-channel Messages
  view. This replaces the static `chat`/`messages` page links for Chat mode only;
  Work/Code sidebars are unchanged.
- **Routing:** `#/chat/:threadId` selects a thread (deep-linkable, survives reload);
  `#/chat` opens the most recent thread, or an empty "start a conversation" state when
  there are none. Integrates with the existing hash router / `canonicalPage`.
- **Conversation view (main area):** user/agent message bubbles; **inline tool-call /
  tool-result cards**; **inline approval prompts**; a live **progress** indicator while
  the agent works — all from the existing WebSocket events (`new_message`,
  `tool_call`, `tool_result`, `approval_request`, `task_progress`) filtered to the
  active thread's JID via the existing `handleWsMessage` patch pattern (`window._chatWsRestore`).
  Composer with Send and the existing voice button. Editable title; delete action.
- **New conversation flow:** button → agent picker modal (templates list +
  **Advanced** custom provider/model) → `POST /api/threads` → open the new empty
  thread. Last-used template/provider remembered in `localStorage`.

## Code organization

- **Create:** `src/channels/web.ts`, `src/admin/routes/threads.ts`, a focused frontend
  chat module (thread sidebar + conversation view) — replacing/refactoring the current
  `renderChat` rather than growing `app.js` further.
- **Modify:** channel registry import; `showShell` (chat-mode sidebar branch); the
  listing endpoints/state accessors behind Groups/Channels/dashboard-health/
  Integrations to exclude `kind:'web'`; registered-group type + DB read/write to carry
  `kind`/`title`; thread folder lifecycle helpers.
- **Untouched:** the message loop, queue, container runner, approval flow, and all
  WhatsApp/Signal channel code.

## Error handling

- Thread creation validates the template exists and the effective provider/model is
  usable; failures return a clear error, no partial group/folder left behind.
- Agent/container errors during a run surface inside the thread conversation (reusing
  existing error broadcast), not as a silent failure.
- Deleting a thread is best-effort idempotent: stop container if running, remove
  folder, unregister group, delete messages; partial failures are logged and surfaced.
- A `web:` JID with no backing registered group (e.g. deleted mid-flight) is ignored by
  the message loop.

## Testing

- **Web channel:** `ownsJid` matches only `web:` JIDs; `sendMessage` persists with
  `is_bot_message=1` and broadcasts; no external send.
- **Threads route:** create clones template config, isolates the folder, marks
  `kind:'web'`, returns an id; created web groups are **excluded** from the
  groups/channels listing endpoints; rename/delete behave; delete cleans up.
- **Separation:** a unit/integration check that web-kind groups don't appear in the
  Groups/Channels/health/Integrations listing responses.
- **Frontend:** verified live in the mock admin server — new conversation, thread
  switching, deep-link to `#/chat/:id`, message send + agent reply, tool-call/approval
  rendering, delete; Work/Code sidebars unaffected; no console errors.

## Non-goals

- No changes to WhatsApp/Signal channels, the Groups/Channels management UIs, or the
  agent runtime/message loop beyond the additive web-channel hook and `kind` filtering.
- No multi-user/shared-thread semantics, no branching/forking of conversations.
- No seeding a thread from an agent's existing files/memory (isolation is strict).

## Open questions (resolve during planning; defaults chosen)

- **Auto-title:** default a thread to "New conversation" and let the user rename;
  auto-naming from the first message is a nice-to-have, deferred unless trivial.
- **Concurrency cap:** rely on the existing GroupQueue limits; no separate web-thread
  cap in v1.
