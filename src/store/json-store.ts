/**
 * json-store.ts — Small atomic JSON file store for runtime state.
 *
 * The rewrite keeps every piece of mutable state in plain files under
 * `blog/data/` instead of a database: admin credentials, the TOTP secret,
 * the image-host settings, visitor permissions and comments. Reads are cached
 * and invalidated by mtime so hand-editing a file still works.
 */
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore<T extends object> {
  readonly file: string;
  private readonly defaults: () => T;
  private readonly mode: number;
  private cache: { mtimeMs: number; value: T } | null = null;

  constructor(file: string, defaults: () => T, mode = 0o600) {
    this.file = file;
    this.defaults = defaults;
    this.mode = mode;
  }

  /** Read the current value, re-parsing when the file changed on disk. */
  read(): T {
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(this.file);
    } catch {
      stat = null;
    }

    if (!stat) {
      // Missing file → defaults, but do not create it until something writes.
      this.cache = null;
      return this.defaults();
    }

    if (this.cache && this.cache.mtimeMs === stat.mtimeMs) {
      return this.cache.value;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as T;
      const merged = { ...this.defaults(), ...parsed };
      this.cache = { mtimeMs: stat.mtimeMs, value: merged };
      return merged;
    } catch (err) {
      console.error(`[store] corrupt JSON in ${this.file}:`, (err as Error).message);
      return this.defaults();
    }
  }

  /** Replace the stored value atomically. */
  write(value: T): T {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: this.mode });
    fs.renameSync(tmp, this.file);
    try {
      fs.chmodSync(this.file, this.mode);
    } catch {
      /* best effort — some filesystems ignore chmod */
    }
    this.cache = null;
    return value;
  }

  /** Read-modify-write helper. */
  update(fn: (current: T) => T): T {
    return this.write(fn(this.read()));
  }

  /** Remove the store file (resets to defaults). */
  reset(): void {
    try {
      fs.unlinkSync(this.file);
    } catch {
      /* already gone */
    }
    this.cache = null;
  }

  exists(): boolean {
    return fs.existsSync(this.file);
  }
}
