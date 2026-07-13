-- /api/posts/:slug (single post with full content)
local cjson = require("cjson")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local slug = ngx.var.post_slug
if not slug then
    ngx.status = 400
    ngx.say(cjson.encode({ error = "Missing slug" }))
    return
end

local posts_dict = ngx.shared.blog_posts
local raw = posts_dict:get("post:" .. slug)
if raw then
    ngx.say(raw)
else
    ngx.status = 404
    ngx.say(cjson.encode({ error = "Post not found: " .. slug }))
end
