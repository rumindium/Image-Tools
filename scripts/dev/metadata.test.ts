import { describe, expect, it } from 'bun:test';
import { parseImageMetadata } from '../../apps/web/src/lib/metadata.ts';
import { sniffBytes } from '../../packages/image-browser/src/sniff.ts';
import type { MetadataGroup, MetadataReport } from '../../packages/image-core/src/index.ts';
import { buildMetadataReport } from '../../packages/image-core/src/metadata-report.ts';
import { makeMetadataJpeg } from './fixtures.ts';

function field(report: MetadataReport, groupId: MetadataGroup['id'], label: string): string | undefined {
  return report.groups.find((group) => group.id === groupId)?.fields.find((entry) => entry.label === label)
    ?.value;
}

describe('metadata viewer parser', () => {
  it('reads camera, capture, image, GPS, ICC and XMP groups from the real fixture', async () => {
    const bytes = makeMetadataJpeg();
    const report = await parseImageMetadata(
      new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
        type: 'image/jpeg',
      }),
      'metadata-exif.jpg',
      sniffBytes(bytes),
    );

    expect(report).toMatchObject({
      name: 'metadata-exif.jpg',
      format: 'jpeg',
      width: 40,
      height: 20,
      dpi: 300,
      orientation: { tag: 6, effect: 'rotate 90° clockwise' },
      icc: { present: true, description: 'sRGB' },
      gps: { present: true },
    });
    expect(report.gps.latitude).toBeCloseTo(-6.2083, 4);
    expect(report.gps.longitude).toBeCloseTo(106.8167, 4);

    expect(field(report, 'camera', 'Make')).toBe('Canon');
    expect(field(report, 'camera', 'Model')).toBe('EOS R5');
    expect(field(report, 'camera', 'Lens model')).toBe('RF 24-70mm F2.8 L IS USM');
    expect(field(report, 'camera', 'Aperture')).toBe('f/2.8');
    expect(field(report, 'camera', 'Shutter')).toBe('1/250 s');
    expect(field(report, 'camera', 'ISO')).toBe('ISO 100');
    expect(field(report, 'camera', 'Focal length')).toBe('50 mm');

    expect(field(report, 'capture', 'Captured')).toBe('2026-11-17 10:30:00');
    expect(field(report, 'capture', 'Captured offset')).toBe('+07:00');
    expect(field(report, 'capture', 'Artist')).toBe('Rumindium');

    expect(field(report, 'image', 'Orientation')).toBe('rotate 90° clockwise');
    expect(field(report, 'image', 'Resolution')).toBe('300 dpi');
    expect(field(report, 'image', 'Colour space')).toBe('sRGB');
    expect(field(report, 'image', 'Dimensions')).toBe('40 × 20');

    expect(field(report, 'gps', 'Latitude')).toBe('6.20833° S');
    expect(field(report, 'gps', 'Longitude')).toBe('106.81667° E');
    expect(field(report, 'gps', 'Altitude')).toContain('8 m above sea level');
    expect(report.groups.find((group) => group.id === 'gps')?.sensitive).toBe(true);

    expect(field(report, 'icc', 'Description')).toBe('sRGB');
    expect(field(report, 'icc', 'Colour space')).toBe('RGB');

    expect(field(report, 'xmp', 'Description')).toBe('Sunset over Jakarta');
    expect(field(report, 'xmp', 'Creator')).toBe('Rumindium');
    expect(field(report, 'xmp', 'Keywords')).toBe('Jakarta, sunset');
    expect(field(report, 'xmp', 'City')).toBe('Jakarta');
  });

  it('falls back to the header when no parser output is available', () => {
    const bytes = makeMetadataJpeg();
    const sniffed = sniffBytes(bytes);
    const report = buildMetadataReport({
      name: 'fallback.jpg',
      bytes: bytes.length,
      format: 'jpeg',
      mime: 'image/jpeg',
      width: sniffed.width,
      height: sniffed.height,
      raw: null,
      header: {
        width: 40,
        height: 20,
        bitDepth: 8,
        dpi: 300,
        icc: true,
        orientation: { tag: 6, effect: 'rotate 90° clockwise' },
      },
    });

    expect(report.dpi).toBe(300);
    expect(report.orientation?.tag).toBe(6);
    expect(field(report, 'image', 'Dimensions')).toBe('40 × 20');
    expect(field(report, 'image', 'Resolution')).toBe('300 dpi');
    expect(report.warnings.join(' ')).toContain('header summary');
  });
});
