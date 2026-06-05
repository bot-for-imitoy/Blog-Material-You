-- /api/admin/totp-setup — returns TOTP provisioning info
-- Requires admin authentication (any method).
local cjson = require("cjson")
local config = require("config")
local admin_auth = require("admin_auth")
local totp = require("totp")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "*"

if ngx.req.get_method() == "OPTIONS" then
    ngx.status = 204
    return
end

local user = admin_auth.verify_admin()
if not user then
    return
end

local cfg = config.get()
local secret = cfg.totp_secret
local uri = totp.provisioning_uri(secret, cfg.admin_user)

ngx.say(cjson.encode({
    errno = 0,
    data = {
        secret = secret,
        provisioning_uri = uri,
        user = cfg.admin_user,
        issuer = "BlogMaterialYou"
    }
}))
