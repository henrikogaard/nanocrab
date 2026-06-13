import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { readEnvFile } from '../../env.js';
import { removeEnvVar, updateEnvVar } from '../auth.js';
import { auditLog } from '../security.js';
import { getCodexAuthStatus } from '../../codex-auth.js';
import { isAgentProvider } from '../../agent-provider.js';
import { createApproval } from '../../approvals.js';
import {
  getProviderProfile,
  loadProviderProfiles,
  providerModels,
  runLiveProviderProbe,
  getStoredProviderProbes,
  getProviderProbeHistory,
} from '../../provider-router.js';
import { isFallbackAction } from '../../providers/fallback-policy.js';
import {
  runAllProbes,
  getProbeHealth,
  refreshProbeHealth,
} from '../../probe-scheduler.js';
import { getModelMetricsData } from '../../model-metrics.js';

const router = Router();
const PROJECT_ROOT = process.cwd();
const PROVIDER_PREFS_PATH = path.join(
  PROJECT_ROOT,
  'store',
  'provider-preferences.json',
);

// --- Provider Registry (curated list) ---

interface Provider {
  id: string;
  name: string;
  category: string;
  description: string;
  website: string;
  envKey: string; // env var name for the API key
  skillFlag?: string; // flag value used by the skill (e.g., --provider fal)
  models?: string[]; // available models
  defaultModel?: string;
  free?: boolean; // has a free tier
}

const PROVIDERS: Provider[] = [
  // Image Generation
  {
    id: 'fal',
    name: 'fal.ai (Flux)',
    category: 'Image Generation',
    description:
      'Fast image generation with Flux and SDXL models. Good balance of speed and quality.',
    website: 'https://fal.ai',
    envKey: 'FAL_KEY',
    skillFlag: 'fal',
    models: ['fal-ai/flux/dev', 'fal-ai/flux/schnell', 'fal-ai/flux-pro'],
    defaultModel: 'fal-ai/flux/dev',
    free: true,
  },
  {
    id: 'openai-dalle',
    name: 'OpenAI DALL-E / GPT Image',
    category: 'Image Generation',
    description:
      'High-quality image generation from OpenAI. Best at following complex prompts. Requires OPENAI_API_KEY.',
    website: 'https://platform.openai.com',
    envKey: 'OPENAI_API_KEY',
    skillFlag: 'openai',
    models: ['gpt-image-1.5', 'gpt-image-1-mini', 'dall-e-3', 'dall-e-2'],
    defaultModel: 'dall-e-3',
  },
  {
    id: 'leonardo',
    name: 'Leonardo.ai',
    category: 'Image Generation',
    description:
      'Creative image generation with fine-tuned models. Great for artistic styles.',
    website: 'https://leonardo.ai',
    envKey: 'LEONARDO_API_KEY',
    skillFlag: 'leonardo',
    free: true,
  },

  // Code
  {
    id: 'claude-code',
    name: 'Claude Code (Agent SDK)',
    category: 'Code',
    description:
      'Primary coding agent powering NanoCrab. Uses Claude models via Agent SDK inside containers.',
    website: 'https://code.claude.com',
    envKey: 'CLAUDE_CODE_OAUTH_TOKEN',
    models: [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ],
    defaultModel: 'claude-sonnet-4-6',
  },
  {
    id: 'openai-codex',
    name: 'OpenAI Codex CLI',
    category: 'Code',
    description:
      'Autonomous coding agent from OpenAI. Supports ChatGPT OAuth login (no API key needed) — ask the bot to run "codex login --device-auth". Falls back to OPENAI_API_KEY.',
    website: 'https://developers.openai.com/codex',
    envKey: 'OPENAI_API_KEY',
    models: [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.2',
      'o4-mini',
      'o3-mini',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'gpt-4o',
      'gpt-4o-mini',
    ],
    defaultModel: 'o4-mini',
  },

  // Voice / Transcription
  {
    id: 'openai-whisper',
    name: 'OpenAI Whisper',
    category: 'Voice',
    description:
      'Speech-to-text transcription. Automatically transcribes voice messages from WhatsApp, Telegram, and Signal.',
    website: 'https://platform.openai.com',
    envKey: 'OPENAI_API_KEY',
    models: ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'],
    defaultModel: 'whisper-1',
  },

  // LLM / Chat
  {
    id: 'anthropic',
    name: 'Anthropic Claude (API Key)',
    category: 'LLM',
    description:
      'Primary AI model powering the assistant. API key from console.anthropic.com with usage-based billing.',
    website: 'https://console.anthropic.com',
    envKey: 'ANTHROPIC_API_KEY',
    models: [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ],
    defaultModel: 'claude-sonnet-4-6',
  },
  {
    id: 'anthropic-oauth',
    name: 'Anthropic Claude (OAuth)',
    category: 'LLM',
    description:
      'OAuth-based authentication for Claude. Uses Claude Code long-lived token — run "claude setup-token" to generate.',
    website: 'https://console.anthropic.com',
    envKey: 'CLAUDE_CODE_OAUTH_TOKEN',
    models: [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ],
    defaultModel: 'claude-sonnet-4-6',
  },

  // OpenAI OAuth (Codex only)
  {
    id: 'openai-oauth',
    name: 'OpenAI ChatGPT Login',
    category: 'Code',
    description:
      'Authenticate Codex CLI via ChatGPT Plus/Pro subscription — no API credits needed. Ask the bot to run "codex login --device-auth". Tokens stored locally. Note: DALL-E and Whisper still require OPENAI_API_KEY.',
    website: 'https://developers.openai.com/codex/auth',
    envKey: 'CODEX_OAUTH',
    free: true,
  },

  // Developer Tools
  {
    id: 'github',
    name: 'GitHub API',
    category: 'Developer Tools',
    description:
      'Create PRs, review code, manage issues, check CI status. Requires a personal access token with repo scope.',
    website: 'https://github.com/settings/tokens',
    envKey: 'GITHUB_TOKEN',
  },
];

// Group by category
function groupByCategory(providers: Provider[]): Record<string, Provider[]> {
  const groups: Record<string, Provider[]> = {};
  for (const p of providers) {
    if (!groups[p.category]) groups[p.category] = [];
    groups[p.category].push(p);
  }
  return groups;
}

// --- Preferences (default provider per category per group) ---

interface ProviderPreferences {
  global: Record<string, string>; // category -> provider id
  groups: Record<string, Record<string, string>>; // groupFolder -> category -> provider id
}

function loadPreferences(): ProviderPreferences {
  try {
    return JSON.parse(fs.readFileSync(PROVIDER_PREFS_PATH, 'utf-8'));
  } catch {
    return { global: {}, groups: {} };
  }
}

function savePreferences(prefs: ProviderPreferences): void {
  fs.mkdirSync(path.dirname(PROVIDER_PREFS_PATH), { recursive: true });
  fs.writeFileSync(PROVIDER_PREFS_PATH, JSON.stringify(prefs, null, 2));
}

// --- Routes ---

// List all providers with status
router.get('/', (_req: Request, res: Response) => {
  const allEnvKeys = [...new Set(PROVIDERS.map((p) => p.envKey))];
  const envVars = readEnvFile(allEnvKeys);
  const codexAuth = getCodexAuthStatus();

  const providers = PROVIDERS.map((p) => ({
    ...p,
    configured:
      p.id === 'openai-oauth'
        ? codexAuth.configured
        : p.id === 'openai-codex'
          ? codexAuth.configured ||
            !!(process.env[p.envKey] || envVars[p.envKey])
          : !!(process.env[p.envKey] || envVars[p.envKey]),
  }));

  const prefs = loadPreferences();
  const categories = groupByCategory(providers);

  res.json({ providers, categories, preferences: prefs });
});

// Enable a provider (set API key)
router.post('/:id/enable', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) {
    res.status(404).json({ error: 'Provider not found' });
    return;
  }

  const { apiKey } = req.body;
  if (!apiKey) {
    res.status(400).json({ error: 'API key required' });
    return;
  }

  updateEnvVar(provider.envKey, apiKey.trim());
  auditLog(req, 'provider_enabled', `${id} (${provider.envKey})`);
  res.json({
    ok: true,
    message: `${provider.name} enabled. Restart to activate.`,
  });
});

// Disable a provider by removing its configured env key.
router.post('/:id/disable', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) {
    res.status(404).json({ error: 'Provider not found' });
    return;
  }
  if (provider.envKey.startsWith('CODEX_')) {
    res.status(400).json({
      error: 'OAuth providers are disabled by logging out of their CLI',
    });
    return;
  }

  removeEnvVar(provider.envKey);
  auditLog(req, 'provider_disabled', `${id} (${provider.envKey})`);
  res.json({ ok: true, message: `${provider.name} disabled.` });
});

// Set default provider for a category
router.put('/preferences', (req: Request, res: Response) => {
  const { category, providerId, groupFolder } = req.body;
  if (!category || (!providerId && !groupFolder)) {
    res.status(400).json({ error: 'Category and providerId required' });
    return;
  }

  const prefs = loadPreferences();

  if (groupFolder) {
    if (!prefs.groups[groupFolder]) prefs.groups[groupFolder] = {};
    if (providerId) {
      prefs.groups[groupFolder][category] = providerId;
    } else {
      delete prefs.groups[groupFolder][category];
      if (Object.keys(prefs.groups[groupFolder]).length === 0) {
        delete prefs.groups[groupFolder];
      }
    }
  } else {
    prefs.global[category] = providerId;
  }

  savePreferences(prefs);
  auditLog(
    req,
    'provider_default_changed',
    `${category} -> ${providerId}${groupFolder ? ` (group: ${groupFolder})` : ' (global)'}`,
  );
  res.json({ ok: true });
});

// Get the effective default provider for a category+group
router.get('/default/:category', (req: Request, res: Response) => {
  const category = req.params.category as string;
  const groupFolder = req.query.group as string | undefined;
  const prefs = loadPreferences();

  // Group-specific > global > first configured provider in category
  let defaultId =
    (groupFolder && prefs.groups[groupFolder]?.[category]) ||
    prefs.global[category] ||
    null;

  if (!defaultId) {
    // Auto-pick first configured provider in this category
    const allEnvKeys = [...new Set(PROVIDERS.map((p) => p.envKey))];
    const envVars = readEnvFile(allEnvKeys);
    const firstConfigured = PROVIDERS.find(
      (p) =>
        p.category === category &&
        !!(process.env[p.envKey] || envVars[p.envKey]),
    );
    defaultId = firstConfigured?.id || null;
  }

  const provider = PROVIDERS.find((p) => p.id === defaultId);
  res.json({ providerId: defaultId, provider: provider || null });
});

router.get('/models', (req: Request, res: Response) => {
  const provider =
    typeof req.query.provider === 'string' ? req.query.provider : '';
  if (provider) {
    if (!isAgentProvider(provider)) {
      res.status(400).json({ error: 'unknown provider' });
      return;
    }
    res.json({ provider, models: providerModels(provider) });
    return;
  }
  res.json({
    profiles: loadProviderProfiles(),
    models: Object.fromEntries(
      loadProviderProfiles().map((profile) => [
        profile.id,
        providerModels(profile.provider),
      ]),
    ),
  });
});

router.post('/probe', async (req: Request, res: Response) => {
  try {
    const profileId =
      typeof req.body.profileId === 'string'
        ? req.body.profileId
        : typeof req.body.profile_id === 'string'
          ? req.body.profile_id
          : 'default_chat';
    const profile = getProviderProfile(profileId as never);
    if (!profile) {
      res
        .status(404)
        .json({ error: `Provider profile not found: ${profileId}` });
      return;
    }
    const probe = await runLiveProviderProbe(profile);
    auditLog(
      req,
      'provider_probe_run',
      `${profile.id} -> ${profile.provider}/${profile.model}`,
    );
    res.json({ ok: true, probe });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get('/probe-history', (req: Request, res: Response) => {
  try {
    const providerId =
      typeof req.query.providerId === 'string'
        ? req.query.providerId
        : undefined;
    const model =
      typeof req.query.model === 'string' ? req.query.model : undefined;
    const limit =
      typeof req.query.limit === 'string'
        ? parseInt(req.query.limit, 10) || undefined
        : undefined;
    const history = getProviderProbeHistory(providerId, model, limit);
    res.json({ ok: true, history });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/fallback-approval', (req: Request, res: Response) => {
  const sourceProfileId =
    typeof req.body.sourceProfileId === 'string'
      ? req.body.sourceProfileId
      : typeof req.body.source_profile_id === 'string'
        ? req.body.source_profile_id
        : '';
  const targetProfileId =
    typeof req.body.targetProfileId === 'string'
      ? req.body.targetProfileId
      : typeof req.body.target_profile_id === 'string'
        ? req.body.target_profile_id
        : '';
  const action =
    typeof req.body.action === 'string' ? req.body.action : 'write';
  if (!sourceProfileId || !targetProfileId) {
    res
      .status(400)
      .json({ error: 'sourceProfileId and targetProfileId required' });
    return;
  }
  if (!isFallbackAction(action)) {
    res.status(400).json({ error: 'action must be a known fallback action' });
    return;
  }
  const profiles = loadProviderProfiles();
  const sourceProfile = profiles.find(
    (profile) => profile.id === sourceProfileId,
  );
  const targetProfile = profiles.find(
    (profile) => profile.id === targetProfileId,
  );
  if (!sourceProfile || !targetProfile) {
    res.status(400).json({ error: 'source and target profiles must exist' });
    return;
  }
  const targetId = `${sourceProfile.id}:${sourceProfile.provider}/${sourceProfile.model}->${targetProfile.id}:${targetProfile.provider}/${targetProfile.model}:${action}`;
  const approval = createApproval({
    kind: 'provider-fallback',
    title: 'Approve provider fallback',
    summary: `Allow ${sourceProfile.label} to fall back from ${sourceProfile.provider}/${sourceProfile.model} to ${targetProfile.provider}/${targetProfile.model} for ${action} work.`,
    risk: action === 'read' ? 'low' : 'high',
    requester: req.user?.username || 'dashboard',
    targetType: 'provider-profile',
    targetId,
    source: 'dashboard',
    payload: {
      sourceProfileId: sourceProfile.id,
      targetProfileId: targetProfile.id,
      sourceProvider: sourceProfile.provider,
      sourceModel: sourceProfile.model,
      targetProvider: targetProfile.provider,
      targetModel: targetProfile.model,
      action,
    },
  });
  auditLog(req, 'provider_fallback_approval_requested', approval.id);
  res.json({ ok: true, approval });
});

router.get('/health', (_req: Request, res: Response) => {
  const health = getProbeHealth();
  if (health.version === 0) {
    refreshProbeHealth();
  }
  res.json(getProbeHealth());
});

router.get('/model-metrics', (_req: Request, res: Response) => {
  res.json(getModelMetricsData());
});

router.post('/probe-all', async (_req: Request, res: Response) => {
  try {
    const data = await runAllProbes();
    auditLog(
      _req,
      'provider_probe_all',
      `${data.entries.length} profiles probed`,
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Probe all failed',
    });
  }
});

export default router;
