import { Router } from 'express';
import fs from 'fs';
import path from 'path';

import {
  buildConnectorCatalog,
  DEFAULT_CONNECTOR_CATALOG,
} from '../../connector-catalog.js';
import { loadConnectorPermissions } from '../../connector-permissions.js';
import {
  listConnectorWorkflows,
  type ConnectorWorkflowDomain,
} from '../../connector-workflows.js';
import { readEnvFile } from '../../env.js';

const router = Router();
const MCP_CONFIG_PATH = path.join(process.cwd(), 'store', 'mcp-servers.json');

function configuredMcpServers(): string[] {
  try {
    const servers = JSON.parse(
      fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'),
    ) as Array<{
      name?: string;
    }>;
    return servers.map((server) => server.name).filter(Boolean) as string[];
  } catch {
    return ['nanocrab', 'github'];
  }
}

router.get('/', (_req, res) => {
  const envKeys = [
    ...new Set(
      DEFAULT_CONNECTOR_CATALOG.flatMap((item) => item.requiredEnvVars),
    ),
  ];
  const envFile = readEnvFile(envKeys);
  const env = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key] || envFile[key]]),
  );
  const configuredServers = configuredMcpServers();
  const permissions = loadConnectorPermissions();
  res.json(
    buildConnectorCatalog({
      servers: DEFAULT_CONNECTOR_CATALOG.filter(
        (definition) =>
          definition.setupPath === 'built-in' ||
          configuredServers.includes(definition.id),
      ).map((definition) => ({
        name: definition.id,
        envVars: definition.requiredEnvVars,
        envStatus: definition.requiredEnvVars.map((key) => ({
          key,
          isSet: Boolean(env[key]),
        })),
        permission: permissions.find(
          (permission) => permission.connectorId === definition.id,
        ),
      })),
      presets: DEFAULT_CONNECTOR_CATALOG.filter((definition) =>
        definition.presetName
          ? configuredServers.includes(definition.presetName)
          : false,
      ).map((definition) => ({
        name: definition.presetName || definition.id,
        installed: true,
      })),
    }),
  );
});

router.get('/workflows', (req, res) => {
  const domain = req.query.domain as ConnectorWorkflowDomain | undefined;
  res.json({
    workflows: listConnectorWorkflows({ domain }),
  });
});

export default router;
