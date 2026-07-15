-- /api/admin/comments — list all comments, delete
local cjson = require("cjson")
local admin_auth = require("admin_auth")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local user = admin_auth.verify_admin()
if not user then
    return
end

local DB_SOCKET = require("utils").db_socket()
local DB_NAME = "blogyou"
local DB_USER = "blogyou"
local DB_PASS = "blog-db-pass-2025"

local function connect()
    local mysql = require("resty.mysql")
    local db, err = mysql:new()
    if not db then return nil, err end
    db:set_timeout(3000)
    local ok, err = db:connect({ path = DB_SOCKET, database = DB_NAME, user = DB_USER, password = DB_PASS })
    if not ok then return nil, err end
    return db
end

local function close(db)
    if db then db:set_keepalive(10000, 50) end
end

if ngx.req.get_method() == "GET" then
    -- List all comments, newest first, with post title info
    local db, err = connect()
    if not db then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "DB error" }))
        return
    end

    local res, err = db:query("SELECT id, nick, mail, comment, link, url, create_time FROM comments ORDER BY create_time DESC")
    close(db)

    if not res then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Query error" }))
        return
    end

    ngx.say(cjson.encode({ errno = 0, data = res }))

elseif ngx.req.get_method() == "DELETE" then
    -- Delete a comment by id
    local id = tonumber(ngx.var.arg_id)
    if not id then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing id" }))
        return
    end

    local db, err = connect()
    if not db then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "DB error" }))
        return
    end

    local res, err = db:query("DELETE FROM comments WHERE id = " .. tostring(id))
    close(db)

    ngx.say(cjson.encode({ errno = 0, data = { deleted = true } }))

else
    ngx.status = 405
    ngx.say(cjson.encode({ errno = -1, errmsg = "Method not allowed" }))
end
