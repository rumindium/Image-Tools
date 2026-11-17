import { DropProbe } from '@/components/drop-probe';
import { NAV_GROUPS } from '@/lib/nav';
import { CATALOG } from '@ri/contracts';
import { Card } from '@ri/ui';
import Link from 'next/link';

const DESTINATIONS = NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.href !== '/settings');

export default function IndexPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <section className="space-y-3">
        <h1 className="text-[32px] font-[650] leading-tight tracking-tight">Rumindium Image</h1>
        <p className="max-w-2xl text-[15px] text-text-muted">
          Everything you need to process images, in one place. Free, private, and processed in your browser —
          no account, no upload.
        </p>
      </section>

      <DropProbe />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Pick a tool</h2>
          <p className="text-xs text-text-muted">{CATALOG.length} tool ids · 11 destinations</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DESTINATIONS.map((item) => {
            const tools = CATALOG.filter((tool) => tool.route.startsWith(item.href));
            const phase = Math.min(...tools.map((tool) => tool.phase));
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-[var(--radius)] border border-border bg-surface-2 p-4 transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-text-muted">
                    P{phase}
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-muted">{tools.map((tool) => tool.title).join(' · ')}</p>
              </Link>
            );
          })}
        </div>
      </section>

      <Card title="Privacy, stated once" description="This is the claim a test has to keep true.">
        <p className="mt-2 text-sm text-text-muted">
          Conversion, compression, resizing, editing, metadata and colour analysis run in a worker in this
          tab. The server worker exists only for what a browser cannot do, it is opt-in per job, and it
          deletes the file within 15 minutes. No image, filename or EXIF field is ever written to a database.
        </p>
      </Card>

      <p className="text-xs text-text-muted">
        Phase 0: the workspace shell, the registry and the sniffer are in place. Each tool page reports its
        own phase from the registry — see <span className="font-mono">docs/0-IMPLEMENTATION-PHASE.md</span>.
      </p>
    </div>
  );
}
