import { ToolShell } from '@/features/tool-shell';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Batch process images',
  description: 'One configuration, up to 200 files, isolated failures and a streamed ZIP.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <ToolShell toolId="batch" />;
}
