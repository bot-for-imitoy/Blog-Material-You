/**
 * comments.ts — File-based comments, one JSON file per page URL.
 *
 * `blog/data/comments/<key>.json` holds an array of comments for one page:
 *   { id, nick, mail, comment, link, ua, avatar, url, createTime }
 *
 * This replaces the `comments` table. Files are keyed by a sanitised form of
 * the page path so a URL can never escape the comments directory.
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

function fileFor(url: string): string {
  return path.join(COMMENTS_DIR, `${safeFilename(url)}.json`);
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

/** Comments for one page path, oldest first. */
export function listComments(url: string): Comment[] {
  if (!url) return [];
  return readFile(fileFor(url));
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

/** Validate a comment submission. Length limits are new — the original had none. */
export function validateComment(input: CommentInput): ValidationResult {
  const nick = str(input.nick);
  const mail = str(input.mail);
  const body = str(input.comment);
  const url = str(input.url);

  if (!nick || !mail || !body || !url) return { ok: false, error: 'Missing required fields' };
  if (nick.length > MAX_NICK) return { ok: false, error: `昵称过长（最多 ${MAX_NICK} 字符）` };
  if (mail.length > MAX_MAIL) return { ok: false, error: `邮箱过长（最多 ${MAX_MAIL} 字符）` };
  if (body.length > MAX_COMMENT) return { ok: false, error: `评论过长（最多 ${MAX_COMMENT} 字符）` };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return { ok: false, error: '邮箱格式不正确' };

  const link = str(input.link).slice(0, MAX_LINK);
  if (link && !/^https?:\/\//i.test(link)) return { ok: false, error: '网站链接必须以 http(s):// 开头' };

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
      avatar: str(input.avatar).slice(0, MAX_LINK),
      url,
      createTime,
    },
  };
}

/** Append a comment to its page file. */
export function addComment(comment: Comment): Comment {
  const file = fileFor(comment.url);
  const comments = readFile(file);
  // Guarantee a unique id even for comments posted in the same millisecond.
  let id = comment.id;
  while (comments.some((c) => c.id === id)) id += 1;
  const stored = { ...comment, id };
  comments.push(stored);
  writeFile(file, comments);
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
