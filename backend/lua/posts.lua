--[[
  posts.lua — Post loading and parsing module.
  Now delegates to db_posts (MariaDB) instead of reading Markdown files.
  load_page reads from the 'pages' table via db.query().
]]

local db_posts = require("db_posts")
local db = require("db")

local _M = {}

-- Load all posts, return array sorted by date descending
function _M.load_all()
    return db_posts.load_all()
end

-- Load only active (non-archived) posts
function _M.load_active()
    return db_posts.load_active()
end

-- Load only archived posts
function _M.load_archived()
    return db_posts.load_archived()
end

-- Load a single post by slug
function _M.load_post(slug)
    return db_posts.load_post(slug)
end

-- Toggle a post's archived status
function _M.toggle_archive(slug)
    return db_posts.toggle_archive(slug)
end

-- Load a single post by slug (alias)
function _M.load_by_slug(slug)
    return db_posts.load_post(slug)
end

-- Load posts for a given tag
function _M.load_by_tag(tag, all_posts)
    return db_posts.load_by_tag(tag, all_posts)
end

-- Load posts for a given category
function _M.load_by_category(cat, all_posts)
    return db_posts.load_by_category(cat, all_posts)
end

-- Build tag index: { tag_name = count, ... }
function _M.build_tag_index(all_posts)
    return db_posts.build_tag_index(all_posts)
end

-- Build category index: { cat_name = count, ... }
function _M.build_category_index(all_posts)
    return db_posts.build_category_index(all_posts)
end

-- Group posts by year
function _M.group_by_year(all_posts)
    return db_posts.group_by_year(all_posts)
end

-- Build a summary (no content) version of a post for listing
function _M.to_summary(post)
    return db_posts.to_summary(post)
end

-- Load a static page (about, talks) from the DB 'pages' table
function _M.load_page(slug)
    local res, err = db.query("SELECT * FROM pages WHERE slug = ?", {slug})
    if not res or #res == 0 then
        return nil
    end
    local row = res[1]
    return {
        title = row.title or "",
        content = row.content or "",
        title_en = row.title_en or "",
        content_en = row.content_en or "",
        slug = slug,
    }
end

-- Load English content for a static page from the DB 'pages' table
function _M.load_page_en(slug)
    local res, err = db.query("SELECT * FROM pages WHERE slug = ?", {slug})
    if not res or #res == 0 then
        return nil
    end
    local row = res[1]
    return {
        title_en = row.title_en or "",
        content_en = row.content_en or "",
        slug = slug,
    }
end

return _M