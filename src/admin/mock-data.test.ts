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
        'interrupted',
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

  it('serves interrupted and partial-data fixtures for unified session recovery', async () => {
    await withServer(async (baseUrl) => {
      const listResponse = await fetch(`${baseUrl}/api/sessions/cockpit`);
      const sessions = (await listResponse.json()) as Array<{
        id: string;
        source: string;
        status: string;
      }>;
      const interrupted = sessions.find(
        (session) => session.id === 'cockpit-interrupted-005',
      );

      expect(interrupted).toMatchObject({
        source: 'transcript',
        status: 'interrupted',
      });

      const detailResponse = await fetch(
        `${baseUrl}/api/sessions/cockpit/cockpit-interrupted-005`,
      );
      expect(detailResponse.status).toBe(200);
      expect(await detailResponse.json()).toMatchObject({
        id: 'cockpit-interrupted-005',
        partialData: true,
        status: 'interrupted',
      });
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

  it('serves Slack and Discord credentials in mock mode', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/credentials`);
      const data = (await response.json()) as {
        credentials: Array<{
          key: string;
          label: string;
          configured: boolean;
          source: string;
        }>;
      };

      expect(data.credentials).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'SLACK_BOT_TOKEN',
            label: 'Slack Bot Token',
            configured: false,
            source: 'missing',
          }),
          expect.objectContaining({
            key: 'SLACK_APP_TOKEN',
            label: 'Slack App Token',
            configured: false,
            source: 'missing',
          }),
          expect.objectContaining({
            key: 'DISCORD_BOT_TOKEN',
            label: 'Discord Bot Token',
            configured: false,
            source: 'missing',
          }),
        ]),
      );
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

  it('serves Skills.sh catalog and install mocks without live network or mutation', async () => {
    await withServer(async (baseUrl) => {
      const searchResponse = await fetch(
        `${baseUrl}/api/skills/skills-sh/search?query=github`,
      );
      const search = (await searchResponse.json()) as {
        skills: Array<{ skillId: string; owner: string; repo: string }>;
      };
      expect(search.skills).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            skillId: 'github-issue-helper',
            owner: 'skills-sh',
            repo: 'agent-workflows',
          }),
        ]),
      );

      const installResponse = await fetch(
        `${baseUrl}/api/skills/skills-sh/install`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            owner: 'skills-sh',
            repo: 'agent-workflows',
            skillId: 'github-issue-helper',
            enabled: true,
            scope: 'main',
            visibility: 'private',
          }),
        },
      );
      const installed = (await installResponse.json()) as {
        ok: boolean;
        mock: boolean;
        skill: { path: string; enabled: boolean };
      };

      expect(installed).toMatchObject({
        ok: true,
        mock: true,
        skill: {
          path: 'github-issue-helper',
          enabled: true,
        },
      });
    });
  });

  it('serves operation schedules in mock mode without live mutation', async () => {
    await withServer(async (baseUrl) => {
      const listResponse = await fetch(`${baseUrl}/api/tasks`);
      const tasks = (await listResponse.json()) as Array<{
        id: string;
        prompt: string;
        tool_policy?: string;
        routine_type?: string;
        delivery_mode?: string;
        session_key?: string;
      }>;

      expect(tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'task-operation-reminder',
            prompt: expect.stringContaining('[operation-schedule]'),
            routine_type: 'operation',
            delivery_mode: 'chat',
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

  it('serves routine blueprints and task logs in mock mode', async () => {
    await withServer(async (baseUrl) => {
      const blueprintsResponse = await fetch(`${baseUrl}/api/tasks/blueprints`);
      const blueprints = (await blueprintsResponse.json()) as Array<{
        id: string;
        routineType: string;
        deliveryMode?: string;
        skills?: string[];
      }>;
      expect(blueprints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'daily-briefing',
            routineType: 'briefing',
            deliveryMode: 'dashboard',
            skills: expect.arrayContaining(['calendar-assistant']),
          }),
          expect.objectContaining({
            id: 'heartbeat-health-check',
            routineType: 'heartbeat',
            deliveryMode: 'dashboard',
          }),
          expect.objectContaining({
            id: 'skill-automation-safety-review',
          }),
        ]),
      );

      const logsResponse = await fetch(
        `${baseUrl}/api/tasks/task-health-heartbeat/logs`,
      );
      const logs = (await logsResponse.json()) as Array<{
        task_id: string;
        status: string;
      }>;
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            task_id: 'task-health-heartbeat',
            status: 'success',
          }),
        ]),
      );
    });
  });

  it('serves task run telemetry and task-scoped webhook approvals in mock mode', async () => {
    await withServer(async (baseUrl) => {
      const tasksResponse = await fetch(`${baseUrl}/api/tasks`);
      const tasks = (await tasksResponse.json()) as Array<{
        id: string;
        active_run_count?: number;
        last_started_at?: string;
      }>;

      expect(tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'task-health-heartbeat',
            active_run_count: 1,
            last_started_at: expect.any(String),
          }),
        ]),
      );

      const approvalResponse = await fetch(
        `${baseUrl}/api/approvals?kind=webhook-delivery&targetType=scheduled-task&targetId=task-release-webhook`,
      );
      const approvals = (await approvalResponse.json()) as Array<{
        kind: string;
        targetType: string;
        targetId: string;
        status: string;
      }>;

      expect(approvals).toEqual([
        expect.objectContaining({
          kind: 'webhook-delivery',
          targetType: 'scheduled-task',
          targetId: 'task-release-webhook',
          status: 'pending',
        }),
      ]);
    });
  });

  it('serves a Cowork MCP document approval in mock mode', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/approvals?kind=tool-action&targetType=cowork-project&targetId=project-auroradocs`,
      );
      const approvals = (await response.json()) as Array<{
        id: string;
        actionPreview: string;
        resourceSummary: string;
        status: string;
      }>;

      expect(approvals).toEqual([
        expect.objectContaining({
          id: 'approval-cowork-mcp-document',
          actionPreview: expect.stringContaining('mcp__docs__create_document'),
          resourceSummary: expect.stringContaining('AuroraDocs'),
          status: 'pending',
        }),
      ]);
    });
  });

  it('serves Cowork project file previews in mock mode', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/projects/project-auroradocs/files/read?path=${encodeURIComponent('docs/brief.md')}`,
      );
      const data = (await response.json()) as {
        file: {
          path: string;
          content: string;
          previewable: boolean;
        };
      };

      expect(data.file).toMatchObject({
        path: 'docs/brief.md',
        previewable: true,
      });
      expect(data.file.content).toContain('AuroraDocs project brief');
    });
  });

  it('serves an empty Cowork project folder in mock mode', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/projects/project-auroradocs`,
      );
      const data = (await response.json()) as {
        files: Array<{ path: string; kind: string }>;
      };

      expect(data.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'empty-folder', kind: 'folder' }),
        ]),
      );
    });
  });

  it('serves Cowork project artifact records in the mock artifact vault', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/artifacts/vault`);
      const records = (await response.json()) as Array<{
        sourceType: string;
        projectId?: string;
        projectName?: string;
        projectFilePath?: string;
        tags: string[];
      }>;

      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceType: 'cowork-project',
            projectId: 'project-auroradocs',
            projectName: 'AuroraDocs MCP workspace',
            projectFilePath: 'docs/brief.md',
            tags: expect.arrayContaining(['cowork', 'project']),
          }),
        ]),
      );

      const summaryResponse = await fetch(
        `${baseUrl}/api/artifacts/vault/summary`,
      );
      const summary = (await summaryResponse.json()) as {
        total: number;
        kinds: string[];
      };

      expect(summary.total).toBe(3);
      expect(summary.kinds).toEqual(
        expect.arrayContaining(['report', 'cowork-artifact']),
      );
    });
  });

  it('serves Cowork run local artifact creation in mock mode', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/projects/project-auroradocs/runs/run-auroradocs-email-brief/artifacts`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            path: 'documents/mock-source-brief.md',
            content: '# Mock source brief',
            sourceLedger: [{ source: 'gmail', purpose: 'mock summary' }],
          }),
        },
      );
      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        artifact: { path: string; sourceLedger: unknown[] };
        contextItem: { path: string; provenance: string };
        run: { events: Array<{ kind: string }> };
      };

      expect(data.artifact).toMatchObject({
        path: 'documents/mock-source-brief.md',
        sourceLedger: [expect.objectContaining({ source: 'gmail' })],
      });
      expect(data.contextItem).toMatchObject({
        path: 'documents/mock-source-brief.md',
        provenance: 'source-ledger',
      });
      expect(data.run.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'artifact_created' }),
        ]),
      );
    });
  });

  it('serves Cowork external-write approval creation in mock mode', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/projects/project-auroradocs/runs/run-auroradocs-email-brief/approvals/external-write`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'publish-document',
            title: 'Publish mock source brief',
            summary: 'Publish the mock source-backed brief.',
            resourceSummary: 'documents/mock-source-brief.md -> Google Docs',
            payload: { connector: 'google-docs' },
          }),
        },
      );
      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        approval: {
          kind: string;
          status: string;
          targetType: string;
          targetId: string;
        };
        reused: boolean;
        run: { status: string; events: Array<{ kind: string }> };
      };

      expect(data).toMatchObject({
        reused: false,
        approval: {
          kind: 'tool-action',
          status: 'pending',
          targetType: 'cowork-run',
          targetId: 'run-auroradocs-email-brief',
        },
        run: {
          status: 'waiting_for_approval',
          events: expect.arrayContaining([
            expect.objectContaining({ kind: 'approval_required' }),
          ]),
        },
      });
    });
  });

  it('serves autofix auto-pick settings and mock scan results', async () => {
    await withServer(async (baseUrl) => {
      const projectsResponse = await fetch(`${baseUrl}/api/autofix/projects`);
      const projects = (await projectsResponse.json()) as Array<{
        autoPickEnabled: boolean;
        pollIntervalMinutes: number;
        lastAutoPickAt: string | null;
      }>;

      expect(projects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            autoPickEnabled: true,
            pollIntervalMinutes: 15,
            lastAutoPickAt: expect.any(String),
          }),
        ]),
      );

      const scanResponse = await fetch(`${baseUrl}/api/autofix/auto-pick/run`, {
        method: 'POST',
      });
      const scan = (await scanResponse.json()) as {
        ok: boolean;
        result: { scanned: number; started: number };
      };

      expect(scan).toMatchObject({
        ok: true,
        result: {
          scanned: 1,
          started: 1,
        },
      });
    });
  });

  it('serves complete coding runtime catalogs and native runtime identity in mock mode', async () => {
    await withServer(async (baseUrl) => {
      const runtimeResponse = await fetch(
        `${baseUrl}/api/agents/coding/runtimes`,
      );
      const runtimes = (await runtimeResponse.json()) as Array<{
        cli: string;
        provider: string;
        model: string;
        available: boolean;
        readiness: { status: string; detail: string };
      }>;
      expect(runtimes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            cli: 'codex',
            provider: 'codex',
            model: 'gpt-5.4',
            available: true,
            readiness: expect.objectContaining({ status: 'healthy' }),
          }),
          expect.objectContaining({
            available: false,
            readiness: expect.objectContaining({ status: 'missing' }),
          }),
          expect.objectContaining({
            cli: 'devin',
            provider: 'claude',
            model: 'claude-sonnet-4-6',
            readiness: expect.objectContaining({ detail: expect.any(String) }),
          }),
        ]),
      );

      const [projects, autofixJobs, agentJobs, agentJob] = await Promise.all([
        fetch(`${baseUrl}/api/autofix/projects`).then(
          async (response) =>
            (await response.json()) as Array<Record<string, unknown>>,
        ),
        fetch(`${baseUrl}/api/autofix/jobs`).then(
          async (response) =>
            (await response.json()) as Array<Record<string, unknown>>,
        ),
        fetch(`${baseUrl}/api/agents/coding/jobs`).then(
          async (response) =>
            (await response.json()) as Array<Record<string, unknown>>,
        ),
        fetch(`${baseUrl}/api/agents/coding/jobs/code-mock-1`).then(
          async (response) =>
            (await response.json()) as Record<string, unknown>,
        ),
      ]);
      expect(projects[0]).toMatchObject({
        runnerCli: 'codex',
        runtime: { cli: 'codex', provider: 'codex', model: 'gpt-5.4' },
      });
      expect(autofixJobs[0]).toMatchObject({
        runnerCli: 'codex',
        actualRuntime: {
          cli: 'codex',
          provider: 'codex',
          model: 'gpt-5.4',
        },
      });
      for (const job of [agentJobs[0], agentJob]) {
        expect(job).toMatchObject({
          runnerCli: 'codex',
          actualRuntime: {
            cli: 'codex',
            provider: 'codex',
            model: 'gpt-5.4',
          },
        });
      }
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

  it('serves production-shaped source collections in mock mode', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/source-collections`);
      const collections = (await response.json()) as Array<{
        id: string;
        reportJobId: string;
        status: string;
        items: Array<{
          scope: string;
          connectorId?: string;
          status: string;
          failureReason: string | null;
        }>;
        ledger: Array<{
          connectorId?: string;
          provenance: string[];
        }>;
      }>;

      expect(response.status).toBe(200);
      expect(Array.isArray(collections)).toBe(true);
      expect(collections[0]).toMatchObject({
        id: expect.any(String),
        reportJobId: expect.any(String),
        status: 'partial',
        items: expect.arrayContaining([
          expect.objectContaining({
            scope: 'connector',
            connectorId: 'gmail',
            status: 'completed',
            failureReason: null,
          }),
          expect.objectContaining({
            scope: 'file',
            status: 'failed',
            failureReason: expect.any(String),
          }),
        ]),
        ledger: expect.arrayContaining([
          expect.objectContaining({
            connectorId: 'gmail',
            provenance: expect.arrayContaining([expect.any(String)]),
          }),
        ]),
      });
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
