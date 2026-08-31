-- /api/admin/export — One-click full data export
-- GET → downloads blog-backup-<timestamp>.json containing all blog data.
local cjson = require("cjson")
local admin_auth = require("admin_auth")
local backup = require("backup")

ngx.header["Content-Type"] = "application/json"

local user = admin_auth.verify_admin()
if not user then
    return
end

if ngx.req.get_method() ~= "GET" then
    ngx.status = 405
    ngx.say(cjson.encode({ errno = -1, errmsg = "Method not allowed" }))
    return
end

local payload, err = backup.export()
if not payload then
    ngx.status = 500
    ngx.say(cjson.encode({ errno = -1, errmsg = "导出失败: " .. tostring(err) }))
    return
end

-- Serve as a downloadable attachment
local filename = "blog-backup-" .. os.date("%Y%m%d-%H%M%S") .. ".json"
ngx.header["Content-Disposition"] = 'attachment; filename="' .. filename .. '"'
ngx.header["Content-Type"] = "application/json; charset=utf-8"
ngx.say(cjson.encode(payload))
