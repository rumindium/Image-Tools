import { ToolWorkspace } from '@/features/tool-workspace';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Compress images without uploading them',
  description: 'Reduce image size by quality or by a target file size, in your browser.',
};

export default function Page() {
  return <ToolWorkspace toolId="compress" />;
}
