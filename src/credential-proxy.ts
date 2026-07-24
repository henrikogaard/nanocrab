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
import { auditEgressDecision, shouldEnforceDeny } from './egress-gateway.js';

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
    'AIROUTER_API_KEY',
    'AIROUTER_BASE_URL',
    'DEFAULT_AIROUTER_BASE_URL',
    'OPENAI_COMPATIBLE_API_KEY',
    'OPENAI_COMPATIBLE_BASE_URL',
    'DEFAULT_OPENAI_COMPATIBLE_BASE_URL',
    'MISTRAL_API_KEY',
    'MISTRAL_BASE_URL',
  ]);
  const secret = (key: string): string | undefined =>
    process.env[key] || secrets[key];

  const authMode: AuthMode = secret('ANTHROPIC_API_KEY') ? 'api-key' : 'oauth';
  const oauthToken =
    secret('CLAUDE_CODE_OAUTH_TOKEN') || secret('ANTHROPIC_AUTH_TOKEN');

  const upstreamUrl = new URL(
    secret('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com',
  );
  const providerRoutes: Record<
    string,
    {
      baseUrl: string;
      apiKey?: string;
      requiresApiKey: boolean;
      credentialId?: string;
    }
  > = {
    openrouter: {
      baseUrl: secret('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1',
      apiKey: secret('OPENROUTER_API_KEY'),
      requiresApiKey: true,
      credentialId: 'OPENROUTER_API_KEY',
    },
    google: {
      baseUrl:
        secret('GOOGLE_OPENAI_BASE_URL') ||
        'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: secret('GEMINI_API_KEY') || secret('GOOGLE_API_KEY'),
      requiresApiKey: true,
      credentialId: 'GEMINI_API_KEY',
    },
    airouter: {
      baseUrl:
        secret('AIROUTER_BASE_URL') ||
        secret('DEFAULT_AIROUTER_BASE_URL') ||
        'https://api.airouter.ch/v1',
      apiKey: secret('AIROUTER_API_KEY'),
      requiresApiKey: true,
      credentialId: 'AIROUTER_API_KEY',
    },
    'openai-compatible': {
      baseUrl:
        secret('OPENAI_COMPATIBLE_BASE_URL') ||
        secret('DEFAULT_OPENAI_COMPATIBLE_BASE_URL') ||
        '',
      apiKey: secret('OPENAI_COMPATIBLE_API_KEY'),
      requiresApiKey: false,
      credentialId: 'OPENAI_COMPATIBLE_API_KEY',
    },
    mistral: {
      baseUrl: secret('MISTRAL_BASE_URL') || 'https://api.mistral.ai/v1',
      apiKey: secret('MISTRAL_API_KEY'),
      requiresApiKey: true,
      credentialId: 'MISTRAL_API_KEY',
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
        let isProviderRoute = false;
        if (routeMatch) {
          isProviderRoute = true;
          const route = providerRoutes[routeMatch[1]];
          if (!route) {
            res.writeHead(404);
            res.end('Unknown provider route');
            return;
          }

          if (!route.baseUrl) {
            res.writeHead(400);
            res.end(`Provider ${routeMatch[1]} base URL is not configured`);
            return;
          } else {
            if (route.requiresApiKey && !route.apiKey) {
              res.writeHead(401);
              res.end(`Provider ${routeMatch[1]} API key is not configured`);
              return;
            }
            targetUrl = new URL(route.baseUrl.replace(/\/+$/, ''));
            targetPath = routeMatch[2] || '/';
            providerApiKey = route.apiKey;
          }
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

        if (isProviderRoute) {
          delete headers.authorization;
          delete headers['x-api-key'];
          if (providerApiKey) {
            headers.authorization = `Bearer ${providerApiKey}`;
          }
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

        // Egress gateway: allow/deny the destination and audit the decision.
        // Credentials are only injected for destinations they are bound to.
        const route = isProviderRoute
          ? providerRoutes[routeMatch![1]]
          : undefined;
        const egressResult = auditEgressDecision({
          host: targetUrl.hostname,
          port: targetUrl.port
            ? parseInt(targetUrl.port, 10)
            : isHttps
              ? 443
              : 80,
          credentialId: route?.credentialId,
          method: req.method,
        });
        if (
          egressResult.decision === 'deny' &&
          shouldEnforceDeny(egressResult)
        ) {
          logger.warn(
            { host: egressResult.host, reason: egressResult.reason },
            'Egress gateway denied outbound request',
          );
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'egress_denied',
              reason: egressResult.reason,
              correlationId: egressResult.correlationId,
            }),
          );
          return;
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
