-- /api/admin/logout — Clear session cookie and blacklist token
local cjson = require("cjson")
local session = require("session")
local admin_auth = require("admin_auth")

ngx.header["Content-Type"] = "application/json"

-- Verify admin session before logout
local user = admin_auth.verify_admin()
if not user then
    return
end

-- Clear the HttpOnly cookie
session.clear_session_cookie()

-- Also try to blacklist the current token in shared dict
local token = session.get_bearer_token()
if token then
    session.destroy_session(token)
end

ngx.say(cjson.encode({ errno = 0, data = { message = "Logged out" } }))
