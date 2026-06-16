-- /api/admin/reload — Reload blog data into shared dicts
-- Requires admin auth. Call after any write operation.
local cjson = require("cjson")
local admin_auth = require("admin_auth")

ngx.header["Content-Type"] = "application/json"

local user = admin_auth.verify_admin()
if not user then
    return
end

-- Clear the initialization flag so init.lua re-runs
local cache = ngx.shared.blog_cache
cache:delete("initialized")

-- Run init logic
-- We can't directly call init.lua as a function because it's written as init_worker,
-- so we re-execute its logic inline
local utils = require("utils")
local posts = require("posts")
local config = require("config")

ngx.log(ngx.NOTICE, "Blog Material You: Reloading data...")

local cfg = config.get()
ngx.shared.blog_config:set("data", cjson.encode(cfg))

-- Load all posts
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

-- Active post summaries
local active_summaries = {}
for _, p in ipairs(active_posts) do
    table.insert(active_summaries, posts.to_summary(p))
end
pd:set("active_summaries", cjson.encode(active_summaries))

-- Archived post summaries
local archived_summaries = {}
for _, p in ipairs(archived_posts) do
    table.insert(archived_summaries, posts.to_summary(p))
end
pd:set("archived_summaries", cjson.encode(archived_summaries))

-- All posts
pd:set("all_full", cjson.encode(all_posts))

-- Tag and category indices from active posts only
local tag_index = posts.build_tag_index(active_posts)
local cat_index = posts.build_category_index(active_posts)
pd:set("tag_index", cjson.encode(tag_index))
pd:set("cat_index", cjson.encode(cat_index))

-- Archives: archived posts grouped by year
local archives = posts.group_by_year(archived_posts)
pd:set("archives", cjson.encode(archives))

-- Store individual posts for quick lookup
for _, p in ipairs(all_posts) do
    pd:set("post:" .. p.slug, cjson.encode(p))
end

-- Load pages
local pages_dict = ngx.shared.blog_pages
for _, slug in ipairs({"about", "talks"}) do
    local page = posts.load_page(slug)
    if page then
        pages_dict:set("page:" .. slug, cjson.encode(page))
    end
end

-- Reload talks into shared dict
local talks = require("talks")
local talks_list = talks.list()
if #talks_list == 0 then
    pages_dict:set("talks", "[]")
else
    pages_dict:set("talks", cjson.encode(talks_list))
end

-- Reload friends into shared dict
local friends = require("friends")
local friends_list = friends.list()
if #friends_list == 0 then
    pages_dict:set("friends", "[]")
else
    pages_dict:set("friends", cjson.encode(friends_list))
end

cache:set("initialized", 1, 0)
ngx.log(ngx.NOTICE, "Blog Material You: Reloaded " .. #active_posts .. " active + " .. #archived_posts .. " archived posts, "
    .. #talks_list .. " talks, " .. #friends_list .. " friends")

ngx.say(cjson.encode({ errno = 0, data = { active = #active_posts, archived = #archived_posts } }))
