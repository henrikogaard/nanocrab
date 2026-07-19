import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

vi.mock('../../production-diagnostics.js', () => ({
  buildProductionDiagnostics: vi.fn(),
  formatDiagnosticsSummary: vi.fn(),
}));

import {
  buildProductionDiagnostics,
  formatDiagnosticsSummary,
} from '../../production-diagnostics.js';
import systemRouter, { validateAvatarUpload } from './system.js';

function ownerApp(): express.Express {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'test', username: 'test', role: 'owner' };
    next();
  });
  app.use('/system', systemRouter);
  return app;
}

function requestJson<T>(port: number, path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`request failed with ${res.statusCode}`));
            return;
          }
          resolve(JSON.parse(Buffer.concat(chunks).toString()) as T);
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('system routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AIROUTER_API_KEY;
  });

  it('rejects avatar uploads that are not image bytes', () => {
    expect(() => validateAvatarUpload(Buffer.from('not an image'))).toThrow(
      'avatar must be a JPEG, PNG, or WebP image',
    );
  });

  it('rejects avatar uploads over the size limit', () => {
    expect(() => validateAvatarUpload(Buffer.alloc(2 * 1024 * 1024))).toThrow(
      'avatar must be 1 MB or smaller',
    );
  });

  it('accepts JPEG avatar bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    expect(validateAvatarUpload(jpeg)).toEqual({
      contentType: 'image/jpeg',
      extension: 'jpg',
    });
  });

  it('preflights a provider against unsaved base URL and model input', async () => {
    process.env.AIROUTER_API_KEY = 'sk-airouter-test';
    const upstreamFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: 'Qwen3.6' }, { id: 'DeepSeek-V4-Flash' }],
      }),
    }));
    vi.stubGlobal('fetch', upstreamFetch);

    const app = express();
    app.use('/system', systemRouter);
    const server = await new Promise<http.Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const result = await requestJson<{
        provider: string;
        ok: boolean;
        checks: Array<{ id: string; ok: boolean; detail?: string }>;
      }>(
        port,
        '/system/provider/preflight/airouter?baseUrl=http%3A%2F%2F127.0.0.1%3A9999%2Fv1&model=DeepSeek-V4-Flash',
      );

      expect(result.provider).toBe('airouter');
      expect(result.checks.find((check) => check.id === 'base-url')).toEqual(
        expect.objectContaining({
          ok: true,
          detail: 'http://127.0.0.1:9999/v1',
        }),
      );
      expect(result.checks.find((check) => check.id === 'model')).toEqual(
        expect.objectContaining({
          ok: true,
          detail: 'DeepSeek-V4-Flash',
        }),
      );
      expect(upstreamFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:9999/v1/models',
        expect.any(Object),
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns production diagnostics as JSON', async () => {
    vi.mocked(buildProductionDiagnostics).mockResolvedValue({
      status: 'ready',
      generatedAt: new Date().toISOString(),
      summary: { total: 6, passed: 6, failedRequired: 0, failedAdvisory: 0 },
      sections: [],
      loadIssues: [],
      stale: false,
    });

    const app = ownerApp();
    const server = await new Promise<http.Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const result = await requestJson<{ status: string; stale: boolean }>(
        port,
        '/system/diagnostics',
      );
      expect(result.status).toBe('ready');
      expect(result.stale).toBe(false);
      expect(buildProductionDiagnostics).toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects production diagnostics for non-owner roles', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: 'viewer', username: 'viewer', role: 'viewer' };
      next();
    });
    app.use('/system', systemRouter);
    const server = await new Promise<http.Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, path: '/system/diagnostics', method: 'GET' },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode || 0));
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(403);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns production diagnostics as plain text when requested', async () => {
    vi.mocked(formatDiagnosticsSummary).mockReturnValue('NanoCrab diagnostics summary');
    vi.mocked(buildProductionDiagnostics).mockResolvedValue({
      status: 'attention',
      generatedAt: new Date().toISOString(),
      summary: { total: 5, passed: 4, failedRequired: 0, failedAdvisory: 1 },
      sections: [],
      loadIssues: [],
      stale: true,
    });

    const app = ownerApp();
    const server = await new Promise<http.Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const text = await new Promise<string>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, path: '/system/diagnostics?format=text', method: 'GET' },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString()));
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(text).toBe('NanoCrab diagnostics summary');
      expect(formatDiagnosticsSummary).toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
