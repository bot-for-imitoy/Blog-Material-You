/**
 * index.ts — Application entry point.
 *
 * Boots the HTTP server after preparing the runtime directories and, on a
 * fresh install, initialising the admin account from `BMY_ADMIN_PASS`.
 */
import 'dotenv/config';
import { HOST, PORT, PROFILE_PORT, ensureRuntimeDirs, BLOG_DIR, DATA_DIR, PUBLIC_DIR } from './paths.ts';
import { createApp } from './app.ts';
import { createProfileApp } from './profile-app.ts';
import { bootstrapFromEnv, credentialFormat } from './store/credentials.ts';
import { startSessionJanitor } from './auth/session.ts';
import { ensureVendoredAssets } from './vendor-assets.ts';
import { VERSION } from './version.ts';

async function main(): Promise<void> {
  ensureRuntimeDirs();
  ensureVendoredAssets();

  // `BMY_ADMIN_PASS` creates the first admin account on an uninitialised
  // install. It never overwrites an existing one — use `npm run passwd-reset`.
  bootstrapFromEnv();
  if (credentialFormat() === 'legacy') {
    console.log(
      '[credentials] a pre-rewrite (AES-256-CBC) admin record was found — your existing\n' +
        '              password still works and is upgraded to scrypt on the next login.\n' +
        '              If login fails, run `npm run passwd-reset` to start over.',
    );
  }
  startSessionJanitor();

  const app = await createApp();

  const servers: import('node:http').Server[] = [];

  /** Bind one Express app and report the URLs it serves. */
  function listen(app: import('express').Express, port: number, label: string, urls: string[]): void {
    const server = app.listen(port, HOST, () => {
      if (!server.listening) return;
      const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
      for (const line of urls) console.log(`  ${line.replace('%host%', shown).replace('%port%', String(port))}`);
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `Failed to start the ${label}: ${HOST}:${port} is already in use.\n` +
            '  Another instance may still be running. Stop it, or move this one with\n' +
            `  BMY_${label === 'profile card' ? 'PROFILE_' : ''}PORT=<port> npm start.`,
        );
      } else if (err.code === 'EACCES') {
        console.error(`Failed to start the ${label}: not allowed to bind ${HOST}:${port} (privileged port?).`);
      } else {
        console.error(`Failed to start the ${label}:`, err);
      }
      process.exit(1);
    });
  }

  listen(app, PORT, 'blog', [
    `site      http://%host%:%port%/`,
    `admin     http://%host%:%port%/admin/`,
    `api       http://%host%:%port%/api/health`,
  ]);

  // The personal card runs on its own port so it can be published
  // independently of the blog (e.g. its own domain behind a reverse proxy).
  const profileApp = await createProfileApp();
  listen(profileApp, PROFILE_PORT, 'profile card', [
    `profile   http://%host%:%port%/`,
  ]);

  console.log(`Blog Material You v${VERSION} (Node.js ${process.version})`);
  console.log(`  content   ${BLOG_DIR}`);
  console.log(`  data      ${DATA_DIR}`);
  console.log(`  assets    ${PUBLIC_DIR}`);

  const shutdown = (signal: string) => {
    console.log(`\n[${signal}] shutting down...`);
    for (const server of servers) server.close();
    // Do not hang forever on keep-alive connections.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
