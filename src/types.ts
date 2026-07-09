import type { AgentProvider } from './agent-provider.js';

export interface AdditionalMount {
  hostPath: string; // Absolute path on host (supports ~ for home)
  containerPath?: string; // Optional — defaults to basename of hostPath. Mounted at /workspace/extra/{value}
  readonly?: boolean; // Default: true for safety
}

/**
 * Mount Allowlist - Security configuration for additional mounts
 * This file should be stored at ~/.config/nanocrab/mount-allowlist.json
 * and is NOT mounted into any container, making it tamper-proof from agents.
 */
export interface MountAllowlist {
  // Directories that can be mounted into containers
  allowedRoots: AllowedRoot[];
  // Glob patterns for paths that should never be mounted (e.g., ".ssh", ".gnupg")
  blockedPatterns: string[];
  // If true, non-main groups can only mount read-only regardless of config
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  // Absolute path or ~ for home (e.g., "~/projects", "/var/repos")
  path: string;
  // Whether read-write mounts are allowed under this root
  allowReadWrite: boolean;
  // Optional description for documentation
  description?: string;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number; // Default: 300000 (5 minutes)
  // Allowlist of MCP servers available to this group.
  // Undefined = all servers (default). Empty array = nanocrab only.
  // Main group always gets all servers regardless of this setting.
  allowedMcpServers?: string[];
  // Override the agent provider for this group. Undefined = inherit DEFAULT_PROVIDER.
  provider?: AgentProvider;
  // Remember the last selected model per provider for this group.
  models?: Partial<Record<AgentProvider, string>>;
  // Override the model for this group. Model names are provider-specific.
  model?: string;
  // Free-text restrictions/instructions appended to the group's agent instructions.
  // Soft approval — the agent follows these as part of its instructions.
  // Example: "Never run `rm -rf`, `git push --force`, or `DROP TABLE` without asking first"
  restrictions?: string;
  // Main-agent channel visibility. Undefined/all = all known group chats.
  // registered = registered bot groups only. allowed = only folders listed below.
  channelScope?: 'all' | 'registered' | 'allowed';
  allowedGroupFolders?: string[];
}

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  containerConfig?: ContainerConfig;
  requiresTrigger?: boolean; // Default: true for groups, false for solo chats
  isMain?: boolean; // True for the main control group (no trigger, elevated privileges)
  enabled?: boolean; // False pauses agent processing for this registered bot/channel
  isPrimary?: boolean; // Primary owner bot for startup notices and owner-facing status
  // 'web' marks a synthetic web-conversation thread (Chat mode). Web groups are
  // excluded from channel/group management surfaces. Undefined = a real channel group.
  kind?: 'web';
  // User-facing conversation title (web threads). Channel groups use `name`.
  title?: string;
  // Optional Cowork project association for project-scoped web threads.
  projectId?: string;
  // Sanitized project folder slug used for internal project workspace mounts.
  projectSlug?: string;
  // Optional Chat-mode virtual folder for grouping plain web conversations.
  chatProjectId?: string;
}

export interface ChatProject {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface CoworkProject {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  instructions: string | null;
  created_at: string;
  updated_at: string;
}

export type CoworkRunStatus =
  | 'draft'
  | 'planning'
  | 'waiting_for_approval'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CoworkComplexity =
  | 'quick'
  | 'standard'
  | 'long'
  | 'connector-heavy';

export type CoworkApprovalRisk = 'low' | 'medium' | 'high';

export interface CoworkRun {
  id: string;
  project_id: string;
  title: string;
  status: CoworkRunStatus;
  provider: string | null;
  model: string | null;
  complexity: CoworkComplexity;
  approval_risk: CoworkApprovalRisk;
  prompt: string | null;
  summary: string | null;
  stats_json: string;
  created_at: string;
  updated_at: string;
}

export interface CoworkRunStep {
  id: string;
  run_id: string;
  step_order: number;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'blocked' | 'failed';
  detail: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoworkRunEvent {
  id: string;
  run_id: string;
  event_order: number;
  kind: string;
  message: string;
  metadata_json: string;
  created_at: string;
}

export interface CoworkContextItem {
  id: string;
  project_id: string;
  type: string;
  title: string;
  path: string | null;
  url: string | null;
  thread_id: string | null;
  artifact_id: string | null;
  included: number;
  pinned: number;
  provenance: string;
  sensitivity: string;
  created_at: string;
  updated_at: string;
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
  thread_id?: string;
  reply_to_message_id?: string;
  reply_to_message_content?: string;
  reply_to_sender_name?: string;
}

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  title?: string | null;
  description?: string | null;
  routine_type?: string | null;
  prompt: string;
  script?: string | null;
  provider_profile_id?: string | null;
  provider?: AgentProvider | null;
  model?: string | null;
  tool_policy?: string | null;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated' | 'session';
  delivery_mode?: 'chat' | 'dashboard' | 'file' | 'webhook' | null;
  delivery_target?: string | null;
  skills_json?: string | null;
  max_runtime_ms?: number | null;
  max_active_runs?: number | null;
  active_run_count?: number | null;
  last_started_at?: string | null;
  heartbeat_policy_json?: string | null;
  silent_marker?: string | null;
  session_key?: string | null;
  context_task_ids_json?: string | null;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

export type AgentProfileToolPolicy =
  | 'read-only'
  | 'approval-required'
  | 'allow';
export type AgentProfileTaskKind =
  | 'chat'
  | 'cowork_task'
  | 'coding_job'
  | 'report'
  | 'research'
  | 'scheduled_check';
export type AgentSubscriptionSourceType = 'github' | 'channel_mention';
export type AgentSubscriptionAutonomyMode = 'investigate_then_pause';

export interface AgentProfile {
  id: string;
  handle: string;
  displayName: string;
  avatar: string | null;
  description: string | null;
  personality: string | null;
  enabled: boolean;
  providerProfileId: string | null;
  provider: AgentProvider | null;
  model: string | null;
  toolPolicy: AgentProfileToolPolicy;
  allowedMcpServers: string[] | null;
  skills: string[];
  memoryScopes: string[];
  taskKinds: AgentProfileTaskKind[];
  channelBindings: Record<string, string[]>;
  writePolicy: {
    directSendRequiresApproval: boolean;
    autonomousSendRequiresApproval: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AgentSubscription {
  id: string;
  agentProfileId: string;
  sourceType: AgentSubscriptionSourceType;
  enabled: boolean;
  filters: Record<string, unknown>;
  taskKind: AgentProfileTaskKind;
  autonomyMode: AgentSubscriptionAutonomyMode;
  lastSeenAt: string | null;
  lastMatchedAt: string | null;
  lastRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSubscriptionEvent {
  id: string;
  subscriptionId: string;
  agentProfileId: string;
  dedupeKey: string;
  sourceType: AgentSubscriptionSourceType;
  sourceId: string;
  externalEventId: string;
  runId: string | null;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface NewAgentSubscriptionEvent {
  id: string;
  subscriptionId: string;
  agentProfileId: string;
  dedupeKey: string;
  sourceType: AgentSubscriptionSourceType;
  sourceId: string;
  externalEventId: string;
  runId: string | null;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AgentProfileActivity {
  id: string;
  agentProfileId: string;
  subscriptionId: string | null;
  kind:
    | 'invocation'
    | 'subscription_match'
    | 'run_started'
    | 'approval_blocked'
    | 'error';
  sourceType: string;
  sourceId: string | null;
  summary: string;
  runId: string | null;
  approvalId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface NewAgentProfileActivity {
  id: string;
  agentProfileId: string;
  subscriptionId: string | null;
  kind: AgentProfileActivity['kind'];
  sourceType: string;
  sourceId: string | null;
  summary: string;
  runId: string | null;
  approvalId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type MemoryScope = 'global' | 'group' | 'user' | 'project' | 'repo';
export type MemoryType =
  | 'preference'
  | 'fact'
  | 'habit'
  | 'relationship'
  | 'project'
  | 'credential-note'
  | 'game-knowledge'
  | 'warning';
export type MemoryVisibility =
  | 'private'
  | 'group'
  | 'global'
  | 'superuser-only';
export type MemoryStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'stale'
  | 'contradicted';

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  source: string | null;
  confidence: number;
  visibility: MemoryVisibility;
  status: MemoryStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  expires_at: string | null;
  sensitivity: 'normal' | 'sensitive' | 'secret-note';
  source_links_json: string;
  contradicts_memory_id: string | null;
  stale_after: string | null;
}

export interface NewMemoryRecord {
  id: string;
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  source?: string | null;
  confidence: number;
  visibility: MemoryVisibility;
  status: MemoryStatus;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at?: string | null;
  expires_at?: string | null;
  sensitivity?: 'normal' | 'sensitive' | 'secret-note';
  source_links_json?: string;
  contradicts_memory_id?: string | null;
  stale_after?: string | null;
}

export interface JournalEntryRecord {
  id: string;
  date: string;
  scope: string;
  group_folder: string | null;
  summary: string;
  notable_events_json: string;
  source_message_ids_json: string;
  provider_profile_id: string | null;
  created_at: string;
}

export interface NewJournalEntryRecord {
  id: string;
  date: string;
  scope: string;
  group_folder?: string | null;
  summary: string;
  notable_events_json?: string;
  source_message_ids_json?: string;
  provider_profile_id?: string | null;
  created_at: string;
}

export interface JournalEventRecord {
  id: string;
  timestamp: string;
  title: string;
  entities_json: string;
  location_context: string | null;
  confidence: number;
  source_ids_json: string;
  tags_json: string;
  group_folder: string | null;
  created_at: string;
}

export interface NewJournalEventRecord {
  id: string;
  timestamp: string;
  title: string;
  entities_json?: string;
  location_context?: string | null;
  confidence: number;
  source_ids_json?: string;
  tags_json?: string;
  group_folder?: string | null;
  created_at: string;
}

// --- Channel abstraction ---

export type ChannelHealthStatus = 'healthy' | 'down' | 'disabled' | 'degraded';

export interface ChannelStatusSnapshot {
  name: string;
  connected: boolean;
  status: ChannelHealthStatus;
  lastActiveAt: string | null;
  reason: string;
}

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  getHealth?(): ChannelHealth;
  // Optional: typing indicator. Channels that support it implement it.
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
  // Optional: sync group/chat names from the platform.
  syncGroups?(force: boolean): Promise<void>;
  // Optional: richer runtime health for dashboard and diagnostics.
  getStatus?(): ChannelStatusSnapshot;
}

export interface ChannelHealth {
  name: string;
  connected: boolean;
  status: 'active' | 'degraded' | 'offline' | 'disabled';
  lastActiveAt: string | null;
  detail: string;
  diagnostics?: Record<string, string | number | boolean | null>;
}

// Callback type that channels use to deliver inbound messages
export type OnInboundMessage = (chatJid: string, message: NewMessage) => void;

// Callback for chat metadata discovery.
// name is optional — channels that deliver names inline (Telegram) pass it here;
// channels that sync names separately (via syncGroups) omit it.
export type OnChatMetadata = (
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
) => void;
