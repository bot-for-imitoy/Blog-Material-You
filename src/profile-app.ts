/**
 * profile-app.ts — The standalone personal card server.
 *
 * `/profile/` no longer shares the blog's port: this small Express app serves
 * the card (plus exactly the static assets it needs) on its own port
 * (`BMY_PROFILE_PORT`, default 31000), so it can be published behind its own
 * domain or path — a reverse proxy points one host at the blog and another at
 * this app — without dragging the blog along.
 *
 * Deliberately minimal: no cookies, no JSON body parsing, no admin surface,
 * no APIs except a liveness probe. It reuses the blog's security headers, the
 * on-demand image resizer and the shared site configuration, so the card keeps
 * re-theming itself when `theme.color` changes in `_config.yml`.
 */
import path from 'node:path';
import express, { type Express, type Request, type Response } from 'express';
import { AVATARS_DIR, HOST, PROFILE_PORT, PUBLIC_DIR, TRUST_PROXY, UPLOADS_DIR } from './paths.ts';
import { securityHeaders } from './app.ts';
import { createMediaRouter } from './routes/media.ts';
import { sendProfilePage } from './profile-page.ts';
import { VERSION } from './version.ts';

export async function createProfileApp(): Promise<Express> {
  const app = express();

  app.set('trust proxy', TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(securityHeaders);

  // ===================== Static assets =====================
  // Only what the card actually references: its stylesheet, images (avatar,
  // optional background photo) and the resized variants rendered by /media.

  app.use('/css', express.static(path.join(PUBLIC_DIR, 'css'), { maxAge: 7 * 24 * 60 * 60 * 1000, immutable: true }));
  app.use('/img', express.static(path.join(PUBLIC_DIR, 'img'), { maxAge: 7 * 24 * 60 * 60 * 1000, immutable: true }));
  app.use('/icon', express.static(path.join(PUBLIC_DIR, 'icon'), { maxAge: 30 * 24 * 60 * 60 * 1000, immutable: true }));
  app.use('/avatars', express.static(AVATARS_DIR, { maxAge: 60 * 60 * 1000 }));
  app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: 60 * 60 * 1000 }));
  app.use('/media', createMediaRouter());

  // ===================== Liveness =====================

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', server: 'nodejs', version: VERSION });
  });

  // ===================== The card =====================

  // The card is the site: `/` and `/profile/` render the same document, so the
  // port works both as a bare host (profile.example.com) and behind a path.
  const render = (req: Request, res: Response, next: express.NextFunction): void => {
    sendProfilePage(res, { currentPath: req.path })
      .then((sent) => {
        if (!sent) {
          // `profile.enabled: false` in _config.yml — the card is switched off.
          res.status(404).type('html').send('<h1>404</h1><p>Page not found</p>');
        }
      })
      .catch(next);
  };
  app.get('/', render);
  app.get('/profile', render);

  // ===================== 404 =====================

  app.use((req: Request, res: Response) => {
    res.status(404).type('html').send('<h1>404</h1><p>Page not found</p>');
  });

  return app;
}

export { HOST, PROFILE_PORT };
