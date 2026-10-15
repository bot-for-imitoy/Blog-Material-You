# blog/ — 内容与运行状态目录

这是博客的「数据库」：所有内容都是带 YAML frontmatter 的 Markdown 文件，
所有运行状态都是 JSON 文件。没有 MariaDB，也没有外部依赖。
项目的完整文档见 [仓库根目录的 README.zh.md](../README.zh.md)（英文版 [README.md](../README.md)）。

## 目录一览

| 路径 | 内容 | 是否 gitignore |
|------|------|----------------|
| `posts/` | 文章（`<slug>.md`），frontmatter 写 title/date/tags/categories/cover 等 | 是（仅跟踪 `.gitkeep`） |
| `pages/` | 页面（如 `about.md`） | 是（同上） |
| `talks/` | 动态（`<unixtime>.md`） | 是（同上） |
| `friends/` | 友链（`<id>-<slug>.md`） | 是（同上） |
| `data/` | 运行状态：管理员凭据、会话、评论、访客、日历、图床配置、访问计数等 JSON | 是 |
| `public/` | 静态资源：`css/`、`js/`、`icon/`、`img/`；`vendor/` 由 `npm run assets` 生成 | `vendor/`、`avatars/`、`uploads/` 是 |

## 快速添加一篇文章

在 `posts/` 下新建 `<slug>.md`（文件名即 URL 中的 slug）：

```markdown
---
title: 文章标题
date: 2025-01-01
tags: [tech, javascript]
categories: [编程]
cover: /img/cover.jpg
---

正文 Markdown（服务端渲染，支持代码高亮、KaTeX 公式）。
```

保存后刷新即可，内容缓存按文件 mtime 自动失效，无需重启服务。
各类型的完整 frontmatter 说明见主 README 的「内容编写」章节。

## 注意

- `data/` 是运行时状态（含凭据），**不要**提交到版本库，也不要公开分享。
- 本目录的旧 README 描述的是已被替换的 OpenResty + MariaDB 架构，已于 2026-10 重写为当前内容。
