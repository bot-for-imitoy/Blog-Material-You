--[[
  cache_loader.lua — Lazy-load blog data from MariaDB into shared dicts.
  Called from API handlers on first request after worker startup.
  Only runs once per worker (checks blog_cache "data_loaded" flag).
]]
local posts = require("posts")
local cjson = require("cjson")

local _M = {}

function _M.ensure_data_loaded()
    local cache = ngx.shared.blog_cache
    local loaded = cache:get("data_loaded")
    if loaded then return true end

    ngx.log(ngx.NOTICE, "Cache loader: Loading blog data from MariaDB...")

    -- Load all posts from DB
    local all_posts = posts.load_all()
    local active_posts = {}
    local archived_posts = {}
    for _, p in ipairs(all_posts) do
        if p.archived then table.insert(archived_posts, p)
        else table.insert(active_posts, p) end
    end

    local pd = ngx.shared.blog_posts

    -- Active summaries
    local active_summaries = {}
    for _, p in ipairs(active_posts) do
        table.insert(active_summaries, posts.to_summary(p))
    end
    pd:set("active_summaries", cjson.encode(active_summaries))

    -- Archived summaries
    local archived_summaries = {}
    for _, p in ipairs(archived_posts) do
        table.insert(archived_summaries, posts.to_summary(p))
    end
    pd:set("archived_summaries", cjson.encode(archived_summaries))

    -- All full posts
    pd:set("all_full", cjson.encode(all_posts))

    -- Tag/category indices from active only
    local tag_index = posts.build_tag_index(active_posts)
    local cat_index = posts.build_category_index(active_posts)
    pd:set("tag_index", cjson.encode(tag_index))
    pd:set("cat_index", cjson.encode(cat_index))

    -- Archives
    local archives = posts.group_by_year(archived_posts)
    pd:set("archives", cjson.encode(archives))

    -- Individual posts
    for _, p in ipairs(all_posts) do
        pd:set("post:" .. p.slug, cjson.encode(p))
    end

    -- Pages
    local pages_dict = ngx.shared.blog_pages
    for _, slug in ipairs({"about", "talks"}) do
        local page = posts.load_page(slug)
        if page then
            pages_dict:set("page:" .. slug, cjson.encode(page))
        end
    end

    -- Talks
    local db_talks = require("db_talks")
    local ok_talks, talks_list = pcall(function() return db_talks.list() end)
    local talks_data = {}
    if ok_talks and type(talks_list) == "table" then
        for _, t in ipairs(talks_list) do table.insert(talks_data, t) end
    end
    pages_dict:set("talks", cjson.encode(talks_data))

    -- Friends
    local db_friends = require("db_friends")
    local friends_list = db_friends.list()
    if type(friends_list) ~= "table" then friends_list = {} end
    pages_dict:set("friends", cjson.encode(friends_list))

    cache:set("data_loaded", 1, 0)
    ngx.log(ngx.NOTICE, "Cache loader: Loaded " .. #all_posts .. " posts, " .. #talks_data .. " talks, " .. #friends_list .. " friends")
    return true
end

return _M