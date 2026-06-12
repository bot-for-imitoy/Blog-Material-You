-- /api/comments — GET (list/count) and POST (submit)
local cjson = require("cjson")
local comments = require("comments")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"
ngx.header["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
ngx.header["Access-Control-Allow-Headers"] = "Content-Type"

if ngx.req.get_method() == "OPTIONS" then
    ngx.status = 204
    return
end

if ngx.req.get_method() == "GET" then
    local path_raw = ngx.var.arg_path or ngx.var.arg_url
    -- URL-decode the path parameter (browser sends %2F for /)
    local path = path_raw and ngx.unescape_uri(path_raw) or nil
    local count_only = ngx.var.arg_type

    if not path then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing path parameter" }))
        return
    end

    if count_only == "count" then
        local count = comments.count(path)
        ngx.say(cjson.encode({ errno = 0, data = { count = count } }))
    else
        local list = comments.load(path)
        if #list == 0 then
            ngx.say('{"errno":0,"data":{"data":[]}}')
        else
            ngx.say(cjson.encode({
                errno = 0,
                data = { data = list }
            }))
        end
    end

elseif ngx.req.get_method() == "POST" then
    ngx.req.read_body()
    local body = ngx.req.get_body_data()
    if not body then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Empty request body" }))
        return
    end

    local ok, data = pcall(cjson.decode, body)
    if not ok or not data then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Invalid JSON" }))
        return
    end

    local nick = data.nick
    local mail = data.mail
    local comment_text = data.comment
    local url = data.url
    local link = data.link or ""
    local ua = data.ua or ""
    local avatar = data.avatar or ""

    if not nick or not mail or not comment_text or not url then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing required fields" }))
        return
    end

    local new_comment = comments.add(nick, mail, comment_text, url, link, ua, avatar)
    if new_comment then
        ngx.say(cjson.encode({ errno = 0, data = new_comment }))
    else
        ngx.say(cjson.encode({ errno = -1, errmsg = "Failed to save comment" }))
    end

else
    ngx.status = 405
    ngx.say(cjson.encode({ error = "Method not allowed" }))
end
