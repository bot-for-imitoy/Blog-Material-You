/**
 * api-server.ts — API-only server entry point (`npm run serve:api`).
 *
 * Companion to the static build (`npm run build`): the HTML pages are served
 * from `blog/dist/` by any static host, while this process provides the
 * dynamic surface behind the same domain (via a reverse proxy):
 *
 *   /api/*    public + admin JSON APIs
 *   /admin/*  the admin console
 *   /media    on-demand image resizing (pages reference /media?src=… URLs)
 *   /static   assets: /css /js /icon /img /vendor, plus /avatars /uploads
 *
 * No SSR pages are mounted — a page request falls through to a 404, because
 * pages are expected to come from the static output.
 *
 * When `_config.yml` changes through the admin API, the static site is rebuilt
 * automatically (debounced) so `blog/dist/` never goes stale — disable with
 * `BMY_AUTO_BUILD=0`.
 */
import 'dotenv/config';
import {
  BLOG_DIR,
  DATA_DIR,
  HOST,
  PORT,
  PROFILE_PORT,
  PUBLIC_DIR,
  ensureRuntimeDirs,
} from './paths.ts';
import { createApp } from './app.ts';
import { createProfileApp } from './profile-app.ts';
import { bootstrapFromEnv } from './store/credentials.ts';
import { startSessionJanitor } from './auth/session.ts';
import { scheduleStaticBuild, distExists } from './build-scheduler.ts';
import { ensureVendoredAssets } from './vendor-assets.ts';
import { VERSION } from './version.ts';

async function main(): Promise<void> {
  ensureRuntimeDirs();
  ensureVendoredAssets();
  bootstrapFromEnv();
  startSessionJanitor();

  const app = await createApp({ skipPublicPages: true });

  const servers: import('node:http').Server[] = [];

  /** Bind one Express app and report the URLs it serves. */
  function listen(a: import('express').Express, port: number, label: string, urls: string[]): void {
    const server = a.listen(port, HOST, () => {
      if (!server.listening) return;
      const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
      for (const line of urls) console.log(`  ${line.replace('%host%', shown).replace('%port%', String(port))}`);
    });
    servers.push(server);
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Failed to start the ${label}: ${HOST}:${port} is already in use.`);
      } else {
        console.error(`Failed to start the ${label}:`, err);
      }
      process.exit(1);
    });
  }

  listen(app, PORT, 'api server', [
    `api       http://%host%:%port%/api/health`,
    `admin     http://%host%:%port%/admin/`,
    `static    ${PUBLIC_DIR} (css/js/icon/img/vendor/media/avatars/uploads)`,
    `pages     NOT served — deploy blog/dist/ (run \`npm run build\`)`,
  ]);

  // The personal card keeps its own server in this mode as well.
  const profileApp = await createProfileApp();
  listen(profileApp, PROFILE_PORT, 'profile card', [
    `profile   http://%host%:%port%/`,
  ]);

  console.log(`Blog Material You v${VERSION} API-only server (Node.js ${process.version})`);
  console.log(`  content   ${BLOG_DIR}`);
  console.log(`  data      ${DATA_DIR}`);
  console.log(`  dist      ${distExists() ? 'present' : 'missing — run `npm run build` or wait for the startup build'}`);

  // Keep the static output fresh: build once shortly after boot (unless
  // disabled), then on every _config.yml write (hooked in config-write.ts).
  if (process.env.BMY_AUTO_BUILD !== '0') scheduleStaticBuild(2500);

  const shutdown = (signal: string) => {
    console.log(`\n[${signal}] shutting down...`);
    for (const server of servers) server.close();
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
