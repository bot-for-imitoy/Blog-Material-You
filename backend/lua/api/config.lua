-- /api/config
local cjson = require("cjson")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "*"
ngx.header["Access-Control-Allow-Methods"] = "GET, OPTIONS"
ngx.header["Access-Control-Allow-Headers"] = "Content-Type"

if ngx.req.get_method() == "OPTIONS" then
    ngx.status = 204
    return
end

local config_dict = ngx.shared.blog_config
local raw = config_dict:get("data")
if raw then
    ngx.say(raw)
else
    ngx.status = 500
    ngx.say(cjson.encode({ error = "Config not loaded" }))
end
