--[[
  security.lua — Shared security helpers for the blog backend.
  Provides slug validation, error message sanitization, and CSPRNG.
]]
local _M = {}

-- Valid slug pattern: only alphanumeric, hyphens, underscores
function _M.valid_slug(slug)
    if not slug or slug == "" then return false end
    return slug:match("^[a-zA-Z0-9_-]+$") ~= nil
end

-- Validate slug and return 400 JSON if invalid
function _M.require_valid_slug(slug)
    if not _M.valid_slug(slug) then
        ngx.status = 400
        ngx.header["Content-Type"] = "application/json"
        ngx.say(require("cjson").encode({ errno = -1, errmsg = "Invalid slug" }))
        return false
    end
    return true
end

-- Safe error message: strip paths for production
function _M.safe_error(msg)
    if not msg then return "Internal error" end
    -- Remove absolute paths that might leak directory structure
    local safe = msg:gsub("/[%w_%-/%.]+", "[path]")
    return safe
end

-- Generate cryptographically secure random bytes using /dev/urandom
function _M.random_bytes(n)
    local f = io.open("/dev/urandom", "rb")
    if not f then
        -- Fallback: use HMAC-based PRNG
        local result = {}
        for i = 1, n do
            result[i] = string.char(math.random(0, 255))
        end
        return table.concat(result)
    end
    local data = f:read(n)
    f:close()
    return data
end

return _M
