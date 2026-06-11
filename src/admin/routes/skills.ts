import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { auditLog } from '../security.js';
import { logger } from '../../logger.js';

import { STORE_DIR } from '../../config.js';
import {
  listSkillRegistry,
  scoreSkillsForRequest,
  SkillScope,
  SkillVisibility,
  updateSkillState,
} from '../../skill-registry.js';
import {
  approveSkillDraft,
  getSkillDraft,
  getSkillDraftContent,
  getSkillDraftDiff,
  listSkillDraftRevisions,
  listSkillDrafts,
  proposeSkillDraft,
  rejectSkillDraft,
  rollbackSkillDraft,
  SkillDraftStatus,
  updateSkillDraft,
} from '../../skill-factory.js';
import {
  dismissSkillSuggestion,
  listSkillSuggestions,
  markSkillSuggestionDrafted,
  upsertSkillSuggestions,
} from '../../skill-suggestions.js';

const router = Router();
const PROJECT_ROOT = process.cwd();
const MESSAGES_DB_PATH = path.join(STORE_DIR, 'messages.db');

interface SuggestedSkill {
  name: string;
  description: string;
  reason: string;
  confidence: number;
  evidenceCount: number;
  instructions: string;
  provenance: string[];
}

function sanitizeDraftName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function buildSkillDraftMarkdown(input: {
  name: string;
  description: string;
  instructions: string;
  allowedTools?: string;
}): string {
  const name = sanitizeDraftName(input.name);
  if (!name) throw new Error('Invalid skill name');
  const description = input.description.trim();
  if (!description) throw new Error('Description required');
  const instructions = input.instructions.trim();
  if (!instructions) throw new Error('Instructions required');

  const frontmatter = [
    '---',
    `name: ${name}`,
    `description: ${yamlScalar(description)}`,
  ];
  if (input.allowedTools?.trim()) {
    frontmatter.push(`allowed-tools: ${input.allowedTools.trim()}`);
  }
  frontmatter.push('---');

  const title = name
    .split('-')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
  return `${frontmatter.join('\n')}\n\n# ${title}\n\n${instructions}\n`;
}

function listInstalledSkillNames(): Set<string> {
  return new Set(listSkillRegistry().map((skill) => skill.path));
}

function keywordCount(messages: string[], patterns: RegExp[]): number {
  return messages.reduce(
    (count, content) =>
      count + (patterns.some((pattern) => pattern.test(content)) ? 1 : 0),
    0,
  );
}

function readRecentConversationText(limit = 400): string[] {
  if (!fs.existsSync(MESSAGES_DB_PATH)) return [];
  const db = new Database(MESSAGES_DB_PATH, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT content
         FROM messages
         WHERE content IS NOT NULL
           AND content != ''
           AND is_bot_message = 0
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(limit) as { content: string }[];
    return rows.map((row) => row.content);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function buildSkillSuggestions(): SuggestedSkill[] {
  const installed = listInstalledSkillNames();
  const drafted = new Set(listSkillDrafts().map((draft) => draft.name));
  const messages = readRecentConversationText();
  const candidates: Array<
    Omit<SuggestedSkill, 'evidenceCount' | 'confidence'> & {
      patterns: RegExp[];
      baseConfidence: number;
    }
  > = [
    {
      name: 'operation-planning',
      description:
        'Plan recurring operations from chat requests, participant counts, orders, and journal context.',
      reason:
        'Recent conversation mentions operations, attacks, fleets, planets, or alliance planning.',
      patterns: [
        /\b(operation|attack|fleet|planet|alliance|orders?|soldiers?)\b/i,
      ],
      baseConfidence: 0.74,
      instructions:
        'Use this skill when users coordinate recurring operations, attacks, fleet movements, participant lists, or orders. Extract participants, resources, timing, target, constraints, open questions, and risks. Prefer structured plans, cite source messages when available, and require explicit approval before sending orders or publishing plans.',
      provenance: ['source:recent-message-history', 'kind:history-suggestion'],
    },
    {
      name: 'personal-workflow-rules',
      description:
        'Capture repeated personal preferences and turn them into reusable operating rules.',
      reason:
        'Recent conversation includes durable preferences such as always/never/when I ask/use this.',
      patterns: [
        /\b(always|never|when i ask|use this|prefer|standard|default)\b/i,
      ],
      baseConfidence: 0.68,
      instructions:
        'Use this skill when the user gives durable preferences, repeated phrasing rules, language choices, formatting habits, or recurring workflow instructions. Summarize the candidate rule, ask whether it should become memory, a skill, or both, and create a skill draft only after consent.',
      provenance: ['source:recent-message-history', 'kind:history-suggestion'],
    },
    {
      name: 'dashboard-design-review',
      description:
        'Review dashboard screens for navigation, visual hierarchy, polish, and missing states.',
      reason:
        'Recent conversation mentions dashboard, UI, sidebar, logo, redesign, or visual changes.',
      patterns: [
        /\b(dashboard|sidebar|logo|ui|ux|redesign|design|icon|layout)\b/i,
      ],
      baseConfidence: 0.66,
      instructions:
        'Use this skill when reviewing or changing dashboard UI. Check navigation clarity, visual hierarchy, text fit, empty/loading/error states, responsiveness, icons, and consistency with the NanoCrab design language. Prefer concrete file-level suggestions and verify with browser screenshots when possible.',
      provenance: ['source:recent-message-history', 'kind:history-suggestion'],
    },
    {
      name: 'private-integration-triage',
      description:
        'Decide whether an integration belongs in core, as an optional preset, or as private runtime state.',
      reason:
        'Recent conversation discusses MCP servers, default skills, Docker containers, and private integrations.',
      patterns: [
        /\b(mcp|integration|docker|container|default setup|private|preset)\b/i,
      ],
      baseConfidence: 0.65,
      instructions:
        'Use this skill when assessing integrations. Classify each item as core default, optional preset, bundled skill, marketplace/plugin candidate, or private runtime-only state. Call out credentials, data sensitivity, required approvals, and whether the item should be committed to the repo.',
      provenance: ['source:recent-message-history', 'kind:history-suggestion'],
    },
  ];

  return candidates
    .map((candidate) => {
      const evidenceCount = keywordCount(messages, candidate.patterns);
      return {
        ...candidate,
        evidenceCount,
        confidence: Math.min(
          0.95,
          candidate.baseConfidence + Math.max(0, evidenceCount - 1) * 0.04,
        ),
      };
    })
    .filter(
      (candidate) =>
        candidate.evidenceCount > 0 &&
        !installed.has(candidate.name) &&
        !drafted.has(candidate.name),
    )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
}

router.get('/', (_req: Request, res: Response) => {
  res.json({ installed: listSkillRegistry(), available: [] });
});

router.get('/search', (req: Request, res: Response) => {
  const query = String(req.query.q || '').trim();
  if (!query) {
    res.status(400).json({ error: 'q query parameter required' });
    return;
  }
  res.json(
    scoreSkillsForRequest(query, {
      isMain: req.query.main !== 'false',
      limit: Math.min(parseInt(String(req.query.limit || '8'), 10) || 8, 30),
    }),
  );
});

router.get('/drafts', (req: Request, res: Response) => {
  const status =
    req.query.status === 'pending' ||
    req.query.status === 'approved' ||
    req.query.status === 'rejected'
      ? (req.query.status as SkillDraftStatus)
      : undefined;
  res.json(listSkillDrafts(status));
});

router.get('/suggestions', (_req: Request, res: Response) => {
  upsertSkillSuggestions(buildSkillSuggestions());
  res.json(listSkillSuggestions('suggested'));
});

router.post('/suggestions/:id/dismiss', (req: Request, res: Response) => {
  try {
    const suggestion = dismissSkillSuggestion(req.params.id as string);
    auditLog(req, 'skill_suggestion_dismissed', suggestion.name);
    res.json({ ok: true, suggestion });
  } catch (err) {
    res.status(404).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/drafts', (req: Request, res: Response) => {
  try {
    const {
      skillMd,
      name,
      description,
      instructions,
      allowedTools,
      createdBy,
      provenance,
      suggestionId,
    } = req.body || {};
    const markdown =
      typeof skillMd === 'string' && skillMd.trim()
        ? skillMd
        : buildSkillDraftMarkdown({
            name: String(name || ''),
            description: String(description || ''),
            instructions: String(instructions || ''),
            allowedTools:
              typeof allowedTools === 'string' ? allowedTools : undefined,
          });
    const draft = proposeSkillDraft({
      skillMd: markdown,
      createdBy: String(createdBy || 'dashboard'),
      provenance: Array.isArray(provenance)
        ? provenance.map((item) => String(item))
        : ['source:dashboard'],
    });
    if (typeof suggestionId === 'string' && suggestionId) {
      markSkillSuggestionDrafted(suggestionId, draft.id);
    }
    auditLog(req, 'skill_draft_created', draft.name);
    res.status(201).json({ ok: true, draft });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get('/drafts/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const draft = getSkillDraft(id);
  const content = getSkillDraftContent(id);
  if (!draft || content === undefined) {
    res.status(404).json({ error: 'Skill draft not found' });
    return;
  }
  res.json({ draft, content });
});

router.get('/drafts/:id/diff', (req: Request, res: Response) => {
  try {
    res.type('text/plain').send(getSkillDraftDiff(req.params.id as string));
  } catch (err) {
    res.status(404).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get('/drafts/:id/revisions', (req: Request, res: Response) => {
  try {
    res.json(listSkillDraftRevisions(req.params.id as string));
  } catch (err) {
    res.status(404).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.put('/drafts/:id', (req: Request, res: Response) => {
  try {
    const skillMd = String(req.body?.skillMd || '');
    if (!skillMd.trim()) {
      res.status(400).json({ error: 'skillMd is required' });
      return;
    }
    const draft = updateSkillDraft(req.params.id as string, {
      skillMd,
      updatedBy: String(req.body?.updatedBy || 'dashboard'),
    });
    auditLog(req, 'skill_draft_updated', draft.name);
    res.json({ ok: true, draft });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/drafts/:id/rollback', (req: Request, res: Response) => {
  try {
    const version = Number(req.body?.version);
    if (!Number.isInteger(version) || version < 1) {
      res.status(400).json({ error: 'valid revision version is required' });
      return;
    }
    const draft = rollbackSkillDraft(
      req.params.id as string,
      version,
      String(req.body?.rolledBackBy || 'dashboard'),
    );
    auditLog(req, 'skill_draft_rolled_back', `${draft.name}: v${version}`);
    res.json({ ok: true, draft });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/drafts/:id/approve', (req: Request, res: Response) => {
  try {
    const draft = approveSkillDraft(req.params.id as string);
    auditLog(req, 'skill_draft_approved', draft.name);
    res.json({ ok: true, draft });
  } catch (err) {
    res.status(404).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/drafts/:id/reject', (req: Request, res: Response) => {
  try {
    const draft = rejectSkillDraft(req.params.id as string);
    auditLog(req, 'skill_draft_rejected', draft.name);
    res.json({ ok: true, draft });
  } catch (err) {
    res.status(404).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// Get a single container skill's SKILL.md content
router.get('/:skillPath', (req: Request, res: Response) => {
  const skillPath = req.params.skillPath as string;
  if (!/^[a-z0-9-]+$/.test(skillPath)) {
    res.status(400).json({ error: 'Invalid skill name' });
    return;
  }
  const skillMd = path.join(
    PROJECT_ROOT,
    'container',
    'skills',
    skillPath,
    'SKILL.md',
  );
  if (!fs.existsSync(skillMd)) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }
  res.json({ content: fs.readFileSync(skillMd, 'utf-8') });
});

// Create a new container skill
router.post('/', (req: Request, res: Response) => {
  const { name, description, allowedTools, content } = req.body;
  if (!name || !description) {
    res.status(400).json({ error: 'Name and description required' });
    return;
  }

  // Sanitize folder name
  const folderName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!folderName) {
    res.status(400).json({ error: 'Invalid skill name' });
    return;
  }

  const skillDir = path.join(PROJECT_ROOT, 'container', 'skills', folderName);
  if (fs.existsSync(skillDir)) {
    res.status(409).json({ error: `Skill "${folderName}" already exists` });
    return;
  }

  // Build SKILL.md
  const frontmatter = ['---', `name: ${name}`, `description: ${description}`];
  if (allowedTools) frontmatter.push(`allowed-tools: ${allowedTools}`);
  frontmatter.push('---');

  const body = content || `\n# ${name}\n\n${description}\n`;
  const skillMd = frontmatter.join('\n') + '\n' + body;

  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd);

  auditLog(req, 'skill_created', folderName);
  logger.info({ skillName: folderName }, 'Container skill created');
  res.json({
    ok: true,
    path: folderName,
    message: 'Skill created. Rebuild container to activate.',
  });
});

// Update a container skill's SKILL.md
router.put('/:skillPath', (req: Request, res: Response) => {
  const skillPath = req.params.skillPath as string;
  if (!/^[a-z0-9-]+$/.test(skillPath)) {
    res.status(400).json({ error: 'Invalid skill name' });
    return;
  }

  const { content } = req.body;
  if (!content) {
    res.status(400).json({ error: 'Content required' });
    return;
  }

  const skillMd = path.join(
    PROJECT_ROOT,
    'container',
    'skills',
    skillPath,
    'SKILL.md',
  );
  if (!fs.existsSync(skillMd)) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }

  fs.writeFileSync(skillMd, content);
  auditLog(req, 'skill_updated', skillPath);
  res.json({ ok: true, message: 'Skill updated. Rebuild container to apply.' });
});

// Delete a container skill
router.delete('/:skillPath', (req: Request, res: Response) => {
  const skillPath = req.params.skillPath as string;
  if (!/^[a-z0-9-]+$/.test(skillPath)) {
    res.status(400).json({ error: 'Invalid skill name' });
    return;
  }

  const skillDir = path.join(PROJECT_ROOT, 'container', 'skills', skillPath);
  if (!fs.existsSync(skillDir)) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }

  fs.rmSync(skillDir, { recursive: true, force: true });
  auditLog(req, 'skill_deleted', skillPath);
  logger.info({ skillName: skillPath }, 'Container skill deleted');
  res.json({ ok: true, message: 'Skill deleted. Rebuild container to apply.' });
});

// Enable/disable a skill
router.put('/:skillPath/state', (req: Request, res: Response) => {
  const skillPath = req.params.skillPath as string;
  if (!/^[a-z0-9-]+$/.test(skillPath)) {
    res.status(400).json({ error: 'Invalid skill name' });
    return;
  }
  const { enabled, scope, visibility } = req.body || {};
  const patch: {
    enabled?: boolean;
    scope?: SkillScope;
    visibility?: SkillVisibility;
  } = {};
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be boolean' });
      return;
    }
    patch.enabled = enabled;
  }
  if (scope !== undefined) {
    if (scope !== 'all' && scope !== 'main' && scope !== 'channels') {
      res.status(400).json({ error: 'Invalid skill scope' });
      return;
    }
    patch.scope = scope;
  }
  if (visibility !== undefined) {
    if (
      visibility !== 'shared' &&
      visibility !== 'private' &&
      visibility !== 'system'
    ) {
      res.status(400).json({ error: 'Invalid skill visibility' });
      return;
    }
    patch.visibility = visibility;
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'No state changes provided' });
    return;
  }
  const state = updateSkillState(skillPath, patch);
  auditLog(
    req,
    'skill_state_updated',
    `${skillPath}: ${JSON.stringify(patch)}`,
  );
  res.json({
    ok: true,
    state,
    note: 'New and restarted containers will use the updated skill registry.',
  });
});

router.put('/:skillPath/toggle', (req: Request, res: Response) => {
  const skillPath = req.params.skillPath as string;
  if (!/^[a-z0-9-]+$/.test(skillPath)) {
    res.status(400).json({ error: 'Invalid skill name' });
    return;
  }
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be boolean' });
    return;
  }
  const state = updateSkillState(skillPath, { enabled });
  auditLog(req, enabled ? 'skill_enabled' : 'skill_disabled', skillPath);
  res.json({
    ok: true,
    state,
    note: 'New and restarted containers will use the updated skill registry.',
  });
});

export default router;
