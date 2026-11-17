/**
 * Social dimensions (docs/11-SOCIAL-PRESETS.md §2). Every row is a claim with a date: see
 * CHANGELOG.md in this package before changing one, and bump PRESETS_VERSION.
 */

export const PRESETS_VERSION = '1.0.0';
export const PRESETS_VERIFIED_AT = '2026-11-16';

export type SocialPlatform = 'instagram' | 'facebook' | 'youtube' | 'tiktok' | 'linkedin' | 'x' | 'whatsapp';

export type SafeMargins = { top: number; bottom: number; left: number; right: number };

export type SocialPreset = {
  platform: SocialPlatform;
  variant: string;
  label: string;
  width: number;
  height: number;
  maxBytes?: number;
  safe?: SafeMargins;
  note?: string;
};

export const SOCIAL_PRESETS: readonly SocialPreset[] = [
  { platform: 'instagram', variant: 'square-post', label: 'Square post', width: 1080, height: 1080 },
  { platform: 'instagram', variant: 'portrait-post', label: 'Portrait post', width: 1080, height: 1350 },
  { platform: 'instagram', variant: 'landscape-post', label: 'Landscape post', width: 1080, height: 566 },
  {
    platform: 'instagram',
    variant: 'story',
    label: 'Story / Reel cover',
    width: 1080,
    height: 1920,
    safe: { top: 0.14, bottom: 0.2, left: 0, right: 0 },
    note: 'UI overlays sit over the top and bottom of a story.',
  },
  {
    platform: 'facebook',
    variant: 'profile',
    label: 'Profile picture',
    width: 320,
    height: 320,
    note: 'Displayed at 176 px in feed.',
  },
  {
    platform: 'facebook',
    variant: 'cover',
    label: 'Cover photo',
    width: 851,
    height: 315,
    note: 'Mobile crops toward 640 × 360.',
  },
  { platform: 'facebook', variant: 'feed-post', label: 'Feed post', width: 1200, height: 630 },
  { platform: 'facebook', variant: 'story', label: 'Story', width: 1080, height: 1920 },
  {
    platform: 'youtube',
    variant: 'thumbnail',
    label: 'Thumbnail',
    width: 1280,
    height: 720,
    maxBytes: 2_000_000,
  },
  {
    platform: 'youtube',
    variant: 'channel-banner',
    label: 'Channel banner',
    width: 2560,
    height: 1440,
    safe: { top: 0.353, bottom: 0.353, left: 0.198, right: 0.198 },
    note: 'Only the centred 1546 × 423 is guaranteed visible on every device.',
  },
  { platform: 'youtube', variant: 'profile', label: 'Profile picture', width: 800, height: 800 },
  {
    platform: 'youtube',
    variant: 'shorts-thumbnail',
    label: 'Shorts thumbnail',
    width: 1080,
    height: 1920,
  },
  {
    platform: 'tiktok',
    variant: 'video-cover',
    label: 'Video cover',
    width: 1080,
    height: 1920,
    safe: { top: 0.12, bottom: 0.18, left: 0, right: 0 },
  },
  { platform: 'tiktok', variant: 'profile', label: 'Profile picture', width: 200, height: 200 },
  { platform: 'linkedin', variant: 'profile', label: 'Profile picture', width: 400, height: 400 },
  { platform: 'linkedin', variant: 'cover', label: 'Cover image', width: 1584, height: 396 },
  {
    platform: 'linkedin',
    variant: 'company-banner',
    label: 'Company banner',
    width: 1128,
    height: 191,
  },
  { platform: 'linkedin', variant: 'feed-post', label: 'Feed post', width: 1200, height: 627 },
  { platform: 'x', variant: 'profile', label: 'Profile picture', width: 400, height: 400 },
  { platform: 'x', variant: 'header', label: 'Header image', width: 1500, height: 500 },
  { platform: 'x', variant: 'post-image', label: 'Post image', width: 1200, height: 675 },
  { platform: 'whatsapp', variant: 'profile', label: 'Profile picture', width: 640, height: 640 },
  { platform: 'whatsapp', variant: 'status', label: 'Status image', width: 1080, height: 1920 },
];

export const PLATFORM_LABELS: Readonly<Record<SocialPlatform, string>> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  x: 'X',
  whatsapp: 'WhatsApp',
};

export function listPresets(platform?: SocialPlatform): readonly SocialPreset[] {
  return platform ? SOCIAL_PRESETS.filter((preset) => preset.platform === platform) : SOCIAL_PRESETS;
}

export function findPreset(platform: SocialPlatform, variant: string): SocialPreset | undefined {
  return SOCIAL_PRESETS.find((preset) => preset.platform === platform && preset.variant === variant);
}

export function groupedPresets(): ReadonlyArray<{
  platform: SocialPlatform;
  label: string;
  presets: readonly SocialPreset[];
}> {
  return (Object.keys(PLATFORM_LABELS) as SocialPlatform[]).map((platform) => ({
    platform,
    label: PLATFORM_LABELS[platform],
    presets: listPresets(platform),
  }));
}
