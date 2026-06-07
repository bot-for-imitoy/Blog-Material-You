-- /api/admin/logout — Clear session cookie and blacklist token
local cjson = require("cjson")
local session = require("session")

ngx.header["Content-Type"] = "application/json"

-- Clear the HttpOnly cookie
session.clear_session_cookie()

-- Also try to blacklist the current token in shared dict
local token = session.get_bearer_token()
if token then
    session.destroy_session(token)
end

ngx.say(cjson.encode({ errno = 0, data = { message = "Logged out" } }))
