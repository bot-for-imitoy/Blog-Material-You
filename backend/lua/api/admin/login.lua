-- /api/admin/login — single-step password login
--
-- POST { username, password }
--   → { errno: 0, data: { token, user } } or 401
--
-- The bearer token is a session stored via session.create_session()
local cjson = require("cjson")
local config = require("config")
local admin_auth = require("admin_auth")
local session = require("session")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "*"

if ngx.req.get_method() == "OPTIONS" then
    ngx.status = 204
    return
end

-- Parse body
ngx.req.read_body()
local body = ngx.req.get_body_data()
local ok, data = pcall(cjson.decode, body or "{}")
if not ok or not data then
    ngx.say(cjson.encode({ errno = -1, errmsg = "Invalid JSON body" }))
    return
end

-- Validate credentials
local cfg = config.get()
if data.username ~= cfg.admin_user or data.password ~= cfg.admin_pass then
    ngx.status = 401
    ngx.say(cjson.encode({ errno = -1, errmsg = "用户名或密码错误" }))
    return
end

-- Password verified — create bearer token
local token, err = session.create_session(data.username)
if not token then
    ngx.status = 500
    ngx.say(cjson.encode({ errno = -1, errmsg = "Internal error: " .. (err or "") }))
    return
end

ngx.say(cjson.encode({
    errno = 0,
    data = {
        token = token,
        user = data.username
    }
}))
