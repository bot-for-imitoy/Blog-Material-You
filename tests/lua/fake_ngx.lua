-- Fake ngx for exercising backend/lua/api/*.lua without OpenResty.
-- Supports exactly the API surface used by api/comments.lua.
local M = {}

local state = {
    header = {},
    status = 200,
    out = {},
    var = {},
    method = "GET",
    body = nil,
}

function M.reset(opts)
    opts = opts or {}
    state.header = {}
    state.status = 200
    state.out = {}
    state.var = opts.var or {}
    state.method = opts.method or "GET"
    state.body = opts.body

    _G.ngx = {
        header = state.header,
        var = state.var,
        ERR = 3,
        WARN = 4,
        INFO = 5,
        status = 200,
        req = {
            get_method = function() return state.method end,
            read_body = function() end,
            get_body_data = function() return state.body end,
            get_body_file = function() return nil end,
            get_headers = function() return {} end,
        },
        say = function(s) state.out[#state.out + 1] = tostring(s or "") end,
        print = function(s) state.out[#state.out + 1] = tostring(s or "") end,
        log = function() end,
        unescape_uri = function(s)
            return (s:gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end))
        end,
        quote_sql_str = function(s)
            return "'" .. tostring(s):gsub("\\", "\\\\"):gsub("'", "\\'"):gsub("%z", "\\0") .. "'"
        end,
        escape_uri = function(s) return s end,
        encode_base64 = function() return "" end,
        decode_base64 = function() return nil end,
        md5 = function(s) return s end,
        now = function() return 0 end,
        shared = { blog_cache = { incr = function() return 1 end } },
    }
    return M
end

function M.status() return ngx.status end
function M.body() return table.concat(state.out) end
function M.header(name) return state.header[name] end

function M.set_status(s) ngx.status = s end

return M
