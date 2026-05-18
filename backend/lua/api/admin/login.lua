-- /api/admin/login — verify credentials, return token
local cjson = require("cjson")
local config = require("config")
local admin_auth = require("admin_auth")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "*"

if ngx.req.get_method() == "OPTIONS" then
    ngx.status = 204
    return
end

-- Accept either Basic auth header or POST body
local ok, user = pcall(admin_auth.verify_basic_auth)
if not ok or not user then
    -- Try POST body
    ngx.req.read_body()
    local body = ngx.req.get_body_data()
    if body then
        local ok2, data = pcall(cjson.decode, body)
        if ok2 and data then
            local cfg = config.get()
            if data.username == cfg.admin_user and data.password == cfg.admin_pass then
                user = data.username
            end
        end
    end
end

if user then
    local session = ngx.encode_base64(user .. ":" .. os.time())
    ngx.say(cjson.encode({
        errno = 0,
        data = {
            token = session,
            user = user
        }
    }))
else
    ngx.status = 401
    ngx.say(cjson.encode({ errno = -1, errmsg = "Invalid credentials" }))
end
