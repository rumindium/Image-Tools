import type { AnalyzeOptionsValue } from '@ri/contracts';
import type { Sniffed } from '@ri/image-browser';
import { type HeaderMetadata, aspectName, readImageMetadata, reducedAspect } from '@ri/image-core';

/** docs/08-UTILITIES.md §3: the sample cap is stated in the report. */
export const ANALYSIS_SAMPLE_MAX_SIDE = 512;

/** A bounded head is enough for every header this analyzer reads. */
export const ANALYSIS_HEADER_BYTES = 256 * 1024;

export type AnalyzeReport = {
  name: string;
  bytes: number;
  format: string;
  mime: string;
  extension: string;
  width: number | null;
  height: number | null;
  dimensionsSource: 'bitmap' | 'header' | 'unknown';
  megapixels: number | null;
  aspect: { ratio: string; value: number } | null;
  orientation: HeaderMetadata['orientation'];
  alpha: { present: boolean | null; sampledAt: number };
  colorMode: 'RGB' | 'RGBA' | 'grayscale' | null;
  dpi: number | null;
  iccProfile: 'present' | 'absent' | 'unknown' | 'not-checked';
  bitDepth: number | null;
  animated: boolean;
  warnings: string[];
};

function extensionOf(name: string, fallback: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return fallback;
  const extension = name.slice(dot + 1).toLowerCase();
  return extension.length <= 10 ? extension : fallback;
}

function samplePixels(bitmap: ImageBitmap): {
  colorMode: AnalyzeReport['colorMode'];
  alphaPresent: boolean | null;
} {
  const width = bitmap.width;
  const height = bitmap.height;
  if (width < 1 || height < 1) return { colorMode: null, alphaPresent: null };

  const scale = Math.min(1, ANALYSIS_SAMPLE_MAX_SIDE / Math.max(width, height));
  const sampleWidth = Math.max(1, Math.round(width * scale));
  const sampleHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { colorMode: null, alphaPresent: null };

  context.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight);
  const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight);

  let alphaPresent = false;
  let grayscale = true;
  for (let offset = 0; offset < data.length; offset += 4) {
    const r = data[offset] as number;
    const g = data[offset + 1] as number;
    const b = data[offset + 2] as number;
    if ((data[offset + 3] as number) < 255) alphaPresent = true;
    if (r !== g || g !== b) grayscale = false;
  }

  return {
    alphaPresent,
    colorMode: grayscale ? 'grayscale' : alphaPresent ? 'RGBA' : 'RGB',
  };
}

/**
 * Decodes the bitmap for the exact dimensions and one 512 px pixel sample; the header supplies
 * orientation, DPI, ICC presence and bit depth. A missing decoder does not erase the header report.
 */
export async function analyzeImage(
  file: File,
  sniffed: Sniffed,
  options: AnalyzeOptionsValue,
): Promise<AnalyzeReport> {
  const head = new Uint8Array(await file.slice(0, ANALYSIS_HEADER_BYTES).arrayBuffer());
  const header = readImageMetadata(head);
  const warnings: string[] = [];

  let width = header.width ?? sniffed.width;
  let height = header.height ?? sniffed.height;
  let dimensionsSource: AnalyzeReport['dimensionsSource'] = width && height ? 'header' : 'unknown';
  let colorMode: AnalyzeReport['colorMode'] = null;
  let alphaPresent: boolean | null = null;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      width = bitmap.width;
      height = bitmap.height;
      dimensionsSource = 'bitmap';
      const sample = samplePixels(bitmap);
      colorMode = sample.colorMode;
      alphaPresent = sample.alphaPresent;
    } finally {
      bitmap.close();
    }

    if (header.width && header.height) {
      const differs = header.width !== width || header.height !== height;
      const swapped = header.width === height && header.height === width;
      if (differs && !swapped) {
        warnings.push(
          `The header says ${header.width} × ${header.height}, but the decoded pixels are ${width} × ${height}. The decoded dimensions win.`,
        );
      }
    }
  } catch {
    warnings.push(
      'The browser could not decode these pixels. Dimensions and metadata come from the header; colour mode and transparency are not checked.',
    );
    if (header.width && header.height) dimensionsSource = 'header';
  }

  const megapixels = width && height ? Number(((width * height) / 1_000_000).toFixed(1)) : null;
  const aspect =
    width && height
      ? {
          ratio: options.includeAspectName ? aspectName(width, height) : reducedAspect(width, height),
          value: Number((width / height).toFixed(4)),
        }
      : null;

  const iccProfile: AnalyzeReport['iccProfile'] = !options.detectColorProfile
    ? 'not-checked'
    : header.icc === true
      ? 'present'
      : header.icc === false
        ? 'absent'
        : 'unknown';

  return {
    name: file.name,
    bytes: file.size,
    format: sniffed.format,
    mime: sniffed.mime,
    extension: extensionOf(file.name, sniffed.format),
    width,
    height,
    dimensionsSource,
    megapixels,
    aspect,
    orientation: header.orientation,
    alpha: {
      present: options.detectTransparency ? alphaPresent : null,
      sampledAt: ANALYSIS_SAMPLE_MAX_SIDE,
    },
    colorMode,
    dpi: header.dpi,
    iccProfile,
    bitDepth: header.bitDepth,
    animated: sniffed.animated,
    warnings,
  };
}
