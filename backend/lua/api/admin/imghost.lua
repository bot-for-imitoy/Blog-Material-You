-- /api/admin/imghost — SFTP image hosting management
-- GET    /api/admin/imghost        → get config
-- PUT    /api/admin/imghost        → update config
-- POST   /api/admin/imghost/test   → test connection
-- POST   /api/admin/imghost/upload → upload an image (base64)
local cjson = require("cjson")
local admin_auth = require("admin_auth")
local imghost = require("imghost")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local user = admin_auth.verify_admin()
if not user then
    return
end

local method = ngx.req.get_method()
local uri = ngx.var.uri

-- ===== GET: load config =====
if method == "GET" then
    local cfg = imghost.load_config()
    -- Mask sensitive data
    local safe_cfg = {}
    for k, v in pairs(cfg) do
        safe_cfg[k] = v
    end
    if safe_cfg.ssh_key_path and safe_cfg.ssh_key_path ~= "" then
        safe_cfg.ssh_key_path = safe_cfg.ssh_key_path
    end
    ngx.say(cjson.encode({ errno = 0, data = safe_cfg }))
    return
end

-- ===== PUT: save config =====
if method == "PUT" then
    ngx.req.read_body()
    local body = ngx.req.get_body_data()
    if not body then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Empty body" }))
        return
    end

    local ok, data = pcall(cjson.decode, body)
    if not ok or not data then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Invalid JSON" }))
        return
    end

    -- Build config from request
    local cfg = {
        enabled = data.enabled == true,
        host = data.host or "",
        port = tonumber(data.port) or 22,
        username = data.username or "",
        ssh_key_path = data.ssh_key_path or "",
        remote_dir = data.remote_dir or "",
        public_url_base = data.public_url_base or "",
        filename_template = data.filename_template or "{yy}-{mm}-{dd}.{file_extension}"
    }

    local ok, err = imghost.save_config(cfg)
    if not ok then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = err or "保存失败" }))
        return
    end

    ngx.say(cjson.encode({ errno = 0, data = { message = "配置已保存" } }))
    return
end

-- ===== POST: test connection or upload =====
if method == "POST" then
    ngx.req.read_body()
    local body = ngx.req.get_body_data()
    if not body then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Empty body" }))
        return
    end

    local ok, data = pcall(cjson.decode, body)
    if not ok or not data then
        ngx.status = 400
        ngx.say(cjson.encode({ errno = -1, errmsg = "Invalid JSON" }))
        return
    end

    -- Test connection
    if data.action == "test" then
        local result, err = imghost.test_connection()
        if not result then
            ngx.say(cjson.encode({ errno = -1, errmsg = err or "连接失败" }))
            return
        end
        ngx.say(cjson.encode({ errno = 0, data = { message = result } }))
        return
    end

    -- Upload image
    if data.action == "upload" then
        local img_data = data.image
        if not img_data or img_data == "" then
            ngx.status = 400
            ngx.say(cjson.encode({ errno = -1, errmsg = "缺少图片数据" }))
            return
        end

        local filename = data.filename or "image.png"

        -- Decode base64
        -- Handle data URI: "data:image/png;base64,..."
        local raw = img_data
        local comma_idx = img_data:find(",")
        if comma_idx then
            raw = img_data:sub(comma_idx + 1)
        end

        local decoded = ngx.decode_base64(raw)
        if not decoded then
            ngx.status = 400
            ngx.say(cjson.encode({ errno = -1, errmsg = "Base64 解码失败" }))
            return
        end

        -- Write to temp file
        local temp_path = "/tmp/imghost_upload_" .. os.time() .. "_" .. math.random(10000, 99999)
        local f, err = io.open(temp_path, "wb")
        if not f then
            ngx.status = 500
            ngx.say(cjson.encode({ errno = -1, errmsg = "无法创建临时文件: " .. (err or "") }))
            return
        end
        f:write(decoded)
        f:close()

        -- Upload via SCP
        local url, err = imghost.upload(temp_path, filename)
        -- Clean up temp file
        os.remove(temp_path)

        if not url then
            ngx.say(cjson.encode({ errno = -1, errmsg = err or "上传失败" }))
            return
        end

        ngx.say(cjson.encode({ errno = 0, data = { url = url } }))
        return
    end

    ngx.status = 400
    ngx.say(cjson.encode({ errno = -1, errmsg = "未知 action" }))
    return
end

ngx.status = 405
ngx.say(cjson.encode({ errno = -1, errmsg = "Method not allowed" }))
