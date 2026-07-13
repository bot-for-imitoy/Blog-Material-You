--[[
  talks.lua — Talks CRUD using .md files in blog/talks/ directory.
  Each talk is a .md file: blog/talks/<timestamp>.md
  Format:
    ---
    id: <number>
    create_time: <unix_timestamp>
    ---
    <content>
]]
local utils = require("utils")
local cjson = require("cjson")

local _M = {}

local TALKS_DIR = require("utils").blog_dir() .. "/talks"

-- Read all talks from files, sorted newest first
function _M.list()
    local files = utils.list_files(TALKS_DIR, "md")
    local talks = {}
    for _, file in ipairs(files) do
        local path = TALKS_DIR .. "/" .. file
        local content, err = utils.read_file(path)
        if content then
            local frontmatter, body
            if content:sub(1, 3) == "---" then
                local _, end_pos = content:find("---", 5, true)
                if end_pos then
                    frontmatter = content:sub(5, end_pos - 2)
                    body = content:sub(end_pos + 2)
                    body = body:match("^[\n]*(.-)[\n]*$") or body
                end
            end
            local meta = {}
            if frontmatter then
                meta = utils.parse_frontmatter(frontmatter)
            end
            table.insert(talks, {
                id = tonumber(meta.id) or 0,
                content = body or content,
                create_time = tonumber(meta.create_time) or 0,
            })
        end
    end
    table.sort(talks, function(a, b) return a.create_time > b.create_time end)
    if #talks == 0 then return cjson.empty_array end
    return talks
end

-- Add a talk, returns { id, content, create_time }
function _M.add(content)
    local now = os.time()
    local id = now
    local path = TALKS_DIR .. "/" .. id .. ".md"
    local data = "---\nid: " .. id .. "\ncreate_time: " .. now .. "\n---\n\n" .. content
    local ok = utils.write_file(path, data)
    if not ok then return nil end
    return { id = id, content = content, create_time = now }
end

-- Update a talk by id
function _M.update(id, content)
    local files = utils.list_files(TALKS_DIR, "md")
    for _, file in ipairs(files) do
        local path = TALKS_DIR .. "/" .. file
        local raw = utils.read_file(path)
        if raw then
            local frontmatter
            if raw:sub(1, 3) == "---" then
                local _, end_pos = raw:find("---", 5, true)
                if end_pos then
                    frontmatter = raw:sub(1, end_pos + 2)
                end
            end
            if frontmatter and frontmatter:match("id:%s*" .. id) then
                local data = frontmatter .. "\n" .. content
                return utils.write_file(path, data)
            end
        end
    end
    return false
end

-- Delete a talk by id
function _M.delete(id)
    local files = utils.list_files(TALKS_DIR, "md")
    for _, file in ipairs(files) do
        local path = TALKS_DIR .. "/" .. file
        local raw = utils.read_file(path)
        if raw then
            if raw:match("id:%s*" .. id) then
                os.remove(path)
                return true
            end
        end
    end
    return false
end

return _M
