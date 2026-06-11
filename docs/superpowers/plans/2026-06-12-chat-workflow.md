# Chat Workflow v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider/model selector, tool-call timeline, inline approve/deny, and live task progress to the Dashboard Chat page.

**Architecture:** All features use a structured marker protocol — agent emits parseable XML-style markers in its text output stream. The backend extracts these in the `processGroupMessages` streaming callback (`src/index.ts`), strips them from visible text, and routes them as typed WebSocket events to the dashboard. No container rebuilds required.

**Tech Stack:** TypeScript/Node.js backend, Express + ws, vanilla JS frontend (no framework), vitest for tests.

---

### File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/admin/chat-workflow.ts` | Create | Pure helper functions: `extractStructuredMarkers()`, `stripStructuredMarkers()` |
| `src/admin/chat-workflow.test.ts` | Create | Unit tests for marker parsing |
| `src/admin/websocket.ts` | Modify | Add `broadcastToolCall`, `broadcastToolResult`, `broadcastApprovalRequest`, `broadcastTaskProgress`, `broadcastApprovalResult` |
| `src/index.ts` | Modify | Wire marker extraction into `processGroupMessages` streaming callback; approval output buffering |
| `src/admin/routes/chat.ts` | Create | `POST /api/chat/approve` endpoint |
| `src/admin/public/app.js` | Modify | Update `renderChat()` for all 4 features; update `handleWsMessage` for new event types |
| `src/admin/public/style.css` | Modify | CSS for tool-call cards, approve/deny UI, progress bar, provider selector |

---

### Task 1: Marker extraction and WS broadcast infrastructure

**Files:**
- Create: `src/admin/chat-workflow.ts`
- Create: `src/admin/chat-workflow.test.ts`
- Modify: `src/admin/websocket.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Read the exact line in index.ts where markers will be extracted**

Read `src/index.ts` lines 426-459 to see the streaming callback.

- [ ] **Step 2: Write marker parser and test**

Create `src/admin/chat-workflow.ts`:

```typescript
import { logger } from '../logger.js';

export interface ToolCallMarker {
  type: 'tool_call';
  id: string;
  name: string;
  input: string;
}

export interface ToolResultMarker {
  type: 'tool_result';
  id: string;
  output: string;
  duration: string;
}

export interface ApprovalRequestMarker {
  type: 'approval_request';
  id: string;
  tool: string;
  reason: string;
  input: string;
}

export interface ProgressMarker {
  type: 'progress';
  phase: string;
  pct: number;
  message: string;
}

export type ParsedMarker = ToolCallMarker | ToolResultMarker | ApprovalRequestMarker | ProgressMarker;

const MARKER_RE = /<(tool_call|tool_result|approval_request|progress)\s+([^>]*?)\s*\/?>/g;
const ATTR_RE = /(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;

function parseAttributes(attrsStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrsStr)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

export function extractStructuredMarkers(text: string): ParsedMarker[] {
  const markers: ParsedMarker[] = [];
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(text)) !== null) {
    const tagName = m[1];
    const attrs = parseAttributes(m[2]);
    try {
      switch (tagName) {
        case 'tool_call':
          markers.push({ type: 'tool_call', id: attrs.id, name: attrs.name, input: attrs.input || '{}' });
          break;
        case 'tool_result':
          markers.push({ type: 'tool_result', id: attrs.id, output: attrs.output || '{}', duration: attrs.duration || '0' });
          break;
        case 'approval_request':
          markers.push({ type: 'approval_request', id: attrs.id, tool: attrs.tool, reason: attrs.reason || '', input: attrs.input || '{}' });
          break;
        case 'progress':
          markers.push({ type: 'progress', phase: attrs.phase, pct: parseInt(attrs.pct || '0', 10), message: attrs.message || '' });
          break;
      }
    } catch (err) {
      logger.warn({ err, tagName, attrs }, 'Failed to parse structured marker');
    }
  }
  return markers;
}

export function stripStructuredMarkers(text: string): string {
  return text.replace(/<(?:tool_call|tool_result|approval_request|progress)\s+[^>]*?\s*\/?>/g, '');
}
```

- [ ] **Step 3: Write tests**

Create `src/admin/chat-workflow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractStructuredMarkers, stripStructuredMarkers } from '../chat-workflow.js';

describe('extractStructuredMarkers', () => {
  it('extracts tool_call marker', () => {
    const markers = extractStructuredMarkers('<tool_call id="tc_1" name="read_file" input=\'{"path":"src/config.ts"}\' />');
    expect(markers).toHaveLength(1);
    if (markers[0].type === 'tool_call') {
      expect(markers[0].id).toBe('tc_1');
      expect(markers[0].name).toBe('read_file');
    } else {
      expect.unreachable('Expected tool_call');
    }
  });

  it('extracts tool_result marker', () => {
    const markers = extractStructuredMarkers('<tool_result id="tc_1" output=\'{"content":"ok"}\' duration="0.342" />');
    expect(markers).toHaveLength(1);
    if (markers[0].type === 'tool_result') {
      expect(markers[0].id).toBe('tc_1');
      expect(markers[0].output).toBe('{"content":"ok"}');
      expect(markers[0].duration).toBe('0.342');
    }
  });

  it('extracts approval_request marker', () => {
    const markers = extractStructuredMarkers('<approval_request id="ar_1" tool="write_file" reason="Modifying config" input=\'{"path":"/etc/config.yaml"}\' />');
    expect(markers).toHaveLength(1);
    if (markers[0].type === 'approval_request') {
      expect(markers[0].tool).toBe('write_file');
      expect(markers[0].reason).toBe('Modifying config');
    }
  });

  it('extracts progress marker', () => {
    const markers = extractStructuredMarkers('<progress phase="researching" pct="15">Researching codebase...</progress>');
    expect(markers).toHaveLength(1);
    if (markers[0].type === 'progress') {
      expect(markers[0].phase).toBe('researching');
      expect(markers[0].pct).toBe(15);
      expect(markers[0].message).toBe('Researching codebase...');
    }
  });

  it('extracts multiple markers in one string', () => {
    const text = [
      '<progress phase="writing" pct="50">Writing...</progress>',
      '<tool_call id="tc_1" name="read_file" input=\'{}\' />',
      '<tool_result id="tc_1" output=\'{}\' duration="0.1" />',
    ].join('\n');
    const markers = extractStructuredMarkers(text);
    expect(markers).toHaveLength(3);
  });

  it('returns empty for text without markers', () => {
    expect(extractStructuredMarkers('Hello world')).toEqual([]);
  });
});

describe('stripStructuredMarkers', () => {
  it('removes all markers from text', () => {
    const text = 'Hello <tool_call id="tc_1" name="read_file" input=\'{}\' /> world';
    expect(stripStructuredMarkers(text)).toBe('Hello  world');
  });

  it('removes progress marker with inner text', () => {
    const text = 'before<progress phase="test" pct="10">message</progress>after';
    expect(stripStructuredMarkers(text)).toBe('beforeafter');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/admin/chat-workflow.test.ts`
Expected: 8 tests PASS

- [ ] **Step 5: Add WS broadcast helpers to websocket.ts**

Add at the end of `src/admin/websocket.ts`, after the `broadcastMessage` function:

```typescript
/** Broadcast a tool_call event to dashboard */
export function broadcastToolCall(data: {
  id: string;
  name: string;
  input: string;
  groupJid: string;
  timestamp: string;
}): void {
  broadcast({ type: 'tool_call', data });
}

/** Broadcast a tool_result event to dashboard */
export function broadcastToolResult(data: {
  id: string;
  output: string;
  duration: string;
  groupJid: string;
}): void {
  broadcast({ type: 'tool_result', data });
}

/** Broadcast an approval_request event to dashboard */
export function broadcastApprovalRequest(data: {
  id: string;
  tool: string;
  reason: string;
  input: string;
  groupJid: string;
}): void {
  broadcast({ type: 'approval_request', data });
}

/** Broadcast a task_progress event to dashboard */
export function broadcastTaskProgress(data: {
  phase: string;
  pct: number;
  message: string;
  groupJid: string;
}): void {
  broadcast({ type: 'task_progress', data });
}

/** Broadcast an approval_result event to dashboard */
export function broadcastApprovalResult(data: {
  id: string;
  groupJid: string;
  approved: boolean;
}): void {
  broadcast({ type: 'approval_result', data });
}
```

- [ ] **Step 6: Wire marker extraction into index.ts streaming callback**

In `src/index.ts`, add imports at the top:

```typescript
import { extractStructuredMarkers, stripStructuredMarkers } from './admin/chat-workflow.js';
import {
  broadcastToolCall,
  broadcastToolResult,
  broadcastApprovalRequest,
  broadcastTaskProgress,
} from './admin/websocket.js';
```

Modify the streaming callback (around line 426-456) to extract markers after the `<internal>` strip:

```typescript
const output = await runAgent(group, prompt, chatJid, async (result) => {
  if (result.result) {
    const raw =
      typeof result.result === 'string'
        ? result.result
        : JSON.stringify(result.result);
    // Strip <internal>...</internal> blocks
    const noInternal = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
    // Extract structured markers (tool_call, tool_result, approval_request, progress)
    const markers = extractStructuredMarkers(noInternal);
    const text = stripStructuredMarkers(noInternal).trim();

    // Broadcast markers as typed WS events
    for (const marker of markers) {
      const now = new Date().toISOString();
      if (marker.type === 'tool_call') {
        broadcastToolCall({ id: marker.id, name: marker.name, input: marker.input, groupJid: chatJid, timestamp: now });
      } else if (marker.type === 'tool_result') {
        broadcastToolResult({ id: marker.id, output: marker.output, duration: marker.duration, groupJid: chatJid });
      } else if (marker.type === 'approval_request') {
        broadcastApprovalRequest({ id: marker.id, tool: marker.tool, reason: marker.reason, input: marker.input, groupJid: chatJid });
      } else if (marker.type === 'progress') {
        broadcastTaskProgress({ phase: marker.phase, pct: marker.pct, message: marker.message, groupJid: chatJid });
      }
    }

    logger.info({ group: group.name }, `Agent output: ${raw.length} chars`);

    if (text) {
      await channel.sendMessage(chatJid, text);
      outputSentToUser = true;
      storeMessageDirect({
        id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        chat_jid: chatJid,
        sender: ASSISTANT_NAME,
        sender_name: ASSISTANT_NAME,
        content: text,
        timestamp: new Date().toISOString(),
        is_from_me: true,
        is_bot_message: true,
      });
      broadcastMessage({
        sender_name: ASSISTANT_NAME,
        content: text,
        chat_jid: chatJid,
        timestamp: new Date().toISOString(),
      });
    }
    resetIdleTimer();
  }
```

No state variables needed — markers are fire-and-forget WS events. The agent polls for approval decisions via the filesystem.

- [ ] **Step 7: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Run all tests**

Run: `npx vitest run --reporter=verbose`
Expected: All previously passing tests still pass, 8 new tests pass, pre-existing SQLite failures unchanged

- [ ] **Step 9: Commit**

```bash
git add src/admin/chat-workflow.ts src/admin/chat-workflow.test.ts src/admin/websocket.ts src/index.ts
git commit -m "feat(chat): add marker extraction and WS broadcast infrastructure"
```

---

### Task 2: Provider/model selector

**Files:**
- Modify: `src/admin/public/app.js`
- Modify: `src/admin/public/style.css`

The groups API already returns `containerConfig.provider` and `containerConfig.model` in `GET /api/groups`. The `PUT /api/groups/:jid` already accepts `containerConfig` updates. So the provider selector is purely a frontend task.

- [ ] **Step 1: Read the renderChat function**

Read `src/admin/public/app.js`, the `renderChat` function (around line 988).

- [ ] **Step 2: Add provider selector CSS to style.css**

Add at the end of `style.css`:

```css
/* Chat workflow — provider/model selector */
.chat-provider-selector {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  position: relative;
}

.chat-provider-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color var(--transition);
  white-space: nowrap;
}

.chat-provider-badge:hover {
  border-color: var(--accent);
}

.chat-provider-popover {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 100;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  padding: 8px;
  min-width: 240px;
  margin-top: 4px;
}

.chat-provider-popover select {
  width: 100%;
  padding: 6px 8px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  margin-bottom: 6px;
}

.chat-provider-popover .popover-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}
```

- [ ] **Step 3: Add provider selector to renderChat**

In the `renderChat` function, find the group selector area (the dropdown and related elements). Add a provider badge next to the group selector. The logic:

```javascript
// After the group selector <select>, add:
function renderProviderSelector(currentGroup) {
  const provider = currentGroup?.containerConfig?.provider || 'default';
  const model = currentGroup?.containerConfig?.model || 'auto';
  return `
    <div class="chat-provider-selector" id="chat-provider-selector">
      <div class="chat-provider-badge" onclick="toggleProviderPopover()">
        <span>${esc(provider)}</span>
        <span style="opacity:0.6">/</span>
        <span>${esc(model)}</span>
        <span style="font-size:10px;margin-left:2px">✎</span>
      </div>
    </div>
  `;
}
```

Add the provider popover toggle and save functions:

```javascript
window.toggleProviderPopover = function () {
  const existing = document.getElementById('chat-provider-popover');
  if (existing) { existing.remove(); return; }

  const groupJid = document.getElementById('chat-group-select')?.value;
  if (!groupJid) return;

  // Fetch available providers
  api('/providers').then(providers => {
    const selector = document.getElementById('chat-provider-selector');
    const popover = document.createElement('div');
    popover.id = 'chat-provider-popover';
    popover.className = 'chat-provider-popover';
    popover.innerHTML = `
      <select id="provider-select">
        ${providers.map(p => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`).join('')}
      </select>
      <select id="model-select">
        <option value="">Auto</option>
      </select>
      <div class="popover-actions">
        <button class="btn btn-sm btn-ghost" onclick="this.closest('.chat-provider-popover').remove()">Cancel</button>
        <button class="btn btn-sm btn-primary" onclick="saveProvider()">Save</button>
      </div>
    `;
    selector.appendChild(popover);

    // When provider changes, update model options
    document.getElementById('provider-select').onchange = function () {
      updateModelOptions(this.value);
    };

    // Set current values
    const group = window._chatGroups?.find(g => g.jid === groupJid);
    if (group?.containerConfig?.provider) {
      document.getElementById('provider-select').value = group.containerConfig.provider;
    }
    updateModelOptions(document.getElementById('provider-select').value, group?.containerConfig?.model);
  });
};

function updateModelOptions(providerId, selectedModel) {
  const modelSelect = document.getElementById('model-select');
  const provider = window._chatProviders?.find(p => p.id === providerId);
  const models = provider?.models || [];
  modelSelect.innerHTML = `
    <option value="">Auto</option>
    ${models.map(m => `<option value="${esc(m.id || m)}" ${m.id === selectedModel || m === selectedModel ? 'selected' : ''}>${esc(m.name || m)}</option>`).join('')}
  `;
  if (selectedModel && !models.some(m => (m.id || m) === selectedModel)) {
    modelSelect.value = selectedModel;
  }
}

window.saveProvider = async function () {
  const groupJid = document.getElementById('chat-group-select')?.value;
  const provider = document.getElementById('provider-select')?.value;
  const model = document.getElementById('model-select')?.value;
  if (!groupJid || !provider) return;

  try {
    await api('/groups/' + encodeURIComponent(groupJid), {
      method: 'PUT',
      body: JSON.stringify({ containerConfig: { provider, model: model || undefined } }),
    });
    toast('Provider updated to ' + provider + '/' + (model || 'auto'), 'success');
    document.getElementById('chat-provider-popover')?.remove();
    // Reload groups to reflect change
    loadChatGroups();
  } catch (e) {
    toast('Failed to update provider: ' + e.message, 'error');
  }
};
```

- [ ] **Step 4: Wire provider data into renderChat**

In `renderChat`, after loading groups, store the groups list and providers list globally for the popover:

```javascript
// After fetching groups:
window._chatGroups = groups;

// Also fetch providers
api('/providers').then(providers => {
  window._chatProviders = providers;
}).catch(() => {});
```

Render the provider badge next to the group selector dropdown. Add a wrapper `div` with `display:flex;gap:8px;align-items:center` around the group selector and provider badge.

- [ ] **Step 5: Verify compilation**

Run: `node -c src/admin/public/app.js`
Expected: syntax OK

- [ ] **Step 6: Commit**

```bash
git add src/admin/public/app.js src/admin/public/style.css
git commit -m "feat(chat): add provider/model selector to chat page"
```

---

### Task 3: Live task progress

**Files:**
- Modify: `src/admin/public/app.js`
- Modify: `src/admin/public/style.css`

- [ ] **Step 1: Add progress bar CSS to style.css**

```css
/* Chat workflow — task progress bar */
.chat-progress-bar {
  margin: 0 12px 8px;
  padding: 6px 10px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 11px;
  display: none;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: opacity 0.3s;
}

.chat-progress-bar.visible {
  display: flex;
}

.chat-progress-bar .progress-phase {
  color: var(--text-secondary);
  white-space: nowrap;
  min-width: 80px;
}

.chat-progress-bar .progress-track {
  flex: 1;
  height: 4px;
  background: var(--bg);
  border-radius: 2px;
  overflow: hidden;
}

.chat-progress-bar .progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.4s ease;
}

.chat-progress-bar .progress-pct {
  color: var(--text-muted);
  min-width: 30px;
  text-align: right;
}

.chat-progress-bar .progress-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Phase history expandable */
.chat-progress-history {
  display: none;
  margin: 0 12px 8px;
  padding: 6px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 11px;
  gap: 4px;
  flex-direction: column;
}

.chat-progress-history.visible {
  display: flex;
}

.chat-progress-history .phase-entry {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  color: var(--text-muted);
}

.chat-progress-history .phase-entry.done {
  color: var(--text-secondary);
}

.chat-progress-history .phase-entry.active {
  color: var(--text);
}

.chat-progress-history .phase-entry .phase-icon {
  font-size: 10px;
}
```

- [ ] **Step 2: Add progress bar to renderChat**

In `renderChat`, add the progress bar section below the chat input area (or above the messages area):

```javascript
// Add after the chat messages area and before the input area:
function renderProgressBar() {
  return `
    <div class="chat-progress-bar" id="chat-progress-bar">
      <span class="progress-spinner" id="progress-spinner"></span>
      <span class="progress-phase" id="progress-phase">Thinking...</span>
      <div class="progress-track">
        <div class="progress-fill" id="progress-fill" style="width:0%"></div>
      </div>
      <span class="progress-pct" id="progress-pct">0%</span>
    </div>
    <div class="chat-progress-history" id="chat-progress-history"></div>
  `;
}
```

- [ ] **Step 3: Add task_progress handler to handleWsMessage**

In `handleWsMessage`, add a handler for `task_progress`:

```javascript
if (msg.type === 'task_progress') {
  const bar = document.getElementById('chat-progress-bar');
  const phase = document.getElementById('progress-phase');
  const fill = document.getElementById('progress-fill');
  const pct = document.getElementById('progress-pct');
  const spinner = document.getElementById('progress-spinner');

  if (!bar || !phase || !fill || !pct) return;

  bar.classList.add('visible');
  phase.textContent = msg.data.message || msg.data.phase;
  fill.style.width = msg.data.pct + '%';
  pct.textContent = msg.data.pct + '%';

  // Add to history
  const history = document.getElementById('chat-progress-history');
  if (history) {
    const entry = document.createElement('div');
    entry.className = 'phase-entry' + (msg.data.pct >= 100 ? ' done' : ' active');
    entry.innerHTML = `<span class="phase-icon">${msg.data.pct >= 100 ? '✓' : '●'}</span> ${esc(msg.data.message || msg.data.phase)}`;
    history.appendChild(entry);
    history.classList.add('visible');
  }

  // Auto-hide on completion
  if (msg.data.pct >= 100 || msg.data.phase === 'done') {
    // Re-show history briefly
    setTimeout(() => {
      bar.classList.remove('visible');
    }, 3000);
  } else if (spinner) {
    spinner.style.display = '';
  }
}
```

- [ ] **Step 4: Add fallback spinner when no progress after 30s**

In `renderChat`, when sending a message, start a 30s timer that shows a generic progress bar if no task_progress received:

```javascript
// Near the send handler in renderChat
window._progressTimeout = setTimeout(() => {
  const bar = document.getElementById('chat-progress-bar');
  if (bar && !bar.classList.contains('visible')) {
    bar.classList.add('visible');
    document.getElementById('progress-spinner').style.display = '';
    document.getElementById('progress-phase').textContent = 'Agent is thinking...';
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-pct').textContent = '';
  }
}, 30000);

// Clear timeout when progress is received (add at top of task_progress handler)
if (window._progressTimeout) {
  clearTimeout(window._progressTimeout);
  window._progressTimeout = null;
}

// Also clear on chat page leave
window._cleanupProgress = function () {
  if (window._progressTimeout) clearTimeout(window._progressTimeout);
  const bar = document.getElementById('chat-progress-bar');
  if (bar) bar.classList.remove('visible');
  const history = document.getElementById('chat-progress-history');
  if (history) history.classList.remove('visible');
};
```

- [ ] **Step 5: Verify compilation**

Run: `node -c src/admin/public/app.js`
Expected: syntax OK

- [ ] **Step 6: Commit**

```bash
git add src/admin/public/app.js src/admin/public/style.css
git commit -m "feat(chat): add live task progress bar"
```

---

### Task 4: Tool-call timeline

**Files:**
- Modify: `src/admin/public/app.js`
- Modify: `src/admin/public/style.css`

- [ ] **Step 1: Add tool-call card CSS to style.css**

```css
/* Chat workflow — tool-call cards */
.chat-tool-call {
  margin: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  font-size: 12px;
}

.chat-tool-call-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--surface);
  cursor: pointer;
  user-select: none;
}

.chat-tool-call-header:hover {
  background: var(--surface2);
}

.chat-tool-call-header .tool-icon {
  font-size: 11px;
  opacity: 0.7;
}

.chat-tool-call-header .tool-name {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-secondary);
}

.chat-tool-call-header .tool-status {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-muted);
}

.chat-tool-call-header .tool-status.running {
  color: var(--accent);
}

.chat-tool-call-header .tool-status.done {
  color: var(--success);
}

.chat-tool-call-body {
  display: none;
  padding: 8px 10px;
  background: var(--bg);
  border-top: 1px solid var(--border);
  max-height: 200px;
  overflow: auto;
}

.chat-tool-call-body.expanded {
  display: block;
}

.chat-tool-call-body pre {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
  white-space: pre-wrap;
  margin: 0;
}

.chat-tool-call-body .section-label {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}
```

- [ ] **Step 2: Add tool_call/tool_result handlers to handleWsMessage**

```javascript
// Tool call events
if (msg.type === 'tool_call' && document.getElementById('chat-page')?.style.display !== 'none') {
  const container = document.getElementById('chat-messages-area');
  if (!container) return;

  // Only show if this is the active group
  const activeGroup = document.getElementById('chat-group-select')?.value;
  if (msg.data.groupJid !== activeGroup) return;

  // Check if card already exists for this id (from a previous result)
  let card = document.getElementById('tool-card-' + msg.data.id);
  if (card) return;

  card = document.createElement('div');
  card.id = 'tool-card-' + msg.data.id;
  card.className = 'chat-tool-call';
  card.innerHTML = `
    <div class="chat-tool-call-header" onclick="this.nextElementSibling.classList.toggle('expanded')">
      <span class="tool-icon">🔧</span>
      <span class="tool-name">${esc(msg.data.name)}</span>
      <span class="tool-status running">● Running...</span>
    </div>
    <div class="chat-tool-call-body">
      <div class="section-label">Input</div>
      <pre>${esc(prettyPrint(msg.data.input))}</pre>
    </div>
  `;
  container.appendChild(card);
  container.scrollTop = container.scrollHeight;
}

if (msg.type === 'tool_result' && document.getElementById('chat-page')?.style.display !== 'none') {
  const activeGroup = document.getElementById('chat-group-select')?.value;
  if (msg.data.groupJid !== activeGroup) return;

  let card = document.getElementById('tool-card-' + msg.data.id);
  if (!card) {
    // Result without matching call — create minimal card
    card = document.createElement('div');
    card.id = 'tool-card-' + msg.data.id;
    card.className = 'chat-tool-call';
    card.innerHTML = `
      <div class="chat-tool-call-header" onclick="this.nextElementSibling.classList.toggle('expanded')">
        <span class="tool-icon">🔧</span>
        <span class="tool-name">tool</span>
        <span class="tool-status done">✓ ${msg.data.duration}s</span>
      </div>
      <div class="chat-tool-call-body">
        <div class="section-label">Result</div>
        <pre>${esc(prettyPrint(msg.data.output))}</pre>
      </div>
    `;
    const container = document.getElementById('chat-messages-area');
    if (container) container.appendChild(card);
    return;
  }

  // Update existing card
  const header = card.querySelector('.chat-tool-call-header');
  const status = header?.querySelector('.tool-status');
  if (status) {
    status.className = 'tool-status done';
    status.textContent = '✓ ' + msg.data.duration + 's';
  }

  // Add result section to body
  const body = card.querySelector('.chat-tool-call-body');
  if (body) {
    const resultDiv = document.createElement('div');
    resultDiv.innerHTML = '<div class="section-label" style="margin-top:8px">Result</div><pre>' + esc(prettyPrint(msg.data.output)) + '</pre>';
    body.appendChild(resultDiv);
    body.scrollTop = body.scrollHeight;
  }
}
```

Add a `prettyPrint` helper if not already in app.js:

```javascript
function prettyPrint(jsonStr) {
  try {
    const obj = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    return JSON.stringify(obj, null, 2);
  } catch {
    return jsonStr;
  }
}
```

- [ ] **Step 3: Verify compilation**

Run: `node -c src/admin/public/app.js`
Expected: syntax OK

- [ ] **Step 4: Commit**

```bash
git add src/admin/public/app.js src/admin/public/style.css
git commit -m "feat(chat): add tool-call timeline cards"
```

---

### Task 5: Inline approve/deny

**Files:**
- Create: `src/admin/routes/chat.ts`
- Modify: `src/admin/public/app.js`
- Modify: `src/admin/public/style.css`

- [ ] **Step 1: Add approve/deny CSS to style.css**

```css
/* Chat workflow — approve/deny cards */
.chat-approval-card {
  margin: 6px 12px;
  border: 1px solid var(--warning-border, #f59e0b);
  border-radius: var(--radius-sm);
  overflow: hidden;
  font-size: 12px;
  background: var(--surface);
}

.chat-approval-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: rgba(245, 158, 11, 0.08);
  font-weight: 500;
}

.chat-approval-body {
  padding: 8px 10px;
  border-top: 1px solid var(--border);
}

.chat-approval-body .approval-detail {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.chat-approval-body .approval-input {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg);
  padding: 6px 8px;
  border-radius: 4px;
  margin: 6px 0;
  max-height: 100px;
  overflow: auto;
  white-space: pre-wrap;
}

.chat-approval-actions {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  justify-content: flex-end;
}

.chat-approval-actions .btn-deny {
  background: var(--error-bg, transparent);
  color: var(--error, #ef4444);
  border-color: var(--error, #ef4444);
}
```

- [ ] **Step 2: Create POST /api/chat/approve route**

Create `src/admin/routes/chat.ts`:

```typescript
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { broadcastApprovalResult } from '../websocket.js';
import { getState } from '../state.js';

const router = Router();

interface ApproveBody {
  approvalId: string;
  groupJid: string;
  approved: boolean;
}

router.post('/approve', (req: Request, res: Response) => {
  const { approvalId, groupJid, approved } = req.body as ApproveBody;

  if (!approvalId || !groupJid) {
    res.status(400).json({ error: 'approvalId and groupJid are required' });
    return;
  }

  const state = getState();
  const groups = state.registeredGroups?.() ?? {};
  const group = groups[groupJid];
  if (!group) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }

  // Write decision to agent-accessible file
  try {
    const groupFolder = group.folder || groupJid;
    const approvalDir = path.join(
      process.cwd(),
      'data',
      'runtime-skills',
      groupFolder,
      '.approval',
    );
    fs.mkdirSync(approvalDir, { recursive: true });
    const resultFile = path.join(approvalDir, `${approvalId}.result`);
    fs.writeFileSync(resultFile, approved ? 'approved' : 'denied', 'utf-8');

    broadcastApprovalResult({ id: approvalId, groupJid, approved });
    res.json({ ok: true, approved });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process approval' });
  }
});

export default router;
```

- [ ] **Step 4: Register the chat route in the admin server**

In `src/admin/index.ts`, find where other routes are registered and add:

```typescript
import chatRoutes from './routes/chat.js';
// ...
app.use('/api/chat', chatRoutes);
```

- [ ] **Step 3: Register the chat route in the admin server**

In `src/admin/index.ts`, find where plugins/routes are registered and add:

```typescript
import chatRoutes from './routes/chat.js';
// ...
app.use('/api/chat', chatRoutes);
```

- [ ] **Step 4: Add approve/deny frontend**

In `handleWsMessage`, add an `approval_request` handler:

```javascript
if (msg.type === 'approval_request' && document.getElementById('chat-page')?.style.display !== 'none') {
  const activeGroup = document.getElementById('chat-group-select')?.value;
  if (msg.data.groupJid !== activeGroup) return;

  const container = document.getElementById('chat-messages-area');
  if (!container) return;

  // Don't duplicate if already showing
  if (document.getElementById('approval-card-' + msg.data.id)) return;

  const card = document.createElement('div');
  card.id = 'approval-card-' + msg.data.id;
  card.className = 'chat-approval-card';
  card.innerHTML = `
    <div class="chat-approval-header">⚠️ Approval Required</div>
    <div class="chat-approval-body">
      <div class="approval-detail">Tool: <strong>${esc(msg.data.tool)}</strong></div>
      <div class="approval-detail">Reason: ${esc(msg.data.reason)}</div>
      <div class="approval-input">${esc(prettyPrint(msg.data.input))}</div>
    </div>
    <div class="chat-approval-actions">
      <button class="btn btn-sm btn-deny" onclick="denyApproval('${esc(msg.data.id)}', '${esc(msg.data.groupJid)}')">Deny</button>
      <button class="btn btn-sm btn-primary" onclick="approveApproval('${esc(msg.data.id)}', '${esc(msg.data.groupJid)}')">Approve</button>
    </div>
  `;
  container.appendChild(card);
  container.scrollTop = container.scrollHeight;
}
```

```javascript
window.approveApproval = async function (id, groupJid) {
  try {
    await api('/chat/approve', {
      method: 'POST',
      body: JSON.stringify({ approvalId: id, groupJid, approved: true }),
    });
    const card = document.getElementById('approval-card-' + id);
    if (card) {
      card.querySelector('.chat-approval-header').textContent = '✓ Approved';
      card.querySelector('.chat-approval-actions')?.remove();
      card.style.borderColor = 'var(--success)';
    }
    toast('Approval granted', 'success');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};

window.denyApproval = async function (id, groupJid) {
  try {
    await api('/chat/approve', {
      method: 'POST',
      body: JSON.stringify({ approvalId: id, groupJid, approved: false }),
    });
    const card = document.getElementById('approval-card-' + id);
    if (card) {
      card.querySelector('.chat-approval-header').textContent = '✗ Denied';
      card.querySelector('.chat-approval-actions')?.remove();
      card.style.borderColor = 'var(--error)';
    }
    toast('Approval denied', 'info');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
};
```

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Verify JS syntax**

Run: `node -c src/admin/public/app.js`
Expected: syntax OK

- [ ] **Step 7: Run tests**

Run: `npx vitest run --reporter=verbose`
Expected: All passing

- [ ] **Step 8: Commit**

```bash
git add src/admin/routes/chat.ts src/admin/index.ts src/admin/public/app.js src/admin/public/style.css
git commit -m "feat(chat): add inline approve/deny workflow"
```

---

### Task 6: Integration and cleanup

**Files:**
- Verify everything

- [ ] **Step 1: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Full test run**

Run: `npx vitest run --reporter=verbose`
Expected: All new tests pass, regressions unchanged

- [ ] **Step 3: Review all changes**

Run: `git diff --stat`
Verify the expected files are modified.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(chat): complete chat workflow v1"
```
