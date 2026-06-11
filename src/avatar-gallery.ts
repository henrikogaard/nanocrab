import fs from 'fs';
import path from 'path';

export interface AvatarGalleryItem {
  id: string;
  name: string;
  description: string;
  kind: 'default' | 'builtin';
  url: string;
  themeNotes: string;
}

const BUILTIN_AVATARS: AvatarGalleryItem[] = [
  {
    id: 'nanocrab-default',
    name: 'NanoCrab Default',
    description: 'The standard NanoCrab logo mark.',
    kind: 'default',
    url: '/static/nanocrab-mark.png',
    themeNotes: 'Default logo avatar for all themes.',
  },
  {
    id: 'tide-crab',
    name: 'Tide Crab',
    description: 'Bright red shell with a blue tide backdrop.',
    kind: 'builtin',
    url: '/static/avatars/tide-crab.svg',
    themeNotes: 'High contrast on light and dark surfaces.',
  },
  {
    id: 'kelp-hermit',
    name: 'Kelp Hermit',
    description: 'Warm hermit body with a green shell.',
    kind: 'builtin',
    url: '/static/avatars/kelp-hermit.svg',
    themeNotes: 'Soft light palette with strong silhouette.',
  },
  {
    id: 'coral-lobster',
    name: 'Coral Lobster',
    description: 'Coral-toned lobster with bold claws.',
    kind: 'builtin',
    url: '/static/avatars/coral-lobster.svg',
    themeNotes: 'Readable at small sizes with warm accents.',
  },
  {
    id: 'amber-shrimp',
    name: 'Amber Shrimp',
    description: 'Curled amber shrimp on a mint field.',
    kind: 'builtin',
    url: '/static/avatars/amber-shrimp.svg',
    themeNotes: 'Rounded form for compact dashboard avatars.',
  },
  {
    id: 'midnight-crab',
    name: 'Midnight Crab',
    description: 'Dark blue crab with bright eyes.',
    kind: 'builtin',
    url: '/static/avatars/midnight-crab.svg',
    themeNotes: 'Designed for dark themes while still framed on light themes.',
  },
];

export function listAvatarGallery(): AvatarGalleryItem[] {
  return BUILTIN_AVATARS.map((item) => ({ ...item }));
}

export function getAvatarGalleryItem(id: string): AvatarGalleryItem | null {
  return listAvatarGallery().find((item) => item.id === id) || null;
}

export function avatarAssetPath(
  item: AvatarGalleryItem,
  projectRoot = process.cwd(),
): string | null {
  if (!item.url.startsWith('/static/')) return null;
  return path.join(
    projectRoot,
    'src',
    'admin',
    'public',
    item.url.replace(/^\//, ''),
  );
}

export function avatarAssetExists(
  item: AvatarGalleryItem,
  projectRoot = process.cwd(),
): boolean {
  const assetPath = avatarAssetPath(item, projectRoot);
  return !!assetPath && fs.existsSync(assetPath);
}
