# Blog-Material-You 重构方案

## 目标

消灭前端 JS 中所有"用字符串拼接 HTML"的毒瘤代码，将 HTML 渲染迁移到后端，通过 ETLua (EJS-like) 模板系统由 OpenResty/Lua 统一输出。

## 技术选型

| 选择 | 原因 |
|------|------|
| **etlua** (leafo/etlua) | 与 EJS 语法高度一致，纯 Lua 实现，与 OpenResty 生态兼容，无外部依赖 |
| **SSR Fragment** 模式 | 不推翻 SPA 导航机制（pushState），后端只返回 HTML 片段，前端 fetch 后注入 DOM |
| **统一渲染入口** | `renderer.lua` 负责模板编译、缓存、渲染，所有视图函数调用同一入口 |

## 模板语法对照 (EJS → ETLua)

| 用途 | EJS | ETLua |
|------|-----|-------|
| 输出（转义） | `<%= title %>` | `<%= title %>` |
| 输出（原始 HTML） | `<%- content %>` | `<%- content %>` |
| 条件分支 | `<% if (x) { %>` | `<% if x then %>` |
| 循环 | `<% items.forEach(i => { %>` | `<% for _, i in ipairs(items) do %>` |
| 结束 | `<% } %>` | `<% end %>` |

仅控制流语法不同（Lua vs JavaScript），插值语法完全一致。

## 模板文件目录结构

```
backend/lua/templates/
├── pages/
│   ├── home.etlua           # 首页瀑布流
│   ├── posts_list.etlua     # 文章列表（按年分组）
│   ├── post.etlua           # 单篇文章（含评论区骨架）
│   ├── tags.etlua           # 标签总览
│   ├── tag_posts.etlua      # 某标签下的文章列表
│   ├── categories.etlua     # 分类总览
│   ├── category_posts.etlua # 某分类下的文章列表
│   ├── archives.etlua       # 归档
│   ├── about.etlua          # 关于
│   ├── talks.etlua          # 动态
│   ├── friends.etlua        # 友链
│   ├── status.etlua         # 状态
│   ├── auth.etlua           # 访客认证（含登录/已登录两种状态）
│   └── 404.etlua            # 404
├── admin/
│   ├── layout.etlua         # 后台布局骨架（侧边栏 + 主区域）
│   ├── login.etlua          # 登录（含 TOTP 第二步）
│   ├── setup.etlua          # 初始化管理员
│   ├── dashboard.etlua      # 概览
│   ├── posts_list.etlua     # 文章管理
│   ├── editor.etlua         # 文章编辑器（中英双语字段 + 工具栏）
│   ├── comments_list.etlua  # 评论管理
│   ├── talks_list.etlua     # 动态管理
│   ├── talks_editor.etlua   # 写动态
│   ├── friends_list.etlua   # 友链列表
│   ├── friends_editor.etlua # 添加/编辑友链
│   ├── pages_list.etlua     # 页面管理
│   ├── pages_editor.etlua   # 页面编辑器
│   └── security.etlua       # 安全设置（3 种 TOTP 状态 + 改密码）
└── game/
    └── 2048.etlua           # 2048 游戏（仅 HTML/CSS 骨架）
```

## 后端渲染引擎

### `renderer.lua` — 统一模板渲染入口

```lua
-- 职责：加载 .etlua 模板文件，编译并缓存，用数据填充后返回 HTML 片段
-- 所有视图函数统一调用 renderer:render(template_name, data)
```

### SSR API 端点

新增 `/api/ssr/*` 路由，每个端点对应一个页面类型：

```
GET /api/ssr/                    → render("pages/home", ...)
GET /api/ssr/posts               → render("pages/posts_list", ...)
GET /api/ssr/post/<slug>         → render("pages/post", ...)
GET /api/ssr/tags                → render("pages/tags", ...)
GET /api/ssr/tags/<name>         → render("pages/tag_posts", ...)
GET /api/ssr/categories          → render("pages/categories", ...)
GET /api/ssr/categories/<name>   → render("pages/category_posts", ...)
GET /api/ssr/archives            → render("pages/archives", ...)
GET /api/ssr/about               → render("pages/about", ...)
GET /api/ssr/talks               → render("pages/talks", ...)
GET /api/ssr/friends             → render("pages/friends", ...)
GET /api/ssr/status              → render("pages/status", ...)
GET /api/ssr/auth                → render("pages/auth", ...)
GET /api/ssr/easter-egg          → render("game/2048", ...)

GET /api/admin/ssr/dashboard     → render("admin/dashboard", ...)
GET /api/admin/ssr/posts         → render("admin/posts_list", ...)
GET /api/admin/ssr/editor?slug=  → render("admin/editor", ...)
... 以此类推
```

## 前端 JS 变更

### `blog/public/index.html` — ~1700 行 → ~350 行

**删除**：
- 全部 ~15 个 `render*Page()` 函数（~600 行 HTML 拼接）
- `_EN_FALLBACK` 对象（翻译统一由后端 etlua 模板处理）
- `loadCSS()` / `<style>@import</style>` hack（后端返回自带 `<link>`）

**保留**：
- 导航路由 `navigate()` — 简化成 `fetch('/api/ssr'+path) → container.innerHTML`
- 评论系统（`initComments` / `submitComment` / 头像上传）
- Image placeholder / KaTeX 渲染
- Easter egg 点击计数
- Auth（`doAuth` / `registerAuth` / `isAuthed` / `setAuth`）
- Sidebar 渲染 / 配置加载
- Status 页面补充交互（播放状态轮询）

### `blog/public/admin/index.html` — ~900 行 → ~250 行

**删除**：
- 全部 ~20 个 `render*()` / 页面布局函数（~500 行 HTML 拼接）

**保留**：
- API 调用 + auth 状态管理
- `data-action` 事件总线（savePost / deletePost / doLogin 等）
- TOTP 设置流程
- 改密码表单逻辑

### `blog/public/js/comment.js` — ~230 行 → ~50 行

**删除**：`loadComments()` 中拼接 HTML 的部分
**保留**：表单验证、`submitComment()` 提交逻辑

### 2048 游戏

**模板** → `game/2048.etlua`（纯 HTML/CSS 骨架）
**引擎 JS** → 保留在 `index.html` inline script 中（~180 行），或拆为 `blog/public/js/game-2048.js`

## 实施步骤

1. 安装 etlua（在 OpenResty lualib 或 vendor 目录下）
2. 创建 `backend/lua/renderer.lua`
3. 创建所有 `.etlua` 模板文件（pages/, admin/, game/）
4. 创建 SSR API 端点文件（`backend/lua/api/ssr/`）
5. 在 nginx route 配置中添加 SSR 端点路由
6. 修改 `blog/public/index.html` — 删除 render* 函数，fetch SSR 替代
7. 修改 `blog/public/admin/index.html` — 同上
8. 修改 `blog/public/js/comment.js` — 删除 HTML 拼接
9. 验证：启动服务，逐页面浏览检查渲染正确性

## 回滚方案

所有 SSR 端点与原 JSON API 端点**共存**，不影响现有 JSON API。如果 SSR 片段有问题，前端 JS 的 `navigate()` 可以降级回原来的 `fetch('/api/...') + render*()` 模式。两套渲染路径并行存在，逐个页面切换验证。
