--[[
  data_store.lua — Simple JSON file read/write for blog data.
  All paths relative to server prefix (blog/../blog/data/).
]]
local cjson = require("cjson")
local _M = {}

local DATA_DIR = ngx.config.prefix() .. "../blog/data"

function _M.read_json(subpath)
  local path = DATA_DIR .. "/" .. subpath
  local f, err = io.open(path, "r")
  if not f then return nil, err end
  local content = f:read("*all")
  f:close()
  local ok, data = pcall(cjson.decode, content)
  if not ok then return nil, "Invalid JSON in " .. subpath end
  return data
end

function _M.write_json(subpath, data)
  local path = DATA_DIR .. "/" .. subpath
  local f, err = io.open(path, "w")
  if not f then return nil, err end
  local ok, encoded = pcall(cjson.encode, data)
  if not ok then f:close(); return nil, "Encode error" end
  f:write(encoded)
  f:close()
  return true
end

function _M.get_emails()
  local data, err = _M.read_json("auth/emails.json")
  if not data then return {} end
  return data
end

function _M.get_pending()
  local data, err = _M.read_json("auth/pending.json")
  if not data then return cjson.empty_array end
  if #data == 0 and next(data) == nil then return cjson.empty_array end
  return data
end

function _M.get_calendar()
  local data, err = _M.read_json("calendar/events.json")
  if not data then return cjson.empty_array end
  if #data == 0 and next(data) == nil then return cjson.empty_array end
  return data
end

-- Check if an email has a specific permission
function _M.has_permission(email, perm)
  local emails = _M.get_emails()
  local entry = emails[email]
  if not entry then return false end
  local perms = entry.permissions or {}
  for _, p in ipairs(perms) do
    if p == perm then return true end
  end
  return false
end

-- Get all permissions for an email
function _M.get_permissions(email)
  local emails = _M.get_emails()
  local entry = emails[email]
  if not entry then return {} end
  return entry.permissions or {}
end

return _M
