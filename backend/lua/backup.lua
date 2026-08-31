--[[
  backup.lua — One-click full backup (export) and restore (import) of all
  blog data stored in MariaDB. All tables are dumped into a single JSON
  document and restored from it. Works with any database the blog is
  configured to use (see db_config.lua).
]]
local cjson = require("cjson")
local db = require("db")
local _M = {}

local APP_NAME = "blog-material-you"
local BACKUP_VERSION = 1

-- All tables that hold blog data
local TABLES = {
    "comments",
    "talks",
    "posts",
    "pages",
    "friends",
    "config",
    "emails",
    "pending_registrations",
    "calendar_events",
    "page_content",
}

-- Convert ngx.null to cjson.null so cjson can serialize NULL values
local function row_to_plain(row)
    local out = {}
    for k, v in pairs(row) do
        if v == ngx.null then
            out[k] = cjson.null
        else
            out[k] = v
        end
    end
    return out
end

-- Export all data as a plain Lua table (cjson-encodable)
function _M.export()
    local tables = {}
    for _, t in ipairs(TABLES) do
        local res, err = db.query("SELECT * FROM `" .. t .. "`")
        if not res then
            return nil, "failed to read table " .. t .. ": " .. tostring(err)
        end
        local rows = {}
        for _, row in ipairs(res) do
            table.insert(rows, row_to_plain(row))
        end
        if #rows == 0 then rows = cjson.empty_array end
        tables[t] = rows
    end
    return {
        app = APP_NAME,
        version = BACKUP_VERSION,
        exported_at = os.time(),
        tables = tables,
    }
end

-- Escape a value into a SQL literal
local function sql_literal(v)
    if v == nil or v == cjson.null then
        return "NULL"
    end
    if type(v) == "number" then
        return tostring(v)
    end
    if type(v) == "boolean" then
        return v and "1" or "0"
    end
    return ngx.quote_sql_str(tostring(v))
end

-- Restore data from an exported payload.
-- Returns a summary table { table = insertedCount } or nil, err.
function _M.import(payload)
    if type(payload) ~= "table" then
        return nil, "invalid backup payload"
    end
    if payload.app ~= APP_NAME then
        return nil, "not a " .. APP_NAME .. " backup"
    end
    if type(payload.tables) ~= "table" then
        return nil, "backup has no tables section"
    end

    local summary = {}
    for _, t in ipairs(TABLES) do
        local rows = payload.tables[t]
        if rows == nil then
            summary[t] = 0
        else
            -- Clear existing data
            local del, derr = db.query("DELETE FROM `" .. t .. "`")
            if not del then
                return nil, "failed to clear table " .. t .. ": " .. tostring(derr)
            end
            local count = 0
            for _, row in ipairs(rows) do
                if type(row) == "table" then
                    local cols, vals = {}, {}
                    for k, v in pairs(row) do
                        -- Sanitize column name before embedding in SQL
                        if tostring(k):match("^[%w_]+$") then
                            table.insert(cols, "`" .. k .. "`")
                            table.insert(vals, sql_literal(v))
                        end
                    end
                    if #cols > 0 then
                        local sql = "INSERT INTO `" .. t .. "` (" ..
                            table.concat(cols, ", ") .. ") VALUES (" ..
                            table.concat(vals, ", ") .. ")"
                        local ins, ierr = db.query(sql)
                        if not ins then
                            return nil, "failed to insert into " .. t .. ": " .. tostring(ierr)
                        end
                        count = count + 1
                    end
                end
            end
            summary[t] = count
        end
    end
    return summary
end

return _M
