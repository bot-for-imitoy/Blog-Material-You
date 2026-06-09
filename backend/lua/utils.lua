--[[
  utils.lua — Utility functions for the Blog Material You backend.
]]

local _M = {}

-- Simple YAML frontmatter parser for our subset of YAML.
-- Handles:
--   key: value
--   key: "quoted value"
--   key: [item1, item2, item3]
--   key:
--     - item1
--     - item2
-- Returns a Lua table.
function _M.parse_frontmatter(yaml_str)
    local result = {}
    local lines = {}
    for line in yaml_str:gmatch("[^\r\n]+") do
        table.insert(lines, line)
    end

    local i = 1
    while i <= #lines do
        local line = lines[i]
        -- Skip empty lines and comments
        if line:match("^%s*$") or line:match("^%s*#") then
            i = i + 1
            goto continue
        end

        -- Match key: value or key: "quoted" on a single line
        local key, value = line:match("^%s*([%w_-]+)%s*:%s*(.+)%s*$")
        if key then
            value = _M.trim(value)
            -- Check if it's an inline array: [item1, item2, ...]
            if value:match("^%[.*%]$") then
                local inner = value:match("^%[(.*)%]$")
                local items = {}
                for item in inner:gmatch("[^,]+") do
                    item = _M.trim(item)
                    -- Remove surrounding quotes
                    item = item:match('^"(.*)"$') or item:match("^'(.*)'$") or item
                    table.insert(items, item)
                end
                result[key] = items
            -- Quoted string
            elseif value:match('^"') or value:match("^'") then
                local q = value:match("^\"(.*)\"$") or value:match("^'(.*)'$")
                result[key] = q or value
            -- Multi-line list (next lines start with -)
            else
                -- Check if next line(s) start with a dash (list items)
                if i + 1 <= #lines and lines[i + 1]:match("^%s*-") then
                    local items = {}
                    -- The first value might be the start, or just empty
                    if value ~= "" then
                        table.insert(items, value)
                    end
                    i = i + 1
                    while i <= #lines and lines[i]:match("^%s*-") do
                        local item = lines[i]:match("^%s*-%s*(.*)$")
                        item = _M.trim(item)
                        item = item:match('^"(.*)"$') or item:match("^'(.*)'$") or item
                        table.insert(items, item)
                        i = i + 1
                    end
                    result[key] = items
                    -- Don't increment i again since loop does it
                    goto continue_without_inc
                else
                    result[key] = value
                end
            end
        end
        i = i + 1
        ::continue::
        ::continue_without_inc::
    end

    return result
end

-- Strip HTML tags
function _M.strip_html(str)
    if not str then return "" end
    return str:gsub("<[^>]*>", "")
end

-- Truncate text to a given number of UTF-8 characters
function _M.truncate(str, max_chars)
    if not str then return "" end
    local total_bytes = #str
    local chars = 0
    local pos = 1
    while pos <= total_bytes do
        local byte = string.byte(str, pos)
        chars = chars + 1
        if chars > max_chars then
            return str:sub(1, pos - 1) .. "..."
        end
        -- Advance past this UTF-8 character
        if byte < 128 then
            pos = pos + 1           -- 1-byte ASCII
        elseif byte < 224 then
            pos = pos + 2           -- 2-byte
        elseif byte < 240 then
            pos = pos + 3           -- 3-byte (CJK, etc.)
        else
            pos = pos + 4           -- 4-byte
        end
    end
    return str
end

-- Trim whitespace
function _M.trim(str)
    if not str then return "" end
    return str:match("^%s*(.-)%s*$") or str
end

-- Format date as YYYY-MM-DD
function _M.format_date(year, month, day)
    return string.format("%04d-%02d-%02d", year, month, day)
end

-- Parse a date string like "2025-12-01" into {year, month, day}
function _M.parse_date(date_str)
    if not date_str then return nil end
    local y, m, d = date_str:match("(%d+)-(%d+)-(%d+)")
    if y and m and d then
        return {year = tonumber(y), month = tonumber(m), day = tonumber(d)}
    end
    return nil
end

-- JSON encode helper
function _M.json_encode(t)
    local cjson = require("cjson")
    return cjson.encode(t)
end

-- JSON decode helper
function _M.json_decode(s)
    local cjson = require("cjson")
    return cjson.decode(s)
end

-- Read a file completely
function _M.read_file(path)
    local f, err = io.open(path, "r")
    if not f then
        return nil, err
    end
    local content = f:read("*all")
    f:close()
    return content
end

-- Write a file completely
function _M.write_file(path, content)
    local f, err = io.open(path, "w")
    if not f then
        return nil, err
    end
    f:write(content)
    f:close()
    return true
end

-- Safely list files in a directory
function _M.list_files(dir, ext)
    local files = {}
    local handle = io.popen("ls -1 \"" .. dir .. "\" 2>/dev/null")
    if not handle then return files end
    for file in handle:lines() do
        if ext then
            if file:match("%." .. ext .. "$") then
                table.insert(files, file)
            end
        else
            table.insert(files, file)
        end
    end
    handle:close()
    return files
end

-- URL decode
function _M.url_decode(str)
    if not str then return "" end
    str = str:gsub("+", " ")
    str = str:gsub("%%(%x%x)", function(hex)
        return string.char(tonumber(hex, 16))
    end)
    return str
end

-- Get a safe filename for comment storage
function _M.safe_filename(str)
    return str:gsub("[^%w_%-]", "_")
end

return _M
