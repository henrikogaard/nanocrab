import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'node:vm';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Terminal operator console UI', () => {
  it('frames terminal as an owner-only operator console', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Operator console');
    expect(source).toContain('Terminal access requires owner role.');
    expect(source).toContain('terminal-command-center');
    expect(source).toContain('terminal-safety-map');
    expect(source).toContain('terminalSafetyCards');
    expect(source).toContain('terminalPreflightChecks');
    expect(source).toContain('terminalOperatorBriefText');
    expect(source).toContain('terminalHandoffPromptText');
    expect(source).toContain('_terminalOperatorState');
    expect(source).toContain('copyTerminalOperatorBrief');
    expect(source).toContain('copyTerminalHandoffPrompt');
    expect(source).toContain('Copy operator brief');
    expect(source).toContain('Copy handoff prompt');
    expect(source).toContain('Terminal operator brief');
    expect(source).toContain('Terminal handoff prompt copied');
    expect(source).toContain(
      'Use this terminal evidence to continue NanoCrab work in the right workspace.',
    );
    expect(source).toContain(
      'Run local commands when dashboard workflows are too coarse.',
    );
    expect(source).toContain(
      'Open repository files from the side pane and hand edits to Code.',
    );
    expect(source).toContain(
      'Watch runtime output beside the shell before changing services.',
    );
    expect(source).toContain(
      'Capture command evidence for reviews, incidents, and handoffs.',
    );
    expect(source).toContain(
      'Before running more commands, state the intended change, confirm the working directory, and prefer read-only inspection unless a service change or file edit is explicitly needed.',
    );
    expect(source).toContain(
      'Move durable edits to Code, verification proof to Test Runner, runtime findings to Logs/System Info, and project outputs to Cowork artifacts.',
    );
    expect(source).toContain(
      'No terminal transcript has been captured for this session yet.',
    );
    expect(source).toContain(
      'Start with a read-only command such as pwd, git status --short, or npm scripts before making changes.',
    );
    expect(source).toContain(
      'Use Logs/System Info when the issue is runtime health, Code when files need durable edits, and Test Runner when proof is the goal.',
    );
    expect(source).toContain(
      'Code: use when files, repositories, tests, commits, branches, or implementation changes are involved.',
    );
    expect(source).toContain(
      'Test Runner: use when the next step is verification evidence, failing tests, or proof collection.',
    );
    expect(source).toContain(
      'Cowork: use when terminal output should become a project note, artifact, report source, or document draft.',
    );
    expect(source).toContain(
      'Logs/System Info: use when runtime health, services, containers, or platform state explain the issue.',
    );
    expect(source).toContain(
      'State whether any command wrote files, restarted services, changed credentials, or touched external systems.',
    );
    expect(source).toContain(
      'Recommend the next workspace: Code, Test Runner, Cowork, Logs/System Info, or Approvals.',
    );
    expect(source).toContain(
      'Ask for approval before destructive commands, service restarts, repository writes, external sends, or credential changes.',
    );
    expect(source).toContain('Pre-command checklist');
    expect(source).toContain('Use the terminal with intent, not momentum.');
    expect(source).toContain(
      'Before running commands, pin the goal, context, blast radius, and evidence path.',
    );
    expect(source).toContain('Intent');
    expect(source).toContain('Location');
    expect(source).toContain('Blast radius');
    expect(source).toContain('Evidence');
    expect(source).toContain(
      'Say what the command should prove or change before executing it.',
    );
    expect(source).toContain(
      'Confirm pwd, repository, service, or container context before acting.',
    );
    expect(source).toContain(
      'Prefer read-only inspection before file writes, service restarts, or destructive commands.',
    );
    expect(source).toContain(
      'Copy transcript or operator brief before handing findings to Code, Test Runner, or Cowork.',
    );
    expect(source).not.toContain('No transcript captured yet.');
  });

  it('keeps terminal session controls and split-pane hooks wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('id="terminal-session-id"');
    expect(source).toContain('reconnectTerminal');
    expect(source).toContain('clearTerminal');
    expect(source).toContain('copyTerminalTranscript');
    expect(source).toContain('Copy terminal transcript');
    expect(source).toContain('Terminal transcript copied');
    expect(source).toContain('spawnNewTerminal');
    expect(source).toContain('id="terminal-split"');
    expect(source).toContain('id="split-divider"');
    expect(source).toContain('switchTermPane');
    expect(source).toContain(
      "container.style.setProperty('--terminal-left-pct'",
    );
    expect(source).toContain(
      "document.body.classList.add('is-terminal-resizing')",
    );
    expect(source).toContain(
      "document.body.classList.remove('is-terminal-resizing')",
    );
    expect(source).toContain('class="tab-content is-hidden" id="left-files"');
    expect(source).toContain('class="tab-content is-hidden" id="right-search"');
    expect(source).toContain("c.classList.add('is-hidden')");
    expect(source).toContain("target.classList.remove('is-hidden')");
    expect(source).not.toContain('leftPane.style.flex');
    expect(source).not.toContain('rightPane.style.flex');
    expect(source).not.toContain(
      "document.getElementById('pane-left').style.flex",
    );
    expect(source).not.toContain(
      "document.getElementById('pane-right').style.flex",
    );
    expect(source).not.toContain('document.body.style.cursor');
    expect(source).not.toContain('document.body.style.userSelect');
    expect(source).not.toContain('id="left-files" style="display:none"');
    expect(source).not.toContain('id="right-search" style="display:none"');
    expect(source).not.toContain("c.style.display = 'none'");
    expect(source).not.toContain("target.style.display = ''");
    expect(source).not.toContain(
      "navigator.clipboard.writeText(activeTerminal.transcript || '')",
    );
    expect(source).not.toContain('Clipboard access failed');
  });

  it('keeps historical terminal attachment read-only until a deliberate new session', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const connectBlock = source.slice(
      source.indexOf('ws.onopen = () =>'),
      source.indexOf('ws.onmessage ='),
    );
    const initBlock = source.slice(
      source.indexOf('// Spawn or attach terminal session'),
      source.indexOf('term.onData'),
    );

    expect(connectBlock).toContain("type: 'terminal_attach'");
    expect(connectBlock).not.toContain("type: 'terminal_spawn'");
    expect(initBlock).toContain("type: 'terminal_attach'");
    expect(initBlock).not.toContain("type: 'terminal_spawn'");
    expect(source).toContain("msg.type === 'terminal_attach_result'");
    expect(source).toContain("msg.data.status === 'not-found'");
    expect(source).toContain("msg.data.status === 'historical'");
    expect(source).toContain('activeTerminal.readOnly');
    expect(source).not.toContain('<div class="terminal-shell-card">">');
  });

  it('provides persistent, keyboard-accessible workspace pane combinations', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const styles = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tab"');
    expect(source).toContain('aria-selected="true"');
    expect(source).toContain('data-tab="chat"');
    expect(source).toContain('data-tab="diff"');
    expect(source).toContain('id="right-chat"');
    expect(source).toContain('id="right-diff"');
    expect(source).toContain('terminal_pane_left');
    expect(source).toContain('terminal_pane_right');
    expect(source).toContain('bindTerminalPaneKeyboard');
    expect(source).toContain("e.key === 'ArrowRight'");
    expect(source).toContain("e.key !== 'ArrowLeft'");
    expect(source).toContain("e.key === 'ArrowRight' ? 1 : -1");
    expect(source).toContain('loadTerminalChatPane');
    expect(source).toContain('loadTerminalDiffPane');
    expect(styles).toContain('.terminal-chat-pane');
    expect(styles).toContain('.terminal-diff-pane');
    expect(styles).toContain('overflow-x: hidden;');
    expect(styles).toContain('.terminal-split-pane {\n    min-width: 0;');
  });

  it('labels sessions interrupted by restart as transcript-only', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("s.recoveryState === 'interrupted'");
    expect(source).toContain('Interrupted by service restart');
    expect(source).toContain('Transcript only');
  });

  it('drives the real message handler without spawning after historical attach', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const start = source.indexOf('let handleWsMessage = function (msg)');
    const end = source.indexOf(
      '\n};\n\nfunction bindChatApprovalActions',
      start,
    );
    const handlerSource = source
      .slice(start, end + 3)
      .replace('let handleWsMessage =', 'globalThis.handleWsMessage =');
    const send = vi.fn();
    const context = {
      activeTerminal: {
        sessionId: 'historical-session',
        readOnly: false,
        term: { write: vi.fn() },
      },
      ws: { readyState: 1, send },
    } as Record<string, unknown>;
    vm.runInNewContext(handlerSource, context);

    (context.handleWsMessage as (message: unknown) => void)({
      type: 'terminal_attach_result',
      sessionId: 'historical-session',
      data: { status: 'historical', readOnly: true },
    });

    expect((context.activeTerminal as { readOnly: boolean }).readOnly).toBe(
      true,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('allows the real message handler to spawn only an explicitly fresh id', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const start = source.indexOf('let handleWsMessage = function (msg)');
    const end = source.indexOf(
      '\n};\n\nfunction bindChatApprovalActions',
      start,
    );
    const handlerSource = source
      .slice(start, end + 3)
      .replace('let handleWsMessage =', 'globalThis.handleWsMessage =');
    const send = vi.fn();
    const context = {
      activeTerminal: {
        sessionId: 'fresh-session',
        readOnly: false,
        term: { write: vi.fn() },
      },
      ws: { readyState: 1, send },
    } as Record<string, unknown>;
    vm.runInNewContext(handlerSource, context);

    (context.handleWsMessage as (message: unknown) => void)({
      type: 'terminal_attach_result',
      sessionId: 'fresh-session',
      data: { status: 'not-found', readOnly: false },
    });

    expect(send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'terminal_spawn', data: 'fresh-session' }),
    );
  });

  it('keeps files, logs, search, and WebSocket terminal behavior intact', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('loadTerminalFileTree');
    expect(source).toContain('term-file-tree');
    expect(source).toContain('renderTerminalFileTreeState');
    expect(source).toContain('loadTerminalLogs');
    expect(source).toContain('term-log-viewer');
    expect(source).toContain('runTerminalSearch');
    expect(source).toContain('focusTerminalSearchPane');
    expect(source).toContain("window.switchTermPane?.('right', 'search')");
    expect(source).toContain('input.select();');
    expect(source).toContain('term-search-input');
    expect(source).toContain(
      "ws.send(JSON.stringify({ type: 'terminal_input', sessionId, data }))",
    );
    expect(source).toContain(
      "ws.send(JSON.stringify({ type: 'subscribe_logs', data: 'system' }))",
    );
    expect(source).not.toContain(
      "prompt('Search terminal (Ctrl+G next, Shift+Ctrl+G prev):')",
    );
  });

  it('uses operator recovery copy when terminal transcripts cannot load', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const actions = source.slice(
      source.indexOf('function terminalActionErrorMessage'),
      source.indexOf('window.focusTerminalSearchPane'),
    );

    expect(actions).toContain('terminalActionErrorMessage');
    expect(actions).toContain('Terminal transcript could not be loaded.');
    expect(actions).toContain('Sessions, Logs, or Monitoring');
    expect(actions).toContain('Code, Test Runner, or Cowork');
    expect(actions).toContain(
      "toast(terminalActionErrorMessage('transcript', e), 'error')",
    );
    expect(actions).not.toContain(
      "toast('Failed to load transcript: ' + e.message, 'error')",
    );
  });

  it('turns terminal log pane empty and failure states into operator recovery actions', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const styles = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderTerminalLogState');
    expect(source).toContain('terminal-log-state');
    expect(source).toContain("renderTerminalLogState('loading')");
    expect(source).toContain('Loading runtime logs');
    expect(source).toContain('terminal-log-skeleton');
    expect(source).toContain('Log stream quiet');
    expect(source).toContain('Log stream unavailable');
    expect(source).toContain('Could not load system logs');
    expect(source).toContain('No log entries in this window');
    expect(source).toContain(
      "navigate('monitoring');setTimeout(function(){window.switchTab?.('mon-tabs','logs')",
    );
    expect(source).toContain(
      "navigate('monitoring');setTimeout(function(){window.switchTab?.('mon-tabs','system')",
    );
    expect(source).not.toContain(": 'No log entries'");
    expect(source).not.toContain("el.innerHTML = 'Failed to load logs';");
    expect(styles).toContain('.terminal-log-state');
    expect(styles).toContain('.terminal-log-state.is-loading');
    expect(styles).toContain('.terminal-log-state.is-error');
    expect(styles).toContain('.terminal-log-actions');
    expect(styles).toContain('.terminal-log-actions button:focus-visible');
    expect(styles).toContain('.terminal-log-skeleton');
    expect(styles).toContain('@keyframes terminalLogLoading');
  });

  it('uses class-based terminal panes, search controls, and file tree states', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('terminal-split-pane');
    expect(source).toContain('terminal-xterm-container');
    expect(source).toContain('terminal-search-input');
    expect(source).toContain('terminal-search-date-row');
    expect(source).toContain('terminal-date-input');
    expect(source).toContain('term-file-tree-state');
    expect(source).toContain(
      'No repositories mounted for terminal file browsing',
    );
    expect(source).toContain('Terminal file tree unavailable');
    expect(source).toContain('term-tree-dir');
    expect(source).not.toContain(
      'id="terminal-container" style="height:100%;background:var(--bg)"',
    );
    expect(source).not.toContain(
      'id="term-search-input" placeholder="Search terminal history..." style="flex:1"',
    );
    expect(source).not.toContain('style="width:auto;padding:2px 6px"');
    expect(source).not.toContain('style="padding:8px;color:var(--text-muted)"');
    expect(source).not.toContain('details style="padding-left:10px"');
    expect(source).not.toContain(
      '<div class="term-file-tree-note">No repos mounted</div>',
    );
    expect(source).not.toContain(
      '<div class="term-file-tree-note">Failed to load</div>',
    );
  });

  it('turns terminal owner access denial into a routed recovery state', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const styles = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderTerminalAccessState');
    expect(source).toContain('terminal-access-state');
    expect(source).toContain('Owner-only console');
    expect(source).toContain(
      'Ask an owner to run the command or continue from safer dashboard surfaces.',
    );
    expect(source).toContain("navigate('monitoring')");
    expect(source).toContain("navigate('devhub')");
    expect(source).toContain("navigate('dashboard')");
    expect(source).not.toContain(
      '<div class="card"><div class="empty">Terminal access requires owner role.</div></div>',
    );
    expect(styles).toContain('.terminal-access-state');
    expect(styles).toContain('.terminal-access-actions');
    expect(styles).toContain('.terminal-access-actions button:focus-visible');
  });

  it('labels terminal recovery links to the dashboard route as Today', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const terminalStateStart = source.indexOf(
      'function renderTerminalAccessState',
    );
    const terminalStateEnd = source.indexOf(
      'async function loadTerminalFileTree',
      terminalStateStart,
    );
    const terminalStates = source.slice(terminalStateStart, terminalStateEnd);

    expect(
      terminalStates.match(
        /onclick="navigate\('dashboard'\)">Today<\/button>/g,
      ) || [],
    ).toHaveLength(2);
    expect(terminalStates).not.toContain(
      'onclick="navigate(\'dashboard\')">Dashboard</button>',
    );
  });

  it('uses class-based terminal search feedback states', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const searchBlock = source.slice(
      source.indexOf('window.runTerminalSearch'),
      source.indexOf('window.viewTerminalTranscript'),
    );
    const styles = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderTerminalSearchState');
    expect(source).toContain("renderTerminalSearchState('idle')");
    expect(source).toContain("renderTerminalSearchState('loading')");
    expect(source).toContain("renderTerminalSearchState(\n        'empty'");
    expect(source).toContain("renderTerminalSearchState(\n        'error'");
    expect(source).toContain('Search terminal history');
    expect(source).toContain('Searching terminal history');
    expect(source).toContain('No terminal matches found');
    expect(source).toContain('Terminal search unavailable');
    expect(source).toContain('terminal-search-loading');
    expect(source).toContain('terminal-search-actions');
    expect(source).toContain("navigate('sessions')");
    expect(source).toContain('terminal-search-state');
    expect(source).toContain('terminal-search-state is-${esc(kind)}');
    expect(source).toContain("kind === 'empty' ? ' is-spacious' : ''");
    expect(source).toContain('error: {');
    expect(searchBlock).toContain('terminal-search-count');
    expect(searchBlock).not.toContain('Enter a query to search</div>');
    expect(searchBlock).not.toContain('Searching...</div>');
    expect(searchBlock).not.toContain('No results found for <strong>');
    expect(searchBlock).not.toContain("Search failed: ' +");
    expect(searchBlock).not.toContain(
      'style="color:var(--text-muted);padding:12px;text-align:center;font-size:12px"',
    );
    expect(searchBlock).not.toContain(
      'style="padding:12px;text-align:center;font-size:12px;color:var(--text-muted)"',
    );
    expect(searchBlock).not.toContain(
      'style="color:var(--text-muted);padding:16px;text-align:center;font-size:12px"',
    );
    expect(searchBlock).not.toContain(
      'style="padding:8px;text-align:center;font-size:11px;color:var(--text-muted)"',
    );
    expect(searchBlock).not.toContain(
      'style="color:var(--error);padding:12px;text-align:center;font-size:12px"',
    );
    expect(styles).toContain('.terminal-search-state');
    expect(styles).toContain('.terminal-search-state.is-spacious');
    expect(styles).toContain('.terminal-search-state.is-error');
    expect(styles).toContain('.terminal-search-actions');
    expect(styles).toContain('.terminal-search-actions button:focus-visible');
    expect(styles).toContain('.terminal-search-loading');
    expect(styles).toContain('@keyframes terminalSearchLoading');
    expect(styles).toContain('.terminal-search-count');
  });

  it('styles the operator console, safety map, and mobile stacking', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.terminal-command-center');
    expect(source).toContain('.terminal-command-actions');
    expect(source).toContain('.terminal-session-field');
    expect(source).toContain('body.is-terminal-resizing');
    expect(source).toContain('user-select: none;');
    expect(source).toContain('--terminal-left-pct: 50%');
    expect(source).toContain('flex: 0 0 var(--terminal-left-pct)');
    expect(source).toContain('flex: 1 1 calc(100% - var(--terminal-left-pct))');
    expect(source).toContain('.terminal-safety-map');
    expect(source).toContain('.terminal-safety-card');
    expect(source).toContain('.terminal-preflight-panel');
    expect(source).toContain('.terminal-preflight-head');
    expect(source).toContain('.terminal-preflight-actions');
    expect(source).toContain('.terminal-preflight-grid');
    expect(source).toContain('.terminal-preflight-card');
    expect(source).toContain('.terminal-shell-card');
    expect(source).toContain('.split-container');
    expect(source).toContain('.terminal-split-pane');
    expect(source).toContain('.terminal-xterm-container');
    expect(source).toContain('.terminal-search-date-row');
    expect(source).toContain('.terminal-date-input');
    expect(source).toContain('.term-file-tree-state');
    expect(source).toContain('.term-file-tree-state.is-error');
    expect(source).toContain('.term-file-tree-actions');
    expect(source).toContain('.term-tree-dir');
    expect(source).toContain('.terminal-log-state');
    expect(source).toContain('.pane-content > .tab-content.is-hidden');
    expect(source).toContain(
      '.terminal-safety-map {\n    grid-template-columns: 1fr;',
    );
    expect(source).toContain(
      '.terminal-preflight-grid {\n    grid-template-columns: 1fr;',
    );
  });
});
