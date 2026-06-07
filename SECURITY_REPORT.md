# Blog-Material-You 后台管理安全性检查报告

> 评估日期：2026-06-07
> 评估方法：代码审计 + 实际端点攻击测试
> 排除项：HTTPS（由生产环境 nginx 反向代理负责）

---

## 评分总览

| 类别 | 状态 |
|---|---|
| 身份认证 | ✅ AES-256-CBC 加密存储，无硬编码密码 |
| 路径遍历 | ✅ security.lua slug 白名单过滤 |
| SQL 注入 | ✅ 参数化查询 |
| CORS | ✅ 已限制为 localhost:30999 |
| 端口限制 | ✅ allow 127.0.0.1 / deny all |
| 速率限制 | ✅ limit_req 已配置 |
| 安全头 | ⚠️ 部分已加（XFO, XCTO, Referrer-Policy），缺 CSP |
| Token 签名密钥 | ❌ **仍存在硬编码 fallback** |
| Token 存储 | ⚠️ localStorage |
| 密码加密算法 | ⚠️ AES-256-CBC (PBKDF2 1000 轮) 偏弱 |

---

## 已修复项（相对于初始审计的版本）

以下问题在最新代码中已修复，**不在本次报告范围内**：

| 问题 | 状态 | 说明 |
|---|---|---|
| 硬编码密码 `admin/bmy2025` | ✅ | `admin_store.lua` 使用 AES-256-CBC 加密存储密码在 `blog/data/admin.json`，密码通过 PBKDF2 派生密钥做加解密验证 |
| 路径遍历（slug） | ✅ | `security.lua:valid_slug()` 限制 `^[a-zA-Z0-9_-]+$`，已注入 posts/pages 的 POST/PUT/DELETE |
| SQL 注入 comments.lua | ✅ | 改用参数化查询 `DELETE FROM comments WHERE id = ?` |
| CORS 通配符 `*` | ✅ | 全部改为 `http://localhost:30999` |
| 错误信息泄露路径 | ✅ | `security.lua:safe_error()` 过滤路径信息；API 返回通用错误 |
| TOTP 弱随机数 | ✅ | `totp_setup.lua` 改用 `/dev/urandom`（带 fallback） |
| 端口 31000 无限制 | ✅ | `31000.conf` 配置 `allow 127.0.0.1; deny all;` |
| 无速率限制 | ✅ | `nginx.conf` 配置 `limit_req_zone`，login 限 30r/m，admin_api 限 60r/m |
| 缺少 XFO/XCTO/Referrer-Policy | ✅ | `nginx.conf` 已添加三项安全头（见 L-02） |
| `math.random()` 生成 TOTP secret | ✅ | 改用 `security.random_bytes()`（/dev/urandom） |

---

## 仍然存在的问题

### 🔴 严重

#### S-01：session_secret 硬编码 fallback 可伪造任意 token

**文件** `backend/lua/config.lua:30`

```lua
session_secret = env("BMY_SESSION_SECRET", "bmy-session-secret-k8x9m2p4v6")
```

**风险验证（已实际攻击验证）**：使用已知的 `bmy-session-secret-k8x9m2p4v6` 伪造 token 成功访问全部管理员 API：

```
$ python3 -c "hmac.new(b'...', b'admin:1780815439', hashlib.sha1)..."
→ 伪造 token: YWRtaW46MTc4MDgxNTQzOTpKcW5SMVhJSFhCQzNmS29RSjgxNUlJU20wV1U
→ GET  /api/admin/posts       → HTTP 200 （获取全部文章内容）
→ GET  /api/admin/totp-setup  → HTTP 200 （获取 TOTP secret）
→ GET  /api/admin/comments    → HTTP 500 （DB 未连接，但认证通过）
```

虽然代码支持 `BMY_SESSION_SECRET` 环境变量覆盖，但环境变量未设置时优雅降级为硬编码值。这意味着：
- 任何知道这个字符串的人可以永久伪造管理员 token
- 该密钥在 git 历史中永久存在，无法删除

**原理**：`session.lua` 使用 HMAC-SHA1 签名 token。格式为 `base64(username:timestamp:hmac_sha1(secret, username:timestamp))`。知道 secret 即可构造有效签名。

**修复建议**：首次启动时若无环境变量，自动生成随机密钥并写入文件，不再使用代码中的硬编码 fallback。

---

### 🟠 高危

#### H-01：前端 Bearer token 存于 localStorage

**文件** `blog/public/admin/index.html:115`

```javascript
localStorage.setItem('admin_bearer_token', authToken);
```

**风险**：localStorage 在同源所有 JavaScript 中可访问。若管理面板的任何部分（文章编辑器、评论内容）被注入恶意脚本，token 将被窃取。

**修复建议**：
1. 改用 HttpOnly Cookie 存储 token（后端 `Set-Cookie`）
2. 或设置严格的 CSP 策略防止 XSS
3. 输出文章标题/内容到管理面板时做 HTML 转义

---

#### H-02：缺少 Content-Security-Policy 头

**文件** `backend/conf/nginx.conf:47-50`

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

**风险**：已有三个安全头，但缺 CSP。管理面板从 unpkg CDN 加载 MDUI（`https://unpkg.com/mdui@2`），攻击者可利用 CDN 劫持或注入。

**修复建议**：

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data:; connect-src 'self';" always;
```

---

### 🟡 中危

#### M-01：HMAC-SHA1 用于 token 签名

**文件** `backend/lua/session.lua:39`

```lua
local sig_raw = ngx.hmac_sha1(secret, sig_input)
```

**风险**：SHA-1 已有已知碰撞攻击。虽然 HMAC-SHA1 目前仍可接受，但不推荐。

**修复**：迁移到 `ngx.hmac_sha256`。

---

#### M-02：session 无撤销机制（token 签发后永久有效直到过期）

`session.lua:113-118` 的 `destroy_session` 只是从共享字典删除条目，但 `verify_session` 在字典未命中时会通过签名验证重新缓存（`verify_session:101-107`）。因此即使调用了 logout，只要 token 未过期，签名仍然有效。

**修复**：维护一个黑名单 shared_dict，或让 `destroy_session` 同时记录到期时间强制拒绝。

---

#### M-03：AES-256-CBC PBKDF2 迭代次数偏低

**文件** `backend/lua/admin_store.lua:20`

```lua
local cipher, err = aes:new(password, salt, aes.cipher(256, "cbc"), aes.hash.sha256, 1000, 16)
```

`1000` 次 PBKDF2 迭代是 2000 年代初的标准，当前推荐至少 600000 次（OWASP 2023）。

**修复**：提高到 `600000`，或更换为 argon2id。

---

#### M-04：管理前端 SPA 目录无独立认证

**文件** `backend/conf/sites-available/31000.conf:50-54`

```nginx
location / {
    root  ../blog/public/admin/;
    index index.html;
    try_files $uri /index.html;
}
```

管理前端 SPA 静态文件可在 `/admin/` 路径直接访问（但端口 31000 已限制 localhost）。如果未来开放端口，攻击者可拿到管理面板 HTML 和 JS 源码进行分析。

**建议**：前端认证通过后动态加载 SPA，而不是直接暴露 HTML。

---

### 🔵 低危

#### L-01：`admin_store.lua` salt 使用弱随机数

```lua
local salt = ngx.encode_base64(ngx.hmac_sha1(tostring(os.time()) .. tostring(math.random()), "salt-gen"))
salt = salt:gsub("\n", ""):sub(1, 8)
```

`math.random()` 用于生成加密 salt。应使用 `security.random_bytes(8)`。

---

#### L-02：HSTS 未配置

生产环境使用 HTTPS 反代后，建议添加：

```nginx
add_header Strict-Transport-Security "max-age=63072000" always;
```

---

## 攻击面验证结果

| 攻击向量 | 测试结果 | 详情 |
|---|---|---|
| 无 token 访问管理 API | ✅ 被拦截 — HTTP 401 | 所有 admin API 正确验证 |
| 旧密码 `bmy2025` 登录 | ✅ 被拦截 — HTTP 401 | admin_store 加密存储，旧密码无效 |
| 路径遍历 `slug=../../etc/test` | ✅ 被拦截 — HTTP 400 | security.lua slug 白名单 |
| 伪造 token（已知 session_secret） | ❌ **成功** — HTTP 200 | 获取全部文章、TOTP 配置 |
| 端口 31000 外部访问 | ✅ 被拦截（若外部可达） | `allow 127.0.0.1` 配置 |
| 登录接口暴力破解 | ⚠️ 30r/m 速率限制生效中 | 但限制较宽松 |

---

## 修复优先级

| 优先级 | 问题 | 难度 | 影响 |
|---|---|---|---|
| ★★★★★ | S-01 `session_secret` 硬编码 fallback | 低 | 全量管理权限接管 |
| ★★★★ | H-01 localStorage token → HttpOnly Cookie | 中 | XSS 场景下 token 窃取 |
| ★★★★ | H-02 添加 CSP 头 | 低 | 减轻 XSS 影响 |
| ★★★ | M-01 HMAC-SHA1 → SHA256 | 低 | 长期签名安全 |
| ★★★ | M-03 PBKDF2 迭代数提升 | 低 | 加密强度提升 |
| ★★ | L-01 salt 弱随机数 | 低 | 加密质量 |
| ★ | M-02 token 撤销机制 | 中 | 登出后 token 仍可用 |

---

## 总结

代码相比初始版本已做大量修复。**最致命且唯一能直接接管后台的问题**是 S-01：`session_secret` 硬编码 fallback。攻击者只需知道 `bmy-session-secret-k8x9m2p4v6`（git 历史里永久存在），即可：

1. 伪造任意管理员 Bearer token
2. 读取/修改全部文章、页面、动态
3. 管理 TOTP 设置（可锁定或关闭 2FA）
4. 操作图片上传配置

**最直接修复**：在启动脚本设置环境变量。
```bash
export BMY_SESSION_SECRET=$(openssl rand -hex 32)
```

其他问题属于安全纵深加固，不会导致单点完全沦陷。
