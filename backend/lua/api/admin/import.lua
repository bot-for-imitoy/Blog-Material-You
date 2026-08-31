-- /api/admin/import — One-click full data restore
-- POST body: a JSON document previously produced by GET /api/admin/export.
-- Replaces ALL blog data with the contents of the backup.
local cjson = require("cjson")
local admin_auth = require("admin_auth")
local backup = require("backup")
local utils = require("utils")

ngx.header["Content-Type"] = "application/json"

local user = admin_auth.verify_admin()
if not user then
    return
end

if ngx.req.get_method() ~= "POST" then
    ngx.status = 405
    ngx.say(cjson.encode({ errno = -1, errmsg = "Method not allowed" }))
    return
end

local body, err = utils.read_request_body()
if not body then
    ngx.status = 400
    ngx.say(cjson.encode({ errno = -1, errmsg = err or "Empty body" }))
    return
end

local ok, payload = pcall(cjson.decode, body)
if not ok or type(payload) ~= "table" then
    ngx.status = 400
    ngx.say(cjson.encode({ errno = -1, errmsg = "备份文件不是有效的 JSON" }))
    return
end

local summary, ierr = backup.import(payload)
if not summary then
    ngx.status = 400
    ngx.say(cjson.encode({ errno = -1, errmsg = "导入失败: " .. tostring(ierr) }))
    return
end

-- Invalidate shared-dict caches so restored data is visible immediately
local cache = ngx.shared.blog_cache
if cache then
    cache:delete("data_loaded")
    cache:delete("initialized")
end

ngx.say(cjson.encode({ errno = 0, data = { summary = summary } }))
