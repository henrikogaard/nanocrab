import { logAuditEvent } from './audit-log.js';
import { evaluatePolicy } from './policy-engine.js';

export interface UploadAuditInput {
  channel: string;
  jid: string;
  filename: string;
  filePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  caption?: string;
  context?: Record<string, unknown>;
}

export async function auditUploadSend<T>(
  input: UploadAuditInput,
  send: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const resource = `${input.channel}/${input.jid}/${input.filename}`;
  const context = {
    channel: input.channel,
    jid: input.jid,
    filename: input.filename,
    filePath: input.filePath,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    captionLength: input.caption?.length || 0,
    ...(input.context || {}),
  };
  const policy = evaluatePolicy({
    actor: input.channel,
    actionType: 'upload.send',
    resource,
    context,
  });

  logAuditEvent({
    actor: input.channel,
    actionType: 'upload.send',
    resource,
    decision: policy.decision,
    context: policy,
  });

  if (policy.decision === 'denied' || policy.decision === 'requires_approval') {
    logAuditEvent({
      actor: input.channel,
      actionType: 'policy.denial',
      resource,
      decision: policy.decision,
      durationMs: Date.now() - start,
      context: policy,
    });
    throw new Error(`Upload blocked by policy: ${policy.explanation}`);
  }

  if (policy.decision === 'simulated') {
    return undefined as T;
  }

  try {
    const result = await send();
    logAuditEvent({
      actor: input.channel,
      actionType: 'upload.send',
      resource,
      decision: 'allowed',
      durationMs: Date.now() - start,
      context,
    });
    return result;
  } catch (err) {
    logAuditEvent({
      actor: input.channel,
      actionType: 'upload.send',
      resource,
      decision: 'error',
      durationMs: Date.now() - start,
      error: err,
      context,
    });
    throw err;
  }
}
