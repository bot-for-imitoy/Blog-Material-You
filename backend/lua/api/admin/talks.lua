-- /api/admin/talks — CRUD for talks
local cjson = require("cjson")
local talks = require("talks")
local admin_auth = require("admin_auth")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local user = admin_auth.verify_admin()
if not user then
    return
end

if ngx.req.get_method() == "GET" then
    local list = talks.list()
    ngx.say(cjson.encode(list))

elseif ngx.req.get_method() == "POST" then
    ngx.req.read_body()
    local body = ngx.req.get_body_data()
    if not body then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Empty body" }))
        return
    end
    local ok, data = pcall(cjson.decode, body)
    if not ok or not data then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Invalid JSON" }))
        return
    end
    local new_talk = talks.add(data.content or "")
    if new_talk then
        ngx.say(cjson.encode({ errno = 0, data = new_talk }))
    else
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Failed to add talk" }))
    end

elseif ngx.req.get_method() == "PUT" then
    ngx.req.read_body()
    local body = ngx.req.get_body_data()
    if not body then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Empty body" }))
        return
    end
    local ok, data = pcall(cjson.decode, body)
    if not ok or not data or not data.id then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing id" }))
        return
    end
    talks.update(data.id, data.content or "")
    ngx.say(cjson.encode({ errno = 0 }))

elseif ngx.req.get_method() == "DELETE" then
    local id = tonumber(ngx.var.arg_id)
    if not id then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing id" }))
        return
    end
    talks.delete(id)
    ngx.say(cjson.encode({ errno = 0 }))

else
    ngx.status = 405
    ngx.say(cjson.encode({ errno = -1, errmsg = "Method not allowed" }))
end
