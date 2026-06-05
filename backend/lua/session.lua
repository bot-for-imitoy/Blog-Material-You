--[[
  session.lua — Bearer token session management.

  Token format: base64(username + ":" + timestamp + ":" + hmac_signature)
  Tokens are self-contained (no DB/storage needed for validation),
  signed with HMAC-SHA1 using a server-side secret.

  Additionally stores temp tokens (short-lived, in shared dict)
  for the two-step login handshake.
]]
local cjson = require("cjson")
local config = require("config")
local _M = {}

local SESSION_TIMEOUT  = 3600    -- Bearer token TTL: 1 hour
local TEMP_TOKEN_TTL = 300    -- Temp auth token TTL: 5 minutes
local SESSION_PREFIX   = "sess:"
local TEMP_PREFIX      = "tmp:"

-- Get the shared dict
local function get_dict()
    return ngx.shared.blog_sessions
end

-- ====== Bearer Token (self-contained, HMAC-signed) ======

-- Create a long-lived bearer session token
function _M.create_session(username)
    local cfg = config.get()
    local secret = cfg.session_secret
    if not secret or #secret == 0 then
        return nil, "session_secret not configured in config.lua"
    end

    local ts = tostring(os.time())
    local sig_input = username .. ":" .. ts

    -- HMAC-SHA1 signature
    local sig_raw = ngx.hmac_sha1(secret, sig_input)
    local sig = ngx.encode_base64(sig_raw):gsub("\n", ""):gsub("=", "")

    -- Encode entire token
    local payload = username .. ":" .. ts .. ":" .. sig
    local token = ngx.encode_base64(payload):gsub("\n", ""):gsub("=", "")

    -- Store in shared dict for expiry tracking and forced invalidation
    local dict = get_dict()
    if dict then
        dict:set(SESSION_PREFIX .. token, username, SESSION_TIMEOUT)
    end

    return token
end

-- Verify a bearer token, returns username or nil
function _M.verify_session(token)
    if not token or token == "" then
        return nil, "No token provided"
    end

    -- Check shared dict first (quick check, also handles expiry)
    local dict = get_dict()
    if dict then
        local cached = dict:get(SESSION_PREFIX .. token)
        if cached then
            return cached
        end
    end

    -- Decode and verify HMAC signature
    local ok, decoded = pcall(ngx.decode_base64, token)
    if not ok or not decoded then
        return nil, "Invalid token encoding"
    end

    local username, ts, sig = decoded:match("^(.-):(.-):(.+)$")
    if not username or not ts or not sig then
        return nil, "Invalid token format"
    end

    -- Check expiry
    local ts_num = tonumber(ts)
    if not ts_num or os.time() - ts_num > SESSION_TIMEOUT then
        return nil, "Token expired"
    end

    -- Verify signature
    local cfg = config.get()
    local secret = cfg.session_secret
    if not secret then
        return nil, "session_secret not configured"
    end

    local expected_raw = ngx.hmac_sha1(secret, username .. ":" .. ts)
    local expected_sig = ngx.encode_base64(expected_raw):gsub("\n", ""):gsub("=", "")

    if sig ~= expected_sig then
        return nil, "Invalid token signature"
    end

    -- Re-cache in shared dict (was evicted or first time seeing self-contained token)
    if dict then
        local remaining = SESSION_TIMEOUT - (os.time() - ts_num)
        if remaining > 0 then
            dict:set(SESSION_PREFIX .. token, username, remaining)
        end
    end

    return username
end

-- Invalidate/destroy a session
function _M.destroy_session(token)
    local dict = get_dict()
    if dict then
        dict:delete(SESSION_PREFIX .. token)
    end
end

-- ====== Temp Token (short-lived, stored in shared dict) ======

-- Create a temporary token for the password-to-TOTP handshake
function _M.create_temp(username)
    local raw = tostring(os.time()) .. tostring(math.random()) .. username
    local uuid = ngx.encode_base64(
        ngx.hmac_sha1(raw, username)
    ):gsub("\n", ""):gsub("=", ""):sub(1, 24)

    local dict = get_dict()
    if dict then
        dict:set(TEMP_PREFIX .. uuid, username, TEMP_TOKEN_TTL)
    end

    return uuid
end

-- Verify and consume a temp token (one-time use)
function _M.verify_temp(temp_token)
    if not temp_token or temp_token == "" then
        return nil, "No temp token provided"
    end

    local dict = get_dict()
    if not dict then
        return nil, "Shared dict not available"
    end

    local username = dict:get(TEMP_PREFIX .. temp_token)
    if not username then
        return nil, "Invalid or expired temp token"
    end

    -- One-time use: delete immediately
    dict:delete(TEMP_PREFIX .. temp_token)

    return username
end

-- ====== Auth helper for admin endpoints ======

-- Extract Bearer token from Authorization header
function _M.get_bearer_token()
    local auth = ngx.req.get_headers()["Authorization"]
    if not auth then
        return nil
    end
    local _, _, token = auth:find("^%s*[Bb]earer%s+(.+)$")
    return token
end

return _M
