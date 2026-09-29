/**
 * backup.ts — Single-file JSON backup (export) and destructive restore (import).
 *
 * The previous OpenResty implementation dumped every MariaDB table into one JSON
 * document (`{app, version, exported_at, tables}`). The rewrite is file-based, so
 * the same "one JSON file" contract is kept, but the sections now mirror the
 * on-disk layout instead of SQL tables:
 *
 *   content.posts / pages / talks / friends → Markdown files under `blog/`
 *   data.comments → `blog/data/comments/*.json`
 *   data.visitors → `blog/data/visitors.json`
 *   data.site     → `blog/data/site.json`
 *   data.calendar → `blog/data/calendar.json`
 *   data.admin / totp / imghost → credential material (`admin.json`, `totp.json`,
 *                                 `imghost.json` in `blog/data/`)
 *
 * ⚠️ SECURITY: a backup contains the admin password verifier (scrypt salt+hash),
 * the TOTP shared secret and the S3/SFTP image-host keys. The file must be
 * treated as a secret: never commit it, never serve it unauthenticated, and
 * delete it once it is no longer needed. `importBackup` therefore exposes an
 * `includeCredentials` switch so a restore can deliberately skip that material.
 *
 * Restore is destructive (like the original `DELETE FROM <table>` import):
 * a section that is present in the payload replaces the existing data, while a
 * section that is absent leaves the current data untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { COMMENTS_DIR, DATA_DIR, FRIENDS_DIR, PAGES_DIR, POSTS_DIR, TALKS_DIR } from '../paths.ts';
import { str } from './text.ts';
import {
  atomicWriteFile,
  invalidateAll,
  isSafeSlug,
  scanMarkdownDir,
  writeMarkdownFile,
} from '../content/markdown-files.ts';
import { addFriend, deleteFriend, listFriends } from '../content/friends.ts';
import { deletePage, listPages } from '../content/pages.ts';
import { deletePost, listPosts } from '../content/posts.ts';
import { deleteTalk, listTalks } from '../content/talks.ts';
import { addComment, listAllComments } from '../store/comments.ts';
import { credentialsStore } from '../store/credentials.ts';
import { totpStore } from '../store/totp-state.ts';
import { visitorsStore } from '../store/visitors.ts';
import { getSiteSettings, siteStore } from '../site-config.ts';
import type { FriendInput } from '../content/friends.ts';
import type { Comment } from '../store/comments.ts';
import type { CredentialsFile } from '../store/credentials.ts';
import type { TotpState } from '../store/totp-state.ts';
import type { VisitorsFile } from '../store/visitors.ts';
import type { SiteSettings } from '../site-config.ts';

/** Marker + format version. Bumped from the old `tables`-based dump (v1). */
const APP_NAME = 'blog-material-you';
const BACKUP_VERSION = 2;

/**
 * Calendar + image-host state. The calendar store is a plain JSON array that may
 * not exist yet, so it is read defensively rather than through a JsonStore
 * (JsonStore merges objects and would corrupt an array on read).
 */
const CALENDAR_FILE = path.join(DATA_DIR, 'calendar.json');
const IMGHOST_FILE = path.join(DATA_DIR, 'imghost.json');

/** One calendar event, matching the `calendar_events` table of the old schema. */
export interface CalendarEvent {
  id: number;
  title: string;
  date: string;
  description: string;
  color: string;
  createdAt: number;
}

/** Shape of the backup document (type alias so it stays assignable to Record). */
export type BackupDocument = {
  app: string;
  version: number;
  exportedAt: number;
  content: {
    posts: Array<{ slug: string; frontmatter: Record<string, unknown>; body: string }>;
    pages: Array<{ slug: string; frontmatter: Record<string, unknown>; body: string }>;
    talks: Array<{ id: number; createTime: number; content: string }>;
    friends: Array<{
      id: number;
      title: string;
      descr: string;
      titleEn: string;
      descrEn: string;
      avatar: string;
      url: string;
      sortOrder: number;
    }>;
  };
  data: {
    comments: Comment[];
    visitors: VisitorsFile;
    site: SiteSettings;
    calendar: CalendarEvent[];
    admin: Record<string, unknown> | null;
    totp: Record<string, unknown> | null;
    imghost: Record<string, unknown> | null;
  };
};

/** Options for {@link importBackup}. */
export interface ImportOptions {
  /**
   * Restore `data.admin` / `data.totp` / `data.imghost` (password verifier, TOTP
   * secret, image-host keys). Defaults to `true` so a full backup round-trips;
   * pass `false` to restore content only (e.g. on an untrusted host).
   */
  includeCredentials?: boolean;
}

/* -------------------------------------------------------------------------- */
/* small, defensive helpers                                                    */
/* -------------------------------------------------------------------------- */

/** `value` as a plain object, or null for arrays/primitives/null. */
function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Coerce a payload value to a string WITHOUT trimming. `str()` from lib/text
 * trims, which is right for titles but would silently rewrite post bodies on
 * every restore, so bodies/comments keep their exact bytes here.
 */
function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

/** Read a JSON file, returning null when it is missing or corrupt (never throws). */
function readJsonFile<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (err) {
    console.warn(`[backup] could not read ${file}: ${(err as Error).message}`);
    return null;
  }
}

/** Read an optional JSON object (admin/totp/imghost), null when absent. */
function readOptionalObject(file: string): Record<string, unknown> | null {
  return asObject(readJsonFile<unknown>(file));
}

/** Atomically write a JSON file (temp file + rename, so readers see no partial data). */
function writeJsonFile(file: string, value: unknown): void {
  atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Run an export step, degrading to `fallback` instead of failing the whole
 * backup when an optional store is missing or unreadable.
 */
function safely<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    console.warn(`[backup] export: ${label} failed: ${(err as Error).message}`);
    return fallback;
  }
}

/** The calendar file only counts as a store when it holds a JSON array. */
function readCalendar(): CalendarEvent[] {
  const raw = readJsonFile<unknown>(CALENDAR_FILE);
  return Array.isArray(raw) ? (raw as CalendarEvent[]) : [];
}

/* -------------------------------------------------------------------------- */
/* export                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Collect every piece of blog state into one JSON-encodable document.
 * Missing optional stores (site.json, visitors.json, calendar.json, …) simply
 * produce their empty/default representation — this never throws.
 */
export async function exportBackup(): Promise<Record<string, unknown>> {
  const doc: BackupDocument = {
    app: APP_NAME,
    version: BACKUP_VERSION,
    exportedAt: Math.floor(Date.now() / 1000),
    content: {
      // Raw frontmatter + body (not the parsed Post model) so a restore is
      // faithful and unknown frontmatter keys survive a round-trip.
      posts: safely(
        'posts',
        () => scanMarkdownDir(POSTS_DIR).map((md) => ({ slug: md.name, frontmatter: md.data, body: md.body })),
        [],
      ),
      pages: safely(
        'pages',
        () => scanMarkdownDir(PAGES_DIR).map((md) => ({ slug: md.name, frontmatter: md.data, body: md.body })),
        [],
      ),
      talks: safely(
        'talks',
        () => listTalks().map((talk) => ({ id: talk.id, createTime: talk.createTime, content: talk.content })),
        [],
      ),
      // `file` is dropped: it is an absolute host path, worthless in a backup.
      friends: safely(
        'friends',
        () =>
          listFriends().map(({ id, title, descr, titleEn, descrEn, avatar, url, sortOrder }) => ({
            id,
            title,
            descr,
            titleEn,
            descrEn,
            avatar,
            url,
            sortOrder,
          })),
        [],
      ),
    },
    data: {
      // Every comment already carries its `url`, which is what addComment needs.
      comments: safely('comments', () => listAllComments(), []),
      visitors: safely('visitors', () => visitorsStore.read(), { emails: {}, pending: [] }),
      site: safely('site', () => getSiteSettings(), {} as SiteSettings),
      calendar: safely('calendar', () => readCalendar(), []),
      admin: safely('admin', () => readOptionalObject(credentialsStore.file), null),
      totp: safely('totp', () => readOptionalObject(totpStore.file), null),
      imghost: safely('imghost', () => readOptionalObject(IMGHOST_FILE), null),
    },
  };
  return doc;
}

/** Pretty-printed JSON document, ready to be sent to the browser as a download. */
export function serializeBackup(doc: unknown): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * `blog-backup-YYYYMMDD-HHMMSS.json` in LOCAL time, matching the filename the
 * original PHP/Lua admin panel produced.
 */
export function backupFilename(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `blog-backup-${stamp}.json`;
}

/* -------------------------------------------------------------------------- */
/* import                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Validate + restore a backup document. Destructive: every section present in
 * the payload replaces the corresponding existing data.
 *
 * All file paths are derived from validated slugs/ids (`isSafeSlug`), never from
 * the payload, so a crafted backup cannot write outside the content directories.
 * Individual malformed entries are skipped with a warning instead of aborting
 * the whole restore.
 */
export async function importBackup(
  payload: unknown,
  options: ImportOptions = {},
): Promise<{ summary: Record<string, number> }> {
  // --- validation (messages are part of the admin UI contract) --------------
  if (typeof payload !== 'object' || payload === null) throw new Error('备份文件不是有效的 JSON');
  const doc = payload as { app?: unknown; content?: unknown; data?: unknown };
  if (doc.app !== APP_NAME) throw new Error(`not a ${APP_NAME} backup`);
  if (typeof doc.content !== 'object' || doc.content === null) throw new Error('backup has no content section');

  const content = doc.content as Record<string, unknown>;
  const data = asObject(doc.data) ?? {};
  // Default TRUE keeps the "restore my whole blog" promise; `false` lets the
  // caller import content without overwriting credentials/keys.
  const includeCredentials = options.includeCredentials !== false;

  const summary: Record<string, number> = {
    posts: 0,
    pages: 0,
    talks: 0,
    friends: 0,
    comments: 0,
    visitors: 0,
    site: 0,
    calendar: 0,
    admin: 0,
    totp: 0,
    imghost: 0,
  };

  // --- content -------------------------------------------------------------
  const posts = arrayOrNull(content.posts);
  if (posts) {
    summary.posts = restoreDocuments(POSTS_DIR, posts, () => {
      for (const post of listPosts()) deletePost(post.slug);
    }, 'posts');
  }

  const pages = arrayOrNull(content.pages);
  if (pages) {
    summary.pages = restoreDocuments(PAGES_DIR, pages, () => {
      for (const page of listPages()) deletePage(page.slug);
    }, 'pages');
  }

  const talks = arrayOrNull(content.talks);
  if (talks) summary.talks = restoreTalks(talks);

  const friends = arrayOrNull(content.friends);
  if (friends) summary.friends = restoreFriends(friends);

  // --- runtime data --------------------------------------------------------
  const comments = arrayOrNull(data.comments);
  if (comments) summary.comments = restoreComments(comments);

  if (data.visitors !== undefined) summary.visitors = restoreVisitors(data.visitors);
  if (data.site !== undefined) summary.site = restoreSite(data.site);
  if (data.calendar !== undefined) summary.calendar = restoreCalendar(data.calendar);

  // --- credential material (opt-in) ---------------------------------------
  if (includeCredentials) {
    const admin = asObject(data.admin);
    if (admin) {
      credentialsStore.write(admin as unknown as CredentialsFile);
      summary.admin = 1;
    }
    const totp = asObject(data.totp);
    if (totp) {
      totpStore.write(totp as unknown as TotpState);
      summary.totp = 1;
    }
    const imghost = asObject(data.imghost);
    if (imghost) {
      writeJsonFile(IMGHOST_FILE, imghost);
      summary.imghost = 1;
    }
  } else {
    console.log('[backup] import: skipping admin/totp/imghost (includeCredentials=false)');
  }

  // Cached Markdown parses must go, otherwise the admin UI would keep serving
  // the pre-restore content until the next mtime change.
  invalidateAll();

  return { summary };
}

/** A payload section must be an array; anything else means "leave untouched". */
function arrayOrNull(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/**
 * Restore posts/pages: `<slug>.md` with frontmatter + body. Both types share the
 * exact same on-disk shape, so they share this helper.
 */
function restoreDocuments(
  dir: string,
  rows: unknown[],
  clearExisting: () => void,
  label: string,
): number {
  clearExisting();
  let written = 0;
  for (const row of rows) {
    const entry = asObject(row);
    const slug = str(entry?.slug);
    // Never trust a payload path: the slug is validated and the filename is
    // rebuilt from it (path-traversal guard).
    if (!entry || !isSafeSlug(slug)) {
      console.warn(`[backup] import: skipping ${label} entry with unsafe/missing slug "${slug}"`);
      continue;
    }
    const frontmatter = asObject(entry.frontmatter);
    if (!frontmatter) {
      console.warn(`[backup] import: ${label} "${slug}" has no frontmatter object, using {}`);
    }
    try {
      writeMarkdownFile(dir, slug, frontmatter ?? {}, textOf(entry.body));
      written += 1;
    } catch (err) {
      console.warn(`[backup] import: failed to write ${label} "${slug}": ${(err as Error).message}`);
    }
  }
  return written;
}

/** Restore talks as `<id>.md` with `{id, create_time}` frontmatter. */
function restoreTalks(rows: unknown[]): number {
  for (const talk of listTalks()) deleteTalk(talk.id);

  let written = 0;
  for (const row of rows) {
    const entry = asObject(row);
    // Ids double as filenames, so they must be positive integers that also pass
    // isSafeSlug (no "/", no leading dot, …).
    const id = Number(entry?.id);
    if (!entry || !Number.isInteger(id) || id <= 0 || !isSafeSlug(String(id))) {
      console.warn(`[backup] import: skipping talk with invalid id "${String(entry?.id)}"`);
      continue;
    }
    const createTime = Number(entry.createTime);
    const create_time = Number.isInteger(createTime) && createTime > 0 ? createTime : id;
    try {
      writeMarkdownFile(TALKS_DIR, String(id), { id, create_time }, textOf(entry.content));
      written += 1;
    } catch (err) {
      console.warn(`[backup] import: failed to write talk ${id}: ${(err as Error).message}`);
    }
  }
  return written;
}

/**
 * Restore friend links through the friends writer so the filename convention
 * (`<id>-<slug>.md`) stays in sync with the title. Payload ids are deliberately
 * ignored: `addFriend` allocates the next free id, which keeps ids unique even
 * when a backup holds duplicates.
 */
function restoreFriends(rows: unknown[]): number {
  for (const friend of listFriends()) deleteFriend(friend.id);

  let written = 0;
  for (const row of rows) {
    const entry = asObject(row);
    if (!entry || !str(entry.title)) {
      console.warn('[backup] import: skipping friend link without a title');
      continue;
    }
    const input: FriendInput = {
      title: entry.title,
      descr: entry.descr,
      titleEn: entry.titleEn,
      descrEn: entry.descrEn,
      avatar: entry.avatar,
      url: entry.url,
      sortOrder: entry.sortOrder,
    };
    try {
      addFriend(input);
      written += 1;
    } catch (err) {
      console.warn(`[backup] import: failed to write friend link "${str(entry.title)}": ${(err as Error).message}`);
    }
  }
  return written;
}

/** Delete every JSON file in the comments directory (missing dir → no-op). */
function clearCommentsDir(): void {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(COMMENTS_DIR);
  } catch {
    return;
  }
  for (const entry of entries) {
    const file = path.join(COMMENTS_DIR, entry);
    // readdir never returns separators, but keep the guard so a malformed name
    // can never resolve to a path outside the comments directory.
    if (path.dirname(file) !== COMMENTS_DIR) continue;
    try {
      if (fs.statSync(file).isFile()) fs.unlinkSync(file);
    } catch (err) {
      console.warn(`[backup] import: could not delete ${file}: ${(err as Error).message}`);
    }
  }
}

/**
 * Restore comments by rewriting the per-URL files through `addComment`, which
 * appends to the file derived from the comment's `url` (so the URL can never
 * escape COMMENTS_DIR).
 */
function restoreComments(rows: unknown[]): number {
  clearCommentsDir();

  let written = 0;
  for (const row of rows) {
    const entry = asObject(row);
    const url = str(entry?.url);
    if (!entry || !url) {
      // A comment without a url has no home file, so it cannot be restored.
      console.warn('[backup] import: skipping comment without a url');
      continue;
    }
    try {
      const now = Math.floor(Date.now() / 1000);
      addComment({
        id: Number(entry.id) || Date.now(),
        nick: str(entry.nick),
        mail: str(entry.mail),
        comment: str(entry.comment),
        link: str(entry.link),
        ua: str(entry.ua),
        avatar: str(entry.avatar),
        url,
        createTime: Number(entry.createTime) || now,
      });
      written += 1;
    } catch (err) {
      console.warn(`[backup] import: failed to write comment for "${url}": ${(err as Error).message}`);
    }
  }
  return written;
}

/** Replace the whole visitors store; returns the number of registered emails. */
function restoreVisitors(value: unknown): number {
  const source = asObject(value);
  if (!source) {
    console.warn('[backup] import: visitors section is not an object, skipping');
    return 0;
  }

  const emails: VisitorsFile['emails'] = {};
  for (const [rawEmail, rawValue] of Object.entries(asObject(source.emails) ?? {})) {
    // Keys are lower-cased because every other visitor API normalises them.
    const email = rawEmail.toLowerCase();
    const record = asObject(rawValue);
    if (!email || !record) {
      console.warn(`[backup] import: skipping malformed visitor "${rawEmail}"`);
      continue;
    }
    emails[email] = {
      permissions: Array.isArray(record.permissions) ? record.permissions.map((p) => str(p)).filter(Boolean) : [],
      name: str(record.name),
      createdAt: Number(record.createdAt) || Math.floor(Date.now() / 1000),
    };
  }

  const pending: VisitorsFile['pending'] = [];
  const pendingRows = Array.isArray(source.pending) ? source.pending : [];
  for (const row of pendingRows) {
    const entry = asObject(row);
    const email = str(entry?.email).toLowerCase();
    if (!entry || !email) {
      console.warn('[backup] import: skipping malformed pending registration');
      continue;
    }
    pending.push({
      email,
      name: str(entry.name),
      createdAt: Number(entry.createdAt) || Math.floor(Date.now() / 1000),
    });
  }

  visitorsStore.write({ emails, pending });
  return Object.keys(emails).length;
}

/**
 * Overwrite the site settings store with the payload. JsonStore merges the
 * built-in defaults back in on read, so absent keys fall back automatically;
 * `strings` is coerced to a plain string map so a hand-edited backup cannot
 * smuggle non-string values into the templates.
 */
function restoreSite(value: unknown): number {
  const settings = asObject(value);
  if (!settings) {
    console.warn('[backup] import: site section is not an object, skipping');
    return 0;
  }

  const strings: Record<string, string> = {};
  for (const [key, raw] of Object.entries(asObject(settings.strings) ?? {})) {
    strings[key] = str(raw);
  }

  siteStore.write({ ...settings, strings } as unknown as SiteSettings);
  return 1;
}

/** Overwrite `blog/data/calendar.json` with the payload's event array. */
function restoreCalendar(value: unknown): number {
  if (!Array.isArray(value)) {
    console.warn('[backup] import: calendar section is not an array, skipping');
    return 0;
  }

  const events: CalendarEvent[] = [];
  for (const row of value) {
    const entry = asObject(row);
    if (!entry) {
      console.warn('[backup] import: skipping malformed calendar event');
      continue;
    }
    events.push({
      id: Number(entry.id) || 0,
      title: str(entry.title),
      date: str(entry.date),
      description: str(entry.description),
      color: str(entry.color),
      createdAt: Number(entry.createdAt) || 0,
    });
  }

  writeJsonFile(CALENDAR_FILE, events);
  return events.length;
}
