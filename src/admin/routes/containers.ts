import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getState } from '../state.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const state = getState();
  const containers = state.queue.getActiveContainers();
  res.json(containers);
});

router.get('/recent', (_req: Request, res: Response) => {
  const groupsDir = path.join(process.cwd(), 'groups');
  const results: Array<{
    filename: string;
    group: string;
    timestamp: string;
    size: number;
  }> = [];

  try {
    const groupFolders = fs.readdirSync(groupsDir).filter((d) => {
      try {
        return fs.statSync(path.join(groupsDir, d)).isDirectory();
      } catch {
        return false;
      }
    });

    for (const folder of groupFolders) {
      const logsDir = path.join(groupsDir, folder, 'logs');
      if (!fs.existsSync(logsDir)) continue;

      const logFiles = fs
        .readdirSync(logsDir)
        .filter((f) => f.startsWith('container-') && f.endsWith('.log'));

      for (const file of logFiles) {
        try {
          const stat = fs.statSync(path.join(logsDir, file));
          // Extract timestamp from filename: container-2026-04-06T23-19-36-719Z.log
          const tsMatch = file.match(
            /container-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z)\.log/,
          );
          const timestamp = tsMatch
            ? tsMatch[1].replace(
                /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d+)Z/,
                '$1T$2:$3:$4.$5Z',
              )
            : stat.mtime.toISOString();

          results.push({
            filename: file,
            group: folder,
            timestamp,
            size: stat.size,
          });
        } catch {
          // skip unreadable files
        }
      }
    }
  } catch {
    // groups dir doesn't exist
  }

  // Sort by timestamp descending, take last 10
  results.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  res.json(results.slice(0, 10));
});

export default router;
