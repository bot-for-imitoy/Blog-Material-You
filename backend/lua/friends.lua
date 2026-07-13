--[[
  friends.lua — Friend links CRUD using .md files in blog/friends/ directory.
  Each friend is a .md file: blog/friends/<slug>.md
  Format:
    ---
    id: <number>
    title: <name>
    descr: <description>
    title_en: <english name>
    descr_en: <english description>
    avatar: <url>
    url: <link>
    sort_order: <number>
    ---
]]
local utils = require("utils")
local cjson = require("cjson")

local _M = {}

local FRIENDS_DIR = require("utils").blog_dir() .. "/friends"

-- Parse a single .md file into a friend object
local function parse_friend(filepath)
    local content, err = utils.read_file(filepath)
    if not content then return nil end
    local frontmatter
    if content:sub(1, 3) == "---" then
        local _, end_pos = content:find("---", 5, true)
        if end_pos then
            frontmatter = content:sub(5, end_pos - 2)
        end
    end
    if not frontmatter then return nil end
    local meta = utils.parse_frontmatter(frontmatter)
    -- Extract slug from filename
    local slug = filepath:match("/([^/]+)%.md$") or filepath:match("([^/\\]+)%.md$")
    return {
        id = tonumber(meta.id) or 0,
        title = meta.title or slug or "Untitled",
        descr = meta.descr or "",
        title_en = meta.title_en or "",
        descr_en = meta.descr_en or "",
        avatar = meta.avatar or "",
        url = meta.url or "#",
        sort_order = tonumber(meta.sort_order) or 0,
        slug = slug,
    }
end

-- Build the friend file content from fields
local function build_friend_file(friend)
    local data = "---\n"
    data = data .. "id: " .. (friend.id or 0) .. "\n"
    data = data .. "title: " .. friend.title .. "\n"
    if friend.descr and friend.descr ~= "" then
        data = data .. "descr: " .. friend.descr .. "\n"
    end
    if friend.title_en and friend.title_en ~= "" then
        data = data .. "title_en: " .. friend.title_en .. "\n"
    end
    if friend.descr_en and friend.descr_en ~= "" then
        data = data .. "descr_en: " .. friend.descr_en .. "\n"
    end
    if friend.avatar and friend.avatar ~= "" then
        data = data .. "avatar: " .. friend.avatar .. "\n"
    end
    data = data .. "url: " .. friend.url .. "\n"
    data = data .. "sort_order: " .. (friend.sort_order or 0) .. "\n"
    data = data .. "---\n"
    return data
end

-- Find next available ID
local function next_id()
    local files = utils.list_files(FRIENDS_DIR, "md")
    local max_id = 0
    for _, file in ipairs(files) do
        local f = parse_friend(FRIENDS_DIR .. "/" .. file)
        if f and f.id > max_id then max_id = f.id end
    end
    return max_id + 1
end

-- Generate a filesystem-safe slug from title
local function title_to_slug(title, id)
    local slug = title:lower()
    slug = slug:gsub("[^%w%u%l%s%-]", "")
    slug = slug:gsub("%s+", "-")
    if #slug > 40 then slug = slug:sub(1, 40) end
    if slug == "" then slug = "friend" end
    return id .. "-" .. slug
end

-- List all friends, ordered by sort_order then id
function _M.list()
    local files = utils.list_files(FRIENDS_DIR, "md")
    local friends = {}
    for _, file in ipairs(files) do
        local f = parse_friend(FRIENDS_DIR .. "/" .. file)
        if f then table.insert(friends, f) end
    end
    table.sort(friends, function(a, b)
        if a.sort_order ~= b.sort_order then return (a.sort_order or 0) < (b.sort_order or 0) end
        return a.id < b.id
    end)
    if #friends == 0 then return cjson.empty_array end
    return friends
end

-- Add a friend
function _M.add(title, descr, title_en, descr_en, avatar, url, sort_order)
    local id = next_id()
    local slug = title_to_slug(title, id)
    local friend = {
        id = id,
        title = title,
        descr = descr or "",
        title_en = title_en or "",
        descr_en = descr_en or "",
        avatar = avatar or "",
        url = url or "#",
        sort_order = sort_order or 0,
    }
    local path = FRIENDS_DIR .. "/" .. slug .. ".md"
    local ok = utils.write_file(path, build_friend_file(friend))
    if not ok then return nil, "Failed to write file" end
    return { id = id, title = title, slug = slug }
end

-- Update a friend
function _M.update(id, title, descr, title_en, descr_en, avatar, url, sort_order)
    local files = utils.list_files(FRIENDS_DIR, "md")
    for _, file in ipairs(files) do
        local path = FRIENDS_DIR .. "/" .. file
        local f = parse_friend(path)
        if f and f.id == tonumber(id) then
            f.title = title
            f.descr = descr or ""
            f.title_en = title_en or ""
            f.descr_en = descr_en or ""
            f.avatar = avatar or ""
            f.url = url or "#"
            f.sort_order = sort_order or 0
            -- Rename file if slug changed
            local new_slug = title_to_slug(title, id)
            local new_path = FRIENDS_DIR .. "/" .. new_slug .. ".md"
            if new_path ~= path then
                os.remove(path)
            end
            return utils.write_file(new_path, build_friend_file(f))
        end
    end
    return false
end

-- Delete a friend
function _M.delete(id)
    local files = utils.list_files(FRIENDS_DIR, "md")
    for _, file in ipairs(files) do
        local path = FRIENDS_DIR .. "/" .. file
        local f = parse_friend(path)
        if f and f.id == tonumber(id) then
            os.remove(path)
            return true
        end
    end
    return false
end

return _M
