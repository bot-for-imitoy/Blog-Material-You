--[[
  config.lua — Blog configuration module.
]]
local _M = {}

_M.data = {
    name = "Blog Material You",
    slogan = "Material You, Your Blog.",
    description = "A blog themed with Material You Design.",
    index_description = "A blog built with MDUI 2 and Material Design 3.",
    title = "Blog Material You",
    avatar = "/img/avatar.png",
    github = "https://github.com/",
    -- Admin credentials (change these in production!)
    admin_user = "admin",
    admin_pass = "bmy2025",

    -- Two-factor authentication (TOTP) secret
    -- Base32-encoded secret for Google Authenticator / Authy
    -- Generate: python3 -c "import base64,os; print(base64.b32encode(os.urandom(10)).decode())"
    -- Or use: openssl rand -base64 8 | base32
    totp_secret = "3KUSEQQC2XMR3OWB",  -- ⚠️ CHANGE THIS in production!

    -- Session token HMAC secret — used to sign bearer tokens
    session_secret = "bmy-session-secret-k8x9m2p4v6",

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
