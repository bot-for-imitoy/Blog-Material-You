/**
 * public-api.ts — The public JSON API.
 *
 * Wire format is consistent across the whole app:
 *   success → { errno: 0, data: ... }
 *   failure → { errno: -1, errmsg: '...' }
 *
 * Deliberate changes from the Lua original:
 *  - field names are camelCase throughout (the old API mixed snake_case and
 *    camelCase and leaked `session_secret`, `admin_user` and `admin_pass` from
 *    `/api/config`; the replacement `/api/site` exposes none of them);
 *  - post bodies are rendered to HTML on the server, so the endpoint returns
 *    `html` (plus `toc`) instead of expecting the browser to run marked.js;
 *  - `/api/auth/check` actually verifies registration (the old one was a stub
 *    that always answered `registered: false`, making the flow a dead end);
 *  - `/api/calendar` authenticates via a signed visitor cookie instead of
 *    trusting a spoofable `X-User-Email` header;
 *  - `/api/status` reports real process metrics instead of a constant string.
 */
import express, { type Router } from 'express';
import multer from 'multer';
import { VERSION } from '../version.ts';
import {
  activePosts,
  archivedPosts,
  buildCategoryIndex,
  buildTagIndex,
  excerptOf,
  getPost,
  groupByYear,
  listPosts,
  postsByCategory,
  postsByTag,
  toSummary,
} from '../content/posts.ts';
import { getPage } from '../content/pages.ts';
import { addTalk, listTalks } from '../content/talks.ts';
import { listFriends } from '../content/friends.ts';
import { addComment, countAllComments, countComments, listComments, validateComment, type Comment } from '../store/comments.ts';
import { getVisits } from '../store/visits.ts';
import { listEvents, type CalendarEvent } from '../store/calendar.ts';
import {
  addPending,
  countVisitors,
  getVisitor,
  hasPermission,
  isRegistered,
  isValidEmail,
  normaliseEmail,
} from '../store/visitors.ts';
import { publicSiteConfig } from '../site-config.ts';
import { VISITOR_PASSCODE } from '../paths.ts';
import { safeEqual } from '../auth/secret.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { searchPosts } from '../lib/search.ts';
import { hitCounter, rateLimit } from '../lib/ratelimit.ts';
import { processAvatar, mirrorToImghost } from '../media/avatar.ts';
import { mediaUrl } from '../media/resize.ts';
import { createVisitorToken, clearVisitorCookie, getVisitorEmail, setVisitorCookie } from '../auth/visitor.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function ok<T>(res: express.Response, data: T): void {
  res.json({ errno: 0, data });
}

function fail(res: express.Response, status: number, errmsg: string): void {
  res.status(status).json({ errno: -1, errmsg });
}

/**
 * A comment as the public site sees it. Deliberately narrower than the stored
 * record (`Comment`): `mail`, `ua` and the page key stay on the server. See
 * `publicComment` below.
 */
interface PublicComment {
  id: number;
  nick: string;
  comment: string;
  link: string;
  avatar: string;
  createTime: number;
}

/**
 * Shared-secret gate for visitor identity endpoints.
 *
 * Without SMTP the server cannot prove ownership of an email address, so any
 * caller who *knows* a registered address could otherwise obtain that
 * visitor's signed session. When `BMY_VISITOR_PASSCODE` is configured, both
 * `/auth/check` and `/auth/register` must present it. Comparison is
 * constant-time. Returns true when the request may proceed (already failed
 * with 403 otherwise).
 */
function requirePasscode(req: express.Request, res: express.Response): boolean {
  if (VISITOR_PASSCODE === '') return true;
  const body = (req.body ?? {}) as { passcode?: unknown };
  const given = typeof body.passcode === 'string' ? body.passcode : '';
  if (given.length === VISITOR_PASSCODE.length && safeEqual(given, VISITOR_PASSCODE)) return true;
  fail(res, 403, '访客口令错误');
  return false;
}

/** Strip internal-only fields and attach the rendered body. */
function publicPost(slug: string) {
  const post = getPost(slug);
  if (!post) return null;
  const primary = renderMarkdown(post.content, true);
  const english = post.contentEn ? renderMarkdown(post.contentEn, true) : null;
  return {
    slug: post.slug,
    title: post.title,
    titleEn: post.titleEn,
    date: post.date,
    tags: post.tags,
    categories: post.categories,
    cover: post.cover,
    archived: post.archived,
    excerpt: excerptOf(post),
    content: post.content,
    contentEn: post.contentEn,
    html: primary.html,
    toc: primary.toc,
    htmlEn: english?.html ?? '',
  };
}

/** Calendar events, newest metadata first (permission-gated by the caller). */
export function readCalendar(): CalendarEvent[] {
  return listEvents();
}

export function createPublicApiRouter(): Router {
  const router = express.Router();

  // ===================== Meta =====================

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', server: 'nodejs', version: VERSION });
  });

  router.get('/site', (_req, res) => {
    ok(res, publicSiteConfig());
  });

  router.get('/status', (_req, res) => {
    const memory = process.memoryUsage();
    ok(res, {
      online: true,
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
      },
      authEnabled: true,
      visits: getVisits(),
      counts: {
        posts: listPosts().length,
        comments: countAllComments(),
        talks: listTalks().length,
        friends: listFriends().length,
        visitors: countVisitors(),
      },
    });
  });

  // ===================== Content =====================

  router.get('/posts', (_req, res) => {
    ok(res, activePosts().map(toSummary));
  });

  router.get('/posts/:slug', (req, res) => {
    const post = publicPost(req.params.slug);
    if (!post) {
      fail(res, 404, `Post not found: ${req.params.slug}`);
      return;
    }
    ok(res, post);
  });

  router.get('/tags', (_req, res) => {
    ok(res, buildTagIndex(activePosts()));
  });

  router.get('/tags/:name', (req, res) => {
    const name = String(req.params.name);
    // Tag listings include archived posts, matching the original behaviour.
    ok(res, postsByTag(name, listPosts()).map(toSummary));
  });

  router.get('/categories', (_req, res) => {
    ok(res, buildCategoryIndex(activePosts()));
  });

  router.get('/categories/:name', (req, res) => {
    const name = String(req.params.name);
    ok(res, postsByCategory(name, listPosts()).map(toSummary));
  });

  router.get('/archives', (_req, res) => {
    ok(res, groupByYear(archivedPosts()).map((group) => ({
      year: group.year,
      posts: group.posts.map(toSummary),
    })));
  });

  router.get('/pages/:slug', (req, res) => {
    const page = getPage(String(req.params.slug));
    if (!page) {
      fail(res, 404, `Page not found: ${req.params.slug}`);
      return;
    }
    const html = renderMarkdown(page.content, true);
    ok(res, {
      slug: page.slug,
      title: page.title,
      titleEn: page.titleEn,
      content: page.content,
      contentEn: page.contentEn,
      html: html.html,
      toc: html.toc,
    });
  });

  // ===================== Talks / friends =====================

  router.get('/talks', (_req, res) => {
    ok(
      res,
      listTalks().map((talk) => ({
        id: talk.id,
        content: talk.content,
        createTime: talk.createTime,
        html: renderMarkdown(talk.content, true).html,
      })),
    );
  });

  router.get('/friends', (_req, res) => {
    ok(
      res,
      listFriends().map((friend) => ({
        id: friend.id,
        title: friend.title,
        descr: friend.descr,
        titleEn: friend.titleEn,
        descrEn: friend.descrEn,
        avatar: friend.avatar,
        url: friend.url,
        sortOrder: friend.sortOrder,
      })),
    );
  });

  // ===================== Comments =====================

  /**
   * The comment shape sent to the public site.
   *
   * An explicit field list rather than a spread of the stored record: the file
   * also holds `mail`, `ua` and the page key, none of which the page renders.
   * Spreading it published every commenter's email address — and every stored
   * User-Agent — to any visitor who opened the endpoint, which also defeated the
   * form's "不展示我的信息" switch: withholding your own browser was pointless
   * while everyone else's was still being handed out.
   *
   * Uploaded avatars are stored as 512x512 WebP but painted at 64 px, so the
   * URL is rewritten to a `/media` resize — 24 kB becomes about 2 kB. Remote
   * avatars are returned unchanged by `mediaUrl`.
   */
  const publicComment = (comment: Comment): PublicComment => ({
    id: comment.id,
    nick: comment.nick,
    comment: comment.comment,
    link: comment.link,
    avatar: mediaUrl(comment.avatar, { width: 160, height: 160, fit: 'cover' }),
    createTime: comment.createTime,
  });

  router.get('/comments', (req, res) => {
    const path = String(req.query.path ?? req.query.url ?? '');
    if (!path) {
      fail(res, 400, 'Missing path parameter');
      return;
    }
    if (String(req.query.type ?? '') === 'count') {
      ok(res, { count: countComments(path) });
      return;
    }
    ok(res, listComments(path).map(publicComment));
  });

  router.post(
    '/comments',
    // Two windows: a short burst limit and a per-day ceiling, so the rate
    // limiter cannot be defeated by pacing requests exactly 61 s apart.
    rateLimit({ name: 'comment', windowMs: 60_000, max: 10 }),
    rateLimit({ name: 'comment-daily', windowMs: 24 * 3600_000, max: 100 }),
    (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = validateComment(body);
      if (!result.ok || !result.comment) {
        fail(res, 400, result.error ?? 'Invalid comment');
        return;
      }
      ok(res, publicComment(addComment(result.comment)));
    },
  );

  // ===================== Search =====================

  /**
   * Full-text search over the Markdown content.
   * Returns an empty result set (not an error) for an empty query so the client
   * can render its "type a keyword" state without special-casing.
   */
  router.get('/search', rateLimit({ name: 'search', windowMs: 60_000, max: 60 }), (req, res) => {
    const outcome = searchPosts(req.query.q, { limit: Number(req.query.limit) || undefined });
    ok(res, {
      query: outcome.query,
      tokens: outcome.tokens,
      total: outcome.total,
      limit: Number(req.query.limit) || 20,
      results: outcome.hits,
    });
  });

  // ===================== Visitor auth =====================

  router.post('/auth/check', rateLimit({ name: 'auth-check', windowMs: 60_000, max: 20 }), (req, res) => {
    if (!requirePasscode(req, res)) return;
    const email = normaliseEmail((req.body as { email?: unknown } | undefined)?.email);
    if (!email) {
      fail(res, 400, 'Missing email');
      return;
    }
    if (!isValidEmail(email)) {
      fail(res, 400, 'Invalid email format');
      return;
    }

    // A real check (the original always answered `registered: false`).
    if (!isRegistered(email)) {
      ok(res, { registered: false, permissions: [], name: '' });
      return;
    }

    const visitor = getVisitor(email);
    setVisitorCookie(res, createVisitorToken(email));
    ok(res, {
      registered: true,
      permissions: visitor?.permissions ?? [],
      name: visitor?.name ?? '',
    });
  });

  router.post('/auth/register', rateLimit({ name: 'auth-register', windowMs: 60_000, max: 5 }), (req, res) => {
    if (!requirePasscode(req, res)) return;
    const body = (req.body ?? {}) as { email?: unknown; name?: unknown };
    const email = normaliseEmail(body.email);
    if (!email) {
      fail(res, 400, 'Missing email');
      return;
    }
    if (!isValidEmail(email)) {
      fail(res, 400, 'Invalid email format');
      return;
    }
    const result = addPending(email, String(body.name ?? ''));
    if (!result.ok) {
      fail(res, 409, result.error ?? 'Registration failed');
      return;
    }
    ok(res, { message: '注册请求已提交，请等待管理员审核' });
  });

  router.post('/auth/logout', (_req, res) => {
    clearVisitorCookie(res);
    ok(res, { message: 'Logged out' });
  });

  // ===================== Calendar (permission gated) =====================

  router.get('/calendar', (req, res) => {
    const email = getVisitorEmail(req);
    if (!email) {
      fail(res, 401, '请先完成邮箱验证');
      return;
    }
    if (!isRegistered(email)) {
      fail(res, 403, '无权限查看日历');
      return;
    }
    if (!hasPermission(email, 'calendar')) {
      fail(res, 403, '无权限查看日历');
      return;
    }
    ok(res, readCalendar());
  });

  // ===================== Avatar upload =====================

  router.post(
    '/upload-avatar',
    upload.single('file'),
    express.text({ type: ['text/plain', 'application/octet-stream'], limit: '10mb' }),
    async (req, res) => {
      const ip = req.ip ?? 'unknown';
      if (hitCounter('avatar', ip, 30_000) > 1) {
        fail(res, 429, '上传太频繁，请30秒后再试');
        return;
      }

      try {
        const buffer = extractImageBuffer(req);
        if (!buffer) {
          fail(res, 400, 'No file data');
          return;
        }
        const avatar = await processAvatar(buffer);
        const mirrored = await mirrorToImghost(avatar.filePath, avatar.filename);
        ok(res, { url: mirrored ?? avatar.url });
      } catch (err) {
        const message = (err as Error).message || '图片处理失败';
        const status = message.includes('太大') || message.includes('无效') ? 400 : 500;
        fail(res, status, message);
      }
    },
  );

  return router;
}

/** Accept multipart, JSON `{image}`, or a raw/base64 text body. */
function extractImageBuffer(req: express.Request): Buffer | null {
  if (req.file?.buffer && req.file.buffer.length > 0) return req.file.buffer;

  const body = req.body as unknown;
  let raw = '';
  if (typeof body === 'string') raw = body;
  else if (body && typeof body === 'object' && typeof (body as { image?: unknown }).image === 'string') {
    raw = (body as { image: string }).image;
  }
  if (!raw) return null;

  // Tolerate a `data:image/png;base64,...` prefix.
  const comma = raw.indexOf(',');
  const payload = raw.startsWith('data:') && comma !== -1 ? raw.slice(comma + 1) : raw;
  try {
    const decoded = Buffer.from(payload, 'base64');
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}
