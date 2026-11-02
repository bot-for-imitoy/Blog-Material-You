/**
 * build-scheduler.ts — debounced automatic static rebuilds.
 *
 * Whenever the admin console writes `_config.yml` (site settings, theme
 * colour, …) the static output in `blog/dist/` would go stale. Instead of
 * requiring the operator to rerun `npm run build`, every config write
 * schedules a rebuild a moment later; saves arriving in quick succession are
 * coalesced into a single build.
 *
 * The scheduler is a fire-and-forget side effect: a failed build is logged and
 * never breaks the request that triggered it. Set `BMY_AUTO_BUILD=0` to
 * disable (e.g. when dist/ is built by a CI pipeline instead).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DIST_DIR } from './paths.ts';

let timer: NodeJS.Timeout | null = null;
let building = false;
let queued = false;

async function run(): Promise<void> {
  building = true;
  try {
    const { buildStaticSite } = await import('./build-static.ts');
    const result = await buildStaticSite();
    console.log(
      `[build] static site rebuilt → ${result.distDir} (${result.pages} pages` +
        `${result.skipped ? `, ${result.skipped} skipped` : ''}` +
        `${result.errors.length ? `, ${result.errors.length} errors` : ''})`,
    );
    for (const error of result.errors) console.warn(`[build]   ${error}`);
  } catch (err) {
    console.error('[build] automatic static rebuild failed:', (err as Error).message);
  } finally {
    building = false;
    if (queued) {
      queued = false;
      void run();
    }
  }
}

/** Schedule a static rebuild `delayMs` after the last call (default 1.5 s). */
export function scheduleStaticBuild(delayMs = 1500): void {
  if (process.env.BMY_AUTO_BUILD === '0') return;
  if (building) {
    queued = true;
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void run();
  }, delayMs);
  timer.unref();
}

/** Whether the dist/ output exists (used to decide about a startup build). */
export function distExists(): boolean {
  try {
    return fs.existsSync(DIST_DIR) && fs.statSync(path.join(DIST_DIR, 'index.html')).isFile();
  } catch {
    return false;
  }
}
