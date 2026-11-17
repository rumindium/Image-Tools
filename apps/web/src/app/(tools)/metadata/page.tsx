import { MetadataWorkspace } from '@/features/metadata-workspace';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Inspect and remove image metadata',
  description: 'Read EXIF and GPS locally, then strip it before you publish.',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  return <MetadataWorkspace initialTab={tab === 'clean' ? 'clean' : 'view'} />;
}
