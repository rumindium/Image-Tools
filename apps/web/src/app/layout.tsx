import { Sidebar } from '@/components/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Rumindium Image — free browser image tools',
    template: '%s — Rumindium Image',
  },
  description:
    'Convert, compress, resize, edit, enhance and remove backgrounds — processed in your browser. Free, private, no account.',
  applicationName: 'Rumindium Image',
  robots: { index: true, follow: true },
};

// The nonce CSP is applied per request in middleware; a prerendered page cannot carry one.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-surface text-text antialiased">
        {/* Served from /theme.js so the CSP needs no inline script (docs/0-SECURITY.md §3). */}
        <script src="/theme.js" />
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-surface/90 px-4 backdrop-blur md:px-6">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span className="rounded-full border border-border px-2 py-0.5 font-medium">Phase 1</span>
                <span className="hidden sm:inline">convert · compress · resize run in this tab</span>
              </div>
              <ThemeToggle />
            </header>
            <main className="flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
            <footer className="border-t border-border px-4 py-4 text-xs text-text-muted md:px-6">
              Images are processed in this tab. Nothing is uploaded unless you choose the server worker.
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
