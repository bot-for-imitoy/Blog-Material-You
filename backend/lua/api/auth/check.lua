--[[
  /api/auth/check — Check if email is registered and return permissions
  POST { email: "..." }
]]
local cjson = require("cjson")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

if ngx.req.get_method() == "OPTIONS" then
  ngx.status = 204
  return
end

ngx.req.read_body()
local body = ngx.req.get_body_data()
if not body then
  ngx.say(cjson.encode({ errno = -1, errmsg = "Empty body" }))
  return
end

local ok, data = pcall(cjson.decode, body)
if not ok or not data or not data.email then
  ngx.say(cjson.encode({ errno = -1, errmsg = "Missing email" }))
  return
end

local email = data.email:lower():match("^%s*(.-)%s*$")
if not email:match("^[^@]+@[^@]+%.[^@]+$") then
  ngx.say(cjson.encode({ errno = -1, errmsg = "Invalid email format" }))
  return
end

-- Always return registered=false to prevent email enumeration.
-- The actual registration status is never revealed to unauthenticated clients.
ngx.say(cjson.encode({
    errno = 0,
    data = {
        registered = false,
        permissions = {}
    }
}))
