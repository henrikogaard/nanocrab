/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two auth modes:
 *   API key:  Proxy injects x-api-key on every request.
 *   OAuth:    Container CLI exchanges its placeholder token for a temp
 *             API key via /api/oauth/claude_cli/create_api_key.
 *             Proxy injects real OAuth token on that exchange request;
 *             subsequent requests carry the temp key which is valid as-is.
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'OPENROUTER_API_KEY',
    'OPENROUTER_BASE_URL',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_OPENAI_BASE_URL',
  ]);
  const secret = (key: string): string | undefined =>
    process.env[key] || secrets[key];

  const authMode: AuthMode = secret('ANTHROPIC_API_KEY') ? 'api-key' : 'oauth';
  const oauthToken =
    secret('CLAUDE_CODE_OAUTH_TOKEN') || secret('ANTHROPIC_AUTH_TOKEN');

  const upstreamUrl = new URL(
    secret('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com',
  );
  const providerRoutes: Record<string, { baseUrl: string; apiKey?: string }> = {
    openrouter: {
      baseUrl: secret('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1',
      apiKey: secret('OPENROUTER_API_KEY'),
    },
    google: {
      baseUrl:
        secret('GOOGLE_OPENAI_BASE_URL') ||
        'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: secret('GEMINI_API_KEY') || secret('GOOGLE_API_KEY'),
    },
  };

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const routeMatch = req.url?.match(
          /^\/__nanocrab\/providers\/([a-z0-9_-]+)(\/.*)?$/,
        );
        let targetUrl = upstreamUrl;
        let targetPath = req.url || '/';
        let providerApiKey: string | undefined;
        if (routeMatch) {
          const route = providerRoutes[routeMatch[1]];
          if (!route) {
            res.writeHead(404);
            res.end('Unknown provider route');
            return;
          }
          if (!route.apiKey) {
            res.writeHead(401);
            res.end(`Provider ${routeMatch[1]} API key is not configured`);
            return;
          }
          targetUrl = new URL(route.baseUrl.replace(/\/+$/, ''));
          targetPath = routeMatch[2] || '/';
          providerApiKey = route.apiKey;
        }

        const isHttps = targetUrl.protocol === 'https:';
        const makeRequest = isHttps ? httpsRequest : httpRequest;
        const headers: Record<string, string | number | string[] | undefined> =
          {
            ...(req.headers as Record<string, string>),
            host: targetUrl.host,
            'content-length': body.length,
          };

        // Strip hop-by-hop headers that must not be forwarded by proxies
        delete headers['connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (providerApiKey) {
          delete headers.authorization;
          delete headers['x-api-key'];
          headers.authorization = `Bearer ${providerApiKey}`;
        } else if (authMode === 'api-key') {
          // API key mode: inject x-api-key on every request
          delete headers['x-api-key'];
          headers['x-api-key'] = secret('ANTHROPIC_API_KEY');
        } else {
          // OAuth mode: replace placeholder Bearer token with the real one
          // only when the container actually sends an Authorization header
          // (exchange request + auth probes). Post-exchange requests use
          // x-api-key only, so they pass through without token injection.
          if (headers['authorization']) {
            delete headers['authorization'];
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        const upstream = makeRequest(
          {
            hostname: targetUrl.hostname,
            port: targetUrl.port || (isHttps ? 443 : 80),
            path: `${targetUrl.pathname.replace(/\/+$/, '')}${targetPath}`,
            method: req.method,
            headers,
          } as RequestOptions,
          (upRes) => {
            res.writeHead(upRes.statusCode!, upRes.headers);
            upRes.pipe(res);
          },
        );

        upstream.on('error', (err) => {
          logger.error(
            { err, url: req.url },
            'Credential proxy upstream error',
          );
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        });

        upstream.write(body);
        upstream.end();
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}
