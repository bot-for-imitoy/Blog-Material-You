/**
 * admin-app.ts — The dedicated admin server.
 *
 * The admin console (`/admin/*`) and the admin JSON API (`/api/admin/*`) run on
 * their own port (`BMY_ADMIN_PORT`), separate from the public site. This makes
 * the deployment story explicit:
 *
 *   - the public site can be proxied under its own domain with the admin
 *     surface structurally absent — `createApp()` never answers on `/admin`
 *     or `/api/admin`, so there is no way to reach the console through it;
 *   - the admin port can sit behind its own domain, an SSH tunnel or a
 *     firewall that only admits trusted addresses;
 *   - when TLS material is configured (`BMY_ADMIN_TLS_CERT` / `BMY_ADMIN_TLS_KEY`)
 *     the port speaks HTTPS, and with `BMY_ADMIN_TLS_CA` it additionally
 *     requires a client certificate signed by that CA — mutual TLS. Without a
 *     client CA it is plain server-side TLS; without any TLS material it is
 *     plain HTTP (fine for localhost/SSH-tunnel use, warned about at boot).
 *
 * Static assets the admin pages reference (`/css`, `/js`, `/icon`, `/img`,
 * `/vendor`, plus `/avatars` and `/uploads` for previews) are served here too,
 * because the console may live on a different origin than the blog.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import {
  ADMIN_BODY_MB,
  ADMIN_TLS,
  AVATARS_DIR,
  COOKIE_SECURE,
  HOST,
  PUBLIC_DIR,
  TRUST_PROXY,
  UPLOADS_DIR,
} from './paths.ts';
import { securityHeaders, originGuard } from './app.ts';
import { createMediaRouter } from './routes/media.ts';

export interface AdminTlsStatus {
  /** True when the port speaks HTTPS. */
  enabled: boolean;
  /** True when client certificates are required and verified (mutual TLS). */
  mutual: boolean;
}

/** Read the configured TLS material, reporting what was actually found. */
function loadTlsOptions(): { options: https.ServerOptions; status: AdminTlsStatus } | null {
  if (!ADMIN_TLS.cert || !ADMIN_TLS.key) return null;

  const cert = fs.readFileSync(ADMIN_TLS.cert);
  const key = fs.readFileSync(ADMIN_TLS.key);
  const options: https.ServerOptions = { cert, key, minVersion: 'TLSv1.2' };

  if (ADMIN_TLS.ca) {
    // mTLS: require a client certificate chained to this CA. Node then rejects
    // any TLS handshake without one, before the request reaches Express.
    options.ca = fs.readFileSync(ADMIN_TLS.ca);
    options.requestCert = true;
    options.rejectUnauthorized = true;
    return { options, status: { enabled: true, mutual: true } };
  }

  return { options, status: { enabled: true, mutual: false } };
}

/** The Express application serving the admin console and its API. */
export async function createAdminApp(): Promise<Express> {
  const app = express();

  app.set('trust proxy', TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(originGuard);
  app.use(cookieParser());
  app.use(express.json({ limit: `${ADMIN_BODY_MB}mb` }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));

  // ===================== Static assets =====================
  //
  // The console is plain HTML + one stylesheet + one ES module, but previews
  // (friend avatars, post covers, uploads) can reference anything in the
  // public tree, so the same asset surfaces as the public app are mounted.
  const dayMs = 24 * 60 * 60 * 1000;
  const immutable = (maxAgeMs: number) => ({ maxAge: maxAgeMs, immutable: true });
  app.use('/vendor', express.static(path.join(PUBLIC_DIR, 'vendor'), immutable(30 * dayMs)));
  app.use('/css', express.static(path.join(PUBLIC_DIR, 'css'), immutable(7 * dayMs)));
  app.use('/js', express.static(path.join(PUBLIC_DIR, 'js'), immutable(7 * dayMs)));
  app.use('/icon', express.static(path.join(PUBLIC_DIR, 'icon'), immutable(30 * dayMs)));
  app.use('/img', express.static(path.join(PUBLIC_DIR, 'img'), immutable(7 * dayMs)));
  app.use('/avatars', express.static(AVATARS_DIR, { maxAge: 60 * 60 * 1000 }));
  app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: 60 * 60 * 1000 }));
  app.use('/media', createMediaRouter());

  // ===================== Admin API + pages =====================

  const { createAdminApiRouter } = await import('./routes/admin-api.ts');
  const { createAdminPagesRouter } = await import('./routes/admin-pages.ts');
  app.use('/api/admin', createAdminApiRouter());
  app.use('/admin', createAdminPagesRouter());

  app.get('/', (_req: Request, res: Response) => {
    res.redirect(302, '/admin/');
  });

  // ===================== 404 / errors =====================

  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ errno: -1, errmsg: `Not found: ${req.path}` });
      return;
    }
    res.redirect(302, '/admin/');
  });

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const type = (err as Error & { type?: string }).type;
    if (type === 'entity.parse.failed') {
      res.status(400).json({ errno: -1, errmsg: '请求体不是有效的 JSON' });
      return;
    }
    if (type === 'entity.too.large') {
      res.status(413).json({ errno: -1, errmsg: `请求体过大（上限 ${ADMIN_BODY_MB}MB）` });
      return;
    }
    console.error(`[admin] ${req.method} ${req.path}:`, err);
    if (req.path.startsWith('/api/')) {
      res.status(500).json({ errno: -1, errmsg: 'Internal error' });
      return;
    }
    res.status(500).type('html').send('<h1>500 Internal Server Error</h1>');
  });

  return app;
}

/**
 * Build the HTTP(S) server for the admin app.
 *
 * With a CA configured the TLS layer itself rejects any client that does not
 * present a certificate signed by that CA, so an unauthenticated peer never
 * even completes a handshake with the Express app.
 */
export function createAdminServer(app: Express): { server: http.Server; tls: AdminTlsStatus } {
  const tls = loadTlsOptions();
  if (tls) return { server: https.createServer(tls.options, app), tls: tls.status };
  return { server: http.createServer(app), tls: { enabled: false, mutual: false } };
}

/** One-line boot summary for the console log. */
export function describeAdminTls(tls: AdminTlsStatus): string {
  const parts: string[] = [];
  if (tls.enabled) parts.push(tls.mutual ? 'HTTPS + mTLS (client cert required)' : 'HTTPS');
  else parts.push('HTTP (no TLS configured — use an SSH tunnel, a firewall, or set BMY_ADMIN_TLS_CERT/KEY)');
  if (!COOKIE_SECURE) parts.push('cookies lack the Secure flag (set BMY_COOKIE_SECURE=1 for HTTPS deployments)');
  return parts.join('; ');
}

export { HOST };
