import { Router, Request, Response } from 'express';

import {
  listChannelBindings,
  getChannelBinding,
  createChannelBinding,
  approveChannelBinding,
  disableChannelBinding,
  enableChannelBinding,
  deleteChannelBinding,
  disableBindingsForAgent,
  getSupportedChannelTypes,
  type CreateChannelBindingInput,
} from '../../channel-bindings.js';
import { auditLog } from '../security.js';
import { logger } from '../../logger.js';

const router = Router();

// List supported channel types
router.get('/types', (_req: Request, res: Response) => {
  res.json(getSupportedChannelTypes());
});

// List all bindings, optionally filtered by agent profile
router.get('/', (req: Request, res: Response) => {
  const agentProfileId =
    typeof req.query.agentProfileId === 'string'
      ? req.query.agentProfileId
      : undefined;
  res.json(listChannelBindings(agentProfileId));
});

// Create a binding (starts as pending, requires approval)
router.post('/', (req: Request, res: Response) => {
  const body = req.body as Partial<CreateChannelBindingInput>;
  if (!body.agentProfileId || !body.channelType || !body.channelId) {
    res.status(400).json({
      error: 'agentProfileId, channelType, and channelId are required',
    });
    return;
  }

  try {
    const binding = createChannelBinding({
      agentProfileId: body.agentProfileId,
      channelType: body.channelType,
      channelId: body.channelId,
      handle: body.handle,
      triggerRules: body.triggerRules,
      requestedBy: body.requestedBy,
    });
    auditLog(req, 'channel_binding_created', binding.id);
    res.json({ ok: true, binding });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Could not create binding',
    });
  }
});

// Get binding detail
router.get('/:id', (req: Request, res: Response) => {
  const binding = getChannelBinding(String(req.params.id));
  if (!binding) {
    res.status(404).json({ error: 'Binding not found' });
    return;
  }
  res.json(binding);
});

// Approve a pending binding
router.post('/:id/approve', (req: Request, res: Response) => {
  try {
    const binding = approveChannelBinding(
      String(req.params.id),
      (req as { user?: { username?: string } }).user?.username || 'admin',
    );
    auditLog(req, 'channel_binding_approved', binding.id);
    res.json({ ok: true, binding });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Could not approve binding',
    });
  }
});

// Disable a binding
router.post('/:id/disable', (req: Request, res: Response) => {
  try {
    const binding = disableChannelBinding(String(req.params.id));
    auditLog(req, 'channel_binding_disabled', binding.id);
    res.json({ ok: true, binding });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Could not disable binding',
    });
  }
});

// Re-enable a disabled binding
router.post('/:id/enable', (req: Request, res: Response) => {
  try {
    const binding = enableChannelBinding(String(req.params.id));
    auditLog(req, 'channel_binding_enabled', binding.id);
    res.json({ ok: true, binding });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Could not enable binding',
    });
  }
});

// Delete a binding
router.delete('/:id', (req: Request, res: Response) => {
  const deleted = deleteChannelBinding(String(req.params.id));
  if (!deleted) {
    res.status(404).json({ error: 'Binding not found' });
    return;
  }
  auditLog(req, 'channel_binding_deleted', String(req.params.id));
  res.json({ ok: true });
});

// Disable all bindings for an agent profile
router.post(
  '/disable-for-agent/:agentProfileId',
  (req: Request, res: Response) => {
    const count = disableBindingsForAgent(String(req.params.agentProfileId));
    auditLog(
      req,
      'channel_bindings_disabled_for_agent',
      String(req.params.agentProfileId),
    );
    res.json({ ok: true, disabled: count });
  },
);

export default router;
