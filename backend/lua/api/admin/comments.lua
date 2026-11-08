-- /api/admin/comments — list all comments, delete one
--
-- Shares the same data layer as the public API (backend/lua/comments.lua)
-- instead of carrying its own SQL, so validation/escaping stays in one place.
local cjson = require("cjson")
local admin_auth = require("admin_auth")
local comments = require("comments")

ngx.header["Content-Type"] = "application/json"
ngx.header["Cache-Control"] = "no-store"

local user = admin_auth.verify_admin()
if not user then
    return
end

if ngx.req.get_method() == "GET" then
    local res = comments.list_all()
    if #res == 0 then res = cjson.empty_array end
    ngx.say(cjson.encode({ errno = 0, data = res }))

elseif ngx.req.get_method() == "DELETE" then
    local id = tonumber(ngx.var.arg_id)
    if not id or id <= 0 or id ~= math.floor(id) then
        ngx.status = 400
        ngx.say(cjson.encode({ ok = false, errno = -1, error = "id_required",
                               field = "id", errmsg = "Missing or invalid comment id" }))
        return
    end

    local ok, err = comments.delete_by_id(id)
    if not ok then
        ngx.status = 404
        ngx.say(cjson.encode({ ok = false, errno = -1, error = "not_found",
                               errmsg = "Comment not found" }))
        return
    end

    ngx.say(cjson.encode({ errno = 0, data = { deleted = true, id = id } }))

elseif ngx.req.get_method() == "OPTIONS" then
    ngx.status = 204

else
    ngx.header["Allow"] = "GET, DELETE, OPTIONS"
    ngx.status = 405
    ngx.say(cjson.encode({ errno = -1, errmsg = "Method not allowed" }))
end
