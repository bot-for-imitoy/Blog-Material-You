--[[
  totp_store.lua — Persist 2FA state and TOTP secret to DB config table.
  Key: "totp_state"
  Structure: { enabled: bool, secret: "BASE32", pending_secret: "BASE32"|null }
]]
local cjson = require("cjson")
local db = require("db")
local _M = {}

local CONFIG_KEY = "totp_state"

-- Read the TOTP store from DB
function _M.read()
    local res, err = db.query("SELECT `value` FROM config WHERE `key` = ?", {CONFIG_KEY})
    if not res or #res == 0 then
        return { enabled = false, secret = "", pending_secret = cjson.null }
    end
    local ok, data = pcall(cjson.decode, res[1].value)
    if not ok then
        return { enabled = false, secret = "", pending_secret = cjson.null }
    end
    return data
end

-- Write the TOTP store to DB
function _M.write(data)
    local value = cjson.encode(data)
    local now = os.time()
    local res, err = db.query(
        "REPLACE INTO config (`key`, `value`, updated_at) VALUES (?, ?, ?)",
        {CONFIG_KEY, value, now}
    )
    return res ~= nil
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
