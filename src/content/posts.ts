/**
 * posts.ts — Post domain model backed by `blog/posts/*.md`.
 *
 * Each post is `<slug>.md` with YAML frontmatter:
 *   title, date, tags, categories, cover, archived, title_en, content_en
 * The Markdown body is the Chinese (default) content; the English body lives in
 * the optional `content_en` frontmatter field.
 */
import fs from 'node:fs';
import path from 'node:path';
import { POSTS_DIR } from '../paths.ts';
import { formatDate, parseDate, str, stripMarkdown, toList } from '../lib/text.ts';
import {
  deleteMarkdownFile,
  readMarkdownFile,
  scanMarkdownDir,
  writeMarkdownFile,
  type MarkdownFile,
} from './markdown-files.ts';

export interface Post {
  slug: string;
  title: string;
  titleEn: string;
  content: string;
  contentEn: string;
  date: string;
  dateFormatted: string;
  tags: string[];
  categories: string[];
  cover: string;
  archived: boolean;
  year: number | null;
  month: number | null;
  day: number | null;
  mtimeMs: number;
}

export interface PostSummary {
  slug: string;
  title: string;
  titleEn: string;
  date: string;
  tags: string[];
  categories: string[];
  cover: string;
  excerpt: string;
}

/** Fields accepted when creating or updating a post. */
export interface PostInput {
  slug: string;
  title?: unknown;
  titleEn?: unknown;
  content?: unknown;
  contentEn?: unknown;
  date?: unknown;
  tags?: unknown;
  categories?: unknown;
  cover?: unknown;
  archived?: unknown;
}

function toPost(md: MarkdownFile): Post {
  const d = md.data;
  const date = formatDate(d.date) || '';
  const parsed = parseDate(date);
  return {
    slug: md.name,
    title: str(d.title),
    titleEn: str(d.title_en ?? d.titleEn),
    content: md.body,
    contentEn: str(d.content_en ?? d.contentEn),
    date,
    dateFormatted: date,
    tags: toList(d.tags),
    categories: toList(d.categories),
    cover: str(d.cover),
    archived: d.archived === true || d.archived === 1 || d.archived === 'true',
    year: parsed ? parsed.year : null,
    month: parsed ? parsed.month : null,
    day: parsed ? parsed.day : null,
    mtimeMs: md.mtimeMs,
  };
}

/** All posts, newest first (date desc, then slug asc). */
export function listPosts(): Post[] {
  return scanMarkdownDir(POSTS_DIR)
    .map(toPost)
    .sort(comparePosts);
}

function comparePosts(a: Post, b: Post): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.slug.localeCompare(b.slug);
}

/** Non-archived posts, newest first. */
export function activePosts(): Post[] {
  return listPosts().filter((p) => !p.archived);
}

/** Archived posts, newest first. */
export function archivedPosts(): Post[] {
  return listPosts().filter((p) => p.archived);
}

/** Load one post by slug, or null. */
export function getPost(slug: string): Post | null {
  const md = readMarkdownFile(POSTS_DIR, slug);
  return md ? toPost(md) : null;
}

export function postExists(slug: string): boolean {
  return readMarkdownFile(POSTS_DIR, slug) !== null;
}

/** Posts carrying the given tag. */
export function postsByTag(tag: string, from: Post[] = activePosts()): Post[] {
  return from.filter((p) => p.tags.includes(tag));
}

/** Posts carrying the given category. */
export function postsByCategory(category: string, from: Post[] = activePosts()): Post[] {
  return from.filter((p) => p.categories.includes(category));
}

export interface FacetCount {
  name: string;
  count: number;
}

/** Tag names with post counts, most used first. */
export function buildTagIndex(posts: Post[] = activePosts()): FacetCount[] {
  return buildFacetIndex(posts, (p) => p.tags);
}

/** Category names with post counts, most used first. */
export function buildCategoryIndex(posts: Post[] = activePosts()): FacetCount[] {
  return buildFacetIndex(posts, (p) => p.categories);
}

function buildFacetIndex(posts: Post[], pick: (p: Post) => string[]): FacetCount[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const name of pick(post)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
}

/** Group posts by year for the archives page, newest year first. */
export function groupByYear(posts: Post[]): Array<{ year: string; posts: Post[] }> {
  const groups = new Map<string, Post[]>();
  for (const post of posts) {
    const year = post.year ? String(post.year) : 'Unknown';
    const bucket = groups.get(year);
    if (bucket) bucket.push(post);
    else groups.set(year, [post]);
  }
  return [...groups.entries()]
    .map(([year, list]) => ({ year, posts: list }))
    .sort((a, b) => (a.year < b.year ? 1 : a.year > b.year ? -1 : 0));
}

/** Shorten a post body for card/list views. */
export function excerptOf(post: Pick<Post, 'content' | 'cover'>, maxChars?: number): string {
  const limit = maxChars ?? (post.cover ? 120 : 200);
  return stripMarkdown(post.content, limit);
}

/** Listing projection (no body) used by the home and list pages. */
export function toSummary(post: Post): PostSummary {
  return {
    slug: post.slug,
    title: post.title,
    titleEn: post.titleEn,
    date: post.dateFormatted,
    tags: post.tags,
    categories: post.categories,
    cover: post.cover,
    excerpt: excerptOf(post),
  };
}

/** Frontmatter object for writing a post back to disk. */
function frontmatterFor(data: PostInput, existing?: Post): Record<string, unknown> {
  const fm: Record<string, unknown> = {};
  fm.title = str(data.title ?? existing?.title ?? data.slug);
  fm.date = formatDate(data.date ?? existing?.date ?? new Date());
  fm.tags = data.tags !== undefined ? toList(data.tags) : (existing?.tags ?? []);
  fm.categories = data.categories !== undefined ? toList(data.categories) : (existing?.categories ?? []);

  const cover = data.cover !== undefined ? str(data.cover) : (existing?.cover ?? '');
  if (cover) fm.cover = cover;

  const archived = data.archived !== undefined
    ? (data.archived === true || data.archived === 'true' || data.archived === 1)
    : (existing?.archived ?? false);
  if (archived) fm.archived = true;

  const titleEn = data.titleEn !== undefined ? str(data.titleEn) : (existing?.titleEn ?? '');
  if (titleEn) fm.title_en = titleEn;

  const contentEn = data.contentEn !== undefined ? str(data.contentEn) : (existing?.contentEn ?? '');
  if (contentEn) fm.content_en = contentEn;

  return fm;
}

/** Create a new post file. Returns the post, or throws if the slug is taken. */
export function createPost(data: PostInput): Post {
  if (postExists(data.slug)) {
    throw new Error(`post already exists: ${data.slug}`);
  }
  const body = str(data.content);
  writeMarkdownFile(POSTS_DIR, data.slug, frontmatterFor(data), body);
  const created = getPost(data.slug);
  if (!created) throw new Error('failed to create post');
  return created;
}

/** Overwrite an existing post file. */
export function updatePost(data: PostInput): Post {
  const existing = getPost(data.slug);
  if (!existing) throw new Error(`post not found: ${data.slug}`);
  const body = data.content !== undefined ? str(data.content) : existing.content;
  writeMarkdownFile(POSTS_DIR, data.slug, frontmatterFor(data, existing), body);
  const updated = getPost(data.slug);
  if (!updated) throw new Error('failed to update post');
  return updated;
}

/** Create or update depending on whether the file already exists. */
export function savePost(data: PostInput): { post: Post; created: boolean } {
  const created = !postExists(data.slug);
  return { post: created ? createPost(data) : updatePost(data), created };
}

export function deletePost(slug: string): boolean {
  return deleteMarkdownFile(POSTS_DIR, slug);
}

/** Flip the archived flag of a post. */
export function toggleArchive(slug: string): Post | null {
  const post = getPost(slug);
  if (!post) return null;
  const md = readMarkdownFile(POSTS_DIR, slug)!;
  const fm = frontmatterFor(
    { slug, content: post.content, contentEn: post.contentEn, title: post.title, titleEn: post.titleEn, date: post.date, tags: post.tags, categories: post.categories, cover: post.cover, archived: !post.archived },
    post,
  );
  writeMarkdownFile(POSTS_DIR, slug, fm, md.body);
  return getPost(slug);
}

/** Ensure the content directory exists. */
export function ensurePostsDir(): void {
  fs.mkdirSync(path.join(POSTS_DIR), { recursive: true });
}
