/**
 * comments.ts — File-based comments, one JSON file per page.
 *
 * `blog/data/comments/<key>.json` holds an array of comments for one page:
 *   { id, nick, mail, comment, link, ua, avatar, url, createTime }
 *
 * This replaces the `comments` table. Files are keyed by a sanitised form of
 * the canonical page path so a URL can never escape the comments directory.
 *
 * "Canonical" matters: the same post is reachable at `/post/x` and `/post/x/`,
 * and the two forms used to land in two different files. See
 * `canonicalCommentPath()`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { COMMENTS_DIR, ensureDir } from '../paths.ts';
import { safeFilename, str } from '../lib/text.ts';

export interface Comment {
  id: number;
  nick: string;
  mail: string;
  comment: string;
  link: string;
  ua: string;
  avatar: string;
  url: string;
  createTime: number;
}

interface CacheEntry {
  mtimeMs: number;
  comments: Comment[];
}

const cache = new Map<string, CacheEntry>();

/**
 * Canonical storage key for a page path.
 *
 * A page has more than one URL. Express treats the trailing slash as optional,
 * so the server answers both `/post/x` and `/post/x/`; the static build writes
 * `dist/post/x/index.html`, which a static host serves at `/post/x/` and
 * redirects the bare form to. The client keys its request on
 * `window.location.pathname`, so a reader who clicks a post (pjax keeps the URL
 * as linked, `/post/x`) and one who reloads it (the static host sends them to
 * `/post/x/`) were writing to two different files — a comment posted on one of
 * them simply did not exist on the other.
 *
 * So the path is canonicalised before it becomes a filename: query/fragment
 * dropped, duplicate slashes collapsed, trailing slash removed. Every form of a
 * page therefore maps onto one thread. Returns '' for anything that is not a
 * site path, which is how a caller learns the value cannot be a key.
 */
export function canonicalCommentPath(value: unknown): string {
  const raw = str(value);
  if (!raw) return '';
  const cleaned = raw.split('#')[0]!.split('?')[0]!.trim();
  // Site paths only: this rejects absolute URLs, `//host/…` (protocol-relative)
  // and schemes such as `javascript:`, all of which are also the values that
  // would be dangerous to render into a link later on.
  if (!cleaned.startsWith('/') || cleaned.startsWith('//')) return '';
  const collapsed = cleaned.replace(/\/{2,}/g, '/');
  const trimmed = collapsed.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

function fileFor(key: string): string {
  return path.join(COMMENTS_DIR, `${safeFilename(key)}.json`);
}

/**
 * Where a page's comments were stored before the key was canonicalised — i.e.
 * the trailing-slash form of the same page. Existing threads keep loading from
 * there and are migrated into the canonical file by `addComment()`.
 */
function legacyFileFor(key: string): string | null {
  return key === '/' ? null : fileFor(`${key}/`);
}

function readFile(file: string): Comment[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    cache.delete(file);
    return [];
  }
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.comments;

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Comment[];
    const comments = Array.isArray(parsed) ? parsed.map(normalise) : [];
    comments.sort((a, b) => a.createTime - b.createTime || a.id - b.id);
    cache.set(file, { mtimeMs: stat.mtimeMs, comments });
    return comments;
  } catch (err) {
    console.error(`[comments] corrupt file ${file}:`, (err as Error).message);
    return [];
  }
}

function normalise(raw: Partial<Comment>): Comment {
  return {
    id: Number(raw.id) || 0,
    nick: str(raw.nick),
    mail: str(raw.mail),
    comment: str(raw.comment),
    link: str(raw.link),
    ua: str(raw.ua),
    avatar: str(raw.avatar),
    url: str(raw.url),
    createTime: Number(raw.createTime ?? (raw as { create_time?: unknown }).create_time) || 0,
  };
}

function writeFile(file: string, comments: Comment[]): void {
  ensureDir(COMMENTS_DIR);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(comments, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  cache.delete(file);
}

/**
 * Comments for one canonical key, falling back to the pre-canonicalisation
 * file when the canonical one does not exist yet.
 */
function readPage(key: string): Comment[] {
  const file = fileFor(key);
  if (fs.existsSync(file)) return readFile(file);
  const legacy = legacyFileFor(key);
  return legacy !== null && fs.existsSync(legacy) ? readFile(legacy) : [];
}

/** Comments for one page path, oldest first. Accepts any URL form of the page. */
export function listComments(url: string): Comment[] {
  const key = canonicalCommentPath(url);
  if (!key) return [];
  return readPage(key);
}

export function countComments(url: string): number {
  return listComments(url).length;
}

export interface CommentInput {
  nick?: unknown;
  mail?: unknown;
  comment?: unknown;
  link?: unknown;
  ua?: unknown;
  avatar?: unknown;
  url?: unknown;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  comment?: Comment;
}

const MAX_NICK = 80;
const MAX_MAIL = 200;
const MAX_LINK = 300;
const MAX_COMMENT = 5000;
/**
 * Page path limit. The path becomes a filename, and a filename component may
 * not exceed 255 bytes; `safeFilename` maps every non-ASCII byte to `_`, so the
 * character count is the byte count here. 200 + ".json" stays well clear.
 */
const MAX_URL = 200;

/**
 * Canonical https URL for the optional 网站 field, or '' when the value cannot
 * be one.
 *
 * The field is labelled 网站（可选）and the obvious thing to type is a bare host
 * (`example.com`), which is exactly what the previous rule refused: it demanded
 * a scheme and threw the whole comment away otherwise — "网站链接必须以
 * http(s):// 开头" surfaced to the visitor as a bare "提交失败". A bare host is
 * therefore promoted to https instead of rejected.
 *
 * Anything else is still refused, because the value becomes an `href` in the
 * admin console: `javascript:`, `data:`, `mailto:`, protocol-relative `//host`
 * and plain-http links never get stored.
 */
export function normaliseCommentLink(value: unknown): string {
  const link = str(value).slice(0, MAX_LINK);
  if (!link) return '';
  if (/^https?:\/\//i.test(link)) return link;
  // host.tld, optionally followed by a path — `[^@\s:]` keeps scheme-like
  // prefixes (`javascript:`) out, since a colon is not allowed before the path.
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(link)) return '';
  return `https://${link}`;
}

/** Validate a comment submission. Length limits are new — the original had none. */
export function validateComment(input: CommentInput): ValidationResult {
  const nick = str(input.nick);
  const mail = str(input.mail);
  const body = str(input.comment);
  // Canonicalised here as well as in the store, so what is validated is exactly
  // what will be stored: `/post/x/` and `/post/x` are one thread.
  const url = canonicalCommentPath(input.url);

  if (!nick || !mail || !body) return { ok: false, error: 'Missing required fields' };
  // The comment has to belong to a page on this site: `url` is the storage key
  // and is rendered as a link in the admin console, so an absolute URL, a
  // protocol-relative `//host/…` or a `javascript:` URL is rejected rather than
  // stored.
  if (!url) return { ok: false, error: '评论必须属于本站的一个页面路径（如 /post/hello）' };
  if (url.length > MAX_URL) return { ok: false, error: `页面路径过长（最多 ${MAX_URL} 字符）` };
  if (nick.length > MAX_NICK) return { ok: false, error: `昵称过长（最多 ${MAX_NICK} 字符）` };
  if (mail.length > MAX_MAIL) return { ok: false, error: `邮箱过长（最多 ${MAX_MAIL} 字符）` };
  if (body.length > MAX_COMMENT) return { ok: false, error: `评论过长（最多 ${MAX_COMMENT} 字符）` };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return { ok: false, error: '邮箱格式不正确' };

  const linkInput = str(input.link);
  const link = normaliseCommentLink(linkInput);
  if (linkInput && !link) return { ok: false, error: '网站格式不正确，可以只填 example.com' };

  // The avatar URL is stored verbatim and later assigned to `img.src`, so
  // restrict it to same-origin paths (the uploader writes to /avatars/) or
  // https links. This blocks `javascript:`, `data:` and plain-http URLs from
  // ever entering the comment store.
  const avatar = str(input.avatar).slice(0, MAX_LINK);
  if (avatar && !avatar.startsWith('/avatars/') && !/^https:\/\//i.test(avatar)) {
    return { ok: false, error: '头像地址必须为站内 /avatars/ 路径或 https:// 链接' };
  }

  const createTime = Math.floor(Date.now() / 1000);
  return {
    ok: true,
    comment: {
      id: Date.now(),
      nick,
      mail,
      comment: body,
      link,
      ua: str(input.ua).slice(0, 500),
      avatar,
      url,
      createTime,
    },
  };
}

/**
 * Append a comment to its page file.
 *
 * The target file is derived from the canonical path, so a comment written from
 * any URL form of the page joins the one thread. A thread that still lives in
 * the pre-canonicalisation (trailing-slash) file is migrated by this write: its
 * rows are included above and the old file is removed, otherwise the admin list
 * would show every one of them twice.
 */
export function addComment(comment: Comment): Comment {
  const key = canonicalCommentPath(comment.url);
  if (!key) throw new Error(`a comment needs a site page path, got "${comment.url}"`);

  const file = fileFor(key);
  const comments = readPage(key);
  // Guarantee a unique id even for comments posted in the same millisecond.
  let id = comment.id;
  while (comments.some((c) => c.id === id)) id += 1;
  const stored = { ...comment, id, url: key };
  comments.push(stored);
  writeFile(file, comments);

  const legacy = legacyFileFor(key);
  if (legacy !== null && fs.existsSync(legacy)) {
    try {
      fs.unlinkSync(legacy);
      cache.delete(legacy);
    } catch (err) {
      console.warn(`[comments] could not retire ${legacy}:`, (err as Error).message);
    }
  }
  return stored;
}

/** Every comment across every page, newest first (admin view). */
export function listAllComments(): Comment[] {
  ensureDir(COMMENTS_DIR);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(COMMENTS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const all: Comment[] = [];
  for (const entry of entries) {
    all.push(...readFile(path.join(COMMENTS_DIR, entry)));
  }
  return all.sort((a, b) => b.createTime - a.createTime || b.id - a.id);
}

/** Delete a comment by id across all pages. */
export function deleteComment(id: number): boolean {
  ensureDir(COMMENTS_DIR);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(COMMENTS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return false;
  }
  for (const entry of entries) {
    const file = path.join(COMMENTS_DIR, entry);
    const comments = readFile(file);
    const index = comments.findIndex((c) => c.id === id);
    if (index === -1) continue;
    comments.splice(index, 1);
    if (comments.length === 0) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
      cache.delete(file);
    } else {
      writeFile(file, comments);
    }
    return true;
  }
  return false;
}

export function countAllComments(): number {
  return listAllComments().length;
}
