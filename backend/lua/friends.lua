--[[
  friends.lua — Friends links CRUD using MariaDB.
]]
local cjson = require("cjson")
local db = require("db")
local _M = {}

-- List all friends, ordered by sort_order
function _M.list()
    local res, err = db.query("SELECT id, title, descr, title_en, descr_en, avatar, url, sort_order FROM friends ORDER BY sort_order ASC, id ASC")
    if not res or #res == 0 then return cjson.empty_array end
    return res
end

-- Add a friend
function _M.add(title, descr, title_en, descr_en, avatar, url, sort_order)
    local now = os.time()
    local res, err = db.query(
        "INSERT INTO friends (title, descr, title_en, descr_en, avatar, url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        {title, descr or "", title_en or "", descr_en or "", avatar or "", url, sort_order or 0, now}
    )
    if not res then return nil, err end
    return { id = res.insert_id, title = title }
end

-- Update a friend
function _M.update(id, title, descr, title_en, descr_en, avatar, url, sort_order)
    local res, err = db.query(
        "UPDATE friends SET title=?, descr=?, title_en=?, descr_en=?, avatar=?, url=?, sort_order=? WHERE id=?",
        {title, descr or "", title_en or "", descr_en or "", avatar or "", url, sort_order or 0, id}
    )
    return res ~= nil
end

-- Delete a friend
function _M.delete(id)
    local res, err = db.query("DELETE FROM friends WHERE id = ?", {id})
    return res ~= nil
end

return _M
