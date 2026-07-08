import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR, STORE_DIR } from '../../config.js';
import {
  createCoworkContextItem,
  getAllRegisteredGroups,
  getCoworkProject,
  touchCoworkProject,
} from '../../db.js';
import {
  safeCoworkProjectFilePath,
  writeCoworkProjectFile,
} from '../../cowork-projects.js';
import { isValidGroupFolder } from '../../group-folder.js';
import {
  AGENT_INSTRUCTIONS_FILE,
  CLAUDE_COMPAT_FILE,
  agentInstructionsPath,
  claudeCompatPath,
  readAgentInstructions,
  writeAgentInstructions,
} from '../../agent-instructions.js';
import { auditLog } from '../security.js';

const router = Router();
const PROJECT_ROOT = process.cwd();
const GLOBAL_INSTRUCTIONS_DIR = path.join(GROUPS_DIR, 'global');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '__pycache__',
  '.next',
  'vendor',
  '.cache',
  'coverage',
  '.turbo',
  'build',
]);

function buildFileTree(
  dir: string,
  depth = 0,
  maxDepth = 4,
): Array<{ name: string; type: string; children?: unknown[] }> {
  if (depth >= maxDepth) return [];
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
      .sort(
        (a, b) =>
          (b.isDirectory() ? 1 : 0) - (a.isDirectory() ? 1 : 0) ||
          a.name.localeCompare(b.name),
      )
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        children: e.isDirectory()
          ? buildFileTree(path.join(dir, e.name), depth + 1, maxDepth)
          : undefined,
      }));
  } catch {
    return [];
  }
}

function findRepo(
  repoName: string,
): { hostPath: string; readonly: boolean } | null {
  const groups = getAllRegisteredGroups();
  for (const group of Object.values(groups)) {
    for (const mount of group.containerConfig?.additionalMounts || []) {
      const hostPath = mount.hostPath.replace(
        /^~/,
        process.env.HOME || '/root',
      );
      const name = mount.containerPath || path.basename(hostPath);
      if (name === repoName) {
        return { hostPath, readonly: mount.readonly !== false };
      }
    }
  }
  return null;
}

// List mounted repos
router.get('/repos', (_req: Request, res: Response) => {
  const groups = getAllRegisteredGroups();
  const repos: Array<{
    name: string;
    hostPath: string;
    readonly: boolean;
    group: string;
  }> = [];
  const seen = new Set<string>();
  for (const [, group] of Object.entries(groups)) {
    for (const mount of group.containerConfig?.additionalMounts || []) {
      const hostPath = mount.hostPath.replace(
        /^~/,
        process.env.HOME || '/root',
      );
      if (seen.has(hostPath)) continue;
      seen.add(hostPath);
      repos.push({
        name: mount.containerPath || path.basename(hostPath),
        hostPath,
        readonly: mount.readonly !== false,
        group: group.folder,
      });
    }
  }
  res.json(repos);
});

// File tree
router.get('/repos/:repoName/tree', (req: Request, res: Response) => {
  const repo = findRepo(req.params.repoName as string);
  if (!repo) {
    res.status(404).json({ error: 'Repo not found' });
    return;
  }
  res.json(buildFileTree(repo.hostPath));
});

// Validate a file path stays within the repo boundary
function validateRepoPath(repoRoot: string, filePath: string): string | null {
  const fullPath = path.resolve(repoRoot, filePath);
  const relative = path.relative(repoRoot, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return fullPath;
}

// Read file
router.get('/repos/:repoName/file', (req: Request, res: Response) => {
  const repo = findRepo(req.params.repoName as string);
  if (!repo) {
    res.status(404).json({ error: 'Repo not found' });
    return;
  }
  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  const fullPath = validateRepoPath(repo.hostPath, filePath);
  if (!fullPath) {
    res.status(403).json({ error: 'Path traversal denied' });
    return;
  }
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > 10 * 1024 * 1024) {
      res.status(413).json({ error: 'File too large (max 10MB)' });
      return;
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    res.json({ content, readonly: repo.readonly });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

// Write file
router.put('/repos/:repoName/file', (req: Request, res: Response) => {
  const repo = findRepo(req.params.repoName as string);
  if (!repo) {
    res.status(404).json({ error: 'Repo not found' });
    return;
  }
  if (repo.readonly) {
    res.status(403).json({ error: 'Mount is read-only' });
    return;
  }
  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  const fullPath = validateRepoPath(repo.hostPath, filePath);
  if (!fullPath) {
    res.status(403).json({ error: 'Path traversal denied' });
    return;
  }
  const { content } = req.body;
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'Content required' });
    return;
  }
  try {
    fs.writeFileSync(fullPath, content);
    auditLog(req, 'repo_file_edit', `${req.params.repoName}/${filePath}`);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// Git status
router.get('/repos/:repoName/git', (req: Request, res: Response) => {
  const repo = findRepo(req.params.repoName as string);
  if (!repo) {
    res.status(404).json({ error: 'Repo not found' });
    return;
  }
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: repo.hostPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    const log = execFileSync('git', ['log', '--oneline', '-10'], {
      cwd: repo.hostPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: repo.hostPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    res.json({
      status: status.split('\n').filter(Boolean),
      log: log.split('\n').filter(Boolean),
      branch,
    });
  } catch {
    res.json({ status: [], log: [], branch: '' });
  }
});

// Group files list
router.get('/', (_req: Request, res: Response) => {
  try {
    const dirs = fs
      .readdirSync(GROUPS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory());
    const groups = dirs.map((d) => {
      const groupPath = path.join(GROUPS_DIR, d.name);
      return {
        name: d.name,
        path: groupPath,
        hasAgentsMd: fs.existsSync(agentInstructionsPath(groupPath)),
        hasClaudeMd: fs.existsSync(claudeCompatPath(groupPath)),
        hasMemoryMd: fs.existsSync(path.join(groupPath, 'MEMORY.md')),
        hasConversations: fs.existsSync(path.join(groupPath, 'conversations')),
        hasAttachments: fs.existsSync(path.join(groupPath, 'attachments')),
        hasArtifacts: fs.existsSync(path.join(groupPath, 'artifacts')),
      };
    });
    res.json(groups);
  } catch {
    res.json([]);
  }
});

function getInstructions(req: Request, res: Response): void {
  const folder = req.params.groupFolder as string;
  if (!isValidGroupFolder(folder)) {
    res.status(400).json({ error: 'Invalid group folder' });
    return;
  }
  try {
    const groupDir = path.join(GROUPS_DIR, folder);
    const content = readAgentInstructions(groupDir);
    res.json({
      content,
      file: fs.existsSync(agentInstructionsPath(groupDir))
        ? AGENT_INSTRUCTIONS_FILE
        : CLAUDE_COMPAT_FILE,
    });
  } catch {
    res.json({ content: '' });
  }
}

function putInstructions(req: Request, res: Response): void {
  const folder = req.params.groupFolder as string;
  if (!isValidGroupFolder(folder)) {
    res.status(400).json({ error: 'Invalid group folder' });
    return;
  }
  const { content } = req.body;
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'Content must be a string' });
    return;
  }
  try {
    writeAgentInstructions(path.join(GROUPS_DIR, folder), content);
    auditLog(req, 'file_edit', `Updated AGENTS.md for ${folder}`);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to write file' });
  }
}

router.get('/global/agents-md', (_req: Request, res: Response) => {
  try {
    res.json({
      content: readAgentInstructions(GLOBAL_INSTRUCTIONS_DIR),
      file: fs.existsSync(agentInstructionsPath(GLOBAL_INSTRUCTIONS_DIR))
        ? AGENT_INSTRUCTIONS_FILE
        : CLAUDE_COMPAT_FILE,
    });
  } catch {
    res.json({ content: '' });
  }
});

router.put('/global/agents-md', (req: Request, res: Response) => {
  const { content } = req.body;
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'Content must be a string' });
    return;
  }
  try {
    writeAgentInstructions(GLOBAL_INSTRUCTIONS_DIR, content);
    auditLog(req, 'file_edit', 'Updated global AGENTS.md');
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to write file' });
  }
});

router.get('/:groupFolder/agents-md', getInstructions);
router.put('/:groupFolder/agents-md', putInstructions);
router.get('/:groupFolder/claude-md', getInstructions);
router.put('/:groupFolder/claude-md', putInstructions);

router.get('/:groupFolder/conversations', (req: Request, res: Response) => {
  const folder = req.params.groupFolder as string;
  if (!isValidGroupFolder(folder)) {
    res.status(400).json({ error: 'Invalid group folder' });
    return;
  }
  const convDir = path.join(GROUPS_DIR, folder, 'conversations');
  try {
    const files = fs
      .readdirSync(convDir)
      .filter((f) => !f.startsWith('.'))
      .map((f) => {
        const stat = fs.statSync(path.join(convDir, f));
        return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
      });
    res.json(files);
  } catch {
    res.json([]);
  }
});

router.get(
  '/:groupFolder/conversations/:filename',
  (req: Request, res: Response) => {
    const folder = req.params.groupFolder as string;
    const filename = req.params.filename as string;
    if (!isValidGroupFolder(folder)) {
      res.status(400).json({ error: 'Invalid group folder' });
      return;
    }
    if (filename.includes('..') || filename.includes('/')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }
    const filePath = path.join(GROUPS_DIR, folder, 'conversations', filename);
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 10 * 1024 * 1024) {
        res.status(413).json({ error: 'File too large (max 10MB)' });
        return;
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      res.json({ content });
    } catch {
      res.status(404).json({ error: 'File not found' });
    }
  },
);

router.get('/:groupFolder/attachments', (req: Request, res: Response) => {
  const folder = req.params.groupFolder as string;
  if (!isValidGroupFolder(folder)) {
    res.status(400).json({ error: 'Invalid group folder' });
    return;
  }
  const attDir = path.join(GROUPS_DIR, folder, 'attachments');
  try {
    const files = fs
      .readdirSync(attDir)
      .filter((f) => !f.startsWith('.'))
      .map((f) => {
        const stat = fs.statSync(path.join(attDir, f));
        return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
      });
    res.json(files);
  } catch {
    res.json([]);
  }
});

router.get('/:groupFolder/artifacts', (req: Request, res: Response) => {
  const folder = req.params.groupFolder as string;
  if (!isValidGroupFolder(folder)) {
    res.status(400).json({ error: 'Invalid group folder' });
    return;
  }
  const artifactsDir = path.join(GROUPS_DIR, folder, 'artifacts');
  try {
    const files = fs
      .readdirSync(artifactsDir)
      .filter((f) => !f.startsWith('.'))
      .map((f) => {
        const stat = fs.statSync(path.join(artifactsDir, f));
        return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
      });
    res.json(files);
  } catch {
    res.json([]);
  }
});

router.post(
  '/:groupFolder/artifacts/:filename/promote',
  (req: Request, res: Response) => {
    const folder = req.params.groupFolder as string;
    const filename = req.params.filename as string;
    if (!isValidGroupFolder(folder)) {
      res.status(400).json({ error: 'Invalid group folder' });
      return;
    }
    if (filename.includes('..') || filename.includes('/')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const projectId =
      typeof req.body.projectId === 'string' ? req.body.projectId.trim() : '';
    if (!projectId) {
      res.status(400).json({ error: 'Project id required' });
      return;
    }
    const project = getCoworkProject(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const targetPath = safeCoworkProjectFilePath(
      typeof req.body.path === 'string' && req.body.path.trim()
        ? req.body.path
        : `artifacts/${filename}`,
    );
    if (!targetPath) {
      res.status(400).json({ error: 'Invalid project file path' });
      return;
    }

    const sourcePath = path.join(GROUPS_DIR, folder, 'artifacts', filename);
    try {
      const content = fs.readFileSync(sourcePath, 'utf-8');
      const file = writeCoworkProjectFile(project, targetPath, content);
      const now = new Date().toISOString();
      const contextItem = createCoworkContextItem({
        id: `ctx-${randomUUID()}`,
        project_id: project.id,
        type: 'artifact',
        title: filename,
        path: file.path,
        url: null,
        thread_id: null,
        artifact_id: `group-artifact:${folder}/${filename}`,
        included: 1,
        pinned: 0,
        provenance: 'manual-upload',
        sensitivity: 'normal',
        created_at: now,
        updated_at: now,
      });
      touchCoworkProject(project.id, now);
      auditLog(
        req,
        'group_artifact_promoted',
        `${folder}/artifacts/${filename} -> ${project.id}/${file.path}`,
      );
      res.json({
        file,
        contextItem,
        provenance: {
          sourceGroup: folder,
          sourceArtifact: filename,
          originalPath: sourcePath,
          promotedAt: now,
        },
      });
    } catch (err) {
      res.status(fs.existsSync(sourcePath) ? 500 : 404).json({
        error: fs.existsSync(sourcePath)
          ? 'Failed to promote artifact'
          : 'Artifact not found',
      });
    }
  },
);

// Shared memory file
router.get('/memory', (_req: Request, res: Response) => {
  const memPath = path.join(GROUPS_DIR, 'global', 'MEMORY.md');
  try {
    const content = fs.readFileSync(memPath, 'utf-8');
    res.json({ content });
  } catch {
    res.json({ content: '' });
  }
});

router.put('/memory', (req: Request, res: Response) => {
  const { content } = req.body;
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'Content must be a string' });
    return;
  }
  const memPath = path.join(GROUPS_DIR, 'global', 'MEMORY.md');
  try {
    // Save previous content to history
    try {
      const previous = fs.readFileSync(memPath, 'utf-8');
      const historyPath = path.join(STORE_DIR, 'memory-history.jsonl');
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        content: previous,
      });
      fs.appendFileSync(historyPath, entry + '\n');
    } catch {
      /* no previous content */
    }

    fs.mkdirSync(path.dirname(memPath), { recursive: true });
    fs.writeFileSync(memPath, content, 'utf-8');
    auditLog(req, 'memory_edit', 'Updated shared MEMORY.md');
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// Download/view a file (attachments, conversations, or artifacts)
router.get(
  '/:groupFolder/download/:type/:filename',
  (req: Request, res: Response) => {
    const folder = req.params.groupFolder as string;
    const type = req.params.type as string;
    const filename = req.params.filename as string;

    if (!isValidGroupFolder(folder)) {
      res.status(400).json({ error: 'Invalid group folder' });
      return;
    }
    if (!['attachments', 'conversations', 'artifacts'].includes(type)) {
      res.status(400).json({ error: 'Invalid file type' });
      return;
    }
    if (filename.includes('..') || filename.includes('/')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const filePath = path.join(GROUPS_DIR, folder, type, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Set appropriate content type
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.aac': 'audio/aac',
      '.pdf': 'application/pdf',
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.csv': 'text/csv',
      '.docx':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    // Inline for viewable types, attachment for others
    const viewable = [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.webp',
      '.svg',
      '.pdf',
      '.mp4',
      '.webm',
      '.mp3',
      '.ogg',
      '.txt',
      '.md',
      '.json',
      '.csv',
    ];
    const disposition = viewable.includes(ext) ? 'inline' : 'attachment';

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${filename}"`,
    );
    fs.createReadStream(filePath).pipe(res);
  },
);

export default router;
