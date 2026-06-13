import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';

export type AssistantAvatarKind = 'default' | 'uploaded' | 'builtin';

export interface AssistantAvatarOption {
  id: string;
  kind: AssistantAvatarKind;
  name: string;
  description: string;
  url: string;
  available: boolean;
}

export interface AssistantProfile {
  selectedAvatarId: string;
  selectedAvatar: AssistantAvatarOption;
  avatars: AssistantAvatarOption[];
}

const PROFILE_PATH = path.join(STORE_DIR, 'assistant-profile.json');
const UPLOADED_AVATAR_EXTENSIONS = ['jpg', 'png', 'webp'] as const;

export const BUILTIN_AVATARS: AssistantAvatarOption[] = [
  {
    id: 'tidal-crab',
    kind: 'builtin',
    name: 'Tidal Crab',
    description: 'Bright shell with clean claws for a friendly assistant mark.',
    url: '/static/avatars/tidal-crab.svg',
    available: true,
  },
  {
    id: 'moon-lobster',
    kind: 'builtin',
    name: 'Moon Lobster',
    description: 'Calm crescent body and long antennae for night operations.',
    url: '/static/avatars/moon-lobster.svg',
    available: true,
  },
  {
    id: 'reef-hermit',
    kind: 'builtin',
    name: 'Reef Hermit',
    description: 'Compact shell silhouette that reads clearly at small sizes.',
    url: '/static/avatars/reef-hermit.svg',
    available: true,
  },
  {
    id: 'signal-shrimp',
    kind: 'builtin',
    name: 'Signal Shrimp',
    description: 'Slim, high-contrast profile for fast channel recognition.',
    url: '/static/avatars/signal-shrimp.svg',
    available: true,
  },
  {
    id: 'ember-crab',
    kind: 'builtin',
    name: 'Ember Crab',
    description: 'Warm shell and bold eyes for alert or operations profiles.',
    url: '/static/avatars/ember-crab.svg',
    available: true,
  },
];

function uploadedAvatarUrl(): string | null {
  const staticDirs = [
    path.join(process.cwd(), 'src/admin/public/static'),
    path.join(process.cwd(), 'dist/admin/public/static'),
  ];
  for (const extension of UPLOADED_AVATAR_EXTENSIONS) {
    if (
      staticDirs.some((staticDir) =>
        fs.existsSync(path.join(staticDir, `avatar.${extension}`)),
      )
    ) {
      return `/static/avatar.${extension}`;
    }
  }
  return null;
}

export function listAssistantAvatars(): AssistantAvatarOption[] {
  const uploadedUrl = uploadedAvatarUrl();
  return [
    {
      id: 'default',
      kind: 'default',
      name: 'NanoCrab Mark',
      description: 'Default NanoCrab logo mark.',
      url: '/static/nanocrab-mark.png',
      available: true,
    },
    {
      id: 'uploaded',
      kind: 'uploaded',
      name: 'Uploaded Avatar',
      description: 'Use the custom image uploaded to the dashboard.',
      url: uploadedUrl || '/static/avatar.jpg',
      available: Boolean(uploadedUrl),
    },
    ...BUILTIN_AVATARS,
  ];
}

function readSelectedAvatarId(): string {
  try {
    const data = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8')) as {
      selectedAvatarId?: string;
    };
    return typeof data.selectedAvatarId === 'string'
      ? data.selectedAvatarId
      : 'default';
  } catch {
    return 'default';
  }
}

export function getAssistantProfile(): AssistantProfile {
  const avatars = listAssistantAvatars();
  const selectedAvatarId = readSelectedAvatarId();
  const selectedAvatar =
    avatars.find(
      (avatar) => avatar.id === selectedAvatarId && avatar.available,
    ) || avatars[0];
  return {
    selectedAvatarId: selectedAvatar.id,
    selectedAvatar,
    avatars,
  };
}

export function saveAssistantAvatarSelection(
  selectedAvatarId: string,
): AssistantProfile {
  const avatars = listAssistantAvatars();
  const selectedAvatar = avatars.find(
    (avatar) => avatar.id === selectedAvatarId,
  );
  if (!selectedAvatar) {
    throw new Error('avatar option not found');
  }
  if (!selectedAvatar.available) {
    throw new Error('avatar option is not available');
  }
  fs.mkdirSync(path.dirname(PROFILE_PATH), { recursive: true });
  fs.writeFileSync(
    PROFILE_PATH,
    `${JSON.stringify({ selectedAvatarId }, null, 2)}\n`,
  );
  return getAssistantProfile();
}
