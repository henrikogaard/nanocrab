import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Git Ops repository state cockpit UI', () => {
  it('frames Git Ops around repository state and review flow', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Repository state');
    expect(source).toContain('gitops-command-center');
    expect(source).toContain('gitops-state-strip');
    expect(source).toContain('gitops-decision-brief');
    expect(source).toContain('Repository decision');
    expect(source).toContain('gitops-workbench');
    expect(source).toContain('Diff review');
    expect(source).toContain('Commit selected');
    expect(source).toContain('gitOpsBriefText');
    expect(source).toContain('gitOpsHandoffRunway');
    expect(source).toContain('_gitOpsState');
    expect(source).toContain('copyGitOpsBrief');
    expect(source).toContain('Copy repo brief');
    expect(source).toContain('Git Ops repository brief');
    expect(source).toContain('Data health');
    expect(source).toContain(
      'Repository list, Git status, and diff loaded without known fallback.',
    );
    expect(source).toContain('Repository inventory unavailable');
    expect(source).toContain('Git status unavailable');
    expect(source).toContain('Repository diff unavailable');
    expect(source).toContain('Git status and diff loaded');
    expect(source).toContain('gitops-data-health');
    expect(source).toContain(
      "gitops-state-card ${loadIssues.length ? 'is-warning' : 'is-clean'}",
    );
    expect(source).toContain('renderGitOpsNoReposState');
    expect(source).toContain('renderGitOpsLoadErrorState');
    expect(source).toContain('renderGitOpsLoadingState');
    expect(source).toContain('gitOpsJsStringAttr');
    expect(source).toContain('Mount a repository before reviewing Code work.');
    expect(source).toContain('Open Mounts');
    expect(source).toContain("navigate('devhub')");
    expect(source).toContain('We could not read repository state.');
    expect(source).toContain('Check mount access, Git availability, and logs');
    expect(source).not.toContain(
      '<div class="page-header"><h2>Git Ops</h2></div><div class="card empty">No repositories mounted.</div>',
    );
    expect(source).not.toContain(
      '<div class="card empty">Failed to load git data</div>',
    );
    expect(source).toContain(
      'Review the diff, keep unrelated files out of the commit, run the focused Test Runner proof, then write a commit message that names the user-visible behavior change.',
    );
    expect(source).toContain(
      'If the tree is dirty, do not pull, push, deploy, or start new automation until the changed files are understood.',
    );
    expect(source).toContain('Handoff runway');
    expect(source).toContain(
      'Move from local edits to reviewed repository work',
    );
    expect(source).toContain(
      'Use this path before commit, push, PR, or another coding-agent handoff.',
    );
    expect(source).toContain('Review diff');
    expect(source).toContain('Run proof');
    expect(source).toContain('Commit intent');
    expect(source).toContain('Sync safely');
    expect(source).toContain(
      'Understand every changed file before syncing, committing, pushing, or starting more automation.',
    );
    expect(source).toContain(
      'Use Test Runner for the smallest verification that proves the changed behavior.',
    );
    expect(source).toContain(
      'Select only related files and write a message that names the user-visible behavior change.',
    );
    expect(source).toContain(
      'Pull, push, or open PR work only after dirty-tree risk and verification gaps are resolved.',
    );
  });

  it('keeps repository loading and git actions wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/files/repos')");
    expect(source).toContain('id="gitops-repo"');
    expect(source).toContain('id="gitops-content"');
    expect(source).toContain('Reading Git state before Code work continues.');
    expect(source).toContain('status, diff, branches, and recent commits');
    expect(source).toContain('renderGitOpsLoadingState(repos[0]?.name ||');
    expect(source).toContain(
      'content.innerHTML = renderGitOpsLoadingState(repoName)',
    );
    expect(source).toContain(
      '`/files/repos/${encodeURIComponent(repoName)}/git`',
    );
    expect(source).toContain('`/dev/git/${encodeURIComponent(repoName)}/diff`');
    expect(source).toContain('const loadIssues = [...inventoryIssues]');
    expect(source).toContain("loadIssues.push('Git status unavailable')");
    expect(source).toContain("loadIssues.push('Repository diff unavailable')");
    expect(source).toContain('window.loadGitOpsPage = loadGitOps');
    expect(source).toContain('gitOpsCheckout');
    expect(source).toContain('gitOpsPull');
    expect(source).toContain('gitOpsPush');
    expect(source).toContain('gitOpsCommit');
    expect(source).not.toContain(
      '<div id="gitops-content"><div class="loading">Loading</div></div>',
    );
    expect(source).not.toContain(
      'content.innerHTML = \'<div class="loading">Loading</div>\'',
    );
  });

  it('uses repository-aware recovery copy for checkout and pull failures', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const actions = source.slice(
      source.indexOf('function gitOpsActionErrorMessage'),
      source.indexOf('window.gitOpsPush'),
    );

    expect(actions).toContain('gitOpsActionErrorMessage');
    expect(actions).toContain('Branch checkout did not complete.');
    expect(actions).toContain('Repository pull did not complete.');
    expect(actions).toContain(
      'dirty files, selected repository, and active Code tasks',
    );
    expect(actions).toContain(
      'dirty-tree risk, branch context, and verification gaps',
    );
    expect(actions).toContain(
      "toast(gitOpsActionErrorMessage('checkout', r), 'error')",
    );
    expect(actions).toContain(
      "toast(gitOpsActionErrorMessage('checkout', err), 'error')",
    );
    expect(actions).toContain(
      "toast(gitOpsActionErrorMessage('pull', r), 'error')",
    );
    expect(actions).toContain(
      "toast(gitOpsActionErrorMessage('pull', err), 'error')",
    );
    expect(actions).not.toContain(
      "toast(r.error || 'Checkout failed', 'error')",
    );
    expect(actions).not.toContain("toast('Checkout failed', 'error')");
    expect(actions).not.toContain("toast(r.error || 'Pull failed', 'error')");
    expect(actions).not.toContain("toast('Pull failed', 'error')");
  });

  it('preserves commit file selection and status classifications', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('class="gitops-file-check"');
    expect(source).toContain('gitops-commit-message');
    expect(source).toContain('const staged = (git.status || [])');
    expect(source).toContain('const untracked = (git.status || [])');
    expect(source).toContain(
      'const allFiles = [...modified, ...staged, ...untracked]',
    );
    expect(source).toContain('gitDecision');
    expect(source).toContain('gitDecisionFacts');
    expect(source).toContain(
      'Local changes need review before sync or handoff',
    );
    expect(source).toContain('Staged changes are ready for commit review');
    expect(source).toContain("window.switchTab?.('gc-tabs','tests')");
    expect(source).toContain('Working tree clean');
    expect(source).not.toContain(
      'id="gitops-commit-msg" placeholder="Commit message" style="max-width:100%"',
    );
  });

  it('styles Git Ops panels, diff review, and responsive layout', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.gitops-command-center');
    expect(source).toContain('.gitops-state-strip');
    expect(source).toContain('.gitops-state-card.is-warning');
    expect(source).toContain('.gitops-data-health.is-warning');
    expect(source).toContain('.gitops-data-health strong');
    expect(source).toContain('.gitops-decision-brief');
    expect(source).toContain('.gitops-decision-brief.is-attention');
    expect(source).toContain('.gitops-decision-facts');
    expect(source).toContain('.gitops-decision-actions');
    expect(source).toContain('.gitops-handoff-runway');
    expect(source).toContain('.gitops-handoff-grid');
    expect(source).toContain('.gitops-handoff-card');
    expect(source).toContain('.gitops-workbench');
    expect(source).toContain('.gitops-diff-panel');
    expect(source).toContain('.gitops-commit-panel');
    expect(source).toContain('.gitops-commit-message .search-input');
    expect(source).toContain('.gitops-branch-chip.active');
    expect(source).toContain('.gitops-repo-empty-state');
    expect(source).toContain('.gitops-load-error-state');
    expect(source).toContain('.gitops-loading-state');
    expect(source).toContain('.gitops-loading-steps');
    expect(source).toContain('.gitops-empty-flow');
    expect(source).toContain('.gitops-empty-actions');
    expect(source).toContain('@media (max-width: 920px)');
    expect(source).toContain('.gitops-state-strip,');
    expect(source).toContain('.gitops-handoff-grid,');
    expect(source).toContain('.gitops-loading-state,');
    expect(source).toContain(
      '.gitops-repo-empty-state,\n  .gitops-load-error-state,\n  .gitops-empty-flow',
    );
    expect(source).toContain('.gitops-decision-brief {');
  });
});
