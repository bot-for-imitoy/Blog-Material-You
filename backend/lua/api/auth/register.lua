--[[
  /api/auth/register — Submit email for registration (adds to pending list)
  POST { email: "..." }
]]
local cjson = require("cjson")
local data_store = require("data_store")

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

-- Check if already registered or already pending
local emails = data_store.get_emails()
if emails[email] then
  ngx.say(cjson.encode({ errno = -1, errmsg = "该邮箱已注册" }))
  return
end

local pending = data_store.get_pending()
for _, p in ipairs(pending) do
  if p.email == email then
    ngx.say(cjson.encode({ errno = -1, errmsg = "该邮箱已在审核队列中" }))
    return
  end
end

-- Add to pending
table.insert(pending, {
  email = email,
  time = os.time(),
  name = data.name or ""
})
data_store.write_json("auth/pending.json", pending)

ngx.say(cjson.encode({
  errno = 0,
  data = { message = "注册请求已提交，请等待管理员审核" }
}))
