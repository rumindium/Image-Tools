import { EditWorkspace } from '@/features/edit-workspace';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crop, rotate and adjust images',
  description: 'Crop, rotate, flip, adjust and filter an image in your browser.',
};

export default function Page() {
  return <EditWorkspace />;
}
