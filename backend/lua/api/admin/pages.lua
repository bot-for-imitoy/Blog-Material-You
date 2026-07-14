-- /api/admin/pages — list and update static pages (about, talks) via MariaDB
local cjson = require("cjson")
local posts = require("posts")
local db_pages = require("db_pages")
local admin_auth = require("admin_auth")
local security = require("security")
local utils = require("utils")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local user = admin_auth.verify_admin()
if not user then
    return
end

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

    local slug = data.slug
    if not slug then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing slug" }))
        return
    end
    if not security.require_valid_slug(slug) then return end

    -- Save to DB via db_pages.save()
    local ok2, err2 = db_pages.save(slug, data.title or slug, data.content or "", data.title_en or "", data.content_en or "")
    if not ok2 then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Failed to write: " .. (err2 or "unknown") }))
        return
    end

    ngx.say(cjson.encode({ errno = 0, data = { slug = slug } }))

else
    ngx.status = 405
    ngx.say(cjson.encode({ errno = -1, errmsg = "Method not allowed" }))
end