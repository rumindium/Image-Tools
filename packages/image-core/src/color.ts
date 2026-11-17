/** Colour conversions shared by the palette tool, the pixel picker and the pixel tests. */

export type RGB = { r: number; g: number; b: number };
export type HSL = { h: number; s: number; l: number };

export function hexToRgb(hex: string): RGB | null {
  // Six digits with the hash, as the docs print them; anything else is a typo, not a colour.
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = match[1] as string;
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const part = (v: number): string =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: Number((l * 100).toFixed(1)) };
  }

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;

  h *= 60;
  if (h < 0) h += 360;
  return { h: Number(h.toFixed(1)), s: Number((s * 100).toFixed(1)), l: Number((l * 100).toFixed(1)) };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const hn = ((h % 360) + 360) % 360;
  const sn = Math.min(100, Math.max(0, s)) / 100;
  const ln = Math.min(100, Math.max(0, l)) / 100;

  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;

  let rgb: [number, number, number];
  if (hn < 60) rgb = [c, x, 0];
  else if (hn < 120) rgb = [x, c, 0];
  else if (hn < 180) rgb = [0, c, x];
  else if (hn < 240) rgb = [0, x, c];
  else if (hn < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

const toLinear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance (docs/09-COLOR-TOOLS.md §2.6). */
export function relativeLuminance({ r, g, b }: RGB): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return Number(((light + 0.05) / (dark + 0.05)).toFixed(2));
}

/** sRGB → CIE Lab (D65). */
export function rgbToLab({ r, g, b }: RGB): { L: number; a: number; b: number } {
  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);

  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;

  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 — the cheap distance, used for clustering and dedupe thresholds. */
export function deltaE76(a: RGB, b: RGB): number {
  const la = rgbToLab(a);
  const lb = rgbToLab(b);
  return Math.hypot(la.L - lb.L, la.a - lb.a, la.b - lb.b);
}

const RAD = Math.PI / 180;

/**
 * CIEDE2000 — the tolerance in docs/0-TESTING.md §5.2. Implemented from the standard
 * formulation; verified against the Sharma et al. reference pairs in color.test.ts.
 */
export function deltaE2000(a: RGB, b: RGB): number {
  const lab1 = rgbToLab(a);
  const lab2 = rgbToLab(b);

  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;

  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));

  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);

  const h1p = c1p === 0 ? 0 : (Math.atan2(b1, a1p) / RAD + 360) % 360;
  const h2p = c2p === 0 ? 0 : (Math.atan2(b2, a2p) / RAD + 360) % 360;

  const dLp = L2 - L1;
  const dCp = c2p - c1p;
  const dhp = (() => {
    if (c1p * c2p === 0) return 0;
    const diff = h2p - h1p;
    if (Math.abs(diff) <= 180) return diff;
    return diff > 180 ? diff - 360 : diff + 360;
  })();
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp / 2) * RAD);

  const lBarP = (L1 + L2) / 2;
  const cBarP = (c1p + c2p) / 2;
  const hBarP = (() => {
    if (c1p * c2p === 0) return h1p + h2p;
    if (Math.abs(h1p - h2p) <= 180) return (h1p + h2p) / 2;
    return h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  })();

  const t =
    1 -
    0.17 * Math.cos((hBarP - 30) * RAD) +
    0.24 * Math.cos(2 * hBarP * RAD) +
    0.32 * Math.cos((3 * hBarP + 6) * RAD) -
    0.2 * Math.cos((4 * hBarP - 63) * RAD);

  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin(2 * dTheta * RAD) * rc;

  const termL = dLp / sl;
  const termC = dCp / sc;
  const termH = dHp / sh;

  return Math.sqrt(termL ** 2 + termC ** 2 + termH ** 2 + rt * termC * termH);
}

/** White or near-black for maximum contrast on a background. */
export function foregroundFor(background: RGB): string {
  return contrastRatio(background, { r: 255, g: 255, b: 255 }) >= 4.5 ? '#ffffff' : '#15181d';
}
