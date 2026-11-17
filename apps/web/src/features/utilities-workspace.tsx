'use client';

import { AnalyzeWorkspace } from '@/features/analyze-workspace';
import { Base64Workspace } from '@/features/base64-workspace';
import { useState } from 'react';

type Tab = 'base64' | 'data-uri' | 'analyze';

/**
 * `/utilities` hosts Base64, its Data URI tab and Analyze (docs/08-UTILITIES.md). Data URI is the
 * same `base64` tool with `includeDataUri: true`; it gets its own tab and CSS preview. The tab lives
 * in the query string so links keep working.
 */
export function UtilitiesWorkspace({ initialTab = 'base64' }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);

  const select = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1 text-sm">
        <button
          type="button"
          onClick={() => select('base64')}
          aria-pressed={tab === 'base64'}
          className={`flex-1 rounded-md px-3 py-1.5 font-medium ${
            tab === 'base64' ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'
          }`}
        >
          Base64
        </button>
        <button
          type="button"
          onClick={() => select('data-uri')}
          aria-pressed={tab === 'data-uri'}
          className={`flex-1 rounded-md px-3 py-1.5 font-medium ${
            tab === 'data-uri' ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'
          }`}
        >
          Data URI
        </button>
        <button
          type="button"
          onClick={() => select('analyze')}
          aria-pressed={tab === 'analyze'}
          className={`flex-1 rounded-md px-3 py-1.5 font-medium ${
            tab === 'analyze' ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'
          }`}
        >
          Analyze
        </button>
      </div>

      {tab === 'base64' ? (
        <Base64Workspace key="base64" />
      ) : tab === 'data-uri' ? (
        <Base64Workspace key="data-uri" mode="data-uri" />
      ) : (
        <AnalyzeWorkspace key="analyze" />
      )}
    </div>
  );
}
