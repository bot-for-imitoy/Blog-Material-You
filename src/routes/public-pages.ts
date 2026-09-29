/**
 * public-pages.ts — Server-rendered pages for the public site.
 *
 * Every route returns a complete HTML document. This replaces the original
 * SPA + `/api/ssr/*` fragment design, where each URL served the same empty
 * shell and the content only appeared after a client-side fetch (invisible to
 * crawlers and to anyone without JavaScript).
 */
import express, { type Router } from 'express';
import {
  activePosts,
  archivedPosts,
  buildCategoryIndex,
  buildTagIndex,
  getPost,
  groupByYear,
  listPosts,
  postsByCategory,
  postsByTag,
  toSummary,
} from '../content/posts.ts';
import { getPage, listPages } from '../content/pages.ts';
import { listTalks } from '../content/talks.ts';
import { listFriends } from '../content/friends.ts';
import { getSiteSettings } from '../site-config.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { searchPosts } from '../lib/search.ts';
import { renderPage, type PageSeo } from '../render/engine.ts';
import { seoForNotFound, seoForRoute } from '../render/seo.ts';
import { getVisitorEmail, clearVisitorCookie } from '../auth/visitor.ts';
import { getVisitor } from '../store/visitors.ts';

/** Stylesheet bundles reused by several views. */
const MARKDOWN_STYLES = [
  '/css/post-content.css',
  '/css/code.css',
  '/vendor/katex/katex.min.css',
  // Syntax highlighting follows the OS colour scheme, matching mdui's
  // `mdui-theme-auto` behaviour on <html>.
  { href: '/vendor/highlight/github.min.css', media: '(prefers-color-scheme: light)' },
  { href: '/vendor/highlight/github-dark.min.css', media: '(prefers-color-scheme: dark)' },
];

const VIEW_STYLES: Record<string, Array<string | { href: string; media?: string }>> = {
  'pages/home': ['/css/index.css', '/css/post-card.css'],
  'pages/post': MARKDOWN_STYLES,
  'pages/talks': [...MARKDOWN_STYLES, '/css/about.css'],
  'pages/page': [...MARKDOWN_STYLES, '/css/about.css'],
  'pages/search': ['/css/search.css'],
  'game/2048': ['/css/game-2048.css'],
};

const VIEW_SCRIPTS: Record<string, string[]> = {
  'pages/post': ['/js/comments.js'],
  'pages/status': ['/js/status.js'],
  'pages/auth': ['/js/auth.js'],
  'pages/search': ['/js/search.js'],
  'game/2048': ['/js/game-2048.js'],
};

/** Render a view with the shared SEO/currentPath/styles prelude. */
async function page(
  res: express.Response,
  view: string,
  data: Record<string, unknown>,
  seo: PageSeo,
  currentPath: string,
): Promise<void> {
  const html = await renderPage(view, {
    ...data,
    seo,
    currentPath,
    styles: VIEW_STYLES[view] ?? [],
    pageScripts: VIEW_SCRIPTS[view] ?? [],
  });
  res.type('html').send(html);
}

async function notFound(res: express.Response, path: string): Promise<void> {
  const html = await renderPage('pages/404', {
    seo: seoForNotFound(path),
    currentPath: path,
  });
  res.status(404).type('html').send(html);
}

export function createPublicPagesRouter(): Router {
  const router = express.Router();

  // ===================== Home =====================

  router.get('/', async (_req, res, next) => {
    try {
      await page(
        res,
        'pages/home',
        { posts: activePosts().map(toSummary) },
        seoForRoute('/'),
        '/',
      );
    } catch (err) {
      next(err);
    }
  });

  // ===================== Posts =====================

  router.get('/posts', async (_req, res, next) => {
    try {
      const years = groupByYear(activePosts()).map((group) => ({
        year: group.year,
        posts: group.posts.map(toSummary),
      }));
      await page(res, 'pages/posts', { years }, seoForRoute('/posts/'), '/posts/');
    } catch (err) {
      next(err);
    }
  });

  router.get('/post/:slug', async (req, res, next) => {
    try {
      const slug = String(req.params.slug);
      const post = getPost(slug);
      if (!post) {
        await notFound(res, `/post/${slug}`);
        return;
      }
      const primary = renderMarkdown(post.content, true);
      await page(
        res,
        'pages/post',
        {
          post,
          postTitle: post.title,
          contentHtml: primary.html,
          toc: primary.toc,
          cats: post.categories,
          tags: post.tags,
          commentsEnabled: getSiteSettings().commentsEnabled,
        },
        seoForRoute(`/post/${encodeURIComponent(slug)}`),
        '/posts/',
      );
    } catch (err) {
      next(err);
    }
  });

  // ===================== Tags =====================

  router.get('/tags', async (_req, res, next) => {
    try {
      await page(res, 'pages/tags', { tags: buildTagIndex(activePosts()) }, seoForRoute('/tags/'), '/tags/');
    } catch (err) {
      next(err);
    }
  });

  router.get('/tags/:name', async (req, res, next) => {
    try {
      const name = String(req.params.name);
      const items = postsByTag(name, listPosts()).map(toSummary);
      const seo = seoForRoute(`/tags/${encodeURIComponent(name)}`);
      await page(res, 'pages/list', { title: name, description: seo.desc, items }, seo, '/tags/');
    } catch (err) {
      next(err);
    }
  });

  // ===================== Categories =====================

  router.get('/categories', async (_req, res, next) => {
    try {
      await page(
        res,
        'pages/categories',
        { cats: buildCategoryIndex(activePosts()) },
        seoForRoute('/categories/'),
        '/categories/',
      );
    } catch (err) {
      next(err);
    }
  });

  router.get('/categories/:name', async (req, res, next) => {
    try {
      const name = String(req.params.name);
      const items = postsByCategory(name, listPosts()).map(toSummary);
      const seo = seoForRoute(`/categories/${encodeURIComponent(name)}`);
      await page(res, 'pages/list', { title: name, description: seo.desc, items }, seo, '/categories/');
    } catch (err) {
      next(err);
    }
  });

  // ===================== Archives =====================

  router.get('/archives', async (_req, res, next) => {
    try {
      const years = groupByYear(archivedPosts()).map((group) => ({
        year: group.year,
        posts: group.posts.map(toSummary),
      }));
      await page(res, 'pages/archives', { years }, seoForRoute('/archives/'), '/archives/');
    } catch (err) {
      next(err);
    }
  });

  // ===================== Talks / friends =====================

  router.get('/talks', async (_req, res, next) => {
    try {
      const talks = listTalks().map((talk) => ({
        ...talk,
        html: renderMarkdown(talk.content, true).html,
      }));
      await page(res, 'pages/talks', { talks }, seoForRoute('/talks/'), '/talks/');
    } catch (err) {
      next(err);
    }
  });

  router.get('/friends', async (_req, res, next) => {
    try {
      await page(res, 'pages/friends', { list: listFriends() }, seoForRoute('/friends/'), '/friends/');
    } catch (err) {
      next(err);
    }
  });

  // ===================== Status / auth / game =====================

  router.get('/status', async (_req, res, next) => {
    try {
      await page(res, 'pages/status', {}, seoForRoute('/status/'), '/status/');
    } catch (err) {
      next(err);
    }
  });

  router.get('/auth', async (req, res, next) => {
    try {
      const email = getVisitorEmail(req);
      const visitor = email ? getVisitor(email) : null;
      await page(
        res,
        'pages/auth',
        {
          authed: visitor !== null,
          authEmail: visitor?.email ?? '',
          authUser: visitor?.name ?? '',
          authPerms: visitor?.permissions ?? [],
        },
        seoForRoute('/auth/'),
        '/auth/',
      );
    } catch (err) {
      next(err);
    }
  });

  /**
   * HTML logout for the visitor session. The auth page uses a plain form post
   * so the action works without JavaScript; the JSON equivalent lives at
   * `POST /api/auth/logout`.
   */
  router.post('/auth/logout', (req, res) => {
    clearVisitorCookie(res);
    res.redirect(303, '/auth/');
  });

  router.get('/2048', async (_req, res, next) => {
    try {
      await page(res, 'game/2048', {}, seoForRoute('/2048/'), '/2048/');
    } catch (err) {
      next(err);
    }
  });

  // ===================== Search =====================

  /**
   * Search results page. Rendered on the server so a query is a shareable,
   * bookmarkable URL and the form works without JavaScript; `search.js`
   * upgrades it to live, as-you-type results.
   */
  router.get('/search', async (req, res, next) => {
    try {
      const outcome = searchPosts(req.query.q);
      await page(
        res,
        'pages/search',
        {
          query: outcome.query,
          tokens: outcome.tokens,
          total: outcome.total,
          results: outcome.hits,
          hasQuery: outcome.tokens.length > 0,
          // Search result pages are thin, per-query duplicates: keep them out of
          // the index but let crawlers follow the links to the posts themselves.
          headExtra: '<meta name="robots" content="noindex, follow">',
        },
        seoForRoute('/search/'),
        '/search/',
      );
    } catch (err) {
      next(err);
    }
  });

  // ===================== Pages =====================

  /** `/about/` and any other page slug rendered at `/pages/<slug>/`. */
  async function renderSinglePage(res: express.Response, slug: string, path: string, next: express.NextFunction) {
    try {
      const found = getPage(slug);
      if (!found) {
        await notFound(res, path);
        return;
      }
      const primary = renderMarkdown(found.content, true);
      // The body always shows the default language, exactly like posts; the
      // English fields are used for SEO metadata (see render/seo.ts).
      await page(
        res,
        'pages/page',
        {
          page: found,
          pageTitle: found.title,
          pageHtml: primary.html,
          toc: primary.toc,
        },
        seoForRoute(path),
        path,
      );
    } catch (err) {
      next(err);
    }
  }

  router.get('/about', async (_req, res, next) => {
    await renderSinglePage(res, 'about', '/about/', next);
  });

  router.get('/pages/:slug', async (req, res, next) => {
    const slug = String(req.params.slug);
    await renderSinglePage(res, slug, `/pages/${slug}/`, next);
  });

  // ===================== Feeds =====================

  router.get('/sitemap.xml', (_req, res) => {
    const { site } = { site: getSiteSettings() };
    const base = site.url.replace(/\/+$/, '');
    const urls: Array<{ loc: string; lastmod?: string }> = [
      { loc: '/' },
      { loc: '/posts/' },
      { loc: '/tags/' },
      { loc: '/categories/' },
      { loc: '/archives/' },
      { loc: '/talks/' },
      { loc: '/friends/' },
      { loc: '/about/' },
    ];
    for (const post of activePosts()) urls.push({ loc: `/post/${encodeURIComponent(post.slug)}`, lastmod: post.date });
    for (const tag of buildTagIndex(activePosts())) urls.push({ loc: `/tags/${encodeURIComponent(tag.name)}` });
    for (const cat of buildCategoryIndex(activePosts())) urls.push({ loc: `/categories/${encodeURIComponent(cat.name)}` });
    for (const p of listPages()) urls.push({ loc: `/pages/${encodeURIComponent(p.slug)}` });

    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls
        .map((u) => `  <url><loc>${base}${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
        .join('\n') +
      `\n</urlset>\n`;
    res.type('application/xml').send(body);
  });

  router.get('/rss.xml', (_req, res) => {
    const { site } = { site: getSiteSettings() };
    const base = site.url.replace(/\/+$/, '');
    const posts = activePosts().slice(0, 20);
    const escape = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<rss version="2.0"><channel>\n` +
      `  <title>${escape(site.title)}</title>\n` +
      `  <link>${base}/</link>\n` +
      `  <description>${escape(site.desc)}</description>\n` +
      posts
        .map(
          (post) =>
            `  <item>\n` +
            `    <title>${escape(post.title)}</title>\n` +
            `    <link>${base}/post/${encodeURIComponent(post.slug)}</link>\n` +
            `    <guid>${base}/post/${encodeURIComponent(post.slug)}</guid>\n` +
            `    <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>\n` +
            `    <description>${escape(renderMarkdown(post.content, true).html)}</description>\n` +
            `  </item>`,
        )
        .join('\n') +
      `\n</channel></rss>\n`;
    res.type('application/rss+xml').send(body);
  });

  return router;
}
