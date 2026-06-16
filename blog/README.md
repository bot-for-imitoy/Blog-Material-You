# Blog Material You — Standalone Blog

基于 [MDUI 2](https://www.mdui.org/zh-cn/docs/2/) (Material Design 3) 的独立博客前端。

**后端由 OpenResty + MariaDB 驱动**，详情见 [DEPLOY.md](https://github.com/imitoy/blog-backend/blob/main/DEPLOY.md)

## 快速导航

| 链接 | 说明 |
|------|------|
| `http://localhost:30999/` | 博客首页 |
| `http://localhost:30999/admin/` | 管理后台 |
| `http://localhost:30999/api/health` | 健康检查 |

## 前端框架

- **MDUI 2** — Material Design 3 Web Components
- **SPA 架构** — 客户端路由 (pushState)，无刷新导航
- **客户端 Markdown 渲染** — 支持代码块、表格、引用等
- **瀑布流布局** — 首页文章卡片瀑布流

## 添加文章

在 `posts/` 目录下创建 `.md` 文件：

```markdown
---
title: 文章标题
date: 2025-01-01
tags: [tech, javascript]
categories: [编程]
cover: /img/cover.jpg
---

正文 Markdown...
```

## 后端部署

后端部署文档见 [`blog-backend/DEPLOY.md`](../blog-backend/DEPLOY.md)
