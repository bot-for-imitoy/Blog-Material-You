--[[
  /api/admin/ssr — Admin Server-Side Rendering API.
  Routes /api/admin/ssr/* requests to admin templates and returns HTML fragments.
]]
local cjson = require("cjson")
local renderer = require("renderer")
local cache = require("cache_loader")

ngx.header["Content-Type"] = "text/html; charset=utf-8"
ngx.header["X-SSR"] = "1"

-- Set language
local accept_lang = ngx.var.http_accept_language or "en"

cache.ensure_data_loaded()

local uri = ngx.var.uri or "/"
local route = uri:gsub("^/api/admin/ssr", "")
if route == "" then route = "/" end

local function render_or_404(template, data)
    local html = renderer.render(template, data)
    if not html then
        ngx.status = 500
        ngx.say("Template error: " .. template)
        return
    end
    ngx.say(html)
end

-- Admin layout (sidebar skeleton)
if route == "/layout" or route == "/layout/" then
    render_or_404("admin/layout", {})

-- Login (step 1)
elseif route == "/login" or route == "/login/" then
    render_or_404("admin/login", {})

-- Login (step 2 / TOTP)
elseif route == "/login-totp" or route == "/login/totp" then
    render_or_404("admin/login_totp", {})

-- Setup
elseif route == "/setup" or route == "/setup/" then
    render_or_404("admin/setup", {})

-- Dashboard
elseif route == "/dashboard" or route == "/dashboard/" then
    local posts_dict = ngx.shared.blog_posts
    local raw = posts_dict:get("active_summaries")
    local posts = {}
    if raw then
        local ok, data = pcall(cjson.decode, raw)
        if ok then posts = data end
    end
    -- Comments count
    local comment_count = 0
    local ok, comments_res = pcall(require("comments").get_all_comments)
    if ok and comments_res then
        if type(comments_res) == "table" and #comments_res > 0 then
            comment_count = #comments_res
        end
    end
    -- Tag count
    local tag_set = {}
    for _, p in ipairs(posts) do
        if p.tags then
            for _, t in ipairs(p.tags) do
                tag_set[t] = true
            end
        end
    end
    local tag_count = 0
    for _ in pairs(tag_set) do tag_count = tag_count + 1 end

    render_or_404("admin/dashboard", {
        postCount = #posts,
        commentCount = comment_count,
        tagCount = tag_count,
        recentPosts = posts,
    })

-- Posts list
elseif route == "/posts" or route == "/posts/" then
    local posts_dict = ngx.shared.blog_posts
    -- Load both active and archived posts so archived posts don't disappear
    local posts = {}
    local raw_active = posts_dict:get("active_summaries")
    if raw_active then
        local ok, data = pcall(cjson.decode, raw_active)
        if ok then
            for _, p in ipairs(data) do
                p.archived = false
                table.insert(posts, p)
            end
        end
    end
    local raw_archived = posts_dict:get("archived_summaries")
    if raw_archived then
        local ok, data = pcall(cjson.decode, raw_archived)
        if ok then
            for _, p in ipairs(data) do
                p.archived = true
                table.insert(posts, p)
            end
        end
    end
    render_or_404("admin/posts_list", { posts = posts })

-- Post editor
elseif route:match("^/editor") then
    local slug = ngx.var.arg_slug
    local post = { slug = "", title = "", date = os.date("%Y-%m-%d"), tags = {}, categories = {}, content = "", cover = "", title_en = "", tags_en = {}, categories_en = {}, content_en = "" }
    if slug then
        local posts_module = require("posts")
        local loaded = posts_module.load_post(slug)
        if loaded then
            post = loaded
        end
    end
    render_or_404("admin/editor", { post = post })

-- Comments list
elseif route == "/comments" or route == "/comments/" then
    local ok, comments_data = pcall(require("comments").list_all)
    render_or_404("admin/comments_list", { comments = comments_data or {} })

-- Talks list
elseif route == "/talks" or route == "/talks/" then
    local ok, talks_data = pcall(require("talks").list)
    render_or_404("admin/talks_list", { talks = talks_data or {} })

-- Talk editor
elseif route == "/talks/new" or route == "/talk-editor" then
    render_or_404("admin/talks_editor", {})

-- Friends list
elseif route == "/friends" or route == "/friends/" then
    local ok, friends_data = pcall(require("friends").list)
    render_or_404("admin/friends_list", { list = friends_data or {} })

-- Friend editor
elseif route:match("^/friends/editor") then
    local json_str = ngx.var.arg_data
    local friend = nil
    if json_str then
        local ok, parsed = pcall(cjson.decode, json_str)
        if ok then friend = parsed end
    end
    render_or_404("admin/friends_editor", { friend = friend })

-- Pages list
elseif route == "/pages" or route == "/pages/" then
    local ok, pages_data = pcall(require("db_pages").list)
    render_or_404("admin/pages_list", { pages = pages_data or {} })

-- Page editor
elseif route:match("^/pages/editor") then
    local slug = ngx.var.arg_slug
    local page = nil
    if slug then
        local ok, loaded = pcall(require("db_pages").get, slug)
        if ok then page = loaded end
    end
    render_or_404("admin/pages_editor", { slug = slug or "about", page = page })

-- Security
elseif route == "/security" or route == "/security/" then
    local totp_store = require("totp_store")
    local totp_module = require("totp")
    local totp_state = totp_store.read()
    local totp = {
        enabled = totp_state.enabled == true,
        has_pending = totp_state.pending_secret ~= nil and totp_state.pending_secret ~= cjson.null,
        secret = "",
        provisioning_uri = "",
        user = "",
    }
    -- Load the relevant secret based on state
    if totp.has_pending then
        totp.secret = totp_state.pending_secret or ""
        totp.provisioning_uri = totp_module.provisioning_uri(totp.secret, totp.user)
    elseif totp.enabled then
        totp.secret = totp_state.secret or ""
        totp.provisioning_uri = totp_module.provisioning_uri(totp.secret, totp.user)
    end
    local admin_store = require("admin_store")
    local admin_data = admin_store.read()
    totp.user = admin_data and admin_data.user or ""
    render_or_404("admin/security", { totp = totp })

else
    ngx.status = 404
    render_or_404("admin/layout", {})
end
