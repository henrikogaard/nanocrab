import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Skills capability library UI', () => {
  it('builds collapse toggles with text nodes instead of HTML interpolation', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain(
      'toggle.append(chevron, document.createTextNode(titleText))',
    );
    expect(source).not.toContain(
      'toggle.innerHTML = \'<span class="settings-card-collapse-chevron"></span>\' + titleText',
    );
  });

  const skillsSource = (source: string) =>
    source.slice(
      source.indexOf('async function renderSkills'),
      source.indexOf("['core', 'plugin', 'tool', 'custom']"),
    );
  const registrySource = (source: string) =>
    source.slice(
      source.indexOf("['core', 'plugin', 'tool', 'custom']"),
      source.indexOf("document.getElementById('skill-draft-create-form')"),
    );
  const reviewPanelsSource = (source: string) =>
    source.slice(
      source.indexOf('<div id="skills-page-timeline">'),
      source.indexOf('window.viewSkillVersionDiff'),
    );
  const actionSource = (source: string) =>
    source.slice(
      source.indexOf('function skillActionErrorMessage'),
      source.indexOf('// Docker'),
    );

  it('frames Skills as a personal capability library', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Capability library');
    expect(source).toContain('Teach agents reusable ways to work');
    expect(source).toContain('Copilot, Cowork, and Code agents');
    expect(source).toContain('skills-command-center');
    expect(source).toContain('skills-command-stats');
    expect(source).toContain('skills-lane-map');
    expect(source).toContain('skillStats');
    expect(source).toContain('skillCapabilityBriefText');
    expect(source).toContain('skillDraftPromptText');
    expect(source).toContain('skillActivationBriefText');
    expect(source).toContain('Skills capability brief');
    expect(source).toContain('Data health:');
    expect(source).toContain(
      'Skills registry, drafts, suggestions, and activity loaded without known fallback.',
    );
    expect(source).toContain('Skill activation brief');
    expect(source).toContain(
      'Draft a NanoCrab skill from a repeated workflow.',
    );
    expect(source).toContain('Copy capability brief');
    expect(source).toContain('Copy draft prompt');
    expect(source).toContain('Copy activation brief');
    expect(source).toContain('copySkillCapabilityBrief');
    expect(source).toContain('copySkillDraftPrompt');
    expect(source).toContain('copySkillActivationBrief');
    expect(source).toContain('Skill capability brief copied');
    expect(source).toContain('Skill draft prompt copied');
    expect(source).toContain('Skill activation brief copied');
    expect(source).toContain('Copy skill draft prompt');
    expect(source).toContain('Copy skill activation brief');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("prompt('Copy skill capability brief:'");
    expect(source).not.toContain("prompt('Copy skill draft prompt:'");
    expect(source).toContain('window._skillCapabilityState');
    expect(source).toContain('window._skillByPath');
  });

  it('maps reusable skills to Copilot, Cowork, Code, and personal scope', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('skillLaneMap');
    expect(source).toContain('Better plain answers');
    expect(source).toContain('Repeatable project work');
    expect(source).toContain('Safer automation');
    expect(source).toContain('Your durable know-how');
    expect(source).toContain(
      'Apply document, brief, email, MCP, and artifact workflows inside project chats',
    );
    expect(source).toContain('Keep cross-agent habits here');
    expect(source).toContain(
      'Turn repeated Copilot, Cowork, Code, MCP, report, and review workflows into skills',
    );
    expect(source).toContain(
      'Keep facts in Memory, active project material in Cowork, stable references in Wiki, and executable/reusable procedure in Skills',
    );
    expect(source).toContain(
      'Review high-risk tool access before enabling skills for unattended work',
    );
    expect(source).toContain(
      'Capture reusable procedure, trigger rules, output format, and verification steps.',
    );
    expect(source).toContain(
      'Do not store personal facts, project-specific content, raw emails, customer details, credentials, or one-off decisions in the skill.',
    );
    expect(source).toContain(
      'Put durable personal facts in Memory, active project material in Cowork, stable references in Wiki, and only executable/reusable procedure in Skills.',
    );
    expect(source).toContain(
      'Include when to use the skill, when not to use it, allowed tool boundaries, approval requirements, and handoff evidence.',
    );
    expect(source).toContain(
      'Prefer a draft that must be reviewed before agents rely on it, especially if MCP tools, external writes, documents, or unattended routines are involved.',
    );
    expect(source).toContain(
      'Anything that should stay in Cowork, Memory, Wiki, Snippets, or Reports instead.',
    );
    expect(source).toContain('Use this skill when');
    expect(source).toContain('Keep out of this skill');
    expect(source).toContain('Activation checklist');
    expect(source).toContain('Durable personal facts belong in Memory.');
    expect(source).toContain(
      'Active files, source summaries, documents, and project decisions belong in Cowork.',
    );
    expect(source).toContain(
      'Repository diffs, branch state, tests, PR evidence, and GitHub Copilot handoffs belong in Code.',
    );
    expect(source).toContain(
      'Stable reference material belongs in Wiki; one-off command snippets belong in Snippets.',
    );
    expect(source).toContain(
      'Keep MCP, document publishing, email sends, calendar edits, webhooks, and repository writes approval-gated.',
    );
  });

  it('summarizes active, draft, suggestion, and guardrail state', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const skills = skillsSource(source);

    expect(source).toContain('activeSkillCount');
    expect(source).toContain('privateSkillCount');
    expect(source).toContain('highRiskSkillCount');
    expect(source).toContain('customSkillCount');
    expect(source).toContain('No active skills are enabled yet.');
    expect(source).toContain(
      'Start by drafting one stable repeated workflow from Copilot, Cowork, Code, MCP, reports, or review work.',
    );
    expect(source).toContain(
      'Keep project-specific context in Cowork; promote only durable procedure, trigger rules, and safe tool boundaries into Skills.',
    );
    expect(source).toContain('waiting for review');
    expect(source).toContain('from repeated work');
    expect(source).toContain('skills-data-health');
    expect(source).toContain(
      'Review missing skill feeds before assuming the capability queue is quiet.',
    );
    expect(source).toContain(
      'Drafts, suggestions, and activity can be used for capability planning.',
    );
    expect(source).toContain(
      "loadIssues.push('Pending skill drafts unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Skill suggestions unavailable')",
    );
    expect(source).toContain("loadIssues.push('Audit activity unavailable')");
    expect(source).toContain("loadIssues.push('Memory activity unavailable')");
    expect(source).toContain(
      "loadIssues.push('Skill draft activity unavailable')",
    );
    expect(source).toContain('renderSkillEmptyState');
    expect(source).toContain('skills-empty-guidance');
    expect(source).toContain(
      'When NanoCrab sees the same Copilot, Cowork, Code, MCP, or report workflow repeated',
    );
    expect(source).toContain(
      'Draft a skill when a workflow is stable enough to reuse',
    );
    expect(source).toContain(
      'Version history appears after this skill is edited',
    );
    expect(source).not.toContain(
      '<div class="empty skills-empty-note">No new skill suggestions from recent history</div>',
    );
    expect(source).not.toContain(
      '<div class="empty skills-empty-note">No pending skill drafts</div>',
    );
    expect(source).not.toContain(
      '<div class="empty skills-empty-note">No versions recorded yet</div>',
    );
    expect(source).not.toContain("'- No active skills yet'");
    expect(skills).not.toContain(
      "api('/skills/drafts?status=pending').catch(() => [])",
    );
    expect(skills).not.toContain("api('/skills/suggestions').catch(() => [])");
    expect(skills).not.toContain("api('/audit?limit=150').catch(() => [])");
    expect(skills).not.toContain("api('/memory?limit=150').catch(() => [])");
    expect(skills).not.toContain("api('/skills/drafts').catch(() => [])");
  });

  it('preserves skill creation, review, registry, and history hooks', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const skills = skillsSource(source);
    const registry = registrySource(source);

    expect(source).toContain('id="new-skill-draft-form"');
    expect(source).toContain(
      'class="skills-form-panel is-hidden" id="new-skill-draft-form"',
    );
    expect(source).toContain('id="skill-draft-create-form"');
    expect(source).toContain('id="new-skill-form"');
    expect(source).toContain(
      'class="skills-form-panel is-hidden" id="new-skill-form"',
    );
    expect(source).toContain('id="skill-create-form"');
    expect(source).toContain(
      'id="skill-editor" class="skill-inline-panel is-hidden"',
    );
    expect(source).toContain(
      'id="skill-version-viewer" class="skill-inline-panel is-hidden"',
    );
    expect(source).toContain(
      'id="skill-draft-viewer" class="skill-inline-panel is-hidden"',
    );
    expect(source).toContain('toggleSkillPanel');
    expect(source).toContain('showSkillPanel');
    expect(source).toContain('hideSkillPanel');
    expect(source).toContain('createSkillDraftFromSuggestion');
    expect(source).toContain('reviewSkillDraft');
    expect(source).toContain('updateSkillState');
    expect(source).toContain('editSkill');
    expect(source).toContain('viewSkillVersions');
    expect(source).toContain('Copy activation brief</button>');
    expect(source).toContain('deleteSkill');
    expect(source).toContain('class="log-viewer skill-version-diff is-hidden"');
    expect(source).toContain('skills-activity-card');
    expect(source).toContain('skills-review-card');
    expect(source).toContain('skills-review-head');
    expect(source).toContain('skills-review-actions');
    expect(source).toContain('skills-review-pre');
    expect(source).toContain('skills-version-row');
    expect(source).toContain('skills-version-main');
    expect(source).toContain('skills-version-title');
    expect(source).toContain('skills-version-actions');
    expect(skills).toContain('class="skills-panel"');
    expect(skills).toContain('class="skills-panel-note"');
    expect(skills).toContain('renderSkillEmptyState');
    expect(skills).toContain('class="skill-row-main"');
    expect(skills).toContain('class="skill-row-title"');
    expect(skills).toContain('class="skill-row-actions"');
    expect(registry).toContain('class="skill-registry-row"');
    expect(registry).toContain(
      'class="badge badge-muted skill-registry-count"',
    );
    expect(registry).toContain('class="skill-active-toggle"');
    expect(registry).toContain('class="input-sm skill-row-select"');
    expect(registry).toContain('class="input-sm skill-row-select is-wide"');
    expect(source).not.toContain(
      'id="new-skill-draft-form" style="display:none"',
    );
    expect(source).not.toContain('id="new-skill-form" style="display:none"');
    expect(source).not.toContain('id="skill-editor" style="display:none"');
    expect(source).not.toContain(
      "document.getElementById('skill-editor').style.display",
    );
    expect(source).not.toContain(
      "document.getElementById('skill-version-viewer').style.display",
    );
    expect(source).not.toContain(
      "document.getElementById('skill-draft-viewer').style.display",
    );
    expect(skills).not.toContain(
      'class="skills-panel" style="margin-bottom:12px"',
    );
    expect(skills).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-bottom:12px"',
    );
    expect(skills).not.toContain('style="flex:1;min-width:0"');
    expect(skills).not.toContain(
      'style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"',
    );
    expect(skills).not.toContain('style="display:flex;gap:5px;flex-wrap:wrap"');
    expect(skills).not.toContain('<div class="empty" style="padding:12px"');
    expect(registry).not.toContain(
      'class="skills-panel" style="margin-bottom:12px"',
    );
    expect(registry).not.toContain('style="font-size:10px"');
    expect(registry).not.toContain(
      'class="channel-info" style="flex:1;min-width:0"',
    );
    expect(registry).not.toContain(
      'style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"',
    );
    expect(registry).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis"',
    );
    expect(registry).not.toContain(
      'style="font-size:11px;color:var(--text-muted);margin-top:6px"',
    );
    expect(registry).not.toContain(
      'style="display:flex;gap:6px;flex-shrink:0;align-items:center;flex-wrap:wrap;justify-content:flex-end"',
    );
    expect(registry).not.toContain(
      'label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);cursor:pointer"',
    );
    expect(registry).not.toContain(
      'select class="input-sm" style="width:auto;min-width:92px"',
    );
    expect(registry).not.toContain(
      'select class="input-sm" style="width:auto;min-width:98px"',
    );
  });

  it('wires a Skills.sh catalog view for downloading and enabling skills', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const skills = skillsSource(source);
    const actions = actionSource(source);

    expect(source).toContain('Skills.sh catalog');
    expect(source).toContain('Search Skills.sh');
    expect(source).toContain('id="skills-sh-query"');
    expect(source).toContain('id="skills-sh-results"');
    expect(source).toContain('id="skills-sh-scope"');
    expect(source).toContain('id="skills-sh-visibility"');
    expect(source).toContain('id="skills-sh-enabled"');
    expect(source).toContain('loadSkillsShCatalog');
    expect(source).toContain('renderSkillsShCatalog');
    expect(source).toContain('installSkillsShSkill');
    expect(source).toContain('api(`/skills/skills-sh/search?');
    expect(source).toContain("api('/skills/skills-sh/install'");
    expect(source).toContain('Download & enable');
    expect(source).toContain('Downloaded from Skills.sh');
    expect(source).toContain('Skills.sh skill installed and enabled');
    expect(actions).toContain('Skills.sh search did not finish.');
    expect(actions).toContain('Skills.sh skill was not installed.');
    expect(skills).toContain('class="skills-sh-search-panel"');
    expect(skills).toContain('class="skills-sh-results"');
    expect(styleSource).toContain('.skills-sh-search-panel');
    expect(styleSource).toContain('.skills-sh-result-card');
    expect(styleSource).toContain('.skills-sh-install-options');
  });

  it('uses class-based review, edit, and version panels', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const styleSource = fs.readFileSync(stylePath, 'utf8');
    const panels = reviewPanelsSource(appSource);

    expect(panels).toContain('skills-activity-card');
    expect(panels).toContain('renderTimelineItems(timelineItems)');
    expect(panels).toContain('skills-review-card');
    expect(panels).toContain('skills-review-head');
    expect(panels).toContain('skills-review-actions');
    expect(panels).toContain('skills-review-pre');
    expect(panels).toContain('skills-editor-textarea tall');
    expect(panels).toContain('skills-version-status');
    expect(panels).toContain('skills-version-row');
    expect(panels).toContain('skills-version-main');
    expect(panels).toContain('skills-version-title');
    expect(panels).toContain('skills-version-name');
    expect(panels).toContain('skills-version-meta');
    expect(panels).toContain('skills-version-actions');
    expect(panels).not.toContain('class="card" style="margin-top:16px"');
    expect(panels).not.toContain(
      'style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px"',
    );
    expect(panels).not.toContain('style="width:100%;min-height:300px');
    expect(panels).not.toContain('style="display:flex;gap:5px;flex-wrap:wrap"');
    expect(styleSource).toContain('.skills-review-card');
    expect(styleSource).toContain('.skills-review-head');
    expect(styleSource).toContain('.skills-version-row');
  });

  it('uses actionable skill failure messages across creation, review, and history actions', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const actions = actionSource(source);

    expect(actions).toContain('skillActionErrorMessage');
    expect(actions).toContain('Skill draft was not created.');
    expect(actions).toContain('Skill was not created.');
    expect(actions).toContain('Suggested skill draft was not created.');
    expect(actions).toContain('Skill draft could not be loaded.');
    expect(actions).toContain('Skill draft review was not saved.');
    expect(actions).toContain('Skill registry change was not saved.');
    expect(actions).toContain('Skill edits were not saved.');
    expect(actions).toContain('Skill version diff could not be loaded.');
    expect(actions).toContain('Skill rollback was not applied.');
    expect(actions).toContain('Skill was not deleted.');
    expect(actions).toContain('high-risk tool access');
    expect(actions).toContain(
      'active routines, Cowork projects, reports, and agents',
    );
    expect(actions).toContain(
      "toast(skillActionErrorMessage('draft', r), 'error')",
    );
    expect(actions).toContain(
      "toast(skillActionErrorMessage('create', r), 'error')",
    );
    expect(actions).toContain(
      "toast(skillActionErrorMessage('suggestion', r), 'error')",
    );
    expect(actions).toContain(
      "toast(skillActionErrorMessage('review', r), 'error')",
    );
    expect(actions).toContain(
      "toast(skillActionErrorMessage('state', r), 'error')",
    );
    expect(actions).toContain(
      "toast(skillActionErrorMessage('save', r), 'error')",
    );
    expect(actions).toContain(
      "toast(skillActionErrorMessage('rollback', r), 'error')",
    );
    expect(actions).toContain(
      "toast(skillActionErrorMessage('delete', r), 'error')",
    );
    expect(actions).not.toContain("toast(r.error || 'Failed', 'error')");
    expect(actions).not.toContain("toast('Failed: ' + e.message, 'error')");
  });

  it('styles capability cards, registry rows, editors, and responsive states', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.skills-command-center');
    expect(source).toContain('.skills-command-stats');
    expect(source).toContain('.skills-command-stat.is-warning');
    expect(source).toContain('.skills-command-stat.is-ready');
    expect(source).toContain('.skills-data-health');
    expect(source).toContain('.skills-data-health.is-warning');
    expect(source).toContain('.skills-data-health.is-ready');
    expect(source).toContain('.skills-lane-map');
    expect(source).toContain('.skills-lane-card');
    expect(source).toContain('.skills-panel');
    expect(source).toContain('.skills-form-panel');
    expect(source).toContain('.skills-form-panel.is-hidden');
    expect(source).toContain('.skill-inline-panel.is-hidden');
    expect(source).toContain('.skill-version-diff.is-hidden');
    expect(source).toContain('.skill-suggestion-card');
    expect(source).toContain('.skill-draft-card');
    expect(source).toContain('.skill-registry-row');
    expect(source).toContain('.skill-row-main');
    expect(source).toContain('.skill-row-title');
    expect(source).toContain('.skill-row-actions');
    expect(source).toContain('.skill-active-toggle');
    expect(source).toContain('.skill-registry-count');
    expect(source).toContain('.skill-row-select');
    expect(source).toContain('.skill-row-select.is-wide');
    expect(source).toContain('.skills-panel-note');
    expect(source).toContain('.skills-empty-note');
    expect(source).toContain('.skills-empty-guidance');
    expect(source).toContain('.skills-empty-actions');
    expect(source).toContain('.skills-editor-textarea');
    expect(source).toContain('.skills-review-card');
    expect(source).toContain('.skills-version-row');
    expect(source).toContain(
      '.skills-command-stats,\n  .skills-lane-map {\n    grid-template-columns: 1fr;',
    );
  });
});
