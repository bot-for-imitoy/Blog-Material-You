--[[
  /api/status — Server status info
]]
local cjson = require("cjson")
local data_store = require("data_store")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

if ngx.req.get_method() == "OPTIONS" then
  ngx.status = 204
  return
end

-- Count registered emails
local emails = data_store.get_emails()
local email_count = 0
for _ in pairs(emails) do email_count = email_count + 1 end

ngx.say(cjson.encode({
  online = true,
  uptime = ngx.worker.exiting() and "exiting" or "running",
  auth_enabled = true,
  registered_users = email_count
}))
