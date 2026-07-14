-- /api/pages/:slug (static page like about, talks)
local cjson = require("cjson")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local cache = require("cache_loader")
cache.ensure_data_loaded()

local slug = ngx.var.page_slug
if not slug then
    ngx.status = 400
    ngx.say(cjson.encode({ error = "Missing page slug" }))
    return
end

local pages_dict = ngx.shared.blog_pages
local raw = pages_dict:get("page:" .. slug)
if raw then
    ngx.say(raw)
else
    ngx.status = 404
    ngx.say(cjson.encode({ error = "Page not found: " .. slug }))
end
