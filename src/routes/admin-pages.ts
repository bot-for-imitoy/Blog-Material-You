/**
 * admin-pages.ts — Server-rendered HTML for the admin console (mounted at `/admin`).
 *
 * Every page is a complete document: `renderPage` renders the page view and
 * wraps it in `views/layouts/admin.ejs`. Nothing here is client-side rendered —
 * the browser (and curl) always sees real content, and `/js/admin.js` only adds
 * behaviour on top of the markup.
 *
 * `currentPath` is passed to each render so the sidebar can highlight the
 * active section; login/setup opt out of the shell via `adminShell: false`
 * because they must render outside the authenticated navigation.
 */
import express from 'express';
import type { Request, Router } from 'express';

import { buildSeo, renderPage, type PageSeo, type RenderData } from '../render/engine.ts';
import { requireAdminPage, resolveAdminUser } from '../middleware/admin-auth.ts';
import { getUser, isSetupDone } from '../store/credentials.ts';
import { getPendingSecret, isTotpEnabled } from '../store/totp-state.ts';
import { provisioningUri } from '../auth/totp.ts';
import { activePosts, archivedPosts, buildTagIndex, getPost, listPosts, type Post } from '../content/posts.ts';
import { getPage, listPages, type Page } from '../content/pages.ts';
import { listTalks, type Talk } from '../content/talks.ts';
import { getFriend, listFriends, type Friend } from '../content/friends.ts';
import { listAllComments } from '../store/comments.ts';
import { PERMISSIONS, listPending, listVisitors } from '../store/visitors.ts';
import { maskImghostConfig, readImghostConfig } from '../store/imghost-config.ts';

/** Build the SEO block for an admin page (titles end in "博客后台"). */
function adminSeo(title: string, canonical: string, desc = ''): PageSeo {
  return buildSeo({ title: `${title} - 博客后台`, desc: desc || title, canonical });
}

export function createAdminPagesRouter(): Router {
  const router = express.Router();

  /** Common render data: the sidebar needs currentPath + the signed-in user. */
  function baseData(req: Request, seo: PageSeo, extra: RenderData = {}): RenderData {
    return {
      seo,
      currentPath: `${req.baseUrl}${req.path}`,
      adminUser: resolveAdminUser(req) ?? '',
      ...extra,
    };
  }

  // ===================== Entry points =====================

  router.get('/', (_req, res) => {
    res.redirect(302, '/admin/dashboard/');
  });

  /** Login: bounce already-authenticated visitors straight to the dashboard. */
  router.get('/login/', async (req, res) => {
    if (resolveAdminUser(req)) {
      res.redirect(302, '/admin/dashboard/');
      return;
    }
    res.type('html').send(
      await renderPage(
        'admin/login',
        baseData(req, adminSeo('登录', '/admin/login/'), { adminShell: false }),
        'layouts/admin',
      ),
    );
  });

  /** First-run wizard: only reachable while no admin account exists. */
  router.get('/setup/', async (req, res) => {
    if (isSetupDone()) {
      res.redirect(302, '/admin/login/');
      return;
    }
    res.type('html').send(
      await renderPage(
        'admin/setup',
        baseData(req, adminSeo('初始化', '/admin/setup/'), { adminShell: false }),
        'layouts/admin',
      ),
    );
  });

  // ===================== Dashboard =====================

  router.get('/dashboard/', requireAdminPage, async (req, res) => {
    const all = listPosts();
    res.type('html').send(
      await renderPage(
        'admin/dashboard',
        baseData(req, adminSeo('控制台', '/admin/dashboard/'), {
          stats: {
            posts: activePosts().length,
            archived: archivedPosts().length,
            comments: listAllComments().length,
            tags: buildTagIndex().length,
            talks: listTalks().length,
          },
          recentPosts: all.slice(0, 5),
          total: all.length,
        }),
        'layouts/admin',
      ),
    );
  });

  // ===================== Posts =====================

  router.get('/posts/', requireAdminPage, async (req, res) => {
    res.type('html').send(
      await renderPage(
        'admin/posts',
        baseData(req, adminSeo('文章', '/admin/posts/'), { posts: listPosts() }),
        'layouts/admin',
      ),
    );
  });

  router.get('/posts/new/', requireAdminPage, async (req, res) => {
    res.type('html').send(
      await renderPage(
        'admin/editor',
        baseData(req, adminSeo('新建文章', '/admin/posts/new/'), { post: emptyPost(), isNew: true }),
        'layouts/admin',
      ),
    );
  });

  router.get('/posts/:slug/edit/', requireAdminPage, async (req, res) => {
    const slug = String(req.params.slug ?? '');
    const post = getPost(slug);
    res.type('html').send(
      await renderPage(
        'admin/editor',
        baseData(req, adminSeo(post ? `编辑 ${post.title || slug}` : '文章', `/admin/posts/${slug}/edit/`), {
          // A missing file still renders the editor (with a warning) instead of
          // a dead end, so the admin can recreate the post.
          post: post ?? { ...emptyPost(), slug },
          isNew: post === null,
          notFound: post === null ? slug : '',
        }),
        'layouts/admin',
      ),
    );
  });

  // ===================== Pages =====================

  router.get('/pages/', requireAdminPage, async (req, res) => {
    res.type('html').send(
      await renderPage(
        'admin/pages',
        baseData(req, adminSeo('页面', '/admin/pages/'), { pages: listPages() }),
        'layouts/admin',
      ),
    );
  });

  router.get('/pages/new/', requireAdminPage, async (req, res) => {
    res.type('html').send(
      await renderPage(
        'admin/page-editor',
        baseData(req, adminSeo('新建页面', '/admin/pages/new/'), { page: emptyPage(), isNew: true }),
        'layouts/admin',
      ),
    );
  });

  router.get('/pages/:slug/edit/', requireAdminPage, async (req, res) => {
    const slug = String(req.params.slug ?? '');
    const page = getPage(slug);
    res.type('html').send(
      await renderPage(
        'admin/page-editor',
        baseData(req, adminSeo(page ? `编辑 ${page.title || slug}` : '页面', `/admin/pages/${slug}/edit/`), {
          page: page ?? { ...emptyPage(), slug },
          isNew: page === null,
          notFound: page === null ? slug : '',
        }),
        'layouts/admin',
      ),
    );
  });

  // ===================== Talks =====================

  router.get('/talks/', requireAdminPage, async (req, res) => {
    res.type('html').send(
      await renderPage(
        'admin/talks',
        baseData(req, adminSeo('动态', '/admin/talks/'), { talks: listTalks() }),
        'layouts/admin',
      ),
    );
  });

  router.get('/talks/new/', requireAdminPage, async (req, res) => {
    res.type('html').send(
      await renderPage(
        'admin/talk-editor',
        baseData(req, adminSeo('发布动态', '/admin/talks/new/'), { talk: null, isNew: true }),
        'layouts/admin',
      ),
    );
  });

  // ===================== Friends =====================

  router.get('/friends/', requireAdminPage, async (req, res) => {
    res.type('html').send(
      await renderPage(
        'admin/friends',
        baseData(req, adminSeo('友链', '/admin/friends/'), { friends: listFriends() }),
        'layouts/admin',
      ),
    );
  });

  router.get('/friends/new/', requireAdminPage, async (req, res) => {
    res.type('html').send(
      await renderPage(
        'admin/friend-editor',
        baseData(req, adminSeo('添加友链', '/admin/friends/new/'), { friend: emptyFriend(), isNew: true }),
        'layouts/admin',
      ),
    );
  });

  router.get('/friends/:id/edit/', requireAdminPage, async (req, res) => {
    const id = Number.parseInt(String(req.params.id ?? ''), 10);
    const friend = Number.isFinite(id) ? getFriend(id) : null;
    res.type('html').send(
      await renderPage(
        'admin/friend-editor',
        baseData(req, adminSeo(friend ? `编辑 ${friend.title}` : '友链', `/admin/friends/${id}/edit/`), {
          friend: friend ?? { ...emptyFriend(), id: Number.isFinite(id) ? id : 0 },
          isNew: friend === null,
          notFound: friend === null ? String(req.params.id ?? '') : '',
        }),
        'layouts/admin',
      ),
    );
  });

  // ===================== Comments / visitors =====================

  router.get('/comments/', requireAdminPage, async (req, res) => {
    res.type('html').send(
      await renderPage(
        'admin/comments',
        baseData(req, adminSeo('评论', '/admin/comments/'), { comments: listAllComments() }),
        'layouts/admin',
      ),
    );
  });

  router.get('/visitors/', requireAdminPage, async (req, res) => {
    res.type('html').send(
      await renderPage(
        'admin/visitors',
        baseData(req, adminSeo('访客', '/admin/visitors/'), {
          visitors: listVisitors(),
          pending: listPending(),
          permissions: [...PERMISSIONS],
        }),
        'layouts/admin',
      ),
    );
  });

  // ===================== Security =====================

  router.get('/security/', requireAdminPage, async (req, res) => {
    const user = getUser();
    const pending = getPendingSecret();
    res.type('html').send(
      await renderPage(
        'admin/security',
        baseData(req, adminSeo('安全', '/admin/security/'), {
          user,
          totp: {
            enabled: isTotpEnabled(),
            hasPending: pending !== '',
            // Only a pending secret is ever sent to a template.
            secret: pending,
            provisioningUri: pending === '' ? '' : provisioningUri(pending, user),
          },
        }),
        'layouts/admin',
      ),
    );
  });

  // ===================== Image host / backup =====================

  router.get('/imghost/', requireAdminPage, async (req, res) => {
    res.type('html').send(
      await renderPage(
        'admin/imghost',
        baseData(req, adminSeo('图床', '/admin/imghost/'), { config: maskImghostConfig(readImghostConfig()) }),
        'layouts/admin',
      ),
    );
  });

  router.get('/backup/', requireAdminPage, async (req, res) => {
    res.type('html').send(
      await renderPage('admin/backup', baseData(req, adminSeo('数据备份', '/admin/backup/')), 'layouts/admin'),
    );
  });

  return router;
}

// ===================== Draft factories =====================
// The editors always receive an object (never null), which keeps the EJS
// templates free of null checks.

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyPost(): Post {
  return {
    slug: '',
    title: '',
    titleEn: '',
    content: '',
    contentEn: '',
    date: today(),
    dateFormatted: today(),
    tags: [],
    categories: [],
    cover: '',
    archived: false,
    year: null,
    month: null,
    day: null,
    mtimeMs: 0,
  };
}

function emptyPage(): Page {
  return { slug: '', title: '', titleEn: '', content: '', contentEn: '', mtimeMs: 0 };
}

function emptyFriend(): Friend {
  return { id: 0, title: '', descr: '', titleEn: '', descrEn: '', avatar: '', url: '', sortOrder: 0, file: '' };
}

/** Unused type re-exports kept for template-side documentation. */
export type { Friend, Page, Post, Talk };
