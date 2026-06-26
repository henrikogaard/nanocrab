import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Webhooks intake cockpit UI', () => {
  it('frames webhooks as external intake for agent work', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('External intake');
    expect(source).toContain('Intake cockpit');
    expect(source).toContain(
      'Route repo activity into the right agent workflow',
    );
    expect(source).toContain("navigate('approvals')");
    expect(source).toContain("navigate('copilot')");
    expect(source).toContain('GitHub Copilot');
  });

  it('surfaces readiness, receiver health, setup path, routing outcome, and event stream', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('webhooks-command-center');
    expect(source).toContain('webhooks-intake-brief');
    expect(source).toContain('Intake decision');
    expect(source).toContain('Fix intake before relying on GitHub automation');
    expect(source).toContain('Webhook intake is ready for agent workflows');
    expect(source).toContain('Receiver health');
    expect(source).toContain('Setup path');
    expect(source).toContain('Routing outcome');
    expect(source).toContain('Recent Events');
    expect(source).toContain('webhook-event-card');
    expect(source).toContain('webhookHandoffMatrix');
    expect(source).toContain('webhookEventLane');
    expect(source).toContain('webhookEventHandoffPromptText');
    expect(source).toContain('renderWebhookHandoffMatrix');
    expect(source).toContain('webhooks-handoff-matrix');
    expect(source).toContain('Event handoff');
    expect(source).toContain(
      'Route GitHub activity before it becomes unattended work',
    );
    expect(source).toContain(
      'human-readable owner, the right workspace lane, and approval gates',
    );
  });

  it('keeps webhook config and event actions wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('id="webhook-url"');
    expect(source).toContain('id="wh-secret"');
    expect(source).toContain('id="wh-target"');
    expect(source).toContain('id="wh-enabled"');
    expect(source).toContain('saveWebhookConfig');
    expect(source).toContain('clearWebhookEvents');
    expect(source).toContain('copyWebhookUrl');
    expect(source).toContain('copyWebhookEventHandoff');
    expect(source).toContain('Copy event handoff');
    expect(source).toContain('Webhook event handoff copied');
    expect(source).toContain('Copy webhook receiver URL');
    expect(source).toContain('Webhook URL copied');
    expect(source).toContain('failedEvents');
    expect(source).toContain("document.getElementById('wh-target')?.focus()");
  });

  it('uses intake recovery copy for webhook config and event clearing failures', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const start = source.indexOf('function webhookActionErrorMessage');
    const actions = source.slice(start, source.indexOf('// Terminal', start));

    expect(actions).toContain('webhookActionErrorMessage');
    expect(actions).toContain('Webhook config was not saved.');
    expect(actions).toContain('Webhook events were not cleared.');
    expect(actions).toContain(
      'approval gates before routing GitHub events into Code, Copilot, or Cowork',
    );
    expect(actions).toContain(
      'failed deliveries before hiding intake evidence',
    );
    expect(actions).toContain(
      "toast(webhookActionErrorMessage('save', r), 'error')",
    );
    expect(actions).toContain(
      "toast(webhookActionErrorMessage('save', err), 'error')",
    );
    expect(actions).toContain(
      "toast(webhookActionErrorMessage('clear', r), 'error')",
    );
    expect(actions).toContain(
      "toast(webhookActionErrorMessage('clear', err), 'error')",
    );
    expect(actions).not.toContain("toast(r.error || 'Failed', 'error')");
  });

  it('maps repo events into the right workspace lane before automation runs', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("event: 'Pull request opened'");
    expect(source).toContain("lane: 'Code'");
    expect(source).toContain(
      'Create a scoped review or verification task before assigning repo-changing automation',
    );
    expect(source).toContain("target: 'gitcode'");
    expect(source).toContain("event: 'Issue assigned'");
    expect(source).toContain("lane: 'GitHub Copilot'");
    expect(source).toContain(
      'Let GitHub Copilot prepare the coding job only after the target repo and issue are clear',
    );
    expect(source).toContain("target: 'copilot'");
    expect(source).toContain("event: 'Release or docs request'");
    expect(source).toContain("lane: 'Cowork'");
    expect(source).toContain(
      'Turn the event into a project thread, document, artifact, or report with saved context',
    );
    expect(source).toContain("target: 'projects'");
    expect(source).toContain("event: 'Failed or blocked delivery'");
    expect(source).toContain("lane: 'Approvals'");
    expect(source).toContain(
      'keep external writes gated until intake is trusted',
    );
    expect(source).toContain("target: 'approvals'");
    expect(source).toContain('onclick="navigate(\'${esc(item.target)}\')"');
  });

  it('turns an empty event stream into an intake test path', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderWebhookEventsEmptyState');
    expect(source).toContain('webhook-events-empty-state');
    expect(source).toContain('No webhook events received yet');
    expect(source).toContain('Send a GitHub ping or pull request event');
    expect(source).toContain('Copy the receiver URL');
    expect(source).toContain('Choose an owner');
    expect(source).toContain('Keep writes gated');
    expect(source).toContain('copyWebhookUrl()');
    expect(source).toContain("navigate('approvals')");
    expect(source).toContain('copyWebhookIntakeBrief()');
    expect(source).not.toContain(
      '\'<div class="empty">No webhook events received yet</div>\'',
    );
    expect(style).toContain('.webhook-events-empty-state');
    expect(style).toContain('.webhook-events-empty-flow');
    expect(style).toContain('.webhook-events-empty-flow article button');
    expect(style).toContain('.webhook-events-empty-actions');
    expect(style).toContain(
      '.webhook-events-empty-flow {\n    grid-template-columns: 1fr;',
    );
  });

  it('uses class-based layout for webhook setup controls', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const webhooksBlock = source.slice(
      source.indexOf('async function renderWebhooks'),
      source.indexOf('window.copyWebhookIntakeBrief'),
    );

    expect(webhooksBlock).toContain('webhook-config-card');
    expect(webhooksBlock).toContain('webhook-url-row');
    expect(webhooksBlock).toContain('webhook-field');
    expect(webhooksBlock).toContain('webhook-toggle-row');
    expect(webhooksBlock).toContain('webhook-config-actions');
    expect(webhooksBlock).toContain('webhook-setup-card');
    expect(webhooksBlock).toContain('webhook-health-summary');
    expect(webhooksBlock).toContain('webhook-health-check');
    expect(webhooksBlock).toContain('webhook-health-detail');
    expect(webhooksBlock).toContain('webhook-event-actions');
    expect(webhooksBlock).toContain('renderWebhookEventsEmptyState()');
    expect(webhooksBlock).not.toContain('style="display:flex');
    expect(webhooksBlock).not.toContain('style="max-width:100%');
    expect(webhooksBlock).not.toContain('style="margin-top:8px"');
    expect(webhooksBlock).not.toContain(
      "navigator.clipboard.writeText(document.getElementById('webhook-url')",
    );
  });

  it('copies webhook intake state for Code and Copilot handoff', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('webhookIntakeBriefText');
    expect(source).toContain('window.copyWebhookIntakeBrief');
    expect(source).toContain('Copy intake brief');
    expect(source).toContain('Webhook intake brief copied');
    expect(source).toContain('Review this NanoCrab webhook intake state.');
    expect(source).toContain('Failed event sample:');
    expect(source).toContain('Handoff matrix:');
    expect(source).toContain('...webhookHandoffMatrix().map(');
    expect(source).toContain(
      'GitHub events can safely route into Code or GitHub Copilot work',
    );
    expect(source).toContain('repo-changing automation behind approvals');
    expect(source).toContain('Webhook event handoff prompt');
    expect(source).toContain('Recommended lane: ${lane.lane}');
    expect(source).toContain(
      'Confirm this event is expected, signed with the configured secret, and belongs to the intended repository owner.',
    );
    expect(source).toContain(
      'Route the follow-up to the recommended lane before starting unattended automation.',
    );
    expect(source).toContain(
      'If the receiver health is not ready or this delivery failed, inspect Approvals, Logs, and webhook health before assigning Code or Copilot work.',
    );
    expect(source).toContain('copyTextWithFallback');
    expect(source).toContain('window._webhookIntakeState');
  });

  it('styles the webhook page as a responsive intake cockpit', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.webhooks-command-center');
    expect(source).toContain('.webhooks-intake-brief');
    expect(source).toContain('.webhooks-intake-brief.is-attention');
    expect(source).toContain('.webhooks-intake-facts');
    expect(source).toContain('.webhooks-command-stats');
    expect(source).toContain('.webhooks-work-grid');
    expect(source).toContain('.webhook-health-card');
    expect(source).toContain('.webhook-event-card');
    expect(source).toContain('.webhook-config-card');
    expect(source).toContain('.webhook-setup-card');
    expect(source).toContain('.webhook-config-actions');
    expect(source).toContain('.webhook-health-check');
    expect(source).toContain('.webhook-event-actions');
    expect(source).toContain('.webhook-event-route-actions');
    expect(source).toContain('.webhook-events-empty-state');
    expect(source).toContain('.webhook-events-empty-flow');
    expect(source).toContain('.webhooks-command-copy');
    expect(source).toContain('.webhooks-stat');
    expect(source).toContain('.webhooks-handoff-matrix');
    expect(source).toContain('.webhooks-handoff-head');
    expect(source).toContain('.webhooks-handoff-grid');
    expect(source).toContain('.webhooks-handoff-card');
    expect(source).toContain('.webhooks-handoff-card:hover');
    expect(source).toContain(
      '.webhooks-command-center,\n  .webhooks-handoff-grid,\n  .webhooks-work-grid',
    );
    expect(source).toContain(
      '.webhooks-command-center,\n  .webhooks-handoff-matrix,\n  .webhooks-panel',
    );
    expect(source).toContain(
      '.webhooks-page-header,\n  .webhooks-intake-brief,\n  .webhooks-handoff-head,\n  .webhooks-panel-head',
    );
    expect(source).toContain('.webhooks-intake-actions');
  });
});
