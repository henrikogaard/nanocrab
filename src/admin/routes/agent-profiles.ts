import { Router, Request, Response } from 'express';

import * as agentProfiles from '../../agent-profiles.js';
import type {
  AgentProfileInput,
  AgentProfileUpdateInput,
  AgentSubscriptionInput,
} from '../../agent-profiles.js';
import type { AgentProfile, AgentSubscription } from '../../types.js';
import { auditLog } from '../security.js';

type AgentProfileRosterState = 'enabled' | 'disabled';

interface AgentProfileRosterSummary extends AgentProfile {
  rosterState: AgentProfileRosterState;
  subscriptionsCount: number;
  enabledSubscriptionsCount: number;
  activityCount: number;
  lastActivityAt: string | null;
}

type AgentSubscriptionUpdateInput = Partial<
  Pick<
    AgentSubscription,
    | 'enabled'
    | 'filters'
    | 'taskKind'
    | 'autonomyMode'
    | 'lastSeenAt'
    | 'lastMatchedAt'
    | 'lastRunId'
  >
>;

type AgentProfilesDomain = typeof agentProfiles & {
  listAgentProfilesWithSummary?: () => AgentProfileRosterSummary[];
  updateAgentSubscription?: (
    id: string,
    patch: AgentSubscriptionUpdateInput,
  ) => AgentSubscription;
};

const domain = agentProfiles as AgentProfilesDomain;
const router = Router();

const EDITABLE_PROFILE_FIELDS = [
  'handle',
  'displayName',
  'avatar',
  'description',
  'personality',
  'enabled',
  'providerProfileId',
  'provider',
  'model',
  'toolPolicy',
  'allowedMcpServers',
  'skills',
  'memoryScopes',
  'taskKinds',
  'channelBindings',
  'writePolicy',
] as const satisfies readonly (keyof AgentProfileUpdateInput)[];

const EDITABLE_SUBSCRIPTION_FIELDS = [
  'enabled',
  'filters',
  'taskKind',
  'autonomyMode',
  'lastSeenAt',
  'lastMatchedAt',
  'lastRunId',
] as const satisfies readonly (keyof AgentSubscriptionUpdateInput)[];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickFields<T extends string>(
  body: unknown,
  fields: readonly T[],
): Partial<Record<T, unknown>> {
  if (!isRecord(body)) return {};

  return fields.reduce<Partial<Record<T, unknown>>>((patch, field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      patch[field] = body[field];
    }
    return patch;
  }, {});
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

function profilePatch(body: unknown): AgentProfileUpdateInput {
  return pickFields(body, EDITABLE_PROFILE_FIELDS) as AgentProfileUpdateInput;
}

function subscriptionPatch(body: unknown): AgentSubscriptionUpdateInput {
  return pickFields(
    body,
    EDITABLE_SUBSCRIPTION_FIELDS,
  ) as AgentSubscriptionUpdateInput;
}

function sendError(res: Response, status: number, err: unknown): void {
  res.status(status).json({ error: errorMessage(err) });
}

function findProfileOr404(req: Request, res: Response): AgentProfile | null {
  const profile = domain.getAgentProfile(routeParam(req, 'id'));
  if (!profile) {
    res.status(404).json({ error: 'Agent profile not found' });
    return null;
  }
  return profile;
}

function findSubscriptionForProfile(
  agentProfileId: string,
  subscriptionId: string,
): AgentSubscription | undefined {
  return domain
    .listAgentSubscriptions(agentProfileId)
    .find((subscription) => subscription.id === subscriptionId);
}

function findSubscriptionOr404(
  req: Request,
  res: Response,
): AgentSubscription | null {
  const subscription = findSubscriptionForProfile(
    routeParam(req, 'id'),
    routeParam(req, 'subscriptionId'),
  );
  if (!subscription) {
    res.status(404).json({ error: 'Agent subscription not found' });
    return null;
  }
  return subscription;
}

function subscriptionUpdateUnavailable(res: Response): void {
  res.status(501).json({
    error: 'Agent subscription updates require a domain update helper',
  });
}

function buildRosterSummary(profile: AgentProfile): AgentProfileRosterSummary {
  const subscriptions = domain.listAgentSubscriptions(profile.id);
  const activity = domain.listAgentProfileActivity(profile.id, 50);

  return {
    ...profile,
    rosterState: profile.enabled ? 'enabled' : 'disabled',
    subscriptionsCount: subscriptions.length,
    enabledSubscriptionsCount: subscriptions.filter(
      (subscription) => subscription.enabled,
    ).length,
    activityCount: activity.length,
    lastActivityAt: activity[0]?.createdAt ?? null,
  };
}

router.get('/', (_req: Request, res: Response) => {
  if (domain.listAgentProfilesWithSummary) {
    res.json(domain.listAgentProfilesWithSummary());
    return;
  }

  res.json(domain.listAgentProfiles().map(buildRosterSummary));
});

router.post('/', (req: Request, res: Response) => {
  try {
    const profile = domain.createAgentProfile(req.body as AgentProfileInput);
    auditLog(req, 'agent_profile_created', profile.id);
    res.json({ ok: true, profile });
  } catch (err) {
    sendError(res, 400, err);
  }
});

router.get('/:id', (req: Request, res: Response) => {
  const profile = findProfileOr404(req, res);
  if (!profile) return;

  res.json({
    ...profile,
    subscriptions: domain.listAgentSubscriptions(profile.id),
    activity: domain.listAgentProfileActivity(profile.id, 50),
  });
});

router.put('/:id', (req: Request, res: Response) => {
  if (!findProfileOr404(req, res)) return;

  try {
    const profile = domain.updateAgentProfile(
      routeParam(req, 'id'),
      profilePatch(req.body),
    );
    auditLog(req, 'agent_profile_updated', profile.id);
    res.json({ ok: true, profile });
  } catch (err) {
    sendError(res, 400, err);
  }
});

router.post('/:id/enable', (req: Request, res: Response) => {
  if (!findProfileOr404(req, res)) return;

  try {
    const profile = domain.updateAgentProfile(routeParam(req, 'id'), {
      enabled: true,
    });
    auditLog(req, 'agent_profile_enabled', profile.id);
    res.json({ ok: true, profile });
  } catch (err) {
    sendError(res, 400, err);
  }
});

router.post('/:id/disable', (req: Request, res: Response) => {
  if (!findProfileOr404(req, res)) return;

  try {
    const profile = domain.updateAgentProfile(routeParam(req, 'id'), {
      enabled: false,
    });
    auditLog(req, 'agent_profile_disabled', profile.id);
    res.json({ ok: true, profile });
  } catch (err) {
    sendError(res, 400, err);
  }
});

router.get('/:id/subscriptions', (req: Request, res: Response) => {
  const profile = findProfileOr404(req, res);
  if (!profile) return;

  res.json(domain.listAgentSubscriptions(profile.id));
});

router.post('/:id/subscriptions', (req: Request, res: Response) => {
  if (!findProfileOr404(req, res)) return;

  try {
    const subscription = domain.createAgentSubscription({
      ...(isRecord(req.body) ? req.body : {}),
      agentProfileId: routeParam(req, 'id'),
    } as AgentSubscriptionInput);
    auditLog(req, 'agent_subscription_created', subscription.id);
    res.json({ ok: true, subscription });
  } catch (err) {
    sendError(res, 400, err);
  }
});

router.put(
  '/:id/subscriptions/:subscriptionId',
  (req: Request, res: Response) => {
    if (!findProfileOr404(req, res)) return;
    if (!findSubscriptionOr404(req, res)) return;

    if (!domain.updateAgentSubscription) {
      subscriptionUpdateUnavailable(res);
      return;
    }

    try {
      const subscription = domain.updateAgentSubscription(
        routeParam(req, 'subscriptionId'),
        subscriptionPatch(req.body),
      );
      auditLog(req, 'agent_subscription_updated', subscription.id);
      res.json({ ok: true, subscription });
    } catch (err) {
      sendError(res, 400, err);
    }
  },
);

router.post(
  '/:id/subscriptions/:subscriptionId/enable',
  (req: Request, res: Response) => {
    if (!findProfileOr404(req, res)) return;
    if (!findSubscriptionOr404(req, res)) return;

    if (!domain.updateAgentSubscription) {
      subscriptionUpdateUnavailable(res);
      return;
    }

    try {
      const subscription = domain.updateAgentSubscription(
        routeParam(req, 'subscriptionId'),
        { enabled: true },
      );
      auditLog(req, 'agent_subscription_enabled', subscription.id);
      res.json({ ok: true, subscription });
    } catch (err) {
      sendError(res, 400, err);
    }
  },
);

router.post(
  '/:id/subscriptions/:subscriptionId/disable',
  (req: Request, res: Response) => {
    if (!findProfileOr404(req, res)) return;
    if (!findSubscriptionOr404(req, res)) return;

    if (!domain.updateAgentSubscription) {
      subscriptionUpdateUnavailable(res);
      return;
    }

    try {
      const subscription = domain.updateAgentSubscription(
        routeParam(req, 'subscriptionId'),
        { enabled: false },
      );
      auditLog(req, 'agent_subscription_disabled', subscription.id);
      res.json({ ok: true, subscription });
    } catch (err) {
      sendError(res, 400, err);
    }
  },
);

router.get('/:id/activity', (req: Request, res: Response) => {
  const profile = findProfileOr404(req, res);
  if (!profile) return;

  res.json(domain.listAgentProfileActivity(profile.id, 50));
});

export default router;
