--[[
  db.lua — Shared MariaDB connection module.
  All database access goes through this module for consistent connection handling.
  Uses resty.mysql via Unix socket to the Docker-local MariaDB.
]]
local mysql = require("resty.mysql")
local _M = {}

local DB_SOCKET = ngx.config.prefix() .. "../blog/data/mysql/mysql.sock"
local DB_NAME   = "blogyou"
local DB_USER   = "blogyou"
local DB_PASS   = "blog-db-pass-2025"

-- Open a connection (for single-query use — prefer query() helper)
function _M.connect()
    local db, err = mysql:new()
    if not db then
        return nil, "failed to create mysql instance: " .. (err or "unknown")
    end
    db:set_timeout(3000)
    local ok, err = db:connect({
        path     = DB_SOCKET,
        database = DB_NAME,
        user     = DB_USER,
        password = DB_PASS,
    })
    if not ok then
        return nil, "failed to connect to MariaDB: " .. (err or "unknown")
    end
    return db
end

-- Close / keepalive
function _M.close(db)
    if db then
        db:set_keepalive(10000, 50)
    end
end

-- Convenience: query(sql[, params]) → result rows or nil, err
-- Opens connection, runs query, closes, returns result.
-- NOTE: resty.mysql on Alpine doesn't support ? placeholders in db:query(),
-- so we manually quote string params instead.
function _M.query(sql, params)
    local db, err = _M.connect()
    if not db then
        return nil, err
    end
    -- Manual parameter substitution (? → quoted string or literal number)
    if params and #params > 0 then
        for _, val in ipairs(params) do
            local escaped
            if type(val) == "number" then
                escaped = tostring(val)
            else
                local s = tostring(val)
                -- Escape single quotes and backslashes for MariaDB
                s = s:gsub("\\", "\\\\")
                s = s:gsub("'", "\\'")
                escaped = "'" .. s .. "'"
            end
            sql = sql:gsub("%?", escaped, 1)
        end
    end
    local res, err = db:query(sql)
    _M.close(db)
    if not res then
        return nil, err
    end
    return res
end

return _M
