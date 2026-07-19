import fs from 'fs';
import path from 'path';

import {
  CODING_JOB_RUNNER_TIMEOUT_MS,
  MAX_CONCURRENT_CONTAINERS,
  STORE_DIR,
} from './config.js';
import {
  buildGitHubConnectorHealth,
  GitHubConnectorHealthInput,
} from './github-connector-health.js';
import { buildInferenceHealth } from './inference-health.js';
import { loadCodingJobs, CodingJob } from './coding-jobs.js';
import { probeAllCodingRunnerReadiness } from './coding-runner-readiness.js';
import { probeAllAgentRuntimes } from './agent-runtime-registry.js';
import { GroupQueue } from './group-queue.js';
import {
  buildChannelStatus,
  channelIdForRegisteredGroup,
} from './channel-status.js';
import { NanoCrabState, getState } from './admin/state.js';
import { Channel, AgentRuntimeHealth } from './types.js';
import { readEnvFile } from './env.js';

export type DiagnosticSeverity = 'required' | 'advisory';
export type DiagnosticStatus = 'ready' | 'attention' | 'blocked';

export interface DiagnosticCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: DiagnosticSeverity;
  detail: string;
  hint?: string;
  stale?: boolean;
}

export interface DiagnosticSection {
  id: string;
  title: string;
  checks: DiagnosticCheck[];
}

export interface ProductionDiagnosticsResult {
  status: DiagnosticStatus;
  generatedAt: string;
  summary: {
    total: number;
    passed: number;
    failedRequired: number;
    failedAdvisory: number;
  };
  sections: DiagnosticSection[];
  loadIssues: string[];
  stale: boolean;
}

export interface ProductionDiagnosticsOptions {
  state?: NanoCrabState;
  queue?: GroupQueue;
  now?: Date;
  staleJobThresholdMs?: number;
  codingReadiness?: AgentRuntimeHealth[];
  agentRuntimes?: AgentRuntimeHealth[];
  codingJobs?: CodingJob[];
  inferenceHealth?: ReturnType<typeof buildInferenceHealth>;
  githubConnectorInput?: GitHubConnectorHealthInput;
}

const GITHUB_WEBHOOK_CONFIG_PATH = path.join(
  STORE_DIR,
  'webhook-config.json',
);
const GITHUB_WEBHOOK_EVENTS_PATH = path.join(
  STORE_DIR,
  'webhook-events.jsonl',
);

function redactSensitive(value: string): string {
  if (!value) return value;
  return (
    value
      // Strip any private absolute paths.
      .replace(
        /(?:[A-Za-z]:\\|\/home\/[^\s"']+|\/Users\/[^\s"']+|\/var\/[^\s"']+|\/etc\/[^\s"']+|\/opt\/[^\s"']+)/g,
        '[redacted path]',
      )
      // Strip token-like fragments.
      .replace(/(?:token|key|secret|password)[:=\s]+\S+/gi, '[redacted]')
      // Keep messages short and free of stack traces.
      .split('\n')[0]
      .slice(0, 240)
  );
}

function summarize(sections: DiagnosticSection[]): ProductionDiagnosticsResult['summary'] {
  const checks = sections.flatMap((section) => section.checks);
  return {
    total: checks.length,
    passed: checks.filter((check) => check.ok).length,
    failedRequired: checks.filter(
      (check) => !check.ok && check.severity === 'required',
    ).length,
    failedAdvisory: checks.filter(
      (check) => !check.ok && check.severity === 'advisory',
    ).length,
  };
}

function loadWebhookConfig(): GitHubConnectorHealthInput['config'] {
  try {
    const raw = fs.readFileSync(GITHUB_WEBHOOK_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as GitHubConnectorHealthInput['config'];
    return {
      enabled: !!parsed.enabled,
      secret: parsed.secret ? '****' : '',
      events: Array.isArray(parsed.events) ? parsed.events : [],
      targetJid: parsed.targetJid || '',
    };
  } catch {
    return { enabled: false, secret: '', events: [], targetJid: '' };
  }
}

function loadWebhookEvents(limit = 20): GitHubConnectorHealthInput['events'] {
  try {
    const content = fs.readFileSync(GITHUB_WEBHOOK_EVENTS_PATH, 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line) as GitHubConnectorHealthInput['events'][number];
        } catch {
          return null;
        }
      })
      .filter((event): event is NonNullable<typeof event> => !!event);
  } catch {
    return [];
  }
}

function buildGitHubConnectorInput(
  state?: NanoCrabState,
): GitHubConnectorHealthInput {
  const env = readEnvFile(['GITHUB_TOKEN', 'GITHUB_WEBHOOK_SECRET']);
  const token = !!(process.env.GITHUB_TOKEN || env.GITHUB_TOKEN);
  const webhookSecret = !!(
    process.env.GITHUB_WEBHOOK_SECRET ||
    env.GITHUB_WEBHOOK_SECRET
  );
  const config = loadWebhookConfig();
  const events = loadWebhookEvents();

  let targetGroupExists = false;
  if (state) {
    targetGroupExists = Object.keys(state.registeredGroups()).some(
      (jid) => jid === config.targetJid,
    );
  }

  return {
    webhookUrl: '/api/webhooks/github',
    config,
    events,
    tokenConfigured: token,
    webhookSecretConfigured: webhookSecret,
    targetGroupExists,
  };
}

function runtimeSeverity(status: AgentRuntimeHealth['status']): DiagnosticSeverity {
  if (status === 'error' || status === 'missing') return 'required';
  return 'advisory';
}

function buildRuntimeSection(
  codingReadiness: AgentRuntimeHealth[],
  agentRuntimes: AgentRuntimeHealth[],
): DiagnosticSection {
  const byCli = new Map<string, AgentRuntimeHealth>();
  for (const health of [...codingReadiness, ...agentRuntimes]) {
    if (!byCli.has(health.cli) || byCli.get(health.cli)?.status !== 'healthy') {
      byCli.set(health.cli, health);
    }
  }

  const checks: DiagnosticCheck[] = [];
  for (const [cli, health] of byCli) {
    const detail = redactSensitive(
      health.status === 'healthy'
        ? `${cli} runtime is ready`
        : `${cli} runtime status: ${health.status}${health.detail ? ` — ${health.detail}` : ''}`,
    );
    let hint: string | undefined;
    if (health.status !== 'healthy') {
      if (health.detail?.toLowerCase().includes('sandbox')) {
        hint = 'Verify the host sandbox executable and that the container image is available';
      } else if (health.status === 'missing') {
        hint = `Install or configure the ${cli} CLI before using it for coding jobs`;
      } else {
        hint = 'Review the runtime status in Settings > Providers or agent profiles';
      }
    }
    checks.push({
      id: `runtime-${cli}`,
      label: `${cli} runtime`,
      ok: health.status === 'healthy',
      severity: runtimeSeverity(health.status),
      detail,
      hint,
    });
  }

  return { id: 'runtime', title: 'Agent runtimes', checks };
}

function buildQueueSection(queue: GroupQueue): DiagnosticSection {
  const diag = queue.getQueueDiagnostics();
  const checks: DiagnosticCheck[] = [
    {
      id: 'queue-capacity',
      label: 'Queue capacity',
      ok:
        diag.activeCount < MAX_CONCURRENT_CONTAINERS &&
        diag.waitingCount === 0,
      severity: diag.waitingCount > 0 ? 'required' : 'advisory',
      detail:
        diag.activeCount < MAX_CONCURRENT_CONTAINERS
          ? `${diag.activeCount} of ${MAX_CONCURRENT_CONTAINERS} container slots in use`
          : `All ${MAX_CONCURRENT_CONTAINERS} container slots are busy`,
      hint:
        diag.waitingCount > 0
          ? 'Increase MAX_CONCURRENT_CONTAINERS or wait for active containers to finish'
          : undefined,
    },
    {
      id: 'queue-waiting',
      label: 'Waiting groups',
      ok: diag.waitingCount === 0,
      severity: diag.waitingCount > 0 ? 'required' : 'advisory',
      detail:
        diag.waitingCount === 0
          ? 'No groups are waiting for a container slot'
          : `${diag.waitingCount} group(s) are queued behind the concurrency limit`,
      hint:
        diag.waitingCount > 0
          ? 'Review active agent sessions and consider closing idle containers'
          : undefined,
    },
    {
      id: 'queue-pending-tasks',
      label: 'Pending tasks',
      ok: diag.pendingTasks === 0,
      severity: diag.pendingTasks > 0 ? 'required' : 'advisory',
      detail:
        diag.pendingTasks === 0
          ? 'No pending tasks in the queue'
          : `${diag.pendingTasks} task(s) are queued`,
    },
    {
      id: 'queue-pending-messages',
      label: 'Pending messages',
      ok: diag.pendingMessages === 0,
      severity: 'advisory',
      detail:
        diag.pendingMessages === 0
          ? 'No queued message checks'
          : `${diag.pendingMessages} message check(s) are queued`,
    },
  ];

  return { id: 'queue', title: 'Queue and concurrency', checks };
}

function buildStaleJobsSection(
  jobs: CodingJob[],
  now: Date,
  thresholdMs: number,
): DiagnosticSection {
  const terminal = new Set(['completed', 'failed', 'cancelled']);
  const staleChecks: DiagnosticCheck[] = [];
  const activeChecks: DiagnosticCheck[] = [];

  for (const job of jobs) {
    if (terminal.has(job.status)) continue;
    const lastTransition =
      job.transitionedAt[job.status] || job.createdAt;
    const lastAt = Date.parse(lastTransition);
    if (Number.isNaN(lastAt)) continue;
    const elapsedMs = now.getTime() - lastAt;
    const isStale = elapsedMs > thresholdMs;

    const detail = `${job.repo}#${job.branch} in ${job.status} for ${Math.round(elapsedMs / 60000)}m`;
    const check: DiagnosticCheck = {
      id: `stale-job-${job.id}`,
      label: `Job ${job.id.slice(0, 8)}`,
      ok: !isStale,
      severity: isStale ? 'advisory' : 'required',
      detail,
      hint: isStale
        ? 'Open the Control Plane to review the stuck job; do not restart external systems automatically'
        : `Job is actively progressing (${job.status})`,
      stale: isStale,
    };
    if (isStale) {
      staleChecks.push(check);
    } else {
      activeChecks.push(check);
    }
  }

  // Limit stale job detail to avoid huge payloads.
  return {
    id: 'stale-jobs',
    title: 'Active and stale jobs',
    checks: staleChecks.slice(0, 20).concat(activeChecks.slice(0, 10)),
  };
}

function buildSandboxSection(
  codingReadiness: AgentRuntimeHealth[],
): DiagnosticSection {
  const checks: DiagnosticCheck[] = [];
  const sandboxProblems = codingReadiness.filter((health) =>
    health.detail.toLowerCase().includes('sandbox'),
  );
  if (sandboxProblems.length === 0) {
    checks.push({
      id: 'sandbox-ready',
      label: 'Sandbox readiness',
      ok: true,
      severity: 'required',
      detail: 'Sandbox credential handoff and image checks passed where applicable',
    });
  } else {
    for (const health of sandboxProblems) {
      checks.push({
        id: `sandbox-${health.cli}`,
        label: `${health.cli} sandbox`,
        ok: false,
        severity: 'required',
        detail: redactSensitive(health.detail),
        hint: 'Sandbox readiness must be satisfied before running untrusted coding jobs',
      });
    }
  }

  const imageProblems = codingReadiness.filter((health) =>
    health.detail.toLowerCase().includes('image'),
  );
  for (const health of imageProblems) {
    checks.push({
      id: `container-image-${health.cli}`,
      label: `${health.cli} container image`,
      ok: false,
      severity: 'required',
      detail: redactSensitive(health.detail),
      hint: 'Rebuild or pull the agent container image and confirm the runtime binary',
    });
  }

  return { id: 'sandbox', title: 'Sandbox and readiness', checks };
}

function buildConnectorsSection(
  githubInput: GitHubConnectorHealthInput,
  inference: ReturnType<typeof buildInferenceHealth>,
): DiagnosticSection {
  const checks: DiagnosticCheck[] = [];

  const githubHealth = buildGitHubConnectorHealth(githubInput);
  for (const check of githubHealth.checks) {
    checks.push({
      id: `github-${check.id}`,
      label: check.label,
      ok: check.ok,
      severity: check.severity,
      detail: redactSensitive(check.detail),
      hint: check.hint,
    });
  }

  for (const item of inference.items) {
    checks.push({
      id: `inference-${item.profileId}`,
      label: `Provider profile: ${item.label}`,
      ok: item.ok,
      severity: 'advisory',
      detail: `${item.status} (${item.provider}/${item.model}, ${item.locality})${item.failedChecks.length > 0 ? ` — ${item.failedChecks.join(', ')}` : ''}`,
      hint: item.status === 'unconfigured'
        ? 'Configure the provider API key or base URL'
        : item.status === 'stale'
          ? 'Re-run the provider probe to refresh the status'
          : undefined,
      stale: item.status === 'stale',
    });
  }

  return { id: 'connectors', title: 'Connectors', checks };
}

function buildChannelsSection(
  channels: Channel[],
  registeredGroups: NanoCrabState['registeredGroups'],
): DiagnosticSection {
  const checks: DiagnosticCheck[] = [];

  for (const channel of channels) {
    const snapshot = buildChannelStatus(channel);
    const channelId = channel.name.toLowerCase();
    const isEnabled = Object.entries(registeredGroups()).some(
      ([jid, group]) =>
        group.kind !== 'web' &&
        channelIdForRegisteredGroup(jid, group) === channelId,
    );
    const ok = snapshot.status === 'healthy';
    const detail = redactSensitive(
      snapshot.reason || `${channel.name} is ${snapshot.status}`,
    );
    checks.push({
      id: `channel-${channel.name}`,
      label: `${channel.name} channel`,
      ok,
      severity: isEnabled && !ok ? 'required' : 'advisory',
      detail,
      hint:
        !ok && isEnabled
          ? `Check the ${channel.name} adapter credentials and network reachability`
          : undefined,
    });
  }

  return { id: 'channels', title: 'Channels', checks };
}

export function formatDiagnosticsSummary(
  result: ProductionDiagnosticsResult,
): string {
  const lines = [
    'NanoCrab production diagnostics',
    `Status: ${result.status}`,
    `Checks: ${result.summary.passed}/${result.summary.total} passed`,
  ];
  if (result.summary.failedRequired > 0) {
    lines.push(
      `Required failures: ${result.summary.failedRequired}`,
    );
  }
  if (result.summary.failedAdvisory > 0) {
    lines.push(
      `Advisory failures: ${result.summary.failedAdvisory}`,
    );
  }
  if (result.stale) {
    lines.push('Stale data detected; some signals may be out of date.');
  }
  if (result.loadIssues.length > 0) {
    lines.push(`Load issues: ${result.loadIssues.join('; ')}`);
  }
  for (const section of result.sections) {
    const failing = section.checks.filter((c) => !c.ok);
    if (failing.length === 0) continue;
    lines.push(`\n${section.title}:`);
    for (const check of failing) {
      const staleFlag = check.stale ? ' [stale]' : '';
      lines.push(`- ${check.label}: ${check.detail}${staleFlag}`);
      if (check.hint) lines.push(`  Hint: ${check.hint}`);
    }
  }
  return lines.join('\n');
}

export async function buildProductionDiagnostics(
  options: ProductionDiagnosticsOptions = {},
): Promise<ProductionDiagnosticsResult> {
  const now = options.now || new Date();
  const generatedAt = now.toISOString();
  const loadIssues: string[] = [];

  let state: NanoCrabState | undefined = options.state;
  if (!state) {
    try {
      state = getState();
    } catch {
      loadIssues.push('NanoCrab state is not initialized');
    }
  }

  let codingReadiness: AgentRuntimeHealth[];
  try {
    codingReadiness =
      options.codingReadiness ?? (await probeAllCodingRunnerReadiness());
  } catch (_err) {
    loadIssues.push('Could not probe coding runner readiness');
    codingReadiness = [];
  }

  let agentRuntimes: AgentRuntimeHealth[];
  try {
    agentRuntimes =
      options.agentRuntimes ?? (await probeAllAgentRuntimes());
  } catch (_err) {
    loadIssues.push('Could not probe agent runtimes');
    agentRuntimes = [];
  }

  let jobs: CodingJob[];
  try {
    jobs = options.codingJobs ?? loadCodingJobs();
  } catch (_err) {
    loadIssues.push('Could not load coding jobs');
    jobs = [];
  }

  const inference =
    options.inferenceHealth ?? buildInferenceHealth();

  const githubConnectorInput =
    options.githubConnectorInput ?? buildGitHubConnectorInput(state);

  const sections: DiagnosticSection[] = [];

  sections.push(buildRuntimeSection(codingReadiness, agentRuntimes));

  const queue = options.queue ?? state?.queue;
  if (queue) {
    sections.push(buildQueueSection(queue));
  } else {
    sections.push({
      id: 'queue',
      title: 'Queue and concurrency',
      checks: [
        {
          id: 'queue-unavailable',
          label: 'Queue state',
          ok: false,
          severity: 'advisory',
          detail: 'Queue diagnostics are unavailable because NanoCrab state is not initialized',
        },
      ],
    });
  }

  sections.push(
    buildStaleJobsSection(
      jobs,
      now,
      options.staleJobThresholdMs ?? CODING_JOB_RUNNER_TIMEOUT_MS,
    ),
  );

  sections.push(buildSandboxSection(codingReadiness));

  sections.push(buildConnectorsSection(githubConnectorInput, inference));

  if (state?.channels) {
    sections.push(
      buildChannelsSection(state.channels, state.registeredGroups),
    );
  }

  const summary = summarize(sections);
  const stale = sections.some((section) =>
    section.checks.some((check) => check.stale),
  );

  return {
    status:
      summary.failedRequired > 0
        ? 'blocked'
        : summary.failedAdvisory > 0
          ? 'attention'
          : 'ready',
    generatedAt,
    summary,
    sections,
    loadIssues,
    stale,
  };
}
