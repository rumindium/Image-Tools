import { getTool } from '@ri/contracts';
import { formatMegapixels, toMegabytes } from '@ri/image-core';
import { Card } from '@ri/ui';

const LANE_COPY = {
  browser: 'Runs in this tab',
  hybrid: 'Runs in this tab, with an opt-in server worker',
  server: 'Server worker only',
} as const;

/**
 * Phase 0 shell for a tool page: the registry is the source of truth, so this page cannot
 * contradict docs/0-TOOL-REGISTRY.md. The workspace, options and result panel land per phase.
 */
export function ToolShell({ toolId, sharesRouteWith = [] }: { toolId: string; sharesRouteWith?: string[] }) {
  const tool = getTool(toolId);
  const lane = LANE_COPY[tool.execution.kind];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{tool.category}</p>
        <h1 className="text-[28px] font-[650] leading-tight tracking-tight">{tool.title}</h1>
        <p className="max-w-2xl text-sm text-text-muted">
          {lane} · {tool.batch ? 'batch supported' : 'one file at a time'} · up to{' '}
          {formatMegapixels(tool.limits.maxPixels)} and {toMegabytes(tool.limits.maxBytes)} MB per file.
        </p>
      </header>

      <Card title="Not built yet" description={`This tool is scheduled for phase ${tool.phase}.`}>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-text-muted">Tool id</dt>
            <dd className="font-mono text-[13px]">{tool.id}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-text-muted">Route</dt>
            <dd className="font-mono text-[13px]">{tool.route || 'panel'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-text-muted">Produces</dt>
            <dd>{tool.produces.join(', ')}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-text-muted">Docs</dt>
            <dd className="font-mono text-[13px]">docs/{tool.docs}</dd>
          </div>
        </dl>

        {sharesRouteWith.length > 0 ? (
          <p className="mt-4 text-xs text-text-muted">
            Shares this route with: {sharesRouteWith.map((id) => getTool(id).title).join(' · ')} — tabs arrive
            with the tool.
          </p>
        ) : null}
      </Card>

      <Card
        title="What will be here"
        description="From docs/0-PROCESSING-PIPELINE.md §12: a drop area, the workspace preview, schema-driven option controls, and a result card with the export panel."
      >
        <ul className="mt-3 space-y-1.5 text-sm text-text-muted">
          <li>· Upload by drop, paste or browse; the sniffer rejects a non-image before any allocation.</li>
          <li>· Options validated by the same Zod schema the API uses.</li>
          <li>· Progress per file, with the lane badge on every result.</li>
          <li>· Export through the single download path, never per tool.</li>
        </ul>
      </Card>
    </div>
  );
}
