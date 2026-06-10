import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { auditLog } from '../security.js';
import { logger } from '../../logger.js';

import { STORE_DIR } from '../../config.js';
import {
  approveSkillDraft,
  getSkillDraft,
  getSkillDraftContent,
  getSkillDraftDiff,
  listSkillDrafts,
  rejectSkillDraft,
  SkillDraftStatus,
} from '../../skill-factory.js';

const router = Router();
const PROJECT_ROOT = process.cwd();
const SKILL_STATE_PATH = path.join(STORE_DIR, 'skill-state.json');

function loadSkillState(): Record<string, { enabled: boolean }> {
  try {
    return JSON.parse(fs.readFileSync(SKILL_STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSkillState(state: Record<string, { enabled: boolean }>): void {
  fs.mkdirSync(path.dirname(SKILL_STATE_PATH), { recursive: true });
  fs.writeFileSync(SKILL_STATE_PATH, JSON.stringify(state, null, 2));
}

export function isSkillEnabled(skillName: string): boolean {
  const state = loadSkillState();
  return state[skillName]?.enabled !== false; // default: enabled
}

router.get('/', (_req: Request, res: Response) => {
  const skillsDir = path.join(PROJECT_ROOT, 'container', 'skills');

  // Bundled skills that ship with NanoCrab.
  const CORE_SKILLS = [
    'agent-browser',
    'capabilities',
    'status',
    'slack-formatting',
  ];
  // Plugin-linked skills (managed by NanoCrab plugins)
  const PLUGIN_SKILLS = ['agent-messaging', 'google-workspace'];

  // Detect custom (gitignored) skills
  let gitIgnored: string[] = [];
  try {
    const output = execFileSync(
      'git',
      [
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--directory',
        'container/skills/',
      ],
      { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 5000 },
    );
    gitIgnored = output
      .split('\n')
      .filter(Boolean)
      .map((p) => p.replace('container/skills/', '').replace(/\/$/, ''));
  } catch {}

  // Installed skills
  const installed: {
    name: string;
    description: string;
    path: string;
    category: string;
    enabled: boolean;
  }[] = [];
  try {
    const dirs = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());
    for (const dir of dirs) {
      const skillMd = path.join(skillsDir, dir.name, 'SKILL.md');
      let name = dir.name;
      let description = '';
      if (fs.existsSync(skillMd)) {
        const content = fs.readFileSync(skillMd, 'utf-8');
        const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const fm = fmMatch[1];
          const nameMatch = fm.match(/^name:\s*(.+)$/m);
          const descMatch = fm.match(/^description:\s*(.+)$/m);
          if (nameMatch) name = nameMatch[1].trim();
          if (descMatch) description = descMatch[1].trim();
        }
      }
      const isCustom = gitIgnored.includes(dir.name);
      const category = isCustom
        ? 'custom'
        : CORE_SKILLS.includes(dir.name)
          ? 'core'
          : PLUGIN_SKILLS.includes(dir.name)
            ? 'plugin'
            : 'tool';
      const enabled = isSkillEnabled(dir.name);
      installed.push({ name, description, path: dir.name, category, enabled });
    }
  } catch {
    // skills dir may not exist
  }

  res.json({ installed, available: [] });
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
router.put('/:skillPath/toggle', (req: Request, res: Response) => {
  const skillPath = req.params.skillPath as string;
  if (!/^[a-z0-9-]+$/.test(skillPath)) {
    res.status(400).json({ error: 'Invalid skill name' });
    return;
  }
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled (boolean) required' });
    return;
  }
  const state = loadSkillState();
  state[skillPath] = { enabled };
  saveSkillState(state);
  auditLog(req, enabled ? 'skill_enabled' : 'skill_disabled', skillPath);
  res.json({ ok: true, note: 'Rebuild container to apply changes' });
});

export default router;
