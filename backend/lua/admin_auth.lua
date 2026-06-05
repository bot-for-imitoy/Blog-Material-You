--[[
  admin_auth.lua — Admin authentication helpers.
  Supports both:
    1. Basic Auth (legacy, backward compatible)
    2. Bearer Token (new, session-based)
  Preferred method: Bearer token via session.lua
]]
local cjson = require("cjson")
local config = require("config")
local session = require("session")

local _M = {}

-- Verify a Basic auth header (legacy).
-- Returns the username on success, or nil + error message.
function _M.verify_basic_auth()
    local auth = ngx.req.get_headers()["Authorization"]
    if not auth then
        return nil, "Missing Authorization header"
    end

    local _, _, b64 = auth:find("^%s*[Bb]asic%s+(.+)$")
    if not b64 then
        return nil, "Invalid auth scheme, use Basic or Bearer"
    end

    local decoded = ngx.decode_base64(b64)
    if not decoded then
        return nil, "Invalid base64"
    end

    local user, pass = decoded:match("^(.-):(.+)$")
    if not user or not pass then
        return nil, "Invalid auth format (expected user:pass)"
    end

    local cfg = config.get()
    if user == cfg.admin_user and pass == cfg.admin_pass then
        return user
    end

    return nil, "Invalid credentials"
end

-- Verify a Bearer token (new).
-- Returns the username on success, or nil + error message.
function _M.verify_bearer_token()
    local token = session.get_bearer_token()
    if not token then
        return nil, "Missing Bearer token"
    end

    local user, err = session.verify_session(token)
    if not user then
        return nil, err or "Invalid session"
    end

    return user
end

-- Verify admin access: try Bearer token first, fall back to Basic Auth.
-- This allows the new login flow (Bearer) and legacy clients (Basic) to coexist.
-- Returns username or nil (401 response already sent).
function _M.verify_admin()
    -- Try Bearer token first (new auth)
    local user = _M.verify_bearer_token()
    if user then
        return user
    end

    -- Fall back to Basic auth (legacy)
    user = _M.verify_basic_auth()
    if user then
        return user
    end

    -- Return JSON error
    ngx.status = 401
    ngx.header["Content-Type"] = "application/json"
    ngx.say(cjson.encode({ errno = -1, errmsg = "Unauthorized" }))
    return nil
end

return _M
