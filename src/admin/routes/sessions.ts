import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { DATA_DIR } from '../../config.js';
import { listTerminalSessions } from '../websocket.js';

const router = Router();

interface SessionInfo {
  sessionId: string;
  group: string;
  startedAt: string;
  lastActivity: string;
  messageCount: number;
  filePath: string;
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const sessionsDir = path.join(DATA_DIR, 'sessions');
    if (!fs.existsSync(sessionsDir)) {
      res.json([]);
      return;
    }

    const sessions: SessionInfo[] = [];
    const groupDirs = fs.readdirSync(sessionsDir).filter((d) => {
      try {
        return fs.statSync(path.join(sessionsDir, d)).isDirectory();
      } catch {
        return false;
      }
    });

    for (const group of groupDirs) {
      let transcriptDir = path.join(
        sessionsDir,
        group,
        '.agents',
        'projects',
        '-workspace-group',
      );
      if (!fs.existsSync(transcriptDir)) {
        transcriptDir = path.join(
          sessionsDir,
          group,
          '.claude',
          'projects',
          '-workspace-group',
        );
      }
      if (!fs.existsSync(transcriptDir)) continue;

      const files = fs
        .readdirSync(transcriptDir)
        .filter((f) => f.endsWith('.jsonl'));

      for (const file of files) {
        const filePath = path.join(transcriptDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.size === 0) continue;

          // Read first and last line for timestamps
          const fd = fs.openSync(filePath, 'r');
          const buf = Buffer.alloc(Math.min(stat.size, 2048));
          fs.readSync(fd, buf, 0, buf.length, 0);
          const firstChunk = buf.toString('utf8');
          const firstLine = firstChunk.split('\n')[0];

          // Read last chunk for last line
          const tailBuf = Buffer.alloc(Math.min(stat.size, 2048));
          const tailOffset = Math.max(0, stat.size - tailBuf.length);
          fs.readSync(fd, tailBuf, 0, tailBuf.length, tailOffset);
          fs.closeSync(fd);
          const tailChunk = tailBuf.toString('utf8');
          const tailLines = tailChunk.split('\n').filter(Boolean);
          const lastLine = tailLines[tailLines.length - 1];

          let startedAt = '';
          let lastActivity = '';
          try {
            const first = JSON.parse(firstLine);
            startedAt = first.timestamp || '';
          } catch {}
          try {
            const last = JSON.parse(lastLine);
            lastActivity = last.timestamp || '';
          } catch {}

          // Count lines for message count
          let lineCount = 0;
          const content = fs.readFileSync(filePath, 'utf8');
          for (let i = 0; i < content.length; i++) {
            if (content[i] === '\n') lineCount++;
          }
          if (content.length > 0 && content[content.length - 1] !== '\n')
            lineCount++;

          const sessionId = file.replace('.jsonl', '');
          sessions.push({
            sessionId,
            group,
            startedAt,
            lastActivity,
            messageCount: lineCount,
            filePath: file,
          });
        } catch {
          // skip unreadable files
        }
      }
    }

    // Sort by last activity, newest first
    sessions.sort((a, b) =>
      (b.lastActivity || '').localeCompare(a.lastActivity || ''),
    );

    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

router.get('/terminal/active', (_req: Request, res: Response) => {
  res.json(listTerminalSessions());
});

router.get('/:group/:sessionId', async (req: Request, res: Response) => {
  try {
    const group = req.params.group as string;
    const sessionId = req.params.sessionId as string;
    let filePath = path.join(
      DATA_DIR,
      'sessions',
      group,
      '.agents',
      'projects',
      '-workspace-group',
      `${sessionId}.jsonl`,
    );
    if (!fs.existsSync(filePath)) {
      filePath = path.join(
        DATA_DIR,
        'sessions',
        group,
        '.claude',
        'projects',
        '-workspace-group',
        `${sessionId}.jsonl`,
      );
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const messages: Array<{
      role: string;
      content: string;
      timestamp: string;
      type: string;
      toolUse?: boolean;
    }> = [];

    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const ts = obj.timestamp || '';
        const type = obj.type || '';

        if (type === 'user' || type === 'human') {
          messages.push({
            role: 'user',
            content: obj.content || obj.message || JSON.stringify(obj),
            timestamp: ts,
            type,
          });
        } else if (type === 'assistant') {
          // Extract text from content blocks
          let text = '';
          if (typeof obj.message === 'string') {
            text = obj.message;
          } else if (Array.isArray(obj.message?.content)) {
            text = obj.message.content
              .filter((b: { type: string }) => b.type === 'text')
              .map((b: { text: string }) => b.text)
              .join('\n');
          } else if (typeof obj.content === 'string') {
            text = obj.content;
          } else if (Array.isArray(obj.content)) {
            text = obj.content
              .filter((b: { type: string }) => b.type === 'text')
              .map((b: { text: string }) => b.text)
              .join('\n');
          }

          const hasToolUse = Array.isArray(obj.message?.content)
            ? obj.message.content.some(
                (b: { type: string }) => b.type === 'tool_use',
              )
            : Array.isArray(obj.content)
              ? obj.content.some((b: { type: string }) => b.type === 'tool_use')
              : false;

          if (text || hasToolUse) {
            messages.push({
              role: 'assistant',
              content: text || '[Tool use only]',
              timestamp: ts,
              type,
              toolUse: hasToolUse || undefined,
            });
          }
        } else if (type === 'queue-operation' && obj.content) {
          messages.push({
            role: 'user',
            content: obj.content,
            timestamp: ts,
            type: 'queue',
          });
        }
      } catch {
        // skip malformed lines
      }
    }

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read session' });
  }
});

export default router;
