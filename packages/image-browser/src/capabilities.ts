import type { Capabilities } from '@ri/contracts';

/**
 * Capability probe — docs/0-PROCESSING-PIPELINE.md §7.
 * Feature detection alone lies (a device can advertise WebGPU and fail a 512 MB allocation), so the
 * encode side is measured with a real 16×16 encode and cached for the session.
 */

let cached: Capabilities | null = null;

type NavigatorWithExtras = Navigator & {
  deviceMemory?: number;
  gpu?: { requestAdapter: () => Promise<unknown> };
};

function canvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return element;
}

async function canEncode(type: string): Promise<boolean> {
  try {
    const surface = canvas(16, 16);
    if ('convertToBlob' in surface) {
      const blob = await surface.convertToBlob({ type, quality: 0.8 });
      return blob.type === type;
    }
    return surface.toDataURL(type).startsWith(`data:${type}`);
  } catch {
    return false;
  }
}

export async function probeCapabilities(): Promise<Capabilities> {
  if (cached) return cached;

  const nav = navigator as NavigatorWithExtras;
  const [jpeg, png, webp, avif] = await Promise.all([
    canEncode('image/jpeg'),
    canEncode('image/png'),
    canEncode('image/webp'),
    canEncode('image/avif'),
  ]);

  let webgpu: Capabilities['webgpu'] = 'no';
  if (nav.gpu) {
    try {
      const adapter = await nav.gpu.requestAdapter();
      webgpu = adapter ? 'yes' : 'adapter-failed';
    } catch {
      webgpu = 'adapter-failed';
    }
  }

  cached = {
    worker: typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined',
    createImageBitmap: typeof createImageBitmap === 'function',
    encode: { jpeg, png, webp, avif },
    // ORT reports its own SIMD/thread capability when the session is created
    // (docs/0-AI-MODELS.md §4); a hand-rolled validate() here would only guess.
    wasmSimd: false,
    wasmThreads: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
    webgpu,
    // A 2D context has no MAX_TEXTURE_SIZE query; keep the documented conservative ceiling and
    // let a failed allocation be the real test (docs/0-PROCESSING-PIPELINE.md §7.1).
    maxTextureDimension2D: 16_384,
    deviceMemoryGb: nav.deviceMemory ?? null,
    hardwareConcurrency: nav.hardwareConcurrency || 4,
    codecs: { heic: false, tiff: false },
  };

  return cached;
}

/** Test-only reset; the probe is otherwise stable for the session. */
export function resetCapabilitiesCache(): void {
  cached = null;
}
