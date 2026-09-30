/**
 * color-scheme.ts — Material You colour schemes, generated on the server.
 *
 * mdui's `setColorScheme()` builds a palette in the browser and injects a
 * `<style>` element plus a class. Doing the same thing here has three
 * advantages:
 *
 *   1. The correct palette is present in the first paint — no flash of mdui's
 *      default purple, and no dependency on JavaScript at all.
 *   2. The same seed can theme things that do not load mdui (the plain-HTML
 *      admin console, the standalone profile card).
 *   3. A bad value is caught on the server and reported, instead of failing
 *      silently in the browser.
 *
 * That last point matters: `setColorScheme` is documented as taking **a
 * hexadecimal colour**. Feeding it anything else is not a graceful no-op —
 * `argbFromHex('rgb(1,2,3)')` throws outright, and `argbFromHex('tomato')`
 * quietly returns opaque black, which repaints the whole site in greys derived
 * from black. So the seed is validated and normalised here, and only a hex
 * value ever reaches the palette generator.
 *
 * The generated CSS mirrors mdui's own `internal/colorScheme.js` so the two
 * produce identical variables.
 */
import {
  CorePalette,
  Scheme,
  argbFromHex,
  blueFromArgb,
  greenFromArgb,
  redFromArgb,
} from '@material/material-color-utilities';

/** mdui's default palette seed, used when the configured colour is unusable. */
export const FALLBACK_SEED = '#ff006a';

/** `#rgb`, `#rrggbb` and `#rrggbbaa`, with or without the leading `#`. */
const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isHexColor(value: string): boolean {
  return HEX_PATTERN.test(value.trim());
}

/**
 * Expand any accepted hex form to `#rrggbb`, or return null.
 * The 8-digit form's alpha is dropped: mdui's palette is generated from an
 * opaque ARGB source, so an alpha channel could not be honoured anyway.
 */
export function normaliseHex(value: string): string | null {
  const match = value.trim().match(HEX_PATTERN);
  if (!match) return null;
  let hex = match[1]!.toLowerCase();
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length === 8) hex = hex.slice(0, 6);
  return `#${hex}`;
}

/** `#rrggbb` → `"r, g, b"`, for use inside `rgb()` / `rgba()`. */
export function hexToRgbTriple(hex: string): string {
  const normalised = normaliseHex(hex) ?? FALLBACK_SEED;
  const value = normalised.slice(1);
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/** `primaryContainer` → `primary-container`, `surfaceTintColor` → `surface-tint-color`. */
function toKebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function rgbFromArgb(argb: number): string {
  return [redFromArgb(argb), greenFromArgb(argb), blueFromArgb(argb)].join(', ');
}

export interface ColorScheme {
  /** Normalised `#rrggbb` actually used. */
  seed: string;
  /** Class to place on the element the scheme applies to. */
  className: string;
  /** The full CSS rule set, ready to drop into a `<style>` element. */
  css: string;
}

const cache = new Map<string, ColorScheme>();

/**
 * Build the colour scheme for a seed colour.
 *
 * Always resolves: an unusable seed falls back to `FALLBACK_SEED` so the site
 * keeps a coherent palette rather than rendering mdui's defaults.
 */
export function buildColorScheme(rawSeed: string): ColorScheme {
  const seed = normaliseHex(rawSeed) ?? FALLBACK_SEED;
  const cached = cache.get(seed);
  if (cached) return cached;

  const source = argbFromHex(seed);
  const schemes: Record<'light' | 'dark', Record<string, number>> = {
    light: Scheme.light(source).toJSON() as unknown as Record<string, number>,
    dark: Scheme.dark(source).toJSON() as unknown as Record<string, number>,
  };

  // mdui fills in the surface roles the upstream library does not emit as
  // scheme entries. Mirrored here so the two outputs stay identical.
  const palette = CorePalette.of(source);
  Object.assign(schemes.light, {
    'surface-dim': palette.n1.tone(87),
    'surface-bright': palette.n1.tone(98),
    'surface-container-lowest': palette.n1.tone(100),
    'surface-container-low': palette.n1.tone(96),
    'surface-container': palette.n1.tone(94),
    'surface-container-high': palette.n1.tone(92),
    'surface-container-highest': palette.n1.tone(90),
    'surface-tint-color': schemes.light.primary,
  });
  Object.assign(schemes.dark, {
    'surface-dim': palette.n1.tone(6),
    'surface-bright': palette.n1.tone(24),
    'surface-container-lowest': palette.n1.tone(4),
    'surface-container-low': palette.n1.tone(10),
    'surface-container': palette.n1.tone(12),
    'surface-container-high': palette.n1.tone(17),
    'surface-container-highest': palette.n1.tone(22),
    'surface-tint-color': schemes.dark.primary,
  });

  const entries = (theme: 'light' | 'dark', render: (token: string, rgb: string) => string) =>
    Object.entries(schemes[theme])
      .map(([key, value]) => render(toKebabCase(key), rgbFromArgb(value)))
      .join('');

  const className = `mdui-custom-color-scheme-${source}`;

  // This mirrors mdui's generated CSS exactly: one rule carrying both palettes,
  // then the dark overrides for `.mdui-theme-dark` and for `.mdui-theme-auto`
  // under a dark `prefers-color-scheme`.
  const css = `.${className} {
  ${entries('light', (token, rgb) => `--mdui-color-${token}-light: ${rgb};`)}
  ${entries('dark', (token, rgb) => `--mdui-color-${token}-dark: ${rgb};`)}
  ${entries('light', (token) => `--mdui-color-${token}: var(--mdui-color-${token}-light);`)}

  color: rgb(var(--mdui-color-on-background));
  background-color: rgb(var(--mdui-color-background));
}

.mdui-theme-dark .${className},
.mdui-theme-dark.${className} {
  ${entries('dark', (token) => `--mdui-color-${token}: var(--mdui-color-${token}-dark);`)}
}

@media (prefers-color-scheme: dark) {
  .mdui-theme-auto .${className},
  .mdui-theme-auto.${className} {
    ${entries('dark', (token) => `--mdui-color-${token}: var(--mdui-color-${token}-dark);`)}
  }
}`;

  const scheme: ColorScheme = { seed, className, css };
  cache.set(seed, scheme);
  return scheme;
}
