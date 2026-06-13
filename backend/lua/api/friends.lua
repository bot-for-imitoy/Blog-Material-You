-- /api/friends — GET list of friend links
local cjson = require("cjson")
local friends = require("friends")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local list = friends.list()
ngx.say(cjson.encode(list))
