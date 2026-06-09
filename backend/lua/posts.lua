--[[
  posts.lua — Post loading and parsing module.
  Reads Markdown files from the frontend's posts/ directory,
  parses YAML frontmatter, caches in shared dict.
]]

local utils = require("utils")
local cjson = require("cjson")

local _M = {}

local POSTS_DIR = ngx.config.prefix() .. "../blog/posts"
local PAGES_DIR = ngx.config.prefix() .. "../blog/pages"

-- Parse a single post file into a Lua table
function _M.parse_post(filepath)
    local content, err = utils.read_file(filepath)
    if not content then return nil, err end

    -- Extract frontmatter between --- separators (robust parsing)
    local frontmatter, body
    if content:sub(1, 3) == "---" then
        -- Search for closing "---" as literal string (plain=true avoids pattern issues)
        local start_pos, end_pos = content:find("---", 5, true)
        if start_pos then
            frontmatter = content:sub(5, start_pos - 2)  -- skip \n before ---
            body = content:sub(end_pos + 2)               -- skip ---\n
            -- Skip leading blank lines in body
            body = body:match("^\n*(.*)$") or body
        end
    end

    if not frontmatter or frontmatter == "" then
        -- No frontmatter, treat whole file as body
        local slug = filepath:match("/([^/]+)%.md$")
        return {
            slug = slug,
            title = slug or "Untitled",
            date = "1970-01-01",
            tags = cjson.empty_array,
            categories = cjson.empty_array,
            title_en = "",
            tags_en = cjson.empty_array,
            categories_en = cjson.empty_array,
            content_en = "",
            cover = cjson.null,
            content = content,
            year = 1970,
            month = 1,
            day = 1,
            date_formatted = "1970-01-01",
        }
    end

    local meta = utils.parse_frontmatter(frontmatter)
    local slug = filepath:match("/([^/]+)%.md$")

    -- Build the post object
    local post = {
        slug = slug,
        title = meta.title or slug or "Untitled",
        date = meta.date or "1970-01-01",
        tags = meta.tags or cjson.empty_array,
        categories = meta.categories or cjson.empty_array,
        title_en = meta.title_en or "",
        tags_en = meta.tags_en or cjson.empty_array,
        categories_en = meta.categories_en or cjson.empty_array,
        content_en = meta.content_en or "",
        cover = meta.cover or cjson.null,
        archived = (meta.archived == "true" or meta.archived == true) and true or false,
        content = body,
    }

    -- Parse date for ordering
    local parsed_date = utils.parse_date(post.date)
    if parsed_date then
        post.year = parsed_date.year
        post.month = parsed_date.month
        post.day = parsed_date.day
        post.date_formatted = utils.format_date(parsed_date.year, parsed_date.month, parsed_date.day)
    else
        post.date_formatted = post.date
    end

    return post
end

-- Load all posts, return array sorted by date descending
function _M.load_all()
    local files = utils.list_files(POSTS_DIR, "md")
    local posts = {}

    for _, file in ipairs(files) do
        local post, err = _M.parse_post(POSTS_DIR .. "/" .. file)
        if post then
            table.insert(posts, post)
        else
            ngx.log(ngx.ERR, "Failed to parse post " .. file .. ": " .. (err or "unknown"))
        end
    end

    -- Sort by date descending
    table.sort(posts, function(a, b)
        if a.year and b.year then
            if a.year ~= b.year then return a.year > b.year end
            if a.month and b.month then
                if a.month ~= b.month then return a.month > b.month end
                if a.day and b.day then return a.day > b.day end
            end
        end
        return false
    end)

    return posts
end

-- Load only active (non-archived) posts
function _M.load_active()
    local all = _M.load_all()
    local active = {}
    for _, p in ipairs(all) do
        if not p.archived then
            table.insert(active, p)
        end
    end
    return active
end

-- Load only archived posts
function _M.load_archived()
    local all = _M.load_all()
    local archived = {}
    for _, p in ipairs(all) do
        if p.archived then
            table.insert(archived, p)
        end
    end
    return archived
end

-- Toggle a post's archived status by modifying the .md file
-- Returns true on success
function _M.toggle_archive(slug)
    local filepath = POSTS_DIR .. "/" .. slug .. ".md"
    local content, err = utils.read_file(filepath)
    if not content then return nil, err end

    -- Check if already has archived in frontmatter
    local has_archived = content:match("^---\n.-archived:.-%s*\n---")
    if has_archived then
        -- Toggle the value
        if content:match("archived:%s*true") then
            content = content:gsub("archived:%s*true", "archived: false")
        else
            content = content:gsub("archived:%s*false", "archived: true")
        end
    else
        -- Add archived: true after the first line of frontmatter
        local first_newline = content:find("\n", 4)
        if first_newline then
            content = content:sub(1, first_newline) .. "archived: true\n" .. content:sub(first_newline + 1)
        else
            return nil, "Malformed frontmatter"
        end
    end

    local f, err = io.open(filepath, "w")
    if not f then return nil, err end
    f:write(content)
    f:close()
    return true
end

-- Load a single post by slug
function _M.load_by_slug(slug)
    local filepath = POSTS_DIR .. "/" .. slug .. ".md"
    return _M.parse_post(filepath)
end

-- Load posts for a given tag
function _M.load_by_tag(tag, all_posts)
    local result = {}
    for _, post in ipairs(all_posts) do
        if type(post.tags) == "table" then
            for _, t in ipairs(post.tags) do
                if t == tag then
                    table.insert(result, post)
                    break
                end
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
                if c == cat then
                    table.insert(result, post)
                    break
                end
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

-- Build category index: { cat_name = count, ... }
function _M.build_category_index(all_posts)
    local cats = {}
    for _, post in ipairs(all_posts) do
        if type(post.categories) == "table" then
            for _, cat in ipairs(post.categories) do
                cats[cat] = (cats[cat] or 0) + 1
            end
        end
    end
    return cats
end

-- Group posts by year
function _M.group_by_year(all_posts)
    local groups = {}
    for _, post in ipairs(all_posts) do
        local year = tostring(post.year or "Unknown")
        if not groups[year] then groups[year] = {} end
        table.insert(groups[year], post)
    end
    return groups
end

-- Build a summary (no content) version of a post for listing
function _M.to_summary(post)
    local excerpt = utils.strip_html(post.content or "")
    local excerpt_len = 200
    if post.cover and post.cover ~= cjson.null then
        excerpt_len = 120
    end
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

-- Load a static page (about, talks)
function _M.load_page(slug)
    local filepath = PAGES_DIR .. "/" .. slug .. ".md"
    if not utils.read_file(filepath) then
        return nil
    end
    local post, err = _M.parse_post(filepath)
    if post then
        -- Load English content from separate JSON file if exists
        local en_content = ""
        local en_filepath = PAGES_DIR .. "/" .. slug .. ".en.json"
        local en_data, en_err = utils.read_file(en_filepath)
        if en_data then
            local ok, parsed = pcall(cjson.decode, en_data)
            if ok and parsed and parsed.content_en then
                en_content = parsed.content_en
            end
        end
        return {
            title = post.title,
            content = post.content,
            title_en = post.title_en or "",
            content_en = en_content,
            slug = slug,
        }
    end
    return nil, err
end

return _M
