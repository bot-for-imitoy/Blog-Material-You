--[[
  talks.lua — Talks CRUD using MariaDB.
]]

local cjson = require("cjson")

local _M = {}

local DB_SOCKET = "/home/openclaw/workspace/Blog/blog/data/mysql/mysql.sock"

local function connect()
    local mysql = require("resty.mysql")
    local db, err = mysql:new()
    if not db then return nil, err end
    db:set_timeout(3000)
    local ok, err = db:connect({ path = DB_SOCKET, database = "hexoyou" })
    if not ok then return nil, err end
    return db
end

local function close(db)
    if db then db:set_keepalive(10000, 50) end
end

-- List all talks, newest first
function _M.list()
    local db, err = connect()
    if not db then ngx.log(ngx.ERR, "talks.list: ", err); return {} end
    local res, err = db:query("SELECT id, content, create_time FROM talks ORDER BY create_time DESC")
    close(db)
    if not res then ngx.log(ngx.ERR, "talks.list query: ", err); return {} end
    return res
end

-- Add a talk
function _M.add(content)
    local db, err = connect()
    if not db then ngx.log(ngx.ERR, "talks.add connect: ", err); return nil end
    local now = os.time()
    local sql = "INSERT INTO talks (content, create_time) VALUES ('" ..
                content:gsub("'", "\\'"):gsub("\\", "\\\\") .. "', " .. now .. ")"
    local res, err = db:query(sql)
    close(db)
    if not res then ngx.log(ngx.ERR, "talks.add query: ", err); return nil end
    return { id = res.insert_id, content = content, create_time = now }
end

-- Update a talk
function _M.update(id, content)
    local db, err = connect()
    if not db then ngx.log(ngx.ERR, "talks.update connect: ", err); return false end
    local sql = "UPDATE talks SET content = '" ..
                content:gsub("'", "\\'"):gsub("\\", "\\\\") ..
                "' WHERE id = " .. id
    local res, err = db:query(sql)
    close(db)
    return res and res.affected_rows > 0
end

-- Delete a talk
function _M.delete(id)
    local db, err = connect()
    if not db then ngx.log(ngx.ERR, "talks.delete connect: ", err); return false end
    local res, err = db:query("DELETE FROM talks WHERE id = " .. id)
    close(db)
    return res and res.affected_rows > 0
end

return _M
