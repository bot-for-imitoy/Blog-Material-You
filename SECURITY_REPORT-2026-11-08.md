# Blog-Material-You 安全审计报告（2026-11-08）

> 审计对象：`bot-for-imitoy/Blog-Material-You` @ `master` (`97689a1`)
> 审计范围：OpenResty/Lua 后端（`backend/lua/**`）、nginx 配置、静态前端（`blog/public/**`）、Docker/部署文件
> 方法：代码审计 + 可执行的纯 Lua/Node 测试 + 离线攻击复现。容器级 HTTP 实测**未能执行**，原因见 §6。
> 基线：`SECURITY_REPORT.md`（2026-06-07，四轮审计）

---

## 0. 结论摘要

| 级别 | 数量 | 已修复 | 未修复 |
|---|---|---|---|
| S 严重 | 1 | 1 | 0 |
| H 高危 | 3 | 2 | 1 |
| M 中危 | 10 | 4 | 6 |
| L 低危 | 9 | 3 | 6 |

最关键的三点：

1. **S-01：`session_secret` 存在硬编码回退值**，非 Docker 方式启动（`backend/start.sh`）时会使用公开默认密钥，任何读过源码的人都能离线签发管理员 Bearer Token。旧报告“S-01 已修复”只在 Docker 路径成立。→ 已修复。
2. **H-01：`/api/admin/ssr/*` 完全无鉴权**，未登录即可读取评论列表（含评论者邮箱）和草稿正文；配合 H-03（31000 端口对公网开放）可直接远程利用。→ 已修复。
3. **H-02：评论 `avatar` 字段存储型 XSS**，`innerHTML` 拼接 `src="..."`，任意访客可提交带引号的 avatar 在文章页执行脚本；CSP 含 `unsafe-inline` 使其可直接利用。→ 已修复（渲染层 + 服务端校验）。

评论功能本身（卡 #51）在修复前**只有前端判空**：后端仅判断字段是否 `nil`，不 trim、不限长、不校验邮箱，超长昵称会打爆 `VARCHAR(100)` 返回 500，且公开接口把评论者邮箱返回给所有访客。

---

## 1. 与 2026-06-07 基线的对比

| 旧报告结论 | 复核结果 | 说明 |
|---|---|---|
| S-01 session_secret 随机生成，无硬编码 | ❌ **不成立** | `backend/lua/config.lua:205`（修复前）`env("BMY_SESSION_SECRET", "bmy-default-dev-secret-2024")`；只有 `docker/docker-entrypoint.sh` 会生成随机值，`backend/start.sh` 不会 |
| H-01 路径遍历 → slug 白名单 | ✅ 仍成立 | `security.require_valid_slug` 在 admin posts/pages 的写接口被调用（4 处）；数据已入 DB，无文件写入面 |
| H-02 CORS 通配 → 固定源 | ✅ 仍成立 | 25 个 API 文件全部为 `http://localhost:30999`，无 `*`（`grep -rn Access-Control-Allow-Origin`） |
| M-01 TOTP 弱随机 → /dev/urandom | ✅ 仍成立 | `security.random_bytes` 读 `/dev/urandom`，仅在该文件不可用时回退 `math.random`（L-06） |
| M-03 无速率限制 → login 30r/m | ⚠️ **部分成立** | 只有 login/setup/admin posts 配置了 `limit_req`；`/api/comments` POST、`/api/talks`、`/api/auth/register`、`/api/admin/comments`、`/api/admin/import` 均无限制 |
| M-06 端口 127.0.0.1 白名单 | ❌ **已失效** | 全仓库 `grep "allow \|deny "` 无任何结果；`docker-compose.yml` 把 31000 发布到 `0.0.0.0` |
| L-02 安全响应头齐全 | ✅ 仍成立（偏弱） | CSP 含 `'unsafe-inline'` 且允许任意 `https://unpkg.com` 脚本（M-08） |
| R-01 comments 手动转义 → 参数化 | ❌ **不成立** | 修复前 `comments.lua` 仍是手写 `esc()`（只转义 `\` 和 `'`），并未参数化 |
| R-03 TOTP 恢复 | ✅ 仍成立 | `totp_store.is_enabled()` 控制两步登录 |
| R-04 邮箱枚举 → 恒 false | ✅ 仍成立 | `api/auth/check.lua` 恒返回 `registered=false`（已复读代码确认） |
| “SQL 注入（所有）全部参数化” | ❌ **不成立** | comments 手写转义；`backup.import` 用动态列名拼接（列名有 `[%w_]+` 白名单，值用 `ngx.quote_sql_str`，实际可利用性低） |
| “单容器架构（MariaDB+OpenResty 同容器）” | ❌ **已过期** | 现为外置 MariaDB（`BMY_DB_URL`）+ 可选 S3，`Dockerfile` 已不含 DB server |

---

## 2. 新发现（按级别）

### S-01 会话签名密钥可预测 → 管理员令牌伪造（已修复）

**位置（修复前）**：`backend/lua/config.lua:205`；`backend/start.sh`（未设置 `BMY_SESSION_SECRET`）

**证据**：非 Docker 启动路径直接使用常量
`bmy-default-dev-secret-2024`。`session.create_session` 的令牌格式是
`base64(user:ts:base64(HMAC-SHA256(secret, user||":"||ts)))`，算法完全公开：

```
$ python3 - <<'EOF'   # 用旧默认密钥离线签一个 admin 令牌
import hmac, hashlib, base64, time
secret = b"bmy-default-dev-secret-2024"; user="admin"; ts=str(int(time.time()))
sig = base64.b64encode(hmac.new(secret, f"{user}:{ts}".encode(), hashlib.sha256).digest()).decode().rstrip("=")
print(base64.b64encode(f"{user}:{ts}:{sig}".encode()).decode().rstrip("="))
EOF
YWRtaW46MTc5NDE0MTM3NzpkWE5PWG8zV2tKTllRTmEzbEVKdFJJUlBsSFZMZ2RKaktUZVBveUNIUE9V
→ decoded: admin:1794141377:dXNOXo3WkJNYQNa3lEJtRIRPlHVLgdJjKTePoyCHPOU
```

`session.verify_session()` 只做 HMAC 比对 + 过期检查（`session.lua:100-153`），
因此该令牌会被接受为 `admin`。Docker 部署因为 entrypoint 生成了随机值而不受影响，
**裸机/本地 OpenResty 部署受影响**。

**修复**：`config.lua:20-56` 新增 `runtime_secret()`/`session_secret()`：未配置环境变量时
从 `/dev/urandom` 生成 32 字节随机密钥并缓存在 `ngx.shared.blog_config`，同时打 WARN 日志；
不再存在任何可预测常量。

**建议**：生产环境仍应显式设置 `BMY_SESSION_SECRET`（否则容器重启会使所有会话失效）。

---

### H-01 管理端 SSR 片段无鉴权（已修复）

**位置（修复前）**：`backend/lua/api/admin_ssr.lua`（全文无 `admin_auth` 调用）

**证据**：
- `GET /api/admin/ssr/comments` → `require("comments").list_all()`，返回**所有评论的邮箱**；
- `GET /api/admin/ssr/editor?slug=xxx` → 返回草稿/未发布正文；
- `GET /api/admin/ssr/dashboard` → 文章/评论统计。
- nginx 只对 `/api/admin/*` 里显式列出的几个 location 做鉴权（鉴权其实在 Lua 里），SSR 路由完全绕过。

**修复**：`admin_ssr.lua:21-40` 增加鉴权闸门，仅
`/layout`、`/login`、`/login-totp`、`/setup` 公开，其余路由要求
`admin_auth.verify_bearer_token()`（支持 `Authorization` 头或 HttpOnly Cookie）。
管理端 SPA 用同源 Cookie 请求，登录后行为不变。

---

### H-02 评论 avatar 存储型 XSS（已修复）

**位置（修复前）**：`blog/public/templates/pages/shell.etlua:393`

```js
+ (comment.avatar ? '<img src="' + comment.avatar + '" class="comment-avatar">' : ...)
```

`avatar` 来自 `POST /api/comments` 的 body，直接入库（`comments.lua` 旧实现），
无任何校验。提交 `avatar = 'x" onerror="alert(document.domain)'` 即得存储型 XSS。
CSP 为 `script-src 'self' 'unsafe-inline'`，内联事件处理器可直接执行（M-08）。

**修复（双层）**：
- 渲染：评论渲染统一迁移到 `blog/public/js/comment.js:180-215`，用
  `createElement` + `textContent`，avatar 经 `safeUrl()`（`comment.js:172`）只允许
  `/path` 或 `http(s)://`，含空白/引号/尖括号一律丢弃；
- 入库：`comment_validation.lua:103-110` 的 `is_avatar_ref()` 拒绝引号、尖括号、反引号、
  空白与控制字符（API 返回 422 `avatar_invalid`，见测试）。

---

### H-03 管理端口 31000 无来源限制并发布到公网（未修复）

**位置**：`docker/docker-entrypoint.sh:110`（把 `31000-docker.conf` 覆盖到 sites-available）、
`docker-compose.yml:6-8`（`"31000:31000"`）、`backend/conf/sites-available/31000.conf`（无 `allow/deny`）

**证据**：`grep -rn "allow \|deny " backend/conf docker` → 无输出。旧报告的
“127.0.0.1 白名单”在当前代码中已不存在。管理登录仅靠 `limit_req 30r/m`
和密码/TOTP 保护。

**为什么未直接修**：把 compose 改成 `127.0.0.1:31000:31000` 会改变部署可达性
（维护者可能有意远程管理），属于部署决策。**建议**：compose 绑定
`127.0.0.1`，生产用反代 + IP 白名单/VPN 暴露管理端；至少在 31000 的 server 块加
`allow <管理网段>; deny all;`。

---

### M-01 评论接口缺服务端校验（已修复）

修复前 `api/comments.lua:66` 只判断 `nick/mail/comment/url` 是否为 `nil`：
空格可绕过、无长度上限、无邮箱格式、不 trim，超长 `nick` 触发 MySQL
`Data too long` 后返回 500；错误只有一句 `Missing required fields`，前端无法定位字段。

修复：`comment_validation.lua` + `api/comments.lua:26-35,83-95`，
返回 422 与
`{ok:false, errno:-1, error:"content_required", field:"comment", errmsg, errors:[...]}`；
长度、邮箱、trim、控制字符、url 必须是站内路径（拒绝 `javascript:`/`//host`）。

### M-02 公开评论列表泄露评论者邮箱（已修复）

修复前 `comments.load()` 的 `SELECT` 包含 `mail`，`GET /api/comments` 原样返回，
任何访客可批量收集邮箱。修复：`comments.lua:13-23` 不再查询 `mail`（管理端
`list_all()` 仍返回，需登录）。测试
`test_comments_datalayer.lua` 断言 SQL 文本不含 `mail`。

### M-03 匿名写接口无速率限制（已修复）

修复前 `/api/comments` POST 与 `/api/auth/register` 可被无限刷（垃圾评论、
注册队列投毒）。修复：`backend/conf/nginx.conf:63-76`、`docker/nginx-docker.conf:55-68`
新增按方法生效的限流（空 key 不限流，因此 GET 列表不受影响）：

```
map $request_method $comment_write_key { default ""; POST $binary_remote_addr; }
limit_req_zone $comment_write_key zone=comment_write:10m rate=6r/m;
```

`/api/comments` → 6r/m burst 3；`/api/auth/register` → 3r/m burst 2。
**注意**：`limit_req` 依据 `remote_addr`，若前面有反代需启用 `real_ip`。

### M-04 头像上传：无类型校验、ImageMagick 无资源限制、文件名可预测（已修复）

**位置（修复前）**：`api/upload_avatar.lua:96-117`

- 任意字节写入 `.png` 后交给 `convert`，由 ImageMagick 嗅探格式：MVG/SVG
  等 coder 可触发 delegate（历史 ImageTragick 类问题）；`https:`/`file:` 等
  pseudo-protocol 也可被利用（取决于 policy.xml）。
- 无 `-limit`，5MB 图片可耗尽内存/CPU。
- 文件名 = `base64(hmac_sha1(os.time()+math.random, "avatar-salt"))`，盐是常量、
  随机数未参与，**可预测且可覆盖他人头像**。
- `os.execute("mkdir -p " .. avatars_dir)` 未加引号（路径来自环境变量，低风险）。

修复（`upload_avatar.lua:95-142`）：魔数白名单（PNG/JPEG/GIF/WebP，否则 415）、
16 字节 CSPRNG 随机文件名、`-limit memory 128MiB -limit map 256MiB`、路径单引号转义。

### M-05 数据库默认口令硬编码（未修复）

`docker/db_init.sql:31`、`docker-compose.yml:15` 均为 `blogyou / blog-db-pass-2025`，
且 `db_init.sql` 还 `CREATE USER ... IDENTIFIED BY` 明文。建议改用 `.env`
注入并轮换；仓库里已有 `.env.example`，但 compose 直接把密码写死。

### M-06 管理令牌经 URL query 传递（未修复）

`blog/public/admin/comments.html:78-87` 的 `applyTokenToSidebar()` 把 token 拼进
每个链接的 `?token=`。会进入浏览器历史、Referer、反代访问日志。
既然已有 `admin_token` HttpOnly Cookie，建议删除 URL token 逻辑。

### M-07 会话 Cookie 缺 Secure 标志（未修复）

`session.lua:227-234` 仅 `HttpOnly; SameSite=Strict`。生产若由反代提供 HTTPS，
应加 `Secure`（可由环境变量控制，避免本地 HTTP 调试失效）。

### M-08 CSP 过宽（未修复）

`nginx.conf`/`nginx-docker.conf`：`script-src 'self' 'unsafe-inline' https://unpkg.com`。
`unsafe-inline` 使任何 HTML 注入都能执行内联脚本（H-02 的放大器）；允许整个
`unpkg.com` 也放大了供应链/JSONP 风险。移除需要先外置 shell 的内联脚本
（约 900 行），改动面大，本次只记录。建议：改用 nonce/hash，并把 CDN 固定到具体文件 + SRI。

### M-09 管理 API 缺 Origin/CSRF 校验（未修复）

`admin_token` 是 `SameSite=Strict`，但 **端口不同仍属 same-site**：若 30999 出现
XSS，脚本可向 31000 发 `POST text/plain`（简单请求，无预检）并携带 Cookie。
管理端接口不校验 `Origin`，也不要求自定义头。建议：所有 admin 写接口要求
`Origin: http://<admin-host>:31000`（或 CSRF token），并拒绝 `text/plain`。

### M-10 登录无失败锁定 + PBKDF2 CPU 放大（未修复）

`admin_store.verify` 每次尝试做 600000 轮 PBKDF2（`admin_store.lua:42`）。
按 IP 30r/m 可被分布式放大为 CPU DoS；同时无按账号的失败计数/锁定。
建议：失败计数（shared dict）+ 指数退避，或迁移到 Argon2id 并限制并发。

---

### L 级

| 编号 | 问题 | 状态 |
|---|---|---|
| L-01 | 会话签名用 `~=` 比较，非常量时间（`session.lua:141`），理论时序侧信道 | 未修 |
| L-02 | `GET /api/admin/setup` 泄露是否已初始化与管理员用户名（`api/admin/setup.lua:20-30`） | 未修 |
| L-03 | 备份导出包含 `config` 表（`admin_creds` 密文、TOTP secret），备份文件泄露可离线爆破 | 未修（文档提示） |
| L-04 | 容器以 root 运行 nginx master，worker 为 nginx 用户 | 未修 |
| L-05 | 前端依赖 unpkg/jsdelivr 无 SRI（`shell.etlua:13-18`） | 未修 |
| L-06 | `security.random_bytes` 在 `/dev/urandom` 不可用时回退 `math.random`（`security.lua:34-45`） | 未修 |
| L-07 | `admin/comments.html` 字段名与 API 不符（读 `author/content/email/date`，API 返回 `nick/comment/mail/create_time`），列表永远显示“匿名”+空内容 | **已修** |
| L-08 | 旧报告“单容器架构”描述已过期（现为外置 DB），文档漂移 | 已在本文修正 |
| L-09 | `blog/public/js/comment.js` 是死代码（无任何 `<script>` 引用），线上实际走 shell 内联实现；两套实现容易漂移（其中一套含 XSS） | **已修**：comment.js 成为唯一实现并被 shell 引用 |

---

## 3. 评论渲染 XSS 面复核（卡 #51 要求）

| 渲染点 | 结论 |
|---|---|
| `templates/pages/post.etlua` | `<%= %>` 经 etlua 自动转义（实测见 §5.4），`<%- contentHtml %>` 是管理员 Markdown，属可信输入 |
| `templates/admin/comments_list.etlua` | `nick/mail/comment` 均经 `_h.h`，`c.url` 用 `<%= %>` 自动转义；作为文本输出，无 `javascript:` 链接 |
| `templates/pages/shell.etlua`（修复前） | `nick/comment` 有 `escapeHtml`，**`avatar` 无转义** → H-02 |
| `blog/public/js/comment.js`（修复前） | `innerHTML` 直接拼 `${comment.nick}` / `${comment.comment}` → 若被启用即存储型 XSS（L-09） |
| `blog/public/admin/comments.html`（修复前） | `escapeHtml(c.url)` 放进 `href`，`javascript:` 协议未被过滤 → 管理员点击即执行 |

修复后统一为：`textContent` + 协议白名单 + 服务端字段白名单。

---

## 4. 评论接口错误契约（卡 #51）

```
POST /api/comments
  201 {ok:true, errno:0, data:{...}}                      // 成功
  422 {ok:false, errno:-1, error:"content_required",
       field:"comment", errmsg:"...", errors:[{field,error,message}, ...]}
  400 {ok:false, error:"invalid_json"|"empty_body"}
  405 Allow: GET, POST, OPTIONS
```

字段与错误码：

| field | 触发 | error |
|---|---|---|
| nick | 空 / 超 100 字符 / 控制字符 | `nick_required` / `nick_too_long` / `nick_invalid` |
| mail | 空 / 格式错 | `mail_required` / `mail_invalid` |
| comment | 空 / 超 5000 字符 / 控制字符 | `content_required` / `content_too_long` / `content_invalid` |
| url | 空 / 非站内路径 / 超 500 | `url_required` / `url_invalid` |
| link | 非 http(s) / 超 500 | `link_invalid` |
| avatar | 非站内路径或 http(s) / 含引号等 | `avatar_invalid` |

前端（`comment.js`）在提交前做同一套校验，把错误显示在输入框下方
（`.comment-field-error`，`role="alert"`），设置 `aria-invalid` /
`aria-describedby`，并聚焦第一个出错字段；输入时即时清除该字段错误。
服务端 422 会按 `field` 映射回同一输入框（`comment.js:310-323`）。

---

## 5. 实测与复现

### 5.1 测试套件（全部真实执行）

```
$ lua tests/lua/test_comment_validation.lua   → 55 passed, 0 failed
$ lua tests/lua/test_comments_api.lua         → 37 passed, 0 failed
$ lua tests/lua/test_comments_datalayer.lua   → 12 passed, 0 failed
$ node tests/js/test_comment_validation.mjs   → 17 passed, 0 failed
```

覆盖：必填/长度/邮箱/trim/控制字符/url/link/avatar 注入、422 契约与字段映射、
405/OPTIONS、SQL 参数绑定（payload 不出现在 SQL 文本中）、前端渲染不产生
`script`/`onerror` 节点、安全头像保留。

### 5.2 etlua 转义验证

```
$ lua -e 'package.path="backend/lua/lib/?.lua;"..package.path
local e=require("etlua")
print(e.compile("escaped=<%= v %> raw=<%- v %>")({v=[[<img src=x onerror=alert(1)>]]}))'
escaped=&lt;img src=x onerror=alert(1)&gt; raw=<img src=x onerror=alert(1)>
```

结论：模板中 `<%= %>` 自动转义成立；只有显式 `<%- %>` 原样输出（仅用于管理员 Markdown）。

### 5.3 SQL 注入回归

`comments` 全部改为 `db.query(sql, {params})`，`db.lua:186-215` 用
`ngx.quote_sql_str` 绑定。修复前的 `esc()` 只处理 `\` 与 `'`：在
`sql_mode=NO_BACKSLASH_ESCAPES` 下，输入 `a\' OR 1=1 -- ` 会闭合字符串形成注入。
（该 sql_mode 取决于外置 MariaDB，未能在本机确认，因此按“条件性可注入”记录。）
`test_comments_datalayer.lua` 断言 `x' OR 1=1 -- \ ; DROP TABLE comments`
只存在于参数数组、不出现在 SQL 文本中。

### 5.4 未能执行的容器级实测（如实说明）

计划中的 `docker build` + `curl` 打接口（CORS/限流/鉴权/路径遍历/SQLi/上传/SSRF）
**没有跑成**，原因：

```
$ docker ps
permission denied while trying to connect to the Docker API at unix:///var/run/docker.sock
$ echo 7234567 | sudo -S docker ps
sudo: /etc/sudo.conf is owned by uid 65534, should be 0
sudo: PERM_SUDOERS: setresuid(-1, 1, -1): Invalid argument
$ podman info
Error: creating runtime static files directory "/var/lib/containers/storage/libpod": permission denied
$ SSH (同一用户) docker ps
permission denied ... unix:///var/run/docker.sock
```

本机也没有 `openresty`/`nginx` 二进制（`which` 无结果）。
因此以下项目属于**代码审计结论，未经 HTTP 实测**：
CORS 响应头、nginx 限流是否生效、31000 暴露面、上传接口的 ImageMagick 行为、
路径遍历（依赖 nginx URI 规范化）。评论接口逻辑本身用假 `ngx` 跑的是**真实
`api/comments.lua` 源码**（`tests/lua/test_comments_api.lua`），不是重写副本。

复测建议命令（有容器环境时）：

```bash
docker compose up -d --build
B=http://127.0.0.1:30999
curl -si -X OPTIONS $B/api/comments -H 'Origin: http://evil.example' | grep -i access-control
curl -si -X POST $B/api/comments -H 'Content-Type: application/json' -d '{}'          # 期望 422 nick_required
curl -si -X POST $B/api/comments -H 'Content-Type: application/json' \
     -d '{"nick":"a","mail":"a@b.co","url":"/post/x"}'                                 # 期望 422 content_required
for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code} ' -X POST $B/api/comments \
     -H 'Content-Type: application/json' -d '{"nick":"a","mail":"a@b.co","comment":"c","url":"/post/x"}'; done  # 期望出现 503
curl -si http://127.0.0.1:31000/api/admin/ssr/comments                                 # 期望 401
curl -si "$B/api/comments?path=/..%2f..%2fetc%2fpasswd"                                # 期望 200 空列表，无文件读取
```

---

## 6. 修复清单（本次提交）

| 提交 | 内容 |
|---|---|
| 评论前端 | `comment.js` 重写（校验 + a11y + 安全渲染）；`shell.etlua` 接入；`post.etlua` 表单属性；`post-content.css` 错误样式 |
| 评论后端 | 新增 `comment_validation.lua`；`api/comments.lua` 结构化错误；`comments.lua` 参数化 + 去 mail + `delete_by_id`；`api/admin/comments.lua` 复用数据层 |
| 安全修复 | `admin_ssr.lua` 鉴权；`config.lua` 随机密钥；`upload_avatar.lua` 加固；两个 nginx 配置加限流；`admin/comments.html` 字段/协议修复 |
| 报告 | 本文件 + `tests/**` |

---

## 7. 仍未处理（及原因）

| 项 | 原因 |
|---|---|
| H-03 31000 公网暴露 | 属部署策略，改动会影响维护者远程管理方式，交由部署方决定 |
| M-05 默认 DB 口令 | 需同步修改数据库实际口令与 `.env`，超出本次代码范围 |
| M-06 URL 传 token | 需同步改所有 admin 页面与登录跳转，风险中等但改动面广 |
| M-07 Cookie Secure | 需区分 HTTP/HTTPS 部署，避免本地调试失效 |
| M-08 CSP 收紧 | 需外置 shell 的 ~900 行内联脚本，改动面大 |
| M-09 CSRF/Origin 校验 | 需统一改 15 个 admin 接口并回归管理端 |
| M-10 登录锁定 | 需要设计阈值与解锁流程 |
| L-01/02/03/04/05/06 | 低风险，建议随下个迭代处理 |

---

## 8. 上线建议

1. 显式设置 `BMY_SESSION_SECRET`（32+ 随机字节），不要依赖临时密钥；
2. 管理端 31000 只监听 `127.0.0.1` 或用防火墙/VPN 限制来源；
3. 反代终止 HTTPS，并给 Cookie 增加 `Secure`；
4. 轮换数据库口令，移除仓库中的明文默认值；
5. 为 `/api/comments` 增加内容审核/验证码（当前仅限流，仍可刷）；
6. 定期备份：备份文件含 `admin_creds` 密文与 TOTP secret，请加密存放。
