import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Channels command center UI', () => {
  it('frames channels as intake and delivery for productive agent work', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('channels-command-center');
    expect(source).toContain("channels: 'renderChannelsStandalone'");
    expect(source).toContain('Intake and delivery');
    expect(source).toContain('Keep the useful channels online');
    expect(source).toContain('Open inbox');
    expect(source).toContain("navigate('approvals')");
    expect(source).toContain("navigate('tasks')");
    expect(source).toContain('channelIntentCards');
    expect(source).toContain('channels-intent-map');
    expect(source).toContain('channelConnectorRunway');
    expect(source).toContain('renderChannelConnectorRunway');
    expect(source).toContain('channelIntakePromptText');
    expect(source).toContain('channels-connector-runway');
    expect(source).toContain('Connector output runway');
    expect(source).toContain('Turn channel and MCP context into durable work.');
    expect(source).toContain('Copy intake prompt');
    expect(source).toContain('copyChannelIntakePrompt');
    expect(source).toContain('Channel intake prompt copied');
    expect(source).toContain('Copy channel intake prompt');
    expect(source.indexOf('renderChannelConnectorRunway()')).toBeLessThan(
      source.indexOf('<section class="channels-routing-panel">'),
    );
  });

  it('maps channels to Copilot, Cowork, Approvals, and scheduled delivery intents', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("lane: 'Copilot'");
    expect(source).toContain("lane: 'Cowork'");
    expect(source).toContain("lane: 'Approvals'");
    expect(source).toContain("lane: 'Scheduled'");
    expect(source).toContain(
      'Project requests, documents, artifacts, and MCP-backed follow-up',
    );
    expect(source).toContain(
      'Operator decisions for external sends, webhooks, and tool writes',
    );
  });

  it('bridges channel and MCP context into Cowork, documents, artifacts, and approvals', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Source ready');
    expect(source).toContain('Project context');
    expect(source).toContain('Document output');
    expect(source).toContain('Delivery gate');
    expect(source).toContain("target: 'Messages'");
    expect(source).toContain("target: 'Cowork'");
    expect(source).toContain("target: 'Reports'");
    expect(source).toContain("target: 'Approvals'");
    expect(source).toContain("route: 'messages'");
    expect(source).toContain("route: 'projects'");
    expect(source).toContain("route: 'reports'");
    expect(source).toContain("route: 'approvals'");
    expect(source).toContain(
      'Confirm the latest email, channel thread, or connector result is visible before asking an agent to summarize it.',
    );
    expect(source).toContain(
      'Move durable summaries, documents, and MCP evidence into a project so follow-up agents inherit the context.',
    );
    expect(source).toContain(
      'Use report generation when a channel or MCP source should become a Markdown, HTML, DOCX, or PDF artifact.',
    );
    expect(source).toContain(
      'Require approval before sending email, publishing documents, editing calendars, or updating external systems.',
    );
    expect(source).toContain(
      'Create a Cowork project artifact from channel or MCP intake.',
    );
    expect(source).toContain(
      'Start from the latest relevant channel message, email thread, connector result, or copied transcript.',
    );
    expect(source).toContain(
      'Name the source channel, sender or group, date window, project, and question before summarizing.',
    );
    expect(source).toContain(
      'If an MCP server is needed, use approved read-only tools first and cite the server, query/filter, and source window.',
    );
    expect(source).toContain(
      'Save the first summary, brief, or document draft inside the Cowork project workspace.',
    );
    expect(source).toContain(
      'Return a concise project artifact draft, source ledger, open questions, and the next approval or follow-up action.',
    );
  });

  it('summarizes connected, degraded, and available channel readiness', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const activeMarkup = source.slice(
      source.indexOf('const activeHtml'),
      source.indexOf('const availableHtml'),
    );
    const availableMarkup = source.slice(
      source.indexOf('const availableHtml'),
      source.indexOf(
        'el.innerHTML = `\\n    <div class="page-header"><h2>Channels</h2></div>',
      ),
    );

    expect(source).toContain('connectedChannels');
    expect(source).toContain('degradedChannels');
    expect(source).toContain('setupReadyChannels');
    expect(source).toContain('missingSetupChannels');
    expect(source).toContain('channelExpansionFocus');
    expect(source).toContain('renderChannelExpansionBrief');
    expect(source).toContain('channelDeliveryChecklist');
    expect(source).toContain('renderChannelDeliveryChecklist');
    expect(source).toContain('Expansion plan');
    expect(source).toContain('Delivery gate');
    expect(source).toContain('Route channel work before agents act');
    expect(source).toContain(
      'visible in Messages before routing work through it',
    );
    expect(source).toContain('Ready to add');
    expect(source).toContain('channelStats');
    expect(source).toContain('channels-routing-panel');
    expect(source).toContain('channels-expansion-brief');
    expect(source).toContain('channels-delivery-checklist');
    expect(source).toContain('channels-active-grid');
    expect(source).toContain('channel-surface-head');
    expect(source).toContain('channel-surface-title');
    expect(source).toContain('channel-surface-name');
    expect(source).toContain('channel-surface-description');
    expect(source).toContain('channel-surface-actions');
    expect(source).toContain('channel-config-table');
    expect(source).toContain('channel-available-row');
    expect(source).toContain('channel-available-main');
    expect(source).toContain('channel-available-setup');
    expect(source).toContain("restartChannel('${esc(ch.id)}',this)");
    expect(activeMarkup).not.toContain(
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">',
    );
    expect(activeMarkup).not.toContain(
      '<div style="display:flex;align-items:center;gap:12px">',
    );
    expect(availableMarkup).not.toContain(
      'style="padding:14px 0;border-bottom:1px solid var(--border)"',
    );
    expect(activeMarkup).not.toContain(
      'td style="width:200px;color:var(--text-muted);font-size:12px"',
    );
    expect(activeMarkup).not.toContain(
      'td style="font-family:var(--mono);font-size:12px;color:var(--text)"',
    );
  });

  it('keeps WhatsApp dashboard pairing states class-driven', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const start = source.indexOf('function renderWhatsAppPairingPanel');
    const end = source.indexOf('window.startWhatsAppPairing', start);
    const pairingMarkup = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(pairingMarkup).toContain('channel-pairing-panel');
    expect(pairingMarkup).toContain('channel-pairing-head');
    expect(pairingMarkup).toContain('channel-pairing-title');
    expect(pairingMarkup).toContain('channel-pairing-detail');
    expect(pairingMarkup).toContain('channel-pairing-badge');
    expect(pairingMarkup).toContain('channel-pairing-qr');
    expect(pairingMarkup).toContain('channel-pairing-qr-img');
    expect(pairingMarkup).toContain('channel-pairing-qr-copy');
    expect(pairingMarkup).toContain('channel-pairing-code');
    expect(pairingMarkup).toContain('channel-pairing-error');
    expect(pairingMarkup).toContain('channel-pairing-actions');
    expect(pairingMarkup).toContain('id="whatsapp-pairing-phone"');
    expect(pairingMarkup).toContain('channel-pairing-phone');
    expect(pairingMarkup).toContain('resetWhatsAppSession(this)');
    expect(source).toContain(
      "document.getElementById('whatsapp-pairing-phone')?.value.trim()",
    );
    expect(source).toContain(
      "toast('Enter a phone number for pairing code', 'warning')",
    );
    expect(source).not.toContain(
      "prompt('Phone number with country code, digits only')",
    );
    expect(source).toContain(
      "inlineConfirm(\n    btnEl,\n    'Reset WhatsApp session files and disconnect the channel?'",
    );
    expect(source).not.toContain(
      "confirm('Reset WhatsApp session files and disconnect the channel?')",
    );
    expect(pairingMarkup).not.toContain(
      'margin:12px 0;padding:12px;background:var(--surface2)',
    );
    expect(pairingMarkup).not.toContain(
      'display:flex;justify-content:space-between;gap:12px',
    );
    expect(pairingMarkup).not.toContain(
      'style="width:180px;height:180px;background:#fff;padding:8px;border-radius:8px"',
    );
    expect(pairingMarkup).not.toContain(
      'style="font-size:22px;font-family:var(--mono);letter-spacing:2px;margin:8px 0;color:var(--accent)"',
    );
    expect(pairingMarkup).not.toContain(
      'class="alert-banner alert-error" style="margin:8px 0"',
    );
  });

  it('uses recovery-oriented channel action failures', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('function channelActionErrorMessage');
    expect(source).toContain('window.restartChannel');
    expect(source).toContain(
      'Channel restart was not completed. Check Logs and System Info before retrying',
    );
    expect(source).toContain(
      'WhatsApp pairing did not start. Check credentials, phone number format, existing sessions, and channel logs',
    );
    expect(source).toContain(
      'WhatsApp pairing was not cancelled. Refresh Channels, check the pairing state',
    );
    expect(source).toContain(
      'WhatsApp session reset was not completed. Check active channel delivery, pairing logs',
    );
    expect(source).toContain(
      "toast(channelActionErrorMessage('restart', res), 'error')",
    );
    expect(source).toContain(
      "toast(channelActionErrorMessage('pair', res), 'error')",
    );
    expect(source).toContain(
      "toast(channelActionErrorMessage('cancel', res), 'error')",
    );
    expect(source).toContain(
      "toast(channelActionErrorMessage('reset', res), 'error')",
    );
    expect(source).not.toContain(
      "toast(res.error || 'Pairing failed to start', 'error')",
    );
    expect(source).not.toContain(
      "toast(res.error || 'Cancel failed', 'error')",
    );
    expect(source).not.toContain("toast(res.error || 'Reset failed', 'error')");
  });

  it('copies channel routing state for Copilot, Cowork, approvals, and schedules', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('channelRoutingBriefText');
    expect(source).toContain('window.copyChannelRoutingBrief');
    expect(source).toContain('Copy routing brief');
    expect(source).toContain('Channel routing brief copied');
    expect(source).toContain('Review this NanoCrab channel routing state.');
    expect(source).toContain('Routing lanes:');
    expect(source).toContain('Delivery gate:');
    expect(source).toContain('Connector output runway:');
    expect(source).toContain('${item.step} -> ${item.target}: ${item.detail}');
    expect(source).toContain('Preserve source');
    expect(source).toContain(
      'Require approval for external sends, document publishing, webhooks, calendar edits, and tool writes',
    );
    expect(source).toContain(
      'Repair degraded delivery paths before expanding external sends',
    );
    expect(source).toContain('keep MCP/document/email actions approval-gated');
    expect(source).toContain('window._channelRoutingState');
  });

  it('styles the channel cockpit, queue, and adapter cards responsively', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.channels-command-center');
    expect(source).toContain('.channels-command-stats');
    expect(source).toContain('.channels-intent-map');
    expect(source).toContain('.channels-intent-card');
    expect(source).toContain('.channels-connector-runway');
    expect(source).toContain('.channels-connector-head');
    expect(source).toContain('.channels-connector-head .btn');
    expect(source).toContain('.channels-connector-grid');
    expect(source).toContain('.channels-connector-card');
    expect(source).toContain('.channels-routing-panel');
    expect(source).toContain('.channels-expansion-brief');
    expect(source).toContain('.channels-expansion-actions');
    expect(source).toContain('.channels-delivery-checklist');
    expect(source).toContain('.channels-delivery-copy');
    expect(source).toContain('.channels-delivery-steps');
    expect(source).toContain('.channels-delivery-step');
    expect(source).toContain('.channels-queue-row');
    expect(source).toContain('.channels-active-grid');
    expect(source).toContain('.channel-surface-card');
    expect(source).toContain('.channel-surface-head');
    expect(source).toContain('.channel-icon');
    expect(source).toContain('.channel-surface-name');
    expect(source).toContain('.channel-surface-actions');
    expect(source).toContain('.channel-available-setup');
    expect(source).toContain('.channel-config-table');
    expect(source).toContain('.channel-config-table td:first-child');
    expect(source).toContain('.channel-config-table td:last-child');
    expect(source).toContain('.channel-pairing-panel');
    expect(source).toContain('.channel-pairing-head');
    expect(source).toContain('.channel-pairing-qr-img');
    expect(source).toContain('.channel-pairing-actions');
    expect(source).toContain('.channel-pairing-phone');
    expect(source).toContain('.channels-command-center,');
    expect(source).toContain('.channels-routing-panel,');
    expect(source).toContain('.channels-expansion-brief,');
    expect(source).toContain('.channels-connector-runway,');
    expect(source).toContain('.channels-connector-grid,');
    expect(source).toContain('.channels-delivery-checklist,');
    expect(source).toContain('.channel-available-row,');
  });
});
