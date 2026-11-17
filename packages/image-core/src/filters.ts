/**
 * Tone and filter primitives (docs/03-EDIT.md §5.2–§5.4). Pure functions over RGBA bytes so the
 * reference maths can be tested without a canvas, and the browser op does one pass over the pixels.
 */

export type Adjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  tint: number;
  gamma: number;
  hue: number;
};

export const NO_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  temperature: 0,
  tint: 0,
  gamma: 1,
  hue: 0,
};

const clampByte = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));

export type ChannelLut = { r: Uint8ClampedArray; g: Uint8ClampedArray; b: Uint8ClampedArray };

/**
 * One 256-entry table per channel: exposure (linear multiplier), contrast around mid-grey,
 * brightness, gamma, then the temperature/tint channel gains. 40 MP becomes 40 M lookups.
 */
export function buildToneLut(adjustments: Partial<Adjustments>): ChannelLut {
  const a = { ...NO_ADJUSTMENTS, ...adjustments };
  const exposure = 2 ** (a.exposure / 50);
  const contrast = (259 * (a.contrast + 255)) / (255 * (259 - a.contrast));
  const brightness = a.brightness * 2.55;
  const gamma = 1 / a.gamma;

  const gains = {
    r: 1 + a.temperature * 0.0012,
    g: 1 - a.tint * 0.0008,
    b: 1 - a.temperature * 0.0012,
  };

  const r = new Uint8ClampedArray(256);
  const g = new Uint8ClampedArray(256);
  const b = new Uint8ClampedArray(256);

  for (let v = 0; v < 256; v += 1) {
    let x = v * exposure;
    x = contrast * (x - 128) + 128 + brightness;
    x = 255 * (Math.max(0, Math.min(255, x)) / 255) ** gamma;
    r[v] = clampByte(x * gains.r);
    g[v] = clampByte(x * gains.g);
    b[v] = clampByte(x * gains.b);
  }

  return { r, g, b };
}

type Hsl = { h: number; s: number; l: number };

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

function hueRotate(data: Uint8ClampedArray, degrees: number): void {
  for (let i = 0; i < data.length; i += 4) {
    const hsl = rgbToHsl(data[i] as number, data[i + 1] as number, data[i + 2] as number);
    const [r, g, b] = hslToRgb((hsl.h + degrees + 360) % 360, hsl.s, hsl.l);
    data[i] = clampByte(r);
    data[i + 1] = clampByte(g);
    data[i + 2] = clampByte(b);
  }
}

/** LUT + saturation (lerp toward Rec.709 luma) + hue rotation, one pass. */
export function applyAdjustments(data: Uint8ClampedArray, adjustments: Partial<Adjustments>): void {
  const a = { ...NO_ADJUSTMENTS, ...adjustments };
  const lut = buildToneLut(a);
  const saturation = Math.max(0, Math.min(2, 1 + a.saturation / 100));

  for (let i = 0; i < data.length; i += 4) {
    const r = lut.r[data[i] as number] as number;
    const g = lut.g[data[i + 1] as number] as number;
    const b = lut.b[data[i + 2] as number] as number;

    let rr = r;
    let gg = g;
    let bb = b;
    if (a.saturation !== 0) {
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      rr = y + (r - y) * saturation;
      gg = y + (g - y) * saturation;
      bb = y + (b - y) * saturation;
    }

    data[i] = clampByte(rr);
    data[i + 1] = clampByte(gg);
    data[i + 2] = clampByte(bb);
  }

  if (a.hue !== 0) hueRotate(data, a.hue);
}

function copyChannel(data: Uint8ClampedArray, width: number, height: number, channel: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let p = 0; p < out.length; p += 1) out[p] = data[p * 4 + channel] as number;
  return out;
}

function writeChannel(
  data: Uint8ClampedArray,
  source: Float32Array,
  channel: number,
  gain = 1,
  offset = 0,
): void {
  for (let p = 0; p < source.length; p += 1) {
    data[p * 4 + channel] = clampByte((source[p] as number) * gain + offset);
  }
}

/** Separable 5-tap Gaussian, edges clamped. */
function gaussianBlur(data: Uint8ClampedArray, width: number, height: number, passes = 1): void {
  const kernel = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  const radius = 2;

  for (let pass = 0; pass < passes; pass += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const source = copyChannel(data, width, height, channel);
      const horizontal = new Float32Array(source.length);

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          let sum = 0;
          for (let k = -radius; k <= radius; k += 1) {
            const sx = Math.min(width - 1, Math.max(0, x + k));
            sum += (source[y * width + sx] as number) * (kernel[k + radius] as number);
          }
          horizontal[y * width + x] = sum;
        }
      }

      const vertical = new Float32Array(source.length);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          let sum = 0;
          for (let k = -radius; k <= radius; k += 1) {
            const sy = Math.min(height - 1, Math.max(0, y + k));
            sum += (horizontal[sy * width + x] as number) * (kernel[k + radius] as number);
          }
          vertical[y * width + x] = sum;
        }
      }

      writeChannel(data, vertical, channel);
    }
  }
}

/** Unsharp mask: out = src + amount × (src − blur). Amount 1 is strong without halos. */
export function unsharpMask(data: Uint8ClampedArray, width: number, height: number, amount: number): void {
  if (amount <= 0) return;
  const original = new Uint8ClampedArray(data);
  gaussianBlur(data, width, height, 1);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const src = original[i + c] as number;
      const blurred = data[i + c] as number;
      data[i + c] = clampByte(src + amount * (src - blurred));
    }
  }
}

export const FILTERS = [
  'none',
  'grayscale',
  'sepia',
  'vintage',
  'mono',
  'blur',
  'invert',
  'warm',
  'cool',
  'sharpen',
] as const;

export type FilterName = (typeof FILTERS)[number];

/** Filters are recipes over the primitives above, never bespoke pipelines. */
export function applyFilter(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  filter: FilterName,
  intensity = 100,
): void {
  if (filter === 'none' || intensity <= 0) return;
  const mix = Math.max(0, Math.min(1, intensity / 100));

  switch (filter) {
    case 'grayscale': {
      for (let i = 0; i < data.length; i += 4) {
        const y =
          0.2126 * (data[i] as number) + 0.7152 * (data[i + 1] as number) + 0.0722 * (data[i + 2] as number);
        data[i] = clampByte((data[i] as number) + (y - (data[i] as number)) * mix);
        data[i + 1] = clampByte((data[i + 1] as number) + (y - (data[i + 1] as number)) * mix);
        data[i + 2] = clampByte((data[i + 2] as number) + (y - (data[i + 2] as number)) * mix);
      }
      return;
    }
    case 'invert': {
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c += 1) {
          const v = data[i + c] as number;
          data[i + c] = clampByte(v + (255 - v - v) * mix);
        }
      }
      return;
    }
    case 'sepia': {
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] as number;
        const g = data[i + 1] as number;
        const b = data[i + 2] as number;
        const sr = 0.393 * r + 0.769 * g + 0.189 * b;
        const sg = 0.349 * r + 0.686 * g + 0.168 * b;
        const sb = 0.272 * r + 0.534 * g + 0.131 * b;
        data[i] = clampByte(r + (sr - r) * mix);
        data[i + 1] = clampByte(g + (sg - g) * mix);
        data[i + 2] = clampByte(b + (sb - b) * mix);
      }
      return;
    }
    case 'mono': {
      applyFilter(data, width, height, 'grayscale', 100);
      applyAdjustments(data, { contrast: 15 * mix, brightness: 5 * mix });
      return;
    }
    case 'vintage': {
      applyFilter(data, width, height, 'sepia', 60 * mix);
      applyAdjustments(data, { contrast: -8 * mix, temperature: 12 * mix });
      vignette(data, width, height, 0.15 * mix);
      return;
    }
    case 'warm': {
      applyAdjustments(data, { temperature: 18 * mix });
      return;
    }
    case 'cool': {
      applyAdjustments(data, { temperature: -18 * mix });
      return;
    }
    case 'blur': {
      if (mix > 0.5) gaussianBlur(data, width, height, 2);
      else gaussianBlur(data, width, height, 1);
      return;
    }
    case 'sharpen': {
      unsharpMask(data, width, height, 0.8 * mix);
      return;
    }
    default:
      return;
  }
}

function vignette(data: Uint8ClampedArray, width: number, height: number, strength: number): void {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxDistance = Math.hypot(cx, cy) || 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - cx, y - cy) / maxDistance;
      const factor = 1 - strength * distance * distance;
      const i = (y * width + x) * 4;
      data[i] = clampByte((data[i] as number) * factor);
      data[i + 1] = clampByte((data[i + 1] as number) * factor);
      data[i + 2] = clampByte((data[i + 2] as number) * factor);
    }
  }
}
