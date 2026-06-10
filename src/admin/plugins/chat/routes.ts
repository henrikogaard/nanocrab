import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

import { STORE_DIR, ASSISTANT_NAME } from '../../../config.js';
import { getState } from '../../state.js';
import { auditLog } from '../../security.js';
import { logger } from '../../../logger.js';
import { broadcastMessage } from '../../websocket.js';

const router = Router();

// Send a message from the dashboard
router.post('/send', async (req: Request, res: Response) => {
  const { message, targetJid } = req.body;
  if (!message || !targetJid) {
    res.status(400).json({ error: 'message and targetJid required' });
    return;
  }

  const state = getState();
  const groups = state.registeredGroups();
  const group = groups[targetJid];
  if (!group) {
    res.status(404).json({ error: 'Group not registered' });
    return;
  }

  // Store the message in DB
  const db = new Database(path.join(STORE_DIR, 'messages.db'));
  try {
    const id = `dash-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const timestamp = new Date().toISOString();
    db.prepare(
      'INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      targetJid,
      'admin',
      'Admin (Dashboard)',
      message,
      timestamp,
      0,
      0,
    );

    // Broadcast to dashboard live feed
    broadcastMessage({
      sender_name: 'Admin (Dashboard)',
      content: message,
      chat_jid: targetJid,
      timestamp,
    });
  } finally {
    db.close();
  }

  // The message is now in the DB. The message loop will pick it up on next poll
  // and trigger the agent, just like a message from WhatsApp/Signal/Telegram.

  auditLog(req, 'chat_message_sent', `to: ${targetJid}`);
  logger.info({ targetJid }, 'Dashboard chat message sent');
  res.json({ ok: true });
});

// Voice message — receives audio blob, transcribes, sends as text
router.post('/voice', async (req: Request, res: Response) => {
  try {
    // Collect raw audio data
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      const buffer = Buffer.concat(chunks);

      // Save temp file
      const tmpFile = path.join('/tmp', `voice-${Date.now()}.ogg`);
      fs.writeFileSync(tmpFile, buffer);

      // Transcribe
      try {
        const { transcribeAudio } = await import('../../../transcription.js');
        const text = await transcribeAudio(tmpFile);
        fs.unlinkSync(tmpFile);

        if (!text) {
          res.json({ ok: false, error: 'Transcription failed' });
          return;
        }

        res.json({ ok: true, text });
      } catch (err) {
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          /* ok */
        }
        res.status(500).json({ error: 'Transcription failed' });
      }
    });
  } catch {
    res.status(500).json({ error: 'Failed to process voice' });
  }
});

export default router;
