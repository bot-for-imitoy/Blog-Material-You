/**
 * pages.ts — Standalone pages (`about`, `talks`, …) backed by `blog/pages/*.md`.
 *
 * Frontmatter carries `title` / `title_en`; the Markdown body is the default
 * content. English content may live in `content_en` frontmatter or, for
 * backwards compatibility with the previous storage, in a sibling
 * `<slug>.en.json` file containing `{"content_en": "…"}`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PAGES_DIR } from '../paths.ts';
import { str } from '../lib/text.ts';
import {
  deleteMarkdownFile,
  isSafeSlug,
  readMarkdownFile,
  scanMarkdownDir,
  writeMarkdownFile,
  type MarkdownFile,
} from './markdown-files.ts';

export interface Page {
  slug: string;
  title: string;
  titleEn: string;
  content: string;
  contentEn: string;
  mtimeMs: number;
}

/** Legacy English-content sidecar written by the previous implementation. */
function readLegacyContentEn(slug: string): string {
  if (!isSafeSlug(slug)) return '';
  try {
    const raw = fs.readFileSync(path.join(PAGES_DIR, `${slug}.en.json`), 'utf8');
    const parsed = JSON.parse(raw) as { content_en?: unknown; contentEn?: unknown };
    return str(parsed.content_en ?? parsed.contentEn);
  } catch {
    return '';
  }
}

function toPage(md: MarkdownFile): Page {
  const d = md.data;
  const inlineEn = str(d.content_en ?? d.contentEn);
  return {
    slug: md.name,
    title: str(d.title) || md.name,
    titleEn: str(d.title_en ?? d.titleEn),
    content: md.body,
    contentEn: inlineEn || readLegacyContentEn(md.name),
    mtimeMs: md.mtimeMs,
  };
}

/** All pages, sorted by slug. */
export function listPages(): Page[] {
  return scanMarkdownDir(PAGES_DIR).map(toPage);
}

/** Load one page by slug, or null. */
export function getPage(slug: string): Page | null {
  const md = readMarkdownFile(PAGES_DIR, slug);
  return md ? toPage(md) : null;
}

export function pageExists(slug: string): boolean {
  return readMarkdownFile(PAGES_DIR, slug) !== null;
}

export interface PageInput {
  slug: string;
  title?: unknown;
  titleEn?: unknown;
  content?: unknown;
  contentEn?: unknown;
}

function pageFrontmatter(data: PageInput, existing?: Page): Record<string, unknown> {
  const fm: Record<string, unknown> = {};
  fm.title = str(data.title ?? existing?.title ?? data.slug);
  const titleEn = data.titleEn !== undefined ? str(data.titleEn) : (existing?.titleEn ?? '');
  if (titleEn) fm.title_en = titleEn;
  const contentEn = data.contentEn !== undefined ? str(data.contentEn) : (existing?.contentEn ?? '');
  if (contentEn) fm.content_en = contentEn;
  return fm;
}

export function createPage(data: PageInput): Page {
  if (pageExists(data.slug)) throw new Error(`page already exists: ${data.slug}`);
  writeMarkdownFile(PAGES_DIR, data.slug, pageFrontmatter(data), str(data.content));
  const created = getPage(data.slug);
  if (!created) throw new Error('failed to create page');
  return created;
}

export function updatePage(data: PageInput): Page {
  const existing = getPage(data.slug);
  if (!existing) throw new Error(`page not found: ${data.slug}`);
  const body = data.content !== undefined ? str(data.content) : existing.content;
  writeMarkdownFile(PAGES_DIR, data.slug, pageFrontmatter(data, existing), body);
  const updated = getPage(data.slug);
  if (!updated) throw new Error('failed to update page');
  return updated;
}

export function savePage(data: PageInput): { page: Page; created: boolean } {
  const created = !pageExists(data.slug);
  return { page: created ? createPage(data) : updatePage(data), created };
}

export function deletePage(slug: string): boolean {
  return deleteMarkdownFile(PAGES_DIR, slug);
}
