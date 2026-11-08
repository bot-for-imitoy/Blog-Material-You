-- Minimal JSON encoder/decoder used ONLY by the pure-Lua test harness
-- (lua-cjson is not installed on the CI-less dev box). Not used by the app.
local json = {}

local function esc(s)
    return '"' .. s:gsub('[%z\1-\31\\"]', function(c)
        local map = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n',
                      ['\r'] = '\\r', ['\t'] = '\\t', ['\b'] = '\\b', ['\f'] = '\\f' }
        return map[c] or string.format('\\u%04x', c:byte())
    end) .. '"'
end

local function is_array(t)
    local n = 0
    for k in pairs(t) do
        if type(k) ~= "number" then return false end
        n = n + 1
    end
    if n == 0 then return true end
    for i = 1, n do if t[i] == nil then return false end end
    return true
end

function json.encode(v)
    local t = type(v)
    if t == "nil" then return "null" end
    if t == "boolean" then return tostring(v) end
    if t == "number" then
        if v == math.floor(v) then return string.format("%d", v) end
        return tostring(v)
    end
    if t == "string" then return esc(v) end
    if t == "table" then
        if is_array(v) then
            local out = {}
            for i = 1, #v do out[i] = json.encode(v[i]) end
            return "[" .. table.concat(out, ",") .. "]"
        end
        local out = {}
        for k, val in pairs(v) do
            out[#out + 1] = esc(tostring(k)) .. ":" .. json.encode(val)
        end
        table.sort(out)
        return "{" .. table.concat(out, ",") .. "}"
    end
    error("cannot encode " .. t)
end

local decode_value

local function skip_ws(s, i)
    while i <= #s and s:sub(i, i):match("%s") do i = i + 1 end
    return i
end

local function decode_string(s, i)
    assert(s:sub(i, i) == '"', "expected string at " .. i)
    i = i + 1
    local buf = {}
    while i <= #s do
        local c = s:sub(i, i)
        if c == '"' then return table.concat(buf), i + 1 end
        if c == "\\" then
            local n = s:sub(i + 1, i + 1)
            local map = { n = "\n", r = "\r", t = "\t", b = "\b", f = "\f", ['"'] = '"', ["\\"] = "\\", ["/"] = "/" }
            if map[n] then buf[#buf + 1] = map[n]; i = i + 2
            elseif n == "u" then
                buf[#buf + 1] = utf8.char(tonumber(s:sub(i + 2, i + 5), 16)); i = i + 6
            else error("bad escape") end
        else
            buf[#buf + 1] = c; i = i + 1
        end
    end
    error("unterminated string")
end

local function decode_number(s, i)
    local num = s:match("^-?%d+%.?%d*[eE]?[-+]?%d*", i)
    assert(num, "bad number at " .. i)
    return tonumber(num), i + #num
end

decode_value = function(s, i)
    i = skip_ws(s, i)
    local c = s:sub(i, i)
    if c == "{" then
        local obj = {}
        i = skip_ws(s, i + 1)
        if s:sub(i, i) == "}" then return obj, i + 1 end
        while true do
            local k; k, i = decode_string(s, i)
            i = skip_ws(s, i)
            assert(s:sub(i, i) == ":", "expected : at " .. i)
            i = skip_ws(s, i + 1)
            local v; v, i = decode_value(s, i)
            obj[k] = v
            i = skip_ws(s, i)
            local ch = s:sub(i, i)
            if ch == "}" then return obj, i + 1 end
            assert(ch == ",", "expected , or } at " .. i)
            i = skip_ws(s, i + 1)
        end
    elseif c == "[" then
        local arr = {}
        i = skip_ws(s, i + 1)
        if s:sub(i, i) == "]" then return arr, i + 1 end
        while true do
            local v; v, i = decode_value(s, i)
            arr[#arr + 1] = v
            i = skip_ws(s, i)
            local ch = s:sub(i, i)
            if ch == "]" then return arr, i + 1 end
            assert(ch == ",", "expected , or ] at " .. i)
            i = skip_ws(s, i + 1)
        end
    elseif c == '"' then
        return decode_string(s, i)
    elseif s:sub(i, i + 3) == "true" then
        return true, i + 4
    elseif s:sub(i, i + 4) == "false" then
        return false, i + 5
    elseif s:sub(i, i + 3) == "null" then
        return nil, i + 4
    else
        return decode_number(s, i)
    end
end

function json.decode(s)
    local v = decode_value(s, 1)
    return v
end

json.empty_array = setmetatable({}, { __jsontype = "array" })

return json
