-- /api/admin/posts — list all posts (with full content), create, update, delete
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

local POSTS_DIR = "/home/openclaw/workspace/Blog/blog/posts"

if ngx.req.get_method() == "GET" then
    -- List all posts with full content
    local all = posts.load_all()
    ngx.say(cjson.encode(all))

elseif ngx.req.get_method() == "POST" then
    -- Create a new post
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
    if not slug or slug == "" then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing slug" }))
        return
    end

    -- Build frontmatter
    local fm = "---\n"
    fm = fm .. "title: " .. (data.title or slug) .. "\n"
    fm = fm .. "date: " .. (data.date or os.date("%Y-%m-%d")) .. "\n"
    if data.tags and #data.tags > 0 then
        fm = fm .. "tags: [" .. table.concat(data.tags, ", ") .. "]\n"
    end
    if data.categories and #data.categories > 0 then
        fm = fm .. "categories: [" .. table.concat(data.categories, ", ") .. "]\n"
    end
    if data.cover and data.cover ~= "" then
        fm = fm .. "cover: " .. data.cover .. "\n"
    end
    fm = fm .. "---\n\n"

    local filepath = POSTS_DIR .. "/" .. slug .. ".md"
    local f, err = io.open(filepath, "w")
    if not f then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Failed to write: " .. (err or "") }))
        return
    end
    f:write(fm .. (data.content or ""))
    f:close()

    ngx.say(cjson.encode({ errno = 0, data = { slug = slug, title = data.title } }))

elseif ngx.req.get_method() == "PUT" then
    -- Update an existing post
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
    fm = fm .. "date: " .. (data.date or os.date("%Y-%m-%d")) .. "\n"
    if data.tags and #data.tags > 0 then
        fm = fm .. "tags: [" .. table.concat(data.tags, ", ") .. "]\n"
    end
    if data.categories and #data.categories > 0 then
        fm = fm .. "categories: [" .. table.concat(data.categories, ", ") .. "]\n"
    end
    if data.cover and data.cover ~= "" then
        fm = fm .. "cover: " .. data.cover .. "\n"
    end
    fm = fm .. "---\n\n"

    local filepath = POSTS_DIR .. "/" .. slug .. ".md"
    local f, err = io.open(filepath, "w")
    if not f then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Failed to write: " .. (err or "") }))
        return
    end
    f:write(fm .. (data.content or ""))
    f:close()

    ngx.say(cjson.encode({ errno = 0, data = { slug = slug } }))

elseif ngx.req.get_method() == "DELETE" then
    -- Delete a post. Slug in query string: ?slug=hello-world
    local slug = ngx.var.arg_slug
    if not slug then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing slug parameter" }))
        return
    end

    local filepath = POSTS_DIR .. "/" .. slug .. ".md"
    local ok, err = os.remove(filepath)
    if not ok then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Failed to delete: " .. (err or "") }))
        return
    end

    ngx.say(cjson.encode({ errno = 0, data = { slug = slug } }))

elseif ngx.req.get_method() == "PATCH" then
    -- Toggle archive status
    ngx.req.read_body()
    local body = ngx.req.get_body_data()
    if not body then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Empty body" }))
        return
    end
    local ok, data = pcall(cjson.decode, body)
    if not ok or not data or not data.slug then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Missing slug" }))
        return
    end
    local success, err = posts.toggle_archive(data.slug)
    if success then
        ngx.say(cjson.encode({ errno = 0, data = { slug = data.slug } }))
    else
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Failed: " .. (err or "") }))
    end

else
    ngx.status = 405
    ngx.say(cjson.encode({ errno = -1, errmsg = "Method not allowed" }))
end
