-- /api/admin/setup — first-run admin setup and password change
--
-- GET  → check if setup is done
-- POST { action: "init", user, password } → initial setup
-- POST { action: "change", old_password, new_password, new_user? } → change password/username
local cjson = require("cjson")
local admin_store = require("admin_store")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

if ngx.req.get_method() == "OPTIONS" then
    ngx.status = 204
    return
end

if ngx.req.get_method() == "GET" then
    local done = admin_store.is_setup_done()
    ngx.say(cjson.encode({
        errno = 0,
        data = {
            setup_done = done,
            user = done and admin_store.get_user() or cjson.null
        }
    }))
    return
end

-- POST: handle actions
ngx.req.read_body()
local body = ngx.req.get_body_data()
local ok, data = pcall(cjson.decode, body or "{}")
if not ok or not data then
    ngx.say(cjson.encode({ errno = -1, errmsg = "Invalid JSON" }))
    return
end

local action = data.action or ""

if action == "init" then
    -- First-run setup
    if admin_store.is_setup_done() then
        ngx.say(cjson.encode({ errno = -1, errmsg = "管理员已初始化，不可重复设置" }))
        return
    end
    local user = data.user
    local password = data.password
    if not user or user == "" or not password or password == "" then
        ngx.say(cjson.encode({ errno = -1, errmsg = "用户名和密码不能为空" }))
        return
    end
    if #password < 6 then
        ngx.say(cjson.encode({ errno = -1, errmsg = "密码长度不少于6位" }))
        return
    end
    -- Reject common/weak passwords leaked from git history
    local weak_passwords = {["bmy2025"]=true, ["admin"]=true, ["password"]=true, ["123456"]=true, ["admin123"]=true, ["12345678"]=true, ["qwerty"]=true}
    if weak_passwords[password:lower()] then
        ngx.say(cjson.encode({ errno = -1, errmsg = "密码过于简单，请使用更安全的密码" }))
        return
    end
    local entry = admin_store.encrypt(user, password)
    if not entry then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "加密失败" }))
        return
    end
    local ok2, err2 = admin_store.write(entry)
    if not ok2 then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "写入失败: " .. (err2 or "") }))
        return
    end
    ngx.say(cjson.encode({ errno = 0, data = { setup_done = true, user = user } }))

elseif action == "change" then
    -- Change password (requires valid session AND old password verification)
    local session = require("session")
    local token = session.get_bearer_token()
    if not token then
        ngx.status = 401
        ngx.say(cjson.encode({ errno = -1, errmsg = "请先登录后再修改密码" }))
        return
    end
    local session_user, sess_err = session.verify_session(token)
    if not session_user then
        ngx.status = 401
        ngx.say(cjson.encode({ errno = -1, errmsg = "会话已过期，请重新登录" }))
        return
    end
    local stored = admin_store.read()
    if not stored then
        ngx.say(cjson.encode({ errno = -1, errmsg = "管理员未初始化" }))
        return
    end
    local old_pass = data.old_password
    local new_pass = data.new_password
    local new_user = data.new_user
    if not old_pass or old_pass == "" then
        ngx.say(cjson.encode({ errno = -1, errmsg = "请输入当前密码" }))
        return
    end
    if not new_pass or new_pass == "" then
        ngx.say(cjson.encode({ errno = -1, errmsg = "请输入新密码" }))
        return
    end
    if #new_pass < 6 then
        ngx.say(cjson.encode({ errno = -1, errmsg = "新密码长度不少于6位" }))
        return
    end
    if not admin_store.verify(stored, old_pass) then
        ngx.say(cjson.encode({ errno = -1, errmsg = "当前密码错误" }))
        return
    end
    -- Re-encrypt with new password
    user = new_user or stored.user
    local entry = admin_store.encrypt(user, new_pass)
    if not entry then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "加密失败" }))
        return
    end
    local ok3, err3 = admin_store.write(entry)
    if not ok3 then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "写入失败" }))
        return
    end
    ngx.say(cjson.encode({ errno = 0, data = { user = user } }))

else
    ngx.say(cjson.encode({ errno = -1, errmsg = "Unknown action: " .. action }))
end
