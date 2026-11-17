import { ToolShell } from '@/features/tool-shell';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Enhance image exposure, contrast and colour',
  description: 'Auto levels, white balance, sharpening and denoising — in your browser.',
};

export default function Page() {
  return <ToolShell toolId="enhance" sharesRouteWith={['upscale']} />;
}
