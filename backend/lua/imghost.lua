--[[
  imghost.lua — Image hosting module.
  Config stored in DB config table (key: "imghost_config").

  Two storage providers:
    "sftp" — upload via SCP to a remote SFTP server (legacy, default).
    "s3"   — upload to an S3-compatible object store (MinIO, AWS S3, ...)
             using the MinIO Client (mc) CLI shipped in the Docker image.

  All settings can be overridden via environment variables so the blog can be
  pointed at an external database / object store without touching code
  (required for distributed deployment):

    BMY_IMGHOST_PROVIDER   — "sftp" | "s3" (when set, enables imghost)
    BMY_S3_ENDPOINT        — S3 endpoint, e.g. http://minio:9000
    BMY_S3_BUCKET          — bucket name
    BMY_S3_ACCESS_KEY      — access key
    BMY_S3_SECRET_KEY      — secret key
    BMY_S3_REGION          — region (optional, default us-east-1)
    BMY_S3_PREFIX          — optional key prefix inside the bucket
    BMY_S3_PUBLIC_URL_BASE — optional public URL base (e.g. CDN domain)
    BMY_S3_INSECURE        — "1"/"true" to skip TLS verification (self-signed)
]]
local cjson = require("cjson")
local db = require("db")
local _M = {}

local CONFIG_KEY = "imghost_config"

-- Default config
local DEFAULT_CONFIG = {
    enabled = false,
    provider = "sftp",            -- "sftp" | "s3"
    -- SFTP (provider = "sftp")
    host = "",
    port = 22,
    username = "",
    ssh_key_path = "",
    remote_dir = "",
    -- S3 (provider = "s3")
    endpoint = "",
    bucket = "",
    access_key = "",
    secret_key = "",
    region = "",
    prefix = "",
    insecure = false,
    -- S3 TLS / mutual TLS (paths inside the container)
    ssl_ca = "",        -- CA bundle to verify the S3 server
    ssl_cert = "",      -- client certificate (mutual TLS)
    ssl_key = "",       -- client private key (mutual TLS)
    -- Common
    public_url_base = "",
    filename_template = "{yy}-{mm}-{dd}.{file_extension}",
}

local function env(key, default)
    local val = os.getenv(key)
    if val and val ~= "" then return val end
    return default
end

-- Merge stored config with defaults
local function fill_defaults(cfg)
    for k, v in pairs(DEFAULT_CONFIG) do
        if cfg[k] == nil then cfg[k] = v end
    end
    return cfg
end

-- Apply environment-variable overrides (deploy-time configuration).
-- Presence of all four required S3 vars enables S3 automatically;
-- BMY_IMGHOST_PROVIDER explicitly selects and enables the provider.
local function apply_env_overrides(cfg)
    local provider = env("BMY_IMGHOST_PROVIDER", "")
    if provider ~= "" then
        if provider == "sftp" or provider == "s3" then
            cfg.enabled = true
            cfg.provider = provider
        end
    end
    local s3_map = {
        endpoint = "BMY_S3_ENDPOINT",
        bucket = "BMY_S3_BUCKET",
        access_key = "BMY_S3_ACCESS_KEY",
        secret_key = "BMY_S3_SECRET_KEY",
        region = "BMY_S3_REGION",
        prefix = "BMY_S3_PREFIX",
        public_url_base = "BMY_S3_PUBLIC_URL_BASE",
        ssl_ca = "BMY_S3_SSL_CA",
        ssl_cert = "BMY_S3_SSL_CERT",
        ssl_key = "BMY_S3_SSL_KEY",
    }
    for k, envk in pairs(s3_map) do
        local v = env(envk, "")
        if v ~= "" then cfg[k] = v end
    end
    local insecure = env("BMY_S3_INSECURE", "")
    if insecure ~= "" then
        cfg.insecure = (insecure == "1" or insecure == "true" or insecure == "yes")
    end
    -- Auto-enable S3 when the four required vars are fully provided
    if cfg.provider == "s3" and cfg.endpoint ~= "" and cfg.bucket ~= ""
        and cfg.access_key ~= "" and cfg.secret_key ~= "" then
        cfg.enabled = true
    end
    return cfg
end

-- Load config from DB (merged with defaults + env overrides)
function _M.load_config()
    local res, err = db.query("SELECT `value` FROM config WHERE `key` = ?", {CONFIG_KEY})
    local cfg
    if not res or #res == 0 then
        cfg = {}
    else
        local ok, parsed = pcall(cjson.decode, res[1].value)
        if ok and type(parsed) == "table" then
            cfg = parsed
        else
            cfg = {}
        end
    end
    cfg = fill_defaults(cfg)
    cfg = apply_env_overrides(cfg)
    return cfg
end

-- Save config to DB
function _M.save_config(cfg)
    -- Normalize provider
    if cfg.provider ~= "s3" then cfg.provider = "sftp" end

    -- Validate required fields when enabled
    if cfg.enabled then
        if cfg.provider == "s3" then
            if not cfg.endpoint or cfg.endpoint == "" then
                return nil, "S3 Endpoint 不能为空"
            end
            if not cfg.bucket or cfg.bucket == "" then
                return nil, "S3 Bucket 不能为空"
            end
            if not cfg.access_key or cfg.access_key == "" then
                return nil, "S3 Access Key 不能为空"
            end
            if not cfg.secret_key or cfg.secret_key == "" then
                return nil, "S3 Secret Key 不能为空"
            end
            -- Mutual TLS: client cert and key must be provided together
            local has_cert = cfg.ssl_cert and cfg.ssl_cert ~= ""
            local has_key = cfg.ssl_key and cfg.ssl_key ~= ""
            if has_cert ~= has_key then
                return nil, "S3 客户端证书与私钥需同时提供（双向 TLS）"
            end
        else
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

-- Build the object key from the original filename using the template
local function build_key(cfg, original_filename)
    local ext = ""
    if original_filename then
        local idx = original_filename:find("%.[^%.]+$")
        if idx then
            ext = original_filename:sub(idx + 1):lower()
        end
    end
    if ext == "" then ext = "png" end

    local base = original_filename or "image"
    local dot_idx = base:find("%.[^%.]+$")
    if dot_idx then
        base = base:sub(1, dot_idx - 1)
    end

    local filename = _M.process_template(cfg.filename_template, base, ext)
    if cfg.provider == "s3" then
        local prefix = (cfg.prefix or ""):gsub("^/+", ""):gsub("/+$", "")
        if prefix ~= "" then
            return prefix .. "/" .. filename
        end
    else
        local remote_dir = (cfg.remote_dir or ""):gsub("/+$", "")
        if remote_dir ~= "" then
            return remote_dir .. "/" .. filename
        end
    end
    return filename
end

-- Run a shell command, return stdout+stderr and exit status
local function run_cmd(cmd)
    local handle = io.popen(cmd .. " 2>&1")
    if not handle then
        return nil, "failed to run command"
    end
    local output = handle:read("*a")
    local ok, _, code = handle:close()
    return output, nil, (ok and 0) or (code or 1)
end

-- ===================== S3 provider (python3 + boto3 helper) =====================

local AWS_DIR = "/tmp/bmy-aws"

-- Resolve the python interpreter: prefer /usr/bin/python3, fall back to PATH
local function python_bin()
    local f = io.open("/usr/bin/python3", "r")
    if f then
        f:close()
        return "/usr/bin/python3"
    end
    return "python3"
end

-- Resolve the S3 helper script path (backend/s3.py in the install prefix)
local function s3_helper_bin()
    local prefix = ngx.config.prefix()
    if prefix and prefix ~= "" then
        local f = io.open(prefix .. "s3.py", "r")
        if f then
            f:close()
            return prefix .. "s3.py"
        end
    end
    local f = io.open("/app/backend/s3.py", "r")
    if f then
        f:close()
        return "/app/backend/s3.py"
    end
    return "s3.py"
end

-- Quote a value for a single-quoted shell argument
local function shq(v)
    return "'" .. tostring(v):gsub("'", "'\\''") .. "'"
end

-- Ensure the AWS credentials file exists. Written from Lua so secrets never
-- appear on the command line. TLS options (CA bundle, client certificate)
-- are passed as plain paths via CLI args — the key material stays in files.
-- Returns the credentials dir or nil, err.
local function s3_ensure_aws_files(cfg)
    local ok_dir = os.execute("mkdir -p " .. AWS_DIR .. " 2>/dev/null")
    if ok_dir == false or ok_dir == nil then
        return nil, "无法创建 AWS 配置目录"
    end

    local creds = "[default]\n" ..
        "aws_access_key_id = " .. (cfg.access_key or "") .. "\n" ..
        "aws_secret_access_key = " .. (cfg.secret_key or "") .. "\n"
    local f, err = io.open(AWS_DIR .. "/credentials", "w")
    if not f then
        return nil, "无法写入 AWS 凭据: " .. (err or "")
    end
    f:write(creds)
    f:close()
    os.execute("chmod 600 " .. AWS_DIR .. "/credentials 2>/dev/null")
    return AWS_DIR
end

-- Build and run the S3 helper command; returns stdout or nil, err
local function s3_run(cfg, args)
    local dir, err = s3_ensure_aws_files(cfg)
    if not dir then
        return nil, err
    end

    local parts = {
        "AWS_SHARED_CREDENTIALS_FILE=" .. dir .. "/credentials",
        "AWS_DEFAULT_REGION=" .. (cfg.region ~= "" and cfg.region or "us-east-1"),
        python_bin(), s3_helper_bin(),
        "--endpoint", cfg.endpoint,
        "--bucket", cfg.bucket,
    }
    if cfg.ssl_ca and cfg.ssl_ca ~= "" then
        table.insert(parts, "--ca")
        table.insert(parts, cfg.ssl_ca)
    end
    if cfg.ssl_cert and cfg.ssl_cert ~= "" then
        table.insert(parts, "--client-cert")
        table.insert(parts, cfg.ssl_cert)
    end
    if cfg.insecure then
        table.insert(parts, "--insecure")
    end
    for _, a in ipairs(args) do
        table.insert(parts, a)
    end
    -- Quote all values; leave env assignments and absolute paths unquoted.
    local quoted = {}
    for _, p in ipairs(parts) do
        if p:match("^[%w_]+=") or p:match("^/") then
            quoted[#quoted + 1] = p
        else
            quoted[#quoted + 1] = shq(p)
        end
    end
    local cmd = table.concat(quoted, " ")
    local output, _, code = run_cmd(cmd)
    if code ~= 0 then
        return nil, (output or ""):gsub("\n", " ")
    end
    return output
end

-- Upload a file to S3; returns the public URL or nil, err
local function s3_upload(cfg, temp_path, key)
    -- Normalize key: no leading slash
    key = key:gsub("^/+", "")

    local output, err = s3_run(cfg, { "cp", "--file", temp_path, "--key", key })
    if not output then
        ngx.log(ngx.ERR, "imghost: S3 upload failed: ", err)
        return nil, "S3 上传失败: " .. (err or "未知错误")
    end

    -- Build public URL
    local url
    local pub = (cfg.public_url_base or ""):gsub("/+$", "")
    if pub ~= "" then
        url = pub .. "/" .. key
    else
        local endpoint = cfg.endpoint
        if not endpoint:match("^https?://") then
            endpoint = "https://" .. endpoint
        end
        url = endpoint:gsub("/+$", "") .. "/" .. cfg.bucket .. "/" .. key
    end
    return url
end

-- ===================== SFTP provider (scp) =====================

-- Upload a file via SCP to the configured SFTP server; returns the public URL
local function sftp_upload(cfg, temp_path, key)
    local port_arg = ""
    if cfg.port and cfg.port ~= 22 then
        port_arg = " -P " .. cfg.port
    end

    local remote_path = key
    -- key already contains remote_dir prefix (see build_key), normalize slashes
    remote_path = remote_path:gsub("//", "/")

    local cmd = string.format(
        "scp%s -i '%s' -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes '%s' '%s@%s:%s' 2>&1",
        port_arg,
        cfg.ssh_key_path:gsub("'", "'\\\\''"),
        temp_path:gsub("'", "'\\\\''"),
        cfg.username:gsub("'", "'\\\\''"),
        cfg.host:gsub("'", "'\\\\''"),
        remote_path:gsub("'", "'\\\\''")
    )
    local output, _, code = run_cmd(cmd)
    if code ~= 0 then
        ngx.log(ngx.ERR, "imghost: SCP upload failed: ", output)
        return nil, "SCP 上传失败: " .. ((output or ""):gsub("\n", " ") or "未知错误")
    end

    local base_url = cfg.public_url_base:gsub("/$", "")
    local filename = remote_path:match("([^/]+)$") or remote_path
    return base_url .. "/" .. filename
end

-- ===================== Public API =====================

-- Upload a file using the configured provider.
-- original_filename drives the filename template (builds the object key).
function _M.upload(temp_path, original_filename)
    local cfg = _M.load_config()
    if not cfg.enabled then
        return nil, "图床未启用，请先在设置中配置"
    end
    local key = build_key(cfg, original_filename)
    if cfg.provider == "s3" then
        return s3_upload(cfg, temp_path, key)
    end
    return sftp_upload(cfg, temp_path, key)
end

-- Upload a file with an explicit object key (used by avatar uploads).
function _M.upload_key(temp_path, key)
    local cfg = _M.load_config()
    if not cfg.enabled then
        return nil, "图床未启用，请先在设置中配置"
    end
    if cfg.provider == "s3" then
        return s3_upload(cfg, temp_path, key)
    end
    return sftp_upload(cfg, temp_path, key)
end

-- Test connection to the configured storage
function _M.test_connection()
    local cfg = _M.load_config()
    if cfg.provider == "s3" then
        if not cfg.bucket or cfg.bucket == "" then
            return nil, "未配置 Bucket"
        end
        local output, err = s3_run(cfg, { "ls" })
        if not output then
            return nil, "S3 连接测试失败: " .. (err or "未知错误")
        end
        return "S3 连接成功: " .. (cfg.endpoint or "") .. "/" .. cfg.bucket
    end

    -- SFTP test (legacy)
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
    local output, _, code = run_cmd(cmd)
    if code ~= 0 then
        return nil, "连接测试失败: " .. ((output or ""):gsub("\n", " ") or "连接超时")
    end
    return "连接成功: " .. ((output or ""):gsub("\n", "") or "OK")
end

return _M
