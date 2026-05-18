-- /api/admin/pages — list and update static pages (about, talks)
local cjson = require("cjson")
local posts = require("posts")
local admin_auth = require("admin_auth")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "*"

local user = admin_auth.verify_basic_auth()
if not user then
    ngx.status = 401
    ngx.say(cjson.encode({ errno = -1, errmsg = "Unauthorized" }))
    return
end

local PAGES_DIR = "/home/openclaw/workspace/Blog/blog/pages"

if ngx.req.get_method() == "GET" then
    local slugs = { "about", "talks" }
    local result = {}
    for _, slug in ipairs(slugs) do
        local page = posts.load_page(slug)
        if page then
            table.insert(result, page)
        end
    end
    ngx.say(cjson.encode(result))

elseif ngx.req.get_method() == "PUT" then
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

    local slug = data.slug
    if not slug then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing slug" }))
        return
    end

    local fm = "---\n"
    fm = fm .. "title: " .. (data.title or slug) .. "\n"
    fm = fm .. "---\n\n"

    local filepath = PAGES_DIR .. "/" .. slug .. ".md"
    local f, err = io.open(filepath, "w")
    if not f then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Failed to write" }))
        return
    end
    f:write(fm .. (data.content or ""))
    f:close()

    ngx.say(cjson.encode({ errno = 0, data = { slug = slug } }))

else
    ngx.status = 405
    ngx.say(cjson.encode({ errno = -1, errmsg = "Method not allowed" }))
end
