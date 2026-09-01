--[[
  db.lua — Shared MariaDB connection module.
  All database access goes through this module for consistent connection handling.

  Two execution paths:
    * lua-resty-mysql (default) — for socket / plain-TCP connections.
    * mariadb CLI + XML output — automatically used when the connection
      requires TLS / mutual TLS (BMY_DB_URL with ssl_ca/ssl_cert/ssl_key),
      which lua-resty-mysql cannot do (it has no client-certificate support).
      Only active in that case; all callers keep using db.query() unchanged.
]]
local mysql = require("resty.mysql")
local db_config = require("db_config")
local urlparse = require("urlparse")
local _M = {}

-- ===================== CLI path (TLS / mutual TLS) =====================

-- Returns CLI connection info when the configured BMY_DB_URL requires
-- TLS / mutual TLS; nil otherwise (use lua-resty-mysql).
local function cli_info()
    local url = os.getenv("BMY_DB_URL") or ""
    if url == "" then return nil end
    local db, err = urlparse.parse_db_url(url)
    if not db then return nil end
    local ssl = db.ssl or {}
    if not (ssl.ca or ssl.cert or ssl.key) then return nil end
    if not (db.host and db.host ~= "") then return nil end

    local parts = { "mariadb" }
    if ssl.ca then parts[#parts + 1] = "--ssl-ca=" .. ssl.ca end
    if ssl.cert then parts[#parts + 1] = "--ssl-cert=" .. ssl.cert end
    if ssl.key then parts[#parts + 1] = "--ssl-key=" .. ssl.key end
    if ssl.verify == false then parts[#parts + 1] = "--ssl-verify-server-cert=OFF" end
    parts[#parts + 1] = "-h" .. db.host
    parts[#parts + 1] = "-P" .. tostring(db.port or 3306)
    parts[#parts + 1] = "-u" .. (db.user or "blogyou")
    parts[#parts + 1] = "--default-character-set=utf8mb4"
    parts[#parts + 1] = "--xml"
    return {
        prefix = table.concat(parts, " "),
        dbname = db.database or "blogyou",
        password = db.password or "",
    }
end

-- Shell-quote a string for use inside single quotes
local function shq(v)
    return "'" .. tostring(v):gsub("'", "'\\''") .. "'"
end

-- Unescape XML entities
local function xml_unescape(s)
    s = s:gsub("&lt;", "<")
    s = s:gsub("&gt;", ">")
    s = s:gsub("&quot;", '"')
    s = s:gsub("&apos;", "'")
    s = s:gsub("&#x(%x+);", function(h) return string.char(tonumber(h, 16)) end)
    s = s:gsub("&#(%d+);", function(n) return string.char(tonumber(n)) end)
    s = s:gsub("&amp;", "&")
    return s
end

-- Convert XML string values to Lua numbers for numeric-looking content,
-- matching lua-resty-mysql's behaviour for INT/DECIMAL/FLOAT columns.
local function convert_value(v)
    if v:match("^%-?%d+$") or v:match("^%-?%d+%.%d+$") then
        local n = tonumber(v)
        if n then return n end
    end
    return v
end

-- Parse `mariadb --xml` output into { {col = value}, ... }
-- NULL columns come back as ngx.null, matching lua-resty-mysql semantics.
local function parse_xml_rows(xml)
    local rows = {}
    for row_block in xml:gmatch("<row>(.-)</row>") do
        local row = {}
        -- xsi:nil (NULL) fields first (self-closing tags)
        for name in row_block:gmatch('<field name="([^"]*)"[^>]*xsi:nil[^>]*/>') do
            row[name] = ngx.null
        end
        -- Normalize nil fields to the empty-tag form so the content pattern
        -- below never crosses a self-closing tag into the next field.
        local cleaned = row_block:gsub(
            '<field name="([^"]*)"[^>]*xsi:nil[^>]*/>', '<field name="%1"></field>')
        -- regular fields with content
        for name, content in cleaned:gmatch('<field name="([^"]*)"[^>]*>(.-)</field>') do
            if not row[name] then
                row[name] = convert_value(xml_unescape(content))
            end
        end
        rows[#rows + 1] = row
    end
    return rows
end

-- Does this statement return a result set (SELECT) or affect rows (write)?
local function is_write_sql(sql)
    local head = sql:match("^%s*([%w_]+)")
    head = head and head:upper() or ""
    return head ~= "SELECT" and head ~= "SHOW" and head ~= "DESCRIBE"
        and head ~= "DESC" and head ~= "EXPLAIN"
end

-- Execute a query through the mariadb CLI (used for TLS / mutual TLS).
-- Returns rows (array of {col=value}) or { insert_id=, affected_rows= }.
local function cli_query(info, sql)
    local is_write = is_write_sql(sql)
    if is_write then
        sql = sql .. "; SELECT LAST_INSERT_ID() AS insert_id, ROW_COUNT() AS affected_rows"
    end

    local cmd = "MYSQL_PWD=" .. shq(info.password) .. " " .. info.prefix .. " " ..
        shq(info.dbname) .. " -e " .. shq(sql) .. " 2>&1"
    local handle = io.popen(cmd)
    if not handle then
        return nil, "failed to run mariadb CLI"
    end
    local output = handle:read("*a")
    local ok, _, code = handle:close()
    if not ok or (code and code ~= 0) then
        -- output contains the CLI error message
        return nil, (output or ""):gsub("\n", " ")
    end

    local xml = output:match("<resultset.*") or output
    local rows = parse_xml_rows(xml)
    if is_write then
        local r = rows[1] or {}
        return {
            insert_id = tonumber(r.insert_id) or 0,
            affected_rows = tonumber(r.affected_rows) or 0,
        }
    end
    return rows
end

-- ===================== lua-resty-mysql path =====================

-- Open a connection (for single-query use — prefer query() helper).
-- When TLS / mutual TLS is configured this returns a shim object whose
-- query() routes through the mariadb CLI (lua-resty-mysql cannot do mTLS).
function _M.connect()
    local cli = cli_info()
    if cli then
        return {
            query = function(_, sql) return cli_query(cli, sql) end,
            set_keepalive = function() return true end,
            set_timeout = function() return true end,
            close = function() return true end,
        }, nil
    end

    local db, err = mysql:new()
    if not db then
        return nil, "failed to create mysql instance: " .. (err or "unknown")
    end
    db:set_timeout(3000)
    local ok, err = db:connect(db_config.connect_params())
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

-- Substitute ? placeholders (resty.mysql on Alpine doesn't support them).
-- Placeholders are scanned LEFT→RIGHT with plain string.find and the
-- substituted values are never rescanned — a previous gsub-based version
-- corrupted queries when a VALUE contained '?' (e.g. regex "(?:" in post
-- content) or '%' (gsub replacement escapes).
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

local function substitute_params(sql, params)
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
    return table.concat(out)
end

function _M.query(sql, params)
    if params and #params > 0 then
        sql = substitute_params(sql, params)
    end

    local cli = cli_info()
    if cli then
        return cli_query(cli, sql)
    end

    local db, err = _M.connect()
    if not db then
        return nil, err
    end
    local res, err = db:query(sql)
    _M.close(db)
    if not res then
        return nil, err
    end
    return res
end

return _M
