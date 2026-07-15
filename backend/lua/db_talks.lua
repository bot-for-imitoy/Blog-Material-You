--[[
  db_talks.lua — Talks CRUD using MariaDB.
  Replaces file-based blog/talks/*.md storage.
  Talks table: id (INT AUTO_INCREMENT), content (TEXT), create_time (INT UNSIGNED)
]]
local db = require("db")
local cjson = require("cjson")
local _M = {}

-- Parse a DB row
local function row_to_talk(row)
    return {
        id = row.id,
        content = row.content or "",
        create_time = tonumber(row.create_time) or 0,
    }
end

-- List all talks ordered by create_time descending
function _M.list()
    local res, err = db.query("SELECT * FROM talks ORDER BY create_time DESC")
    if not res then return {} end
    local talks = {}
    for _, row in ipairs(res) do
        table.insert(talks, row_to_talk(row))
    end
    if #talks == 0 then return {} end
    return talks
end

-- Add a talk, returns { id, content, create_time }
function _M.add(content)
    local now = os.time()
    local res, err = db.query(
        "INSERT INTO talks (content, create_time) VALUES (?, ?)",
        {content or "", now}
    )
    if not res then return nil end
    local insert_id = res.insert_id
    return { id = insert_id, content = content or "", create_time = now }
end

-- Delete a talk by id
function _M.delete(id)
    local res, err = db.query("DELETE FROM talks WHERE id = ?", {tonumber(id)})
    return res ~= nil
end

return _M