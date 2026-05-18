# Blog Material You — 独立博客部署文档

基于 [MDUI 2](https://www.mdui.org/zh-cn/docs/2/) (Material Design 3) 的独立博客系统，从 [Blog Material You](https://github.com/imitoy/Blog) 主题重构而来，去除 Material Design 3 框架依赖，使用 OpenResty + MariaDB + SPA 前端架构。

---

## 目录

1. [项目结构](#1-项目结构)
2. [环境要求](#2-环境要求)
3. [快速部署](#3-快速部署)
4. [配置文件](#4-配置文件)
5. [写文章](#5-写文章)
6. [API 参考](#6-api-参考)
7. [管理后台](#7-管理后台)
8. [常见问题](#8-常见问题)

---

## 1. 项目结构

```
blog-frontend/         ← 前端 + 数据
├── public/
│   ├── index.html           ← SPA 前端入口（客户端路由 + Markdown 渲染）
│   ├── admin/index.html     ← 管理后台 SPA
│   ├── css/                 ← 样式 (MDUI 2 + 自定义)
│   ├── js/                  ← JS (导航栏 / 瀑布流 / 评论)
│   ├── icon/                ← SVG 图标
│   └── img/                 ← 头像等图片
├── posts/                   ← 文章 (.md + YAML frontmatter)
├── pages/                   ← 静态页面 (about.md, talks.md)
├── data/
│   ├── mysql/               ← MariaDB 数据目录（自动创建）
│   └── comments/            ← 旧版文件评论（已弃用）
├── package.json
└── config.js                ← 博客配置 (Express 版)

blog-backend/            ← 后端 (OpenResty / Lua)
├── conf/
│   └── nginx.conf           ← 主配置，端口 30999
├── lua/
│   ├── init.lua             ← Worker 启动时加载博客数据
│   ├── config.lua           ← 博客配置 + 管理员密码
│   ├── utils.lua            ← YAML 解析 / 日期格式化 / 文件工具
│   ├── posts.lua            ← 文章和页面加载模块
│   ├── comments.lua         ← 评论 CRUD (MariaDB)
│   ├── talks.lua            ← 动态 CRUD (MariaDB)
│   ├── admin_auth.lua       ← 管理员认证
│   └── api/
│       ├── config.lua       ← GET /api/config
│       ├── posts.lua        ← GET /api/posts
│       ├── post.lua         ← GET /api/posts/:slug
│       ├── tags.lua         ← GET /api/tags
│       ├── tag.lua          ← GET /api/tags/:tag
│       ├── categories.lua   ← GET /api/categories
│       ├── category.lua     ← GET /api/categories/:category
│       ├── archives.lua     ← GET /api/archives
│       ├── page.lua         ← GET /api/pages/:slug
│       ├── comments.lua     ← GET/POST /api/comments
│       ├── talks.lua        ← GET /api/talks
│       └── admin/
│           ├── login.lua    ← POST /api/admin/login
│           ├── posts.lua    ← CRUD /api/admin/posts
│           ├── comments.lua ← GET/DELETE /api/admin/comments
│           ├── talks.lua    ← CRUD /api/admin/talks
│           └── pages.lua    ← GET/PUT /api/admin/pages
├── logs/                    ← OpenResty 日志
├── tmp/                     ← 运行时临时文件
├── start.sh                 ← 启动脚本
└── stop.sh                  ← 停止脚本
```

---

## 2. 环境要求

| 组件 | 版本 | 说明 |
|------|------|------|
| **OpenResty** | ≥ 1.27 | 含 `resty.mysql` 模块 |
| **MariaDB** | ≥ 10.6 | 或 MySQL 8.0+ |
| **Node.js** | — | 仅用于模板编译（非运行必需） |

**检查已安装：**

```bash
/opt/openresty/bin/openresty -V
mariadb --version
```

---

## 3. 快速部署

### 3.1 初始化 MariaDB

```bash
# 创建数据目录
DB_DIR=/home/openclaw/workspace/blog-frontend/data/mysql
mkdir -p "$DB_DIR"

# 初始化数据库（首次运行）
mariadb-install-db --datadir="$DB_DIR" --user=$(whoami)
```

### 3.2 启动 MariaDB

```bash
mariadbd \
  --datadir="$DB_DIR" \
  --socket="$DB_DIR/mysql.sock" \
  --port=3308 \
  --skip-grant-tables &
```

### 3.3 创建数据库和表

```bash
MYSQL="mariadb --socket=$DB_DIR/mysql.sock"

$MYSQL -e "CREATE DATABASE IF NOT EXISTS hexoyou CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 评论表
$MYSQL hexoyou -e "
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

# 动态表
$MYSQL hexoyou -e "
CREATE TABLE IF NOT EXISTS talks (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    content     TEXT       NOT NULL,
    create_time INT UNSIGNED NOT NULL,
    INDEX idx_time (create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"
```

### 3.4 启动 OpenResty
### 3.4 配置管理员密码
### 3.4 启动 OpenResty

### 3.4 启动 OpenResty
编辑 `blog-backend/lua/config.lua`：
### 3.4 启动 OpenResty

### 3.4 启动 OpenResty
```lua
### 3.4 启动 OpenResty
admin_user = "admin",
### 3.4 启动 OpenResty
admin_pass = "设置一个安全的密码",
### 3.4 启动 OpenResty
```
### 3.4 启动 OpenResty

### 3.4 启动 OpenResty
### 3.5 启动 OpenResty
### 3.4 启动 OpenResty

### 3.4 启动 OpenResty
```bash
### 3.4 启动 OpenResty
cd blog-backend
### 3.4 启动 OpenResty
bash start.sh
### 3.4 启动 OpenResty

### 3.4 启动 OpenResty
# 验证
### 3.4 启动 OpenResty
curl http://localhost:30999/api/health
### 3.4 启动 OpenResty
# → {"status":"ok","server":"openresty","version":"blog-frontend"}
### 3.4 启动 OpenResty
```
### 3.4 启动 OpenResty

### 3.4 启动 OpenResty
### 3.6 一键启动脚本

```bash
# 同时启动 MariaDB + OpenResty
DB_DIR=/home/openclaw/workspace/blog-frontend/data/mysql

# 启动 MariaDB（如果还没启动）
pgrep -a mariadbd || mariadbd --datadir="$DB_DIR" --socket="$DB_DIR/mysql.sock" --port=3308 --skip-grant-tables &

# 启动 OpenResty
bash blog-backend/start.sh
```

停止：

```bash
bash blog-backend/stop.sh
kill $(pgrep -f "mariadbd.*mysql.sock") 2>/dev/null || true
```

---

## 4. 配置文件

### 4.1 博客配置

`blog-backend/lua/config.lua`：

```lua
_M.data = {
    name = "Blog Material You",              -- 博客名称
    slogan = "A simple theme.",      -- 副标题
    description = "Hiiiiiiiii!",     -- 首页描述
    title = "Blog Material You's Blog",       -- 浏览器标题
    avatar = "/img/avatar.png",      -- 头像路径
    github = "https://github.com/",  -- GitHub 链接
    admin_user = "admin",            -- 管理员用户名
    admin_pass = "hexoyou2025",      -- 管理员密码

    menu = {
        { name = "Home",  url = "/",          icon = "/icon/home.svg",    id = "home" },
        { name = "Posts", url = "/posts/",    icon = "/icon/article.svg", id = "posts" },
        ...
    }
}
```

修改后需重启 OpenResty 生效。

### 4.2 端口配置

编辑 `blog-backend/conf/nginx.conf`，修改 `listen` 值：

```nginx
server {
    listen       30999;    # 改为你想要的端口
    ...
}
```

---

## 5. 写文章

### 5.1 手动创建

在 `blog-frontend/posts/` 目录下创建 `.md` 文件：

```markdown
---
title: 我的文章标题
date: 2025-06-01
tags: [tech, javascript]
categories: [编程]
cover: /img/cover.jpg
---

这里是文章正文，支持 **Markdown** 语法。

## 二级标题

- 列表项
- 列表项

```javascript
console.log('Hello');
```
```

### 5.2 通过管理后台

访问 `http://localhost:30999/admin/` → 登录 → 文章 → 写新文章

编辑器支持工具栏辅助（加粗、斜体、标题、列表、代码块、引用）。

---

## 6. API 参考

### 6.1 公开 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/config` | GET | 博客配置 |
| `/api/posts` | GET | 文章列表（摘要） |
| `/api/posts/:slug` | GET | 单篇文章（含正文） |
| `/api/tags` | GET | 所有标签及文章数 |
| `/api/tags/:tag` | GET | 某标签下的文章 |
| `/api/categories` | GET | 所有分类及文章数 |
| `/api/categories/:cat` | GET | 某分类下的文章 |
| `/api/archives` | GET | 文章按年分组 |
| `/api/pages/:slug` | GET | 静态页面 (about) |
| `/api/talks` | GET | 动态列表 |
| `/api/comments` | GET | 获取评论 |
| `/api/comments` | POST | 提交评论 |

**评论参数：**

```bash
# 获取评论
curl "/api/comments?path=/post/hello-world"

# 评论计数
curl "/api/comments?type=count&path=/post/hello-world"

# 提交评论
curl -X POST /api/comments \
  -H 'Content-Type: application/json' \
  -d '{"nick":"Alice","mail":"a@b.com","comment":"好文章！","url":"/post/hello-world"}'
```

### 6.2 管理 API

所有管理端点需携带 HTTP Basic Auth 头，凭据在 `config.lua` 中配置。

```bash
# Base64 编码用户名:密码
AUTH="Basic $(echo -n 'admin:你的密码' | base64)"
```

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/admin/login` | POST | 登录验证 |
| `/api/admin/posts` | GET | 文章列表（含全文） |
| `/api/admin/posts` | POST | 创建文章 |
| `/api/admin/posts` | PUT | 更新文章 |
| `/api/admin/posts?slug=xxx` | DELETE | 删除文章 |
| `/api/admin/comments` | GET | 所有评论 |
| `/api/admin/comments?id=N` | DELETE | 删除评论 |
| `/api/admin/talks` | GET | 动态列表 |
| `/api/admin/talks` | POST | 创建动态 |
| `/api/admin/talks?id=N` | DELETE | 删除动态 |
| `/api/admin/pages` | GET | 页面列表 |
| `/api/admin/pages` | PUT | 更新页面 |

**创建文章示例：**

```bash
curl -X POST /api/admin/posts \
  -H 'Authorization: Basic ...' \
  -H 'Content-Type: application/json' \
  -d '{
    "slug": "new-post",
    "title": "新文章",
    "date": "2025-06-01",
    "tags": ["tech"],
    "categories": ["编程"],
    "content": "文章正文 Markdown..."
  }'
```

---

## 7. 管理后台

访问 `http://localhost:30999/admin/`

### 7.1 功能一览

| 页面 | 功能 |
|------|------|
| **概览** | 文章/评论/标签统计，最近文章 |
| **文章** | 列表、新建、编辑、删除（编辑含 Markdown 工具栏） |
| **评论** | 查看所有评论，删除 |
| **动态** | 列表、发布、删除 |
| **页面** | 编辑 about / talks 页面 |

### 7.2 默认凭据

- 用户名：`admin`
- 密码：`hexoyou2025`

⚠️ **部署到公网前务必修改密码！** 在 `blog-backend/lua/config.lua` 中：

```lua
admin_pass = "你的强密码",
```

---

## 8. 常见问题

### 8.1 `init_worker_by_lua_file` 错误

```
cannot load module 'cjson'
```

OpenResty 需要 `lua_package_path` 指向 cjson.so。确认 `nginx.conf` 中有：

```nginx
lua_package_path "/opt/openresty/lualib/?.lua;;";
```

### 8.2 MariaDB 连接失败

```
failed to connect to MariaDB: neither "host" nor "path" options are specified
```

确认：
1. MariaDB 正在运行：`pgrep -a mariadbd`
2. Socket 文件存在：`ls data/mysql/mysql.sock`
3. `comments.lua` 中 `DB_SOCKET` 路径正确

### 8.3 端口被占用

```bash
# 查看谁占用了端口
ss -tlnp | grep 30999

# 修改端口
# 编辑 nginx.conf 中的 listen 值，然后重启
```

### 8.4 页面一直显示 "Loading..."

1. 打开浏览器控制台 (F12) 查看 JS 错误
2. 确认 API 可访问：`curl http://localhost:30999/api/posts`
3. 清除浏览器缓存：`http://localhost:30999/?nocache=1`

### 8.5 文章修改后不生效

OpenResty 在 `init_worker_by_lua` 阶段将文章缓存在共享内存中。修改 `posts/` 下的 .md 文件后需**重启 OpenResty**：

```bash
bash blog-backend/stop.sh && bash blog-backend/start.sh
```
