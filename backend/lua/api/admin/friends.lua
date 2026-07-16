-- /api/admin/friends — Admin CRUD for friend links
-- GET    → list
-- POST   → add   { title, descr, avatar, url, sort_order }
-- PUT    → update { id, title, descr, avatar, url, sort_order }
-- DELETE → delete { id }
local cjson = require("cjson")
cjson.encode_empty_table_as_array(true)
local friends = require("friends")
local admin_auth = require("admin_auth")
local utils = require("utils")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local user = admin_auth.verify_admin()
if not user then return end

local method = ngx.req.get_method()

if method == "GET" then
    local list = friends.list()
    if #list == 0 then list = cjson.empty_array end
    ngx.say(cjson.encode({ errno = 0, data = list }))
    return
end

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

if method == "POST" then
    if not data.title or not data.url then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing title or url" }))
        return
    end
    local r, err = friends.add(data.title, data.descr, data.title_en, data.descr_en, data.avatar, data.url, data.sort_order)
    if r then
        ngx.say(cjson.encode({ errno = 0, data = r }))
    else
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = err or "Failed" }))
    end

elseif method == "PUT" then
    if not data.id or not data.title or not data.url then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing fields" }))
        return
    end
    local ok2 = friends.update(data.id, data.title, data.descr, data.title_en, data.descr_en, data.avatar, data.url, data.sort_order)
    ngx.say(cjson.encode({ errno = ok2 and 0 or -1, data = { updated = ok2 } }))

elseif method == "DELETE" then
    if not data.id then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing id" }))
        return
    end
    friends.delete(data.id)
    ngx.say(cjson.encode({ errno = 0, data = { deleted = true } }))

else
    ngx.status = 405
    ngx.say(cjson.encode({ errno = -1, errmsg = "Method not allowed" }))
end