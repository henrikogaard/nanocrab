import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Memory personal knowledge cockpit UI', () => {
  const memorySource = (source: string) =>
    source.slice(
      source.indexOf('async function renderMemory(el)'),
      source.indexOf('<div class="memory-journal-card">'),
    );
  const journalSource = (source: string) =>
    source.slice(
      source.indexOf('<div class="memory-journal-card">'),
      source.indexOf(
        '<div class="memory-work-grid">',
        source.indexOf('<div class="memory-journal-card">'),
      ),
    );
  const sharedMemorySource = (source: string) =>
    source.slice(
      source.indexOf('<div class="memory-review-card memory-shared-card">'),
      source.indexOf(
        '<div class="memory-review-card">\n      <div class="card-title">Recent Memory & Skill Activity</div>',
      ),
    );
  const channelContextSource = (source: string) =>
    source.slice(
      source.indexOf('<div class="card-title">Per-Channel Context</div>'),
      source.indexOf(
        '</div>`;',
        source.indexOf('<div class="card-title">Per-Channel Context</div>'),
      ),
    );
  const standaloneTimelineSource = (source: string) =>
    source.slice(
      source.indexOf('function memoryTimelineBriefText'),
      source.indexOf('// Memory'),
    );

  it('frames Memory as the personal knowledge surface', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Personal knowledge');
    expect(source).toContain(
      'Curate what agents remember about you and your work',
    );
    expect(source).toContain('Copilot, Cowork, and Code sessions');
    expect(source).toContain('memory-command-center');
    expect(source).toContain('memory-stats');
    expect(source).toContain('memory-boundary-map');
    expect(source).toContain('memory-review-brief');
    expect(source).toContain('Review priority');
    expect(source).toContain('memoryScopeSummary');
    expect(source).toContain('renderMemoryReviewBrief');
    expect(source).toContain('memoryPersonalBriefText');
    expect(source).toContain('Personal memory brief');
    expect(source).toContain('Data health:');
    expect(source).toContain(
      'Memory proposals, activity, journal summaries, skills, and channel context loaded without known fallback.',
    );
    expect(source).toContain('Copy memory brief');
    expect(source).toContain('copyMemoryPersonalBrief');
    expect(source).toContain('Memory brief copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("prompt('Copy memory brief:'");
    expect(source).toContain('window._memoryPersonalState');
    expect(source).toContain('memoryStats');
  });

  it('separates personal memory from Cowork projects, Skills, and channel files', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('memoryBoundaryCards');
    expect(source).toContain('Remember here');
    expect(source).toContain('Durable personal context');
    expect(source).toContain('Keep in Cowork');
    expect(source).toContain('Project-specific material');
    expect(source).toContain('Teach as Skills');
    expect(source).toContain('Reusable ways to work');
    expect(source).toContain('Route by channel');
    expect(source).toContain(
      'Approve only durable personal preferences, facts, constraints, and patterns',
    );
    expect(source).toContain(
      'Keep project-specific material in Cowork, reusable procedures in Skills, stable references in Wiki, and channel-scoped facts in channel files',
    );
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('skills')");
    expect(source).toContain("navigate('files')");
  });

  it('preserves memory review, shared editor, and navigation hooks', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const memory = memorySource(source);
    const shared = sharedMemorySource(source);
    const channels = channelContextSource(source);
    const saveMemoryBlock = source.slice(
      source.indexOf('window.saveMemory = async'),
      source.indexOf('window.copyMemoryPersonalBrief'),
    );

    expect(source).toContain("api('/files/memory')");
    expect(source).toContain("api('/memory?limit=100')");
    expect(source).toContain('memory-data-health');
    expect(source).toContain('Memory data health');
    expect(source).toContain(
      'Review missing personal knowledge feeds before approving or dismissing memory.',
    );
    expect(source).toContain(
      'The review queue and activity context are available for personal knowledge decisions.',
    );
    expect(source).toContain(
      "loadIssues.push('Memory audit activity unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Structured memory proposals unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Journal summaries unavailable')",
    );
    expect(source).toContain(
      "loadIssues.push('Skill draft context unavailable')",
    );
    expect(source).toContain(
      'Channel context unavailable for ${g.name || g.folder}',
    );
    expect(source).toContain('reviewMemoryRecord');
    expect(source).toContain('id="memory-editor"');
    expect(source).toContain('saveMemory');
    expect(source).toContain('id="memory-msg"');
    expect(source).toContain("navigate('skills')");
    expect(source).toContain("navigate('wiki')");
    expect(source).toContain("navigate('files')");
    expect(memory).toContain('memory-proposal-card');
    expect(memory).toContain('memory-proposal-main');
    expect(memory).toContain('memory-proposal-badges');
    expect(memory).toContain('memory-proposal-actions');
    expect(memory).toContain('memory-approved-strip');
    expect(memory).toContain('memory-approved-title');
    expect(memory).toContain('memory-approved-row');
    expect(memory).toContain('renderMemoryEmptyGuidance');
    expect(source).toContain('memory-empty-guidance');
    expect(source).toContain('No pending memory proposals.');
    expect(source).toContain(
      'Keep project material in Cowork and reusable process in Skills.',
    );
    expect(source).toContain('No memory or skill changes recorded yet.');
    expect(source).not.toContain(
      '<div class="empty memory-empty-note">No pending memory proposals</div>',
    );
    expect(source).not.toContain(
      '<div class="empty memory-empty-note">No memory or skill changes recorded yet</div>',
    );
    expect(shared).toContain('memory-shared-card');
    expect(shared).toContain('memory-card-note');
    expect(shared).toContain('memory-editor-actions');
    expect(shared).toContain('memory-status-msg');
    expect(saveMemoryBlock).toContain(
      "setInlineStatus(msg, 'Saved', 'success')",
    );
    expect(saveMemoryBlock).toContain(
      "setInlineStatus(msg, memoryActionErrorMessage('save', err), 'error')",
    );
    expect(saveMemoryBlock).toContain(
      "setTimeout(() => setInlineStatus(msg, ''), 3000)",
    );
    expect(saveMemoryBlock).not.toContain('msg.style.color');
    expect(channels).toContain('memory-card-note');
    expect(channels).toContain('link-button');
    expect(channels).toContain('memory-channel-head');
    expect(channels).toContain('memory-channel-edit');
    expect(memory).not.toContain(
      'class="channel-card" style="align-items:flex-start"',
    );
    expect(memory).not.toContain('style="flex:1;min-width:0"');
    expect(memory).not.toContain(
      'style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:5px"',
    );
    expect(memory).not.toContain(
      'style="font-size:13px;color:var(--text);line-height:1.45"',
    );
    expect(memory).not.toContain(
      'style="font-size:11px;color:var(--text-muted);margin-top:5px"',
    );
    expect(memory).not.toContain('style="display:flex;gap:5px"');
    expect(memory).not.toContain('<div class="empty" style="padding:12px"');
    expect(memory).not.toContain(
      'style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)"',
    );
    expect(memory).not.toContain("api('/audit?limit=50').catch(() => [])");
    expect(memory).not.toContain("api('/memory?limit=100').catch(() => [])");
    expect(memory).not.toContain(
      "api('/journal/entries?limit=10').catch(() => [])",
    );
    expect(memory).not.toContain("api('/skills/drafts').catch(() => [])");
    expect(memory).not.toContain(").catch(() => ({ content: '' }))");
    expect(shared).not.toContain(
      'class="memory-review-card" style="grid-column:1/-1"',
    );
    expect(shared).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-bottom:12px"',
    );
    expect(shared).not.toContain(
      'style="margin-top:12px;display:flex;gap:8px;align-items:center"',
    );
    expect(shared).not.toContain('id="memory-msg" style="font-size:12px"');
    expect(channels).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-bottom:16px"',
    );
    expect(channels).not.toContain(
      'style="color:var(--accent);cursor:pointer"',
    );
    expect(channels).not.toContain(
      'style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"',
    );
    expect(channels).not.toContain('style="font-weight:600;color:var(--text)"');
    expect(channels).not.toContain('style="margin-top:8px"');
  });

  it('keeps journal search, summary generation, and per-channel context wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const journal = journalSource(source);
    const journalAnswer = source.slice(
      source.indexOf('window.searchJournalAnswer'),
      source.indexOf('window.createJournalSummary'),
    );

    expect(source).toContain('id="journal-answer-query"');
    expect(source).toContain('searchJournalAnswer');
    expect(source).toContain('id="journal-summary-group"');
    expect(source).toContain('id="journal-summary-period"');
    expect(source).toContain('createJournalSummary');
    expect(source).toContain('memory-channel-card');
    expect(source).toContain('selectGroup');
    expect(journal).toContain('memory-journal-query');
    expect(journal).toContain('memory-journal-result');
    expect(journal).toContain('memory-journal-controls');
    expect(journal).toContain('memory-journal-period');
    expect(journal).toContain('memory-journal-msg');
    expect(journal).toContain('memory-journal-entry');
    expect(journal).toContain('memory-journal-head');
    expect(journal).toContain('renderMemoryEmptyGuidance');
    expect(source).toContain('No journal summaries recorded yet.');
    expect(source).toContain(
      'Generate summaries when channel history contains decisions',
    );
    expect(source).not.toContain(
      '<div class="empty memory-empty-note">No journal summaries recorded yet</div>',
    );
    expect(journalAnswer).toContain('memory-journal-answer');
    expect(journalAnswer).toContain('memory-journal-answer-text');
    expect(journalAnswer).toContain('memory-journal-citations');
    expect(journal).not.toContain(
      'style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:12px"',
    );
    expect(journal).not.toContain(
      'class="form-group" style="margin:0;flex:1;min-width:220px"',
    );
    expect(journal).not.toContain(
      'label style="font-size:12px;color:var(--text-muted)"',
    );
    expect(journal).not.toContain(
      'id="journal-answer-result" style="margin-bottom:14px"',
    );
    expect(journal).not.toContain(
      'select class="search-input" id="journal-summary-group" style="min-width:150px"',
    );
    expect(journal).not.toContain(
      'select class="search-input" id="journal-summary-period" style="min-width:110px"',
    );
    expect(journal).not.toContain(
      'id="journal-summary-msg" style="font-size:12px;color:var(--text-muted)"',
    );
    expect(journal).not.toContain('<div class="empty" style="padding:12px"');
    expect(journal).not.toContain(
      'style="padding:10px 0;border-top:1px solid var(--border)"',
    );
    expect(journalAnswer).not.toContain(
      'style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;background:var(--bg)"',
    );
    expect(journalAnswer).not.toContain(
      'style="font-size:12px;color:var(--text);white-space:pre-wrap;line-height:1.45"',
    );
    expect(journalAnswer).not.toContain(
      'style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px"',
    );
  });

  it('uses personal-memory recovery copy for save, review, journal search, and summary failures', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const actions = source.slice(
      source.indexOf('function memoryActionErrorMessage'),
      source.indexOf('// Mounts'),
    );

    expect(actions).toContain('memoryActionErrorMessage');
    expect(actions).toContain('Personal memory was not saved.');
    expect(actions).toContain('Memory review was not saved.');
    expect(actions).toContain('Journal search could not run.');
    expect(actions).toContain('Journal summary was not created.');
    expect(actions).toContain(
      'whether this belongs in Memory, Cowork project context, Skills, Wiki, or channel files',
    );
    expect(actions).toContain(
      'durable personal context before approving it across Copilot, Cowork, and Code',
    );
    expect(actions).toContain(
      "setInlineStatus(msg, memoryActionErrorMessage('save', r), 'error')",
    );
    expect(actions).toContain(
      "setInlineStatus(msg, memoryActionErrorMessage('save', err), 'error')",
    );
    expect(actions).toContain(
      "toast(memoryActionErrorMessage('review', r), 'error')",
    );
    expect(actions).toContain(
      "toast(memoryActionErrorMessage('review', e), 'error')",
    );
    expect(actions).toContain(
      "toast(memoryActionErrorMessage('search', err), 'error')",
    );
    expect(actions).toContain("memoryActionErrorMessage('summary', r)");
    expect(actions).toContain("memoryActionErrorMessage('summary', e)");
    expect(actions).not.toContain("toast(r.error || 'Failed', 'error')");
    expect(actions).not.toContain("toast('Failed: ' + e.message, 'error')");
  });

  it('keeps knowledge timeline tone styling in CSS', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const timeline = source.slice(
      source.indexOf('function renderTimelineItems'),
      source.indexOf(
        'async function renderSkills',
        source.indexOf('function renderTimelineItems'),
      ),
    );
    const standaloneTimeline = standaloneTimelineSource(source);

    expect(standaloneTimeline).toContain('memoryTimelineBriefText');
    expect(standaloneTimeline).toContain('Memory timeline brief');
    expect(standaloneTimeline).toContain('Data health:');
    expect(standaloneTimeline).toContain(
      'Audit, memory, and skill draft timeline feeds loaded without known fallback.',
    );
    expect(standaloneTimeline).toContain(
      "loadIssues.push('Timeline audit activity unavailable')",
    );
    expect(standaloneTimeline).toContain(
      "loadIssues.push('Timeline memory proposals unavailable')",
    );
    expect(standaloneTimeline).toContain(
      "loadIssues.push('Timeline skill drafts unavailable')",
    );
    expect(standaloneTimeline).toContain('window._memoryTimelineState');
    expect(standaloneTimeline).toContain('copyMemoryTimelineBrief');
    expect(standaloneTimeline).toContain('Memory timeline brief copied');
    expect(standaloneTimeline).toContain('Timeline data health');
    expect(standaloneTimeline).toContain(
      'Review missing timeline evidence before assuming memory and skill history is quiet.',
    );
    expect(standaloneTimeline).not.toContain(
      "api('/audit?limit=150').catch(() => [])",
    );
    expect(standaloneTimeline).not.toContain(
      "api('/memory?limit=150').catch(() => [])",
    );
    expect(standaloneTimeline).not.toContain(
      "api('/skills/drafts').catch(() => [])",
    );
    expect(timeline).toContain('knowledge-timeline-dot');
    expect(timeline).toContain('const toneClass = (tone)');
    expect(timeline).toContain(
      'knowledge-timeline-dot ${toneClass(item.tone)}',
    );
    expect(timeline).not.toContain('style="--timeline-tone');
    expect(timeline).not.toContain(
      'style="background:${color(item.tone)};box-shadow:0 0 0 4px color-mix(in srgb, ${color(item.tone)} 18%, transparent)"',
    );
    expect(style).toContain('.knowledge-timeline-dot');
    expect(style).toContain('.knowledge-timeline-dot.is-accent');
    expect(style).toContain('.knowledge-timeline-dot.is-success');
    expect(style).toContain('.knowledge-timeline-dot.is-danger');
    expect(style).toContain('.knowledge-timeline-dot.is-warning');
    expect(style).toContain('.memory-timeline-health');
    expect(style).toContain('.memory-timeline-health.is-warning');
    expect(style).toContain('.memory-timeline-health.is-ready');
    expect(style).toContain('background: var(--timeline-tone, var(--accent));');
    expect(style).toContain(
      'color-mix(in srgb, var(--timeline-tone, var(--accent)) 18%, transparent)',
    );
  });

  it('styles memory panels, cards, editor, and responsive layout', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.memory-command-center');
    expect(source).toContain('.memory-stats');
    expect(source).toContain('.memory-stats .is-warning');
    expect(source).toContain('.memory-stats .is-ready');
    expect(source).toContain('.memory-data-health');
    expect(source).toContain('.memory-data-health.is-warning');
    expect(source).toContain('.memory-data-health.is-ready');
    expect(source).toContain('.memory-boundary-map');
    expect(source).toContain('.memory-boundary-card');
    expect(source).toContain('.memory-review-brief');
    expect(source).toContain('.memory-review-brief-actions');
    expect(source).toContain('.memory-work-grid');
    expect(source).toContain('.memory-review-card');
    expect(source).toContain('.memory-proposal-card');
    expect(source).toContain('.memory-proposal-main');
    expect(source).toContain('.memory-proposal-badges');
    expect(source).toContain('.memory-proposal-actions');
    expect(source).toContain('.memory-approved-strip');
    expect(source).toContain('.memory-approved-title');
    expect(source).toContain('.memory-approved-row');
    expect(source).toContain('.memory-empty-note');
    expect(source).toContain('.memory-empty-guidance');
    expect(source).toContain('.memory-empty-actions');
    expect(source).toContain('.memory-journal-card');
    expect(source).toContain('.memory-journal-query');
    expect(source).toContain('.memory-journal-result');
    expect(source).toContain('.memory-journal-answer-text');
    expect(source).toContain('.memory-journal-citations');
    expect(source).toContain('.memory-journal-controls');
    expect(source).toContain('.memory-journal-period');
    expect(source).toContain('.memory-journal-msg');
    expect(source).toContain('.memory-journal-entry');
    expect(source).toContain('.memory-journal-head');
    expect(source).toContain('.memory-card-note');
    expect(source).toContain('.memory-shared-card');
    expect(source).toContain('.memory-editor-actions');
    expect(source).toContain('.memory-status-msg');
    expect(source).toContain('.memory-status-msg.is-success');
    expect(source).toContain('.memory-status-msg.is-error');
    expect(source).toContain('.memory-editor-textarea');
    expect(source).toContain('.memory-channel-card');
    expect(source).toContain('.memory-channel-head');
    expect(source).toContain('.memory-channel-edit');
    expect(source).toContain('.memory-stats,');
    expect(source).toContain('.memory-boundary-map,');
    expect(source).toContain('.memory-review-brief,');
    expect(source).toContain('.memory-work-grid,');
  });
});
