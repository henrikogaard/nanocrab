import { Router, Request, Response } from 'express';

import { fetchGitHubCheckStatus } from '../../github-checks.js';
import { getGitHubToken } from '../../coding-jobs.js';
import { logger } from '../../logger.js';

const router = Router();

router.get('/checks', async (req: Request, res: Response) => {
  const owner =
    typeof req.query.owner === 'string' ? req.query.owner : '';
  const repo =
    typeof req.query.repo === 'string' ? req.query.repo : '';
  const ref =
    (typeof req.query.ref === 'string' ? req.query.ref : '') ||
    (typeof req.query.branch === 'string' ? req.query.branch : '');
  const branch =
    typeof req.query.branch === 'string' ? req.query.branch : undefined;

  if (!owner || !repo || !ref) {
    res
      .status(400)
      .json({ error: 'owner, repo, and ref (or branch) are required' });
    return;
  }

  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    res.status(400).json({ error: 'owner and repo must be safe identifiers' });
    return;
  }

  const token = getGitHubToken();
  if (!token) {
    res.status(503).json({ error: 'GitHub token is not configured' });
    return;
  }

  try {
    const result = await fetchGitHubCheckStatus(owner, repo, ref, token, {
      branch,
    });
    if (result.rateLimited) {
      res.status(429).json(result);
      return;
    }
    if (result.status === 'unknown' && result.error) {
      res.status(500).json({
        ...result,
        error: 'Could not retrieve GitHub check status',
      });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error(
      { err, owner, repo, ref },
      'GitHub check status route failed',
    );
    res.status(500).json({ error: 'Could not retrieve GitHub check status' });
  }
});

export default router;
