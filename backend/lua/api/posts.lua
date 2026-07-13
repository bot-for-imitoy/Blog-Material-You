-- /api/posts — list active posts as summaries
local cjson = require("cjson")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local posts_dict = ngx.shared.blog_posts
local raw = posts_dict:get("active_summaries")
if raw then
    ngx.say(raw)
else
    ngx.status = 500
    ngx.say(cjson.encode({ error = "Posts not loaded" }))
end
