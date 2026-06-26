import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');
const routePath = path.join(process.cwd(), 'src/admin/routes/messages.ts');

const messagesRenderSource = (source: string) =>
  source.slice(
    source.indexOf('async function renderMessages'),
    source.indexOf('function renderMsgList'),
  );

describe('Messages inbox UI', () => {
  it('frames message history as a triage inbox', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('messages-command-center');
    expect(source).toContain('Conversation triage');
    expect(source).toContain('Turn message history into a useful inbox');
    expect(source).toContain('Open Copilot');
    expect(source).toContain("navigate('channels')");
    expect(source).toContain("navigate('approvals')");
  });

  it('summarizes channels, chats, human input, agent replies, and follow-up hints', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('analyzeMessages');
    expect(source).toContain('actionHints');
    expect(source).toContain('messageTriageDestination');
    expect(source).toContain('renderMessageTriageBrief');
    expect(source).toContain('Triage focus');
    expect(source).toContain('Open next');
    expect(source).toContain('messages-channel-grid');
    expect(source).toContain('messages-intent-map');
    expect(source).toContain('workIntents');
    expect(source).toContain('messages-routing-panel');
    expect(source).toContain('messages-triage-brief');
    expect(source).toContain('messages-handoff-checklist');
    expect(source).toContain('messageHandoffChecklist');
    expect(source).toContain('renderMessageHandoffChecklist');
    expect(source).toContain('Turn inbox signals into routed work');
    expect(source).toContain(
      'Use this before asking an agent to continue from channel history, pinned context, or a copied triage brief.',
    );
    expect(source).toContain('messages-pinned-card');
    expect(source).toContain('renderMessageRow');
    expect(source).toContain('renderMessagesEmptyState');
    expect(source).toContain('messages-empty-state');
    expect(source).toContain('No matching messages');
    expect(source).toContain('Keep the inbox useful while it is quiet.');
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('channels')");
    expect(source).toContain('Inbox timeline');
  });

  it('copies the current message slice as a reusable triage brief', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('messageTriageBriefText');
    expect(source).toContain('window.copyMessageTriageBrief');
    expect(source).toContain('copyMessageTriageBrief()');
    expect(source).toContain('Message triage brief copied');
    expect(source).toContain('Review this NanoCrab message triage slice.');
    expect(source).toContain(
      'Route each item to Copilot, Cowork, Approvals, Tasks, or Code.',
    );
    expect(source).toContain(
      'ask before sending external messages, publishing documents, or changing third-party systems',
    );
    expect(source).toContain('Handoff checklist:');
    expect(source).toContain(
      'Pin useful context or move project material into Cowork so the next agent does not rebuild it from memory.',
    );
    expect(source).toContain(
      'Open the destination workspace with the triage brief, source channel, pending decision, and next expected output.',
    );
    expect(source).toContain('window._messageTriageState');
  });

  it('copies a single message as a routed follow-up prompt', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('messageFollowUpPromptText');
    expect(source).toContain(
      'Turn this NanoCrab message into a ${destinationLabel} follow-up.',
    );
    expect(source).toContain('Suggested route: ${destinationLabel}');
    expect(source).toContain(
      'Preserve source context before asking another agent to continue.',
    );
    expect(source).toContain(
      'If this belongs in Cowork, create or update a project artifact, document, or source-backed brief.',
    );
    expect(source).toContain(
      'If this belongs in Code, include repository, issue, test, PR, or review context before assigning work.',
    );
    expect(source).toContain(
      'If this needs an external send, document publish, calendar edit, webhook, or repository write, route it through Approvals first.',
    );
    expect(source).toContain('copyMessageFollowUpPrompt');
    expect(source).toContain('Copy follow-up');
    expect(source).toContain('Message follow-up prompt copied');
    expect(source).toContain('Copy message follow-up prompt');
    expect(source).toContain('Message follow-up is not available');
    expect(source).not.toContain(
      "window.prompt('Copy message follow-up prompt:'",
    );
  });

  it('maps recent messages into Copilot, Cowork, Approvals, Tasks, and Code signals', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('messageIntentCards');
    expect(source).toContain(
      'Project briefs, documents, summaries, and artifacts',
    );
    expect(source).toContain(
      'Permission, deny, allow, and external-action decisions',
    );
    expect(source).toContain(
      'Scheduling, reminders, routines, and follow-up work',
    );
    expect(source).toContain(
      'Repository, PR, test, deploy, and review signals',
    );
    expect(source).toContain("destination === 'agents'");
  });

  it('styles the inbox cockpit and message rows responsively', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.messages-command-center');
    expect(source).toContain('.messages-command-stats');
    expect(source).toContain('.messages-routing-panel');
    expect(source).toContain('.messages-triage-brief');
    expect(source).toContain('.messages-handoff-checklist');
    expect(source).toContain('.messages-handoff-copy');
    expect(source).toContain('.messages-handoff-steps');
    expect(source).toContain('.messages-handoff-step');
    expect(source).toContain('.messages-triage-actions');
    expect(source).toContain('.messages-channel-grid');
    expect(source).toContain('.messages-intent-map');
    expect(source).toContain('.messages-intent-card');
    expect(source).toContain('.messages-empty-state');
    expect(source).toContain('.messages-empty-actions');
    expect(source).toContain('.messages-row');
    expect(source).toContain('.messages-handoff-checklist,');
    expect(source).toContain('.unregistered-empty-state.is-loading');
  });

  it('keeps inbox filter and export controls class-based', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const renderSource = messagesRenderSource(appSource);

    expect(renderSource).toContain('messages-filter-select');
    expect(renderSource).toContain('messages-export-actions');
    expect(renderSource).not.toContain(
      'id="msg-filter" style="max-width:180px"',
    );
    expect(renderSource).not.toContain(
      'style="margin-top:8px;text-align:right" id="msg-export"',
    );
    expect(styleSource).toContain('.messages-filter-select');
    expect(styleSource).toContain('.messages-export-actions');
  });

  it('keeps unregistered conversation previews class-based', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const unregisteredSource = appSource.slice(
      appSource.indexOf('async function loadUnregisteredConversations'),
      appSource.indexOf('window.toggleUnregMessages'),
    );

    expect(unregisteredSource).toContain('unregistered-chat-name');
    expect(unregisteredSource).toContain('unregistered-chat-jid');
    expect(unregisteredSource).toContain('unregistered-message-cell');
    expect(unregisteredSource).toContain('unregistered-message-drawer');
    expect(unregisteredSource).toContain('unregistered-message-empty');
    expect(unregisteredSource).toContain(
      'renderUnregisteredMessagesEmptyState',
    );
    expect(unregisteredSource).toContain('No retained transcript');
    expect(unregisteredSource).toContain(
      'Register it only if the source is trusted',
    );
    expect(unregisteredSource).toContain('Confirm source');
    expect(unregisteredSource).toContain('Route to Copilot or Cowork');
    expect(unregisteredSource).toContain("navigate('groups')");
    expect(unregisteredSource).toContain("navigate('projects')");
    expect(unregisteredSource).toContain('unregistered-message-preview');
    expect(unregisteredSource).toContain('unregistered-message-content');
    expect(unregisteredSource).toContain('renderUnregisteredConversationState');
    expect(unregisteredSource).toContain('unregistered-empty-state');
    expect(unregisteredSource).toContain('unregistered-loading-flow');
    expect(unregisteredSource).toContain('Channel intake');
    expect(unregisteredSource).toContain('Inspect intake');
    expect(unregisteredSource).toContain('Route work');
    expect(unregisteredSource).not.toContain(
      '\'<div class="empty">No unregistered conversations found</div>\'',
    );
    expect(unregisteredSource).not.toContain(
      '\'<div class="empty">Failed to load unregistered conversations</div>\'',
    );
    expect(unregisteredSource).not.toContain(
      'td style="color:var(--text);font-weight:500"',
    );
    expect(unregisteredSource).not.toContain(
      'td style="font-family:var(--mono);font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis"',
    );
    expect(unregisteredSource).not.toContain(
      'td colspan="6" style="padding:0"',
    );
    expect(unregisteredSource).not.toContain(
      'style="max-height:200px;overflow-y:auto;padding:8px 14px;background:var(--bg);border-radius:var(--radius-sm);margin:4px 0"',
    );
    expect(unregisteredSource).not.toContain(
      'span style="color:var(--text-muted);font-size:12px"',
    );
    expect(unregisteredSource).not.toContain(
      '\'<span class="unregistered-message-empty">No stored messages</span>\'',
    );
    expect(unregisteredSource).not.toContain(
      'class="message" style="padding:6px 0;border-bottom:1px solid var(--border)"',
    );
    expect(unregisteredSource).not.toContain(
      'class="message-content" style="font-size:12px"',
    );
    expect(styleSource).toContain('.unregistered-chat-name');
    expect(styleSource).toContain('.unregistered-chat-jid');
    expect(styleSource).toContain('.unregistered-message-cell');
    expect(styleSource).toContain('.unregistered-message-drawer');
    expect(styleSource).toContain('.unregistered-message-empty');
    expect(styleSource).toContain('.unregistered-message-empty-flow');
    expect(styleSource).toContain('.unregistered-message-empty-actions');
    expect(styleSource).toContain('.unregistered-message-preview');
    expect(styleSource).toContain('.unregistered-message-content');
    expect(styleSource).toContain('.unregistered-empty-state');
    expect(styleSource).toContain('.unregistered-empty-state.is-loading');
    expect(styleSource).toContain('.unregistered-empty-state.is-error');
    expect(styleSource).toContain('.unregistered-empty-flow');
    expect(styleSource).toContain('.unregistered-empty-actions');
    expect(styleSource).toContain('.unregistered-loading-flow');
    expect(styleSource).toContain('@keyframes unregisteredLoading');
  });

  it('keeps pinned messages route before the chat id catch-all route', () => {
    const source = fs.readFileSync(routePath, 'utf8');

    expect(source.indexOf("router.get('/pinned'")).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("router.get('/:chatJid'")).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("router.get('/pinned'")).toBeLessThan(
      source.indexOf("router.get('/:chatJid'"),
    );
  });
});
