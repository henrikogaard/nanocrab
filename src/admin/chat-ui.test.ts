import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Dashboard Chat surface UI', () => {
  it('keeps plain chat controls styled through reusable classes', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('class="chat-page-actions"');
    expect(source).toContain('class="search-input chat-group-select"');
    expect(source).toContain('class="card chat-session-card"');
    expect(source).toContain('<div class="page-header"><h2>Copilot</h2>');
    expect(source).toContain('placeholder="Ask Copilot..."');
    expect(source).toContain('class="btn btn-sm btn-ghost chat-voice-btn"');
    expect(source).toContain('class="chat-voice-status"');
    expect(source).toContain("voiceBtn.classList.add('is-recording')");
    expect(source).toContain("voiceBtn.classList.remove('is-recording')");
    expect(source).toContain('function setProgressFill');
    expect(source).toContain('setProgressFill(fill, 0)');
    expect(source).toContain('setProgressFill(fill, msg.data.pct)');
    expect(source).toContain('class="chat-provider-separator"');
    expect(source).toContain('class="chat-provider-edit"');
    expect(source).toContain('class="form-select chat-provider-select"');
    expect(source).toContain('renderLegacyChatState');
    expect(source).toContain('legacyChatSendErrorMessage');
    expect(source).toContain(
      'Channel message was not sent. Your draft was restored',
    );
    expect(source).toContain('input.value = msg');
    expect(source).toContain('renderChatMessages();');
    expect(source).toContain("toast(legacyChatSendErrorMessage(err), 'error')");
    expect(source).toContain("renderLegacyChatState('loading')");
    expect(source).toContain('chat-loading-state');
    expect(source).toContain('Loading recent messages');
    expect(source).toContain(
      'Pulling the latest group history, provider context, and channel status',
    );
    expect(source).toContain('chat-empty-state');
    expect(source).toContain('Start the first exchange');
    expect(source).toContain("${renderLegacyChatState('empty')}");
    expect(source).toContain('Failed to load messages');
    expect(source).toContain(
      'project files, documents, artifacts, or MCP-backed source context',
    );
    expect(source).toContain(
      'Copilot chat, quick questions, and messages that should stay lightweight.',
    );
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('channels')");
    expect(source).toContain('id="progress-spinner"');
    expect(source).toContain('section-label section-label-result');
    expect(source).toContain('chat-tool-call chat-tool-call-history');
    expect(source).toContain("card.classList.add('is-approved')");
    expect(source).toContain("card.classList.add('is-denied')");
    expect(source).not.toContain('card.style.borderColor');
    expect(source).not.toContain('spinner.style.display');
    expect(source).not.toContain('voiceBtn.style.color');
    expect(source).not.toContain('fill.style.width');
    expect(source).not.toContain('style="max-width:250px"');
    expect(source).not.toContain(
      'style="padding:0;overflow:hidden;display:flex;flex-direction:column"',
    );
    expect(source).not.toContain('style="font-size:16px;padding:6px 10px"');
    expect(source).not.toContain(
      'class="section-label" style="margin-top:8px"',
    );
    expect(source).not.toContain('class="chat-tool-call" style="margin:6px 0"');
    expect(source).not.toContain(
      'area.innerHTML = \'<div class="empty">Failed to load messages</div>\'',
    );
    expect(source).not.toContain("toast('Failed to send message', 'error')");
    expect(source).not.toContain(
      '\'<div class="empty">No messages yet. Send one below.</div>\'',
    );
    expect(source).not.toContain(
      'area.innerHTML = \'<div class="loading">Loading</div>\'',
    );
    expect(source).not.toContain(
      '<div class="loading">Select a group to start chatting</div>',
    );
    expect(style).toContain('.chat-page-actions');
    expect(style).toContain('.chat-session-card');
    expect(style).toContain('.chat-empty-state');
    expect(style).toContain('.chat-empty-state.is-error');
    expect(style).toContain('.chat-loading-state');
    expect(style).toContain('.chat-loading-bars');
    expect(style).toContain('@keyframes chatLoadingSweep');
    expect(style).toContain('.chat-empty-flow');
    expect(style).toContain('.chat-empty-actions');
    expect(style).toContain('.chat-voice-btn.is-recording');
    expect(style).toContain('width: var(--progress-pct, 0%);');
    expect(style).toContain('.chat-provider-select');
    expect(style).toContain('.section-label-result');
    expect(style).toContain('.chat-tool-call-history');
    expect(style).toContain('.chat-approval-card.is-approved');
    expect(style).toContain('.chat-approval-card.is-denied');
  });

  it('keeps approval failures pending with operator recovery copy', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const actions = source.slice(
      source.indexOf('function chatApprovalActionErrorMessage'),
      source.indexOf('// Channels'),
    );

    expect(actions).toContain('chatApprovalActionErrorMessage');
    expect(actions).toContain("kind === 'approve' ? 'Approval' : 'Denial'");
    expect(actions).toContain('was not saved. Keep the request pending');
    expect(actions).toContain('Keep the request pending');
    expect(actions).toContain('external action should stay approval-gated');
    expect(actions).toContain(
      "toast(chatApprovalActionErrorMessage('approve', e), 'error')",
    );
    expect(actions).toContain(
      "toast(chatApprovalActionErrorMessage('deny', e), 'error')",
    );
    expect(actions).not.toContain("toast('Failed: ' + e.message, 'error')");
  });
});
