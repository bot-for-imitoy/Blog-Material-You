--[[
  renderer.lua — Unified ETLua template rendering engine.
  Compiles .etlua templates on first access, caches them,
  and renders with data + helper functions.
  All UI text comes from blog_config (config.lua).
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

-- Text lookup: get a UI string from blog_config by key
-- Templates use _h._("key") to get the configured text
local function _(key)
    local cfg = get_blog_config()
    if cfg and cfg[key] then
        return cfg[key]
    end
    return key
end

-- ===== Render =====

-- Helper functions available in all templates
local template_helpers = {
    h = h,
    format_date = format_date,
    truncate = truncate,
    url_encode = url_encode,
    _ = _,
    strip_md = strip_md,
    cjson = cjson,
}

function _M.render(template_name, data)
    local tpl = tpl_cache[template_name]
    if not tpl then
        -- Search in template_dir or default path
        local dir = template_dir or (require("utils").blog_dir() .. "/public/templates")
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
    data.blog_config = data.blog_config or get_blog_config()

    local ok, result = pcall(tpl, data)
    if not ok then
        ngx.log(ngx.ERR, "renderer: template " .. template_name .. " error: " .. tostring(result))
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
end

return _M
