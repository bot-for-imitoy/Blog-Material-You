--[[
  comments.lua — Comment CRUD module using MariaDB.
  Uses manual escaping (resty.mysql on Alpine doesn't support ? placeholders).
]]
local cjson = require("cjson")
local mysql = require("resty.mysql")

local _M = {}

local DB_SOCKET = ngx.config.prefix() .. "../blog/data/mysql/mysql.sock"
local DB_NAME   = "blogyou"
local DB_USER   = "blogyou"
local DB_PASS   = "blog-db-pass-2025"

-- Escape string for SQL (single quotes + backslashes)
local function esc(s)
    if not s then return "''" end
    local str = tostring(s)
    str = str:gsub("\\", "\\\\")
    str = str:gsub("'", "\\'")
    return "'" .. str .. "'"
end

-- Open a MariaDB connection
local function connect()
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

-- Close connection
local function close(db)
    if db then
        db:set_keepalive(10000, 50)
    end
end

-- List all comments for a given URL, oldest first
function _M.load(url_path)
    local db, err = connect()
    if not db then
        ngx.log(ngx.ERR, "comments.load connect: ", err)
        return {}
    end

    local sql = "SELECT id, nick, mail, comment, link, ua, avatar, create_time " ..
                "FROM comments WHERE url = " .. esc(url_path) .. " " ..
                "ORDER BY create_time ASC"
    local res, err = db:query(sql)
    close(db)

    if not res then
        ngx.log(ngx.ERR, "comments.load query: ", err)
        return {}
    end

    return res
end

-- Add a comment. Returns the inserted row or nil.
function _M.add(nick, mail, comment_text, url, link, ua, avatar)
    local db, err = connect()
    if not db then
        ngx.log(ngx.ERR, "comments.add connect: ", err)
        return nil
    end

    local now = os.time()
    local sql = "INSERT INTO comments (nick, mail, comment, link, ua, avatar, url, create_time) " ..
                "VALUES (" ..
                esc(nick) .. "," ..
                esc(mail) .. "," ..
                esc(comment_text) .. "," ..
                esc(link or "") .. "," ..
                esc(ua or "") .. "," ..
                esc(avatar or "") .. "," ..
                esc(url) .. "," ..
                now ..
                ")"
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
        avatar = avatar or "",
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

    local sql = "SELECT COUNT(*) AS cnt FROM comments WHERE url = " .. esc(url_path)
    local res, err = db:query(sql)
    close(db)

    if not res or #res == 0 then
        return 0
    end

    return res[1].cnt
end

return _M
