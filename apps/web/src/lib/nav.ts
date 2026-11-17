export type NavItem = { href: string; label: string; icon: string };

export type NavGroup = { label: string | null; items: NavItem[] };

/**
 * Sidebar structure — docs/0-UI-DESIGN.md §2.1. The registry has 20 tool ids but 11 destinations:
 * crop/transform/adjust/filter are tabs of /edit, base64/analyze are tabs of /utilities, and
 * pixel-pick is a tab of /colors (docs/0-TOOL-REGISTRY.md §3).
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { href: '/convert', label: 'Convert', icon: 'convert' },
      { href: '/compress', label: 'Compress', icon: 'compress' },
      { href: '/edit', label: 'Edit', icon: 'edit' },
      { href: '/resize', label: 'Resize', icon: 'resize' },
      { href: '/background', label: 'Remove bg', icon: 'background' },
      { href: '/enhance', label: 'Enhance', icon: 'enhance' },
    ],
  },
  {
    label: 'Inspect',
    items: [
      { href: '/utilities', label: 'Utilities', icon: 'utilities' },
      { href: '/colors', label: 'Colors', icon: 'colors' },
      { href: '/metadata', label: 'Metadata', icon: 'metadata' },
    ],
  },
  {
    label: null,
    items: [
      { href: '/batch', label: 'Batch', icon: 'batch' },
      { href: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

export const INDEX_HREF = '/';
