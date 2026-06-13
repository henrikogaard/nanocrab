import { describe, expect, it } from 'vitest';
import express from 'express';
import http from 'http';
import { handleMockApi } from './mock-data.js';

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use('/api', handleMockApi);
  return server;
}

async function withServer<T>(
  handler: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer(app());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to allocate test server port');
  }
  try {
    return await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

describe('mock admin data', () => {
  it('serves complete cockpit summary states and rich approval detail', async () => {
    await withServer(async (baseUrl) => {
      const listResponse = await fetch(`${baseUrl}/api/sessions/cockpit`);
      const sessions = (await listResponse.json()) as Array<{
        id: string;
        status: string;
        artifactCount: number;
        approvalCount: number;
      }>;

      expect(sessions.map((session) => session.status).sort()).toEqual([
        'completed',
        'failed',
        'running',
        'waiting_approval',
      ]);
      expect(
        sessions.every((session) => Number.isInteger(session.artifactCount)),
      ).toBe(true);

      const detailResponse = await fetch(
        `${baseUrl}/api/sessions/cockpit/cockpit-approval-002`,
      );
      const detail = (await detailResponse.json()) as {
        timeline: unknown[];
        artifacts: Array<{ kind: string; path: string }>;
        deliverables: Array<{ status: string; sourceType: string }>;
        approvals: Array<{ status: string; risk: string; targetType: string }>;
      };

      expect(detail.timeline.length).toBeGreaterThanOrEqual(5);
      expect(detail.artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'approval-preview',
            path: 'data/approvals/cockpit-approval-002/preview.md',
          }),
        ]),
      );
      expect(detail.approvals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: 'pending',
            risk: 'high',
            targetType: 'message',
          }),
        ]),
      );
      expect(detail.deliverables).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: 'pending',
            sourceType: 'approval',
          }),
        ]),
      );
    });
  });

  it('serves session detail stats and tool calls for cockpit-linked sessions', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/sessions/operations/cockpit-approval-002/detail`,
      );
      const detail = (await response.json()) as {
        stats: {
          model: string;
          provider: string;
          messageCount: number;
          toolCount: number;
        };
        messages: Array<{ toolCalls?: unknown[] }>;
      };

      expect(detail.stats).toMatchObject({
        model: 'claude-sonnet-4-6',
        provider: 'claude',
        messageCount: 3,
        toolCount: 1,
      });
      expect(detail.messages.some((message) => message.toolCalls?.length)).toBe(
        true,
      );
    });
  });

  it('keeps mock write requests read-safe', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/sessions/cockpit/cockpit-approval-002`,
        { method: 'POST' },
      );
      const body = (await response.json()) as {
        ok: boolean;
        mock: boolean;
        message: string;
      };

      expect(body).toMatchObject({
        ok: true,
        mock: true,
        message: 'Mock write accepted. No live data changed.',
      });
    });
  });

  it('serves terminal history and searchable transcripts in mock mode', async () => {
    await withServer(async (baseUrl) => {
      const historyResponse = await fetch(
        `${baseUrl}/api/sessions/terminal/history`,
      );
      const history = (await historyResponse.json()) as Array<{
        id: string;
        owner: string;
      }>;

      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'mock-terminal-main',
            owner: 'mock-owner',
          }),
        ]),
      );

      const searchResponse = await fetch(
        `${baseUrl}/api/sessions/terminal/search`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: 'deliverables' }),
        },
      );
      const search = (await searchResponse.json()) as {
        results: Array<{ sessionId: string; text: string }>;
      };

      expect(search.results).toEqual([
        expect.objectContaining({
          sessionId: 'mock-terminal-main',
          text: expect.stringContaining('deliverables'),
        }),
      ]);
    });
  });
});
