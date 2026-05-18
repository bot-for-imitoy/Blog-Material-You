-- /api/admin/comments — list all comments, delete
local cjson = require("cjson")
local admin_auth = require("admin_auth")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "*"

local user = admin_auth.verify_basic_auth()
if not user then
    ngx.status = 401
    ngx.say(cjson.encode({ errno = -1, errmsg = "Unauthorized" }))
    return
end

local DB_SOCKET = "/home/openclaw/workspace/Blog/blog/data/mysql/mysql.sock"

local function connect()
    local mysql = require("resty.mysql")
    local db, err = mysql:new()
    if not db then return nil, err end
    db:set_timeout(3000)
    local ok, err = db:connect({ path = DB_SOCKET, database = "hexoyou" })
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
        ngx.say(cjson.encode({ errno = -1, errmsg = "DB error: " .. (err or "") }))
        return
    end

    local res, err = db:query("SELECT id, nick, mail, comment, link, url, create_time FROM comments ORDER BY create_time DESC")
    close(db)

    if not res then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Query error" }))
        return
    end

    ngx.say(cjson.encode(res))

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

    local res, err = db:query("DELETE FROM comments WHERE id = " .. id)
    close(db)

    ngx.say(cjson.encode({ errno = 0, data = { deleted = true } }))

else
    ngx.status = 405
    ngx.say(cjson.encode({ errno = -1, errmsg = "Method not allowed" }))
end
