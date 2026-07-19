import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchGitHubCheckStatus } from './github-checks.js';

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

describe('fetchGitHubCheckStatus', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function route(url: string): string {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  }

  it('returns success with required and optional checks separated', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const path = route(url);
      if (path.startsWith('/repos/owner/repo/branches/main/protection')) {
        return mockResponse({
          json: {
            required_status_checks: {
              contexts: ['ci/test'],
              checks: [{ context: 'ci/test', app_id: null }],
            },
          },
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
                check_suite: { id: 100, app: { name: 'GitHub Actions' } },
              },
              {
                id: 2,
                name: 'lint',
                status: 'completed',
                conclusion: 'failure',
                started_at: new Date().toISOString(),
                completed_at: new Date().toISOString(),
                check_suite: { id: 100, app: { name: 'GitHub Actions' } },
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

    const result = await fetchGitHubCheckStatus(
      'owner',
      'repo',
      'abc',
      'ghp_token_redacted',
      { branch: 'main' },
    );

    expect(result.status).toBe('attention');
    expect(result.overall).toBe('attention');
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.permission).toBe('full');
    expect(result.requiredChecks).toContain('ci/test');
    expect(result.optionalChecks).toContain('lint');
    expect(result.failedRequired).toEqual([]);
    expect(result.failedOptional).toContain('lint');
    expect(result.failureSummary).toContain('lint');
    expect(JSON.stringify(result)).not.toContain('ghp_token_redacted');
  });

  it('marks required check failures as failure and optional as attention', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const path = route(url);
      if (path.startsWith('/repos/owner/repo/branches/main/protection')) {
        return mockResponse({
          json: {
            required_status_checks: {
              contexts: ['ci/test'],
            },
          },
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
                conclusion: 'failure',
                started_at: new Date().toISOString(),
                completed_at: new Date().toISOString(),
              },
            ],
          },
        });
      }
      if (path.startsWith('/repos/owner/repo/commits/abc/status')) {
        return mockResponse({ json: { state: 'failure', statuses: [] } });
      }
      return mockResponse({ status: 404 });
    });

    const result = await fetchGitHubCheckStatus(
      'owner',
      'repo',
      'abc',
      'token',
      { branch: 'main' },
    );

    expect(result.status).toBe('failure');
    expect(result.failedRequired).toContain('ci/test');
  });

  it('returns pending when checks are in progress', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const path = route(url);
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
                status: 'in_progress',
                conclusion: null,
                started_at: new Date().toISOString(),
              },
            ],
          },
        });
      }
      if (path.startsWith('/repos/owner/repo/commits/abc/status')) {
        return mockResponse({ json: { state: 'pending', statuses: [] } });
      }
      return mockResponse({ status: 404 });
    });

    const result = await fetchGitHubCheckStatus(
      'owner',
      'repo',
      'abc',
      'token',
      { branch: 'main' },
    );

    expect(result.status).toBe('pending');
    expect(result.checks[0].state).toBe('pending');
  });

  it('marks old completed checks as stale', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    fetchMock.mockImplementation(async (url: string) => {
      const path = route(url);
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
                started_at: old,
                completed_at: old,
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

    const result = await fetchGitHubCheckStatus(
      'owner',
      'repo',
      'abc',
      'token',
      { branch: 'main' },
    );

    expect(result.stale).toBe(true);
    expect(result.checks[0].isStale).toBe(true);
    expect(result.checks[0].state).toBe('stale');
    expect(result.status).toBe('stale');
    expect(result.staleReason).toContain('ci/test');
  });

  it('reports rate limit and retry-after', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const path = route(url);
      if (path.startsWith('/repos/owner/repo/branches/main/protection')) {
        return mockResponse({
          status: 403,
          headers: {
            'X-RateLimit-Remaining': '0',
            'Retry-After': '60',
          },
        });
      }
      if (path.startsWith('/repos/owner/repo/commits/abc/check-runs')) {
        return mockResponse({
          status: 403,
          headers: {
            'X-RateLimit-Remaining': '0',
            'Retry-After': '60',
          },
        });
      }
      if (path.startsWith('/repos/owner/repo/commits/abc/status')) {
        return mockResponse({
          status: 403,
          headers: {
            'X-RateLimit-Remaining': '0',
            'Retry-After': '60',
          },
        });
      }
      return mockResponse({ status: 404 });
    });

    const result = await fetchGitHubCheckStatus(
      'owner',
      'repo',
      'abc',
      'token',
      { branch: 'main' },
    );

    expect(result.rateLimited).toBe(true);
    expect(result.retryAfter).toBe(60);
    expect(result.status).toBe('error');
    expect(result.error).toContain('rate limit');
  });

  it('falls back to checks-only when branch protection is forbidden', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const path = route(url);
      if (path.startsWith('/repos/owner/repo/branches/main/protection')) {
        return mockResponse({ status: 403 });
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

    const result = await fetchGitHubCheckStatus(
      'owner',
      'repo',
      'abc',
      'token',
      { branch: 'main' },
    );

    expect(result.permission).toBe('checks-only');
    expect(result.status).toBe('success');
    expect(result.requiredChecks).toEqual([]);
    expect(result.checks.every((c) => c.required === null)).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('fails closed when a required context has no check result', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const path = route(url);
      if (path.includes('/branches/main/protection')) {
        return mockResponse({
          json: { required_status_checks: { contexts: ['ci/missing'] } },
        });
      }
      if (path.includes('/check-runs')) {
        return mockResponse({ json: { check_runs: [] } });
      }
      return mockResponse({ json: { state: 'success', statuses: [] } });
    });

    const result = await fetchGitHubCheckStatus(
      'owner',
      'repo',
      'abc',
      'token',
      { branch: 'main' },
    );

    expect(result.status).toBe('failure');
    expect(result.requiredChecks).toContain('ci/missing');
    expect(result.failedRequired).toContain('ci/missing');
  });

  it('keeps an old failed required check blocking while marking it stale', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    fetchMock.mockImplementation(async (url: string) => {
      const path = route(url);
      if (path.includes('/branches/main/protection')) {
        return mockResponse({
          json: { required_status_checks: { contexts: ['ci/test'] } },
        });
      }
      if (path.includes('/check-runs')) {
        return mockResponse({
          json: {
            check_runs: [
              {
                id: 1,
                name: 'ci/test',
                status: 'completed',
                conclusion: 'failure',
                completed_at: old,
              },
            ],
          },
        });
      }
      return mockResponse({ json: { state: 'failure', statuses: [] } });
    });

    const result = await fetchGitHubCheckStatus(
      'owner',
      'repo',
      'abc',
      'token',
      { branch: 'main' },
    );

    expect(result.checks[0]).toMatchObject({ state: 'failure', isStale: true });
    expect(result.status).toBe('failure');
  });

  it('loads every page of check runs', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const path = route(url);
      if (path.includes('/branches/main/protection')) {
        return mockResponse({
          json: { required_status_checks: { contexts: ['second-page'] } },
        });
      }
      if (path.includes('/check-runs')) {
        const page = new URL(url).searchParams.get('page');
        return mockResponse({
          json: {
            check_runs:
              page === '2'
                ? [
                    {
                      id: 101,
                      name: 'second-page',
                      status: 'completed',
                      conclusion: 'success',
                    },
                  ]
                : Array.from({ length: 100 }, (_, index) => ({
                    id: index + 1,
                    name: `check-${index}`,
                    status: 'completed',
                    conclusion: 'success',
                  })),
          },
        });
      }
      return mockResponse({ json: { state: 'success', statuses: [] } });
    });

    const result = await fetchGitHubCheckStatus(
      'owner',
      'repo',
      'abc',
      'token',
      { branch: 'main' },
    );

    expect(result.checks).toHaveLength(101);
    expect(result.requiredChecks).toContain('second-page');
  });

  it('reports unavailable when both check endpoints fail', async () => {
    fetchMock.mockImplementation(async () => mockResponse({ status: 500 }));

    const result = await fetchGitHubCheckStatus(
      'owner',
      'repo',
      'abc',
      'token',
      { branch: 'main' },
    );

    expect(result.status).toBe('unknown');
    expect(result.permission).toBe('none');
    expect(result.error).toContain('GitHub API');
    expect(JSON.stringify(result)).not.toContain('token');
  });

  it('returns unknown when token is missing', async () => {
    const result = await fetchGitHubCheckStatus('owner', 'repo', 'abc', '');
    expect(result.status).toBe('unknown');
    expect(result.error).toBe('GitHub token not configured');
    expect(result.permission).toBe('none');
  });

  it('handles network errors without leaking tokens', async () => {
    fetchMock.mockRejectedValue(new Error('network timeout'));

    const result = await fetchGitHubCheckStatus(
      'owner',
      'repo',
      'abc',
      'super-secret-token',
    );

    expect(result.status).toBe('unknown');
    expect(result.error).toBe('GitHub API unreachable');
    expect(JSON.stringify(result)).not.toContain('super-secret-token');
  });
});
