--[[
  config.lua — Blog configuration module.
  All user-facing text uses locale keys (translated in locales.yml).
  The menu defines the sidebar navigation — each item refers to a locale key.
]]
local _M = {}

local function env(key, default)
    local val = os.getenv(key)
    if val and val ~= "" then return val end
    return default
end

_M.data = {
    -- Sidebar header (locale keys)
    name_key = "site_name",
    desc_key = "site_desc",

    -- Avatar
    avatar = "/img/avatar.png",

    -- Blog info
    title = "Blog Material You",
    github = "https://github.com/",

    -- Admin credentials loaded from encrypted store at runtime.
    admin_user = "",
    admin_pass = "",

    -- Session token HMAC secret
    session_secret = env("BMY_SESSION_SECRET", nil),

    -- Sidebar navigation menu
    -- Each item: { text_key, page_title_key?, page_desc_key?, icon, route }
    -- If page_desc_key is omitted or empty, the description element is hidden.
    menu = {
        {
            text_key = "nav_home",
            page_title_key = nil,
            page_desc_key = nil,
            icon = "/icon/home.svg",
            route = "/",
        },
        {
            text_key = "nav_posts",
            page_title_key = "page_posts",
            page_desc_key = "page_posts_desc",
            icon = "/icon/article.svg",
            route = "/posts/",
        },
        {
            text_key = "nav_tags",
            page_title_key = "page_tags",
            page_desc_key = "page_tags_desc",
            icon = "/icon/tag.svg",
            route = "/tags/",
        },
        {
            text_key = "nav_categories",
            page_title_key = "page_categories",
            page_desc_key = "page_categories_desc",
            icon = "/icon/category.svg",
            route = "/categories/",
        },
        {
            text_key = "nav_moments",
            page_title_key = "page_moments",
            page_desc_key = "page_moments_desc",
            icon = "/icon/chat.svg",
            route = "/talks/",
        },
        {
            text_key = "nav_about",
            page_title_key = nil,
            page_desc_key = nil,
            icon = "/icon/person.svg",
            route = "/about/",
        },
        {
            text_key = "nav_archives",
            page_title_key = "page_archives",
            page_desc_key = "page_archives_desc",
            icon = "/icon/archive.svg",
            route = "/archives/",
        },
    },
}

function _M.get()
    return _M.data
end

return _M
