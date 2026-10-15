/**
 * vendor-assets.ts — Regenerate the vendored front-end libraries when missing.
 *
 * The vendored assets (mdui, KaTeX, highlight.js) are generated from
 * node_modules and are gitignored, so a fresh clone would 404 on every
 * stylesheet. Both server entry points (SSR and API-only) run this on boot.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PUBLIC_DIR, ROOT } from './paths.ts';

export function ensureVendoredAssets(): void {
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
