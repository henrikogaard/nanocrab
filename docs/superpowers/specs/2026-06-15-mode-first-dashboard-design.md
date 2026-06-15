# Mode-First Dashboard Redesign — Chat / Work / Code

**Date:** 2026-06-15
**Status:** Approved design, pending implementation plan

## Problem

The NanoCrab admin SPA leads with a deep navigation tree: ~20+ pages across six
sections (Home, Workspace, Tools, Developer, System). New tools like Microsoft
Copilot — and the Claude UI that inspired this request — instead lead with a
small set of **modes** and tuck the machinery underneath. We want the dashboard
to feel mode-first: open into a workspace, not an admin index.

## Goal

Reorganize the shell around three top-level modes — **Chat**, **Work**, **Code** —
with admin/operations demoted to a secondary "More" drawer. This is a full
mode-first rework of the *shell and information architecture*, not a rewrite of
the underlying pages or backend.

## Decisions (locked during brainstorming)

- **Scope:** Full mode-first rework. The three modes become the primary
  top-level surface; everything else collapses into a secondary admin area.
- **Mode names:** `Chat`, `Work`, `Code`. ("Work", not "Cowork" — reads more
  naturally for an agent-ops tool.)
- **Landing:** App reopens the **last used mode** (persisted). First run defaults
  to Chat with a New session.
- **Pages and backend are untouched.** Only the shell (nav, routing layer,
  styling) changes. No API changes.

## Mode → page mapping

| Mode | Pages |
|------|-------|
| 💬 **Chat** — "talk to / through the bot" | Chat, Messages / live feed, Bot response feed, inline Channel status |
| 🤝 **Work** — "agents doing work for you" | Agents, Groups, Tasks, Approvals, Dispatch*, Routines*, Workflows, Reports, Artifacts, Memory, Timeline |
| `</>` **Code** — "hands-on building" | Git & Code, Terminal, AutoFix, Skills, Plugins / Marketplace |
| ⌄ **More** (secondary, not a mode) | Dashboard (ops health), Deploy, Monitoring, Containers, Integrations, Security, Audit, Uptime, Copilot, Settings |

\* **Routines** and **Dispatch** are *also* pinned to the always-present bottom
section of the sidebar so they are reachable from any mode. They conceptually
belong to Work but stay globally accessible.

## The shell

The shell is the frame every page renders inside.

- **Mode switcher** (segmented control: Chat / Work / Code) at the top of the
  sidebar — the single most important control. Switching it swaps the
  mode-scoped section below.
- **"New session"** primary action directly beneath the switcher. Context-aware:
  new chat in Chat, new agent/task in Work, new terminal/repo session in Code.
- **Mode-scoped middle section:** lists only the pages for the active mode. This
  removes the 20-item wall.
- **Always-present bottom section:** Routines, Dispatch, **More** (admin/ops
  drawer), Customize — visible regardless of active mode.
- **Main area:** shows a mode landing (recent sessions + quick-start cards) until
  a page is selected, then renders the active page.
- **Mobile:** the bottom tab bar changes from Home / Chat / Agents / Messages /
  More to **Chat / Work / Code / More**.

## Routing & mode behavior

Introduce a **mode layer above the existing page layer**.

- New `mode` concept: `chat | work | code`, each owning a list of page ids (the
  mapping above), expressed in a single `MODES` config object — one source of
  truth.
- The nav list becomes *derived*: `navItems = pagesForMode[activeMode]` plus the
  always-pinned items. Replaces the hand-maintained nav-items list.
- `activeMode` persists to `localStorage`. On boot, restore the last mode; first
  run → `chat`.
- **Deep links keep working.** Routes stay page-based (`#git-code`, `#agents`,
  …). Navigating to a page resolves and sets `activeMode` to whichever mode owns
  that page, so the correct mode-scoped sidebar shows. No existing URLs/bookmarks
  break.
- **More** is a drawer/overlay, not a mode — selecting an admin page from it does
  not change `activeMode` (or maps to a neutral "admin" context). It lists the
  ops/admin pages.

## Affected code

Frontend-only; pages and backend untouched.

- **`src/admin/public/app.js`**
  - Add `MODES` config (mode → page-id lists) and `activeMode` state with
    `localStorage` persistence.
  - Add mode-switcher rendering.
  - Refactor the nav builder (currently ~lines 502–551) to be mode-derived
    instead of a flat list.
  - Router tweak: on navigation, resolve a page's owning mode and set
    `activeMode` so the sidebar stays consistent (incl. deep links).
- **`src/admin/public/style.css`**
  - Mode-switcher segmented control.
  - Restyle sidebar sections (~854–1108) into "mode-scoped" + "pinned (always
    present)" groupings.
  - Update mobile bottom bar to Chat / Work / Code / More.
- **`src/admin/public/pages/*.js`** — unchanged. They continue to render into the
  main area.
- **Backend / API** — no changes.

## Non-goals

- No changes to page internals, data flow, or backend APIs.
- No new pages or features — pure information-architecture/shell rework.
- No redesign of individual page contents (e.g. the ops Dashboard's internals).

## Risks & properties

- **Low risk / incrementally shippable:** because pages are unchanged and routes
  preserved, the shell can ship without touching feature surfaces.
- **Main migration risk** is mis-bucketing a page (a page feels like it's in the
  wrong mode). Mitigated by the single `MODES` config — re-bucketing is a
  one-line change.
- **Discoverability of demoted admin pages:** operators who lived in the ops
  Dashboard must learn it now lives under "More". Mitigated by keeping deep
  links/bookmarks working and (optionally) a one-time pointer.

## Testing

- Mode switching shows the correct mode-scoped page set; pinned items always
  present in every mode.
- `activeMode` persists across reloads; first run defaults to Chat.
- Deep-linking directly to a page (e.g. `#agents`, `#security`) sets the correct
  active mode / admin context and renders the right sidebar.
- Every page in the pre-redesign nav remains reachable (no orphaned pages).
- Mobile bottom bar reflects Chat / Work / Code / More and navigates correctly.
