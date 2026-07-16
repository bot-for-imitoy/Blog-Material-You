-- /api/admin/talks — CRUD for talks (MariaDB-backed via db_talks)
local cjson = require("cjson")
cjson.encode_empty_table_as_array(true)
local db_talks = require("db_talks")
local admin_auth = require("admin_auth")
local utils = require("utils")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local user = admin_auth.verify_admin()
if not user then
    return
end

if ngx.req.get_method() == "GET" then
    local list = db_talks.list()
    if #list == 0 then list = cjson.empty_array end
    ngx.say(cjson.encode({ errno = 0, data = list }))

elseif ngx.req.get_method() == "POST" then
    local body, err = utils.read_request_body()
    if not body then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = err or "Empty body" }))
        return
    end
    local ok, data = pcall(cjson.decode, body)
    if not ok or not data then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Invalid JSON" }))
        return
    end
    local new_talk = db_talks.add(data.content or "")
    if new_talk then
        ngx.say(cjson.encode({ errno = 0, data = new_talk }))
    else
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Failed to add talk" }))
    end

elseif ngx.req.get_method() == "DELETE" then
    local body, err = utils.read_request_body()
    if not body then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = err or "Empty body" }))
        return
    end
    local ok, data = pcall(cjson.decode, body)
    if not ok or not data or not data.id then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing id" }))
        return
    end
    db_talks.delete(data.id)
    ngx.say(cjson.encode({ errno = 0, data = { deleted = true } }))

else
    ngx.status = 405
    ngx.say(cjson.encode({ errno = -1, errmsg = "Method not allowed" }))
end