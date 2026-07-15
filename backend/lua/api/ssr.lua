--[[
  /api/ssr — Server-Side Rendering API for all page types.
  Routes /api/ssr/* requests to the appropriate template and returns HTML fragments.
  The SPA frontend fetches these and injects them into the DOM.
]]
local cjson = require("cjson")
local renderer = require("renderer")
local cache = require("cache_loader")
local posts = require("posts")
local talks_mod = require("talks")
local friends_mod = require("friends")
local db_posts = require("db_posts")
local db_pages = require("db_pages")
local db_talks = require("db_talks")
local db_friends = require("db_friends")

ngx.header["Content-Type"] = "text/html; charset=utf-8"
ngx.header["X-SSR"] = "1"

-- Set language from Accept-Language header
local accept_lang = ngx.var.http_accept_language or "en"

-- Ensure data is loaded from DB
cache.ensure_data_loaded()

-- Parse the SSR path
local uri = ngx.var.uri or "/"
-- Strip /api/ssr prefix and normalize
local route = uri:gsub("^/api/ssr", "")
-- Normalize: empty should be "/" for root matching
if route == "" then route = "/" end

-- Helper: render with error handling
local function render_or_404(template, data)
    local html = renderer.render(template, data)
    if not html then
        html = renderer.render("pages/404", {}) or "<h1>404 — Page Not Found</h1>"
    end
    ngx.say(html)
end

-- Helper: load active posts from shared dict
local function load_active_posts()
    local raw = ngx.shared.blog_posts:get("active_summaries")
    if raw then
        local ok, data = pcall(cjson.decode, raw)
        if ok then return data end
    end
    return {}
end

-- ===== Routes =====

-- Home
if route == "" or route == "/" then
    render_or_404("pages/home", { posts = load_active_posts() })

-- Posts list
elseif route == "/posts" or route == "/posts/" then
    render_or_404("pages/posts_list", { posts = load_active_posts() })

-- Single post
elseif route:match("^/post/(.+)$") then
    local slug = ngx.unescape_uri(route:match("^/post/(.+)$"))
    -- Strip trailing slash
    slug = slug:gsub("/$", "")
    local post = posts.load_post(slug)
    if post then
        -- Ensure cats/tags are arrays, not JSON strings from DB
        local cats = post.categories
        if type(cats) == "string" then
            local ok, decoded = pcall(cjson.decode, cats)
            cats = ok and decoded or {}
        elseif type(cats) ~= "table" then
            cats = {}
        end
        local tags = post.tags
        if type(tags) == "string" then
            local ok, decoded = pcall(cjson.decode, tags)
            tags = ok and decoded or {}
        elseif type(tags) ~= "table" then
            tags = {}
        end
        render_or_404("pages/post", {
            post = post,
            postTitle = post.title,
            contentHtml = post.content or "",
            cats = cats,
            tags = tags,
        })
    else
        ngx.status = 404
        render_or_404("pages/404", {})
    end

-- Tags list
elseif route == "/tags" or route == "/tags/" then
    local all_posts = db_posts.load_all()
    local idx = db_posts.build_tag_index(all_posts)
    -- Convert hash {name=count} to array of {name, count} for template
    local tags_data = {}
    for name, count in pairs(idx) do
        table.insert(tags_data, { name = name, count = count })
    end
    table.sort(tags_data, function(a, b) return a.name < b.name end)
    render_or_404("pages/tags", { tags = tags_data })

-- Single tag
elseif route:match("^/tags/(.+)$") then
    local tag = ngx.unescape_uri(route:match("^/tags/(.+)$"))
    local all_posts = db_posts.load_all()
    local items = db_posts.load_by_tag(tag, all_posts)
    if type(items) ~= "table" then items = {} end
    render_or_404("pages/list", {
        title = tag,
        description = tag,
        items = items,
    })

-- Categories list
elseif route == "/categories" or route == "/categories/" then
    local all_posts = db_posts.load_all()
    local idx = db_posts.build_category_index(all_posts)
    -- Convert hash to array of {name, count}
    local cats_data = {}
    for name, count in pairs(idx) do
        table.insert(cats_data, { name = name, count = count })
    end
    table.sort(cats_data, function(a, b) return a.name < b.name end)
    render_or_404("pages/categories", { cats = cats_data })

-- Single category
elseif route:match("^/categories/(.+)$") then
    local cat = ngx.unescape_uri(route:match("^/categories/(.+)$"))
    local all_posts = db_posts.load_all()
    local items = db_posts.load_by_category(cat, all_posts)
    if type(items) ~= "table" then items = {} end
    render_or_404("pages/list", {
        title = cat,
        description = cat,
        items = items,
    })

-- Archives
elseif route == "/archives" or route == "/archives/" then
    local all_posts = db_posts.load_archived()
    local archives_data = db_posts.group_by_year(all_posts)
    render_or_404("pages/archives", { archives = archives_data or {} })

-- About
elseif route == "/about" or route == "/about/" then
    local page = db_pages.get("about")
    render_or_404("pages/about", {
        page = page or {},
        pageTitle = (page and page.title) or "About",
        contentHtml = (page and page.content) or "",
    })

-- Talks
elseif route == "/talks" or route == "/talks/" then
    local talks_data = db_talks.list()
    -- Convert userdata to table if needed
    if type(talks_data) ~= "table" then talks_data = {} end
    render_or_404("pages/talks", { talks = talks_data })

-- Friends
elseif route == "/friends" or route == "/friends/" then
    local friends_data = db_friends.list()
    -- Convert userdata to table if needed
    if type(friends_data) ~= "table" then friends_data = {} end
    render_or_404("pages/friends", { list = friends_data })

-- Status
elseif route == "/status" or route == "/status/" then
    render_or_404("pages/status", {})

-- Auth
elseif route == "/auth" or route == "/auth/" then
    render_or_404("pages/auth", { authed = false })

-- Easter egg / 2048 game
elseif route == "/easter-egg" or route == "/easter-egg/" then
    render_or_404("game/2048", {})

-- 404
else
    ngx.status = 404
    render_or_404("pages/404", {})
end
