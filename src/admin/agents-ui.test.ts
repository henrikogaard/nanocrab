import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const agentsPagePath = path.join(
  process.cwd(),
  'src/admin/public/pages/agents.js',
);
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');
const mockDataPath = path.join(process.cwd(), 'src/admin/mock-data.ts');

describe('Agents launcher UI', () => {
  it('offers outcome-based task templates', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');

    expect(source).toContain('TASK_TEMPLATES');
    expect(source).toContain('Start from a known outcome');
    expect(source).toContain('Fix regression');
    expect(source).toContain('Release check');
    expect(source).toContain('renderTaskTemplateCards');
  });

  it('keeps template prompts oriented at the beginning after selection', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');

    expect(source).toContain('prompt.setSelectionRange(0, 0)');
    expect(source).toContain('prompt.scrollTop = 0');
    expect(source).toContain('task-prompt-hint');
  });

  it('keeps the assignment wizard and task output panels class-driven', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');

    expect(source).toContain('toggleTaskLauncher');
    expect(source).toContain('toggleTaskOutputPanel');
    expect(source).toContain('isTaskOutputPanelOpen');
    expect(source).toContain(
      'task-launcher" class="card assign-wizard is-hidden',
    );
    expect(source).toContain('assign-pane is-hidden');
    expect(source).toContain(
      'task-output-panel" class="task-output-panel is-hidden',
    );
    expect(source).toContain("launcher.classList.toggle('is-hidden'");
    expect(source).toContain("panel.classList.toggle('is-hidden'");
    expect(source).toContain("pane.classList.toggle('is-hidden'");
    expect(source).toContain('assign-form-grid');
    expect(source).toContain('assign-full-input');
    expect(source).toContain('assign-prompt-input');
    expect(source).toContain('assign-action-row');
    expect(source).toContain('task-output-head');
    expect(source).toContain('task-output-log');
    expect(source).toContain('task-output-link');
    expect(source).toContain('coding-job-meta');
    expect(source).toContain('codingDenyNoteId');
    expect(source).toContain('coding-deny-note-field');
    expect(source).toContain('agent-command-surface');
    expect(source).toContain('card agent-section-card');
    expect(source).not.toContain(
      "prompt('Reason for denying implementation?')",
    );
    expect(source).not.toContain(
      'id="task-launcher" class="card assign-wizard" style=',
    );
    expect(source).not.toContain('id="task-output-panel" style=');
    expect(source).not.toContain(
      'class="assign-pane" id="assign-pane-github" style=',
    );
    expect(source).not.toContain(
      'class="assign-pane" id="assign-pane-autofix" style=',
    );
    expect(source).not.toContain(
      "document.getElementById('task-launcher').style.display",
    );
    expect(source).not.toContain(
      "document.getElementById('task-output-panel').style.display",
    );
    expect(source).not.toContain('pane.style.display');
    expect(source).not.toContain('launcher.style.display');
    expect(source).not.toContain('panel.style.display');
    expect(source).not.toContain(
      'id="task-tool" onchange="updateTaskModels()" style=',
    );
    expect(source).not.toContain(
      'id="task-prompt" rows="4" placeholder="Describe the outcome you want, the repo area, and any checks to run." style=',
    );
    expect(source).not.toContain(
      'style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"',
    );
    expect(source).not.toContain(
      'style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"',
    );
    expect(source).not.toContain('style="color:var(--accent);font-size:12px"');
    expect(source).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-bottom:8px"',
    );
    expect(source).not.toContain(
      'class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"',
    );
    expect(source).not.toContain('class="card" style="margin-bottom:16px"');
  });

  it('keeps coding agent availability rows class-driven', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const start = source.indexOf('Coding Agents');
    const end = source.indexOf('Bot Agents', start);
    const codingAgentsMarkup = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(codingAgentsMarkup).toContain('agent-tool-row');
    expect(codingAgentsMarkup).toContain('agent-tool-row is-unavailable');
    expect(codingAgentsMarkup).toContain('agent-tool-main');
    expect(codingAgentsMarkup).toContain('agent-tool-meta');
    expect(codingAgentsMarkup).toContain('agent-tool-actions');
    expect(codingAgentsMarkup).toContain('agent-tool-badge');
    expect(codingAgentsMarkup).not.toContain(
      'display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)',
    );
    expect(codingAgentsMarkup).not.toContain(
      'display:flex;align-items:center;gap:10px',
    );
    expect(codingAgentsMarkup).not.toContain('style="width:8px;height:8px"');
    expect(codingAgentsMarkup).not.toContain(
      'style="font-size:11px;color:var(--text-muted)">Not installed',
    );
    expect(codingAgentsMarkup).not.toContain('style="font-size:10px">Ready');
    expect(codingAgentsMarkup).not.toContain(
      'style="font-size:10px">Unavailable',
    );
  });

  it('keeps bot agent roster rows class-driven', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const rowStart = source.indexOf('const agentCards = groups');
    const rowEnd = source.indexOf('// Tool options for the launcher', rowStart);
    const rowMarkup = source.slice(rowStart, rowEnd);
    const cardStart = source.indexOf('id="bot-agents-card"');
    const cardEnd = source.indexOf('coding-tasks-card', cardStart);
    const cardMarkup = source.slice(
      cardStart,
      cardEnd === -1 ? undefined : cardEnd,
    );

    expect(rowStart).toBeGreaterThan(-1);
    expect(rowEnd).toBeGreaterThan(rowStart);
    expect(cardStart).toBeGreaterThan(-1);
    expect(cardMarkup).toContain('Bot Agents');
    expect(cardMarkup).toContain('agent-tool-badge');
    expect(rowMarkup).toContain('agent-bot-row');
    expect(rowMarkup).toContain('agent-bot-row ${!isEnabled ?');
    expect(rowMarkup).toContain('agent-bot-main');
    expect(rowMarkup).toContain('agent-bot-copy');
    expect(rowMarkup).toContain('agent-bot-titleline');
    expect(rowMarkup).toContain('agent-bot-name');
    expect(rowMarkup).toContain('agent-bot-badge');
    expect(rowMarkup).toContain('agent-bot-meta');
    expect(rowMarkup).toContain('agent-bot-boundaries');
    expect(rowMarkup).toContain('agent-bot-mini-badge');
    expect(rowMarkup).toContain('agent-bot-actions');
    expect(rowMarkup).toContain('agent-tool-badge');
    expect(rowMarkup).not.toContain(
      'display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)',
    );
    expect(rowMarkup).not.toContain('display:flex;align-items:center;gap:10px');
    expect(rowMarkup).not.toContain('style="width:8px;height:8px"');
    expect(rowMarkup).not.toContain('style="margin-left:6px;font-size:9px"');
    expect(rowMarkup).not.toContain(
      'style="font-size:11px;color:var(--text-muted)"',
    );
    expect(rowMarkup).not.toContain(
      'style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px"',
    );
    expect(rowMarkup).not.toContain('style="font-size:8px"');
    expect(rowMarkup).not.toContain('style="font-size:10px"');
  });

  it('keeps coding task history rows class-driven', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const rowStart = source.indexOf('// Task history');
    const rowEnd = source.indexOf('const enabledPlugins', rowStart);
    const rowMarkup = source.slice(rowStart, rowEnd);
    const cardStart = source.indexOf(
      '<div class="card agent-section-card" id="coding-tasks-card"',
    );
    const cardEnd = source.indexOf('recent.length > 0', cardStart);
    const cardMarkup = source.slice(cardStart, cardEnd);

    expect(rowStart).toBeGreaterThan(-1);
    expect(rowEnd).toBeGreaterThan(rowStart);
    expect(cardStart).toBeGreaterThan(-1);
    expect(cardEnd).toBeGreaterThan(cardStart);
    expect(rowMarkup).toContain('agent-task-row');
    expect(rowMarkup).toContain('agent-task-main');
    expect(rowMarkup).toContain('agent-task-head');
    expect(rowMarkup).toContain('agent-mini-badge');
    expect(rowMarkup).toContain('agent-task-prompt');
    expect(rowMarkup).toContain('agent-task-meta');
    expect(rowMarkup).toContain('agent-task-actions');
    expect(rowMarkup).toContain('agent-tool-badge');
    expect(rowMarkup).toContain('agent-danger-action');
    expect(cardMarkup).toContain('card agent-section-card');
    expect(cardMarkup).toContain('Coding Tasks');
    expect(cardMarkup).toContain('agent-tool-badge');
    expect(rowMarkup).not.toContain(
      'class="channel-card" style="padding:8px 0"',
    );
    expect(rowMarkup).not.toContain('style="flex:1;min-width:0"');
    expect(rowMarkup).not.toContain(
      'style="display:flex;align-items:center;gap:6px"',
    );
    expect(rowMarkup).not.toContain('style="font-size:9px"');
    expect(rowMarkup).not.toContain('style="font-size:12px;font-weight:500"');
    expect(rowMarkup).not.toContain(
      'style="font-size:11px;color:var(--text-muted);margin-top:2px"',
    );
    expect(rowMarkup).not.toContain(
      'style="display:flex;gap:4px;align-items:center;flex-shrink:0"',
    );
    expect(rowMarkup).not.toContain('style="font-size:10px"');
    expect(rowMarkup).not.toContain('style="color:var(--error)"');
  });

  it('keeps repo coding rules form and rows class-driven', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const rowStart = source.indexOf('const codingRepoRuleRows =');
    const rowEnd = source.indexOf('const codingJobRows =', rowStart);
    const rowMarkup = source.slice(rowStart, rowEnd);
    const cardStart = source.indexOf(
      '<div class="card agent-section-card" id="repo-coding-rules-card"',
    );
    const cardEnd = source.indexOf('id="coding-agents-card"', cardStart);
    const cardMarkup = source.slice(cardStart, cardEnd);

    expect(rowStart).toBeGreaterThan(-1);
    expect(rowEnd).toBeGreaterThan(rowStart);
    expect(cardStart).toBeGreaterThan(-1);
    expect(cardEnd).toBeGreaterThan(cardStart);
    expect(rowMarkup).toContain("renderAgentCodeEmptyState('rules')");
    expect(source).toContain('function renderAgentCodeEmptyState');
    expect(source).toContain('agent-code-empty');
    expect(source).toContain(
      'Save project-specific conventions so Code agents know',
    );
    expect(source).toContain(
      "document.getElementById('repo-rule-title')?.focus()",
    );
    expect(rowMarkup).toContain('agent-rule-row');
    expect(rowMarkup).toContain('agent-rule-head');
    expect(rowMarkup).toContain('agent-rule-title');
    expect(rowMarkup).toContain('agent-rule-meta');
    expect(rowMarkup).toContain('agent-rule-content');
    expect(rowMarkup).toContain('agent-tool-badge');
    expect(cardMarkup).toContain('agent-rule-form');
    expect(cardMarkup).toContain('agent-rule-field');
    expect(cardMarkup).toContain('agent-rule-field-wide');
    expect(cardMarkup).toContain('agent-tool-badge');
    expect(cardMarkup).not.toContain('style="margin-bottom:16px"');
    expect(cardMarkup).not.toContain(
      'display:grid;grid-template-columns:minmax(160px,220px) 1fr 2fr auto',
    );
    expect(cardMarkup).not.toContain(
      'style="font-size:11px;color:var(--text-muted)"',
    );
    expect(rowMarkup).not.toContain('class="empty" style="padding:10px"');
    expect(rowMarkup).not.toContain(
      '<div class="agent-rule-empty">No repo coding rules saved yet</div>',
    );
    expect(rowMarkup).not.toContain(
      'style="padding:8px 0;border-bottom:1px solid var(--border)"',
    );
    expect(rowMarkup).not.toContain(
      'style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"',
    );
    expect(rowMarkup).not.toContain('style="font-size:12px;color:var(--text)"');
    expect(rowMarkup).not.toContain(
      'style="font-size:11px;color:var(--text-muted);margin-top:3px"',
    );
    expect(rowMarkup).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-top:5px;line-height:1.35"',
    );
  });

  it('keeps container provider rows aligned with the tool row pattern', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const start = source.indexOf(
      '<div class="card-title">Container Providers</div>',
    );
    const end = source.indexOf('agentMsgs.length > 0', start);
    const providersMarkup = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(providersMarkup).toContain('agent-tool-row');
    expect(providersMarkup).toContain('agent-tool-main');
    expect(providersMarkup).toContain('agent-tool-meta');
    expect(providersMarkup).toContain('agent-tool-badge');
    expect(providersMarkup).not.toContain(
      'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)',
    );
    expect(providersMarkup).not.toContain(
      'display:flex;align-items:center;gap:10px',
    );
    expect(providersMarkup).not.toContain('style="width:8px;height:8px"');
    expect(providersMarkup).not.toContain(
      'style="font-size:11px;color:var(--text-muted)"',
    );
    expect(providersMarkup).not.toContain('style="font-size:10px"');
  });

  it('keeps recent session history rows readable without inline layout', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const start = source.indexOf('<div class="card agent-section-card">');
    const end = source.indexOf('container-log-viewer', start);
    const sessionsMarkup = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(sessionsMarkup).toContain('agent-section-card');
    expect(sessionsMarkup).toContain('agent-session-row');
    expect(sessionsMarkup).toContain('agent-session-main');
    expect(sessionsMarkup).toContain('agent-session-head');
    expect(sessionsMarkup).toContain('agent-mini-badge');
    expect(sessionsMarkup).toContain('agent-session-file');
    expect(sessionsMarkup).toContain('agent-session-meta');
    expect(sessionsMarkup).not.toContain(
      'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)',
    );
    expect(sessionsMarkup).not.toContain('style="flex:1;min-width:0"');
    expect(sessionsMarkup).not.toContain(
      'style="display:flex;align-items:center;gap:6px"',
    );
    expect(sessionsMarkup).not.toContain('style="font-size:9px"');
    expect(sessionsMarkup).not.toContain(
      'style="font-size:12px;font-family:var(--mono);color:var(--text-muted)"',
    );
    expect(sessionsMarkup).not.toContain(
      'style="font-size:11px;color:var(--text-muted);margin-top:2px"',
    );
  });

  it('keeps container log viewer states class-driven', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const start = source.indexOf('window.viewContainerLog = async function');
    const end = source.indexOf('};', start);
    const logMarkup = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(logMarkup).toContain("renderAgentLoadingState('log')");
    expect(logMarkup).toContain('agent-log-viewer');
    expect(logMarkup).toContain('agent-log-head');
    expect(logMarkup).toContain('agent-log-title');
    expect(logMarkup).toContain('agent-log-close');
    expect(logMarkup).toContain('agent-log-body');
    expect(logMarkup).toContain('renderAgentRecoveryState');
    expect(logMarkup).toContain("renderAgentRecoveryState('log'");
    expect(logMarkup).not.toContain('style="padding:12px"');
    expect(logMarkup).not.toContain(
      'margin-top:12px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden',
    );
    expect(logMarkup).not.toContain(
      'display:flex;justify-content:space-between;align-items:center;padding:8px 12px',
    );
    expect(logMarkup).not.toContain('style="font-size:11px"');
    expect(logMarkup).not.toContain('max-height:500px;overflow:auto');
    expect(logMarkup).not.toContain(
      'style="margin-top:12px;padding:12px;color:var(--error);font-size:12px"',
    );
  });

  it('uses guided recovery states for agent load and detail failures', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');

    expect(source).toContain('function renderAgentRecoveryState');
    expect(source).toContain('agent-recovery-state');
    expect(source).toContain('Agent cockpit could not load');
    expect(source).toContain('Task output could not load');
    expect(source).toContain('Coding job detail could not load');
    expect(source).toContain('Session log could not load');
    expect(source).toContain("navigate('monitoring')");
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('gitcode')");
    expect(source).toContain("renderAgentRecoveryState('load'");
    expect(source).toContain("renderAgentRecoveryState('coding'");
    expect(source).toContain("renderAgentRecoveryState('task'");
    expect(source).toContain("renderAgentRecoveryState('log'");
    expect(source).not.toContain(
      'el.innerHTML = `<div class="card empty">Failed to load agents: ${esc(e.message)}</div>`',
    );
    expect(source).not.toContain(
      'panel.innerHTML = `<div class="card empty">Failed: ${esc(e.message)}</div>`',
    );
    expect(source).not.toContain(
      'viewer.innerHTML = `<div class="agent-log-error">Failed to load log: ${esc(e.message)}</div>`',
    );
  });

  it('uses specific recovery copy for agent action failures', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const start = source.indexOf('function agentActionErrorMessage');
    const end = source.indexOf('function renderAgentLoadingState', start);
    const actionBlock = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(actionBlock).toContain('Could not launch the delegated task');
    expect(actionBlock).toContain('Could not register the coding repo');
    expect(actionBlock).toContain('Could not start a coding issue handoff');
    expect(actionBlock).toContain('Could not enable Autofix pickup');
    expect(actionBlock).toContain('Could not update the coding job');
    expect(actionBlock).toContain('Could not send the agent message');
    expect(source).toContain("agentActionErrorMessage('launch'");
    expect(source).toContain("agentActionErrorMessage('repo'");
    expect(source).toContain("agentActionErrorMessage('issue'");
    expect(source).toContain("agentActionErrorMessage('autofix'");
    expect(source).toContain("agentActionErrorMessage('coding-job'");
    expect(source).toContain("agentActionErrorMessage('message'");
    expect(source).not.toContain("toast(r.error || 'Failed'");
    expect(source).not.toContain("toast(r.error || 'Coding job action failed'");
    expect(source).not.toContain("toast('Failed: ' + e.message");
    expect(source).not.toContain("toast('Failed to share: ' + e.message");
  });

  it('keeps pending question decision rows class-driven', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const start = source.indexOf('<div class="card agent-question-card"');
    const end = source.indexOf('agentProviders.length > 0', start);
    const questionsMarkup = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(questionsMarkup).toContain('agent-question-card');
    expect(questionsMarkup).toContain('agent-question-title');
    expect(questionsMarkup).toContain('agent-question-row');
    expect(questionsMarkup).toContain('agent-question-text');
    expect(questionsMarkup).toContain('agent-question-meta');
    expect(questionsMarkup).toContain('agent-question-actions');
    expect(questionsMarkup).not.toContain(
      'style="margin-bottom:16px;border-left:3px solid var(--warning)"',
    );
    expect(questionsMarkup).not.toContain(
      'style="display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap"',
    );
    expect(questionsMarkup).not.toContain(
      'style="padding:10px 0;border-bottom:1px solid var(--border)"',
    );
    expect(questionsMarkup).not.toContain(
      'style="font-size:13px;font-weight:500;margin-bottom:6px"',
    );
    expect(questionsMarkup).not.toContain(
      'style="font-size:11px;color:var(--text-muted);margin-bottom:8px"',
    );
    expect(questionsMarkup).not.toContain(
      'style="display:flex;gap:6px;flex-wrap:wrap"',
    );
  });

  it('keeps agent message history rows class-driven', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const start = source.indexOf(
      '<div class="card agent-section-card">\n        <div class="card-title">Agent Messages',
    );
    const end = source.indexOf(
      '<div class="card-title">Send Agent Message</div>',
      start,
    );
    const messagesMarkup = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(messagesMarkup).toContain('agent-section-card');
    expect(messagesMarkup).toContain('agent-message-row');
    expect(messagesMarkup).toContain('agent-message-main');
    expect(messagesMarkup).toContain('agent-message-route');
    expect(messagesMarkup).toContain('agent-message-arrow');
    expect(messagesMarkup).toContain('agent-new-badge');
    expect(messagesMarkup).toContain('agent-message-content');
    expect(messagesMarkup).toContain('agent-message-time');
    expect(messagesMarkup).not.toContain(
      'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)',
    );
    expect(messagesMarkup).not.toContain('style="flex:1;min-width:0"');
    expect(messagesMarkup).not.toContain(
      'style="display:flex;align-items:center;gap:6px"',
    );
    expect(messagesMarkup).not.toContain(
      'style="font-size:11px;color:var(--text-muted)"',
    );
    expect(messagesMarkup).not.toContain('style="font-size:8px"');
    expect(messagesMarkup).not.toContain(
      'style="font-size:12px;margin-top:2px"',
    );
    expect(messagesMarkup).not.toContain(
      'style="font-size:10px;color:var(--text-muted);margin-top:1px"',
    );
  });

  it('keeps the agent message compose form class-driven', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const start = source.indexOf(
      '<div class="card-title">Send Agent Message</div>',
    );
    const end = source.indexOf('<div class="card-title">Plugins', start);
    const composeMarkup = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(composeMarkup).toContain('agent-message-compose-grid');
    expect(composeMarkup).toContain('agent-message-select');
    expect(composeMarkup).toContain('agent-message-compose-row');
    expect(composeMarkup).toContain('agent-message-input');
    expect(composeMarkup).not.toContain(
      'style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px"',
    );
    expect(composeMarkup).not.toContain('id="msg-from" style="width:100%"');
    expect(composeMarkup).not.toContain('id="msg-to" style="width:100%"');
    expect(composeMarkup).not.toContain('style="display:flex;gap:8px"');
    expect(composeMarkup).not.toContain(
      'id="msg-content" placeholder="Message content..." style="flex:1"',
    );
  });

  it('keeps the plugin summary rows class-driven', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const start = source.indexOf('<div class="card-title">Plugins');
    const end = source.indexOf('Manage plugins', start);
    const pluginsMarkup = source.slice(start, end + 'Manage plugins'.length);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(pluginsMarkup).toContain('agent-tool-badge');
    expect(pluginsMarkup).toContain('agent-plugin-row');
    expect(pluginsMarkup).toContain('agent-plugin-name');
    expect(pluginsMarkup).toContain('agent-plugin-version');
    expect(pluginsMarkup).toContain('agent-plugin-action');
    expect(pluginsMarkup).toContain('agent-plugin-manage');
    expect(pluginsMarkup).not.toContain(
      'class="badge badge-muted" style="font-size:10px"',
    );
    expect(pluginsMarkup).not.toContain(
      'class="channel-card" style="padding:6px 0"',
    );
    expect(pluginsMarkup).not.toContain('style="font-weight:500"');
    expect(pluginsMarkup).not.toContain(
      'style="font-size:11px;color:var(--text-muted)"',
    );
    expect(pluginsMarkup).not.toContain('style="font-size:11px"');
    expect(pluginsMarkup).not.toContain(
      'style="margin-top:6px;font-size:11px;color:var(--text-muted)"',
    );
    expect(pluginsMarkup).not.toContain(
      'style="color:var(--accent);cursor:pointer"',
    );
  });

  it('styles task templates as responsive action cards', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.assign-template-card');
    expect(source).toContain('repeat(auto-fit, minmax(148px, 1fr))');
    expect(source).toContain('.assign-template-card:focus-visible');
    expect(source).toContain('.assign-wizard.is-hidden');
    expect(source).toContain('.assign-pane.is-hidden');
    expect(source).toContain('.task-output-panel.is-hidden');
    expect(source).toContain('.assign-form-grid');
    expect(source).toContain('.assign-full-input');
    expect(source).toContain('.assign-prompt-input');
    expect(source).toContain('.assign-action-row');
    expect(source).toContain('.task-output-head');
    expect(source).toContain('.task-output-badges');
    expect(source).toContain('.task-output-actions');
    expect(source).toContain('.task-output-link');
    expect(source).toContain('.coding-deny-note-field');
    expect(source).toContain('.coding-deny-note-field input');
    expect(source).toContain('.coding-job-meta');
    expect(source).toContain('.task-output-log');
    expect(source).toContain('.agent-tool-row');
    expect(source).toContain('.agent-tool-main');
    expect(source).toContain('.agent-tool-meta');
    expect(source).toContain('.agent-tool-actions');
    expect(source).toContain('.agent-tool-badge');
    expect(source).toContain('.agent-bot-row');
    expect(source).toContain('.agent-bot-row.is-disabled');
    expect(source).toContain('.agent-bot-main');
    expect(source).toContain('.agent-bot-titleline');
    expect(source).toContain('.agent-bot-meta');
    expect(source).toContain('.agent-bot-boundaries');
    expect(source).toContain('.agent-bot-actions');
    expect(source).toContain('.agent-bot-mini-badge');
    expect(source).toContain('.agent-section-card');
    expect(source).toContain('.agent-session-row');
    expect(source).toContain('.agent-session-file');
    expect(source).toContain('.agent-session-meta');
    expect(source).toContain('.agent-log-loading');
    expect(source).toContain('.agent-log-viewer');
    expect(source).toContain('.agent-log-head');
    expect(source).toContain('.agent-log-title');
    expect(source).toContain('.agent-log-close');
    expect(source).toContain('.agent-log-body');
    expect(source).toContain('.agent-log-error');
    expect(source).toContain('.agent-recovery-state');
    expect(source).toContain('.agent-recovery-actions');
    expect(source).toContain('.agent-task-row');
    expect(source).toContain('.agent-task-main');
    expect(source).toContain('.agent-task-head');
    expect(source).toContain('.agent-task-prompt');
    expect(source).toContain('.agent-task-meta');
    expect(source).toContain('.agent-task-actions');
    expect(source).toContain('.agent-danger-action');
    expect(source).toContain('.agent-rule-form');
    expect(source).toContain('.agent-rule-field');
    expect(source).toContain('.agent-rule-row');
    expect(source).toContain('.agent-rule-head');
    expect(source).toContain('.agent-rule-title');
    expect(source).toContain('.agent-rule-meta');
    expect(source).toContain('.agent-rule-content');
    expect(source).toContain('.agent-code-empty');
    expect(source).toContain('.agent-code-empty-actions');
    expect(source).toContain('.agent-question-card');
    expect(source).toContain('.agent-question-title');
    expect(source).toContain('.agent-question-row');
    expect(source).toContain('.agent-question-text');
    expect(source).toContain('.agent-question-meta');
    expect(source).toContain('.agent-question-actions');
    expect(source).toContain('.agent-message-row');
    expect(source).toContain('.agent-message-route');
    expect(source).toContain('.agent-message-arrow');
    expect(source).toContain('.agent-new-badge');
    expect(source).toContain('.agent-message-content');
    expect(source).toContain('.agent-message-time');
    expect(source).toContain('.agent-message-compose-grid');
    expect(source).toContain('.agent-message-select');
    expect(source).toContain('.agent-message-compose-row');
    expect(source).toContain('.agent-message-input');
    expect(source).toContain('.agent-plugin-row');
    expect(source).toContain('.agent-plugin-name');
    expect(source).toContain('.agent-plugin-version');
    expect(source).toContain('.agent-plugin-action');
    expect(source).toContain('.agent-plugin-manage');
  });

  it('surfaces a delegation command center with attention shortcuts', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');

    expect(source).toContain('agent-command-surface');
    expect(source).toContain('agent-command-metrics');
    expect(source).toContain('agentDelegationBriefText');
    expect(source).toContain('agentQuestionDecisionBriefText');
    expect(source).toContain('renderAgentLoadingState');
    expect(source).toContain('Loading delegation cockpit');
    expect(source).toContain('Loading coding job evidence');
    expect(source).toContain('Loading session log');
    expect(source).toContain('Loading task output');
    expect(source).toContain('_agentDelegationState');
    expect(source).toContain('copyAgentDelegationBrief');
    expect(source).toContain('copyAgentQuestionDecisionBrief');
    expect(source).toContain('Copy brief');
    expect(source).toContain('Copy question brief');
    expect(source).toContain('copyTextWithFallback');
    expect(source).toContain('Agent delegation brief');
    expect(source).toContain('Agent question decision brief');
    expect(source).toContain('Data health:');
    expect(source).toContain('Delegation feeds loaded without known fallback.');
    expect(source).toContain('loadIssues');
    expect(source).toContain("label: 'Data health'");
    expect(source).toContain('Feeds need review before broad delegation');
    expect(source).toContain("loadIssues.push('Bot agent roster unavailable')");
    expect(source).toContain(
      "loadIssues.push('Delegate tool catalog unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Pending agent questions unavailable')",
    );
    expect(source).toContain("loadIssues.push('Approval queue unavailable')");
    expect(source).toContain("loadIssues.push('Coding job queue unavailable')");
    expect(source).toContain("loadIssues.push('Channel status unavailable')");
    expect(source).not.toContain("prompt('Copy agent delegation brief:'");
    expect(source).not.toContain("prompt('Copy agent question brief:'");
    expect(source).toContain('Questions waiting for a decision');
    expect(source).toContain(
      'Use this brief before assigning more work to agents. Resolve approval gates, unanswered questions, and waiting coding jobs before launching additional automation.',
    );
    expect(source).toContain(
      'Answer these before assigning more automation. Questions often encode missing user intent, approval risk, or routing between Copilot, Cowork, and Code.',
    );
    expect(source).toContain(
      'If the question would trigger external sends, document publishing, webhooks, calendar changes, or repository writes, check Approvals first.',
    );
    expect(source).toContain(
      'Route project/document/email/calendar context back to Cowork, repository context to Code, and simple clarification back to Copilot.',
    );
    expect(source).toContain(
      'Choose Copilot for simple conversation, Cowork projects for artifacts and MCP-backed project work, Code/GitHub handoff for repository changes, and Workflows when a repeated routine needs supervision.',
    );
    expect(source).toContain('Delegation readiness checklist');
    expect(source).toContain(
      'Pick the lane first: Copilot for conversation, Cowork for project/MCP/document work, Code for repository changes, Workflows for repeatable routines.',
    );
    expect(source).toContain(
      'Name the owner, expected output, source context, approval boundary, and proof needed before assigning.',
    );
    expect(source).toContain(
      'Keep MCP/email/document/calendar requests in Cowork until sources and artifact paths are visible.',
    );
    expect(source).toContain(
      'Do not launch another agent when approvals, unanswered questions, or coding gates already block the lane.',
    );
    expect(source).toContain(
      'Capture the chosen lane, owner, expected output, and verification step when the answer creates follow-up work.',
    );
    expect(source).toContain('agent-attention-panel');
    expect(source).toContain('pendingQuestions.length');
    expect(source).toContain('waitingCodingJobCount');
    expect(source).toContain('codingJobActive(job.status)');
    expect(source).toContain("openAssignWorkWizard('github')");
    expect(source).toContain("scrollToAgentSection('pending-questions-card')");
    expect(source).toContain("scrollToAgentSection('github-coding-jobs')");
    expect(source).not.toContain(
      'el.innerHTML = \'<div class="loading">Loading agents</div>\'',
    );
    expect(source).not.toContain("api('/agents/tools').catch(() => [])");
    expect(source).not.toContain("api('/questions/pending').catch(() => [])");
    expect(source).not.toContain("api('/approvals').catch(() => [])");
    expect(source).not.toContain("api('/agents/coding/jobs').catch(() => [])");
    expect(source).not.toContain(
      '<div class="card"><div class="loading">Loading coding job...</div></div>',
    );
    expect(source).not.toContain(
      '<div class="agent-log-loading"><div class="loading">Loading session log...</div></div>',
    );
    expect(source).not.toContain(
      '<div class="card"><div class="loading">Loading output...</div></div>',
    );
  });

  it('elevates the assign wizard and coding job queue into a premium launch desk', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const styles = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('Launch desk');
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-labelledby="assign-work-title"');
    expect(source).toContain('role="tab"');
    expect(source).toContain("setAttribute('aria-selected'");
    expect(source).toContain('agent-coding-job-list');
    expect(source).toContain('agent-coding-job-card');
    expect(source).toContain('agent-coding-queue-actions');
    expect(source).toContain("openAssignWorkWizard('github')");
    expect(source).toContain('Assign issue');
    expect(source).toContain('GitHub coding board');
    expect(styles).toContain('.agent-coding-job-card');
    expect(styles).toContain('.agent-coding-job-list');
    expect(styles).toContain('.agent-coding-queue-actions');
    expect(styles).toContain('.assign-wizard-title');
    expect(styles).toContain('Agents assign + coding board redesign');
  });

  it('keeps secondary Agents operations under a clearer accordion and section kickers', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    expect(source).toContain('Coding tools, bot agents, and history');
    expect(source).toContain('id="coding-agents-card"');
    expect(source).toContain('id="bot-agents-card"');
    expect(source).toContain(
      '<span class="agent-kicker">Delegates</span>Coding Agents',
    );
    expect(source).toContain(
      '<span class="agent-kicker">Channels</span>Bot Agents',
    );
    expect(source).toContain(
      '<span class="agent-kicker">Attention</span>Pending Questions',
    );
    expect(source).toContain(
      '<span class="agent-kicker">Policy</span>Repo Coding Rules',
    );
  });

  it('frames GitHub coding as a handoff board with setup, pickup, and queue state', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');

    expect(source).toContain('agent-coding-board');
    expect(source).toContain('GitHub handoff');
    expect(source).toContain('codingBoardTone');
    expect(source).toContain('codingBoardTitle');
    expect(source).toContain('Register a repo before delegating GitHub work');
    expect(source).toContain('Ready to pick the next GitHub issue');
    expect(source).toContain('agent-coding-controls');
    expect(source).toContain('agent-coding-panel');
    expect(source).toContain('agent-coding-pick-grid');
    expect(source).toContain('Coding jobs');
    expect(source).toContain("renderAgentCodeEmptyState('jobs')");
    expect(source).toContain(
      'Register a repository, choose labels, and let a coding agent pick up',
    );
    expect(source).toContain(
      "document.getElementById('coding-repo-new')?.focus()",
    );
    expect(source).not.toContain(
      '<div class="agent-coding-empty">No dedicated coding jobs yet. Register a repo and pick an issue when you want a coding agent to work.</div>',
    );
  });

  it('surfaces all coding job lifecycle actions in the Agents UI', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');

    expect(source).toContain('GitHub workbench');
    expect(source).toContain("navigate('autofix')");
    expect(source).toContain("controlCodingJob('${esc(job.id)}','open-pr')");
    expect(source).toContain("controlCodingJob('${esc(id)}','open-pr')");
    expect(source).toContain("controlCodingJob('${esc(job.id)}','revert')");
    expect(source).toContain("controlCodingJob('${esc(id)}','revert')");
    expect(source).toContain("controlCodingJob('${esc(job.id)}','close-pr')");
    expect(source).toContain("controlCodingJob('${esc(id)}','close-pr')");
    expect(source).toContain('Open PR');
    expect(source).toContain('Revert');
    expect(source).toContain('Close PR');
  });

  it('renders a premium command surface and soft agent kickers', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const styles = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('agent-command-surface');
    expect(source).toContain('agent-command-metrics');
    expect(source).toContain('agent-metric is-');
    expect(source).toContain('agent-kicker');
    expect(source).toContain('Choose who works next');
    expect(source).toContain('Copy brief');
    expect(source).toContain(
      "class=\"agent-attention-panel ${agentAttentionItems.length > 0 ? 'is-open' : 'is-collapsed'}\"",
    );
    expect(styles).toContain('.agent-command-surface');
    expect(styles).toContain('.agent-metric');
    expect(styles).toContain('font-family: var(--font-display)');
    expect(styles).not.toMatch(/\.agent-stat-pill\s*\{/);
  });

  it('adds an editable agent profile cockpit with explicit states', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const styles = fs.readFileSync(stylePath, 'utf8');
    const mockData = fs.readFileSync(mockDataPath, 'utf8');
    const tabStart = source.indexOf('class="agent-profile-tabs"');
    const tabEnd = source.indexOf('</div>', tabStart);
    const tabMarkup = source.slice(tabStart, tabEnd);

    expect(source).toContain("api('/agent-profiles')");
    expect(source).toContain(
      "'/agent-profiles/' + encodeURIComponent(agentProfileId(profile))",
    );
    expect(source).toContain(
      "loadIssues.push('Agent profile roster unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Agent profile detail unavailable')",
    );
    expect(source).toContain('function renderAgentProfileRoster');
    expect(source).toContain('function renderAgentProfileDetail');
    expect(source).toContain('function renderAgentProfileEmptyState');
    expect(source).toContain('window.selectAgentProfileByIndex');
    expect(source).toContain('onclick="selectAgentProfileByIndex(${index})"');
    expect(source).toContain('renderAgentProfileShell(agentProfiles)');
    expect(source).toContain('agent-profile-roster');
    expect(source).toContain('agent-profile-tabs');
    expect(source).toContain('data-profile-tab=');
    expect(source).toContain('data-profile-tab-panel=');
    expect(source).toContain('aria-controls=');
    expect(source).toContain('aria-labelledby=');
    expect(source).toContain('tab.dataset.profileTab');
    expect(tabMarkup).toContain('>Identity<');
    expect(tabMarkup).toContain('>Model<');
    expect(tabMarkup).toContain('>Capabilities<');
    expect(tabMarkup).toContain('>Subscriptions<');
    expect(tabMarkup).toContain('>Activity<');
    expect(source).toContain('agent-profile-empty-state');
    expect(source).toContain('agent-profile-loading-state');
    expect(source).toContain('agent-profile-unavailable-state');
    expect(source).toContain('agent-profile-subscription-row');
    expect(source).toContain('agent-profile-activity-row');
    expect(source).toContain('Provider profile');
    expect(source).toContain('Tool policy');
    expect(source).toContain('Task kinds');
    expect(source).toContain('profile.allowedMcpServers');
    expect(source).toContain('detailUnavailable: true');
    expect(source).toContain(
      "renderAgentProfileEmptyState('detailUnavailable')",
    );
    expect(source).toContain('esc(String(activeRuns))');
    expect(source).toContain('esc(String(blockedApprovals))');
    expect(source).toContain('esc(String(errors))');
    expect(source).toContain("'approval_blocked', 'blocked', 'await_approval'");
    expect(source).toContain("'error', 'failed', 'failure'");
    expect(source).not.toContain('style="display:flex;gap:12px"');

    expect(styles).toContain('.agent-profile-shell');
    expect(styles).toContain('.agent-profile-roster');
    expect(styles).toContain('.agent-profile-row');
    expect(styles).toContain('.agent-profile-row.is-active');
    expect(styles).toContain('.agent-profile-detail');
    expect(styles).toContain('.agent-profile-tabs');
    expect(styles).toContain('.agent-profile-tab-panel');
    expect(styles).toContain('.agent-profile-empty-state');
    expect(styles).toContain('.agent-profile-loading-state');
    expect(styles).toContain('.agent-profile-unavailable-state');
    expect(styles).toContain('.agent-profile-subscription-row');
    expect(styles).toContain('.agent-profile-activity-row');

    expect(mockData).toContain("pathname === '/agent-profiles'");
    expect(mockData).toContain("displayName: 'Manual Host'");
    expect(mockData).toContain("displayName: 'Repo Fixer'");
    expect(mockData).toContain("displayName: 'Researcher'");
    expect(mockData).toContain('subscriptions: [');
    expect(mockData).toContain('activity: [');
  });

  it('wires agent profile save and invoke actions without prompt dialogs', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');
    const styles = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('saveAgentProfile');
    expect(source).toContain('invokeAgentProfile');
    expect(source).toContain("api('/agent-profiles/' + encodeURIComponent");
    expect(source).toContain("'/invoke'");
    expect(source).not.toContain("prompt('");
    expect(source).toContain('name="displayName"');
    expect(source).toContain('name="handle"');
    expect(source).toContain('name="description"');
    expect(source).toContain('name="personality"');
    expect(source).toContain('name="enabled"');
    expect(source).toContain('name="providerProfileId"');
    expect(source).toContain('name="provider"');
    expect(source).toContain('name="model"');
    expect(source).toContain('name="toolPolicy"');
    expect(source).toContain('name="allowedMcpServers"');
    expect(source).toContain('name="skills"');
    expect(source).toContain('name="memoryScopes"');
    expect(source).toContain('name="taskKinds"');
    expect(source).toContain('agent-profile-action-status');
    expect(source).toContain('agent-profile-invoke-prompt-');
    expect(source).toContain(
      "Quick invoke uses this profile's configured provider, model, and capabilities",
    );
    expect(source).toContain('function agentProfileAttr');
    expect(source).toContain(
      'value="${agentProfileAttr(agentProfileDisplayName(profile))}"',
    );
    expect(source).toContain('agentProfileSetStatus');
    expect(source).toContain('Display name and handle are required');
    expect(source).toContain('Enter a prompt before invoking this profile.');
    expect(source).toContain('JSON.stringify({ prompt })');
    expect(source).toContain('currentAllowedMcpServers');
    expect(source).toContain('Array.isArray(currentAllowedMcpServers)');
    expect(styles).toContain('.agent-profile-action-status');
    expect(styles).toContain('.agent-profile-action-status.is-error');
    expect(styles).toContain('.agent-profile-form');
    expect(styles).toContain('.agent-profile-field-wide');
    expect(styles).toContain('.agent-profile-invoke-input');
  });

  it('uses complete runtime compatibility metadata for coding selectors', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');

    expect(source).toContain("api('/agents/coding/runtimes')");
    expect(source).toContain("api('/agents/coding/runtime-profiles')");
    expect(source).toContain('codingRuntimeProfileOptions');
    expect(source).toContain('selectCodingRuntimeProfile');
    expect(source).toContain('normalizeCodingRuntimeCatalog');
    expect(source).toContain('loadIssues.push(runtimeCatalog.error)');
    expect(source).toContain('Runner CLI');
    expect(source).toContain('Provider');
    expect(source).toContain('Model');
    expect(source).toContain('codingRuntimeOptionsForCli');
    expect(source).toContain('codingRuntimeOptionsForProvider');
    expect(source).toContain('readiness.detail');
    expect(source).toContain("readiness.status === 'healthy'");
    expect(source).toContain(
      "Devin sends the prompt, selected repository content, and tool results to Devin's external service.",
    );
    expect(source).toContain('actualRuntime: { cli, provider, model }');
    expect(source).not.toContain("provider === 'devin'");
  });

  it('renders the complete actual coding runtime on job cards and details', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');

    expect(source).toContain('function runtimeLabel(runtime)');
    expect(source).toContain('runtimeLabel(');
    expect(source).toContain('job.actualRuntime || {');
    expect(source).toContain('cli: job.runnerCli');
    expect(source).toContain(
      "[runtime.cli, runtime.provider, runtime.model].join(' / ')",
    );
  });

  it('makes Code assignment the primary repo work flow with explicit target and plan controls', () => {
    const source = fs.readFileSync(agentsPagePath, 'utf8');

    expect(source).toContain('assign-coding-target-type');
    expect(source).toContain('value="auto">Next issue');
    expect(source).toContain('value="issue-number">Issue #');
    expect(source).toContain('value="freeform">Freeform task');
    expect(source).toContain('assign-coding-issue-number');
    expect(source).toContain('assign-coding-prompt');
    expect(source).toContain('assign-coding-plan-mode');
    expect(source).toContain('assign-coding-profile-select');
    expect(source).toContain('value="plan-first"');
    expect(source).toContain('value="implement-now"');
    expect(source).toContain('startAssignedCodingJob');
    expect(source).toContain("api('/agents/coding/jobs'");
    expect(source).toContain("api('/agents/coding/pick-issue'");
    expect(source).toContain('assignmentPlanDirective');
    expect(source).toContain('Implementation approval is still required');
  });

  it('styles the delegation cockpit for desktop and narrow screens', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.agent-command-surface');
    expect(source).toContain('.agent-command-metrics');
    expect(source).toContain('.agent-metric');
    expect(source).toContain('.agent-loading-state');
    expect(source).toContain('.agent-loading-state.is-cockpit');
    expect(source).toContain('.agent-loading-state::after');
    expect(source).toContain('.agent-loading-flow');
    expect(source).toContain('@keyframes agentLoadingSweep');
    expect(source).toContain('.agent-attention-row');
    expect(source).toContain('.agent-question-brief');
    expect(source).toContain('.agent-attention-row:focus-visible');
    expect(source).toContain('.agent-coding-board');
    expect(source).toContain('.agent-coding-brief');
    expect(source).toContain('.agent-coding-controls');
    expect(source).toContain('.agent-coding-pick-grid');
    expect(source).toContain('.agent-code-empty');
    expect(source).toContain('.agent-code-empty-actions');
    expect(source).toContain('@media (max-width: 520px)');
    expect(source).toContain(
      '.agent-attention-row {\n    align-items: flex-start;',
    );
    expect(source).toContain('.agent-coding-brief-stats,');
    expect(source).toContain('.agent-loading-flow,');
    expect(source).toContain(
      '.agent-coding-inline-form {\n    grid-template-columns: 1fr;',
    );
  });
});
