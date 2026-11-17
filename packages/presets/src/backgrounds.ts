/** Studio-style backdrop presets for docs/06-BACKGROUND-EDITOR.md §3. */

export type GradientPreset = {
  id: string;
  label: string;
  kind: 'linear' | 'radial';
  angle: number;
  stops: ReadonlyArray<{ color: string; at: number }>;
};

export const SOLID_BACKGROUNDS: ReadonlyArray<{ label: string; color: string }> = [
  { label: 'White', color: '#ffffff' },
  { label: 'Paper', color: '#f6f1e8' },
  { label: 'Light grey', color: '#e5e7eb' },
  { label: 'Charcoal', color: '#1f2329' },
  { label: 'Indigo', color: '#4f46e5' },
  { label: 'Forest', color: '#14532d' },
];

export const GRADIENT_BACKGROUNDS: readonly GradientPreset[] = [
  {
    id: 'studio-soft',
    label: 'Studio soft',
    kind: 'linear',
    angle: 135,
    stops: [
      { color: '#ffffff', at: 0 },
      { color: '#e5e7eb', at: 1 },
    ],
  },
  {
    id: 'warm-paper',
    label: 'Warm paper',
    kind: 'linear',
    angle: 160,
    stops: [
      { color: '#fdf6ec', at: 0 },
      { color: '#e9d8c3', at: 1 },
    ],
  },
  {
    id: 'cool-slate',
    label: 'Cool slate',
    kind: 'linear',
    angle: 45,
    stops: [
      { color: '#1f2937', at: 0 },
      { color: '#4b5563', at: 1 },
    ],
  },
  {
    id: 'sunset',
    label: 'Sunset',
    kind: 'linear',
    angle: 200,
    stops: [
      { color: '#f97316', at: 0 },
      { color: '#db2777', at: 0.6 },
      { color: '#4c1d95', at: 1 },
    ],
  },
  {
    id: 'spotlight',
    label: 'Spotlight',
    kind: 'radial',
    angle: 0,
    stops: [
      { color: '#ffffff', at: 0 },
      { color: '#9ca3af', at: 1 },
    ],
  },
  {
    id: 'mint',
    label: 'Mint fade',
    kind: 'linear',
    angle: 120,
    stops: [
      { color: '#ecfdf5', at: 0 },
      { color: '#a7f3d0', at: 1 },
    ],
  },
];

/** Quality presets shared by the option cards. */
export const QUALITY_PRESETS: ReadonlyArray<{ label: string; value: number; note: string }> = [
  { label: 'Smallest', value: 45, note: 'visible compression on photos' },
  { label: 'Balanced', value: 80, note: 'the default for WebP' },
  { label: 'High', value: 90, note: 'near-original, larger files' },
  { label: 'Maximum', value: 95, note: 'few visible artefacts, largest files' },
];
