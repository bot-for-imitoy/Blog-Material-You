--[[
  imghost.lua — SFTP image hosting module.
  Config stored in DB config table (key: "imghost_config").
  Uses scp command to upload images to a remote SFTP server.
]]
local cjson = require("cjson")
local db = require("db")
local _M = {}

local CONFIG_KEY = "imghost_config"

-- Default config
local DEFAULT_CONFIG = {
    enabled = false,
    host = "",
    port = 22,
    username = "",
    ssh_key_path = "",
    remote_dir = "",
    public_url_base = "",
    filename_template = "{yy}-{mm}-{dd}.{file_extension}"
}

-- Load config from DB
function _M.load_config()
    local res, err = db.query("SELECT `value` FROM config WHERE `key` = ?", {CONFIG_KEY})
    if not res or #res == 0 then
        -- Return defaults if no entry exists
        local cfg = {}
        for k, v in pairs(DEFAULT_CONFIG) do cfg[k] = v end
        return cfg
    end
    local ok, cfg = pcall(cjson.decode, res[1].value)
    if not ok or type(cfg) ~= "table" then
        local cfg = {}
        for k, v in pairs(DEFAULT_CONFIG) do cfg[k] = v end
        return cfg
    end
    -- Fill in missing fields with defaults
    for k, v in pairs(DEFAULT_CONFIG) do
        if cfg[k] == nil then cfg[k] = v end
    end
    return cfg
end

-- Save config to DB
function _M.save_config(cfg)
    -- Validate required fields when enabled
    if cfg.enabled then
        if not cfg.host or cfg.host == "" then
            return nil, "SFTP 主机地址不能为空"
        end
        if not cfg.username or cfg.username == "" then
            return nil, "用户名不能为空"
        end
        if not cfg.ssh_key_path or cfg.ssh_key_path == "" then
            return nil, "SSH 密钥路径不能为空"
        end
        if not cfg.remote_dir or cfg.remote_dir == "" then
            return nil, "远程目录不能为空"
        end
        if not cfg.public_url_base or cfg.public_url_base == "" then
            return nil, "公开 URL 基址不能为空"
        end
        if not cfg.filename_template or cfg.filename_template == "" then
            cfg.filename_template = DEFAULT_CONFIG.filename_template
        end
    end

    local value = cjson.encode(cfg)
    local now = os.time()
    local res, err = db.query(
        "REPLACE INTO config (`key`, `value`, updated_at) VALUES (?, ?, ?)",
        {CONFIG_KEY, value, now}
    )
    if not res then
        return nil, "无法写入配置: " .. (err or "")
    end
    return true
end

-- Process filename template → actual filename
-- Supported variables:
--   {yy}  → 2-digit year
--   {mm}  → 2-digit month
--   {dd}  → 2-digit day
--   {file_extension} → original file extension
--   {original} → original filename without extension
function _M.process_template(template, original_filename, ext)
    local now = os.time()
    local yy = os.date("%y", now)
    local mm = os.date("%m", now)
    local dd = os.date("%d", now)

    local result = template
    result = result:gsub("{yy}", yy)
    result = result:gsub("{mm}", mm)
    result = result:gsub("{dd}", dd)
    result = result:gsub("{file_extension}", ext)
    result = result:gsub("{original}", original_filename or "image")

    -- Remove path separators from result (security)
    result = result:gsub("[/\\]", "_")

    return result
end

-- Upload a file via SCP to the configured SFTP server
-- Returns the public URL on success
function _M.upload(temp_path, original_filename)
    local cfg = _M.load_config()
    if not cfg.enabled then
        return nil, "图床未启用，请先在设置中配置"
    end

    -- Extract extension from original filename
    local ext = ""
    if original_filename then
        local idx = original_filename:find("%.[^%.]+$")
        if idx then
            ext = original_filename:sub(idx + 1):lower()
        end
    end
    if ext == "" then ext = "png" end

    -- Get original filename without extension
    local base = original_filename or "image"
    local dot_idx = base:find("%.[^%.]+$")
    if dot_idx then
        base = base:sub(1, dot_idx - 1)
    end

    -- Process filename template
    local filename = _M.process_template(cfg.filename_template, base, ext)
    local remote_path = cfg.remote_dir .. "/" .. filename
    -- Normalize: remove double slashes
    remote_path = remote_path:gsub("//", "/")

    -- Build SCP command
    local port_arg = ""
    if cfg.port and cfg.port ~= 22 then
        port_arg = " -P " .. cfg.port
    end

    local cmd = string.format(
        "scp%s -i '%s' -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes '%s' '%s@%s:%s' 2>&1",
        port_arg,
        cfg.ssh_key_path:gsub("'", "'\\\\''"),
        temp_path:gsub("'", "'\\\\''"),
        cfg.username:gsub("'", "'\\\\''"),
        cfg.host:gsub("'", "'\\\\''"),
        remote_path:gsub("'", "'\\\\''")
    )

    local handle = io.popen(cmd)
    local output = handle:read("*a")
    local success = handle:close()

    if not success then
        ngx.log(ngx.ERR, "imghost: SCP upload failed: ", output)
        return nil, "SCP 上传失败: " .. (output:gsub("\n", " ") or "未知错误")
    end

    -- Build public URL
    local base_url = cfg.public_url_base:gsub("/$", "")
    local url = base_url .. "/" .. filename

    return url
end

-- Test connection to SFTP server
function _M.test_connection()
    local cfg = _M.load_config()
    if not cfg.host or cfg.host == "" then
        return nil, "未配置主机地址"
    end

    local port_arg = ""
    if cfg.port and cfg.port ~= 22 then
        port_arg = " -P " .. cfg.port
    end

    local cmd = string.format(
        "ssh%s -i '%s' -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=10 '%s@%s' 'echo OK' 2>&1",
        port_arg,
        cfg.ssh_key_path:gsub("'", "'\\\\''"),
        cfg.username:gsub("'", "'\\\\''"),
        cfg.host:gsub("'", "'\\\\''")
    )

    local handle = io.popen(cmd)
    local output = handle:read("*a")
    local success = handle:close()

    if not success then
        return nil, "连接测试失败: " .. (output:gsub("\n", " ") or "连接超时")
    end

    return "连接成功: " .. (output:gsub("\n", "") or "OK")
end

return _M
