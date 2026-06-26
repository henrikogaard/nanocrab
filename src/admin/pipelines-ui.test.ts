import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');
const mockPath = path.join(process.cwd(), 'src/admin/mock-data.ts');

describe('Deploy pipelines release cockpit UI', () => {
  it('frames deploy pipelines as a release cockpit', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Release cockpit');
    expect(source).toContain('Deploy Pipelines');
    expect(source).toContain('pipelines-command-center');
    expect(source).toContain('pipelines-command-stats');
    expect(source).toContain('pipeline-release-map');
    expect(source).toContain('pipeline-promotion-gate');
    expect(source).toContain('pipeline-release-grid');
    expect(source).toContain('pipeline-release-card');
    expect(source).toContain('Setup path');
    expect(source).toContain('releaseLaneCards');
    expect(source).toContain('pipelineReleaseBriefText');
    expect(source).toContain('NanoCrab release pipeline brief');
    expect(source).toContain('Copy release brief');
    expect(source).toContain('copyPipelineReleaseBrief');
    expect(source).toContain('Pipeline release brief copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).toContain('Data health');
    expect(source).toContain(
      'Pipeline inventory and repository data loaded without known fallback.',
    );
    expect(source).toContain('Pipeline inventory unavailable');
    expect(source).toContain('Repository inventory unavailable');
    expect(source).toContain('Pipeline and repo data loaded');
    expect(source).toContain('loadIssues');
    expect(source).toContain(
      "pipeline-stat ${loadIssues.length ? 'is-warning' : ''}",
    );
    expect(source).not.toContain("prompt('Copy pipeline release brief:'");
    expect(source).toContain('window._pipelineReleaseState');
    expect(source).toContain(
      'Run focused checks before handoff or deploy work leaves Code.',
    );
    expect(source).toContain(
      'Keep build and documentation commands attached to each repository.',
    );
    expect(source).toContain(
      'Turn repeated release commands into named, reviewable pipelines.',
    );
    expect(source).toContain(
      'Use saved output and monitoring links to decide the next action.',
    );
    expect(source).toContain('pipelinePromotionChecklist');
    expect(source).toContain('renderPipelinePromotionGate');
    expect(source).toContain('Promotion gate');
    expect(source).toContain(
      'Save a pipeline only after the release path is repeatable',
    );
    expect(source).toContain('one-off terminal sequence into automation');
    expect(source).toContain(
      'preserve context, evidence, and ownership when something fails',
    );
    expect(source).toContain(
      'Keep release evidence with the related issue, PR, Cowork artifact, or approval',
    );
    expect(source).toContain(
      'Use System Info, Logs, Uptime, and provider health before running broad release automation',
    );
    expect(source).toContain(
      'Turn repeated manual release commands into named pipelines only after the steps are stable',
    );
  });

  it('keeps create, run, and delete wiring intact', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/dev/deploy')");
    expect(source).toContain(
      "loadIssues.push('Pipeline inventory unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Repository inventory unavailable')",
    );
    expect(source).toContain('id="new-pipeline-form"');
    expect(source).toContain(
      'class="pipeline-form-panel is-hidden" id="new-pipeline-form"',
    );
    expect(source).toContain('id="pipeline-create-form"');
    expect(source).toContain('id="pipeline-name"');
    expect(source).toContain('id="pipeline-repo"');
    expect(source).toContain('id="pipeline-steps-list"');
    expect(source).toContain('addPipelineStep');
    expect(source).toContain('togglePipelineForm');
    expect(source).toContain('runPipeline');
    expect(source).toContain('deletePipeline');
    expect(source).not.toContain('id="new-pipeline-form" style="display:none"');
  });

  it('uses release-oriented pipeline action errors', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const pipelineBlock = source.slice(
      source.indexOf('// --- Deploy Pipelines ---'),
      source.indexOf('// --- Review Rules ---'),
    );

    expect(pipelineBlock).toContain('function pipelineActionErrorMessage');
    expect(pipelineBlock).toContain(
      'Pipeline was not created. Check the repository, step names, commands, and whether this release path is stable enough to automate.',
    );
    expect(pipelineBlock).toContain(
      'Pipeline run failed. Preserve the output, check Logs, Uptime, and repository state before retrying or continuing release work.',
    );
    expect(pipelineBlock).toContain(
      'Pipeline was not deleted. Check whether its latest output is still needed for a PR, Cowork artifact, approval, or release packet.',
    );
    expect(pipelineBlock).toContain(
      "toast(pipelineActionErrorMessage('create', r), 'error')",
    );
    expect(pipelineBlock).toContain(
      "toast(pipelineActionErrorMessage('create', err), 'error')",
    );
    expect(pipelineBlock).toContain(
      "toast(pipelineActionErrorMessage('run', r), 'error')",
    );
    expect(pipelineBlock).toContain(
      "toast(pipelineActionErrorMessage('run', err), 'error')",
    );
    expect(pipelineBlock).toContain(
      "toast(pipelineActionErrorMessage('delete', r), 'error')",
    );
    expect(pipelineBlock).toContain(
      "toast(pipelineActionErrorMessage('delete', err), 'error')",
    );
    expect(pipelineBlock).not.toContain("toast(r.error || 'Failed', 'error')");
    expect(pipelineBlock).not.toContain(
      "toast(r.error || 'Pipeline failed', 'error')",
    );
    expect(pipelineBlock).not.toContain("toast('Pipeline failed', 'error')");
    expect(pipelineBlock).not.toContain(
      "toast('Failed to create pipeline', 'error')",
    );
    expect(pipelineBlock).not.toContain(
      "toast('Failed to delete pipeline', 'error')",
    );
  });

  it('offers release templates that prefill pipeline steps', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('pipelineTemplates');
    expect(source).toContain('Start from a release pattern');
    expect(source).toContain('Verify before handoff');
    expect(source).toContain('Build and deploy');
    expect(source).toContain('Docs release packet');
    expect(source).toContain('applyPipelineTemplate');
    expect(source).toContain('npm run typecheck');
    expect(source).toContain('git diff --check');
    expect(source).toContain("form?.classList.remove('is-hidden')");
    expect(source).toContain('form.scrollIntoView');
  });

  it('promotes only repeatable command paths into saved automation', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("title: 'Stable command path'");
    expect(source).toContain(
      'Run the commands manually at least once and keep the exact repo, branch, and environment visible',
    );
    expect(source).toContain("title: 'Evidence destination'");
    expect(source).toContain(
      'Decide where output belongs: PR note, Cowork artifact, approval record, report, or release packet',
    );
    expect(source).toContain("title: 'Failure owner'");
    expect(source).toContain(
      'Name who reviews failed output before retries, deploys, or external writes continue',
    );
    expect(source).toContain("title: 'Budget and runtime guard'");
    expect(source).toContain(
      'Check Usage, System Info, Logs, and Uptime before turning long checks into repeated automation',
    );
    expect(source).toContain('promotionLines');
    expect(source).toContain(
      'pipelinePromotionChecklist()\n    .map((item) => `- ${item.title}: ${item.detail}`)',
    );
    expect(source).toContain('renderPipelinePromotionGate()');
  });

  it('turns an empty release grid into a first-pipeline setup path', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderPipelineEmptyState');
    expect(source).toContain('pipeline-release-empty-state');
    expect(source).toContain('First pipeline');
    expect(source).toContain('No pipelines configured');
    expect(source).toContain('Create a small verification pipeline first');
    expect(source).toContain('Start with verification');
    expect(source).toContain('Attach a repository');
    expect(source).toContain('Keep evidence portable');
    expect(source).toContain('applyPipelineTemplate(0)');
    expect(source).toContain('copyPipelineReleaseBrief()');
    expect(source).not.toContain(
      '\'<div class="pipeline-release-card empty">No pipelines configured. Create one to automate deployments.</div>\'',
    );
    expect(style).toContain('.pipeline-release-empty-state');
    expect(style).toContain('.pipeline-empty-flow');
    expect(style).toContain('.pipeline-empty-flow article button');
    expect(style).toContain('.pipeline-empty-actions');
    expect(style).toContain('.pipeline-empty-flow,');
  });

  it('uses class-based pipeline form rows and release cards', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const pipelineBlock = source.slice(
      source.indexOf('// --- Deploy Pipelines ---'),
      source.indexOf('// --- Review Rules ---'),
    );

    expect(pipelineBlock).toContain('pipeline-step-name-field');
    expect(pipelineBlock).toContain('pipeline-step-command-field');
    expect(pipelineBlock).toContain('pipeline-step-input');
    expect(pipelineBlock).toContain('pipeline-step-controls');
    expect(pipelineBlock).toContain('pipeline-form-actions');
    expect(pipelineBlock).toContain('pipeline-release-head');
    expect(pipelineBlock).toContain('pipeline-release-actions');
    expect(pipelineBlock).toContain('renderPipelineEmptyState()');
    expect(pipelineBlock).toContain('pipeline-step-name-label');
    expect(pipelineBlock).toContain('pipeline-output');
    expect(pipelineBlock).not.toContain(
      'style="display:flex;gap:8px;margin-bottom:8px;align-items:end"',
    );
    expect(pipelineBlock).not.toContain('style="margin:0;flex:0 0 200px"');
    expect(pipelineBlock).not.toContain(
      'style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px"',
    );
    expect(pipelineBlock).not.toContain(
      'style="font-weight:500;color:var(--text)"',
    );
    expect(style).toContain('.pipeline-step-row');
    expect(style).toContain('.pipeline-step-name-field');
    expect(style).toContain('.pipeline-step-command-field');
    expect(style).toContain('.pipeline-step-name-label');
    expect(style).toContain('.pipeline-output');
  });

  it('uses class-based pipeline run output panels', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const runBlock = source.slice(
      source.indexOf('window.runPipeline'),
      source.indexOf('window.deletePipeline'),
    );

    expect(runBlock).toContain('pipeline-run-log');
    expect(runBlock).toContain('pipeline-run-result');
    expect(runBlock).toContain('renderPipelineRunLoadingState(id)');
    expect(source).toContain('pipeline-run-loading-state');
    expect(source).toContain('Running release steps');
    expect(source).toContain(
      'Executing the saved commands and collecting step output for release evidence.',
    );
    expect(runBlock).not.toContain(
      'outputEl.innerHTML = \'<div class="loading">Running pipeline</div>\'',
    );
    expect(runBlock).not.toContain(
      'class="log-viewer" style="max-height:240px"',
    );
    expect(runBlock).not.toContain('style="margin-bottom:10px"');
    expect(runBlock).not.toContain(
      'style="white-space:pre-wrap;margin-top:4px"',
    );
    expect(style).toContain('.pipeline-run-log');
    expect(style).toContain('max-height: 240px');
    expect(style).toContain('.pipeline-run-result');
    expect(style).toContain('.pipeline-run-loading-state');
    expect(style).toContain('.pipeline-run-loading-steps');
    expect(style).toContain('@keyframes pipelineRunLoading');
    expect(style).toContain('white-space: pre-wrap');
  });

  it('styles the release cockpit responsively', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.pipelines-command-center');
    expect(source).toContain('.pipelines-command-stats');
    expect(source).toContain('.pipeline-stat.is-warning');
    expect(source).toContain('.pipeline-stat.is-warning strong');
    expect(source).toContain('.pipeline-release-map');
    expect(source).toContain('.pipeline-release-map-card');
    expect(source).toContain('.pipeline-template-strip');
    expect(source).toContain('.pipeline-template-head');
    expect(source).toContain('.pipeline-template-grid');
    expect(source).toContain('.pipeline-template-card:focus-visible');
    expect(source).toContain('.pipeline-promotion-gate');
    expect(source).toContain('.pipeline-promotion-head');
    expect(source).toContain('.pipeline-promotion-grid');
    expect(source).toContain('.pipeline-promotion-card');
    expect(source).toContain('.pipeline-form-panel.is-hidden');
    expect(source).toContain('.pipeline-release-empty-state');
    expect(source).toContain('.pipeline-empty-flow');
    expect(source).toContain('.pipeline-release-card');
    expect(source).toContain('.pipeline-step-command');
    expect(source).toContain('.pipeline-template-grid,');
    expect(source).toContain('.pipeline-promotion-grid,');
    expect(source).toContain('.pipeline-release-map,');
    expect(source).toContain(
      '.pipeline-template-copy,\n  .pipeline-template-head,\n  .pipeline-promotion-head,',
    );
    expect(source).toContain('.pipelines-command-stats {');
  });

  it('serves deploy sample data at the route used by the page', () => {
    const source = fs.readFileSync(mockPath, 'utf8');

    expect(source).toContain("pathname === '/dev/deploy'");
    expect(source).toContain('lastStatus');
    expect(source).toContain("command: 'npm run build'");
  });
});
