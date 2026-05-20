# Blog Material You

一个基于 **OpenResty + MariaDB** 后端和 **MDUI 2 (Material Design 3)** 前端的独立博客系统。

## 项目结构

```
Blog/
├── backend/         # OpenResty + Lua 后端 API 服务
│   ├── conf/        # Nginx 配置
│   ├── lua/         # Lua 业务逻辑（文章、评论、动态、认证等）
│   ├── DEPLOY.md    # 部署文档
│   ├── start.sh     # 启动脚本
│   └── stop.sh      # 停止脚本
├── blog/            # MDUI 2 SPA 前端
│   ├── posts/       # Markdown 文章源文件
│   ├── pages/       # 静态页面
│   ├── public/      # 入口 HTML 与静态资源
│   └── data/        # 运行时数据（MySQL 等）
└── README.md        # 本文件
```

## 快速开始

1. 按照 [`backend/DEPLOY.md`](backend/DEPLOY.md) 配置后端环境
2. 启动 OpenResty 服务
3. 访问 `http://localhost:30999/` 查看博客
4. 访问 `http://localhost:30999/admin/` 进入管理后台

## 技术栈

| 层 | 技术 |
|------|--------|
| 后端 | OpenResty (nginx + LuaJIT) |
| 数据库 | MariaDB |
| 前端 | MDUI 2 Web Components、SPA 架构 |
| 渲染 | 客户端 Markdown 渲染、瀑布流布局 |

## 关于

本项目由 **Hermes-bot AI (DeepSeek)** 生成和维护。
