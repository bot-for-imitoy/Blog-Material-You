--[[
  comments.lua — Comment CRUD module using MariaDB.
  All statements go through db.query(sql, params); db.lua quotes every
  parameter with ngx.quote_sql_str (identical to the MySQL client escaping
  rules), so no value is ever interpolated by hand. The previous
  gsub-based escaper silently broke under sql_mode=NO_BACKSLASH_ESCAPES.
]]
local dbmod = require("db")

local _M = {}

-- List all comments for a given URL, oldest first.
-- `mail` is intentionally NOT selected: the public API returns this list and
-- a commenter's address must not be readable by every visitor.
function _M.load(url_path)
    local res, err = dbmod.query(
        "SELECT id, nick, comment, link, ua, avatar, create_time " ..
        "FROM comments WHERE url = ? ORDER BY create_time ASC", { url_path })
    if not res then
        ngx.log(ngx.ERR, "comments.load query: ", err)
        return {}
    end
    return res
end

-- Add a comment. Returns the inserted row or nil.
function _M.add(nick, mail, comment_text, url, link, ua, avatar)
    local now = os.time()
    local res, err = dbmod.query(
        "INSERT INTO comments (nick, mail, comment, link, ua, avatar, url, create_time) " ..
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        { nick, mail, comment_text, link or "", ua or "", avatar or "", url, now })
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
    local res, err = dbmod.query(
        "SELECT COUNT(*) AS cnt FROM comments WHERE url = ?", { url_path })
    if not res then
        ngx.log(ngx.ERR, "comments.count query: ", err)
        return 0
    end
    if #res == 0 then return 0 end
    return tonumber(res[1].cnt) or 0
end

-- List all comments (admin view), newest first. Includes mail.
function _M.list_all()
    local res, err = dbmod.query(
        "SELECT id, nick, mail, comment, link, url, create_time " ..
        "FROM comments ORDER BY create_time DESC")
    if not res then
        ngx.log(ngx.ERR, "comments.list_all query: ", err)
        return {}
    end
    return res
end

-- Delete one comment by id. Returns true when a row was removed.
function _M.delete_by_id(id)
    local n = tonumber(id)
    if not n then return false, "invalid id" end
    local res, err = dbmod.query("DELETE FROM comments WHERE id = ?", { n })
    if not res then
        ngx.log(ngx.ERR, "comments.delete_by_id query: ", err)
        return false, err
    end
    return (tonumber(res.affected_rows) or 0) > 0
end

return _M
