import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { DATA_DIR, SESSIONS_DIR } from '../../config.js';
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

// GET /api/sessions/terminal/history — list all terminal sessions
router.get('/terminal/history', async (_req: Request, res: Response) => {
  try {
    const indexPath = path.join(SESSIONS_DIR, 'index.json');
    if (!fs.existsSync(indexPath)) {
      res.json([]);
      return;
    }
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const activeSessions = listTerminalSessions();
    const activeIds = new Set(activeSessions.filter(s => s.active).map(s => s.id));
    const history = index.map((entry: any) => ({
      ...entry,
      active: activeIds.has(entry.id),
    }));
    history.sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read session history' });
  }
});

// GET /api/sessions/terminal/:id/transcript — full transcript
router.get('/terminal/:id/transcript', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id as string;
    const logPath = path.join(SESSIONS_DIR, `${sessionId}.log`);
    if (!fs.existsSync(logPath)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const content = fs.readFileSync(logPath, 'utf-8');
    res.json({ id: sessionId, content });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read session transcript' });
  }
});

// POST /api/sessions/terminal/search — search across session logs
router.post('/terminal/search', async (req: Request, res: Response) => {
  try {
    const { query, sessionId, dateFrom, dateTo } = req.body as {
      query?: string;
      sessionId?: string;
      dateFrom?: string;
      dateTo?: string;
    };
    if (!query || !query.trim()) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const indexPath = path.join(SESSIONS_DIR, 'index.json');
    if (!fs.existsSync(indexPath)) {
      res.json({ results: [] });
      return;
    }
    const index: any[] = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const lowerQuery = query.toLowerCase();
    const results: Array<{
      sessionId: string;
      line: number;
      text: string;
      context: string;
    }> = [];

    const sessionsToSearch = sessionId
      ? index.filter(e => e.id === sessionId)
      : index;

    for (const entry of sessionsToSearch) {
      if (dateFrom && entry.createdAt && entry.createdAt < dateFrom) continue;
      if (dateTo && entry.createdAt && entry.createdAt > dateTo + 'T23:59:59Z') continue;

      const logPath = path.join(SESSIONS_DIR, `${entry.id}.log`);
      if (!fs.existsSync(logPath)) continue;

      const content = fs.readFileSync(logPath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          results.push({
            sessionId: entry.id,
            line: i + 1,
            text: lines[i],
            context: lines.slice(Math.max(0, i - 2), i + 3).join('\n'),
          });
        }
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/sessions/:group/:sessionId/detail — full session detail with stats + structured tool calls
router.get('/:group/:sessionId/detail', async (req: Request, res: Response) => {
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
      toolCalls?: Array<{
        id: string;
        name: string;
        input: string;
        output: string;
        duration: string;
      }>;
    }> = [];

    const pendingToolCalls = new Map<string, { name: string; input: string }>();
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let toolCount = 0;
    let model = '';

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
        if (!firstTimestamp) firstTimestamp = ts;
        lastTimestamp = ts;

        if (obj.type === 'user' || obj.type === 'human') {
          messages.push({
            role: 'user',
            content: obj.content || obj.message || JSON.stringify(obj),
            timestamp: ts,
            type: obj.type,
          });
        } else if (obj.type === 'assistant') {
          if (!model && obj.message?.model) {
            model = obj.message.model;
          }

          let text = '';
          const tc: Array<{
            id: string;
            name: string;
            input: string;
            output: string;
            duration: string;
          }> = [];

          const contentBlocks = Array.isArray(obj.message?.content)
            ? obj.message.content
            : Array.isArray(obj.content)
              ? obj.content
              : [];

          for (const block of contentBlocks) {
            if (block.type === 'text') {
              text += block.text || '';
            } else if (block.type === 'tool_use') {
              toolCount++;
              const toolId = block.id || block.tool_use_id || `tc_${toolCount}`;
              pendingToolCalls.set(toolId, {
                name: block.name || '',
                input: JSON.stringify(block.input || {}),
              });
              tc.push({
                id: toolId,
                name: block.name || '',
                input: JSON.stringify(block.input || {}),
                output: '',
                duration: '',
              });
            } else if (block.type === 'tool_result') {
              const toolId = block.tool_use_id || '';
              const pending = pendingToolCalls.get(toolId);
              if (pending) {
                pendingToolCalls.delete(toolId);
                tc.push({
                  id: toolId,
                  name: pending.name,
                  input: pending.input,
                  output: typeof block.content === 'string' ? block.content : JSON.stringify(block.content || ''),
                  duration: block.duration || '',
                });
              }
            }
          }

          const content = text || (tc.length > 0 ? '' : JSON.stringify(obj));

          if (content || tc.length > 0) {
            messages.push({
              role: 'assistant',
              content,
              timestamp: ts,
              type: obj.type,
              toolCalls: tc.length > 0 ? tc : undefined,
            });
          }
        } else if (obj.type === 'tool_result' && obj.message?.tool_use_id) {
          const toolId = obj.message.tool_use_id;
          const pending = pendingToolCalls.get(toolId);
          if (pending) {
            pendingToolCalls.delete(toolId);
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].role === 'assistant') {
                if (!messages[i].toolCalls) messages[i].toolCalls = [];
                messages[i].toolCalls!.push({
                  id: toolId,
                  name: pending.name,
                  input: pending.input,
                  output: typeof obj.message.content === 'string'
                    ? obj.message.content
                    : JSON.stringify(obj.message.content || ''),
                  duration: obj.message.duration || '',
                });
                break;
              }
            }
          }
        } else if (obj.type === 'queue-operation' && obj.content) {
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

    const duration = firstTimestamp && lastTimestamp
      ? Math.round((new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()) / 1000)
      : 0;

    res.json({
      id: sessionId,
      group,
      stats: {
        messageCount: messages.length,
        duration,
        toolCount,
        model: model || 'unknown',
        createdAt: firstTimestamp,
        endedAt: lastTimestamp,
      },
      messages,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read session detail' });
  }
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
