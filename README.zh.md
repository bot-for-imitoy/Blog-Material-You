# Blog Material You

基于 **OpenResty + MariaDB** 后端和 **MDUI 2 (Material Design 3)** 前端的独立博客系统。支持中英文双语显示（自动检测浏览器语言）。

## 项目结构

```
Blog/
├── backend/              # OpenResty + Lua API 服务
│   ├── conf/             # Nginx 配置
│   │   └── nginx.conf    # 端口 30999（前台）+ 31000（管理后台）
│   ├── lua/              # Lua 业务逻辑
│   │   ├── posts.lua     # 文章加载与解析（.md + YAML frontmatter）
│   │   ├── comments.lua  # 评论 CRUD（MariaDB）
│   │   ├── talks.lua     # 动态 CRUD（MariaDB）
│   │   ├── config.lua    # 博客配置与管理员凭据
│   │   ├── session.lua   # Bearer Token 管理
│   │   └── api/          # HTTP API 端点
│   ├── start.sh          # 启动脚本
│   └── stop.sh           # 停止脚本
├── blog/                 # 前端（MDUI 2 SPA）
│   ├── posts/            # Markdown 文章源文件（含 YAML frontmatter）
│   ├── pages/            # 静态页面（about、talks）
│   ├── public/           # nginx 托管的静态资源
│   │   ├── index.html    # 博客 SPA（双语自动切换）
│   │   ├── admin/        # 管理后台 SPA
│   │   └── css/js/icon/  # 样式表、脚本、图标
│   └── locales.yml       # UI 文案翻译（中文 + 英文）
└── README.md             # 英文说明文档
└── README.zh.md          # 本文件
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
