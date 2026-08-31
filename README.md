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
├── docker/               # Docker deployment files
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── docker-entrypoint.sh
└── README.md             # This file
```

## Quick Start (Docker)

```bash
docker compose build
docker compose up -d
```

Then visit http://localhost:30999/ for the blog and http://localhost:31000/ for the admin panel.

## Access

| Service       | URL                            | Setup                  |
|---------------|--------------------------------|------------------------|
| Blog Frontend | http://localhost:30999/        | —                      |
| Admin Panel   | http://localhost:31000/        | Set up on first visit  |

## Features

### Frontend
- **Bilingual (CN/EN)**: Auto-detects browser language, switches between Chinese and English UI.
- **Article Language Switching**: Articles can have separate English fields (`title_en`, `content_en`, `tags_en`, `categories_en`).
- **Material Design 3**: MDUI 2 Web Components with dynamic color theming.
- **Waterfall Layout**: Responsive card grid on homepage.
- **KaTeX Math Rendering**: LaTeX support via KaTeX.
- **Comment System**: Avatar support (URL or upload, auto-resized to 512×512).
- **2048 Game**: Hidden easter egg on About page.

### Backend
- **Flat-File CMS**: Articles stored as Markdown + YAML frontmatter in `blog/posts/`.
- **MariaDB**: Comments, talks, user data, and configuration storage.
- **Bearer Token Auth**: Password-based authentication.
- **Admin API**: Full CRUD for posts, comments, talks, and pages.
- **Admin Comments**: Full comment moderation from admin panel.
- **One-Click Backup/Restore**: Export the entire database to a single JSON file and restore it — useful before switching to a new database.

## Database Configuration

Database connection is centralized in `backend/lua/db_config.lua` and configurable via environment variables, so you can point the blog at a new database without code changes:

| Env var          | Default                                    | Description                          |
|------------------|--------------------------------------------|--------------------------------------|
| `BMY_DB_SOCKET`  | `$BMY_BLOG_DIR/data/mysql/mysql.sock`      | Unix socket path (used when no host) |
| `BMY_DB_HOST`    | *(empty)*                                  | TCP host; when set, uses TCP         |
| `BMY_DB_PORT`    | `3306`                                     | TCP port                             |
| `BMY_DB_NAME`    | `blogyou`                                  | Database name                        |
| `BMY_DB_USER`    | `blogyou`                                  | Database user                        |
| `BMY_DB_PASS`    | `blog-db-pass-2025`                        | Database password                    |

Example — connect to a new remote database:

```bash
BMY_DB_HOST=db.example.com BMY_DB_PORT=3306 \
BMY_DB_NAME=myblog BMY_DB_USER=blog BMY_DB_PASS=s3cret \
bash backend/start.sh
```

> nginx only exposes env vars declared with the `env` directive in `backend/conf/nginx.conf`; restart the service after changing them. Before switching databases, export the old data from the admin panel's **💾 Data Backup** page, then import it after connecting the new database.

## One-Click Export / Import

The admin panel has a **💾 Data Backup** page (`http://localhost:31000/backup.html`):

- **One-Click Export**: downloads all database data (posts, pages, comments, talks, friends, config, calendar events, etc.) as a single JSON file.
- **One-Click Import**: picks a previously exported backup file, clears and restores all data (with a confirmation dialog).

Raw API (requires admin Bearer token):

```bash
# Export (download JSON backup)
curl -H "Authorization: Bearer <token>" http://localhost:31000/api/admin/export -o backup.json

# Import (restore backup)
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     --data-binary @backup.json http://localhost:31000/api/admin/import
```

## Tech Stack

| Layer       | Technology                              | License       |
|-------------|-----------------------------------------|---------------|
| Base Image  | Alpine Linux 3.23                       | GPL-2.0       |
| Web Server  | OpenResty 1.27 (nginx + LuaJIT)         | BSD 2-Clause  |
| Database    | MariaDB 11.4 (via Unix socket)          | GPL-2.0       |
| Lua Modules | lua-resty-mysql, lua-resty-aes, lua-cjson | BSD / MIT   |
| Frontend UI | MDUI 2 (Material Design 3 Web Components) | MIT         |
| Markdown    | marked 15.0.0                           | MIT           |
| Math Render | KaTeX 0.16.11                           | MIT           |
| Image Proc  | ImageMagick                             | Apache 2.0    |

## Open Source Acknowledgments

This project uses the following open-source components. We thank their authors and contributors.

### Runtime Dependencies

#### Alpine Linux ([alpinelinux.org](https://alpinelinux.org))
Copyright © 2016-2024 Alpine Linux development team. Licensed under **GPL-2.0**.
Used as the base Docker image.

#### OpenResty ([openresty.org](https://openresty.org))
Copyright © 2007-2024, OpenResty Inc. Licensed under **BSD 2-Clause**.
Used as the web server and Lua execution environment.

#### MariaDB ([mariadb.org](https://mariadb.org))
Copyright © 2009-2024 MariaDB Corporation Ab and contributors. Licensed under **GPL-2.0**.
Used as the database backend.

#### ImageMagick ([imagemagick.org](https://imagemagick.org))
Copyright © 1999-2024 ImageMagick Studio LLC. Licensed under **Apache 2.0**.
Used for avatar image resizing.

### Lua Libraries

#### lua-resty-mysql
Copyright © 2012-2019, OpenResty Inc. Licensed under **BSD 2-Clause**.

#### lua-resty-aes
Copyright © 2014-2019, OpenResty Inc. Licensed under **BSD 2-Clause**.

#### lua-cjson
Copyright © 2010-2022, Mark Pulford & OpenResty Inc. Licensed under **MIT**.

### Frontend Libraries

#### MDUI 2 ([mdui.org](https://www.mdui.org))
Copyright © 2016-2024, zdhxiong. Licensed under **MIT**.
```
MIT License

Copyright (c) 2016-2024 zdhxiong

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### marked ([marked.js.org](https://marked.js.org))
Copyright © 2018+, MarkedJS. Licensed under **MIT**.
```
MIT License

Copyright (c) 2018-2024 MarkedJS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### KaTeX ([katex.org](https://katex.org))
Copyright © 2013-2024 Khan Academy. Licensed under **MIT**.
```
MIT License

Copyright (c) 2013-2024 Khan Academy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## License

This project is licensed under the **MIT License**. See the license notices above for the respective licenses of each open-source component used.

---

*Built with ❤️ using OpenResty, MariaDB, MDUI 2, and more wonderful open-source tools.*
