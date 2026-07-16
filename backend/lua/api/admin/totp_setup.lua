-- /api/admin/totp-setup — TOTP 2FA setup management
-- Requires admin authentication.
--
-- GET  → returns current TOTP state (enabled/disabled, secret info)
-- POST { action: "start" }   → generate new secret, store as pending
-- POST { action: "disable" } → disable 2FA
local cjson = require("cjson")
local config = require("config")
local admin_auth = require("admin_auth")
local totp = require("totp")
local totp_store = require("totp_store")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

if ngx.req.get_method() == "OPTIONS" then
    ngx.status = 204
    return
end

local user = admin_auth.verify_admin()
if not user then
    return
end

local cfg = config.get()

if ngx.req.get_method() == "GET" then
    -- Return current state
    local state = totp_store.read()
    local secret = state.pending_secret and state.pending_secret ~= cjson.null
                 and state.pending_secret or state.secret or ""
    local uri = ""
    if secret and secret ~= "" then
        uri = totp.provisioning_uri(secret, cfg.admin_user)
    end
    ngx.say(cjson.encode({
        errno = 0,
        data = {
            enabled = state.enabled == true,
            has_pending = state.pending_secret and state.pending_secret ~= cjson.null,
            secret = secret,
            provisioning_uri = uri,
            user = cfg.admin_user,
            issuer = "BlogMaterialYou"
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

if action == "start" then
    -- Generate a new TOTP secret using CSPRNG (/dev/urandom)
    local raw = ""
    local f = io.open("/dev/urandom", "rb")
    if f then
        raw = f:read(20)
        f:close()
    end
    if not raw or #raw < 20 then
        -- Fallback: use HMAC-based pseudo-random stream
        raw = ""
        for i = 1, 20 do
            local h = ngx.hmac_sha1(tostring(os.time()) .. tostring(math.random()) .. tostring(i), "totp-gen")
            raw = raw .. h:sub(1, 1)
        end
    end
    -- Map each random byte (0-255) to a base32 character via modulo 32
    -- This guarantees every byte produces a valid base32 character
    local b32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    local new_secret = ""
    for i = 1, #raw do
        local byte_val = raw:byte(i)
        local idx = (byte_val % 32) + 1  -- 1-based index into b32chars
        new_secret = new_secret .. b32chars:sub(idx, idx)
    end

    totp_store.start_enable(new_secret)
    local uri = totp.provisioning_uri(new_secret, cfg.admin_user)

    ngx.say(cjson.encode({
        errno = 0,
        data = {
            secret = new_secret,
            provisioning_uri = uri,
            user = cfg.admin_user,
            issuer = "BlogMaterialYou"
        }
    }))

elseif action == "verify" then
    -- Verify the pending secret with a TOTP code from user
    local code = data.code
    if not code or code == "" then
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing TOTP code" }))
        return
    end
    local secret = totp_store.get_pending_secret()
    if not secret or secret == cjson.null or secret == "" then
        ngx.say(cjson.encode({ errno = -1, errmsg = "No pending setup, please start first" }))
        return
    end
    local ok, err = totp.verify(secret, code)
    if not ok then
        ngx.say(cjson.encode({ errno = -1, errmsg = err or "验证码错误，请重试" }))
        return
    end
    -- Code verified — promote to active
    totp_store.confirm_enable()
    ngx.say(cjson.encode({ errno = 0, data = { enabled = true } }))

elseif action == "disable" then
    totp_store.disable()
    ngx.say(cjson.encode({ errno = 0, data = { enabled = false } }))

else
    ngx.status = 400
    ngx.say(cjson.encode({ errno = -1, errmsg = "Unknown action: " .. action }))
end
