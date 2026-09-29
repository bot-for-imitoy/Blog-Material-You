/**
 * markdown-files.ts — Cached scanner for Markdown files with YAML frontmatter.
 *
 * This is the storage engine of the blog: every post, page, talk and friend
 * link is a Markdown file on disk (Hexo-style). Files are re-read only when
 * their mtime/size changes, so editing a file by hand is picked up without a
 * restart while requests stay cheap.
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { formatDate } from '../lib/text.ts';

export interface MarkdownFile {
  /** Absolute path on disk. */
  file: string;
  /** Basename without the extension — the default slug. */
  name: string;
  mtimeMs: number;
  size: number;
  data: Record<string, unknown>;
  /** Markdown body with the frontmatter stripped. */
  body: string;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  parsed: MarkdownFile;
}

const caches = new Map<string, Map<string, CacheEntry>>();

function cacheFor(dir: string): Map<string, CacheEntry> {
  let c = caches.get(dir);
  if (!c) {
    c = new Map();
    caches.set(dir, c);
  }
  return c;
}

/**
 * Minimal frontmatter parser used when the strict YAML parser rejects a file.
 * Mirrors the tolerant parser from the original Lua implementation so
 * hand-written, slightly-off files keep working.
 */
export function parseLenientYaml(source: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = source.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) {
      i += 1;
      continue;
    }
    const kv = line.match(/^\s*([\w-]+)\s*:\s*(.+?)\s*$/);
    let key = kv ? kv[1]! : '';
    let value = kv ? kv[2]! : '';
    if (!key) {
      const bare = line.match(/^\s*([\w-]+)\s*:\s*$/);
      if (bare) {
        key = bare[1]!;
        value = '';
      }
    }
    if (!key) {
      i += 1;
      continue;
    }

    const inline = value.match(/^\[(.*)\]$/);
    if (inline) {
      out[key] = inline[1]!
        .split(',')
        .map((s) => s.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'))
        .filter((s) => s !== '');
      i += 1;
      continue;
    }

    if (/^"/.test(value) || /^'/.test(value)) {
      out[key] = value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      i += 1;
      continue;
    }

    // A following block of "- item" lines is a list.
    if (i + 1 < lines.length && /^\s*-/.test(lines[i + 1]!)) {
      const items: string[] = [];
      if (value !== '') items.push(value);
      i += 1;
      while (i < lines.length && /^\s*-/.test(lines[i]!)) {
        let item = (lines[i]!.match(/^\s*-\s*(.*)$/)?.[1] ?? '').trim();
        const nested = item.match(/^-\s*(.*)$/);
        if (nested) item = (nested[1] ?? '').trim();
        items.push(item.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'));
        i += 1;
      }
      out[key] = items;
      continue;
    }

    out[key] = value;
    i += 1;
  }
  return out;
}

function parseFile(file: string, mtimeMs: number, size: number): MarkdownFile {
  const raw = fs.readFileSync(file, 'utf8');
  const name = path.basename(file).replace(/\.[^.]+$/, '');
  let data: Record<string, unknown> = {};
  let body = raw;

  try {
    const parsed = matter(raw);
    data = (parsed.data ?? {}) as Record<string, unknown>;
    body = parsed.content;
  } catch (err) {
    // Malformed YAML — fall back to the tolerant parser instead of failing.
    console.warn(`[content] YAML parse failed for ${file}, using lenient parser:`, (err as Error).message);
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (fm) {
      data = parseLenientYaml(fm[1]!);
      body = raw.slice(fm[0]!.length);
    }
  }

  return { file, name, mtimeMs, size, data, body };
}

/**
 * Scan a directory for Markdown files, returning parsed frontmatter + body.
 * Results are cached and invalidated per file by mtime + size.
 */
export function scanMarkdownDir(dir: string, extensions = ['.md']): MarkdownFile[] {
  const cache = cacheFor(dir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const result: MarkdownFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!extensions.includes(path.extname(entry.name).toLowerCase())) continue;

    const file = path.join(dir, entry.name);
    seen.add(file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }

    const cached = cache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      result.push(cached.parsed);
      continue;
    }

    try {
      const parsed = parseFile(file, stat.mtimeMs, stat.size);
      cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, parsed });
      result.push(parsed);
    } catch (err) {
      console.error(`[content] failed to read ${file}:`, (err as Error).message);
    }
  }

  for (const key of [...cache.keys()]) {
    if (!seen.has(key)) cache.delete(key);
  }

  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

/** Look up a single file in a directory by its slug (basename). */
export function readMarkdownFile(dir: string, slug: string, extensions = ['.md']): MarkdownFile | null {
  if (!isSafeSlug(slug)) return null;
  const files = scanMarkdownDir(dir, extensions);
  return files.find((f) => f.name === slug) ?? null;
}

/** Reject slugs that could escape the content directory or hit dotfiles. */
export function isSafeSlug(slug: string): boolean {
  return (
    typeof slug === 'string' &&
    slug.length > 0 &&
    slug.length <= 200 &&
    !slug.includes('/') &&
    !slug.includes('\\') &&
    !slug.includes('\0') &&
    slug !== '.' &&
    slug !== '..' &&
    !slug.startsWith('.')
  );
}

/**
 * Serialise frontmatter + body back to a Markdown file.
 * `js-yaml` (via gray-matter) guarantees the output stays valid.
 *
 * Dates are normalised to `YYYY-MM-DD`: the YAML parser turns an unquoted
 * `date: 2026-07-17` into a JS `Date`, which would otherwise be written back as
 * a noisy `'2026-07-17T00:00:00.000Z'` timestamp (this bit the backup importer,
 * which round-trips parsed frontmatter).
 */
export function stringifyMarkdown(data: Record<string, unknown>, body: string): string {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    clean[key] = value instanceof Date ? formatDate(value) : value;
  }
  const rendered = matter.stringify(body.endsWith('\n') ? body : `${body}\n`, clean);
  // gray-matter does not add a blank line after the closing fence.
  return rendered.replace(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/, (_m, fm: string) => `---\n${fm}\n---\n\n`);
}

/** Atomically write a file (temp file + rename) so readers never see a partial file. */
export function atomicWriteFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

/** Write a Markdown file with frontmatter, invalidating the directory cache. */
export function writeMarkdownFile(
  dir: string,
  slug: string,
  data: Record<string, unknown>,
  body: string,
): string {
  if (!isSafeSlug(slug)) throw new Error(`unsafe slug: ${slug}`);
  const file = path.join(dir, `${slug}.md`);
  atomicWriteFile(file, stringifyMarkdown(data, body));
  cacheFor(dir).delete(file);
  return file;
}

/** Delete a Markdown file, invalidating the cache. */
export function deleteMarkdownFile(dir: string, slug: string): boolean {
  if (!isSafeSlug(slug)) return false;
  const file = path.join(dir, `${slug}.md`);
  try {
    fs.unlinkSync(file);
  } catch {
    return false;
  }
  cacheFor(dir).delete(file);
  return true;
}

/** Drop every cached parse (used by the admin reload endpoint). */
export function invalidateAll(): void {
  for (const cache of caches.values()) cache.clear();
}

/** Drop the cache for one directory. */
export function invalidateDir(dir: string): void {
  cacheFor(dir).clear();
}
