--[[
  data_store.lua — Blog data access via MariaDB (migrated from JSON files).
  Manages emails, pending registrations, and calendar events.
]]
local cjson = require("cjson")
local db = require("db")
local _M = {}

-- ===== Emails (was auth/emails.json) =====

function _M.get_emails()
    local res, err = db.query("SELECT email, permissions, created_at FROM emails")
    if not res then return {} end
    local result = {}
    for _, row in ipairs(res) do
        local ok, perms = pcall(cjson.decode, row.permissions)
        result[row.email] = {
            permissions = ok and perms or {},
            created_at = row.created_at,
        }
    end
    return result
end

-- Check if an email has a specific permission
function _M.has_permission(email, perm)
    local res, err = db.query("SELECT permissions FROM emails WHERE email = ?", {email})
    if not res or #res == 0 then return false end
    local ok, perms = pcall(cjson.decode, res[1].permissions)
    if not ok then return false end
    for _, p in ipairs(perms) do
        if p == perm then return true end
    end
    return false
end

-- Get all permissions for an email
function _M.get_permissions(email)
    local res, err = db.query("SELECT permissions FROM emails WHERE email = ?", {email})
    if not res or #res == 0 then return {} end
    local ok, perms = pcall(cjson.decode, res[1].permissions)
    if ok then return perms end
    return {}
end

-- Add or update an email
function _M.set_email(email, permissions, created_at)
    local perms_json = cjson.encode(permissions or {})
    local now = created_at or os.time()
    local res, err = db.query(
        "REPLACE INTO emails (email, permissions, created_at) VALUES (?, ?, ?)",
        {email, perms_json, now}
    )
    return res ~= nil
end

-- ===== Pending registrations (was auth/pending.json) =====

function _M.get_pending()
    local res, err = db.query("SELECT id, email, name, created_at FROM pending_registrations ORDER BY created_at ASC")
    if not res then return {} end
    return res
end

-- Add a pending registration
function _M.add_pending(email, name)
    local now = os.time()
    local res, err = db.query(
        "INSERT INTO pending_registrations (email, name, created_at) VALUES (?, ?, ?)",
        {email, name or "", now}
    )
    return res ~= nil
end

-- Remove a pending registration
function _M.remove_pending(id)
    local res, err = db.query("DELETE FROM pending_registrations WHERE id = ?", {id})
    return res ~= nil
end

-- ===== Calendar events (was calendar/events.json) =====

function _M.get_calendar()
    local res, err = db.query("SELECT id, title, date, description, color FROM calendar_events ORDER BY date ASC")
    if not res then return {} end
    -- Return empty array if no events
    if #res == 0 then return cjson.empty_array end
    return res
end

-- Add a calendar event
function _M.add_calendar_event(title, date, description, color)
    local now = os.time()
    local res, err = db.query(
        "INSERT INTO calendar_events (title, date, description, color, created_at) VALUES (?, ?, ?, ?, ?)",
        {title, date, description or "", color or "", now}
    )
    return res ~= nil
end

-- ===== Legacy wrappers (for backward compat if any external callers) =====

function _M.read_json(subpath)
    -- Deprecated: all data now lives in DB
    return nil, "JSON file storage is deprecated, use DB instead"
end

function _M.write_json(subpath, data)
    -- Deprecated: all data now lives in DB
    return nil, "JSON file storage is deprecated, use DB instead"
end

return _M
