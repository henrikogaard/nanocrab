import { Router, Request, Response } from 'express';

import { createOperationReminder } from '../../operation-reminders.js';
import { requireRole } from '../middleware.js';
import { auditLog } from '../security.js';

const router = Router();

router.post(
  '/reminders',
  requireRole('admin'),
  (req: Request, res: Response) => {
    try {
      const task = createOperationReminder({
        groupFolder: req.body.groupFolder,
        title: req.body.title,
        order: req.body.order,
        scheduleType: req.body.scheduleType,
        scheduleValue: req.body.scheduleValue,
        audience: req.body.audience,
        requireConfirmation: req.body.requireConfirmation === true,
      });
      auditLog(req, 'operation_reminder_created', task.id);
      res.json({ ok: true, task });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

export default router;
