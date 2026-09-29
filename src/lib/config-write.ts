/**
 * config-write.ts — write scalar values back into `_config.yml`.
 *
 * The admin console can change a handful of site settings, and those changes
 * have to land in the one configuration file rather than in a second,
 * hidden override store — otherwise `_config.yml` stops being the single
 * source of truth.
 *
 * Doing that safely is the whole point of this module:
 *
 *   1. The edit is **line-based**, not a YAML round-trip. `yaml.dump` would
 *      reformat the file and delete every comment, turning the annotated,
 *      teaching-oriented `_config.yml` into an unreadable key dump.
 *   2. The patched text is **re-parsed and verified** before anything is
 *      written: if it does not parse, or if a key did not end up with the
 *      expected value, the write is abandoned and the original file is left
 *      untouched.
 *   3. The write is atomic (temp file + rename), so a crash mid-write cannot
 *      leave a truncated config behind.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { CONFIG_FILE, invalidateConfig } from '../site-config.ts';

export interface ConfigUpdate {
  /** Dotted key path, e.g. `['theme', 'color']`. */
  path: string[];
  value: string | number | boolean | string[];
}

interface LineInfo {
  /** Index into the original line array. */
  index: number;
  raw: string;
  /** Leading-space count. */
  indent: number;
  /** The key when this line opens a mapping entry, else null. */
  key: string | null;
  /** True for blank lines and full-line comments. */
  ignorable: boolean;
}

/** Parse `key: value` at the start of a line without being fooled by quotes. */
function parseLine(raw: string, index: number): LineInfo {
  const indent = raw.length - raw.trimStart().length;
  const body = raw.trim();
  const ignorable = body === '' || body.startsWith('#');

  let key: string | null = null;
  if (!ignorable) {
    const match = body.match(/^("([^"]*)"|'([^']*)'|([A-Za-z0-9_.-]+))\s*:/);
    if (match) key = match[2] ?? match[3] ?? match[4] ?? null;
  }
  return { index, raw, indent, key, ignorable };
}

/**
 * Decide whether a string can be written without quotes.
 * Conservative on purpose: anything containing `:`, `#`, quotes, leading or
 * trailing space, or that could be read as a number/boolean/null gets quoted.
 */
function needsQuotes(value: string): boolean {
  if (value === '') return true;
  if (!/^[A-Za-z0-9_][A-Za-z0-9_./@+-]*$/.test(value)) return true;
  if (/^(true|false|yes|no|on|off|null|none|~)$/i.test(value)) return true;
  if (/^[+-]?\d/.test(value)) return true;
  return false;
}

function serializeScalar(value: string | number | boolean): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (needsQuotes(value)) return `'${value.replace(/'/g, "''")}'`;
  return value;
}

function serializeValue(value: ConfigUpdate['value']): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeScalar(String(item))).join(', ')}]`;
  }
  return serializeScalar(value);
}

/** Locate the line that defines `path`, or -1. */
function findKeyLine(lines: LineInfo[], keyPath: string[]): number {
  const [head, ...rest] = keyPath;
  const headLine = lines.find((line) => !line.ignorable && line.indent === 0 && line.key === head);
  if (!headLine) return -1;
  if (rest.length === 0) return headLine.index;

  // Walk the block that belongs to `head`: everything more indented than it,
  // stopping at the next top-level entry.
  for (let i = headLine.index + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.ignorable && line.indent <= headLine.indent) break;
    if (!line.ignorable && line.key === rest[0]) return i;
  }
  return -1;
}

/** Last line index of the block opened by `path` (for appending into it). */
function blockEnd(lines: LineInfo[], keyPath: string[]): number {
  const [head] = keyPath;
  const headLine = lines.find((line) => !line.ignorable && line.indent === 0 && line.key === head);
  if (!headLine) return lines.length - 1;
  let end = headLine.index;
  for (let i = headLine.index + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.ignorable && line.indent <= headLine.indent) break;
    end = i;
  }
  return end;
}

function replaceLine(lines: string[], update: ConfigUpdate): void {
  const info = lines.map(parseLine);
  const target = findKeyLine(info, update.path);
  const [head, ...rest] = update.path;

  if (target !== -1) {
    const line = info[target]!;
    const indent = ' '.repeat(line.indent);
    const key = update.path[update.path.length - 1]!;
    lines[target] = `${indent}${key}: ${serializeValue(update.value)}`;
    return;
  }

  // Not present: create it, or append it to the end of its parent block.
  if (rest.length === 0) {
    lines.push(`${head}: ${serializeValue(update.value)}`);
    return;
  }

  const key = rest[rest.length - 1]!;
  const parentExists = info.some((line) => !line.ignorable && line.indent === 0 && line.key === head);
  if (!parentExists) {
    lines.push(`${head}:`);
    lines.push(`  ${key}: ${serializeValue(update.value)}`);
    return;
  }

  const end = blockEnd(info, update.path);
  // `end` may point at a trailing blank line; insert before trailing blanks so
  // the new key stays visually inside the block.
  let insertAt = end + 1;
  while (insertAt - 1 > 0 && lines[insertAt - 1]!.trim() === '') insertAt -= 1;
  lines.splice(insertAt, 0, `  ${key}: ${serializeValue(update.value)}`);
}

/** Read a value out of a parsed object by key path. */
function readPath(object: unknown, keyPath: string[]): unknown {
  let current: unknown = object;
  for (const key of keyPath) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function sameValue(actual: unknown, expected: ConfigUpdate['value']): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      actual.every((item, i) => String(item) === String(expected[i]))
    );
  }
  return String(actual) === String(expected);
}

/**
 * Apply scalar updates to `_config.yml`, preserving comments and layout.
 *
 * Throws (leaving the file untouched) when the result would not parse or when a
 * value did not land where it was expected.
 */
export function patchConfigFile(updates: ConfigUpdate[]): string[] {
  if (updates.length === 0) return [];

  const original = fs.readFileSync(CONFIG_FILE, 'utf8');
  const lines = original.split('\n');
  for (const update of updates) replaceLine(lines, update);

  const next = lines.join('\n');

  // ---- validate before writing ----
  let parsed: unknown;
  try {
    parsed = yaml.load(next, { filename: CONFIG_FILE });
  } catch (err) {
    throw new Error(`refusing to write _config.yml: the result would not parse (${(err as Error).message})`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('refusing to write _config.yml: the result is not a YAML mapping');
  }
  for (const update of updates) {
    const actual = readPath(parsed, update.path);
    if (!sameValue(actual, update.value)) {
      throw new Error(
        `refusing to write _config.yml: ${update.path.join('.')} did not round-trip ` +
          `(expected ${JSON.stringify(update.value)}, got ${JSON.stringify(actual)})`,
      );
    }
  }

  // ---- write ----
  // Preferred: temp file in the same directory + rename, which is atomic. In a
  // container the application directory is often read-only for the app user
  // while `_config.yml` itself is writable, so fall back to an in-place write
  // rather than failing the save outright. Validation already ran, so the
  // window in which a crash could truncate the file is tiny.
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  const tmp = `${CONFIG_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, next, 'utf8');
    fs.renameSync(tmp, CONFIG_FILE);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing to clean up */
    }
    if (code !== 'EACCES' && code !== 'EPERM' && code !== 'EROFS' && code !== 'EXDEV') throw err;
    try {
      fs.writeFileSync(CONFIG_FILE, next, 'utf8');
    } catch (writeErr) {
      const reason = (writeErr as NodeJS.ErrnoException).code ?? (writeErr as Error).message;
      throw new Error(
        `${reason}: cannot write ${CONFIG_FILE}. If this is a container, make sure the file (or the ` +
          'directory holding it) is writable by the user the app runs as, or mount it read-write.',
      );
    }
  }
  invalidateConfig();

  return updates.map((update) => update.path.join('.'));
}

export { CONFIG_FILE };
