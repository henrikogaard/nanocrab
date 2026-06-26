import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Docker runtime operations UI', () => {
  it('frames Docker as the agent runtime operations surface', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Runtime operations');
    expect(source).toContain(
      'Watch the agent container fleet before work leaves the browser',
    );
    expect(source).toContain('docker-command-center');
    expect(source).toContain('docker-stats');
    expect(source).toContain('dockerStats');
    expect(source).toContain('docker-runtime-map');
    expect(source).toContain('dockerRuntimeLanes');
    expect(source).toContain('dockerDispatchGate');
    expect(source).toContain('renderDockerDispatchGate');
    expect(source).toContain('docker-dispatch-gate');
    expect(source).toContain('Dispatch gate');
    expect(source).toContain(
      'Check runtime readiness before agents leave the browser',
    );
    expect(source).toContain('dockerRuntimeBriefText');
    expect(source).toContain('_dockerRuntimeState');
    expect(source).toContain('copyDockerRuntimeBrief');
    expect(source).toContain('Copy runtime brief');
    expect(source).toContain('Docker runtime brief');
    expect(source).toContain(
      'Containers executing Copilot, Cowork, and Code agent work.',
    );
    expect(source).toContain(
      'Rebuild these when tools, skills, or provider homes change.',
    );
    expect(source).toContain(
      'Use custom containers for local APIs, renderers, and private tooling.',
    );
    expect(source).toContain(
      'Inspect stopped containers before assigning long-running work.',
    );
    expect(source).toContain(
      'Before starting expensive or long-running agent work, check stopped containers, missing images, rebuild needs, and sidecar dependencies.',
    );
  });

  it('preserves Docker data loading and rebuild/navigation hooks', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/docker/containers')");
    expect(source).toContain("api('/docker/images')");
    expect(source).toContain("api('/docker/rebuild'");
    expect(source).toContain('rebuildContainer');
    expect(source).toContain('docker-command-actions');
    expect(source).toContain("navigate('custom-containers')");
    expect(source).toContain("navigate('monitoring')");
  });

  it('uses runtime-aware failure copy for rebuilds', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const actions = source.slice(
      source.indexOf('function dockerActionErrorMessage'),
      source.indexOf('window.copyDockerRuntimeBrief'),
    );

    expect(actions).toContain('dockerActionErrorMessage');
    expect(actions).toContain('Container rebuild was not started.');
    expect(actions).toContain(
      'active Cowork or Code work depends on the current image',
    );
    expect(actions).toContain(
      "toast(dockerActionErrorMessage('rebuild', r), 'error')",
    );
    expect(actions).toContain(
      "toast(dockerActionErrorMessage('rebuild', err), 'error')",
    );
    expect(actions).not.toContain("toast(r.error || 'Failed', 'error')");
  });

  it('renders container and image cards with runtime state', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('runningContainers');
    expect(source).toContain('stoppedContainers');
    expect(source).toContain('docker-container-card');
    expect(source).toContain('docker-image-card');
    expect(source).toContain('docker-meta-grid');
    expect(source).toContain('No NanoCrab agent containers found');
    expect(source).toContain('No NanoCrab agent images found');
  });

  it('turns missing Docker runtime inventory into recovery actions', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderDockerEmptyState');
    expect(source).toContain('docker-empty-state');
    expect(source).toContain('docker-empty-flow');
    expect(source).toContain('docker-empty-actions');
    expect(source).toContain("primary: 'Rebuild image'");
    expect(source).toContain('Monitoring</button>');
    expect(source).toContain('Sidecars</button>');
    expect(source).toContain('Copy brief</button>');
    expect(source).toContain("renderDockerEmptyState('containers')");
    expect(source).toContain("renderDockerEmptyState('images')");
    expect(source).not.toContain(
      '\'<div class="empty">No NanoCrab agent containers found</div>\'',
    );
    expect(source).not.toContain(
      '\'<div class="empty">No NanoCrab agent images found</div>\'',
    );
    expect(style).toContain('.docker-empty-state');
    expect(style).toContain('.docker-empty-flow');
    expect(style).toContain('.docker-empty-actions');
  });

  it('surfaces runtime triage and next actions from current fleet state', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('runtimeTriage');
    expect(source).toContain('Runtime triage');
    expect(source).toContain('stopped container');
    expect(source).toContain('No runtime images available');
    expect(source).toContain('Runtime ready for agent work');
    expect(source).toContain('action: "navigate(\'monitoring\')"');
    expect(source).toContain('action: "navigate(\'custom-containers\')"');
    expect(source).toContain("action: 'rebuildContainer(this)'");
    expect(source).toContain('docker-triage-panel');
  });

  it('adds a dispatch gate before expensive agent work leaves the browser', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("label: 'Image'");
    expect(source).toContain('Confirm the runtime image exists');
    expect(source).toContain(
      'Rebuild before delegation when skills, provider homes, MCP tools, or container mounts changed',
    );
    expect(source).toContain("label: 'Fleet'");
    expect(source).toContain('Review stopped containers');
    expect(source).toContain(
      'Inspect stopped or unhealthy containers before starting long Copilot, Cowork, Code, or scheduled work',
    );
    expect(source).toContain("label: 'Sidecars'");
    expect(source).toContain('Check local service dependencies');
    expect(source).toContain(
      'Verify custom containers for local APIs, renderers, private tools, and MCP-adjacent services',
    );
    expect(source).toContain("label: 'Evidence'");
    expect(source).toContain('Keep logs close to the handoff');
    expect(source).toContain(
      'Open Monitoring or Logs before rebuilding so failures can become a clear runtime repair brief',
    );
    expect(source).toContain(
      'Use this before expensive Cowork MCP reads, Code automation, scheduled work, or anything that depends on sidecars and provider homes',
    );
    expect(source).toContain('Dispatch gate');
    expect(source).toContain('...dispatchLines');
  });

  it('styles Docker cockpit, cards, and responsive layout', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.docker-command-center');
    expect(source).toContain('.docker-stats');
    expect(source).toContain('.docker-runtime-map');
    expect(source).toContain('.docker-runtime-card');
    expect(source).toContain('.docker-triage-panel');
    expect(source).toContain('.docker-triage-panel.is-warning');
    expect(source).toContain('.docker-triage-panel.is-ready');
    expect(source).toContain('.docker-dispatch-gate');
    expect(source).toContain('.docker-dispatch-head');
    expect(source).toContain('.docker-dispatch-grid');
    expect(source).toContain('.docker-dispatch-card');
    expect(source).toContain('.docker-container-card.running');
    expect(source).toContain('.docker-container-card.stopped');
    expect(source).toContain('.docker-image-card');
    expect(source).toContain('.docker-meta-grid code');
    expect(source).toContain('.docker-empty-state');
    expect(source).toContain('.docker-empty-actions');
    expect(source).toContain('.docker-stats,');
    expect(source).toContain('.docker-runtime-map,');
    expect(source).toContain('.docker-dispatch-grid,');
    expect(source).toContain('.docker-card-grid,');
  });
});
