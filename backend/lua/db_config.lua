--[[
  db_config.lua — Centralized MariaDB connection configuration.
  All settings can be overridden via environment variables so the blog can be
  pointed at a NEW database without touching code:

    BMY_DB_SOCKET — Unix socket path
                   (default: BMY_BLOG_DIR/data/mysql/mysql.sock)
    BMY_DB_HOST   — TCP host (optional; when set, TCP is used instead of socket)
    BMY_DB_PORT   — TCP port (default: 3306)
    BMY_DB_NAME   — database name (default: blogyou)
    BMY_DB_USER   — database user (default: blogyou)
    BMY_DB_PASS   — database password (default: blog-db-pass-2025)

  Example — point at a new MySQL/MariaDB server over TCP:
    BMY_DB_HOST=db.example.com BMY_DB_PORT=3306 \
    BMY_DB_NAME=myblog BMY_DB_USER=blog BMY_DB_PASS=s3cret \
    backend/start.sh
]]
local _M = {}

local function env(key, default)
    local val = os.getenv(key)
    if val and val ~= "" then return val end
    return default
end

-- Build the connection params table for resty.mysql:connect()
function _M.connect_params()
    local params = {
        database = env("BMY_DB_NAME", "blogyou"),
        user     = env("BMY_DB_USER", "blogyou"),
        password = env("BMY_DB_PASS", "blog-db-pass-2025"),
    }
    local host = env("BMY_DB_HOST", "")
    if host ~= "" then
        params.host = host
        params.port = tonumber(env("BMY_DB_PORT", "3306")) or 3306
    else
        params.path = require("utils").db_socket()
    end
    return params
end

return _M
