import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('System Info profile UI', () => {
  it('frames system info as runtime profile and pressure summary', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('System profile');
    expect(source).toContain('system-command-center');
    expect(source).toContain('system-state-strip');
    expect(source).toContain('system-decision-map');
    expect(source).toContain('system-workbench');
    expect(source).toContain('runtime pressure');
    expect(source).toContain("label: 'Capacity'");
    expect(source).toContain("label: 'Delivery'");
    expect(source).toContain("label: 'Evidence'");
    expect(source).toContain("label: 'Control'");
    expect(source).toContain(
      '<span>${esc(card.label)}</span><strong>${esc(card.title)}</strong>',
    );
    expect(source).toContain('Channel health');
    expect(source).toContain('systemDecisionCards');
    expect(source).toContain('systemRuntimeBriefText');
    expect(source).toContain('NanoCrab runtime readiness brief');
    expect(source).toContain('Copy runtime brief');
    expect(source).toContain('copySystemRuntimeBrief');
    expect(source).toContain('System runtime brief copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("prompt('Copy system runtime brief:'");
    expect(source).toContain('window._systemRuntimeState');
    expect(source).toContain(
      'Use heap, RAM, load, and disk before starting heavy agent work.',
    );
    expect(source).toContain(
      'Channel state tells you whether chats and scheduled work can deliver.',
    );
    expect(source).toContain(
      'Open Logs before restarting so recent errors stay visible.',
    );
    expect(source).toContain(
      'Restart only after checking pressure, channels, and current work.',
    );
    expect(source).toContain(
      'Check heap, RAM, load, disk, channels, and logs before starting heavy Cowork, Code, MCP, or scheduled agent work',
    );
    expect(source).toContain(
      'Restart only after confirming no project chat, Code automation, report, or external-write workflow is mid-flight',
    );
    expect(source).toContain(
      'Route channel failures to Copilot or Cowork owners before relying on scheduled delivery',
    );
    expect(source).toContain('Restart readiness checklist');
    expect(source).toContain(
      'Preserve current Logs and Monitoring evidence before restarting or rebuilding runtime services.',
    );
    expect(source).toContain(
      'Confirm no Cowork project chat, Code automation, report export, approval, or external-write workflow is mid-flight.',
    );
    expect(source).toContain(
      'Check channels and scheduled delivery paths so a restart does not hide delivery failures.',
    );
    expect(source).toContain(
      'Prefer diagnosis in Logs, Monitoring, Containers, or Integrations when pressure is high but work is still active.',
    );
  });

  it('keeps system APIs and restart action wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/system')");
    expect(source).toContain("api('/system/health')");
    expect(source).toContain('restartService(this)');
    expect(source).toContain(
      "window._tabLoaderRegistry?.['mon-tabs']?.('system')",
    );
    expect(source).toContain('health.overall');
  });

  it('summarizes process, host, load, disk, and channel readiness', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('const systemStats = [');
    expect(source).toContain('const processRows = [');
    expect(source).toContain('const hostRows = [');
    expect(source).toContain('unhealthyChannels');
    expect(source).toContain('system-channel-row');
    expect(source).toContain('renderSystemChannelEmptyState');
    expect(source).toContain('system-channel-empty');
    expect(source).toContain('No channel health rows returned.');
    expect(source).toContain(
      'Channel adapters have not reported readiness yet.',
    );
    expect(source).toContain("navigate('channels')");
    expect(source).not.toContain(
      '<div class="empty compact-empty">No channel health rows returned.</div>',
    );
  });

  it('styles system state cards, profile panels, and mobile layout', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.system-command-center');
    expect(source).toContain('.system-state-strip');
    expect(source).toContain('.system-decision-map');
    expect(source).toContain('.system-decision-card');
    expect(source).toContain('.system-decision-card strong');
    expect(source).toContain('.system-workbench');
    expect(source).toContain('.system-info-row');
    expect(source).toContain('.system-channel-panel');
    expect(source).toContain('.system-channel-empty');
    expect(source).toContain('.system-channel-empty-actions');
    expect(source).toContain('.system-state-strip,');
    expect(source).toContain('.system-decision-map,');
    expect(source).toContain(
      '.system-workbench {\n    grid-template-columns: 1fr;',
    );
  });
});
