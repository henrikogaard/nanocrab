import { Router } from 'express';
import fs from 'fs';
import path from 'path';

import {
  buildConnectorCatalog,
  CONNECTOR_DEFINITIONS,
} from '../../connector-catalog.js';
import {
  listConnectorWorkflows,
  type ConnectorWorkflowDomain,
} from '../../connector-workflows.js';
import { readEnvFile } from '../../env.js';
import { getState } from '../state.js';

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
  const state = getState();
  const envKeys = [
    ...new Set(CONNECTOR_DEFINITIONS.flatMap((item) => item.envVars)),
  ];
  const envFile = readEnvFile(envKeys);
  const env = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key] || envFile[key]]),
  );
  res.json(
    buildConnectorCatalog({
      activeChannels: state.channels.map((channel) => channel.name),
      configuredMcpServers: configuredMcpServers(),
      env,
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
