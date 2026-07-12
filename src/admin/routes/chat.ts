import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { broadcastApprovalResult } from '../websocket.js';
import { getState } from '../state.js';

const router = Router();

router.post('/approve', (req: Request, res: Response) => {
  const { approvalId, groupJid, approved } = req.body as {
    approvalId: string;
    groupJid: string;
    approved: boolean;
  };

  if (!approvalId || !groupJid) {
    res.status(400).json({ error: 'approvalId and groupJid are required' });
    return;
  }

  const state = getState();
  const groups = state.registeredGroups?.() ?? {};
  const group = groups[groupJid];
  if (!group) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }

  try {
    const groupFolder = group.folder || groupJid;
    const approvalDir = path.join(
      process.cwd(),
      'data',
      'runtime-skills',
      groupFolder,
      '.approval',
    );
    fs.mkdirSync(approvalDir, { recursive: true });
    const resultFile = path.join(approvalDir, `${approvalId}.result`);
    fs.writeFileSync(resultFile, approved ? 'approved' : 'denied', 'utf-8');

    broadcastApprovalResult({ id: approvalId, groupJid, approved });
    res.json({ ok: true, approved });
  } catch (_err) {
    res.status(500).json({ error: 'Failed to process approval' });
  }
});

export default router;
