/**
 * media.ts — `GET /media`, the resizing endpoint.
 *
 * This is the only place the public internet can ask the server to do image
 * work, so the contract is deliberately narrow:
 *
 *   GET /media?src=/uploads/photo.jpg&w=800[&h=450][&fit=cover][&f=webp]
 *
 * `src` is a same-origin path, never a remote URL, and `w`/`h` are snapped up
 * to a fixed ladder by `mediaUrl()` on the way in and again here on the way
 * out. Everything else (quality, encoder settings) is fixed in src/media/
 * resize.ts. The result is cached on disk and served with an immutable,
 * long-lived `Cache-Control`, because the ETag changes whenever the source file
 * does — see the cache-key comment in resize.ts.
 */
import express, { type Router } from 'express';
import fs from 'node:fs';
import { MediaError, getImageVariant, isFit, isFormat, snapDimension } from '../media/resize.ts';

/** One year: the URL plus ETag fully identify the bytes. */
const IMMUTABLE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Map a failure to a status code. `unsupported` is a 415 rather than a 500 —
 * the request was well-formed, the file simply is not an image we can decode.
 */
function statusFor(code: MediaError['code']): number {
  switch (code) {
    case 'invalid-source':
      return 400;
    case 'not-found':
      return 404;
    case 'unsupported':
    default:
      return 415;
  }
}

/** Plain-text error body: this endpoint never returns HTML. */
function fail(res: express.Response, status: number, message: string): void {
  res.status(status).type('text/plain; charset=utf-8').send(message);
}

export function createMediaRouter(): Router {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const src = req.query.src;

    // At least one dimension is required. Serving the untouched original would
    // make `/media` a way to bypass the ladder entirely, so it is rejected.
    const width = snapDimension(req.query.w);
    const height = snapDimension(req.query.h);
    if (!width && !height) {
      fail(res, 400, 'Missing or invalid w/h');
      return;
    }

    const fit = isFit(req.query.fit) ? req.query.fit : undefined;
    const format = isFormat(req.query.f) ? req.query.f : undefined;

    try {
      const variant = await getImageVariant(src, { width: width ?? undefined, height: height ?? undefined, fit, format });

      res.set('Cache-Control', `public, max-age=${IMMUTABLE_SECONDS}, immutable`);
      res.type(variant.contentType);
      res.set('ETag', `"${variant.cacheKey}"`);
      res.set('X-Image-Cache', variant.cached ? 'hit' : 'miss');

      // The cache key already covers the source's mtime and size, so a matching
      // ETag really does mean the same bytes.
      if (req.headers['if-none-match']?.includes(variant.cacheKey)) {
        res.status(304).end();
        return;
      }

      // The file is streamed by hand rather than through `res.sendFile`: the
      // `send` module treats any path segment starting with a dot as hidden and
      // answers 404, which would break a perfectly ordinary deployment whose
      // data directory is something like `~/.blog/data`.
      res.set('Content-Length', String(variant.bytes));
      const stream = fs.createReadStream(variant.filePath);
      stream.on('error', (err) => {
        console.error('[media] cannot read cached variant:', err);
        // Headers are already on the wire, so the only honest ending is to cut
        // the response short — the browser sees an incomplete image.
        res.destroy();
      });
      // The reader may navigate away mid-download; stop reading the file.
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (err) {
      if (err instanceof MediaError) {
        fail(res, statusFor(err.code), err.message);
        return;
      }
      console.error('[media] unexpected failure:', err);
      fail(res, 500, 'Internal error');
    }
  });

  return router;
}
