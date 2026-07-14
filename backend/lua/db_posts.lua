--[[
  db_posts.lua — Post CRUD using MariaDB.
  Replaces file-based blog/posts/*.md storage.
  Tags/categories stored as JSON arrays in TEXT columns.
]]
local db = require("db")
local cjson = require("cjson")
local utils = require("utils")
local _M = {}

-- Parse a DB row into a post object (matches the old file-based format)
local function row_to_post(row)
    local function parse_json_list(val)
        if not val or val == "" then return cjson.empty_array end
        local ok, parsed = pcall(cjson.decode, val)
        if ok and type(parsed) == "table" then
            if #parsed == 0 then return cjson.empty_array end
            return parsed
        end
        return cjson.empty_array
    end

    local post = {
        slug = row.slug,
        title = row.title,
        date = row.date or "1970-01-01",
        tags = parse_json_list(row.tags),
        categories = parse_json_list(row.categories),
        cover = row.cover or cjson.null,
        archived = (row.archived and row.archived > 0) and true or false,
        content = row.content or "",
        title_en = row.title_en or "",
        tags_en = parse_json_list(row.tags_en),
        categories_en = parse_json_list(row.categories_en),
        content_en = row.content_en or "",
    }

    -- Parse date fields
    local y, m, d = row.date:match("^(%d+)%-(%d+)%-(%d+)$")
    if y then
        post.year = tonumber(y)
        post.month = tonumber(m)
        post.day = tonumber(d)
        post.date_formatted = row.date
    else
        post.date_formatted = row.date
    end

    return post
end

-- Convert a post to summary (no content, with excerpt)
function _M.to_summary(post)
    local excerpt = post.content and post.content:gsub("<[^>]+>", "") or ""
    local excerpt_len = 200
    if post.cover and post.cover ~= cjson.null then excerpt_len = 120 end
    return {
        slug = post.slug,
        title = post.title,
        date = post.date_formatted or post.date,
        tags = post.tags,
        categories = post.categories,
        title_en = post.title_en,
        tags_en = post.tags_en,
        categories_en = post.categories_en,
        content_en = post.content_en,
        cover = post.cover,
        excerpt = utils.truncate(excerpt, excerpt_len),
    }
end

-- Load all posts sorted by date descending
function _M.load_all()
    local res, err = db.query("SELECT * FROM posts ORDER BY `date` DESC, slug ASC")
    if not res then return {} end
    local posts = {}
    for _, row in ipairs(res) do
        table.insert(posts, row_to_post(row))
    end
    return posts
end

-- Load active (non-archived) posts
function _M.load_active()
    local res, err = db.query("SELECT * FROM posts WHERE archived=0 ORDER BY `date` DESC, slug ASC")
    if not res then return {} end
    local posts = {}
    for _, row in ipairs(res) do
        table.insert(posts, row_to_post(row))
    end
    return posts
end

-- Load archived posts
function _M.load_archived()
    local res, err = db.query("SELECT * FROM posts WHERE archived=1 ORDER BY `date` DESC, slug ASC")
    if not res then return {} end
    local posts = {}
    for _, row in ipairs(res) do
        table.insert(posts, row_to_post(row))
    end
    return posts
end

-- Load a single post by slug
function _M.load_post(slug)
    local res, err = db.query("SELECT * FROM posts WHERE slug = ?", {slug})
    if not res or #res == 0 then return nil end
    return row_to_post(res[1])
end

-- Load posts for a given tag (tag stored as JSON array)
function _M.load_by_tag(tag, all_posts)
    local result = {}
    for _, post in ipairs(all_posts) do
        if type(post.tags) == "table" then
            for _, t in ipairs(post.tags) do
                if t == tag then table.insert(result, post); break end
            end
        end
    end
    return result
end

-- Load posts for a given category
function _M.load_by_category(cat, all_posts)
    local result = {}
    for _, post in ipairs(all_posts) do
        if type(post.categories) == "table" then
            for _, c in ipairs(post.categories) do
                if c == cat then table.insert(result, post); break end
            end
        end
    end
    return result
end

-- Build tag index: { tag_name = count, ... }
function _M.build_tag_index(all_posts)
    local tags = {}
    for _, post in ipairs(all_posts) do
        if type(post.tags) == "table" then
            for _, t in ipairs(post.tags) do
                tags[t] = (tags[t] or 0) + 1
            end
        end
    end
    return tags
end

-- Build category index
function _M.build_category_index(all_posts)
    local cats = {}
    for _, post in ipairs(all_posts) do
        if type(post.categories) == "table" then
            for _, c in ipairs(post.categories) do
                cats[c] = (cats[c] or 0) + 1
            end
        end
    end
    return cats
end

-- Group posts by year (for archives)
function _M.group_by_year(all_posts)
    local groups = {}
    for _, post in ipairs(all_posts) do
        local year = tostring(post.year or "Unknown")
        if not groups[year] then groups[year] = {} end
        table.insert(groups[year], post)
    end
    return groups
end

-- Create a new post
function _M.create(data)
    local slug = data.slug
    local now = os.time()
    local tags_json = cjson.encode(data.tags or {})
    local cats_json = cjson.encode(data.categories or {})
    local tags_en_json = cjson.encode(data.tags_en or {})
    local cats_en_json = cjson.encode(data.categories_en or {})

    local res, err = db.query(
        "INSERT INTO posts (slug, title, content, `date`, tags, categories, cover, archived, title_en, content_en, tags_en, categories_en, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)",
        {slug, data.title or "", data.content or "", data.date or "", tags_json, cats_json, data.cover or "",
         data.title_en or "", data.content_en or "", tags_en_json, cats_en_json, now, now}
    )
    if not res then return nil, err end
    return {slug = slug, title = data.title}
end

-- Update an existing post
function _M.update(data)
    local slug = data.slug
    local now = os.time()
    local tags_json = cjson.encode(data.tags or {})
    local cats_json = cjson.encode(data.categories or {})
    local tags_en_json = cjson.encode(data.tags_en or {})
    local cats_en_json = cjson.encode(data.categories_en or {})

    local res, err = db.query(
        "UPDATE posts SET title=?, content=?, `date`=?, tags=?, categories=?, cover=?, title_en=?, content_en=?, tags_en=?, categories_en=?, updated_at=? WHERE slug=?",
        {data.title or "", data.content or "", data.date or "", tags_json, cats_json, data.cover or "",
         data.title_en or "", data.content_en or "", tags_en_json, cats_en_json, now, slug}
    )
    return res ~= nil, err
end

-- Delete a post
function _M.delete(slug)
    local res, err = db.query("DELETE FROM posts WHERE slug = ?", {slug})
    return res ~= nil, err
end

-- Toggle archive status
function _M.toggle_archive(slug)
    -- Toggle: SET archived = NOT archived
    local res, err = db.query("UPDATE posts SET archived = CASE WHEN archived=0 THEN 1 ELSE 0 END, updated_at=? WHERE slug=?", {os.time(), slug})
    if not res then return nil, err end
    return true
end

-- Check if a post exists
function _M.exists(slug)
    local res, err = db.query("SELECT 1 FROM posts WHERE slug = ?", {slug})
    return res and #res > 0
end

return _M