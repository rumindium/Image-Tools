import { ToolShell } from '@/features/tool-shell';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Remove image backgrounds in your browser',
  description: 'AI background removal with a transparent export, plus a background editor.',
};

export default function Page() {
  return <ToolShell toolId="bg-remove" sharesRouteWith={['bg-replace']} />;
}
