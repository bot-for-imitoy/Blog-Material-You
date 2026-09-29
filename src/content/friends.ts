/**
 * friends.ts — Friend links (友情链接) backed by `blog/friends/*.md`.
 *
 * Files are named `<id>-<slug>.md` and carry:
 *   id, title, descr, title_en, descr_en, avatar, url, sort_order
 * Ordering is `sort_order` ascending, then `id` ascending.
 */
import path from 'node:path';
import { FRIENDS_DIR } from '../paths.ts';
import { slugify, str } from '../lib/text.ts';
import {
  deleteMarkdownFile,
  scanMarkdownDir,
  writeMarkdownFile,
  type MarkdownFile,
} from './markdown-files.ts';

export interface Friend {
  id: number;
  title: string;
  descr: string;
  titleEn: string;
  descrEn: string;
  avatar: string;
  url: string;
  sortOrder: number;
  file: string;
}

function toFriend(md: MarkdownFile): Friend {
  const d = md.data;
  const fromName = Number.parseInt(md.name.split('-')[0] ?? '', 10);
  const id = Number(d.id) || (Number.isFinite(fromName) ? fromName : 0);
  return {
    id,
    title: str(d.title) || md.name,
    descr: str(d.descr),
    titleEn: str(d.title_en ?? d.titleEn),
    descrEn: str(d.descr_en ?? d.descrEn),
    avatar: str(d.avatar),
    url: str(d.url) || '#',
    sortOrder: Number(d.sort_order ?? d.sortOrder) || 0,
    file: md.file,
  };
}

/** All friend links in display order. */
export function listFriends(): Friend[] {
  return scanMarkdownDir(FRIENDS_DIR)
    .map(toFriend)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

export function getFriend(id: number): Friend | null {
  return listFriends().find((f) => f.id === id) ?? null;
}

export interface FriendInput {
  id?: unknown;
  title?: unknown;
  descr?: unknown;
  titleEn?: unknown;
  descrEn?: unknown;
  avatar?: unknown;
  url?: unknown;
  sortOrder?: unknown;
}

function frontmatterFor(id: number, data: FriendInput): Record<string, unknown> {
  const fm: Record<string, unknown> = { id };
  fm.title = str(data.title);
  const descr = str(data.descr);
  if (descr) fm.descr = descr;
  const titleEn = str(data.titleEn);
  if (titleEn) fm.title_en = titleEn;
  const descrEn = str(data.descrEn);
  if (descrEn) fm.descr_en = descrEn;
  const avatar = str(data.avatar);
  if (avatar) fm.avatar = avatar;
  fm.url = str(data.url) || '#';
  fm.sort_order = Number(data.sortOrder) || 0;
  return fm;
}

function nextId(): number {
  const ids = listFriends().map((f) => f.id);
  return (ids.length > 0 ? Math.max(...ids) : 0) + 1;
}

/** Add a friend link, returning the stored record. */
export function addFriend(data: FriendInput): Friend {
  const id = nextId();
  const slug = slugify(str(data.title) || `friend-${id}`);
  writeMarkdownFile(FRIENDS_DIR, `${id}-${slug}`, frontmatterFor(id, data), '');
  const created = getFriend(id);
  if (!created) throw new Error('failed to create friend link');
  return created;
}

/** Update a friend link in place (the file may be renamed when the title changes). */
export function updateFriend(id: number, data: FriendInput): Friend {
  const existing = getFriend(id);
  if (!existing) throw new Error(`friend link not found: ${id}`);

  const slug = slugify(str(data.title) || existing.title || `friend-${id}`);
  const wanted = path.join(FRIENDS_DIR, `${id}-${slug}.md`);

  if (path.resolve(wanted) !== path.resolve(existing.file)) {
    deleteMarkdownFile(FRIENDS_DIR, path.basename(existing.file).replace(/\.md$/, ''));
  }
  writeMarkdownFile(FRIENDS_DIR, `${id}-${slug}`, frontmatterFor(id, data), '');

  const updated = getFriend(id);
  if (!updated) throw new Error('failed to update friend link');
  return updated;
}

export function deleteFriend(id: number): boolean {
  const existing = getFriend(id);
  if (!existing) return false;
  return deleteMarkdownFile(FRIENDS_DIR, path.basename(existing.file).replace(/\.md$/, ''));
}

export function parseFriendId(value: unknown): number | null {
  const n = Number.parseInt(str(value), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Strip the internal `file` path before a friend link crosses an API boundary.
 * The absolute path is only needed internally by `updateFriend`/`deleteFriend`
 * (to rename or remove the right file) and must never leak to clients.
 */
export function publicFriend(friend: Friend): Omit<Friend, 'file'> {
  const { file: _file, ...rest } = friend;
  return rest;
}

/** Same as `publicFriend`, applied to a list. */
export function publicFriends(list: Friend[]): Array<Omit<Friend, 'file'>> {
  return list.map(publicFriend);
}
