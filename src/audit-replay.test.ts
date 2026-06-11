import { describe, expect, it } from 'vitest';

import { buildAuditReplay } from './audit-replay.js';

describe('audit replay', () => {
  it('normalizes admin audit events into replay entries', () => {
    const replay = buildAuditReplay({
      sources: ['admin'],
      adminEvents: [
        {
          timestamp: '2026-06-10T10:00:00.000Z',
          ip: '127.0.0.1',
          action: 'login_success',
          details: 'username: admin',
          userAgent: 'test',
        },
      ],
    });

    expect(replay).toEqual([
      expect.objectContaining({
        at: '2026-06-10T10:00:00.000Z',
        source: 'admin',
        action: 'login_success',
        actor: '127.0.0.1',
        summary: 'username: admin',
      }),
    ]);
  });
});
