import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { isValidGroupFolder } from '../../group-folder.js';

const router = Router();
const PROJECT_ROOT = process.cwd();

router.get('/system', (req: Request, res: Response) => {
  const logFile = path.join(PROJECT_ROOT, 'logs', 'nanocrab.log');
  const lines = Math.min(parseInt(req.query.lines as string) || 100, 500);
  try {
    const content = fs.readFileSync(logFile, 'utf-8');
    const allLines = content.split('\n');
    res.json({ lines: allLines.slice(-lines) });
  } catch {
    res.json({ lines: [] });
  }
});

router.get('/errors', (req: Request, res: Response) => {
  const logFile = path.join(PROJECT_ROOT, 'logs', 'nanocrab.error.log');
  const lines = Math.min(parseInt(req.query.lines as string) || 100, 500);
  try {
    const content = fs.readFileSync(logFile, 'utf-8');
    const allLines = content.split('\n');
    res.json({ lines: allLines.slice(-lines) });
  } catch {
    res.json({ lines: [] });
  }
});

router.get('/:groupFolder', (req: Request, res: Response) => {
  const groupFolder = req.params.groupFolder as string;
  if (!isValidGroupFolder(groupFolder)) {
    res.status(400).json({ error: 'Invalid group folder' });
    return;
  }

  const logsDir = path.join(PROJECT_ROOT, 'groups', groupFolder, 'logs');
  try {
    if (!fs.existsSync(logsDir)) {
      res.json([]);
      return;
    }
    const files = fs
      .readdirSync(logsDir)
      .filter((f: string) => f.endsWith('.log'))
      .sort()
      .reverse()
      .slice(0, 50);
    res.json(
      files.map((f: string) => ({
        name: f,
        size: fs.statSync(path.join(logsDir, f)).size,
      })),
    );
  } catch {
    res.json([]);
  }
});

router.get('/:groupFolder/:filename', (req: Request, res: Response) => {
  const groupFolder = req.params.groupFolder as string;
  const filename = req.params.filename as string;
  if (!isValidGroupFolder(groupFolder)) {
    res.status(400).json({ error: 'Invalid group folder' });
    return;
  }
  if (
    filename.includes('..') ||
    filename.includes('/') ||
    !filename.endsWith('.log')
  ) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  const filePath = path.join(
    PROJECT_ROOT,
    'groups',
    groupFolder,
    'logs',
    filename,
  );
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(-500);
    res.json({ lines });
  } catch {
    res.status(404).json({ error: 'Log file not found' });
  }
});

export default router;
