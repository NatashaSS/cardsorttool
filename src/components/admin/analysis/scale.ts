// Pure helpers for the heat-maps (ANL-01/02): single-hue sequential scale and number formatting.

/** Lightest step (0 %): a faint blue tint, still distinguishable from a blank (null) cell. */
export const HEAT_LOW = "#e6eefc";
/** Darkest step (100 %): the `accent` token. */
export const HEAT_HIGH = "#2563eb";
/** Black (not the ink token) so every step meets WCAG AA 4.5:1 with one of the two text colours. */
const INK = "#000000";
const WHITE = "#ffffff";

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const v = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as RGB;
}

function rgbToHex(rgb: RGB): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.min(1, Math.max(0, t));
}

/** Sequential colour for a value in 0..1 (light → accent). Monotone in lightness. */
export function heatColor(t: number): string {
  const k = clamp01(t);
  const a = hexToRgb(HEAT_LOW);
  const b = hexToRgb(HEAT_HIGH);
  return rgbToHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k) as RGB);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text colour (ink or white) with the better contrast on heatColor(t). */
export function heatTextColor(t: number): string {
  const bg = heatColor(t);
  return contrastRatio(bg, WHITE) >= contrastRatio(bg, INK) ? WHITE : INK;
}

/** 0.456 → "46%"; null → "–". */
export function formatPct(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "–";
  return `${Math.round(ratio * 100)}%`;
}

/** Cell text without the % sign (the matrix caption says values are %); null → "". */
export function cellPct(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "";
  return String(Math.round(ratio * 100));
}
