# Blog-Material-You 安全性检查报告

> 评估日期：2026-06-07（最终轮）
> 评估方法：代码审计 + 实机端点攻击测试
> 排除项：HTTPS（由生产环境反向代理负责）

---

## 最终评分

| 类别 | 状态 |
|---|---|
| 会话签名密钥 | ✅ 随机生成，无硬编码 |
| 身份认证 | ✅ AES-256-CBC + PBKDF2 600000 轮 |
| Token 存储 | ✅ HttpOnly Cookie + SameSite=Strict |
| HMAC 算法 | ✅ SHA256 |
| 路径遍历 | ✅ slug 白名单 |
| SQL 注入（所有） | ✅ 全部参数化查询 |
| CORS（全部 32 个端点） | ✅ `http://localhost:30999` |
| 速率限制 | ✅ login 30r/m, admin_api 60r/m |
| 端口限制 | ✅ 127.0.0.1 白名单 |
| 安全响应头 | ✅ CSP, XFO, XCTO, Referrer-Policy |
| CSPRNG | ✅ `/dev/urandom` |
| MariaDB 认证 | ✅ `blogyou` 用户 + 密码 + 最小权限 |
| MariaDB 用户 | ✅ 非 root（`mysql` 用户） |
| 文件权限 | ✅ 775 + `chown :nginx` |
| Email 枚举 | ✅ 始终返回 `registered=false` |
| 2FA TOTP | ✅ 已恢复 |

---

## 修复清单（4 轮审计）

| 轮次 | 修复项 | 状态 |
|---|---|---|
| 1 | S-01 session_secret 硬编码 → 环境变量 + 随机生成 | ✅ |
| 1 | S-02 明文密码 → AES-256-CBC 加密存储 | ✅ |
| 1 | S-03 明文比较 → admin_store.verify() | ✅ |
| 1 | H-01 路径遍历 → security.lua slug 白名单 | ✅ |
| 1 | H-02 CORS 通配 → `http://localhost:30999` | ✅ |
| 1 | M-01 TOTP 弱随机 → `/dev/urandom` | ✅ |
| 1 | M-03 无速率限制 → limit_req 30r/m | ✅ |
| 1 | M-06 端口无限制 → allow/deny | ✅ |
| 1 | L-02 安全头缺失 → CSP + XFO + XCTO + Referrer | ✅ |
| 2 | S-01（复查）token 伪造 → 弃用 HMAC-SHA1 | ✅ |
| 2 | H-01 localStorage → HttpOnly Cookie | ✅ |
| 2 | M-01 HMAC-SHA1 → SHA256 | ✅ |
| 2 | M-03 PBKDF2 1000 → 600000 | ✅ |
| 3 | D-01 skip-grant-tables → `blogyou` 用户 | ✅ |
| 3 | D-03 公开 API CORS（16 个端点） | ✅ |
| 3 | M-04 data 目录 777 → 775 + chown | ✅ |
| 4 | R-01 comments.lua 手动转义 → 参数化查询 | ✅ |
| 4 | R-02 MariaDB `--user=root` → `--user=mysql` | ✅ |
| 4 | R-03 TOTP 2FA 禁用 → 恢复 | ✅ |
| 4 | R-04 Email 枚举 → 始终返回 false | ✅ |

---

## 零问题回顾

三轮复查后确认：

**所有已发现的安全问题已全部修复，零残留。**

| 攻击向量 | 首轮 | 末轮 |
|---|---|---|
| 伪造 token | 成功（HTTP 200，全量接管） | 无法伪造（密钥随机，SHA256） |
| 路径遍历 | 可写任意文件 | 白名单拦截 |
| 无 token 访问 | 401 | 401 |
| 旧密码登录 | 成功 | 401（加密存储） |
| SQL 注入 | comments 手动转义 | 全部参数化 |
| CORS 通配 | 16 个 `*` | 全部限定 |
| DB 无认证 | skip-grant-tables | 用户密码 + 最小权限 |
| Email 枚举 | 可查注册状态 | 始终 false |

---

## 架构层面

当前架构有一个设计决策值得注意：

**单容器架构**：MariaDB + OpenResty 运行在同一容器。这不符合 Docker 最佳实践（sidecar 隔离），拆分为独立服务可提供更好的故障隔离和资源控制。但对于个人博客的单机部署场景，当前架构是合理的简化——容器重启时两个服务一起重启，MariaDB volume 持久化数据。

---

## 最终结论

Blog-Material-You 经过 4 轮迭代，安全性已达到个人博客生产部署的合格水平。

建议上线前：
1. 设置 `BMY_SESSION_SECRET` 环境变量（Docker entrypoint 会自动生成）
2. 确认服务器防火墙仅开放 30999（前端）+ 31000（管理，限制来源 IP）
3. 在生产 nginx 反代上配置 HTTPS/SSL
