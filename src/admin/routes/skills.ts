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
  approveSkillSuggestion,
  approveSkillDraft,
  detectAndQueueSkillSuggestions,
  getSkillDraft,
  getSkillDraftContent,
  getSkillDraftDiff,
  listSkillSuggestions,
  listSkillDrafts,
  proposeSkillDraft,
  rejectSkillDraft,
  SkillDraftStatus,
  SkillSuggestionStatus,
} from '../../skill-factory.js';
import { getAllTasks } from '../../db.js';
import { findSkillWorthyJournalPatterns } from '../../journal-store.js';

const router = Router();
const PROJECT_ROOT = process.cwd();
const MESSAGES_DB_PATH = path.join(STORE_DIR, 'messages.db');

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

function readTaskPromptText(limit = 200): string[] {
  return getAllTasks()
    .slice(0, limit)
    .map((task) => task.prompt)
    .filter(Boolean);
}

function readJournalSuggestionText(): string[] {
  try {
    return findSkillWorthyJournalPatterns({ limit: 200 }).flatMap(
      (pattern) => pattern.examples,
    );
  } catch {
    return [];
  }
}

function refreshSkillSuggestionQueue(): void {
  const messages = readRecentConversationText();
  const tasks = readTaskPromptText();
  const journal = readJournalSuggestionText();
  if (messages.length === 0 && tasks.length === 0 && journal.length === 0) {
    return;
  }
  const installed = listInstalledSkillNames();
  detectAndQueueSkillSuggestions({
    messages,
    tasks,
    journal,
    createdBy: 'history-detector',
    existingSkillNames: [...installed],
  });
}

function parseSuggestionDecision(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return 'create-draft';
  }
  if (value === 'create-draft' || value === 'reject' || value === 'defer') {
    return value;
  }
  throw new Error('suggestion decision must be create-draft, reject, or defer');
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

router.get('/suggestions', (req: Request, res: Response) => {
  refreshSkillSuggestionQueue();
  const status =
    req.query.status === 'pending' ||
    req.query.status === 'approved' ||
    req.query.status === 'rejected'
      ? (req.query.status as SkillSuggestionStatus)
      : undefined;
  res.json(listSkillSuggestions({ status }));
});

router.post('/suggestions/:id/approve', (req: Request, res: Response) => {
  try {
    const suggestion = approveSkillSuggestion(req.params.id as string, {
      decidedBy: String(req.body?.decidedBy || 'dashboard'),
      decision: parseSuggestionDecision(req.body?.decision),
    });
    auditLog(req, 'skill_suggestion_approved', suggestion.proposedSkillName);
    res.json({ ok: true, suggestion });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 400;
    res.status(status).json({
      error: message,
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
