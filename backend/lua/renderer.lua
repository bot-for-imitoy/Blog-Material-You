--[[
  renderer.lua — Unified ETLua template rendering engine.
  Compiles .etlua templates on first access, caches them,
  and renders with data + helper functions.
]]
local etlua = require("etlua")
local cjson = require("cjson")
local _M = {}

-- Compiled template cache
local tpl_cache = {}

-- Config
local template_dir

function _M.set_template_dir(dir)
    template_dir = dir
end

-- ===== Helper functions injected into every template =====

local function h(s)
    if not s then return "" end
    s = tostring(s)
    return s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;")
end

local function format_date(date_str)
    if not date_str or date_str == "" then return "" end
    -- Strip leading non-digit characters
    local cleaned = date_str:match("(%d.*)")
    if not cleaned then return date_str end
    -- Expects YYYY-MM-DD or YYYY-MM-DD...
    local y, m, d = cleaned:match("^(%d%d%d%d)-(%d%d)-(%d%d)")
    if y then return y .. "-" .. m .. "-" .. d end
    -- Try as Unix timestamp
    local ts = tonumber(date_str)
    if ts then
        local dt = os.date("*t", ts)
        if dt then return string.format("%04d-%02d-%02d", dt.year, dt.month, dt.day) end
    end
    return date_str
end

local function truncate(text, len)
    if not text then return "" end
    if #text <= len then return text end
    return text:sub(1, len) .. "..."
end

local function url_encode(s)
    if not s then return "" end
    -- Simple URL encoding for ASCII-safe strings (slugs)
    return ngx.escape_uri(s)
end

local function strip_md(s)
    if not s then return "" end
    s = s:gsub("^#+%s*", ""):gsub("%*%*", ""):gsub("%*", ""):gsub("`", "")
    s = s:gsub("!%[.-%]%(.-%)", ""):gsub("%[.-%]%(.-%)", "%1")
    s = s:gsub("^>%s*", ""):gsub("```.-```", ""):gsub("~~~", "")
    s = s:gsub("%s+", " "):gsub("^%s*(.-)%s*$", "%1")
    if #s > 200 then s = s:sub(1, 200) .. "…" end
    return s
end

-- Multilingual helpers
local function use_en(post, field)
    if not post then return "" end
    local _LANG = ngx.ctx._LANG or "en"
    if _LANG == "en" and post[field .. "_en"] and post[field .. "_en"] ~= "" then
        return post[field .. "_en"]
    end
    return post[field] or ""
end

local function get_title(post)  return use_en(post, "title") end
local function get_content(post) return use_en(post, "content") end
local function get_tags(post)
    local _LANG = ngx.ctx._LANG or "en"
    if _LANG == "en" and post.tags_en and #post.tags_en > 0 then return post.tags_en end
    return post.tags or {}
end
local function get_cats(post)
    local _LANG = ngx.ctx._LANG or "en"
    if _LANG == "en" and post.categories_en and #post.categories_en > 0 then return post.categories_en end
    return post.categories or {}
end

-- Translation lookup
local _locales_cache = nil

function _M.load_locales()
    if _locales_cache then return _locales_cache end
    local path = require("utils").blog_dir() .. "/locales.yml"
    local f = io.open(path, "r")
    if not f then
        _locales_cache = {}
        return _locales_cache
    end
    local text = f:read("*a")
    f:close()
    -- Minimal YAML parser for flat structure
    local result, current_section = {}, nil
    for line in text:gmatch("[^\r\n]+") do
        local section = line:match("^(%w+):%s*$")
        if section then
            current_section = section
        elseif current_section then
            local key, val = line:match("^%s+([%w%-]+)%s*:%s*(.*)$")
            if key and val then
                val = val:match('^"(.*)"$') or val:match("^'(.*)'$") or val
                if not result[current_section] then result[current_section] = {} end
                result[current_section][key] = val
            end
        end
    end
    _locales_cache = result
    return result
end

local function _(key)
    local _LANG = ngx.ctx._LANG or "en"
    if not _locales_cache then _M.load_locales() end
    if _locales_cache[_LANG] and _locales_cache[_LANG][key] then
        return _locales_cache[_LANG][key]
    end
    -- English fallback
    if _locales_cache["en"] and _locales_cache["en"][key] then
        return _locales_cache["en"][key]
    end
    return key
end

-- English fallback for initial renders before locale loads
local _EN_FALLBACK = {
    site_name = "Blog", site_desc = "A simple and elegant theme.",
    nav_home = "Home", nav_posts = "Posts", nav_tags = "Tags",
    nav_categories = "Categories", nav_moments = "Moments", nav_about = "About",
    nav_archives = "Archives", nav_friends = "Friends",
    page_posts = "Posts", page_posts_desc = "All posts of the blog",
    page_tags = "Tags", page_tags_desc = "All tags of the blog",
    page_categories = "Categories", page_categories_desc = "All categories of the blog",
    page_moments = "Moments", page_moments_desc = "Moments",
    page_archives = "Archives", page_archives_desc = "All archived posts",
    page_friends = "Friends", page_friends_desc = "My Friends",
    loading = "Loading...", networkError = "Network error",
    commentSuccess = "Comment submitted successfully", commentFail = "Failed to submit comment",
    nickName = "Nick Name", email = "Email", website = "Website (optional)",
    commentContent = "Comment", submit = "Submit", reply = "Reply", avatar = "Avatar",
    noPosts = "No posts yet", noComments = "No comments yet", noTalks = "No moments yet",
    serverOnline = "Online", serverOffline = "Offline",
    cpr = "C 2025 Blog Material You", forward = "Read",
    noFriends = "No friends yet",
    status = "Status", statusDesc = "Service Status",
}

-- Locale helper with fallback
local function t(key)
    local val = _(key)
    if val ~= key then return val end
    return _EN_FALLBACK[key] or key
end

-- ===== Load blog config =====
local function get_blog_config()
    local raw = ngx.shared.blog_config:get("data")
    if raw then
        local ok, cfg = pcall(cjson.decode, raw)
        if ok and cfg.title then return cfg end
    end
    local cfg_mod = require("config")
    return cfg_mod.get()
end

-- ===== Render =====

-- Helper functions available in all templates
local template_helpers = {
    h = h,
    format_date = format_date,
    truncate = truncate,
    url_encode = url_encode,
    _ = t,
    get_title = get_title,
    get_content = get_content,
    get_tags = get_tags,
    get_cats = get_cats,
    strip_md = strip_md,
}

function _M.render(template_name, data)
    -- Set default lang if not set
    if not ngx.ctx._LANG then
        ngx.ctx._LANG = "en"
    end

    local tpl = tpl_cache[template_name]
    if not tpl then
        -- Search in template_dir or default path
        local dir = template_dir or (require("utils").blog_dir() .. "/../backend/lua/templates")
        local path = dir .. "/" .. template_name .. ".etlua"
        local f = io.open(path, "r")
        if not f then
            ngx.log(ngx.ERR, "renderer: template not found: " .. path)
            return nil
        end
        local content = f:read("*a")
        f:close()
        local ok, compiled = pcall(etlua.compile, content)
        if not ok then
            ngx.log(ngx.ERR, "renderer: failed to compile template " .. template_name .. ": " .. tostring(compiled))
            return nil
        end
        tpl = compiled
        tpl_cache[template_name] = compiled
    end

    -- Inject helpers into data
    data = data or {}
    data._h = template_helpers
    data._LANG = ngx.ctx._LANG or "en"
    data.blog_config = data.blog_config or get_blog_config()

    local ok, result = pcall(tpl, data)
    if not ok then
        ngx.log(ngx.ERR, "renderer: template " .. template_name .. " error: " .. tostring(result))
        -- Log what data keys are available
        local keys = {}
        for k, _ in pairs(data or {}) do
            table.insert(keys, k)
        end
        ngx.log(ngx.ERR, "renderer: data keys: " .. table.concat(keys, ", "))
        return nil
    end
    return result
end

function _M.clear_cache()
    tpl_cache = {}
    _locales_cache = nil
end

return _M
