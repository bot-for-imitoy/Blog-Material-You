-- /api/talks — list all talks
local cjson = require("cjson")
local talks = require("talks")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

if ngx.req.get_method() == "GET" then
    local list = talks.list()
    ngx.say(cjson.encode(list))
else
    ngx.status = 405
    ngx.say(cjson.encode({ error = "Method not allowed" }))
end
