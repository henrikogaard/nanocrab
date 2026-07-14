import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const pagePath = path.join(
  process.cwd(),
  'src/admin/public/pages/control-plane.js',
);
const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const indexHtmlPath = path.join(process.cwd(), 'src/admin/public/index.html');
const modesPath = path.join(process.cwd(), 'src/admin/public/modes.js');
const navPath = path.join(
  process.cwd(),
  'src/admin/public/ui/shell-navigation.js',
);
const mockDataPath = path.join(process.cwd(), 'src/admin/mock-data.ts');

describe('Control Plane UI', () => {
  it('control-plane page exists and exports a render function', () => {
    const source = fs.readFileSync(pagePath, 'utf8');
    expect(source).toContain('function renderControlPlane');
    expect(source).toContain('window.renderControlPlane = renderControlPlane');
  });

  it('loads all six control-plane API endpoints', () => {
    const source = fs.readFileSync(pagePath, 'utf8');
    expect(source).toContain("api('/control-plane/overview')");
    expect(source).toContain("api('/control-plane/runtimes')");
    expect(source).toContain("api('/control-plane/pipelines')");
    expect(source).toContain("api('/control-plane/runs')");
    expect(source).toContain("api('/control-plane/decisions')");
  });

  it('renders the six required sections', () => {
    const source = fs.readFileSync(pagePath, 'utf8');
    expect(source).toContain('control-plane-overview');
    expect(source).toContain('control-plane-agents');
    expect(source).toContain('control-plane-pipelines');
    expect(source).toContain('control-plane-runs');
    expect(source).toContain('control-plane-decisions');
    expect(source).toContain('control-plane-settings');
  });

  it('keeps board cards class-driven and card-based', () => {
    const source = fs.readFileSync(pagePath, 'utf8');
    expect(source).toContain('control-plane-board-card');
    expect(source).toContain('board-card-stage');
    expect(source).toContain('board-card-agent');
    expect(source).toContain('board-card-runtime');
    expect(source).toContain('board-card-run');
    expect(source).toContain('board-card-decision');
    expect(source).not.toContain('control-plane-board-card" style=');
    expect(source).not.toContain('display:flex;justify-content:space-between');
  });

  it('uses class-driven stat, pipeline, agent, run, and decision cards', () => {
    const source = fs.readFileSync(pagePath, 'utf8');
    expect(source).toContain('control-plane-stat');
    expect(source).toContain('control-plane-pipeline-card');
    expect(source).toContain('control-plane-agent-card');
    expect(source).toContain('control-plane-run-card');
    expect(source).toContain('control-plane-decision-card');
    expect(source).toContain('control-plane-runtime-row');
  });

  it('renders coding-runner readiness instead of host-only CLI health', () => {
    const source = fs.readFileSync(pagePath, 'utf8');
    expect(source).toContain('runtime.codingReadiness || runtime.health');
  });

  it('wires page routing and navigation', () => {
    const app = fs.readFileSync(appPath, 'utf8');
    expect(app).toContain('renderControlPlane');
    expect(app).toContain('control-plane');
    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    expect(html).toContain('pages/control-plane.js');
    const modes = fs.readFileSync(modesPath, 'utf8');
    expect(modes).toContain("'control-plane'");
    const nav = fs.readFileSync(navPath, 'utf8');
    expect(nav).toContain('control-plane');
    expect(nav).toContain('Control Plane');
  });

  it('has mock data for the control-plane API', () => {
    const mock = fs.readFileSync(mockDataPath, 'utf8');
    expect(mock).toContain("'/control-plane/overview'");
    expect(mock).toContain("'/control-plane/pipelines'");
    expect(mock).toContain("'/control-plane/runs'");
    expect(mock).toContain("'/control-plane/decisions'");
    expect(mock).toContain("'/control-plane/runtimes'");
  });
});
