import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Logs runtime console UI', () => {
  it('frames logs as a runtime console with scan-ready state', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Runtime console');
    expect(source).toContain('logs-command-center');
    expect(source).toContain('logs-state-strip');
    expect(source).toContain('logs-triage-brief');
    expect(source).toContain('logs-triage-packet');
    expect(source).toContain('logs-evidence-bundle');
    expect(source).toContain('logs-followup-lanes');
    expect(source).toContain('logs-workbench');
    expect(source).toContain('Runtime decision');
    expect(source).toContain('System stream');
    expect(source).toContain('Error focus');
    expect(source).toContain('logRuntimeBriefText');
    expect(source).toContain('logTriagePacket');
    expect(source).toContain('logEvidenceBundle');
    expect(source).toContain('logFollowUpLanes');
    expect(source).toContain('renderLogTriagePacket');
    expect(source).toContain('renderLogEvidenceBundle');
    expect(source).toContain('renderLogFollowUpLanes');
    expect(source).toContain('NanoCrab runtime log triage brief');
    expect(source).toContain('Follow-up lanes');
    expect(source).toContain(
      'Turn log findings into the next useful workspace action.',
    );
    expect(source).toContain('Copy triage brief');
    expect(source).toContain('copyLogRuntimeBrief');
    expect(source).toContain('Log triage brief copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("prompt('Copy log triage brief:'");
    expect(source).toContain('window._logRuntimeState');
  });

  it('keeps log APIs, live stream id, and websocket subscription intact', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/logs/system?lines=150')");
    expect(source).toContain("api('/logs/errors?lines=50')");
    expect(source).toContain('id="live-log"');
    expect(source).toContain(
      "ws.send(JSON.stringify({ type: 'subscribe_logs', data: 'system' }))",
    );
    expect(source).toContain(
      "window._tabLoaderRegistry?.['mon-tabs']?.('logs')",
    );
  });

  it('classifies log lines for operator attention without backend changes', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('const classifyLogLines = (lines) =>');
    expect(source).toContain('/error|failed|exception|fatal/i');
    expect(source).toContain('/warn|timeout|retry/i');
    expect(source).toContain('systemStats.errors');
    expect(source).toContain('No errors in the current window.');
    expect(source).toContain('logTriage');
    expect(source).toContain('logTriageRoutes');
    expect(source).toContain(
      'Errors need operator review before more agent work',
    );
    expect(source).toContain(
      'Warnings are present, but the runtime is still observable',
    );
    expect(source).toContain('Logs are quiet in the current window');
    expect(source).toContain("route: 'credentials'");
    expect(source).toContain("route: 'channels'");
    expect(source).toContain("route: 'containers'");
    expect(source).toContain("route: 'integrations'");
    expect(source).toContain("route: 'monitoring'");
    expect(source).toContain("route: 'gitcode'");
    expect(source).toContain("route: 'projects'");
    expect(source).toContain(
      'Review errors before launching more Copilot, Cowork, Code, MCP, or scheduled agent work',
    );
    expect(source).toContain(
      'Route credential failures to Credentials, channel delivery failures to Channels, container/tool failures to Containers, and connector failures to Integrations',
    );
    expect(source).toContain(
      'Keep the relevant error lines with any approval, incident, or project handoff',
    );
    expect(source).toContain('Triage packet');
    expect(source).toContain(
      'Keep the retry trail useful before launching more agent work',
    );
    expect(source).toContain(
      'Use this when a failure touches MCP, email, documents, webhooks, scheduled sends',
    );
    expect(source).toContain('Capture');
    expect(source).toContain('Attach');
    expect(source).toContain('Verify');
    expect(source).toContain('Gate');
    expect(source).toContain(
      'Capture the first failing timestamp, route, actor/group, provider or container, and correlation ID if present.',
    );
    expect(source).toContain(
      'Attach the matching log lines to the related approval, Cowork project, Code run, incident, or audit review.',
    );
    expect(source).toContain(
      'Retry only after the owning route has been checked and Monitoring shows fresh runtime evidence.',
    );
    expect(source).toContain(
      'If MCP, email, document, webhook, or scheduled sends are involved, keep the next run read-only or approval-gated.',
    );
    expect(source).toContain('Evidence bundle');
    expect(source).toContain(
      'Preserve the facts another workspace needs to continue.',
    );
    expect(source).toContain('Timestamp and route');
    expect(source).toContain('Actor and correlation');
    expect(source).toContain('Cause and owner');
    expect(source).toContain('Retry boundary');
    expect(source).toContain(
      'Keep the first failing timestamp, HTTP route, channel, group, thread, project, or job identifier.',
    );
    expect(source).toContain(
      'State whether the next retry must be read-only, approval-gated, provider-reprobed, or blocked until code changes land.',
    );
    expect(source).toContain('Runtime fix');
    expect(source).toContain('Credential or connector');
    expect(source).toContain('Code repair');
    expect(source).toContain('Project artifact');
    expect(source).toContain(
      'Use when resource pressure, restart decisions, or service health is the problem.',
    );
    expect(source).toContain(
      'Use when auth, MCP, provider, email, document, or integration errors appear.',
    );
    expect(source).toContain(
      'Use when stack traces, failed builds, or repeatable defects need file changes and tests.',
    );
    expect(source).toContain(
      'Use when findings should become a project note, incident summary, or durable artifact.',
    );
  });

  it('styles the log console, panels, and mobile layout', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.logs-command-center');
    expect(source).toContain('.logs-state-strip');
    expect(source).toContain('.logs-triage-brief');
    expect(source).toContain('.logs-triage-brief.is-attention');
    expect(source).toContain('.logs-triage-routes');
    expect(source).toContain('.logs-triage-packet');
    expect(source).toContain('.logs-triage-packet-head');
    expect(source).toContain('.logs-triage-packet-grid');
    expect(source).toContain('.logs-triage-step');
    expect(source).toContain('.logs-evidence-bundle');
    expect(source).toContain('.logs-evidence-head');
    expect(source).toContain('.logs-evidence-grid');
    expect(source).toContain('.logs-evidence-card');
    expect(source).toContain('.logs-followup-lanes');
    expect(source).toContain('.logs-followup-head');
    expect(source).toContain('.logs-followup-grid');
    expect(source).toContain('.logs-followup-card');
    expect(source).toContain('.logs-workbench');
    expect(source).toContain('.logs-panel-head');
    expect(source).toContain('.logs-viewer');
    expect(source).toContain('.logs-triage-brief {');
    expect(source).toContain('.logs-state-strip,');
    expect(source).toContain('.logs-triage-packet-grid,');
    expect(source).toContain('.logs-evidence-grid,');
    expect(source).toContain('.logs-followup-grid,');
    expect(source).toContain('.logs-workbench,');
    expect(source).toContain('.logs-evidence-head,');
    expect(source).toContain('.logs-followup-head,');
    expect(source).toContain(
      '.logs-triage-packet-head {\n    flex-direction: column;',
    );
  });
});
