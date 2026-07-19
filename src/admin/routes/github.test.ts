import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

import githubRouter from './github.js';

vi.mock('../../coding-jobs.js', () => ({
  getGitHubToken: vi.fn().mockReturnValue('mock-token'),
}));

vi.mock('../../logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

function mockResponse({
  status = 200,
  headers = {},
  json,
}: {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
} = {}) {
  const headerMap = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) || null,
    },
    json: async () => json,
    text: async () => (json ? JSON.stringify(json) : ''),
  } as Response;
}

function requestJson<T>(
  port: number,
  path: string,
  method = 'GET',
): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let body: T = {} as T;
          try {
            body = JSON.parse(text) as T;
          } catch {
            body = text as unknown as T;
          }
          resolve({ status: res.statusCode || 0, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('GitHub routes', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createServer(): Promise<http.Server> {
    const app = express();
    app.use('/github', githubRouter);
    return new Promise((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
  }

  it('rejects requests without owner, repo, or ref', async () => {
    const server = await createServer();
    try {
      const port = (server.address() as AddressInfo).port;
      const { status, body } = await requestJson<{ error?: string }>(
        port,
        '/github/checks?owner=owner&repo=repo',
      );
      expect(status).toBe(400);
      expect(body.error).toContain('required');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects unsafe owner or repo identifiers', async () => {
    const server = await createServer();
    try {
      const port = (server.address() as AddressInfo).port;
      const { status, body } = await requestJson<{ error?: string }>(
        port,
        '/github/checks?owner=../&repo=repo&ref=main',
      );
      expect(status).toBe(400);
      expect(body.error).toContain('safe identifiers');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns check status when GitHub APIs respond', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const path = `${parsed.pathname}${parsed.search}`;
      if (path.startsWith('/repos/owner/repo/branches/main/protection')) {
        return mockResponse({
          json: { required_status_checks: { contexts: [] } },
        });
      }
      if (path.startsWith('/repos/owner/repo/commits/abc/check-runs')) {
        return mockResponse({
          json: {
            check_runs: [
              {
                id: 1,
                name: 'ci/test',
                status: 'completed',
                conclusion: 'success',
                started_at: new Date().toISOString(),
                completed_at: new Date().toISOString(),
              },
            ],
          },
        });
      }
      if (path.startsWith('/repos/owner/repo/commits/abc/status')) {
        return mockResponse({ json: { state: 'success', statuses: [] } });
      }
      return mockResponse({ status: 404 });
    });

    const server = await createServer();
    try {
      const port = (server.address() as AddressInfo).port;
      const { status, body } = await requestJson<{
        status?: string;
        fetchedAt?: string;
      }>(port, '/github/checks?owner=owner&repo=repo&ref=abc&branch=main');
      expect(status).toBe(200);
      expect(body.status).toBe('success');
      expect(body.fetchedAt).toBeDefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns 429 and rate limit details when rate limited', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        status: 403,
        headers: {
          'X-RateLimit-Remaining': '0',
          'Retry-After': '120',
        },
      }),
    );

    const server = await createServer();
    try {
      const port = (server.address() as AddressInfo).port;
      const { status, body } = await requestJson<{
        rateLimited?: boolean;
        retryAfter?: number;
      }>(port, '/github/checks?owner=owner&repo=repo&ref=abc&branch=main');
      expect(status).toBe(429);
      expect(body.rateLimited).toBe(true);
      expect(body.retryAfter).toBe(120);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns 500 without leaking tokens on network errors', async () => {
    fetchMock.mockRejectedValue(new Error('network timeout'));

    const server = await createServer();
    try {
      const port = (server.address() as AddressInfo).port;
      const { status, body } = await requestJson<{ error?: string }>(
        port,
        '/github/checks?owner=owner&repo=repo&ref=abc&branch=main',
      );
      expect(status).toBe(500);
      expect(body.error).toContain('Could not retrieve');
      expect(JSON.stringify(body)).not.toContain('mock-token');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
