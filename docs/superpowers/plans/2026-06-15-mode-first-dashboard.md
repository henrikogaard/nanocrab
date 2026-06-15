# Mode-First Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the NanoCrab admin SPA shell around three top-level modes — Chat / Work / Code — with admin/ops demoted to a secondary "More" drawer, while keeping every existing page and route working.

**Architecture:** All navigation logic that can be made DOM-free is extracted into a new pure module `src/admin/public/modes.js` (config + helpers), unit-tested with vitest. The existing `showShell()` in `app.js` is refactored to consume that module: it renders a mode switcher, a mode-scoped page list, an always-present footer (Customize / More / Help), and a "More" admin drawer. Routes stay page-based (`#/<page>`); the active mode is *derived* from the current page so deep links keep working, and the last-used mode is persisted to `localStorage`. Pages (`pages/*.js`) and all backend code are untouched.

**Tech Stack:** Vanilla browser JS (classic `<script defer>`, no bundler), CSS custom properties, vitest (Node, ESM) for the pure-logic tests. The browser frontend has no DOM test harness (vitest globs `src/**/*.test.ts` only, no jsdom), so DOM/CSS tasks are verified manually via the mock admin server (`npm run mock:admin`).

**Key constraints discovered:**
- Browser code lives in `src/admin/public/*.js` and is **copied verbatim** by the build (`cp -r src/admin/public dist/admin/public`) — it is NOT compiled. So `modes.js` must be plain classic-script JS (no `import`/`export` keywords).
- Classic `<script defer>` tags execute in document order, so loading `modes.js` before `app.js` in `index.html` guarantees `window.NanoModes` exists when `app.js` runs.
- `package.json` has `"type": "module"`, so the vitest `.ts` test imports `modes.js` for its side effect (it assigns `globalThis.NanoModes`).
- Routines/Dispatch from the original screenshot have no backing pages and are **out of scope** here (noted as future work).

---

## File Structure

- **Create** `src/admin/public/modes.js` — pure mode config (`MODES`, `MODE_ORDER`, `MORE_IDS`) and helpers (`resolveMode`, `navPagesForMode`, `loadActiveMode`, `saveActiveMode`). Assigns `globalThis.NanoModes`.
- **Create** `src/admin/modes.test.ts` — vitest unit tests for the helpers above.
- **Modify** `src/admin/public/index.html:18` — add `<script defer src="/modes.js?v=...">` before `app.js`.
- **Modify** `src/admin/public/app.js` — `showShell()` nav builder (~502–609), shell markup (~611–652), `navigate`/`hashchange`/init (~9896–9925); add `window.setMode`, `window.toggleMoreDrawer`.
- **Modify** `src/admin/public/style.css` — mode switcher segmented control, sidebar section styles (~854–1108), More drawer, mobile bottom bar.

---

## Task 1: Pure mode config + `resolveMode`

**Files:**
- Create: `src/admin/public/modes.js`
- Test: `src/admin/modes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/admin/modes.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';

// modes.js is a classic-script IIFE that assigns globalThis.NanoModes.
// Importing it for its side effect populates the global.
beforeAll(async () => {
  await import('./public/modes.js');
});

const M = () => (globalThis as any).NanoModes;

describe('MODES config', () => {
  it('exposes three modes in order', () => {
    expect(M().MODE_ORDER).toEqual(['chat', 'work', 'code']);
  });

  it('every mode page id is unique across modes', () => {
    const all = M().MODE_ORDER.flatMap((m: string) => M().MODES[m].pages);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('resolveMode', () => {
  it('maps a chat page to the chat mode', () => {
    expect(M().resolveMode('messages')).toBe('chat');
  });
  it('maps a work page to the work mode', () => {
    expect(M().resolveMode('approvals')).toBe('work');
  });
  it('maps a code page to the code mode', () => {
    expect(M().resolveMode('gitcode')).toBe('code');
  });
  it('returns null for an admin/ops (More) page', () => {
    expect(M().resolveMode('security')).toBeNull();
  });
  it('returns null for an unknown page', () => {
    expect(M().resolveMode('does-not-exist')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/admin/modes.test.ts`
Expected: FAIL — `Cannot find module './public/modes.js'` (file not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/admin/public/modes.js`:

```js
// NanoCrab — mode-first navigation config & pure helpers.
// Loaded as a classic <script defer> BEFORE app.js (sets window.NanoModes),
// and imported by vitest for unit tests (sets globalThis.NanoModes).
// Plain classic-script JS only: no import/export (build copies this verbatim).
(function () {
  const MODES = {
    chat: {
      id: 'chat',
      label: 'Chat',
      icon: 'chat',
      pages: ['chat', 'messages'],
    },
    work: {
      id: 'work',
      label: 'Work',
      icon: 'agents',
      pages: [
        'agents',
        'groups',
        'tasks',
        'approvals',
        'sessions',
        'workflows',
        'reports',
        'artifacts',
        'memory',
        'timeline',
      ],
    },
    code: {
      id: 'code',
      label: 'Code',
      icon: 'gitcode',
      pages: ['gitcode', 'devhub', 'autofix', 'skills', 'marketplace'],
    },
  };
  const MODE_ORDER = ['chat', 'work', 'code'];

  // Admin / operations pages — reachable via the "More" drawer, not a mode.
  const MORE_IDS = [
    'dashboard',
    'pipelines',
    'monitoring',
    'containers',
    'integrations',
    'webhooks',
    'credentials',
    'security',
    'audit',
    'uptime',
    'copilot',
    'backup',
    'usage',
    'settings',
    'help',
  ];

  function resolveMode(pageId, modes, order) {
    modes = modes || MODES;
    order = order || MODE_ORDER;
    for (const m of order) {
      if (modes[m] && modes[m].pages.indexOf(pageId) !== -1) return m;
    }
    return null;
  }

  const NanoModes = { MODES, MODE_ORDER, MORE_IDS, resolveMode };
  const g = typeof globalThis !== 'undefined' ? globalThis : window;
  g.NanoModes = NanoModes;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/admin/modes.test.ts`
Expected: PASS (all tests in this file green).

- [ ] **Step 5: Commit**

```bash
git add src/admin/public/modes.js src/admin/modes.test.ts
git commit -m "feat(admin): add mode config and resolveMode helper"
```

---

## Task 2: `navPagesForMode` helper

**Files:**
- Modify: `src/admin/public/modes.js`
- Test: `src/admin/modes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/admin/modes.test.ts`:

```ts
describe('navPagesForMode', () => {
  it('returns the page list for a mode (a copy, not the original)', () => {
    const pages = M().navPagesForMode('chat');
    expect(pages).toEqual(['chat', 'messages']);
    pages.push('tampered');
    expect(M().MODES.chat.pages).toEqual(['chat', 'messages']);
  });
  it('returns an empty array for an unknown mode', () => {
    expect(M().navPagesForMode('nope')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/admin/modes.test.ts`
Expected: FAIL — `M().navPagesForMode is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/admin/public/modes.js`, add the function before the `NanoModes` object and include it in the export:

```js
  function navPagesForMode(modeId, modes) {
    modes = modes || MODES;
    return modes[modeId] ? modes[modeId].pages.slice() : [];
  }

  const NanoModes = {
    MODES,
    MODE_ORDER,
    MORE_IDS,
    resolveMode,
    navPagesForMode,
  };
```

(Replace the existing `const NanoModes = { ... }` line with the version above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/admin/modes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/public/modes.js src/admin/modes.test.ts
git commit -m "feat(admin): add navPagesForMode helper"
```

---

## Task 3: Active-mode persistence helpers

**Files:**
- Modify: `src/admin/public/modes.js`
- Test: `src/admin/modes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/admin/modes.test.ts`:

```ts
function mkStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe('loadActiveMode', () => {
  it('defaults to the first mode when storage is empty', () => {
    expect(M().loadActiveMode(mkStore())).toBe('chat');
  });
  it('returns the saved mode when valid', () => {
    const s = mkStore();
    s.setItem('active_mode', 'code');
    expect(M().loadActiveMode(s)).toBe('code');
  });
  it('falls back to the first mode when saved value is invalid', () => {
    const s = mkStore();
    s.setItem('active_mode', 'garbage');
    expect(M().loadActiveMode(s)).toBe('chat');
  });
});

describe('saveActiveMode', () => {
  it('persists a valid mode and reports success', () => {
    const s = mkStore();
    expect(M().saveActiveMode('work', s)).toBe(true);
    expect(s.getItem('active_mode')).toBe('work');
  });
  it('rejects an invalid mode without writing', () => {
    const s = mkStore();
    expect(M().saveActiveMode('garbage', s)).toBe(false);
    expect(s.getItem('active_mode')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/admin/modes.test.ts`
Expected: FAIL — `M().loadActiveMode is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/admin/public/modes.js`, add both functions before the `NanoModes` object and include them in it:

```js
  function loadActiveMode(storage, order) {
    order = order || MODE_ORDER;
    let saved = null;
    try {
      saved = storage && storage.getItem('active_mode');
    } catch {
      saved = null;
    }
    return order.indexOf(saved) !== -1 ? saved : order[0];
  }

  function saveActiveMode(modeId, storage, order) {
    order = order || MODE_ORDER;
    if (order.indexOf(modeId) === -1) return false;
    try {
      if (storage) storage.setItem('active_mode', modeId);
      return true;
    } catch {
      return false;
    }
  }

  const NanoModes = {
    MODES,
    MODE_ORDER,
    MORE_IDS,
    resolveMode,
    navPagesForMode,
    loadActiveMode,
    saveActiveMode,
  };
```

(Replace the existing `const NanoModes = { ... }` line accordingly.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/admin/modes.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/admin/public/modes.js src/admin/modes.test.ts
git commit -m "feat(admin): add active-mode persistence helpers"
```

---

## Task 4: Load `modes.js` in the page

**Files:**
- Modify: `src/admin/public/index.html:18`

- [ ] **Step 1: Add the script tag before app.js**

In `src/admin/public/index.html`, immediately before the existing line:

```html
  <script defer src="/app.js?v=2.0.0-beta.1"></script>
```

insert:

```html
  <script defer src="/modes.js?v=2.0.0-beta.1"></script>
```

(Classic defer scripts run in document order, so `window.NanoModes` is defined before `app.js` executes.)

- [ ] **Step 2: Verify it loads**

Run: `npm run mock:admin` (starts the mock admin server; note the printed URL, typically http://localhost:3000).
In the browser devtools console on that page, run: `window.NanoModes.MODE_ORDER`
Expected: `['chat', 'work', 'code']`. Stop the server (Ctrl-C) when done.

- [ ] **Step 3: Commit**

```bash
git add src/admin/public/index.html
git commit -m "feat(admin): load modes.js before app.js"
```

---

## Task 5: Add active-mode state + mode switcher to the shell

**Files:**
- Modify: `src/admin/public/app.js` (top-level state near line 4; `showShell` ~498–652; add `window.setMode`)

- [ ] **Step 1: Add module-level mode state**

Near the top of `app.js`, after `let currentPage = '';` (line 4), add:

```js
let activeMode = 'chat';
```

- [ ] **Step 2: Initialize/derive the mode at the top of `showShell`**

In `showShell(page)`, replace the opening:

```js
function showShell(page) {
  stopPolling();
  currentPage = page;
```

with:

```js
function showShell(page) {
  stopPolling();
  currentPage = page;
  // Derive the active mode from the page being shown (deep links land in the
  // correct mode). Admin/More pages resolve to null and keep the last mode.
  const NM = window.NanoModes;
  const ownerMode = NM.resolveMode(page);
  if (ownerMode) {
    activeMode = ownerMode;
    NM.saveActiveMode(activeMode, window.localStorage);
  }
```

- [ ] **Step 3: Add the `setMode` handler**

After `showShell` ends (after its closing `}` at ~line 671), add:

```js
window.setMode = function (mode) {
  const NM = window.NanoModes;
  if (NM.MODE_ORDER.indexOf(mode) === -1) return;
  activeMode = mode;
  NM.saveActiveMode(mode, window.localStorage);
  // Open the first page of the chosen mode.
  const first = NM.navPagesForMode(mode)[0];
  if (first) navigate(first);
};
```

- [ ] **Step 4: Render the mode switcher in the sidebar markup**

In the sidebar markup, replace the header block at ~line 627:

```js
        <div class="sidebar-header"><span class="brand-mark">${brandLogo()}</span><div><h1>${esc(botName)}</h1><span>${window._editionShort || 'NanoCrab'}</span></div></div>
        <div class="sidebar-nav">${navHtml}</div>
```

with (adds the switcher between header and nav):

```js
        <div class="sidebar-header"><span class="brand-mark">${brandLogo()}</span><div><h1>${esc(botName)}</h1><span>${window._editionShort || 'NanoCrab'}</span></div></div>
        <div class="mode-switcher">
          ${window.NanoModes.MODE_ORDER.map((m) => {
            const cfg = window.NanoModes.MODES[m];
            return `<button class="mode-tab ${activeMode === m ? 'active' : ''}" onclick="setMode('${m}')" type="button">${navIcon(cfg.icon)}<span>${cfg.label}</span></button>`;
          }).join('')}
        </div>
        <div class="sidebar-nav">${navHtml}</div>
```

- [ ] **Step 5: Manual verification**

Run: `npm run mock:admin`, open the URL. Expected: a Chat/Work/Code segmented control appears above the nav; clicking a tab navigates to that mode's first page and highlights the tab. (Nav list still shows the old full tree until Task 6 — that's expected.) Stop the server.

- [ ] **Step 6: Commit**

```bash
git add src/admin/public/app.js
git commit -m "feat(admin): add active mode state and mode switcher"
```

---

## Task 6: Make the sidebar nav mode-scoped + pinned footer

**Files:**
- Modify: `src/admin/public/app.js` (`showShell` nav builder ~502–609)

- [ ] **Step 1: Replace the static `navItems` list with a mode-derived list**

Replace the block from `const navItems = [` (line 502) through the end of the Developer & System `navItems.push( ... );` (the closing `);` at ~line 551) with:

```js
  // Mode-scoped nav: only the pages for the active mode (in config order).
  const NMcfg = window.NanoModes;
  const labelFor = {
    chat: 'Chat', messages: 'Messages',
    agents: 'Agents', groups: 'Groups', tasks: 'Tasks', approvals: 'Approvals',
    sessions: 'Sessions', workflows: 'Workflows', reports: 'Reports',
    artifacts: 'Artifacts', memory: 'Memory', timeline: 'Timeline',
    gitcode: 'Git & Code', devhub: 'Terminal', autofix: 'AutoFix',
    skills: 'Skills', marketplace: 'Marketplace',
  };
  const iconFor = {
    chat: 'chat', messages: 'messages',
    agents: 'agents', groups: 'groups', tasks: 'tasks', approvals: 'approvals',
    sessions: 'sessions', workflows: 'workflows', reports: 'audit',
    artifacts: 'files', memory: 'memory', timeline: 'timeline',
    gitcode: 'gitcode', devhub: 'devhub', autofix: 'autofix',
    skills: 'skills', marketplace: 'marketplace',
  };
  const navItems = NMcfg.navPagesForMode(activeMode).map((id) => ({
    id,
    icon: iconFor[id] || 'integrations',
    label: labelFor[id] || id,
  }));

  // Inject enabled plugins whose page belongs to the active mode.
  const cachedPlugins = window._pluginsList || [];
  for (const p of cachedPlugins) {
    if (!p.enabled || !p.sidebar) continue;
    if (NMcfg.resolveMode(p.sidebar.id) !== activeMode) continue;
    if (navItems.some((n) => n.id === p.sidebar.id)) continue;
    navItems.push({
      id: p.sidebar.id,
      icon: navIconPaths[p.sidebar.id] ? p.sidebar.id : 'integrations',
      label: p.sidebar.label,
    });
  }
```

This removes section headers (modes replace them). The existing role-filter block (lines 553–570) stays and still works on `navItems`.

- [ ] **Step 2: Simplify nav HTML (no collapsible sections)**

Replace the nav-HTML builder (lines 572–598, from `const savedCollapsed = ...` through `if (lastSection) navHtml += '</div>';`) with:

```js
  let navHtml = filteredNavItems
    .map(
      (item) =>
        `<a class="nav-link ${page === item.id ? 'active' : ''}" onclick="navigate('${item.id}')">${navIcon(item.icon)}<span class="nav-label">${item.label}</span></a>`,
    )
    .join('');
```

- [ ] **Step 3: Build the pinned footer items (Customize / More / Help)**

Replace the sidebar footer block (lines 629–635):

```js
        <div class="sidebar-footer">
          <div class="sidebar-footer-actions">
            <button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme"></button>
            <a class="nav-link nav-link-icon-only" onclick="navigate('help')" title="Help & Manual">${navIcon('help')}</a>
            <a class="nav-link nav-link-icon-only" onclick="logout()" title="Logout">${navIcon('logout')}</a>
          </div>
        </div>
```

with:

```js
        <div class="sidebar-pinned">
          <a class="nav-link" onclick="toggleMoreDrawer()">${navIcon('settings')}<span class="nav-label">More</span></a>
          <a class="nav-link ${page === 'settings' ? 'active' : ''}" onclick="navigate('settings')">${navIcon('settings')}<span class="nav-label">Customize</span></a>
        </div>
        <div class="sidebar-footer">
          <div class="sidebar-footer-actions">
            <button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme"></button>
            <a class="nav-link nav-link-icon-only" onclick="navigate('help')" title="Help & Manual">${navIcon('help')}</a>
            <a class="nav-link nav-link-icon-only" onclick="logout()" title="Logout">${navIcon('logout')}</a>
          </div>
        </div>
```

- [ ] **Step 4: Manual verification**

Run: `npm run mock:admin`, open the URL. Expected: the sidebar now shows only the active mode's pages (e.g. Chat → Chat, Messages); switching modes swaps the list; a "More" and "Customize" item sit pinned at the bottom. ("More" does nothing yet — wired in Task 7.) Verify no JS console errors. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add src/admin/public/app.js
git commit -m "feat(admin): make sidebar nav mode-scoped with pinned footer"
```

---

## Task 7: "More" admin drawer

**Files:**
- Modify: `src/admin/public/app.js` (shell markup ~611–652; add `window.toggleMoreDrawer`)

- [ ] **Step 1: Build the drawer markup**

In the shell markup, immediately after the opening `<div class="app">` (line 612), insert the drawer (overlay + panel) built from `MORE_IDS`:

```js
      <div class="more-overlay" onclick="toggleMoreDrawer()"></div>
      <div class="more-drawer" id="more-drawer">
        <div class="more-drawer-header"><span>Admin & operations</span><button class="more-close" onclick="toggleMoreDrawer()" aria-label="Close">✕</button></div>
        <div class="more-drawer-body">
          ${window.NanoModes.MORE_IDS.filter((id) => pages[id] && filteredNavItems.every((n) => n.id !== id))
            .map((id) => {
              const labels = { dashboard: 'Dashboard', pipelines: 'Deploy', monitoring: 'Monitoring', containers: 'Containers', integrations: 'Integrations', webhooks: 'Webhooks', credentials: 'Credentials', security: 'Security', audit: 'Audit', uptime: 'Uptime', copilot: 'Copilot', backup: 'Backup', usage: 'Usage', settings: 'Settings', help: 'Help' };
              return `<a class="nav-link" onclick="toggleMoreDrawer(); navigate('${id}')">${navIcon(id) || navIcon('settings')}<span class="nav-label">${labels[id] || id}</span></a>`;
            })
            .join('')}
        </div>
      </div>
```

- [ ] **Step 2: Add the toggle handler**

Near the other window handlers (e.g. after `window.setMode`), add:

```js
window.toggleMoreDrawer = function () {
  const drawer = document.getElementById('more-drawer');
  const overlay = document.querySelector('.more-overlay');
  if (drawer) drawer.classList.toggle('open');
  if (overlay) overlay.classList.toggle('visible');
};
```

- [ ] **Step 3: Manual verification**

Run: `npm run mock:admin`, open the URL. Expected: clicking "More" opens a drawer listing admin/ops pages (Dashboard, Deploy, Monitoring, Security, Settings, …); clicking one navigates to it and closes the drawer; clicking the overlay or ✕ closes it. Navigating to an admin page keeps the previously active mode tab highlighted. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/admin/public/app.js
git commit -m "feat(admin): add More admin/ops drawer"
```

---

## Task 8: Mobile bottom bar → Chat / Work / Code / More

**Files:**
- Modify: `src/admin/public/app.js` (bottom-tabs markup ~643–651)

- [ ] **Step 1: Replace the bottom-tabs markup**

Replace the `<div class="bottom-tabs">` block (lines 643–651) with:

```js
      <div class="bottom-tabs">
        <nav>
          ${window.NanoModes.MODE_ORDER.map((m) => {
            const cfg = window.NanoModes.MODES[m];
            return `<button class="bottom-tab ${activeMode === m ? 'active' : ''}" onclick="setMode('${m}')">${navIcon(cfg.icon, 'tab-icon')}<span>${cfg.label}</span></button>`;
          }).join('')}
          <button class="bottom-tab" onclick="toggleMoreDrawer()">${navIcon('menu', 'tab-icon')}<span>More</span></button>
        </nav>
      </div>
```

- [ ] **Step 2: Manual verification**

Run: `npm run mock:admin`, open the URL, narrow the window to mobile width (or use devtools device mode). Expected: bottom bar shows Chat / Work / Code / More; tapping a mode tab switches mode + page and highlights it; "More" opens the admin drawer. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add src/admin/public/app.js
git commit -m "feat(admin): mode-first mobile bottom bar"
```

---

## Task 9: Default the app to the last-used mode

**Files:**
- Modify: `src/admin/public/app.js` (init IIFE ~9915–9925)

- [ ] **Step 1: Update the init landing logic**

In the init IIFE, replace:

```js
    const p = canonicalPage(window.location.hash.replace('#/', ''));
    showShell(pages[p] ? p : 'dashboard');
```

with:

```js
    const hashPage = canonicalPage(window.location.hash.replace('#/', ''));
    if (window.location.hash && pages[hashPage]) {
      // Explicit deep link wins; showShell derives the mode from the page.
      showShell(hashPage);
    } else {
      // No deep link: open the last-used mode's first page.
      const mode = window.NanoModes.loadActiveMode(window.localStorage);
      const landing = window.NanoModes.navPagesForMode(mode)[0] || 'chat';
      navigate(landing);
    }
```

- [ ] **Step 2: Manual verification**

Run: `npm run mock:admin`, open the URL with no hash. Expected: first visit opens Chat's first page (chat). Switch to Code, reload with no hash → reopens a Code page. Deep-link directly to `#/security` → loads Security with the prior mode tab still active. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add src/admin/public/app.js
git commit -m "feat(admin): land on last-used mode on startup"
```

---

## Task 10: Styling — switcher, sidebar sections, drawer

**Files:**
- Modify: `src/admin/public/style.css` (sidebar block ~854–1108)

- [ ] **Step 1: Add styles for the new shell elements**

Append to `src/admin/public/style.css` (uses existing theme custom properties; adjust variable names to match the file's existing tokens if they differ — grep the file for `--accent`, `--border`, `--bg-elevated`, `--text-muted` first and reuse the real names):

```css
/* --- Mode-first shell --- */
.mode-switcher {
  display: flex;
  gap: 4px;
  margin: 8px 12px 12px;
  padding: 4px;
  background: var(--bg-elevated, rgba(127, 127, 127, 0.12));
  border-radius: 10px;
}
.mode-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted, #999);
  cursor: pointer;
  font: inherit;
}
.mode-tab.active {
  background: var(--bg, rgba(127, 127, 127, 0.28));
  color: var(--text, #fff);
  font-weight: 600;
}
.mode-tab svg { width: 16px; height: 16px; }

.sidebar-pinned {
  margin-top: auto;
  padding: 8px 0;
  border-top: 1px solid var(--border, rgba(127, 127, 127, 0.2));
}

/* More drawer */
.more-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  z-index: 40;
}
.more-overlay.visible { opacity: 1; pointer-events: auto; }
.more-drawer {
  position: fixed;
  top: 0;
  left: -340px;
  width: 320px;
  height: 100%;
  background: var(--bg-elevated, #1b1b1b);
  border-right: 1px solid var(--border, rgba(127, 127, 127, 0.2));
  transition: left 0.18s ease;
  z-index: 41;
  display: flex;
  flex-direction: column;
}
.more-drawer.open { left: 0; }
.more-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  font-weight: 600;
  border-bottom: 1px solid var(--border, rgba(127, 127, 127, 0.2));
}
.more-close {
  border: 0;
  background: transparent;
  color: var(--text-muted, #999);
  cursor: pointer;
  font-size: 16px;
}
.more-drawer-body { padding: 8px; overflow-y: auto; }
```

- [ ] **Step 2: Confirm the sidebar is a flex column (so `margin-top:auto` pins the footer)**

Grep: `grep -n "\.sidebar {" src/admin/public/style.css`. Confirm the `.sidebar` rule has `display: flex; flex-direction: column;`. If it does not, add those two properties to it.

- [ ] **Step 3: Manual verification**

Run: `npm run mock:admin`, open the URL. Expected: the mode switcher is a clean segmented control; the active tab is highlighted; "More"/"Customize" sit pinned at the bottom of the sidebar; the More drawer slides in from the left over a dimmed overlay. Toggle a few themes (theme button) and confirm colors track the theme. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/admin/public/style.css
git commit -m "style(admin): mode switcher, pinned footer, More drawer"
```

---

## Task 11: Full-suite regression + reachability check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, including the new `src/admin/modes.test.ts`. No previously passing test regresses.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Reachability sweep (manual)**

Run: `npm run mock:admin`. For each mode, open every listed page; open the More drawer and open every admin page; confirm each renders without a console error and without "Page not found". Confirm Chat/Work/Code each persist across reload, and that `#/<page>` deep links for a sampling of pages from each bucket (e.g. `#/chat`, `#/approvals`, `#/gitcode`, `#/security`) land correctly with the right mode highlighted. Stop the server.

- [ ] **Step 4: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "test(admin): verify mode-first navigation reachability"
```

---

## Self-Review Notes

- **Spec coverage:** mode switcher (T5), mode→page mapping & mode-scoped sidebar (T1/T6), always-present pinned section (T6), More drawer for admin/ops (T7), page-based routes with mode derived from active page (T5 step 2, T9), last-used-mode landing (T3/T9), mobile bottom bar (T8), styling (T10), pages/backend untouched (no tasks modify `pages/*.js` or any `.ts` route), testing (T1–T3 unit, T11 regression+reachability). ✔
- **Divergence from spec:** Routines and Dispatch are intentionally omitted (no backing pages in NanoCrab); the pinned section uses Customize (Settings), More, and Help instead. Flagged to the user before planning.
- **Type/name consistency:** `resolveMode`, `navPagesForMode`, `loadActiveMode`, `saveActiveMode`, `MODES`, `MODE_ORDER`, `MORE_IDS`, `activeMode`, `window.setMode`, `window.toggleMoreDrawer` are used consistently across tasks.
- **Known assumptions to verify during execution:** exact CSS custom-property names in `style.css` (grep before relying on the fallbacks given); the mock server URL/port; that `navIcon(id)` returns empty/usable output for admin ids (Task 7 falls back to the settings icon).
