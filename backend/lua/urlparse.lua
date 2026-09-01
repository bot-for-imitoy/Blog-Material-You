--[[
  urlparse.lua — Minimal dependency-free URI parser.
  Used to parse BMY_DB_URL ("mariadb://user:pass@host:port/db?ssl_ca=...").
]]

local _M = {}

-- Percent-decode a string (also decodes "+" as space, per query rules)
local function pct_decode(s)
    if not s then return "" end
    s = s:gsub("+", " ")
    return (s:gsub("%%(%x%x)", function(h)
        return string.char(tonumber(h, 16))
    end))
end

-- Parse a generic URI: [scheme://][user[:pass]@]host[:port][/path][?query][#frag]
-- Returns { scheme, user, password, host, port, path, query = {k=v}, fragment }
function _M.parse(uri)
    if not uri or uri == "" then
        return nil, "empty uri"
    end
    local rest = uri

    -- scheme
    local scheme = nil
    local s = rest:find("://", 1, true)
    if s then
        scheme = rest:sub(1, s - 1):lower()
        rest = rest:sub(s + 3)
    end

    -- fragment
    local fragment = nil
    local f = rest:find("#", 1, true)
    if f then
        fragment = rest:sub(f + 1)
        rest = rest:sub(1, f - 1)
    end

    -- query
    local query = {}
    local q = rest:find("?", 1, true)
    if q then
        local qs = rest:sub(q + 1)
        rest = rest:sub(1, q - 1)
        for kv in qs:gmatch("[^&]+") do
            local k, v = kv:match("^([^=]+)=(.*)$")
            if k then
                query[pct_decode(k)] = pct_decode(v)
            else
                query[pct_decode(kv)] = true
            end
        end
    end

    -- authority / path
    local authority, path
    local slash = rest:find("/", 1, true)
    if slash then
        authority = rest:sub(1, slash - 1)
        path = rest:sub(slash)
    else
        authority = rest
        path = "/"
    end

    -- userinfo
    local user, password
    local at = authority:find("@", 1, true)
    if at then
        local ui = authority:sub(1, at - 1)
        authority = authority:sub(at + 1)
        local colon = ui:find(":", 1, true)
        if colon then
            user = pct_decode(ui:sub(1, colon - 1))
            password = pct_decode(ui:sub(colon + 1))
        else
            user = pct_decode(ui)
        end
    end

    -- host:port (with IPv6 literal support)
    local host, port
    if authority:sub(1, 1) == "[" then
        local close = authority:find("]", 1, true)
        if close then
            host = authority:sub(2, close - 1)
            local p = authority:sub(close + 1):match("^:(%d+)$")
            if p then port = tonumber(p) end
        else
            host = authority
        end
    else
        local colon = authority:find(":", 1, true)
        if colon then
            host = authority:sub(1, colon - 1)
            port = tonumber(authority:sub(colon + 1))
        else
            host = authority
        end
    end

    return {
        scheme = scheme,
        user = user,
        password = password,
        host = host,
        port = port,
        path = path,
        query = query,
        fragment = fragment,
    }
end

-- Parse a database URL: mariadb:// or mysql://
-- Supported query params (all optional):
--   ssl_ca=/path/ca.pem          CA bundle used to verify the server
--   ssl_cert=/path/client.crt    client certificate (mutual TLS)
--   ssl_key=/path/client.key     client private key (mutual TLS)
--   ssl_verify=0|1               verify the server certificate (default 1)
--   ssl_server_name=host         TLS SNI / hostname to verify against
-- Returns { host, port, database, user, password, ssl = {ca, cert, key, verify, server_name} }
function _M.parse_db_url(url)
    local u, err = _M.parse(url)
    if not u then
        return nil, err
    end
    if u.scheme ~= "mariadb" and u.scheme ~= "mysql" then
        return nil, "unsupported scheme '" .. tostring(u.scheme) .. "' (expected mariadb:// or mysql://)"
    end

    local database = nil
    if u.path and u.path ~= "/" then
        database = u.path:match("^/([^/]*)$")
    end

    local sv = u.query.ssl_verify
    local verify = (sv == nil or sv == "" or sv == "1" or sv == "true" or sv == "yes")

    local ssl = {
        ca = u.query.ssl_ca,
        cert = u.query.ssl_cert,
        key = u.query.ssl_key,
        verify = verify,
        server_name = u.query.ssl_server_name,
    }
    -- Drop empty entries so callers can test with `ssl.ca and ssl.ca ~= ""`
    for k, v in pairs(ssl) do
        if v == "" then ssl[k] = nil end
    end

    return {
        host = u.host,
        port = u.port,
        database = database,
        user = u.user,
        password = u.password,
        ssl = ssl,
    }
end

return _M
