--[[
  config.lua — Blog configuration module.
  Reads sensitive values from environment variables when available:
    BMY_ADMIN_USER     — admin username (fallback: "admin")
    BMY_ADMIN_PASS     — admin password (fallback: "bmy2025")
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

    -- Admin credentials (override via BMY_ADMIN_USER / BMY_ADMIN_PASS env vars)
    admin_user = env("BMY_ADMIN_USER", "admin"),
    admin_pass = env("BMY_ADMIN_PASS", "bmy2025"),

    -- Password hash (HMAC-SHA1 with salt). When set, takes precedence over admin_pass.
    -- Generate: python3 -c "import hmac,hashlib,base64; print(base64.b64encode(hmac.new(b'salt', b'password', hashlib.sha1).digest()).decode())"
    admin_pass_hash = "IKQ8CJhvms/u2Xl2DH1NBDboGIY=",
    admin_pass_salt = "bmy-salt-v1",

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
