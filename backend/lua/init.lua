--[[
  init.lua — Initialize blog data in shared dicts at worker startup.
  All data loaded from MariaDB instead of files.
  Separates active and archived posts.
]]

local utils = require("utils")
local posts = require("posts")
local config = require("config")
local cjson = require("cjson")

-- Check if we already initialized
local cache = ngx.shared.blog_cache
local init_flag = cache:get("initialized")
if init_flag then
    return
end

ngx.log(ngx.NOTICE, "Blog Material You: Initializing...")

-- Load config
local cfg = config.get()
ngx.shared.blog_config:set("data", cjson.encode(cfg))

-- Load all posts from DB
local all_posts = posts.load_all()
local active_posts = {}
local archived_posts = {}
for _, p in ipairs(all_posts) do
    if p.archived then
        table.insert(archived_posts, p)
    else
        table.insert(active_posts, p)
    end
end

local pd = ngx.shared.blog_posts

-- Active post summaries (for homepage & posts listing)
local active_summaries = {}
for _, p in ipairs(active_posts) do
    table.insert(active_summaries, posts.to_summary(p))
end
pd:set("active_summaries", cjson.encode(active_summaries))

-- Archived post summaries (for archives page)
local archived_summaries = {}
for _, p in ipairs(archived_posts) do
    table.insert(archived_summaries, posts.to_summary(p))
end
pd:set("archived_summaries", cjson.encode(archived_summaries))

-- All posts (for admin & individual lookup)
pd:set("all_full", cjson.encode(all_posts))

-- Build indices from active posts only (tags/categories reflect active)
local tag_index = posts.build_tag_index(active_posts)
local cat_index = posts.build_category_index(active_posts)
pd:set("tag_index", cjson.encode(tag_index))
pd:set("cat_index", cjson.encode(cat_index))

-- Archives: only archived posts grouped by year
local archives = posts.group_by_year(archived_posts)
pd:set("archives", cjson.encode(archives))

-- Store individual posts for quick lookup
for _, p in ipairs(all_posts) do
    pd:set("post:" .. p.slug, cjson.encode(p))
end

-- Load pages from DB
local pages_dict = ngx.shared.blog_pages
for _, slug in ipairs({"about", "talks"}) do
    local page = posts.load_page(slug)
    if page then
        pages_dict:set("page:" .. slug, cjson.encode(page))
    end
end

-- Load talks from DB
local db_talks = require("db_talks")
local talks_list = db_talks.list()
if #talks_list == 0 then
    pages_dict:set("talks", "[]")
else
    pages_dict:set("talks", cjson.encode(talks_list))
end

-- Load friends from DB
local db_friends = require("db_friends")
local friends_list = db_friends.list()
pages_dict:set("friends", cjson.encode(friends_list))

cache:set("initialized", 1, 0)
ngx.log(ngx.NOTICE, "Blog Material You: " .. #active_posts .. " active + " .. #archived_posts .. " archived posts, "
    .. #talks_list .. " talks, " .. #friends_list .. " friends")