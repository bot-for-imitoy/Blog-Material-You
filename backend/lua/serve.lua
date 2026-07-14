--[[
  serve.lua — Serve the SPA with server-side SEO metadata injection.
  Injects <title>, <meta description>, and OG tags for every page type.
  The SPA JS still handles all client-side navigation.
  All data loaded from MariaDB.
]]
local cjson = require("cjson")
local posts = require("posts")

-- Escape HTML
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

-- Read blog config for site title/desc
local function get_blog_config()
    local raw = ngx.shared.blog_config:get("data")
    if raw then
        local ok, cfg = pcall(cjson.decode, raw)
        if ok and cfg.title then return cfg end
    end
    -- Fallback: read from config.lua directly (shared dict not yet initialized)
    local cfg_mod = require("config")
    return cfg_mod.get()
end

ngx.header["Content-Type"] = "text/html; charset=utf-8"

-- Determine the page type from URI
local uri = ngx.var.uri or "/"
local blog_cfg = get_blog_config()
local site_title = blog_cfg.title
local site_desc = blog_cfg.desc
local seo_title = site_title
local seo_desc = site_desc
local canonical = uri

-- Post pages
local post_slug = uri:match("^/post/([^/]+)")
if post_slug then
    local post = posts.load_post(post_slug)
    if post then
        local t = post.title_en and post.title_en ~= "" and post.title_en or post.title
        local c = post.content_en and post.content_en ~= "" and post.content_en or post.content or ""
        seo_title = h(t) .. " - " .. site_title
        seo_desc = h(strip_md(c))
    end
end

-- About / Talks (load from DB via posts.load_page)
local page_slug = uri:match("^/(about|talks)")
if page_slug then
    local page = posts.load_page(page_slug)
    if page then
        local t = page.title_en and page.title_en ~= "" and page.title_en or page.title or site_title
        seo_title = h(t) .. " - " .. site_title
        seo_desc = h(strip_md(page.content_en or page.content or ""))
    end
end

-- Tags / Categories
local tag_slug = uri:match("^/tags/(.+)")
if tag_slug then
    seo_title = h(ngx.unescape_uri(tag_slug)) .. " - " .. site_title
    seo_desc = "Posts tagged with " .. h(ngx.unescape_uri(tag_slug))
end
local cat_slug = uri:match("^/categories/(.+)")
if cat_slug then
    seo_title = h(ngx.unescape_uri(cat_slug)) .. " - " .. site_title
    seo_desc = "Posts in category " .. h(ngx.unescape_uri(cat_slug))
end

-- Friends
if uri == "/friends/" or uri == "/friends" then
    seo_title = "Friends - " .. site_title
    seo_desc = "友情链接"
end

-- Archives
if uri == "/archives/" or uri == "/archives" then
    seo_title = "Archives - " .. site_title
    seo_desc = "所有已归档文章"
end

-- Posts listing
if uri == "/posts/" or uri == "/posts" then
    seo_title = "Posts - " .. site_title
    seo_desc = "博客所有文章"
end

-- Tags listing
if uri == "/tags/" or uri == "/tags" then
    seo_title = "Tags - " .. site_title
    seo_desc = "博客所有标签"
end

-- Categories listing
if uri == "/categories/" or uri == "/categories" then
    seo_title = "Categories - " .. site_title
    seo_desc = "博客所有分类"
end

-- About listing
if uri == "/about/" or uri == "/about" then
    seo_title = "About - " .. site_title
    seo_desc = site_desc
end

-- Talks listing
if uri == "/talks/" or uri == "/talks" then
    seo_title = "Moments - " .. site_title
    seo_desc = "动态"
end

-- Status
if uri == "/status/" or uri == "/status" then
    seo_title = "Status - " .. site_title
    seo_desc = "系统状态 & 设备信息"
end

-- Auth
if uri == "/auth/" or uri == "/auth" then
    seo_title = "Auth - " .. site_title
    seo_desc = "访客认证"
end

-- Read and modify the SPA index.html
local f = io.open(require("utils").blog_dir() .. "/public/index.html", "r")
if not f then
    ngx.status = 500
    ngx.say("Internal Server Error")
    return
end
local html = f:read("*a")
f:close()

-- Inject SEO tags (replaces both existing <title> and any stale meta/og/canonical)
html = html:gsub("<title>.-</title>",
    "<title>" .. seo_title .. "</title>"
    .. '<meta name="description" content="' .. seo_desc .. '">'
    .. '<meta property="og:title" content="' .. seo_title .. '">'
    .. '<meta property="og:description" content="' .. seo_desc .. '">'
    .. '<meta property="og:type" content="website">'
    .. '<link rel="canonical" href="' .. canonical .. '">'
)

-- Set response headers
ngx.header["Content-Length"] = #html
ngx.say(html)