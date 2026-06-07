--[[
  /api/calendar — Get calendar events (requires auth + calendar permission)
  GET with Authorization: Bearer <token> + email header
]]
local cjson = require("cjson")
local data_store = require("data_store")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

if ngx.req.get_method() == "OPTIONS" then
  ngx.status = 204
  return
end

-- Get email from header
local email = ngx.req.get_headers()["X-User-Email"]
if not email then
  ngx.status = 401
  ngx.say(cjson.encode({ errno = -1, errmsg = "Missing X-User-Email header" }))
  return
end
email = email:lower()

-- Check permission
if not data_store.has_permission(email, "calendar") then
  ngx.status = 403
  ngx.say(cjson.encode({ errno = -1, errmsg = "无权限查看日历" }))
  return
end

local events = data_store.get_calendar()
ngx.say(cjson.encode({ errno = 0, data = events }))
