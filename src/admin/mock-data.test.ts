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

      const streamResponse = await fetch(
        `${baseUrl}/api/sessions/cockpit/cockpit-approval-002/stream`,
      );
      const stream = (await streamResponse.json()) as {
        events: Array<{ type: string; pct?: number; toolName?: string }>;
      };

      expect(stream.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_call',
            toolName: 'write_file',
          }),
          expect.objectContaining({ type: 'progress', pct: 80 }),
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

  it('serves default connector skills in mock mode', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/skills`);
      const data = (await response.json()) as {
        installed: Array<{
          path: string;
          category: string;
          riskLevel: string;
          triggers: string[];
          requiredTools: string[];
        }>;
      };

      const connectorSkills = data.installed.filter((skill) =>
        [
          'connector-catalog',
          'github-connector',
          'drive-files-connector',
          'browser-connector',
        ].includes(skill.path),
      );

      expect(connectorSkills).toHaveLength(4);
      expect(
        connectorSkills.every((skill) => skill.category === 'plugin'),
      ).toBe(true);
      expect(connectorSkills).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'github-connector',
            riskLevel: 'medium',
            requiredTools: expect.arrayContaining(['mcp__github__*']),
          }),
          expect.objectContaining({
            path: 'drive-files-connector',
            triggers: expect.arrayContaining(['drive', 'files']),
          }),
        ]),
      );
    });
  });

  it('serves operation schedules in mock mode without live mutation', async () => {
    await withServer(async (baseUrl) => {
      const listResponse = await fetch(`${baseUrl}/api/tasks`);
      const tasks = (await listResponse.json()) as Array<{
        id: string;
        prompt: string;
        tool_policy?: string;
      }>;

      expect(tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'task-operation-reminder',
            prompt: expect.stringContaining('[operation-schedule]'),
            tool_policy: 'approval-required',
          }),
        ]),
      );

      const createResponse = await fetch(
        `${baseUrl}/api/tasks/operation-schedules`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            groupFolder: 'operations',
            chatJid: 'tg:operations-room',
            title: 'Mock reminder',
            orders: 'Confirm rally roles.',
            intent: 'reminder',
            scheduleType: 'interval',
            scheduleValue: '30m',
            deliveryMode: 'preview',
            deliveryApproved: false,
          }),
        },
      );
      const created = (await createResponse.json()) as {
        ok: boolean;
        deliveryMode: string;
        task: { prompt: string; tool_policy: string };
      };

      expect(created).toMatchObject({
        ok: true,
        deliveryMode: 'preview',
        task: {
          prompt: expect.stringContaining('[operation-schedule]'),
          tool_policy: 'dry-run',
        },
      });
    });
  });

  it('serves model operations metrics in mock mode', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/providers/model-metrics`);
      const metrics = (await response.json()) as {
        summary: {
          totalModels: number;
          healthyModels: number;
          averageLatencyMs: number;
        };
        models: Array<{
          provider: string;
          model: string;
          costTier: string;
          contextWindow: number;
          successRate: number;
        }>;
      };

      expect(metrics.summary).toMatchObject({
        totalModels: 2,
        healthyModels: 1,
        averageLatencyMs: 880,
      });
      expect(metrics.models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: 'openrouter',
            model: 'openrouter/auto',
            costTier: 'medium',
            contextWindow: 128000,
            successRate: 1,
          }),
        ]),
      );
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

  it('serves assistant avatar gallery metadata in mock mode', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/assistant-profile`);
      const profile = (await response.json()) as {
        selectedAvatarId: string;
        avatars: Array<{ id: string; kind: string; available: boolean }>;
      };

      expect(profile.selectedAvatarId).toBe('tidal-crab');
      expect(profile.avatars).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'default', kind: 'default' }),
          expect.objectContaining({
            id: 'uploaded',
            kind: 'uploaded',
            available: false,
          }),
          expect.objectContaining({ id: 'ember-crab', kind: 'builtin' }),
        ]),
      );
      expect(
        profile.avatars.filter((avatar) => avatar.kind === 'builtin'),
      ).toHaveLength(5);

      const saveResponse = await fetch(
        `${baseUrl}/api/assistant-profile/avatar`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ selectedAvatarId: 'ember-crab' }),
        },
      );
      const saved = (await saveResponse.json()) as {
        ok: boolean;
        profile: { selectedAvatarId: string };
      };

      expect(saved).toMatchObject({
        ok: true,
        profile: { selectedAvatarId: 'ember-crab' },
      });
    });
  });
});
