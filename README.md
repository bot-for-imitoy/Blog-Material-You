# Blog Material You

A standalone blog system powered by **OpenResty + MariaDB** backend and **MDUI 2 (Material Design 3)** frontend. Fully bilingual (Chinese/English) with auto language detection.

## Project Structure

```
Blog/
├── backend/              # OpenResty + Lua API server
│   ├── conf/             # Nginx configuration
│   │   └── nginx.conf    # Port 30999 (public) + 31000 (admin)
│   ├── lua/              # Lua business logic
│   │   ├── posts.lua     # Post loading & parsing (.md + YAML frontmatter)
│   │   ├── comments.lua  # Comments CRUD (MariaDB)
│   │   ├── talks.lua     # Talks CRUD (MariaDB)
│   │   ├── config.lua    # Blog config & admin credentials
│   │   ├── session.lua   # Bearer token management
│   │   └── api/          # HTTP API endpoints
│   ├── start.sh          # Start script
│   └── stop.sh           # Stop script
├── blog/                 # Frontend (MDUI 2 SPA)
│   ├── posts/            # Markdown articles with YAML frontmatter
│   ├── pages/            # Static pages (about, talks)
│   ├── public/           # Static assets served by nginx
│   │   ├── index.html    # Blog SPA (bilingual)
│   │   ├── admin/        # Admin SPA
│   │   └── css/js/icon/  # Stylesheets, scripts, icons
│   └── locales.yml       # UI string translations (zh + en)
└── README.md             # This file
```

## Quick Start

### Prerequisites

- **OpenResty** ≥ 1.27 (with `resty.mysql`)
- **MariaDB** ≥ 10.6 (or MySQL 8.0+)

### 1. Initialize Database

```bash
DB_DIR=/path/to/Blog/blog/data/mysql
mkdir -p "$DB_DIR"
mariadb-install-db --datadir="$DB_DIR" --user=$(whoami)
```

### 2. Start MariaDB

```bash
mariadbd \
  --datadir="$DB_DIR" \
  --socket="$DB_DIR/mysql.sock" \
  --port=3308 \
  --skip-grant-tables &
```

### 3. Create Database Tables

```bash
MYSQL="mariadb --socket=$DB_DIR/mysql.sock"
$MYSQL -e "CREATE DATABASE IF NOT EXISTS blogyou CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

$MYSQL blogyou -e "
CREATE TABLE IF NOT EXISTS comments (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nick        VARCHAR(100)  NOT NULL,
    mail        VARCHAR(255)  NOT NULL,
    comment     TEXT          NOT NULL,
    link        VARCHAR(500)  NOT NULL DEFAULT '',
    ua          TEXT          NOT NULL DEFAULT '',
    pid         BIGINT UNSIGNED DEFAULT NULL,
    rid         BIGINT UNSIGNED DEFAULT NULL,
    at          VARCHAR(100)  DEFAULT NULL,
    url         VARCHAR(500)  NOT NULL,
    create_time INT UNSIGNED  NOT NULL,
    INDEX idx_url (url(191)),
    INDEX idx_create_time (create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"

$MYSQL blogyou -e "
CREATE TABLE IF NOT EXISTS talks (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    content     TEXT       NOT NULL,
    create_time INT UNSIGNED NOT NULL,
    INDEX idx_time (create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"
```

### 4. Start OpenResty

```bash
cd blog-backend   # or the backend/ directory
bash start.sh
```

### 5. Verify

```bash
curl http://localhost:30999/api/health
# → {"status":"ok","server":"openresty","version":"blog-material-you"}
```

## Access

| Service       | URL                            | Credentials          |
|---------------|--------------------------------|----------------------|
| Blog Frontend | http://localhost:30999/        | —                    |
| Admin Panel   | http://localhost:31000/        | admin / bmy2025      |

## Features

### Frontend
- **Bilingual (CN/EN)**: Auto-detects browser language, switches between Chinese and English UI. Language data in `locales.yml`.
- **Article Language Switching**: Articles can have separate English fields (`title_en`, `content_en`, `tags_en`, `categories_en`). Displayed automatically when browser language is English.
- **Material Design 3**: MDUI 2 Web Components with dynamic color theming.
- **Waterfall Layout**: Responsive card grid on homepage.
- **KaTeX Math Rendering**: LaTeX support via KaTeX.
- **2048 Game**: Hidden easter egg on About page (click avatar 7 times).

### Backend
- **Flat-File CMS**: Articles stored as Markdown + YAML frontmatter in `blog/posts/`.
- **MariaDB**: Only for comments and talks.
- **Bearer Token Auth**: Password-only login (TOTP removed for simplicity).
- **Admin API**: Full CRUD for posts, comments, talks, and pages.

## Admin Panel

Access **http://localhost:31000/** to manage:
- **Dashboard**: Statistics overview
- **Posts**: Create, edit, delete, archive/unarchive articles
- **Comments**: View and delete comments
- **Talks**: Publish and manage moments
- **Pages**: Edit About and Talks pages (with bilingual content support)
- **Security**: Currently password-only (TOTP 2FA removed)

### Writing Bilingual Articles

In the post editor, scroll down to the **🌐 English Content** section to add:
- English title
- English tags (comma-separated)
- English categories (comma-separated)
- English body (Markdown)

When a visitor's browser language is set to English, the English fields will be displayed automatically.

## Tech Stack

| Layer       | Technology                              |
|-------------|-----------------------------------------|
| Backend     | OpenResty (nginx + LuaJIT)              |
| Database    | MariaDB (via Unix socket)               |
| Frontend    | MDUI 2 Web Components, vanilla JS SPA   |
| Rendering   | Client-side Markdown, KaTeX, Waterfall  |
| Auth        | Bearer token (HMAC-SHA1 signed)         |
| I18n        | YAML locale file, runtime loaded        |

## License

MIT
