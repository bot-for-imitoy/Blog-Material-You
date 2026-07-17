--[[
  seo.lua — Compute per-route SEO title/description from blog config + DB.
  Shared by serve.lua (full shell render) and api/ssr.lua (X-SSR-Title header)
  so the values always come from the Lua backend, never from client JS.
  Returns UNESCAPED plain strings; the etlua template escapes them.
]]
local cjson = require("cjson")
local posts = require("posts")

local _M = {}

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

-- route: URI path with any /api/ssr prefix already stripped,
-- e.g. "/", "/posts/", "/post/my-slug", "/tags/lua"
function _M.for_route(route)
    local cfg = get_blog_config()
    local site_title = cfg.title or "Blog"
    local site_desc = cfg.desc or ""
    local title = site_title
    local desc = site_desc

    route = route or "/"

    -- Single post
    local post_slug = route:match("^/post/([^/]+)")
    if post_slug then
        local post = posts.load_post(ngx.unescape_uri(post_slug))
        if post then
            local t = (post.title_en and post.title_en ~= "") and post.title_en or post.title
            local c = (post.content_en and post.content_en ~= "") and post.content_en or post.content or ""
            title = tostring(t) .. " - " .. site_title
            desc = strip_md(c)
        end

    -- Listing pages (exact match, with or without trailing slash)
    elseif route == "/posts/" or route == "/posts" then
        title = "Posts - " .. site_title
        desc = "博客所有文章"
    elseif route == "/tags/" or route == "/tags" then
        title = "Tags - " .. site_title
        desc = "博客所有标签"
    elseif route == "/categories/" or route == "/categories" then
        title = "Categories - " .. site_title
        desc = "博客所有分类"
    elseif route == "/archives/" or route == "/archives" then
        title = "Archives - " .. site_title
        desc = "所有已归档文章"
    elseif route == "/friends/" or route == "/friends" then
        title = "Friends - " .. site_title
        desc = "友情链接"
    elseif route == "/about/" or route == "/about" then
        title = "About - " .. site_title
        desc = site_desc
    elseif route == "/talks/" or route == "/talks" then
        title = "Moments - " .. site_title
        desc = "动态"
    elseif route == "/status/" or route == "/status" then
        title = "Status - " .. site_title
        desc = "系统状态 & 设备信息"
    elseif route == "/auth/" or route == "/auth" then
        title = "Auth - " .. site_title
        desc = "访客认证"

    -- Single tag / category
    else
        local tag_slug = route:match("^/tags/(.+)")
        local cat_slug = route:match("^/categories/(.+)")
        if tag_slug then
            local tag = ngx.unescape_uri(tag_slug):gsub("/$", "")
            title = tag .. " - " .. site_title
            desc = "Posts tagged with " .. tag
        elseif cat_slug then
            local cat = ngx.unescape_uri(cat_slug):gsub("/$", "")
            title = cat .. " - " .. site_title
            desc = "Posts in category " .. cat
        end
    end

    return { title = title, desc = desc }
end

return _M
