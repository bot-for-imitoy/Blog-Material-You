# Blog-Material-You 后台管理安全性检查报告

> 评估日期：2026-06-07
> 评估范围：管理员后端 API（端口 31000）、认证机制、会话管理
> 排除项：HTTPS（由生产环境 nginx 反向代理负责，到时加载 SSL 证书）

---

## 严重

### S-01：硬编码管理员凭据

**文件** `backend/lua/config.lua:15-16`

```lua
admin_user = "admin"
admin_pass = "bmy2025"
```

**风险**：密码 `bmy2025` 明文硬编码在源码中，提交到 git 仓库。任何能访问仓库的人都知道管理员密码。config.lua 也不是 .gitignore 的文件。

**修复建议**：
1. 从环境变量读取凭据：`os.getenv("BMY_ADMIN_PASS")`，无环境变量时拒绝启动
2. 或从外部 `.env` 文件加载，并加入 `.gitignore`

---

### S-02：HMAC 会话签名密钥硬编码

**文件** `backend/lua/config.lua:25`

```lua
session_secret = "bmy-session-secret-k8x9m2p4v6"
```

**风险**：Bearer token 的 HMAC-SHA1 签名密钥是固定字符串。知道密钥的人可以伪造任意用户的 token。token 格式为 `base64(username:timestamp:hmac_sha1)`，构造过程完全可复现。

**修复建议**：与凭据一样从环境变量读取，首次启动时自动生成随机值并提示保存。

---

### S-03：密码明文比较

**文件** `backend/lua/api/admin/login.lua:37`

```lua
if data.username ~= cfg.admin_user or data.password ~= cfg.admin_pass then
```

**风险**：密码没有任何哈希（无 bcrypt/PBKDF2/argon2）。用户数据库（如果未来扩展或用 MySQL 存储用户）泄露即所有密码明文暴露。

**修复建议**：
1. 存储 bcrypt 哈希，验证时用 `bcrypt.compare(password, hash)`
2. 或者用 OpenResty 调用 `openssl dgst` 做 PBKDF2，但推荐使用 `lua-resty-bcrypt`

---

## 高危

### H-01：路径遍历——文章管理 API

**文件** `backend/lua/api/admin/posts.lua:68`

```lua
local filepath = POSTS_DIR .. "/" .. slug .. ".md"
local f, err = io.open(filepath, "w")
```

**风险**：`slug` 未做任何过滤。已认证的管理员可以传入 `../../etc/cron.d/malicious` 实现任意文件写入，结合 crontab 可实现远程命令执行。DELETE（`os.remove`）同理。

同样的问题出现在 `pages.lua:57`、`talks.lua`（需确认）。

**修复建议**：

```lua
-- 拒绝含路径遍历的 slug
if slug:match("%.%.") then
    ngx.status = 400
    ngx.say(cjson.encode({ errno = -1, errmsg = "Invalid slug" }))
    return
end
-- 或只允许白名单字符
if not slug:match("^[a-zA-Z0-9_-]+$") then
    ngx.status = 400
    ...
end
```

---

### H-02：CORS 通配符

**文件** 所有 admin API（`login.lua:16`, `posts.lua:7`, `comments.lua:6` 等）

```lua
ngx.header["Access-Control-Allow-Origin"] = "*"
```

**风险**：管理 API 来自信任来源有限（同一台机器或 nginx 反代），不需要 CORS 通配。虽然 Bearer token 不由浏览器自动附加（不像 cookie），但如果同机其他服务存在 XSS，可以读取管理 API 数据。

**修复建议**：
- 开发环境：`Access-Control-Allow-Origin: http://localhost:30999`
- 生产环境：设置为实际域名
- 或直接移除 CORS 头（管理 API 不应被浏览器跨域调用）

---

## 中危

### M-01：TOTP 密钥使用弱随机数生成

**文件** `backend/lua/api/admin/totp_setup.lua:65-66`

```lua
local raw = ngx.encode_base64(
    ngx.hmac_sha1(tostring(os.time()) .. tostring(math.random()), "totp-gen")
)
```

**风险**：
- `math.random()` 是 LCG（线性同余）伪随机数生成器，未显式设置种子（默认种子可能为 1）
- 即使 seed 了 `math.randomseed(os.time())`，`os.time()` 精度为秒，穷举空间仅 86400/秒
- 攻击者可预测接下来生成的 TOTP secret，替换管理员绑定的 2FA 密钥

**修复建议**：

```lua
-- 使用 OpenSSL 提供的 CSPRNG
local f = io.open("/dev/urandom", "rb")
local random_bytes = f:read(10)
f:close()
local secret = ngx.encode_base64(random_bytes)
-- 或 ngx.random_bytes()（OpenResty 1.19+）
```

同时验证 2FA 启用前要求用户输入当前 TOTP 码（已有此流程，好）。

---

### M-02：Token 存储于 localStorage

**文件** `blog/public/admin/index.html:115`

```javascript
localStorage.setItem('admin_bearer_token', authToken);
```

**风险**：localStorage 在同源下所有 JavaScript 都可访问。如果管理面板（或文章中 WYSIWYG 编辑器）存在 XSS，攻击者可窃取 token。

**修复建议**：
- 使用 HttpOnly cookie 存储 token（由后端 set-cookie），前端只读
- 或确保管理面板所有用户输入（文章内容、标题、slug 等）输出时做 HTML 转义
- 生产环境设置 CSP：`Content-Security-Policy: script-src 'self' 'nonce-xxxx'`

---

### M-03：无登录频率限制

**文件** `backend/lua/api/admin/login.lua`

**风险**：登录接口无速率限制、无失败计数、无帐号临时锁定。配合 6 位 TOTP（±1 时间窗口，每次验证相当于检查 3/10^6 空间），攻击者可以持续暴力尝试。

**修复建议**：

在 nginx 级别限制：

```nginx
# nginx.conf 中 server 31000 块内
limit_req_zone $binary_remote_addr zone=admin_login:10m rate=3r/m;

location = /api/admin/login {
    limit_req zone=admin_login burst=1 nodelay;
    content_by_lua_file lua/api/admin/login.lua;
}
```

或 Lua 层计数：失败 5 次后锁定 IP 15 分钟（用 `lua_shared_dict`）。

---

### M-04：Basic Auth 兜底认证

**文件** `backend/lua/admin_auth.lua:71-72`

```lua
-- Fall back to Basic auth (legacy)
user = _M.verify_basic_auth()
```

**风险**：如果 Bearer token 验证失败，自动降级到 Basic Auth。Basic Auth 的密码是 `base64(user:pass)`，非加密，中间人可解码。这让攻击者多了一个攻击面。

**修复建议**：考虑移除 Basic Auth 降级逻辑，只保留 Bearer token。或者在生产环境中通过配置禁用降级。

---

### M-05：HMAC-SHA1 用于 token 签名

**文件** `backend/lua/session.lua:39`

```lua
local sig_raw = ngx.hmac_sha1(secret, sig_input)
```

**风险**：SHA-1 已被学术界证明存在碰撞攻击（SHAttered、SHAMBLES）。虽然 HMAC-SHA1 目前仍被认为安全，但已不推荐。

**修复建议**：迁移到 `ngx.hmac_sha256(secret, sig_input)`，并更新 `TOKEN_TIMEOUT` 为合理值（当前 1 小时，建议缩短到 30 分钟）。

---

### M-06：管理端口未限制来源 IP

**文件** `backend/conf/nginx.conf:128-169`

```
server {
    listen       31000;
    ...
}
```

**风险**：如果部署机器有公网 IP 且防火墙未封 31000，管理 API 直接面向互联网。OpenResty 没有配置 `allow/deny` 限制。

**修复建议**：

```nginx
server {
    listen 31000;
    allow 127.0.0.1;
    allow ::1;
    deny all;
    ...
}
```

这样只有本地服务和反向代理能访问管理端口。

---

### M-07：TOTP JSON 文件路径暴露风险

**文件** `blog/data/totp.json`

```json
{"enabled":true,"secret":"TCIRRMFGFLIFEXNA3GXS","pending_secret":null}
```

**风险**：TOTP secret 以明文存储在 JSON 文件中。当前 `blog/data/` 在 web 根目录 `blog/public/` 之外，不可通过浏览器直接访问。但若将来配置变更导致 data 目录可访问，secret 会泄露。

**修复建议**：确保 `blog/data/` 永远在 web 根目录之外。考虑将敏感数据存储在 `backend/data/` 下，减少误暴露风险。

---

## 低危

### L-01：详细错误信息泄露内部路径

多处 API 返回含路径的错误信息：

- `login.lua:45`：`"Internal error: " .. (err or "")`
- `posts.lua:71`：`"Failed to write: " .. (err or "")`

可能泄漏 OpenResty 目录结构，有助于攻击者侦察。

**建议**：生产环境返回通用错误信息，将详细日志写入 error.log。

---

### L-02：缺少安全响应头

所有 API 响应缺少以下头部：

| 头 | 用途 |
|---|---|
| `Content-Security-Policy` | 防止 XSS 和数据注入 |
| `X-Content-Type-Options: nosniff` | 防止 MIME 嗅探 |
| `X-Frame-Options: DENY` | 防止点击劫持 |
| `Referrer-Policy: strict-origin-when-cross-origin` | 控制 referrer 泄漏 |

**建议**：在 nginx server 块添加：

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https:; connect-src 'self';" always;
```

---

### L-03：comments 删除 SQL 查询非参数化

**文件** `backend/lua/api/admin/comments.lua:65`

```lua
local res, err = db:query("DELETE FROM comments WHERE id = " .. id)
```

虽然 `tonumber(ngx.var.arg_id)` 的验证使得此处实际无注入风险，但字符串拼接的模式是脆弱编码习惯，后续维护可能引入问题。

**建议**：使用参数化查询：

```lua
local res, err = db:query("DELETE FROM comments WHERE id = ?", id)
```

（`lua-resty-mysql` 支持 `query` 的第二个参数传入绑定变量）

---

### L-04：imghost 配置返回 SSH 密钥路径

**文件** `backend/lua/api/admin/imghost.lua:29-31`

注释写着"Mask sensitive data"但实际代码只是不加星号返回了路径字符串。路径信息有助于攻击者了解服务器文件结构。

**建议**：返回路径时只返回文件名，不返回完整路径，或在前端显示时截断路径。

---

## 修复优先级矩阵

| 编号 | 问题 | 严重度 | 利用难度 | 影响 | 优先级 |
|---|---|---|---|---|---|
| S-01 | 硬编码凭据 | 严重 | 低 | 全量接管 | ★★★★★ |
| S-02 | 硬编码签名密钥 | 严重 | 低 | 全量接管 | ★★★★★ |
| S-03 | 明文密码 | 严重 | 低 | 凭据泄露 | ★★★★★ |
| H-01 | 路径遍历 | 高危 | 中（需认证） | RCE | ★★★★ |
| H-02 | CORS 通配 | 高危 | 中 | 数据泄露 | ★★★★ |
| M-01 | 弱随机数 | 中危 | 中 | 2FA 绕过 | ★★★ |
| M-03 | 无速率限制 | 中危 | 高 | 暴力破解 | ★★★ |
| M-06 | 端口无限制 | 中危 | 低（网络可达时） | 全网暴露 | ★★★ |
| M-02 | localStorage token | 中危 | 高（需 XSS） | token 窃取 | ★★ |
| M-04 | Basic Auth 兜底 | 中危 | 中 | 额外攻击面 | ★★ |
| M-05 | SHA1 签名 | 中危 | 高 | 碰撞攻击 | ★ |
| 其余低危 | — | 低危 | — | — | ★ |

---

## 补充说明

- **HTTPS**：已排除在本报告之外。生产部署时 nginx 反代会终止 TLS，到 OpenResty 后端可使用内部 HTTP。
- **前端静态资源**：管理面板的 MDUI 样式和脚本从 unpkg CDN 加载（`https://unpkg.com/mdui@2`），CDN 被攻陷或不可用时会影响管理面板。
- **本报告仅覆盖后端管理 API 和认证机制**，不涵盖博客前端 XSS/CSRF、MariaDB 安全配置、主机安全等范围。
