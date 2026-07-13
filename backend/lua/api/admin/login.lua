-- /api/admin/login — login with optional TOTP 2FA
--
-- Admin credentials are stored encrypted in blog/data/admin.json.
-- If not initialized, all login attempts return "not set up" error.
--
-- If 2FA is not enabled (default): single-step login
--   POST { username, password } → { errno: 0, data: { token, user } }
--
-- If 2FA is enabled: two-step login
--   Step 1: POST { step: 1, username, password } → { errno: 0, data: { step: 2, temp_token } }
--   Step 2: POST { step: 2, temp_token, totp }  → { errno: 0, data: { token, user } }
local cjson = require("cjson")
local session = require("session")
local totp = require("totp")
local totp_store = require("totp_store")
local admin_store = require("admin_store")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

if ngx.req.get_method() == "OPTIONS" then
    ngx.status = 204
    return
end

-- Check if admin is initialized
if not admin_store.is_setup_done() then
    ngx.say(cjson.encode({ errno = -1, errmsg = "管理员尚未初始化，请先访问 /admin/setup/ 进行初始化" }))
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

local stored = admin_store.read()
local is2fa = totp_store.is_enabled()

-- Verify credentials using admin_store (AES-256-CBC decryption check)
local function check_password(input_user, input_pass)
    if not input_user or not input_pass then return false end
    if input_user ~= stored.user then return false end
    return admin_store.verify(stored, input_pass)
end

if not is2fa then
    -- ====== Single-step login (2FA disabled) ======
    if not check_password(data.username, data.password) then
        ngx.status = 401
        ngx.say(cjson.encode({ errno = -1, errmsg = "用户名或密码错误" }))
        return
    end
    local token, err = session.create_session(data.username)
    if not token then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Internal error" }))
        return
    end
    -- Set HttpOnly cookie for browser-based auth
    session.set_session_cookie(token)
    ngx.say(cjson.encode({ errno = 0, data = { token = token, user = data.username } }))
    return
end

-- ====== Two-step login (2FA enabled) ======
local step = tonumber(data.step) or 1

if step == 1 then
    -- Step 1: Password verification
    if not check_password(data.username, data.password) then
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
    local username, err = session.verify_temp(data.temp_token)
    if not username then
        ngx.status = 401
        ngx.say(cjson.encode({ errno = -1, errmsg = err or "Session expired" }))
        return
    end
    local secret = totp_store.get_secret()
    local totp_ok, totp_err = totp.verify(secret, data.totp)
    if not totp_ok then
        ngx.status = 401
        ngx.say(cjson.encode({ errno = -1, errmsg = totp_err or "验证码错误" }))
        return
    end
    local token2, err2 = session.create_session(username)
    if not token2 then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Internal error" }))
        return
    end
    -- Set HttpOnly cookie for browser-based auth
    session.set_session_cookie(token2)
    ngx.say(cjson.encode({ errno = 0, data = { token = token2, user = username } }))
else
    ngx.status = 400
    ngx.say(cjson.encode({ errno = -1, errmsg = "Invalid step" }))
end
