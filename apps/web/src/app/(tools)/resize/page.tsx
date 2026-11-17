import { ToolWorkspace } from '@/features/tool-workspace';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Resize images by pixels, percentage or max edge',
  description: 'Resize with fit, fill, cover, contain or stretch — in your browser, in batch.',
};

export default function Page() {
  return <ToolWorkspace toolId="resize" />;
}
