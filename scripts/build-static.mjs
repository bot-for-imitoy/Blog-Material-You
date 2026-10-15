#!/usr/bin/env node
/**
 * build-static.mjs — CLI wrapper for the static site generator.
 *
 *   npm run build
 *   BMY_DIST_DIR=/path node scripts/build-static.mjs   # custom output
 *
 * Renders every public page to `blog/dist/` (overridable with BMY_DIST_DIR)
 * together with a copy of the static assets. The API-only server
 * (`npm run serve:api`) also rebuilds dist/ automatically whenever the admin
 * console writes `_config.yml` — this script is for manual/CI builds.
 *
 * Exit code: 0 when the build finished (even with per-page skips), 1 on a
 * fatal error. Per-page errors are reported but do not fail the build unless
 * --strict is passed.
 */
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const strict = process.argv.includes('--strict');
const build = await import(path.join(ROOT, 'src/build-static.ts'));
const { DIST_DIR } = await import(path.join(ROOT, 'src/paths.ts'));

try {
  const result = await build.buildStaticSite();
  console.log(`Static site built → ${result.distDir}`);
  console.log(`  pages:   ${result.pages}`);
  if (result.skipped) console.log(`  skipped: ${result.skipped} (feature switched off in _config.yml)`);
  if (result.errors.length) {
    console.warn(`  errors:  ${result.errors.length}`);
    for (const error of result.errors) console.warn(`    ${error}`);
  }
  console.log('Deploy dist/ with any static host; keep /api, /admin and /media on the API server (npm run serve:api).');
  if (strict && result.errors.length) process.exit(1);
} catch (err) {
  console.error('Build failed:', err);
  process.exit(1);
}
