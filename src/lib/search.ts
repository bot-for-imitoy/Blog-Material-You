/**
 * search.ts — Full-text search over the Markdown content.
 *
 * There is no search back-end (and no database) to delegate to, so the index is
 * built in-process from the same Markdown scanner the rest of the site uses.
 * Building it is cheap — `scanMarkdownDir` already caches parsed files by
 * mtime — and the resulting index is memoised on the set of file mtimes, so
 * editing a post invalidates it automatically.
 *
 * Matching is deliberately substring-based rather than word-based: the content
 * is mostly Chinese, which has no spaces, so a tokeniser geared to Latin words
 * would fail on exactly the queries this blog receives. Latin queries still
 * work because matching is case-insensitive and the query is split on spaces
 * for multi-word AND-style ranking.
 *
 * Highlighting is XSS-safe by construction: text is HTML-escaped *before* the
 * `<mark>` tags are inserted, so a post containing `<script>` can never inject
 * markup into a snippet (`escapeSegments` below).
 */
import { escapeHtml } from './text.ts';
import { listPosts, excerptOf, type Post } from '../content/posts.ts';

export interface SearchHit {
  slug: string;
  title: string;
  /** Title with matches wrapped in <mark>, HTML-escaped and safe to inject. */
  titleHtml: string;
  date: string;
  tags: string[];
  categories: string[];
  cover: string;
  archived: boolean;
  excerpt: string;
  /** Plain-text snippet around the first match (for APIs/clients). */
  snippet: string;
  /** Snippet with matches wrapped in <mark>, safe to inject. */
  snippetHtml: string;
  score: number;
}

export interface SearchOutcome {
  query: string;
  tokens: string[];
  total: number;
  hits: SearchHit[];
}

export interface SearchOptions {
  /** Maximum hits to return (default 20, capped at 50). */
  limit?: number;
  /** Include archived posts (default true — searching should find everything). */
  includeArchived?: boolean;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_QUERY_LENGTH = 200;
/** Characters of context shown around a match. */
const SNIPPET_LENGTH = 180;

interface IndexEntry {
  post: Post;
  titleLower: string;
  titleEnLower: string;
  tagsLower: string[];
  categoriesLower: string[];
  /** Markdown-stripped body, lower-cased, for matching. */
  bodyLower: string;
  /** Markdown-stripped body in its original casing, for snippets. */
  body: string;
}

interface Cache {
  key: string;
  entries: IndexEntry[];
}

let cache: Cache | null = null;

/** Strip Markdown down to searchable prose (keeps the original casing). */
function toPlainText(markdown: string): string {
  return (
    markdown
      // Raw HTML is markup, not prose — and never belongs in a snippet.
      .replace(/<[^>]*>/g, ' ')
      // Fenced code blocks are noise for search: drop them, but keep inline code.
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/~~~[\s\S]*?~~~/g, ' ')
      .replace(/!\[([\s\S]*?)\]\([\s\S]*?\)/g, '$1')
      .replace(/\[([\s\S]*?)\]\([\s\S]*?\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/[*_~`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function buildIndex(): IndexEntry[] {
  return listPosts().map((post) => {
    const body = toPlainText(post.content);
    return {
      post,
      titleLower: post.title.toLowerCase(),
      titleEnLower: post.titleEn.toLowerCase(),
      tagsLower: post.tags.map((t) => t.toLowerCase()),
      categoriesLower: post.categories.map((c) => c.toLowerCase()),
      bodyLower: body.toLowerCase(),
      body,
    };
  });
}

/** Current index, rebuilt only when a content file's mtime changes. */
function index(): IndexEntry[] {
  const posts = listPosts();
  // The mtime set is a cheap, exact cache key: any edit changes it.
  const key = posts.map((p) => `${p.slug}@${p.mtimeMs}`).join('|');
  if (cache && cache.key === key) return cache.entries;
  const entries = buildIndex();
  cache = { key, entries };
  return entries;
}

/** Split a raw query into lower-cased tokens (whole query kept for CJK). */
export function tokenize(query: string): string[] {
  const normalised = query.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH).toLowerCase();
  if (!normalised) return [];
  const tokens = normalised.split(' ').filter(Boolean);
  // Cap the token count so a pathological query cannot cost much.
  return tokens.slice(0, 8);
}

/** All occurrences of `token` in `haystack`, capped to keep scoring bounded. */
function countOccurrences(haystack: string, token: string, cap = 10): number {
  if (!token) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(token, from);
    if (at === -1) break;
    count += 1;
    if (count >= cap) break;
    from = at + token.length;
  }
  return count;
}

interface Range {
  start: number;
  end: number;
}

/** Merge overlapping match ranges so highlighting never nests. */
function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) return [];
  const sorted = ranges.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [sorted[0]!];
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push(range);
  }
  return merged;
}

/** Match ranges for every token inside `[from, to)`. */
function findRanges(text: string, tokens: string[], from = 0, to = text.length): Range[] {
  const lower = text.toLowerCase();
  const ranges: Range[] = [];
  for (const token of tokens) {
    let at = lower.indexOf(token, from);
    while (at !== -1 && at < to) {
      ranges.push({ start: at, end: Math.min(at + token.length, to) });
      at = lower.indexOf(token, at + token.length);
    }
  }
  return mergeRanges(ranges);
}

/**
 * Turn text + ranges into escaped HTML with `<mark>` around the ranges.
 * Escaping happens per segment, so injected markup is impossible.
 */
function escapeSegments(text: string, ranges: Range[]): string {
  let html = '';
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) html += escapeHtml(text.slice(cursor, range.start));
    html += `<mark class="search-mark">${escapeHtml(text.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
}

/** Build a snippet centred on the first match of any token. */
function buildSnippet(entry: IndexEntry, tokens: string[]): { snippet: string; snippetHtml: string } {
  const text = entry.body;
  if (!text) return { snippet: '', snippetHtml: '' };

  // Where does the first match start? Prefer the body; fall back to the head.
  let firstMatch = -1;
  for (const token of tokens) {
    const at = entry.bodyLower.indexOf(token);
    if (at !== -1 && (firstMatch === -1 || at < firstMatch)) firstMatch = at;
  }

  let start = 0;
  if (firstMatch > 40) start = firstMatch - 40;
  let end = Math.min(text.length, start + SNIPPET_LENGTH);
  // Avoid cutting a word in half when the boundary lands mid-token.
  if (end < text.length) {
    const nextSpace = text.indexOf(' ', end);
    if (nextSpace !== -1 && nextSpace - end < 20) end = nextSpace;
  }

  const slice = text.slice(start, end);
  const ranges = findRanges(slice, tokens, 0, slice.length);
  // Ranges are relative to the slice; shift them into slice coordinates.
  const snippet = `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`;
  const offset = start > 0 ? 1 : 0; // account for the leading ellipsis
  const shifted = ranges.map((r) => ({ start: r.start + offset, end: r.end + offset }));
  const snippetHtml = escapeSegments(snippet, shifted);
  return { snippet, snippetHtml };
}

function scoreEntry(entry: IndexEntry, tokens: string[]): { score: number; matchedTokens: number } {
  let score = 0;
  let matchedTokens = 0;

  for (const token of tokens) {
    let tokenScore = 0;

    // Titles are the strongest signal; the English title counts too, since a
    // post may only be findable by its translated name.
    tokenScore += countOccurrences(entry.titleLower, token, 3) * 20;
    tokenScore += countOccurrences(entry.titleEnLower, token, 3) * 12;
    for (const tag of entry.tagsLower) tokenScore += countOccurrences(tag, token, 1) * 8;
    for (const category of entry.categoriesLower) tokenScore += countOccurrences(category, token, 1) * 8;
    tokenScore += countOccurrences(entry.bodyLower, token, 10) * 2;

    if (tokenScore > 0) matchedTokens += 1;
    score += tokenScore;
  }

  // Require every token to appear somewhere: a post that matches only one word
  // of a two-word query is usually not what the reader meant.
  if (matchedTokens === 0 || matchedTokens < tokens.length) {
    score = score / (tokens.length - matchedTokens + 1);
  }

  // Archived posts are still findable but rank below live ones.
  if (entry.post.archived) score *= 0.6;
  return { score, matchedTokens };
}

/**
 * Search posts. Returns an empty result set for an empty query rather than
 * throwing, so callers can render an "enter a keyword" state.
 */
export function searchPosts(query: unknown, options: SearchOptions = {}): SearchOutcome {
  const raw = typeof query === 'string' ? query : '';
  const tokens = tokenize(raw);
  const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const includeArchived = options.includeArchived ?? true;

  if (tokens.length === 0) {
    return { query: raw.trim().slice(0, MAX_QUERY_LENGTH), tokens: [], total: 0, hits: [] };
  }

  const scored: Array<{ entry: IndexEntry; score: number }> = [];
  for (const entry of index()) {
    if (!includeArchived && entry.post.archived) continue;
    const { score, matchedTokens } = scoreEntry(entry, tokens);
    if (score <= 0 || matchedTokens === 0) continue;
    scored.push({ entry, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.entry.post.date < b.entry.post.date ? 1 : a.entry.post.date > b.entry.post.date ? -1 : 0) ||
      a.entry.post.slug.localeCompare(b.entry.post.slug),
  );

  const hits: SearchHit[] = scored.slice(0, limit).map(({ entry, score }) => {
    const titleSource = entry.post.title;
    const titleRanges = findRanges(titleSource, tokens);
    const { snippet, snippetHtml } = buildSnippet(entry, tokens);
    return {
      slug: entry.post.slug,
      title: titleSource,
      titleHtml: escapeSegments(titleSource, titleRanges),
      date: entry.post.date,
      tags: entry.post.tags,
      categories: entry.post.categories,
      cover: entry.post.cover,
      archived: entry.post.archived,
      excerpt: excerptOf(entry.post),
      snippet,
      snippetHtml,
      score,
    };
  });

  return { query: raw.trim().slice(0, MAX_QUERY_LENGTH), tokens, total: scored.length, hits };
}

/** Drop the memoised index (used by tests and the admin reload endpoint). */
export function invalidateSearchIndex(): void {
  cache = null;
}
