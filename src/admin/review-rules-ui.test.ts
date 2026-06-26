import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Review rules policy cockpit UI', () => {
  it('frames review rules as a policy cockpit for agent code review', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Review policy cockpit');
    expect(source).toContain('Review Rules');
    expect(source).toContain('review-rules-command-center');
    expect(source).toContain('review-rules-stats');
    expect(source).toContain('review-rules-layout');
    expect(source).toContain(
      'Agents use these rules during PR reviews, code checks, and coding handoffs.',
    );
    expect(source).toContain('reviewPolicyBriefText');
    expect(source).toContain('NanoCrab review policy brief');
    expect(source).toContain('reviewEvidenceLadder');
    expect(source).toContain('reviewDecisionMatrix');
    expect(source).toContain('Review evidence ladder');
    expect(source).toContain('Make approval depend on proof, not memory.');
    expect(source).toContain(
      'Name the user-facing workflow, touched files, and whether the change belongs in Copilot, Cowork, Code, or System.',
    );
    expect(source).toContain(
      'Call out security, credentials, MCP/tool access, external writes, data loss, and rollback concerns.',
    );
    expect(source).toContain(
      'Separate blocking fixes from optional follow-up, then state approve, request changes, or defer.',
    );
    expect(source).toContain('Review decision matrix');
    expect(source).toContain('Decision matrix');
    expect(source).toContain('Decide what happens after the review.');
    expect(source).toContain(
      'Make the next action explicit so agent work does not drift between approval, rework, and planning.',
    );
    expect(source).toContain('Approve');
    expect(source).toContain('Request changes');
    expect(source).toContain('Defer');
    expect(source).toContain(
      'Scope is clear, risks are named, and verification evidence matches the changed behavior.',
    );
    expect(source).toContain(
      'User-impact, security, data, tool access, or regression risk is unresolved.',
    );
    expect(source).toContain(
      'The change belongs in Cowork planning, product direction, or a separate Code task.',
    );
    expect(source).toContain(
      'Route the decision to the right workspace instead of approving unclear implementation work.',
    );
    expect(source).toContain('Copy policy brief');
    expect(source).toContain('copyReviewPolicyBrief');
    expect(source).toContain('Review policy brief copied');
    expect(source).toContain('reviewHandoffPromptText');
    expect(source).toContain(
      'Run a NanoCrab Code review using the active review policy.',
    );
    expect(source).toContain(
      'Start from repository, branch, issue, diff, changed files, test target, and user-facing workflow.',
    );
    expect(source).toContain(
      'Require test, typecheck, build, lint, or skipped-verification evidence before approval.',
    );
    expect(source).toContain(
      'Check security, credentials, MCP/tool access, external writes, data loss, and rollback.',
    );
    expect(source).toContain(
      'If the change belongs in Cowork planning or product direction, defer instead of approving unclear implementation work.',
    );
    expect(source).toContain(
      'Return findings ordered by severity with file and line references, required fixes, optional follow-up, and a final decision.',
    );
    expect(source).toContain('Copy review prompt');
    expect(source).toContain('copyReviewHandoffPrompt');
    expect(source).toContain('Review handoff prompt copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("prompt('Copy review policy brief:'");
    expect(source).not.toContain("prompt('Copy review handoff prompt:'");
    expect(source).toContain('window._reviewPolicyState');
    expect(source).toContain(
      'Apply these rules during Code reviews, PR checks, coding-agent handoffs, and release verification',
    );
    expect(source).toContain(
      'Require concrete test, typecheck, build, and skipped-verification evidence',
    );
    expect(source).toContain(
      'Keep review feedback actionable: reference files, name risks, and separate required fixes from optional follow-up',
    );
  });

  it('keeps editor, save, and endpoint wiring intact', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/dev/review-rules')");
    expect(source).toContain("method: 'PUT'");
    expect(source).toContain('id="review-rules-editor"');
    expect(source).toContain('id="review-rules-msg"');
    expect(source).toContain('saveReviewRules');
  });

  it('offers quick inserts for practical review expectations', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('reviewRuleSnippets');
    expect(source).toContain('Security gate');
    expect(source).toContain('Test evidence');
    expect(source).toContain('User impact');
    expect(source).toContain('Agent handoff');
    expect(source).toContain('insertReviewRuleSnippet');
  });

  it('uses class-based save status states', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const reviewBlock = source.slice(
      source.indexOf('// --- Review Rules ---'),
      source.indexOf('// --- Custom Containers ---'),
    );

    expect(reviewBlock).toContain("msg.classList.add('is-success')");
    expect(reviewBlock).toContain("msg.classList.add('is-error')");
    expect(reviewBlock).toContain(
      "msg.classList.remove('is-success', 'is-error')",
    );
    expect(reviewBlock).not.toContain("msg.style.color = 'var(--success)'");
    expect(reviewBlock).not.toContain("msg.style.color = 'var(--error)'");
    expect(style).toContain('#review-rules-msg.is-success');
    expect(style).toContain('#review-rules-msg.is-error');
  });

  it('styles the review rules editor responsively', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.review-rules-command-center');
    expect(source).toContain('.review-rules-stats');
    expect(source).toContain('.review-rules-layout');
    expect(source).toContain('.review-evidence-ladder');
    expect(source).toContain('.review-evidence-steps');
    expect(source).toContain('.review-evidence-step');
    expect(source).toContain('.review-decision-matrix');
    expect(source).toContain('.review-decision-copy');
    expect(source).toContain('.review-decision-grid');
    expect(source).toContain('.review-decision-card');
    expect(source).toContain('.review-rule-snippet');
    expect(source).toContain('#review-rules-editor');
    expect(source).toContain('.review-rules-stats,\n  .review-rules-layout');
    expect(source).toContain(
      '.review-evidence-ladder,\n  .review-evidence-steps',
    );
    expect(source).toContain('.review-decision-grid,');
  });
});
