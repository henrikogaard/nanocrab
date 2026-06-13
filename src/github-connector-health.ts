export type GitHubConnectorHealthStatus = 'ready' | 'attention' | 'blocked';
export type GitHubConnectorHealthSeverity = 'required' | 'advisory';

export interface GitHubWebhookConfigView {
  enabled: boolean;
  secret?: string;
  events: string[];
  targetJid?: string;
}

export interface GitHubWebhookEventView {
  timestamp?: string;
  event?: string;
  repo?: string;
  status?: string;
}

export interface GitHubConnectorHealthCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: GitHubConnectorHealthSeverity;
  detail: string;
  hint?: string;
}

export interface GitHubConnectorHealthResult {
  status: GitHubConnectorHealthStatus;
  webhookUrl: string;
  generatedAt: string;
  summary: {
    total: number;
    passed: number;
    failedRequired: number;
    failedAdvisory: number;
  };
  checks: GitHubConnectorHealthCheck[];
}

export interface GitHubConnectorHealthInput {
  webhookUrl: string;
  config: GitHubWebhookConfigView;
  events: GitHubWebhookEventView[];
  tokenConfigured: boolean;
  webhookSecretConfigured: boolean;
  targetGroupExists: boolean;
  now?: Date;
}

function summarize(checks: GitHubConnectorHealthCheck[]) {
  const failedRequired = checks.filter(
    (check) => !check.ok && check.severity === 'required',
  ).length;
  const failedAdvisory = checks.filter(
    (check) => !check.ok && check.severity === 'advisory',
  ).length;
  return {
    total: checks.length,
    passed: checks.filter((check) => check.ok).length,
    failedRequired,
    failedAdvisory,
  };
}

export function buildGitHubConnectorHealth(
  input: GitHubConnectorHealthInput,
): GitHubConnectorHealthResult {
  const subscribedEvents = new Set(input.config.events || []);
  const recommendedEvents = ['push', 'pull_request', 'issues'];
  const hasRecommendedEvents = recommendedEvents.every((event) =>
    subscribedEvents.has(event),
  );
  const recentEvent = input.events.find((event) => !!event.timestamp);

  const checks: GitHubConnectorHealthCheck[] = [
    {
      id: 'github-token',
      label: 'GitHub API token',
      ok: input.tokenConfigured,
      severity: 'required',
      detail: input.tokenConfigured
        ? 'GitHub token is configured for connector and coding-job API calls'
        : 'GitHub token is missing',
      hint: 'Set GITHUB_TOKEN in Credentials before using GitHub issue pickup or coding jobs',
    },
    {
      id: 'webhook-enabled',
      label: 'Webhook receiver',
      ok: input.config.enabled,
      severity: 'advisory',
      detail: input.config.enabled
        ? 'GitHub webhook receiver is enabled'
        : 'GitHub webhook receiver is disabled',
      hint: 'Enable the receiver after the GitHub repository webhook is configured',
    },
    {
      id: 'webhook-secret',
      label: 'Webhook secret',
      ok: input.webhookSecretConfigured,
      severity: input.config.enabled ? 'required' : 'advisory',
      detail: input.webhookSecretConfigured
        ? 'Webhook secret is configured'
        : 'Webhook secret is missing',
      hint: 'Set a shared secret in NanoCrab and GitHub; secrets are never shown after saving',
    },
    {
      id: 'target-group',
      label: 'Notification target',
      ok: !!input.config.targetJid && input.targetGroupExists,
      severity: input.config.enabled ? 'required' : 'advisory',
      detail:
        input.config.targetJid && input.targetGroupExists
          ? 'Target group is configured'
          : input.config.targetJid
            ? 'Configured target group is not currently registered'
            : 'No target group selected',
      hint: 'Select a registered group to receive GitHub webhook summaries',
    },
    {
      id: 'event-selection',
      label: 'Event selection',
      ok: hasRecommendedEvents,
      severity: 'advisory',
      detail: hasRecommendedEvents
        ? 'Push, pull request, and issue events are selected'
        : 'Recommended events are not all selected',
      hint: 'Select push, pull_request, and issues events for coding and autofix workflows',
    },
    {
      id: 'recent-delivery',
      label: 'Recent delivery',
      ok: !!recentEvent,
      severity: 'advisory',
      detail: recentEvent
        ? `Most recent event: ${recentEvent.event || 'unknown'} on ${recentEvent.repo || 'unknown repo'}`
        : 'No webhook events have been received yet',
      hint: 'Use GitHub Webhook Settings -> Recent Deliveries to send a ping after setup',
    },
  ];

  const summary = summarize(checks);
  return {
    status:
      summary.failedRequired > 0
        ? 'blocked'
        : summary.failedAdvisory > 0
          ? 'attention'
          : 'ready',
    webhookUrl: input.webhookUrl,
    generatedAt: (input.now || new Date()).toISOString(),
    summary,
    checks,
  };
}
