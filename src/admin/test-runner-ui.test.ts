import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');
const mockPath = path.join(process.cwd(), 'src/admin/mock-data.ts');

describe('Test Runner verification cockpit UI', () => {
  it('frames tests as verification evidence for agent work', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Verification cockpit');
    expect(source).toContain('Test Runner');
    expect(source).toContain('testrunner-command-center');
    expect(source).toContain('testrunner-stats');
    expect(source).toContain('testrunner-work-grid');
    expect(source).toContain('Current run');
    expect(source).toContain('Last saved result');
    expect(source).toContain('testRunnerBriefText');
    expect(source).toContain('testRunnerFailureTriagePromptText');
    expect(source).toContain('verificationProofLadder');
    expect(source).toContain('_testRunnerState');
    expect(source).toContain('copyTestRunnerBrief');
    expect(source).toContain('copyTestRunnerTriagePrompt');
    expect(source).toContain('Copy evidence brief');
    expect(source).toContain('Copy triage prompt');
    expect(source).toContain('Verification evidence brief');
    expect(source).toContain('Data health');
    expect(source).toContain(
      'Repository inventory and saved verification results loaded without known fallback.',
    );
    expect(source).toContain('Repository inventory unavailable');
    expect(source).toContain('Saved verification results unavailable');
    expect(source).toContain('Repository inventory loaded');
    expect(source).toContain('loadIssues');
    expect(source).toContain(
      "testrunner-stat ${loadIssues.length ? 'is-warning' : ''}",
    );
    expect(source).toContain(
      'Triage failed or missing NanoCrab verification evidence.',
    );
    expect(source).toContain(
      'Use this brief when handing code work to an agent or reviewer.',
    );
    expect(source).toContain('Proof ladder');
    expect(source).toContain(
      'Choose the smallest evidence that makes the handoff honest',
    );
    expect(source).toContain(
      'Start narrow, broaden when shared behavior changes, and make missing proof explicit instead of implied.',
    );
    expect(source).toContain('Narrow proof');
    expect(source).toContain('Contract proof');
    expect(source).toContain('Integration proof');
    expect(source).toContain('Missing proof');
    expect(source).toContain(
      'Run the smallest test or command that proves the changed behavior.',
    );
    expect(source).toContain(
      'Run typecheck, lint, or API checks when shared contracts changed.',
    );
    expect(source).toContain(
      'Run build or broader suites when shared UI, routing, runtime, or release paths changed.',
    );
    expect(source).toContain(
      'Record exactly what could not run and what evidence would close the gap.',
    );
    expect(source).toContain(
      'Do not rerun broad suites first; isolate the smallest failing proof, then broaden only after the narrow cause is understood.',
    );
    expect(source).toContain(
      'Classify the issue as implementation bug, test expectation drift, environment or dependency issue, missing repository mount, or skipped verification.',
    );
    expect(source).toContain(
      'Return likely cause, smallest next command, files or areas to inspect, destination workspace, and residual risk.',
    );
    expect(source).toContain(
      'If no output is available, ask for the exact command, working directory, repository, changed behavior, and last failure text.',
    );
    expect(source).toContain('Output tail');
    expect(source).toContain('Verification triage prompt copied');
    expect(source).toContain('Copy verification triage prompt');
    expect(source).not.toContain("prompt('Copy verification triage prompt:'");
  });

  it('keeps repository selection, run action, and result loading wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/files/repos')");
    expect(source).toContain('id="testrunner-repo"');
    expect(source).toContain('id="testrunner-run-btn"');
    expect(source).toContain('runTests');
    expect(source).toContain('function renderTestRunnerLoadingState');
    expect(source).toContain('Loading saved verification evidence');
    expect(source).toContain(
      'lastEl.innerHTML = renderTestRunnerLoadingState(repo)',
    );
    expect(source).toContain('`/dev/test/${encodeURIComponent(repo)}/run`');
    expect(source).toContain('`/dev/test/${encodeURIComponent(repo)}/results`');
    expect(source).toContain('testrunner-evidence-state');
  });

  it('shows a proof bundle for agent work verification', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('verificationRecipes');
    expect(source).toContain('Proof bundle');
    expect(source).toContain('Focused test');
    expect(source).toContain('npm test -- <path-or-pattern>');
    expect(source).toContain('npm run typecheck');
    expect(source).toContain('npm run build');
    expect(source).toContain('git diff --check');
    expect(source).toContain('copyVerificationCommand');
    expect(source).toContain('Verification command copied');
    expect(source).toContain('Copy verification command');
    expect(source).not.toContain('navigator.clipboard?.writeText(command)');
    expect(source).toContain(
      'For Cowork or Code tasks, require focused tests for changed behavior, typecheck for contracts, build for integration, and git diff checks before marking the work ready.',
    );
    expect(source).toContain(
      'If a result is missing, ask the agent to run the narrowest relevant check first',
    );
  });

  it('turns missing test results into evidence starter actions', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('function renderTestRunnerEmptyState');
    expect(source).toContain('No verification evidence yet');
    expect(source).toContain('No saved result for this repository');
    expect(source).toContain('Saved results are unavailable');
    expect(source).toContain('No repositories mounted for verification');
    expect(source).toContain('Mount a repository before running tests.');
    expect(source).toContain('testrunner-empty-state');
    expect(source).toContain('testrunner-empty-flow');
    expect(source).toContain('testrunner-empty-actions');
    expect(source).toContain('Run tests</button>');
    expect(source).toContain('Open Mounts</button>');
    expect(source).toContain("navigate('mounts')");
    expect(source).toContain("navigate('devhub')");
    expect(source).toContain('Copy brief</button>');
    expect(source).toContain('Copy triage prompt</button>');
    expect(source).toContain("navigate('gitcode')");
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("renderTestRunnerEmptyState('repo')");
    expect(source).toContain("renderTestRunnerEmptyState('unavailable')");
    expect(source).toContain(
      "renderTestRunnerEmptyState(repos.length ? 'initial' : 'noRepos')",
    );
    expect(source).toContain('Mount a repository first');
    expect(source).toContain(
      'id="testrunner-run-btn" onclick="runTests()" ${repos.length ? \'\' : \'disabled\'}',
    );
  });

  it('uses class-based saved result metadata', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const resultsBlock = source.slice(
      source.indexOf('async function loadTestResults'),
      source.indexOf('window.runTests'),
    );

    expect(resultsBlock).toContain('testrunner-result-meta');
    expect(resultsBlock).toContain(
      "issue !== 'Saved verification results unavailable'",
    );
    expect(resultsBlock).toContain(
      "issues.add('Saved verification results unavailable')",
    );
    expect(resultsBlock).not.toContain(
      'span style="font-size:12px;color:var(--text-muted)"',
    );
    expect(style).toContain('.testrunner-result-meta');
    expect(style).toContain('color: var(--text-muted)');
    expect(style).toContain('font-size: 12px');
  });

  it('styles result states and mobile layout', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.testrunner-command-center');
    expect(source).toContain('.testrunner-result-card.passed');
    expect(source).toContain('.testrunner-result-card.failed');
    expect(source).toContain('.testrunner-running');
    expect(source).toContain('.testrunner-stat.is-warning');
    expect(source).toContain('.testrunner-stat.is-warning strong');
    expect(source).toContain('.testrunner-loading-state');
    expect(source).toContain('.testrunner-loading-flow');
    expect(source).toContain('.testrunner-proof-ladder');
    expect(source).toContain('.testrunner-proof-grid');
    expect(source).toContain('.testrunner-proof-card');
    expect(source).toContain('.testrunner-recipe-panel');
    expect(source).toContain('.testrunner-recipe-grid');
    expect(source).toContain('.testrunner-recipe-card');
    expect(source).toContain('.testrunner-empty-state');
    expect(source).toContain('.testrunner-empty-flow');
    expect(source).toContain('.testrunner-empty-actions');
    expect(source).toContain('.testrunner-stats,\n  .testrunner-work-grid');
    expect(source).toContain('.testrunner-recipe-grid,');
    expect(source).toContain('.testrunner-proof-grid,');
    expect(source).toContain('.testrunner-loading-flow,');
  });

  it('serves mock run and result payloads in the result shape used by the page', () => {
    const source = fs.readFileSync(mockPath, 'utf8');

    expect(source).toContain('/^\\/dev\\/test\\/[^/]+\\/results$/');
    expect(source).toContain('/^\\/dev\\/test\\/[^/]+\\/run$/');
    expect(source).toContain('passed: true');
    expect(source).toContain('duration: 3170');
  });
});
