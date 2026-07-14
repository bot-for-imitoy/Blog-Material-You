-- /api/friends — list all friends
local cjson = require("cjson")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local cache = require("cache_loader")
cache.ensure_data_loaded()

local raw = ngx.shared.blog_pages:get("friends")
if raw then
    ngx.say(raw)
else
    local friends = require("friends")
    local list = friends.list()
    ngx.say(cjson.encode(list))
end
