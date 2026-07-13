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
    -- Sidebar header
    title = "imitoy's Blog",
    desc = "No blog desc.",

    -- Avatar
    avatar = "/img/avatar.jpg",

    -- Blog info
    github = "https://github.com/imitoy/Blog",

    -- Admin credentials loaded from encrypted store at runtime.
    admin_user = "",
    admin_pass = "",

    -- Session token HMAC secret (default for dev, always override in production)
    session_secret = env("BMY_SESSION_SECRET", "bmy-default-dev-secret-2024"),

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
        {
            text_key = "nav_friends",
            page_title_key = "page_friends",
            page_desc_key = "page_friends_desc",
            icon = "/icon/friends.svg",
            route = "/friends/",
        },
    },
}

function _M.get()
    return _M.data
end

return _M
