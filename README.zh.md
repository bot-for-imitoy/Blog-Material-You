# Blog Material You

基于 **OpenResty + MariaDB** 后端和 **MDUI 2 (Material Design 3)** 前端的独立博客系统。支持中英文双语显示（自动检测浏览器语言）。

## 项目结构

```
Blog-Material-You/
│
├── backend/                          # OpenResty + Lua 后端服务
│   ├── conf/
│   │   ├── nginx.conf                # 主配置：共享字典、Lua 路径、include 站点
│   │   └── sites-available/
│   │       ├── 30999.conf            # 博客前台 SPA + 公开 API (端口 30999)
│   │       └── 31000.conf            # 管理后台 SPA + 管理 API (端口 31000)
│   ├── lua/                          # Lua 业务逻辑
│   │   ├── posts.lua                 # 文章模型：.md + YAML frontmatter 解析、缓存
│   │   ├── comments.lua              # 评论模型：MariaDB CRUD
│   │   ├── talks.lua                 # 动态模型：MariaDB CRUD
│   │   ├── config.lua                # 博客元配置（标题、菜单、session_secret）
│   │   ├── session.lua               # Bearer Token 签发/校验/缓存
│   │   ├── admin_auth.lua            # 管理认证中间件
│   │   ├── admin_store.lua           # 管理员凭据加密存储 (AES-256-CBC)
│   │   ├── security.lua              # slug 校验、错误信息清理
│   │   ├── utils.lua                 # 工具函数：YAML 解析、UTF-8 截断、文件读写
│   │   ├── data_store.lua            # JSON 文件读写（日历/邮箱数据）
│   │   ├── init.lua                  # 启动初始化：加载文章到共享字典
│   │   ├── serve.lua                 # SSR 文章中间件
│   │   ├── ssr.lua                   # 服务端渲染引擎
│   │   ├── db.lua                    # MariaDB 连接池
│   │   ├── totp.lua                  # TOTP 验证实现
│   │   ├── totp_store.lua            # TOTP 密钥持久化
│   │   ├── imghost.lua               # 图片托管业务逻辑
│   │   ├── friends.lua               # 友链数据读写
│   │   ├── api/                      # 公开 HTTP API 端点 (端口 30999)
│   │   │   ├── posts.lua             # GET /api/posts — 活跃文章列表摘要
│   │   │   ├── post.lua              # GET /api/posts/:slug — 单篇文章完整内容
│   │   │   ├── tags.lua              # GET /api/tags — 标签索引（含文章数）
│   │   │   ├── tag.lua               # GET /api/tags/:tag — 标签下的文章
│   │   │   ├── categories.lua        # GET /api/categories — 分类索引
│   │   │   ├── category.lua          # GET /api/categories/:cat — 分类下的文章
│   │   │   ├── archives.lua          # GET /api/archives — 已归档文章按年份分组
│   │   │   ├── page.lua              # GET /api/pages/:slug — 静态页面
│   │   │   ├── config.lua            # GET /api/config — 博客配置
│   │   │   ├── comments.lua          # GET/POST /api/comments — 评论
│   │   │   ├── talks.lua             # GET/POST /api/talks — 动态
│   │   │   ├── friends.lua           # GET /api/friends — 友链
│   │   │   ├── status.lua            # GET /api/status — 服务状态
│   │   │   ├── calendar.lua          # GET /api/calendar — 日历事件
│   │   │   ├── ssr_post.lua          # 服务端渲染文章（SEO 兜底）
│   │   │   ├── upload_avatar.lua     # 评论头像上传
│   │   │   └── auth/
│   │   │       ├── register.lua      # POST /api/auth/register — 邮箱注册
│   │   │       └── check.lua         # GET /api/auth/check — 权限检查
│   │   └── api/admin/                # 管理后台 HTTP API 端点 (端口 31000)
│   │       ├── login.lua             # POST /api/admin/login — 密码登录
│   │       ├── logout.lua            # POST /api/admin/logout — 登出
│   │       ├── setup.lua             # GET/POST /api/admin/setup — 初始化管理员
│   │       ├── posts.lua             # GET/POST/PUT/DELETE/PATCH — 文章 CRUD+归档
│   │       ├── pages.lua             # GET/PUT /api/admin/pages — 页面读写
│   │       ├── comments.lua          # DELETE /api/admin/comments — 删除评论
│   │       ├── talks.lua             # POST/DELETE /api/admin/talks — 动态管理
│   │       ├── reload.lua            # POST /api/admin/reload — 热重载缓存
│   │       ├── totp_setup.lua        # TOTP 两步验证设置
│   │       ├── imghost.lua           # 图片托管 API
│   │       └── friends.lua           # 友链管理
│   ├── start.sh                      # 启动脚本（创建目录、启动 OpenResty）
│   ├── stop.sh                       # 停止脚本
│   └── data/
│       └── imghost.json              # 图片托管元数据
│
├── blog/                             # 博客内容与前端
│   ├── posts/                        # 文章 .md 源文件（YAML frontmatter + Markdown）
│   ├── pages/                        # 静态页面
│   │   ├── about.md                  # 关于页面（中文）
│   │   ├── about.en.json             # 关于页面英文内容
│   │   └── talks.md                  # 动态页面
│   ├── talks/                        # 动态数据文件（JSON 格式）
│   ├── friends/                      # 友链 Markdown 文件
│   ├── public/                       # Nginx 托管的静态资源
│   │   ├── index.html                # 博客前台 SPA（路由、渲染、双语切换）
│   │   ├── admin/
│   │   │   └── index.html            # 管理后台 SPA（CRUD、认证、缓存刷新）
│   │   ├── css/
│   │   │   ├── root.css              # 根布局
│   │   │   ├── content-container.css # 内容区容器
│   │   │   ├── navigation-drawer.css # 侧边导航栏
│   │   │   ├── header-card.css       # 页面头部卡片
│   │   │   ├── post-card.css         # 首页文章卡片 + 瀑布流
│   │   │   ├── post-content.css      # 文章正文 + 图片加载占位
│   │   │   ├── code.css              # 代码块样式
│   │   │   ├── about.css             # 关于页面
│   │   │   ├── index.css             # 首页样式
│   │   │   ├── lists.css             # 列表页面（标签/分类/归档）
│   │   │   └── mdui.css              # MDUI 主题覆盖
│   │   ├── js/
│   │   │   ├── code.js               # 代码块行号移除
│   │   │   ├── comment.js            # 评论提交逻辑
│   │   │   ├── color.js              # MDUI 动态取色（主题色）
│   │   │   ├── navigation-drawer.js  # 侧边栏响应式控制
│   │   │   └── page.js               # 首页瀑布流布局
│   │   └── icon/                     # SVG 图标集合
│   │       ├── home.svg, article.svg, tag.svg, category.svg
│   │       ├── chat.svg, person.svg, archive.svg, friends.svg
│   │       ├── search.svg, menu.svg, link.svg, hr.svg
│   │       ├── calender.svg, arrow-forward.svg, monitoring.svg
│   │       └── hr.svg                # 波浪分隔线
│   └── locales.yml                   # UI 文案翻译（zh/en）
│
├── docker/                           # Docker 部署
│   ├── docker-entrypoint.sh          # 容器入口：启动 MariaDB + OpenResty
│   ├── nginx-docker.conf             # Docker 版 nginx 主配置
│   ├── 31000-docker.conf             # Docker 版管理后台站点（无 127.0.0.1 限制）
│   └── db_init.sql                   # 数据库建表 SQL
│
├── Dockerfile                        # 多阶段构建镜像
├── docker-compose.yml                # Compose 编排（端口映射 + 持久卷）
├── .dockerignore                     # 构建上下文排除
├── .env.example                      # 环境变量模板（BMY_SESSION_SECRET）
├── .gitignore
├── README.md                         # 英文说明
├── README.zh.md                      # 本文件
└── SECURITY_REPORT.md                # 安全审计报告
```

## 快速开始

### 环境要求

- **OpenResty** ≥ 1.27（含 `resty.mysql`）
- **MariaDB** ≥ 10.6（或 MySQL 8.0+）

### 1. 初始化数据库

```bash
DB_DIR=/path/to/Blog/blog/data/mysql
mkdir -p "$DB_DIR"
mariadb-install-db --datadir="$DB_DIR" --user=$(whoami)
```

### 2. 启动 MariaDB

```bash
mariadbd \
  --datadir="$DB_DIR" \
  --socket="$DB_DIR/mysql.sock" \
  --port=3308 \
  --skip-grant-tables &
```

### 3. 创建数据库表

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

### 4. 启动 OpenResty

```bash
cd backend/
bash start.sh
```

### 5. 验证

```bash
curl http://localhost:30999/api/health
# → {"status":"ok","server":"openresty","version":"blog-material-you"}
```

### 指定新的数据库

数据库连接参数通过环境变量配置（默认连接本地 MariaDB Socket），支持切换到任意新的数据库（如另一台 MySQL/MariaDB 服务器）：

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `BMY_DB_SOCKET` | `$BMY_BLOG_DIR/data/mysql/mysql.sock` | Unix Socket 路径（未设置 `BMY_DB_HOST` 时使用） |
| `BMY_DB_HOST` | *(空)* | TCP 主机；设置后改用 TCP 连接 |
| `BMY_DB_PORT` | `3306` | TCP 端口 |
| `BMY_DB_NAME` | `blogyou` | 数据库名 |
| `BMY_DB_USER` | `blogyou` | 数据库用户 |
| `BMY_DB_PASS` | `blog-db-pass-2025` | 数据库密码 |

示例 — 连接到新的远程数据库：

```bash
BMY_DB_HOST=db.example.com BMY_DB_PORT=3306 \
BMY_DB_NAME=myblog BMY_DB_USER=blog BMY_DB_PASS=s3cret \
bash backend/start.sh
```

> 注意：nginx 仅读取白名单内的环境变量（见 `backend/conf/nginx.conf` 中的 `env` 指令），修改后需重启服务。切换数据库前，请先用管理后台的「数据备份」功能导出旧库数据，再在接入新库后一键导入。

### Docker + 外部数据库

在 `docker-compose.yml` 中设置 `BMY_DB_HOST` 后，容器**不再启动内置 MariaDB**，而是连接外部数据库，并在启动时自动初始化/迁移表结构（全部为 `CREATE TABLE IF NOT EXISTS`，重启安全）。请先在外部服务器上创建数据库与用户：

```sql
CREATE DATABASE blogyou CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'blogyou'@'%' IDENTIFIED BY 'your-password';
GRANT ALL PRIVILEGES ON blogyou.* TO 'blogyou'@'%';
FLUSH PRIVILEGES;
```

## S3 / SFTP 图床

博客支持将图片（文章封面、评论头像）上传到远程图床，两种存储提供方：

| 提供方 | 说明 |
|--------|------|
| `sftp`（默认） | 通过 `scp` 上传到远程 SFTP 服务器 |
| `s3` | 上传到任意 S3 兼容对象存储（MinIO、AWS S3 等），使用镜像内置的 MinIO Client（`mc`） |

### 在管理后台配置

打开管理后台侧边栏的 **🖼️ 图床**（`http://localhost:31000/imagehost.html`），选择提供方、填写凭据后点 **保存配置**，再点 **测试连接**。

### 通过环境变量配置（分布式部署推荐）

无需登录后台，直接在 `docker-compose.yml` / `.env` 中设置：

| 环境变量 | 说明 |
|---------|------|
| `BMY_IMGHOST_PROVIDER` | `sftp` 或 `s3`（设置后即启用图床） |
| `BMY_S3_ENDPOINT` | S3 服务地址，如 `http://minio:9000` |
| `BMY_S3_BUCKET` | 存储桶名称 |
| `BMY_S3_ACCESS_KEY` | 访问密钥 |
| `BMY_S3_SECRET_KEY` | 秘密密钥 |
| `BMY_S3_REGION` | 区域（AWS 需要，MinIO 通常可省略） |
| `BMY_S3_PREFIX` | 桶内对象前缀（可选） |
| `BMY_S3_PUBLIC_URL_BASE` | 图片公开访问 URL 基址（CDN / 自定义域名，可选） |
| `BMY_S3_INSECURE` | 设为 `1` 跳过 TLS 证书校验（自签名证书） |

环境变量优先于后台保存的配置。使用 `s3` 提供方时，上传的图片通过 `$BMY_S3_PUBLIC_URL_BASE`（或 `$BMY_S3_ENDPOINT/$BMY_S3_BUCKET`）访问；启用 S3 图床后，评论头像也会存储到 S3，保证多实例共享同一份文件。

> 若要公开访问图片，需为存储桶设置公共读策略，例如 `mc anonymous set download myminio/blog-images`（或在您的 S3 服务商控制台配置等效策略）。
>
> 前端 CSP（`img-src`）默认仅允许 `'self'` 与 `data:` —— 若图片托管在自定义 CDN/域名，请在 `docker/nginx-docker.conf` / `backend/conf/nginx.conf` 的 `img-src` 中加入该域名，例如 `img-src 'self' data: https://cdn.example.com;`。

## 分布式部署

博客支持多个无状态实例部署在负载均衡之后：所有数据存放于外部 MariaDB，所有图片存放于 S3/MinIO。完整示例见 `docker-compose.distributed.yml`（博客 + MinIO，连接外部数据库）：

```bash
export BMY_DB_PASS=your-db-password
docker compose -f docker-compose.distributed.yml up -d
```

水平扩容时，使用相同的 `BMY_DB_*` / `BMY_S3_*` 环境变量再启动多个 `blog` 容器，并将 30999/31000 端口放入负载均衡即可。文章/页面数据存放在数据库中（首次启动时从 `blog/posts/*.md` 导入），多实例可挂载同一份内容，或统一在后台管理。

### 一键导入 / 一键导出数据

管理后台新增「💾 数据备份」页面（`http://localhost:31000/backup.html`）：

- **一键导出**：将数据库全部数据（文章、页面、评论、动态、友链、配置、日历等）导出为单个 JSON 文件下载。
- **一键导入**：选择此前导出的备份文件，清空并恢复全部数据（导入前会二次确认）。

对应 API（需管理员 Bearer Token）：

```bash
# 导出（下载 JSON 备份文件）
curl -H "Authorization: Bearer <token>" http://localhost:31000/api/admin/export -o backup.json

# 导入（恢复备份）
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     --data-binary @backup.json http://localhost:31000/api/admin/import
```

## 访问

| 服务       | 地址                           | 凭据                |
|-----------|-------------------------------|---------------------|
| 博客前台   | http://localhost:30999/        | —                   |
| 管理后台   | http://localhost:31000/        | admin / bmy2025     |

## 功能特性

### 前台
- **双语支持**：自动检测浏览器语言，切换中文/英文界面。文案配置在 `locales.yml`。
- **文章双语**：文章可设置英文标题、正文、标签和分类（`title_en`、`content_en` 等字段），浏览器为英文时自动显示。
- **Material Design 3**：基于 MDUI 2 Web Components，支持动态取色。
- **瀑布流布局**：首页文章卡片自适应 1–3 列瀑布流。
- **KaTeX 数学公式**：支持 LaTeX 公式渲染。
- **2048 小游戏**：关于页面隐藏彩蛋（点击头像 7 次）。

### 后端
- **文件式 CMS**：文章存为 Markdown + YAML frontmatter，无需数据库存储文章。
- **MariaDB**：仅用于评论和动态。
- **Bearer Token 认证**：仅密码登录（已移除 TOTP 双重验证）。
- **管理 API**：完整的文章、评论、动态、页面 CRUD。

## 管理后台

访问 **http://localhost:31000/** 进行管理：
- **概览**：统计信息
- **文章**：创建、编辑、删除、归档/取消归档
- **评论**：查看与删除评论
- **动态**：发布与管理
- **页面**：编辑 About 和 Talks 页面（支持双语内容）
- **图床**：SFTP / S3（MinIO）图片托管配置与测试
- **安全**：当前为仅密码认证

### 编写双语文章

在文章编辑器中向下滚动到 **🌐 英文内容** 区域，填写：
- 英文标题
- 英文标签（逗号分隔）
- 英文分类（逗号分隔）
- 英文正文（Markdown）

当访客浏览器语言为英文时，自动显示英文内容。

## 技术栈

| 层       | 技术                                   |
|---------|----------------------------------------|
| 后端     | OpenResty（nginx + LuaJIT）             |
| 数据库   | MariaDB（Unix Socket 连接）            |
| 前端     | MDUI 2 Web Components，原生 JS SPA     |
| 渲染     | 客户端 Markdown 渲染、KaTeX、瀑布流      |
| 认证     | Bearer Token（HMAC-SHA1 签名）          |
| 国际化   | YAML 文案文件，运行时加载               |

## 许可

MIT
