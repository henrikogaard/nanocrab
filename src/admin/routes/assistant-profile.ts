import { Router, Request, Response } from 'express';

import {
  getAssistantProfile,
  saveAssistantAvatarSelection,
} from '../../assistant-profile.js';
import { requireRole } from '../middleware.js';
import { auditLog } from '../security.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(getAssistantProfile());
});

router.put(
  '/avatar',
  requireRole('admin'),
  (req: Request, res: Response): void => {
    try {
      const selectedAvatarId = String(req.body?.selectedAvatarId || '');
      const profile = saveAssistantAvatarSelection(selectedAvatarId);
      auditLog(req, 'assistant_avatar_changed', selectedAvatarId);
      res.json({ ok: true, profile });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

export default router;
