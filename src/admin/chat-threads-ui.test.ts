import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'node:vm';

const scriptPath = path.join(
  process.cwd(),
  'src/admin/public/pages/chat-threads.js',
);
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');
const appPath = path.join(process.cwd(), 'src/admin/public/app.js');

type WebChatHarnessApi = {
  setActiveThreadId(id: string): void;
  processRunEvent(message: unknown, threadId: string): boolean;
  promoteThread(destination: string): void;
};

function loadWebChatHarness() {
  const strip = {
    innerHTML: '',
    onclick: null as null | ((event: unknown) => void),
    replaceChildren() {
      this.innerHTML = '';
    },
  };
  const values = new Map<string, string>();
  const context = {
    window: {
      NanoWorkSession: {
        normalize: (value: Record<string, unknown>) => ({
          ...value,
          approvals: value.approvals || [],
        }),
        renderRunStrip: (session: Record<string, unknown>) =>
          `<div>${session.status}:${session.currentStep}</div>`,
      },
    },
    document: {
      addEventListener() {},
      getElementById(id: string) {
        return id === 'thread-run-strip' ? strip : null;
      },
      querySelector() {
        return null;
      },
    },
    sessionStorage: {
      getItem(key: string) {
        return values.get(key) || null;
      },
      removeItem(key: string) {
        values.delete(key);
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    },
    setWsMessageSubscriber() {},
    navigate() {},
    console,
  } as Record<string, unknown>;
  vm.runInNewContext(fs.readFileSync(scriptPath, 'utf8'), context);
  return { context, strip, values };
}

describe('WebChat new conversation start surface', () => {
  it('shows shared run state only for active work and keeps promotions explicit', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');

    expect(source).toContain('function renderActiveChatRun(session)');
    expect(source).toContain('window.NanoWorkSession.renderRunStrip(session)');
    expect(source).toContain('id="thread-run-strip"');
    expect(source).toContain("status: 'running'");
    expect(source).toContain('function isActiveChatRun(session)');
    expect(source).toContain('data-webchat-action="promote-thread"');
    expect(source).toContain('data-promotion-destination="cowork"');
    expect(source).toContain('data-promotion-destination="code"');
    expect(source).toContain("sessionStorage.setItem('work_session_promotion'");
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('gitcode')");
    expect(source).not.toContain('onclick="promote');
    expect(source).not.toContain("api('/threads/promote'");
    expect(source).not.toContain(
      "updateActiveChatRun({ currentStep: 'Sending message'",
    );
    expect(source).toContain('function applyChatRunEvent(msg, threadId)');
    expect(source).toContain("msg.type === 'task_progress'");
    expect(source).toContain('if (evJid !== threadId) return false');
    expect(source).toContain('isTerminalTaskProgress(msg.data)');
    expect(source).toContain("setWsMessageSubscriber('web-chat-thread'");
    expect(source).not.toContain('var origHandler = handleWsMessage');
    expect(source).not.toContain('handleWsMessage = threadWsHandler');
  });

  it('creates fresh, consumed promotion handoffs for the current thread', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');

    expect(source).toContain(
      "sessionStorage.removeItem('work_session_promotion')",
    );
    expect(source).toContain("threadId: _activeThreadId || ''");
    expect(source).toContain('brief: chatThreadBriefText(state)');
    const promotionBlock = source.slice(
      source.indexOf('function promoteThread(destination)'),
      source.indexOf('function installWebChatActionHandlers'),
    );
    expect(promotionBlock).not.toContain('state.threadId || _activeThreadId');
    expect(source).toContain('clearWebChatThreadState()');
  });

  it('activates run state only from scoped live lifecycle evidence', () => {
    const { context, strip } = loadWebChatHarness();
    const webChat = (context.window as { WebChat: WebChatHarnessApi }).WebChat;
    webChat.setActiveThreadId('web:current');

    expect(
      webChat.processRunEvent(
        {
          type: 'task_progress',
          data: { groupJid: 'web:other', phase: 'run', pct: 20 },
        },
        'web:current',
      ),
    ).toBe(false);
    expect(strip.innerHTML).toBe('');

    expect(
      webChat.processRunEvent(
        {
          type: 'task_progress',
          data: {
            groupJid: 'web:current',
            phase: 'run',
            message: 'Inspecting',
            pct: 20,
          },
        },
        'web:current',
      ),
    ).toBe(true);
    expect(strip.innerHTML).toContain('running:Inspecting');

    webChat.processRunEvent(
      {
        type: 'task_progress',
        data: { groupJid: 'web:current', phase: 'failed', pct: 20 },
      },
      'web:current',
    );
    expect(strip.innerHTML).toBe('');
  });

  it('always promotes the currently selected thread and preserves hostile ids as data', () => {
    const { context, values } = loadWebChatHarness();
    const window = context.window as {
      WebChat: WebChatHarnessApi;
      _webchatThreadBriefState?: Record<string, unknown>;
    };
    const hostileId = 'web:new<thread>"';
    window.WebChat.setActiveThreadId('web:stale');
    window._webchatThreadBriefState = {
      threadId: 'web:stale',
      title: 'Old',
      messages: [],
      threadMeta: {},
    };
    window.WebChat.setActiveThreadId(hostileId);
    window._webchatThreadBriefState = {
      threadId: hostileId,
      title: 'Current',
      messages: [],
      threadMeta: {},
    };

    window.WebChat.promoteThread('code');
    const payload = JSON.parse(values.get('work_session_promotion') || '{}');
    expect(payload).toMatchObject({ destination: 'code', threadId: hostileId });
    expect(payload.brief).toContain('Current');
    expect(payload.brief).not.toContain('Old');
  });

  it('consumes promotion only at the matching destination and escapes its surface', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const start = source.indexOf('function consumeWorkSessionPromotion');
    const end = source.indexOf(
      'window.renderWorkSessionPromotion = renderWorkSessionPromotion;',
      start,
    );
    const values = new Map<string, string>();
    const context = {
      window: {},
      sessionStorage: {
        getItem: (key: string) => values.get(key) || null,
        removeItem: (key: string) => values.delete(key),
      },
      esc: (value: unknown) =>
        String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;'),
    } as Record<string, unknown>;
    vm.runInNewContext(
      source.slice(start, end) +
        '\n;globalThis.consume = consumeWorkSessionPromotion;' +
        '\n;globalThis.render = renderWorkSessionPromotion;',
      context,
    );
    const hostileId = 'web:<img src=x onerror=alert(1)>"';
    values.set(
      'work_session_promotion',
      JSON.stringify({
        destination: 'code',
        threadId: hostileId,
        brief: '<script>alert(1)</script>',
      }),
    );
    const consume = context.consume as (destination: string) => unknown;
    const render = context.render as (promotion: unknown) => string;

    expect(consume('cowork')).toBeNull();
    expect(values.has('work_session_promotion')).toBe(true);
    const promotion = consume('code') as Record<string, string>;
    expect(promotion.threadId).toBe(hostileId);
    expect(values.has('work_session_promotion')).toBe(false);
    const html = render(promotion);
    expect(html).toContain('data-work-session-promotion');
    expect(html).toContain('data-promotion-destination="code"');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    const style = fs.readFileSync(stylePath, 'utf8');
    expect(style).toContain('.work-session-promotion-handoff pre');
    expect(style).toContain('white-space: pre-wrap;');
    expect(style).toContain('overflow-wrap: anywhere;');
  });

  it('creates plain chat threads from the configured model picker, not agent templates', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');

    expect(source).toContain("api('/system/provider')");
    expect(source).toContain('loadWebChatProviderChoices');
    expect(source).toContain('available[p.id] !== false');
    expect(source).toContain('id="webchat-start-model-select"');
    expect(source).toContain('id="webchat-start-model-search"');
    expect(source).toContain('filterStartModelOptions');
    expect(source).toContain('data-model-search-text');
    expect(source).toContain('provider.id + ');
    expect(source).toContain("localStorage.setItem('webchat_last_provider'");
    expect(source).not.toContain('Agent template');
    expect(source).not.toContain('/threads/agent-templates');
    expect(source).not.toContain('templateAgentId');
  });

  it('offers starter prompts through the inline start composer', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('var CHAT_STARTERS = [');
    expect(source).toContain('webchat-start-suggestions');
    expect(source).toContain('webchat-start-row');
    expect(source).toContain('startFromPrompt');
    expect(source).toContain(
      "'/threads/' + encodeURIComponent(resp.id) + '/messages'",
    );
    expect(source).toContain('message: prompt');
    expect(source).toContain('How can I help you?');
    expect(style).toContain('.webchat-start-composer');
    expect(style).toContain('#webchat-start-model-select');
    expect(source).not.toContain('body.title = selectedStarter');
  });

  it('supports virtual Chat projects for grouping conversations', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain("api('/threads/projects'");
    expect(source).toContain('chatProjectId');
    expect(source).toContain('data-webchat-action="create-chat-project"');
    expect(source).toContain('data-webchat-action="assign-chat-project"');
    expect(source).toContain('renderChatProjectSections');
    expect(source).toContain('Virtual folders for related chats');
    expect(source).toContain('id="webchat-start-project-select"');
    expect(style).toContain('.webchat-project-section');
    expect(style).toContain('.webchat-project-create');
  });

  it('renders an active plain-chat brief with reusable starter prompts', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('renderPlainThreadBrief');
    expect(source).toContain('renderEmptyThreadState');
    expect(source).toContain('renderWebchatLoadingState');
    expect(source).toContain('function setProgressFill');
    expect(source).toContain('chatThreadBriefText');
    expect(source).toContain('_webchatThreadBriefState');
    expect(source).toContain('Data health: ');
    expect(source).toContain(
      'Thread messages and metadata loaded without known fallback.',
    );
    expect(source).toContain('Thread messages unavailable');
    expect(source).toContain('Thread metadata unavailable');
    expect(source).toContain('Thread title lookup unavailable');
    expect(source).toContain('renderThreadMessageLoadIssue');
    expect(source).toContain('renderThreadContextUnavailable');
    expect(source).toContain('chatActionErrorMessage');
    expect(source).toContain('Your draft was restored');
    expect(source).toContain('input.value = msg');
    expect(source).toContain('copyThreadBrief');
    expect(source).toContain('webchat-plain-brief');
    expect(source).toContain('Plain chat');
    expect(source).toContain(
      'Plain chat has no project files, artifacts, or agent template.',
    );
    expect(source).toContain('No project context');
    expect(source).toContain('plainChatMcpAccessText(threadMeta)');
    expect(source).toContain('useStarterPrompt');
    expect(source).toContain('webchat-chatgpt-shell');
    expect(source).toContain('webchat-chatgpt-topbar');
    expect(source).toContain('webchat-chatgpt-context');
    expect(source).toContain('webchat-chatgpt-composer');
    expect(source).toContain('webchat-thread-card');
    expect(source).toContain('webchat-thread-empty-state');
    expect(source).toContain('Loading chat context');
    expect(source).toContain(
      'Checking whether this is a plain Chat thread or a Cowork project thread',
    );
    expect(source).toContain('renderWebchatLoadingState()');
    expect(source).toContain('Start with a plain chat prompt.');
    expect(source).toContain(
      'Move to Cowork when you need durable project context or MCP-backed documents.',
    );
    expect(source).toContain("navigate('projects')");
    expect(source).toContain('webchat-thread-title');
    expect(source).toContain('webchat-thread-actions');
    expect(source).toContain('webchat-thread-action');
    expect(source).toContain('renderThreadSidebarEmptyState');
    expect(source).toContain('thread-sidebar-empty');
    expect(source).toContain('window._webchatThreadListLoadIssue');
    expect(source).toContain('Chat list unavailable');
    expect(source).toContain('Retry list');
    expect(source).toContain('Chat queue');
    expect(source).toContain('Start a plain chat for quick thinking');
    expect(source).toContain(
      'Use Cowork when the request needs project files, MCP tools, or durable artifacts.',
    );
    expect(source).toContain('phase-entry-marker');
    expect(source).toContain('id="progress-spinner"');
    expect(source).toContain('setProgressFill(fill, 0)');
    expect(source).toContain('setProgressFill(fill, msg.data.pct)');
    expect(source).toContain(
      "input.style.setProperty(\n      '--chat-input-height'",
    );
    expect(source).not.toContain("input.style.height = 'auto'");
    expect(source).not.toContain(
      'input.style.height = Math.min(input.scrollHeight, 148)',
    );
    expect(source).toContain('section-label-result');
    expect(source).toContain('Copy chat brief');
    expect(source).toContain('Web chat thread brief');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("window.prompt('Copy web chat thread brief:'");
    expect(source).toContain('openNewConversationSurface()');
    expect(source).toContain('function openConfirmModal(options)');
    expect(source).toContain('function openInputModal(options)');
    expect(source).toContain("title: 'Rename conversation'");
    expect(source).toContain(
      'Give this chat a title that makes it easy to find later.',
    );
    expect(source).toContain('webchat-input-panel');
    expect(source).toContain("title: 'Delete conversation'");
    expect(source).toContain(
      'This removes the conversation and its local thread history',
    );
    expect(source).toContain('webchat-confirm-panel');
    expect(source).not.toContain('id="thread-title" style="margin:0"');
    expect(source).not.toContain(
      '<div class="empty">No messages yet. Send one below.</div>',
    );
    expect(source).not.toContain(
      '<div class="chat-messages" id="chat-messages-area"><div class="loading">Loading</div></div>',
    );
    expect(source).not.toContain('class="card webchat-thread-card"');
    expect(source).not.toContain('id="progress-fill" style="width:0%"');
    expect(source).not.toContain('id="thread-copy-brief-btn" style=');
    expect(source).not.toContain('id="thread-rename-btn" style=');
    expect(source).not.toContain('id="thread-delete-btn" style=');
    expect(source).not.toContain(
      'class="section-label" style="margin-top:8px"',
    );
    expect(source).not.toContain('class="nav-empty" style=');
    expect(source).not.toContain(
      '<div class="nav-empty">No conversations yet</div>',
    );
    expect(source).not.toContain('catch (_) {\n      return [];\n    }');
    expect(source).not.toContain("toast('Failed to send message', 'error')");
    expect(source).not.toContain('spinner.style.display');
    expect(source).not.toContain('fill.style.width');
    expect(source).not.toContain("window.prompt('Rename conversation:'");
    expect(source).not.toContain("window.confirm('Delete this conversation?')");
    expect(source).toContain('function conversationRoot()');
    expect(source).toContain("document.getElementById('page-content')");
    expect(source).toContain('if (location.hash === nextHash)');
    expect(source).toContain('data-thread-id="');
    expect(source).toContain('data-thread-title="');
    expect(source).toContain('installThreadListHandlers');
    expect(source).not.toContain('onclick="WebChat.openThread(');
    expect(source).not.toContain('jsStringAttr(t.id)');
    expect(source).not.toContain('jsStringAttr(t.title || t.id)');
    expect(source).not.toContain('JSON.stringify(t.id)');
    expect(source).not.toContain('JSON.stringify(t.title || t.id)');
    expect(source).not.toContain("document.getElementById('main')");
    expect(style).toContain('width: var(--progress-pct, 0%);');
    expect(style).toContain('height: var(--chat-input-height, 40px);');
    expect(style).toContain('.webchat-plain-brief');
    expect(style).toContain('.webchat-plain-starters');
    expect(style).toContain('.webchat-chatgpt-shell');
    expect(style).toContain('.webchat-chatgpt-composer');
    expect(style).toContain('.webchat-chatgpt-shell .chat-msg-bot::before');
    expect(style).toContain('.webchat-chatgpt-shell #chat-send-btn::before');
    expect(style).not.toContain(
      '.webchat-chatgpt-context .webchat-plain-brief {\n  display: none;',
    );
    expect(style).toContain('.webchat-thread-card');
    expect(style).toContain('.webchat-loading-state');
    expect(style).toContain('.webchat-loading-state::after');
    expect(style).toContain('.webchat-loading-flow');
    expect(style).toContain('@keyframes webchatLoadingSweep');
    expect(style).toContain('.webchat-thread-empty-state');
    expect(style).toContain('.webchat-thread-empty-starters');
    expect(style).toContain(
      '.webchat-thread-empty-starters button:focus-visible',
    );
    expect(style).toContain('.webchat-thread-title');
    expect(style).toContain('.webchat-thread-actions');
    expect(style).toContain('.webchat-thread-action');
    expect(style).toContain('.thread-sidebar-empty');
    expect(style).toContain('.thread-sidebar-empty.is-error');
    expect(style).toContain('.thread-sidebar-empty button:focus-visible');
    expect(style).toContain('.thread-sidebar-empty + .nav-link');
    expect(style).toContain('.nav-empty');
    expect(style).toContain('.phase-entry-marker');
    expect(style).toContain('.section-label-result');
    expect(style).toContain('.webchat-confirm-panel');
    expect(style).toContain('.webchat-input-panel .webchat-modal-field');
    expect(style).toContain('.webchat-context-warning');
    expect(style).toContain('.webchat-message-error-state');
  });

  it('renders project context for project-scoped chat threads', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');

    expect(source).toContain('renderThreadContextBanner');
    expect(source).toContain('renderProjectThreadStartState');
    expect(source).toContain('webchat-project-start');
    expect(source).toContain('Work from ');
    expect(source).toContain(
      'Ask for a project brief, source-backed summary, document draft, or next action.',
    );
    expect(source).toContain(
      'Project chat can use Cowork context, approved MCP tools, and project artifacts.',
    );
    expect(source).toContain(
      'External writes, sent messages, published documents, and calendar changes stay approval-gated.',
    );
    expect(source).toContain('var PROJECT_TOOL_STARTERS = [');
    expect(source).toContain('renderProjectToolStarters');
    expect(source).toContain('renderProjectMcpServerRibbon');
    expect(source).toContain('id="thread-context-banner"');
    expect(source).toContain('renderEmptyThreadState(threadMeta)');
    expect(source).toContain(
      'if (threadMeta && threadMeta.projectId) return renderProjectThreadStartState(threadMeta)',
    );
    expect(source).toContain("api('/threads/' + encodeURIComponent(threadId))");
    expect(source).toContain('Cowork project');
    expect(source).toContain('toolsAvailable');
    expect(source).toContain('data-mcp-enabled');
    expect(source).toContain('approved MCP tools are available');
    expect(source).toContain('External MCP tools are not enabled');
    expect(source).toContain('MCP actions');
    expect(source).toContain('webchat-mcp-status');
    expect(source).toContain(
      'All configured MCP servers allowed by connector permissions',
    );
    expect(source).toContain('Writes stay behind approvals');
    expect(source).toContain('Latest email summary');
    expect(source).toContain('Emails from someone');
    expect(source).toContain('Create document');
    expect(source).toContain('Custom MCP task');
    expect(source).toContain('any approved connector workflow');
    expect(source).toContain('PROJECT_MCP_COMMANDS');
    expect(source).toContain('Available MCP scope');
    expect(source).toContain('webchat-mcp-server-ribbon');
    expect(source).toContain('Use these for read-only source gathering');
    expect(source).toContain('Examples: ');
    expect(source).toContain(
      'Latest emails, sender summaries, document drafts, and custom source reads',
    );
    expect(source).toContain('MCP request examples:');
    expect(source).toContain(
      'External document publishing, email sends, calendar edits, and third-party updates ask for approval first.',
    );
    expect(source).toContain('Latest emails -> summary doc');
    expect(source).toContain('Emails from sender -> brief');
    expect(source).toContain('Project context -> document');
    expect(source).toContain('Mailbox topic sweep');
    expect(source).toContain(
      'source window, decisions, deadlines, risks, waiting items, next actions, and a source ledger',
    );
    expect(source).toContain('recent emails from [person or domain]');
    expect(source).toContain(
      'source ledger naming sender filter, query window, MCP calls, and created project files',
    );
    expect(source).toContain(
      'source ledger with MCP servers, tool-call purpose, source files, and artifact path',
    );
    expect(source).toContain('PROJECT_MCP_SOURCE_STEPS');
    expect(source).toContain('MCP source-to-document checklist');
    expect(source).toContain('Source');
    expect(source).toContain(
      'Name the MCP server, sender/topic, date window, and project question.',
    );
    expect(source).toContain('Evidence');
    expect(source).toContain(
      'Collect citations, decisions, deadlines, waiting items, and gaps.',
    );
    expect(source).toContain('Draft');
    expect(source).toContain(
      'Save a markdown summary or document in the Cowork project workspace first.',
    );
    expect(source).toContain('Ledger');
    expect(source).toContain(
      'Record MCP server, tool-call purpose, query window or sender filter, and created project files.',
    );
    expect(source).toContain('Approval');
    expect(source).toContain(
      'Ask before publishing documents, sending mail, or changing external systems.',
    );
    expect(source).toContain('source:');
    expect(source).toContain('output:');
    expect(source).toContain('approval:');
    expect(source).toContain('<strong>Source</strong>');
    expect(source).toContain('<strong>Output</strong>');
    expect(source).toContain('<strong>Approval</strong>');
    expect(source).toContain('webchat-mcp-command-strip');
    expect(source).toContain('useProjectMcpCommand');
    expect(source).toContain('useProjectToolPrompt');
    expect(source).toContain('Use MCP runbook');
    expect(source).toContain('useProjectMcpRunbook');
    expect(source).toContain('projectMcpRunbookPromptText');
    expect(source).toContain('projectMcpPromptContextText');
    expect(source).toContain('projectMcpScopedPrompt');
    expect(source).toContain('Cowork MCP context:');
    expect(source).toContain('Use MCP tools from this Cowork project chat.');
    expect(source).toContain('Available MCP scope: ');
    expect(source).toContain(
      'Use approved MCP servers for email, calendar, document, storage, or custom source gathering when they fit the request.',
    );
    expect(source).toContain(
      'Local output default: save the first summary, brief, document, or artifact inside the Cowork project workspace.',
    );
    expect(source).toContain(
      'Source ledger required: MCP server, tool-call purpose, query window or sender/topic filter, cited evidence, and created project file path.',
    );
    expect(source).toContain(
      'Missing tool behavior: say which connector or permission is missing instead of inventing source results.',
    );
    expect(source).toContain(
      'input.value = projectMcpScopedPrompt(starter.prompt, window._webchatThreadBriefState)',
    );
    expect(source).toContain(
      'input.value = projectMcpScopedPrompt(command.prompt, window._webchatThreadBriefState)',
    );
    expect(source).toContain(
      'Goal: gather approved external context, then create a durable local project artifact.',
    );
    expect(source).toContain(
      'If I ask for latest emails, use the configured mail MCP server',
    );
    expect(source).toContain(
      'If I ask for emails from someone, search that sender or domain',
    );
    expect(source).toContain(
      'Save the first summary, brief, or document draft inside the Cowork project workspace',
    );
    expect(source).toContain(
      'Include a source ledger naming each MCP server, tool-call purpose, query window or sender filter, and created project file path.',
    );
    expect(source).toContain(
      'Reading approved source systems and writing local project drafts can happen in chat.',
    );
    expect(source).toContain(
      'Ask for approval before sending email, publishing or updating external documents, changing calendar events, calling webhooks, or updating third-party records.',
    );
    expect(source).toContain(
      'If the needed MCP tool is not exposed, say exactly what connector or permission is missing instead of inventing source results.',
    );
    expect(source).toContain('<textarea id="chat-msg-input" rows="1"');
    expect(source).toContain('resizeChatInput');
    expect(source).toContain('Back to project');
    expect(source).toContain('openProjectContext');
    expect(source).toContain('data-project-id="');
    expect(source).not.toContain(
      "'</div>' +\n      (toolsAvailable ? renderProjectToolStarters(threadMeta) : '')",
    );
    expect(source).not.toContain('function jsStringAttr');
    expect(source).not.toContain(".replace(/\"/g, '&quot;')");
    expect(source).toContain("sessionStorage.setItem('project_focus_id'");
  });

  it('styles active project chat MCP commands as compact prompt chips', () => {
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(style).toContain('.webchat-mcp-command-strip');
    expect(style).toContain('.webchat-mcp-command-strip button');
    expect(style).toContain('.webchat-mcp-command-strip button:focus-visible');
    expect(style).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(style).toContain('.webchat-mcp-command-strip button small');
    expect(style).toContain('.webchat-mcp-command-strip button strong');
    expect(style).toContain('.webchat-mcp-source-flow');
    expect(style).toContain('.webchat-mcp-source-flow article');
    expect(style).toContain(
      '.webchat-mcp-source-flow {\n    grid-template-columns: 1fr;',
    );
  });

  it('surfaces MCP access in plain chat briefs when regular web chats have connectors', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');

    expect(source).toContain('function formatMcpAccessSummary');
    expect(source).toContain('plainChatMcpAccessText');
    expect(source).toContain('Plain chat can use MCP scope');
    expect(source).toContain(
      'MCP access: ' + "' + plainChatMcpAccessText(threadMeta)",
    );
    expect(source).not.toContain(
      'MCP access: no project connector context by default.',
    );
  });

  it('uses delegated web chat actions instead of inline onclick attributes', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');

    expect(source).toContain('installWebChatActionHandlers');
    expect(source).toContain('data-webchat-action="open-new-conversation"');
    expect(source).toContain('data-webchat-action="use-starter"');
    expect(source).toContain('data-webchat-action="use-project-tool"');
    expect(source).toContain('data-webchat-action="use-project-mcp-command"');
    expect(source).toContain('data-webchat-action="toggle-tool-call"');
    expect(source).not.toContain(' onclick=');
  });
});
