import { ToolShell } from '@/features/tool-shell';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Extract a colour palette from an image',
  description: 'Dominant colours with proportions, CSS and JSON export, plus a pixel picker.',
};

export default function Page() {
  return <ToolShell toolId="palette" sharesRouteWith={['pixel-pick']} />;
}
