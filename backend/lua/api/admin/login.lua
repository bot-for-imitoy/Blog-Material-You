-- /api/admin/login — login with optional TOTP 2FA
--
-- If 2FA is not enabled (default): single-step login
--   POST { username, password } → { errno: 0, data: { token, user } }
--
-- If 2FA is enabled: two-step login
--   Step 1: POST { step: 1, username, password } → { errno: 0, data: { step: 2, temp_token } }
--   Step 2: POST { step: 2, temp_token, totp }  → { errno: 0, data: { token, user } }
local cjson = require("cjson")
local config = require("config")
local session = require("session")
local totp = require("totp")
local totp_store = require("totp_store")

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

local cfg = config.get()
local is2fa = totp_store.is_enabled()

if not is2fa then
    -- ====== Single-step login (2FA disabled) ======
    if data.username ~= cfg.admin_user or data.password ~= cfg.admin_pass then
        ngx.status = 401
        ngx.say(cjson.encode({ errno = -1, errmsg = "用户名或密码错误" }))
        return
    end
    local token, err = session.create_session(data.username)
    if not token then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Internal error: " .. (err or "") }))
        return
    end
    ngx.say(cjson.encode({ errno = 0, data = { token = token, user = data.username } }))
    return
end

-- ====== Two-step login (2FA enabled) ======
local step = tonumber(data.step) or 1

if step == 1 then
    -- Step 1: Password verification
    if data.username ~= cfg.admin_user or data.password ~= cfg.admin_pass then
        ngx.status = 401
        ngx.say(cjson.encode({ errno = -1, errmsg = "用户名或密码错误" }))
        return
    end
    local temp_token = session.create_temp(data.username)
    if not temp_token then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Internal error" }))
        return
    end
    ngx.say(cjson.encode({
        errno = 0,
        data = { step = 2, temp_token = temp_token, user = data.username }
    }))

elseif step == 2 then
    -- Step 2: TOTP verification
    local temp_token = data.temp_token
    local totp_code = data.totp
    local username, err = session.verify_temp(temp_token)
    if not username then
        ngx.status = 401
        ngx.say(cjson.encode({ errno = -1, errmsg = err or "Session expired" }))
        return
    end
    local secret = totp_store.get_secret()
    local totp_ok, totp_err = totp.verify(secret, totp_code)
    if not totp_ok then
        ngx.status = 401
        ngx.say(cjson.encode({ errno = -1, errmsg = totp_err or "验证码错误" }))
        return
    end
    local token, err2 = session.create_session(username)
    if not token then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Internal error: " .. (err2 or "") }))
        return
    end
    ngx.say(cjson.encode({ errno = 0, data = { token = token, user = username } }))
else
    ngx.status = 400
    ngx.say(cjson.encode({ errno = -1, errmsg = "Invalid step" }))
end
