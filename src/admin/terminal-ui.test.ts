import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'node:vm';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Terminal operator console UI', () => {
  it('maps live terminal connectivity into shared work-session states', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain(
      'function terminalSessionViewModel(kind, sessionId)',
    );
    expect(source).toContain('window.NanoWorkSession.normalize(');
    expect(source).toContain(
      'function renderTerminalSessionState(kind, sessionId)',
    );
    expect(source).toContain('id="terminal-session-state"');
    expect(source).toContain('Loading terminal session');
    expect(source).toContain('Terminal ready');
    expect(source).toContain('Interrupted session · transcript only');
    expect(source).toContain('Terminal unavailable');
    expect(source).toContain('Reconnecting terminal');
    expect(source).toContain("isReadOnly: kind === 'interrupted'");
    expect(source).toContain('canResume: false');
    expect(source).toContain("setTerminalSessionState('ready'");
    expect(source).toContain("setTerminalSessionState('interrupted'");
    expect(source).toContain("setTerminalSessionState('unavailable'");
    expect(source).toContain("setTerminalSessionState('reconnecting'");
    expect(source).not.toContain('data-work-session-action="resume"');
    expect(source).not.toContain('function terminalOutputEndedProcess(data)');
    expect(source).toContain("msg.type === 'terminal_lifecycle'");
    expect(source).toContain("msg.data.state === 'ready'");
    expect(source).toContain("msg.data.state === 'exited'");
    expect(source).toContain("msg.data.state === 'idle-timeout'");
    expect(source).toContain("msg.data.state === 'unavailable'");
    expect(source).toContain("setTerminalSessionState('interrupted'");
    expect(source).toContain('activeTerminal.readOnly = true');
    expect(source).toContain(
      "setTerminalSessionState(wsReconnectTimer ? 'reconnecting' : 'unavailable'",
    );
  });

  it('resolves the current terminal session id for every live callback', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const initBlock = source.slice(
      source.indexOf('// Spawn or attach terminal session'),
      source.indexOf(
        'const container = document.getElementById',
        source.indexOf('// Spawn or attach terminal session'),
      ),
    );
    const attachHelper = source.slice(
      source.indexOf('function sendTerminalAttach(sessionId)'),
      source.indexOf('\nconst PAGE_ALIASES'),
    );

    expect(source).toContain('function activeTerminalId()');
    expect(initBlock).toContain('const currentSessionId = activeTerminalId()');
    expect(initBlock).toContain('sendTerminalAttach(currentSessionId)');
    expect(attachHelper).toContain("type: 'terminal_attach'");
    expect(attachHelper).toContain('sessionId');
    expect(initBlock).toContain("type: 'terminal_input'");
    expect(initBlock).not.toContain("type: 'terminal_input', sessionId, data");
    expect(source).toContain('activeTerminal.sessionId = sessionId');
  });

  it('captures, rotates, scopes, and clears the reconnect capability from typed messages', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("msg.type === 'terminal_session'");
    expect(source).toContain('function sendTerminalAttach(sessionId)');
    expect(source).toContain('activeTerminal.reconnectCapability');

    const helpersStart = source.indexOf('function activeTerminalId()');
    const helpersEnd = source.indexOf('\nconst PAGE_ALIASES', helpersStart);
    const handlerStart = source.indexOf('let handleWsMessage = function (msg)');
    const handlerEnd = source.indexOf(
      '\n};\n\nfunction bindChatApprovalActions',
      handlerStart,
    );
    const context = {
      activeTerminal: {
        sessionId: 'term-current',
        reconnectCapability: '',
        readOnly: false,
        transcript: '',
        term: { write: vi.fn() },
      },
      setTerminalSessionState: vi.fn(),
      ws: { readyState: 1, send: vi.fn() },
    } as Record<string, unknown>;
    vm.runInNewContext(
      source.slice(helpersStart, helpersEnd) +
        '\n' +
        source
          .slice(handlerStart, handlerEnd + 3)
          .replace('let handleWsMessage =', 'globalThis.handleWsMessage =') +
        '\n;globalThis.sendAttach = sendTerminalAttach;',
      context,
    );
    const handle = context.handleWsMessage as (message: unknown) => void;
    const sendAttach = context.sendAttach as (sessionId: string) => boolean;
    const socket = context.ws as { send: ReturnType<typeof vi.fn> };

    handle({
      type: 'terminal_attach_result',
      sessionId: 'term-current',
      data: { status: 'not-found', readOnly: false },
    });
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({
      type: 'terminal_spawn',
      data: 'term-current',
    });
    sendAttach('term-current');
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({
      type: 'terminal_attach',
      sessionId: 'term-current',
    });

    handle({
      type: 'terminal_session',
      sessionId: 'term-current',
      data: { sessionToken: 'capability-one' },
    });
    sendAttach('term-current');
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({
      type: 'terminal_attach',
      sessionId: 'term-current',
      sessionToken: 'capability-one',
    });

    handle({
      type: 'terminal_session',
      sessionId: 'term-current',
      data: { sessionToken: 'capability-two' },
    });
    handle({
      type: 'terminal_session',
      sessionId: 'term-stale',
      data: { sessionToken: 'wrong-capability' },
    });
    sendAttach('term-current');
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({
      type: 'terminal_attach',
      sessionId: 'term-current',
      sessionToken: 'capability-two',
    });
    sendAttach('term-stale');
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({
      type: 'terminal_attach',
      sessionId: 'term-stale',
    });

    handle({
      type: 'terminal_session',
      sessionId: 'term-current',
      data: {},
    });
    sendAttach('term-current');
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({
      type: 'terminal_attach',
      sessionId: 'term-current',
    });

    for (const state of [
      'historical',
      'ended',
      'exited',
      'idle-timeout',
      'unavailable',
    ]) {
      handle({
        type: 'terminal_session',
        sessionId: 'term-current',
        data: { sessionToken: `capability-${state}` },
      });
      handle({
        type: 'terminal_lifecycle',
        sessionId: 'term-current',
        data: { state, readOnly: true },
      });
      sendAttach('term-current');
      expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({
        type: 'terminal_attach',
        sessionId: 'term-current',
      });
    }

    handle({
      type: 'terminal_session',
      sessionId: 'term-current',
      data: { sessionToken: 'capability-history' },
    });
    handle({
      type: 'terminal_attach_result',
      sessionId: 'term-current',
      data: { status: 'historical', readOnly: true },
    });
    sendAttach('term-current');
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({
      type: 'terminal_attach',
      sessionId: 'term-current',
    });
  });

  it('manual reconnect preserves only the exact current session capability', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const helpersStart = source.indexOf('function activeTerminalId()');
    const helpersEnd = source.indexOf('\nconst PAGE_ALIASES', helpersStart);
    const reconnectStart = source.indexOf(
      'window.reconnectTerminal = function ()',
    );
    const reconnectEnd = source.indexOf(
      '\nwindow.clearTerminal',
      reconnectStart,
    );
    const send = vi.fn();
    const sessionInput = { value: 'term-current' };
    const activeTerminal = {
      sessionId: 'term-current',
      reconnectCapability: 'current-capability',
      transcript: 'old',
      term: { reset: vi.fn() },
    };
    const context = {
      activeTerminal,
      ws: { readyState: 1, send },
      window: {
        _terminalOperatorState: {},
        _spawnTerminalSession: null as null | (() => void),
      },
      document: { getElementById: () => sessionInput },
      localStorage: { setItem: vi.fn() },
      setTerminalSessionState: vi.fn(),
    } as Record<string, unknown>;
    vm.runInNewContext(
      'let activeTerminal = globalThis.activeTerminal;\n' +
        source.slice(helpersStart, helpersEnd) +
        '\n' +
        source.slice(reconnectStart, reconnectEnd) +
        '\nwindow._spawnTerminalSession = () => sendTerminalAttach(activeTerminalId());',
      context,
    );

    (context.window as { reconnectTerminal: () => void }).reconnectTerminal();
    expect(JSON.parse(send.mock.calls.at(-1)![0])).toEqual({
      type: 'terminal_attach',
      sessionId: 'term-current',
      sessionToken: 'current-capability',
    });

    sessionInput.value = 'term-other';
    (context.window as { reconnectTerminal: () => void }).reconnectTerminal();
    expect(JSON.parse(send.mock.calls.at(-1)![0])).toEqual({
      type: 'terminal_attach',
      sessionId: 'term-other',
    });
    expect(activeTerminal.reconnectCapability).toBe('');
  });

  it('never leaks a reconnect capability across session selection, history, or teardown', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const stopBlock = source.slice(
      source.indexOf('function stopPolling()'),
      source.indexOf(
        '\nfunction poll(',
        source.indexOf('function stopPolling()'),
      ),
    );
    const reconnectBlock = source.slice(
      source.indexOf('window.reconnectTerminal = function ()'),
      source.indexOf(
        '\nwindow.clearTerminal',
        source.indexOf('window.reconnectTerminal'),
      ),
    );
    const loadBlock = source.slice(
      source.indexOf('window.loadTerminalSession = function'),
      source.indexOf(
        '\nwindow.deleteTerminalSession',
        source.indexOf('window.loadTerminalSession'),
      ),
    );

    expect(stopBlock).toContain('clearTerminalReconnectCapability()');
    expect(reconnectBlock).toContain(
      'if (sessionId !== activeTerminal.sessionId)',
    );
    expect(reconnectBlock).toContain('clearTerminalReconnectCapability()');
    expect(loadBlock).toContain('clearTerminalReconnectCapability()');
    expect(source).not.toContain(
      "localStorage.setItem('terminal_session_token'",
    );
    expect(source).not.toContain(
      'localStorage.setItem("terminal_session_token"',
    );
    expect(source).not.toMatch(
      /(?:local|session)Storage\.setItem\([^)]*(?:reconnectCapability|sessionToken)/,
    );
    expect(source).not.toContain('reconnectCapability || sessionToken');
  });

  it('uses a stable websocket subscriber registry instead of wrapper restoration', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('const wsMessageSubscribers = new Map()');
    expect(source).toContain('function setWsMessageSubscriber(id, subscriber)');
    expect(source).toContain('function dispatchWsMessageSubscribers(msg)');
    expect(source).toContain("setWsMessageSubscriber('web-chat-thread', null)");
    expect(source).not.toContain('window._chatWsRestore');
  });

  it('replaces a page subscriber by id while preserving other websocket consumers', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const registrySource = source.slice(
      source.indexOf('const wsMessageSubscribers = new Map()'),
      source.indexOf('function connectWs()'),
    );
    const context = {} as Record<string, unknown>;
    vm.runInNewContext(
      registrySource +
        '\n;globalThis.setSubscriber = setWsMessageSubscriber;' +
        '\n;globalThis.dispatch = dispatchWsMessageSubscribers;',
      context,
    );
    const first = vi.fn();
    const replacement = vi.fn();
    const other = vi.fn();
    const setSubscriber = context.setSubscriber as (
      id: string,
      subscriber: null | ((message: unknown) => void),
    ) => void;
    const dispatch = context.dispatch as (message: unknown) => void;

    setSubscriber('chat', first);
    setSubscriber('other', other);
    setSubscriber('chat', replacement);
    dispatch({ type: 'task_progress' });

    expect(first).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    setSubscriber('chat', null);
    dispatch({ type: 'task_progress' });
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(2);
  });

  it('treats sentinel-like output as data and terminalizes only typed lifecycle', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const handlerStart = source.indexOf('let handleWsMessage = function (msg)');
    const handlerEnd = source.indexOf(
      '\n};\n\nfunction bindChatApprovalActions',
      handlerStart,
    );
    const handlerSource = source
      .slice(handlerStart, handlerEnd + 3)
      .replace('let handleWsMessage =', 'globalThis.handleWsMessage =');
    const setTerminalSessionState = vi.fn();
    const context = {
      activeTerminal: {
        sessionId: 'live-session',
        readOnly: false,
        transcript: '',
        term: { write: vi.fn() },
      },
      setTerminalSessionState,
      clearTerminalReconnectCapability: vi.fn(),
      ws: { readyState: 1, send: vi.fn() },
    } as Record<string, unknown>;
    vm.runInNewContext(handlerSource, context);

    (context.handleWsMessage as (message: unknown) => void)({
      type: 'terminal_output',
      sessionId: 'live-session',
      data: '\r\n[Process exited]\r\n',
    });

    expect((context.activeTerminal as { readOnly: boolean }).readOnly).toBe(
      false,
    );
    expect(setTerminalSessionState).not.toHaveBeenCalled();

    (context.handleWsMessage as (message: unknown) => void)({
      type: 'terminal_lifecycle',
      sessionId: 'live-session',
      data: { state: 'exited', readOnly: true, reason: 'process-exit' },
    });

    expect((context.activeTerminal as { readOnly: boolean }).readOnly).toBe(
      true,
    );
    expect(setTerminalSessionState).toHaveBeenCalledWith(
      'interrupted',
      'live-session',
    );
  });

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

    expect(connectBlock).toContain('sendTerminalAttach(activeTerminalId())');
    expect(connectBlock).not.toContain("type: 'terminal_spawn'");
    expect(initBlock).toContain('sendTerminalAttach(currentSessionId)');
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
      setTerminalSessionState: vi.fn(),
      clearTerminalReconnectCapability: vi.fn(),
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
      setTerminalSessionState: vi.fn(),
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
    expect(source).toContain("type: 'terminal_input'");
    expect(source).toContain('sessionId: currentSessionId');
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
