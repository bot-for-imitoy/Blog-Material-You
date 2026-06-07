--[[
  admin_auth.lua — Admin authentication helpers.
  Uses Bearer Token (session-based) only.
  Basic Auth fallback removed for security (M-04).
]]
local cjson = require("cjson")
local session = require("session")

local _M = {}

-- Verify a Bearer token.
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

-- Verify admin access via Bearer token.
-- Returns username or nil (401 response already sent).
function _M.verify_admin()
    local user = _M.verify_bearer_token()
    if user then
        return user
    end
    ngx.status = 401
    ngx.header["Content-Type"] = "application/json"
    ngx.say(cjson.encode({ errno = -1, errmsg = "Unauthorized" }))
    return nil
end

return _M
