/**
 * NotebookLM Enterprise runtime adapter with mock transport.
 *
 * Implements the official Enterprise operation mapping (create notebook, add URL/file source,
 * list/retrieve/share, and output-link operations) with a verified mock transport and
 * deployment-gated readiness. No live external calls are made by default.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { logAuditEvent } from './audit-log.js';
import {
  loadConnectorPermissions,
  authorizeConnectorAction,
  defaultConnectorPermission,
} from './connector-permissions.js';
import { STORE_DIR } from './config.js';
import {
  NOTEBOOKLM_CONNECTOR_ID,
  NOTEBOOKLM_CONTRACT_VERSION,
  NOTEBOOKLM_CAPABILITIES,
  type NotebookLmCapability,
  type NotebookLmConfig,
  type NotebookLmOperationResult,
  type NotebookLmReadiness,
  type NotebookLmProvenance,
  getNotebookLmReadiness,
  loadNotebookLmConfig,
  saveNotebookLmConfig,
} from './research-jobs.js';

export interface NotebookLmNotebook {
  id: string;
  name: string;
  sourceCount: number;
  createdAt: string;
  updatedAt: string;
  outputLink?: string;
}

const NOTEBOOKLM_NOTEBOOKS_PATH = path.join(
  STORE_DIR,
  'notebooklm-notebooks.json',
);
const NOTEBOOKLM_STATE_PATH = path.join(STORE_DIR, 'notebooklm-state.jsonl');

function readNotebooks(): NotebookLmNotebook[] {
  try {
    const data = JSON.parse(
      fs.readFileSync(NOTEBOOKLM_NOTEBOOKS_PATH, 'utf-8'),
    );
    if (!Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

function writeNotebooks(notebooks: NotebookLmNotebook[]): void {
  fs.mkdirSync(path.dirname(NOTEBOOKLM_NOTEBOOKS_PATH), { recursive: true });
  fs.writeFileSync(
    NOTEBOOKLM_NOTEBOOKS_PATH,
    `${JSON.stringify(notebooks, null, 2)}\n`,
  );
}

function appendStateEvent(event: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(NOTEBOOKLM_STATE_PATH), { recursive: true });
  fs.appendFileSync(NOTEBOOKLM_STATE_PATH, `${JSON.stringify(event)}\n`);
}

export interface NotebookLmMockTransportResult {
  connectorId: typeof NOTEBOOKLM_CONNECTOR_ID;
  operation: NotebookLmCapability;
  status: 'completed' | 'requires_approval' | 'blocked';
  executed: boolean;
  idempotencyKey?: string;
  result?: Record<string, unknown>;
  reason?: string;
  researchJobId?: string | null;
}

export function createNotebookLmMockTransport(): {
  execute: (
    operation: NotebookLmCapability,
    input: Record<string, unknown>,
    options: {
      approved?: boolean;
      researchJobId?: string;
      actor?: string;
    },
  ) => NotebookLmMockTransportResult;
} {
  const idempotencyCache = new Map<string, NotebookLmMockTransportResult>();

  return {
    execute(
      operation: NotebookLmCapability,
      input: Record<string, unknown>,
      options: { approved?: boolean; researchJobId?: string; actor?: string },
    ): NotebookLmMockTransportResult {
      const config = loadNotebookLmConfig();
      const readiness = getNotebookLmReadiness(config);
      const idempotencyKey = crypto.randomUUID();

      // Fail closed if not configured
      if (!readiness.configured) {
        return {
          connectorId: NOTEBOOKLM_CONNECTOR_ID,
          operation,
          status: 'blocked',
          executed: false,
          idempotencyKey,
          reason: readiness.detail,
          researchJobId: options.researchJobId || null,
        };
      }

      // Operation not in allowed list
      if (!readiness.capabilities.includes(operation)) {
        return {
          connectorId: NOTEBOOKLM_CONNECTOR_ID,
          operation,
          status: 'blocked',
          executed: false,
          idempotencyKey,
          reason: `Operation ${operation} is not in the allowed operations list`,
          researchJobId: options.researchJobId || null,
        };
      }

      // Write operations require explicit approval
      const writeOps = ['create-notebook', 'add-source', 'share-notebook'];
      if (writeOps.includes(operation) && !options.approved) {
        appendStateEvent({
          operation,
          status: 'requires_approval',
          timestamp: new Date().toISOString(),
          actor: options.actor || 'system',
          idempotencyKey,
        });
        logAuditEvent({
          actor: options.actor || 'system',
          actionType: `notebooklm.${operation}`,
          resource: NOTEBOOKLM_CONNECTOR_ID,
          decision: 'requires_approval',
          context: { idempotencyKey, operation },
        });
        return {
          connectorId: NOTEBOOKLM_CONNECTOR_ID,
          operation,
          status: 'requires_approval',
          executed: false,
          idempotencyKey,
          reason: 'Operation requires explicit owner approval',
          researchJobId: options.researchJobId || null,
        };
      }

      // Idempotency check
      const cached = idempotencyCache.get(idempotencyKey);
      if (cached && cached.executed) {
        return cached;
      }

      // Execute the operation (mock transport)
      let result: Record<string, unknown> = {};

      switch (operation) {
        case 'create-notebook': {
          const notebookId = crypto.randomUUID();
          const name =
            typeof input.name === 'string' ? input.name : 'Untitled Notebook';
          const notebook: NotebookLmNotebook = {
            id: notebookId,
            name: name.slice(0, 200),
            sourceCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          const notebooks = readNotebooks();
          notebooks.push(notebook);
          writeNotebooks(notebooks);
          result = { notebookId, name };
          break;
        }

        case 'add-source': {
          const notebookId =
            typeof input.notebookId === 'string' ? input.notebookId : null;
          if (!notebookId) {
            return {
              connectorId: NOTEBOOKLM_CONNECTOR_ID,
              operation,
              status: 'blocked',
              executed: false,
              idempotencyKey,
              reason: 'notebookId is required for add-source',
              researchJobId: options.researchJobId || null,
            };
          }
          const notebooks = readNotebooks();
          const notebook = notebooks.find((n) => n.id === notebookId);
          if (!notebook) {
            return {
              connectorId: NOTEBOOKLM_CONNECTOR_ID,
              operation,
              status: 'blocked',
              executed: false,
              idempotencyKey,
              reason: `Notebook ${notebookId} not found`,
              researchJobId: options.researchJobId || null,
            };
          }
          notebook.sourceCount += 1;
          notebook.updatedAt = new Date().toISOString();
          writeNotebooks(notebooks);
          result = { notebookId, sourceCount: notebook.sourceCount };
          break;
        }

        case 'list-notebooks': {
          const notebooks = readNotebooks();
          result = { notebooks: notebooks.slice(0, 50) };
          break;
        }

        case 'retrieve-notebook': {
          const notebookId =
            typeof input.notebookId === 'string' ? input.notebookId : null;
          if (!notebookId) {
            return {
              connectorId: NOTEBOOKLM_CONNECTOR_ID,
              operation,
              status: 'blocked',
              executed: false,
              idempotencyKey,
              reason: 'notebookId is required for retrieve-notebook',
              researchJobId: options.researchJobId || null,
            };
          }
          const notebooks = readNotebooks();
          const notebook = notebooks.find((n) => n.id === notebookId);
          if (!notebook) {
            return {
              connectorId: NOTEBOOKLM_CONNECTOR_ID,
              operation,
              status: 'blocked',
              executed: false,
              idempotencyKey,
              reason: `Notebook ${notebookId} not found`,
              researchJobId: options.researchJobId || null,
            };
          }
          result = { notebook };
          break;
        }

        case 'share-notebook': {
          const notebookId =
            typeof input.notebookId === 'string' ? input.notebookId : null;
          if (!notebookId) {
            return {
              connectorId: NOTEBOOKLM_CONNECTOR_ID,
              operation,
              status: 'blocked',
              executed: false,
              idempotencyKey,
              reason: 'notebookId is required for share-notebook',
              researchJobId: options.researchJobId || null,
            };
          }
          const notebooks = readNotebooks();
          const notebook = notebooks.find((n) => n.id === notebookId);
          if (!notebook) {
            return {
              connectorId: NOTEBOOKLM_CONNECTOR_ID,
              operation,
              status: 'blocked',
              executed: false,
              idempotencyKey,
              reason: `Notebook ${notebookId} not found`,
              researchJobId: options.researchJobId || null,
            };
          }
          const shareToken = crypto.randomBytes(16).toString('hex');
          result = {
            notebookId,
            shareToken,
            sharedAt: new Date().toISOString(),
          };
          break;
        }

        case 'link-output': {
          const notebookId =
            typeof input.notebookId === 'string' ? input.notebookId : null;
          if (!notebookId) {
            return {
              connectorId: NOTEBOOKLM_CONNECTOR_ID,
              operation,
              status: 'blocked',
              executed: false,
              idempotencyKey,
              reason: 'notebookId is required for link-output',
              researchJobId: options.researchJobId || null,
            };
          }
          const notebooks = readNotebooks();
          const notebook = notebooks.find((n) => n.id === notebookId);
          if (!notebook) {
            return {
              connectorId: NOTEBOOKLM_CONNECTOR_ID,
              operation,
              status: 'blocked',
              executed: false,
              idempotencyKey,
              reason: `Notebook ${notebookId} not found`,
              researchJobId: options.researchJobId || null,
            };
          }
          const outputLink = `https://notebooklm.google.com/notebook/${notebookId}/output`;
          notebook.outputLink = outputLink;
          notebook.updatedAt = new Date().toISOString();
          writeNotebooks(notebooks);
          result = { notebookId, outputLink };
          break;
        }

        default:
          return {
            connectorId: NOTEBOOKLM_CONNECTOR_ID,
            operation,
            status: 'blocked',
            executed: false,
            idempotencyKey,
            reason: `Unsupported operation: ${operation}`,
            researchJobId: options.researchJobId || null,
          };
      }

      // Record state event
      appendStateEvent({
        operation,
        status: 'completed',
        timestamp: new Date().toISOString(),
        actor: options.actor || 'system',
        idempotencyKey,
        result,
      });

      logAuditEvent({
        actor: options.actor || 'system',
        actionType: `notebooklm.${operation}`,
        resource: NOTEBOOKLM_CONNECTOR_ID,
        decision: 'allowed',
        context: { idempotencyKey, operation },
      });

      const res: NotebookLmMockTransportResult = {
        connectorId: NOTEBOOKLM_CONNECTOR_ID,
        operation,
        status: 'completed',
        executed: true,
        idempotencyKey,
        result,
        researchJobId: options.researchJobId || null,
      };

      idempotencyCache.set(idempotencyKey, res);
      return res;
    },
  };
}

// Export singleton mock transport
export const notebookLmMockTransport = createNotebookLmMockTransport();

export function listNotebookLmNotebooks(): NotebookLmNotebook[] {
  return readNotebooks();
}

export function getNotebookLmNotebook(
  id: string,
): NotebookLmNotebook | undefined {
  return readNotebooks().find((n) => n.id === id);
}
