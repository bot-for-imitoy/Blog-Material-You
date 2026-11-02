---
title: 你好，世界
date: '2026-01-01'
tags:
  - 示例
categories:
  - 开始
title_en: Hello, World
content_en: |
  This is the example post that ships with the repository.

  Delete it (or archive it with `archived: true`) and start writing your own
  posts: drop a `<slug>.md` file into `blog/posts/` and give it the same
  frontmatter shape.
---

这是随仓库附带的示例文章，用来演示文章文件的完整结构。

# 标题与元信息

文件名就是文章的 slug（如 `hello-world.md` → `/post/hello-world/`）。frontmatter 支持的字段：

- `title`：标题（必填）
- `date`：发布日期（必填），首页与归档按它排序
- `tags` / `categories`：标签与分类，数组形式，可多级
- `cover`：封面图地址（可选）
- `archived`：设为 `true` 可归档文章（仍可访问，不进列表）
- `title_en` / `content_en`：可选的英文标题与正文（配合 `language` 做双语）

# 正文

正文就是普通 Markdown，支持代码高亮、表格、数学公式（KaTeX）等：

```python
def hello(name: str) -> str:
    return f"Hello, {name}!"
```

写好自己的文章后，删除本文件即可。
