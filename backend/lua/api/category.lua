-- /api/categories/:category (posts for a specific category)
local cjson = require("cjson")
local utils = require("utils")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local cat = utils.url_decode(ngx.var.category_name or "")
if cat == "" then
    ngx.status = 400
    ngx.say(cjson.encode({ error = "Missing category name" }))
    return
end

local posts_dict = ngx.shared.blog_posts
local raw = posts_dict:get("all_full")
if not raw then
    ngx.status = 500
    ngx.say(cjson.encode({ error = "Posts not loaded" }))
    return
end

local all_posts = cjson.decode(raw)
local result = {}
for _, post in ipairs(all_posts) do
    if type(post.categories) == "table" then
        for _, c in ipairs(post.categories) do
            if c == cat then
                table.insert(result, {
                    slug = post.slug,
                    title = post.title,
                    date = post.date_formatted or post.date,
                    tags = post.tags,
                    categories = post.categories,
                    cover = post.cover,
                })
                break
            end
        end
    end
end

ngx.say(cjson.encode(result))
