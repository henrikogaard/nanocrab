import type { Request, Response } from 'express';

type JsonValue = unknown;

const now = new Date('2026-06-09T20:45:00.000Z');

function iso(minutesAgo = 0): string {
  return new Date(now.getTime() - minutesAgo * 60_000).toISOString();
}

function day(offset: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

const groups = [
  {
    jid: 'wa:alliance-command',
    name: 'Alliance Command',
    folder: 'main',
    channel: 'whatsapp',
    enabled: true,
    active: true,
    isMain: true,
    isPrimary: true,
    description: 'Main operator group for planning, admin, and approvals.',
    containerConfig: {
      persistent: true,
      provider: 'codex',
      model: 'gpt-5.4',
      memoryLimit: '2g',
      cpuLimit: '2',
    },
  },
  {
    jid: 'tg:operations-room',
    name: 'Operations Room',
    folder: 'operations',
    channel: 'telegram',
    enabled: true,
    active: true,
    isMain: true,
    isPrimary: false,
    description: 'Fleet operations and scheduled orders.',
    containerConfig: {
      persistent: true,
      provider: 'openrouter',
      model: 'openrouter/auto',
    },
  },
  {
    jid: 'sig:scouts',
    name: 'Scouting Desk',
    folder: 'scouts',
    channel: 'signal',
    enabled: false,
    active: false,
    isMain: true,
    isPrimary: false,
    description: 'Recon notes, sightings, and player intel.',
    containerConfig: {
      persistent: false,
      provider: 'ollama',
      model: 'gemma4:e2b',
    },
  },
];

const channels = [
  { name: 'whatsapp', connected: true, status: 'healthy', lastSeen: iso(1) },
  { name: 'telegram', connected: true, status: 'healthy', lastSeen: iso(3) },
  { name: 'signal', connected: true, status: 'healthy', lastSeen: iso(1) },
];

const agentBoundaries = [
  {
    jid: 'wa:alliance-command',
    name: 'Alliance Command',
    folder: 'main',
    isMain: true,
    boundary: {
      agentId: 'main',
      groupFolder: 'main',
      isMain: true,
      channelScopes: ['own', 'all'],
      filesystemScopes: [
        { containerPath: '/workspace/project', access: 'read-only' },
        { containerPath: '/workspace/project/store', access: 'read-write' },
        { containerPath: '/workspace/group', access: 'read-write' },
      ],
      skillScopes: {
        allowedScopes: ['all', 'main', 'channels'],
        allowedVisibility: ['shared', 'private', 'system'],
      },
      providerProfiles: ['default_chat', 'default_coding', 'default_reports'],
      connectorIds: ['nanocrab', 'github', 'kdrive'],
      externalWrites: { allowed: true, requiresApproval: true },
    },
    capabilities: {
      allowedConnectorIds: ['nanocrab', 'github', 'kdrive'],
      allowedChannelScopes: ['own', 'all'],
      allowedProviderProfiles: [
        'default_chat',
        'default_coding',
        'default_reports',
      ],
      allowExternalWrites: true,
      externalWritesRequireApproval: true,
      allowedToolActions: ['read', 'mcp.call', 'external.write'],
    },
  },
  {
    jid: 'tg:operations-room',
    name: 'Operations Room',
    folder: 'operations',
    isMain: false,
    boundary: {
      agentId: 'operations',
      groupFolder: 'operations',
      isMain: false,
      channelScopes: ['own'],
      filesystemScopes: [
        { containerPath: '/workspace/group', access: 'read-write' },
        { containerPath: '/workspace/global', access: 'read-only' },
      ],
      skillScopes: {
        allowedScopes: ['all', 'channels'],
        allowedVisibility: ['shared'],
      },
      providerProfiles: ['default_chat', 'default_automation'],
      connectorIds: ['nanocrab', 'github'],
      externalWrites: { allowed: false, requiresApproval: true },
    },
    capabilities: {
      allowedConnectorIds: ['nanocrab', 'github'],
      allowedChannelScopes: ['own'],
      allowedProviderProfiles: ['default_chat', 'default_automation'],
      allowExternalWrites: false,
      externalWritesRequireApproval: true,
      allowedToolActions: ['read', 'mcp.call'],
    },
  },
];

const containers = [
  {
    id: 'mock-main-agent',
    name: 'nanocrab-main-agent',
    groupJid: 'wa:alliance-command',
    groupFolder: 'main',
    startedAt: iso(22),
    isTask: false,
    idleWaiting: false,
    status: 'running',
    currentStep: 'Summarizing latest operation requests',
  },
  {
    id: 'mock-coding-job',
    name: 'coding-job-1248',
    groupJid: 'tg:operations-room',
    groupFolder: 'operations',
    startedAt: iso(9),
    isTask: true,
    idleWaiting: true,
    status: 'running',
    currentStep: 'Waiting for operator approval before opening PR',
  },
];

const cockpitSessions = [
  {
    id: 'cockpit-running-001',
    sessionId: 'cockpit-running-001',
    group: 'main',
    provider: 'codex',
    model: 'gpt-5.4',
    status: 'running',
    startedAt: iso(18),
    updatedAt: iso(1),
    lastEventAt: iso(1),
    lastActivity: iso(1),
    messageCount: 42,
    approvalCount: 0,
    artifactCount: 2,
    changedFiles: [
      'src/admin/routes/sessions.ts',
      'src/admin/public/pages/dashboard.js',
    ],
    currentStep:
      'Parsing transcript metadata and building cockpit session summaries.',
    filePath: 'cockpit-running-001.jsonl',
  },
  {
    id: 'cockpit-approval-002',
    sessionId: 'cockpit-approval-002',
    group: 'operations',
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    status: 'waiting_approval',
    startedAt: iso(54),
    updatedAt: iso(7),
    lastEventAt: iso(7),
    lastActivity: iso(7),
    messageCount: 27,
    approvalCount: 2,
    artifactCount: 1,
    changedFiles: ['docs/ops/nightfall-orders.md'],
    currentStep: 'Waiting for approval to publish revised operation orders.',
    filePath: 'cockpit-approval-002.jsonl',
  },
  {
    id: 'cockpit-failed-003',
    sessionId: 'cockpit-failed-003',
    group: 'scouts',
    provider: 'openrouter',
    model: 'openrouter/auto',
    status: 'failed',
    startedAt: iso(148),
    updatedAt: iso(132),
    lastEventAt: iso(132),
    lastActivity: iso(132),
    messageCount: 13,
    approvalCount: 0,
    artifactCount: 0,
    changedFiles: [],
    currentStep:
      'Provider request failed after retrying scout report extraction.',
    filePath: 'cockpit-failed-003.jsonl',
  },
  {
    id: 'cockpit-complete-004',
    sessionId: 'cockpit-complete-004',
    group: 'HenrikOrg/nanocrab',
    provider: 'codex',
    model: 'gpt-5.4',
    status: 'completed',
    startedAt: iso(360),
    updatedAt: iso(295),
    lastEventAt: iso(295),
    lastActivity: iso(295),
    messageCount: 58,
    approvalCount: 1,
    artifactCount: 3,
    changedFiles: ['src/admin/routes/containers.ts', 'src/admin/websocket.ts'],
    currentStep: 'Completed implementation and recorded focused test results.',
    filePath: '',
  },
];

const approvals = [
  {
    id: 'approval-message-risk',
    kind: 'external-message',
    title: 'Send outbound operation update',
    summary:
      'Post revised rally timing to Alliance Command with player names and target windows.',
    risk: 'high',
    requester: 'main',
    targetType: 'message',
    targetId: 'msg-outbound-418',
    source: 'chat',
    correlationId: 'corr-nightfall-ops',
    expiresAt: iso(-16),
    actionPreview:
      'Send to wa:alliance-command: Rally window moved to 21:30. Confirm leaders: Mira, Henrik, Scout-7.',
    resourceSummary: 'WhatsApp outbound message to Alliance Command',
    policyDecisionId: 'policy-outbound-sensitive',
    payload: { channel: 'whatsapp', groupJid: 'wa:alliance-command' },
    status: 'pending',
    createdAt: iso(7),
    reviewedAt: null,
    reviewedBy: null,
    decisionNote: null,
  },
  {
    id: 'approval-upload-risk',
    kind: 'upload',
    title: 'Process uploaded scout archive',
    summary:
      'Extract text and images from a large uploaded archive before sharing findings with scouts.',
    risk: 'medium',
    requester: 'scouts',
    targetType: 'upload',
    targetId: 'upload-scout-archive',
    source: 'attachment',
    correlationId: 'corr-scout-upload',
    expiresAt: iso(-60),
    actionPreview: 'Unpack scout-intel.zip and run OCR on 18 image files.',
    resourceSummary: 'ZIP upload with screenshots and notes',
    policyDecisionId: 'policy-upload-review',
    payload: { filename: 'scout-intel.zip', sizeMb: 42 },
    status: 'pending',
    createdAt: iso(18),
    reviewedAt: null,
    reviewedBy: null,
    decisionNote: null,
  },
  {
    id: 'approval-repo-risk',
    kind: 'coding-open-pr',
    title: 'Open PR for provider routing fix',
    summary:
      'Publish branch issue-42-provider-routing with changes to provider fallback policy.',
    risk: 'high',
    requester: 'coding-agent',
    targetType: 'coding-job',
    targetId: 'af-job-1',
    source: 'autofix',
    correlationId: 'corr-gh-42',
    expiresAt: iso(-45),
    actionPreview:
      'git push origin issue-42-provider-routing && gh pr create --fill',
    resourceSummary: 'Repository change touching provider fallback code',
    policyDecisionId: 'policy-repo-write',
    payload: { issue: 42, branch: 'issue-42-provider-routing' },
    status: 'pending',
    createdAt: iso(24),
    reviewedAt: null,
    reviewedBy: null,
    decisionNote: null,
  },
  {
    id: 'approval-provider-risk',
    kind: 'provider-fallback',
    title: 'Fallback from Codex to OpenRouter',
    summary:
      'Primary provider failed preflight; route the current operation summary to OpenRouter.',
    risk: 'medium',
    requester: 'provider-router',
    targetType: 'provider',
    targetId: 'openrouter',
    source: 'provider-router',
    correlationId: 'corr-provider-fallback',
    expiresAt: iso(-20),
    actionPreview: 'Retry operation summary with openrouter/auto.',
    resourceSummary: 'Provider fallback for Operations Room',
    policyDecisionId: 'policy-provider-fallback',
    payload: { from: 'codex', to: 'openrouter', group: 'operations' },
    status: 'pending',
    createdAt: iso(32),
    reviewedAt: null,
    reviewedBy: null,
    decisionNote: null,
  },
  {
    id: 'approval-tool-risk',
    kind: 'tool-action',
    title: 'Run deployment health probe',
    summary:
      'Call a configured tool that reaches the deployment endpoint and records freshness state.',
    risk: 'low',
    requester: 'uptime',
    targetType: 'tool',
    targetId: 'deployment-probe',
    source: 'tool-runner',
    correlationId: 'corr-uptime-probe',
    expiresAt: iso(-90),
    actionPreview: 'probe https://nanocrab.example/health --record',
    resourceSummary: 'External HTTP probe tool action',
    policyDecisionId: 'policy-tool-network',
    payload: { url: 'https://nanocrab.example/health', method: 'GET' },
    status: 'pending',
    createdAt: iso(45),
    reviewedAt: null,
    reviewedBy: null,
    decisionNote: null,
  },
  {
    id: 'approval-history-1',
    kind: 'report-outline',
    title: 'Approve weekly alliance digest outline',
    summary: 'Situation summary, notable events, risks, next actions.',
    risk: 'low',
    requester: 'operations',
    targetType: 'report-job',
    targetId: 'report-mock-1',
    source: 'report-writer',
    correlationId: 'corr-weekly-digest',
    expiresAt: null,
    actionPreview:
      'Create digest outline with situation summary, notable events, risks, and next actions.',
    resourceSummary: 'Weekly alliance digest outline',
    policyDecisionId: 'policy-report-outline',
    payload: { jobId: 'report-mock-1' },
    status: 'approved',
    createdAt: iso(180),
    reviewedAt: iso(120),
    reviewedBy: 'mock-owner',
    decisionNote: 'Outline approved for drafting.',
  },
];

const auditEvents = [
  {
    id: 'audit-code-plan',
    timestamp: iso(22),
    actor: 'coding-agent',
    actorId: 'code-mock-1',
    actionType: 'coding.transition',
    resource: 'code-mock-1',
    decision: 'allowed',
    context: { from: 'queued', to: 'plan', repo: 'henrikogaard/nanocrab' },
    correlationId: 'code-mock-1',
    durationMs: 12,
    error: null,
  },
  {
    id: 'audit-code-dry-run',
    timestamp: iso(21),
    actor: 'coding-agent',
    actorId: 'code-mock-1',
    actionType: 'coding.implement',
    resource: 'henrikogaard/nanocrab',
    decision: 'simulated',
    context: {
      branch: 'nanocrab/p0-policy-engine',
      dryRun: true,
      explanation: 'Repository write simulated with read-only mounts.',
    },
    correlationId: 'code-mock-1',
    durationMs: 41,
    error: null,
  },
  {
    id: 'audit-pr-approval',
    timestamp: iso(19),
    actor: 'mock-owner',
    actorId: 'approval-repo-risk',
    actionType: 'approval.coding-open-pr.approved',
    resource: 'coding-job/af-job-1',
    decision: 'approved',
    context: {
      approvalId: 'approval-repo-risk',
      policyDecisionId: 'policy-repo-write',
    },
    correlationId: 'corr-gh-42',
    durationMs: 4,
    error: null,
  },
  {
    id: 'audit-provider-fallback',
    timestamp: iso(32),
    actor: 'provider-router',
    actorId: null,
    actionType: 'provider.fallback',
    resource: 'default_coding',
    decision: 'requires_approval',
    context: {
      from: 'codex/gpt-5.4',
      to: 'openrouter/auto',
      reason: 'Primary provider preflight failed.',
    },
    correlationId: 'corr-provider-fallback',
    durationMs: 8,
    error: null,
  },
  {
    id: 'audit-channel-send',
    timestamp: iso(11),
    actor: 'router',
    actorId: null,
    actionType: 'channel.send',
    resource: 'wa:alliance-command',
    decision: 'allowed',
    context: { channel: 'whatsapp', textLength: 184 },
    correlationId: 'corr-nightfall-ops',
    durationMs: 73,
    error: null,
  },
  {
    id: 'audit-upload-denied',
    timestamp: iso(45),
    actor: 'attachment-handler',
    actorId: 'upload-scout-archive',
    actionType: 'upload.process',
    resource: 'scout-intel.zip',
    decision: 'denied',
    context: {
      filename: 'scout-intel.zip',
      reason: 'Archive processing denied by policy simulator.',
      apiKey: '[REDACTED]',
    },
    correlationId: 'corr-scout-upload',
    durationMs: 2,
    error: 'Upload policy denied archive extraction',
  },
];

const messages = [
  {
    id: 'msg-001',
    chat_jid: 'wa:alliance-command',
    chat_name: 'Alliance Command',
    sender_name: 'Henrik',
    content:
      'Can we prepare a coordinated attack window for tonight? I have 53,200 soldiers ready.',
    timestamp: iso(6),
    is_bot_message: false,
    channel: 'whatsapp',
  },
  {
    id: 'msg-002',
    chat_jid: 'wa:alliance-command',
    chat_name: 'Alliance Command',
    sender_name: 'NanoCrab',
    content:
      'Logged the request, added you to the operation planning list, and matched available forces against current scout reports.',
    timestamp: iso(5),
    is_bot_message: true,
    channel: 'whatsapp',
  },
  {
    id: 'msg-003',
    chat_jid: 'tg:operations-room',
    chat_name: 'Operations Room',
    sender_name: 'Mira',
    content:
      'Forum tag #operation-nightfall has updated target windows and rally point notes.',
    timestamp: iso(18),
    is_bot_message: false,
    channel: 'telegram',
  },
  {
    id: 'msg-004',
    chat_jid: 'sig:scouts',
    chat_name: 'Scouting Desk',
    sender_name: 'Scout-7',
    content:
      'Enemy fleet spotted near Kepler-442b. Estimated return timer: 21:40 server time.',
    timestamp: iso(31),
    is_bot_message: false,
    channel: 'signal',
  },
  {
    id: 'msg-005',
    chat_jid: 'tg:operations-room',
    chat_name: 'Operations Room',
    sender_name: 'NanoCrab',
    content:
      'Daily summary draft is ready: 4 action items, 2 intel updates, 1 pending approval.',
    timestamp: iso(45),
    is_bot_message: true,
    channel: 'telegram',
  },
];

const tasks = [
  {
    id: 'task-daily-summary',
    group_folder: 'operations',
    chat_jid: 'tg:operations-room',
    prompt: 'Generate a daily casual-player summary from the last 24h.',
    schedule_type: 'cron',
    schedule_value: '0 20 * * *',
    next_run: iso(-75),
    last_run: day(-1) + 'T20:00:00.000Z',
    status: 'active',
    context_mode: 'group',
    created_at: day(-12) + 'T10:15:00.000Z',
  },
  {
    id: 'task-operation-reminder',
    group_folder: 'main',
    chat_jid: 'wa:alliance-command',
    prompt:
      'Repeat active operation orders and list missing confirmations every 30 minutes.',
    schedule_type: 'interval',
    schedule_value: '1800000',
    next_run: iso(-21),
    last_run: iso(9),
    status: 'active',
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    context_mode: 'group',
    created_at: day(-3) + 'T18:00:00.000Z',
  },
  {
    id: 'task-weekly-report',
    group_folder: 'main',
    chat_jid: 'wa:alliance-command',
    prompt: 'Produce a weekly report of notable attacks, diplomacy, and spend.',
    schedule_type: 'cron',
    schedule_value: '0 9 * * MON',
    next_run: day(6) + 'T09:00:00.000Z',
    last_run: day(-1) + 'T09:00:00.000Z',
    status: 'paused',
    provider_profile_id: 'report',
    provider: 'openrouter',
    model: 'openrouter/auto',
    context_mode: 'isolated',
    created_at: day(-20) + 'T09:00:00.000Z',
  },
];

const plugins = [
  {
    id: 'chat',
    name: 'Chat',
    version: '1.0.0',
    enabled: true,
    pageId: 'chat',
    sidebar: { id: 'chat', icon: '◎', label: 'Chat' },
  },
  {
    id: 'wiki',
    name: 'Wiki',
    version: '1.0.0',
    enabled: true,
    pageId: 'wiki',
    sidebar: { id: 'wiki', icon: '◇', label: 'Wiki' },
  },
  {
    id: 'workflows',
    name: 'Workflows',
    version: '1.0.0',
    enabled: true,
    pageId: 'workflows',
    sidebar: { id: 'workflows', icon: '⇄', label: 'Workflows' },
  },
  {
    id: 'uptime',
    name: 'Uptime Monitor',
    version: '1.0.0',
    enabled: true,
    pageId: 'uptime',
    sidebar: { id: 'uptime', icon: '◌', label: 'Uptime' },
  },
  {
    id: 'autofix',
    name: 'GitHub Autofix',
    version: '1.0.0',
    enabled: true,
    pageId: 'autofix',
    sidebar: { id: 'autofix', icon: '⌁', label: 'Autofix' },
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    version: '1.0.0',
    enabled: true,
    pageId: 'copilot',
    sidebar: { id: 'copilot', icon: '⌘', label: 'Copilot' },
  },
];

const providerDefinitions = {
  claude: {
    id: 'claude',
    name: 'Claude',
    description: 'Anthropic Claude through Agent SDK.',
    runtime: 'claude-agent-sdk',
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI Codex CLI coding runtime.',
    runtime: 'codex-cli',
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    description: 'OpenCode CLI coding-agent runtime.',
    runtime: 'opencode-cli',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local Ollama OpenAI-compatible endpoint.',
    runtime: 'openai-compatible',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'OpenRouter OpenAI-compatible gateway.',
    runtime: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    description: 'Gemini OpenAI-compatible endpoint.',
    runtime: 'openai-compatible',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    envKey: 'GEMINI_API_KEY',
  },
};

const providerInfo = {
  provider: 'codex',
  model: 'gpt-5.4',
  modelsByProvider: {
    claude: 'claude-sonnet-4-6',
    codex: 'gpt-5.4',
    opencode: 'opencode/grok-code-fast-1',
    ollama: 'gemma4:e2b',
    openrouter: 'openrouter/auto',
    google: 'gemini-2.5-flash',
  },
  baseUrlsByProvider: {
    ollama: 'http://127.0.0.1:11434/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  },
  definitions: providerDefinitions,
  models: {
    claude: ['claude-sonnet-4-6', 'claude-opus-4-6'],
    codex: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'o4-mini'],
    opencode: ['opencode/grok-code-fast-1'],
    ollama: ['gemma4:e2b', 'llama3.1', 'mistral'],
    openrouter: ['openrouter/auto', 'anthropic/claude-sonnet-4.5'],
    google: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  },
  available: {
    claude: true,
    codex: true,
    opencode: true,
    ollama: true,
    openrouter: true,
    google: true,
  },
  purposes: [
    { id: 'default_chat', label: 'Chat', toolPolicy: 'read-only' },
    {
      id: 'default_coding',
      label: 'Coding',
      toolPolicy: 'approval-required',
    },
    {
      id: 'default_automation',
      label: 'Automations',
      toolPolicy: 'approval-required',
    },
    {
      id: 'default_memory',
      label: 'Memory extraction',
      toolPolicy: 'read-only',
    },
    {
      id: 'default_journal',
      label: 'Journal extraction',
      toolPolicy: 'read-only',
    },
    {
      id: 'default_skill_factory',
      label: 'Skill Factory',
      toolPolicy: 'approval-required',
    },
    { id: 'default_reports', label: 'Reports', toolPolicy: 'read-only' },
    { id: 'default_docs', label: 'Documents', toolPolicy: 'read-only' },
    { id: 'default_vision', label: 'Vision', toolPolicy: 'read-only' },
  ],
  profiles: [
    {
      id: 'default_chat',
      label: 'Chat',
      purpose: 'default_chat',
      provider: 'openrouter',
      model: 'openrouter/auto',
      toolPolicy: 'read-only',
      fallbackProfileId: 'default_memory',
      updatedAt: iso(120),
    },
    {
      id: 'default_coding',
      label: 'Coding',
      purpose: 'default_coding',
      provider: 'codex',
      model: 'gpt-5.4',
      toolPolicy: 'approval-required',
      fallbackProfileId: 'default_automation',
      updatedAt: iso(180),
    },
    {
      id: 'default_automation',
      label: 'Automations',
      purpose: 'default_automation',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      toolPolicy: 'approval-required',
      fallbackProfileId: null,
      updatedAt: iso(240),
    },
    {
      id: 'default_memory',
      label: 'Memory extraction',
      purpose: 'default_memory',
      provider: 'google',
      model: 'gemini-2.5-flash',
      toolPolicy: 'read-only',
      fallbackProfileId: null,
      updatedAt: iso(300),
    },
    {
      id: 'default_journal',
      label: 'Journal extraction',
      purpose: 'default_journal',
      provider: 'google',
      model: 'gemini-2.5-flash',
      toolPolicy: 'read-only',
      fallbackProfileId: null,
      updatedAt: iso(360),
    },
    {
      id: 'default_skill_factory',
      label: 'Skill Factory',
      purpose: 'default_skill_factory',
      provider: 'codex',
      model: 'gpt-5.4',
      toolPolicy: 'approval-required',
      fallbackProfileId: 'default_automation',
      updatedAt: iso(420),
    },
    {
      id: 'default_reports',
      label: 'Reports',
      purpose: 'default_reports',
      provider: 'google',
      model: 'gemini-2.5-pro',
      toolPolicy: 'read-only',
      fallbackProfileId: 'default_chat',
      updatedAt: iso(480),
    },
    {
      id: 'default_docs',
      label: 'Documents',
      purpose: 'default_docs',
      provider: 'google',
      model: 'gemini-2.5-pro',
      toolPolicy: 'read-only',
      fallbackProfileId: 'default_reports',
      updatedAt: iso(540),
    },
    {
      id: 'default_vision',
      label: 'Vision',
      purpose: 'default_vision',
      provider: 'google',
      model: 'gemini-2.5-pro',
      toolPolicy: 'read-only',
      fallbackProfileId: 'default_chat',
      updatedAt: iso(600),
    },
  ],
  capabilityMatrix: {
    claude: {
      available: true,
      tool_calls: true,
      structured_output: true,
      streaming: true,
      vision: true,
      privacy_tier: 'hosted',
    },
    codex: {
      available: true,
      tool_calls: true,
      structured_output: true,
      streaming: true,
      vision: true,
      privacy_tier: 'hosted',
    },
    opencode: {
      available: true,
      tool_calls: true,
      structured_output: false,
      streaming: true,
      vision: false,
      privacy_tier: 'third-party',
    },
    ollama: {
      available: true,
      tool_calls: false,
      structured_output: false,
      streaming: true,
      vision: false,
      privacy_tier: 'local',
    },
    openrouter: {
      available: true,
      tool_calls: true,
      structured_output: true,
      streaming: true,
      vision: true,
      privacy_tier: 'third-party',
    },
    google: {
      available: true,
      tool_calls: true,
      structured_output: true,
      streaming: true,
      vision: true,
      privacy_tier: 'hosted',
    },
  },
  profileProbes: [
    {
      profileId: 'default_chat',
      provider: 'openrouter',
      model: 'openrouter/auto',
      ok: true,
      live: true,
      lastProbeAt: iso(8),
      latencyMs: 184,
      capabilities: {
        tool_calls: true,
        structured_output: true,
        streaming: true,
        vision: true,
        context_window: 128000,
      },
      checks: [{ id: 'mock', label: 'Mock profile check', ok: true }],
    },
    {
      profileId: 'default_automation',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      ok: false,
      live: true,
      lastProbeAt: iso(16),
      latencyMs: 2400,
      errorDetail: 'API key expired; update Claude credentials.',
      errors: ['API key expired; update Claude credentials.'],
      checks: [
        {
          id: 'mock-auth',
          label: 'Mock credentials',
          ok: false,
          detail: 'API key expired; update Claude credentials.',
        },
      ],
    },
  ],
  probeHistory: [
    {
      profileId: 'default_chat',
      provider: 'openrouter',
      model: 'openrouter/auto',
      ok: true,
      latencyMs: 184,
      streaming: true,
      streamingSupport: true,
      toolSupport: true,
      schemaSupport: true,
      visionSupport: true,
      contextWindow: 128000,
      timestamp: iso(8),
    },
    {
      profileId: 'default_chat',
      provider: 'openrouter',
      model: 'openrouter/auto',
      ok: true,
      latencyMs: 211,
      streaming: true,
      streamingSupport: true,
      toolSupport: true,
      schemaSupport: true,
      visionSupport: true,
      contextWindow: 128000,
      timestamp: iso(24),
    },
    {
      profileId: 'default_automation',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      ok: false,
      latencyMs: 2400,
      streaming: true,
      streamingSupport: true,
      toolSupport: true,
      schemaSupport: true,
      visionSupport: true,
      contextWindow: 200000,
      errorDetail: 'API key expired; update Claude credentials.',
      timestamp: iso(16),
    },
  ],
  auth: { codex: { configured: true, hasHostAuth: true } },
};

function dailyCounts(): { day: string; count: number }[] {
  return Array.from({ length: 30 }, (_, i) => ({
    day: day(i - 29),
    count: 12 + ((i * 7) % 31),
  }));
}

function usageDaily(): JsonValue[] {
  return Array.from({ length: 28 }, (_, i) => ({
    date: day(i - 27),
    input: 18_000 + i * 1200,
    output: 7_000 + i * 520,
    cacheWrite: 1_200 + i * 41,
    cacheRead: 8_000 + i * 210,
    estimatedCost: Number((0.38 + i * 0.021).toFixed(4)),
  }));
}

const repos = [
  { name: 'nanocrab', path: '/workspace/repos/nanocrab', readonly: false },
  { name: 'auroradocs', path: '/workspace/repos/auroradocs', readonly: true },
];

const skills = [
  {
    name: 'capabilities',
    description: 'Describe available tools and agent capabilities.',
    path: 'capabilities',
    category: 'core',
    enabled: true,
  },
  {
    name: 'status',
    description: 'Run a read-only status check of the agent environment.',
    path: 'status',
    category: 'core',
    enabled: true,
  },
  {
    name: 'memory-curator',
    description: 'Review and maintain durable cross-channel memories.',
    path: 'memory-curator',
    category: 'core',
    enabled: true,
  },
  {
    name: 'journalist',
    description: 'Extract notable events and create daily or weekly summaries.',
    path: 'journalist',
    category: 'core',
    enabled: true,
  },
  {
    name: 'task-planner',
    description: 'Turn chat requests into tasks, reminders, and follow-ups.',
    path: 'task-planner',
    category: 'core',
    enabled: true,
  },
  {
    name: 'report-writer',
    description: 'Create cited reports and exportable documents.',
    path: 'report-writer',
    category: 'core',
    enabled: true,
  },
  {
    name: 'github-issue-agent',
    description: 'Triage GitHub issues and prepare coding jobs.',
    path: 'github-issue-agent',
    category: 'core',
    enabled: true,
  },
  {
    name: 'code-reviewer',
    description: 'Review diffs for bugs, regressions, and missing tests.',
    path: 'code-reviewer',
    category: 'core',
    enabled: true,
  },
  {
    name: 'release-manager',
    description: 'Prepare changelogs, release notes, and rollout checks.',
    path: 'release-manager',
    category: 'core',
    enabled: true,
  },
  {
    name: 'email-assistant',
    description: 'Search, summarize, triage, and draft email.',
    path: 'email-assistant',
    category: 'core',
    enabled: true,
  },
  {
    name: 'ops-commander',
    description: 'Coordinate operations with orders and readiness checks.',
    path: 'ops-commander',
    category: 'core',
    enabled: true,
  },
  {
    name: 'security-reviewer',
    description: 'Review configs, MCPs, providers, ports, and permissions.',
    path: 'security-reviewer',
    category: 'core',
    enabled: true,
  },
  {
    name: 'incident-analyst',
    description: 'Reconstruct timelines and postmortems from events and logs.',
    path: 'incident-analyst',
    category: 'core',
    enabled: true,
  },
  {
    name: 'web-researcher',
    description: 'Research current information with sources and citations.',
    path: 'web-researcher',
    category: 'core',
    enabled: true,
  },
  {
    name: 'automation-designer',
    description: 'Design safe recurring workflows and monitors.',
    path: 'automation-designer',
    category: 'core',
    enabled: true,
  },
  {
    name: 'docx-generation',
    description: 'Generate Word documents and reports.',
    path: 'docx-generation',
    category: 'tool',
    enabled: true,
  },
  {
    name: 'operation-planning',
    description: 'Draft and summarize game operation plans.',
    path: 'operation-planning',
    category: 'custom',
    enabled: true,
  },
].map((skill) => ({
  scope: 'all',
  visibility: 'shared',
  riskLevel:
    skill.name.includes('security') || skill.name.includes('ops')
      ? 'high'
      : 'low',
  triggers: skill.name.split('-'),
  examples: [],
  requiredTools: [],
  ...skill,
}));

const wikiPages = [
  {
    name: 'game-manual-notes',
    title: 'Game Manual Notes',
    updatedAt: iso(240),
    size: 1840,
    tags: ['manual', 'mechanics'],
    excerpt: 'Fleet combat timing, scouting rules, morale, and logistics.',
  },
  {
    name: 'provider-playbook',
    title: 'Provider Playbook',
    updatedAt: iso(480),
    size: 980,
    tags: ['providers', 'ops'],
    excerpt: 'When to use Codex, OpenRouter, Ollama, and Google.',
  },
];

function ok(extra: Record<string, JsonValue> = {}): JsonValue {
  return { ok: true, mock: true, ...extra };
}

function dashboard(): JsonValue {
  return {
    uptime: 5_428_000,
    uptimeFormatted: '1h 30m',
    channels,
    containers,
    groups,
    messages,
    failedLogins: 2,
    blockedIps: 1,
    todayCount: 148,
    daily: dailyCounts(),
  };
}

function system(): JsonValue {
  return {
    uptime: 5_428_000,
    uptimeFormatted: '1h 30m',
    startedAt: iso(90),
    nodeVersion: process.version,
    version: {
      edition: 'NanoCrab Edition',
      editionShort: 'NanoCrab',
      editionVersion: '1.2.52',
      appVersion: '1.2.52-mock',
      containerImage: 'nanocrab-agent:mock',
    },
    platform: process.platform,
    arch: process.arch,
    memory: {
      rss: 156_000_000,
      heapUsed: 78_000_000,
      heapTotal: 128_000_000,
      heapLimit: 512_000_000,
    },
    system: {
      cpus: 8,
      freeMemory: 7_800_000_000,
      totalMemory: 16_000_000_000,
      loadAvg: [0.42, 0.58, 0.63],
      disk: { free: 180_000_000_000, total: 512_000_000_000, percent: 65 },
    },
  };
}

function providers(): JsonValue {
  const providerList = [
    {
      id: 'fal',
      name: 'fal.ai',
      category: 'Image Generation',
      description: 'Fast image generation with Flux and SDXL models.',
      configured: true,
      envKey: 'FAL_KEY',
      website: 'https://fal.ai',
      free: false,
      models: ['fal-ai/flux/dev', 'fal-ai/flux/schnell'],
    },
    {
      id: 'openai-image',
      name: 'OpenAI Images',
      category: 'Image Generation',
      description: 'Image generation for assets and mockups.',
      configured: true,
      envKey: 'OPENAI_API_KEY',
      website: 'https://platform.openai.com',
      free: false,
      models: ['gpt-image-1.5', 'dall-e-3'],
    },
    {
      id: 'codex',
      name: 'Codex',
      category: 'Code',
      description: 'Coding runtime for repository work.',
      configured: true,
      envKey: 'CODEX_AUTH',
      website: 'https://developers.openai.com/codex',
      free: false,
      models: ['gpt-5.4', 'gpt-5.4-mini'],
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      category: 'LLM',
      description: 'OpenAI-compatible gateway for hosted models.',
      configured: true,
      envKey: 'OPENROUTER_API_KEY',
      website: 'https://openrouter.ai',
      free: false,
      models: ['openrouter/auto', 'anthropic/claude-sonnet-4.5'],
    },
    {
      id: 'ollama',
      name: 'Ollama',
      category: 'LLM',
      description: 'Local private model endpoint.',
      configured: true,
      envKey: 'OLLAMA_HOST',
      website: 'https://ollama.com',
      free: true,
      models: ['gemma4:e2b', 'llama3.1'],
    },
    {
      id: 'whisper',
      name: 'Whisper',
      category: 'Voice',
      description: 'Voice transcription for channel audio messages.',
      configured: false,
      envKey: 'OPENAI_API_KEY',
      website: 'https://platform.openai.com',
      free: false,
      models: ['gpt-4o-transcribe', 'whisper-1'],
    },
  ];
  const categories = providerList.reduce<Record<string, JsonValue[]>>(
    (acc, provider) => {
      const category = String(provider.category);
      acc[category] = acc[category] || [];
      acc[category].push(provider);
      return acc;
    },
    {},
  );
  return {
    providers: providerList,
    categories,
    preferences: {
      global: {
        'Image Generation': 'fal',
        Code: 'codex',
        LLM: 'openrouter',
      },
      groups: { operations: { LLM: 'ollama' } },
    },
  };
}

function fileList(): JsonValue {
  return groups.map((g) => ({
    name: g.folder,
    hasAgentsMd: true,
    hasConversations: true,
    hasAttachments: g.folder !== 'scouts',
  }));
}

function usage(): JsonValue {
  const daily = usageDaily();
  return {
    daily,
    totals: {
      input: 882_000,
      output: 344_000,
      cacheWrite: 28_000,
      cacheRead: 212_000,
      cost: 28.42,
      claudeCost: 11.36,
    },
    byGroup: [
      {
        group: 'main',
        input: 380_000,
        output: 152_000,
        cacheWrite: 9000,
        cacheRead: 81000,
        cost: 12.8,
      },
      {
        group: 'operations',
        input: 302_000,
        output: 121_000,
        cacheWrite: 7000,
        cacheRead: 73000,
        cost: 9.9,
      },
      {
        group: 'scouts',
        input: 200_000,
        output: 71_000,
        cacheWrite: 4000,
        cacheRead: 58000,
        cost: 5.72,
      },
    ],
    byProvider: [
      { provider: 'openrouter', service: 'chat', count: 93, totalCost: 8.62 },
      { provider: 'google', service: 'summary', count: 26, totalCost: 2.44 },
      { provider: 'fal', service: 'image', count: 5, totalCost: 1.72 },
    ],
  };
}

function sessions(): JsonValue[] {
  return cockpitSessions;
}

function cockpitDetail(id: string): JsonValue | undefined {
  const session = cockpitSessions.find((item) => item.id === id);
  if (!session) return undefined;
  return {
    ...session,
    timeline: [
      {
        id: `${id}-start`,
        timestamp: session.startedAt,
        type: 'started',
        title: 'Session started',
        detail: `${session.provider}/${session.model} run started for ${session.group}.`,
      },
      {
        id: `${id}-step`,
        timestamp: session.lastEventAt,
        type: session.status,
        title: session.status.replace(/_/g, ' '),
        detail: session.currentStep,
      },
    ],
    artifacts: session.changedFiles.map((file, index) => ({
      id: `${id}-artifact-${index}`,
      name: file.split('/').pop(),
      path: file,
      kind: 'changed-file',
    })),
    approvals:
      session.approvalCount > 0
        ? Array.from({ length: session.approvalCount }, (_, index) => ({
            id: `${id}-approval-${index + 1}`,
            title:
              index === 0 ? 'Approve file changes' : 'Approve outbound message',
            status:
              session.status === 'waiting_approval' ? 'pending' : 'approved',
            risk: index === 0 ? 'medium' : 'low',
            createdAt: iso(12 + index),
          }))
        : [],
  };
}

function routeJson(pathname: string, req: Request): JsonValue | undefined {
  const method = req.method.toUpperCase();
  if (method !== 'GET') return writeResponse(pathname);

  if (pathname === '/me') {
    return { username: 'mock-owner', role: 'owner', mock: true };
  }
  if (pathname === '/plugins') return plugins;
  if (pathname === '/system/dashboard') return dashboard();
  if (pathname === '/system/identity') {
    return {
      name: 'MockCrab',
      trigger: '!mockcrab',
      edition: 'NanoCrab Edition',
      editionShort: 'NanoCrab',
      editionVersion: '1.2.52',
      appVersion: '1.2.52-mock',
      projectRoot: '/mock/nanocrab',
      mockMode: true,
    };
  }
  if (pathname === '/system/provider') return providerInfo;
  if (pathname === '/system/provider/profiles') {
    return {
      profiles: providerInfo.profiles,
      purposes: providerInfo.purposes,
      capabilityMatrix: providerInfo.capabilityMatrix,
      models: providerInfo.models,
      definitions: providerInfo.definitions,
      probes: providerInfo.profileProbes,
      probeHistory: providerInfo.probeHistory,
    };
  }
  if (pathname.startsWith('/system/provider/profiles/')) {
    const profileId = pathname.split('/').at(-2) || 'default_chat';
    const profile =
      providerInfo.profiles.find((item) => item.id === profileId) ||
      providerInfo.profiles[0];
    return {
      profileId: profile.id,
      provider: profile.provider,
      model: profile.model,
      ok: true,
      checks: [
        {
          id: 'mock-profile',
          label: 'Mock provider profile',
          ok: true,
          detail: `${profile.provider}/${profile.model}`,
        },
      ],
    };
  }
  if (pathname.startsWith('/system/provider/preflight/')) {
    return {
      provider: pathname.split('/').pop(),
      ok: true,
      checks: [
        {
          id: 'mock',
          label: 'Mock provider check',
          ok: true,
          detail: 'Sample credentials available in mock mode.',
        },
      ],
    };
  }
  if (pathname === '/providers/models') {
    return {
      profiles: providerInfo.profiles,
      models: providerInfo.models,
    };
  }
  if (pathname === '/providers/health') {
    return {
      version: 1,
      entries: [
        {
          profileId: 'default_chat',
          provider: 'openrouter',
          model: 'openrouter/auto',
          purpose: 'Chat',
          ok: true,
          lastProbeAt: new Date(Date.now() - 60000).toISOString(),
          capabilities: ['tools', 'json', 'stream', 'vision'],
        },
        {
          profileId: 'default_coding',
          provider: 'codex',
          model: 'gpt-5.4',
          purpose: 'Coding',
          ok: true,
          lastProbeAt: new Date(Date.now() - 120000).toISOString(),
          capabilities: ['tools', 'json', 'stream', 'vision'],
        },
        {
          profileId: 'default_automation',
          provider: 'openrouter',
          model: 'openrouter/auto',
          purpose: 'Automations',
          ok: false,
          lastProbeAt: new Date(Date.now() - 300000).toISOString(),
          errorMessage: 'Rate limit exceeded',
          capabilities: ['tools', 'json', 'stream', 'vision'],
        },
        {
          profileId: 'default_memory',
          provider: 'openrouter',
          model: 'openrouter/auto',
          purpose: 'Memory',
          ok: true,
          lastProbeAt: new Date(Date.now() - 3600000).toISOString(),
          capabilities: ['json'],
        },
        {
          profileId: 'default_journal',
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          purpose: 'Journal',
          ok: true,
          lastProbeAt: new Date(Date.now() - 7200000).toISOString(),
          capabilities: ['json'],
        },
        {
          profileId: 'default_report',
          provider: 'claude',
          model: 'claude-sonnet-4-6',
          purpose: 'Reports',
          ok: false,
          lastProbeAt: new Date(Date.now() - 1800000).toISOString(),
          errorMessage:
            'API reached max capacity: this model is temporarily unavailable',
          capabilities: ['tools', 'json', 'stream'],
        },
      ],
    };
  }
  if (pathname === '/providers/probe-history') {
    const now = Date.now();
    const hrs = (n: number) => new Date(now - n * 3600000).toISOString();
    return {
      ok: true,
      history: [
        {
          providerId: 'openai-responses',
          model: 'gpt-5.4',
          result: { ok: true, validated: true, status: 'success' },
          timestamp: hrs(1),
        },
        {
          providerId: 'openai-responses',
          model: 'gpt-5.4',
          result: { ok: true, validated: true, status: 'success' },
          timestamp: hrs(6),
        },
        {
          providerId: 'anthropic-messages',
          model: 'claude-sonnet-4-6',
          result: { ok: true, validated: true, status: 'success' },
          timestamp: hrs(2),
        },
        {
          providerId: 'gemini',
          model: 'gemini-2.5-flash',
          result: {
            ok: false,
            validated: false,
            status: 'failed',
            errorMessage: 'API rate limited',
          },
          timestamp: hrs(4),
        },
        {
          providerId: 'gemini',
          model: 'gemini-2.5-flash',
          result: { ok: true, validated: true, status: 'success' },
          timestamp: hrs(12),
        },
        {
          providerId: 'mistral',
          model: 'mistral-large-latest',
          result: { ok: true, validated: true, status: 'success' },
          timestamp: hrs(3),
        },
        {
          providerId: 'openai-compatible',
          model: 'model-id',
          result: {
            ok: false,
            validated: false,
            status: 'failed',
            errorMessage: 'Base URL not configured',
          },
          timestamp: hrs(8),
        },
      ],
    };
  }
  if (pathname === '/approvals') {
    const q = req.query as Record<string, string | undefined>;
    return approvals
      .filter((item) => !q.status || item.status === q.status)
      .filter((item) => !q.risk || item.risk === q.risk)
      .filter((item) => !q.kind || item.kind === q.kind)
      .filter((item) => !q.requester || item.requester === q.requester)
      .filter((item) => !q.targetType || item.targetType === q.targetType)
      .filter(
        (item) => !q.correlationId || item.correlationId === q.correlationId,
      )
      .filter((item) => !q.createdFrom || item.createdAt >= q.createdFrom)
      .filter((item) => !q.createdTo || item.createdAt <= q.createdTo)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  if (pathname === '/system/alerts') {
    return [
      {
        type: 'info',
        message:
          'Mock mode is using sample data. No live messages, containers, or credentials are touched.',
      },
    ];
  }
  if (pathname === '/system/weather') {
    return {
      location: 'Oslo, mock sample',
      temperature: 18,
      windSpeed: 4.2,
      windDirection: 'NW',
      cloudCover: 41,
      pressure: 1012,
      humidity: 63,
      precipitation: 0.2,
    };
  }
  if (pathname === '/system/health') {
    return {
      overall: 'healthy',
      channels,
      checks: [
        { name: 'Database', ok: true, message: 'Mock SQLite state loaded' },
        { name: 'Containers', ok: true, message: 'Sample containers active' },
      ],
    };
  }
  if (pathname === '/system') return system();
  if (pathname === '/system/stats') {
    return {
      daily: dailyCounts().map((d) => ({
        date: d.day,
        total: d.count,
        bot: Math.floor(d.count * 0.38),
        user: Math.ceil(d.count * 0.62),
      })),
      byChannel: [
        { channel: 'whatsapp', count: 92 },
        { channel: 'telegram', count: 41 },
        { channel: 'signal', count: 15 },
      ],
      totals: { total: 148, bot: 55, user: 93 },
    };
  }
  if (pathname === '/system/budget') {
    return { dailyLimit: 6, monthlyLimit: 180, alertsEnabled: true };
  }
  if (pathname === '/system/unregistered') {
    return {
      chats: [
        {
          jid: 'tg:unregistered-trader',
          name: 'Trader DM',
          channel: 'telegram',
          lastActivity: iso(90),
          isGroup: false,
        },
      ],
      messages: [
        {
          chat_jid: 'tg:unregistered-trader',
          sender_name: 'Trader DM',
          content: 'Can I get access to alliance summaries?',
          timestamp: iso(91),
        },
      ],
    };
  }
  if (pathname === '/system/report-config') {
    return {
      enabled: true,
      schedule: 'weekly',
      targetJid: 'wa:alliance-command',
      providerProfileId: 'default_reports',
      requireOutlineApproval: true,
      outputFormats: ['markdown', 'docx', 'pdf'],
      sourceScopes: ['journal', 'memory', 'github', 'wiki'],
      deliverablesDir: 'store/deliverables',
    };
  }
  if (pathname === '/channels') {
    return {
      active: [
        {
          id: 'whatsapp',
          name: 'WhatsApp',
          icon: 'WA',
          description: 'Primary alliance command channel.',
          connected: true,
          envVars: ['WHATSAPP_PHONE_NUMBER'],
          config: { WHATSAPP_PHONE_NUMBER: '+47 *** ** 107' },
        },
        {
          id: 'telegram',
          name: 'Telegram',
          icon: 'TG',
          description: 'Operations and casual-player summaries.',
          connected: true,
          envVars: ['TELEGRAM_BOT_TOKEN'],
          config: { TELEGRAM_BOT_TOKEN: 'mock-token-set' },
        },
        {
          id: 'signal',
          name: 'Signal',
          icon: 'SG',
          description: 'Scout desk and private alerts.',
          connected: true,
          envVars: ['SIGNAL_PHONE_NUMBER'],
          config: { SIGNAL_PHONE_NUMBER: '+47 *** ** 107' },
        },
      ],
      available: [
        {
          id: 'discord',
          name: 'Discord',
          icon: 'DC',
          description: 'Sample unconfigured Discord bot channel.',
          envVars: ['DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID'],
          skill: 'container/skills/discord/SKILL.md',
        },
        {
          id: 'slack',
          name: 'Slack',
          icon: 'SL',
          description: 'Sample workplace channel placeholder.',
          envVars: ['SLACK_BOT_TOKEN'],
          skill: 'container/skills/slack/SKILL.md',
        },
      ],
    };
  }
  if (pathname === '/groups') return groups;
  if (pathname === '/containers') return containers;
  if (pathname === '/containers/recent') {
    return [
      {
        group: 'main',
        filename: 'session-main.log',
        timestamp: iso(8),
        size: 18240,
      },
      {
        group: 'operations',
        filename: 'coding-job-1248.log',
        timestamp: iso(18),
        size: 65400,
      },
    ];
  }
  if (pathname.startsWith('/messages/search')) return messages.slice(0, 3);
  if (pathname === '/messages/recent') return messages;
  if (pathname === '/messages/pinned') return [messages[1]];
  if (pathname.startsWith('/messages/')) return messages;
  if (pathname === '/tasks') return tasks;
  if (pathname === '/agents/boundaries') return agentBoundaries;
  if (pathname.startsWith('/tasks/')) {
    const id = decodeURIComponent(pathname.split('/')[2] || '');
    return tasks.find((t) => t.id === id) || tasks[0];
  }
  if (pathname === '/credentials') {
    return {
      credentials: [
        { key: 'OPENROUTER_API_KEY', configured: true, source: 'env' },
        { key: 'GITHUB_TOKEN', configured: true, source: 'env' },
        { key: 'KDRIVE_TOKEN', configured: false, source: 'missing' },
      ],
    };
  }
  if (pathname === '/mcp/health') {
    return {
      summary: {
        total: 3,
        ready: 2,
        missingEnv: 1,
        configPath: 'store/mcp-servers.json',
      },
      servers: [
        {
          name: 'nanocrab',
          label: 'NanoCrab IPC',
          core: true,
          allEnvSet: true,
          command: 'node',
          args: ['dist/ipc-mcp-stdio.js'],
          envVars: [],
          envStatus: [],
          toolPattern: 'mcp__nanocrab__*',
          permission: {
            connectorId: 'nanocrab',
            scope: 'all',
            allowedActions: ['*'],
            requiresApproval: false,
            groups: [],
            agents: [],
            createdAt: iso(120),
            updatedAt: iso(20),
          },
          status: 'healthy',
          notes: 'Core mock server exposed to every sample agent container.',
        },
        {
          name: 'github',
          label: 'GitHub',
          core: false,
          allEnvSet: true,
          command: 'npx',
          args: ['@modelcontextprotocol/server-github'],
          envVars: ['GITHUB_TOKEN'],
          envStatus: [{ key: 'GITHUB_TOKEN', isSet: true }],
          toolPattern: 'mcp__github__*',
          permission: {
            connectorId: 'github',
            scope: 'groups',
            allowedActions: ['issues.read', 'pulls.read', 'pulls.write'],
            requiresApproval: true,
            groups: ['main', 'operations'],
            agents: [],
            createdAt: iso(120),
            updatedAt: iso(20),
          },
          status: 'healthy',
          notes: 'Sample GitHub issue and pull request tooling.',
        },
        {
          name: 'kdrive',
          label: 'kDrive',
          core: false,
          allEnvSet: false,
          command: 'node',
          args: ['mcp/kdrive.js'],
          envVars: ['KDRIVE_TOKEN'],
          envStatus: [{ key: 'KDRIVE_TOKEN', isSet: false }],
          toolPattern: 'mcp__kdrive__*',
          permission: {
            connectorId: 'kdrive',
            scope: 'main',
            allowedActions: ['files.read', 'files.write'],
            requiresApproval: true,
            groups: [],
            agents: [],
            createdAt: iso(120),
            updatedAt: iso(20),
          },
          status: 'not_configured',
          notes: 'Placeholder document source for report generation.',
        },
      ],
    };
  }
  if (pathname === '/mcp/presets') {
    return [
      {
        name: 'infomaniak',
        label: 'Infomaniak kSuite',
        command: 'npx',
        args: ['-y', '@henrikogaard/infomaniak-mcp'],
        envVars: [
          'INFOMANIAK_TOKEN',
          'KDRIVE_ID',
          'MAIL_USER',
          'MAIL_PASSWORD',
          'DAV_USER',
          'DAV_PASSWORD',
        ],
        notes:
          'Optional mail, kDrive, and DAV integration for Infomaniak kSuite.',
        installed: false,
        toolPattern: 'mcp__infomaniak__*',
      },
    ];
  }
  if (pathname === '/providers') return providers();
  if (pathname === '/memory') {
    return [
      {
        id: 'mem-mock-1',
        scope: 'global',
        type: 'preference',
        content:
          'Henrik prefers concise operational summaries with clear next actions.',
        source: 'mock conversation',
        confidence: 0.86,
        visibility: 'global',
        status: 'pending',
        created_by: 'operations',
        created_at: iso(30),
        updated_at: iso(30),
        reviewed_at: null,
        expires_at: null,
        sensitivity: 'normal',
        source_links_json: '[]',
        contradicts_memory_id: null,
        stale_after: null,
      },
      {
        id: 'mem-mock-2',
        scope: 'group',
        type: 'game-knowledge',
        content:
          'Operations channel tracks fleet crashes, attacks, planet names, and rally windows.',
        source: 'mock journal',
        confidence: 0.78,
        visibility: 'group',
        status: 'approved',
        created_by: 'operations',
        created_at: iso(280),
        updated_at: iso(260),
        reviewed_at: iso(260),
        expires_at: null,
        sensitivity: 'normal',
        source_links_json: '[]',
        contradicts_memory_id: null,
        stale_after: iso(120),
      },
      {
        id: 'mem-mock-3',
        scope: 'group',
        type: 'preference',
        content: 'Operations summaries should not include speculative targets.',
        source: 'mock message',
        confidence: 0.91,
        visibility: 'group',
        status: 'contradicted',
        created_by: 'operations',
        created_at: iso(480),
        updated_at: iso(35),
        reviewed_at: iso(35),
        expires_at: null,
        sensitivity: 'normal',
        source_links_json: '[]',
        contradicts_memory_id: 'mem-mock-4',
        stale_after: null,
      },
      {
        id: 'mem-mock-4',
        scope: 'group',
        type: 'preference',
        content: 'Operations summaries should include speculative targets.',
        source: 'mock message',
        confidence: 0.84,
        visibility: 'group',
        status: 'approved',
        created_by: 'operations',
        created_at: iso(55),
        updated_at: iso(35),
        reviewed_at: iso(35),
        expires_at: null,
        sensitivity: 'normal',
        source_links_json: '[]',
        contradicts_memory_id: 'mem-mock-3',
        stale_after: null,
      },
    ];
  }
  if (pathname === '/journal/entries') {
    return [
      {
        id: 'journal-mock-1',
        date: day(-1),
        scope: 'daily',
        group_folder: 'operations',
        summary:
          '42 messages reviewed. Notable events included a fleet crash near Kepler-442b and new orders for the evening operation.',
        notable_events_json: '[]',
        source_message_ids_json: '[]',
        provider_profile_id: 'default_journal',
        created_at: iso(50),
      },
      {
        id: 'journal-mock-2',
        date: `${day(-7)}-week`,
        scope: 'weekly',
        group_folder: 'main',
        summary:
          'Weekly digest: more defensive coordination, two GitHub coding tasks, and one provider routing change.',
        notable_events_json: '[]',
        source_message_ids_json: '[]',
        provider_profile_id: 'default_journal',
        created_at: iso(1440),
      },
    ];
  }
  if (pathname === '/journal/events') {
    return [
      {
        id: 'evt-mock-1',
        timestamp: iso(90),
        title: 'Fleet crash near Kepler-442b',
        entities_json: '["Kepler-442b","Scout-7"]',
        location_context: 'operations',
        confidence: 0.82,
        source_ids_json: '[]',
        tags_json: '["fleet","crash"]',
        group_folder: 'operations',
        created_at: iso(88),
      },
    ];
  }
  if (pathname === '/journal/search') {
    return {
      query: req.query.query || 'fleet crash',
      answer: `${day(-1)}: Fleet crash near Kepler-442b (operations)`,
      events: [
        {
          id: 'evt-mock-1',
          timestamp: iso(90),
          title: 'Fleet crash near Kepler-442b',
          entities_json: '["Kepler-442b","Scout-7"]',
          location_context: 'operations',
          confidence: 0.82,
          source_ids_json: '[]',
          tags_json: '["fleet","crash"]',
          group_folder: 'operations',
          created_at: iso(88),
        },
      ],
    };
  }
  if (pathname === '/reports/jobs') {
    return [
      {
        id: 'report-mock-1',
        title: 'Weekly Alliance Digest',
        request: 'Create a casual weekly summary for alliance members.',
        requester: 'operations',
        providerProfileId: 'default_reports',
        sourceScopes: ['journal', 'memory'],
        outputFormats: ['markdown', 'docx', 'pdf'],
        deliverablesDir: 'store/deliverables',
        requireOutlineApproval: true,
        requireDeliveryApproval: true,
        status: 'awaiting_outline_approval',
        outline:
          '# Weekly Alliance Digest\n\n1. Situation summary\n2. Fleet events\n3. Orders\n4. Next actions',
        markdown: '',
        citations: [],
        artifacts: [],
        createdAt: iso(55),
        updatedAt: iso(55),
        error: null,
      },
    ];
  }
  if (pathname === '/research/jobs') {
    return [
      {
        id: 'research-mock-1',
        query: 'Latest known Infinite Conflict alliance mechanics',
        urls: ['https://manual.infiniteconflict.com'],
        requester: 'main',
        status: 'completed',
        notesPath: '/mock/store/research/research-mock-1/notes.md',
        screenshots: ['/mock/store/research/research-mock-1/1.png'],
        createdAt: iso(130),
        completedAt: iso(126),
        error: null,
      },
    ];
  }
  if (pathname === '/research/notebooklm') {
    return {
      enabled: false,
      provider: 'google-enterprise',
      projectId: '',
      notes:
        'Official NotebookLM Enterprise connector placeholder. Consumer scraping is not included.',
    };
  }
  if (pathname === '/sessions/terminal/active') {
    return [
      {
        id: 'mock-terminal-main',
        name: 'main shell',
        owner: 'mock-owner',
        transcriptBytes: 1834,
      },
    ];
  }
  if (pathname === '/skills') return { installed: skills, available: [] };
  if (pathname === '/skills/search') {
    return skills
      .filter((skill) =>
        `${skill.name} ${skill.description} ${skill.triggers.join(' ')}`
          .toLowerCase()
          .includes(String(req.query.q || '').toLowerCase()),
      )
      .slice(0, 8)
      .map((skill, index) => ({
        ...skill,
        score: 20 - index,
        reasons: ['mock-match'],
      }));
  }
  if (pathname === '/skills/suggestions') {
    return [
      {
        id: 'skill-suggestion-mock-1',
        proposedSkillName: 'operation-planning',
        description:
          'Reusable workflow for operation planning from chat requests, participant counts, orders, and journal context.',
        confidence: 0.86,
        status: 'pending',
        ownerDecision: null,
        sourceExamples: [
          'Prepare operation plan from orders and scout notes.',
          'Prepare operation plan with participant counts.',
          'Prepare operation plan for tonight from journal context.',
        ],
        provenance: ['source:mock-history'],
        createdBy: 'history-detector',
        createdAt: iso(18),
        reviewedAt: null,
        draftId: null,
      },
      {
        id: 'skill-suggestion-mock-2',
        proposedSkillName: 'dashboard-design-review',
        description:
          'Reusable workflow for reviewing dashboard screens for navigation, polish, and missing states.',
        confidence: 0.78,
        status: 'approved',
        ownerDecision: 'create-draft',
        sourceExamples: [
          'Review dashboard navigation and missing states.',
          'Review dashboard visual hierarchy and icons.',
          'Review dashboard responsive polish.',
        ],
        provenance: ['source:mock-history'],
        createdBy: 'history-detector',
        createdAt: iso(90),
        reviewedAt: iso(20),
        draftId: 'skill-mock-1',
      },
    ];
  }
  if (pathname === '/skills/drafts') {
    const drafts = [
      {
        id: 'skill-mock-1',
        name: 'operation-briefing',
        description:
          'Draft skill for producing alliance operation briefings from journal events and orders.',
        status: 'pending',
        createdBy: 'operations',
        createdAt: iso(40),
        reviewedAt: null,
        draftDir: '/mock/store/skill-drafts/skill-mock-1',
        installDir: null,
        version: 1,
        installedVersion: null,
        syncStatus: 'draft',
        validationStatus: 'valid',
        validationErrors: [],
        provenance: ['source:mock-operations-chat'],
      },
      {
        id: 'skill-mock-2',
        name: 'daily-summary',
        description:
          'Installed skill for writing daily summaries for casual players.',
        status: 'approved',
        createdBy: 'dashboard',
        createdAt: iso(75),
        reviewedAt: iso(38),
        draftDir: '/mock/store/skill-drafts/skill-mock-2',
        installDir: '/mock/nanocrab/container/skills/daily-summary',
        version: 1,
        installedVersion: 1,
        syncStatus: 'installed',
        validationStatus: 'valid',
        validationErrors: [],
        provenance: ['source:dashboard', 'kind:instruction-draft'],
      },
    ];
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    return status ? drafts.filter((draft) => draft.status === status) : drafts;
  }
  if (pathname.startsWith('/skills/drafts/')) {
    return {
      draft: {
        id: 'skill-mock-1',
        name: 'operation-briefing',
        description:
          'Draft skill for producing alliance operation briefings from journal events and orders.',
        status: 'pending',
        createdBy: 'operations',
        createdAt: iso(40),
        reviewedAt: null,
        draftDir: '/mock/store/skill-drafts/skill-mock-1',
        installDir: null,
      },
      content:
        '---\nname: operation-briefing\ndescription: Produce concise operation briefings from journal events, orders, and scout reports.\n---\n\n# Operation Briefing\n\nUse journal events and approved orders to prepare a concise brief with confirmed facts, open questions, and next actions.\n',
    };
  }
  if (pathname.startsWith('/skills/')) {
    const skill = skills.find((s) => s.path === pathname.split('/')[2]);
    return {
      content: `---\nname: ${skill?.name || 'mock-skill'}\ndescription: ${skill?.description || 'Mock skill'}\n---\n\n# ${skill?.name || 'Mock Skill'}\n\nSample skill content for dashboard design work.\n`,
    };
  }
  if (pathname === '/docker/containers') {
    return [
      {
        name: 'nanocrab-main-agent',
        status: 'Up 22 minutes',
        image: 'nanocrab-agent:latest',
        created: iso(22),
        ports: '',
      },
      {
        name: 'coding-job-1248',
        status: 'Exited (0) 5 minutes ago',
        image: 'nanocrab-agent:latest',
        created: iso(35),
        ports: '',
      },
    ];
  }
  if (pathname === '/docker/images') {
    return [
      {
        repository: 'nanocrab-agent',
        tag: 'latest',
        size: '2.4GB',
        created: '2 hours ago',
      },
    ];
  }
  if (pathname === '/files') return fileList();
  if (pathname === '/files/memory') {
    return {
      content:
        '# Runtime Memory\n\n- Owner prefers concise status updates.\n- Operations summaries should separate confirmed intel from speculation.\n- Never reveal alliance-private notes outside approved groups.\n',
    };
  }
  if (pathname.match(/^\/files\/[^/]+\/agents-md$/)) {
    const folder = decodeURIComponent(pathname.split('/')[2]);
    return {
      content: `# ${folder} Agent Instructions\n\nUse this mock content to redesign the editor and file surfaces. Keep summaries brief and ask for approval before external actions.\n`,
    };
  }
  if (pathname.match(/^\/files\/[^/]+\/conversations$/)) {
    return [
      { name: '2026-06-09-session.jsonl', size: 14820, modified: iso(12) },
      {
        name: '2026-06-08-summary.md',
        size: 4020,
        modified: day(-1) + 'T22:00:00.000Z',
      },
    ];
  }
  if (pathname.match(/^\/files\/[^/]+\/attachments$/)) {
    return [
      { name: 'fleet-plan.png', size: 244000, modified: iso(44) },
      { name: 'orders-brief.pdf', size: 88000, modified: iso(120) },
    ];
  }
  if (pathname.match(/^\/files\/[^/]+\/conversations\/.+$/)) {
    return {
      content:
        '[20:10] Henrik: Prepare the operation summary.\n[20:12] NanoCrab: Summary queued and pending owner approval.\n',
    };
  }
  if (pathname === '/files/repos') return repos;
  if (pathname.match(/^\/files\/repos\/[^/]+\/tree$/)) {
    return [
      {
        name: 'src',
        type: 'dir',
        children: [
          {
            name: 'admin',
            type: 'dir',
            children: [{ name: 'mock-server.ts', type: 'file' }],
          },
          { name: 'index.ts', type: 'file' },
        ],
      },
      { name: 'README.md', type: 'file' },
    ];
  }
  if (pathname.match(/^\/files\/repos\/[^/]+\/git$/)) {
    return {
      branch: 'mock-dashboard',
      status: [' M src/admin/public/app.js'],
      log: [],
    };
  }
  if (pathname.match(/^\/files\/repos\/[^/]+\/file$/)) {
    return {
      path: String(req.query.path || 'README.md'),
      readonly: false,
      content:
        '# Mock File\n\nThis placeholder file lets the dashboard editor render without a mounted repository.\n',
    };
  }
  if (pathname === '/mounts') {
    return {
      mounts: [
        {
          id: 'm1',
          hostPath: '/Users/henrik/Dev/Repos/nanocrab',
          containerPath: '/workspace/repos/nanocrab',
          readonly: false,
          groups: ['main'],
        },
        {
          id: 'm2',
          hostPath: '/Users/henrik/Documents/reports',
          containerPath: '/workspace/reports',
          readonly: true,
          groups: ['operations'],
        },
      ],
      allowlistPath: '~/.config/nanocrab/mount-allowlist.json',
    };
  }
  if (pathname === '/webhooks/config') {
    return { enabled: true, secret: '****', targetJid: 'wa:alliance-command' };
  }
  if (pathname === '/webhooks/events') {
    return [
      {
        timestamp: iso(37),
        event: 'issues',
        repo: 'henrikogaard/nanocrab',
        summary: 'Issue labeled autofix and queued for coding job.',
        status: 'handled',
      },
      {
        timestamp: iso(240),
        event: 'pull_request',
        repo: 'henrikogaard/auroradocs',
        summary: 'Draft PR opened by coding agent.',
        status: 'notified',
      },
    ];
  }
  if (pathname === '/logs/system') {
    return {
      lines: [
        '[INFO] Mock admin dashboard started',
        '[INFO] Sample WebSocket client connected',
        '[INFO] Signal channel showing as connected — verified mock status',
      ],
    };
  }
  if (pathname === '/logs/errors') {
    return {
      lines: [
        '[ERROR] Sample provider preflight failed for kDrive credentials',
      ],
    };
  }
  if (pathname === '/allowlist') {
    return { enabled: true, ips: ['92.221.30.107', '10.0.0.0/24'] };
  }
  if (pathname === '/audit') {
    return [
      {
        timestamp: iso(18),
        action: 'skill_draft_created',
        ip: '92.221.30.107',
        details: 'operation-briefing',
        userAgent: 'Mock browser',
      },
      {
        timestamp: iso(24),
        action: 'memory_approved',
        ip: '92.221.30.107',
        details: 'mem-mock-2',
        userAgent: 'Mock browser',
      },
      {
        timestamp: iso(38),
        action: 'skill_draft_approved',
        ip: '92.221.30.107',
        details: 'daily-summary',
        userAgent: 'Mock browser',
      },
      {
        timestamp: iso(66),
        action: 'memory_edit',
        ip: '92.221.30.107',
        details: 'Updated shared MEMORY.md',
        userAgent: 'Mock browser',
      },
      {
        timestamp: iso(11),
        action: 'login_success',
        ip: '92.221.30.107',
        details: 'mock owner session',
        userAgent: 'Mock browser',
      },
      {
        timestamp: iso(95),
        action: 'provider_changed',
        ip: '92.221.30.107',
        details: 'codex/gpt-5.4',
        userAgent: 'Mock browser',
      },
      {
        timestamp: iso(180),
        action: 'login_failed',
        ip: '203.0.113.22',
        details: 'bad password',
        userAgent: 'Unknown',
      },
      {
        timestamp: iso(210),
        action: 'ip_blocked',
        ip: '203.0.113.22',
        details: 'too many login attempts',
        userAgent: 'Unknown',
      },
    ];
  }
  if (pathname === '/runtime-audit') {
    const q = req.query;
    return auditEvents
      .filter((event) => !q.actor || event.actor === q.actor)
      .filter((event) => !q.actionType || event.actionType === q.actionType)
      .filter((event) => !q.decision || event.decision === q.decision)
      .filter(
        (event) => !q.correlationId || event.correlationId === q.correlationId,
      )
      .slice(0, Math.min(parseInt(String(q.limit || '100'), 10), 1000));
  }
  if (pathname === '/runtime-audit/export') {
    return { exportedAt: iso(0), events: auditEvents };
  }
  if (pathname.startsWith('/runtime-audit/replay/')) {
    const correlationId = decodeURIComponent(pathname.split('/').pop() || '');
    const events = auditEvents
      .filter((event) => event.correlationId === correlationId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return {
      correlationId,
      events,
      summary: {
        eventCount: events.length,
        firstActionType: events[0]?.actionType || null,
        lastActionType: events[events.length - 1]?.actionType || null,
        lastDecision: events[events.length - 1]?.decision || null,
        durationMs: events.length ? 120000 : null,
      },
    };
  }
  if (pathname === '/usage') return usage();
  if (pathname === '/sessions') return sessions();
  if (pathname === '/sessions/cockpit') return sessions();
  if (pathname.startsWith('/sessions/cockpit/')) {
    return cockpitDetail(decodeURIComponent(pathname.split('/').pop() || ''));
  }
  if (pathname.match(/^\/sessions\/[^/]+\/[^/]+$/)) {
    return [
      {
        role: 'user',
        timestamp: iso(24),
        content: 'What happened around Kepler-442b?',
        toolUse: false,
      },
      {
        role: 'assistant',
        timestamp: iso(23),
        content:
          'Scout-7 reported a fleet sighting near Kepler-442b. Confidence 0.82. I recorded it as a journal event.',
        toolUse: true,
      },
    ];
  }
  if (pathname === '/backup') {
    return {
      totalSizeFormatted: '42.1 MB',
      items: [
        {
          label: 'groups/',
          sizeFormatted: '18.2 MB',
          critical: true,
          exists: true,
        },
        {
          label: 'store/',
          sizeFormatted: '21.4 MB',
          critical: true,
          exists: true,
        },
        {
          label: '.env',
          sizeFormatted: '2.5 KB',
          critical: true,
          exists: true,
        },
      ],
      backups: [
        {
          name: 'nanocrab-backup-mock-20260609.tar.gz',
          sizeFormatted: '42.1 MB',
          created: iso(360),
        },
      ],
    };
  }
  if (pathname === '/backup/restore-guide') {
    return {
      steps: [
        '1. Stop NanoCrab: systemctl --user stop nanocrab',
        '2. Copy backup to new server',
        '3. Extract backup archive',
        '4. Install dependencies and rebuild the container',
      ],
      notes: ['Mock restore guide only; no files are changed.'],
    };
  }
  if (pathname === '/wiki') return wikiPages;
  if (pathname.startsWith('/wiki/search')) return wikiPages;
  if (pathname.startsWith('/wiki/')) {
    const name = decodeURIComponent(pathname.split('/')[2] || 'mock-page');
    return {
      name,
      title: name.replace(/-/g, ' '),
      content:
        '# Mock Wiki Page\n\nThis is placeholder knowledge content. Use it to redesign reading, editing, and search states.\n',
      updatedAt: iso(10),
    };
  }
  if (pathname === '/workflows') {
    return [
      {
        id: 'wf-daily-summary',
        name: 'Daily Casual Summary',
        enabled: true,
        trigger: 'schedule',
        targetGroup: 'operations',
        lastRun: iso(80),
        status: 'ok',
        actions: ['Collect messages', 'Extract notable events', 'Send summary'],
      },
    ];
  }
  if (pathname === '/uptime') {
    return [
      {
        id: 'u1',
        name: 'llm.ogard.cloud',
        type: 'http',
        url: 'https://llm.ogard.cloud/health',
        status: 'up',
        lastCheck: iso(4),
        responseMs: 84,
      },
      {
        id: 'u2',
        name: 'Game manual freshness',
        type: 'file',
        url: 'store/manual/index.json',
        status: 'warning',
        lastCheck: iso(35),
        responseMs: 0,
      },
    ];
  }
  if (pathname.match(/^\/uptime\/[^/]+\/history$/)) {
    return [
      { timestamp: iso(5), status: 'up', responseMs: 88 },
      { timestamp: iso(65), status: 'up', responseMs: 92 },
      { timestamp: iso(125), status: 'warning', responseMs: 0 },
    ];
  }
  if (pathname === '/dev/guide') {
    return {
      sections: [
        {
          title: 'From Your Phone',
          content: 'Ask the bot to review commits, fix issues, or create a PR.',
        },
        { title: 'Safety', content: 'Mock mode never runs host commands.' },
      ],
    };
  }
  if (pathname === '/dev/monitoring/history') {
    return [
      { timestamp: iso(5), cpu: 12, memory: 38, disk: 65 },
      { timestamp: iso(10), cpu: 18, memory: 40, disk: 65 },
      { timestamp: iso(15), cpu: 9, memory: 37, disk: 65 },
    ];
  }
  if (pathname === '/dev/snippets') {
    return [
      {
        id: 'snip-1',
        title: 'Provider preflight checklist',
        language: 'md',
        tags: ['ops'],
        updatedAt: iso(70),
      },
      {
        id: 'snip-2',
        title: 'Discord bot deployment notes',
        language: 'bash',
        tags: ['deploy'],
        updatedAt: iso(300),
      },
    ];
  }
  if (pathname.startsWith('/dev/snippets/')) {
    return {
      id: pathname.split('/').pop() || 'snip-1',
      title: 'Provider preflight checklist',
      language: 'md',
      tags: ['ops'],
      code: '- Check base URL\n- Check model\n- Check credentials\n',
      updatedAt: iso(70),
    };
  }
  if (pathname === '/dev/pipelines') {
    return [
      {
        id: 'pipe-1',
        name: 'Build and smoke test',
        repo: 'nanocrab',
        status: 'idle',
        lastRun: iso(360),
        steps: ['typecheck', 'build', 'smoke'],
      },
    ];
  }
  if (pathname === '/dev/review-rules') {
    return {
      content:
        '# Review Rules\n\nPrioritize security, tests, and user-visible regressions.\n',
    };
  }
  if (pathname.match(/^\/dev\/git\/[^/]+\/status$/)) {
    return {
      branch: 'mock-dashboard',
      status: [' M README.md', '?? src/admin/mock-server.ts'],
      ahead: 0,
      behind: 0,
    };
  }
  if (pathname.match(/^\/dev\/git\/[^/]+\/diff$/)) {
    return {
      diff: 'diff --git a/mock b/mock\n+Sample diff for dashboard preview\n',
    };
  }
  if (pathname.match(/^\/dev\/test\/[^/]+\/results$/)) {
    return {
      status: 'passed',
      output: '80 tests passed in mock sample output.',
    };
  }
  if (pathname === '/custom-containers') {
    return [
      {
        id: 'cc-1',
        name: 'Sample Worker',
        description:
          'Example optional sidecar container for mock dashboard design.',
        image: 'node:22',
        autoStart: true,
        ports: [{ host: 8788, container: 8788 }],
        volumes: [
          {
            host: '/data/manual',
            container: '/data/manual',
            readonly: false,
          },
        ],
        envVars: { SAMPLE_MODE: 'mock' },
        state: {
          status: 'running',
          containerId: 'mock-sample-worker',
          startedAt: iso(44),
        },
      },
      {
        id: 'cc-2',
        name: 'Report Renderer',
        description: 'Renders PDF and DOCX artifacts.',
        image: 'ghcr.io/nanocrab/reports:mock',
        buildContext: '/opt/nanocrab/report-renderer',
        autoStart: false,
        ports: [],
        volumes: [],
        envVars: {},
        state: {
          status: 'stopped',
        },
      },
    ];
  }
  if (
    pathname.startsWith('/custom-containers/') &&
    pathname.endsWith('/logs')
  ) {
    return {
      logs: '[INFO] Mock container log line\n[INFO] No live container was queried\n',
    };
  }
  if (pathname.startsWith('/custom-containers/')) {
    return {
      id: 'cc-1',
      name: 'Sample Worker',
      description:
        'Example optional sidecar container for mock dashboard design.',
      image: 'node:22',
      autoStart: true,
      ports: [{ host: 8788, container: 8788 }],
      volumes: [
        {
          host: '/data/manual',
          container: '/data/manual',
          readonly: false,
        },
      ],
      envVars: { SAMPLE_MODE: 'mock' },
      state: {
        status: 'running',
        containerId: 'mock-sample-worker',
        startedAt: iso(44),
      },
    };
  }
  if (pathname === '/agents/tools') {
    return [
      {
        id: 'codex',
        name: 'Codex',
        available: true,
        models: [
          { id: 'gpt-5.4', label: 'GPT-5.4' },
          { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
        ],
      },
      {
        id: 'opencode',
        name: 'OpenCode',
        available: true,
        models: [{ id: 'opencode/grok-code-fast-1', label: 'Grok Code Fast' }],
      },
      {
        id: 'claude',
        name: 'Claude Code',
        available: false,
        models: [{ id: 'claude-sonnet-4-6', label: 'Sonnet' }],
      },
    ];
  }
  if (pathname === '/agents/tasks') {
    return [
      {
        id: 'agent-task-1',
        tool: 'codex',
        model: 'gpt-5.4',
        prompt: 'Improve the dashboard mock data states.',
        workDir: '/workspace/repos/nanocrab',
        status: 'running',
        createdAt: iso(14),
        output: 'Analyzing dashboard surfaces...\n',
      },
      {
        id: 'agent-task-2',
        tool: 'opencode',
        model: 'opencode/grok-code-fast-1',
        prompt: 'Draft provider settings copy.',
        workDir: '/workspace/repos/nanocrab',
        status: 'completed',
        createdAt: iso(240),
        completedAt: iso(210),
        output: 'Completed sample job.\n',
      },
    ];
  }
  if (pathname.startsWith('/agents/tasks/')) {
    return {
      id: pathname.split('/')[3] || 'agent-task-1',
      status: 'running',
      output: 'Mock task output\nNo command was run.\n',
    };
  }
  if (pathname === '/agents/coding/repos') {
    return [
      {
        id: 'nanocrab',
        fullName: 'henrikogaard/nanocrab',
        defaultBranch: 'main',
        labels: ['nanocrab', 'agent-ready'],
        enabled: true,
        createdAt: iso(360),
        updatedAt: iso(30),
      },
    ];
  }
  if (pathname === '/agents/coding/jobs') {
    return [
      {
        id: 'code-mock-1',
        repo: 'henrikogaard/nanocrab',
        type: 'issue',
        prompt: 'Improve the provider routing UI.',
        issueNumber: 42,
        issueTitle: 'Add provider profiles to dashboard',
        provider: 'codex',
        model: 'gpt-5.4',
        status: 'running',
        branch: 'nanocrab/issue-42-code-mock-1',
        workspace: '/mock/coding/jobs/code-mock-1/nanocrab',
        createPr: true,
        prUrl: null,
        output:
          'Cloned repo\\nInspecting provider routes\\nApplying focused dashboard changes...',
        requestedBy: 'mock-owner',
        createdAt: iso(18),
        completedAt: null,
      },
    ];
  }
  if (pathname.startsWith('/agents/coding/jobs/')) {
    return {
      id: 'code-mock-1',
      repo: 'henrikogaard/nanocrab',
      type: 'issue',
      prompt: 'Improve the provider routing UI.',
      issueNumber: 42,
      issueTitle: 'Add provider profiles to dashboard',
      provider: 'codex',
      model: 'gpt-5.4',
      status: 'running',
      branch: 'nanocrab/issue-42-code-mock-1',
      workspace: '/mock/coding/jobs/code-mock-1/nanocrab',
      createPr: true,
      prUrl: null,
      output:
        'Cloned repo\\nInspecting provider routes\\nApplying focused dashboard changes...\\nTests will run when the mock job completes.',
      requestedBy: 'mock-owner',
      createdAt: iso(18),
      completedAt: null,
    };
  }
  if (pathname === '/agents/providers') {
    return [
      {
        id: 'codex',
        name: 'Codex',
        available: true,
        models: [{ id: 'gpt-5.4', label: 'GPT-5.4' }],
      },
      {
        id: 'ollama',
        name: 'Ollama',
        available: true,
        models: [{ id: 'gemma4:e2b', label: 'Gemma e2b' }],
      },
    ];
  }
  if (pathname === '/agents/messages') {
    return [
      {
        id: 'am-1',
        from_group: 'main',
        to_group: 'operations',
        content: 'Please confirm operation summary before 21:00.',
        status: 'unread',
        created_at: iso(17),
      },
      {
        id: 'am-2',
        from_group: 'scouts',
        to_group: 'main',
        content: 'Scout report added for Kepler-442b.',
        status: 'read',
        created_at: iso(43),
      },
    ];
  }
  if (pathname === '/questions/pending') {
    return [
      {
        id: 'q-1',
        group_folder: 'operations',
        question: 'Approve daily casual summary?',
        options: ['Approve', 'Revise', 'Skip'],
        created_at: iso(33),
      },
    ];
  }
  if (pathname === '/copilot/status') {
    return {
      configured: true,
      accounts: 1,
      message: 'Mock GitHub OAuth connected',
    };
  }
  if (pathname === '/copilot/accounts') {
    return [
      {
        id: 'gh-1',
        username: 'henrikogaard',
        scopes: ['repo'],
        connectedAt: iso(1200),
      },
    ];
  }
  if (pathname === '/copilot/jobs') {
    return [
      {
        id: 'copilot-job-1',
        repo: 'henrikogaard/nanocrab',
        issue: 42,
        status: 'assigned',
        createdAt: iso(75),
      },
    ];
  }
  if (pathname.includes('/copilot/repos/')) {
    return [
      {
        owner: 'henrikogaard',
        repo: 'nanocrab',
        private: true,
        defaultBranch: 'main',
      },
      {
        owner: 'henrikogaard',
        repo: 'auroradocs',
        private: true,
        defaultBranch: 'main',
      },
    ];
  }
  if (pathname.includes('/copilot/issues/')) {
    return [
      {
        number: 42,
        title: 'Improve provider settings UX',
        labels: ['autofix'],
        url: 'https://github.com/henrikogaard/nanocrab/issues/42',
      },
      {
        number: 43,
        title: 'Add dashboard mock mode',
        labels: ['ui'],
        url: 'https://github.com/henrikogaard/nanocrab/issues/43',
      },
    ];
  }
  if (pathname === '/copilot/oauth/url') {
    return { url: 'https://github.com/login/oauth/authorize?mock=1' };
  }
  if (pathname === '/autofix/projects') {
    return [
      {
        id: 'af-1',
        owner: 'henrikogaard',
        repo: 'nanocrab',
        triggerLabel: 'autofix',
        model: 'gpt-5.4',
        notifyJid: 'wa:alliance-command',
        autoReview: true,
      },
    ];
  }
  if (pathname === '/autofix/jobs') {
    return [
      {
        id: 'af-job-1',
        projectId: 'af-1',
        repo: 'henrikogaard/nanocrab',
        issueNumber: 43,
        issueTitle: 'Add dashboard mock mode',
        provider: 'codex',
        model: 'gpt-5.4',
        status: 'await_pr_approval',
        branch: 'nanocrab/issue-43-af-job-1',
        prUrl: null,
        commitSha: null,
        changedFiles: [
          'src/admin/public/pages/autofix.js',
          'src/admin/mock-data.ts',
        ],
        diffSummary:
          'src/admin/public/pages/autofix.js | 82 +++++++++++++++++++++\nsrc/admin/mock-data.ts | 24 ++++++',
        testSummary:
          'rtk mise exec node@22 -- npx vitest run src/coding-jobs.test.ts\n11 tests passed',
        ciStatus: 'pending',
        lastCiError: null,
        transitionedAt: {
          queued: iso(25),
          investigate: iso(24),
          plan: iso(23),
          await_approval: iso(22),
          implement: iso(21),
          test: iso(20),
          await_pr_approval: iso(19),
        },
        failureReason: null,
        createdAt: iso(19),
        startedAt: iso(19),
        output:
          'Investigating repository and issue context.\nImplementation approved by mock-owner.\nDiff stat captured. PR creation is awaiting approval.\n',
      },
    ];
  }
  if (pathname === '/autofix/issues') {
    return [
      {
        number: 43,
        title: 'Add dashboard mock mode',
        body: 'The Autofix dashboard needs realistic review data.',
        labels: ['autofix', 'ui'],
        assignees: ['henrikogaard'],
        milestone: 'P0 Closure',
        author: 'henrikogaard',
        htmlUrl: 'https://github.com/henrikogaard/nanocrab/issues/43',
        updatedAt: iso(30),
      },
      {
        number: 44,
        title: 'Block PR creation without approval',
        body: 'Opening PRs must be approval gated.',
        labels: ['autofix', 'safety'],
        assignees: [],
        milestone: 'P0 Closure',
        author: 'reviewer',
        htmlUrl: 'https://github.com/henrikogaard/nanocrab/issues/44',
        updatedAt: iso(44),
      },
    ];
  }
  if (pathname.startsWith('/autofix/jobs/')) {
    return {
      id: 'af-job-1',
      repo: 'henrikogaard/nanocrab',
      issueNumber: 43,
      issueTitle: 'Add dashboard mock mode',
      provider: 'codex',
      model: 'gpt-5.4',
      status: 'await_pr_approval',
      branch: 'nanocrab/issue-43-af-job-1',
      prUrl: null,
      commitSha: null,
      changedFiles: [
        'src/admin/public/pages/autofix.js',
        'src/admin/mock-data.ts',
      ],
      diffSummary:
        'src/admin/public/pages/autofix.js | 82 +++++++++++++++++++++\nsrc/admin/mock-data.ts | 24 ++++++',
      testSummary:
        'rtk mise exec node@22 -- npx vitest run src/coding-jobs.test.ts\n11 tests passed',
      ciStatus: 'pending',
      lastCiError: null,
      transitionedAt: {
        queued: iso(25),
        investigate: iso(24),
        plan: iso(23),
        await_approval: iso(22),
        implement: iso(21),
        test: iso(20),
        await_pr_approval: iso(19),
      },
      failureReason: null,
      createdAt: iso(19),
      startedAt: iso(19),
      output:
        'Investigating repository and issue context.\nImplementation approved by mock-owner.\nDiff stat captured. PR creation is awaiting approval.\n',
    };
  }
  if (pathname === '/marketplace') {
    return [
      {
        name: 'kdrive-reports',
        url: 'https://example.com/nanocrab-kdrive-plugin.git',
        installedAt: iso(2400),
        status: 'installed',
      },
    ];
  }
  if (pathname === '/users') {
    return [
      {
        id: 'user-1',
        username: 'mock-owner',
        role: 'owner',
        created_at: day(-20),
        last_login: iso(10),
      },
      {
        id: 'user-2',
        username: 'designer',
        role: 'admin',
        created_at: day(-3),
        last_login: iso(60),
      },
    ];
  }
  if (pathname === '/2fa/status') return { enabled: true };
  if (pathname === '/tokens') {
    return [
      {
        id: 'tok-1',
        name: 'local redesign token',
        created_at: day(-2),
        last_used: iso(20),
      },
    ];
  }
  if (pathname === '/push/vapid-key')
    return { publicKey: 'mock-vapid-public-key' };

  return undefined;
}

function writeResponse(pathname: string): JsonValue {
  if (pathname === '/login') {
    return {
      ok: true,
      token: 'mock-token',
      user: { username: 'mock-owner', role: 'owner' },
    };
  }
  if (pathname.includes('/check'))
    return ok({ message: 'Mock check completed' });
  if (pathname.includes('/run'))
    return ok({ message: 'Mock run queued', id: 'mock-run-1' });
  if (pathname === '/agents/coding/pick-issue') {
    return ok({
      issue: {
        number: 42,
        title: 'Add provider profiles to dashboard',
        htmlUrl: 'https://github.com/henrikogaard/nanocrab/issues/42',
      },
      job: {
        id: 'code-mock-1',
        repo: 'henrikogaard/nanocrab',
        status: 'queued',
      },
    });
  }
  if (pathname.includes('/rebuild'))
    return ok({ message: 'Mock rebuild queued' });
  if (pathname.includes('/preflight'))
    return ok({ message: 'Mock preflight passed' });
  if (pathname === '/providers/probe-all') return { version: 2, entries: [] };
  if (pathname === '/runtime-audit/simulate') {
    return ok({
      decision: {
        id: 'policy-mock-simulation',
        actionType: 'coding.open_pr',
        resource: 'henrikogaard/nanocrab',
        risk: 'high',
        decision: 'requires_approval',
        approvalRequired: true,
        dryRunAllowed: true,
        explanation: 'Repository-changing coding actions require approval.',
        matchedRuleIds: ['coding-writes'],
        context: { branch: 'nanocrab/task' },
      },
    });
  }
  return ok({ message: 'Mock write accepted. No live data changed.' });
}

export function handleMockApi(req: Request, res: Response): void {
  const pathname = req.path || '/';
  res.setHeader('Cache-Control', 'no-store');
  if (pathname === '/me' || pathname === '/login') {
    res.cookie('nanocrab_session', 'mock-token', {
      sameSite: 'strict',
      path: '/',
      maxAge: 86_400_000,
    });
  }

  if (pathname.includes('/download/attachments/')) {
    res
      .type('svg')
      .send(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#111827"/><text x="24" y="92" fill="#60a5fa" font-family="Arial" font-size="22">Mock attachment</text></svg>',
      );
    return;
  }

  const json = routeJson(pathname, req);
  if (json !== undefined) {
    res.json(json);
    return;
  }

  if (req.method.toUpperCase() !== 'GET') {
    res.json(writeResponse(pathname));
    return;
  }

  res.json({
    ok: true,
    mock: true,
    message: `Mock endpoint placeholder for ${pathname}`,
    items: [],
  });
}

export function mockWsMessages(): JsonValue[] {
  return [
    { type: 'log_lines', data: { lines: ['[INFO] Mock websocket connected'] } },
    {
      type: 'new_message',
      data: {
        id: 'ws-msg-1',
        chat_jid: 'wa:alliance-command',
        chat_name: 'Alliance Command',
        sender_name: 'Mock Scout',
        content: 'Live mock event: scout report arrived while previewing UI.',
        timestamp: iso(0),
        channel: 'whatsapp',
      },
    },
  ];
}
