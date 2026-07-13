--[[
  /api/upload-avatar — Upload a comment avatar image.
  POST with multipart/form-data: file (image)
  Returns { errno: 0, data: { url: "/avatars/<filename>" } }
  Resizes to 512x512 using ImageMagick.
  Rate-limited: 1 upload per 30s per IP.
]]
local cjson = require("cjson")
local security = require("security")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

if ngx.req.get_method() == "OPTIONS" then
    ngx.status = 204
    return
end

if ngx.req.get_method() ~= "POST" then
    ngx.status = 405
    ngx.say(cjson.encode({ errno = -1, errmsg = "Method not allowed" }))
    return
end

-- Rate limit: 1 upload per 30s per IP
local limit = ngx.shared.blog_cache
if not limit then
    ngx.status = 500
    ngx.say(cjson.encode({ errno = -1, errmsg = "Server error" }))
    return
end

local ip = ngx.var.remote_addr or "unknown"
local remaining, err = limit:incr("avatar_upload:" .. ip, 1, 0, 30)
if not remaining then
    remaining = 1
end
if remaining > 1 then
    ngx.status = 429
    ngx.say(cjson.encode({ errno = -1, errmsg = "上传太频繁，请30秒后再试" }))
    return
end

-- Read the uploaded file
ngx.req.read_body()
local body_data = ngx.req.get_body_data()
local body_file = ngx.req.get_body_file()

local raw_data
if body_data then
    raw_data = body_data
elseif body_file then
    local f = io.open(body_file, "rb")
    if not f then
        ngx.status = 500
        ngx.say(cjson.encode({ errno = -1, errmsg = "Cannot read upload" }))
        return
    end
    raw_data = f:read("*a")
    f:close()
else
    ngx.status = 400
    ngx.say(cjson.encode({ errno = -1, errmsg = "No file data" }))
    return
end

-- Expect base64-encoded image data from the frontend
-- Handle data URI: "data:image/png;base64,..."
local comma_idx = raw_data:find(",")
local b64_data = raw_data
if comma_idx then
    b64_data = raw_data:sub(comma_idx + 1)
end

-- Decode
local img_data = ngx.decode_base64(b64_data)
if not img_data or #img_data < 100 then
    ngx.status = 400
    ngx.say(cjson.encode({ errno = -1, errmsg = "无效的图片数据" }))
    return
end

-- Check size (max 5MB)
if #img_data > 5 * 1024 * 1024 then
    ngx.status = 400
    ngx.say(cjson.encode({ errno = -1, errmsg = "图片太大，最大5MB" }))
    return
end

-- Save to temp file
local stamp = tostring(os.time()) .. tostring(math.random(10000, 99999))
local tmp_path = "/tmp/avatar_" .. stamp .. ".png"
local f = io.open(tmp_path, "wb")
if not f then
    ngx.status = 500
    ngx.say(cjson.encode({ errno = -1, errmsg = "Write error" }))
    return
end
f:write(img_data)
f:close()

-- Resize to 512x512 with ImageMagick, convert to WebP
local avatars_dir = require("utils").blog_dir() .. "/public/avatars"
os.execute("mkdir -p " .. avatars_dir)

local hash = ngx.encode_base64(ngx.hmac_sha1(stamp, "avatar-salt"))
    :gsub("/", "_"):gsub("%+", "-"):gsub("=", ""):sub(1, 16)
local out_name = hash .. ".webp"
local out_path = avatars_dir .. "/" .. out_name

os.execute("convert " .. tmp_path .. " -resize 512x512^ -gravity center -extent 512x512 " .. out_path .. " 2>/dev/null")

-- Clean up temp file
os.remove(tmp_path)

-- Check if output was created
local out_f = io.open(out_path, "r")
if not out_f then
    ngx.status = 500
    ngx.say(cjson.encode({ errno = -1, errmsg = "图片处理失败" }))
    return
end
out_f:close()

local url = "/avatars/" .. out_name

ngx.say(cjson.encode({ errno = 0, data = { url = url } }))
