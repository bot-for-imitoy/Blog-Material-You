-- /api/comments — GET (list/count) and POST (submit)
--
-- POST validates every field server-side (backend/lua/comment_validation.lua)
-- and answers with a *machine readable* error so the browser can point at the
-- exact input:
--   422 {"ok":false,"errno":-1,"error":"content_required","field":"comment",
--        "errmsg":"Comment content is required",
--        "errors":[{field=...,error=...,message=...}, ...]}
-- `errno` is kept for backwards compatibility with older clients.
local cjson = require("cjson")
local comments = require("comments")
local validation = require("comment_validation")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"
ngx.header["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
ngx.header["Access-Control-Allow-Headers"] = "Content-Type"
ngx.header["Cache-Control"] = "no-store"

local function reply(status, payload)
    ngx.status = status
    ngx.say(cjson.encode(payload))
end

-- 422 with the first error mirrored at the top level (field + code).
local function reply_validation(errors)
    reply(422, {
        ok = false,
        errno = -1,
        error = errors[1].error,
        field = errors[1].field,
        errmsg = errors[1].message,
        errors = errors,
    })
end

if ngx.req.get_method() == "OPTIONS" then
    ngx.status = 204
    return
end

if ngx.req.get_method() == "GET" then
    local path_raw = ngx.var.arg_path or ngx.var.arg_url
    -- URL-decode the path parameter (browser sends %2F for /)
    local path = path_raw and ngx.unescape_uri(path_raw) or nil

    if not path or path == "" then
        reply(400, { ok = false, errno = -1, error = "path_required", field = "path",
                     errmsg = "Missing path parameter" })
        return
    end
    -- Reads accept any stored path but still bound it (DoS / log injection).
    if #path > validation.LIMITS.url or path:find("[%z\1-\31\127]") then
        reply(400, { ok = false, errno = -1, error = "path_invalid", field = "path",
                     errmsg = "Invalid path parameter" })
        return
    end

    if ngx.var.arg_type == "count" then
        local count = comments.count(path)
        ngx.say(cjson.encode({ errno = 0, data = { count = count } }))
    else
        local list = comments.load(path)
        if #list == 0 then
            ngx.say('{"errno":0,"data":{"data":[]}}')
        else
            ngx.say(cjson.encode({ errno = 0, data = { data = list } }))
        end
    end

elseif ngx.req.get_method() == "POST" then
    ngx.req.read_body()
    local body = ngx.req.get_body_data()
    if not body then
        reply(400, { ok = false, errno = -1, error = "empty_body",
                     errmsg = "Empty request body" })
        return
    end

    local ok, data = pcall(cjson.decode, body)
    if not ok or type(data) ~= "table" then
        reply(400, { ok = false, errno = -1, error = "invalid_json",
                     errmsg = "Invalid JSON" })
        return
    end

    local cleaned, errors = validation.validate(data)
    if errors then
        reply_validation(errors)
        return
    end

    local new_comment = comments.add(
        cleaned.nick, cleaned.mail, cleaned.comment,
        cleaned.url, cleaned.link, cleaned.ua, cleaned.avatar)
    if new_comment then
        reply(201, { ok = true, errno = 0, data = new_comment })
    else
        reply(500, { ok = false, errno = -1, error = "save_failed",
                     errmsg = "Failed to save comment" })
    end

else
    ngx.header["Allow"] = "GET, POST, OPTIONS"
    reply(405, { ok = false, errno = -1, error = "method_not_allowed",
                 errmsg = "Method not allowed" })
end
