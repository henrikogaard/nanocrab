import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const scriptPath = path.join(
  process.cwd(),
  'src/admin/public/pages/chat-threads.js',
);
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('WebChat new conversation modal', () => {
  it('creates plain chat threads from provider/model selection, not agent templates', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');

    expect(source).toContain("api('/system/provider')");
    expect(source).toContain('id="wc-provider-select"');
    expect(source).toContain('id="wc-model-select"');
    expect(source).not.toContain('Agent template');
    expect(source).not.toContain('/threads/agent-templates');
    expect(source).not.toContain('templateAgentId');
  });

  it('offers starter prompts without converting them into conversation titles or templates', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');

    expect(source).toContain('var CHAT_STARTERS = [');
    expect(source).toContain('webchat-starter-grid');
    expect(source).toContain('startFromPrompt');
    expect(source).toContain(
      "'/threads/' + encodeURIComponent(resp.id) + '/messages'",
    );
    expect(source).toContain('message: selectedStarter.prompt');
    expect(source).not.toContain('body.title = selectedStarter');
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
      'Mode: Plain chat. Conversation-only thread with no project workspace attached.',
    );
    expect(source).toContain('Conversation only');
    expect(source).toContain('External actions ask first');
    expect(source).toContain('useStarterPrompt');
    expect(source).toContain('webchat-thread-card');
    expect(source).toContain('webchat-thread-empty-state');
    expect(source).toContain('Loading chat context');
    expect(source).toContain(
      'Loading conversation metadata, message history, and available actions.',
    );
    expect(source).toContain('renderWebchatLoadingState()');
    expect(source).toContain('Start with a plain chat prompt.');
    expect(source).toContain(
      'This conversation is ready for quick thinking, writing, planning, and questions.',
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
    expect(source).toContain('Copilot queue');
    expect(source).toContain('Start a plain chat for quick thinking');
    expect(source).toContain(
      'Start a plain chat for quick thinking, writing, planning, or drafting.',
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
    expect(source).toContain('openNewConversationModal(starter)');
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
    expect(source).not.toContain('class="card webchat-thread-card" style=');
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
    expect(style).toContain('width: var(--progress-pct, 0%);');
    expect(style).toContain('height: var(--chat-input-height, 40px);');
    expect(style).toContain('.webchat-plain-brief');
    expect(style).toContain('.webchat-plain-starters');
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
    expect(source).toContain('jsStringAttr');
    expect(source).toContain(".replace(/\"/g, '&quot;')");
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
});
