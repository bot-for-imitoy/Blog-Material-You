/**
 * index.ts — Application entry point.
 *
 * Boots the HTTP server after preparing the runtime directories and, on a
 * fresh install, initialising the admin account from `BMY_ADMIN_PASS`.
 */
import 'dotenv/config';
import {
  ADMIN_PORT,
  BLOG_DIR,
  DATA_DIR,
  HOST,
  PORT,
  PROFILE_PORT,
  PUBLIC_DIR,
  ensureRuntimeDirs,
} from './paths.ts';
import { createApp } from './app.ts';
import { createAdminApp, createAdminServer, describeAdminTls } from './admin-app.ts';
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

  /** Bind one server and report the URLs it serves. */
  function listen(server: import('node:http').Server, port: number, label: string, urls: string[]): void {
    servers.push(server);
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `Failed to start the ${label}: ${HOST}:${port} is already in use.\n` +
            '  Another instance may still be running. Stop it, or move this one with\n' +
            `  BMY_${label === 'profile card' ? 'PROFILE_' : label === 'admin server' ? 'ADMIN_' : ''}PORT=<port> npm start.`,
        );
      } else if (err.code === 'EACCES') {
        console.error(`Failed to start the ${label}: not allowed to bind ${HOST}:${port} (privileged port?).`);
      } else {
        console.error(`Failed to start the ${label}:`, err);
      }
      process.exit(1);
    });
    server.listen(port, HOST, () => {
      if (!server.listening) return;
      const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
      for (const line of urls) console.log(`  ${line.replace('%host%', shown).replace('%port%', String(port))}`);
    });
  }

  listen(app.listen(PORT, HOST), PORT, 'blog', [
    `site      http://%host%:%port%/`,
    `api       http://%host%:%port%/api/health`,
    `admin     NOT served here — dedicated admin server on port ${ADMIN_PORT}`,
  ]);

  // The admin console and its API live on their own port, optionally with
  // TLS / mutual TLS, so they can be published behind their own domain (or
  // kept off the public internet entirely).
  const adminApp = await createAdminApp();
  const { server: adminServer, tls: adminTls } = createAdminServer(adminApp);
  listen(adminServer, ADMIN_PORT, 'admin server', [
    `admin     ${adminTls.enabled ? 'https' : 'http'}://%host%:%port%/admin/`,
  ]);
  console.log(`  admin tls ${describeAdminTls(adminTls)}`);

  // The personal card runs on its own port so it can be published
  // independently of the blog (e.g. its own domain behind a reverse proxy).
  const profileApp = await createProfileApp();
  listen(profileApp.listen(PROFILE_PORT, HOST), PROFILE_PORT, 'profile card', [
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
