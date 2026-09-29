/**
 * index.ts — Application entry point.
 *
 * Boots the HTTP server after preparing the runtime directories and, on a
 * fresh install, initialising the admin account from `BMY_ADMIN_PASS`.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HOST, PORT, ROOT, ensureRuntimeDirs, BLOG_DIR, DATA_DIR, PUBLIC_DIR } from './paths.ts';
import { createApp } from './app.ts';
import { bootstrapFromEnv, credentialFormat } from './store/credentials.ts';
import { startSessionJanitor } from './auth/session.ts';
import { VERSION } from './version.ts';

/**
 * The vendored front-end libraries (mdui, KaTeX, highlight.js) are generated
 * from node_modules and are gitignored, so a fresh clone would 404 on every
 * stylesheet. Regenerate them on boot when they are missing.
 */
function ensureVendoredAssets(): void {
  const marker = path.join(PUBLIC_DIR, 'vendor', 'mdui', 'mdui.css');
  if (fs.existsSync(marker)) return;
  const script = path.join(ROOT, 'scripts', 'sync-assets.mjs');
  if (!fs.existsSync(script)) {
    console.warn('[assets] vendored front-end assets are missing and scripts/sync-assets.mjs was not found');
    return;
  }
  try {
    console.log('[assets] vendored front-end assets missing — running sync-assets.mjs');
    execFileSync(process.execPath, [script], { stdio: 'inherit' });
  } catch (err) {
    console.warn('[assets] could not sync front-end assets:', (err as Error).message);
  }
}

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

  const server = app.listen(PORT, HOST, () => {
    const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`Blog Material You v${VERSION} (Node.js ${process.version})`);
    console.log(`  site      http://${shown}:${PORT}/`);
    console.log(`  admin     http://${shown}:${PORT}/admin/`);
    console.log(`  api       http://${shown}:${PORT}/api/health`);
    console.log(`  content   ${BLOG_DIR}`);
    console.log(`  data      ${DATA_DIR}`);
    console.log(`  assets    ${PUBLIC_DIR}`);
  });

  const shutdown = (signal: string) => {
    console.log(`\n[${signal}] shutting down...`);
    server.close(() => process.exit(0));
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
