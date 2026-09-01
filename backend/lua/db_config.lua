--[[
  db_config.lua — Centralized MariaDB connection configuration.

  Two configuration styles are supported:

  1) Connection URL (recommended for remote/SSL databases), via BMY_DB_URL:

       mariadb://user:pass@host:3306/dbname?ssl_ca=/certs/ca.pem&ssl_cert=/certs/client.crt&ssl_key=/certs/client.key
       mysql://user:pass@host:3306/dbname

     Query params (all optional):
       ssl_ca=/path/ca.pem          CA bundle to verify the server
       ssl_cert=/path/client.crt    client certificate (mutual TLS)
       ssl_key=/path/client.key     client private key (mutual TLS)
       ssl_verify=0|1               verify server cert (default 1)
       ssl_server_name=host         TLS SNI / hostname to verify

  2) Individual environment variables (legacy / local socket):

       BMY_DB_SOCKET — Unix socket path
       BMY_DB_HOST   — TCP host (when set, TCP is used instead of socket)
       BMY_DB_PORT   — TCP port (default: 3306)
       BMY_DB_NAME   — database name (default: blogyou)
       BMY_DB_USER   — database user (default: blogyou)
       BMY_DB_PASS   — database password (default: blog-db-pass-2025)

  When BMY_DB_URL is set it takes precedence over the individual variables.
  All settings are read from the environment so the blog can be pointed at a
  NEW database without touching code.
]]
local _M = {}

local function env(key, default)
    local val = os.getenv(key)
    if val and val ~= "" then return val end
    return default
end

-- Build the connection params table for resty.mysql:connect()
function _M.connect_params()
    -- 1) Connection URL form (supports SSL / mutual TLS)
    local url = env("BMY_DB_URL", "")
    if url ~= "" then
        local urlparse = require("urlparse")
        local db, perr = urlparse.parse_db_url(url)
        if not db then
            error("invalid BMY_DB_URL: " .. tostring(perr))
        end
        local params = {
            database = db.database or env("BMY_DB_NAME", "blogyou"),
            user     = db.user or env("BMY_DB_USER", "blogyou"),
            password = db.password or env("BMY_DB_PASS", "blog-db-pass-2025"),
        }
        if db.host and db.host ~= "" then
            params.host = db.host
            params.port = db.port or (tonumber(env("BMY_DB_PORT", "3306")) or 3306)
        else
            params.path = require("utils").db_socket()
        end
        -- TLS / mutual TLS via lua-resty-mysql SSL options
        local ssl = db.ssl or {}
        if ssl.ca or ssl.cert or ssl.key then
            params.ssl = true
            params.ssl_verify = ssl.verify ~= false
            if ssl.ca then params.ssl_ca_cert_path = ssl.ca end
            if ssl.cert then params.ssl_cert_path = ssl.cert end
            if ssl.key then params.ssl_key_path = ssl.key end
            if ssl.server_name then params.ssl_server_name = ssl.server_name end
        end
        return params
    end

    -- 2) Legacy individual environment variables
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
