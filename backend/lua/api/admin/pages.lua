-- /api/admin/pages — list and update static pages (about, talks)
local cjson = require("cjson")
local posts = require("posts")
local admin_auth = require("admin_auth")
local security = require("security")
local utils = require("utils")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local user = admin_auth.verify_admin()
if not user then
    return
end

local PAGES_DIR = require("utils").blog_dir() .. "/pages"

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

    local fm = "---\n"
    fm = fm .. "title: " .. (data.title or slug) .. "\n"
    if data.title_en and data.title_en ~= "" then
        fm = fm .. "title_en: " .. data.title_en .. "\n"
    end
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

    -- Store English content in DB (was pages/*.en.json)
    local db = require("db")
    local now = os.time()
    db.query(
        "REPLACE INTO page_content (slug, content_en, updated_at) VALUES (?, ?, ?)",
        {slug, data.content_en or "", now}
    )

    ngx.say(cjson.encode({ errno = 0, data = { slug = slug } }))

else
    ngx.status = 405
    ngx.say(cjson.encode({ errno = -1, errmsg = "Method not allowed" }))
end
