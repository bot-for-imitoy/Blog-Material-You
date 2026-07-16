local aes = require("resty.aes")
local cjson = require("cjson")
local db = require("db")

ngx.header["Content-Type"] = "application/json"

local password = "admin123"
local salt = ngx.encode_base64(ngx.hmac_sha1(tostring(os.time()) .. tostring(math.random()), "salt-gen"))
salt = salt:gsub("\n", ""):sub(1, 8)
local cipher = aes:new(password, salt, aes.cipher(256, "cbc"), aes.hash.sha256, 600000, 16)
local encrypted = cipher:encrypt("BLOG-ADMIN-VERIFIED")
local data = {user = "admin", setup_done = true, data = ngx.encode_base64(encrypted):gsub("\n", ""), salt = salt}
local value = cjson.encode(data)
local res, err = db.query("REPLACE INTO config (`key`, `value`, updated_at) VALUES ('admin_creds', ?, ?)", {value, os.time()})
if res then
    ngx.say(cjson.encode({ok = true, msg = "Password reset to admin123"}))
else
    ngx.say(cjson.encode({ok = false, err = tostring(err)}))
end
