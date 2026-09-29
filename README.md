# Blog Material You

A self-hosted blog built on a **Node.js + TypeScript** backend with **local Markdown storage (Hexo-like, no database at all)**, a **MDUI 2 (Material Design 3)** frontend, and full **server-side rendering**.

Every post, page, talk and friend link is a Markdown file with YAML frontmatter under `blog/`. Every piece of runtime state — admin credentials, comments, visitor permissions, the TOTP secret, image-host settings — is a JSON file under `blog/data/`. There is no MariaDB, no nginx, no OpenResty, no Python, and no external CDN: one Node.js process serves the public site, the admin console and both JSON APIs on a single port.

This is a ground-up rewrite of the previous OpenResty/Lua + MariaDB implementation. **No database is required any more.** Upgrading is supported: see [Migrating from the old MariaDB version](#migrating-from-the-old-mariadb-version).

---

## Project Structure

```
Blog-Material-You/
├── src/                      # Node.js + TypeScript application (run directly, no build step)
│   ├── index.ts              # Entry point: runtime dirs, vendor assets, admin bootstrap, HTTP server
│   ├── app.ts                # Express wiring: security headers, Origin guard, static, routes, 404/500
│   ├── paths.ts              # Every filesystem location + environment variable resolution
│   ├── version.ts            # Application version (reported by /api/health and /api/status)
│   ├── site-config.ts        # Site settings + the complete UI string dictionary + navigation menu
│   ├── content/              # Markdown content model (the "database")
│   │   ├── markdown-files.ts # mtime/size-cached scanner, frontmatter parser, atomic writer
│   │   ├── posts.ts          # blog/posts/*.md       → Post
│   │   ├── pages.ts          # blog/pages/*.md       → Page
│   │   ├── talks.ts          # blog/talks/*.md       → Talk (short "moments")
│   │   └── friends.ts        # blog/friends/*.md     → Friend
│   ├── store/                # Runtime state, one JSON file per concern
│   │   ├── json-store.ts     # Atomic, mtime-cached JSON file store
│   │   ├── credentials.ts    # blog/data/admin.json    (scrypt + legacy AES records)
│   │   ├── totp-state.ts     # blog/data/totp.json     (2FA secret, pending secret)
│   │   ├── visitors.ts       # blog/data/visitors.json (registered emails + pending queue)
│   │   ├── comments.ts       # blog/data/comments/<key>.json (one file per page URL)
│   │   ├── calendar.ts       # blog/data/calendar.json
│   │   └── imghost-config.ts # blog/data/imghost.json  (SFTP / S3 settings)
│   ├── auth/                 # password, secret, session, TOTP, visitor session
│   ├── middleware/           # admin-auth.ts — API and HTML page guards
│   ├── media/                # imghost.ts (S3/SFTP upload), avatar.ts (sharp → 512×512 WebP)
│   ├── lib/                  # markdown.ts, text.ts, ratelimit.ts, backup.ts
│   ├── render/               # engine.ts (EJS), seo.ts (per-route title/description/canonical)
│   └── routes/               # public-pages.ts, public-api.ts, admin-pages.ts, admin-api.ts
├── views/                    # EJS templates (server-rendered, no client-side templating)
│   ├── layouts/              # public.ejs, admin.ejs
│   ├── pages/                # home, posts, post, list, tags, categories, archives,
│   │                         # talks, friends, page, status, auth, 404
│   ├── admin/                # dashboard, posts, editor, pages, page-editor, talks,
│   │                         # talk-editor, friends, friend-editor, comments, visitors,
│   │                         # security, imghost, backup, login, setup
│   └── game/2048.ejs         # Easter egg
├── blog/                     # Content + static assets + runtime state
│   ├── posts/                # <slug>.md
│   ├── pages/                # <slug>.md  (+ optional legacy <slug>.en.json)
│   ├── talks/                # <unixtime>.md
│   ├── friends/              # <id>-<slug>.md
│   ├── data/                 # Runtime state (gitignored): credentials, comments,
│   │                         # visitors, TOTP, sessions, site/calendar/imghost settings
│   ├── locales.yml           # Legacy translation file kept for reference (unused at runtime)
│   └── public/               # Static assets served under /css, /js, /icon, /img, …
│       └── vendor/           # GENERATED: mdui, KaTeX, highlight.js copied from node_modules
├── scripts/
│   ├── sync-assets.mjs       # Vendors mdui/KaTeX/highlight.js into blog/public/vendor
│   └── import-legacy-mariadb.mjs  # One-time migration from the old MariaDB install
├── Dockerfile                # node:24-alpine, non-root, HEALTHCHECK
├── docker-compose.yml        # Single container + volumes
├── .env.example              # Every supported environment variable, documented
├── package.json              # npm start / dev / typecheck / assets
├── tsconfig.json             # strict, NodeNext, noEmit (Node runs the .ts files directly)
└── README.md / README.zh.md
```

### Where state lives

| Path | Contents | Gitignored |
|------|----------|------------|
| `blog/posts/`, `blog/pages/`, `blog/talks/`, `blog/friends/` | Your content as Markdown — **this is the database** | yes (only `.gitkeep` files are tracked) |
| `blog/data/` | Runtime state: `admin.json` (credentials), `totp.json`, `visitors.json`, `site.json`, `calendar.json`, `imghost.json`, `secret.json`, `comments/`, `sessions/` | yes |
| `blog/public/vendor/` | mdui / KaTeX / highlight.js, generated from `node_modules` by `scripts/sync-assets.mjs` | yes |
| `blog/public/avatars/`, `blog/public/uploads/` | Uploaded images | yes |

`blog/public/vendor/` is generated, not source. `npm install` runs `sync-assets.mjs` via `postinstall`, and the server regenerates the bundle on boot if it is missing, so a fresh clone still works offline — the site never loads a public CDN at runtime.

---

## Quick Start

### Requirements

- **Node.js ≥ 22.18** (the app runs TypeScript directly through Node's built-in type stripping — there is no build step)
- No database, no web server, no Python

### Local

```bash
npm install     # installs dependencies and vendors the front-end libraries
npm start       # → http://localhost:30999/
```

Useful scripts:

| Command | Purpose |
|---------|---------|
| `npm start` | Run the server (`node src/index.ts`) |
| `npm run dev` | Run with `--watch` (restarts on file changes) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run assets` | Re-vendor mdui / KaTeX / highlight.js into `blog/public/vendor` |

### Docker

```bash
docker compose up -d --build
```

`docker-compose.yml` publishes container port `30999` on host port **`8000`** by default — change the `ports:` mapping if you want a different host port.

### URLs

| Service | URL | Notes |
|---------|-----|-------|
| Blog | `http://localhost:30999/` (Docker: `http://localhost:8000/`) | Server-rendered |
| Admin console | `http://localhost:30999/admin/` | Redirects to `/admin/dashboard/` |
| Health check | `http://localhost:30999/api/health` | `{"status":"ok","server":"nodejs","version":"2.0.0"}` |
| First-run setup | `http://localhost:30999/admin/setup/` | Only reachable while no admin exists |
| Sitemap / RSS | `/sitemap.xml`, `/rss.xml` | Absolute URLs when `BMY_SITE_URL` is set |

### Creating the admin account

The first time you open the site there is **no admin account**. Visit **`/admin/setup/`** and choose a username and password (≥ 6 characters; a few well-known passwords are rejected). The account is written to `blog/data/admin.json` with a scrypt hash, and `/admin/setup/` then redirects to the login page.

For unattended deployments you can create the account from the environment instead: set `BMY_ADMIN_USER` / `BMY_ADMIN_PASS` and start the server. This only applies **while no admin account exists**, so a password you change later in the UI is never silently reverted on restart. To force an overwrite — the recovery path for a forgotten password — set `BMY_ADMIN_PASS` together with **`BMY_ADMIN_RESET=1`** and restart, then remove both variables again.

---

## Content Authoring

All content lives in `blog/` as UTF-8 Markdown files with a YAML frontmatter block. **The filename (without `.md`) is the slug** used in URLs, in `/api/...` paths and in the admin console.

Files are scanned lazily and cached by **mtime + size**. Editing a file with your own editor (or `git pull`) is picked up on the next request — no restart, no reload endpoint needed. Markdown is rendered **on the server**, so every page is complete HTML for crawlers and for readers without JavaScript, with:

- heading anchors (`id` attributes on every heading, exposed as a table of contents on posts/pages)
- syntax highlighting via highlight.js (dark and light GitHub themes are vendored)
- KaTeX math (`$…$` inline, `$$…$$` display)
- link auto-detection, tables and blockquotes

### Posts — `blog/posts/<slug>.md`

| Field | Type | Meaning |
|-------|------|---------|
| `title` | string | Display title (falls back to the slug) |
| `date` | `YYYY-MM-DD` or Unix seconds | Sort key and archive year; normalised on read |
| `tags` | list | Used by `/tags/`, `/tags/:name` and `GET /api/tags` |
| `categories` | list | Used by `/categories/`, `/categories/:name` and `GET /api/categories` |
| `cover` | string | Optional card/hero image URL |
| `archived` | boolean | `true` moves the post to `/archives/` and hides it from the home page |
| `title_en` | string | English title (optional) |
| `content_en` | string | English body as YAML (optional) |

```markdown
---
title: 用 Docker 部署一个静态博客
date: 2025-11-23
tags: [Docker, Linux]
categories: [笔记]
cover: /img/cover.jpg
title_en: Deploying a static blog with Docker
---

# 背景

正文内容写在这里。

```bash
docker compose up -d --build
```

行内公式 $E = mc^2$，块级公式：

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

## 小结

更多内容……
```

Bilingual posts: keep the Chinese body in the Markdown body and put the English body in the `content_en` frontmatter field (a YAML block scalar or a single-quoted string both work). `/api/posts/:slug` then returns `html` and `htmlEn`, and the per-route SEO metadata switches to the English title/description when `title_en` is present.

Lists may be written either as YAML sequences (`[Docker, Linux]`, `- Docker`) or as a comma-separated string — the admin editor sends the latter. If a file's YAML is malformed the app falls back to a tolerant line-based parser (the same behaviour as the previous Lua implementation) and logs a warning instead of dropping the file.

### Pages — `blog/pages/<slug>.md`

Standalone pages. `about.md` is served at **`/about/`**; every other page is served at **`/pages/<slug>/`**.

| Field | Type | Meaning |
|-------|------|---------|
| `title` | string | Page title (falls back to the slug) |
| `title_en` | string | English title (optional) |
| `content_en` | string | English body as YAML (optional) |

```markdown
---
title: 关于
title_en: About Me
---

这里是页面正文。
```

For backwards compatibility with the previous storage, the English body may instead live in a sibling file `blog/pages/<slug>.en.json` containing `{"content_en": "…"}`. The frontmatter field wins; the sidecar is only read when it is absent. When both an English title and an English body are available, `/pages/<slug>/` renders the English variant.

### Talks (动态) — `blog/talks/<unixtime>.md`

Short "moments". The filename is the numeric id and doubles as the creation timestamp when `create_time` is missing.

| Field | Type | Meaning |
|-------|------|---------|
| `id` | integer | Talk id; also the filename |
| `create_time` | Unix seconds | Sort key (newest first) |

```markdown
---
id: 1781603753
create_time: 1781603753
---

今天天气真好！在浏览器里测试动态功能。 😊
```

### Friend links — `blog/friends/<id>-<slug>.md`

| Field | Type | Meaning |
|-------|------|---------|
| `id` | integer | Numeric id, unique; the filename starts with it |
| `title` | string | Site name (falls back to the filename) |
| `descr` | string | Description |
| `title_en` / `descr_en` | string | English variants (optional) |
| `avatar` | string | Avatar image URL |
| `url` | string | Target link (defaults to `#`) |
| `sort_order` | integer | Ascending display order, then `id` |

```markdown
---
id: 2
title: Google
descr: 全球最大的搜索引擎
title_en: Google
descr_en: The world's largest search engine
avatar: https://www.google.com/favicon.ico
url: https://www.google.com
sort_order: 0
---
```

When you change a friend's `title` through the admin console, the file is renamed to keep the `<id>-<slug>` convention in sync.

### Writing content from the admin console

The editors at `/admin/posts/new/`, `/admin/pages/new/`, `/admin/talks/new/` and `/admin/friends/new/` write exactly the same files, atomically (temp file + rename). Mutations invalidate the Markdown cache automatically, so a saved post is visible on the public site on the very next request. The `POST /api/admin/reload` endpoint still exists for content you edited by hand outside the process.

---

## Features

### Public site

- **Home** (`/`) — card grid of active posts, newest first, with cover images and auto excerpts.
- **Posts** (`/posts/`) — all active posts grouped by year; individual posts at `/post/<slug>/`.
- **Post detail** — server-rendered body, table of contents generated from the heading anchors, tags, categories, cover, and the comment form when comments are enabled.
- **Tags** (`/tags/`, `/tags/:name/`) and **Categories** (`/categories/`, `/categories/:name/`) — facet indexes with post counts, most used first.
- **Archives** (`/archives/`) — posts flagged `archived: true`, grouped by year. Tag and category listings deliberately include archived posts too.
- **Talks** (`/talks/`) — chronological "moments".
- **Friend links** (`/friends/`).
- **Pages** — `/about/` plus `/pages/<slug>/`.
- **Status** (`/status/`) — live process uptime, Node.js version, memory usage and content counts (posts, comments, talks, friends, registered visitors), plus the permission-gated visitor calendar.
- **Visitor identity** (`/auth/`) — a reader enters an email address; a registered address receives a signed visitor cookie, an unknown one can submit a registration request that lands in the admin approval queue. Logging out works both as a plain HTML form post (`POST /auth/logout`, no JavaScript required) and as JSON (`POST /api/auth/logout`).
- **2048** (`/2048/`) — the easter egg, complete with best-score persistence in the browser.
- **Search** (`/search/`) — full-text search over titles, tags, categories and post bodies, with an in-process index. Works without JavaScript (plain GET form); `js/search.js` upgrades it to live results as you type, and `Ctrl`/`Cmd`+`K` focuses the field.
- **Bilingual content** — per-post and per-page English title/body; the public UI strings live in `src/site-config.ts` and can be overridden per key from `blog/data/site.json`.
- **SEO** — per-route `<title>`, meta description and canonical link, plus `/sitemap.xml` and `/rss.xml` (20 newest posts). Set `BMY_SITE_URL` so the canonical URLs and feed links are absolute.

### Comments

- One JSON file per page URL under `blog/data/comments/`; writes are atomic and the reader is mtime-cached.
- Fields: `id`, `nick`, `mail`, `comment`, `link`, `ua`, `avatar`, `url`, `createTime`.
- Server-side validation: nickname ≤ 80, email ≤ 200 and format-checked, body ≤ 5000, `link` must start with `http(s)://`, user agent truncated to 500 characters (the original implementation had no limits at all).
- Posting is rate limited to 10 comments per IP per minute. Comment moderation (list across all pages, delete) lives in the admin console.

### Search

`/search/` is a normal server-rendered page, so a query is a shareable URL and the form works with JavaScript disabled. It queries titles, English titles, tags, categories and post bodies.

- **Index**: built in-process from the same mtime-cached Markdown scanner the rest of the site uses, and memoised on the set of file mtimes — editing a post invalidates it automatically, with no rebuild step or search daemon. `POST /api/admin/reload` drops it explicitly.
- **Matching is substring-based**, not word-based. Chinese has no spaces, so a Latin-style tokeniser would fail on exactly the queries this blog receives; Latin queries still work because matching is case-insensitive and a multi-word query is split on spaces for AND-style ranking.
- **Ranking**: title matches outweigh English titles, which outweigh tags/categories, which outweigh body hits. Archived posts are still findable but rank 40% lower. A post matching every token ranks above one matching only some.
- **Snippets** are cut around the first match and the matched terms are wrapped in `<mark>`. Highlighting is XSS-safe by construction: text is HTML-escaped *before* the `<mark>` tags are inserted, so a post containing `<script>` can never inject markup. The client-side live search never uses `innerHTML` either — it rebuilds the highlight with `createElement` + `textContent`.
- **Rate limit**: 60 requests per IP per minute on `/api/search`.
- **SEO**: the results page carries `noindex, follow`, since per-query result pages are thin duplicates; the posts they link to stay indexable.

### Admin console

Every page under `/admin/` is a complete server-rendered document, not a client-side SPA:

| Page | What it does |
|------|--------------|
| `/admin/login/` | Password login; becomes a two-step form when TOTP is enabled |
| `/admin/setup/` | First-run wizard that creates the admin account (only while none exists) |
| `/admin/dashboard/` | Counts (active/archived posts, comments, tags, talks) and the five most recent posts |
| `/admin/posts/` | All posts incl. archived; create, edit, archive/unarchive, delete |
| `/admin/posts/new/`, `/admin/posts/:slug/edit/` | Post editor: slug, title, date, cover, comma-separated tags/categories, Chinese and English bodies |
| `/admin/pages/`, `/admin/pages/new/`, `/admin/pages/:slug/edit/` | Page list and editor (upsert by slug) |
| `/admin/talks/`, `/admin/talks/new/` | Publish, edit and delete talks |
| `/admin/friends/`, `/admin/friends/new/`, `/admin/friends/:id/edit/` | Friend-link list and editor |
| `/admin/comments/` | Every comment across every page, newest first, with delete |
| `/admin/visitors/` | **Visitor management (new in the rewrite)**: approve pending registration requests, grant or revoke the `calendar` permission, add or remove approved addresses |
| `/admin/security/` | Change username/password, enable or disable TOTP 2FA (QR/secret + 6-digit confirmation) |
| `/admin/imghost/` | Image-host configuration (SFTP or S3, incl. TLS/mTLS) and a connection test |
| `/admin/backup/` | Export the whole site as one JSON file and import a backup |

### Image hosting

Uploaded avatars are resized to 512×512 WebP by sharp and written to `blog/public/avatars/`. Two remote providers are supported, configured in `/admin/imghost/` or entirely through environment variables:

- **S3-compatible** (MinIO, AWS S3, Cloudflare R2, …) via `@aws-sdk/client-s3`, including custom CA and **mutual TLS** (client certificate + key).
- **SFTP** via `ssh2-sftp-client` (host, port, username, private-key path, remote directory).

Both providers support a filename template (`{yy}`, `{mm}`, `{dd}`, `{file_extension}`, `{original}`); path separators in a rendered name are neutralised and templates without per-upload uniqueness get a short random suffix so two uploads on the same day cannot overwrite each other. When S3 is enabled, freshly generated avatars are mirrored to the bucket so multiple instances serve the same file.

### Security

- Passwords use **scrypt** (N=16384, r=8, p=1, 64-byte key, 16-byte random salt) with constant-time verification. Records written by the old implementation (AES-256-CBC + `EVP_BytesToKey`) are still accepted and are **transparently re-hashed with scrypt on the next successful login**.
- Sessions are `base64url(payload).HMAC-SHA256(payload)` tokens carrying username, issue time and a random nonce. **Logout really revokes** (the token is blacklisted) and changing the password or username bumps a revocation epoch that invalidates every outstanding token — the original only dropped the cookie and left the token valid for 7 days.
- The session secret comes from `BMY_SESSION_SECRET` or, when unset, is **generated once and persisted** to `blog/data/secret.json` (mode `0600`). The old build shipped a hard-coded default secret, which let anyone forge an admin token.
- The admin cookie is `HttpOnly` + `SameSite=Strict` with a 7-day TTL (configurable with `BMY_SESSION_TTL`, in seconds); the visitor cookie is `HttpOnly` + `SameSite=Lax`. The token itself is signed with the session secret, so a token from one deployment is useless on another.
- **TOTP 2FA** — RFC 6238, HMAC-SHA1, 6 digits, 30-second steps, ±1 step of clock skew, compatible with Google Authenticator / Authy / 1Password. Login becomes a two-step handshake: the password step returns a single-use 5-minute temp token, and a wrong code **burns** that token so codes cannot be brute-forced against one handshake. Enabling 2FA requires proving a working code first. The active secret is never returned by the API — only a pending, unconfirmed one.
- **Origin check** on every state-changing request (anything other than GET/HEAD/OPTIONS): a cross-origin `Origin` header is rejected with 403. This complements `SameSite=Strict` and also protects the `Authorization: Bearer` path.
- **Rate limiting** is enforced in-process, keyed by client IP and route: admin login and setup 30/min, comment posting 10/min, `/api/auth/check` 20/min, `/api/auth/register` 5/min, avatar uploads one per 30 seconds. Exceeding a limit returns HTTP 429 with a `Retry-After` header.
- **Strict Content-Security-Policy** with no third-party CDN and no inline scripts (`script-src 'self'`; `style-src 'self' 'unsafe-inline'` only because mdui sets inline style attributes). Also `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`. `X-Powered-By` is disabled.
- `isSafeSlug()` guards every slug-derived path (no `/`, no `\`, no NUL, no leading dot, ≤ 200 characters), and the backup importer rebuilds all filenames from validated slugs — so neither a crafted URL nor a crafted backup can write outside the content directories.
- Admin usernames are restricted to `[A-Za-z0-9_.-]{1,64}`, passwords must be ≥ 6 characters, and a small list of leaked/weak passwords (`bmy2025`, `admin`, `password`, …) is rejected at setup.
- **Every** admin page and **every** `/api/admin/*` route except `login`/`setup` is authentication-gated (`requireAdmin` for the JSON API, `requireAdminPage` for HTML). The old implementation exposed its `/api/admin/ssr/*` fragment endpoints completely unauthenticated.

#### Known limitation: visitor email verification

Without an SMTP provider there is no way to prove that a visitor controls the address they type in. `/api/auth/check` therefore grants a signed visitor cookie to **any known (already approved) address on request** — it verifies *registration*, not *ownership*. The code documents this in `src/auth/visitor.ts`. Treat the visitor system as a light permission gate (it exists to protect the calendar), not as an authentication mechanism: everything genuinely sensitive is behind the admin login. If you need real proof of ownership, add an SMTP-based confirmation flow before enabling it for untrusted users.

---

## Configuration

Copy `.env.example` to `.env` (it is gitignored) or pass the variables to Docker. Everything is optional — the defaults are sensible for local use.

### Service

| Variable | Default | Meaning |
|----------|---------|---------|
| `BMY_PORT` | `30999` | HTTP listen port |
| `BMY_HOST` | `0.0.0.0` | Listen address |
| `BMY_SITE_URL` | *(empty)* | Public base URL, e.g. `https://blog.example.com`. Used for canonical links, `sitemap.xml` and `rss.xml`; without it those URLs are relative |
| `BMY_TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy so rate limiting keys on the real client IP from `X-Forwarded-For` |
| `BMY_MAX_UPLOAD_MB` | `100` | JSON/URL-encoded request-body limit, in MB (backup import) |
| `NODE_ENV` | `development` | `production` enables EJS template caching and disables development warnings |

### Admin account

| Variable | Default | Meaning |
|----------|---------|---------|
| `BMY_ADMIN_USER` | `admin` | Admin username used when bootstrapping from the environment |
| `BMY_ADMIN_PASS` | *(empty)* | When set **and no admin account exists**, creates the account at startup. It never overwrites a password you changed in the UI |
| `BMY_ADMIN_RESET` | `0` | Together with `BMY_ADMIN_PASS`, forces the admin account to be overwritten on the next start — the documented recovery path for a forgotten password. Remove both variables again afterwards |
| `BMY_SESSION_SECRET` | *(empty)* | HMAC key for admin session tokens. When empty, a random 32-byte secret is generated once and stored in `blog/data/secret.json` |
| `BMY_SESSION_TTL` | `604800` | Session lifetime in seconds (7 days) |

### Directories

| Variable | Default | Meaning |
|----------|---------|---------|
| `BMY_BLOG_DIR` | `./blog` | Content + static + runtime-state root |
| `BMY_DATA_DIR` | `$BMY_BLOG_DIR/data` | Runtime state (credentials, comments, visitors, TOTP, settings, sessions) |
| `BMY_PUBLIC_DIR` | `$BMY_BLOG_DIR/public` | Static assets (css/js/icon/img/vendor/avatars/uploads) |
| `BMY_VIEWS_DIR` | `./views` | EJS template directory |

### Image host (S3 / SFTP)

| Variable | Default | Meaning |
|----------|---------|---------|
| `BMY_IMGHOST_PROVIDER` | *(empty)* | `s3` or `sftp` — setting it also enables image hosting |
| `BMY_S3_ENDPOINT` | *(empty)* | S3 endpoint, e.g. `http://minio:9000`. A complete set of the four S3 credentials enables S3 on its own |
| `BMY_S3_BUCKET` | *(empty)* | Bucket name |
| `BMY_S3_ACCESS_KEY` | *(empty)* | Access key |
| `BMY_S3_SECRET_KEY` | *(empty)* | Secret key |
| `BMY_S3_REGION` | *(empty)* | Region (AWS); empty means `us-east-1` |
| `BMY_S3_PREFIX` | *(empty)* | Optional key prefix inside the bucket |
| `BMY_S3_PUBLIC_URL_BASE` | *(empty)* | Public URL base for served objects; defaults to `$BMY_S3_ENDPOINT/$BMY_S3_BUCKET` |
| `BMY_S3_INSECURE` | `0` | `1` skips TLS certificate verification (self-signed certificates) |
| `BMY_S3_SSL_CA` | *(empty)* | CA bundle path (inside the container) used to verify the S3 server |
| `BMY_S3_SSL_CERT` | *(empty)* | Client certificate path for **mutual TLS** |
| `BMY_S3_SSL_KEY` | *(empty)* | Client private key path for **mutual TLS**. Mutual TLS needs certificate + key in one file, so `BMY_S3_SSL_CERT` and `BMY_S3_SSL_KEY` usually point at the same PEM bundle |

SFTP settings have no environment variables — configure them on `/admin/imghost/`; they are stored in `blog/data/imghost.json`. Environment variables always win over the stored file and are never written back, so a deployment configured entirely through env vars keeps working when the settings form is saved.

### Migration only

These are read by `scripts/import-legacy-mariadb.mjs`, not by the server:

| Variable | Default | Meaning |
|----------|---------|---------|
| `BMY_DB_URL` | *(empty)* | `mariadb://user:pass@host:3306/dbname` — takes precedence over the individual values |
| `BMY_DB_HOST` / `BMY_DB_PORT` | *(empty)* / `3306` | TCP host and port |
| `BMY_DB_SOCKET` | *(empty)* | Unix socket path (used when no host is set) |
| `BMY_DB_NAME` | `blogyou` | Database name |
| `BMY_DB_USER` / `BMY_DB_PASS` | `blogyou` / `blog-db-pass-2025` | Database credentials |

---

## HTTP API

### Response envelope

Every JSON endpoint except `/api/health` uses the same envelope:

```json
{ "errno": 0,  "data": { } }
{ "errno": -1, "errmsg": "Post not found: foo" }
```

`errno: 0` means success and the payload is under `data`; `errno: -1` means failure and the human-readable reason is `errmsg`. The HTTP status carries the semantics as well (`400` validation, `401` unauthenticated, `403` forbidden, `404` missing, `409` conflict, `429` rate limited, `500` unexpected). `/api/health` is deliberately plain for load balancers and returns `{"status":"ok","server":"nodejs","version":"2.0.0"}` with a 200. Field names are camelCase throughout (the pre-rewrite API mixed snake_case and camelCase and leaked `session_secret`, `admin_user` and `admin_pass` from `/api/config`).

### Public API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness probe (plain object, no envelope) |
| GET | `/api/site` | Site settings, navigation menu and the full UI string dictionary — never any credential material |
| GET | `/api/status` | Uptime, start time, Node.js version, platform, memory, and counts (posts, comments, talks, friends, visitors) |
| GET | `/api/posts` | Active (non-archived) posts, newest first, as summaries with excerpts |
| GET | `/api/posts/:slug` | One post: metadata, raw Markdown, server-rendered `html`, `htmlEn`, and `toc` (404 if missing) |
| GET | `/api/tags` | Tag index with post counts, most used first |
| GET | `/api/tags/:name` | Posts carrying that tag (includes archived posts) |
| GET | `/api/categories` | Category index with post counts |
| GET | `/api/categories/:name` | Posts in that category (includes archived posts) |
| GET | `/api/archives` | Archived posts grouped by year |
| GET | `/api/pages/:slug` | One page: metadata, raw Markdown, rendered `html`, `toc` (404 if missing) |
| GET | `/api/talks` | All talks, newest first, each with rendered `html` |
| GET | `/api/friends` | Friend links in display order |
| GET | `/api/search?q=<query>&limit=<n>` | Full-text search. Returns `{query, tokens, total, limit, results}`; each result carries plain `title`/`snippet` plus pre-escaped `titleHtml`/`snippetHtml` with `<mark>`. An empty `q` returns an empty result set, not an error. `limit` defaults to 20 (max 50) |
| GET | `/api/comments?path=<url>` | Comments for a page path, oldest first. Add `&type=count` to get `{count}` only |
| POST | `/api/comments` | Post a comment. Body `{nick, mail, comment, url, link?, ua?, avatar?}` |
| POST | `/api/auth/check` | `{email}` → `{registered, permissions, name}`; sets the signed visitor cookie when the address is registered |
| POST | `/api/auth/register` | `{email, name?}` → queues a registration request for admin approval (409 if already registered or already pending) |
| POST | `/api/auth/logout` | Clears the visitor cookie |
| POST | `/auth/logout` | HTML logout used by the auth page's plain form, so it works without JavaScript; clears the visitor cookie and redirects (303) to `/auth/` |
| GET | `/api/calendar` | Calendar events. Requires a visitor cookie with the `calendar` permission (401 without a cookie, 403 without the permission) |
| POST | `/api/upload-avatar` | Upload a comment avatar. Accepts multipart (`file`), JSON `{image}` or a raw base64 body; returns `{url}`. Max 5 MB, one upload per 30 seconds |

`curl` examples:

```bash
# Health
curl http://localhost:30999/api/health
# → {"status":"ok","server":"nodejs","version":"2.0.0"}

# Post summaries
curl http://localhost:30999/api/posts

# One post, rendered server-side
curl http://localhost:30999/api/posts/2025-11-23

# Post a comment
curl -X POST http://localhost:30999/api/comments \
  -H 'Content-Type: application/json' \
  -d '{"nick":"Alice","mail":"alice@example.com","comment":"Nice post!","url":"/post/2025-11-23"}'

# Visitor check (stores the cookie in a jar)
curl -c cookies.txt -X POST http://localhost:30999/api/auth/check \
  -H 'Content-Type: application/json' -d '{"email":"alice@example.com"}'
curl -b cookies.txt http://localhost:30999/api/calendar

# Upload an avatar
curl -X POST http://localhost:30999/api/upload-avatar -F 'file=@avatar.png'
```

### Admin API

Mounted at `/api/admin`. All routes except `POST /login`, `GET|POST /setup` require an authenticated admin session; send it either as the `admin_token` cookie or as an `Authorization: Bearer <token>` header. Unauthenticated requests get `401 {"errno":-1,"errmsg":"Unauthorized"}`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/login` | `{username, password}` → session + `{token, user}`. With 2FA enabled it returns `{step:2, tempToken}` instead; send `{step:2, tempToken, totp}` to finish |
| GET | `/api/admin/setup` | `{setupDone, user}` — is the first-run wizard still needed? |
| POST | `/api/admin/setup` | `{action:"init", user, password}` first run; `{action:"change", oldPassword, newPassword, newUser?}` afterwards |
| POST | `/api/admin/logout` | Revokes the current token and clears the cookie |
| GET | `/api/admin/posts` | Every post incl. archived ones, with bodies |
| POST | `/api/admin/posts` | Create (`{slug, title, titleEn, content, contentEn, date, tags, categories, cover, archived}`) |
| PUT | `/api/admin/posts` | Update an existing post (same body) |
| PATCH | `/api/admin/posts` | `{slug}` → toggle the archived flag, returns `{slug, archived}` |
| DELETE | `/api/admin/posts?slug=` | Delete the post file |
| GET | `/api/admin/pages` | All pages |
| PUT | `/api/admin/pages` | Upsert a page (`{slug, title, titleEn, content, contentEn}`) |
| DELETE | `/api/admin/pages?slug=` | Delete a page file |
| GET | `/api/admin/talks` | All talks |
| POST | `/api/admin/talks` | Publish a talk (`{content}`) |
| PUT | `/api/admin/talks` | Update a talk (`{id, content}`) |
| DELETE | `/api/admin/talks?id=` | Delete a talk |
| GET | `/api/admin/friends` | All friend links |
| POST | `/api/admin/friends` | Add a friend link (`{title, url, descr?, titleEn?, descrEn?, avatar?, sortOrder?}`) |
| PUT | `/api/admin/friends` | Update a friend link (`{id, …}`) |
| DELETE | `/api/admin/friends?id=` | Delete a friend link |
| GET | `/api/admin/comments` | Every comment across every page, newest first |
| DELETE | `/api/admin/comments?id=` | Delete a comment by id |
| GET | `/api/admin/visitors` | `{visitors, pending, permissions}` — approved addresses, the approval queue and the permission catalogue |
| POST | `/api/admin/visitors` | Create or update an approved visitor (`{email, permissions, name?}`) |
| DELETE | `/api/admin/visitors?email=` | Remove an approved visitor |
| POST | `/api/admin/visitors/approve` | Approve a pending request and grant permissions (`{email, permissions}`) |
| DELETE | `/api/admin/visitors/pending?email=` | Reject a pending request |
| GET | `/api/admin/totp` | 2FA state. `secret`/`provisioningUri` are only ever the **pending** secret, never the active one |
| POST | `/api/admin/totp` | `{action:"start"}` generate a secret, `{action:"verify", code}` confirm it, `{action:"disable"}` turn 2FA off |
| GET | `/api/admin/imghost` | Image-host config with `secret_key` masked as `********` |
| PUT | `/api/admin/imghost` | Save the config (an empty or masked `secret_key` keeps the stored value) |
| POST | `/api/admin/imghost` | `{action:"test"}` connection test, or `{action:"upload", image, filename?, key?}` (base64 image) |
| GET | `/api/admin/export` | Download the whole site as one JSON document (`blog-backup-YYYYMMDD-HHMMSS.json`) |
| POST | `/api/admin/import` | Restore a backup; the body is the raw JSON document |
| POST | `/api/admin/reload` | Drop every cached Markdown parse and return the new counts |

`curl` examples:

```bash
# Log in and keep the session cookie
curl -c admin-cookies.txt -X POST http://localhost:30999/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"your-password"}'
# → {"errno":0,"data":{"token":"…","user":"admin"}}

# List every post (cookie auth)
curl -b admin-cookies.txt http://localhost:30999/api/admin/posts

# …or with a bearer token
curl -H 'Authorization: Bearer <token>' http://localhost:30999/api/admin/posts

# Create a post
curl -b admin-cookies.txt -X POST http://localhost:30999/api/admin/posts \
  -H 'Content-Type: application/json' \
  -d '{"slug":"hello-world","title":"Hello World","date":"2025-11-23",
       "tags":"Notes","categories":"Blog","content":"# Hi\n\nFirst post."}'

# Export a backup
curl -b admin-cookies.txt http://localhost:30999/api/admin/export -o backup.json

# Restore a backup
curl -b admin-cookies.txt -X POST http://localhost:30999/api/admin/import \
  -H 'Content-Type: application/json' --data-binary @backup.json

# Log out (revokes the token server-side)
curl -b admin-cookies.txt -X POST http://localhost:30999/api/admin/logout
```

> The `Origin` guard rejects state-changing requests that carry a mismatched `Origin` header. `curl` sends none, which is fine; browser clients must call the API same-origin.

---

## Migrating from the old MariaDB version

The rewrite keeps the same on-disk contract for content, so an existing deployment can be moved over with one script. It reads the old MariaDB tables through the `mariadb` (or `mysql`) command-line client with `--xml` output — no database driver is required, and it reuses the application's own writers, so the output format can never drift from what the server expects.

```bash
# Preview everything without writing anything
node scripts/import-legacy-mariadb.mjs --dry-run

# Real migration
node scripts/import-legacy-mariadb.mjs

# Skip the `config` table (admin credentials, TOTP state, image-host settings)
node scripts/import-legacy-mariadb.mjs --skip-config
```

| Flag | Effect |
|------|--------|
| `--dry-run` | Prints every post/page/talk/friend/comment it *would* write and a summary — touches nothing |
| `--skip-config` | Leaves `admin_creds`, `totp_state` and `imghost_config` alone (useful when you want to keep the new server's own settings) |

Connection settings come from the [environment variables](#migration-only) listed above.

### What it migrates

| Source (MariaDB) | Destination |
|------------------|-------------|
| `posts` | `blog/posts/<slug>.md` — `title`, `date`, `tags`, `categories`, `cover`, `archived`, `title_en`, `content_en` frontmatter |
| `pages` + `page_content` | `blog/pages/<slug>.md`; the English body from `page_content` is folded into `content_en` |
| `talks` | `blog/talks/<id>.md` with `id` / `create_time` frontmatter |
| `friends` | `blog/friends/<id>-<slug>.md` with `sort_order` |
| `comments` | `blog/data/comments/<key>.json`, one file per page URL |
| `emails`, `pending_registrations` | `blog/data/visitors.json` (approved addresses with permissions + the pending queue) |
| `calendar_events` | `blog/data/calendar.json` |
| `config`: `admin_creds` | `blog/data/admin.json` — **copied verbatim** |
| `config`: `totp_state` | `blog/data/totp.json` |
| `config`: `imghost_config` | `blog/data/imghost.json` |

Missing tables are simply skipped, so a partial old install still migrates. Run it with `--dry-run` first and compare the summary against the old database.

### The admin password is preserved

`admin_creds` holds the legacy AES-256-CBC verifier and is copied across unchanged. `src/store/credentials.ts` detects that format, still verifies the old password, and **re-hashes it with scrypt on the first successful login** (`[credentials] legacy password record upgraded to scrypt`). You do not need to reset anything.

If the legacy login fails for any reason, the recovery path is `BMY_ADMIN_PASS` **plus `BMY_ADMIN_RESET=1`**: set both and restart to overwrite the admin account (the bare `BMY_ADMIN_PASS` is ignored once an account exists, so the old record would otherwise stay in place). Alternatively delete `blog/data/admin.json` and go through `/admin/setup/` again.

> Legacy visitor data is also imported automatically: the first time `blog/data/visitors.json` is read, the old `blog/data/auth/emails.json` and `blog/data/auth/pending.json` files are folded in if they exist.

---

## Backup and Restore

The admin console's **数据备份** page at `/admin/backup/` exports the entire site as **one JSON document** — the same "one file" contract as the old implementation, but the sections now mirror the on-disk layout instead of SQL tables.

```json
{
  "app": "blog-material-you",
  "version": 2,
  "exportedAt": 1763900000,
  "content": { "posts": [], "pages": [], "talks": [], "friends": [] },
  "data": { "comments": [], "visitors": {}, "site": {}, "calendar": [],
            "admin": {}, "totp": {}, "imghost": {} }
}
```

- `content.posts` / `content.pages` keep the **raw frontmatter and body**, so unknown frontmatter keys survive a round-trip. `content.friends` drops only the internal absolute file path.
- `data.comments`, `data.visitors`, `data.site` and `data.calendar` cover comments, the visitor registry and approval queue, site settings (including UI-string overrides) and calendar events.

> ⚠️ **The backup file is a secret.** `data.admin` contains the admin password verifier (scrypt salt + hash), `data.totp` contains the TOTP shared secret, and `data.imghost` contains the S3/SFTP credentials including the secret key. Never commit it, never serve it unauthenticated, and delete it once you no longer need it. The exported download is authenticated, but the file you save is not protected afterwards.
>
> `importBackup()` in `src/lib/backup.ts` accepts `{includeCredentials: false}` to restore content only and leave credentials, the TOTP secret and image-host keys untouched. The admin console always performs a full restore.

**Import is destructive**, matching the old import: a section present in the payload replaces the existing data, while an absent section leaves the current data alone. Posts, pages, talks, friends and comments are cleared before being rewritten; TOTP, credentials and image-host settings are overwritten when the corresponding section is present. Malformed individual entries are skipped with a warning rather than aborting the whole restore, and all filenames are rebuilt from validated slugs, so a crafted backup cannot write outside the content directories.

Via the admin page: open `/admin/backup/`, download the export, and upload the file to restore. Via the API:

```bash
# Export
curl -b admin-cookies.txt http://localhost:30999/api/admin/export -o backup.json

# Import (restores everything, including credentials)
curl -b admin-cookies.txt -X POST http://localhost:30999/api/admin/import \
  -H 'Content-Type: application/json' --data-binary @backup.json
# → {"errno":0,"data":{"summary":{"posts":12,"pages":3,…}}}
```

Because a backup restores credentials and the TOTP secret, importing a backup taken **before** you enabled 2FA will disable 2FA again — keep the current TOTP secret at hand before restoring on a live server.

---

## Deployment

### Docker

The image is a single self-contained container: `node:24-alpine`, dependencies installed with `npm ci --omit=dev`, `scripts/sync-assets.mjs` run at build time, no database server, no nginx, no Python, no compiler. It runs as the unprivileged `node` user, exposes `30999`, and declares a `HEALTHCHECK` that fetches `/api/health` every 30 seconds.

```bash
docker compose up -d --build
docker compose logs -f blog
```

### Volume layout

`blog/` splits into two things you should treat differently:

| Path | Nature | Recommended volume |
|------|--------|--------------------|
| `blog/posts`, `blog/pages`, `blog/talks`, `blog/friends` | **Content** — version it, back it up, edit it from the host | bind mounts for each directory |
| `blog/data` | **Runtime state** — credentials, comments, visitors, TOTP, settings, sessions | a named volume (must persist; losing it loses the admin account and all comments) |
| `blog/public/avatars`, `blog/public/uploads` | Uploaded media | bind mount or a volume |
| `blog/public/vendor` | Generated from `node_modules` at build/boot time | do **not** mount over it |

```yaml
services:
  blog:
    build: .
    ports:
      - "8000:30999"
    volumes:
      - blog_data:/app/blog/data          # state — named volume
      - ./blog/posts:/app/blog/posts      # content — bind mounts
      - ./blog/pages:/app/blog/pages
      - ./blog/talks:/app/blog/talks
      - ./blog/friends:/app/blog/friends
      - ./blog/public/avatars:/app/blog/public/avatars
    restart: unless-stopped
volumes:
  blog_data:
```

### Behind a TLS reverse proxy

Put nginx/Caddy/Traefik in front for HTTPS (the app speaks plain HTTP on one port):

1. Set **`BMY_SITE_URL`** to the public `https://` address, otherwise canonical links, `sitemap.xml` and `rss.xml` carry relative URLs.
2. Set **`BMY_TRUST_PROXY=1`** so Express trusts `X-Forwarded-For` and rate limits key on the real client IP instead of the proxy's. Without it, one abusive client can exhaust the limit for everyone.
3. Forward both `Host` and `X-Forwarded-Proto`, and allow request bodies at least as large as `BMY_MAX_UPLOAD_MB`.
4. **Cookie `Secure` flag:** session and visitor cookies are marked `HttpOnly` and `SameSite=Strict`/`Lax`, but not `Secure` — over plain HTTP a `Secure` cookie would never be sent, so the code leaves it off. If you terminate TLS at the proxy and want the flag, add `secure: true` in `setSessionCookie()` (`src/auth/session.ts`) and `setVisitorCookie()` (`src/auth/visitor.ts`) and serve the app exclusively over HTTPS. Until then, keep the app off the public internet over plain HTTP.

### Scaling

The app is stateless with respect to in-process caches (Markdown parses and JSON stores are re-read when files change), so you *can* run several instances against shared content — but two caveats:

- **Rate limiting is per process.** Each instance counts independently, so N instances allow N× the configured rate. A multi-instance deployment needs a limit at the proxy level (`limit_req` in nginx) as the real control; the in-process limiter is defence in depth.
- **Sessions live in memory.** Tokens are signed with `BMY_SESSION_SECRET`, so set it explicitly to the same random value on every instance; the in-process revocation registry and two-step-login temp tokens are not shared, meaning a logout on one instance does not immediately invalidate the token on another (the revocation epoch is bumped per process only). Pin admin traffic to one instance, or shorten `BMY_SESSION_TTL`, if that matters to you.
- Content and `blog/data` must be on shared storage (a mounted volume) for every instance; S3 image hosting keeps uploaded media consistent across instances.

### Operations

- **Reset a lost admin password** — set `BMY_ADMIN_PASS` together with `BMY_ADMIN_RESET=1` and restart (remove both afterwards), or delete `blog/data/admin.json` and reopen `/admin/setup/`.
- **Reset 2FA** — delete the `totp` section (or `blog/data/totp.json`); the login goes back to password-only.
- **Health** — `GET /api/health` for liveness, `GET /api/status` for content counts and process metrics; the `/status/` page renders the same data.
- **Content updates** — copying `.md` files in is enough; the cache is mtime-based, so no restart is needed.

---

## Tech Stack

| Layer | Technology | Version | License |
|-------|-----------|---------|---------|
| Runtime | Node.js (≥ 22.18 required; Docker image uses 24) | 22.18+ / 24 | MIT |
| Language | TypeScript, executed directly by Node (type stripping, no build step) | 5.9.3 | Apache-2.0 |
| HTTP framework | Express | 5.2.1 | MIT |
| Templates | EJS (server-side rendering) | 3.1.10 | Apache-2.0 |
| Frontend UI | MDUI 2 (Material Design 3 Web Components), vendored locally | 2.1.5 | MIT |
| Markdown | markdown-it (+ markdown-it-anchor for heading anchors) | 14.3.2 | MIT |
| Syntax highlighting | highlight.js (server-side) | 11.12.0 | BSD-3-Clause |
| Math | KaTeX (+ @vscode/markdown-it-katex) | 0.16.47 | MIT |
| Frontmatter | gray-matter (js-yaml) with a tolerant fallback parser | 4.0.3 | MIT |
| Image processing | sharp (512×512 WebP avatars) | 0.33.5 | Apache-2.0 |
| Object storage | @aws-sdk/client-s3 (S3 / MinIO / R2, incl. mutual TLS) | 3.1142.0 | Apache-2.0 |
| SFTP | ssh2-sftp-client | 12.1.1 | Apache-2.0 |
| Uploads | multer (memory storage, 10 MB limit) | 2.4.0 | MIT |
| Cookies | cookie-parser | 1.4.7 | MIT |
| Config | dotenv | 16.6.1 | BSD-2-Clause |
| Password hashing / TOTP / sessions | Node.js built-in `node:crypto` (scrypt, HMAC-SHA256, AES-256-CBC for legacy verification) | — | MIT (Node.js) |

Versions are the resolved versions from `package.json` / `package-lock.json` at the time of writing; `npm outdated` may suggest newer ones within the declared semver ranges.

## Open Source Acknowledgments

This project is built on the work of many open-source projects. We thank their authors and contributors. Each entry lists the project, its license and where to find it.

### Runtime and framework

| Project | License | Link |
|---------|---------|------|
| Node.js | MIT | [nodejs.org](https://nodejs.org) |
| TypeScript | Apache-2.0 | [typescriptlang.org](https://www.typescriptlang.org) |
| Express | MIT | [expressjs.com](https://expressjs.com) |
| EJS | Apache-2.0 | [ejs.co](https://ejs.co) |

### Front end

| Project | License | Link |
|---------|---------|------|
| MDUI 2 (Material Design 3 Web Components) | MIT | [mdui.org](https://www.mdui.org) |
| KaTeX | MIT | [katex.org](https://katex.org) |
| highlight.js | BSD-3-Clause | [highlightjs.org](https://highlightjs.org) |
| markdown-it | MIT | [markdown-it.github.io](https://markdown-it.github.io) |

### Storage, media and services

| Project | License | Link |
|---------|---------|------|
| sharp | Apache-2.0 | [sharp.pixelplumbing.com](https://sharp.pixelplumbing.com) |
| AWS SDK for JavaScript v3 | Apache-2.0 | [aws.amazon.com/sdk-for-javascript](https://aws.amazon.com/sdk-for-javascript/) |
| ssh2-sftp-client | Apache-2.0 | [github.com/theophilusx/ssh2-sftp-client](https://github.com/theophilusx/ssh2-sftp-client) |
| gray-matter | MIT | [github.com/jonschlinkert/gray-matter](https://github.com/jonschlinkert/gray-matter) |
| multer | MIT | [github.com/expressjs/multer](https://github.com/expressjs/multer) |
| cookie-parser | MIT | [github.com/expressjs/cookie-parser](https://github.com/expressjs/cookie-parser) |
| dotenv | BSD-2-Clause | [github.com/motdotla/dotenv](https://github.com/motdotla/dotenv) |
| markdown-it-anchor | Unlicense | [github.com/valeriangalliat/markdown-it-anchor](https://github.com/valeriangalliat/markdown-it-anchor) |

Please refer to each project's own repository for the authoritative copyright notices and the full license text.

## License

This project is licensed under the **MIT License**. See the acknowledgements above for the respective licenses of the open-source components it uses.

---

*Built with ❤️ on Node.js + TypeScript, MDUI 2, and more wonderful open-source tools.*
