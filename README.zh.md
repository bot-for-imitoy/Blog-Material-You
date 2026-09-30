# Blog Material You

一个自托管博客系统：后端基于 **Node.js + TypeScript**，内容采用**本地 Markdown 存储（类 Hexo，完全没有数据库）**，前端使用 **MDUI 2 (Material Design 3)**，并且完全**服务端渲染**。

每篇文章、页面、动态和友链都是 `blog/` 下带 YAML frontmatter 的 Markdown 文件；所有运行状态——管理员凭据、评论、访客权限、TOTP 密钥、图床配置——都是 `blog/data/` 下的 JSON 文件。没有 MariaDB，没有 nginx，没有 OpenResty，没有 Python，也没有任何外部 CDN：单个 Node.js 进程在一个端口上同时提供前台页面、管理后台以及两套 JSON API。

本项目是对旧的 OpenResty/Lua + MariaDB 实现的彻底重写，**不再需要任何数据库**。升级路径见[从旧的 MariaDB 版本迁移](#从旧的-mariadb-版本迁移)。

---

## 项目结构

```
Blog-Material-You/
├── src/                      # Node.js + TypeScript 应用（直接运行，无需构建）
│   ├── index.ts              # 入口：运行时目录、前端资源、管理员初始化、HTTP 服务
│   ├── app.ts                # Express 装配：安全响应头、Origin 校验、静态资源、路由、404/500
│   ├── paths.ts              # 所有文件系统位置与环境变量解析
│   ├── version.ts            # 应用版本（/api/health 与 /api/status 使用）
│   ├── site-config.ts        # 站点设置 + 完整 UI 文案字典 + 导航菜单
│   ├── content/              # Markdown 内容模型（就是"数据库"）
│   │   ├── markdown-files.ts # 按 mtime/size 缓存的扫描器、frontmatter 解析、原子写入
│   │   ├── posts.ts          # blog/posts/*.md       → Post
│   │   ├── pages.ts          # blog/pages/*.md       → Page
│   │   ├── talks.ts          # blog/talks/*.md       → Talk（微动态）
│   │   └── friends.ts        # blog/friends/*.md     → Friend
│   ├── store/                # 运行状态，每个用途一个 JSON 文件
│   │   ├── json-store.ts     # 原子写入、按 mtime 缓存的 JSON 文件存储
│   │   ├── credentials.ts    # blog/data/admin.json    （scrypt + 旧版 AES 记录）
│   │   ├── totp-state.ts     # blog/data/totp.json     （两步验证密钥、待确认密钥）
│   │   ├── visitors.ts       # blog/data/visitors.json （已注册邮箱 + 待审核队列）
│   │   ├── comments.ts       # blog/data/comments/<key>.json（每个页面 URL 一个文件）
│   │   ├── calendar.ts       # blog/data/calendar.json
│   │   └── imghost-config.ts # blog/data/imghost.json  （SFTP / S3 配置）
│   ├── auth/                 # password、secret、session、TOTP、访客会话
│   ├── middleware/           # admin-auth.ts —— API 与页面两套鉴权守卫
│   ├── media/                # imghost.ts（S3/SFTP 上传）、avatar.ts（sharp → 512×512 WebP）
│   ├── lib/                  # markdown.ts、text.ts、ratelimit.ts、backup.ts
│   ├── render/               # engine.ts（EJS）、seo.ts（逐路由 title/description/canonical）
│   └── routes/               # public-pages.ts、public-api.ts、admin-pages.ts、admin-api.ts
├── views/                    # EJS 模板（服务端渲染，无客户端模板引擎）
│   ├── layouts/              # public.ejs、admin.ejs
│   ├── pages/                # home、posts、post、list、tags、categories、archives、
│   │                         # talks、friends、page、status、auth、404
│   ├── admin/                # dashboard、posts、editor、pages、page-editor、talks、
│   │                         # talk-editor、friends、friend-editor、comments、visitors、
│   │                         # security、imghost、backup、login、setup
│   └── game/2048.ejs         # 彩蛋
├── blog/                     # 内容 + 静态资源 + 运行状态
│   ├── posts/                # <slug>.md
│   ├── pages/                # <slug>.md（可选旧的 <slug>.en.json）
│   ├── talks/                # <unixtime>.md
│   ├── friends/              # <id>-<slug>.md
│   ├── data/                 # 运行状态（已 gitignore）：凭据、评论、访客、
│   │                         # TOTP、会话、站点/日历/图床设置
│   ├── locales.yml           # 旧版翻译文件，仅作参考（运行时已不使用）
│   └── public/               # 静态资源，通过 /css、/js、/icon、/img 等路径提供
│       └── vendor/           # 生成目录：从 node_modules 复制来的 mdui、KaTeX、highlight.js
├── scripts/
│   ├── sync-assets.mjs       # 把 mdui/KaTeX/highlight.js 复制到 blog/public/vendor
│   ├── import-legacy-mariadb.mjs  # 从旧 MariaDB 安装一次性迁移
│   └── passwd-reset.mjs      # 离线重置管理员凭据（npm run passwd-reset）
├── Dockerfile                # node:24-alpine、非 root 用户、HEALTHCHECK
├── docker-compose.yml        # 单容器 + 数据卷
├── .env.example              # 所有支持的环境变量，均带注释
├── package.json              # npm start / dev / typecheck / assets / passwd-reset
├── tsconfig.json             # strict、NodeNext、noEmit（Node 直接运行 .ts 文件）
└── README.md / README.zh.md
```

### 状态存放位置

| 路径 | 内容 | 是否 gitignore |
|------|------|----------------|
| `blog/posts/`、`blog/pages/`、`blog/talks/`、`blog/friends/` | 你的内容（Markdown）——**这就是数据库** | 是（仓库只跟踪 `.gitkeep`） |
| `blog/data/` | 运行状态：`admin.json`（凭据）、`totp.json`、`visitors.json`、`calendar.json`、`imghost.json`、`secret.json`、`comments/`、`sessions/`、`image-cache/`（缩放后的图片变体，可随时删除） | 是 |
| `blog/public/vendor/` | mdui / KaTeX / highlight.js，由 `scripts/sync-assets.mjs` 从 `node_modules` 生成 | 是 |
| `blog/public/avatars/`、`blog/public/uploads/` | 上传的图片 | 是 |

`blog/public/vendor/` 是生成产物而非源码。`npm install` 会通过 `postinstall` 执行 `sync-assets.mjs`，服务启动时若发现缺失也会自动重新生成，因此全新克隆的仓库在离线环境下同样可用——运行时永远不会加载公共 CDN。

---

## 快速开始

### 环境要求

- **Node.js ≥ 22.18**（应用依赖 Node 内置的类型擦除直接运行 TypeScript，没有构建步骤）
- 不需要数据库、Web 服务器或 Python

### 本地运行

```bash
npm install     # 安装依赖，并同步前端库到 vendor 目录
npm start       # → http://localhost:30999/
```

常用脚本：

| 命令 | 用途 |
|------|------|
| `npm start` | 启动服务（`node src/index.ts`） |
| `npm run dev` | 以 `--watch` 模式运行（文件变化自动重启） |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run assets` | 重新把 mdui / KaTeX / highlight.js 同步到 `blog/public/vendor` |

### Docker 运行

```bash
docker compose up -d --build
```

`docker-compose.yml` 默认把容器的 `30999` 端口映射到宿主机的 **`8000`**，如需其他端口请修改 `ports:`。

### 访问地址

| 服务 | 地址 | 说明 |
|------|------|------|
| 博客前台 | `http://localhost:30999/`（Docker：`http://localhost:8000/`） | 服务端渲染 |
| 管理后台 | `http://localhost:30999/admin/` | 会跳转到 `/admin/dashboard/` |
| 健康检查 | `http://localhost:30999/api/health` | `{"status":"ok","server":"nodejs","version":"2.0.0"}` |
| 首次初始化 | `http://localhost:30999/admin/setup/` | 仅在尚未创建管理员时可访问 |
| Sitemap / RSS | `/sitemap.xml`、`/rss.xml` | 设置 `BMY_SITE_URL` 后输出绝对地址 |

### 创建管理员账号

首次打开站点时**并不存在管理员账号**。访问 **`/admin/setup/`** 设置用户名和密码（密码至少 6 位，若干常见弱口令会被拒绝）。账号以 scrypt 哈希写入 `blog/data/admin.json`，之后 `/admin/setup/` 会自动跳转到登录页。

无人值守部署时也可以通过环境变量创建：设置 `BMY_ADMIN_USER` / `BMY_ADMIN_PASS` 后启动服务。该逻辑**只在没有管理员账号时生效**，因此之后在后台改过的密码不会在重启时被悄悄改回去。忘记密码时的重置方式**刻意不做成环境变量**——请使用 `npm run passwd-reset`（见[运维](#运维)），这样部署配置里的任何值都不可能在你不知情的情况下覆盖凭据。

---

## 内容编写

所有内容都是 `blog/` 下带 YAML frontmatter 的 UTF-8 Markdown 文件。**文件名（去掉 `.md`）就是 slug**，用于 URL、`/api/...` 路径以及管理后台。

文件按需扫描，并以 **mtime + size** 作为缓存键。用你自己的编辑器修改文件（或 `git pull`）后，下一次请求即可生效——无需重启，也不需要手动 reload。Markdown 在**服务端**渲染，因此每个页面都是完整的 HTML，对爬虫和禁用 JavaScript 的读者都友好，并支持：

- 标题锚点（每个标题带 `id`，在文章/页面页作为目录输出）
- 通过 highlight.js 做代码高亮（已内置 GitHub 明暗两套主题）
- KaTeX 数学公式（行内 `$…$`，块级 `$$…$$`）
- 链接自动识别、表格、引用

### 文章 —— `blog/posts/<slug>.md`

| 字段 | 类型 | 含义 |
|------|------|------|
| `title` | string | 显示标题（缺省回退为 slug） |
| `date` | `YYYY-MM-DD` 或 Unix 秒 | 排序键与归档年份，读取时会归一化 |
| `tags` | list | 用于 `/tags/`、`/tags/:name` 以及 `GET /api/tags` |
| `categories` | list | 用于 `/categories/`、`/categories/:name` 以及 `GET /api/categories` |
| `cover` | string | 可选的卡片/头图地址 |
| `archived` | boolean | `true` 表示移入 `/archives/`，并从前台列表中隐藏 |
| `title_en` | string | 英文标题（可选） |
| `content_en` | string | 英文正文，写在 YAML 里（可选） |

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

双语文章：中文正文放在 Markdown 正文中，英文正文放在 `content_en` frontmatter 字段里（YAML 块标量或单引号字符串均可）。此时 `/api/posts/:slug` 会同时返回 `html` 和 `htmlEn`；当 `title_en` 存在时，逐路由 SEO 元数据也会切换为英文标题与描述。

列表既可以写成 YAML 序列（`[Docker, Linux]`、`- Docker`），也可以写成逗号分隔的字符串——管理后台的编辑器发送的是后者。若文件的 YAML 格式有误，程序会退回使用容错的逐行解析器（与旧 Lua 实现的行为一致）并输出警告，而不会丢弃该文件。

### 页面 —— `blog/pages/<slug>.md`

独立页面。`about.md` 的访问地址是 **`/about/`**，其他页面均为 **`/pages/<slug>/`**。

| 字段 | 类型 | 含义 |
|------|------|------|
| `title` | string | 页面标题（缺省回退为 slug） |
| `title_en` | string | 英文标题（可选） |
| `content_en` | string | 英文正文，写在 YAML 里（可选） |

```markdown
---
title: 关于
title_en: About Me
---

这里是页面正文。
```

为了兼容旧版存储，英文正文也可以放在同级文件 `blog/pages/<slug>.en.json` 中，内容形如 `{"content_en": "…"}`。frontmatter 字段优先；只有字段缺失时才会读取该旁路文件。当英文标题和英文正文都存在时，`/pages/<slug>/` 会渲染英文版本。

### 动态 —— `blog/talks/<unixtime>.md`

短动态（微动态）。文件名即数字 id；当 `create_time` 缺失时也直接作为创建时间使用。

| 字段 | 类型 | 含义 |
|------|------|------|
| `id` | integer | 动态 id，同时也是文件名 |
| `create_time` | Unix 秒 | 排序键（新的在前） |

```markdown
---
id: 1781603753
create_time: 1781603753
---

今天天气真好！在浏览器里测试动态功能。 😊
```

### 友链 —— `blog/friends/<id>-<slug>.md`

| 字段 | 类型 | 含义 |
|------|------|------|
| `id` | integer | 数字 id，唯一；文件名以它开头 |
| `title` | string | 站点名称（缺省回退为文件名） |
| `descr` | string | 描述 |
| `title_en` / `descr_en` | string | 英文版本（可选） |
| `avatar` | string | 头像地址 |
| `url` | string | 目标链接（默认为 `#`） |
| `sort_order` | integer | 升序排序，其次按 `id` |

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

在管理后台修改友链 `title` 时，文件会自动重命名，以保持 `<id>-<slug>` 的命名约定。

### 通过管理后台编写内容

`/admin/posts/new/`、`/admin/pages/new/`、`/admin/talks/new/`、`/admin/friends/new/` 中的编辑器写入的是完全相同的文件，并且是原子写入（临时文件 + rename）。每次写操作都会自动让 Markdown 缓存失效，因此保存后下一次请求即可在前台看到。`POST /api/admin/reload` 仍然保留，用于处理在进程之外手工修改的文件。

---

## 功能特性

### 前台

- **首页**（`/`）——活跃文章的卡片网格，按时间倒序，支持封面图和自动摘要。
- **文章列表**（`/posts/`）——按年份分组的全部活跃文章；单篇地址为 `/post/<slug>/`。
- **文章详情**——服务端渲染正文、由标题锚点生成的目录、标签、分类、封面，以及在开启评论时显示评论表单。
- **标签**（`/tags/`、`/tags/:name/`）与**分类**（`/categories/`、`/categories/:name/`）——带文章数的聚合索引，按使用次数倒序。
- **归档**（`/archives/`）——`archived: true` 的文章，按年份分组。标签与分类列表有意同时包含已归档文章。
- **动态**（`/talks/`）——按时间排列的微动态。
- **友链**（`/friends/`）。
- **页面**——`/about/` 以及 `/pages/<slug>/`。
- **状态**（`/status/`）——实时进程运行时长、Node.js 版本、内存占用、内容统计（文章、评论、动态、友链、注册访客），以及需要权限的访客日历。
- **访客身份验证**（`/auth/`）——读者输入邮箱：已注册地址会获得签名的访客 Cookie，未注册地址可以提交注册申请，进入管理后台的审核队列。退出登录既支持普通表单提交（`POST /auth/logout`，无需 JavaScript），也支持 JSON 接口（`POST /api/auth/logout`）。
- **2048**（`/2048/`）——彩蛋小游戏，最高分保存在浏览器本地。
- **搜索**（`/search/`）——对标题、标签、分类与正文进行全文搜索，索引在进程内构建。无需 JavaScript 即可使用（普通 GET 表单）；`js/search.js` 会把它升级为输入即搜，`Ctrl`/`Cmd`+`K` 可直接聚焦搜索框。
- **个人名片页**（`/profile/`）——一个独立的整屏页面：高斯模糊的夜景背景 + 缓慢浮动的微光点、毛玻璃卡片、霓虹圆环头像、渐变胶囊标签，以及可展开的导航长条。它使用自己的布局渲染（不带站点外壳），且**完全不需要 JavaScript**——展开面板用的是 `<details>`。内容位于 `_config.yml` 的 `profile:` 块。
- **双语内容**——文章与页面各自支持英文标题/正文；前台 UI 文案的内置默认值位于 `src/site-config.ts`，可在 `_config.yml` 的 `strings:` 下按键覆盖。
- **SEO**——逐路由的 `<title>`、meta description 与 canonical 链接，以及 `/sitemap.xml` 和 `/rss.xml`（最新 `rssLimit` 篇文章）。在 `_config.yml` 中设置 `url`（或设置 `BMY_SITE_URL`）后，canonical 与订阅链接为绝对地址。
- **按需尺寸的图片**——页面上出现的每张图片都由下面的缩放接口提供，手机不会再下载桌面尺寸的大图。

## 图片：缩放、裁剪与缓存

既不预生成，也不重复上传。模板与 Markdown 渲染器输出带目标尺寸的 `/media` URL；`GET /media`（`src/routes/media.ts`）在首次请求时用 sharp 处理源文件，写入 `blog/data/image-cache/`，然后把结果流式返回。浏览器从 `srcset` 中真正选中的那一个尺寸才会被生成。

```
GET /media?src=/uploads/photo.jpg&w=800          # 缩放到宽 800
GET /media?src=/img/avatar.jpg&w=160&fit=cover   # 正方形裁剪
```

- **Markdown**：`![](/uploads/a.jpg)` 在渲染时被改写为覆盖 320–2000 px 的 `src`/`srcset`/`sizes`（`src/lib/markdown.ts`），2400 px 的原图不会被送进 360 px 宽的正文栏。远程地址与 `data:` URI 原样保留。
- **模板**：所有视图都可以用 `mediaUrl()` 与 `mediaSrcset()`。封面会按瀑布流列宽生成 `srcset`，抽屉与关于页头像请求 160/320 px 的方图——仓库自带的 `avatar.jpg` 有 445 kB，在它真正被绘制的尺寸下约为 7 kB。
- **缓存键**：源文件路径、体积、mtime，加上请求的尺寸、裁剪方式与格式的 SHA-256。因此就地替换图片无需任何手动失效——URL 不变但 ETag 变了；响应带一年 `immutable`。超过 30 天未被使用的条目会被清理，整个目录随时可以直接删除。
- **刻意加上边界**：只接受 `/uploads`、`/avatars`、`/img` 下的本地文件（解码后的路径会再次与这三个目录比对，`..` 与 `%2e%2e` 都逃不出去）；宽高会向上对齐到固定档位且上限 2560 px；质量按格式固定；`w`/`h` 必填——所以 `/media` 既不能当开放代理，也不能被用来刷出无限缓存。
- **并发**：同一变体的并发请求只跑一次 sharp；缓存文件先写临时名再 rename，读者不会看到写了一半的图片。

## 无缝导航

点击站内链接不再整页重载。页面在后台取回，只替换真正变化的部分——内容区、该页自己的样式表、`<title>` 与描述 / Open Graph / canonical 标签，以及侧边栏的当前项高亮。顶栏、导航抽屉（包括它的滚动位置与展开状态）、内联的 Material You 配色、以及 mdui 已升级的自定义元素，全都原样保留。

实现位于 `blog/public/js/pjax.js`。它是**渐进增强，而不是把渲染模型改回去**：

- 每个 URL 依然返回完整文档。爬虫、`curl`、禁用 JavaScript 的浏览器都能拿到全部内容，因为服务端并不关心客户端之后是否会打补丁。（本项目早期版本是客户端渲染的外壳 + 片段接口，正是因为这个原因被替换掉，本功能刻意不再走回那条路。）
- 任何失败——网络错误、非 HTML 响应、响应里没有内容容器——都会回退为普通跳转。
- 指向 `/admin`（独立外壳）、`/profile/`（独立文档）、订阅源、图片、下载、跨域地址、`target="_blank"` 以及带修饰键的点击（Ctrl/Cmd/Shift/中键）都交给浏览器处理。

### 页面脚本契约

由于内容区每次导航都会被丢弃重建，页面脚本不能在模块顶层捕获元素——ES 模块只求值一次，第二次访问就会绑定在已删除的节点上。因此 `blog/public/js/` 下的页面脚本都要导出：

```js
export function init() {}    // 每次都在这里重新查询 DOM
export function destroy() {} // 释放监听、定时器与观察器
```

`init()` 可重复调用，`destroy()` 在 `init()` 从未执行过时也能安全调用；凡是绑定在页面自身子树之外的东西（`document`、`window`、定时器、观察器），都要在 `init()` 里注册、在 `destroy()` 里释放。

`pjax.js` 从内容容器的 `data-pjax-scripts` 属性（由布局输出）读取该页需要哪些脚本，先对即将离开的模块调用 `destroy()`，替换 DOM，再导入并初始化新的一组。每次导入前后会设置 `window.__pjax.importing`，让尚未求值过的模块跳过自己的自动初始化——这样「整页加载」（由布局的 `<script type="module">` 标签初始化）和「pjax 导航」都不会重复初始化。

前进/后退也已处理：历史条目会记录滚动偏移，解析后的文档会短暂缓存，因此返回是瞬时的。

改这块代码前有两件事值得知道：

- **滚动容器不是 window**。外壳是 `100vh` 的纵向 flex 布局，滚动的是 `.content-container`（`overflow: auto`），mdui 顶栏通过 `scroll-target` 绑定的也正是它。所以滚动 `window` 什么都不会发生。`pjax.js` 操作的是这个容器，并且在**替换之前**先把它拉回顶部——否则从另一个页面的中部进入的新页面会继承「已滚动」状态而让顶栏保持抬起（不透明），可新页面明明在最顶端、顶栏本该与背景融为一体。
- **`pushState` 在替换之前而不是之后**。页面脚本会读 `window.location`（`comments.js` 用它作为请求的键），所以如果之后再更新 URL，新进入的文章会按「刚刚离开的那个页面」去取评论，只有手动刷新才能看到自己的评论。

### 评论

- 每个页面 URL 对应 `blog/data/comments/` 下的一个 JSON 文件；写入原子化，读取按 mtime 缓存。
- 字段：`id`、`nick`、`mail`、`comment`、`link`、`ua`、`avatar`、`url`、`createTime`。
- 服务端校验：昵称 ≤ 80，邮箱 ≤ 200 且校验格式，正文 ≤ 5000，`link` 必须以 `http(s)://` 开头，User-Agent 截断到 500 字符（旧实现完全没有限制）。
- 提交评论按 IP 限制为每分钟 10 条。评论审核（跨页面列表、删除）位于管理后台。

#### 评论隐私

评论表单在「评论内容」与提交按钮之间有一个标注为 **不展示我的信息** 的开关，下面跟一行说明文案。它是有实际行为的功能，不是装饰：

- 开关**关闭**时，提交内容包含 `nick`、`mail`、`comment`、`link`、`url`（评论所属页面，同时也是存储键）以及 `ua`（`navigator.userAgent`）——后者是页面自动采集、而非访客手填的唯一一项。
- 开关**打开**时，`comments.js` 发送空的 `ua`。服务端如实存空值，而不会转去从请求头里猜浏览器——所以打开开关是真的不采集，而不是把它藏起来。
- 开关只对一次提交生效，提交成功后复位；它不在浏览器或会话里留下任何持久化记录，服务端也不会为了记住它而写 Cookie。

如果改动这两段文案，请保持说明准确——它是访客唯一能看到「采集了什么」的地方。文案位于 `_config.yml` 的 `strings:`（`commentPrivacyToggle`、`commentPrivacyNotice`）。

### 搜索

`/search/` 是普通的服务端渲染页面，因此查询结果是一个可分享的 URL，禁用 JavaScript 也能使用。搜索范围覆盖标题、英文标题、标签、分类与正文。

- **索引**：在进程内用全站同一套「按 mtime 缓存」的 Markdown 扫描器构建，并以文件 mtime 集合作为记忆化键——改一篇文章即自动失效，不需要重建步骤或搜索服务。`POST /api/admin/reload` 会显式清空它。
- **采用子串匹配而非分词匹配**。中文没有空格，按拉丁语系分词会恰好在这个博客最常见的查询上失效；拉丁查询同样可用，因为匹配不区分大小写，多词查询会按空格拆分成 AND 式排序。
- **排序**：标题命中 > 英文标题命中 > 标签/分类命中 > 正文命中；已归档文章仍可搜到，但权重降低 40%；命中全部关键词的文章排在只命中部分关键词的前面。
- **摘要**围绕首个命中位置截取，命中的词用 `<mark>` 包裹。高亮在构造上就是 XSS 安全的：先对文本做 HTML 转义，**再**插入 `<mark>`，因此包含 `<script>` 的文章无法注入标记。前端即时搜索也完全不用 `innerHTML`，而是用 `createElement` + `textContent` 重建高亮。
- **限流**：`/api/search` 每 IP 每分钟 60 次。
- **SEO**：结果页带 `noindex, follow`，因为逐查询的结果页属于稀薄重复内容；它链接到的文章本身仍可被索引。

### 管理后台

`/admin/` 下的每个页面都是完整的服务端渲染文档，而不是客户端 SPA：

| 页面 | 作用 |
|------|------|
| `/admin/login/` | 密码登录；启用 TOTP 后变为两步表单 |
| `/admin/setup/` | 首次初始化向导，创建管理员账号（仅在尚未创建时可访问） |
| `/admin/dashboard/` | 统计（活跃/已归档文章、评论、标签、动态）与最近五篇文章 |
| `/admin/posts/` | 全部文章（含已归档）；新建、编辑、归档/取消归档、删除 |
| `/admin/posts/new/`、`/admin/posts/:slug/edit/` | 文章编辑器：slug、标题、日期、封面、逗号分隔的标签/分类、中英文正文 |
| `/admin/pages/`、`/admin/pages/new/`、`/admin/pages/:slug/edit/` | 页面列表与编辑器（按 slug upsert） |
| `/admin/talks/`、`/admin/talks/new/` | 发布、编辑、删除动态 |
| `/admin/friends/`、`/admin/friends/new/`、`/admin/friends/:id/edit/` | 友链列表与编辑器 |
| `/admin/comments/` | 跨页面的全部评论，新的在前，支持删除 |
| `/admin/visitors/` | **访客管理（本次重写新增）**：审核注册申请、授予或撤销 `calendar` 权限、添加或移除已批准的邮箱 |
| `/admin/security/` | 修改用户名/密码，启用或关闭 TOTP 两步验证（二维码/密钥 + 6 位验证码确认） |
| `/admin/imghost/` | 图床配置（SFTP 或 S3，含 TLS/双向认证）与连接测试 |
| `/admin/backup/` | 将整站导出为一个 JSON 文件，以及导入备份 |

### 图床

上传的头像会由 sharp 处理成 512×512 WebP 并写入 `blog/public/avatars/`。支持两种远端存储，可在 `/admin/imghost/` 配置，也可完全通过环境变量配置：

- **S3 兼容对象存储**（MinIO、AWS S3、Cloudflare R2 等），通过 `@aws-sdk/client-s3`，支持自定义 CA 与**双向 TLS**（客户端证书 + 私钥）。
- **SFTP**，通过 `ssh2-sftp-client`（主机、端口、用户名、私钥路径、远程目录）。

两者都支持文件名模板（`{yy}`、`{mm}`、`{dd}`、`{file_extension}`、`{original}`）；模板渲染结果中的路径分隔符会被替换，且不含每次上传唯一性的模板会自动附加短随机后缀，因此同一天内的两次上传不会互相覆盖。启用 S3 后，新生成的头像会同步到存储桶，多实例部署时各实例提供同一份文件。

### 安全

- 密码使用 **scrypt**（N=16384、r=8、p=1、64 字节密钥、16 字节随机盐）并以常量时间比较验证。旧实现写入的记录（AES-256-CBC + `EVP_BytesToKey`）仍可验证，并会在**下一次成功登录时自动重新哈希为 scrypt**。
- 会话 Token 形如 `base64url(payload).HMAC-SHA256(payload)`，载荷包含用户名、签发时间和随机 nonce。**退出登录会真正吊销 Token**（加入黑名单）；修改密码或用户名会提升吊销纪元（epoch），从而让所有已签发的 Token 立即失效——旧实现只是删除 Cookie，Token 在 7 天内依然有效。
- 会话密钥来自 `BMY_SESSION_SECRET`；未设置时会**随机生成一次并持久化**到 `blog/data/secret.json`（权限 `0600`）。旧版本内置了硬编码的默认密钥，任何人都可以伪造管理员 Token。
- 管理员 Cookie 为 `HttpOnly` + `SameSite=Strict`，有效期 7 天（可用 `BMY_SESSION_TTL` 以秒为单位调整）；访客 Cookie 为 `HttpOnly` + `SameSite=Lax`。Token 本身由会话密钥签名，因此一个部署的 Token 在另一个部署上无效。
- **TOTP 两步验证**——RFC 6238，HMAC-SHA1、6 位、30 秒步长、允许 ±1 步时钟偏移，兼容 Google Authenticator / Authy / 1Password。登录变为两步握手：密码步骤只返回一次性、5 分钟有效的临时 Token，验证码错误会**作废**该 Token，因此无法针对同一次握手暴力尝试验证码。启用两步验证前必须先验证一次有效验证码。API 从不返回已生效的密钥，只返回待确认的密钥。
- 对所有改变状态的请求（GET/HEAD/OPTIONS 之外）做 **Origin 校验**：跨源的 `Origin` 会被 403 拒绝。它与 `SameSite=Strict` 互为补充，同时也能保护 `Authorization: Bearer` 路径。
- **限流**在进程内按客户端 IP + 路由执行：管理员登录与初始化 30 次/分钟，提交评论 10 次/分钟，`/api/auth/check` 20 次/分钟，`/api/auth/register` 5 次/分钟，头像上传每 30 秒一次。超限返回 HTTP 429 并带 `Retry-After` 响应头。
- **严格的 CSP**：不使用第三方 CDN，也不允许内联脚本（`script-src 'self'`；`style-src` 之所以包含 `'unsafe-inline'`，仅因为 mdui 会在运行时设置内联 style 属性）。此外还有 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy`、`base-uri 'self'`、`form-action 'self'`、`frame-ancestors 'none'`，并关闭 `X-Powered-By`。
- `isSafeSlug()` 守护所有由 slug 推导出的路径（不允许 `/`、`\`、NUL，不允许以点开头，长度 ≤ 200），备份导入时也一律用校验过的 slug 重建文件名——因此无论是构造 URL 还是构造备份文件，都无法写出内容目录之外。
- 管理员用户名限制为 `[A-Za-z0-9_.-]{1,64}`，密码至少 6 位，初始化时会拒绝一小份已泄露/弱口令列表（`bmy2025`、`admin`、`password` 等）。
- **所有**管理页面以及除 `login`/`setup` 之外的**所有** `/api/admin/*` 路由都需要鉴权（JSON API 用 `requireAdmin`，HTML 页面用 `requireAdminPage`）。旧实现的 `/api/admin/ssr/*` 片段接口完全没有鉴权。

#### 已知限制：访客邮箱验证

在没有 SMTP 服务的情况下，无法证明访客确实拥有其填写的邮箱。因此 `/api/auth/check` 对**任何已获批的邮箱**都会在请求时直接签发访客 Cookie——它验证的是*是否已注册*，而不是*是否拥有该邮箱*。代码在 `src/auth/visitor.ts` 中也注明了这一点。请把访客体系当作轻量权限门（它的存在是为了保护日历），而不是身份认证机制：真正敏感的内容都在管理员登录之后。若需要真正证明邮箱归属，请先接入基于 SMTP 的确认流程，再对不可信用户开放。

---

## 配置

配置分两部分，思路是「Hexo + 十二要素应用」：

| 内容 | 位置 | 是否纳入版本控制 |
|------|------|------------------|
| **站点配置**——名称、副标题、描述、关键词、作者、语言、头像、主题色、导航菜单、功能开关、摘要长度、界面文案 | **`_config.yml`**（仓库根目录） | **是** |
| **部署配置**——端口、监听地址、会话密钥、管理员初始账号、S3 密钥 | **环境变量**（`.env` / `BMY_*`） | 否 |

这样拆分是有意的：前者属于站点内容，应该和代码一起进仓库；后者因机器而异且包含机密，绝不能提交。

### 站点配置 —— `_config.yml`

仓库根目录下唯一一个带注释的配置文件。只写你想改的键即可，其余键自动使用内置默认值，所以文件不完整——甚至不存在——也能正常启动。

```yaml
title: imitoy's Blog          # 站点名称（侧边栏、顶栏、<title>）
subtitle: 暂无简介             # 站点名称下方的一句话简介
description: 一个使用 Node.js 与 Material You 构建的博客   # meta description
keywords: []                  # meta keywords
author: ''                    # meta author
language: zh-CN               # <html lang="…">
url: ''                       # canonical / sitemap / RSS 使用的站点地址

avatar: /img/avatar.jpg
copyright: © 2025 Blog Material You
github: https://github.com/imitoy/Blog
theme:
  color: '#ff006a'            # Material You 配色种子色

menu:                         # 侧边栏 / 导航
  - text: 首页
    icon: /icon/home.svg
    route: /

features:                     # 整块功能的开关
  comments: true
  calendar: true
  search: true
  easterEgg: true
  rss: true
  sitemap: true

excerpt:
  length: 200                 # 首页卡片摘要长度（无封面）
  lengthWithCover: 120        # 首页卡片摘要长度（有封面）
rssLimit: 20

strings: {}                   # 覆盖任意界面文案，例如 {page_posts: 博客文章}
```

- **无需重启**——文件按修改时间缓存，改完下一次请求即生效。
- **功能开关在请求时生效**：关掉 `search`、`rss`、`sitemap`、`easterEgg` 会移除对应路由与界面入口，`calendar: false` 会隐藏状态页的日历卡片。
- **`strings`** 可覆盖内置词典中的任意键（见 `src/site-config.ts` 的 `DEFAULT_STRINGS`）；未覆盖的键保持内置值。
- **可在后台修改**——`/admin/settings/` 会把改动写回本文件。写入是逐行修改并带校验的（先重新解析再原子替换），所以上面的注释会保留，非法值会被拒绝而不是把文件写坏。
- **`theme.color`** 是站点**主题色**，必须是**十六进制**（`#rgb`、`#rrggbb` 或 `#rrggbbaa`）——这是 mdui 配色生成器唯一接受的输入，后台表单也会直接拒绝其他写法，而不是让它在浏览器里静默失败。它既作为 Material You 配色种子，也以 `<meta name="theme-color">` 输出给浏览器界面。
- 配色方案由**服务端**生成（`src/lib/color-scheme.ts`）并内联进每个页面，等价于 mdui 的 `setColorScheme()` 在浏览器里做的事。好处是首次绘制就是正确颜色（不会先闪一下默认紫色），并且在**禁用 JavaScript** 时站点依然保持主题配色。
- **`BMY_CONFIG_FILE`** 可让服务读取另一个配置文件，便于把每套部署的配置放在检出目录之外。
- `url` 是唯一允许被环境变量覆盖的值：显式设置了 **`BMY_SITE_URL`** 时它优先于 `_config.yml`，这样容器无需改动受版本控制的文件就能改指向。
- YAML 写错时会大声报错并回退到默认值，而不是让站点挂掉，便于你先进后台把它修好。

### 个人名片页 —— `profile:` 块

`/profile/` 是独立页面（不使用站点外壳），因此内容单独配置：

```yaml
profile:
  enabled: true               # 该页面唯一的开关
  accent: ''                  # 留空跟随 theme.color；填十六进制则固定
  avatar: /img/avatar.jpg
  greeting: Hi, I am
  name: X-LeeHe
  tagline: 警惕赛博杂食性动物
  background: ''              # 可选背景图，会被 CSS 高斯模糊；留空则用内置夜色渐变
  tags:                       # 每个数组是一行胶囊标签
    - [ArchLinuxUser, Mild DIY enthusiast]
    - [Robotics (idiot), Minecraft, Helldivers 2]
  buttons:                    # 右侧长条
    - { text: Github, icon: github, href: https://github.com/imitoy, action: link }
    - { text: Blog, icon: blog, href: /posts/, action: link }
    - text: More
      icon: more
      action: expand          # expand 显示 ⌄ 并展开面板
      items:
        - { text: 归档, href: /archives/ }
    - { text: Music (From NetEase), icon: music, action: expand, music: true }
  music:
    audio: ''                 # 音频直链 → 原生 <audio> 播放器
    embed: ''                 # 或外链播放器地址（网易云 outchain）→ <iframe>
```

- `action: link` 右侧显示 `›` 并跳转；`action: expand` 右侧显示 `⌄` 并展开面板。
- 图标是内联 SVG，不依赖图标字体或 CDN：`github`（`<>`）、`blog`、`more`（分支）、`music`、`link`、`mail`、`rss`。
- **完全不需要 JavaScript**：面板是 `<details>`（带 `name` 属性，在支持的浏览器里就是原生手风琴）。
- 配置了 `music.embed` 或 `music.audio` 时，只会把该来源加入页面的 CSP `frame-src` / `media-src`，不需要全局放宽策略。
- `accent` 默认跟随站点主题色，所以改 `theme.color` 时本页会一起变。填一个十六进制值（如 `'#4da3ff'`）可把卡片的霓虹圆环、徽章和图标固定成该颜色，不受主题色影响。
- 想让它出现在侧边栏，把它加进 `menu:` 即可——默认刻意不加入。

### 部署配置 —— 环境变量

把 `.env.example` 复制为 `.env`（该文件已 gitignore），或把变量传给 Docker。所有变量都是可选的——默认值已适配本地使用。

### 服务

| 变量 | 默认值 | 含义 |
|------|--------|------|
| `BMY_PORT` | `30999` | HTTP 监听端口 |
| `BMY_HOST` | `0.0.0.0` | 监听地址 |
| `BMY_SITE_URL` | *(空)* | **优先于 `_config.yml` 中的 `url`。** 站点对外地址，例如 `https://blog.example.com`，用于 canonical 链接、`sitemap.xml` 和 `rss.xml`；未设置时这些地址为相对路径 |
| `BMY_TRUST_PROXY` | `0` | 位于反向代理后方时设为 `1`，限流会按 `X-Forwarded-For` 中的真实客户端 IP 计数 |
| `BMY_MAX_UPLOAD_MB` | `100` | JSON / URL-encoded 请求体上限，单位 MB（用于导入备份） |
| `NODE_ENV` | `development` | `production` 会启用 EJS 模板缓存并关闭开发期警告 |

### 管理员账号

| 变量 | 默认值 | 含义 |
|------|--------|------|
| `BMY_ADMIN_USER` | `admin` | 从环境变量初始化时使用的管理员用户名 |
| `BMY_ADMIN_PASS` | *(空)* | 在**尚未创建管理员账号**时，启动即创建账号。它不会覆盖你在后台改过的密码 |
| `BMY_SESSION_SECRET` | *(空)* | 管理员会话 Token 的 HMAC 密钥。为空时会随机生成 32 字节密钥并保存到 `blog/data/secret.json` |
| `BMY_SESSION_TTL` | `604800` | 会话有效期，单位秒（7 天） |

### 目录

| 变量 | 默认值 | 含义 |
|------|--------|------|
| `BMY_BLOG_DIR` | `./blog` | 内容 + 静态资源 + 运行状态的根目录 |
| `BMY_DATA_DIR` | `$BMY_BLOG_DIR/data` | 运行状态（凭据、评论、访客、TOTP、设置、会话、`image-cache/`） |
| `BMY_PUBLIC_DIR` | `$BMY_BLOG_DIR/public` | 静态资源（css/js/icon/img/vendor/avatars/uploads） |
| `BMY_VIEWS_DIR` | `./views` | EJS 模板目录 |
| `BMY_CONFIG_FILE` | `./_config.yml` | 站点配置文件路径（见上文） |

### 图床（S3 / SFTP）

| 变量 | 默认值 | 含义 |
|------|--------|------|
| `BMY_IMGHOST_PROVIDER` | *(空)* | `s3` 或 `sftp`——设置该变量同时会启用图床 |
| `BMY_S3_ENDPOINT` | *(空)* | S3 端点，例如 `http://minio:9000`。四项 S3 凭据齐备时也会自动启用 S3 |
| `BMY_S3_BUCKET` | *(空)* | 存储桶名称 |
| `BMY_S3_ACCESS_KEY` | *(空)* | Access Key |
| `BMY_S3_SECRET_KEY` | *(空)* | Secret Key |
| `BMY_S3_REGION` | *(空)* | 区域（AWS 需要）；为空表示 `us-east-1` |
| `BMY_S3_PREFIX` | *(空)* | 桶内对象前缀（可选） |
| `BMY_S3_PUBLIC_URL_BASE` | *(空)* | 图片公开访问的 URL 基址；默认使用 `$BMY_S3_ENDPOINT/$BMY_S3_BUCKET` |
| `BMY_S3_INSECURE` | `0` | `1` 表示跳过 TLS 证书校验（自签名证书） |
| `BMY_S3_SSL_CA` | *(空)* | 校验 S3 服务端证书所用 CA 的路径（容器内路径） |
| `BMY_S3_SSL_CERT` | *(空)* | **双向 TLS** 的客户端证书路径 |
| `BMY_S3_SSL_KEY` | *(空)* | **双向 TLS** 的客户端私钥路径。双向 TLS 需要证书与私钥合并为一个文件，因此 `BMY_S3_SSL_CERT` 与 `BMY_S3_SSL_KEY` 通常指向同一个 PEM 文件 |

SFTP 没有对应的环境变量，请在 `/admin/imghost/` 页面配置，配置保存在 `blog/data/imghost.json`。环境变量始终优先于存储文件，且不会被回写，因此完全通过环境变量配置的部署在保存设置表单后依然有效。

### 仅用于迁移

以下变量由 `scripts/import-legacy-mariadb.mjs` 读取，服务本身不使用：

| 变量 | 默认值 | 含义 |
|------|--------|------|
| `BMY_DB_URL` | *(空)* | `mariadb://user:pass@host:3306/dbname`——优先于下面各项 |
| `BMY_DB_HOST` / `BMY_DB_PORT` | *(空)* / `3306` | TCP 主机与端口 |
| `BMY_DB_SOCKET` | *(空)* | Unix socket 路径（未设置主机时使用） |
| `BMY_DB_NAME` | `blogyou` | 数据库名 |
| `BMY_DB_USER` / `BMY_DB_PASS` | `blogyou` / `blog-db-pass-2025` | 数据库凭据 |

---

## HTTP API

### 响应结构

除 `/api/health` 外，所有 JSON 接口使用同一套结构：

```json
{ "errno": 0,  "data": { } }
{ "errno": -1, "errmsg": "Post not found: foo" }
```

`errno: 0` 表示成功，数据在 `data` 中；`errno: -1` 表示失败，`errmsg` 是可读的原因。HTTP 状态码同时表达语义（`400` 参数错误、`401` 未认证、`403` 无权限、`404` 不存在、`409` 冲突、`429` 触发限流、`500` 意外错误）。`/api/health` 有意保持简单，供负载均衡使用，返回 200 与 `{"status":"ok","server":"nodejs","version":"2.0.0"}`。字段名统一为 camelCase（重写前的 API 混用 snake_case 与 camelCase，并且 `/api/config` 会泄漏 `session_secret`、`admin_user` 和 `admin_pass`）。

### 公开 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 存活探针（普通对象，不使用响应结构） |
| GET | `/api/site` | 站点设置、导航菜单与完整 UI 文案字典——绝不包含任何凭据信息 |
| GET | `/api/status` | 运行时长、启动时间、Node.js 版本、平台、内存，以及文章/评论/动态/友链/访客数量 |
| GET | `/api/posts` | 活跃（未归档）文章的摘要列表，新的在前，含自动摘要 |
| GET | `/api/posts/:slug` | 单篇文章：元数据、原始 Markdown、服务端渲染的 `html`、`htmlEn` 与 `toc`（不存在则 404） |
| GET | `/api/tags` | 标签索引及文章数，按使用次数倒序 |
| GET | `/api/tags/:name` | 该标签下的文章（包含已归档文章） |
| GET | `/api/categories` | 分类索引及文章数 |
| GET | `/api/categories/:name` | 该分类下的文章（包含已归档文章） |
| GET | `/api/archives` | 已归档文章按年份分组 |
| GET | `/api/pages/:slug` | 单个页面：元数据、原始 Markdown、渲染后的 `html`、`toc`（不存在则 404） |
| GET | `/api/talks` | 全部动态，新的在前，每条带渲染后的 `html` |
| GET | `/api/friends` | 按展示顺序排列的友链 |
| GET | `/api/search?q=<query>&limit=<n>` | 全文搜索。返回 `{query, tokens, total, limit, results}`；每条结果同时给出纯文本 `title`/`snippet` 与已转义的 `titleHtml`/`snippetHtml`（含 `<mark>`）。`q` 为空时返回空结果集而非报错。`limit` 默认 20（上限 50） |
| GET | `/api/comments?path=<url>` | 某页面路径下的评论，旧的在前。加 `&type=count` 只返回 `{count}` |
| POST | `/api/comments` | 提交评论。请求体 `{nick, mail, comment, url, link?, ua?, avatar?}` |
| POST | `/api/auth/check` | `{email}` → `{registered, permissions, name}`；邮箱已注册时同时下发签名访客 Cookie |
| POST | `/api/auth/register` | `{email, name?}` → 提交注册申请，等待管理员审核（已注册或已在队列中返回 409） |
| POST | `/api/auth/logout` | 清除访客 Cookie |
| POST | `/auth/logout` | 身份验证页面使用的 HTML 退出登录（普通表单提交，无需 JavaScript）；清除访客 Cookie 并以 303 跳转回 `/auth/` |
| GET | `/api/calendar` | 日历事件。需要带 `calendar` 权限的访客 Cookie（无 Cookie 返回 401，无权限返回 403） |
| POST | `/api/upload-avatar` | 上传评论头像。支持 multipart（`file`）、JSON `{image}` 或原始 base64 请求体；返回 `{url}`。最大 5 MB，每 30 秒只能上传一次 |

`curl` 示例：

```bash
# 健康检查
curl http://localhost:30999/api/health
# → {"status":"ok","server":"nodejs","version":"2.0.0"}

# 文章摘要列表
curl http://localhost:30999/api/posts

# 单篇文章（服务端渲染结果）
curl http://localhost:30999/api/posts/2025-11-23

# 提交评论
curl -X POST http://localhost:30999/api/comments \
  -H 'Content-Type: application/json' \
  -d '{"nick":"Alice","mail":"alice@example.com","comment":"Nice post!","url":"/post/2025-11-23"}'

# 访客验证（Cookie 存入 jar）
curl -c cookies.txt -X POST http://localhost:30999/api/auth/check \
  -H 'Content-Type: application/json' -d '{"email":"alice@example.com"}'
curl -b cookies.txt http://localhost:30999/api/calendar

# 上传头像
curl -X POST http://localhost:30999/api/upload-avatar -F 'file=@avatar.png'
```

### 管理 API

挂载在 `/api/admin`。除 `POST /login` 与 `GET|POST /setup` 之外，所有路由都要求管理员会话；可以通过 `admin_token` Cookie 或 `Authorization: Bearer <token>` 请求头传递。未认证时返回 `401 {"errno":-1,"errmsg":"Unauthorized"}`。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/admin/login` | `{username, password}` → 会话 + `{token, user}`。启用两步验证时改为返回 `{step:2, tempToken}`，再发送 `{step:2, tempToken, totp}` 完成登录 |
| GET | `/api/admin/setup` | `{setupDone, user}`——是否还需要首次初始化 |
| POST | `/api/admin/setup` | 首次使用 `{action:"init", user, password}`；之后使用 `{action:"change", oldPassword, newPassword, newUser?}` |
| POST | `/api/admin/logout` | 吊销当前 Token 并清除 Cookie |
| GET | `/api/admin/posts` | 全部文章（含已归档），带正文 |
| POST | `/api/admin/posts` | 新建（`{slug, title, titleEn, content, contentEn, date, tags, categories, cover, archived}`） |
| PUT | `/api/admin/posts` | 更新已有文章（请求体同上） |
| PATCH | `/api/admin/posts` | `{slug}` → 切换归档状态，返回 `{slug, archived}` |
| DELETE | `/api/admin/posts?slug=` | 删除文章文件 |
| GET | `/api/admin/pages` | 全部页面 |
| PUT | `/api/admin/pages` | upsert 页面（`{slug, title, titleEn, content, contentEn}`） |
| DELETE | `/api/admin/pages?slug=` | 删除页面文件 |
| GET | `/api/admin/talks` | 全部动态 |
| POST | `/api/admin/talks` | 发布动态（`{content}`） |
| PUT | `/api/admin/talks` | 更新动态（`{id, content}`） |
| DELETE | `/api/admin/talks?id=` | 删除动态 |
| GET | `/api/admin/friends` | 全部友链 |
| POST | `/api/admin/friends` | 添加友链（`{title, url, descr?, titleEn?, descrEn?, avatar?, sortOrder?}`） |
| PUT | `/api/admin/friends` | 更新友链（`{id, …}`） |
| DELETE | `/api/admin/friends?id=` | 删除友链 |
| GET | `/api/admin/comments` | 跨页面的全部评论，新的在前 |
| DELETE | `/api/admin/comments?id=` | 按 id 删除评论 |
| GET | `/api/admin/visitors` | `{visitors, pending, permissions}`——已批准邮箱、待审核队列与权限清单 |
| POST | `/api/admin/visitors` | 新增或更新已批准的访客（`{email, permissions, name?}`） |
| DELETE | `/api/admin/visitors?email=` | 移除已批准的访客 |
| POST | `/api/admin/visitors/approve` | 批准待审核申请并授予权限（`{email, permissions}`） |
| DELETE | `/api/admin/visitors/pending?email=` | 拒绝待审核申请 |
| GET | `/api/admin/totp` | 两步验证状态。`secret`/`provisioningUri` 只可能是**待确认**密钥，永远不会是已生效密钥 |
| POST | `/api/admin/totp` | `{action:"start"}` 生成密钥，`{action:"verify", code}` 确认启用，`{action:"disable"}` 关闭 |
| GET | `/api/admin/imghost` | 图床配置，`secret_key` 以 `********` 掩码返回 |
| PUT | `/api/admin/imghost` | 保存配置（`secret_key` 为空或为掩码时保留原值） |
| POST | `/api/admin/imghost` | `{action:"test"}` 连接测试，或 `{action:"upload", image, filename?, key?}`（base64 图片） |
| GET | `/api/admin/export` | 将整站导出为一个 JSON 文档下载（`blog-backup-YYYYMMDD-HHMMSS.json`） |
| POST | `/api/admin/import` | 恢复备份；请求体为原始 JSON 文档 |
| POST | `/api/admin/reload` | 清空 Markdown 解析缓存并返回最新数量 |

`curl` 示例：

```bash
# 登录并保存会话 Cookie
curl -c admin-cookies.txt -X POST http://localhost:30999/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"your-password"}'
# → {"errno":0,"data":{"token":"…","user":"admin"}}

# 获取全部文章（Cookie 认证）
curl -b admin-cookies.txt http://localhost:30999/api/admin/posts

# ……或使用 Bearer Token
curl -H 'Authorization: Bearer <token>' http://localhost:30999/api/admin/posts

# 新建文章
curl -b admin-cookies.txt -X POST http://localhost:30999/api/admin/posts \
  -H 'Content-Type: application/json' \
  -d '{"slug":"hello-world","title":"Hello World","date":"2025-11-23",
       "tags":"Notes","categories":"Blog","content":"# Hi\n\nFirst post."}'

# 导出备份
curl -b admin-cookies.txt http://localhost:30999/api/admin/export -o backup.json

# 恢复备份
curl -b admin-cookies.txt -X POST http://localhost:30999/api/admin/import \
  -H 'Content-Type: application/json' --data-binary @backup.json

# 退出登录（服务端真正吊销 Token）
curl -b admin-cookies.txt -X POST http://localhost:30999/api/admin/logout
```

> Origin 校验会拒绝携带不匹配 `Origin` 请求头的状态变更请求。`curl` 不发送该头，因此没有问题；浏览器端需要同源调用这些 API。

---

## 从旧的 MariaDB 版本迁移

重写保留了内容的磁盘格式约定，因此已有部署可以用一个脚本完成迁移。该脚本通过 `mariadb`（或 `mysql`）命令行客户端的 `--xml` 输出读取旧表——不需要任何数据库驱动，并且复用应用自身的写入函数，因此输出格式不会与服务端预期产生偏差。

```bash
# 预演：只打印将要写入的内容，不做任何修改
node scripts/import-legacy-mariadb.mjs --dry-run

# 正式迁移
node scripts/import-legacy-mariadb.mjs

# 跳过 config 表（管理员凭据、TOTP 状态、图床配置）
node scripts/import-legacy-mariadb.mjs --skip-config
```

| 参数 | 作用 |
|------|------|
| `--dry-run` | 打印**将要**写入的每篇文章/页面/动态/友链/评论以及汇总，不改动任何文件 |
| `--skip-config` | 不动 `admin_creds`、`totp_state`、`imghost_config`（适用于想保留新服务自身配置的场景） |

连接信息来自上文的[仅用于迁移](#仅用于迁移)环境变量。

### 迁移内容

| 来源（MariaDB） | 目标 |
|------------------|------|
| `posts` | `blog/posts/<slug>.md`，frontmatter 含 `title`、`date`、`tags`、`categories`、`cover`、`archived`、`title_en`、`content_en` |
| `pages` + `page_content` | `blog/pages/<slug>.md`；`page_content` 中的英文正文会合并进 `content_en` |
| `talks` | `blog/talks/<id>.md`，frontmatter 含 `id` / `create_time` |
| `friends` | `blog/friends/<id>-<slug>.md`，含 `sort_order` |
| `comments` | `blog/data/comments/<key>.json`，每个页面 URL 一个文件 |
| `emails`、`pending_registrations` | `blog/data/visitors.json`（带权限的已批准邮箱 + 待审核队列） |
| `calendar_events` | `blog/data/calendar.json` |
| `config`：`admin_creds` | `blog/data/admin.json`——**原样复制** |
| `config`：`totp_state` | `blog/data/totp.json` |
| `config`：`imghost_config` | `blog/data/imghost.json` |

不存在的表会被直接跳过，因此不完整的旧安装同样可以迁移。建议先执行 `--dry-run`，把汇总结果与旧数据库核对一遍。

### 管理员密码会被保留

`admin_creds` 中存放的是旧版 AES-256-CBC 校验值，会被原样复制过去。`src/store/credentials.ts` 能识别这种格式，旧的密码依然可以登录，并会在**首次成功登录时自动重新哈希为 scrypt**（日志输出 `[credentials] legacy password record upgraded to scrypt`），无需重置任何内容。

如果旧密码因故无法登录，请执行 `npm run passwd-reset -- --clear`，然后重新走一遍 `/admin/setup/` 创建新账号。原凭据会先备份到同目录下，误操作可以找回。

> 旧访客数据也会自动导入：第一次读取 `blog/data/visitors.json` 时，若存在旧的 `blog/data/auth/emails.json` 和 `blog/data/auth/pending.json`，其内容会被合并进来。

---

## 备份与恢复

管理后台的**数据备份**页面（`/admin/backup/`）会把整站导出为**一个 JSON 文档**——与旧实现相同的"单文件"约定，只是分节改为对应磁盘布局而非 SQL 表。

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

- `content.posts` / `content.pages` 保留**原始 frontmatter 与正文**，因此未知的 frontmatter 字段也能完整往返。`content.friends` 只丢弃内部使用的绝对文件路径。
- `data.comments`、`data.visitors`、`data.site`、`data.calendar` 分别覆盖评论、访客注册表与审核队列、站点设置（含 UI 文案覆盖）以及日历事件。

> ⚠️ **备份文件属于机密。** `data.admin` 含管理员密码校验值（scrypt 盐 + 哈希），`data.totp` 含 TOTP 共享密钥，`data.imghost` 含 S3/SFTP 凭据（包括 Secret Key）。不要提交到仓库，不要以未鉴权方式提供下载，不再需要时请及时删除。导出下载本身需要鉴权，但你保存下来的文件此后并不受保护。
>
> `src/lib/backup.ts` 中的 `importBackup()` 支持 `{includeCredentials: false}`，可只恢复内容而保留凭据、TOTP 密钥和图床密钥不动。管理后台执行的始终是完整恢复。

**导入是破坏性的**，与旧版导入一致：请求体中出现的分节会替换现有数据，未出现的分节保持不动。文章、页面、动态、友链与评论会先清空再重写；TOTP、凭据与图床设置在该分节存在时会被覆盖。个别格式错误的条目会被跳过并记录警告，而不会中断整个恢复过程；所有文件名都由校验过的 slug 重建，因此构造的备份文件无法写到内容目录之外。

通过管理页面恢复：打开 `/admin/backup/`，先下载导出文件，再上传该文件进行恢复。通过 API：

```bash
# 导出
curl -b admin-cookies.txt http://localhost:30999/api/admin/export -o backup.json

# 导入（会一并恢复凭据）
curl -b admin-cookies.txt -X POST http://localhost:30999/api/admin/import \
  -H 'Content-Type: application/json' --data-binary @backup.json
# → {"errno":0,"data":{"summary":{"posts":12,"pages":3,…}}}
```

由于备份会恢复凭据与 TOTP 密钥，导入一份**启用两步验证之前**的备份会把两步验证重新关闭——在线上恢复前请先备份当前的 TOTP 密钥。

---

## 部署

### Docker

镜像是单个自包含容器：基于 `node:24-alpine`，用 `npm ci --omit=dev` 安装依赖，构建时执行 `scripts/sync-assets.mjs`，没有数据库服务、没有 nginx、没有 Python、也不需要编译器。容器以非特权 `node` 用户运行，暴露 `30999`，并声明了每 30 秒请求一次 `/api/health` 的 `HEALTHCHECK`。

```bash
docker compose up -d --build
docker compose logs -f blog
```

镜像会把 `_config.yml` 的属主改成 `node`，以便后台设置页能写回配置。如果你想在容器外管理配置，可以把它以只读方式挂载进去——此时保存会给出明确报错，而不是静默失败。

### 数据卷布局

`blog/` 中的内容需要区别对待：

| 路径 | 性质 | 建议的卷 |
|------|------|----------|
| `blog/posts`、`blog/pages`、`blog/talks`、`blog/friends` | **内容**——建议纳入版本管理、定期备份，并可从宿主机编辑 | 各目录单独 bind mount |
| `blog/data` | **运行状态**——凭据、评论、访客、TOTP、设置、会话 | 命名卷（必须持久化；丢失会同时丢失管理员账号与全部评论） |
| `blog/public/avatars`、`blog/public/uploads` | 上传的媒体文件 | bind mount 或卷 |
| `blog/public/vendor` | 构建/启动时由 `node_modules` 生成 | **不要**用卷覆盖它 |

```yaml
services:
  blog:
    build: .
    ports:
      - "8000:30999"
    volumes:
      - blog_data:/app/blog/data          # 运行状态 —— 命名卷
      - ./blog/posts:/app/blog/posts      # 内容 —— bind mount
      - ./blog/pages:/app/blog/pages
      - ./blog/talks:/app/blog/talks
      - ./blog/friends:/app/blog/friends
      - ./blog/public/avatars:/app/blog/public/avatars
    restart: unless-stopped
volumes:
  blog_data:
```

### 放在 TLS 反向代理之后

用 nginx/Caddy/Traefik 在前面提供 HTTPS（应用本身只在单个端口上使用明文 HTTP）：

1. 在 `_config.yml` 中设置 **`url`**（或设置 **`BMY_SITE_URL`** 环境变量）为对外的 `https://` 地址，否则 canonical 链接、`sitemap.xml` 与 `rss.xml` 都会使用相对地址。
2. 设置 **`BMY_TRUST_PROXY=1`**，让 Express 信任 `X-Forwarded-For`，限流将按真实客户端 IP 而非代理 IP 计数。若不设置，一个滥用者就可能耗尽所有人的限额。
3. 转发 `Host` 与 `X-Forwarded-Proto`，并允许至少与 `BMY_MAX_UPLOAD_MB` 相当的请求体大小。
4. **Cookie 的 `Secure` 标记：**会话 Cookie 与访客 Cookie 都设置了 `HttpOnly` 以及 `SameSite=Strict`/`Lax`，但**没有**设置 `Secure`——在明文 HTTP 下 `Secure` Cookie 永远不会被发送，因此代码选择关闭它。如果你在代理处终止 TLS 并希望加上该标记，请在 `setSessionCookie()`（`src/auth/session.ts`）和 `setVisitorCookie()`（`src/auth/visitor.ts`）中加上 `secure: true`，并确保应用只通过 HTTPS 访问。在此之前，请不要让应用以明文 HTTP 直接暴露在公网。

### 横向扩展

应用的进程内缓存（Markdown 解析与 JSON 存储）都会在文件变化时重新读取，因此可以针对共享内容运行多个实例，但有两点需要注意：

- **限流是按进程计算的。** 每个实例独立计数，N 个实例意味着允许 N 倍于配置的速率。多实例部署应在代理层设置真正的限制（nginx 的 `limit_req`），进程内限流仅作为纵深防御。
- **会话保存在内存中。** Token 用 `BMY_SESSION_SECRET` 签名，因此请在每个实例上显式设置为同一个随机值；进程内的吊销表与两步登录临时 Token 并不共享，这意味着在一个实例上退出登录不会立刻让另一个实例上的 Token 失效（吊销纪元只在单个进程内提升）。如果这一点对你很重要，请把管理后台流量固定到单个实例，或缩短 `BMY_SESSION_TTL`。
- 内容与 `blog/data` 必须位于每个实例都能访问的共享存储（挂载卷）上；使用 S3 图床可以保证上传的媒体在各实例间一致。

### 运维

- **找回管理员密码**——执行 `npm run passwd-reset`。密码只以「单向校验值」形式保存（scrypt，或旧版 AES 记录），**无法从 `blog/data/admin.json` 读回原文，只能替换**。该命令离线运行，使用与服务完全相同的数据目录：

  ```bash
  npm run passwd-reset                        # 交互式设置新密码
  npm run passwd-reset -- --clear             # 删除账号，之后用 /admin/setup/ 重新创建
  npm run passwd-reset -- --password '…' --user admin
  npm run passwd-reset -- --clear --keep-totp # 保留两步验证（默认会关闭）
  # Docker 内：
  docker compose exec blog npm run passwd-reset -- --clear
  ```

  `--clear` 默认会**同时关闭两步验证**，否则新建的账号登录时仍会要求旧验证器上的动态码。改动前会把原凭据文件复制为 `blog/data/admin.json.bak-<时间戳>`（权限 `0600`）。
- **重置两步验证**——删除 `totp` 分节（或 `blog/data/totp.json`），登录会恢复为仅密码。
- **健康检查**——`GET /api/health` 用于存活探测，`GET /api/status` 提供内容数量与进程指标；`/status/` 页面展示同样的数据。
- **更新内容**——直接复制 `.md` 文件即可，缓存基于 mtime，无需重启。

---

## 技术栈

| 层次 | 技术 | 版本 | 许可 |
|------|------|------|------|
| 运行时 | Node.js（要求 ≥ 22.18；Docker 镜像使用 24） | 22.18+ / 24 | MIT |
| 语言 | TypeScript，由 Node 直接执行（类型擦除，无构建步骤） | 5.9.3 | Apache-2.0 |
| HTTP 框架 | Express | 5.2.1 | MIT |
| 模板引擎 | EJS（服务端渲染） | 3.1.10 | Apache-2.0 |
| 前端 UI | MDUI 2（Material Design 3 Web Components），本地内置 | 2.1.5 | MIT |
| Markdown | markdown-it（+ markdown-it-anchor 生成标题锚点） | 14.3.2 | MIT |
| 代码高亮 | highlight.js（服务端渲染） | 11.12.0 | BSD-3-Clause |
| 数学公式 | KaTeX（+ @vscode/markdown-it-katex） | 0.16.47 | MIT |
| Frontmatter 解析 | gray-matter（js-yaml），并提供容错解析回退 | 4.0.3 | MIT |
| 图片处理 | sharp（512×512 WebP 头像） | 0.33.5 | Apache-2.0 |
| 对象存储 | @aws-sdk/client-s3（S3 / MinIO / R2，支持双向 TLS） | 3.1142.0 | Apache-2.0 |
| SFTP | ssh2-sftp-client | 12.1.1 | Apache-2.0 |
| 上传 | multer（内存存储，10 MB 上限） | 2.4.0 | MIT |
| Cookie | cookie-parser | 1.4.7 | MIT |
| 配置 | dotenv | 16.6.1 | BSD-2-Clause |
| 密码哈希 / TOTP / 会话 | Node.js 内置 `node:crypto`（scrypt、HMAC-SHA256，旧版校验用 AES-256-CBC） | — | MIT (Node.js) |

版本为撰写时 `package.json` / `package-lock.json` 中实际解析到的版本；在声明的 semver 范围内，`npm outdated` 可能会提示更新的版本。

## 开源致谢

本项目建立在众多开源项目之上，在此向它们的作者与贡献者致谢。下表列出项目、许可与链接。

### 运行时与框架

| 项目 | 许可 | 链接 |
|------|------|------|
| Node.js | MIT | [nodejs.org](https://nodejs.org) |
| TypeScript | Apache-2.0 | [typescriptlang.org](https://www.typescriptlang.org) |
| Express | MIT | [expressjs.com](https://expressjs.com) |
| EJS | Apache-2.0 | [ejs.co](https://ejs.co) |

### 前端

| 项目 | 许可 | 链接 |
|------|------|------|
| MDUI 2（Material Design 3 Web Components） | MIT | [mdui.org](https://www.mdui.org) |
| KaTeX | MIT | [katex.org](https://katex.org) |
| highlight.js | BSD-3-Clause | [highlightjs.org](https://highlightjs.org) |
| markdown-it | MIT | [markdown-it.github.io](https://markdown-it.github.io) |

### 存储、媒体与服务

| 项目 | 许可 | 链接 |
|------|------|------|
| sharp | Apache-2.0 | [sharp.pixelplumbing.com](https://sharp.pixelplumbing.com) |
| AWS SDK for JavaScript v3 | Apache-2.0 | [aws.amazon.com/sdk-for-javascript](https://aws.amazon.com/sdk-for-javascript/) |
| ssh2-sftp-client | Apache-2.0 | [github.com/theophilusx/ssh2-sftp-client](https://github.com/theophilusx/ssh2-sftp-client) |
| gray-matter | MIT | [github.com/jonschlinkert/gray-matter](https://github.com/jonschlinkert/gray-matter) |
| multer | MIT | [github.com/expressjs/multer](https://github.com/expressjs/multer) |
| cookie-parser | MIT | [github.com/expressjs/cookie-parser](https://github.com/expressjs/cookie-parser) |
| dotenv | BSD-2-Clause | [github.com/motdotla/dotenv](https://github.com/motdotla/dotenv) |
| markdown-it-anchor | Unlicense | [github.com/valeriangalliat/markdown-it-anchor](https://github.com/valeriangalliat/markdown-it-anchor) |

各项目的版权声明与完整许可文本请以对应仓库中的文件为准。

## 许可

本项目采用 **MIT 许可**。所使用开源组件的许可请见上文的致谢部分。

---

*用 ❤️ 构建，基于 Node.js + TypeScript、MDUI 2 以及更多优秀的开源工具。*
