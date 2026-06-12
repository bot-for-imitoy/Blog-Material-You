--[[
  serve.lua — Serve the SPA with server-side SEO metadata injection.
  For post pages, injects <title>, <meta description>, and OG tags.
  The SPA JS still handles all client-side navigation.
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

ngx.header["Content-Type"] = "text/html; charset=utf-8"

-- Determine the page type from URI
local uri = ngx.var.uri or "/"
local seo_title = "Blog Material You"
local seo_desc = "A simple and elegant blog theme."
local canonical = uri

-- Post pages
local post_slug = uri:match("^/post/([^/]+)")
if post_slug then
    local post = posts.load_post(post_slug)
    if post then
        local t = post.title_en and post.title_en ~= "" and post.title_en or post.title
        local c = post.content_en and post.content_en ~= "" and post.content_en or post.content or ""
        seo_title = h(t) .. " - Blog Material You"
        seo_desc = h(strip_md(c))
    end
end

-- About / Talks
local page_slug = uri:match("^/(about|talks)")
if page_slug then
    local pages_dir = ngx.config.prefix() .. "../blog/pages"
    local f = io.open(pages_dir .. "/" .. page_slug .. ".json", "r")
    if f then
        local ok, data = pcall(cjson.decode, f:read("*a"))
        f:close()
        if ok and data then
            local t = data.title_en and data.title_en ~= "" and data.title_en or data.title or seo_title
            seo_title = h(t) .. " - Blog Material You"
            seo_desc = h(strip_md(data.content or data.content_en or ""))
        end
    end
end

-- Tags / Categories
local tag_slug = uri:match("^/tags/(.+)")
if tag_slug then
    seo_title = h(ngx.unescape_uri(tag_slug)) .. " - " .. seo_title
    seo_desc = "Posts tagged with " .. h(ngx.unescape_uri(tag_slug))
end
local cat_slug = uri:match("^/categories/(.+)")
if cat_slug then
    seo_title = h(ngx.unescape_uri(cat_slug)) .. " - " .. seo_title
    seo_desc = "Posts in category " .. h(ngx.unescape_uri(cat_slug))
end

-- Read and modify the SPA index.html
local f = io.open(ngx.config.prefix() .. "../blog/public/index.html", "r")
if not f then
    ngx.status = 500
    ngx.say("Internal Server Error")
    return
end
local html = f:read("*a")
f:close()

-- Inject SEO tags
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
