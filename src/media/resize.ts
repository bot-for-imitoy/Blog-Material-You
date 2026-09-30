/**
 * resize.ts — on-demand image resizing with a disk cache.
 *
 * The site used to ship every image at its original resolution: the default
 * avatar alone is 445 kB, and a 4000 px photo in a post was sent in full to a
 * phone that then painted it into a 360 px column. This module is one half of
 * the fix — `mediaUrl()` and `mediaSrcset()` build `/media?…` URLs for the
 * templates and the Markdown renderer, and `GET /media` (src/routes/media.ts)
 * runs the source through sharp and serves the requested size.
 *
 * Three properties keep that safe to expose to the public internet:
 *
 *   1. **Only local files.** `src` must be a same-origin path under one of the
 *      `SOURCE_PREFIXES` directories. The decoded path is then resolved and
 *      checked against those directories, so neither `..` nor `%2e%2e` can
 *      reach anything else — the endpoint is not an SSRF proxy and cannot read
 *      outside the published asset tree.
 *   2. **A fixed size ladder.** Arbitrary widths would let a visitor mint
 *      unlimited cache entries. Widths and heights are snapped up to
 *      `SIZE_LADDER`, quality is fixed per format, and the format is one of
 *      four values — so the number of distinct variants per source is small.
 *   3. **A content-addressed cache.** The key includes the source's size and
 *      mtime, so replacing an image in place needs no manual invalidation: the
 *      URL stays the same but the ETag changes and the entry is re-rendered.
 *
 * Rendering is deduplicated — two concurrent requests for the same variant
 * produce one sharp run and both await it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { IMAGE_CACHE_DIR, PUBLIC_DIR, ensureDir } from '../paths.ts';

/* ==========================================================================
 * What may be resized
 * ======================================================================== */

/**
 * URL prefixes the endpoint will serve from. `vendor/` and `icon/` are
 * deliberately absent: vendored assets are versioned with the app and the SVG
 * icons are already tiny and resolution-independent.
 */
const SOURCE_PREFIXES = ['/uploads/', '/avatars/', '/img/'];

/** The same prefixes as absolute directories, for the containment check. */
const SOURCE_DIRS = SOURCE_PREFIXES.map((prefix) => path.join(PUBLIC_DIR, prefix.replace(/^\/|\/$/g, '')));

/**
 * Widths (and heights) the endpoint will actually produce. A request is snapped
 * *up* to the next entry, so a template may ask for a layout-derived number
 * without ever creating a one-off cache entry.
 */
export const SIZE_LADDER = [160, 240, 320, 480, 640, 800, 960, 1200, 1600, 2000];

/** Upper bound for a single dimension; anything larger is clamped. */
export const MAX_DIMENSION = 2560;

/** Refuse to decode absurd inputs (a decompression-bomb guard for sharp). */
const MAX_INPUT_PIXELS = 50_000_000;

/**
 * Content widths for images inside rendered Markdown. The largest entry is the
 * widest the article column ever gets, so the browser never has to upscale.
 */
export const CONTENT_WIDTHS = [320, 480, 640, 800, 960, 1200, 1600, 2000];

/**
 * The `sizes` hint that goes with `CONTENT_WIDTHS`. Below the drawer breakpoint
 * the container is the viewport; above it the drawer takes 360 px, so the
 * article column tops out around 760 px.
 */
export const CONTENT_SIZES = '(max-width: 900px) calc(100vw - 32px), 760px';

/* ==========================================================================
 * Formats
 * ======================================================================== */

export type ImageFormat = 'webp' | 'avif' | 'jpeg' | 'png';
export type Fit = 'cover' | 'contain' | 'inside';

const DEFAULT_FORMAT: ImageFormat = 'webp';
const FORMATS: readonly ImageFormat[] = ['webp', 'avif', 'jpeg', 'png'];
const FITS: readonly Fit[] = ['cover', 'contain', 'inside'];

/**
 * Fixed quality per format. Keeping this out of the URL is deliberate: a
 * caller-tunable quality would multiply the cache keyspace for no benefit.
 */
const QUALITY: Record<ImageFormat, number> = { webp: 80, avif: 62, jpeg: 82, png: 80 };

const CONTENT_TYPE: Record<ImageFormat, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** File extension of a cached variant; also its identity on disk. */
const EXTENSION: Record<ImageFormat, string> = { webp: 'webp', avif: 'avif', jpeg: 'jpg', png: 'png' };

/* ==========================================================================
 * Helpers shared with the templates
 * ======================================================================== */

function normaliseSrc(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Whether a URL points at a local file this endpoint may resize.
 *
 * Pure string inspection — no filesystem access — because it runs for every
 * image in a template. Remote URLs, `data:` URIs and protocol-relative URLs
 * come back false, and `mediaUrl` then returns them unchanged, so a template
 * can pass any image through it without branching.
 */
export function isResizableImage(src: unknown): boolean {
  const value = normaliseSrc(src);
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  const clean = value.split('?')[0].split('#')[0];
  return SOURCE_PREFIXES.some((prefix) => clean.startsWith(prefix));
}

/** Snap a dimension up to the ladder, clamped to the maximum. */
export function snapDimension(value: unknown): number | null {
  const raw = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (raw >= MAX_DIMENSION) return MAX_DIMENSION;
  return SIZE_LADDER.find((step) => step >= raw) ?? MAX_DIMENSION;
}

export interface MediaOptions {
  /** Target width in CSS pixels; snapped up to the ladder. */
  width?: number;
  /** Target height; only meaningful together with an explicit `fit`. */
  height?: number;
  fit?: Fit;
  format?: ImageFormat;
}

/** Whether a value is one of the accepted fits. */
export function isFit(value: unknown): value is Fit {
  return typeof value === 'string' && FITS.includes(value as Fit);
}

/** Whether a value is one of the accepted formats. */
export function isFormat(value: unknown): value is ImageFormat {
  return typeof value === 'string' && FORMATS.includes(value as ImageFormat);
}

/**
 * Build the `/media` URL for one image.
 *
 * A source that cannot be resized (remote, `data:`, an icon) is returned
 * verbatim, so callers never need to branch. Parameters are emitted in a fixed
 * order and only when they differ from the defaults, which keeps URLs stable
 * and therefore cacheable by the browser.
 */
export function mediaUrl(src: unknown, options: MediaOptions = {}): string {
  const value = normaliseSrc(src);
  if (!value || !isResizableImage(value)) return value;

  const parts = [`src=${encodeURIComponent(value)}`];
  const width = snapDimension(options.width);
  if (width) parts.push(`w=${width}`);
  const height = snapDimension(options.height);
  if (height) parts.push(`h=${height}`);
  if (options.fit) parts.push(`fit=${options.fit}`);
  if (options.format && options.format !== DEFAULT_FORMAT) parts.push(`f=${options.format}`);
  return `/media?${parts.join('&')}`;
}

/**
 * Build a `srcset` for an image, one candidate per ladder width.
 *
 * When `options.height` is given the aspect ratio implied by `width: height` is
 * preserved across the candidates, which is what a fixed crop box needs.
 * Returns an empty string when the image is not resizable, so a template can
 * write `<%= mediaSrcset(...) %>` unconditionally.
 */
export function mediaSrcset(
  src: unknown,
  widths: readonly number[] = CONTENT_WIDTHS,
  options: MediaOptions = {},
): string {
  const value = normaliseSrc(src);
  if (!value || !isResizableImage(value)) return '';

  const baseWidth = snapDimension(options.width);
  const baseHeight = snapDimension(options.height);

  const candidates: string[] = [];
  const seen = new Set<number>();
  for (const requested of widths) {
    const width = snapDimension(requested);
    if (!width || seen.has(width)) continue;
    seen.add(width);
    const height = baseWidth && baseHeight ? Math.round((baseHeight * width) / baseWidth) : undefined;
    candidates.push(`${mediaUrl(value, { ...options, width, height })} ${width}w`);
  }
  return candidates.join(', ');
}

/* ==========================================================================
 * Source resolution
 * ======================================================================== */

/** Why a variant could not be produced, so the route can pick a status code. */
export type MediaErrorCode = 'invalid-source' | 'not-found' | 'unsupported';

export class MediaError extends Error {
  code: MediaErrorCode;

  constructor(code: MediaErrorCode, message: string) {
    super(message);
    this.name = 'MediaError';
    this.code = code;
  }
}

/**
 * Map a `/media?src=` value to an absolute path, or throw.
 *
 * The prefix test runs on the raw string and the containment test on the
 * decoded, resolved path, so percent-encoded traversal is caught by the second
 * check even when it slips past the first.
 */
function resolveSource(src: unknown): string {
  const value = normaliseSrc(src);
  if (!value.startsWith('/') || value.startsWith('//')) {
    throw new MediaError('invalid-source', 'src must be a local path');
  }
  const clean = value.split('?')[0].split('#')[0];
  if (!SOURCE_PREFIXES.some((prefix) => clean.startsWith(prefix))) {
    throw new MediaError('invalid-source', 'src is outside the resizable directories');
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    throw new MediaError('invalid-source', 'src is not valid percent-encoding');
  }
  if (decoded.includes('\0')) throw new MediaError('invalid-source', 'src contains a null byte');

  const absolute = path.resolve(PUBLIC_DIR, decoded.replace(/^\/+/, ''));
  const allowed = SOURCE_DIRS.some((dir) =>
    absolute.startsWith(dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`),
  );
  if (!allowed) throw new MediaError('invalid-source', 'src escapes the asset directories');
  return absolute;
}

/** Stat a resolved source, reporting a missing file as `not-found`. */
function statSource(absolute: string): fs.Stats {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolute);
  } catch {
    throw new MediaError('not-found', 'source image does not exist');
  }
  if (!stat.isFile()) throw new MediaError('not-found', 'source is not a file');
  return stat;
}

/* ==========================================================================
 * Rendering
 * ======================================================================== */

export interface ImageVariant {
  /** Absolute path of the cached file. */
  filePath: string;
  contentType: string;
  /** Stable identity of this variant, used as the ETag. */
  cacheKey: string;
  bytes: number;
  /** Whether the file was already on disk when the request arrived. */
  cached: boolean;
}

/**
 * Cache key. The source's size and mtime are part of the hash, so an image
 * edited in place produces a new key: the URL does not change, but the ETag
 * does, and neither the browser nor this cache can serve a stale crop.
 */
function cacheKeyFor(
  absolute: string,
  stat: fs.Stats,
  width: number | null,
  height: number | null,
  fit: Fit,
  format: ImageFormat,
): string {
  return createHash('sha256')
    .update([absolute, stat.size, Math.round(stat.mtimeMs), width ?? '', height ?? '', fit, format].join('|'))
    .digest('hex')
    .slice(0, 40);
}

/** Determine the effective fit: an explicit box crops, a bare width does not. */
function effectiveFit(fit: unknown, width: number | null, height: number | null): Fit {
  if (isFit(fit)) return fit;
  return width && height ? 'cover' : 'inside';
}

/**
 * Attach the encoder. JPEG and WebP here flatten transparency onto white: a
 * transparent PNG encoded to a format without an alpha channel otherwise comes
 * out with black fringes.
 */
function encode(pipeline: sharp.Sharp, format: ImageFormat): sharp.Sharp {
  switch (format) {
    case 'avif':
      return pipeline.flatten({ background: '#ffffff' }).avif({ quality: QUALITY.avif, effort: 4 });
    case 'jpeg':
      return pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: QUALITY.jpeg, progressive: true, mozjpeg: true });
    case 'png':
      return pipeline.png({ quality: QUALITY.png, compressionLevel: 9, palette: true });
    case 'webp':
    default:
      return pipeline.flatten({ background: '#ffffff' }).webp({ quality: QUALITY.webp, effort: 4 });
  }
}

/** Promises for variants currently being rendered, keyed by cache key. */
const inFlight = new Map<string, Promise<ImageVariant>>();

/**
 * Record that a cached variant was just used, so TTL pruning does not delete an
 * image that is still being served. Best effort: a read-only cache directory
 * only costs us an early re-render later.
 */
function touch(filePath: string): void {
  const now = new Date();
  try {
    fs.utimesSync(filePath, now, now);
  } catch {
    /* read-only cache: pruning will simply be less precise */
  }
}

/** Read back the produced file's size and build the variant record. */
function finish(filePath: string, format: ImageFormat, cacheKey: string, cached: boolean): ImageVariant {
  const stat = fs.statSync(filePath);
  return { filePath, contentType: CONTENT_TYPE[format], cacheKey, bytes: stat.size, cached: cached };
}

/* ==========================================================================
 * Concurrency
 * ======================================================================== */

/**
 * How many sharp jobs may run at once.
 *
 * The size ladder bounds the cache *keyspace*, but it does not bound how much
 * work a visitor can ask for: a first request for a large photo in each of its
 * variants would otherwise start that many decodes in parallel and saturate
 * every core. libvips already threads internally, so a small number of
 * concurrent jobs is also the fastest setting — the rest queue.
 */
const MAX_CONCURRENT_RENDERS = 3;

let activeRenders = 0;
const renderQueue: Array<() => void> = [];

/** Wait for a render slot. Resolves to a function that releases it. */
function acquireSlot(): Promise<() => void> {
  const release = () => {
    activeRenders -= 1;
    const next = renderQueue.shift();
    if (next) next();
  };

  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders += 1;
    return Promise.resolve(release);
  }
  return new Promise((resolve) => {
    renderQueue.push(() => {
      activeRenders += 1;
      resolve(release);
    });
  });
}

/**
 * Produce (or reuse) one image variant. Dimensions are snapped here as well as
 * in `mediaUrl`, so calling this directly is safe.
 */
export async function getImageVariant(src: unknown, options: MediaOptions = {}): Promise<ImageVariant> {
  const absolute = resolveSource(src);
  const stat = statSource(absolute);

  const width = snapDimension(options.width);
  const height = snapDimension(options.height);
  const format = isFormat(options.format) ? options.format : DEFAULT_FORMAT;
  const fit = effectiveFit(options.fit, width, height);

  const cacheKey = cacheKeyFor(absolute, stat, width, height, fit, format);
  const filePath = path.join(IMAGE_CACHE_DIR, `${cacheKey}.${EXTENSION[format]}`);

  if (fs.existsSync(filePath)) {
    touch(filePath);
    return finish(filePath, format, cacheKey, true);
  }

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const job = (async (): Promise<ImageVariant> => {
    // Held only around the decode/encode, never around the wait for an
    // in-flight sibling above — that would deadlock the queue.
    const release = await acquireSlot();
    const resize: sharp.ResizeOptions = { fit, withoutEnlargement: true };
    if (fit === 'cover' || fit === 'contain') resize.position = 'centre';

    const pipeline = sharp(absolute, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' });
    if (width || height) pipeline.resize(width ?? null, height ?? null, resize);

    ensureDir(IMAGE_CACHE_DIR);
    // Write to a sibling temp file and rename: the rename is atomic within one
    // filesystem, so a concurrent reader never sees a half-written image.
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await encode(pipeline, format).toFile(temp);
      fs.renameSync(temp, filePath);
    } catch (err) {
      fs.rmSync(temp, { force: true });
      const reason = err instanceof Error ? err.message : String(err);
      throw new MediaError('unsupported', `cannot decode image: ${reason}`);
    } finally {
      release();
    }

    schedulePrune();
    return finish(filePath, format, cacheKey, false);
  })();

  inFlight.set(cacheKey, job);
  try {
    return await job;
  } finally {
    inFlight.delete(cacheKey);
  }
}

/* ==========================================================================
 * Cache housekeeping
 * ======================================================================== */

/** How long an unused variant stays on disk. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** At most one sweep per interval, so a busy page cannot trigger a scan each. */
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;

let lastPrune = 0;
let pruning = false;

/**
 * Delete variants that have not been served for `CACHE_TTL_MS`. Correctness
 * depends on `touch()` refreshing the mtime of every cache hit, which is why
 * the two live next to each other.
 */
function schedulePrune(): void {
  if (pruning || Date.now() - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = Date.now();
  pruning = true;
  const timer = setTimeout(() => {
    try {
      const cutoff = Date.now() - CACHE_TTL_MS;
      for (const name of fs.readdirSync(IMAGE_CACHE_DIR)) {
        const file = path.join(IMAGE_CACHE_DIR, name);
        try {
          if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
        } catch {
          /* a file removed under us is already the desired end state */
        }
      }
    } catch {
      /* the cache directory may not exist yet */
    } finally {
      pruning = false;
    }
  }, 1000);
  timer.unref();
}

/** Statistics for the admin console and for debugging. */
export function imageCacheStats(): { dir: string; files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  try {
    for (const name of fs.readdirSync(IMAGE_CACHE_DIR)) {
      try {
        const stat = fs.statSync(path.join(IMAGE_CACHE_DIR, name));
        if (stat.isFile()) {
          files += 1;
          bytes += stat.size;
        }
      } catch {
        /* ignore entries that vanished mid-scan */
      }
    }
  } catch {
    /* directory not created yet */
  }
  return { dir: IMAGE_CACHE_DIR, files, bytes };
}
