import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const swPath = path.join(process.cwd(), 'src/admin/public/sw.js');
const offlinePath = path.join(process.cwd(), 'src/admin/public/offline.html');

describe('Service worker offline fallback UI', () => {
  it('pre-caches and uses the offline page for navigation fallback', () => {
    const source = fs.readFileSync(swPath, 'utf8');

    expect(source).toContain("const OFFLINE_PAGE = '/offline.html'");
    expect(source).toContain('const PRECACHE_URLS = [');
    expect(source).toContain('cache.addAll(PRECACHE_URLS)');
    expect(source).toContain('caches.match(OFFLINE_PAGE)');
    expect(source).toContain("e.request.mode === 'navigate'");
  });

  it('keeps API and websocket traffic out of the service worker cache', () => {
    const source = fs.readFileSync(swPath, 'utf8');

    expect(source).toContain("e.request.url.includes('/api/')");
    expect(source).toContain("e.request.url.includes('ws')");
    expect(source).toContain("e.request.url.startsWith('chrome-extension')");
  });

  it('routes notification clicks only to known workspace resume targets', () => {
    const source = fs.readFileSync(swPath, 'utf8');

    expect(source).toContain("const CACHE_NAME = 'nanocrab-v8-rc6'");
    expect(source).toContain('const NOTIFICATION_TARGETS = new Set([');
    expect(source).toContain("'chat'");
    expect(source).toContain("'projects'");
    expect(source).toContain("'gitcode'");
    expect(source).toContain("'approvals'");
    expect(source).toContain("'monitoring'");
    expect(source).toContain("'logs'");
    expect(source).toContain("'tasks'");
    expect(source).toContain("'workflows'");
    expect(source).toContain("'reports'");
    expect(source).toContain("'audit'");
    expect(source).toContain("'integrations'");
    expect(source).toContain('function notificationTargetHash(data)');
    expect(source).toContain("String(data?.page || data?.target || '').trim()");
    expect(source).toContain(
      "requested.replace(/^#?\\//, '').split(/[?#]/)[0]",
    );
    expect(source).toContain(
      "normalized === 'mcp' || normalized === 'providers'",
    );
    expect(source).toContain("? 'integrations'");
    expect(source).toContain(": 'monitoring'");
    expect(source).toContain(
      'const targetHash = notificationTargetHash(e.notification.data || {})',
    );
    expect(source).toContain('client.navigate(targetHash)');
    expect(source).toContain('clients.openWindow(targetHash)');
    expect(source).not.toContain("client.navigate('/#/' + page)");
    expect(source).not.toContain("clients.openWindow('/#/' + page)");
  });

  it('ships an offline workspace recovery page', () => {
    const html = fs.readFileSync(offlinePath, 'utf8');

    expect(html).toContain('<title>NanoCrab offline</title>');
    expect(html).toContain('NanoCrab is offline');
    expect(html).toContain('Copilot');
    expect(html).toContain('Cowork');
    expect(html).toContain('Code');
    expect(html).toContain('Recovery checklist');
    expect(html).toContain('offline-work-plan');
    expect(html).toContain('Offline work plan');
    expect(html).toContain('Draft only');
    expect(html).toContain('Hold changes');
    expect(html).toContain('Reconcile');
    expect(html).toContain(
      'Write notes, outlines, and reply drafts in local files',
    );
    expect(html).toContain('repository pushes, and third-party writes');
    expect(html).toContain(
      'project history before resuming agents or scheduled work',
    );
    expect(html).toContain('resume-targets');
    expect(html).toContain('resume-target-grid');
    expect(html).toContain('When NanoCrab is reachable again');
    expect(html).toContain(
      'Resume from the surface that can prove the current state before handing work back to agents.',
    );
    expect(html).toContain('Monitoring</strong>');
    expect(html).toContain('Logs</strong>');
    expect(html).toContain('Cowork</strong>');
    expect(html).toContain('Reports</strong>');
    expect(html).toContain('Approvals</strong>');
    expect(html).toContain(
      'Confirm the runtime is fresh before restarting scheduled or long-running work.',
    );
    expect(html).toContain(
      'Check outage timing and failed actions before retrying channels or MCP tools.',
    );
    expect(html).toContain(
      'Attach offline notes to the project before asking agents to continue.',
    );
    expect(html).toContain(
      'Regenerate summaries or documents after source systems are reachable.',
    );
    expect(html).toContain(
      'Review pending external writes before sending, publishing, or updating systems.',
    );
    expect(html).toContain('copyOfflineBrief');
    expect(html).toContain('Copy outage brief');
    expect(html).toContain('copyOfflineProjectNote');
    expect(html).toContain('Copy project note');
    expect(html).toContain('NanoCrab offline recovery brief');
    expect(html).toContain('Offline Cowork project note');
    expect(html).toContain('copy-status');
    expect(html).toContain('manual-copy-panel');
    expect(html).toContain('showManualCopy');
    expect(html).toContain(
      'Clipboard access is unavailable. The outage brief is ready for manual copy.',
    );
    expect(html).toContain('Outage brief copied.');
    expect(html).toContain('Offline project note copied.');
    expect(html).toContain('Monitoring, Logs, and Approvals');
    expect(html).toContain(
      'Do not send email, publish documents, trigger webhooks, update calendars, or change third-party systems',
    );
    expect(html).toContain(
      'Hold changes: do not publish, push, send, or trigger third-party writes',
    );
    expect(html).toContain('Reconnect resume targets:');
    expect(html).toContain(
      'Monitoring: confirm the runtime is fresh before restarting scheduled or long-running work.',
    );
    expect(html).toContain(
      'Logs: check outage timing and failed actions before retrying channels or MCP tools.',
    );
    expect(html).toContain(
      'Cowork: attach offline notes to the project before asking agents to continue.',
    );
    expect(html).toContain(
      'Reports: regenerate summaries or documents after source systems are reachable.',
    );
    expect(html).toContain(
      'Approvals: review pending external writes before sending, publishing, or updating systems.',
    );
    expect(html).toContain('What changed while NanoCrab was offline:');
    expect(html).toContain('Drafted work:');
    expect(html).toContain('Decisions and open questions:');
    expect(html).toContain(
      'Attach this note to the Cowork project before asking agents to continue.',
    );
    expect(html).toContain(
      'Ask Cowork to reconcile this note with project files, recent chats, source systems, and pending approvals before resuming automation.',
    );
    expect(html).toContain('location.reload()');
    expect(html).not.toContain('window.prompt');
  });
});
