--[[
  db_friends.lua — Friend links CRUD using MariaDB.
  Replaces file-based blog/friends/*.md storage.
]]
local db = require("db")
local cjson = require("cjson")
local _M = {}

-- Parse a DB row
local function row_to_friend(row)
    return {
        id = row.id,
        title = row.title,
        descr = row.descr or "",
        title_en = row.title_en or "",
        descr_en = row.descr_en or "",
        avatar = row.avatar or "",
        url = row.url or "#",
        sort_order = row.sort_order or 0,
    }
end

-- List all friends ordered by sort_order then id
function _M.list()
    local res, err = db.query("SELECT * FROM friends ORDER BY sort_order ASC, id ASC")
    if not res then return {} end
    local friends = {}
    for _, row in ipairs(res) do
        table.insert(friends, row_to_friend(row))
    end
    if #friends == 0 then return cjson.empty_array end
    return friends
end

-- Add a friend
function _M.add(title, descr, title_en, descr_en, avatar, url, sort_order)
    local now = os.time()
    local res, err = db.query(
        "INSERT INTO friends (title, descr, title_en, descr_en, avatar, url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        {title, descr or "", title_en or "", descr_en or "", avatar or "", url or "#", sort_order or 0, now}
    )
    if not res then return nil, err end
    local insert_id = res.insert_id
    return {id = insert_id, title = title}
end

-- Update a friend
function _M.update(id, title, descr, title_en, descr_en, avatar, url, sort_order)
    local res, err = db.query(
        "UPDATE friends SET title=?, descr=?, title_en=?, descr_en=?, avatar=?, url=?, sort_order=? WHERE id=?",
        {title, descr or "", title_en or "", descr_en or "", avatar or "", url or "#", sort_order or 0, tonumber(id)}
    )
    return res ~= nil, err
end

-- Delete a friend
function _M.delete(id)
    local res, err = db.query("DELETE FROM friends WHERE id = ?", {tonumber(id)})
    return res ~= nil, err
end

return _M