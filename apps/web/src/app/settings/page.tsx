import { Diagnostics } from '@/components/diagnostics';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-[28px] font-[650] leading-tight tracking-tight">Settings</h1>
        <p className="text-sm text-text-muted">
          Theme, capability diagnostics and the privacy facts that apply to every tool.
        </p>
      </header>

      <Diagnostics />

      <section className="rounded-[var(--radius)] border border-border bg-surface-2 p-5 text-sm">
        <h2 className="text-base font-semibold">Theme</h2>
        <p className="mt-1 text-text-muted">
          Light, dark or follow the system. Stored as <span className="font-mono">ri-theme</span> in this
          browser only.
        </p>
      </section>

      <section className="rounded-[var(--radius)] border border-border bg-surface-2 p-5 text-sm">
        <h2 className="text-base font-semibold">What is stored on this device</h2>
        <ul className="mt-2 space-y-1.5 text-text-muted">
          <li>· The theme preference.</li>
          <li>· Downloaded AI models, in the browser cache, with a hash check on read.</li>
          <li>· Nothing else. No image, filename, EXIF field or palette is persisted.</li>
        </ul>
      </section>
    </div>
  );
}
