--[[
  ssr.lua — Server-Side Rendering: injects post/page content into the SPA
  shell so search engines see real content (title, meta description, article body).
  All data loaded from MariaDB via posts module.
]]
local cjson = require("cjson")
local posts_module = require("posts")
local _M = {}

-- Read site title from config
local function get_site_title()
    local raw = ngx.shared.blog_config:get("data")
    if raw then
        local ok, cfg = pcall(cjson.decode, raw)
        if ok and cfg.title then return cfg.title end
    end
    local cfg_mod = require("config")
    return cfg_mod.get().title or "Blog"
end

local site_title = get_site_title()

-- Read and cache the SPA index.html
local function get_shell()
    local f = io.open(require("utils").blog_dir() .. "/public/index.html", "r")
    if not f then
        ngx.log(ngx.ERR, "ssr: cannot open index.html")
        return nil
    end
    local content = f:read("*a")
    f:close()
    return content
end

-- Escape HTML special chars
local function h(s)
    if not s then return "" end
    s = tostring(s)
    s = s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;")
    return s
end

-- Strip markdown (crude but good enough for meta description)
local function strip_md(s)
    if not s then return "" end
    s = s:gsub("^#+%s*", ""):gsub("%*%*", ""):gsub("%*", ""):gsub("`", "")
    s = s:gsub("!%[.-%]%(.-%)", ""):gsub("%[.-%]%(.-%)", "%1")
    s = s:gsub("^>%s*", ""):gsub("```.-```", ""):gsub("~~~", "")
    s = s:gsub("%s+", " "):gsub("^%s*(.-)%s*$", "%1")
    if #s > 200 then s = s:sub(1, 200) .. "…" end
    return s
end

-- Render a full HTML page for a post
function _M.render_post(slug)
    local shell = get_shell()
    if not shell then
        ngx.status = 500
        return "Internal Server Error"
    end

    local post = posts_module.load_post(slug)
    if not post then
        ngx.status = 404
        return "Not Found"
    end

    local title = post.title_en and post.title_en ~= "" and post.title_en or post.title
    local desc = strip_md(post.content or "")
    local display_title = h(title) .. " - " .. site_title

    -- Inject SEO tags into <head>
    shell = shell:gsub("<title>.-</title>",
        "<title>" .. display_title .. "</title>"
        .. '<meta name="description" content="' .. h(desc) .. '">'
        .. '<meta property="og:title" content="' .. h(title) .. '">'
        .. '<meta property="og:description" content="' .. h(desc) .. '">'
        .. '<meta property="og:type" content="article">'
        .. '<meta name="twitter:card" content="summary">'
    )

    -- Wrap post content in <article> for SEO, appended to the loading area
    local content_html = h(title) .. "\n\n" .. desc
    shell = shell:gsub('id="content-container"[^>]*>',
        'id="content-container" data-ssr="' .. h(slug) .. '">'
        .. '<article><h1>' .. h(title) .. '</h1><p>' .. h(desc) .. '</p></article>'
    )

    return shell
end

-- Render a full HTML page for static pages (about, talks) via DB
function _M.render_page(page_slug)
    local shell = get_shell()
    if not shell then return nil end

    -- Load page from DB via posts module
    local page = posts_module.load_page(page_slug)
    if not page then return nil end

    local title = page.title_en and page.title_en ~= "" and page.title_en or page.title or page_slug
    local content = page.content_en and page.content_en ~= "" and page.content_en or page.content or ""
    local desc = strip_md(content)

    shell = shell:gsub("<title>.-</title>",
        "<title>" .. h(title) .. " - " .. site_title .. "</title>"
        .. '<meta name="description" content="' .. h(desc) .. '">'
    )

    return shell
end

return _M