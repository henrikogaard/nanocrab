import { Router, Request, Response } from 'express';
import { execSync, spawn } from 'child_process';

import { auditLog } from '../security.js';
import { logger } from '../../logger.js';

const router = Router();
const PROJECT_ROOT = process.cwd();

router.get('/containers', (_req: Request, res: Response) => {
  try {
    const output = execSync(
      `docker ps -a --filter name=nanocrab --format '{"name":"{{.Names}}","status":"{{.Status}}","image":"{{.Image}}","created":"{{.CreatedAt}}","ports":"{{.Ports}}"}'`,
      { encoding: 'utf-8', timeout: 10000 },
    );
    const containers = output
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    res.json(containers);
  } catch {
    res.json([]);
  }
});

router.get('/images', (_req: Request, res: Response) => {
  try {
    const output = execSync(
      `docker images nanocrab-agent --format '{"repository":"{{.Repository}}","tag":"{{.Tag}}","size":"{{.Size}}","created":"{{.CreatedAt}}"}'`,
      { encoding: 'utf-8', timeout: 10000 },
    );
    const images = output
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    res.json(images);
  } catch {
    res.json([]);
  }
});

router.post('/rebuild', (req: Request, res: Response) => {
  auditLog(req, 'docker_rebuild', 'Container rebuild started');
  logger.info('Admin dashboard triggered container rebuild');

  const child = spawn('./container/build.sh', [], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  res.json({ ok: true, message: 'Rebuild started' });
});

export default router;
