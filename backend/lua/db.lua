--[[
  db.lua — Shared MariaDB connection module.
  All database access goes through this module for consistent connection handling.
  Uses resty.mysql via Unix socket to the Docker-local MariaDB.
]]
local mysql = require("resty.mysql")
local _M = {}

local DB_SOCKET = require("utils").db_socket()
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
-- so we substitute them manually. Placeholders are scanned LEFT→RIGHT with
-- plain string.find and the substituted values are never rescanned —
-- a previous gsub-based version corrupted queries when a VALUE contained
-- '?' (e.g. regex "(?:" in post content) or '%' (gsub replacement escapes).
local function quote_param(val)
    if val == nil then
        return "NULL"
    elseif type(val) == "number" then
        return tostring(val)
    elseif type(val) == "boolean" then
        return val and "1" or "0"
    else
        -- ngx.quote_sql_str handles ' " \ NUL \n \r \Z (MySQL-safe)
        return ngx.quote_sql_str(tostring(val))
    end
end

function _M.query(sql, params)
    local db, err = _M.connect()
    if not db then
        return nil, err
    end
    if params and #params > 0 then
        local out = {}
        local pos = 1
        local i = 0
        while true do
            local q = sql:find("?", pos, true)
            if not q then
                out[#out + 1] = sql:sub(pos)
                break
            end
            i = i + 1
            out[#out + 1] = sql:sub(pos, q - 1)
            out[#out + 1] = quote_param(params[i])
            pos = q + 1
        end
        sql = table.concat(out)
    end
    local res, err = db:query(sql)
    _M.close(db)
    if not res then
        return nil, err
    end
    return res
end

return _M
