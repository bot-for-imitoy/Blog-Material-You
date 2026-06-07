--[[
  config.lua — Blog configuration module.
  Admin credentials are stored encrypted in blog/data/admin.json.
  Sensitive values can also be overridden via environment variables:
    BMY_SESSION_SECRET — HMAC signing key (fallback: hardcoded default)
]]
local _M = {}

local function env(key, default)
    local val = os.getenv(key)
    if val and val ~= "" then return val end
    return default
end

_M.data = {
    name = "Blog Material You",
    slogan = "Material You, Your Blog.",
    description = "A blog themed with Material You Design.",
    index_description = "A blog built with MDUI 2 and Material Design 3.",
    title = "Blog Material You",
    avatar = "/img/avatar.png",
    github = "https://github.com/",

    -- Admin credentials loaded from encrypted store at runtime.
    -- See admin_store.lua and blog/data/admin.json.
    admin_user = "",    -- populated by login.lua
    admin_pass = "",    -- NOT USED for auth; kept for backward compat

    -- Session token HMAC secret (override via BMY_SESSION_SECRET env var)
    session_secret = env("BMY_SESSION_SECRET", "bmy-session-secret-k8x9m2p4v6"),

    menu = {
        { name = "Home",       url = "/",          icon = "/icon/home.svg",    id = "home" },
        { name = "Posts",      url = "/posts/",    icon = "/icon/article.svg", id = "posts",
          page = { name = "Posts", description = "All posts of the blog." } },
        { name = "Tags",       url = "/tags/",     icon = "/icon/tag.svg",     id = "tags",
          page = { name = "Tags", description = "All tags of the blog." } },
        { name = "Moments",    url = "/talks/",    icon = "/icon/chat.svg",    id = "talks",
          page = { name = "Moments", description = "Moments" } },
        { name = "About",      url = "/about/",    icon = "/icon/person.svg",  id = "about" },
        { name = "Categories", url = "/categories/", icon = "/icon/category.svg", id = "categories",
          page = { name = "Categories", description = "All categories of the blog." } },
        { name = "Archives",   url = "/archives/", icon = "/icon/archive.svg", id = "archives",
          page = { name = "Archives", description = "All archived posts" } },
    }
}

function _M.get()
    return _M.data
end

return _M
