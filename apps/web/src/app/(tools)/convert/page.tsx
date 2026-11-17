import { ToolWorkspace } from '@/features/tool-workspace';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Convert JPG, PNG, WebP and AVIF in your browser',
  description: 'Convert images between formats without uploading them. Free, private, batch supported.',
};

export default function Page() {
  return <ToolWorkspace toolId="convert" />;
}
