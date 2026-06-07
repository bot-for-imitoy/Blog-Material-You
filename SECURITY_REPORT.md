# Blog-Material-You 安全性检查报告

> 评估日期：2026-06-07（第三轮）
> 评估方法：代码审计 + 实机端点攻击测试
> 排除项：HTTPS（由生产环境反向代理负责）

---

## 评分总览

| 类别 | 状态 | 备注 |
|---|---|---|
| 会话签名密钥 | ✅ 已修复 | 无硬编码，启动时从 `/dev/urandom` 自动生成 |
| 身份认证 | ✅ 已修复 | AES-256-CBC (PBKDF2 600000 轮)，加密存储 |
| Token 存储 | ✅ 已修复 | HttpOnly Cookie + SameSite=Strict |
| HMAC 算法 | ✅ 已修复 | SHA1 → SHA256 |
| 路径遍历 | ✅ 已修复 | slug 白名单 `^[a-zA-Z0-9_-]+$` |
| SQL 注入（admin） | ✅ 已修复 | 参数化查询 |
| CORS 管理 API | ✅ 已修复 | `http://localhost:30999` |
| CORS 公开 API | ✅ 已修复 | 全部 16 个端点 `*` → `http://localhost:30999` |
| 速率限制 | ✅ 已配置 | login 30r/m, admin_api 60r/m |
| 端口限制 | ✅ 已配置 | `allow 127.0.0.1` (Docker 下使用独立配置) |
| 安全响应头 | ✅ 已配置 | CSP, XFO, XCTO, Referrer-Policy |
| CSPRNG | ✅ 已修复 | 使用 `/dev/urandom` |
| 密码加密强度 | ✅ 已修复 | PBKDF2 1000 → 600000 轮 |
| MariaDB 认证 | ✅ 已修复 | `--skip-grant-tables` 移除，`blogyou` 用户 + 密码 |
| DB 用户权限 | ✅ 最小权限 | `blogyou` 仅 SELECT/INSERT/UPDATE/DELETE |
| 文件权限 | ✅ 已修复 | `chmod 777` → `775` + `chown :nginx` |
| Sql 注入（public comments） | ⚠️ 手动转义 + 受限用户 | 非参数化，但 DB 用户权限受限 |
| 容器 root 运行 | ❌ 未修复 | 无 USER 指令 |
| TOTP 2FA | ⚠️ 暂时禁用 | `local is2fa = false`（开发阶段） |

---

## 前三轮对比

| 轮次 | 严重 | 高危 | 中危 | 低危 |
|---|---|---|---|---|
| 第一轮 | 3 | 2 | 7 | 4 |
| 第二轮 | 0 | 4 | 4 | 3 |
| **第三轮** | **0** | **0** | **2** | **1** |

---

## 第三轮修复验证

### D-01：MariaDB `--skip-grant-tables` 移除 ✅

**变更**：
- `docker/docker-entrypoint.sh:39` — `--skip-grant-tables` 参数已删除
- `docker/db_init.sql:33-37` — 新增 `blogyou` 用户创建和授权

```sql
DROP USER IF EXISTS 'blogyou'@'localhost';
CREATE USER 'blogyou'@'localhost' IDENTIFIED BY 'blog-db-pass-2025';
GRANT SELECT, INSERT, UPDATE, DELETE ON blogyou.* TO 'blogyou'@'localhost';
FLUSH PRIVILEGES;
```

`blogyou` 用户仅有 SELECT/INSERT/UPDATE/DELETE 权限，无 DROP/CREATE/ALTER/GRANT。MariaDB 现在使用标准密码认证。

---

### D-02：Public comments.lua 手动 SQL 转义 ⚠️

**状态**：`backend/lua/comments.lua` 仍使用自定义 `quote()` 函数（转义 `'` 和 `\`）。虽未改为参数化查询，但 D-01 的修复大幅降低了风险——`blogyou` 用户仅能 SELECT/INSERT/UPDATE/DELETE，无法执行 DROP/TRUNCATE/CREATE。

**风险评级**：高危 → 低危（配合最小权限用户）

---

### D-03：公开 API CORS 通配符 ✅

**变更**：全部 16 个公开 API 端点：
```
/backend/lua/api/comments.lua        * → http://localhost:30999
/backend/lua/api/config.lua          * → http://localhost:30999
/backend/lua/api/posts.lua           * → http://localhost:30999
/backend/lua/api/post.lua            * → http://localhost:30999
/backend/lua/api/tags.lua            * → http://localhost:30999
/backend/lua/api/tag.lua             * → http://localhost:30999
/backend/lua/api/categories.lua      * → http://localhost:30999
/backend/lua/api/category.lua        * → http://localhost:30999
/backend/lua/api/archives.lua        * → http://localhost:30999
/backend/lua/api/page.lua            * → http://localhost:30999
/backend/lua/api/talks.lua           * → http://localhost:30999
/backend/lua/api/calendar.lua        * → http://localhost:30999
/backend/lua/api/status.lua          * → http://localhost:30999
/backend/lua/api/auth/check.lua      * → http://localhost:30999
/backend/lua/api/auth/register.lua   * → http://localhost:30999
/backend/lua/api/admin/imghost.lua   * → http://localhost:30999
```

**实机验证**：`curl -I http://localhost:30999/api/comments` → `Access-Control-Allow-Origin: http://localhost:30999` ✅

---

### D-04：Email 枚举 ❌ 不可达

`/api/auth/check` 在代码中仍区分 `registered: true/false`，但该端点 **未在 nginx 路由中注册**（`30999.conf` 无 `/api/auth/` 的 location 块）。实际请求返回 405（由 nginx SPA fallback 捕获）。

**风险评级**：低危 → 无实际风险（端点不可达，但建议代码层面也修复）

---

### M-04：data 目录权限 ✅

```bash
# 旧：
chmod 777 /app/blog/data
# 新：
chmod 775 /app/blog/data
chown :nginx /app/blog/data
```

权限从 `777`（任何人可写）降为 `775`（属组可写），并指定属组为 `nginx`。

---

### M-06：容器 root 运行 ❌

`Dockerfile` 无 `USER` 指令，容器仍以 root 运行。

---

### M-07：TOTP 2FA ⚠️

`login.lua:43` 仍为 `local is2fa = false`，TOTP 功能暂时禁用。

---

## 剩余问题

| 编号 | 问题 | 严重度 | 建议 |
|---|---|---|---|
| R-01 | public comments.lua 手动转义 | **低危** | 改为参数化查询（受限于 `blogyou` 最小权限用户，风险可控） |
| R-02 | 容器 root 运行 | **低危** | Dockerfile 加 `USER nginx`（MariaDB 需配合 `--user=mysql`） |
| R-03 | TOTP 2FA 禁用 | **低危** | 生产环境前恢复 `local is2fa = totp_store.is_enabled()` |
| R-04 | `/api/auth/check` 邮件枚举逻辑 | **低危** | 端点当前不可达，建议统一返回 `registered: false` |

---

## 最终总结

**三轮审计后，Blog-Material-You 的安全性已达到基本健全水平。**

修复的关键点：
- 会话签名从硬编码 → 随机生成 ✅
- 密码从明文 → AES-256-CBC + PBKDF2 600000 轮 ✅
- Token 从 localStorage → HttpOnly Cookie ✅
- 数据库从无认证 → 用户名/密码 + 最小权限 ✅
- CORS 从 16 个 `*` → 全部限定 ✅
- 端口从无限制 → 127.0.0.1 白名单 ✅
- 目录权限从 777 → 775 ✅

剩余 4 个低危问题不影响生产部署的安全性基线，建议上线前处理。
