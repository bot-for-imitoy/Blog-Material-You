/**
 * admin-api.ts — JSON API for the admin console (mounted at `/api/admin`).
 *
 * Conventions (identical to the public API so the frontend has one shape):
 *   success → `{ errno: 0, data: ... }`
 *   failure → `{ errno: -1, errmsg: '...' }` (HTTP 400 for validation, 401 for
 *             auth, 500 for unexpected errors)
 *
 * The rewrite replaced MySQL with Markdown files, so every mutation calls
 * `invalidateAll()` to drop the parsed-file cache. That makes the next render
 * see the new content immediately — the original needed an explicit
 * `/api/admin/reload` round trip, and a forgotten reload meant stale pages.
 * `/reload` is kept for compatibility and for hand-edited files.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Request, Response, Router } from 'express';

import { rateLimit } from '../lib/ratelimit.ts';
import { safeFilename, str } from '../lib/text.ts';
import { getSessionToken, consumeTempToken, createSession, createTempToken, destroyAllSessions, destroySession, setSessionCookie, clearSessionCookie } from '../auth/session.ts';
import { generateSecret, provisioningUri, verifyTotp } from '../auth/totp.ts';
import { MIN_PASSWORD_LENGTH, USERNAME_PATTERN, WEAK_PASSWORDS } from '../auth/password.ts';
import { getUser, isSetupDone, setCredentials, verifyCredentials } from '../store/credentials.ts';
import { confirmEnable, disable, getActiveSecret, getPendingSecret, isTotpEnabled, startEnable } from '../store/totp-state.ts';
import { createPost, deletePost, listPosts, toggleArchive, updatePost } from '../content/posts.ts';
import { deletePage, listPages, savePage } from '../content/pages.ts';
import { addTalk, deleteTalk, listTalks, parseTalkId, updateTalk } from '../content/talks.ts';
import { addFriend, deleteFriend, listFriends, parseFriendId, publicFriend, publicFriends, updateFriend } from '../content/friends.ts';
import { invalidateAll, isSafeSlug } from '../content/markdown-files.ts';
import { deleteComment, listAllComments } from '../store/comments.ts';
import { invalidateSearchIndex } from '../lib/search.ts';
import { patchConfigFile } from '../lib/config-write.ts';
import { getSiteSettings } from '../site-config.ts';
import { PERMISSIONS, approvePending, isValidEmail, listPending, listVisitors, normaliseEmail, removePending, removeVisitor, setVisitor } from '../store/visitors.ts';
import { maskImghostConfig, readImghostConfig, saveImghostConfig, type ImghostConfig } from '../store/imghost-config.ts';
import { testConnection, upload, uploadKey } from '../media/imghost.ts';
import { backupFilename, exportBackup, importBackup, serializeBackup } from '../lib/backup.ts';
import { adminApiHandler, requireAdmin, resolveAdminUser } from '../middleware/admin-auth.ts';

/** Issuer shown in authenticator apps; kept stable so existing entries match. */
const TOTP_ISSUER = 'BlogMaterialYou';

// The password/username policy lives in src/auth/password.ts so the setup API,
// the password-change API and `npm run passwd-reset` cannot drift apart.


// ===================== Response helpers =====================

function ok(res: Response, data: unknown): void {
  res.json({ errno: 0, data });
}

/** Failure response. `status` is 200 for the legacy "soft error" shape. */
function fail(res: Response, status: number, errmsg: string): void {
  res.status(status).json({ errno: -1, errmsg });
}

/** Parse a JSON request body, tolerating a raw string/Buffer body. */
function bodyOf(req: Request): Record<string, unknown> {
  const raw = (req as Request & { body?: unknown }).body;
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim() !== '') return JSON.parse(raw) as Record<string, unknown>;
  if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
  return {};
}

/**
 * Validate the slug of a content mutation.
 * Returns the slug, or null after having already sent a 400 response.
 */
function takeSlug(res: Response, value: unknown): string | null {
  const slug = str(value);
  if (slug === '') {
    fail(res, 400, 'Missing slug');
    return null;
  }
  if (!isSafeSlug(slug)) {
    fail(res, 400, 'Invalid slug');
    return null;
  }
  return slug;
}

/**
 * Same username rule for first-run setup and for later renames.
 * Rejecting `:` fixes a token-corruption bug: the old token payload joined
 * fields with colons, so a username containing one produced a token that could
 * never be verified again.
 */
function validateAdminUser(user: string): string | null {
  if (user.includes(':') || !USERNAME_PATTERN.test(user)) {
    return '用户名只能包含字母、数字、下划线、点或短横线（1-64 位）';
  }
  return null;
}

export function createAdminApiRouter(): Router {
  const router = express.Router();

  // Requests bodies are JSON everywhere; a generous limit keeps a full-site
  // import (base64 images, long posts) working. Mounting the parser here keeps
  // the router self-contained: express.json() is a no-op when the app already
  // parsed the body.
  router.use(express.json({ limit: '100mb' }));

  // Nginx used to rate limit these routes; the limiter now lives in-process.
  const loginLimit = rateLimit({ name: 'admin-login', windowMs: 60_000, max: 30 });
  const setupLimit = rateLimit({ name: 'admin-setup', windowMs: 60_000, max: 30 });

  // ===================== Authentication =====================

  /**
   * POST /login — single-step, or two-step when TOTP is enabled.
   *
   * Public route: it must NOT sit behind `requireAdmin`.
   *   body {username, password}            → session cookie + {token,user}
   *   body {step:2, tempToken, totp}       → session cookie + {token,user}
   * The intermediate password step returns a one-time tempToken instead of a
   * session, so a stolen password alone is still not enough to log in.
   */
  router.post('/login', loginLimit, adminApiHandler(async (req, res) => {
    if (!isSetupDone()) {
      // Soft error (200): the frontend redirects to the setup wizard on errno -1.
      fail(res, 200, '管理员尚未初始化，请先访问 /admin/setup/ 进行初始化');
      return;
    }

    const body = bodyOf(req);
    const stepRaw = body.step;
    const step = stepRaw === undefined || stepRaw === null || stepRaw === '' ? 1 : Number(stepRaw);
    const twoFactor = isTotpEnabled();

    if (!twoFactor) {
      // 2FA disabled → the password is the whole story.
      const username = str(body.username);
      const password = str(body.password);
      const check = await verifyCredentials(username, password);
      if (!check.ok) {
        fail(res, 401, '用户名或密码错误');
        return;
      }
      const token = createSession(username);
      setSessionCookie(res, token);
      ok(res, { token, user: username });
      return;
    }

    if (step !== 1 && step !== 2) {
      fail(res, 400, 'Invalid step');
      return;
    }

    if (step === 1) {
      const username = str(body.username);
      const check = await verifyCredentials(username, str(body.password));
      if (!check.ok) {
        fail(res, 401, '用户名或密码错误');
        return;
      }
      // No cookie yet — only a short-lived, single-use handshake token.
      const tempToken = createTempToken(username);
      ok(res, { step: 2, tempToken, user: username });
      return;
    }

    // step 2: the temp token is consumed first, so a wrong code burns it and an
    // attacker cannot keep guessing TOTP codes against the same handshake.
    const username = consumeTempToken(str(body.tempToken));
    if (!username) {
      fail(res, 401, '会话已过期，请重新登录');
      return;
    }
    const result = verifyTotp(getActiveSecret(), str(body.totp));
    if (!result.ok) {
      fail(res, 401, result.reason ?? '验证码错误，请重试');
      return;
    }
    const token = createSession(username);
    setSessionCookie(res, token);
    ok(res, { token, user: username });
  }));

  /** GET /setup — is the first-run wizard still needed? */
  router.get('/setup', adminApiHandler((_req, res) => {
    const setupDone = isSetupDone();
    ok(res, { setupDone, user: setupDone ? getUser() : null });
  }));

  /**
   * POST /setup — `{action:'init'}` first run, `{action:'change'}` later edits.
   * Public by necessity (init), but `change` verifies the session itself.
   */
  router.post('/setup', setupLimit, adminApiHandler(async (req, res) => {
    const body = bodyOf(req);
    const action = str(body.action);

    if (action === 'init') {
      if (isSetupDone()) {
        fail(res, 200, '管理员已初始化，不可重复设置');
        return;
      }
      const user = str(body.user);
      const password = str(body.password);
      if (user === '' || password === '') {
        fail(res, 400, '用户名和密码不能为空');
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        fail(res, 400, '密码长度不少于6位');
        return;
      }
      if (WEAK_PASSWORDS.includes(password.toLowerCase())) {
        fail(res, 400, '密码过于简单，请使用更安全的密码');
        return;
      }
      const userError = validateAdminUser(user);
      if (userError) {
        fail(res, 400, userError);
        return;
      }
      setCredentials(user, password);
      ok(res, { setupDone: true, user });
      return;
    }

    if (action === 'change') {
      // This route is public, so the session check is done explicitly here
      // rather than via `requireAdmin` (which would break the init flow).
      const token = getSessionToken(req);
      const sessionUser = resolveAdminUser(req);
      if (!token) {
        fail(res, 401, '请先登录后再修改密码');
        return;
      }
      if (!sessionUser) {
        fail(res, 401, '会话已过期，请重新登录');
        return;
      }
      if (!isSetupDone()) {
        fail(res, 200, '管理员未初始化');
        return;
      }

      const oldPassword = str(body.oldPassword);
      const newPassword = str(body.newPassword);
      if (oldPassword === '') {
        fail(res, 400, '请输入当前密码');
        return;
      }
      if (newPassword === '') {
        fail(res, 400, '请输入新密码');
        return;
      }
      if (newPassword.length < 6) {
        fail(res, 400, '新密码长度不少于6位');
        return;
      }

      // The stored username is authoritative: after a rename every session was
      // revoked, so any live session must belong to the current user.
      const currentUser = getUser();
      const check = await verifyCredentials(currentUser, oldPassword);
      if (!check.ok) {
        fail(res, 400, '当前密码错误');
        return;
      }

      // `newUser` is optional. An empty/whitespace-only value keeps the stored
      // username — the original Lua version treated '' as truthy and blanked it.
      const requested = str(body.newUser).trim();
      const effectiveUser = requested === '' ? currentUser : requested;
      const userError = validateAdminUser(effectiveUser);
      if (userError) {
        fail(res, 400, userError);
        return;
      }

      setCredentials(effectiveUser, newPassword);
      // A password/username change invalidates every outstanding token so a
      // stolen session cannot outlive the credentials it was minted for.
      destroyAllSessions();
      ok(res, { user: effectiveUser });
      return;
    }

    fail(res, 400, `Unknown action: ${action}`);
  }));

  /** POST /logout — revoke the current token and clear the cookie. */
  router.post('/logout', adminApiHandler((req, res) => {
    destroySession(getSessionToken(req));
    clearSessionCookie(res);
    ok(res, { message: 'Logged out' });
  }));

  // ===================== Posts =====================

  /** GET /posts — every post including body and archived ones (admin view). */
  router.get('/posts', requireAdmin, adminApiHandler((_req, res) => {
    ok(res, listPosts());
  }));

  /** POST /posts — create. */
  router.post('/posts', requireAdmin, adminApiHandler((req, res) => {
    const body = bodyOf(req);
    const slug = takeSlug(res, body.slug);
    if (slug === null) return;
    try {
      createPost({
        slug,
        title: body.title,
        titleEn: body.titleEn,
        content: body.content,
        contentEn: body.contentEn,
        date: body.date,
        tags: body.tags,
        categories: body.categories,
        cover: body.cover,
        archived: body.archived,
      });
    } catch (err) {
      fail(res, 400, err instanceof Error ? err.message : '保存失败');
      return;
    }
    invalidateAll();
    ok(res, { slug });
  }));

  /** PUT /posts — update an existing post. */
  router.put('/posts', requireAdmin, adminApiHandler((req, res) => {
    const body = bodyOf(req);
    const slug = takeSlug(res, body.slug);
    if (slug === null) return;
    try {
      updatePost({
        slug,
        title: body.title,
        titleEn: body.titleEn,
        content: body.content,
        contentEn: body.contentEn,
        date: body.date,
        tags: body.tags,
        categories: body.categories,
        cover: body.cover,
        archived: body.archived,
      });
    } catch (err) {
      fail(res, 400, err instanceof Error ? err.message : '保存失败');
      return;
    }
    invalidateAll();
    ok(res, { slug });
  }));

  /** PATCH /posts — toggle the archived flag. */
  router.patch('/posts', requireAdmin, adminApiHandler((req, res) => {
    const slug = takeSlug(res, bodyOf(req).slug);
    if (slug === null) return;
    const post = toggleArchive(slug);
    if (!post) {
      fail(res, 404, 'Post not found');
      return;
    }
    invalidateAll();
    ok(res, { slug, archived: post.archived });
  }));

  /** DELETE /posts?slug= — remove a post file. */
  router.delete('/posts', requireAdmin, adminApiHandler((req, res) => {
    const slug = takeSlug(res, req.query.slug);
    if (slug === null) return;
    if (!deletePost(slug)) {
      fail(res, 404, 'Post not found');
      return;
    }
    invalidateAll();
    ok(res, { slug });
  }));

  // ===================== Pages =====================

  router.get('/pages', requireAdmin, adminApiHandler((_req, res) => {
    ok(res, listPages());
  }));

  /** PUT /pages — upsert (the editor has no separate create route). */
  router.put('/pages', requireAdmin, adminApiHandler((req, res) => {
    const body = bodyOf(req);
    const slug = takeSlug(res, body.slug);
    if (slug === null) return;
    try {
      savePage({ slug, title: body.title, titleEn: body.titleEn, content: body.content, contentEn: body.contentEn });
    } catch (err) {
      fail(res, 400, err instanceof Error ? err.message : '保存失败');
      return;
    }
    invalidateAll();
    ok(res, { slug });
  }));

  router.delete('/pages', requireAdmin, adminApiHandler((req, res) => {
    const slug = takeSlug(res, req.query.slug);
    if (slug === null) return;
    if (!deletePage(slug)) {
      fail(res, 404, 'Page not found');
      return;
    }
    invalidateAll();
    ok(res, { slug });
  }));

  // ===================== Talks =====================

  router.get('/talks', requireAdmin, adminApiHandler((_req, res) => {
    ok(res, listTalks());
  }));

  router.post('/talks', requireAdmin, adminApiHandler((req, res) => {
    const content = str(bodyOf(req).content);
    if (content === '') {
      fail(res, 400, '内容不能为空');
      return;
    }
    const talk = addTalk(content);
    invalidateAll();
    ok(res, talk);
  }));

  router.put('/talks', requireAdmin, adminApiHandler((req, res) => {
    const body = bodyOf(req);
    const id = parseTalkId(body.id);
    if (id === null) {
      fail(res, 400, 'Invalid id');
      return;
    }
    const talk = updateTalk(id, body.content);
    if (!talk) {
      fail(res, 404, 'Talk not found');
      return;
    }
    invalidateAll();
    ok(res, talk);
  }));

  router.delete('/talks', requireAdmin, adminApiHandler((req, res) => {
    const id = parseTalkId(req.query.id);
    if (id === null) {
      fail(res, 400, 'Invalid id');
      return;
    }
    if (!deleteTalk(id)) {
      fail(res, 404, 'Talk not found');
      return;
    }
    invalidateAll();
    ok(res, { id });
  }));

  // ===================== Friends =====================

  router.get('/friends', requireAdmin, adminApiHandler((_req, res) => {
    ok(res, publicFriends(listFriends()));
  }));

  router.post('/friends', requireAdmin, adminApiHandler((req, res) => {
    const body = bodyOf(req);
    if (str(body.title) === '' || str(body.url) === '') {
      fail(res, 400, 'Missing title or url');
      return;
    }
    const friend = addFriend({
      title: body.title,
      url: body.url,
      descr: body.descr,
      titleEn: body.titleEn,
      descrEn: body.descrEn,
      avatar: body.avatar,
      sortOrder: body.sortOrder,
    });
    invalidateAll();
    ok(res, publicFriend(friend));
  }));

  router.put('/friends', requireAdmin, adminApiHandler((req, res) => {
    const body = bodyOf(req);
    const id = parseFriendId(body.id);
    if (id === null) {
      fail(res, 400, 'Invalid id');
      return;
    }
    try {
      updateFriend(id, {
        title: body.title,
        url: body.url,
        descr: body.descr,
        titleEn: body.titleEn,
        descrEn: body.descrEn,
        avatar: body.avatar,
        sortOrder: body.sortOrder,
      });
    } catch (err) {
      fail(res, 404, err instanceof Error ? err.message : 'Friend link not found');
      return;
    }
    invalidateAll();
    ok(res, { id });
  }));

  router.delete('/friends', requireAdmin, adminApiHandler((req, res) => {
    const id = parseFriendId(req.query.id);
    if (id === null) {
      fail(res, 400, 'Invalid id');
      return;
    }
    if (!deleteFriend(id)) {
      fail(res, 404, 'Friend link not found');
      return;
    }
    invalidateAll();
    ok(res, { id });
  }));

  // ===================== Comments =====================

  /** GET /comments — every comment across all pages, newest first. */
  router.get('/comments', requireAdmin, adminApiHandler((_req, res) => {
    ok(res, listAllComments());
  }));

  router.delete('/comments', requireAdmin, adminApiHandler((req, res) => {
    const id = Number.parseInt(str(req.query.id), 10);
    if (!Number.isFinite(id)) {
      fail(res, 400, 'Invalid id');
      return;
    }
    deleteComment(id);
    invalidateAll();
    ok(res, { deleted: true });
  }));

  // ===================== Visitors (new in the rewrite) =====================

  /**
   * GET /visitors — approved visitors, the pending queue and the catalogue of
   * permission names. The original required manual SQL surgery for approvals;
   * everything is manageable from the console now.
   */
  router.get('/visitors', requireAdmin, adminApiHandler((_req, res) => {
    ok(res, {
      visitors: listVisitors(),
      pending: listPending(),
      permissions: [...PERMISSIONS],
    });
  }));

  /** POST /visitors — create or update an approved visitor. */
  router.post('/visitors', requireAdmin, adminApiHandler((req, res) => {
    const body = bodyOf(req);
    const email = normaliseEmail(body.email);
    if (email === '' || !isValidEmail(email)) {
      fail(res, 400, '邮箱格式不正确');
      return;
    }
    const permissions = Array.isArray(body.permissions)
      ? body.permissions.map((p) => str(p)).filter((p) => p !== '')
      : [];
    const visitor = setVisitor(email, permissions, str(body.name));
    ok(res, visitor);
  }));

  router.delete('/visitors', requireAdmin, adminApiHandler((req, res) => {
    const email = normaliseEmail(req.query.email);
    if (email === '') {
      fail(res, 400, 'Missing email');
      return;
    }
    ok(res, { deleted: removeVisitor(email) });
  }));

  /** POST /visitors/approve — promote a pending registration. */
  router.post('/visitors/approve', requireAdmin, adminApiHandler((req, res) => {
    const body = bodyOf(req);
    const email = normaliseEmail(body.email);
    if (email === '') {
      fail(res, 400, 'Missing email');
      return;
    }
    const permissions = Array.isArray(body.permissions)
      ? body.permissions.map((p) => str(p)).filter((p) => p !== '')
      : [];
    const visitor = approvePending(email, permissions);
    if (!visitor) {
      fail(res, 404, 'Pending visitor not found');
      return;
    }
    ok(res, visitor);
  }));

  /** DELETE /visitors/pending?email= — reject a registration request. */
  router.delete('/visitors/pending', requireAdmin, adminApiHandler((req, res) => {
    const email = normaliseEmail(req.query.email);
    if (email === '') {
      fail(res, 400, 'Missing email');
      return;
    }
    ok(res, { deleted: removePending(email) });
  }));

  // ===================== TOTP two-factor authentication =====================

  /**
   * GET /totp — current 2FA state.
   *
   * Security: the ACTIVE secret is never returned. Only a pending (not yet
   * confirmed) secret is exposed, because the user must type it into their
   * authenticator app. The original returned the active secret too, which
   * leaked the second factor to anyone with a valid session.
   */
  router.get('/totp', requireAdmin, adminApiHandler((_req, res) => {
    const user = getUser();
    const pending = getPendingSecret();
    ok(res, {
      enabled: isTotpEnabled(),
      hasPending: pending !== '',
      secret: pending,
      provisioningUri: pending === '' ? '' : provisioningUri(pending, user, TOTP_ISSUER),
      user,
      issuer: TOTP_ISSUER,
    });
  }));

  /** POST /totp — `start` | `verify` | `disable`. */
  router.post('/totp', requireAdmin, adminApiHandler((req, res) => {
    const body = bodyOf(req);
    const action = str(body.action);
    const user = getUser();

    if (action === 'start') {
      const secret = generateSecret();
      startEnable(secret);
      ok(res, { secret, provisioningUri: provisioningUri(secret, user, TOTP_ISSUER), user, issuer: TOTP_ISSUER });
      return;
    }

    if (action === 'verify') {
      const pending = getPendingSecret();
      if (pending === '') {
        fail(res, 400, 'No pending setup, please start first');
        return;
      }
      const result = verifyTotp(pending, str(body.code));
      if (!result.ok) {
        fail(res, 400, '验证码错误，请重试');
        return;
      }
      const confirmed = confirmEnable();
      if (!confirmed.ok) {
        fail(res, 400, confirmed.error ?? '启用失败');
        return;
      }
      ok(res, { enabled: true });
      return;
    }

    if (action === 'disable') {
      disable();
      ok(res, { enabled: false });
      return;
    }

    fail(res, 400, `Unknown action: ${action}`);
  }));

  // ===================== Image host =====================

  /** GET /imghost — config with the secret key masked. */
  router.get('/imghost', requireAdmin, adminApiHandler((_req, res) => {
    ok(res, maskImghostConfig(readImghostConfig()));
  }));

  /**
   * PUT /imghost — save the full config.
   * An empty or masked `secret_key` keeps the stored value, so re-saving the
   * form without retyping the secret does not wipe it.
   */
  router.put('/imghost', requireAdmin, adminApiHandler((req, res) => {
    const body = bodyOf(req);
    const current = readImghostConfig();
    const bool = (value: unknown, fallback: boolean): boolean =>
      value === undefined ? fallback : value === true || value === 'true' || value === 1 || value === '1';

    const patch: Partial<ImghostConfig> = {
      enabled: bool(body.enabled, current.enabled),
      provider: body.provider === 's3' ? 's3' : body.provider === 'sftp' ? 'sftp' : current.provider,
      host: str(body.host ?? current.host),
      port: body.port === undefined ? current.port : Number.parseInt(String(body.port), 10) || 22,
      username: str(body.username ?? current.username),
      ssh_key_path: str(body.ssh_key_path ?? current.ssh_key_path),
      remote_dir: str(body.remote_dir ?? current.remote_dir),
      endpoint: str(body.endpoint ?? current.endpoint),
      bucket: str(body.bucket ?? current.bucket),
      access_key: str(body.access_key ?? current.access_key),
      secret_key: str(body.secret_key ?? current.secret_key),
      region: str(body.region ?? current.region),
      prefix: str(body.prefix ?? current.prefix),
      insecure: bool(body.insecure, current.insecure),
      ssl_ca: str(body.ssl_ca ?? current.ssl_ca),
      ssl_cert: str(body.ssl_cert ?? current.ssl_cert),
      ssl_key: str(body.ssl_key ?? current.ssl_key),
      public_url_base: str(body.public_url_base ?? current.public_url_base),
      filename_template: str(body.filename_template ?? current.filename_template) || current.filename_template,
    };

    if (patch.secret_key === '' || patch.secret_key === '********') {
      patch.secret_key = current.secret_key;
    }

    const saved = saveImghostConfig(patch);
    if (!saved.ok) {
      fail(res, 400, saved.error);
      return;
    }
    ok(res, { message: '配置已保存', config: maskImghostConfig(saved.config) });
  }));

  /**
   * POST /imghost — `{action:'test'}` or `{action:'upload', image, filename?}`.
   *
   * `image` is a base64 string (optionally a `data:` URI), matching the old
   * admin frontend. The bytes are staged in a temp file because the media
   * module uploads from disk. Operational failures are returned as soft errors
   * (200 + errno -1) so the UI can show the provider's message.
   */
  router.post('/imghost', requireAdmin, adminApiHandler(async (req, res) => {
    const body = bodyOf(req);
    const action = str(body.action);

    if (action === 'test') {
      const result = await testConnection();
      if (!result.ok) {
        fail(res, 200, result.message || '连接失败');
        return;
      }
      ok(res, { message: result.message || '连接成功' });
      return;
    }

    if (action === 'upload') {
      const image = str(body.image);
      if (image === '') {
        fail(res, 400, '缺少图片数据');
        return;
      }
      // Strip a `data:image/png;base64,` prefix when present.
      const comma = image.indexOf(',');
      const payload = comma >= 0 ? image.slice(comma + 1) : image;
      let buffer: Buffer;
      try {
        buffer = Buffer.from(payload, 'base64');
      } catch {
        fail(res, 400, 'Base64 解码失败');
        return;
      }
      if (buffer.length === 0) {
        fail(res, 400, 'Base64 解码失败');
        return;
      }

      const filename = str(body.filename) || 'image.png';
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmy-imghost-'));
      const tmpFile = path.join(tmpDir, `${crypto.randomBytes(4).toString('hex')}-${safeFilename(filename)}`);
      fs.writeFileSync(tmpFile, buffer);
      try {
        // An explicit `key` lets the caller choose the object path; otherwise
        // the provider applies its configured filename template.
        const key = str(body.key);
        // `upload` derives the object key from the filename template and
        // returns { url, key }; `uploadKey` uses an explicit key and returns
        // just the URL. Normalise both to the same response shape.
        const result =
          key === ''
            ? await upload(tmpFile, filename)
            : { url: await uploadKey(tmpFile, key, filename), key };
        ok(res, result);
      } catch (err) {
        fail(res, 200, err instanceof Error ? err.message : '上传失败');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      return;
    }

    fail(res, 400, `Unknown action: ${action}`);
  }));

  // ===================== Backup =====================

  /** GET /export — download the whole site as one JSON document. */
  router.get('/export', requireAdmin, adminApiHandler(async (_req, res) => {
    const doc = await exportBackup();
    res.setHeader('Content-Disposition', `attachment; filename="${backupFilename()}"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(serializeBackup(doc));
  }));

  /**
   * POST /import — restore from a backup document.
   * The body is the raw JSON document; validation errors from `importBackup`
   * are reported verbatim with a 400 so the UI can explain what was wrong.
   */
  router.post('/import', requireAdmin, adminApiHandler(async (req, res) => {
    const raw = (req as Request & { body?: unknown }).body;
    let payload: unknown = raw;
    if (typeof raw === 'string') {
      try {
        payload = JSON.parse(raw);
      } catch {
        fail(res, 400, '备份文件不是有效的 JSON');
        return;
      }
    } else if (Buffer.isBuffer(raw)) {
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        fail(res, 400, '备份文件不是有效的 JSON');
        return;
      }
    }
    if (!payload || typeof payload !== 'object') {
      fail(res, 400, '备份文件不是有效的 JSON');
      return;
    }
    try {
      const { summary } = await importBackup(payload);
      invalidateAll();
      ok(res, { summary });
    } catch (err) {
      fail(res, 400, err instanceof Error ? err.message : '导入失败');
    }
  }));

  /**
   * POST /reload — drop every cached Markdown parse.
   * Mutations already do this; the endpoint remains for hand-edited files and
   * for clients written against the old API.
   */
  router.post('/reload', requireAdmin, adminApiHandler((_req, res) => {
    invalidateAll();
    // The search index is keyed by file mtimes and would normally refresh on
    // its own; this makes an explicit reload authoritative.
    invalidateSearchIndex();
    ok(res, {
      posts: listPosts().length,
      pages: listPages().length,
      talks: listTalks().length,
      friends: listFriends().length,
      comments: listAllComments().length,
    });
  }));

  // ===================== Site settings =====================

  /**
   * The subset of `_config.yml` the admin console can edit.
   * Every entry maps a request field to a key path in the YAML file.
   */
  const EDITABLE_SETTINGS: Array<{ key: string; path: string[]; kind: 'text' | 'list' | 'color' | 'url' | 'language' }> = [
    { key: 'title', path: ['title'], kind: 'text' },
    { key: 'subtitle', path: ['subtitle'], kind: 'text' },
    { key: 'description', path: ['description'], kind: 'text' },
    { key: 'keywords', path: ['keywords'], kind: 'list' },
    { key: 'author', path: ['author'], kind: 'text' },
    { key: 'language', path: ['language'], kind: 'language' },
    { key: 'url', path: ['url'], kind: 'url' },
    { key: 'avatar', path: ['avatar'], kind: 'text' },
    { key: 'copyright', path: ['copyright'], kind: 'text' },
    { key: 'github', path: ['github'], kind: 'url' },
    { key: 'themeColor', path: ['theme', 'color'], kind: 'color' },
  ];

  /** Accept `#rgb`/`#rrggbb`/`#rrggbbaa`, a CSS colour function, or a name. */
  const COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([0-9a-zA-Z%.,\s/+-]*\))$/;
  const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

  function coerceSetting(
    field: (typeof EDITABLE_SETTINGS)[number],
    raw: unknown,
  ): { ok: true; value: string | string[] } | { ok: false; error: string } {
    if (field.kind === 'list') {
      const list = Array.isArray(raw)
        ? raw.map((v) => str(v)).filter(Boolean)
        : str(raw).split(',').map((v) => v.trim()).filter(Boolean);
      return { ok: true, value: list };
    }

    const value = str(raw);
    switch (field.kind) {
      case 'color':
        if (!COLOR_PATTERN.test(value)) {
          return { ok: false, error: `${field.key} 不是有效的颜色值（示例：#ff006a、rgb(255,0,106)、tomato）` };
        }
        return { ok: true, value };
      case 'url':
        if (value !== '' && !/^https?:\/\/\S+$/i.test(value)) {
          return { ok: false, error: `${field.key} 必须以 http:// 或 https:// 开头` };
        }
        return { ok: true, value };
      case 'language':
        if (!LANGUAGE_PATTERN.test(value)) {
          return { ok: false, error: `${field.key} 不是有效的语言标签（示例：zh-CN、en）` };
        }
        return { ok: true, value };
      default:
        return { ok: true, value };
    }
  }

  /** GET /settings — the current, editable site configuration. */
  router.get('/settings', requireAdmin, adminApiHandler((_req, res) => {
    const settings = getSiteSettings();
    ok(res, {
      values: {
        title: settings.title,
        subtitle: settings.subtitle,
        description: settings.description,
        keywords: settings.keywords,
        author: settings.author,
        language: settings.language,
        url: settings.url,
        avatar: settings.avatar,
        copyright: settings.copyright,
        github: settings.github,
        themeColor: settings.themeColor,
      },
      // Feature switches and list lengths are editable in the file but not on
      // the settings form, so surface them read-only for context.
      features: settings.features,
      excerpt: settings.excerpt,
      rssLimit: settings.rssLimit,
    });
  }));

  /**
   * PUT /settings — persist a subset of the site configuration.
   *
   * The change is written back into `_config.yml` itself (comments preserved,
   * validated before writing) so the file stays the single source of truth
   * rather than an admin-only override store appearing next to it.
   */
  router.put('/settings', requireAdmin, adminApiHandler((req, res) => {
    const body = bodyOf(req);
    const updates: Array<{ path: string[]; value: string | string[] }> = [];

    for (const field of EDITABLE_SETTINGS) {
      if (!(field.key in body)) continue;
      const coerced = coerceSetting(field, body[field.key]);
      if (!coerced.ok) {
        fail(res, 400, coerced.error);
        return;
      }
      updates.push({ path: field.path, value: coerced.value });
    }

    if (updates.length === 0) {
      fail(res, 400, '没有需要保存的配置项');
      return;
    }

    try {
      const changed = patchConfigFile(updates);
      ok(res, { changed, message: '配置已保存到 _config.yml' });
    } catch (err) {
      // patchConfigFile refuses to write anything it cannot round-trip, so the
      // file on disk is still intact when this branch runs.
      fail(res, 500, `保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }));

  return router;
}
