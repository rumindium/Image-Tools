import { UtilitiesWorkspace } from '@/features/utilities-workspace';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Base64, data URI and image analysis',
  description:
    'Encode an image to base64 or a data URI, decode one back, and inspect a batch without uploading it.',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  const initialTab = tab === 'analyze' ? 'analyze' : tab === 'data-uri' ? 'data-uri' : 'base64';
  return <UtilitiesWorkspace initialTab={initialTab} />;
}
