--[[
  admin_auth.lua — Admin authentication helpers.
  Uses config.lua admin_user / admin_pass.
]]

local cjson = require("cjson")
local config = require("config")

local _M = {}

-- Verify a Basic auth header.
-- Returns the username on success, or nil + error message.
function _M.verify_basic_auth()
    local auth = ngx.req.get_headers()["Authorization"]
    if not auth then
        return nil, "Missing Authorization header"
    end

    -- Expected: "Basic base64(username:password)"
    local _, _, b64 = auth:find("^%s*[Bb]asic%s+(.+)$")
    if not b64 then
        return nil, "Invalid auth scheme, use Basic"
    end

    -- Decode base64
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

return _M
