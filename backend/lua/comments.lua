--[[
  comments.lua — Comment CRUD module using MariaDB.
  Uses resty.mysql with manual quoting for parameterized queries.
]]

local cjson = require("cjson")

local _M = {}

local DB_SOCKET = "/home/openclaw/workspace/Blog/blog/data/mysql/mysql.sock"
local DB_NAME   = "blogyou"

-- Quote a string value for SQL (escape single quotes)
local function quote(val)
    if val == nil then
        return "NULL"
    end
    local s = tostring(val)
    -- Escape single quotes and backslashes
    s = s:gsub("\\", "\\\\")
    s = s:gsub("'", "\\'")
    return "'" .. s .. "'"
end

-- Open a MariaDB connection
local function connect()
    local mysql = require("resty.mysql")
    local db, err = mysql:new()
    if not db then
        return nil, "failed to create mysql instance: " .. (err or "unknown")
    end
    db:set_timeout(3000)

    local ok, err = db:connect({
        path     = DB_SOCKET,
        database = DB_NAME,
    })
    if not ok then
        return nil, "failed to connect to MariaDB: " .. (err or "unknown")
    end
    return db
end

-- Close connection
local function close(db)
    if db then
        db:set_keepalive(10000, 50)
    end
end

-- List all comments for a given URL, newest first
function _M.load(url_path)
    local db, err = connect()
    if not db then
        ngx.log(ngx.ERR, "comments.load connect: ", err)
        return {}
    end

    local sql = "SELECT id, nick, mail, comment, link, ua, create_time " ..
                "FROM comments WHERE url = " .. quote(url_path) ..
                " ORDER BY create_time ASC"
    local res, err = db:query(sql)
    close(db)

    if not res then
        ngx.log(ngx.ERR, "comments.load query: ", err)
        return {}
    end

    return res
end

-- Add a comment. Returns the inserted row or nil.
function _M.add(nick, mail, comment_text, url, link, ua)
    local db, err = connect()
    if not db then
        ngx.log(ngx.ERR, "comments.add connect: ", err)
        return nil
    end

    local now = os.time()
    local sql = "INSERT INTO comments (nick, mail, comment, link, ua, url, create_time) VALUES (" ..
                quote(nick) .. ", " ..
                quote(mail) .. ", " ..
                quote(comment_text) .. ", " ..
                quote(link or "") .. ", " ..
                quote(ua or "") .. ", " ..
                quote(url) .. ", " ..
                now .. ")"
    local res, err = db:query(sql)
    close(db)

    if not res then
        ngx.log(ngx.ERR, "comments.add query: ", err)
        return nil
    end

    return {
        id = res.insert_id,
        nick = nick,
        mail = mail,
        comment = comment_text,
        link = link or "",
        ua = ua or "",
        url = url,
        create_time = now,
    }
end

-- Count comments for a given URL
function _M.count(url_path)
    local db, err = connect()
    if not db then
        ngx.log(ngx.ERR, "comments.count connect: ", err)
        return 0
    end

    local sql = "SELECT COUNT(*) AS cnt FROM comments WHERE url = " .. quote(url_path)
    local res, err = db:query(sql)
    close(db)

    if not res or #res == 0 then
        return 0
    end

    return res[1].cnt
end

return _M
