/**
 * app.ts — Express application wiring.
 *
 * Single process, single port: the admin console lives under `/admin` and
 * `/api/admin` instead of the original second nginx server on port 31000. That
 * also removes the original's cross-origin CORS complications.
 *
 * Security posture (see README):
 *  - strict CSP with no inline scripts and no third-party CDN;
 *  - all admin pages and admin APIs are authentication-gated (the original
 *    `/api/admin/ssr/*` fragment endpoints were completely unauthenticated);
 *  - an Origin check guards every state-changing request (the original had none
 *    and relied solely on a SameSite cookie);
 *  - rate limits on login, setup, comments, visitor auth and uploads.
 */
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { AVATARS_DIR, HOST, MAX_UPLOAD_MB, PUBLIC_DIR, TRUST_PROXY, UPLOADS_DIR } from './paths.ts';
import { createPublicApiRouter } from './routes/public-api.ts';
import { createPublicPagesRouter } from './routes/public-pages.ts';
import { createMediaRouter } from './routes/media.ts';
import { getSiteSettings } from './site-config.ts';

/**
 * Origins the profile page's music panel needs.
 *
 * The CSP is `default-src 'self'`, which also covers `frame-src` and `media-src`
 * — so a NetEase embed or a remote audio file would be blocked. Rather than
 * loosening those directives globally, only the origins actually configured in
 * `_config.yml` are allowed, and only for the two directives that need them.
 */
function musicOrigins(): { frames: string[]; media: string[] } {
  const { profile } = getSiteSettings();
  const originOf = (value: string): string | null => {
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
    } catch {
      return null;
    }
  };
  const embed = originOf(profile.music.embed);
  const audio = originOf(profile.music.audio);
  return { frames: embed ? [embed] : [], media: audio ? [audio] : [] };
}

/** Headers applied to every response. Shared with the profile-only app. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  const { frames, media } = musicOrigins();
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      // mdui sets inline style attributes at runtime, so style attributes must
      // stay allowed; scripts deliberately do not get 'unsafe-inline'.
      "style-src 'self' 'unsafe-inline'",
      // `https:` covers remote avatars and the profile page's background photo.
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      `frame-src 'self'${frames.length > 0 ? ` ${frames.join(' ')}` : ''}`,
      `media-src 'self'${media.length > 0 ? ` ${media.join(' ')}` : ''}`,
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
}

/**
 * Reject cross-origin state-changing requests.
 * SameSite=Strict already blocks cookie-bearing cross-site requests, but an
 * explicit Origin check also protects the Bearer-token path.
 */
function originGuard(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  const origin = req.get('origin');
  if (!origin) {
    // Same-origin form posts and non-browser clients send no Origin header.
    next();
    return;
  }
  try {
    const host = req.get('host');
    const originHost = new URL(origin).host;
    if (originHost === host) {
      next();
      return;
    }
  } catch {
    /* malformed Origin falls through to rejection */
  }
  res.status(403).json({ errno: -1, errmsg: 'Cross-origin request rejected' });
}

/** Cache policy: hashed/vendored assets are immutable, HTML is never cached. */
function staticOptions(maxAgeMs: number, immutable: boolean) {
  return {
    maxAge: maxAgeMs,
    immutable,
    setHeaders(res: Response, filePath: string) {
      if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-cache');
    },
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AppOptions {
  /** Skip mounting the admin console (useful for tests / public-only runs). */
  publicOnly?: boolean;
  /**
   * Skip mounting the SSR public pages (the static build and the API-only
   * server, `npm run serve:api`). Static assets, /media, /api and /admin stay
   * mounted so the API server remains a complete backend for a statically
   * deployed site.
   */
  skipPublicPages?: boolean;
}

export async function createApp(options: AppOptions = {}): Promise<Express> {
  const app = express();

  // nginx used to sit in front; behind a reverse proxy we must trust
  // X-Forwarded-For so rate limiting keys on the real client address.
  app.set('trust proxy', TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(originGuard);
  app.use(cookieParser());
  app.use(express.json({ limit: `${MAX_UPLOAD_MB}mb` }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));

  // ===================== Static assets =====================

  // Vendored libraries (mdui, KaTeX, highlight.js) are versioned together with
  // the app, so they can be cached aggressively.
  app.use('/vendor', express.static(path.join(PUBLIC_DIR, 'vendor'), staticOptions(30 * DAY_MS, true)));
  app.use('/css', express.static(path.join(PUBLIC_DIR, 'css'), staticOptions(7 * DAY_MS, true)));
  app.use('/js', express.static(path.join(PUBLIC_DIR, 'js'), staticOptions(7 * DAY_MS, true)));
  app.use('/icon', express.static(path.join(PUBLIC_DIR, 'icon'), staticOptions(30 * DAY_MS, true)));
  app.use('/img', express.static(path.join(PUBLIC_DIR, 'img'), staticOptions(7 * DAY_MS, true)));
  // Uploads change over time, so cache briefly (matches the original's 1 hour).
  app.use('/avatars', express.static(AVATARS_DIR, staticOptions(60 * 60 * 1000, false)));
  app.use('/uploads', express.static(UPLOADS_DIR, staticOptions(60 * 60 * 1000, false)));

  // Resized copies of the images above, rendered on demand and cached on disk.
  // Mounted after the static handlers so the original files keep working; the
  // endpoint itself only ever reads from those directories.
  app.use('/media', createMediaRouter());

  // ===================== APIs =====================

  if (!options.publicOnly) {
    try {
      const { createAdminApiRouter } = await import('./routes/admin-api.ts');
      app.use('/api/admin', createAdminApiRouter());
    } catch (err) {
      console.warn('[app] admin API not mounted:', (err as Error).message);
    }
  }

  app.use('/api', createPublicApiRouter());

  // ===================== Admin console =====================

  if (!options.publicOnly) {
    try {
      const { createAdminPagesRouter } = await import('./routes/admin-pages.ts');
      app.use('/admin', createAdminPagesRouter());
    } catch (err) {
      console.warn('[app] admin console not mounted:', (err as Error).message);
    }
  }

  // ===================== Public pages =====================

  if (!options.skipPublicPages) {
    app.use('/', createPublicPagesRouter());
  }

  // ===================== 404 / errors =====================

  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ errno: -1, errmsg: `Not found: ${req.path}` });
      return;
    }
    res
      .status(404)
      .type('html')
      .send(
        `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
          `<meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<title>404</title><link rel="stylesheet" href="/vendor/mdui/mdui.css">` +
          `</head><body class="mdui-theme-auto"><div style="padding:48px;text-align:center">` +
          `<h1>404</h1><p>页面未找到</p><mdui-button href="/">返回首页</mdui-button></div></body></html>`,
      );
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    // body-parser rejects malformed payloads before any route runs, so these
    // have to be translated here — otherwise a corrupt backup upload would be
    // reported as a 500 instead of a validation error.
    const type = (err as Error & { type?: string }).type;
    if (type === 'entity.parse.failed') {
      res.status(400).json({ errno: -1, errmsg: '请求体不是有效的 JSON' });
      return;
    }
    if (type === 'entity.too.large') {
      res.status(413).json({ errno: -1, errmsg: `请求体过大（上限 ${MAX_UPLOAD_MB}MB）` });
      return;
    }

    console.error(`[error] ${req.method} ${req.path}:`, err);
    if (req.path.startsWith('/api/')) {
      res.status(500).json({ errno: -1, errmsg: 'Internal error' });
      return;
    }
    // Path segments are redacted so absolute filesystem paths never leak.
    const safe = (err.message || 'Internal error').replace(/\/[\w\-./]+/g, '[path]');
    res.status(500).type('html').send(`<h1>500 Internal Server Error</h1><p>${safe}</p>`);
  });

  return app;
}

export { HOST };
