/**
 * build-static.ts — `npm run build`, the static site generator.
 *
 * Renders every public page of the blog to `blog/dist/` so deployment does not
 * need the Node server for page views at all: the output is a self-contained
 * static tree (HTML pages + a copy of the static assets), Hexo-style.
 *
 * How it works: the real Express app is booted on an ephemeral loopback port
 * and every page is fetched from it. Reusing the app — instead of re-asking
 * the render layer — guarantees the static output is byte-identical to what
 * the SSR server would serve, including 404s, feeds and feature switches.
 *
 * Not baked into the output (they need a live process and stay on the API
 * server, see api-server.ts):
 *   - `/api/*` and `/admin/*` (dynamic by definition);
 *   - `/media` (on-demand image resizing — proxy it to the API server);
 *   - `/auth/` (renders the visitor's session state).
 *
 * The build also copies `blog/public` into `dist/`, so CSS/JS/icons/images and
 * uploads ship with the pages. `dist/` is disposable and rebuilt from scratch.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import { createApp } from './app.ts';
import { DIST_DIR, PUBLIC_DIR } from './paths.ts';
import {
  activePosts,
  buildCategoryIndex,
  buildTagIndex,
  listPosts,
} from './content/posts.ts';
import { listPages } from './content/pages.ts';

export interface StaticBuildResult {
  distDir: string;
  pages: number;
  skipped: number;
  errors: string[];
}

/** All URLs that should exist in the static output. */
function collectUrls(): string[] {
  const urls = ['/', '/posts/', '/status/', '/2048/', '/search/'];
  // Dynamic segments mirror the URL shapes the site itself links to
  // (see sitemap.xml), while fixed routes keep their trailing slash.
  for (const post of listPosts()) urls.push(`/post/${encodeURIComponent(post.slug)}`);
  urls.push('/tags/', '/categories/', '/archives/', '/talks/', '/friends/', '/about/');
  for (const tag of buildTagIndex(activePosts())) urls.push(`/tags/${encodeURIComponent(tag.name)}`);
  for (const cat of buildCategoryIndex(activePosts())) urls.push(`/categories/${encodeURIComponent(cat.name)}`);
  for (const page of listPages()) urls.push(`/pages/${encodeURIComponent(page.slug)}`);
  urls.push('/sitemap.xml', '/rss.xml');
  return urls;
}

/** Map a URL to its output path inside `dist/` (`/posts/` → `posts/index.html`). */
function outputPathFor(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  if (trimmed === '') return path.join(DIST_DIR, 'index.html');
  if (path.extname(trimmed)) return path.join(DIST_DIR, trimmed);
  return path.join(DIST_DIR, trimmed, 'index.html');
}

/** Run `fn` over `items` with a small concurrency cap. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function buildStaticSite(): Promise<StaticBuildResult> {
  const result: StaticBuildResult = { distDir: DIST_DIR, pages: 0, skipped: 0, errors: [] };

  // The build's own page fetches must not count as visits.
  const previousFlag = process.env.BMY_NO_RECORD;
  process.env.BMY_NO_RECORD = '1';

  const app: Express = await createApp({ publicOnly: true });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('could not determine the ephemeral port');
    const base = `http://127.0.0.1:${address.port}`;

    // Start from a clean tree: dist/ is disposable by contract.
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
    fs.mkdirSync(DIST_DIR, { recursive: true });

    // Static assets ship with the pages so dist/ can be served as-is.
    if (fs.existsSync(PUBLIC_DIR)) {
      fs.cpSync(PUBLIC_DIR, DIST_DIR, { recursive: true });
    }

    const urls = collectUrls();
    await mapLimit(urls, 8, async (url) => {
      try {
        const response = await fetch(`${base}${url}`);
        if (response.status === 404) {
          // Feature switched off in _config.yml (search/rss/sitemap) — skip.
          result.skipped += 1;
          return;
        }
        if (!response.ok) {
          result.errors.push(`${url}: HTTP ${response.status}`);
          return;
        }
        const body = Buffer.from(await response.arrayBuffer());
        const file = outputPathFor(url);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
        result.pages += 1;
      } catch (err) {
        result.errors.push(`${url}: ${(err as Error).message}`);
      }
    });
  } finally {
    server.close();
    if (previousFlag === undefined) delete process.env.BMY_NO_RECORD;
    else process.env.BMY_NO_RECORD = previousFlag;
  }

  return result;
}
