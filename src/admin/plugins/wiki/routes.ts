import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { auditLog } from '../../security.js';

const router = Router();
const PROJECT_ROOT = process.cwd();

function wikiDir(): string {
  const dir = path.join(PROJECT_ROOT, 'groups', 'global', 'wiki');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeName(name: string): string {
  // Ensure .md extension and prevent path traversal
  const base = path.basename(name).replace(/[^a-zA-Z0-9_-]/g, '-');
  return base.endsWith('.md') ? base : base + '.md';
}

// List all wiki pages
router.get('/', (_req: Request, res: Response) => {
  try {
    const dir = wikiDir();
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const filePath = path.join(dir, f);
        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        const titleMatch = content.match(/^#\s+(.+)$/m);
        return {
          name: f,
          title: titleMatch ? titleMatch[1] : f.replace('.md', ''),
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };
      })
      .sort(
        (a, b) =>
          new Date(b.modified).getTime() - new Date(a.modified).getTime(),
      );
    res.json(files);
  } catch {
    res.json([]);
  }
});

// Search across all wiki pages
router.get('/search', (req: Request, res: Response) => {
  const q = ((req.query.q as string) || '').toLowerCase().trim();
  if (!q || q.length < 2) {
    res.json([]);
    return;
  }
  try {
    const dir = wikiDir();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    const results: {
      name: string;
      title: string;
      snippet: string;
      modified: string;
    }[] = [];
    for (const f of files) {
      const content = fs.readFileSync(path.join(dir, f), 'utf-8');
      const lower = content.toLowerCase();
      const idx = lower.indexOf(q);
      if (idx !== -1 || f.toLowerCase().includes(q)) {
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const snippet =
          idx !== -1
            ? content.slice(Math.max(0, idx - 40), idx + q.length + 60)
            : '';
        const stat = fs.statSync(path.join(dir, f));
        results.push({
          name: f,
          title: titleMatch ? titleMatch[1] : f.replace('.md', ''),
          snippet,
          modified: stat.mtime.toISOString(),
        });
      }
    }
    res.json(results);
  } catch {
    res.json([]);
  }
});

// Read a wiki page
router.get('/:name', (req: Request, res: Response) => {
  const name = sanitizeName(req.params.name as string);
  const filePath = path.join(wikiDir(), name);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Page not found' });
    return;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const stat = fs.statSync(filePath);
  res.json({ name, content, modified: stat.mtime.toISOString() });
});

// Create/update a wiki page
router.put('/:name', (req: Request, res: Response) => {
  const name = sanitizeName(req.params.name as string);
  const { content } = req.body;
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'Content is required' });
    return;
  }
  const filePath = path.join(wikiDir(), name);
  const isNew = !fs.existsSync(filePath);
  fs.writeFileSync(filePath, content, 'utf-8');
  auditLog(req, isNew ? 'wiki_create' : 'wiki_update', `page: ${name}`);
  res.json({ ok: true, name, message: isNew ? 'Page created' : 'Page saved' });
});

// Delete a wiki page
router.delete('/:name', (req: Request, res: Response) => {
  const name = sanitizeName(req.params.name as string);
  const filePath = path.join(wikiDir(), name);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Page not found' });
    return;
  }
  fs.unlinkSync(filePath);
  auditLog(req, 'wiki_delete', `page: ${name}`);
  res.json({ ok: true, message: 'Page deleted' });
});

export default router;
