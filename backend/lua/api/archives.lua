-- /api/archives — archived posts grouped by year
local cjson = require("cjson")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "*"

local posts_dict = ngx.shared.blog_posts
local raw = posts_dict:get("archives")
if raw then
    ngx.say(raw)
else
    ngx.status = 500
    ngx.say(cjson.encode({ error = "Archives not loaded" }))
end
