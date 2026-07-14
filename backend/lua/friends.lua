--[[
  friends.lua — Friend links CRUD using MariaDB via db_friends.
  Delegates all operations to db_friends module.
]]
local db_friends = require("db_friends")
local cjson = require("cjson")

local _M = {}

-- List all friends, ordered by sort_order then id
function _M.list()
    return db_friends.list()
end

-- Add a friend
function _M.add(title, descr, title_en, descr_en, avatar, url, sort_order)
    return db_friends.add(title, descr, title_en, descr_en, avatar, url, sort_order)
end

-- Update a friend
function _M.update(id, title, descr, title_en, descr_en, avatar, url, sort_order)
    return db_friends.update(id, title, descr, title_en, descr_en, avatar, url, sort_order)
end

-- Delete a friend
function _M.delete(id)
    return db_friends.delete(id)
end

return _M