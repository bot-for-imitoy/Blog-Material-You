--[[
  db_pages.lua — Static page CRUD using MariaDB.
  Reads/writes from the 'pages' table for about, talks, etc.
]]
local db = require("db")
local _M = {}

-- List all pages
function _M.list()
    local res, err = db.query("SELECT * FROM pages ORDER BY slug ASC")
    if not res then return {} end
    return res
end

-- Get a single page by slug
function _M.get(slug)
    local res, err = db.query("SELECT * FROM pages WHERE slug = ?", {slug})
    if not res or #res == 0 then return nil end
    return res[1]
end

-- Save (insert or update) a page
-- Uses INSERT ON DUPLICATE KEY UPDATE
function _M.save(slug, title, content, title_en, content_en)
    local now = os.time()
    local res, err = db.query(
        "INSERT INTO pages (slug, title, content, title_en, content_en, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title=VALUES(title), content=VALUES(content), title_en=VALUES(title_en), content_en=VALUES(content_en), updated_at=VALUES(updated_at)",
        {slug, title or "", content or "", title_en or "", content_en or "", now}
    )
    if not res then return nil, err end
    return true
end

return _M