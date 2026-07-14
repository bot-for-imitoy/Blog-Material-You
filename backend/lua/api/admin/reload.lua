-- /api/admin/reload — Reload blog data into shared dicts from MariaDB
-- Requires admin auth. Call after any write operation.
local cjson = require("cjson")
local admin_auth = require("admin_auth")

ngx.header["Content-Type"] = "application/json"

local user = admin_auth.verify_admin()
if not user then
    return
end

-- Clear the initialization flag so init logic re-runs on next worker init,
-- but for this request we do the reload inline.
local cache = ngx.shared.blog_cache
cache:delete("initialized")

local utils = require("utils")
local posts = require("posts")
local config = require("config")

ngx.log(ngx.NOTICE, "Blog Material You: Reloading data...")

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

-- Load pages from DB
local pages_dict = ngx.shared.blog_pages
for _, slug in ipairs({"about", "talks"}) do
    local page = posts.load_page(slug)
    if page then
        pages_dict:set("page:" .. slug, cjson.encode(page))
    end
end

-- Reload talks from DB
local db_talks = require("db_talks")
local talks_raw = db_talks.list()
local talks_list = {}
if type(talks_raw) == "table" then
    for _, t in ipairs(talks_raw) do table.insert(talks_list, t) end
end
if #talks_list == 0 then
    pages_dict:set("talks", "[]")
else
    pages_dict:set("talks", cjson.encode(talks_list))
end

-- Reload friends from DB
local db_friends = require("db_friends")
local friends_raw = db_friends.list()
local friends_list = {}
if type(friends_raw) == "table" then
    for _, f in ipairs(friends_raw) do table.insert(friends_list, f) end
end
if #friends_list == 0 then
    pages_dict:set("friends", "[]")
else
    pages_dict:set("friends", cjson.encode(friends_list))
end

cache:set("initialized", 1, 0)
cache:set("data_loaded", 1, 0)
ngx.log(ngx.NOTICE, "Blog Material You: Reloaded " .. #active_posts .. " active + " .. #archived_posts .. " archived posts, "
    .. #talks_list .. " talks, " .. #friends_list .. " friends")

ngx.say(cjson.encode({ errno = 0, data = { active = #active_posts, archived = #archived_posts } }))