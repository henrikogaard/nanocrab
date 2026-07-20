import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Developer Hub engineering cockpit UI', () => {
  it('frames Dev Hub as an engineering cockpit', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Engineering cockpit');
    expect(source).toContain('Move from repository context to action');
    expect(source).toContain('devhub-command-center');
    expect(source).toContain('devhub-stats');
    expect(source).toContain('devhub-lane-map');
    expect(source).toContain('devhub-workbench');
    expect(source).toContain('devStats');
    expect(source).toContain('engineeringLanes');
    expect(source).toContain('devHubEngineeringBriefText');
    expect(source).toContain('_devHubEngineeringState');
    expect(source).toContain('copyDevHubEngineeringBrief');
    expect(source).toContain('Copy engineering brief');
    expect(source).toContain('Dev Hub engineering brief');
    expect(source).toContain('Data health');
    expect(source).toContain(
      'Repository and developer guide data loaded without known fallback.',
    );
    expect(source).toContain('Repos and guide loaded');
    expect(source).toContain('Repository inventory unavailable');
    expect(source).toContain('Developer guide unavailable');
    expect(source).toContain('loadIssues');
    expect(source).toContain(
      "devhub-stat ${loadIssues.length ? 'is-warning' : ''}",
    );
    expect(source).toContain('Code workspace');
    expect(source).toContain('Test loop');
    expect(source).toContain('Runtime');
    expect(source).toContain('Release path');
    expect(source).toContain(
      'Use this brief to decide where code work should go next: Code for edits, Git Ops for repository decisions, Test Runner for proof, Runtime for containers/providers/MCP, and Release path for deployable routines.',
    );
    expect(source).toContain(
      'If any repository is dirty, review Git Ops before pulling, pushing, deploying, or assigning more automation.',
    );
  });

  it('keeps repo actions and developer navigation wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/files/repos')");
    expect(source).toContain("api('/dev/guide')");
    expect(source).toContain('devHubRunTests');
    expect(source).toContain('devHubPull');
    expect(source).toContain("navigate('gitcode')");
    expect(source).toContain("navigate('containers')");
    expect(source).toContain("navigate('monitoring')");
    expect(source).toContain("navigate('pipelines')");
    expect(source).toContain("navigate('integrations')");
  });

  it('uses engineering recovery copy for test and pull failures', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const actions = source.slice(
      source.indexOf('function devHubActionErrorMessage'),
      source.indexOf('// --- Git Ops ---'),
    );

    expect(actions).toContain('devHubActionErrorMessage');
    expect(actions).toContain('Tests were not started.');
    expect(actions).toContain('Repository pull did not complete.');
    expect(actions).toContain(
      'repository mount, package scripts, runtime containers',
    );
    expect(actions).toContain(
      'Git Ops, dirty files, branch context, and active Code tasks',
    );
    expect(actions).toContain(
      "toast(devHubActionErrorMessage('test', r), 'error')",
    );
    expect(actions).toContain(
      "toast(devHubActionErrorMessage('test', err), 'error')",
    );
    expect(actions).toContain(
      "toast(devHubActionErrorMessage('pull', r), 'error')",
    );
    expect(actions).toContain(
      "toast(devHubActionErrorMessage('pull', err), 'error')",
    );
    expect(actions).not.toContain(
      "toast(r.error || 'Failed to start tests', 'error')",
    );
    expect(actions).not.toContain("toast('Failed to start tests', 'error')");
    expect(actions).not.toContain("toast(r.error || 'Pull failed', 'error')");
    expect(actions).not.toContain("toast('Pull failed', 'error')");
  });

  it('surfaces repo readiness and local guide content', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('dirtyRepos');
    expect(source).toContain('cleanRepos');
    expect(source).toContain('branchCount');
    expect(source).toContain('devhub-repo-card');
    expect(source).toContain('devhub-guide-item');
    expect(source).toContain('renderDevHubEmptyState');
    expect(source).toContain('Repository setup');
    expect(source).toContain('No repositories mounted yet.');
    expect(source).toContain(
      'Mount a workspace repository before using Code, Git Ops, Test Runner, or release automation.',
    );
    expect(source).toContain('No developer guide sections configured.');
    expect(source).toContain(
      'Add local engineering notes so future Code, Git Ops, and release work starts with shared context.',
    );
    expect(source).not.toContain('devhub-repo-card clean empty');
    expect(source).not.toContain('devhub-guide-item empty');
  });

  it('uses class-based mounted repository cards and empty-state navigation', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const devhubSource = source.slice(
      source.indexOf('async function renderDevHub(el)'),
      source.indexOf('window.copyDevHubEngineeringBrief'),
    );

    expect(source).toContain('devhub-repo-card-head');
    expect(source).toContain('devhub-repo-card-main');
    expect(source).toContain('devhub-repo-card-actions');
    expect(source).toContain("navigate('mounts')");
    expect(devhubSource).not.toContain(
      'style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px"',
    );
    expect(devhubSource).not.toContain(
      'style="font-size:16px;font-weight:600;color:var(--text)"',
    );
    expect(devhubSource).not.toContain(
      'style="display:flex;gap:6px;margin-top:8px"',
    );
    expect(devhubSource).not.toContain(
      'style="color:var(--accent);cursor:pointer"',
    );
  });

  it('styles Dev Hub cards and responsive layout', () => {
    const source = fs.readFileSync(stylePath, 'utf8');
    const laneStyles = source.slice(
      source.indexOf('.devhub-lane-card {'),
      source.indexOf('.devhub-stat span {'),
    );
    const responsiveLaneStyles = source.slice(
      source.indexOf('.devhub-lane-card {'),
    );

    expect(source).toContain('.devhub-command-center');
    expect(source).toContain('.devhub-stats');
    expect(source).toContain('.devhub-lane-map');
    expect(source).toContain('.devhub-lane-card');
    expect(laneStyles).toContain('color: var(--text);');
    expect(laneStyles).toContain('font: inherit;');
    expect(laneStyles).toContain('.devhub-lane-card strong');
    expect(laneStyles).toContain('.devhub-lane-card:focus-visible');
    expect(source).toContain('.devhub-workbench');
    expect(source).toContain('.devhub-repo-card.clean');
    expect(source).toContain('.devhub-repo-card.dirty');
    expect(source).toContain('.devhub-stat.is-warning');
    expect(source).toContain('.devhub-stat.is-warning strong');
    expect(source).toContain('.devhub-repo-card-head');
    expect(source).toContain('.devhub-repo-card-main');
    expect(source).toContain('.devhub-repo-card-actions');
    expect(source).toContain('.devhub-empty-state strong');
    expect(source).toContain('.devhub-empty-actions');
    expect(source).toContain('.devhub-guide-item summary');
    expect(source).toContain('.devhub-stats,');
    expect(source).toContain('.devhub-lane-map,');
    expect(source).toContain('.devhub-workbench,');
    expect(responsiveLaneStyles).toMatch(
      /@media \(max-width: 768px\)[\s\S]*?\.devhub-lane-map\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
    );
  });
});
