-- /api/talks — list all talks
local cjson = require("cjson")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local cache = require("cache_loader")
cache.ensure_data_loaded()

if ngx.req.get_method() == "GET" then
    local raw = ngx.shared.blog_pages:get("talks")
    if raw then
        ngx.say(raw)
    else
        -- Fallback: read from files directly
        local talks = require("talks")
        local list = talks.list()
        ngx.say(cjson.encode(list))
    end
else
    ngx.status = 405
    ngx.say(cjson.encode({ error = "Method not allowed" }))
end
