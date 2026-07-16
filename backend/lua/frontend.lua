--[[
  frontend.lua — Full server-rendered frontend (no SPA).
  Replaces serve.lua (SPA shell injection) and api/ssr.lua (HTML fragments).
  All pages are fully rendered on the server via etlua templates.
  Routes match the old api/ssr.lua pattern exactly.
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

-- Set language from Accept-Language header
local accept_lang = ngx.var.http_accept_language or "en"

-- Ensure data is loaded from DB
cache.ensure_data_loaded()

-- Load blog config
local function get_blog_config()
    local raw = ngx.shared.blog_config:get("data")
    if raw then
        local ok, cfg = pcall(cjson.decode, raw)
        if ok and cfg.title then return cfg end
    end
    local cfg_mod = require("config")
    return cfg_mod.get()
end

local blog_cfg = get_blog_config()
local site_title = blog_cfg.title or "Blog"

-- Escape HTML helper
local function h(s)
    if not s then return "" end
    s = tostring(s)
    return s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;")
end

-- Crude markdown → plaintext (for meta description)
local function strip_md(s)
    if not s then return "" end
    s = s:gsub("^#+%s*", ""):gsub("%*%*", ""):gsub("%*", ""):gsub("`", "")
    s = s:gsub("!%[.-%]%(.-%)", ""):gsub("%[.-%]%(.-%)", "%1")
    s = s:gsub("^>%s*", ""):gsub("```.-```", ""):gsub("~~~", "")
    s = s:gsub("%s+", " "):gsub("^%s*(.-)%s*$", "%1")
    if #s > 200 then s = s:sub(1, 200) .. "…" end
    return s
end

-- Parse the request URI
local uri = ngx.var.uri or "/"

-- Helper: render a full page and send it
local function render_page(template, data)
    local html = renderer.render_page(template, data)
    if html then
        ngx.say(html)
    else
        ngx.status = 500
        ngx.say("<!DOCTYPE html><html><body><h1>500 — Internal Server Error</h1></body></html>")
    end
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
if uri == "" or uri == "/" then
    render_page("pages/home", {
        posts = load_active_posts(),
        seo_title = site_title,
        seo_desc = blog_cfg.desc,
        canonical = "/",
    })

-- Posts list
elseif uri == "/posts" or uri == "/posts/" then
    render_page("pages/posts_list", {
        posts = load_active_posts(),
        seo_title = "Posts - " .. site_title,
        seo_desc = blog_cfg.page_posts_desc or "All posts",
        canonical = "/posts/",
    })

-- Single post
elseif uri:match("^/post/(.+)$") then
    local slug = ngx.unescape_uri(uri:match("^/post/(.+)$"))
    slug = slug:gsub("/$", "")
    local post = posts.load_post(slug)
    if post then
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
        local t = post.title_en and post.title_en ~= "" and post.title_en or post.title
        local c = post.content_en and post.content_en ~= "" and post.content_en or post.content or ""
        render_page("pages/post", {
            post = post,
            postTitle = post.title,
            contentHtml = post.content or "",
            cats = cats,
            tags = tags,
            seo_title = h(t) .. " - " .. site_title,
            seo_desc = h(strip_md(c)),
            canonical = "/post/" .. slug,
        })
    else
        ngx.status = 404
        render_page("pages/404", {
            seo_title = "404 - " .. site_title,
            seo_desc = blog_cfg.page_404_desc or "Page not found",
            canonical = uri,
        })
    end

-- Tags list
elseif uri == "/tags" or uri == "/tags/" then
    local all_posts = db_posts.load_all()
    local idx = db_posts.build_tag_index(all_posts)
    local tags_data = {}
    for name, count in pairs(idx) do
        table.insert(tags_data, { name = name, count = count })
    end
    table.sort(tags_data, function(a, b) return a.name < b.name end)
    render_page("pages/tags", {
        tags = tags_data,
        seo_title = "Tags - " .. site_title,
        seo_desc = blog_cfg.page_tags_desc or "All tags",
        canonical = "/tags/",
    })

-- Single tag
elseif uri:match("^/tags/(.+)$") then
    local tag = ngx.unescape_uri(uri:match("^/tags/(.+)$"))
    local all_posts = db_posts.load_all()
    local items = db_posts.load_by_tag(tag, all_posts)
    if type(items) ~= "table" then items = {} end
    render_page("pages/list", {
        title = tag,
        description = tag,
        items = items,
        seo_title = h(tag) .. " - " .. site_title,
        seo_desc = (blog_cfg.tag_posts_desc or "Posts tagged with") .. " " .. h(tag),
        canonical = "/tags/" .. ngx.escape_uri(tag),
    })

-- Categories list
elseif uri == "/categories" or uri == "/categories/" then
    local all_posts = db_posts.load_all()
    local idx = db_posts.build_category_index(all_posts)
    local cats_data = {}
    for name, count in pairs(idx) do
        table.insert(cats_data, { name = name, count = count })
    end
    table.sort(cats_data, function(a, b) return a.name < b.name end)
    render_page("pages/categories", {
        cats = cats_data,
        seo_title = "Categories - " .. site_title,
        seo_desc = blog_cfg.page_categories_desc or "All categories",
        canonical = "/categories/",
    })

-- Single category
elseif uri:match("^/categories/(.+)$") then
    local cat = ngx.unescape_uri(uri:match("^/categories/(.+)$"))
    local all_posts = db_posts.load_all()
    local items = db_posts.load_by_category(cat, all_posts)
    if type(items) ~= "table" then items = {} end
    render_page("pages/list", {
        title = cat,
        description = cat,
        items = items,
        seo_title = h(cat) .. " - " .. site_title,
        seo_desc = (blog_cfg.cat_posts_desc or "Posts in category") .. " " .. h(cat),
        canonical = "/categories/" .. ngx.escape_uri(cat),
    })

-- Archives
elseif uri == "/archives" or uri == "/archives/" then
    local all_posts = db_posts.load_archived()
    local archives_data = db_posts.group_by_year(all_posts)
    render_page("pages/archives", {
        archives = archives_data or {},
        seo_title = "Archives - " .. site_title,
        seo_desc = blog_cfg.page_archives_desc or "All archived posts",
        canonical = "/archives/",
    })

-- About
elseif uri == "/about" or uri == "/about/" then
    local page = db_pages.get("about")
    local content_html = ""
    if page then
        content_html = page.content_en and page.content_en ~= "" and page.content_en or page.content or ""
    end
    local page_title = (page and page.title) or "About"
    local seo_desc_val = ""
    if page then
        seo_desc_val = h(strip_md(page.content_en or page.content or ""))
    end
    render_page("pages/about", {
        page = page or {},
        pageTitle = page_title,
        contentHtml = content_html,
        seo_title = h(page_title) .. " - " .. site_title,
        seo_desc = seo_desc_val ~= "" and seo_desc_val or blog_cfg.desc,
        canonical = "/about/",
    })

-- Talks
elseif uri == "/talks" or uri == "/talks/" then
    local talks_data = db_talks.list()
    if type(talks_data) ~= "table" then talks_data = {} end
    render_page("pages/talks", {
        talks = talks_data,
        seo_title = "Moments - " .. site_title,
        seo_desc = blog_cfg.page_moments_desc or "Moments",
        canonical = "/talks/",
    })

-- Friends
elseif uri == "/friends" or uri == "/friends/" then
    local friends_data = db_friends.list()
    if type(friends_data) ~= "table" then friends_data = {} end
    render_page("pages/friends", {
        list = friends_data,
        seo_title = "Friends - " .. site_title,
        seo_desc = blog_cfg.page_friends_desc or "友情链接",
        canonical = "/friends/",
    })

-- Status
elseif uri == "/status" or uri == "/status/" then
    render_page("pages/status", {
        seo_title = "Status - " .. site_title,
        seo_desc = blog_cfg.page_status_desc or "Service Status",
        canonical = "/status/",
    })

-- Auth
elseif uri == "/auth" or uri == "/auth/" then
    render_page("pages/auth", {
        authed = false,
        seo_title = "Auth - " .. site_title,
        seo_desc = blog_cfg.authDesc or "Visitor authentication",
        canonical = "/auth/",
    })

-- Easter egg / 2048 game
elseif uri == "/easter-egg" or uri == "/easter-egg/" then
    render_page("game/2048", {
        seo_title = "2048 - " .. site_title,
        seo_desc = "2048 game",
        canonical = "/easter-egg/",
    })

-- 404
else
    ngx.status = 404
    render_page("pages/404", {
        seo_title = "404 - " .. site_title,
        seo_desc = blog_cfg.page_404_desc or "Page not found",
        canonical = uri,
    })
end
