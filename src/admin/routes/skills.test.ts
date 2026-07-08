import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(os.tmpdir(), `nanocrab-skills-test-${Date.now()}`);
const DATA_DIR = path.join(os.tmpdir(), `nanocrab-skills-data-${Date.now()}`);
const CONTAINER_SKILLS_DIR = path.join(
  os.tmpdir(),
  `nanocrab-container-skills-${Date.now()}`,
);

vi.mock('../../config.js', () => ({
  STORE_DIR,
  DATA_DIR,
  CONTAINER_SKILLS_DIR,
  SKILLS_SH_API_BASE_URL: 'https://skills.test/api',
}));

vi.mock('../middleware.js', () => ({
  requireRole:
    () =>
    (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      req.user = { username: 'owner', role: 'admin' } as any;
      next();
    },
}));

vi.mock('../security.js', () => ({
  auditLog: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('../../db.js', () => ({
  getAllTasks: () => [],
}));

vi.mock('../../journal-store.js', () => ({
  findSkillWorthyJournalPatterns: () => [],
}));

vi.mock('../../memory-store.js', () => ({
  listMemoryProvenanceTimeline: () => [],
}));

const { default: skillsRouter } = await import('./skills.js');

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use('/skills', skillsRouter);
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

describe('skill admin routes', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(CONTAINER_SKILLS_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('searches Skills.sh through the server-side catalog route', async () => {
    const realFetch = globalThis.fetch.bind(globalThis);
    const fetchMock = vi.fn(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url = String(input);
        if (!url.startsWith('https://skills.test/')) {
          return realFetch(input, init);
        }
        expect(url).toContain('https://skills.test/api/skills?');
        expect(url).toContain('query=github');
        expect(url).toContain('pageSize=2');
        return new Response(
          JSON.stringify({
            skills: [
              {
                id: 'github-issue-helper',
                name: 'GitHub Issue Helper',
                description: 'Turn GitHub issues into implementation plans.',
                owner: 'mastra-ai',
                repo: 'agent-skills',
                source: { owner: 'mastra-ai', repo: 'agent-skills' },
                downloads: 42,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 2,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/skills/skills-sh/search?query=github&pageSize=2`,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        skills: Array<{
          skillId: string;
          owner: string;
          repo: string;
          description: string;
        }>;
        total: number;
      };

      expect(body.total).toBe(1);
      expect(body.skills).toEqual([
        expect.objectContaining({
          skillId: 'github-issue-helper',
          owner: 'mastra-ai',
          repo: 'agent-skills',
          description: 'Turn GitHub issues into implementation plans.',
        }),
      ]);
    });
  });

  it('downloads, versions, and enables a Skills.sh skill as a normal registry skill', async () => {
    const skillMd = [
      '---',
      'name: github-issue-helper',
      'description: Turn GitHub issues into implementation plans.',
      'triggers: github, issue, plan',
      '---',
      '',
      '# GitHub Issue Helper',
      '',
      'Use this skill when turning GitHub issues into implementation plans.',
      '',
    ].join('\n');
    const realFetch = globalThis.fetch.bind(globalThis);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          const url = String(input);
          if (!url.startsWith('https://skills.test/')) {
            return realFetch(input, init);
          }
          expect(url).toBe(
            'https://skills.test/api/skills/mastra-ai/agent-skills/github-issue-helper/content',
          );
          return new Response(JSON.stringify({ content: skillMd }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      ),
    );

    await withServer(async (baseUrl) => {
      const installResponse = await fetch(
        `${baseUrl}/skills/skills-sh/install`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            owner: 'mastra-ai',
            repo: 'agent-skills',
            skillId: 'github-issue-helper',
            enabled: true,
            scope: 'main',
            visibility: 'private',
          }),
        },
      );

      expect(installResponse.status).toBe(201);
      const installed = (await installResponse.json()) as {
        ok: boolean;
        skill: { path: string; enabled: boolean; scope: string };
        state: { enabled: boolean; scope: string; visibility: string };
      };
      expect(installed).toMatchObject({
        ok: true,
        skill: {
          path: 'github-issue-helper',
          enabled: true,
          scope: 'main',
        },
        state: {
          enabled: true,
          scope: 'main',
          visibility: 'private',
        },
      });

      expect(
        fs.readFileSync(
          path.join(CONTAINER_SKILLS_DIR, 'github-issue-helper', 'SKILL.md'),
          'utf-8',
        ),
      ).toBe(skillMd);
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(
              CONTAINER_SKILLS_DIR,
              'github-issue-helper',
              'skills-sh-source.json',
            ),
            'utf-8',
          ),
        ),
      ).toMatchObject({
        owner: 'mastra-ai',
        repo: 'agent-skills',
        skillId: 'github-issue-helper',
        source: 'skills.sh',
      });
    });
  });
});
