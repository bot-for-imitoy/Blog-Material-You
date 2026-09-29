/**
 * text.ts — Small text helpers shared by the API and the templates.
 *
 * The truncate/stripMarkdown behaviour intentionally mirrors the original Lua
 * implementation (UTF-8 safe, identical truncation markers) so existing content
 * keeps producing the same excerpts.
 */

/** HTML-escape a value for safe interpolation in templates. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Truncate to `maxChars` Unicode code points, appending "..." when cut.
 * Operates on code points (not UTF-16 units) so CJK and emoji are never
 * sliced in half.
 */
export function truncate(str: unknown, maxChars: number): string {
  if (str === null || str === undefined) return '';
  const s = String(str);
  if (s === '') return '';
  if (!maxChars || maxChars <= 0) return '';
  if (s.length <= maxChars) return s;
  const chars = Array.from(s);
  if (chars.length <= maxChars) return s;
  return chars.slice(0, maxChars).join('') + '...';
}

/** Collapse runs of whitespace and trim (Lua `%s+` + trim). */
function squeeze(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Crude Markdown → plain text, used for meta descriptions and auto excerpts.
 * Derived from the original Lua chain, with heading markers removed on every
 * line (the Lua version only stripped a marker at position 0, so excerpts used
 * to begin with a literal "#").
 */
export function stripMarkdown(input: unknown, maxChars = 200): string {
  if (input === null || input === undefined) return '';
  let s = String(input).replace(/^\s+/, '');
  s = s.replace(/^[ \t]*#{1,6}[ \t]*/gm, '');
  s = s.replace(/^[ \t]*>[ \t]?/gm, '');
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/```[\s\S]*$/g, ' ');
  s = s.replace(/~~~/g, '');
  s = s.replace(/!\[[\s\S]*?\]\([\s\S]*?\)/g, '');
  s = s.replace(/\[([\s\S]*?)\]\([\s\S]*?\)/g, '$1');
  s = s.replace(/\*\*/g, '');
  s = s.replace(/\*/g, '');
  s = s.replace(/`/g, '');
  s = s.replace(/^\s*[-*+]\s+/gm, '');
  s = s.replace(/^\s*\d+\.\s+/gm, '');
  s = squeeze(s);
  if (maxChars > 0 && Array.from(s).length > maxChars) {
    return Array.from(s).slice(0, maxChars).join('') + '…';
  }
  return s;
}

/**
 * Normalise a frontmatter date to `YYYY-MM-DD`.
 * Accepts `YYYY-MM-DD...`, a Unix timestamp (seconds), a Date, or a number.
 */
export function formatDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isoDate(value);
  }
  if (typeof value === 'number') return isoDate(new Date(value * 1000));

  const s = String(value);
  const cleaned = s.match(/(\d.*)/);
  const source = cleaned ? cleaned[1]! : s;

  const ymd = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;

  const ts = Number(s);
  if (Number.isFinite(ts) && ts > 0) return isoDate(new Date(ts * 1000));
  return s;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a `YYYY-MM-DD` string into sortable parts. */
export function parseDate(value: unknown): { year: number; month: number; day: number } | null {
  const s = formatDate(value);
  const m = s.match(/^(\d+)-(\d+)-(\d+)/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Trim + coerce to string (frontmatter values can be numbers/booleans). */
export function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Normalise a frontmatter list field. Accepts an array (the normal case) or a
 * comma-separated string, which is what the admin editor sends.
 */
export function toList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((v) => str(v)).filter((v) => v !== '');
  }
  const s = str(value);
  if (s === '') return [];
  return s
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

/** Slugify an arbitrary string into a URL-safe identifier. */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'untitled'
  );
}

/** Make a string safe to use as a filename (mirrors utils.safe_filename). */
export function safeFilename(input: string): string {
  return input.replace(/[^\w\-.]/g, '_');
}

/** Format a Unix timestamp (seconds) as `YYYY-MM-DD HH:mm`. */
export function formatDateTime(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
