import { ToolShell } from '@/features/tool-shell';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Resize for Instagram, YouTube, TikTok and more',
  description: 'Platform presets with a focal point and safe-zone guides.',
};

export default function Page() {
  return <ToolShell toolId="social-resize" />;
}
