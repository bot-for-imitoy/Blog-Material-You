/**
 * paths.ts — Resolve every filesystem location the app uses.
 *
 * The project is file-based (Hexo-like): content lives in `blog/`, runtime
 * state lives in `blog/data/`, and static assets are served from `blog/public`.
 * Every path can be relocated with an environment variable so the Docker image
 * and local development share the same code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository / application root (the directory containing package.json). */
export const ROOT = path.resolve(here, '..');

function envStr(key: string, fallback = ''): string {
  const raw = process.env[key];
  return raw === undefined || raw === '' ? fallback : raw;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return !['0', 'false', 'no', 'off', ''].includes(raw.toLowerCase());
}

/** Content + static root. Overridable with BMY_BLOG_DIR. */
export const BLOG_DIR = path.resolve(envStr('BMY_BLOG_DIR', path.join(ROOT, 'blog')));

/** Markdown content directories. */
export const POSTS_DIR = path.join(BLOG_DIR, 'posts');
export const PAGES_DIR = path.join(BLOG_DIR, 'pages');
export const TALKS_DIR = path.join(BLOG_DIR, 'talks');
export const FRIENDS_DIR = path.join(BLOG_DIR, 'friends');

/** Static assets (css / js / icon / img / vendored libraries). */
export const PUBLIC_DIR = path.resolve(envStr('BMY_PUBLIC_DIR', path.join(BLOG_DIR, 'public')));

/** Uploaded/generated files that live inside the static tree. */
export const AVATARS_DIR = path.join(PUBLIC_DIR, 'avatars');
export const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');

/** EJS templates. */
export const VIEWS_DIR = path.resolve(envStr('BMY_VIEWS_DIR', path.join(ROOT, 'views')));

/** Runtime state (gitignored): credentials, TOTP, image-host config, comments. */
export const DATA_DIR = path.resolve(envStr('BMY_DATA_DIR', path.join(BLOG_DIR, 'data')));
export const COMMENTS_DIR = path.join(DATA_DIR, 'comments');
export const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

/**
 * Resized image variants, written by `GET /media`. Disposable: the directory
 * can be deleted at any time and every file is simply rendered again.
 */
export const IMAGE_CACHE_DIR = path.join(DATA_DIR, 'image-cache');

/** Server configuration. */
export const PORT = envInt('BMY_PORT', 30999);
/**
 * Port of the standalone personal card (`/profile/`).
 *
 * The profile card is served by its own small Express app on this port, so it
 * can be published behind its own domain/path without dragging the blog
 * along. Both servers share the same content, assets and data directory.
 */
export const PROFILE_PORT = envInt('BMY_PROFILE_PORT', 31000);
export const HOST = envStr('BMY_HOST', '0.0.0.0');
export const SITE_URL = envStr('BMY_SITE_URL', '');
export const SESSION_SECRET = envStr('BMY_SESSION_SECRET', '');
export const SESSION_TTL = envInt('BMY_SESSION_TTL', 7 * 24 * 3600);
export const ADMIN_USER = envStr('BMY_ADMIN_USER', 'admin');
/**
 * First-run admin password.
 *
 * Only used while no admin account exists, so a password changed in the UI is
 * never silently reverted on restart. Resetting a *forgotten* password is
 * deliberately NOT an environment switch — it is the explicit, one-off
 * `npm run passwd-reset` command, so nothing in a deployment config can
 * overwrite credentials behind your back.
 */
export const ADMIN_PASS = envStr('BMY_ADMIN_PASS', '');
export const TRUST_PROXY = envBool('BMY_TRUST_PROXY', false);
export const MAX_UPLOAD_MB = envInt('BMY_MAX_UPLOAD_MB', 100);
export const DEV = envStr('NODE_ENV', 'development') !== 'production';

/** Image host (SFTP or S3). */
export const IMGHOST = {
  provider: envStr('BMY_IMGHOST_PROVIDER', '') as '' | 'sftp' | 's3',
  s3: {
    endpoint: envStr('BMY_S3_ENDPOINT'),
    bucket: envStr('BMY_S3_BUCKET'),
    accessKey: envStr('BMY_S3_ACCESS_KEY'),
    secretKey: envStr('BMY_S3_SECRET_KEY'),
    region: envStr('BMY_S3_REGION'),
    prefix: envStr('BMY_S3_PREFIX'),
    publicUrlBase: envStr('BMY_S3_PUBLIC_URL_BASE'),
    insecure: envBool('BMY_S3_INSECURE', false),
    sslCa: envStr('BMY_S3_SSL_CA'),
    sslCert: envStr('BMY_S3_SSL_CERT'),
    sslKey: envStr('BMY_S3_SSL_KEY'),
  },
};

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Create every runtime directory the app expects to exist. */
export function ensureRuntimeDirs(): void {
  for (const dir of [DATA_DIR, COMMENTS_DIR, SESSIONS_DIR, AVATARS_DIR, UPLOADS_DIR, IMAGE_CACHE_DIR]) {
    ensureDir(dir);
  }
}
