#!/usr/bin/env node
/**
 * import-legacy-mariadb.mjs — One-time migration from the previous OpenResty +
 * MariaDB implementation to this file-based (Hexo-like) one.
 *
 * The old deployment kept posts, pages, talks, friends, comments, visitor
 * permissions and configuration in MariaDB. This script reads those tables and
 * writes the equivalent Markdown / JSON files, reusing the application's own
 * writers so the output format is guaranteed to match.
 *
 * It deliberately shells out to the `mariadb` (or `mysql`) client with `--xml`
 * output — the same dependency-free approach the old Lua backend used — so the
 * migration needs no database driver.
 *
 * Usage:
 *   node scripts/import-legacy-mariadb.mjs [--dry-run] [--skip-config]
 *
 * Connection is taken from the same environment variables the old app used:
 *   BMY_DB_URL=mariadb://user:pass@host:3306/dbname     (preferred)
 *   ...or BMY_DB_HOST / BMY_DB_PORT / BMY_DB_NAME / BMY_DB_USER / BMY_DB_PASS
 *   ...or BMY_DB_SOCKET
 * Content is written under $BMY_BLOG_DIR (default ./blog).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Import the application's own writers so the on-disk format can never drift
// from what the server expects. Node runs TypeScript directly.
const { BLOG_DIR, DATA_DIR, POSTS_DIR, PAGES_DIR, TALKS_DIR, FRIENDS_DIR, ensureDir } = await import(
  path.join(ROOT, 'src/paths.ts')
);
const { writeMarkdownFile } = await import(path.join(ROOT, 'src/content/markdown-files.ts'));
const { addComment } = await import(path.join(ROOT, 'src/store/comments.ts'));
const { setVisitor, addPending, visitorsStore } = await import(path.join(ROOT, 'src/store/visitors.ts'));
const { replaceEvents } = await import(path.join(ROOT, 'src/store/calendar.ts'));

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const SKIP_CONFIG = args.has('--skip-config');

// ===================== Connection =====================

function parseDatabaseUrl(url) {
  // mariadb://user:pass@host:port/dbname?ssl_ca=...
  const match = String(url).match(/^(?:mariadb|mysql):\/\/([^:@/]+)(?::([^@]*))?@([^:/]+)(?::(\d+))?\/([^?]+)/);
  if (!match) return null;
  return {
    user: decodeURIComponent(match[1]),
    password: decodeURIComponent(match[2] ?? ''),
    host: match[3],
    port: Number(match[4] ?? 3306),
    database: decodeURIComponent(match[5]),
  };
}

function connection() {
  const fromUrl = parseDatabaseUrl(process.env.BMY_DB_URL ?? '');
  if (fromUrl) return fromUrl;
  return {
    user: process.env.BMY_DB_USER || 'blogyou',
    password: process.env.BMY_DB_PASS || 'blog-db-pass-2025',
    host: process.env.BMY_DB_HOST || '',
    port: Number(process.env.BMY_DB_PORT || 3306),
    database: process.env.BMY_DB_NAME || 'blogyou',
    socket: process.env.BMY_DB_SOCKET || '',
  };
}

function clientBinary() {
  for (const bin of ['mariadb', 'mysql']) {
    try {
      execFileSync('which', [bin], { stdio: 'pipe' });
      return bin;
    } catch {
      /* try the next one */
    }
  }
  throw new Error('Neither `mariadb` nor `mysql` was found in PATH.');
}

function query(conn, bin, sql) {
  const cliArgs = ['--xml', '--default-character-set=utf8mb4', '-u', conn.user];
  if (conn.host) cliArgs.push('-h', conn.host, '-P', String(conn.port));
  if (conn.socket) cliArgs.push('-S', conn.socket);
  cliArgs.push(conn.database, '-e', sql);

  const output = execFileSync(bin, cliArgs, {
    encoding: 'utf8',
    env: { ...process.env, MYSQL_PWD: conn.password },
    maxBuffer: 256 * 1024 * 1024,
  });
  return parseXmlRows(output);
}

/** Parse `mariadb --xml` output into an array of plain objects. */
function parseXmlRows(xml) {
  const rows = [];
  for (const rowBlock of xml.match(/<row>[\s\S]*?<\/row>/g) ?? []) {
    const row = {};
    // NULL columns are self-closing tags.
    const cleaned = rowBlock.replace(
      /<field name="([^"]*)"[^>]*xsi:nil[^>]*\/>/g,
      '<field name="$1"></field>',
    );
    for (const match of cleaned.matchAll(/<field name="([^"]*)"[^>]*>([\s\S]*?)<\/field>/g)) {
      row[match[1]] = unescapeXml(match[2]);
    }
    rows.push(row);
  }
  return rows;
}

function unescapeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}

/** Parse a JSON array column, tolerating NULL / empty / malformed values. */
function jsonList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function slugify(input) {
  return (
    String(input)
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'untitled'
  );
}

/** Write a file unless --dry-run. */
function emit(file, content) {
  if (DRY_RUN) {
    console.log(`  [dry-run] would write ${path.relative(ROOT, file)}`);
    return;
  }
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, 'utf8');
}

const summary = {};
function count(key, n = 1) {
  summary[key] = (summary[key] ?? 0) + n;
}

// ===================== Migration =====================

function migratePosts(rows) {
  for (const row of rows) {
    const slug = String(row.slug ?? '').trim();
    if (!slug) continue;
    const frontmatter = {
      title: row.title ?? slug,
      date: row.date ?? '',
      tags: jsonList(row.tags),
      categories: jsonList(row.categories),
    };
    if (row.cover) frontmatter.cover = row.cover;
    if (String(row.archived ?? '0') !== '0') frontmatter.archived = true;
    if (row.title_en) frontmatter.title_en = row.title_en;
    if (row.content_en) frontmatter.content_en = row.content_en;

    if (DRY_RUN) {
      console.log(`  [dry-run] post ${slug}`);
    } else {
      writeMarkdownFile(POSTS_DIR, slug, frontmatter, row.content ?? '');
    }
    count('posts');
  }
}

function migratePages(rows, englishBySlug) {
  for (const row of rows) {
    const slug = String(row.slug ?? '').trim();
    if (!slug) continue;
    const frontmatter = { title: row.title ?? slug };
    if (row.title_en) frontmatter.title_en = row.title_en;
    // English body may live on the row or in the page_content table.
    const contentEn = row.content_en || englishBySlug.get(slug) || '';
    if (contentEn) frontmatter.content_en = contentEn;

    if (DRY_RUN) {
      console.log(`  [dry-run] page ${slug}`);
    } else {
      writeMarkdownFile(PAGES_DIR, slug, frontmatter, row.content ?? '');
    }
    count('pages');
  }
}

function migrateTalks(rows) {
  for (const row of rows) {
    const id = Number.parseInt(String(row.id ?? ''), 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    const createTime = Number.parseInt(String(row.create_time ?? ''), 10) || id;
    if (DRY_RUN) {
      console.log(`  [dry-run] talk ${id}`);
    } else {
      writeMarkdownFile(TALKS_DIR, String(id), { id, create_time: createTime }, row.content ?? '');
    }
    count('talks');
  }
}

function migrateFriends(rows) {
  for (const row of rows) {
    const id = Number.parseInt(String(row.id ?? ''), 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    const frontmatter = {
      id,
      title: row.title ?? `friend-${id}`,
      url: row.url || '#',
    };
    if (row.descr) frontmatter.descr = row.descr;
    if (row.title_en) frontmatter.title_en = row.title_en;
    if (row.descr_en) frontmatter.descr_en = row.descr_en;
    if (row.avatar) frontmatter.avatar = row.avatar;
    frontmatter.sort_order = Number.parseInt(String(row.sort_order ?? '0'), 10) || 0;

    if (DRY_RUN) {
      console.log(`  [dry-run] friend ${id}`);
    } else {
      writeMarkdownFile(FRIENDS_DIR, `${id}-${slugify(row.title ?? `friend-${id}`)}`, frontmatter, '');
    }
    count('friends');
  }
}

function migrateComments(rows) {
  for (const row of rows) {
    const url = String(row.url ?? '').trim();
    if (!url) continue;
    if (DRY_RUN) {
      console.log(`  [dry-run] comment ${row.id} → ${url}`);
      count('comments');
      continue;
    }
    addComment({
      id: Number.parseInt(String(row.id ?? ''), 10) || Date.now(),
      nick: String(row.nick ?? ''),
      mail: String(row.mail ?? ''),
      comment: String(row.comment ?? ''),
      link: String(row.link ?? ''),
      ua: String(row.ua ?? ''),
      avatar: String(row.avatar ?? ''),
      url,
      createTime: Number.parseInt(String(row.create_time ?? ''), 10) || Math.floor(Date.now() / 1000),
    });
    count('comments');
  }
}

function migrateVisitors(emailRows, pendingRows) {
  if (DRY_RUN) {
    count('visitors', emailRows.length);
    count('pending', pendingRows.length);
    return;
  }
  for (const row of emailRows) {
    const email = String(row.email ?? '').trim().toLowerCase();
    if (!email) continue;
    setVisitor(email, jsonList(row.permissions));
    count('visitors');
  }
  for (const row of pendingRows) {
    const email = String(row.email ?? '').trim().toLowerCase();
    if (!email) continue;
    addPending(email, String(row.name ?? ''));
    count('pending');
  }
  // Force the store to flush even when both tables were empty.
  visitorsStore.read();
}

function migrateCalendar(rows) {
  const events = rows.map((row) => ({
    id: Number.parseInt(String(row.id ?? ''), 10) || Date.now(),
    title: String(row.title ?? ''),
    date: String(row.date ?? ''),
    description: String(row.description ?? ''),
    color: String(row.color ?? ''),
    createdAt: Number.parseInt(String(row.created_at ?? ''), 10) || Math.floor(Date.now() / 1000),
  }));
  if (DRY_RUN) {
    count('calendar', events.length);
    return;
  }
  if (events.length > 0) replaceEvents(events);
  count('calendar', events.length);
}

/**
 * Config rows are copied verbatim: the `admin_creds` blob is the legacy
 * AES-256-CBC verifier, which `src/store/credentials.ts` can still validate and
 * will transparently upgrade to scrypt on the first successful login. This is
 * what preserves the existing admin password.
 */
function migrateConfig(rows) {
  const targets = {
    admin_creds: path.join(DATA_DIR, 'admin.json'),
    totp_state: path.join(DATA_DIR, 'totp.json'),
    imghost_config: path.join(DATA_DIR, 'imghost.json'),
  };
  for (const row of rows) {
    const key = String(row.key ?? '');
    const file = targets[key];
    if (!file) continue;
    emit(file, `${JSON.stringify(JSON.parse(row.value), null, 2)}\n`);
    count(`config:${key}`);
  }
}

async function main() {
  const conn = connection();
  const bin = clientBinary();
  console.log(`Reading from ${conn.host || conn.socket || 'localhost'}:${conn.port}/${conn.database} using \`${bin}\``);
  console.log(`Writing into ${BLOG_DIR}${DRY_RUN ? '  (DRY RUN — nothing will be written)' : ''}\n`);

  const tables = new Set(
    query(conn, bin, 'SHOW TABLES').flatMap((row) => Object.values(row).map(String)),
  );
  const read = (table) => (tables.has(table) ? query(conn, bin, `SELECT * FROM \`${table}\``) : []);
  const has = (table) => tables.has(table);

  console.log('Migrating:');
  if (has('posts')) migratePosts(read('posts'));
  const englishBySlug = new Map(
    read('page_content').map((row) => [String(row.slug ?? ''), String(row.content_en ?? '')]),
  );
  if (has('pages')) migratePages(read('pages'), englishBySlug);
  if (has('talks')) migrateTalks(read('talks'));
  if (has('friends')) migrateFriends(read('friends'));
  if (has('comments')) migrateComments(read('comments'));
  migrateVisitors(read('emails'), read('pending_registrations'));
  migrateCalendar(read('calendar_events'));
  if (!SKIP_CONFIG) migrateConfig(read('config'));

  console.log('\nSummary:');
  for (const [key, value] of Object.entries(summary).sort()) console.log(`  ${key.padEnd(20)} ${value}`);
  if (Object.keys(summary).length === 0) console.log('  (nothing to migrate)');

  console.log(
    DRY_RUN
      ? '\nDry run complete — re-run without --dry-run to write the files.'
      : `\nDone. Content: ${BLOG_DIR}   Runtime state: ${DATA_DIR}`,
  );
  if (!DRY_RUN && !SKIP_CONFIG) {
    console.log(
      'Your existing admin password was carried over from `admin_creds` and will be\n' +
        're-hashed with scrypt automatically on the first successful login.',
    );
  }
}

main().catch((err) => {
  console.error(`\nMigration failed: ${err.message}`);
  process.exit(1);
});
