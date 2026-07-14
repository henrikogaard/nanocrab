/**
 * Standalone admin dashboard mock server.
 *
 * This serves the production dashboard frontend with sample API responses so
 * UI/UX work can happen locally without live channels, containers, secrets, or
 * deployment state.
 */
import { createServer } from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

import { handleMockApi, mockWsMessages } from './mock-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_ADMIN_PORT = parseInt(process.env.MOCK_ADMIN_PORT || '', 10) || 5173;

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', handleMockApi);

app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders(res, filePath) {
      if (
        filePath.endsWith('.js') ||
        filePath.endsWith('.css') ||
        filePath.endsWith('.html')
      ) {
        res.setHeader(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, proxy-revalidate',
        );
      }
    },
  }),
);

app.get('/health', (_req, res) => {
  res.json({ status: 'mock', mock: true });
});

app.get('{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  for (const message of mockWsMessages()) {
    ws.send(JSON.stringify(message));
  }

  ws.on('message', (raw) => {
    let payload: { type?: string; sessionId?: string; data?: string } = {};
    try {
      payload = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (payload.type === 'terminal_spawn') {
      ws.send(
        JSON.stringify({
          type: 'terminal_output',
          sessionId: payload.data,
          data: 'NanoCrab mock terminal\\n$ echo "No live commands are run in mock mode."\\nNo live commands are run in mock mode.\\n$ ',
        }),
      );
    }

    if (payload.type === 'terminal_input') {
      ws.send(
        JSON.stringify({
          type: 'terminal_output',
          sessionId: payload.sessionId,
          data: `\\n(mock) received ${JSON.stringify(payload.data || '')}\\n$ `,
        }),
      );
    }
  });
});

server.listen(MOCK_ADMIN_PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  NanoCrab mock admin dashboard');
  console.log(`  http://127.0.0.1:${MOCK_ADMIN_PORT}`);
  console.log('');
  console.log('  This is sample data only. No live services are touched.');
  console.log('');
});
