'use client';

import { NAV_GROUPS } from '@/lib/nav';
import { cn } from '@ri/ui';
import {
  ArrowLeftRight,
  Code2,
  Layers,
  Minimize2,
  Palette,
  Scaling,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Wand2,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ICONS = {
  convert: ArrowLeftRight,
  compress: Minimize2,
  edit: SlidersHorizontal,
  resize: Scaling,
  background: Wand2,
  enhance: Sparkles,
  utilities: Code2,
  colors: Palette,
  metadata: Tags,
  batch: Layers,
  settings: Settings,
} as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-surface-2 md:flex md:flex-col">
      <Link href="/" className="flex h-14 items-center gap-2 border-b border-border px-4">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-[13px] font-bold text-accent-contrast">
          R
        </span>
        <span className="text-sm font-semibold leading-tight">
          Rumindium
          <span className="block text-[11px] font-normal text-text-muted">Image</span>
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Tools">
        {NAV_GROUPS.map((group, index) => (
          <div key={group.label ?? `group-${index}`} className={cn(index > 0 && 'mt-4')}>
            {group.label ? (
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {group.label}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = ICONS[item.icon as keyof typeof ICONS] ?? Layers;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                        active
                          ? 'bg-surface text-text shadow-sm'
                          : 'text-text-muted hover:bg-surface hover:text-text',
                      )}
                    >
                      <Icon size={15} strokeWidth={1.9} aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <p className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-text-muted">
        Privacy first.
        <br />
        No account, no upload.
      </p>
    </aside>
  );
}
