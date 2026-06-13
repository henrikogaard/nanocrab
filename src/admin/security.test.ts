import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Request, Response } from 'express';

import { _resetApiRateLimitForTests, apiRateLimit } from './security.js';

function runApiRateLimit(method: string, ip = '203.0.113.10') {
  const req = {
    method,
    headers: {},
    socket: { remoteAddress: ip },
  } as unknown as Request;
  const res = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
  const next = vi.fn();

  apiRateLimit(req, res, next);

  return {
    next,
    res: res as unknown as {
      setHeader: ReturnType<typeof vi.fn>;
      status: ReturnType<typeof vi.fn>;
      json: ReturnType<typeof vi.fn>;
    },
  };
}

describe('admin API rate limiting', () => {
  beforeEach(() => {
    _resetApiRateLimitForTests();
  });

  it('allows dashboard read traffic beyond the old 200 request ceiling', () => {
    let last = runApiRateLimit('GET');
    for (let i = 1; i < 250; i++) {
      last = runApiRateLimit('GET');
    }

    expect(last.next).toHaveBeenCalledOnce();
    expect(last.res.status).not.toHaveBeenCalled();
  });

  it('keeps a tighter limit for write requests and reports retry timing', () => {
    let last = runApiRateLimit('POST', '203.0.113.11');
    for (let i = 1; i < 301; i++) {
      last = runApiRateLimit('POST', '203.0.113.11');
    }

    expect(last.next).not.toHaveBeenCalled();
    expect(last.res.setHeader).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(Number),
    );
    expect(last.res.status).toHaveBeenCalledWith(429);
    expect(last.res.json).toHaveBeenCalledWith({
      error: 'Rate limit exceeded',
    });
  });
});
