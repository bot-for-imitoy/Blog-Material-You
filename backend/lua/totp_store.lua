--[[
  totp_store.lua — Persist 2FA state and TOTP secret to a JSON file.
  File: blog/data/totp.json
  Structure: { enabled: bool, secret: "BASE32", pending_secret: "BASE32"|null }
]]
local cjson = require("cjson")
local utils = require("utils")
local _M = {}

local STORE_DIR = ngx.config.prefix() .. "../blog/data"
local STORE_FILE = STORE_DIR .. "/totp.json"

-- Read the TOTP store file
function _M.read()
    local content, err = utils.read_file(STORE_FILE)
    if not content then
        return { enabled = false, secret = "", pending_secret = cjson.null }
    end
    local ok, data = pcall(cjson.decode, content)
    if not ok then
        return { enabled = false, secret = "", pending_secret = cjson.null }
    end
    return data
end

-- Write the TOTP store file
function _M.write(data)
    -- Ensure directory exists
    os.execute("mkdir -p " .. STORE_DIR)
    local content = cjson.encode(data)
    local f, err = io.open(STORE_FILE, "w")
    if not f then return nil, err end
    f:write(content)
    f:close()
    return true
end

-- Check if 2FA is enabled
function _M.is_enabled()
    local data = _M.read()
    return data.enabled == true
end

-- Get current secret (for login verification)
function _M.get_secret()
    local data = _M.read()
    return data.secret or ""
end

-- Get the pending secret (for setup verification)
function _M.get_pending_secret()
    local data = _M.read()
    return data.pending_secret
end

-- Start enabling 2FA: generate and store a pending secret
function _M.start_enable(new_secret)
    local data = _M.read()
    data.pending_secret = new_secret
    return _M.write(data)
end

-- Confirm enable: promote pending secret to active
function _M.confirm_enable()
    local data = _M.read()
    if not data.pending_secret or data.pending_secret == cjson.null then
        return nil, "No pending secret"
    end
    data.secret = data.pending_secret
    data.pending_secret = cjson.null
    data.enabled = true
    return _M.write(data)
end

-- Disable 2FA
function _M.disable()
    local data = _M.read()
    data.enabled = false
    data.pending_secret = cjson.null
    return _M.write(data)
end

return _M
