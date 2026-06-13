--[[
  ssr.lua — Server-Side Rendering: injects post/page content into the SPA
  shell so search engines see real content (title, meta description, article body).
]]
local cjson = require("cjson")
local posts_module = require("posts")
local _M = {}

-- Read and cache the SPA index.html
local function get_shell()
    local f = io.open(ngx.config.prefix() .. "../blog/public/index.html", "r")
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

    local title = (post.title_en and _LANG == "en") and post.title_en or post.title
    local desc = strip_md(post.content or "")
    local display_title = h(title) .. " - Blog Material You"

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

-- Render a full HTML page for static pages (about, talks)
function _M.render_page(page_slug)
    local shell = get_shell()
    if not shell then return nil end

    -- Load page from API
    local http = require("resty.http")
    -- For simplicity, read page file directly
    local pages_dir = ngx.config.prefix() .. "../blog/pages"
    local f = io.open(pages_dir .. "/" .. page_slug .. ".json", "r")
    if not f then
        f = io.open(pages_dir .. "/" .. page_slug .. ".en.json", "r")
    end
    if not f then return nil end

    local page_data = f:read("*a")
    f:close()
    local ok, page = pcall(cjson.decode, page_data)
    if not ok then return nil end

    local title = page.title or page_slug
    local content = page.content or ""
    local desc = strip_md(content)

    shell = shell:gsub("<title>.-</title>",
        "<title>" .. h(title) .. " - Blog Material You</title>"
        .. '<meta name="description" content="' .. h(desc) .. '">'
    )

    return shell
end

return _M
