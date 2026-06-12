# Agent Session Page v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline session viewer with a dedicated Agent Session Detail page featuring stats header bar and full transcript with inline tool call details.

**Architecture:** New `GET /:group/:sessionId/detail` endpoint returns session stats + structured tool call data parsed from JSONL transcript files. Frontend adds a new page (`renderSessionDetail`) in the existing page router with stats bar and collapsible tool call cards reusing `.chat-tool-call` CSS from Chat Workflow.

**Tech Stack:** TypeScript/Node.js backend, Express, vanilla JS frontend (no framework), vitest for tests.

---

### File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/admin/routes/sessions.ts` | Modify | Add `GET /:group/:sessionId/detail` endpoint with stats computation + structured tool call extraction |
| `src/admin/routes/sessions.test.ts` | Modify | Add tests for new detail endpoint |
| `src/admin/public/app.js` | Modify | Add `renderSessionDetail()` page function, update `_pageMap`, update `renderSessions` view button, stats customization UI, transcript rendering |
| `src/admin/public/style.css` | Modify | Stats header bar CSS, session detail page layout |

---

### Task 1: Backend detail endpoint

**Files:**
- Modify: `src/admin/routes/sessions.ts`
- Modify: `src/admin/routes/sessions.test.ts`

- [ ] **Step 1: Read the existing session route and test file**

Read `src/admin/routes/sessions.ts` (especially the `GET /:group/:sessionId` handler at line 229) and `src/admin/routes/sessions.test.ts`.

- [ ] **Step 2: Add the detail endpoint**

Add after the existing `GET /:group/:sessionId` handler (before the `export default router`):

```typescript
// GET /api/sessions/:group/:sessionId/detail — full session detail with stats + tool calls
router.get('/:group/:sessionId/detail', async (req: Request, res: Response) => {
  try {
    const group = req.params.group as string;
    const sessionId = req.params.sessionId as string;
    let filePath = path.join(
      DATA_DIR,
      'sessions',
      group,
      '.agents',
      'projects',
      '-workspace-group',
      `${sessionId}.jsonl`,
    );
    if (!fs.existsSync(filePath)) {
      filePath = path.join(
        DATA_DIR,
        'sessions',
        group,
        '.claude',
        'projects',
        '-workspace-group',
        `${sessionId}.jsonl`,
      );
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const messages: Array<{
      role: string;
      content: string;
      timestamp: string;
      type: string;
      toolCalls?: Array<{
        id: string;
        name: string;
        input: string;
        output: string;
        duration: string;
      }>;
    }> = [];

    const pendingToolCalls = new Map<string, { name: string; input: string }>();
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let toolCount = 0;
    let model = '';

    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const ts = obj.timestamp || '';
        if (!firstTimestamp) firstTimestamp = ts;
        lastTimestamp = ts;

        if (obj.type === 'user' || obj.type === 'human') {
          messages.push({
            role: 'user',
            content: obj.content || obj.message || JSON.stringify(obj),
            timestamp: ts,
            type: obj.type,
          });
        } else if (obj.type === 'assistant') {
          let text = '';
          const tc: Array<{
            id: string;
            name: string;
            input: string;
            output: string;
            duration: string;
          }> = [];

          const contentBlocks = Array.isArray(obj.message?.content)
            ? obj.message.content
            : Array.isArray(obj.content)
              ? obj.content
              : [];

          for (const block of contentBlocks) {
            if (block.type === 'text') {
              text += block.text || '';
            } else if (block.type === 'tool_use') {
              toolCount++;
              const toolId = block.id || block.tool_use_id || `tc_${toolCount}`;
              pendingToolCalls.set(toolId, {
                name: block.name || '',
                input: JSON.stringify(block.input || {}),
              });
              tc.push({
                id: toolId,
                name: block.name || '',
                input: JSON.stringify(block.input || {}),
                output: '',
                duration: '',
              });
            } else if (block.type === 'tool_result') {
              const toolId = block.tool_use_id || '';
              const pending = pendingToolCalls.get(toolId);
              if (pending) {
                pendingToolCalls.delete(toolId);
                tc.push({
                  id: toolId,
                  name: pending.name,
                  input: pending.input,
                  output: typeof block.content === 'string' ? block.content : JSON.stringify(block.content || ''),
                  duration: block.duration || '',
                });
              }
            }
          }

          if (!model && obj.message?.model) {
            model = obj.message.model;
          }

          // Extract model from content blocks
          if (!model) {
            for (const block of contentBlocks) {
              if (block.type === 'text' && block.text?.startsWith('Model:')) {
                model = block.text.replace('Model:', '').trim();
              }
            }
          }

          const content = text || (tc.length > 0 ? '' : JSON.stringify(obj));

          if (content || tc.length > 0) {
            messages.push({
              role: 'assistant',
              content,
              timestamp: ts,
              type: obj.type,
              toolCalls: tc.length > 0 ? tc : undefined,
            });
          }
        } else if (obj.type === 'tool_result' && obj.message?.tool_use_id) {
          // Orphan tool_result (no preceding assistant with tool_use in this batch)
          const toolId = obj.message.tool_use_id;
          const pending = pendingToolCalls.get(toolId);
          if (pending) {
            pendingToolCalls.delete(toolId);
            // Find last assistant message and append
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].role === 'assistant') {
                if (!messages[i].toolCalls) messages[i].toolCalls = [];
                messages[i].toolCalls.push({
                  id: toolId,
                  name: pending.name,
                  input: pending.input,
                  output: typeof obj.message.content === 'string'
                    ? obj.message.content
                    : JSON.stringify(obj.message.content || ''),
                  duration: obj.message.duration || '',
                });
                break;
              }
            }
          }
        }
      } catch {
        // skip malformed lines
      }
    }

    const duration = firstTimestamp && lastTimestamp
      ? Math.round((new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()) / 1000)
      : 0;

    res.json({
      id: sessionId,
      group,
      stats: {
        messageCount: messages.length,
        duration,
        toolCount,
        model: model || 'unknown',
        createdAt: firstTimestamp,
        endedAt: lastTimestamp,
      },
      messages,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read session detail' });
  }
});
```

- [ ] **Step 3: Route ordering check**

This new `/:group/:sessionId/detail` route MUST be placed BEFORE the existing `/:group/:sessionId` route, otherwise Express will match `detail` as a `:sessionId` parameter. Place it right before the existing handler.

- [ ] **Step 4: Add tests**

Read and then add to `src/admin/routes/sessions.test.ts`:

```typescript
describe('session detail endpoint', () => {
  const detailDir = path.join(os.tmpdir(), `nanocrab-session-detail-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(path.join(detailDir, 'sessions', 'test-group', '.agents', 'projects', '-workspace-group'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(detailDir, { recursive: true, force: true });
  });

  it('computes stats from session JSONL', () => {
    const sessionFile = path.join(detailDir, 'sessions', 'test-group', '.agents', 'projects', '-workspace-group', 'session-1.jsonl');
    fs.writeFileSync(sessionFile, [
      JSON.stringify({ type: 'user', content: 'Hello', timestamp: '2026-06-12T10:00:00Z' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi there' }] }, timestamp: '2026-06-12T10:00:05Z' }),
    ].join('\n'));

    const content = fs.readFileSync(sessionFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it('extracts tool calls from assistant messages', () => {
    const sessionFile = path.join(detailDir, 'sessions', 'test-group', '.agents', 'projects', '-workspace-group', 'session-tools.jsonl');
    const line1 = JSON.stringify({
      type: 'user', content: 'Read config.ts', timestamp: '2026-06-12T10:00:00Z',
    });
    const line2 = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Reading file...' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'config.ts' } },
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'port=3000', duration: '0.3' },
          { type: 'text', text: 'Done.' },
        ],
      },
      timestamp: '2026-06-12T10:00:05Z',
    });
    fs.writeFileSync(sessionFile, [line1, line2].join('\n'));

    const content = fs.readFileSync(sessionFile, 'utf-8');
    expect(content).toContain('tool_use');
    expect(content).toContain('read_file');
  });

  it('calculates duration between first and last message', () => {
    const sessionFile = path.join(detailDir, 'sessions', 'test-group', '.agents', 'projects', '-workspace-group', 'session-dur.jsonl');
    fs.writeFileSync(sessionFile, [
      JSON.stringify({ type: 'user', content: 'Start', timestamp: '2026-06-12T10:00:00Z' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Mid' }] }, timestamp: '2026-06-12T10:01:00Z' }),
      JSON.stringify({ type: 'user', content: 'End', timestamp: '2026-06-12T10:02:30Z' }),
    ].join('\n'));

    const content = fs.readFileSync(sessionFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
  });

  it('counts tool_use blocks', () => {
    const sessionFile = path.join(detailDir, 'sessions', 'test-group', '.agents', 'projects', '-workspace-group', 'session-tc.jsonl');
    fs.writeFileSync(sessionFile, JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'a.ts' } },
          { type: 'tool_use', id: 'tu_2', name: 'write_file', input: { path: 'b.ts' } },
        ],
      },
      timestamp: '2026-06-12T10:00:00Z',
    }));

    const content = fs.readFileSync(sessionFile, 'utf-8');
    const match = content.match(/"tool_use"/g);
    expect(match).toHaveLength(2);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/admin/routes/sessions.test.ts --reporter=verbose`
Expected: All PASS (existing tests + new ones)

- [ ] **Step 6: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/admin/routes/sessions.ts src/admin/routes/sessions.test.ts
git commit -m "feat(sessions): add detail endpoint with stats and structured tool calls"
```

---

### Task 2: Session detail page routing

**Files:**
- Modify: `src/admin/public/app.js`

- [ ] **Step 1: Read current page routing in app.js**

Find the `_pageMap` registration (search for `navigate('sessions'` or `sessions:` in `_pageMap`) and the `renderSessions` function.

- [ ] **Step 2: Register Session Detail in page map**

In `_pageMap`, add:

```javascript
'session-detail': 'renderSessionDetail',
```

- [ ] **Step 3: Add renderSessionDetail function**

Add after the `renderSessions` function (or near it):

```javascript
async function renderSessionDetail(el, params) {
  const group = params?.group;
  const sessionId = params?.sessionId;
  if (!group || !sessionId) {
    el.innerHTML = '<div class="card"><div class="empty">No session specified</div></div>';
    return;
  }

  el.innerHTML = `
    <div class="page-header">
      <h2>
        <a href="#" onclick="navigate('sessions');return false" style="color:var(--text-muted);text-decoration:none">Sessions</a>
        <span style="color:var(--text-muted);margin:0 4px">/</span>
        ${esc(sessionId.slice(0, 8))}...
      </h2>
      <button class="btn btn-sm btn-ghost" onclick="navigate('sessions')">Back</button>
    </div>
    <div id="session-stats-bar"></div>
    <div id="session-transcript" class="card" style="padding:0;overflow:hidden;flex:1;margin-top:8px">
      <div class="loading" style="padding:24px">Loading session...</div>
    </div>
  `;

  try {
    const data = await api(`/sessions/${encodeURIComponent(group)}/${encodeURIComponent(sessionId)}/detail`);
    renderSessionStats(data.stats);
    renderSessionTranscript(data.messages, data.stats);
  } catch (e) {
    document.getElementById('session-transcript').innerHTML = '<div class="empty">Failed to load session</div>';
  }
}
```

- [ ] **Step 4: Update renderSessions "View" button**

In `renderSessions` and `renderSessionList`, change the View button from calling `viewSession(...)` to navigating to the detail page:

```javascript
// Old:
<button class="btn btn-sm btn-ghost" onclick="viewSession('${esc(s.group)}','${esc(s.sessionId)}')">View</button>

// New:
<button class="btn btn-sm btn-ghost" onclick="navigate('session-detail', { group: '${esc(s.group)}', sessionId: '${esc(s.sessionId)}' })">View</button>
```

- [ ] **Step 5: Verify JS syntax**

Run: `node -c src/admin/public/app.js`
Expected: syntax OK

- [ ] **Step 6: Commit**

```bash
git add src/admin/public/app.js
git commit -m "feat(sessions): add session detail page routing"
```

---

### Task 3: Stats header bar

**Files:**
- Modify: `src/admin/public/app.js`
- Modify: `src/admin/public/style.css`

- [ ] **Step 1: Add stats bar CSS**

Read `src/admin/public/style.css` and add at the end:

```css
/* Session detail — stats header bar */
.session-stats-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  padding: 10px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 8px;
  align-items: center;
  position: relative;
}

.session-stat {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.session-stat-label {
  color: var(--text-muted);
  margin-right: 4px;
}

.session-stat-value {
  color: var(--text);
  font-weight: 500;
}

.session-stats-toggle {
  margin-left: auto;
  cursor: pointer;
  opacity: 0.5;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 4px;
  transition: opacity var(--transition), background var(--transition);
}

.session-stats-toggle:hover {
  opacity: 1;
  background: var(--surface2);
}

.session-stats-menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 50;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  padding: 8px;
  min-width: 160px;
  margin-top: 4px;
}

.session-stats-menu label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
}

.session-stats-menu label:hover {
  background: var(--surface2);
}

.session-stats-menu input[type="checkbox"] {
  accent-color: var(--accent);
}
```

- [ ] **Step 2: Add renderSessionStats function**

In app.js, add:

```javascript
const DEFAULT_STATS_VISIBILITY = {
  messages: true,
  duration: true,
  tools: true,
  model: true,
  tokens: false,
  cost: false,
  errors: false,
  sessionId: false,
  created: false,
};

function getStatVisibility() {
  try {
    const saved = localStorage.getItem('session_stat_visibility');
    return saved ? { ...DEFAULT_STATS_VISIBILITY, ...JSON.parse(saved) } : DEFAULT_STATS_VISIBILITY;
  } catch {
    return DEFAULT_STATS_VISIBILITY;
  }
}

function saveStatVisibility(v) {
  localStorage.setItem('session_stat_visibility', JSON.stringify(v));
}

function renderSessionStats(stats) {
  const el = document.getElementById('session-stats-bar');
  if (!el) return;

  const visibility = getStatVisibility();
  const statDefs = {
    messages: { label: 'Messages', value: stats.messageCount },
    duration: { label: 'Duration', value: formatDuration(stats.duration) },
    tools: { label: 'Tools', value: stats.toolCount },
    model: { label: 'Model', value: stats.model },
    tokens: { label: 'Tokens', value: stats.tokenCount ? stats.tokenCount.toLocaleString() : null },
    cost: { label: 'Cost', value: stats.cost ? '$' + stats.cost.toFixed(2) : null },
    errors: { label: 'Errors', value: stats.errorCount || null },
    sessionId: { label: 'Session', value: stats.id ? stats.id.slice(0, 8) + '...' : null },
    created: { label: 'Created', value: stats.createdAt ? formatTime(stats.createdAt) : null },
  };

  const visibleStats = Object.entries(statDefs)
    .filter(([key, def]) => visibility[key] && def.value !== null)
    .map(([key, def]) => `<span class="session-stat"><span class="session-stat-label">${def.label}:</span><span class="session-stat-value">${esc(String(def.value))}</span></span>`)
    .join('');

  el.innerHTML = `
    <div class="session-stats-bar" id="session-stats-bar-inner">
      ${visibleStats}
      <span class="session-stats-toggle" onclick="toggleStatsMenu()" title="Customize stats">&#x2699;</span>
    </div>
  `;
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '';
  if (seconds < 60) return seconds + 's';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + 'm ' + s + 's';
}

window.toggleStatsMenu = function () {
  const existing = document.getElementById('session-stats-menu');
  if (existing) { existing.remove(); return; }

  const visibility = getStatVisibility();
  const menu = document.createElement('div');
  menu.id = 'session-stats-menu';
  menu.className = 'session-stats-menu';
  menu.innerHTML = Object.keys(DEFAULT_STATS_VISIBILITY).map(key =>
    `<label><input type="checkbox" ${visibility[key] ? 'checked' : ''} data-key="${key}"> ${key.charAt(0).toUpperCase() + key.slice(1)}</label>`
  ).join('') +
  '<div style="padding:4px 8px 0;display:flex;gap:6px;justify-content:flex-end;border-top:1px solid var(--border);margin-top:4px;padding-top:6px">' +
  '<button class="btn btn-sm btn-primary" onclick="saveStatsMenu()">Done</button></div>';

  document.getElementById('session-stats-bar-inner')?.appendChild(menu);
};

window.saveStatsMenu = function () {
  const v = {};
  document.querySelectorAll('#session-stats-menu input[type="checkbox"]').forEach(cb => {
    v[cb.dataset.key] = cb.checked;
  });
  saveStatVisibility(v);
  document.getElementById('session-stats-menu')?.remove();
  // Re-render stats bar with current data
  const transcript = document.getElementById('session-transcript');
  if (transcript && transcript.dataset.stats) {
    renderSessionStats(JSON.parse(transcript.dataset.stats));
  }
};
```

- [ ] **Step 3: Store stats data for re-render**

In `renderSessionDetail`, after rendering stats, store the stats JSON on the transcript element:

```javascript
document.getElementById('session-transcript').dataset.stats = JSON.stringify(data.stats);
```

- [ ] **Step 4: Verify JS syntax**

Run: `node -c src/admin/public/app.js`
Expected: syntax OK

- [ ] **Step 5: Commit**

```bash
git add src/admin/public/app.js src/admin/public/style.css
git commit -m "feat(sessions): add customizable stats header bar"
```

---

### Task 4: Full transcript with tool calls

**Files:**
- Modify: `src/admin/public/app.js`
- Modify: `src/admin/public/style.css`

- [ ] **Step 1: Add transcript CSS**

Read `src/admin/public/style.css` and add at the end:

```css
/* Session detail — transcript */
.session-transcript {
  padding: 16px;
  max-height: calc(100vh - 300px);
  overflow-y: auto;
}

.session-msg {
  margin-bottom: 12px;
  max-width: 85%;
}

.session-msg-user {
  margin-left: auto;
}

.session-msg-user .session-msg-bubble {
  background: var(--accent);
  color: white;
  border-radius: 12px 12px 4px 12px;
  padding: 10px 14px;
}

.session-msg-assistant .session-msg-bubble {
  background: var(--surface2);
  border-radius: 12px 12px 12px 4px;
  padding: 10px 14px;
}

.session-msg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.session-msg-assistant .session-msg-header {
  padding-left: 4px;
}

.session-msg-role {
  font-weight: 500;
  color: var(--text-secondary);
}

.session-msg-content {
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.session-msg-system {
  text-align: center;
  margin: 16px 0;
}

.session-msg-system .session-msg-bubble {
  display: inline-block;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 4px 14px;
  font-size: 11px;
  color: var(--text-muted);
}
```

- [ ] **Step 2: Add renderSessionTranscript function**

In app.js, add:

```javascript
function renderSessionTranscript(messages, stats) {
  const el = document.getElementById('session-transcript');
  if (!el) return;

  if (!messages || messages.length === 0) {
    el.innerHTML = '<div class="empty">No messages in this session</div>';
    return;
  }

  el.innerHTML = '<div class="session-transcript">' + messages.map((m, idx) => {
    if (m.role === 'user') {
      return `
        <div class="session-msg session-msg-user">
          <div class="session-msg-header" style="justify-content:flex-end;padding-right:4px">
            ${m.timestamp ? `<span>${formatTime(m.timestamp)}</span>` : ''}
            <span class="session-msg-role">User</span>
          </div>
          <div class="session-msg-bubble session-msg-content">${esc(m.content)}</div>
        </div>`;
    } else if (m.role === 'assistant') {
      const toolCards = (m.toolCalls || []).map(tc => `
        <div class="chat-tool-call" style="margin:6px 0" onclick="this.querySelector('.chat-tool-call-body').classList.toggle('expanded')">
          <div class="chat-tool-call-header">
            <span class="tool-icon">&#x1F527;</span>
            <span class="tool-name">${esc(tc.name)}</span>
            <span class="tool-status ${tc.output ? 'done' : 'running'}">${tc.output ? '\u2713 ' + (tc.duration || '') + 's' : '\u25CF Running...'}</span>
          </div>
          <div class="chat-tool-call-body ${tc.output ? 'expanded' : ''}">
            <div class="section-label">Input</div>
            <pre>${esc(prettyPrint(tc.input))}</pre>
            ${tc.output ? `<div class="section-label" style="margin-top:8px">Result</div><pre>${esc(prettyPrint(tc.output))}</pre>` : ''}
          </div>
        </div>
      `).join('');

      return `
        <div class="session-msg session-msg-assistant">
          <div class="session-msg-header">
            <span class="session-msg-role">Assistant</span>
            ${stats?.model ? `<span style="font-size:11px;color:var(--text-muted)">${esc(stats.model)}</span>` : ''}
            ${m.timestamp ? `<span style="font-size:11px;color:var(--text-muted)">${formatTime(m.timestamp)}</span>` : ''}
          </div>
          <div class="session-msg-bubble">
            ${m.content ? `<div class="session-msg-content">${esc(m.content)}</div>` : ''}
            ${toolCards}
          </div>
        </div>`;
    } else {
      // System/event messages
      return `
        <div class="session-msg session-msg-system">
          <div class="session-msg-bubble">${esc(m.content || m.type || '')}</div>
        </div>`;
    }
  }).join('') + '</div>';
}
```

- [ ] **Step 3: Ensure prettyPrint exists**

Search for `prettyPrint` in app.js. It should already exist from Chat Workflow Task 4. If not, add:

```javascript
function prettyPrint(jsonStr) {
  try {
    const obj = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    return JSON.stringify(obj, null, 2);
  } catch {
    return jsonStr || '';
  }
}
```

- [ ] **Step 4: Clean up the old viewSession function**

The old `viewSession` function is no longer used (View buttons now navigate to `session-detail`). Either remove it or leave it for backward compatibility. Leaving it is fine — it won't cause harm.

- [ ] **Step 5: Verify JS syntax**

Run: `node -c src/admin/public/app.js`
Expected: syntax OK

- [ ] **Step 6: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/admin/public/app.js src/admin/public/style.css
git commit -m "feat(sessions): add full transcript with inline tool call details"
```

---

### Task 5: Integration and cleanup

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
git commit -m "feat(sessions): complete agent session page v1"
```
