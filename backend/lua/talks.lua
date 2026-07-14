--[[
  talks.lua — Talks CRUD using MariaDB via db_talks.
  Delegates all operations to db_talks module.
]]
local db_talks = require("db_talks")
local cjson = require("cjson")

local _M = {}

-- List all talks, sorted newest first
function _M.list()
    return db_talks.list()
end

-- Add a talk, returns { id, content, create_time }
function _M.add(content)
    return db_talks.add(content)
end

-- Delete a talk by id
function _M.delete(id)
    return db_talks.delete(id)
end

return _M